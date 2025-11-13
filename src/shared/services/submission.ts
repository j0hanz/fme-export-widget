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

interface RawFormData {
  [key: string]: unknown;
}

interface SubmissionContext {
  workspace: string;
  serviceMode: ServiceMode | null;
  userEmail: string;
  rawFormData: RawFormData;
}

type SubmissionContextResult =
  | { status: "success"; context: SubmissionContext }
  | { status: "error"; result: SubmissionOrchestrationResult };

type ParamsPreparationOutcome =
  | { status: "success"; params: MutableParams | null }
  | { status: "error"; result: SubmissionOrchestrationResult };

const isFailedContextResult = (
  result: SubmissionContextResult
): result is { status: "error"; result: SubmissionOrchestrationResult } =>
  result.status === "error";

const isFailedParamsOutcome = (
  outcome: ParamsPreparationOutcome
): outcome is { status: "error"; result: SubmissionOrchestrationResult } =>
  outcome.status === "error";

const extractRawFormData = (
  formData: SubmissionOrchestrationOptions["formData"]
): RawFormData => {
  const data = (formData as { data?: unknown })?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as RawFormData;
  }
  return {};
};

const determineSubmissionContext = async (options: {
  formData: SubmissionOrchestrationOptions["formData"];
  config: SubmissionOrchestrationOptions["config"];
  workspaceItem: SubmissionOrchestrationOptions["workspaceItem"];
  areaWarning: SubmissionOrchestrationOptions["areaWarning"];
  drawnArea: SubmissionOrchestrationOptions["drawnArea"];
  selectedWorkspace: SubmissionOrchestrationOptions["selectedWorkspace"];
}): Promise<SubmissionContextResult> => {
  const rawFormData = extractRawFormData(options.formData);
  const determinedMode = determineServiceMode(
    { data: rawFormData },
    options.config,
    {
      workspaceItem: options.workspaceItem,
      areaWarning: options.areaWarning,
      drawnArea: options.drawnArea,
      onModeOverride: () => {
        // Mode override handled upstream
      },
    }
  );

  const serviceMode =
    determinedMode === "sync" || determinedMode === "async"
      ? determinedMode
      : null;

  const userEmail =
    serviceMode === "async" ? await getEmail(options.config) : "";
  const workspace = options.selectedWorkspace;

  if (!workspace) {
    return {
      status: "error",
      result: {
        success: false,
        error: new Error("No workspace selected"),
        serviceMode,
      },
    };
  }

  return {
    status: "success",
    context: {
      workspace,
      serviceMode,
      userEmail,
      rawFormData,
    },
  };
};

interface ParamsPreparationOptions {
  rawFormData: RawFormData;
  userEmail: string;
  geometryJson: SubmissionPreparationOptions["geometryJson"];
  geometry: SubmissionPreparationOptions["geometry"];
  modules: SubmissionPreparationOptions["modules"];
  config: SubmissionPreparationOptions["config"];
  workspaceParameters: SubmissionPreparationOptions["workspaceParameters"];
  workspaceItem: SubmissionPreparationOptions["workspaceItem"];
  selectedWorkspaceName: string;
  areaWarning: SubmissionPreparationOptions["areaWarning"];
  drawnArea: SubmissionPreparationOptions["drawnArea"];
  makeCancelable: SubmissionPreparationOptions["makeCancelable"];
  fmeClient: SubmissionPreparationOptions["fmeClient"];
  signal: AbortSignal;
  remoteDatasetSubfolder: string;
  onStatusChange?: SubmissionPreparationOptions["onStatusChange"];
  serviceMode: ServiceMode | null;
}

const prepareParamsOrReturnFailure = async (
  options: ParamsPreparationOptions
): Promise<ParamsPreparationOutcome> => {
  const preparation = await prepareSubmissionParams({
    rawFormData: options.rawFormData,
    userEmail: options.userEmail,
    geometryJson: options.geometryJson,
    geometry: options.geometry,
    modules: options.modules,
    config: options.config,
    workspaceParameters: options.workspaceParameters,
    workspaceItem: options.workspaceItem,
    selectedWorkspaceName: options.selectedWorkspaceName,
    areaWarning: options.areaWarning,
    drawnArea: options.drawnArea,
    makeCancelable: options.makeCancelable,
    fmeClient: options.fmeClient,
    signal: options.signal,
    remoteDatasetSubfolder: options.remoteDatasetSubfolder,
    onStatusChange: options.onStatusChange,
  });

  if (preparation.aoiError) {
    return {
      status: "error",
      result: {
        success: false,
        error: preparation.aoiError,
        serviceMode: options.serviceMode,
      },
    };
  }

  return { status: "success", params: preparation.params ?? null };
};

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

  let userEmail = "";
  let workspace = "";
  let rawFormData: RawFormData = {};

  try {
    const contextResult = await determineSubmissionContext({
      formData,
      config,
      workspaceItem,
      areaWarning,
      drawnArea,
      selectedWorkspace,
    });

    if (isFailedContextResult(contextResult)) {
      const failure = contextResult.result;
      serviceMode = failure.serviceMode ?? serviceMode;
      return failure;
    }

    serviceMode = contextResult.context.serviceMode;
    userEmail = contextResult.context.userEmail;
    workspace = contextResult.context.workspace;
    rawFormData = contextResult.context.rawFormData;

    controller = submissionAbort.abortAndCreate();
    const subfolder = `widget_${widgetId || "fme"}`;

    const paramsOutcome = await prepareParamsOrReturnFailure({
      rawFormData,
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
      serviceMode,
    });

    if (isFailedParamsOutcome(paramsOutcome)) {
      return paramsOutcome.result;
    }

    const finalParams = paramsOutcome.params;
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
