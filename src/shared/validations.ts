import {
  ErrorSeverity,
  ErrorType,
  type ErrorState,
  type FmeExportConfig,
} from "../config"

type TFn = (key: string, params?: any) => string

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

export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (/no-?reply/i.test(email)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const getSupportEmail = (
  configuredEmailRaw: unknown
): string | undefined => {
  const cfg =
    typeof configuredEmailRaw === "string" ? configuredEmailRaw.trim() : ""
  return isValidEmail(cfg) ? cfg : undefined
}

const MIN_TOKEN_LENGTH = 10
const FME_REST_PATH = "/fmerest"

// Internal helpers to consolidate repeated patterns
const isHttpStatus = (n: unknown): n is number =>
  typeof n === "number" && n >= 100 && n <= 599

const safeParseUrl = (raw: string): URL | null => {
  try {
    return new URL((raw || "").trim())
  } catch {
    return null
  }
}

const hasForbiddenPaths = (pathname: string): boolean => {
  const lowerPath = pathname.toLowerCase()
  return lowerPath.includes(FME_REST_PATH)
}

export const normalizeBaseUrl = (rawUrl: string): string => {
  const trimmed = (rawUrl || "").trim()
  if (!trimmed) return ""

  try {
    const u = safeParseUrl(trimmed)
    if (!u) return ""
    let path = u.pathname || "/"
    const lower = path.toLowerCase()
    const idxRest = lower.indexOf(FME_REST_PATH)
    if (idxRest >= 0) path = path.substring(0, idxRest) || "/"

    // Clear mutable parts
    u.pathname = path
    u.search = ""
    u.hash = ""
    u.username = ""
    u.password = ""

    // Do not keep a trailing slash in settings UI; keep the base host/path only
    const cleanPath = path === "/" ? "" : path.replace(/\/$/, "")
    return `${u.origin}${cleanPath}`
  } catch {
    return ""
  }
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

  const hasWhitespace = /\s/.test(token)
  const hasProblematicChars = /[<>"'`]/.test(token)
  const tooShort = token.length < MIN_TOKEN_LENGTH

  if (hasWhitespace || tooShort)
    return { ok: false, key: "errorTokenIsInvalid" }

  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)
    if (code < 32 || code === 127)
      return { ok: false, key: "errorTokenIsInvalid" }
  }

  if (hasProblematicChars) return { ok: false, key: "errorTokenIsInvalid" }

  return { ok: true }
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

export const extractErrorMessage = (error: unknown): string => {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (typeof error === "number") return error.toString()
  if (error instanceof Error) return error.message || "Error object"

  if (typeof error === "object" && error !== null) {
    const obj = error as { [key: string]: unknown }

    // Try common error message properties
    for (const prop of ["message", "error", "details", "description"]) {
      const value = obj[prop]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }

  return "Unknown error occurred"
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

// ------------------------------
// 3. Error mapping (canonical API)
// ------------------------------
export const mapErrorToKey = (err: unknown, status?: number): string => {
  // Extract status from error object if not provided
  if (!status) {
    status = extractHttpStatus(err)
  }

  // Check for explicit error codes first
  if (err && typeof err === "object") {
    const errorObj = err as any
    const code = errorObj.code

    if (typeof code === "string") {
      switch (code) {
        // API client error codes from api.ts
        case "ARCGIS_MODULE_ERROR":
          return "startupNetworkError"
        case "REQUEST_FAILED":
          // Categorize primarily by HTTP status
          if (status === 0 || status === undefined) return "startupNetworkError"
          if (status === 401 || status === 403) return "startupTokenError"
          if (status === 404) return "connectionFailed"
          if (status >= 500) return "startupServerError"
          return "startupServerError"
        case "NETWORK_ERROR":
          return "startupNetworkError"
        case "INVALID_RESPONSE_FORMAT":
          // Often indicates HTML (login page) or non-JSON where JSON was expected
          if (status === 401 || status === 403) return "startupTokenError"
          // Default to auth-related guidance since FME often returns HTML on auth errors
          return "startupTokenError"
        case "WEBHOOK_AUTH_ERROR":
          return "startupTokenError"
        case "SERVER_URL_ERROR":
          return "connectionFailed"
        case "REPOSITORIES_ERROR":
          return "startupServerError"
        case "REPOSITORY_ITEMS_ERROR":
          return "startupServerError"
        case "WORKSPACE_ITEM_ERROR":
          return "startupServerError"
        case "JOB_SUBMISSION_ERROR":
          return "startupServerError"
        case "DATA_STREAMING_ERROR":
          return "startupServerError"
        case "DATA_DOWNLOAD_ERROR":
          return "startupServerError"
        case "INVALID_CONFIG":
          return "startupConfigError"
        case "GEOMETRY_MISSING":
          return "GEOMETRY_SERIALIZATION_FAILED"
        case "GEOMETRY_TYPE_INVALID":
          return "GEOMETRY_SERIALIZATION_FAILED"
        case "URL_TOO_LONG":
          return "urlTooLong"
      }
    }
  }

  // HTTP status-based mapping
  if (typeof status === "number") {
    switch (status) {
      case 0:
        return "startupNetworkError"
      case 401:
      case 403:
        return "startupTokenError"
      case 404:
        return "connectionFailed"
      case 408:
        return "timeout"
      case 429:
        return "rateLimited"
      case 431:
        return "headersTooLarge"
      default:
        if (status >= 500) return "startupServerError"
    }
  }

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

export const isJson = (contentType: string | null): boolean =>
  (contentType ?? "").toLowerCase().includes("application/json")

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

export const isFileObject = (value: unknown): value is File => {
  try {
    return (
      value instanceof File ||
      (typeof value === "object" &&
        value !== null &&
        "name" in value &&
        "size" in value &&
        "type" in value)
    )
  } catch {
    return false
  }
}

export const getFileDisplayName = (file: File): string => {
  const name = file.name
  return typeof name === "string" && name.trim() ? name.trim() : "unnamed-file"
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

export const parseNonNegativeInt = (val: string): number | undefined => {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
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

export const extractHostFromUrl = (serverUrl: string): string | null => {
  const u = safeParseUrl(serverUrl)
  return u ? u.hostname || null : null
}

// Composite connection inputs validator used by settings UI
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

export interface StartupValidationResult {
  isValid: boolean
  error?: ErrorState
  canProceed: boolean
  requiresSettings: boolean
}

export interface StartupValidationOptions {
  config: FmeExportConfig | undefined
  translate: TFn
  signal?: AbortSignal
}

export const validateRequiredFields = (
  config: FmeExportConfig,
  translate: TFn
): StartupValidationResult => {
  const missing = getMissingConfigFields(config)

  if (missing.length > 0) {
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
  translate: TFn,
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

export const maskToken = (token: string): string =>
  token ? `****${token.slice(-4)}` : ""

export const ariaDesc = (id?: string, suffix = "error"): string | undefined =>
  id ? `${id}-${suffix}` : undefined

export const getBtnAria = (
  text?: any,
  icon?: string | boolean,
  jimuAriaLabel?: string,
  tooltip?: string,
  fallbackLabel?: string
): string | undefined => {
  if (jimuAriaLabel) return jimuAriaLabel
  if (typeof text === "string" && text.length > 0) return text
  if (!icon) return undefined
  return (typeof tooltip === "string" && tooltip) || fallbackLabel
}

export const getErrorIconSrc = (code?: string): string => {
  if (!code) return "error"

  const k = code.trim().toUpperCase()

  // Auth/token errors
  if (k.includes("TOKEN") || k.includes("AUTH")) return "user-x"

  // Server errors
  if (k.includes("SERVER") || k.includes("GATEWAY")) return "server"

  // Repository errors
  if (k.includes("REPOSITORY") || k.includes("REPO")) return "folder-x"

  // Network errors
  if (k.includes("NETWORK") || k.includes("OFFLINE")) return "wifi-off"

  // Specific errors
  if (k.includes("URL")) return "link-off"
  if (k.includes("TIMEOUT")) return "timer-off"
  if (k.includes("CONFIG")) return "settings"
  if (k.includes("EMAIL")) return "mail-x"

  return "error"
}

export const validateDateTimeFormat = (dateTimeString: string): boolean => {
  const trimmed = dateTimeString.trim()
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  return dateTimeRegex.test(trimmed)
}

export const toIsoLocal = (spaceDateTime: string | undefined): string => {
  const s = (spaceDateTime || "").trim()
  if (!s) return ""
  const parts = s.split(" ")
  if (parts.length !== 2) return ""
  const [d, t] = parts
  const tParts = t.split(":")
  const hh = tParts[0] || "00"
  const mm = tParts[1] || "00"
  const ss = tParts[2] || "00"
  return `${d}T${hh}:${mm}:${ss}`
}

export const fromIsoLocal = (isoLocal: string | undefined): string => {
  const s = (isoLocal || "").trim()
  if (!s) return ""
  const parts = s.split("T")
  if (parts.length !== 2) return ""
  const [d, t] = parts
  const tParts = t.split(":")
  const hh = tParts[0] || "00"
  const mm = tParts[1] || "00"
  const ss = tParts[2] || "00"
  return `${d} ${hh}:${mm}:${ss}`
}

export const pad2 = (n: number): string => String(n).padStart(2, "0")

export const fmeDateTimeToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length < 12) return ""
  const y = s.slice(0, 4)
  const m = s.slice(4, 6)
  const d = s.slice(6, 8)
  const hh = s.slice(8, 10)
  const mm = s.slice(10, 12)
  const ss = s.length >= 14 ? s.slice(12, 14) : ""
  return `${y}-${m}-${d}T${hh}:${mm}${ss ? `:${ss}` : ""}`
}

export const inputToFmeDateTime = (v: string): string => {
  if (!v) return ""
  const s = v.trim()
  const [date, time] = s.split("T")
  if (!date || !time) return ""

  const [y, m, d] = date.split("-")
  const [hh, mi, ssRaw] = time.split(":")

  if (!y || y.length !== 4 || !/^[0-9]{4}$/.test(y)) return ""

  const safePad2 = (part?: string): string | null => {
    if (!part) return null
    const n = Number(part)
    return Number.isFinite(n) && n >= 0 && n <= 99 ? pad2(n) : null
  }

  const m2 = safePad2(m)
  const d2 = safePad2(d)
  const hh2 = safePad2(hh)
  const mi2 = safePad2(mi)
  if (!m2 || !d2 || !hh2 || !mi2) return ""

  const ss2 = ssRaw ? safePad2(ssRaw) : "00"
  if (ss2 === null) return ""

  return `${y}${m2}${d2}${hh2}${mi2}${ss2}`
}

export const fmeDateToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length !== 8) return ""
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export const inputToFmeDate = (v: string): string =>
  v ? v.replace(/-/g, "") : ""

export const fmeTimeToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`
  if (s.length >= 6) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
  return ""
}

export const inputToFmeTime = (v: string): string => {
  if (!v) return ""
  const parts = v.split(":").map((x) => x || "")
  const hh = parts[0] || ""
  const mm = parts[1] || ""
  const ss = parts[2] || ""

  const nH = Number(hh)
  const nM = Number(mm)
  if (!Number.isFinite(nH) || !Number.isFinite(nM)) return ""

  const nS = Number(ss)
  const finalSS = Number.isFinite(nS) ? pad2(nS) : "00"

  return `${pad2(nH)}${pad2(nM)}${finalSS}`
}

export const normalizedRgbToHex = (v: string): string | null => {
  const parts = (v || "").split(",").map((s) => s.trim())
  if (parts.length < 3) return null
  const to255 = (f: string) => {
    const n = Number(f)
    return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 255) : null
  }
  const r = to255(parts[0])
  const g = to255(parts[1])
  const b = to255(parts[2])
  if (r == null || g == null || b == null) return null
  const toHex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export const hexToNormalizedRgb = (hex: string): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const f = (x: number) => Number((x / 255).toFixed(6)).toString()
  return `${f(r)},${f(g)},${f(b)}`
}

export const normalizeFormValue = (value: any, isMultiSelect: boolean): any => {
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  if (isMultiSelect) {
    return Array.isArray(value) ? value : [value]
  }
  return typeof value === "string" || typeof value === "number" ? value : ""
}

export const toSerializable = (error: any): any => {
  if (!error) return null
  const ts =
    typeof error.timestampMs === "number"
      ? error.timestampMs
      : error.timestamp instanceof Date
        ? error.timestamp.getTime()
        : 0
  const { retry, timestamp, ...rest } = error
  return { ...rest, timestampMs: ts }
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

export const isPolygonGeometry = (
  value: unknown
): value is { rings: unknown } | { geometry: { rings: unknown } } => {
  if (!value || typeof value !== "object") return false

  const geom =
    "geometry" in value ? (value as { geometry: unknown }).geometry : value
  if (!geom || typeof geom !== "object") return false

  const rings = "rings" in geom ? (geom as { rings: unknown }).rings : undefined
  if (!Array.isArray(rings) || rings.length === 0) return false

  const isValidTuple = (pt: unknown) =>
    Array.isArray(pt) &&
    pt.length >= 2 &&
    pt.length <= 4 &&
    pt.every((n) => Number.isFinite(n))
  const isValidRing = (ring: unknown) =>
    Array.isArray(ring) && ring.length >= 3 && ring.every(isValidTuple)
  return (rings as unknown[]).every(isValidRing)
}

export const calcArea = (
  geometry: __esri.Geometry | undefined,
  modules: any
): number => {
  if (!geometry || geometry.type !== "polygon" || !modules?.geometryEngine) {
    return 0
  }

  try {
    const areaResult = modules.geometryEngine.planarArea(
      geometry,
      "square-meters"
    )
    return typeof areaResult === "number" &&
      Number.isFinite(areaResult) &&
      areaResult >= 0
      ? areaResult
      : 0
  } catch (error) {
    console.warn("Failed to calculate polygon area:", error)
    return 0
  }
}

export const validatePolygon = (
  geometry: __esri.Geometry | undefined,
  modules: any
): { valid: boolean; error?: ErrorState } => {
  // Local helper to construct consistent geometry error objects
  const makeGeometryError = (
    message: string,
    code: string
  ): { valid: false; error: ErrorState } => ({
    valid: false,
    error: {
      message,
      type: ErrorType.GEOMETRY,
      code,
      severity: ErrorSeverity.ERROR,
      recoverable: true,
      timestamp: new Date(),
      timestampMs: Date.now(),
    },
  })

  if (!geometry) {
    return makeGeometryError("noGeometryProvided", "NO_GEOMETRY")
  }

  if (geometry.type !== "polygon") {
    return makeGeometryError("geometryMustBePolygon", "INVALID_GEOMETRY_TYPE")
  }

  if (!modules?.geometryEngine) {
    return { valid: true }
  }

  try {
    const isSimple = modules.geometryEngine.isSimple(geometry)
    if (!isSimple) {
      return makeGeometryError("polygonNotSimple", "INVALID_GEOMETRY")
    }
    return { valid: true }
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
  translateFn: TFn
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

// Workflow utility functions
export const stripErrorLabel = (errorText?: string): string | undefined => {
  const text = (errorText ?? "").replace(/<[^>]*>/g, "").trim()
  if (!text) return undefined

  const colonIdx = text.indexOf(":")
  if (colonIdx > -1) return text.substring(colonIdx + 1).trim()

  return text
}

export const initFormValues = (
  formConfig: readonly any[]
): { [key: string]: any } => {
  const result: { [key: string]: any } = {}
  for (const field of formConfig) {
    if (field?.name) {
      result[field.name] = field.defaultValue ?? ""
    }
  }
  return result
}

export const canResetButton = (
  onReset: (() => void) | undefined,
  canResetFlag: boolean,
  state: string,
  drawnArea: number,
  isDrawing?: boolean,
  clickCount?: number
): boolean => {
  if (!onReset || !canResetFlag || state === "order-result") return false
  if (state === "drawing")
    return Boolean(clickCount && clickCount > 0) || Boolean(isDrawing)
  return drawnArea > 0 && state !== "initial"
}

export const shouldShowWorkspaceLoading = (
  isLoading: boolean,
  workspaces: readonly any[],
  state: string,
  hasError?: boolean
): boolean => {
  if (hasError) return false
  const needsLoading =
    state === "workspace-selection" || state === "export-options"
  return isLoading || (!workspaces.length && needsLoading)
}
