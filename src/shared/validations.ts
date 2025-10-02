import {
  ErrorSeverity,
  ErrorType,
  type ErrorState,
  type FmeExportConfig,
  type StartupValidationResult,
  type TranslateFn,
  type FmeResponse,
  type NormalizedServiceInfo,
} from "../config"
import { extractErrorMessage, maskToken, safeParseUrl } from "./utils"

const parseAsNumber = (value: unknown): number | null => {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const num = Number(value.trim())
    return Number.isFinite(num) ? num : null
  }
  return null
}

export const isInt = (value: unknown): boolean => {
  const num = parseAsNumber(value)
  return num !== null && Number.isInteger(num)
}

export const isNum = (value: unknown): boolean => {
  const num = parseAsNumber(value)
  return num !== null
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
  const invalid = (key: string) => ({ ok: false as const, key })
  const invalidBaseUrl = () => invalid("errorInvalidServerUrl")

  if (!trimmedUrl) return invalid("errorMissingServerUrl")

  const parsedUrl = safeParseUrl(trimmedUrl)
  if (!parsedUrl) return invalidBaseUrl()

  if (!/^https?:$/i.test(parsedUrl.protocol)) return invalidBaseUrl()

  // Optional HTTPS enforcement
  if (opts?.requireHttps && !/^https:$/i.test(parsedUrl.protocol)) {
    return invalidBaseUrl()
  }

  if (parsedUrl.username || parsedUrl.password) return invalidBaseUrl()

  // Disallow query string and fragment in base URL
  if (parsedUrl.search || parsedUrl.hash) return invalidBaseUrl()

  if (hasForbiddenPaths(parsedUrl.pathname)) {
    return { ok: false, key: "errorBadBaseUrl" }
  }

  // Check for hostname ending with dot (invalid)
  if (parsedUrl.hostname.endsWith(".")) return invalidBaseUrl()

  // Apply hostname heuristic only in strict mode
  if (opts?.strict) {
    const hostname = parsedUrl.hostname || ""
    // In strict mode, reject hostnames that look suspicious (no dots, too short)
    if (!hostname.includes(".") || hostname.length < 4) return invalidBaseUrl()
  }

  return { ok: true }
}

const hasControlCharacters = (token: string): boolean => {
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

const hasDangerousCharacters = (token: string): boolean =>
  /\s/.test(token) || /[<>"'`]/.test(token) || hasControlCharacters(token)

export const validateToken = (token: string): { ok: boolean; key?: string } => {
  if (!token) return { ok: false, key: "errorMissingToken" }

  const invalid =
    token.length < MIN_TOKEN_LENGTH || hasDangerousCharacters(token)

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

const STATUS_PROPERTIES = ["status", "statusCode", "httpStatus"] as const

// Helper function for extracting HTTP status from various error structures
export const extractHttpStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined

  const obj = error as { [key: string]: unknown }

  for (const prop of STATUS_PROPERTIES) {
    const value = obj[prop]
    if (isHttpStatus(value)) return value
  }

  const details = obj.details as any
  if (details && typeof details === "object") {
    const detailsStatus = details.httpStatus || details.status
    if (isHttpStatus(detailsStatus)) return detailsStatus
  }

  const message = extractErrorMessage(error)
  if (typeof message === "string") {
    const statusMatch = /status:\s*(\d{3})/i.exec(message)
    if (statusMatch) {
      const statusCode = parseInt(statusMatch[1], 10)
      if (isHttpStatus(statusCode)) return statusCode
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

const STATUS_TO_KEY_MAP: { [status: number]: string } = {
  0: "startupNetworkError",
  401: "startupTokenError",
  403: "startupTokenError",
  404: "connectionFailed",
  408: "timeout",
  429: "rateLimited",
  431: "headersTooLarge",
}

const statusToKey = (s?: number): string | undefined => {
  if (typeof s !== "number") return undefined
  if (STATUS_TO_KEY_MAP[s]) return STATUS_TO_KEY_MAP[s]
  if (s >= 500) return "startupServerError"
  return undefined
}

const MESSAGE_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /failed to fetch/i, key: "startupNetworkError" },
  { pattern: /timeout/i, key: "timeout" },
  { pattern: /cors/i, key: "corsError" },
  { pattern: /url.*too/i, key: "urlTooLong" },
]

const matchMessagePattern = (message: string): string | undefined => {
  const lowerMessage = message.toLowerCase()
  for (const { pattern, key } of MESSAGE_PATTERNS) {
    if (pattern.test(lowerMessage)) return key
  }
  return undefined
}

export const mapErrorToKey = (err: unknown, status?: number): string => {
  if (status == null) {
    status = extractHttpStatus(err)
  }

  if (err && typeof err === "object") {
    const code = (err as any).code
    if (typeof code === "string") {
      if (code === "REQUEST_FAILED") {
        return statusToKey(status) || "startupServerError"
      }
      const mapped = ERROR_CODE_TO_KEY[code]
      if (mapped) return mapped
    }
  }

  const byStatus = statusToKey(status)
  if (byStatus) return byStatus

  const message = (err as Error)?.message
  if (typeof message === "string") {
    const matched = matchMessagePattern(message)
    if (matched) return matched
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

const REQUIRED_CONFIG_FIELDS = [
  "fmeServerUrl",
  "fmeServerToken",
  "repository",
] as const

const getMissingConfigFields = (
  config: FmeExportConfig | undefined
): string[] => {
  if (!config) return [...REQUIRED_CONFIG_FIELDS]

  return REQUIRED_CONFIG_FIELDS.filter((field) => !config[field]?.trim())
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
    kind: "runtime",
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

const isGeographicSpatialRef = (polygon: __esri.Polygon): boolean => {
  try {
    const sr: any = polygon.spatialReference || {}
    if (sr && (sr.isGeographic || sr.isWGS84)) return true
    if (typeof sr.wkid === "number" && sr.wkid === 4326) return true
    const json = polygon.toJSON?.()
    const jsr = json?.spatialReference || {}
    return Boolean(jsr.isGeographic) || jsr.wkid === 4326
  } catch {
    return false
  }
}

const tryCalcArea = async (
  engine: any,
  polygon: __esri.Polygon,
  isGeographic: boolean
): Promise<number> => {
  if (!engine) return 0

  if (isGeographic && typeof engine.geodesicArea === "function") {
    const area = await engine.geodesicArea(polygon, "square-meters")
    if (Number.isFinite(area) && area > 0) return area
  }

  if (typeof engine.planarArea === "function") {
    const area = await engine.planarArea(polygon, "square-meters")
    if (Number.isFinite(area) && area > 0) return area
  }

  return 0
}

// Geometry helpers
export const calcArea = async (
  geometry: __esri.Geometry | undefined,
  modules: any
): Promise<number> => {
  if (!geometry || geometry.type !== "polygon") return 0

  const polygon = geometry as __esri.Polygon
  const geographic = isGeographicSpatialRef(polygon)

  try {
    if (modules?.geometryEngineAsync) {
      const area = await tryCalcArea(
        modules.geometryEngineAsync,
        polygon,
        geographic
      )
      if (area > 0) return area
    }

    if (modules?.geometryEngine) {
      const area = await tryCalcArea(
        modules.geometryEngine,
        polygon,
        geographic
      )
      if (area > 0) return area
    }
  } catch {}

  return 0
}

const makeGeometryError = (
  messageKey: string,
  code: string
): { valid: false; error: ErrorState } => ({
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
    kind: "runtime",
  },
})

const simplifyPolygon = async (
  poly: __esri.Polygon,
  engine: any,
  engineAsync: any
): Promise<__esri.Polygon | null> => {
  if (engineAsync?.simplify) {
    const simplified = (await engineAsync.simplify(
      poly
    )) as __esri.Polygon | null
    if (!simplified) return null

    const checkSimple = engineAsync.isSimple || engine?.isSimple
    if (checkSimple) {
      const isSimple = await checkSimple(simplified)
      if (!isSimple) return null
    }

    return simplified
  }

  if (engine?.simplify) {
    const simplified = engine.simplify(poly) as __esri.Polygon | null
    if (!simplified) return null
    if (engine.isSimple && !engine.isSimple(simplified)) return null
    return simplified
  }

  if (engine?.isSimple && !engine.isSimple(poly)) return null

  return poly
}

const isRingClosed = (ring: any[]): boolean => {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return Boolean(first && last && first[0] === last[0] && first[1] === last[1])
}

const validateRingStructure = (rings: any[]): boolean => {
  if (!Array.isArray(rings) || rings.length === 0) return false

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return false
    if (!isRingClosed(ring)) return false
  }

  return true
}

const validateHolesWithinOuter = (
  rings: any[],
  poly: __esri.Polygon,
  engine: any,
  modules: any
): boolean => {
  if (rings.length <= 1 || !engine?.contains) return true

  try {
    const PolygonCtor = modules?.Polygon
    if (!PolygonCtor) return true

    const outer = PolygonCtor.fromJSON({
      rings: [rings[0]],
      spatialReference: (poly as any).spatialReference,
    })

    for (let i = 1; i < rings.length; i++) {
      const hole = PolygonCtor.fromJSON({
        rings: [rings[i]],
        spatialReference: (poly as any).spatialReference,
      })
      if (!engine.contains(outer, hole)) return false
    }
  } catch {
    return true
  }

  return true
}

export const validatePolygon = async (
  geometry: __esri.Geometry | undefined,
  modules: any
): Promise<{
  valid: boolean
  error?: ErrorState
  simplified?: __esri.Polygon
}> => {
  if (!geometry) {
    return makeGeometryError("noGeometryProvided", "NO_GEOMETRY")
  }

  if (geometry.type !== "polygon") {
    return makeGeometryError("geometryMustBePolygon", "INVALID_GEOMETRY_TYPE")
  }

  if (!modules?.geometryEngine && !modules?.geometryEngineAsync) {
    return { valid: true }
  }

  try {
    const engine: any = modules.geometryEngine
    const engineAsync: any = modules.geometryEngineAsync
    let poly = geometry as __esri.Polygon

    const simplified = await simplifyPolygon(poly, engine, engineAsync)
    if (!simplified) {
      return makeGeometryError("polygonNotSimple", "INVALID_GEOMETRY")
    }
    poly = simplified

    const rings: any[] = (poly as any).rings || []
    if (!validateRingStructure(rings)) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
    }

    const area = await calcArea(poly as any, modules)
    if (!area || area <= 0) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
    }

    if (!validateHolesWithinOuter(rings, poly, engine, modules)) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
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

const createBlobResponse = (
  blob: Blob,
  workspace: string,
  userEmail: string
) => ({
  success: true,
  blob,
  email: userEmail,
  workspaceName: workspace,
  downloadFilename: `${workspace}_export.zip`,
})

const createSuccessResponse = (
  serviceInfo: NormalizedServiceInfo,
  workspace: string,
  userEmail: string
) => ({
  success: true,
  jobId: typeof serviceInfo.jobId === "number" ? serviceInfo.jobId : undefined,
  email: userEmail,
  workspaceName: workspace,
  downloadUrl: serviceInfo.url,
  downloadFilename: serviceInfo.url ? `${workspace}_export.zip` : undefined,
})

const createFailureResponse = (message: string) => ({
  success: false,
  message,
  code: "FME_JOB_FAILURE",
})

const isValidDownloadUrl = (url: unknown): boolean =>
  typeof url === "string" && /^https?:\/\//.test(url)

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

  if (data.blob instanceof Blob) {
    return createBlobResponse(data.blob, workspace, userEmail)
  }

  const serviceInfo = normalizeFmeServiceInfo(response as FmeResponse)

  if (serviceInfo.status === "success" || isValidDownloadUrl(serviceInfo.url)) {
    return createSuccessResponse(serviceInfo, workspace, userEmail)
  }

  return createFailureResponse(
    serviceInfo.message || translateFn("fmeJobSubmissionFailed")
  )
}

export const normalizeFmeServiceInfo = (resp: any): NormalizedServiceInfo => {
  const r: any = resp || {}
  const raw = r?.data?.serviceResponse || r?.data || r
  const status = raw?.statusInfo?.status || raw?.status
  const message = raw?.statusInfo?.message || raw?.message
  const jobId = typeof raw?.jobID === "number" ? raw.jobID : raw?.id
  const url = raw?.url
  return { status, message, jobId, url }
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
