/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx, React } from "jimu-core";
import type {
  DetermineServiceModeOptions,
  Dictionary,
  EsriModules,
  ForceAsyncResult,
  ImmutableLikeConfig,
  PrimitiveParams,
  WebhookArtifactOptions,
  WebhookArtifacts,
  WorkspaceItemDetail,
} from "../../config/index";
import {
  ALLOWED_SERVICE_MODES,
  FME_FLOW_API,
  LOOPBACK_IPV6,
  TM_NUMERIC_PARAM_KEYS,
  WEBHOOK_EXCLUDE_PARAMS,
} from "../../config/index";
import type {
  ExportResult,
  FmeExportConfig,
  NormalizedServiceInfo,
  ServiceMode,
  TranslateFn,
  ViewAction,
  ViewState,
  WebhookErrorCode,
  WorkspaceItem,
  WorkspaceParameter,
} from "../../config/types";
import { makeErrorView } from "../../config/types";
import { validateAndNormalizeUrl } from "../validations";
import {
  toBooleanValue,
  toNonEmptyTrimmedString,
  toTrimmedString,
  toTrimmedStringOrEmpty,
} from "./conversion";
import {
  collectStringsFromProp,
  sanitizeOptGetUrlParam,
  uniqueStrings,
} from "./form";
import { formatByteSize, maskEmailForDisplay } from "./format";
import { attachAoi, collectGeometryParamNames } from "./geometry";
import { buildParams, buildUrl, safeParseUrl } from "./network";

const toDictionary = (value: unknown): Dictionary | null => {
  if (typeof value !== "object" || value === null) return null;
  if (Array.isArray(value)) return null;
  return value as Dictionary;
};

const extractFormData = (formData: unknown): Dictionary => {
  const container = toDictionary(formData);
  const dataValue = container?.data;
  return toDictionary(dataValue) ?? {};
};

const hasImmutableSet = (
  candidate: unknown
): candidate is ImmutableLikeConfig =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate) &&
  typeof (candidate as { set?: unknown }).set === "function";

// Bygger ViewState för att visa resultatet av ett FME-exportjobb
export const deriveOrderResultStatus = (
  result: ExportResult | null | undefined,
  config: FmeExportConfig | null | undefined
): {
  readonly hasResult: boolean;
  readonly isCancelled: boolean;
  readonly isSuccess: boolean;
  readonly serviceMode: ServiceMode;
} => {
  const hasResult = Boolean(result);
  const isCancelled = Boolean(result?.cancelled);
  const isSuccess = hasResult && !isCancelled && Boolean(result?.success);
  const fallbackMode: ServiceMode = config?.syncMode ? "sync" : "async";
  const serviceMode: ServiceMode =
    result?.serviceMode === "sync" || result?.serviceMode === "async"
      ? result.serviceMode
      : fallbackMode;

  return { hasResult, isCancelled, isSuccess, serviceMode };
};

export const buildOrderResultView = (
  result: ExportResult | null | undefined,
  config: FmeExportConfig | null | undefined,
  translate: TranslateFn,
  handlers: {
    readonly onReuseGeography?: () => void;
    readonly onBack?: () => void;
    readonly onReset?: () => void;
  },
  alertNode?: React.ReactNode,
  fallbackDownloadUrl?: string | null
): ViewState => {
  if (!result) {
    return makeErrorView(translate("msgNoResult"), {
      code: "NO_RESULT",
      actions: handlers.onBack
        ? [{ label: translate("btnBack"), onClick: handlers.onBack }]
        : undefined,
    });
  }

  const { isCancelled, isSuccess, serviceMode } = deriveOrderResultStatus(
    result,
    config
  );
  const isFailure = !isCancelled && !isSuccess;

  // Build info detail section
  const infoLines: string[] = [];
  if (result.jobId !== undefined && result.jobId !== null) {
    infoLines.push(`${translate("lblJobId")}: ${result.jobId}`);
  }
  if (result.workspaceName) {
    infoLines.push(`${translate("lblWorkspace")}: ${result.workspaceName}`);
  }
  const deliveryModeKey =
    serviceMode === "async" ? "optAsyncMode" : "optSyncMode";
  infoLines.push(`${translate("lblDelivery")}: ${translate(deliveryModeKey)}`);

  if (result.downloadFilename) {
    infoLines.push(`${translate("lblFilename")}: ${result.downloadFilename}`);
  }
  if (result.status) {
    infoLines.push(`${translate("lblFmeStatus")}: ${result.status}`);
  }
  if (result.statusMessage && result.statusMessage !== result.message) {
    infoLines.push(`${translate("lblFmeMessage")}: ${result.statusMessage}`);
  }
  if (result.blobMetadata?.type) {
    infoLines.push(`${translate("lblBlobType")}: ${result.blobMetadata.type}`);
  }
  if (result.blobMetadata?.size) {
    const sizeFormatted = formatByteSize(result.blobMetadata.size);
    if (sizeFormatted) {
      infoLines.push(`${translate("lblBlobSize")}: ${sizeFormatted}`);
    }
  }
  if (serviceMode !== "sync" && result.email) {
    const masked =
      config?.maskEmailOnSuccess && isSuccess
        ? maskEmailForDisplay(result.email)
        : result.email;
    infoLines.push(`${translate("lblEmail")}: ${masked}`);
  }
  // Note: Error code is displayed by StateView component, not added to infoLines

  // Determine message text
  let messageText: string | null = null;
  if (isCancelled) {
    const failureCode = (result.code || "").toString().toUpperCase();
    const isTimeout = failureCode.includes("TIMEOUT");
    messageText = isTimeout
      ? translate("msgOrderTimeout")
      : translate("msgOrderCancelled");
  } else if (isSuccess) {
    if (serviceMode === "async") {
      messageText = translate("msgEmailSent");
    }
  } else {
    const failureCode = (result.code || "").toString().toUpperCase();
    const rawMessage = result.message || result.statusMessage || "";

    if (failureCode === "FME_JOB_CANCELLED_TIMEOUT") {
      messageText = translate("msgJobTimeout");
    } else if (failureCode === "FME_JOB_CANCELLED") {
      messageText = translate("msgJobCancelled");
    } else if (
      failureCode === "FME_JOB_FAILURE" ||
      /FME\s*Flow\s*transformation\s*failed/i.test(rawMessage)
    ) {
      messageText = translate("errTransformFailed");
    } else if (rawMessage) {
      messageText = rawMessage;
    } else {
      messageText = translate("msgJobFailed");
    }
  }

  // Build actions
  const actions: ViewAction[] = [];

  if (isCancelled) {
    actions.push({
      label: translate("btnNewOrder"),
      onClick: () => {
        handlers.onReuseGeography?.();
      },
      type: "primary" as const,
    });
  } else if (isSuccess) {
    actions.push({
      label: translate("btnReuseArea"),
      onClick: () => {
        handlers.onReuseGeography?.();
      },
      type: "primary" as const,
    });
  } else {
    // Failure
    actions.push({
      label: translate("btnRetry"),
      onClick: () => {
        handlers.onBack?.();
      },
      type: "primary" as const,
    });
  }

  // Secondary "Close" action
  actions.push({
    label: translate("btnEnd"),
    onClick: () => {
      if (handlers.onReset) {
        handlers.onReset();
      } else {
        handlers.onBack?.();
      }
    },
    type: "default" as const,
  });

  // Build info detail React node
  const infoDetail =
    infoLines.length > 0
      ? jsx(
          React.Fragment,
          null,
          ...infoLines.map((line, idx) => jsx("div", { key: idx }, line))
        )
      : null;

  // Hanter nedladdningslänk för synkrona jobb
  let downloadNode: React.ReactNode = null;
  if (isSuccess && serviceMode === "sync") {
    const downloadUrl = result.downloadUrl || fallbackDownloadUrl || null;
    if (downloadUrl) {
      // Fallback download button if auto-download didn't start
      downloadNode = jsx(
        "div",
        { style: { marginBottom: "0.5rem" } },
        jsx(
          "a",
          {
            href: downloadUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            download: result.downloadFilename || "download",
          },
          translate("btnDownloadFallback")
        )
      );
    }
  }

  // Kombinerar alla detaljdelar
  const fullDetail =
    alertNode || infoDetail || downloadNode || messageText
      ? jsx(
          React.Fragment,
          null,
          alertNode,
          infoDetail,
          downloadNode,
          messageText && jsx("div", null, messageText)
        )
      : undefined;

  // Return appropriate ViewState
  if (isFailure) {
    const titleText = translate("titleOrderFailed");
    return makeErrorView(titleText, {
      code: result.code,
      actions,
      detail: fullDetail,
    });
  }

  // Success or cancelled
  const titleText = isCancelled
    ? translate("titleOrderCancelled")
    : serviceMode === "sync"
      ? translate("titleOrderComplete")
      : translate("titleOrderConfirmed");

  return {
    kind: "success",
    title: titleText,
    message: undefined,
    actions,
    detail: fullDetail,
  };
};

const isLoopbackHostname = (hostname: string): boolean => {
  if (!hostname) return false;
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost") return true;
  if (normalized === "::1" || normalized === LOOPBACK_IPV6) return true;
  if (normalized.startsWith("127.")) return true;
  return false;
};

const shouldForceAsyncMode = (
  config: FmeExportConfig | undefined,
  options?: {
    workspaceItem?: WorkspaceItem | WorkspaceItemDetail | null;
    areaWarning?: boolean;
    drawnArea?: number;
    formData?: unknown;
    userEmail?: string;
  }
): ForceAsyncResult | null => {
  if (!options) return null;

  if (options.areaWarning) {
    return {
      reason: "area",
      value: options.drawnArea,
      threshold: config?.largeArea,
    };
  }

  if (typeof config?.largeArea === "number" && options.drawnArea != null) {
    if (options.drawnArea > config.largeArea) {
      return {
        reason: "area",
        value: options.drawnArea,
        threshold: config.largeArea,
      };
    }
  }

  // Check URL length for sync mode
  if (options.formData && config) {
    try {
      const data = (options.formData as { [key: string]: unknown })?.data || {};
      const mockParams = buildFmeParams(
        { data },
        options.userEmail || "",
        "sync",
        config
      );

      const workspaceName = options.workspaceItem?.name;
      if (workspaceName && config.fmeServerUrl && config.repository) {
        const urlCheck = isWebhookUrlTooLong({
          serverUrl: config.fmeServerUrl,
          repository: config.repository,
          workspace: workspaceName,
          parameters: mockParams,
          token: config.fmeServerToken,
          options: { requireHttps: config.requireHttps },
        });

        if (urlCheck) {
          const { fullUrl } = createWebhookArtifacts(
            config.fmeServerUrl,
            config.repository,
            workspaceName,
            mockParams,
            config.fmeServerToken,
            { requireHttps: config.requireHttps }
          );
          return {
            reason: "url_length",
            urlLength: fullUrl.length,
            threshold: FME_FLOW_API.MAX_URL_LENGTH,
          };
        }
      }
    } catch {
      // Silently ignore URL validation errors - will be caught at submission
    }
  }

  return null;
};

export const normalizeServiceModeConfig = (
  config: FmeExportConfig | null | undefined
): FmeExportConfig | undefined => {
  if (!config) return config ?? undefined;

  const rawValue = config.syncMode;
  let normalized =
    typeof rawValue === "boolean" ? rawValue : toBooleanValue(rawValue);

  if (normalized === undefined) {
    normalized = Boolean(rawValue);
  }

  if (typeof rawValue === "boolean" && rawValue === normalized) {
    return config;
  }

  const cloned = { ...config, syncMode: normalized };
  if (hasImmutableSet(config)) {
    Object.defineProperty(cloned, "set", {
      value: config.set,
      writable: true,
      configurable: true,
    });
  }
  return cloned;
};

export const determineServiceMode = (
  formData: unknown,
  config?: FmeExportConfig,
  options?: DetermineServiceModeOptions
): ServiceMode => {
  const data = extractFormData(formData);
  const overrideValue = data._serviceMode;
  const override = toNonEmptyTrimmedString(
    toTrimmedStringOrEmpty(overrideValue)
  ).toLowerCase();

  let resolved: ServiceMode;
  if (override === "sync" || override === "async") {
    resolved = override as ServiceMode;
  } else {
    resolved = config?.syncMode ? "sync" : "async";
  }

  const forceInfo = shouldForceAsyncMode(config, {
    workspaceItem: options?.workspaceItem,
    areaWarning: options?.areaWarning,
    drawnArea: options?.drawnArea,
    formData,
    userEmail:
      typeof data.opt_requesteremail === "string"
        ? data.opt_requesteremail
        : "",
  });

  if (forceInfo && resolved === "sync") {
    options?.onModeOverride?.({
      forcedMode: "async",
      previousMode: "sync",
      reason: forceInfo.reason,
      value: forceInfo.value,
      threshold: forceInfo.threshold,
      urlLength: forceInfo.urlLength,
    });
    return "async";
  }

  return resolved;
};

export const buildFmeParams = (
  formData: unknown,
  userEmail: string,
  serviceMode: ServiceMode = "async",
  config?: FmeExportConfig | null
): { [key: string]: unknown } => {
  const data = extractFormData(formData);
  const mode = ALLOWED_SERVICE_MODES.includes(serviceMode)
    ? serviceMode
    : "async";
  const includeResult = config?.showResult ?? true;

  const base: { [key: string]: unknown } = {
    ...data,
    opt_servicemode: mode,
    opt_responseformat: "json",
    opt_showresult: includeResult ? "true" : "false",
  };

  const trimmedEmail = toNonEmptyTrimmedString(userEmail);
  if (mode === "async" && trimmedEmail) {
    base.opt_requesteremail = trimmedEmail;
  }

  return base;
};

export const applyDirectiveDefaults = (
  params: { [key: string]: unknown },
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  if (!config) return params;

  const out: { [key: string]: unknown } = { ...params };
  const toPosInt = (v: unknown): number | undefined => {
    const parsed = parseNonNegativeInt(v);
    if (parsed === undefined || parsed <= 0) return undefined;
    return parsed;
  };

  const rawMode = (() => {
    const candidate = params.opt_servicemode;
    if (typeof candidate === "string") return candidate;
    const cloned = out.opt_servicemode;
    return toTrimmedStringOrEmpty(cloned);
  })();

  const normalizedMode = toNonEmptyTrimmedString(rawMode).toLowerCase();

  const allowTmTtc =
    normalizedMode === "sync" || (!normalizedMode && Boolean(config?.syncMode));

  if (!allowTmTtc && typeof out.tm_ttc !== "undefined") {
    delete out.tm_ttc;
  } else if (allowTmTtc && !("tm_ttc" in out)) {
    const v = toPosInt(config?.tm_ttc);
    if (v !== undefined) out.tm_ttc = v;
  }
  if (!("tm_ttl" in out)) {
    const v = toPosInt(config?.tm_ttl);
    if (v !== undefined) out.tm_ttl = v;
  }

  return out;
};

export const parseNonNegativeInt = (val: unknown): number | undefined => {
  if (typeof val === "number" && Number.isFinite(val)) {
    if (val < 0) return undefined;
    return Math.floor(val);
  }

  const trimmed = toTrimmedString(val);
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
};

export const parseIntSafe = (val: unknown, radix = 10): number | undefined => {
  if (typeof val === "number" && Number.isFinite(val)) {
    const truncated = Math.trunc(val);
    return Number.isFinite(truncated) ? truncated : undefined;
  }

  const str = toTrimmedStringOrEmpty(val);
  if (!str || !/^[+-]?\d+$/.test(str)) return undefined;

  const parsed = parseInt(str, radix);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const prepFmeParams = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  options?: {
    config?: FmeExportConfig;
    workspaceParameters?: readonly WorkspaceParameter[] | null;
    workspaceItem?: WorkspaceItemDetail | null;
    areaWarning?: boolean;
    drawnArea?: number;
  }
): { [key: string]: unknown } => {
  const {
    config: rawConfig,
    workspaceParameters,
    workspaceItem,
    areaWarning,
    drawnArea,
  } = options || {};
  const normalizedConfig = normalizeServiceModeConfig(rawConfig);
  const original = ((formData as { [key: string]: unknown })?.data || {}) as {
    [key: string]: unknown;
  };
  const chosen = determineServiceMode({ data: original }, normalizedConfig, {
    workspaceItem,
    areaWarning,
    drawnArea,
  });
  const {
    _serviceMode: _ignoredServiceMode,
    __upload_file__: _ignoredUpload,
    __remote_dataset_url__: _ignoredRemote,
    ...publicFields
  } = original;

  const base = buildFmeParams(
    { data: publicFields },
    userEmail,
    chosen,
    normalizedConfig
  );
  const geometryParamNames = collectGeometryParamNames(workspaceParameters);
  const withAoi = attachAoi(
    base,
    geometryJson,
    currentGeometry,
    modules,
    normalizedConfig,
    geometryParamNames
  );
  const withDirectives = applyDirectiveDefaults(withAoi, normalizedConfig);
  sanitizeOptGetUrlParam(withDirectives, normalizedConfig);
  return withDirectives;
};

export const extractRepositoryNames = (source: unknown): string[] => {
  if (Array.isArray(source)) {
    return uniqueStrings(collectStringsFromProp(source, "name"));
  }

  const record = typeof source === "object" && source !== null ? source : null;
  const items = (record as { [key: string]: unknown } | null)?.items;

  if (Array.isArray(items)) {
    return uniqueStrings(collectStringsFromProp(items, "name"));
  }

  return [];
};

// Factory för att skapa FME response objekt
const createFmeResponse = {
  blob: (blob: Blob, workspace: string, userEmail: string) => ({
    success: true,
    blob,
    email: userEmail,
    workspaceName: workspace,
    downloadFilename: `${workspace}_export.zip`,
    blobMetadata: {
      type: toTrimmedString(blob.type),
      size:
        typeof blob.size === "number" && Number.isFinite(blob.size)
          ? blob.size
          : undefined,
    },
  }),

  success: (
    serviceInfo: NormalizedServiceInfo,
    workspace: string,
    userEmail: string
  ) => ({
    success: true,
    jobId:
      typeof serviceInfo.jobId === "number" ? serviceInfo.jobId : undefined,
    email: userEmail,
    workspaceName: workspace,
    downloadUrl: serviceInfo.url,
    downloadFilename: serviceInfo.url ? `${workspace}_export.zip` : undefined,
    status: serviceInfo.status,
    statusMessage: serviceInfo.message,
  }),

  failure: (
    message: string,
    serviceInfo?: NormalizedServiceInfo,
    code = "FME_JOB_FAILURE"
  ) => ({
    success: false,
    message,
    code,
    ...(typeof serviceInfo?.jobId === "number" && {
      jobId: serviceInfo.jobId,
    }),
    ...(serviceInfo?.status && { status: serviceInfo.status }),
    ...(serviceInfo?.message && { statusMessage: serviceInfo.message }),
  }),
};

// Validerar att url är en giltig http/https URL
const isValidDownloadUrl = (url: unknown): boolean =>
  typeof url === "string" && /^https?:\/\//.test(url);

// Processerar FME response och returnerar ExportResult
export const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translateFn: TranslateFn
): ExportResult => {
  const responseRecord = toDictionary(fmeResponse);
  const dataValue = responseRecord?.data;

  if (!dataValue) {
    return {
      success: false,
      message: translateFn("noDataInResponse"),
      code: "NO_DATA",
    };
  }

  const dataRecord = toDictionary(dataValue);
  const blobCandidate = dataRecord?.blob;

  if (blobCandidate instanceof Blob) {
    return createFmeResponse.blob(blobCandidate, workspace, userEmail);
  }

  const serviceInfo = normalizeFmeServiceInfo(fmeResponse);
  const normalizedStatus = (serviceInfo.status || "")
    .toString()
    .trim()
    .toUpperCase();

  // Kontrollerar om jobbet avbröts
  if (normalizedStatus === "ABORTED") {
    const statusMessage = serviceInfo.message || "";
    const normalizedMessage = statusMessage.toLowerCase();
    const timeoutIndicators = [
      "timeout",
      "time limit",
      "time-limit",
      "max execution",
      "maximum execution",
      "max runtime",
      "maximum runtime",
      "max run time",
    ];
    const isTimeout = timeoutIndicators.some((indicator) =>
      normalizedMessage.includes(indicator)
    );
    const translationKey = isTimeout ? "jobCancelledTimeout" : "jobCancelled";
    return {
      success: false,
      cancelled: true,
      message: translateFn(translationKey),
      code: isTimeout ? "FME_JOB_CANCELLED_TIMEOUT" : "FME_JOB_CANCELLED",
      status: serviceInfo.status,
      statusMessage,
      jobId:
        typeof serviceInfo.jobId === "number" ? serviceInfo.jobId : undefined,
    };
  }

  const failureStatuses = new Set([
    "FAILURE",
    "FAILED",
    "JOB_FAILURE",
    "FME_FAILURE",
  ]);

  if (failureStatuses.has(normalizedStatus)) {
    const failureMessage =
      toTrimmedString(serviceInfo.message) || translateFn("jobFailed");
    return createFmeResponse.failure(
      failureMessage,
      serviceInfo,
      "FME_JOB_FAILURE"
    );
  }

  const hasValidResult =
    normalizedStatus === "SUCCESS" ||
    isValidDownloadUrl(serviceInfo.url) ||
    (typeof serviceInfo.jobId === "number" && serviceInfo.jobId > 0);

  if (hasValidResult) {
    return createFmeResponse.success(serviceInfo, workspace, userEmail);
  }

  return createFmeResponse.failure(
    serviceInfo.message || translateFn("errorJobSubmission"),
    serviceInfo
  );
};

// Normaliserar FME service response till NormalizedServiceInfo
export const normalizeFmeServiceInfo = (
  resp: unknown
): NormalizedServiceInfo => {
  const r = (resp || {}) as { [key: string]: unknown };
  const raw =
    (r?.data as { [key: string]: unknown })?.serviceResponse || r?.data || r;
  const rawRecord = raw as { [key: string]: unknown };
  const status =
    (rawRecord?.statusInfo as { [key: string]: unknown })?.status ||
    rawRecord?.status;
  const message =
    (rawRecord?.statusInfo as { [key: string]: unknown })?.message ||
    rawRecord?.message;
  const jobId =
    typeof rawRecord?.jobID === "number" ? rawRecord.jobID : rawRecord?.id;
  const url = rawRecord?.url;
  return {
    status: status as string,
    message: message as string,
    jobId: jobId as number,
    url: url as string,
  };
};

// Skapar typat fel med kod, status och orsak
const makeWebhookError = (
  code: WebhookErrorCode,
  status?: number,
  cause?: unknown
): Error & { code: WebhookErrorCode; status?: number; cause?: unknown } => {
  const error = new Error(code) as Error & {
    code: WebhookErrorCode;
    status?: number;
    cause?: unknown;
  };
  error.code = code;
  if (status != null) error.status = status;
  if (cause !== undefined) error.cause = cause;
  return error;
};

// Normaliserar och trunkerar text till maxlängd
const normalizeText = (value: unknown, limit: number): string | undefined => {
  const trimmed = toTrimmedString(value);
  return trimmed ? trimmed.slice(0, limit) : undefined;
};

// Serialiserar URL search parameters
const serializeParams = (params: URLSearchParams): string => {
  const entries = Array.from(params.entries());
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
};

// Lägger till Transaction Manager (TM) numeriska parametrar
const appendWebhookTmParams = (
  params: URLSearchParams,
  source: PrimitiveParams = {}
): void => {
  // Lägg till numeriska TM-parametrar (timeout, pri, tag osv.)
  for (const key of TM_NUMERIC_PARAM_KEYS) {
    const value = parseNonNegativeInt(
      (source as { [key: string]: unknown })[key]
    );
    if (value !== undefined) params.set(key, String(value));
  }

  // Lägg till tm_tag om definierad
  const tag = normalizeText((source as { [key: string]: unknown }).tm_tag, 128);
  if (tag) params.set("tm_tag", tag);
};

// Skapar webhook-URL med query-parametrar för FME-jobb
export const createWebhookArtifacts = (
  serverUrl: string,
  repository: string,
  workspace: string,
  parameters: PrimitiveParams = {},
  token?: string,
  options?: WebhookArtifactOptions
): WebhookArtifacts => {
  const baseUrl = buildUrl(serverUrl, "fmedatadownload", repository, workspace);
  const referenceUrl =
    safeParseUrl(serverUrl) ?? safeParseUrl(baseUrl) ?? undefined;
  const hostname = referenceUrl?.hostname || "";

  const enforceHttps = options?.requireHttps ?? true;
  const enforceStrict =
    options?.strict ?? (!isLoopbackHostname(hostname) && enforceHttps);

  const result = validateAndNormalizeUrl(baseUrl, {
    strict: enforceStrict,
    requireHttps: enforceHttps,
  });

  if (!result.ok) {
    throw makeWebhookError(
      "WEBHOOK_AUTH_ERROR",
      0,
      result.errorKey || "invalid_url"
    );
  }

  const params = buildParams(parameters, [...WEBHOOK_EXCLUDE_PARAMS], true);
  if (token) {
    params.set("token", token);
  }
  appendWebhookTmParams(params, parameters);
  return {
    baseUrl,
    params,
    fullUrl: `${baseUrl}?${serializeParams(params)}`,
  };
};

// Kontrollerar om webhook-URL skulle överskrida maxlängd
export const isWebhookUrlTooLong = (args: {
  serverUrl: string;
  repository: string;
  workspace: string;
  parameters?: PrimitiveParams;
  maxLen?: number;
  token?: string;
  options?: WebhookArtifactOptions;
}): boolean => {
  const {
    serverUrl,
    repository,
    workspace,
    parameters = {},
    maxLen = FME_FLOW_API.MAX_URL_LENGTH,
    token,
    options,
  } = args;

  const { fullUrl } = createWebhookArtifacts(
    serverUrl,
    repository,
    workspace,
    parameters,
    token,
    options
  );
  return typeof maxLen === "number" && maxLen > 0 && fullUrl.length > maxLen;
};
