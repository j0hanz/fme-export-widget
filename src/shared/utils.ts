// Shared utility functions
export const isEmpty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") return v.trim().length === 0
  return false
}

export const isAuthError = (status: number): boolean =>
  status === 403 || status === 401

export const isServerError = (status: number): boolean =>
  status >= 500 && status < 600

export const isNetworkError = (status: number): boolean =>
  status === 0 || status === 408 || status === 504

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

// Error extraction utilities
export const extractErrorMessage = (error: unknown): string => {
  if (!error) return "Unknown error"

  if (typeof error === "string") return error
  if (typeof error === "number") return String(error)

  if (error instanceof Error) return error.message || error.name || "Error"

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
      return "Object error"
    }
  }

  // Final fallback for unknown types
  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown error type"
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
