import {
  ErrorSeverity,
  ErrorType,
  type ErrorState,
  type FmeExportConfig,
} from "../config"

type TFn = (key: string, params?: any) => string

export interface WebhookLenArgs {
  readonly serverUrl: string
  readonly repository: string
  readonly workspace: string
  readonly parameters?: { readonly [key: string]: unknown }
  readonly token?: string
  readonly maxLen?: number
}

export const isInt = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isInteger(value)
  if (typeof value === "string") {
    const trimmed = value.trim()
    const num = Number(trimmed)
    return Number.isInteger(num) && !Number.isNaN(num)
  }
  return false
}

export const isNum = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "string") {
    const trimmed = value.trim()
    const num = Number(trimmed)
    return Number.isFinite(num) && !Number.isNaN(num)
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

const hasForbiddenPaths = (pathname: string): boolean => {
  const lowerPath = pathname.toLowerCase()
  return lowerPath.includes(FME_REST_PATH)
}

export const normalizeBaseUrl = (rawUrl: string): string => {
  const trimmed = (rawUrl || "").trim()
  if (!trimmed) return ""

  try {
    const u = new URL(trimmed)
    let path = u.pathname || "/"
    const lower = path.toLowerCase()
    const idxRest = lower.indexOf(FME_REST_PATH)
    if (idxRest >= 0) path = path.substring(0, idxRest) || "/"

    u.pathname = path.endsWith("/") ? path : `${path}/`
    u.search = ""
    u.hash = ""
    u.username = ""
    u.password = ""

    return u.toString()
  } catch {
    return ""
  }
}

export const validateServerUrl = (
  url: string,
  opts?: { strict?: boolean }
): { ok: boolean; key?: string } => {
  const trimmedUrl = url?.trim()
  if (!trimmedUrl) return { ok: false, key: "errorMissingServerUrl" }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedUrl)
  } catch {
    return { ok: false, key: "errorInvalidServerUrl" }
  }

  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return { ok: false, key: "errorInvalidServerUrl" }
  }

  if (parsedUrl.username || parsedUrl.password) {
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

// ------------------------------
// 3. Error mapping (canonical API)
// ------------------------------
export const mapErrorToKey = (err: unknown, status?: number): string => {
  // Check structured error properties first
  if (err && typeof err === "object") {
    const errorObj = err as any

    // Check for explicit error codes
    const code = errorObj.code
    if (typeof code === "string") {
      switch (code) {
        case "GEOMETRY_SERIALIZATION_FAILED":
          return "GEOMETRY_SERIALIZATION_FAILED"
        case "DATA_DOWNLOAD_ERROR":
        case "PAYLOAD_TOO_LARGE":
          return "payloadTooLarge"
        case "RATE_LIMITED":
          return "rateLimited"
        case "URL_TOO_LONG":
        case "MAX_URL_LENGTH_EXCEEDED":
          return "urlTooLong"
        case "ETIMEDOUT":
          return "timeout"
        case "ECONNRESET":
        case "ERR_NETWORK":
          return "networkError"
        case "ENOTFOUND":
        case "ERR_NAME_NOT_RESOLVED":
          return "invalidUrl"
        case "MISSING_REQUESTER_EMAIL":
          return "userEmailMissing"
        case "INVALID_EMAIL":
          return "invalidEmail"
      }
    }

    // Check HTTP status from object properties
    const objStatus =
      errorObj.status || errorObj.statusCode || errorObj.httpStatus
    if (typeof objStatus === "number") {
      status = objStatus
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
        if (status >= 500) return "serverError"
    }
  }

  // Message pattern matching as fallback
  const message = (err as Error)?.message
  if (typeof message === "string" && message.trim()) {
    // Direct message matches
    if (message === "GEOMETRY_SERIALIZATION_FAILED") {
      return "GEOMETRY_SERIALIZATION_FAILED"
    }
    if (message === "MISSING_REQUESTER_EMAIL") {
      return "userEmailMissing"
    }
    if (message === "INVALID_EMAIL") {
      return "invalidEmail"
    }

    // Pattern-based matching
    const lowerMessage = message.toLowerCase()
    if (lowerMessage.includes("failed to fetch")) {
      return "startupNetworkError"
    }
    if (lowerMessage.includes("timeout")) {
      return "timeout"
    }
    if (/(cors|blocked by cors policy)/i.test(message)) {
      return "corsError"
    }
    if (/url\s*too\s*long|request-uri too large/i.test(message)) {
      return "urlTooLong"
    }
  }

  return "unknownErrorOccurred"
}

export const isJson = (contentType: string | null): boolean =>
  contentType?.includes("application/json") ?? false

export const isValidExternalUrlForOptGetUrl = (url: unknown): boolean => {
  if (typeof url !== "string") return false
  const trimmed = url.trim()
  if (!trimmed || trimmed.length > 10000) return false
  try {
    const u = new URL(trimmed)
    return /^https?:$/i.test(u.protocol)
  } catch {
    return false
  }
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

export const validateConfigFields = (
  config: FmeExportConfig | undefined
): {
  isValid: boolean
  missingFields: string[]
} => {
  if (!config) {
    return {
      isValid: false,
      missingFields: ["fmeServerUrl", "fmeServerToken", "repository"],
    }
  }

  const missing: string[] = []

  if (!config.fmeServerUrl?.trim()) {
    missing.push("fmeServerUrl")
  }

  if (!config.fmeServerToken?.trim()) {
    missing.push("fmeServerToken")
  }

  if (!config.repository?.trim()) {
    missing.push("repository")
  }

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

export const STATUS_ERROR_MAP: { readonly [status: number]: string } = {
  [HTTP_STATUS_CODES.UNAUTHORIZED]: "errorUnauthorized",
  [HTTP_STATUS_CODES.FORBIDDEN]: "errorUnauthorized",
  [HTTP_STATUS_CODES.NOT_FOUND]: "errorNotFound",
  [HTTP_STATUS_CODES.BAD_REQUEST]: "errorBadRequest",
  [HTTP_STATUS_CODES.TIMEOUT]: "errorTimeout",
  [HTTP_STATUS_CODES.GATEWAY_TIMEOUT]: "errorTimeout",
  [HTTP_STATUS_CODES.TOO_MANY_REQUESTS]: "errorTooManyRequests",
  [HTTP_STATUS_CODES.BAD_GATEWAY]: "errorGateway",
  [HTTP_STATUS_CODES.SERVICE_UNAVAILABLE]: "errorServiceUnavailable",
  [HTTP_STATUS_CODES.NETWORK_ERROR]: "errorNetworkShort",
} as const

export const isAuthError = (status: number): boolean => {
  return (
    status === HTTP_STATUS_CODES.UNAUTHORIZED ||
    status === HTTP_STATUS_CODES.FORBIDDEN
  )
}

export const getStatusErrorMessage = (
  status: number,
  translate: TFn
): string => {
  const errorKey = STATUS_ERROR_MAP[status]

  if (errorKey) {
    return translate(errorKey, { status })
  }

  if (
    status >= HTTP_STATUS_CODES.SERVER_ERROR_MIN &&
    status <= HTTP_STATUS_CODES.SERVER_ERROR_MAX
  ) {
    return translate("errorServerError", { status })
  }

  return translate("errorHttpStatus", { status })
}

export const extractErrorMessage = (error: unknown): string => {
  if (!error) return "Unknown error"

  if (typeof error === "string") return error
  if (typeof error === "number") return error.toString()

  if (error instanceof Error)
    return error.message || error.toString() || "Error object"

  if (typeof error === "object" && error !== null) {
    const obj = error as { [key: string]: unknown }

    // Try common error message properties
    for (const prop of ["message", "error", "details", "description"]) {
      const value = obj[prop]
      if (typeof value === "string" && value.trim()) return value.trim()
    }

    // Try nested error objects
    if (obj.error && typeof obj.error === "object") {
      const nested = obj.error as { [key: string]: unknown }
      if (typeof nested.message === "string" && nested.message.trim()) {
        return nested.message.trim()
      }
    }
  }

  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown error occurred"
  }
}

export const extractHttpStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined

  const obj = error as { [key: string]: unknown }

  for (const prop of ["status", "statusCode", "httpStatus", "code"]) {
    const value = obj[prop]
    if (typeof value === "number" && value >= 100 && value <= 599) {
      return value
    }
    if (typeof value === "string") {
      const parsed = parseInt(value, 10)
      if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 599) {
        return parsed
      }
    }
  }

  return undefined
}

export const extractHostFromUrl = (serverUrl: string): string | null => {
  try {
    return new URL(serverUrl.trim()).hostname || null
  } catch {
    return null
  }
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
  const missing: string[] = []

  if (!config.fmeServerUrl?.trim()) {
    missing.push("fmeServerUrl")
  }

  if (!config.fmeServerToken?.trim()) {
    missing.push("fmeServerToken")
  }

  if (!config.repository?.trim()) {
    missing.push("repository")
  }

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

export const createConfigError = (translate: TFn, code: string): ErrorState => {
  return {
    message: translate("startupConfigError") || "startupConfigError",
    type: ErrorType.CONFIG,
    code,
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage:
      translate("startupConfigErrorHint") || "startupConfigErrorHint",
    suggestion: translate("openSettingsPanel") || "openSettingsPanel",
  }
}

export const createConnectionError = (
  translate: TFn,
  connectionError?: { message: string; type: string; status?: number }
): ErrorState => {
  const baseMessageKey = connectionError?.message || "startupConnectionError"
  const baseMessage = translate(baseMessageKey) || baseMessageKey
  let suggestion = translate("checkConnectionSettings")

  if (connectionError?.type === "token") {
    suggestion = translate("checkTokenSettings")
  } else if (connectionError?.type === "server") {
    suggestion = translate("checkServerUrlSettings")
  } else if (connectionError?.type === "repository") {
    suggestion = translate("checkRepositorySettings")
  } else if (connectionError?.type === "network") {
    suggestion = translate("checkNetworkConnection")
  }

  return {
    message: baseMessage,
    type: ErrorType.NETWORK,
    code: connectionError?.type?.toUpperCase() || "CONNECTION_ERROR",
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage: "",
    suggestion,
  }
}

export const createNetworkError = (translate: TFn): ErrorState => {
  const message = translate("startupNetworkError") || "startupNetworkError"

  return {
    message,
    type: ErrorType.NETWORK,
    code: "STARTUP_NETWORK_ERROR",
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage: "",
    suggestion: translate("checkNetworkConnection") || "checkNetworkConnection",
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
  const defaultErrorIcon = "error"

  if (!code || typeof code !== "string") return defaultErrorIcon
  const k = code.trim().toUpperCase()

  // Auth/token errors
  if (
    k === "TOKEN" ||
    k === "AUTH_ERROR" ||
    k === "INVALID_TOKEN" ||
    k === "TOKEN_EXPIRED" ||
    k === "AUTH_REQUIRED"
  ) {
    return "user-x"
  }

  // Server errors
  if (
    k === "SERVER" ||
    k === "SERVER_ERROR" ||
    k === "BAD_GATEWAY" ||
    k === "SERVICE_UNAVAILABLE" ||
    k === "GATEWAY_TIMEOUT"
  ) {
    return "server"
  }

  // Repository errors
  if (
    k === "REPOSITORY" ||
    k === "REPO_NOT_FOUND" ||
    k === "REPOSITORY_NOT_FOUND" ||
    k === "INVALID_REPOSITORY"
  ) {
    return "folder-x"
  }

  if (k === "DNS_ERROR") return "globe-x"
  if (k === "NETWORK" || k === "NETWORK_ERROR") return "wifi-off"
  if (k === "OFFLINE" || k === "STARTUP_NETWORK_ERROR") return "cloud-off"
  if (k === "CORS_ERROR" || k === "SSL_ERROR") return "shield-x"
  if (
    k === "INVALID_URL" ||
    k === "URL_TOO_LONG" ||
    k === "MAX_URL_LENGTH_EXCEEDED"
  )
    return "link-off"
  if (k === "HEADERS_TOO_LARGE") return "file-x"
  if (k === "BAD_RESPONSE") return "alert-triangle"
  if (k === "BAD_REQUEST") return "x-octagon"
  if (k === "PAYLOAD_TOO_LARGE" || k === "DATA_DOWNLOAD_ERROR")
    return "download-x"
  if (k === "RATE_LIMITED") return "clock-x"
  if (k === "TIMEOUT" || k === "ETIMEDOUT") return "timer-off"
  if (k === "ABORT") return "stop-circle"
  if (k === "CANCELLED") return "x-circle"
  if (k === "WEBHOOK_AUTH_ERROR") return "webhook"
  if (k === "ARCGIS_MODULE_ERROR") return "layers"

  // Config/validation
  if (
    k === "INVALID_CONFIG" ||
    k === "CONFIGMISSING" ||
    k === "MISSINGREQUIREDFIELDS"
  )
    return "settings"
  if (
    k === "USEREMAILMISSING" ||
    k === "MISSING_REQUESTER_EMAIL" ||
    k === "INVALID_EMAIL"
  )
    return "mail-x"

  // Generic defaults
  if (k === "CONNECTION_ERROR") return "wifi-off"
  if (k === "SUCCESS") return "check"
  if (k === "INFO") return "info"

  return defaultErrorIcon
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
  const base = error
  const ts =
    typeof base.timestampMs === "number"
      ? base.timestampMs
      : base.timestamp instanceof Date
        ? base.timestamp.getTime()
        : 0
  const { retry, timestamp, ...rest } = base
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
  if (!geometry) {
    return {
      valid: false,
      error: {
        message: "No geometry provided",
        type: ErrorType.GEOMETRY,
        code: "NO_GEOMETRY",
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestamp: new Date(),
        timestampMs: Date.now(),
      },
    }
  }

  if (geometry.type !== "polygon") {
    return {
      valid: false,
      error: {
        message: "Geometry must be a polygon",
        type: ErrorType.GEOMETRY,
        code: "INVALID_GEOMETRY_TYPE",
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestamp: new Date(),
        timestampMs: Date.now(),
      },
    }
  }

  if (!modules?.geometryEngine) {
    return { valid: true }
  }

  try {
    const isSimple = modules.geometryEngine.isSimple(geometry)
    if (!isSimple) {
      return {
        valid: false,
        error: {
          message: "Polygon geometry is not simple (may be self-intersecting)",
          type: ErrorType.GEOMETRY,
          code: "INVALID_GEOMETRY",
          severity: ErrorSeverity.ERROR,
          recoverable: true,
          timestamp: new Date(),
          timestampMs: Date.now(),
        },
      }
    }
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: {
        message: "Failed to validate polygon geometry",
        type: ErrorType.GEOMETRY,
        code: "GEOMETRY_VALIDATION_ERROR",
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestamp: new Date(),
        timestampMs: Date.now(),
      },
    }
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

export const isWebhookUrlTooLong = (args: WebhookLenArgs): boolean => {
  const {
    serverUrl,
    repository,
    workspace,
    parameters = {},
    token,
    maxLen = 4000,
  } = args

  const normalizedBase = normalizeBaseUrl(serverUrl)
  if (!normalizedBase) return false

  const baseUrl = normalizedBase.endsWith("/")
    ? normalizedBase.slice(0, -1)
    : normalizedBase
  const webhookUrl = `${baseUrl}/fmedatadownload/${repository}/${workspace}.fmw`

  const params = new URLSearchParams()

  params.set("opt_responseformat", "json")
  params.set("opt_showresult", "true")

  const excludeKeys = new Set([
    "token",
    "fmetoken",
    "opt_responseformat",
    "opt_showresult",
  ])
  for (const [key, value] of Object.entries(parameters)) {
    if (!excludeKeys.has(key) && value != null) {
      const stringValue =
        typeof value === "string"
          ? value
          : typeof value === "number"
            ? value.toString()
            : typeof value === "boolean"
              ? value.toString()
              : JSON.stringify(value)
      params.set(key, stringValue)
    }
  }

  if (token) {
    params.set("token", token)
  }

  const fullUrl = `${webhookUrl}?${params.toString()}`
  return typeof maxLen === "number" && maxLen > 0 && fullUrl.length > maxLen
}

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

  if (data.blob instanceof Blob) {
    return {
      success: true,
      blob: data.blob,
      email: userEmail,
      workspaceName: workspace,
      downloadFilename: `${workspace}_export.zip`,
    }
  }

  const serviceInfo: any = data.serviceResponse || data
  const statusRaw = serviceInfo?.statusInfo?.status || serviceInfo?.status
  const status = typeof statusRaw === "string" ? statusRaw.toLowerCase() : ""
  const rawId = (serviceInfo?.jobID ?? serviceInfo?.id) as unknown
  const parsedId =
    typeof rawId === "number" ? rawId : rawId != null ? Number(rawId) : NaN
  const jobId: number | undefined =
    Number.isFinite(parsedId) && parsedId > 0 ? parsedId : undefined

  if (status === "success") {
    return {
      success: true,
      jobId,
      email: userEmail,
      workspaceName: workspace,
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

// Workflow helper functions
export const stripErrorLabel = (errorText?: string): string | undefined => {
  const t = (errorText ?? "").replace(/<[^>]*>/g, "").trim()
  if (!t) return undefined

  const colonIdx = t.indexOf(":")
  if (colonIdx > -1) return t.substring(colonIdx + 1).trim()

  const isIdx = t.toLowerCase().indexOf(" is ")
  if (isIdx > -1) return t.substring(isIdx + 4).trim()
  return t
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
  if (!onReset || !canResetFlag || state === "order-result") {
    return false
  }

  if (state === "drawing") {
    return Boolean(clickCount && clickCount > 0) || Boolean(isDrawing)
  }
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
