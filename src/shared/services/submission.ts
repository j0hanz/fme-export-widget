import type {
  ExportResult,
  MutableParams,
  ServiceMode,
  SubmissionOrchestrationOptions,
  SubmissionOrchestrationResult,
  SubmissionPreparationOptions,
  SubmissionPreparationResult,
} from "../../config/index";
import {
  applyDirectiveDefaults,
  buildSupportHintText,
  determineServiceMode,
  getEmail,
  isAbortError,
  isNonEmptyTrimmedString,
  mapErrorFromNetwork,
  normalizeServiceModeConfig,
  parseSubmissionFormData,
  prepFmeParams,
  removeAoiErrorMarker,
  resolveMessageOrKey,
  toTrimmedString,
} from "../utils";
import { processFmeResponse } from "../utils/fme";
import { getSupportEmail } from "../validations";
import { resolveRemoteDataset } from "./dataset";

// Förbereder submission-parametrar med AOI och remote dataset-upplösning
export async function prepareSubmissionParams({
  rawFormData,
  userEmail,
  geometryJson,
  geometry,
  modules,
  config,
  workspaceParameters,
  workspaceItem,
  selectedWorkspaceName,
  areaWarning,
  drawnArea,
  makeCancelable,
  fmeClient,
  signal,
  remoteDatasetSubfolder,
  onStatusChange,
}: SubmissionPreparationOptions): Promise<SubmissionPreparationResult> {
  onStatusChange?.("normalizing");
  const { sanitizedFormData, uploadFile, remoteUrl } =
    parseSubmissionFormData(rawFormData);
  const normalizedConfig = normalizeServiceModeConfig(config || undefined);

  const baseParams = prepFmeParams(
    {
      data: sanitizedFormData,
    },
    userEmail,
    geometryJson,
    geometry || undefined,
    modules,
    {
      config: normalizedConfig,
      workspaceParameters,
      workspaceItem,
      areaWarning,
      drawnArea,
    }
  );

  const aoiError = (baseParams as MutableParams).__aoi_error__;
  if (aoiError) {
    onStatusChange?.("complete");
    return { params: null, aoiError };
  }

  const params: MutableParams = { ...baseParams };

  const shouldResolveRemoteDataset = Boolean(
    uploadFile || isNonEmptyTrimmedString(remoteUrl)
  );

  if (shouldResolveRemoteDataset) {
    onStatusChange?.("resolvingDataset");
  }

  await resolveRemoteDataset({
    params,
    remoteUrl,
    uploadFile,
    config: normalizedConfig,
    workspaceParameters,
    makeCancelable,
    fmeClient,
    signal,
    subfolder: remoteDatasetSubfolder,
    workspaceName:
      toTrimmedString(workspaceItem?.name) ||
      toTrimmedString(selectedWorkspaceName) ||
      null,
  });

  onStatusChange?.("applyingDefaults");
  const paramsWithDefaults = applyDirectiveDefaults(params, normalizedConfig);
  removeAoiErrorMarker(paramsWithDefaults as MutableParams);

  onStatusChange?.("complete");
  return { params: paramsWithDefaults };
}

// Bygger ExportResult från lyckad FME-submission
export function buildSubmissionSuccessResult(
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translate: (id: string, data?: { [key: string]: string | number }) => string,
  serviceMode?: ServiceMode | null
): ExportResult {
  const baseResult = processFmeResponse(
    fmeResponse,
    workspace,
    userEmail,
    translate
  );

  return {
    ...baseResult,
    ...(serviceMode ? { serviceMode } : {}),
  };
}

// Bygger ExportResult från submission-fel
export function buildSubmissionErrorResult(
  error: unknown,
  translate: (id: string, data?: { [key: string]: string | number }) => string,
  supportEmail: string | null | undefined,
  serviceMode?: ServiceMode | null
): ExportResult | null {
  if (isAbortError(error)) {
    return null;
  }

  const rawKey = mapErrorFromNetwork(error);
  let localizedErr = "";
  if (rawKey) {
    try {
      localizedErr = resolveMessageOrKey(rawKey, translate);
    } catch {
      localizedErr = "";
    }
  }

  const contactHint = buildSupportHintText(translate, supportEmail);
  const baseFailMessage = translate("errorOrderFailed");

  // Build message parts, filtering out empty strings
  const parts = [baseFailMessage, localizedErr, contactHint].filter(Boolean);
  const resultMessage = parts.join(". ");

  return {
    success: false,
    message: resultMessage,
    code: (error as { code?: string }).code || "SUBMISSION_ERROR",
    ...(serviceMode ? { serviceMode } : {}),
  };
}

// Orchestrerar hela submission-flödet: validering, förberedelse, körning
export async function executeJobSubmission(
  options: SubmissionOrchestrationOptions
): Promise<SubmissionOrchestrationResult> {
  const {
    formData,
    config,
    geometryJson,
    modules,
    workspaceParameters,
    workspaceItem,
    selectedWorkspace,
    areaWarning,
    drawnArea,
    fmeClient,
    submissionAbort,
    widgetId,
    translate,
    makeCancelable,
    onStatusChange,
    getActiveGeometry,
  } = options;

  let controller: AbortController | null = null;
  let serviceMode: ServiceMode | null = null;

  try {
    const rawDataEarly = ((formData as { [key: string]: unknown })?.data ||
      {}) as {
      [key: string]: unknown;
    };

    const determinedMode = determineServiceMode(
      { data: rawDataEarly },
      config,
      {
        workspaceItem,
        areaWarning,
        drawnArea,
        onModeOverride: () => {
          // Mode override handled by caller's side-effect
        },
      }
    );
    serviceMode =
      determinedMode === "sync" || determinedMode === "async"
        ? determinedMode
        : null;

    const userEmail = serviceMode === "async" ? await getEmail(config) : "";
    const workspace = selectedWorkspace;

    if (!workspace) {
      return {
        success: false,
        error: new Error("No workspace selected"),
        serviceMode,
      };
    }

    controller = submissionAbort.abortAndCreate();
    const subfolder = `widget_${widgetId || "fme"}`;

    const preparation = await prepareSubmissionParams({
      rawFormData: rawDataEarly,
      userEmail,
      geometryJson,
      geometry: getActiveGeometry() || undefined,
      modules,
      config,
      workspaceParameters,
      workspaceItem,
      selectedWorkspaceName: workspace,
      areaWarning,
      drawnArea,
      makeCancelable,
      fmeClient,
      signal: controller.signal,
      remoteDatasetSubfolder: subfolder,
      onStatusChange,
    });

    if (preparation.aoiError) {
      return {
        success: false,
        error: preparation.aoiError,
        serviceMode,
      };
    }

    const finalParams = preparation.params;
    if (!finalParams) {
      throw new Error("Submission parameter preparation failed");
    }

    onStatusChange?.("submitting");
    const fmeResponse = await makeCancelable(
      fmeClient.runWorkspace(
        workspace,
        finalParams,
        undefined,
        controller.signal
      )
    );

    if (controller.signal.aborted) {
      return { success: false, serviceMode };
    }

    const result = buildSubmissionSuccessResult(
      fmeResponse,
      workspace,
      userEmail,
      translate,
      serviceMode
    );

    return { success: true, result, serviceMode };
  } catch (error) {
    const supportEmail = getSupportEmail(config?.supportEmail);
    const errorResult = buildSubmissionErrorResult(
      error,
      translate,
      supportEmail,
      serviceMode
    );

    if (!errorResult) {
      // Abort error, return unsuccessful but no error result
      return { success: false, serviceMode };
    }

    return { success: false, result: errorResult, error, serviceMode };
  } finally {
    submissionAbort.finalize(controller);
  }
}
