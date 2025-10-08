import {
  ErrorSeverity,
  ErrorType,
  type ErrorState,
  type FmeExportConfig,
  type StartupValidationResult,
  type TranslateFn,
  type FmeResponse,
  type NormalizedServiceInfo,
  type MutableParams,
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
  MIN_TOKEN_LENGTH,
  FME_REST_PATH,
  WKID,
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
} from "../config/index"
import {
  extractErrorMessage,
  maskToken,
  safeParseUrl,
  loadArcgisModules,
  toTrimmedString,
  isValidExternalUrlForOptGetUrl,
} from "./utils"

const parseAsNumber = (value: unknown): number | null => {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const num = Number(value.trim())
    return Number.isFinite(num) ? num : null
  }
  return null
}

export const isInt = (value: unknown): boolean => {
  const num = parseAsNumber(value)
  return num !== null && Number.isInteger(num)
}

export const isNum = (value: unknown): boolean => {
  const num = parseAsNumber(value)
  return num !== null
}

// Type guards
const isHttpStatus = (n: unknown): n is number =>
  typeof n === "number" && n >= 100 && n <= 599

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof (value as { then?: unknown }).then === "function"

const isPolygonGeometryLike = (value: unknown): value is __esri.Polygon =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "polygon"

const hasForbiddenPath = (pathname: string): boolean =>
  pathname.toLowerCase().includes(FME_REST_PATH)

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

export const mapServerUrlReasonToKey = (reason?: string): string => {
  if (!reason) return "invalid_url"
  return SERVER_URL_REASON_TO_KEY[reason] || "invalid_url"
}

const hasControlCharacters = (token: string): boolean => {
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

const hasDangerousCharacters = (token: string): boolean =>
  /\s/.test(token) || /[<>"'`]/.test(token) || hasControlCharacters(token)

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

const statusToKey = (s?: number): string | undefined => {
  if (typeof s !== "number") return undefined
  if (STATUS_TO_KEY_MAP[s]) return STATUS_TO_KEY_MAP[s]
  if (s >= 500) return "errorServerIssue"
  return undefined
}

const matchMessagePattern = (message: string): string | undefined => {
  const lowerMessage = message.toLowerCase()
  for (const { pattern, key } of MESSAGE_PATTERNS) {
    if (pattern.test(lowerMessage)) return key
  }
  return undefined
}

export const mapErrorToKey = (err: unknown, status?: number): string => {
  if (status == null) {
    status = extractHttpStatus(err)
  }

  if (err && typeof err === "object") {
    const code = (err as any).code
    if (typeof code === "string") {
      if (code === "REQUEST_FAILED") {
        return statusToKey(status) || "errorServerIssue"
      }
      const mapped = ERROR_CODE_TO_KEY[code]
      if (mapped) return mapped
    }
  }

  const byStatus = statusToKey(status)
  if (byStatus) return byStatus

  const message = (err as Error)?.message
  if (typeof message === "string") {
    const matched = matchMessagePattern(message)
    if (matched) return matched
  }

  return "errorUnknown"
}

export const resolveUploadTargetParam = (
  config: FmeExportConfig | null | undefined
): string | null => toTrimmedString(config?.uploadTargetParamName) ?? null

export const sanitizeOptGetUrlParam = (
  params: MutableParams,
  config: FmeExportConfig | null | undefined
): void => {
  const value = params.opt_geturl

  if (typeof value !== "string") {
    delete params.opt_geturl
    return
  }

  const trimmed = value.trim()
  const urlIsAllowed = Boolean(config?.allowRemoteUrlDataset)
  const urlIsValid = isValidExternalUrlForOptGetUrl(trimmed)

  if (!trimmed || !urlIsAllowed || !urlIsValid) {
    delete params.opt_geturl
    return
  }

  params.opt_geturl = trimmed
}

export { isValidExternalUrlForOptGetUrl } from "./utils"

export const validateRequiredConfig = (config: {
  readonly serverUrl?: string
  readonly token?: string
  readonly repository?: string
}): void => {
  if (!config.serverUrl || !config.token || !config.repository) {
    throw new Error("Missing required configuration")
  }
}

const getMissingConfigFields = (
  config: FmeExportConfig | undefined
): string[] => {
  if (!config) return [...REQUIRED_CONFIG_FIELDS]

  return REQUIRED_CONFIG_FIELDS.filter((field) => !config[field]?.trim())
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

export const isAuthError = (status: number): boolean => {
  return (
    status === HTTP_STATUS_CODES.UNAUTHORIZED ||
    status === HTTP_STATUS_CODES.FORBIDDEN
  )
}

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

  const serverValidation = validateServerUrl(url)
  if (!serverValidation.ok) {
    const reason = (serverValidation as { reason?: string }).reason
    errors.serverUrl = mapServerUrlReasonToKey(reason)
  }

  const t = validateToken(token)
  if (!t.ok) errors.token = t.key || "errorTokenIssue"

  const repoCheck = validateRepository(
    repository || "",
    availableRepos === undefined ? [] : availableRepos
  )
  if (!repoCheck.ok) errors.repository = repoCheck.key || "invalidRepository"

  return { ok: Object.keys(errors).length === 0, errors }
}

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

export function validateScheduleFields(data: any) {
  if (!data || data.opt_servicemode !== "schedule") return { ok: true as const }

  const isRunOnce = data.trigger === "runonce"
  const hasCat = typeof data.category === "string" && !!data.category.trim()
  const hasName = typeof data.name === "string" && !!data.name.trim()
  const startStr = String(data.start || "")
  const fmtOk = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(startStr)

  let notTooPast = false
  if (fmtOk) {
    const [datePart, timePart] = startStr.split(" ")
    const [Y, M, D] = datePart.split("-").map(Number)
    const [h, m, s] = timePart.split(":").map(Number)
    const start = new Date(Y, (M || 1) - 1, D || 1, h || 0, m || 0, s || 0)
    notTooPast = start.getTime() >= Date.now() - 60_000
  }

  const ok = isRunOnce && hasCat && hasName && fmtOk && notTooPast
  return ok
    ? { ok: true as const }
    : { ok: false as const, key: "scheduleInvalid" }
}

// Error Factory
const createErrorState = (
  message: string,
  type: ErrorType,
  code: string,
  options?: {
    userFriendlyMessage?: string
    suggestion?: string
    retry?: () => void
  }
): ErrorState => ({
  message,
  type,
  code,
  severity: ErrorSeverity.ERROR,
  recoverable: true,
  timestamp: new Date(),
  timestampMs: Date.now(),
  userFriendlyMessage: options?.userFriendlyMessage || "",
  suggestion: options?.suggestion || "",
  retry: options?.retry,
  kind: "runtime",
})

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
  createErrorState(translate(messageKey) || messageKey, type, code, {
    ...options,
    suggestion:
      options?.suggestion || translate("connectionSettingsHint") || "",
  })

const makeGeometryError = (
  messageKey: string,
  code: string
): { valid: false; error: ErrorState } => ({
  valid: false,
  error: createErrorState(messageKey, ErrorType.GEOMETRY, code),
})

export const validateDateTimeFormat = (dateTimeString: string): boolean => {
  const trimmed = dateTimeString.trim()
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
  return dateTimeRegex.test(trimmed)
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

const readWkids = (sr: unknown): { wkid?: number; latestWkid?: number } => {
  if (typeof sr !== "object" || sr === null) {
    return {}
  }

  const ref = sr as { wkid?: unknown; latestWkid?: unknown }
  const wkid = typeof ref.wkid === "number" ? ref.wkid : undefined
  const latestWkid =
    typeof ref.latestWkid === "number" ? ref.latestWkid : undefined

  return { wkid, latestWkid }
}

const isWebMercatorSr = (sr: unknown): boolean => {
  const ref = sr as { isWebMercator?: boolean } | undefined
  if (ref?.isWebMercator) return true
  const { wkid, latestWkid } = readWkids(sr)
  return wkid === WKID.WEB_MERCATOR || latestWkid === WKID.WEB_MERCATOR
}

const isWgs84Sr = (sr: unknown): boolean => {
  const ref = sr as { isGeographic?: boolean; isWGS84?: boolean } | undefined
  if (ref?.isGeographic || ref?.isWGS84) return true
  const { wkid, latestWkid } = readWkids(sr)
  return wkid === WKID.WGS84 || latestWkid === WKID.WGS84
}

const isGeographicSpatialRef = (polygon: __esri.Polygon): boolean => {
  try {
    if (
      isWgs84Sr(polygon.spatialReference) ||
      isWebMercatorSr(polygon.spatialReference)
    ) {
      return true
    }

    const json = polygon.toJSON?.()
    if (json && typeof json === "object") {
      const spatialRef = (json as { spatialReference?: unknown })
        .spatialReference
      return isWgs84Sr(spatialRef) || isWebMercatorSr(spatialRef)
    }
  } catch {}

  return false
}

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

const unwrapModule = (module: unknown): unknown =>
  (module as { default?: unknown }).default ?? module

let normalizeUtilsCache: NormalizeUtilsModule | null | undefined
let geometryServiceCache: GeometryServiceModule | null | undefined
let areasAndLengthsParamsCache: AreasAndLengthsParametersCtor | null | undefined
let esriConfigCache: EsriConfigLike | null | undefined

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

const preparePolygonForArea = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<__esri.Polygon> => {
  let working = polygon
  working = await normalizePolygon(working, modules)
  working = await applyDensify(working, modules)
  return working
}

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

const coerceAreaOperator = (
  candidate: unknown
):
  | ((geometry: __esri.Geometry, unit?: string) => number | Promise<number>)
  | null => {
  return typeof candidate === "function" ? (candidate as any) : null
}

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

const validateRingStructure = (rings: unknown[]): boolean => {
  if (!Array.isArray(rings) || rings.length === 0) return false

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return false
    if (!isRingClosed(ring)) return false
  }

  return true
}

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

const resolveAreaLimit = (limit?: number): number | undefined => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return undefined
  if (limit <= 0) return undefined
  return limit
}

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

export const checkLargeArea = (area: number, largeArea?: number): boolean =>
  evaluateArea(area, { largeArea }).shouldWarn

export const resetValidationCachesForTest = () => {
  normalizeUtilsCache = undefined
  geometryServiceCache = undefined
  areasAndLengthsParamsCache = undefined
  esriConfigCache = undefined
}

// FME Response Factory
const createFmeResponse = {
  blob: (blob: Blob, workspace: string, userEmail: string) => ({
    success: true,
    blob,
    email: userEmail,
    workspaceName: workspace,
    downloadFilename: `${workspace}_export.zip`,
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
  }),

  failure: (message: string) => ({
    success: false,
    message,
    code: "FME_JOB_FAILURE",
  }),
}

const isValidDownloadUrl = (url: unknown): boolean =>
  typeof url === "string" && /^https?:\/\//.test(url)

// FME response processing
export const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translateFn: TranslateFn
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
    return createFmeResponse.blob(data.blob, workspace, userEmail)
  }

  const serviceInfo = normalizeFmeServiceInfo(response as FmeResponse)

  // Scheduled jobs return a jobId but no download URL (job runs later)
  const hasValidResult =
    serviceInfo.status === "success" ||
    isValidDownloadUrl(serviceInfo.url) ||
    (typeof serviceInfo.jobId === "number" && serviceInfo.jobId > 0)

  if (hasValidResult) {
    return createFmeResponse.success(serviceInfo, workspace, userEmail)
  }

  return createFmeResponse.failure(
    serviceInfo.message || translateFn("errorJobSubmission")
  )
}

export const normalizeFmeServiceInfo = (resp: any): NormalizedServiceInfo => {
  const r: any = resp || {}
  const raw = r?.data?.serviceResponse || r?.data || r
  const status = raw?.statusInfo?.status || raw?.status
  const message = raw?.statusInfo?.message || raw?.message
  const jobId = typeof raw?.jobID === "number" ? raw.jobID : raw?.id
  const url = raw?.url
  return { status, message, jobId, url }
}

export {
  // general utils
  isValidEmail,
  getSupportEmail,
  isJson,
  safeParseUrl,
  extractErrorMessage,
  extractHostFromUrl,
  // file utils
  isFileObject,
  getFileDisplayName,
  // numbers/strings
  parseNonNegativeInt,
  pad2,
  // datetime and color conversions
  fmeDateTimeToInput,
  inputToFmeDateTime,
  fmeDateToInput,
  inputToFmeDate,
  fmeTimeToInput,
  inputToFmeTime,
  normalizedRgbToHex,
  hexToNormalizedRgb,
  toIsoLocal,
  fromIsoLocal,
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
