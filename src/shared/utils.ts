// Shared utility functions
import type { SanitizationResult } from "../config"
export const isEmpty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") return v.trim().length === 0
  return false
}

export const isAuthError = (status: number): boolean =>
  status === 403 || status === 401

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

// Resolve a message or a key to a translated message if available
export function resolveMessageOrKey(
  raw: string,
  translate: (key: string) => string
): string {
  if (!raw) return raw
  const exact = translate(raw)
  if (exact && exact !== raw) return exact
  const camelKey = raw
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/^([a-z])/, (_, c: string) => c)
  const camel = translate(camelKey)
  return camel && camel !== camelKey ? camel : raw
}

// Email validation utility
export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (/no-?reply/i.test(email)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Mask email for display, e.g. "
export const maskEmailForDisplay = (email: unknown): string => {
  if (typeof email !== "string") return ""
  const trimmed = email.trim()
  if (!isValidEmail(trimmed)) return trimmed
  const atIdx = trimmed.indexOf("@")
  if (atIdx <= 1) return `**${trimmed.slice(atIdx)}`

  const local = trimmed.slice(0, atIdx)
  const domain = trimmed.slice(atIdx)
  const visible = local.slice(0, 2)
  return `${visible}****${domain}`
}

// Centralized FME validation and sanitization helpers (shared by settings and services)

const IPV4_MIN_OCTET = 0
const IPV4_MAX_OCTET = 255
const MIN_TOKEN_LENGTH = 10
const FME_REST_PATH = "/fmerest"

const isValidIPv4 = (host: string): boolean => {
  const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/
  if (!ipv4Pattern.test(host)) return false

  return host.split(".").every((octet) => {
    const num = Number(octet)
    return (
      Number.isFinite(num) && num >= IPV4_MIN_OCTET && num <= IPV4_MAX_OCTET
    )
  })
}

const isValidHostname = (host: string): boolean => {
  // Allow localhost, IPv4 addresses, domain names with dots, or FME Flow branded hostnames
  const isLocalhost = host.toLowerCase() === "localhost"
  const isIPv4Address = isValidIPv4(host)
  const hasDomainDot = host.includes(".")
  const isFmeFlowBranded = /fmeflow/i.test(host)

  return isLocalhost || isIPv4Address || hasDomainDot || isFmeFlowBranded
}

const hasForbiddenPaths = (pathname: string): boolean => {
  const lowerPath = pathname.toLowerCase()
  return lowerPath.includes(FME_REST_PATH)
}

// Sanitize FME base URL by removing trailing '/fmerest' and trailing slash
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

// Validate server URL; returns i18n error key or null
export const validateServerUrlKey = (url: string): string | null => {
  const trimmedUrl = url?.trim()
  if (!trimmedUrl) return "errorMissingServerUrl"

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedUrl)
  } catch {
    return "errorInvalidServerUrl"
  }

  // Validate protocol (only HTTP/HTTPS allowed)
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return "errorInvalidServerUrl"
  }

  // Disallow URLs with embedded credentials
  if (parsedUrl.username || parsedUrl.password) {
    return "errorInvalidServerUrl"
  }

  // Check for forbidden FME-specific paths that should be stripped
  if (hasForbiddenPaths(parsedUrl.pathname)) {
    return "errorBadBaseUrl"
  }

  // Validate hostname/host
  if (!isValidHostname(parsedUrl.hostname)) {
    return "errorInvalidServerUrl"
  }

  return null
}

// Validate token; returns i18n error key or null
export const validateTokenKey = (token: string): string | null => {
  if (!token) return "errorMissingToken"

  const hasWhitespace = /\s/.test(token)
  const hasProblematicChars = /[<>"'`]/.test(token)
  const tooShort = token.length < MIN_TOKEN_LENGTH

  if (hasWhitespace || tooShort) return "errorTokenIsInvalid"

  // Control characters check
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)
    if (code < 32 || code === 127) return "errorTokenIsInvalid"
  }

  if (hasProblematicChars) return "errorTokenIsInvalid"

  return null
}

// Validate repository; returns i18n error key or null
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

// Email validation that returns error key or null (optional field)
export const getEmailValidationError = (email: string): string | null => {
  if (!email) return null
  return isValidEmail(email) ? null : "errorInvalidEmail"
}

// Error extraction utilities
export const extractErrorMessage = (error: unknown): string => {
  // Return a generic i18n key instead of hardcoded English strings
  if (!error) return "unknownErrorOccurred"

  if (typeof error === "string") return error
  if (typeof error === "number") return String(error)

  if (error instanceof Error)
    return error.message || error.name || "unknownErrorOccurred"

  if (typeof error === "object" && error !== null) {
    const obj = error as { [key: string]: unknown }

    // Check common error message properties
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

    // Fallback to JSON representation
    try {
      return JSON.stringify(error)
    } catch {
      return "unknownErrorOccurred"
    }
  }

  // Final fallback for unknown types
  try {
    return JSON.stringify(error)
  } catch {
    return "unknownErrorOccurred"
  }
}

export const extractHttpStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined

  const obj = error as { [key: string]: unknown }

  // Check common status properties
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

// Support hint utilities
export const EMAIL_PLACEHOLDER = /\{\s*email\s*\}/i

export type TranslateFn = (
  key: string,
  vars?: { [key: string]: unknown }
) => string

// Build support hint text with optional email or custom message
export const buildSupportHintText = (
  translate: TranslateFn,
  supportEmail?: string,
  userFriendly?: string
): string => {
  if (supportEmail) {
    return translate("contactSupportWithEmail").replace(
      EMAIL_PLACEHOLDER,
      supportEmail
    )
  }
  if (typeof userFriendly === "string" && userFriendly.trim()) {
    return userFriendly
  }
  return translate("contactSupport")
}

// Extract and validate a configured support email using enterprise-safe rules
export const getSupportEmail = (
  configuredEmailRaw: unknown
): string | undefined => {
  const cfg =
    typeof configuredEmailRaw === "string" ? configuredEmailRaw.trim() : ""
  return isValidEmail(cfg) ? cfg : undefined
}
