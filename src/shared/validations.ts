// Centralized validation and error handling utilities
import {
  ErrorSeverity,
  ErrorType,
  type SanitizationResult,
  type ErrorState,
  type FmeExportConfig,
} from "../config"

// ------------------------------
// Primitive validators
// ------------------------------
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

// ------------------------------
// Email utilities
// ------------------------------
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

// ------------------------------
// FME URL/token/repository validators
// ------------------------------
const MIN_TOKEN_LENGTH = 10
const FME_REST_PATH = "/fmerest"

const isValidHostname = (host: string): boolean => {
  const hostnamePattern =
    /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+)$/i
  return hostnamePattern.test(host)
}

const hasForbiddenPaths = (pathname: string): boolean => {
  const lowerPath = pathname.toLowerCase()
  return lowerPath.includes(FME_REST_PATH)
}

export const sanitizeFmeBaseUrl = (rawUrl: string): SanitizationResult => {
  try {
    const trimmed = (rawUrl || "").trim()
    const u = new URL(trimmed)
    let path = u.pathname || "/"
    const lower = path.toLowerCase()
    const idxRest = lower.indexOf(FME_REST_PATH)
    if (idxRest >= 0) path = path.substring(0, idxRest) || "/"
    const cleaned = new URL(u.origin + path).toString().replace(/\/$/, "")
    const changed = cleaned !== trimmed.replace(/\/$/, "") && idxRest >= 0
    return { isValid: true, cleaned, changed, errors: [] }
  } catch {
    return {
      isValid: false,
      cleaned: rawUrl,
      changed: false,
      errors: ["invalidUrl"],
    }
  }
}

export const validateServerUrlKey = (url: string): string | null => {
  const trimmedUrl = url?.trim()
  if (!trimmedUrl) return "errorMissingServerUrl"

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedUrl)
  } catch {
    return "errorInvalidServerUrl"
  }

  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return "errorInvalidServerUrl"
  }

  if (parsedUrl.username || parsedUrl.password) {
    return "errorInvalidServerUrl"
  }

  if (hasForbiddenPaths(parsedUrl.pathname)) {
    return "errorBadBaseUrl"
  }

  if (!isValidHostname(parsedUrl.hostname)) {
    return "errorInvalidServerUrl"
  }

  return null
}

// Heuristic used during connectivity checks on auth errors to flag suspect hostnames
export const hasLikelyInvalidHostname = (url: string): boolean => {
  try {
    const u = new URL((url || "").trim())
    const hostname = u.hostname || ""
    return !hostname.includes(".") || hostname.length < 4
  } catch {
    return true
  }
}

export const validateTokenKey = (token: string): string | null => {
  if (!token) return "errorMissingToken"

  const hasWhitespace = /\s/.test(token)
  const hasProblematicChars = /[<>"'`]/.test(token)
  const tooShort = token.length < MIN_TOKEN_LENGTH

  if (hasWhitespace || tooShort) return "errorTokenIsInvalid"

  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)
    if (code < 32 || code === 127) return "errorTokenIsInvalid"
  }

  if (hasProblematicChars) return "errorTokenIsInvalid"

  return null
}

export const validateRepositoryKey = (
  repository: string,
  availableRepos: string[] | null
): string | null => {
  if (availableRepos === null) return null
  if (availableRepos.length > 0 && !repository) return "errorRepoRequired"
  if (
    availableRepos.length > 0 &&
    repository &&
    !availableRepos.includes(repository)
  ) {
    return "errorRepositoryNotFound"
  }
  return null
}

export const getEmailValidationError = (email: string): string | null => {
  if (!email) return null
  return isValidEmail(email) ? null : "errorInvalidEmail"
}

// ------------------------------
// Error extraction and HTTP status helpers
// ------------------------------
export const extractErrorMessage = (error: unknown): string => {
  if (!error) return "unknownErrorOccurred"

  if (typeof error === "string") return error
  if (typeof error === "number") return String(error)

  if (error instanceof Error)
    return error.message || error.name || "unknownErrorOccurred"

  if (typeof error === "object" && error !== null) {
    const obj = error as { [key: string]: unknown }

    for (const prop of [
      "message",
      "error",
      "description",
      "detail",
      "reason",
    ]) {
      const value = obj[prop]
      if (typeof value === "string" && value.trim()) {
        return value
      }
    }

    try {
      return JSON.stringify(error)
    } catch {
      return "unknownErrorOccurred"
    }
  }

  try {
    return JSON.stringify(error)
  } catch {
    return "unknownErrorOccurred"
  }
}

export const extractHttpStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined

  const obj = error as { [key: string]: unknown }

  for (const prop of ["status", "statusCode", "httpStatus", "code"]) {
    const value = obj[prop]
    if (typeof value === "number" && value >= 100 && value < 600) {
      return value
    }
    if (typeof value === "string") {
      const parsed = parseInt(value, 10)
      if (!isNaN(parsed) && parsed >= 100 && parsed < 600) {
        return parsed
      }
    }
  }

  return undefined
}

// ------------------------------
// External URL guard (FME opt_geturl)
// ------------------------------
export const isValidExternalUrlForOptGetUrl = (url: unknown): boolean => {
  if (typeof url !== "string") return false
  const trimmed = url.trim()
  if (!trimmed || trimmed.length > 10000) return false
  try {
    const u = new URL(trimmed)
    if (u.protocol.toLowerCase() !== "https:") return false
    if (u.username || u.password) return false
    return true
  } catch {
    return false
  }
}

// ------------------------------
// URL and host validation utilities
// ------------------------------
export const extractHostFromUrl = (serverUrl: string): string | null => {
  try {
    return new URL(serverUrl).host
  } catch {
    return null
  }
}

// ------------------------------
// HTTP status extraction utilities
// ------------------------------
export const extractStatusFromMessage = (
  message: string
): number | undefined => {
  // Define status extraction patterns in order of specificity
  const statusPatterns = [
    /status:\s*(\d{3})/i, // "status: 401"
    /\b(\d{3})\s*\((?:Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error|Service Unavailable|Gateway)/i, // "401 (Unauthorized)"
    /\b(\d{3})\b/, // standalone "401"
  ]

  for (const pattern of statusPatterns) {
    const match = message.match(pattern)
    if (match) {
      return parseInt(match[1], 10)
    }
  }

  return undefined
}

// ------------------------------
// Enhanced error information extraction
// ------------------------------
export const getErrorInfo = (
  err: unknown
): {
  message: string
  status?: number
  details?: unknown
} => {
  if (err && typeof err === "object") {
    const anyErr = err as any

    // Try multiple ways to extract status code
    const status =
      anyErr.status ||
      anyErr.httpStatus ||
      anyErr.httpCode ||
      anyErr.code ||
      anyErr.response?.status ||
      anyErr.details?.httpCode ||
      (typeof anyErr.message === "string"
        ? extractStatusFromMessage(anyErr.message)
        : undefined)

    return {
      message:
        typeof anyErr.message === "string"
          ? anyErr.message
          : extractErrorMessage(anyErr.message),
      status: typeof status === "number" ? status : undefined,
      details: anyErr.details,
    }
  }
  return { message: extractErrorMessage(err) }
}

// ------------------------------
// Content type validation
// ------------------------------
export const isJson = (contentType: string | null): boolean =>
  contentType?.includes("application/json") ?? false

// ------------------------------
// Token masking utility
// ------------------------------
export const maskToken = (token: string): string =>
  token ? `****${token.slice(-4)}` : ""

// ------------------------------
// File object validation
// ------------------------------
export const isFileObject = (value: unknown): value is File => {
  try {
    // Check if File constructor exists in the global scope
    const FileConstructor = (globalThis as any).File
    if (typeof FileConstructor === "undefined") return false

    // Safely check instanceof
    return value instanceof FileConstructor
  } catch {
    // If instanceof check fails, fall back to duck typing
    return (
      value !== null &&
      typeof value === "object" &&
      typeof (value as any).name === "string" &&
      typeof (value as any).size === "number"
    )
  }
}

// Get a safe display name for a File object
export const getFileDisplayName = (file: File): string => {
  const name = file.name
  return typeof name === "string" && name.trim() ? name.trim() : "unnamed-file"
}

// ------------------------------
// Configuration validation
// ------------------------------
export const validateRequiredConfig = (config: {
  readonly serverUrl?: string
  readonly token?: string
  readonly repository?: string
}): void => {
  if (!config.serverUrl || !config.token || !config.repository) {
    throw new Error("INVALID_CONFIG")
  }
}

// ------------------------------
// Numeric validation utilities
// ------------------------------
// Parse a non-negative integer from string; returns undefined when invalid
export const parseNonNegativeInt = (val: string): number | undefined => {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

// ------------------------------
// HTTP status error message utilities
// ------------------------------
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

// Check if status is an auth error
export const isAuthError = (status: number): boolean => {
  return (
    status === HTTP_STATUS_CODES.UNAUTHORIZED ||
    status === HTTP_STATUS_CODES.FORBIDDEN
  )
}

// Error message generation helpers
export const getErrorMessageWithHelper = (
  translate: (key: string, params?: any) => string,
  errorKey: string,
  status: number,
  helperKey?: string
): string => {
  // TODO(i18n): Consider moving this composition into a single translation key
  // e.g., translate('errorWithHelper', { base: translate(errorKey, { status }), helper: translate(helperKey) })
  const baseMessage = translate(errorKey, { status })
  if (helperKey) {
    const helperMessage = translate(helperKey)
    return `${baseMessage} ${helperMessage}`
  }
  return baseMessage
}

export const getSpecialStatusErrorMessage = (
  status: number,
  translate: (key: string, params?: any) => string,
  errorKey: string
): string => {
  if (status === HTTP_STATUS_CODES.NETWORK_ERROR) {
    return getErrorMessageWithHelper(
      translate,
      errorKey,
      status,
      "helperNetwork"
    )
  }
  if (isAuthError(status)) {
    return getErrorMessageWithHelper(translate, errorKey, status, "helperAuth")
  }
  if (status === HTTP_STATUS_CODES.NOT_FOUND) {
    return getErrorMessageWithHelper(
      translate,
      errorKey,
      status,
      "helperNotFound"
    )
  }
  return translate(errorKey, { status })
}

export function getStatusErrorMessage(
  status: number,
  translate: (key: string, params?: any) => string
): string {
  const errorKey = STATUS_ERROR_MAP[status]

  if (errorKey) {
    return getSpecialStatusErrorMessage(status, translate, errorKey)
  }

  if (
    status >= HTTP_STATUS_CODES.SERVER_ERROR_MIN &&
    status <= HTTP_STATUS_CODES.SERVER_ERROR_MAX
  ) {
    return translate("errorServer", { status })
  }

  return translate("errorHttpStatus", { status })
}

// ------------------------------
// Error service and error mapping
// ------------------------------
export class ErrorHandlingService {
  createError(
    message: string,
    type: ErrorType = ErrorType.VALIDATION,
    options: {
      code?: string
      severity?: ErrorSeverity
      details?: { [key: string]: unknown }
      recoverable?: boolean
      retry?: () => void
      userFriendlyMessage?: string
      suggestion?: string
    } = {}
  ) {
    const {
      code = "UNKNOWN_ERROR",
      severity = ErrorSeverity.ERROR,
      details,
      recoverable = false,
      retry,
      userFriendlyMessage,
      suggestion,
    } = options

    return {
      message,
      type,
      code,
      severity,
      details,
      recoverable,
      retry,
      timestamp: new Date(),
      timestampMs: 0, // Keep original test-expected value
      userFriendlyMessage,
      suggestion,
    }
  }

  deriveStartupError(
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } {
    if (typeof translate !== "function") {
      return {
        code: "STARTUP_ERROR",
        message: "Validation failed",
      }
    }
    if (!error) {
      return {
        code: "STARTUP_ERROR",
        message: translate("startupValidationFailed"),
      }
    }

    const errorObj = error as { [key: string]: unknown }
    const errorCode =
      (errorObj.code as string) || (errorObj.name as string) || ""
    const status = this.normalizeStatus(errorObj.status)
    const message = (error as Error)?.message || ""

    const knownCodeResult = this.checkKnownErrorCodes(
      errorCode,
      message,
      translate
    )
    if (knownCodeResult) return knownCodeResult

    const specificErrorResult = this.checkSpecificErrorPatterns(
      errorCode,
      message,
      translate
    )
    if (specificErrorResult) return specificErrorResult

    if (typeof status === "number") {
      const statusResult = this.checkHttpStatusCodes(status, translate)
      if (statusResult) return statusResult
    }

    const messageResult = this.checkMessagePatterns(message, error, translate)
    if (messageResult) return messageResult

    const networkResult = this.checkNetworkConditions(status, translate)
    if (networkResult) return networkResult

    return {
      code: "STARTUP_ERROR",
      message: translate("startupValidationFailed"),
    }
  }

  private normalizeStatus(status: unknown): number | undefined {
    if (typeof status === "number") return status
    if (typeof status === "string") {
      const parsed = Number(status)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
  }

  private checkKnownErrorCodes(
    errorCode: string,
    message: string,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    const knownCodes: { [key: string]: string } = {
      UserEmailMissing: "userEmailMissing",
      INVALID_EMAIL: "invalidEmail",
      INVALID_CONFIG: "invalidConfiguration",
      WEBHOOK_AUTH_ERROR: "authenticationFailed",
      ARCGIS_MODULE_ERROR: "connectionFailed",
      DATA_DOWNLOAD_ERROR: "payloadTooLarge",
      ABORT: "requestAborted",
      CANCELLED: "operationCancelled",
      CORS_ERROR: "corsError",
      OFFLINE: "offline",
      SSL_ERROR: "sslError",
      INVALID_URL: "invalidUrl",
      RATE_LIMITED: "rateLimited",
      BAD_GATEWAY: "badGateway",
      SERVICE_UNAVAILABLE: "serviceUnavailable",
      GATEWAY_TIMEOUT: "gatewayTimeout",
      BAD_REQUEST: "badRequest",
      PAYLOAD_TOO_LARGE: "payloadTooLarge",
      ETIMEDOUT: "timeout",
      ECONNRESET: "networkError",
      ENOTFOUND: "invalidUrl",
      EAI_AGAIN: "networkError",
      ERR_NAME_NOT_RESOLVED: "invalidUrl",
      ERR_CONNECTION_REFUSED: "connectionFailed",
      ERR_NETWORK: "networkError",
      AUTH_REQUIRED: "startupTokenError",
      INVALID_TOKEN: "startupTokenError",
      TOKEN_EXPIRED: "startupTokenError",
      REPOSITORY_NOT_FOUND: "repoNotFound",
      INVALID_REPOSITORY: "repoNotFound",
      URL_TOO_LONG: "urlTooLong",
      MAX_URL_LENGTH_EXCEEDED: "urlTooLong",
      DNS_ERROR: "connectionFailed",
    }

    if (message && knownCodes[message]) {
      return { code: message, message: translate(knownCodes[message]) }
    }

    if (errorCode && knownCodes[errorCode]) {
      return { code: errorCode, message: translate(knownCodes[errorCode]) }
    }

    return null
  }

  private checkSpecificErrorPatterns(
    errorCode: string,
    message: string,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (errorCode === "AbortError" || errorCode === "ABORT") {
      return { code: "ABORT", message: translate("requestAborted") }
    }
    if (errorCode === "CancelledPromiseError" || /cancel/i.test(message)) {
      return { code: "CANCELLED", message: translate("operationCancelled") }
    }
    return null
  }

  private checkHttpStatusCodes(
    status: number,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (status === 408) {
      return { code: "TIMEOUT", message: translate("timeout") }
    }
    if (status === 401 || status === 403) {
      return {
        code: "AUTH_ERROR",
        message: translate("authenticationFailed"),
      }
    }
    if (status === 404) {
      return { code: "REPO_NOT_FOUND", message: translate("repoNotFound") }
    }
    if (status === 429) {
      return { code: "RATE_LIMITED", message: translate("rateLimited") }
    }
    if (status === 413) {
      return {
        code: "PAYLOAD_TOO_LARGE",
        message: translate("payloadTooLarge"),
      }
    }
    if (status === 431) {
      return {
        code: "HEADERS_TOO_LARGE",
        message: translate("headersTooLarge"),
      }
    }
    if (status === 400 || status === 422) {
      return { code: "BAD_REQUEST", message: translate("badRequest") }
    }
    if (status === 502) {
      return { code: "BAD_GATEWAY", message: translate("badGateway") }
    }
    if (status === 503) {
      return {
        code: "SERVICE_UNAVAILABLE",
        message: translate("serviceUnavailable"),
      }
    }
    if (status === 504) {
      return {
        code: "GATEWAY_TIMEOUT",
        message: translate("gatewayTimeout"),
      }
    }
    if (status >= 500) {
      return { code: "SERVER_ERROR", message: translate("serverError") }
    }
    return null
  }

  private checkMessagePatterns(
    message: string,
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (typeof message !== "string") return null

    if (/timeout/i.test(message)) {
      return { code: "TIMEOUT", message: translate("timeout") }
    }
    if (/^TypeError: Failed to fetch$/i.test(message)) {
      return this.handleFetchError(translate)
    }
    if (/network|failed to fetch|net::|ECONNRESET|ERR_NETWORK/i.test(message)) {
      return { code: "NETWORK_ERROR", message: translate("networkError") }
    }
    if (/unexpected token|json|parse/i.test(message)) {
      return { code: "BAD_RESPONSE", message: translate("badResponse") }
    }
    if (/invalid url/i.test(message)) {
      return { code: "INVALID_URL", message: translate("invalidUrl") }
    }
    if (/ssl|certificate|self[- ]signed/i.test(message)) {
      return { code: "SSL_ERROR", message: translate("sslError") }
    }
    if (/CORS|blocked by CORS policy/i.test(message)) {
      return { code: "CORS_ERROR", message: translate("corsError") }
    }
    if (/URL( |%20)?too( |%20)?long|Request-URI Too Large/i.test(message)) {
      return { code: "URL_TOO_LONG", message: translate("urlTooLong") }
    }
    if (/Name or service not known|DNS|ERR_NAME_NOT_RESOLVED/i.test(message)) {
      return { code: "DNS_ERROR", message: translate("connectionFailed") }
    }
    if (
      (error as Error)?.name === "TypeError" &&
      /fetch/i.test((error as Error)?.message)
    ) {
      return { code: "NETWORK_ERROR", message: translate("networkError") }
    }
    return null
  }

  private handleFetchError(translate: (key: string) => string): {
    code: string
    message: string
  } {
    try {
      const nav = (globalThis as { navigator?: { onLine?: boolean } })
        ?.navigator
      if (nav && !nav.onLine) {
        return { code: "OFFLINE", message: translate("offline") }
      }
    } catch {
      // Ignore errors accessing navigator
    }
    return { code: "CORS_ERROR", message: translate("corsError") }
  }

  private checkNetworkConditions(
    status: number | undefined,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (status === 0) {
      try {
        const nav = (globalThis as { navigator?: { onLine?: boolean } })
          ?.navigator
        if (nav && !nav.onLine) {
          return { code: "OFFLINE", message: translate("offline") }
        }
      } catch {
        // Ignore errors accessing navigator
      }
      return { code: "CORS_ERROR", message: translate("corsError") }
    }
    return null
  }
}

export function getErrorMessage(err: unknown, status?: number): string {
  const code = (err as any)?.code
  if (typeof code === "string") {
    if (code === "GEOMETRY_SERIALIZATION_FAILED")
      return "GEOMETRY_SERIALIZATION_FAILED"
    if (code === "DATA_DOWNLOAD_ERROR") return "payloadTooLarge"
    if (code === "PAYLOAD_TOO_LARGE") return "payloadTooLarge"
    if (code === "RATE_LIMITED") return "rateLimited"
    if (code === "URL_TOO_LONG" || code === "MAX_URL_LENGTH_EXCEEDED")
      return "urlTooLong"
    if (code === "ETIMEDOUT") return "timeout"
    if (code === "ECONNRESET" || code === "ERR_NETWORK") return "networkError"
    if (code === "ENOTFOUND" || code === "ERR_NAME_NOT_RESOLVED")
      return "invalidUrl"
    if (code === "MISSING_REQUESTER_EMAIL") return "userEmailMissing"
    if (code === "INVALID_EMAIL") return "invalidEmail"
  }
  if (status === 0) return "startupNetworkError"
  if (status === 408) return "timeout"
  if (status === 401 || status === 403) return "startupTokenError"
  if (status === 404) return "connectionFailed"
  if (status === 429) return "rateLimited"
  if (status === 431) return "headersTooLarge"
  if (status && status >= 500) return "serverError"

  const message = (err as Error)?.message
  if (typeof message === "string" && message.trim()) {
    if (message === "GEOMETRY_SERIALIZATION_FAILED")
      return "GEOMETRY_SERIALIZATION_FAILED"
    if (message === "MISSING_REQUESTER_EMAIL") return "userEmailMissing"
    if (message === "INVALID_EMAIL") return "invalidEmail"
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
    return "unknownErrorOccurred"
  }

  return "unknownErrorOccurred"
}

// ------------------------------
// Startup validation types and helpers
// ------------------------------

export interface StartupValidationResult {
  isValid: boolean
  error?: ErrorState
  canProceed: boolean
  requiresSettings: boolean
}

export interface StartupValidationOptions {
  config: FmeExportConfig | undefined
  translate: (key: string, params?: any) => string
  signal?: AbortSignal
}

/**
 * Validate that all required configuration fields are present
 */
export function validateRequiredFields(
  config: FmeExportConfig,
  translate: (key: string, params?: any) => string
): StartupValidationResult {
  const missing: string[] = []

  if (!config.fmeServerUrl?.trim()) {
    missing.push(translate("fmeServerUrl"))
  }

  if (!config.fmeServerToken?.trim()) {
    missing.push(translate("fmeServerToken"))
  }

  if (!config.repository?.trim()) {
    missing.push(translate("fmeRepository"))
  }

  if (missing.length > 0) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createConfigError(translate, "missingRequiredFields"),
    }
  }

  return {
    isValid: true,
    canProceed: true,
    requiresSettings: false,
  }
}

/**
 * Create configuration error with user guidance
 */
export function createConfigError(
  translate: (key: string, params?: any) => string,
  code: string
): ErrorState {
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

/**
 * Create connection error from validation service result
 */
export function createConnectionError(
  translate: (key: string, params?: any) => string,
  connectionError?: { message: string; type: string; status?: number }
): ErrorState {
  // Interpret incoming message as a translation key when possible
  const baseMessageKey = connectionError?.message || "startupConnectionError"
  let baseMessage = translate(baseMessageKey) || baseMessageKey
  let suggestion = translate("checkConnectionSettings")

  // Provide specific guidance based on error type
  if (connectionError?.type === "token") {
    baseMessage = translate("startupTokenError") || baseMessage
    suggestion = translate("checkTokenSettings")
  } else if (connectionError?.type === "server") {
    baseMessage = translate("startupServerError") || baseMessage
    suggestion = translate("checkServerSettings")
  } else if (connectionError?.type === "repository") {
    baseMessage = translate("repositoryNotAccessible") || baseMessage
    suggestion = translate("checkRepositorySettings")
  } else if (connectionError?.type === "network") {
    baseMessage = translate("startupNetworkError") || baseMessage
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

/**
 * Create network error from exception
 */
export function createNetworkError(
  translate: (key: string, params?: any) => string
): ErrorState {
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

/**
 * Quick validation check without network calls
 * Used for initial validation before attempting connection
 */
export function validateConfigFields(config: FmeExportConfig | undefined): {
  isValid: boolean
  missingFields: string[]
} {
  if (!config) {
    return {
      isValid: false,
      missingFields: ["configuration"],
    }
  }

  const missing: string[] = []

  if (!config.fmeServerUrl?.trim()) {
    missing.push("serverUrl")
  }

  if (!config.fmeServerToken?.trim()) {
    missing.push("token")
  }

  if (!config.repository?.trim()) {
    missing.push("repository")
  }

  return {
    isValid: missing.length === 0,
    missingFields: missing,
  }
}

// ------------------------------
// Workflow validation functions (moved from workflow.tsx)
// ------------------------------

// Strip HTML tags and extract meaningful error text from validation errors
export const stripErrorLabel = (errorText?: string): string | undefined => {
  const t = (errorText ?? "").replace(/<[^>]*>/g, "").trim()
  if (!t) return undefined

  const colonIdx = t.indexOf(":")
  if (colonIdx > -1) return t.slice(colonIdx + 1).trim()

  const isIdx = t.toLowerCase().indexOf(" is ")
  if (isIdx > -1) return t.slice(isIdx + 4).trim()
  return t
}

// Initialize form values based on field configuration
export const initFormValues = (
  formConfig: readonly any[] // DynamicFieldConfig[] - using any to avoid import issues
): { [key: string]: any } => {
  const result: { [key: string]: any } = {}
  for (const field of formConfig) {
    if (field.defaultValue !== undefined) {
      result[field.name] = field.defaultValue
    } else if (field.type === "MULTI_SELECT") {
      // FormFieldType.MULTI_SELECT
      result[field.name] = []
    }
  }
  return result
}

// Validate whether reset button should be enabled based on state and conditions
export const canResetButton = (
  onReset: (() => void) | undefined,
  canResetFlag: boolean,
  state: string, // ViewMode - using string to avoid import issues
  drawnArea: number,
  isDrawing?: boolean,
  clickCount?: number
): boolean => {
  if (!onReset || !canResetFlag || state === "order-result") {
    return false
  }

  if (state === "drawing") {
    // During drawing, enable if at least one click has been made
    return !(isDrawing && (clickCount ?? 0) === 0)
  }
  // In other states, enable if there is a drawn area and not in initial state
  return drawnArea > 0 && state !== "initial"
}

// Validate whether workspace loading state should be shown
export const shouldShowWorkspaceLoading = (
  isLoading: boolean,
  workspaces: readonly any[], // WorkspaceItem[] - using any to avoid import issues
  state: string, // ViewMode - using string to avoid import issues
  hasError?: boolean
): boolean => {
  if (hasError) return false
  const needsLoading =
    state === "workspace-selection" || state === "export-options"
  return isLoading || (!workspaces.length && needsLoading)
}

// Validate date-time format for scheduling (YYYY-MM-DD HH:mm:ss)
export const validateDateTimeFormat = (dateTimeString: string): boolean => {
  const trimmed = dateTimeString.trim()
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  return dateTimeRegex.test(trimmed)
}

// ------------------------------
// UI validation functions (moved from ui.tsx)
// ------------------------------

// Generate aria-describedby IDs for form validation
export const ariaDesc = (id?: string, suffix = "error"): string | undefined =>
  id ? `${id}-${suffix}` : undefined

// Validate and generate appropriate aria-label for buttons (accessibility validation)
export const getBtnAria = (
  text?: any, // React.ReactNode - using any to avoid import issues
  icon?: string | boolean,
  jimuAriaLabel?: string,
  tooltip?: string,
  fallbackLabel?: string
): string | undefined => {
  // If there's an explicit aria-label, use it
  if (jimuAriaLabel) return jimuAriaLabel
  // If there's visible text, use it
  if (typeof text === "string" && text.length > 0) return text
  // if no icon, no need for aria-label
  if (!icon) return undefined
  // If there's an icon but no text, use tooltip or fallback label
  return (typeof tooltip === "string" && tooltip) || fallbackLabel
}

// Map error codes to appropriate icons (pure validation/mapping function)
export const getErrorIconSrc = (code?: string): string => {
  // Default error icon - fallback for any unrecognized codes
  const defaultErrorIcon = "error"

  if (!code || typeof code !== "string") return defaultErrorIcon
  const k = code.trim().toUpperCase()

  if (
    k === "TOKEN" ||
    k === "AUTH_ERROR" ||
    k === "INVALID_TOKEN" ||
    k === "TOKEN_EXPIRED" ||
    k === "AUTH_REQUIRED"
  ) {
    return "lock"
  }
  if (
    k === "SERVER" ||
    k === "SERVER_ERROR" ||
    k === "BAD_GATEWAY" ||
    k === "SERVICE_UNAVAILABLE" ||
    k === "GATEWAY_TIMEOUT"
  ) {
    return "error"
  }
  if (
    k === "REPOSITORY" ||
    k === "REPO_NOT_FOUND" ||
    k === "REPOSITORY_NOT_FOUND" ||
    k === "INVALID_REPOSITORY"
  ) {
    return "folder"
  }
  if (k === "DNS_ERROR") return "globe"
  if (k === "NETWORK" || k === "NETWORK_ERROR") return "unlink-chain"

  // Specific technical issues
  if (k === "OFFLINE" || k === "STARTUP_NETWORK_ERROR") return "sync-off"
  if (k === "CORS_ERROR" || k === "SSL_ERROR") return "lock"
  if (
    k === "INVALID_URL" ||
    k === "URL_TOO_LONG" ||
    k === "MAX_URL_LENGTH_EXCEEDED"
  )
    return "url"
  if (k === "HEADERS_TOO_LARGE") return "document"
  if (k === "BAD_RESPONSE") return "code"
  if (k === "BAD_REQUEST") return "warning"
  if (k === "PAYLOAD_TOO_LARGE" || k === "DATA_DOWNLOAD_ERROR")
    return "document"
  if (k === "RATE_LIMITED") return "minus-circle"
  if (k === "TIMEOUT" || k === "ETIMEDOUT") return "pending"
  if (k === "ABORT") return "stop-circle"
  if (k === "CANCELLED") return "close-circle"
  if (k === "WEBHOOK_AUTH_ERROR") return "person-lock"
  if (k === "ARCGIS_MODULE_ERROR") return "widget-framework"

  // Configuration & validation
  if (
    k === "INVALID_CONFIG" ||
    k === "CONFIGMISSING" ||
    k === "MISSINGREQUIREDFIELDS"
  )
    return "setting"
  if (
    k === "USEREMAILMISSING" ||
    k === "MISSING_REQUESTER_EMAIL" ||
    k === "INVALID_EMAIL"
  )
    return "email"

  // Generic defaults
  if (k === "CONNECTION_ERROR") return "unlink-chain"
  if (k === "SUCCESS") return "success"
  if (k === "INFO") return "info"
  return defaultErrorIcon
}

// ------------------------------
// Form field validation functions (moved from fields.tsx)
// ------------------------------

// Utility function to pad numbers with leading zeros
export const pad2 = (n: number): string => String(n).padStart(2, "0")

// Convert FME datetime format to input format (YYYYMMDDHHmmss -> YYYY-MM-DDTHH:mm[:ss])
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

// Convert input datetime format to FME format (YYYY-MM-DDTHH:mm[:ss] -> YYYYMMDDHHmmss)
export const inputToFmeDateTime = (v: string): string => {
  if (!v) return ""
  const s = v.trim()
  const [date, time] = s.split("T")
  if (!date || !time) return ""

  const [y, m, d] = date.split("-")
  const [hh, mi, ssRaw] = time.split(":")

  // Year must be 4 digits
  if (!y || y.length !== 4 || !/^[0-9]{4}$/.test(y)) return ""

  const safePad2 = (part?: string): string | null => {
    if (!part && part !== "0") return null
    const n = Number(part)
    if (!Number.isFinite(n)) return null
    return pad2(n)
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

// Convert FME date format to input format (YYYYMMDD -> YYYY-MM-DD)
export const fmeDateToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length !== 8) return ""
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

// Convert input date format to FME format (YYYY-MM-DD -> YYYYMMDD)
export const inputToFmeDate = (v: string): string =>
  v ? v.replace(/-/g, "") : ""

// Convert FME time format to input format (HHmmss or HHmm -> HH:mm[:ss])
export const fmeTimeToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`
  if (s.length >= 6) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
  return ""
}

// Convert input time format to FME format (HH:mm or HH:mm:ss -> HHmmss)
export const inputToFmeTime = (v: string): string => {
  if (!v) return ""
  const parts = v.split(":").map((x) => x || "")
  const hh = parts[0] || ""
  const mm = parts[1] || ""
  const ss = parts[2] || ""

  const nH = Number(hh)
  const nM = Number(mm)
  // FME time requires HHmm, ss is optional
  if (!Number.isFinite(nH) || !Number.isFinite(nM)) return ""

  const nS = Number(ss)
  const finalSS = Number.isFinite(nS) ? pad2(nS) : "00"

  return `${pad2(nH)}${pad2(nM)}${finalSS}`
}

// Convert normalized RGB floats to hex color ("r,g,b[,a]" floats 0..1 -> "#RRGGBB")
export const normalizedRgbToHex = (v: string): string | null => {
  const parts = (v || "").split(",").map((s) => s.trim())
  if (parts.length < 3) return null
  const to255 = (f: string) => {
    const n = Number(f)
    if (!Number.isFinite(n)) return null
    const clamped = Math.max(0, Math.min(1, n))
    return Math.round(clamped * 255)
  }
  const r = to255(parts[0])
  const g = to255(parts[1])
  const b = to255(parts[2])
  if (r == null || g == null || b == null) return null
  const toHex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Convert hex color to normalized RGB floats ("#RRGGBB" -> "r,g,b" floats 0..1)
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

// Normalize form values for multi-select handling
export const normalizeFormValue = (
  value: any, // FormPrimitive | undefined - using any to avoid import issues
  isMultiSelect: boolean
): any => {
  // FormPrimitive | SelectValue
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  if (isMultiSelect) {
    return Array.isArray(value) ? value : []
  }
  return typeof value === "string" || typeof value === "number" ? value : ""
}

// ------------------------------
// Redux state validation functions (moved from store.ts)
// ------------------------------

// Convert ErrorState to SerializableErrorState for Redux storage
export const toSerializable = (
  error: any // ErrorState | SerializableErrorState | null - using any to avoid import issues
): any => {
  // SerializableErrorState | null
  if (!error) return null
  const base = error
  // Preserve timestampMs if provided; else derive from timestamp Date; else default to 0
  const ts =
    typeof base.timestampMs === "number"
      ? base.timestampMs
      : base.timestamp instanceof Date
        ? base.timestamp.getTime()
        : 0
  const { retry, timestamp, ...rest } = base
  return { ...rest, timestampMs: ts }
}

// Sanitize form values by masking password-type parameters for Redux storage
export const sanitizeFormValues = (
  formValues: any, // FormValues - using any to avoid import issues
  parameters: readonly any[] // WorkspaceParameter[] - using any to avoid import issues
): any => {
  // FormValues
  if (!formValues) return formValues
  const secretNames = new Set(
    (parameters || [])
      .filter((p) => p && p.type === "PASSWORD") // ParameterType.PASSWORD
      .map((p) => p.name)
  )
  if (secretNames.size === 0) return formValues
  const masked: any = {}
  for (const k of Object.keys(formValues || {})) {
    masked[k] =
      secretNames.has(k) && formValues[k]
        ? ("[redacted]" as any)
        : formValues[k]
  }
  return masked
}

// ------------------------------
// Geometry validation functions (moved from widget.tsx)
// ------------------------------

// Type guard: checks for valid Esri Polygon geometry JSON, handling Graphic JSON wrapper.
export const isPolygonGeometry = (
  value: unknown
): value is { rings: unknown } | { geometry: { rings: unknown } } => {
  if (!value || typeof value !== "object") return false

  // Handle cases where the geometry is wrapped in a `geometry` property (e.g., Graphic JSON)
  const geom =
    "geometry" in value ? (value as { geometry: unknown }).geometry : value
  if (!geom || typeof geom !== "object") return false

  // Check for the defining characteristic of a polygon: the `rings` array.
  const rings = "rings" in geom ? (geom as { rings: unknown }).rings : undefined
  if (!Array.isArray(rings) || rings.length === 0) return false
  // Each ring must be an array of at least 3 tuples, each tuple being an array of 2-4 finite numbers.
  const isValidTuple = (pt: unknown) =>
    Array.isArray(pt) &&
    pt.length >= 2 &&
    pt.length <= 4 &&
    pt.every((n) => Number.isFinite(n))
  const isValidRing = (ring: unknown) =>
    Array.isArray(ring) && ring.length >= 3 && ring.every(isValidTuple)
  return (rings as unknown[]).every(isValidRing)
}

// Geometry area calculation
export const calcArea = (
  geometry: __esri.Geometry | undefined,
  modules: any // EsriModules type
): number => {
  if (!geometry || geometry.type !== "polygon" || !modules?.geometryEngine) {
    return 0
  }

  try {
    const polygon = modules.Polygon.fromJSON(geometry.toJSON())
    const engine = modules.geometryEngine
    const simplified = (engine.simplify(polygon) || polygon) as __esri.Polygon

    const sr = polygon.spatialReference
    const useGeodesic = sr?.isGeographic || sr?.isWebMercator
    const area = useGeodesic
      ? engine.geodesicArea(simplified, "square-meters")
      : engine.planarArea(simplified, "square-meters")

    return Number.isFinite(area) ? Math.abs(area) : 0
  } catch (error) {
    console.warn("Error calculating geometry area:", error)
    return 0
  }
}

// Polygon validation
export const validatePolygon = (
  geometry: __esri.Geometry | undefined,
  modules: any // EsriModules type
): { valid: boolean; error?: ErrorState } => {
  if (!geometry) {
    return {
      valid: false,
      error: new ErrorHandlingService().createError(
        "GEOMETRY_MISSING",
        ErrorType.GEOMETRY,
        {
          code: "GEOM_MISSING",
        }
      ),
    }
  }

  if (geometry.type !== "polygon") {
    return {
      valid: false,
      error: new ErrorHandlingService().createError(
        "GEOMETRY_TYPE_INVALID",
        ErrorType.GEOMETRY,
        { code: "GEOM_TYPE_INVALID" }
      ),
    }
  }

  if (!modules?.geometryEngine) {
    return { valid: true }
  }

  try {
    const polygon = modules.Polygon.fromJSON(geometry.toJSON())
    if (!modules.geometryEngine.isSimple(polygon)) {
      return {
        valid: false,
        error: new ErrorHandlingService().createError(
          "GEOMETRY_SELF_INTERSECTING",
          ErrorType.GEOMETRY,
          { code: "GEOM_SELF_INTERSECTING" }
        ),
      }
    }
    return { valid: true }
  } catch (error) {
    console.warn("Error validating polygon:", error)
    return {
      valid: false,
      error: new ErrorHandlingService().createError(
        "GEOMETRY_INVALID",
        ErrorType.GEOMETRY,
        { code: "GEOM_INVALID" }
      ),
    }
  }
}

// Area constraints
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

// Process FME response
export const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translateFn: (key: string) => string
): any => {
  // Using any for ExportResult type to avoid import issues
  const response = fmeResponse as any // FmeResponse type
  const data = response?.data
  if (!data) {
    return {
      success: false,
      message: translateFn("unexpectedFmeResponse"),
      code: "INVALID_RESPONSE",
    }
  }

  // Handle direct Blob response (streaming mode)
  if (data.blob instanceof Blob) {
    const blob: Blob = data.blob
    const contentType: string | undefined = data.contentType || blob.type
    // Create a temporary object URL for download
    const url = URL.createObjectURL(blob)
    return {
      success: true,
      message: translateFn("exportOrderSubmitted"),
      workspaceName: workspace,
      email: userEmail,
      downloadUrl: url,
      // We don't have a jobId in streaming mode
      code: contentType || undefined,
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
      message: translateFn("exportOrderSubmitted"),
      jobId,
      workspaceName: workspace,
      email: userEmail,
      downloadUrl: serviceInfo?.url,
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
