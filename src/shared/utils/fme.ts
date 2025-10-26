import type {
  DetermineServiceModeOptions,
  FmeExportConfig,
  ForceAsyncResult,
  ServiceMode,
  WorkspaceItem,
  WorkspaceItemDetail,
  WorkspaceParameter,
  EsriModules,
  ExportResult,
  TranslateFn,
  FmeResponse,
  NormalizedServiceInfo,
  PrimitiveParams,
  WebhookArtifacts,
  WebhookErrorCode,
} from "../../config/index"
import {
  FME_FLOW_API,
  TM_NUMERIC_PARAM_KEYS,
  WEBHOOK_EXCLUDE_PARAMS,
} from "../../config/index"
import { collectGeometryParamNames, attachAoi } from "./geometry"
import {
  collectStringsFromProp,
  uniqueStrings,
  sanitizeOptGetUrlParam,
} from "./form"
import {
  toBooleanValue,
  toNonEmptyTrimmedString,
  toTrimmedString,
  toTrimmedStringOrEmpty,
} from "./conversion"
import { validateServerUrl, mapServerUrlReasonToKey } from "../validations"
import { buildUrl, buildParams, safeParseUrl } from "./network"

const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = ["sync", "async"] as const

const LOOPBACK_IPV6 = "0:0:0:0:0:0:0:1"

const isLoopbackHostname = (hostname: string): boolean => {
  if (!hostname) return false
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (normalized === "localhost") return true
  if (normalized === "::1" || normalized === LOOPBACK_IPV6) return true
  if (normalized.startsWith("127.")) return true
  return false
}

export interface WebhookArtifactOptions {
  readonly requireHttps?: boolean
  readonly strict?: boolean
}

const shouldForceAsyncMode = (
  config: FmeExportConfig | undefined,
  options?: {
    workspaceItem?: WorkspaceItem | WorkspaceItemDetail | null
    areaWarning?: boolean
    drawnArea?: number
  }
): ForceAsyncResult | null => {
  if (!options) return null

  if (options.areaWarning) {
    return {
      reason: "area",
      value: options.drawnArea,
      threshold: config?.largeArea,
    }
  }

  if (typeof config?.largeArea === "number" && options.drawnArea != null) {
    if (options.drawnArea > config.largeArea) {
      return {
        reason: "area",
        value: options.drawnArea,
        threshold: config.largeArea,
      }
    }
  }

  return null
}

export const normalizeServiceModeConfig = (
  config: FmeExportConfig | null | undefined
): FmeExportConfig | undefined => {
  if (!config) return config ?? undefined

  const rawValue = config.syncMode
  let normalized =
    typeof rawValue === "boolean" ? rawValue : toBooleanValue(rawValue)

  if (normalized === undefined) {
    normalized = Boolean(rawValue)
  }

  if (typeof rawValue === "boolean" && rawValue === normalized) {
    return config
  }

  const cloned = { ...config, syncMode: normalized }
  if (typeof (config as any).set === "function") {
    Object.defineProperty(cloned, "set", {
      value: (config as any).set,
      writable: true,
      configurable: true,
    })
  }
  return cloned
}

export const determineServiceMode = (
  formData: unknown,
  config?: FmeExportConfig,
  options?: DetermineServiceModeOptions
): ServiceMode => {
  const data = (formData as any)?.data || {}

  const override = toNonEmptyTrimmedString(data._serviceMode).toLowerCase()

  let resolved: ServiceMode
  if (override === "sync" || override === "async") {
    resolved = override as ServiceMode
  } else {
    resolved = config?.syncMode ? "sync" : "async"
  }

  const forceInfo = shouldForceAsyncMode(config, {
    workspaceItem: options?.workspaceItem,
    areaWarning: options?.areaWarning,
    drawnArea: options?.drawnArea,
  })

  if (forceInfo && resolved === "sync") {
    options?.onModeOverride?.({
      forcedMode: "async",
      previousMode: "sync",
      reason: forceInfo.reason,
      value: forceInfo.value,
      threshold: forceInfo.threshold,
    })
    return "async"
  }

  return resolved
}

export const buildFmeParams = (
  formData: unknown,
  userEmail: string,
  serviceMode: ServiceMode = "async",
  config?: FmeExportConfig | null
): { [key: string]: unknown } => {
  const data = (formData as { data?: { [key: string]: unknown } })?.data || {}
  const mode = ALLOWED_SERVICE_MODES.includes(serviceMode)
    ? serviceMode
    : "async"
  const includeResult = config?.showResult ?? true

  const base: { [key: string]: unknown } = {
    ...data,
    opt_servicemode: mode,
    opt_responseformat: "json",
    opt_showresult: includeResult ? "true" : "false",
  }

  const trimmedEmail = toNonEmptyTrimmedString(userEmail)
  if (mode === "async" && trimmedEmail) {
    base.opt_requesteremail = trimmedEmail
  }

  return base
}

export const applyDirectiveDefaults = (
  params: { [key: string]: unknown },
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  if (!config) return params

  const out: { [key: string]: unknown } = { ...params }
  const toPosInt = (v: unknown): number | undefined => {
    const parsed = parseNonNegativeInt(v)
    if (parsed === undefined || parsed <= 0) return undefined
    return parsed
  }

  const rawMode = (() => {
    const candidate = (params as { opt_servicemode?: unknown }).opt_servicemode
    if (typeof candidate === "string") return candidate
    const cloned = out.opt_servicemode
    return typeof cloned === "string" ? cloned : ""
  })()

  const normalizedMode = toNonEmptyTrimmedString(rawMode).toLowerCase()

  const allowTmTtc =
    normalizedMode === "sync" || (!normalizedMode && Boolean(config?.syncMode))

  if (!allowTmTtc && typeof out.tm_ttc !== "undefined") {
    delete out.tm_ttc
  } else if (allowTmTtc && !("tm_ttc" in out)) {
    const v = toPosInt(config?.tm_ttc)
    if (v !== undefined) out.tm_ttc = v
  }
  if (!("tm_ttl" in out)) {
    const v = toPosInt(config?.tm_ttl)
    if (v !== undefined) out.tm_ttl = v
  }

  return out
}

export const parseNonNegativeInt = (val: unknown): number | undefined => {
  if (typeof val === "number" && Number.isFinite(val)) {
    if (val < 0) return undefined
    return Math.floor(val)
  }

  const trimmed = toTrimmedString(val)
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined

  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

export const parseIntSafe = (val: unknown, radix = 10): number | undefined => {
  if (typeof val === "number" && Number.isFinite(val)) {
    const truncated = Math.trunc(val)
    return Number.isFinite(truncated) ? truncated : undefined
  }

  const str = toTrimmedStringOrEmpty(val)
  if (!str || !/^[+-]?\d+$/.test(str)) return undefined

  const parsed = parseInt(str, radix)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const prepFmeParams = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  options?: {
    config?: FmeExportConfig
    workspaceParameters?: readonly WorkspaceParameter[] | null
    workspaceItem?: WorkspaceItemDetail | null
    areaWarning?: boolean
    drawnArea?: number
  }
): { [key: string]: unknown } => {
  const {
    config: rawConfig,
    workspaceParameters,
    workspaceItem,
    areaWarning,
    drawnArea,
  } = options || {}
  const normalizedConfig = normalizeServiceModeConfig(rawConfig)
  const original = ((formData as any)?.data || {}) as {
    [key: string]: unknown
  }
  const chosen = determineServiceMode({ data: original }, normalizedConfig, {
    workspaceItem,
    areaWarning,
    drawnArea,
  })
  const {
    _serviceMode: _ignoredServiceMode,
    __upload_file__: _ignoredUpload,
    __remote_dataset_url__: _ignoredRemote,
    ...publicFields
  } = original

  const base = buildFmeParams(
    { data: publicFields },
    userEmail,
    chosen,
    normalizedConfig
  )
  const geometryParamNames = collectGeometryParamNames(workspaceParameters)
  const withAoi = attachAoi(
    base,
    geometryJson,
    currentGeometry,
    modules,
    normalizedConfig,
    geometryParamNames
  )
  const withDirectives = applyDirectiveDefaults(withAoi, normalizedConfig)
  sanitizeOptGetUrlParam(withDirectives, normalizedConfig)
  return withDirectives
}

export const extractRepositoryNames = (source: unknown): string[] => {
  if (Array.isArray(source)) {
    return uniqueStrings(collectStringsFromProp(source, "name"))
  }

  const record = typeof source === "object" && source !== null ? source : null
  const items = (record as any)?.items

  if (Array.isArray(items)) {
    return uniqueStrings(collectStringsFromProp(items, "name"))
  }

  return []
}

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
}

// Validerar att url är en giltig http/https URL
const isValidDownloadUrl = (url: unknown): boolean =>
  typeof url === "string" && /^https?:\/\//.test(url)

// Processerar FME response och returnerar ExportResult
export const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translateFn: TranslateFn
): ExportResult => {
  const response = fmeResponse as any
  const data = response?.data

  if (!data) {
    return {
      success: false,
      message: translateFn("noDataInResponse"),
      code: "NO_DATA",
    }
  }

  if (data.blob instanceof Blob) {
    return createFmeResponse.blob(data.blob, workspace, userEmail)
  }

  const serviceInfo = normalizeFmeServiceInfo(response as FmeResponse)
  const normalizedStatus = (serviceInfo.status || "")
    .toString()
    .trim()
    .toUpperCase()

  if (normalizedStatus === "CANCELLED" || normalizedStatus === "CANCELED") {
    const statusMessage = serviceInfo.message || ""
    const normalizedMessage = statusMessage.toLowerCase()
    const timeoutIndicators = [
      "timeout",
      "time limit",
      "time-limit",
      "max execution",
      "maximum execution",
      "max runtime",
      "maximum runtime",
      "max run time",
    ]
    const isTimeout = timeoutIndicators.some((indicator) =>
      normalizedMessage.includes(indicator)
    )
    const translationKey = isTimeout ? "jobCancelledTimeout" : "jobCancelled"
    return {
      success: false,
      cancelled: true,
      message: translateFn(translationKey),
      code: isTimeout ? "FME_JOB_CANCELLED_TIMEOUT" : "FME_JOB_CANCELLED",
      status: serviceInfo.status,
      statusMessage,
      jobId:
        typeof serviceInfo.jobId === "number" ? serviceInfo.jobId : undefined,
    }
  }

  const failureStatuses = new Set([
    "FAILURE",
    "FAILED",
    "JOB_FAILURE",
    "FME_FAILURE",
  ])

  if (failureStatuses.has(normalizedStatus)) {
    const failureMessage =
      toTrimmedString(serviceInfo.message) || translateFn("jobFailed")
    return createFmeResponse.failure(
      failureMessage,
      serviceInfo,
      "FME_JOB_FAILURE"
    )
  }

  const hasValidResult =
    normalizedStatus === "SUCCESS" ||
    isValidDownloadUrl(serviceInfo.url) ||
    (typeof serviceInfo.jobId === "number" && serviceInfo.jobId > 0)

  if (hasValidResult) {
    return createFmeResponse.success(serviceInfo, workspace, userEmail)
  }

  return createFmeResponse.failure(
    serviceInfo.message || translateFn("errorJobSubmission"),
    serviceInfo
  )
}

// Normaliserar FME service response till NormalizedServiceInfo
export const normalizeFmeServiceInfo = (resp: any): NormalizedServiceInfo => {
  const r: any = resp || {}
  const raw = r?.data?.serviceResponse || r?.data || r
  const status = raw?.statusInfo?.status || raw?.status
  const message = raw?.statusInfo?.message || raw?.message
  const jobId = typeof raw?.jobID === "number" ? raw.jobID : raw?.id
  const url = raw?.url
  return { status, message, jobId, url }
}

// Skapar typat fel med kod, status och orsak
const makeWebhookError = (
  code: WebhookErrorCode,
  status?: number,
  cause?: unknown
): Error & { code: WebhookErrorCode; status?: number; cause?: unknown } => {
  const error = new Error(code) as Error & {
    code: WebhookErrorCode
    status?: number
    cause?: unknown
  }
  error.code = code
  if (status != null) error.status = status
  if (cause !== undefined) error.cause = cause
  return error
}

// Normaliserar och trunkerar text till maxlängd
const normalizeText = (value: unknown, limit: number): string | undefined => {
  const trimmed = toTrimmedString(value)
  return trimmed ? trimmed.slice(0, limit) : undefined
}

// Serialiserar URL search parameters
const serializeParams = (params: URLSearchParams): string => {
  const entries = Array.from(params.entries())
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&")
}

// Lägger till Transaction Manager (TM) numeriska parametrar
const appendWebhookTmParams = (
  params: URLSearchParams,
  source: PrimitiveParams = {}
): void => {
  // Lägg till numeriska TM-parametrar (timeout, pri, tag osv.)
  for (const key of TM_NUMERIC_PARAM_KEYS) {
    const value = parseNonNegativeInt((source as any)[key])
    if (value !== undefined) params.set(key, String(value))
  }

  // Lägg till tm_tag om definierad
  const tag = normalizeText((source as any).tm_tag, 128)
  if (tag) params.set("tm_tag", tag)
}

// Skapar webhook-URL med query-parametrar för FME-jobb
export const createWebhookArtifacts = (
  serverUrl: string,
  repository: string,
  workspace: string,
  parameters: PrimitiveParams = {},
  token?: string,
  options?: WebhookArtifactOptions
): WebhookArtifacts => {
  const baseUrl = buildUrl(serverUrl, "fmedatadownload", repository, workspace)
  const referenceUrl =
    safeParseUrl(serverUrl) ?? safeParseUrl(baseUrl) ?? undefined
  const hostname = referenceUrl?.hostname || ""

  const enforceHttps = options?.requireHttps ?? true
  const enforceStrict = options?.strict ?? (!isLoopbackHostname(hostname) && enforceHttps)
  const baseUrlValidation = validateServerUrl(baseUrl, {
    strict: enforceStrict,
    requireHttps: enforceHttps,
  })

  if (!baseUrlValidation.ok) {
    const reason = mapServerUrlReasonToKey(
      "reason" in baseUrlValidation ? baseUrlValidation.reason : undefined
    )
    throw makeWebhookError("WEBHOOK_AUTH_ERROR", 0, reason)
  }

  const params = buildParams(parameters, [...WEBHOOK_EXCLUDE_PARAMS], true)
  if (token) {
    params.set("token", token)
  }
  appendWebhookTmParams(params, parameters)
  return {
    baseUrl,
    params,
    fullUrl: `${baseUrl}?${serializeParams(params)}`,
  }
}

// Kontrollerar om webhook-URL skulle överskrida maxlängd
export const isWebhookUrlTooLong = (args: {
  serverUrl: string
  repository: string
  workspace: string
  parameters?: PrimitiveParams
  maxLen?: number
  token?: string
  options?: WebhookArtifactOptions
}): boolean => {
  const {
    serverUrl,
    repository,
    workspace,
    parameters = {},
    maxLen = FME_FLOW_API.MAX_URL_LENGTH,
    token,
    options,
  } = args

  const { fullUrl } = createWebhookArtifacts(
    serverUrl,
    repository,
    workspace,
    parameters,
    token,
    options
  )
  return typeof maxLen === "number" && maxLen > 0 && fullUrl.length > maxLen
}
