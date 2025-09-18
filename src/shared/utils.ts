import { isValidEmail } from "./validations"

export const isEmpty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") return v.trim().length === 0
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
  const camel = translate(camelKey)
  return camel && camel !== camelKey ? camel : raw
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
  return ""
}

// Safe HTML-to-text sanitizer used in UI display (no HTML rendering)
export const stripHtmlToText = (input?: string): string => {
  if (!input) return ""
  let out = input.replace(
    /<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  )
  out = out.replace(/<[^>]*>/g, "")
  return out
}
