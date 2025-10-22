import {
  ErrorSeverity,
  ErrorType,
  type ErrorState,
  type ExportResult,
  type FmeExportConfig,
  type StartupValidationResult,
  type TranslateFn,
  type FmeResponse,
  type NormalizedServiceInfo,
  type UrlValidation,
  type AreaEvaluation,
  type GeometryEngineLike,
  type NormalizeUtilsModule,
  type EsriConfigLike,
  type GeometryServiceModule,
  type ArcgisGeometryModules,
  type AreasAndLengthsParametersCtor,
  type PolygonMaybe,
  type AreaStrategy,
  type FormValues,
  type WorkspaceParameter,
  ParameterType,
  MIN_TOKEN_LENGTH,
  FME_REST_PATH,
  EMAIL_REGEX,
  GEODESIC_SEGMENT_LENGTH_METERS,
  MIN_PLANAR_SEGMENT_DEGREES,
  DEGREES_PER_METER,
  HTTP_STATUS_CODES,
  ERROR_CODE_TO_KEY,
  STATUS_TO_KEY_MAP,
  MESSAGE_PATTERNS,
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
  loadArcgisModules,
  toTrimmedString,
  isFileObject,
  isFiniteNumber,
  isWgs84Sr,
  isWebMercatorSr,
  isGeographicSpatialRef,
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

// Kontrollerar om nummer är valid HTTP status code (100-599)
const isHttpStatus = (n: unknown): n is number =>
  typeof n === "number" && n >= 100 && n <= 599

// Kontrollerar om värde är Promise-like (har then-metod)
const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof (value as { then?: unknown }).then === "function"

// Kontrollerar om värde är polygon-geometri via type property
const isPolygonGeometryLike = (value: unknown): value is __esri.Polygon =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "polygon"

// Kontrollerar om pathname innehåller förbjuden FME REST path
const hasForbiddenPath = (pathname: string): boolean =>
  pathname.toLowerCase().includes(FME_REST_PATH)

// Normaliserar bas-URL genom att ta bort fmerest och credentials
export const normalizeBaseUrl = (rawUrl: string): string => {
  const u = safeParseUrl(rawUrl || "")
  if (!u) return ""

  let path = u.pathname || "/"
  const idxRest = path.toLowerCase().indexOf(FME_REST_PATH)
  if (idxRest >= 0) path = path.substring(0, idxRest) || "/"

  u.search = ""
  u.hash = ""
  u.username = ""
  u.password = ""
  u.pathname = path

  const cleanPath = path === "/" ? "" : path.replace(/\/$/, "")
  return `${u.origin}${cleanPath}`
}

// Validerar server-URL med olika strictness-nivåer och options
export function validateServerUrl(
  url: string,
  opts?: {
    strict?: boolean
    requireHttps?: boolean
    disallowRestForWebhook?: boolean
  }
): UrlValidation {
  const trimmed = (url || "").trim()
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

    if (
      opts?.disallowRestForWebhook &&
      /\/fmerest(?:\/|$)/i.test(parsed.pathname)
    ) {
      return { ok: false, reason: "disallow_fmerest_for_webhook" }
    }

    if (hasForbiddenPath(parsed.pathname)) {
      return { ok: false, reason: "invalid_url" }
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
  const trimmed = (email ?? "").trim()

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

  if (!status || status < 100) return true
  if (status >= 500) return true
  return status === 408 || status === 429
}

// Mappar HTTP status code till översättningsnyckel
const statusToKey = (s?: number): string | undefined => {
  if (typeof s !== "number") return undefined
  if (STATUS_TO_KEY_MAP[s]) return STATUS_TO_KEY_MAP[s]
  if (s >= 500) return "errorServerIssue"
  return undefined
}

// Matchar felmeddelande mot pattern-lista och returnerar key
const matchMessagePattern = (message: string): string | undefined => {
  const lowerMessage = message.toLowerCase()
  for (const { pattern, key } of MESSAGE_PATTERNS) {
    if (pattern.test(lowerMessage)) return key
  }
  return undefined
}

// Helper to extract and classify error information
const classifyError = (err: unknown, status?: number) => {
  const resolvedStatus = status ?? extractHttpStatus(err)

  let errorCode: string | undefined
  let message: string | undefined

  if (err && typeof err === "object") {
    errorCode = (err as any).code
    message = (err as Error)?.message
  }

  return {
    status: resolvedStatus,
    code: typeof errorCode === "string" ? errorCode : undefined,
    message: typeof message === "string" ? message : undefined,
    isRequestFailed: errorCode === "REQUEST_FAILED",
  }
}

// Mappar error till översättningsnyckel via status/code/message
export const mapErrorToKey = (err: unknown, status?: number): string => {
  const classification = classifyError(err, status)

  // Priority 1: Request-failed should use status
  if (classification.isRequestFailed) {
    return statusToKey(classification.status) || "errorServerIssue"
  }

  // Priority 2: Known error codes
  if (classification.code && ERROR_CODE_TO_KEY[classification.code]) {
    return ERROR_CODE_TO_KEY[classification.code]
  }

  // Priority 3: HTTP status codes
  const statusKey = statusToKey(classification.status)
  if (statusKey) return statusKey

  // Priority 4: Message pattern matching
  if (classification.message) {
    const messageKey = matchMessagePattern(classification.message)
    if (messageKey) return messageKey
  }

  return "errorUnknown"
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

// Validerar resultat från schemaläggnings-API
export const createRuntimeError = (
  message: string,
  options: {
    type?: ErrorType
    code?: string
    severity?: ErrorSeverity
    recoverable?: boolean
    userFriendlyMessage?: string
    suggestion?: string
    retry?: () => void
  } = {}
): ErrorState => ({
  message,
  type: options.type ?? ErrorType.NETWORK,
  code: options.code ?? "UNKNOWN",
  severity: options.severity ?? ErrorSeverity.ERROR,
  recoverable: options.recoverable ?? true,
  timestamp: new Date(),
  timestampMs: Date.now(),
  userFriendlyMessage: options.userFriendlyMessage ?? "",
  suggestion: options.suggestion ?? "",
  retry: options.retry,
  kind: "runtime",
})

// Översätter messageKey via translate-funktionen och skapar ErrorState
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
): ErrorState =>
  createRuntimeError(translate(messageKey) || messageKey, {
    type,
    code,
    ...options,
    suggestion:
      options?.suggestion || translate("connectionSettingsHint") || "",
  })

// Skapar geometry error med valid=false och ErrorState objekt
const makeGeometryError = (
  messageKey: string,
  code: string
): { valid: false; error: ErrorState } => ({
  valid: false,
  error: createRuntimeError(messageKey, {
    type: ErrorType.GEOMETRY,
    code,
  }),
})

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

// Beräknar area med geodesic/planar via GeometryEngine
const tryCalcArea = async (
  engine: GeometryEngineLike | undefined,
  polygon: __esri.Polygon,
  isGeographic: boolean
): Promise<number> => {
  if (!engine) return 0

  const geodesicAreaFn = engine.geodesicArea
  if (isGeographic && typeof geodesicAreaFn === "function") {
    const area = await geodesicAreaFn(polygon, "square-meters")
    if (Number.isFinite(area) && area > 0) return area
  }

  const planarAreaFn = engine.planarArea
  if (typeof planarAreaFn === "function") {
    const area = await planarAreaFn(polygon, "square-meters")
    if (Number.isFinite(area) && area > 0) return area
  }

  return 0
}

// Packar upp module-objekt till .default eller själva modulen
const unwrapModule = (module: unknown): unknown =>
  (module as { default?: unknown }).default ?? module

let normalizeUtilsCache: NormalizeUtilsModule | null | undefined
let geometryServiceCache: GeometryServiceModule | null | undefined
let areasAndLengthsParamsCache: AreasAndLengthsParametersCtor | null | undefined
let esriConfigCache: EsriConfigLike | null | undefined

// Laddar & cachar normalizeUtils modul om ej tillgänglig i modules
const ensureNormalizeUtils = async (
  modules: ArcgisGeometryModules
): Promise<NormalizeUtilsModule | null> => {
  if (modules?.normalizeUtils?.normalizeCentralMeridian) {
    return modules.normalizeUtils
  }

  if (normalizeUtilsCache !== undefined) return normalizeUtilsCache

  try {
    const [normalizeUtilsMod] = await loadArcgisModules([
      "esri/geometry/support/normalizeUtils",
    ])
    normalizeUtilsCache = unwrapModule(
      normalizeUtilsMod
    ) as NormalizeUtilsModule
  } catch {
    normalizeUtilsCache = null
  }

  return normalizeUtilsCache
}

// Laddar & cachar esriConfig modul om ej tillgänglig i modules
const ensureEsriConfig = async (
  modules: ArcgisGeometryModules
): Promise<EsriConfigLike | null> => {
  if (modules?.esriConfig) return modules.esriConfig
  if (esriConfigCache !== undefined) return esriConfigCache

  try {
    const [configMod] = await loadArcgisModules(["esri/config"])
    esriConfigCache = unwrapModule(configMod) as EsriConfigLike
  } catch {
    esriConfigCache = null
  }

  return esriConfigCache
}

// Laddar geometryService & AreasAndLengthsParameters moduler
const ensureGeometryServiceModules = async (): Promise<{
  geometryService: GeometryServiceModule | null
  AreasAndLengthsParameters: AreasAndLengthsParametersCtor | null
}> => {
  if (
    geometryServiceCache !== undefined &&
    areasAndLengthsParamsCache !== undefined
  ) {
    return {
      geometryService: geometryServiceCache,
      AreasAndLengthsParameters: areasAndLengthsParamsCache,
    }
  }

  try {
    const [geometryServiceMod, paramsMod] = await loadArcgisModules([
      "esri/rest/geometryService",
      "esri/rest/support/AreasAndLengthsParameters",
    ])
    geometryServiceCache = unwrapModule(
      geometryServiceMod
    ) as GeometryServiceModule
    areasAndLengthsParamsCache = unwrapModule(
      paramsMod
    ) as AreasAndLengthsParametersCtor
  } catch {
    geometryServiceCache = null
    areasAndLengthsParamsCache = null
  }

  return {
    geometryService: geometryServiceCache,
    AreasAndLengthsParameters: areasAndLengthsParamsCache,
  }
}

// Hämtar geometryServiceUrl från esriConfig eller portalSelf
const resolveGeometryServiceUrl = async (
  modules: ArcgisGeometryModules
): Promise<string | null> => {
  try {
    const directUrl = modules?.esriConfig?.geometryServiceUrl
    if (typeof directUrl === "string" && directUrl) return directUrl

    const config = await ensureEsriConfig(modules)
    if (!config) return null

    const directConfigUrl = config.geometryServiceUrl
    if (typeof directConfigUrl === "string" && directConfigUrl) {
      return directConfigUrl
    }

    const requestUrl = config.request?.geometryServiceUrl
    if (typeof requestUrl === "string" && requestUrl) return requestUrl

    const helperUrl =
      config.portalSelf?.helperServices?.geometry?.url ||
      config.portalInfo?.helperServices?.geometry?.url ||
      config.helperServices?.geometry?.url

    if (typeof helperUrl === "string" && helperUrl) return helperUrl
  } catch {}

  return null
}

// Wrapprar polygon-värden (kan vara Promise eller synkront)
const maybeResolvePolygon = async (
  value: PolygonMaybe
): Promise<__esri.Polygon | null> => {
  if (!value) return null
  try {
    const resolved = isPromiseLike(value) ? await value : value
    if (isPolygonGeometryLike(resolved)) {
      return resolved
    }
  } catch {}
  return null
}

// Försöker densify med geodesicDensify eller planar densify
const attemptDensify = async (
  engine: GeometryEngineLike | undefined,
  method: "geodesicDensify" | "densify",
  geometry: __esri.Polygon,
  args: readonly unknown[]
): Promise<__esri.Polygon | null> => {
  const densify = engine?.[method]
  if (typeof densify !== "function") return null
  try {
    const result = densify(geometry, ...(args as [number, string?]))
    return await maybeResolvePolygon(result)
  } catch {
    return null
  }
}

// Normaliserar polygon över central meridian (WGS84/Web Mercator)
const normalizePolygon = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<__esri.Polygon> => {
  const sr = polygon?.spatialReference
  const shouldNormalize = isWgs84Sr(sr) || isWebMercatorSr(sr)
  if (!shouldNormalize) return polygon

  const normalizeUtils = await ensureNormalizeUtils(modules)
  if (!normalizeUtils?.normalizeCentralMeridian) return polygon

  try {
    const results = await normalizeUtils.normalizeCentralMeridian([polygon])
    const normalized = Array.isArray(results) ? results[0] : null
    if (isPolygonGeometryLike(normalized)) {
      return normalized
    }
  } catch {}

  return polygon
}

// Applicerar geodesic eller planar densify beroende på SR
const applyDensify = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<__esri.Polygon> => {
  const sr = polygon?.spatialReference
  const canUseGeodesic = isWgs84Sr(sr) || isWebMercatorSr(sr)
  const isGeographic = isWgs84Sr(sr)

  let working = polygon

  if (canUseGeodesic) {
    const geodesicArgs: readonly unknown[] = [
      GEODESIC_SEGMENT_LENGTH_METERS,
      "meters",
    ]
    const geodesicResult =
      (await attemptDensify(
        modules?.geometryEngineAsync,
        "geodesicDensify",
        working,
        geodesicArgs
      )) ??
      (await attemptDensify(
        modules?.geometryEngine,
        "geodesicDensify",
        working,
        geodesicArgs
      ))

    if (geodesicResult) {
      working = geodesicResult
    }
  }

  const planarSegment = isGeographic
    ? Math.max(
        GEODESIC_SEGMENT_LENGTH_METERS * DEGREES_PER_METER,
        MIN_PLANAR_SEGMENT_DEGREES
      )
    : GEODESIC_SEGMENT_LENGTH_METERS

  const planarArgs: readonly unknown[] = [planarSegment]
  const planarResult =
    (await attemptDensify(
      modules?.geometryEngineAsync,
      "densify",
      working,
      planarArgs
    )) ??
    (await attemptDensify(
      modules?.geometryEngine,
      "densify",
      working,
      planarArgs
    ))

  if (planarResult) {
    working = planarResult
  }

  return working
}

// Förbereder polygon: normalisering + densify för area-beräkning
const preparePolygonForArea = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<__esri.Polygon> => {
  let working = polygon
  working = await normalizePolygon(working, modules)
  working = await applyDensify(working, modules)
  return working
}

// Beräknar area via remote geometry service (error recovery strategy)
const calcAreaViaGeometryService = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<number> => {
  const serviceUrl = await resolveGeometryServiceUrl(modules)
  if (!serviceUrl) return 0

  const { geometryService, AreasAndLengthsParameters } =
    await ensureGeometryServiceModules()

  if (
    !geometryService?.areasAndLengths ||
    typeof geometryService.areasAndLengths !== "function" ||
    !AreasAndLengthsParameters
  ) {
    return 0
  }

  try {
    const paramOptions: __esri.AreasAndLengthsParametersProperties & {
      geodesic?: boolean
    } = {
      polygons: [polygon],
      areaUnit: "square-meters",
      lengthUnit: "meters",
      calculationType: "geodesic",
      geodesic: true,
    }
    const params = new AreasAndLengthsParameters(paramOptions)

    const response = await geometryService.areasAndLengths(serviceUrl, params)
    const area = response?.areas?.[0]
    if (Number.isFinite(area) && Math.abs(area) > 0) {
      return Math.abs(area)
    }
  } catch {}

  return 0
}

// Tvingar area operator till function eller null
const coerceAreaOperator = (
  candidate: unknown
):
  | ((geometry: __esri.Geometry, unit?: string) => number | Promise<number>)
  | null => {
  return typeof candidate === "function" ? (candidate as any) : null
}

// Väljer geodesic/planar operator från operators record
const pickGeometryOperator = (
  operators: unknown,
  geographic: boolean
):
  | ((geometry: __esri.Geometry, unit?: string) => number | Promise<number>)
  | null => {
  if (!operators) return null
  if (typeof operators === "function") {
    return operators as any
  }

  if (typeof operators !== "object") {
    return null
  }

  const record = operators as { [key: string]: unknown }
  const lookupOrder = geographic
    ? ["geodesicArea", "geodesic", "planarArea", "planar"]
    : ["planarArea", "planar", "geodesicArea", "geodesic"]

  for (const key of lookupOrder) {
    const fn = coerceAreaOperator(record[key])
    if (fn) return fn
  }

  if (record.area) {
    return pickGeometryOperator(record.area, geographic)
  }

  return null
}

// Skapar lista med area-strategier för resilient beräkning
const createAreaStrategies = (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules,
  geographic: boolean
): AreaStrategy[] => {
  const strategies: AreaStrategy[] = []

  const operatorFn = pickGeometryOperator(
    modules?.geometryOperators,
    geographic
  )
  if (operatorFn) {
    strategies.push(async () => {
      try {
        const args =
          operatorFn.length >= 2 ? [polygon, "square-meters"] : [polygon]
        const callable = operatorFn as (...fnArgs: any[]) => unknown
        const result = callable(...args)
        const area = isPromiseLike(result) ? await result : result
        if (typeof area === "number" && Math.abs(area) > 0) {
          return Math.abs(area)
        }
      } catch {}
      return 0
    })
  }

  if (modules?.geometryEngineAsync) {
    strategies.push(() =>
      tryCalcArea(modules.geometryEngineAsync, polygon, geographic)
    )
  }

  if (modules?.geometryEngine) {
    strategies.push(() =>
      tryCalcArea(modules.geometryEngine, polygon, geographic)
    )
  }

  return strategies
}

// Beräknar area via strategy chain: operators → engine → service
export const calcArea = async (
  geometry: __esri.Geometry | undefined,
  modules: ArcgisGeometryModules
): Promise<number> => {
  if (!geometry || geometry.type !== "polygon") return 0

  const polygon = geometry as __esri.Polygon
  let prepared = polygon

  try {
    prepared = await preparePolygonForArea(polygon, modules)
  } catch {
    prepared = polygon
  }

  const geographic = isGeographicSpatialRef(prepared)

  const strategies = createAreaStrategies(prepared, modules, geographic)
  for (const runStrategy of strategies) {
    try {
      const area = await runStrategy()
      if (area > 0) return area
    } catch {}
  }

  const geometryServiceArea = await calcAreaViaGeometryService(
    prepared,
    modules
  )
  if (geometryServiceArea > 0) return geometryServiceArea

  return 0
}

// Simplifierar polygon och validerar att den är simple
const simplifyPolygon = async (
  poly: __esri.Polygon,
  engine: GeometryEngineLike | undefined,
  engineAsync: GeometryEngineLike | undefined
): Promise<__esri.Polygon | null> => {
  const simplifyAsync = engineAsync?.simplify
  if (typeof simplifyAsync === "function") {
    const asyncResult = await simplifyAsync(poly)
    const simplified = await maybeResolvePolygon(asyncResult)
    if (!simplified) return null

    const checkSimple = engineAsync?.isSimple ?? engine?.isSimple
    if (typeof checkSimple === "function") {
      const simpleResult = checkSimple(simplified)
      const isSimple = isPromiseLike(simpleResult)
        ? await simpleResult
        : simpleResult
      if (!isSimple) return null
    }

    return simplified
  }

  const simplifySync = engine?.simplify
  if (typeof simplifySync === "function") {
    const simplified = await maybeResolvePolygon(simplifySync(poly))
    if (!simplified) return null
    const isSimpleFn = engine?.isSimple
    if (typeof isSimpleFn === "function") {
      const simpleResult = isSimpleFn(simplified)
      const isSimple = isPromiseLike(simpleResult)
        ? await simpleResult
        : simpleResult
      if (!isSimple) return null
    }
    return simplified
  }

  const isSimpleFn = engine?.isSimple
  if (typeof isSimpleFn === "function") {
    const simpleResult = isSimpleFn(poly)
    const isSimple = isPromiseLike(simpleResult)
      ? await simpleResult
      : simpleResult
    if (!isSimple) return null
  }

  return poly
}

// Kontrollerar att ring är stängd (första=sista punkt)
const isRingClosed = (ring: unknown[]): boolean => {
  if (!Array.isArray(ring) || ring.length === 0) return false
  const first = ring[0] as number[] | undefined
  const last = ring[ring.length - 1] as number[] | undefined
  return Boolean(
    first &&
      last &&
      Array.isArray(first) &&
      Array.isArray(last) &&
      first[0] === last[0] &&
      first[1] === last[1]
  )
}

// Validerar att alla rings har >=4 punkter och är stängda
const validateRingStructure = (rings: unknown[]): boolean => {
  if (!Array.isArray(rings) || rings.length === 0) return false

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return false
    if (!isRingClosed(ring)) return false
  }

  return true
}

// Validerar att alla holes är innanför första ringen (outer)
const validateHolesWithinOuter = (
  rings: unknown[],
  poly: __esri.Polygon,
  engine: GeometryEngineLike | undefined,
  modules: ArcgisGeometryModules
): boolean => {
  if (rings.length <= 1) return true
  const contains = engine?.contains
  if (typeof contains !== "function") return true

  try {
    const PolygonCtor = modules?.Polygon
    if (!PolygonCtor) return true

    const outer = PolygonCtor.fromJSON({
      rings: [rings[0]],
      spatialReference: poly.spatialReference,
    })

    for (let i = 1; i < rings.length; i++) {
      const hole = PolygonCtor.fromJSON({
        rings: [rings[i]],
        spatialReference: poly.spatialReference,
      })
      if (!contains(outer, hole)) return false
    }
  } catch {
    return true
  }

  return true
}

// Validerar polygon: simplify, ring structure, area, holes
export const validatePolygon = async (
  geometry: __esri.Geometry | undefined,
  modules: ArcgisGeometryModules
): Promise<{
  valid: boolean
  error?: ErrorState
  simplified?: __esri.Polygon
}> => {
  if (!geometry) {
    return makeGeometryError("geometryMissingMessage", "NO_GEOMETRY")
  }

  if (geometry.type !== "polygon") {
    return makeGeometryError("geometryPolygonRequired", "INVALID_GEOMETRY_TYPE")
  }

  if (!modules?.geometryEngine && !modules?.geometryEngineAsync) {
    return { valid: true }
  }

  try {
    const engine = modules.geometryEngine
    const engineAsync = modules.geometryEngineAsync
    let poly = geometry as __esri.Polygon

    const simplified = await simplifyPolygon(poly, engine, engineAsync)
    if (!simplified) {
      return makeGeometryError("geometryNotSimple", "INVALID_GEOMETRY")
    }
    poly = simplified

    const rawRings = (poly as { rings?: unknown }).rings
    const rings = Array.isArray(rawRings) ? rawRings : []
    if (!validateRingStructure(rings)) {
      return makeGeometryError("geometryInvalidCode", "GEOMETRY_INVALID")
    }

    const area = await calcArea(poly, modules)
    if (!area || area <= 0) {
      return makeGeometryError("geometryInvalidCode", "GEOMETRY_INVALID")
    }

    if (!validateHolesWithinOuter(rings, poly, engine, modules)) {
      return makeGeometryError("geometryInvalidCode", "GEOMETRY_INVALID")
    }

    return { valid: true, simplified: poly }
  } catch {
    return makeGeometryError(
      "geometryValidationFailedMessage",
      "GEOMETRY_VALIDATION_ERROR"
    )
  }
}

// Konverterar area limit till number eller undefined
const resolveAreaLimit = (limit?: number): number | undefined => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return undefined
  if (limit <= 0) return undefined
  return limit
}

// Utvärderar area mot max/warning thresholds
export const evaluateArea = (
  area: number,
  limits?: { maxArea?: number; largeArea?: number }
): AreaEvaluation => {
  const normalized = Math.abs(area) || 0
  const maxThreshold = resolveAreaLimit(limits?.maxArea)
  const warningThreshold = resolveAreaLimit(limits?.largeArea)
  const exceedsMaximum =
    typeof maxThreshold === "number" ? normalized > maxThreshold : false
  const shouldWarn =
    !exceedsMaximum &&
    typeof warningThreshold === "number" &&
    normalized > warningThreshold

  return {
    area: normalized,
    maxThreshold,
    warningThreshold,
    exceedsMaximum,
    shouldWarn,
  }
}

// Validerar om area överskrider max area
export const checkMaxArea = (
  area: number,
  maxArea?: number
): { ok: boolean; message?: string; code?: string } => {
  const resolved = resolveAreaLimit(maxArea)
  if (!resolved || area <= resolved) {
    return { ok: true }
  }

  return {
    ok: false,
    message: "geometryAreaTooLargeCode",
    code: "AREA_TOO_LARGE",
  }
}

// Kontrollerar om area ska trigga warning (large area)
export const checkLargeArea = (area: number, largeArea?: number): boolean =>
  evaluateArea(area, { largeArea }).shouldWarn

// Återställer validation-cachar för test-syfte
export const resetValidationCachesForTest = () => {
  normalizeUtilsCache = undefined
  geometryServiceCache = undefined
  areasAndLengthsParamsCache = undefined
  esriConfigCache = undefined
}

// Factory för att skapa FME response objekt
const createFmeResponse = {
  blob: (blob: Blob, workspace: string, userEmail: string) => ({
    success: true,
    blob,
    email: userEmail,
    workspaceName: workspace,
    downloadFilename: `${workspace}_export.zip`,
    blobMetadata: {
      type: toTrimmedString(blob.type),
      size:
        typeof blob.size === "number" && Number.isFinite(blob.size)
          ? blob.size
          : undefined,
    },
  }),

  success: (
    serviceInfo: NormalizedServiceInfo,
    workspace: string,
    userEmail: string
  ) => ({
    success: true,
    jobId:
      typeof serviceInfo.jobId === "number" ? serviceInfo.jobId : undefined,
    email: userEmail,
    workspaceName: workspace,
    downloadUrl: serviceInfo.url,
    downloadFilename: serviceInfo.url ? `${workspace}_export.zip` : undefined,
    status: serviceInfo.status,
    statusMessage: serviceInfo.message,
  }),

  failure: (
    message: string,
    serviceInfo?: NormalizedServiceInfo,
    code = "FME_JOB_FAILURE"
  ) => ({
    success: false,
    message,
    code,
    ...(typeof serviceInfo?.jobId === "number" && {
      jobId: serviceInfo.jobId,
    }),
    ...(serviceInfo?.status && { status: serviceInfo.status }),
    ...(serviceInfo?.message && { statusMessage: serviceInfo.message }),
  }),
}

// Validerar att url är en giltig http/https URL
const isValidDownloadUrl = (url: unknown): boolean =>
  typeof url === "string" && /^https?:\/\//.test(url)

// Processerar FME response och returnerar ExportResult
export const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translateFn: TranslateFn
): ExportResult => {
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
    return createFmeResponse.blob(data.blob, workspace, userEmail)
  }

  const serviceInfo = normalizeFmeServiceInfo(response as FmeResponse)
  const normalizedStatus = (serviceInfo.status || "")
    .toString()
    .trim()
    .toUpperCase()

  if (normalizedStatus === "CANCELLED" || normalizedStatus === "CANCELED") {
    const statusMessage = serviceInfo.message || ""
    const normalizedMessage = statusMessage.toLowerCase()
    const timeoutIndicators = [
      "timeout",
      "time limit",
      "time-limit",
      "max execution",
      "maximum execution",
      "max runtime",
      "maximum runtime",
      "max run time",
    ]
    const isTimeout = timeoutIndicators.some((indicator) =>
      normalizedMessage.includes(indicator)
    )
    const translationKey = isTimeout ? "jobCancelledTimeout" : "jobCancelled"
    return {
      success: false,
      cancelled: true,
      message: translateFn(translationKey),
      code: isTimeout ? "FME_JOB_CANCELLED_TIMEOUT" : "FME_JOB_CANCELLED",
      status: serviceInfo.status,
      statusMessage,
      jobId:
        typeof serviceInfo.jobId === "number" ? serviceInfo.jobId : undefined,
    }
  }

  const failureStatuses = new Set([
    "FAILURE",
    "FAILED",
    "JOB_FAILURE",
    "FME_FAILURE",
  ])

  if (failureStatuses.has(normalizedStatus)) {
    const failureMessage =
      toTrimmedString(serviceInfo.message) || translateFn("jobFailed")
    return createFmeResponse.failure(
      failureMessage,
      serviceInfo,
      "FME_JOB_FAILURE"
    )
  }

  const hasValidResult =
    normalizedStatus === "SUCCESS" ||
    isValidDownloadUrl(serviceInfo.url) ||
    (typeof serviceInfo.jobId === "number" && serviceInfo.jobId > 0)

  if (hasValidResult) {
    return createFmeResponse.success(serviceInfo, workspace, userEmail)
  }

  return createFmeResponse.failure(
    serviceInfo.message || translateFn("errorJobSubmission"),
    serviceInfo
  )
}

// Normaliserar FME service response till NormalizedServiceInfo
export const normalizeFmeServiceInfo = (resp: any): NormalizedServiceInfo => {
  const r: any = resp || {}
  const raw = r?.data?.serviceResponse || r?.data || r
  const status = raw?.statusInfo?.status || raw?.status
  const message = raw?.statusInfo?.message || raw?.message
  const jobId = typeof raw?.jobID === "number" ? raw.jobID : raw?.id
  const url = raw?.url
  return { status, message, jobId, url }
}

/* Re-exports från utils */
export {
  // allmänna utils
  isJson,
  safeParseUrl,
  extractErrorMessage,
  extractHostFromUrl,
  // fil-utils
  isFileObject,
  getFileDisplayName,
  // nummer/strängar
  parseNonNegativeInt,
  pad2,
  // datum-tid och färgkonverteringar
  fmeDateTimeToInput,
  inputToFmeDateTime,
  fmeDateToInput,
  inputToFmeDate,
  fmeTimeToInput,
  inputToFmeTime,
  normalizedRgbToHex,
  hexToNormalizedRgb,
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
