// Shared utility functions
export const isAuthError = (status: number): boolean =>
  status === 403 || status === 401

export function getErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message
    return typeof message === "string" || typeof message === "number"
      ? String(message)
      : ""
  }
  return ""
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
