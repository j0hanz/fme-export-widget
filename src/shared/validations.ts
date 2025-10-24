import {
  type FmeExportConfig,
  type StartupValidationResult,
  type TranslateFn,
  type UrlValidation,
  type FormValues,
  type WorkspaceParameter,
  ParameterType,
  MIN_TOKEN_LENGTH,
  EMAIL_REGEX,
  HTTP_STATUS_CODES,
  isHttpStatus,
  isRetryableStatus,
  SERVER_URL_REASON_TO_KEY,
  REQUIRED_CONFIG_FIELDS,
  STATUS_PROPERTIES,
  PRIVATE_IPV4_RANGES,
  FORBIDDEN_HOSTNAME_SUFFIXES,
  MAX_URL_LENGTH,
  ALLOWED_FILE_EXTENSIONS,
} from "../config/index"
import {
  extractErrorMessage,
  maskToken,
  safeParseUrl,
  toTrimmedString,
  toTrimmedStringOrEmpty,
  isFileObject,
  isFiniteNumber,
} from "./utils"

// URL validation helpers
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

export const isValidExternalUrlForOptGetUrl = (s: string): boolean => {
  const trimmed = toTrimmedStringOrEmpty(s)
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

const isNumericSelectOptionValue = (value: unknown): boolean => {
  if (isFiniteNumber(value)) return true
  if (typeof value !== "string") return false

  const trimmed = value.trim()
  if (!trimmed) return false

  const numeric = Number(trimmed)
  return Number.isFinite(numeric) && String(numeric) === trimmed
}

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

// Parsar värde till nummer eller null vid invalid input
const parseAsNumber = (value: unknown): number | null => {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const num = Number(value.trim())
    return Number.isFinite(num) ? num : null
  }
  return null
}

// Kontrollerar om värde är heltal
export const isInt = (value: unknown): boolean => {
  const num = parseAsNumber(value)
  return num !== null && Number.isInteger(num)
}

// Kontrollerar om värde är finit nummer
export const isNum = (value: unknown): boolean => {
  const num = parseAsNumber(value)
  return num !== null
}

// URL validation helpers

// Normaliserar bas-URL genom att ta bort credentials och query params
export const normalizeBaseUrl = (rawUrl: string): string => {
  const u = safeParseUrl(rawUrl || "")
  if (!u) return ""

  u.search = ""
  u.hash = ""
  u.username = ""
  u.password = ""

  const cleanPath = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")
  return `${u.origin}${cleanPath}`
}

// Validerar server-URL med olika strictness-nivåer och options
export function validateServerUrl(
  url: string,
  opts?: {
    strict?: boolean
    requireHttps?: boolean
  }
): UrlValidation {
  const trimmed = toTrimmedStringOrEmpty(url)
  if (!trimmed) return { ok: false, reason: "invalid_url" }

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== "http:" && protocol !== "https:") {
      return { ok: false, reason: "invalid_url" }
    }

    if (opts?.requireHttps && protocol !== "https:") {
      return { ok: false, reason: "require_https" }
    }

    if (parsed.username || parsed.password) {
      return { ok: false, reason: "invalid_url" }
    }

    if (parsed.search || parsed.hash) {
      return { ok: false, reason: "no_query_or_hash" }
    }

    if (parsed.hostname.endsWith(".")) {
      return { ok: false, reason: "invalid_url" }
    }

    if (opts?.strict) {
      const hostname = parsed.hostname || ""
      if (!hostname.includes(".") || hostname.length < 4) {
        return { ok: false, reason: "invalid_url" }
      }
    }

    return { ok: true }
  } catch {
    return { ok: false, reason: "invalid_url" }
  }
}

// Mappar URL validation reason till översättningsnyckel
export const mapServerUrlReasonToKey = (reason?: string): string => {
  if (!reason) return "invalid_url"
  return SERVER_URL_REASON_TO_KEY[reason] || "invalid_url"
}

// Email validation utilities (consolidated from conversion.ts)
const NO_REPLY_REGEX = /^no[-_]?reply@/i

export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (NO_REPLY_REGEX.test(email)) return false
  return EMAIL_REGEX.test(email)
}

export const validateEmailField = (
  email: string | undefined,
  options: { required?: boolean } = {}
): { ok: boolean; errorKey?: string } => {
  const trimmed = toTrimmedStringOrEmpty(email)

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

export const getSupportEmail = (
  configuredEmailRaw: unknown
): string | undefined => {
  const cfg = toTrimmedString(configuredEmailRaw)
  return cfg && isValidEmail(cfg) ? cfg : undefined
}

// Kontrollerar om token innehåller control characters
const hasControlCharacters = (token: string): boolean => {
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

// Kontrollerar om token har farliga tecken (whitespace, XSS, control)
const hasDangerousCharacters = (token: string): boolean =>
  /\s/.test(token) || /[<>"'`]/.test(token) || hasControlCharacters(token)

// Validerar FME token (längd och tecken-säkerhet)
export const validateToken = (token: string): { ok: boolean; key?: string } => {
  if (!token) return { ok: false, key: "missingToken" }

  const tooShort = token.length < MIN_TOKEN_LENGTH
  const hasWhitespace = /\s/.test(token)
  const invalidChars = hasDangerousCharacters(token)

  if (tooShort || invalidChars) {
    if (hasWhitespace) return { ok: false, key: "tokenWithWhitespace" }
    return { ok: false, key: "errorTokenIssue" }
  }

  return { ok: true }
}

// Validerar repository-namn mot lista av tillgängliga repositories
export const validateRepository = (
  repository: string,
  available: string[] | null
): { ok: boolean; key?: string } => {
  if (available === null) return { ok: true }
  if (available.length > 0 && !repository)
    return { ok: false, key: "missingRepository" }
  if (available.length > 0 && repository && !available.includes(repository)) {
    return { ok: false, key: "invalidRepository" }
  }
  return { ok: true }
}

// Extraherar HTTP status code från error object (flera källor)
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

// Bestämmer om fel är retryable baserat på status code
export const isRetryableError = (error: unknown): boolean => {
  if (error && typeof error === "object") {
    const candidate = error as { isRetryable?: unknown }
    if (typeof candidate.isRetryable === "boolean") {
      return candidate.isRetryable
    }
  }

  const status = extractHttpStatus(error)
  return isRetryableStatus(status)
}

// Validerar att obligatoriska config-fält är satta
export const validateRequiredConfig = (config: {
  readonly serverUrl?: string
  readonly token?: string
  readonly repository?: string
}): void => {
  if (!config.serverUrl || !config.token || !config.repository) {
    throw new Error("Missing required configuration")
  }
}

// Returnerar lista med obligatoriska fält som saknas i config
const getMissingConfigFields = (
  config: FmeExportConfig | undefined
): string[] => {
  if (!config) return [...REQUIRED_CONFIG_FIELDS]

  return REQUIRED_CONFIG_FIELDS.filter((field) => !config[field]?.trim())
}

// Returnerar isValid flag och lista med saknade config-fält
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

// Kontrollerar om status code indikerar autentiseringsfel
export const isAuthError = (status: number): boolean => {
  return (
    status === HTTP_STATUS_CODES.UNAUTHORIZED ||
    status === HTTP_STATUS_CODES.FORBIDDEN
  )
}

// Validerar url, token, repository och returnerar errors per fält
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

  // Use buildValidationErrors helper from utils/error
  const { buildValidationErrors } = require("./utils/error")

  return buildValidationErrors([
    {
      field: "serverUrl",
      validator: () => {
        const result = validateServerUrl(url)
        return result.ok
          ? { ok: true }
          : { ok: false, key: mapServerUrlReasonToKey((result as any).reason) }
      },
    },
    {
      field: "token",
      validator: () => {
        const result = validateToken(token)
        return result.ok
          ? { ok: true }
          : { ok: false, key: result.key || "errorTokenIssue" }
      },
    },
    {
      field: "repository",
      validator: () => {
        const result = validateRepository(
          repository || "",
          availableRepos === undefined ? [] : availableRepos
        )
        return result.ok
          ? { ok: true }
          : { ok: false, key: result.key || "invalidRepository" }
      },
    },
  ])
}

// Validerar att alla obligatoriska fält är satta i config
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

// Skapar geometry error med valid=false och ErrorState objekt
// Validerar datetime-sträng: YYYY-MM-DD HH:MM:SS format
export const validateDateTimeFormat = (dateTimeString: string): boolean => {
  const trimmed = dateTimeString.trim()
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  return dateTimeRegex.test(trimmed)
}

// Sanitizerar textvärde genom att klippa och ersätta XSS-tecken
const sanitizeTextValue = (value: unknown, maxLength = 10000): unknown => {
  if (typeof value !== "string") {
    return value
  }

  const clipped = value.length > maxLength ? value.slice(0, maxLength) : value

  return clipped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

export const sanitizeFormValues = (
  formValues: FormValues | null | undefined,
  parameters: readonly WorkspaceParameter[] | null | undefined
): FormValues | null | undefined => {
  if (!formValues) return formValues

  const secretNames = new Set(
    (parameters ?? [])
      .filter((param) => param?.type === ParameterType.PASSWORD)
      .map((param) => param.name)
  )

  const sanitized: FormValues = {}

  for (const [key, value] of Object.entries(formValues)) {
    if (secretNames.has(key)) {
      const safeValue =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "bigint"
            ? value.toString()
            : typeof value === "boolean"
              ? value
                ? "true"
                : "false"
              : ""
      sanitized[key] = maskToken(safeValue)
      continue
    }

    const sanitizedResult = sanitizeTextValue(value)
    sanitized[key] = sanitizedResult as FormValues[string]
  }

  return sanitized
}
