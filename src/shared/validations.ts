import {
  ErrorSeverity,
  ErrorType,
  type ErrorState,
  type FmeExportConfig,
  type StartupValidationResult,
  type TranslateFn,
} from "../config"
import { extractErrorMessage, maskToken, safeParseUrl } from "./utils"

export const isInt = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isInteger(value)
  if (typeof value === "string") {
    const trimmed = value.trim()
    const num = Number(trimmed)
    return Number.isInteger(num)
  }
  return false
}

export const isNum = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "string") {
    const trimmed = value.trim()
    const num = Number(trimmed)

    return Number.isFinite(num)
  }
  return false
}

const MIN_TOKEN_LENGTH = 10
const FME_REST_PATH = "/fmerest"

// Internal helpers to consolidate repeated patterns
const isHttpStatus = (n: unknown): n is number =>
  typeof n === "number" && n >= 100 && n <= 599

const hasForbiddenPaths = (pathname: string): boolean => {
  const lowerPath = pathname.toLowerCase()
  return lowerPath.includes(FME_REST_PATH)
}

export const normalizeBaseUrl = (rawUrl: string): string => {
  const u = safeParseUrl(rawUrl || "")
  if (!u) return ""

  // Extract base path without /fmerest or anything after it
  let path = u.pathname || "/"
  const idxRest = path.toLowerCase().indexOf(FME_REST_PATH)
  if (idxRest >= 0) path = path.substring(0, idxRest) || "/"

  u.search = ""
  u.hash = ""
  u.username = ""
  u.password = ""
  u.pathname = path

  // Remove trailing slash unless it's the root "/"
  const cleanPath = path === "/" ? "" : path.replace(/\/$/, "")
  return `${u.origin}${cleanPath}`
}

export const validateServerUrl = (
  url: string,
  opts?: { strict?: boolean; requireHttps?: boolean }
): { ok: boolean; key?: string } => {
  const trimmedUrl = url?.trim()
  if (!trimmedUrl) return { ok: false, key: "errorMissingServerUrl" }

  const parsedUrl = safeParseUrl(trimmedUrl)
  if (!parsedUrl) return { ok: false, key: "errorInvalidServerUrl" }

  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return { ok: false, key: "errorInvalidServerUrl" }
  }

  // Optional HTTPS enforcement
  if (opts?.requireHttps && !/^https:$/i.test(parsedUrl.protocol)) {
    return { ok: false, key: "errorInvalidServerUrl" }
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, key: "errorInvalidServerUrl" }
  }

  // Disallow query string and fragment in base URL
  if (parsedUrl.search || parsedUrl.hash) {
    return { ok: false, key: "errorInvalidServerUrl" }
  }

  if (hasForbiddenPaths(parsedUrl.pathname)) {
    return { ok: false, key: "errorBadBaseUrl" }
  }

  // Check for hostname ending with dot (invalid)
  if (parsedUrl.hostname.endsWith(".")) {
    return { ok: false, key: "errorInvalidServerUrl" }
  }

  // Apply hostname heuristic only in strict mode
  if (opts?.strict) {
    const hostname = parsedUrl.hostname || ""
    // In strict mode, reject hostnames that look suspicious (no dots, too short)
    if (!hostname.includes(".") || hostname.length < 4) {
      return { ok: false, key: "errorInvalidServerUrl" }
    }
  }

  return { ok: true }
}

export const validateToken = (token: string): { ok: boolean; key?: string } => {
  if (!token) return { ok: false, key: "errorMissingToken" }

  const hasControlChar = (() => {
    for (let i = 0; i < token.length; i++) {
      const code = token.charCodeAt(i)
      if (code < 32 || code === 127) return true
    }
    return false
  })()

  const invalid =
    token.length < MIN_TOKEN_LENGTH ||
    /\s/.test(token) ||
    /[<>"'`]/.test(token) ||
    hasControlChar

  return invalid ? { ok: false, key: "errorTokenIsInvalid" } : { ok: true }
}

export const validateRepository = (
  repository: string,
  available: string[] | null
): { ok: boolean; key?: string } => {
  if (available === null) return { ok: true }
  if (available.length > 0 && !repository)
    return { ok: false, key: "errorRepoRequired" }
  if (available.length > 0 && repository && !available.includes(repository)) {
    return { ok: false, key: "errorRepositoryNotFound" }
  }
  return { ok: true }
}

// Helper function for extracting HTTP status from various error structures
export const extractHttpStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined

  const obj = error as { [key: string]: unknown }

  // Try standard status properties first
  for (const prop of ["status", "statusCode", "httpStatus"]) {
    const value = obj[prop]
    if (isHttpStatus(value)) {
      return value
    }
  }

  // Check for esriRequest-specific error structure
  const details = obj.details as any
  if (details && typeof details === "object") {
    const detailsStatus = details.httpStatus || details.status
    if (isHttpStatus(detailsStatus)) return detailsStatus
  }

  // Try to extract from error message using regex as last resort
  const message = extractErrorMessage(error)
  if (typeof message === "string") {
    // Look for "status: 401" pattern in error messages
    const statusMatch = /status:\s*(\d{3})/i.exec(message)
    if (statusMatch) {
      const statusCode = parseInt(statusMatch[1], 10)
      if (statusCode >= 100 && statusCode <= 599) {
        return statusCode
      }
    }
  }

  return undefined
}

const ERROR_CODE_TO_KEY: { [code: string]: string } = {
  ARCGIS_MODULE_ERROR: "startupNetworkError",
  NETWORK_ERROR: "startupNetworkError",
  INVALID_RESPONSE_FORMAT: "startupTokenError",
  WEBHOOK_AUTH_ERROR: "startupTokenError",
  SERVER_URL_ERROR: "connectionFailed",
  REPOSITORIES_ERROR: "startupServerError",
  REPOSITORY_ITEMS_ERROR: "startupServerError",
  WORKSPACE_ITEM_ERROR: "startupServerError",
  JOB_SUBMISSION_ERROR: "startupServerError",
  DATA_STREAMING_ERROR: "startupServerError",
  DATA_DOWNLOAD_ERROR: "startupServerError",
  INVALID_CONFIG: "startupConfigError",
  GEOMETRY_MISSING: "GEOMETRY_SERIALIZATION_FAILED",
  GEOMETRY_TYPE_INVALID: "GEOMETRY_SERIALIZATION_FAILED",
  URL_TOO_LONG: "urlTooLong",
}

const statusToKey = (s?: number): string | undefined => {
  if (typeof s !== "number") return undefined
  if (s === 0) return "startupNetworkError"
  if (s === 401 || s === 403) return "startupTokenError"
  if (s === 404) return "connectionFailed"
  if (s === 408) return "timeout"
  if (s === 429) return "rateLimited"
  if (s === 431) return "headersTooLarge"
  if (s >= 500) return "startupServerError"
  return undefined
}

export const mapErrorToKey = (err: unknown, status?: number): string => {
  // Extract status from error object if not provided
  if (status == null) {
    status = extractHttpStatus(err)
  }

  if (err && typeof err === "object") {
    const code = (err as any).code
    if (typeof code === "string") {
      if (code === "REQUEST_FAILED") {
        // Preserve existing categorization logic exactly
        const fromStatus = statusToKey(status)
        return fromStatus || "startupServerError"
      }
      const mapped = ERROR_CODE_TO_KEY[code]
      if (mapped) return mapped
    }
  }

  const byStatus = statusToKey(status)
  if (byStatus) return byStatus

  // Simple message pattern matching as last resort
  const message = (err as Error)?.message
  if (typeof message === "string") {
    const lowerMessage = message.toLowerCase()
    if (lowerMessage.includes("failed to fetch")) return "startupNetworkError"
    if (lowerMessage.includes("timeout")) return "timeout"
    if (lowerMessage.includes("cors")) return "corsError"
    if (lowerMessage.includes("url") && lowerMessage.includes("too"))
      return "urlTooLong"
  }

  return "unknownErrorOccurred"
}

export const isValidExternalUrlForOptGetUrl = (url: unknown): boolean => {
  if (typeof url !== "string") return false
  const trimmed = url.trim()
  if (!trimmed || trimmed.length > 10000) return false
  const u = safeParseUrl(trimmed)
  if (!u) return false
  // Enforce HTTPS and disallow embedded credentials for remote dataset URLs
  if (!/^https:$/i.test(u.protocol)) return false
  // Disallow URLs with username/password
  if (u.username || u.password) return false
  return true
}

export const validateRequiredConfig = (config: {
  readonly serverUrl?: string
  readonly token?: string
  readonly repository?: string
}): void => {
  if (!config.serverUrl || !config.token || !config.repository) {
    throw new Error("Missing required configuration")
  }
}

// Check for missing required fields in the config
const getMissingConfigFields = (
  config: FmeExportConfig | undefined
): string[] => {
  if (!config) return ["fmeServerUrl", "fmeServerToken", "repository"]
  const missing: string[] = []
  if (!config.fmeServerUrl?.trim()) missing.push("fmeServerUrl")
  if (!config.fmeServerToken?.trim()) missing.push("fmeServerToken")
  if (!config.repository?.trim()) missing.push("repository")
  return missing
}

export const validateConfigFields = (
  config: FmeExportConfig | undefined
): {
  isValid: boolean
  missingFields: string[]
} => {
  const missing = getMissingConfigFields(config)
  return {
    isValid: missing.length === 0,
    missingFields: missing,
  }
}

export const HTTP_STATUS_CODES = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  TIMEOUT: 408,
  GATEWAY_TIMEOUT: 504,
  TOO_MANY_REQUESTS: 429,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  NETWORK_ERROR: 0,
  SERVER_ERROR_MIN: 500,
  SERVER_ERROR_MAX: 599,
} as const

export const isAuthError = (status: number): boolean => {
  return (
    status === HTTP_STATUS_CODES.UNAUTHORIZED ||
    status === HTTP_STATUS_CODES.FORBIDDEN
  )
}

export function validateConnectionInputs(args: {
  url: string
  token: string
  repository?: string
  availableRepos?: string[] | null
}): {
  ok: boolean
  errors: { serverUrl?: string; token?: string; repository?: string }
} {
  const { url, token, repository, availableRepos } = args || ({} as any)

  const errors: { serverUrl?: string; token?: string; repository?: string } = {}

  const u = validateServerUrl(url)
  if (!u.ok) errors.serverUrl = u.key || "errorInvalidServerUrl"

  const t = validateToken(token)
  if (!t.ok) errors.token = t.key || "errorTokenIsInvalid"

  // If availableRepos is null, skip repository validation (not loaded yet)
  const repoCheck = validateRepository(
    repository || "",
    availableRepos === undefined ? [] : availableRepos
  )
  if (!repoCheck.ok)
    errors.repository = repoCheck.key || "errorRepositoryNotFound"

  return { ok: Object.keys(errors).length === 0, errors }
}

export const validateRequiredFields = (
  config: FmeExportConfig,
  _translate: TranslateFn,
  opts?: { mapConfigured?: boolean }
): StartupValidationResult => {
  const missing = getMissingConfigFields(config)
  const mapConfigured = opts?.mapConfigured ?? true

  if (missing.length > 0 || !mapConfigured) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
    }
  }

  return {
    isValid: true,
    canProceed: true,
    requiresSettings: false,
  }
}

export const createError = (
  messageKey: string,
  type: ErrorType,
  code: string,
  translate: TranslateFn,
  options?: {
    suggestion?: string
    userFriendlyMessage?: string
    retry?: () => void
  }
): ErrorState => {
  return {
    message: translate(messageKey) || messageKey,
    type,
    code,
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage: options?.userFriendlyMessage || "",
    suggestion:
      options?.suggestion || translate("checkConnectionSettings") || "",
    retry: options?.retry,
  }
}

// FME conversions (date/time/color)
export const validateDateTimeFormat = (dateTimeString: string): boolean => {
  const trimmed = dateTimeString.trim()
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  return dateTimeRegex.test(trimmed)
}

export const sanitizeFormValues = (
  formValues: any,
  parameters: readonly any[]
): any => {
  if (!formValues) return formValues
  const secretNames = new Set(
    (parameters || [])
      .filter((p) => p && p.type === "PASSWORD")
      .map((p) => p.name)
  )
  if (secretNames.size === 0) return formValues
  const masked: any = {}
  for (const k of Object.keys(formValues || {})) {
    masked[k] = secretNames.has(k)
      ? maskToken(formValues[k] || "")
      : formValues[k]
  }
  return masked
}

// Geometry helpers
export const calcArea = (
  geometry: __esri.Geometry | undefined,
  modules: any
): number => {
  if (!geometry || geometry.type !== "polygon" || !modules?.geometryEngine)
    return 0

  const engine = modules.geometryEngine

  const isGeographic = (): boolean => {
    try {
      const sr: any = (geometry as any).spatialReference || {}
      if (sr && (sr.isGeographic || sr.isWGS84)) return true
      if (typeof sr.wkid === "number" && sr.wkid === 4326) return true
      const json = (geometry as any).toJSON?.()
      const jsr = json?.spatialReference || {}
      return Boolean(jsr.isGeographic) || jsr.wkid === 4326
    } catch {
      return false
    }
  }

  try {
    const area = isGeographic()
      ? engine.geodesicArea
        ? engine.geodesicArea(geometry as __esri.Polygon, "square-meters")
        : engine.planarArea(geometry as __esri.Polygon, "square-meters")
      : engine.planarArea(geometry as __esri.Polygon, "square-meters")

    return Number.isFinite(area) && area > 0 ? area : 0
  } catch (e) {
    console.warn("Failed to calculate polygon area:", e)
    return 0
  }
}

export const validatePolygon = (
  geometry: __esri.Geometry | undefined,
  modules: any
): { valid: boolean; error?: ErrorState; simplified?: __esri.Polygon } => {
  // Local helper to construct consistent geometry error objects
  const makeGeometryError = (
    messageKey: string,
    code: string
  ): { valid: false; error: ErrorState } => {
    // Late import to avoid circular deps in tests
    try {
      const { buildErrorStateSimple } = require("./utils")
      return {
        valid: false,
        error: buildErrorStateSimple(
          messageKey,
          ErrorType.GEOMETRY,
          code,
          (k: string) => k
        ),
      }
    } catch {
      // Fallback without utils
      return {
        valid: false,
        error: {
          message: messageKey,
          type: ErrorType.GEOMETRY,
          code,
          severity: ErrorSeverity.ERROR,
          recoverable: true,
          timestamp: new Date(),
          timestampMs: Date.now(),
          userFriendlyMessage: "",
          suggestion: "",
        },
      }
    }
  }

  if (!geometry) {
    return makeGeometryError("noGeometryProvided", "NO_GEOMETRY")
  }

  if (geometry.type !== "polygon") {
    return makeGeometryError("geometryMustBePolygon", "INVALID_GEOMETRY_TYPE")
  }

  // If geometry engine is not available, skip detailed validation
  if (!modules?.geometryEngine) {
    return { valid: true }
  }

  try {
    const engine: any = modules.geometryEngine
    let poly = geometry as __esri.Polygon

    // 1) Simplify and/or check if simple (if supported by engine)
    if (typeof engine.simplify === "function") {
      const simplified = engine.simplify(poly) as __esri.Polygon | null
      if (!simplified || !engine.isSimple(simplified)) {
        return makeGeometryError("polygonNotSimple", "INVALID_GEOMETRY")
      }
      poly = simplified
    } else {
      if (typeof engine.isSimple === "function" && !engine.isSimple(poly)) {
        return makeGeometryError("polygonNotSimple", "INVALID_GEOMETRY")
      }
    }

    // 2) Structural checks: rings must be closed with >=4 points
    const rings: any[] = (poly as any).rings || []
    if (!Array.isArray(rings) || rings.length === 0) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
    }
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4) {
        return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
      }
      const first = ring[0]
      const last = ring[ring.length - 1]
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
      }
    }

    // 3) Area must be > 0 (use our calcArea helper)
    const area = calcArea(poly as any, modules)
    if (!area || area <= 0) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
    }

    // 4) Validate holes lie within outer ring (best-effort if contains exists)
    if (rings.length > 1 && typeof engine.contains === "function") {
      // Build outer polygon from first ring
      try {
        const PolygonCtor = (modules && modules.Polygon) || null
        const outer = PolygonCtor
          ? PolygonCtor.fromJSON({
              rings: [rings[0]],
              spatialReference: (poly as any).spatialReference,
            })
          : poly
        for (let i = 1; i < rings.length; i++) {
          const hole = PolygonCtor
            ? PolygonCtor.fromJSON({
                rings: [rings[i]],
                spatialReference: (poly as any).spatialReference,
              })
            : poly
          if (!engine.contains(outer, hole)) {
            return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
          }
        }
      } catch {
        // If anything fails here, fall back to accepting simplified polygon
      }
    }

    return { valid: true, simplified: poly }
  } catch {
    return makeGeometryError(
      "geometryValidationFailed",
      "GEOMETRY_VALIDATION_ERROR"
    )
  }
}

export const checkMaxArea = (
  area: number,
  maxArea?: number
): { ok: boolean; message?: string; code?: string } => {
  if (!maxArea || area <= maxArea) {
    return { ok: true }
  }

  return {
    ok: false,
    message: "AREA_TOO_LARGE",
    code: "AREA_TOO_LARGE",
  }
}

// FME response processing
export const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translateFn: TranslateFn
): any => {
  const response = fmeResponse as any
  const data = response?.data

  if (!data) {
    return {
      success: false,
      message: translateFn("noDataInResponse"),
      code: "NO_DATA",
    }
  }

  // Handle blob response
  if (data.blob instanceof Blob) {
    return {
      success: true,
      blob: data.blob,
      email: userEmail,
      workspaceName: workspace,
      downloadFilename: `${workspace}_export.zip`,
    }
  }

  // Handle service response
  const serviceInfo = data.serviceResponse || data
  const directUrl = serviceInfo?.url
  const status = serviceInfo?.statusInfo?.status || serviceInfo?.status
  const jobId = serviceInfo?.jobID || serviceInfo?.id

  if (status === "success" || (directUrl && /^https?:\/\//.test(directUrl))) {
    return {
      success: true,
      jobId: typeof jobId === "number" ? jobId : undefined,
      email: userEmail,
      workspaceName: workspace,
      downloadUrl: directUrl,
      downloadFilename: directUrl ? `${workspace}_export.zip` : undefined,
    }
  }

  return {
    success: false,
    message:
      serviceInfo?.statusInfo?.message ||
      serviceInfo?.message ||
      translateFn("fmeJobSubmissionFailed"),
    code: "FME_JOB_FAILURE",
  }
}

export {
  // general utils
  isValidEmail,
  getSupportEmail,
  isJson,
  safeParseUrl,
  extractErrorMessage,
  extractHostFromUrl,
  // file utils
  isFileObject,
  getFileDisplayName,
  // numbers/strings
  parseNonNegativeInt,
  pad2,
  // datetime and color conversions
  fmeDateTimeToInput,
  inputToFmeDateTime,
  fmeDateToInput,
  inputToFmeDate,
  fmeTimeToInput,
  inputToFmeTime,
  normalizedRgbToHex,
  hexToNormalizedRgb,
  toIsoLocal,
  fromIsoLocal,
  // forms
  normalizeFormValue,
  toSerializable,
  // geometry
  isPolygonGeometry,
  // UI helpers
  ariaDesc,
  getBtnAria,
  getErrorIconSrc,
  // workflow helpers
  stripErrorLabel,
  initFormValues,
  canResetButton,
  shouldShowWorkspaceLoading,
  maskToken,
} from "./utils"
