import {
  ErrorSeverity,
  ErrorType,
  type ErrorState,
  type FmeExportConfig,
  type StartupValidationResult,
  type TranslateFn,
  type FmeResponse,
  type NormalizedServiceInfo,
} from "../config"
import {
  extractErrorMessage,
  maskToken,
  safeParseUrl,
  loadArcgisModules,
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

const MIN_TOKEN_LENGTH = 10
const FME_REST_PATH = "/fmerest"

const isHttpStatus = (n: unknown): n is number =>
  typeof n === "number" && n >= 100 && n <= 599

const hasForbiddenPaths = (pathname: string): boolean => {
  const lowerPath = pathname.toLowerCase()
  return lowerPath.includes(FME_REST_PATH)
}

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

export const validateServerUrl = (
  url: string,
  opts?: { strict?: boolean; requireHttps?: boolean }
): { ok: boolean; key?: string } => {
  const trimmedUrl = url?.trim()
  const invalid = (key: string) => ({ ok: false as const, key })
  const invalidBaseUrl = () => invalid("errorInvalidServerUrl")

  if (!trimmedUrl) return invalid("errorMissingServerUrl")

  const parsedUrl = safeParseUrl(trimmedUrl)
  if (!parsedUrl) return invalidBaseUrl()

  if (!/^https?:$/i.test(parsedUrl.protocol)) return invalidBaseUrl()

  if (opts?.requireHttps && !/^https:$/i.test(parsedUrl.protocol)) {
    return invalidBaseUrl()
  }

  if (parsedUrl.username || parsedUrl.password) return invalidBaseUrl()

  if (parsedUrl.search || parsedUrl.hash) return invalidBaseUrl()

  if (hasForbiddenPaths(parsedUrl.pathname)) {
    return { ok: false, key: "errorBadBaseUrl" }
  }

  if (parsedUrl.hostname.endsWith(".")) return invalidBaseUrl()

  if (opts?.strict) {
    const hostname = parsedUrl.hostname || ""
    if (!hostname.includes(".") || hostname.length < 4) return invalidBaseUrl()
  }

  return { ok: true }
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
  if (!token) return { ok: false, key: "errorMissingToken" }

  const invalid =
    token.length < MIN_TOKEN_LENGTH || hasDangerousCharacters(token)

  return invalid ? { ok: false, key: "errorTokenIsInvalid" } : { ok: true }
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

const STATUS_PROPERTIES = ["status", "statusCode", "httpStatus"] as const

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

const ERROR_CODE_TO_KEY: { [code: string]: string } = {
  ARCGIS_MODULE_ERROR: "startupNetworkError",
  NETWORK_ERROR: "startupNetworkError",
  INVALID_RESPONSE_FORMAT: "startupTokenError",
  WEBHOOK_AUTH_ERROR: "startupTokenError",
  SERVER_URL_ERROR: "connectionFailed",
  REPOSITORIES_ERROR: "startupServerError",
  REPOSITORY_ITEMS_ERROR: "startupServerError",
  WORKSPACE_ITEM_ERROR: "startupServerError",
  JOB_SUBMISSION_ERROR: "startupServerError",
  DATA_STREAMING_ERROR: "startupServerError",
  DATA_DOWNLOAD_ERROR: "startupServerError",
  INVALID_CONFIG: "startupConfigError",
  GEOMETRY_MISSING: "GEOMETRY_SERIALIZATION_FAILED",
  GEOMETRY_TYPE_INVALID: "GEOMETRY_SERIALIZATION_FAILED",
  URL_TOO_LONG: "urlTooLong",
}

const STATUS_TO_KEY_MAP: { [status: number]: string } = {
  0: "startupNetworkError",
  401: "startupTokenError",
  403: "startupTokenError",
  404: "connectionFailed",
  408: "timeout",
  429: "rateLimited",
  431: "headersTooLarge",
}

const statusToKey = (s?: number): string | undefined => {
  if (typeof s !== "number") return undefined
  if (STATUS_TO_KEY_MAP[s]) return STATUS_TO_KEY_MAP[s]
  if (s >= 500) return "startupServerError"
  return undefined
}

const MESSAGE_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /failed to fetch/i, key: "startupNetworkError" },
  { pattern: /timeout/i, key: "timeout" },
  { pattern: /cors/i, key: "corsError" },
  { pattern: /url.*too/i, key: "urlTooLong" },
]

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
        return statusToKey(status) || "startupServerError"
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

  return "unknownErrorOccurred"
}

export const isValidExternalUrlForOptGetUrl = (url: unknown): boolean => {
  if (typeof url !== "string") return false
  const trimmed = url.trim()
  if (!trimmed || trimmed.length > 10000) return false
  const u = safeParseUrl(trimmed)
  if (!u) return false
  if (!/^https:$/i.test(u.protocol)) return false
  if (u.username || u.password) return false
  return true
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

const REQUIRED_CONFIG_FIELDS = [
  "fmeServerUrl",
  "fmeServerToken",
  "repository",
] as const

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

  const u = validateServerUrl(url)
  if (!u.ok) errors.serverUrl = u.key || "errorInvalidServerUrl"

  const t = validateToken(token)
  if (!t.ok) errors.token = t.key || "errorTokenIsInvalid"

  const repoCheck = validateRepository(
    repository || "",
    availableRepos === undefined ? [] : availableRepos
  )
  if (!repoCheck.ok)
    errors.repository = repoCheck.key || "errorRepositoryNotFound"

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
): ErrorState => {
  return {
    message: translate(messageKey) || messageKey,
    type,
    code,
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage: options?.userFriendlyMessage || "",
    suggestion:
      options?.suggestion || translate("checkConnectionSettings") || "",
    retry: options?.retry,
    kind: "runtime",
  }
}

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

type GeometryAreaFn = (
  geometry: __esri.Geometry,
  unit: string
) => number | PromiseLike<number>

type GeometryDensifyFn = (
  geometry: __esri.Geometry,
  ...args: readonly unknown[]
) => __esri.Geometry | null | PromiseLike<__esri.Geometry | null>

type GeometrySimplifyFn = (
  polygon: __esri.Polygon
) => __esri.Geometry | null | PromiseLike<__esri.Geometry | null>

type GeometryIsSimpleFn = (
  polygon: __esri.Polygon
) => boolean | PromiseLike<boolean>

type GeometryContainsFn = (
  outer: __esri.Geometry,
  inner: __esri.Geometry
) => boolean

interface GeometryEngineLike {
  geodesicArea?: GeometryAreaFn
  planarArea?: GeometryAreaFn
  geodesicDensify?: GeometryDensifyFn
  densify?: GeometryDensifyFn
  simplify?: GeometrySimplifyFn
  isSimple?: GeometryIsSimpleFn
  contains?: GeometryContainsFn
}

interface NormalizeUtilsModule {
  normalizeCentralMeridian?: (
    geometries: readonly __esri.Geometry[]
  ) => PromiseLike<readonly __esri.Geometry[]> | readonly __esri.Geometry[]
}

interface EsriConfigLike {
  geometryServiceUrl?: string
  request?: { geometryServiceUrl?: string }
  portalSelf?: { helperServices?: { geometry?: { url?: string } } }
  portalInfo?: { helperServices?: { geometry?: { url?: string } } }
  helperServices?: { geometry?: { url?: string } }
}

type AreasAndLengthsParametersCtor = new (
  options: __esri.AreasAndLengthsParametersProperties
) => __esri.AreasAndLengthsParameters

interface AreasAndLengthsResponse {
  areas?: number[]
}

interface GeometryServiceModule {
  areasAndLengths?: (
    url: string,
    params: __esri.AreasAndLengthsParameters
  ) => PromiseLike<AreasAndLengthsResponse> | AreasAndLengthsResponse
}

interface PolygonCtor {
  fromJSON?: (json: unknown) => __esri.Polygon
}

interface ArcgisGeometryModules {
  geometryEngine?: GeometryEngineLike
  geometryEngineAsync?: GeometryEngineLike
  normalizeUtils?: NormalizeUtilsModule
  esriConfig?: EsriConfigLike
  Polygon?: PolygonCtor
  geometryOperators?: unknown
}

type PolygonMaybe =
  | __esri.Geometry
  | null
  | undefined
  | PromiseLike<__esri.Geometry | null | undefined>

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof (value as { then?: unknown }).then === "function"

const isPolygonGeometryLike = (value: unknown): value is __esri.Polygon =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "polygon"

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
  return wkid === 3857 || latestWkid === 3857
}

const isWgs84Sr = (sr: unknown): boolean => {
  const ref = sr as { isGeographic?: boolean; isWGS84?: boolean } | undefined
  if (ref?.isGeographic || ref?.isWGS84) return true
  const { wkid, latestWkid } = readWkids(sr)
  return wkid === 4326 || latestWkid === 4326
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

const GEODESIC_SEGMENT_LENGTH_METERS = 50
const MIN_PLANAR_SEGMENT_DEGREES = 1e-6
const DEGREES_PER_METER = 1 / 111319.49079327358

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
    const result = densify(geometry, ...args)
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

type AreaStrategy = () => Promise<number>

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

const makeGeometryError = (
  messageKey: string,
  code: string
): { valid: false; error: ErrorState } => ({
  valid: false,
  error: {
    message: messageKey,
    type: ErrorType.GEOMETRY,
    code,
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage: "",
    suggestion: "",
    kind: "runtime",
  },
})

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
    return makeGeometryError("noGeometryProvided", "NO_GEOMETRY")
  }

  if (geometry.type !== "polygon") {
    return makeGeometryError("geometryMustBePolygon", "INVALID_GEOMETRY_TYPE")
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
      return makeGeometryError("polygonNotSimple", "INVALID_GEOMETRY")
    }
    poly = simplified

    const rawRings = (poly as { rings?: unknown }).rings
    const rings = Array.isArray(rawRings) ? rawRings : []
    if (!validateRingStructure(rings)) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
    }

    const area = await calcArea(poly, modules)
    if (!area || area <= 0) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
    }

    if (!validateHolesWithinOuter(rings, poly, engine, modules)) {
      return makeGeometryError("GEOMETRY_INVALID", "GEOMETRY_INVALID")
    }

    return { valid: true, simplified: poly }
  } catch {
    return makeGeometryError(
      "geometryValidationFailed",
      "GEOMETRY_VALIDATION_ERROR"
    )
  }
}

const resolveAreaLimit = (limit?: number): number | undefined => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return undefined
  if (limit <= 0) return undefined
  return limit
}

export interface AreaEvaluation {
  readonly area: number
  readonly warningThreshold?: number
  readonly maxThreshold?: number
  readonly exceedsMaximum: boolean
  readonly shouldWarn: boolean
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
    message: "AREA_TOO_LARGE",
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

const createBlobResponse = (
  blob: Blob,
  workspace: string,
  userEmail: string
) => ({
  success: true,
  blob,
  email: userEmail,
  workspaceName: workspace,
  downloadFilename: `${workspace}_export.zip`,
})

const createSuccessResponse = (
  serviceInfo: NormalizedServiceInfo,
  workspace: string,
  userEmail: string
) => ({
  success: true,
  jobId: typeof serviceInfo.jobId === "number" ? serviceInfo.jobId : undefined,
  email: userEmail,
  workspaceName: workspace,
  downloadUrl: serviceInfo.url,
  downloadFilename: serviceInfo.url ? `${workspace}_export.zip` : undefined,
})

const createFailureResponse = (message: string) => ({
  success: false,
  message,
  code: "FME_JOB_FAILURE",
})

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
    return createBlobResponse(data.blob, workspace, userEmail)
  }

  const serviceInfo = normalizeFmeServiceInfo(response as FmeResponse)

  if (serviceInfo.status === "success" || isValidDownloadUrl(serviceInfo.url)) {
    return createSuccessResponse(serviceInfo, workspace, userEmail)
  }

  return createFailureResponse(
    serviceInfo.message || translateFn("fmeJobSubmissionFailed")
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
