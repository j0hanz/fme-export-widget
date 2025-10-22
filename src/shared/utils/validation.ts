import type { FmeExportConfig, WorkspaceParameter } from "../../config/index"
import {
  ALLOWED_FILE_EXTENSIONS,
  EMAIL_REGEX,
  FORBIDDEN_HOSTNAME_SUFFIXES,
  MAX_URL_LENGTH,
  NO_REPLY_REGEX,
  PRIVATE_IPV4_RANGES,
} from "../../config/index"
import {
  isFileObject,
  isFiniteNumber,
  normalizeParameterValue,
  toStr,
  toTrimmedString,
} from "./conversion"

/** Returns true when email complies with configured validation rules. */
export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (NO_REPLY_REGEX.test(email)) return false
  return EMAIL_REGEX.test(email)
}

/**
 * Validates email field with consistent error handling
 * Returns validation result with optional error key for translation
 */
export const validateEmailField = (
  email: string | undefined,
  options: { required?: boolean } = {}
): { ok: boolean; errorKey?: string } => {
  const trimmed = (email ?? "").trim()

  // Empty is valid if not required
  if (!trimmed) {
    return options.required
      ? { ok: false, errorKey: "emailRequired" }
      : { ok: true }
  }

  if (!isValidEmail(trimmed)) {
    return { ok: false, errorKey: "invalidEmail" }
  }

  return { ok: true }
}

/** Extracts a valid support email or returns undefined. */
export const getSupportEmail = (
  configuredEmailRaw: unknown
): string | undefined => {
  const cfg = toTrimmedString(configuredEmailRaw)
  return cfg && isValidEmail(cfg) ? cfg : undefined
}

/** Builds a set of normalized parameter choices when available. */
export const buildChoiceSet = (
  list: WorkspaceParameter["listOptions"]
): Set<string | number> | null =>
  list?.length
    ? new Set(list.map((opt) => normalizeParameterValue(opt.value)))
    : null

const parseIpv4 = (hostname: string): number[] | null => {
  const parts = hostname.split(".")
  if (parts.length !== 4) return null

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return NaN
    const value = Number(part)
    return value >= 0 && value <= 255 ? value : NaN
  })

  return octets.every(Number.isInteger) ? octets : null
}

const isPrivateIpv4 = (octets: number[]): boolean => {
  return PRIVATE_IPV4_RANGES.some(({ start, end }) => {
    for (let i = 0; i < 4; i++) {
      if (octets[i] < start[i] || octets[i] > end[i]) return false
    }
    return true
  })
}

const isPrivateIpv6 = (hostname: string): boolean => {
  const lower = hostname.toLowerCase()
  return (
    lower === "::1" ||
    lower.startsWith("::1:") ||
    lower === "0:0:0:0:0:0:0:1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    /^fe[89ab][0-9a-f]/i.test(lower)
  )
}

const hasDisallowedSuffix = (hostname: string): boolean => {
  const lower = hostname.toLowerCase()
  return FORBIDDEN_HOSTNAME_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(suffix)
  )
}

/** Ensures remote dataset URL submissions are safe for opt_geturl usage. */
export const isValidExternalUrlForOptGetUrl = (s: string): boolean => {
  const trimmed = (s || "").trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return false

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }

  if (url.username || url.password || url.protocol !== "https:") return false

  const host = url.hostname.toLowerCase()
  if (!host || hasDisallowedSuffix(host)) return false

  const ipv4 = parseIpv4(host)
  if (ipv4 && isPrivateIpv4(ipv4)) return false
  if (host.includes(":") && isPrivateIpv6(host)) return false

  const hasFileExtension = /\.[^/]+$/.test(url.pathname)
  if (hasFileExtension) {
    const pathWithQuery = `${url.pathname}${url.search}`
    if (!ALLOWED_FILE_EXTENSIONS.test(pathWithQuery)) return false
  }

  return true
}

/** Detects offline state in a defensive manner. */
export const isNavigatorOffline = (): boolean => {
  if (typeof navigator === "undefined") return false

  try {
    const nav = (globalThis as any)?.navigator
    return Boolean(nav && nav.onLine === false)
  } catch {
    return false
  }
}

/** Shared abort detection helper used by network handlers. */
const ABORT_REGEX = /\baborted?\b/i

export const isAbortError = (error: unknown): boolean => {
  if (!error) return false

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      name?: unknown
      code?: unknown
      message?: unknown
    }
    const name = toStr(candidate.name ?? candidate.code)
    if (name === "AbortError" || name === "ABORT_ERR" || name === "ERR_ABORTED")
      return true
    if (!name || name === "Error") {
      const message = toStr(candidate.message)
      return ABORT_REGEX.test(message) || message.includes("signal is aborted")
    }
    return false
  }
  if (typeof error === "string") {
    return ABORT_REGEX.test(error)
  }
  return false
}

const isNumericSelectOptionValue = (value: unknown): boolean => {
  if (isFiniteNumber(value)) return true
  if (typeof value !== "string") return false

  const trimmed = value.trim()
  if (!trimmed) return false

  const numeric = Number(trimmed)
  return Number.isFinite(numeric) && String(numeric) === trimmed
}

/** Determines when select options should be coerced to numbers. */
export const computeSelectCoerce = (
  isSelectType: boolean,
  selectOptions: ReadonlyArray<{ readonly value?: unknown }>
): "number" | undefined => {
  if (!isSelectType || !selectOptions?.length) return undefined

  const allNumeric = selectOptions.every((o) =>
    isNumericSelectOptionValue(o.value)
  )
  return allNumeric ? "number" : undefined
}

/** Parses incoming table-row values from mixed representations. */
export const parseTableRows = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((x) => (typeof x === "string" ? x : String(x)))
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : value ? [value] : []
    } catch {
      return value ? [value] : []
    }
  }

  return []
}

const isRemoteDatasetEnabled = (
  config: FmeExportConfig | null | undefined
): boolean => Boolean(config?.allowRemoteDataset)

/** Determines whether remote dataset URL should be included in submission. */
export const shouldApplyRemoteDatasetUrl = (
  remoteUrl: unknown,
  config: FmeExportConfig | null | undefined
): boolean => {
  if (!isRemoteDatasetEnabled(config)) return false
  if (!config?.allowRemoteUrlDataset) return false

  const trimmed = toTrimmedString(remoteUrl)
  if (!trimmed) return false

  return isValidExternalUrlForOptGetUrl(trimmed)
}

/** Determines when remote dataset files should be uploaded. */
export const shouldUploadRemoteDataset = (
  config: FmeExportConfig | null | undefined,
  uploadFile: File | Blob | null | undefined
): boolean => {
  if (!isRemoteDatasetEnabled(config)) return false
  if (!uploadFile) return false

  if (typeof Blob !== "undefined" && uploadFile instanceof Blob) {
    return true
  }

  return isFileObject(uploadFile)
}
