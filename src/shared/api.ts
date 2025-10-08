// types moved to central config
import type {
  FmeFlowConfig,
  FmeExportConfig,
  RequestConfig,
  ApiResponse,
  WorkspaceParameter,
  JobResult,
  PrimitiveParams,
  EsriRequestConfig,
  EsriMockKey,
} from "../config/index"
import {
  FmeFlowApiError,
  HttpMethod,
  ESRI_GLOBAL_MOCK_KEYS,
} from "../config/index"
import {
  extractHttpStatus,
  validateRequiredConfig,
  mapErrorToKey,
  calcArea,
} from "./validations"
import {
  buildUrl,
  resolveRequestUrl,
  buildParams,
  createHostPattern,
  interceptorExists,
  safeLogParams,
  makeScopeId,
  makeGeoJson,
  isJson,
  extractHostFromUrl,
  extractErrorMessage,
  isAbortError,
  extractRepositoryNames,
  loadArcgisModules,
} from "./utils"

// Construct a typed FME Flow API error with identical message and code.
const makeFlowError = (code: string, status?: number) =>
  new FmeFlowApiError(code, code, status)

const unwrapModule = (module: unknown): any =>
  (module as any)?.default ?? module

// ArcGIS module references
let _esriRequest: unknown
let _esriConfig: unknown
let _projection: unknown
let _webMercatorUtils: unknown
let _SpatialReference: unknown
let _loadPromise: Promise<void> | null = null
let _geometryEngine: unknown
let _geometryEngineAsync: unknown
// Keep latest FME tokens per-host so the interceptor always uses fresh values
const _fmeTokensByHost: { [host: string]: string } = Object.create(null)

const ESRI_MOCK_FALLBACKS: { [K in EsriMockKey]: unknown } = {
  esriRequest: () => Promise.resolve({ data: null }),
  esriConfig: {
    request: { maxUrlLength: 4000, interceptors: [] },
  },
  projection: {},
  webMercatorUtils: {},
  SpatialReference: function spatialReferenceMock() {
    return {}
  },
}

const getEsriMockFallback = (key: EsriMockKey): unknown =>
  ESRI_MOCK_FALLBACKS[key]

const applyGlobalEsriMocks = (source: any): void => {
  const assignments: { [K in EsriMockKey]: (value: any) => void } = {
    esriRequest: (v) => (_esriRequest = v),
    esriConfig: (v) => (_esriConfig = v),
    projection: (v) => (_projection = v),
    webMercatorUtils: (v) => (_webMercatorUtils = v),
    SpatialReference: (v) => (_SpatialReference = v),
  }

  for (const key of ESRI_GLOBAL_MOCK_KEYS) {
    const value = source?.[key] ?? getEsriMockFallback(key)
    assignments[key](value)
  }
}

/**
 * Reset loaded ArcGIS modules cache and computed limits (used in tests).
 */
export function resetEsriCache(): void {
  _esriRequest = undefined
  _esriConfig = undefined
  _projection = undefined
  _webMercatorUtils = undefined
  _SpatialReference = undefined
  _loadPromise = null
  _cachedMaxUrlLength = null
  _geometryEngine = undefined
  _geometryEngineAsync = undefined
}

async function ensureGeometryEngines(): Promise<void> {
  if (!_geometryEngine) {
    try {
      const [engineMod] = await loadArcgisModules([
        "esri/geometry/geometryEngine",
      ])
      _geometryEngine = unwrapModule(engineMod)
    } catch {
      throw new Error("ARCGIS_MODULE_ERROR")
    }
  }

  if (_geometryEngineAsync === undefined) {
    try {
      const [engineAsyncMod] = await loadArcgisModules([
        "esri/geometry/geometryEngineAsync",
      ])
      _geometryEngineAsync = unwrapModule(engineAsyncMod)
    } catch {
      _geometryEngineAsync = null
    }
  }
}

const areEsriModulesLoaded = (): boolean =>
  Boolean(
    _esriRequest &&
      _esriConfig &&
      _projection &&
      _webMercatorUtils &&
      _SpatialReference
  )

const hasGlobalEsriMocks = (): boolean => {
  const globalAny =
    typeof globalThis !== "undefined" ? (globalThis as any) : undefined
  return Boolean(
    globalAny && ESRI_GLOBAL_MOCK_KEYS.some((key) => Boolean(globalAny?.[key]))
  )
}

const loadEsriModules = async (): Promise<void> => {
  const [requestMod, configMod, projectionMod, webMercatorMod, spatialRefMod] =
    await loadArcgisModules([
      "esri/request",
      "esri/config",
      "esri/geometry/projection",
      "esri/geometry/support/webMercatorUtils",
      "esri/geometry/SpatialReference",
    ])

  _esriRequest = unwrapModule(requestMod)
  _esriConfig = unwrapModule(configMod)
  _projection = unwrapModule(projectionMod)
  _webMercatorUtils = unwrapModule(webMercatorMod)
  _SpatialReference = unwrapModule(spatialRefMod)

  const projection = asProjection(_projection)
  if (projection?.load) {
    await projection.load()
  }
}

/**
 * Ensure ArcGIS modules are loaded once with caching and test-mode injection.
 */
async function ensureEsri(): Promise<void> {
  if (areEsriModulesLoaded()) return
  if (_loadPromise) return _loadPromise

  const loadPromise = (async () => {
    if (hasGlobalEsriMocks()) {
      const globalAny = globalThis as any
      applyGlobalEsriMocks(globalAny)
      return
    }

    try {
      await loadEsriModules()
    } catch {
      throw new Error("ARCGIS_MODULE_ERROR")
    }
  })()

  _loadPromise = loadPromise

  try {
    await loadPromise
  } catch (error) {
    resetEsriCache()
    throw error instanceof Error ? error : new Error(String(error))
  }
}

async function getEsriConfig(): Promise<EsriRequestConfig | null> {
  await ensureEsri()
  return asEsriConfig(_esriConfig)
}

function removeMatchingInterceptors(
  interceptors: any[] | undefined,
  pattern: RegExp
): void {
  if (!interceptors?.length) return

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const candidate = interceptors[i]
    if (!candidate?._fmeInterceptor) continue

    const urls = candidate.urls
    const matches =
      urls instanceof RegExp
        ? urls.source === pattern.source && urls.flags === pattern.flags
        : pattern.test(typeof urls === "string" ? urls : String(urls ?? ""))

    if (matches) {
      interceptors.splice(i, 1)
    }
  }
}

const isObjectType = (v: unknown): v is object =>
  Boolean(v && typeof v === "object")

const asEsriRequest = (
  v: unknown
): ((url: string, options: any) => Promise<any>) | null =>
  typeof v === "function" ? (v as any) : null

const asEsriConfig = (
  v: unknown
): { request: { maxUrlLength: number; interceptors: any[] } } | null => {
  if (!isObjectType(v)) return null
  return (v as any).request ? (v as any) : null
}

const asProjection = (
  v: unknown
): {
  project?: (geometry: any, spatialReference: any) => any
  load?: () => Promise<void>
  isLoaded?: () => boolean
} | null => (isObjectType(v) ? (v as any) : null)

const asWebMercatorUtils = (
  v: unknown
): {
  webMercatorToGeographic?: (geometry: any) => any
  geographicToWebMercator?: (geometry: any) => any
} | null => (isObjectType(v) ? (v as any) : null)

const asSpatialReference = (v: unknown): new (props: any) => any =>
  typeof v === "function" ? (v as any) : ((() => ({})) as any)

const asGeometryEngine = (v: unknown): any =>
  isObjectType(v) ? (v as any) : null

const asGeometryEngineAsync = (v: unknown): any =>
  isObjectType(v) ? (v as any) : null
const API = {
  BASE_PATH: "/fmerest/v3",
  MAX_URL_LENGTH: 4000,
  WEBHOOK_EXCLUDE_KEYS: [],
  WEBHOOK_LOG_WHITELIST: [
    "opt_responseformat",
    "opt_showresult",
    "opt_servicemode",
  ],
} as const

type WebhookErrorCode =
  | "URL_TOO_LONG"
  | "WEBHOOK_AUTH_ERROR"
  | "WEBHOOK_BAD_RESPONSE"
  | "WEBHOOK_NON_JSON"
  | "WEBHOOK_TIMEOUT"

const makeError = (
  code: WebhookErrorCode,
  status?: number,
  cause?: unknown
): Error & { code: WebhookErrorCode; status?: number; cause?: unknown } => {
  const error = new Error(code) as Error & {
    code: WebhookErrorCode
    status?: number
    cause?: unknown
  }
  error.code = code
  if (status != null) error.status = status
  if (cause !== undefined) error.cause = cause
  return error
}

const hasCachedToken = (hostKey: string): boolean =>
  Object.prototype.hasOwnProperty.call(_fmeTokensByHost, hostKey)

const removeCachedToken = (hostKey: string): void => {
  delete _fmeTokensByHost[hostKey]
}

const setCachedToken = (hostKey: string, token: string): void => {
  _fmeTokensByHost[hostKey] = token
}

const getCachedToken = (hostKey: string): string | undefined =>
  _fmeTokensByHost[hostKey]

const removeTokenInterceptor = async (pattern: RegExp): Promise<void> => {
  let esriConfig: EsriRequestConfig | null
  try {
    esriConfig = await getEsriConfig()
  } catch {
    return
  }
  removeMatchingInterceptors(esriConfig?.request?.interceptors, pattern)
}

const createTokenInterceptor = (
  hostKey: string,
  pattern: RegExp
): {
  urls: RegExp
  before: (params: any) => void
  _fmeInterceptor: boolean
} => ({
  urls: pattern,
  before(params: any) {
    if (!params?.requestOptions) {
      params.requestOptions = {}
    }
    const ro: any = params.requestOptions
    ro.headers = ro.headers || {}

    const currentToken = getCachedToken(hostKey)
    if (currentToken) {
      ro.headers.Authorization = `fmetoken token=${currentToken}`
    }
  },
  _fmeInterceptor: true,
})

// Add interceptor to append fmetoken to requests to the specified server URL
async function addFmeInterceptor(
  serverUrl: string,
  token: string
): Promise<void> {
  if (!serverUrl) return

  const host = extractHostFromUrl(serverUrl)
  if (!host) return

  const hostKey = host.toLowerCase()
  const pattern = createHostPattern(host)

  if (!token) {
    const hadToken = hasCachedToken(hostKey)
    removeCachedToken(hostKey)
    if (hadToken) {
      await removeTokenInterceptor(pattern)
    }
    return
  }

  setCachedToken(hostKey, token)

  let esriConfig: EsriRequestConfig | null
  try {
    esriConfig = await getEsriConfig()
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }

  if (!esriConfig?.request?.interceptors) return
  if (interceptorExists(esriConfig.request.interceptors, pattern)) return

  esriConfig.request.interceptors.push(createTokenInterceptor(hostKey, pattern))
}

// Determine maximum URL length from Esri config or use default
let _cachedMaxUrlLength: number | null = null
const getMaxUrlLength = (): number => {
  const windowLength = (() => {
    if (typeof window === "undefined") return undefined
    const raw = (window as any)?.esriConfig?.request?.maxUrlLength
    const numeric = typeof raw === "number" ? raw : Number(raw)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
  })()

  if (windowLength !== undefined) return windowLength

  if (_cachedMaxUrlLength !== null) return _cachedMaxUrlLength

  const cfg = asEsriConfig(_esriConfig)
  const raw = cfg?.request?.maxUrlLength
  const numeric = typeof raw === "number" ? raw : Number(raw)
  _cachedMaxUrlLength = Number.isFinite(numeric) && numeric > 0 ? numeric : 1900
  return _cachedMaxUrlLength
}

// Check if a constructed webhook URL would exceed the maximum length
export function isWebhookUrlTooLong(
  serverUrl: string,
  repository: string,
  workspace: string,
  parameters: PrimitiveParams = {},
  maxLen: number = API.MAX_URL_LENGTH,
  token?: string
): boolean {
  const webhookUrl = buildUrl(
    serverUrl,
    "fmedatadownload",
    repository,
    workspace
  )
  const params = buildParams(
    parameters,
    [...API.WEBHOOK_EXCLUDE_KEYS, "tm_ttc", "tm_ttl", "tm_tag"],
    true
  )
  appendWebhookTmParams(params, parameters)
  // Add tm_* values if present
  if (token) {
    params.set("token", token)
  }
  const fullUrl = `${webhookUrl}?${params.toString()}`
  return typeof maxLen === "number" && maxLen > 0 && fullUrl.length > maxLen
}

// helper moved to utils.ts: resolveRequestUrl

// helper moved to utils.ts: buildParams

const isWgs84SpatialRef = (
  sr: (__esri.SpatialReference & { isWGS84?: boolean }) | undefined
): boolean => Boolean(sr?.isWGS84 || sr?.wkid === 4326)

const projectGeometryToWgs84 = (
  geometry: __esri.Geometry,
  projection: any,
  SpatialReference: any
): __esri.Geometry | null => {
  if (!projection?.project || !SpatialReference) return null

  const target =
    SpatialReference?.WGS84 ||
    (typeof SpatialReference === "function"
      ? new SpatialReference({ wkid: 4326 })
      : { wkid: 4326 })

  const projected = projection.project(geometry, target)
  if (!projected) return null

  if (Array.isArray(projected) && projected[0]) {
    return (projected[0] as __esri.Geometry) || null
  }

  return (projected as __esri.Geometry).type
    ? (projected as __esri.Geometry)
    : null
}

// Geometry processing: coordinate transformation
const toWgs84 = async (geometry: __esri.Geometry): Promise<__esri.Geometry> => {
  const spatialRef = geometry?.spatialReference as
    | (__esri.SpatialReference & { isWGS84?: boolean })
    | undefined

  if (!spatialRef || isWgs84SpatialRef(spatialRef)) {
    return geometry
  }

  try {
    await ensureEsri()
    const projection = asProjection(_projection)
    const SpatialReference = asSpatialReference(_SpatialReference) as any

    const projected = projectGeometryToWgs84(
      geometry,
      projection,
      SpatialReference
    )
    if (projected) return projected

    const webMercatorUtils = asWebMercatorUtils(_webMercatorUtils)
    if (webMercatorUtils?.webMercatorToGeographic) {
      return webMercatorUtils.webMercatorToGeographic(geometry) || geometry
    }
  } catch {}

  return geometry
}

// helper moved to utils.ts: makeGeoJson

async function setApiSettings(config: FmeFlowConfig): Promise<void> {
  const esriConfig = await getEsriConfig()
  if (!esriConfig) return

  // Preserve existing platform value; ensure it is at least our safe default.
  // Do not reduce a higher platform-provided limit.
  esriConfig.request.maxUrlLength = Math.max(
    Number(esriConfig.request.maxUrlLength) || 0,
    API.MAX_URL_LENGTH
  )
}

// Request Processing Utilities

const toPosInt = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

const normalizeText = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : undefined
}

const appendWebhookTmParams = (
  params: URLSearchParams,
  source: PrimitiveParams = {}
): void => {
  const numericKeys: Array<"tm_ttc" | "tm_ttl"> = ["tm_ttc", "tm_ttl"]
  for (const key of numericKeys) {
    const value = toPosInt((source as any)[key])
    if (value !== undefined) params.set(key, String(value))
  }

  const tag = normalizeText((source as any).tm_tag, 128)
  if (tag) params.set("tm_tag", tag)
}

type TMDirectives = Partial<{
  ttc: number
  ttl: number
  tag: string
  description: string
}>

type NMDirectives = Partial<{
  directives: Array<{
    name: string
    [key: string]: any
  }>
}>

const buildTMDirectives = (params: any): TMDirectives => {
  const ttc = toPosInt(params?.tm_ttc)
  const ttl = toPosInt(params?.tm_ttl)
  const tag = typeof params?.tm_tag === "string" ? params.tm_tag.trim() : ""
  const description =
    typeof params?.tm_description === "string"
      ? params.tm_description.trim().slice(0, 512)
      : ""

  const out: TMDirectives = {}
  if (ttc !== undefined) out.ttc = ttc
  if (ttl !== undefined) out.ttl = ttl
  if (tag) out.tag = tag
  if (description) out.description = description
  return out
}

const buildNMDirectives = (params: any): NMDirectives | null => {
  const serviceMode = params?.opt_servicemode
  if (serviceMode !== "schedule") return null

  const start = typeof params?.start === "string" ? params.start.trim() : ""
  const name = typeof params?.name === "string" ? params.name.trim() : ""
  const category =
    typeof params?.category === "string" ? params.category.trim() : ""
  const trigger =
    typeof params?.trigger === "string" ? params.trigger.trim() : "runonce"
  const description =
    typeof params?.description === "string" ? params.description.trim() : ""

  if (!start || !name || !category) return null

  const scheduleDirective: any = {
    name: "schedule",
    begin: start,
    scheduleName: name,
    scheduleCategory: category,
    scheduleTrigger: trigger,
  }

  if (description) {
    scheduleDirective.scheduleDescription = description
  }

  return {
    directives: [scheduleDirective],
  }
}

const makeSubmitBody = (
  publishedParameters: any,
  params: any
): {
  publishedParameters: any
  TMDirectives?: TMDirectives
  NMDirectives?: NMDirectives
} => {
  const tmDirectives = buildTMDirectives(params)
  const nmDirectives = buildNMDirectives(params)

  const body: {
    publishedParameters: any
    TMDirectives?: TMDirectives
    NMDirectives?: NMDirectives
  } = { publishedParameters }

  if (Object.keys(tmDirectives).length > 0) {
    body.TMDirectives = tmDirectives
  }

  if (nmDirectives) {
    body.NMDirectives = nmDirectives
  }

  return body
}

const handleAbortError = <T>(): ApiResponse<T> => ({
  data: undefined as unknown as T,
  status: 0,
  statusText: "requestAborted",
})

// helper moved to utils.ts: safeLogParams

export class FmeFlowApiClient {
  private config: FmeFlowConfig
  private readonly basePath = API.BASE_PATH
  private abortController: AbortController | null = null
  private setupPromise: Promise<void>
  private disposed = false

  constructor(config: FmeFlowConfig) {
    this.config = config
    this.setupPromise = Promise.resolve()
    this.queueSetup(config)
  }

  private queueSetup(config: FmeFlowConfig): void {
    this.setupPromise = (this.setupPromise || Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await setApiSettings(config)
        await addFmeInterceptor(config.serverUrl, config.token)
      })
      .catch((error) => {
        throw error instanceof Error ? error : new Error(String(error))
      })
  }

  private queueTeardown(serverUrl: string): void {
    this.setupPromise = (this.setupPromise || Promise.resolve())
      .catch(() => undefined)
      .then(() => addFmeInterceptor(serverUrl, ""))
      .catch(() => undefined)
  }

  private safeAbortController(): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      try {
        this.abortController.abort()
      } catch {}
    }
    this.abortController = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.safeAbortController()
    this.queueTeardown(this.config.serverUrl)
  }

  private resolveUploadPath(
    data: any,
    fileName: string,
    subfolder: string
  ): string {
    const directPath =
      (typeof data.path === "string" && data.path) ||
      (typeof data.fullpath === "string" && data.fullpath)

    if (directPath) return directPath

    if (Array.isArray(data.files) && data.files.length) {
      const first = data.files[0]
      const filePath =
        (typeof first?.path === "string" && first.path) ||
        (typeof first?.fullpath === "string" && first.fullpath)
      if (filePath) return filePath
    }

    const joined =
      (subfolder ? `${subfolder.replace(/\/+$/g, "")}/` : "") + fileName
    return `$(FME_SHAREDRESOURCE_TEMP)/${joined}`
  }

  /** Upload a file/blob to FME temp shared resource. */
  async uploadToTemp(
    file: File | Blob,
    options?: { subfolder?: string; signal?: AbortSignal }
  ): Promise<ApiResponse<{ path: string }>> {
    await ensureEsri()

    const segments: string[] = [
      this.basePath.slice(1),
      "resources",
      "connections",
      "FME_SHAREDRESOURCE_TEMP",
      "filesys",
    ]

    const sub = (options?.subfolder || "")
      .replace(/[^A-Za-z0-9_\-/]/g, "")
      .replace(/^\/+|\/+$/g, "")

    if (sub) {
      for (const s of sub.split("/")) if (s) segments.push(s)
    }

    const endpoint = buildUrl(this.config.serverUrl, ...segments)
    const rawName = (file as any)?.name ? String((file as any).name) : ""
    const safeName =
      rawName.replace(/[^\w.\- ]+/g, "").slice(0, 128) || `upload_${Date.now()}`

    const headers: { [key: string]: string } = {
      Accept: "application/json",
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`,
      "X-Content-Type-Options": "nosniff",
    }

    const resp = await this.request<{
      path?: string
      fullpath?: string
      files?: any[]
    }>(endpoint, {
      method: HttpMethod.POST,
      headers,
      body: file as unknown as any,
      query: { createDirectories: "true" },
      signal: options?.signal,
    })

    const resolvedPath = this.resolveUploadPath(resp?.data || {}, safeName, sub)

    return {
      data: { path: resolvedPath },
      status: resp.status,
      statusText: resp.statusText,
    }
  }

  private resolveRepository(repository?: string): string {
    return repository || this.config.repository
  }

  private buildServiceUrl(
    service: string,
    repository: string,
    workspace: string
  ): string {
    return buildUrl(this.config.serverUrl, service, repository, workspace)
  }

  // addQuery helper removed (unused)

  private formatJobParams(parameters: PrimitiveParams = {}): any {
    if ((parameters as any).publishedParameters) return parameters

    // Exclude TM directives and schedule metadata from published parameters
    const excludeFromPublished = new Set([
      "tm_ttc",
      "tm_ttl",
      "tm_tag",
      "tm_description",
      "start",
      "name",
      "category",
      "trigger",
      "description",
      "opt_servicemode",
      "opt_responseformat",
      "opt_showresult",
      "opt_requesteremail",
    ])

    const publishedParameters = Object.entries(parameters)
      .filter(([name]) => !excludeFromPublished.has(name))
      .map(([name, value]) => ({ name, value }))

    return makeSubmitBody(publishedParameters, parameters)
  }

  // Build repository endpoint
  private repoEndpoint(repository: string, ...segments: string[]): string {
    return buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "repositories",
      repository,
      ...segments
    )
  }

  // Build transformation endpoint
  private transformEndpoint(
    action: string,
    repository: string,
    workspace: string
  ): string {
    return buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "transformations",
      action,
      repository,
      workspace
    )
  }

  private async withApiError<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    errorCode: string
  ): Promise<T> {
    try {
      return await operation()
    } catch (err) {
      const status = extractHttpStatus(err)
      throw new FmeFlowApiError(errorMessage, errorCode, status || 0)
    }
  }

  updateConfig(config: Partial<FmeFlowConfig>): void {
    this.config = { ...this.config, ...config }
    this.queueSetup(this.config)
  }

  /**
   * Calls /info on FME server to verify connectivity and get version info.
   */
  async testConnection(
    signal?: AbortSignal
  ): Promise<ApiResponse<{ build: string; version: string }>> {
    return this.request<{ build: string; version: string }>("/info", { signal })
  }

  async validateRepository(
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<{ name: string }>> {
    const repo = this.resolveRepository(repository)
    const endpoint = this.repoEndpoint(repo)
    return this.request<{ name: string }>(endpoint, { signal })
  }

  async getRepositories(
    signal?: AbortSignal
  ): Promise<ApiResponse<Array<{ name: string }>>> {
    return this.withApiError(
      async () => {
        // Use the collection endpoint without a trailing slash
        const listEndpoint = buildUrl(
          this.config.serverUrl,
          this.basePath.slice(1),
          "repositories"
        )
        const raw = await this.request<any>(listEndpoint, {
          signal,
          cacheHint: false, // Avoid cross-token header-insensitive caches
          query: { limit: -1, offset: -1 },
        })

        const data = raw?.data
        const items = extractRepositoryNames(data).map((name) => ({ name }))

        return {
          data: items,
          status: raw.status,
          statusText: raw.statusText,
        }
      },
      "REPOSITORIES_ERROR",
      "REPOSITORIES_ERROR"
    )
  }

  async getWorkspaceParameter(
    workspace: string,
    parameter: string,
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<WorkspaceParameter>> {
    const repo = this.resolveRepository(repository)
    const endpoint = this.repoEndpoint(
      repo,
      "items",
      workspace,
      "parameters",
      parameter
    )
    return this.request<WorkspaceParameter>(endpoint, {
      signal,
      cacheHint: false, // Disable header-insensitive caching
      repositoryContext: repo, // Add repository context for proper cache scoping
    })
  }

  async getWorkspaceParameters(
    workspace: string,
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<WorkspaceParameter[]>> {
    const repo = this.resolveRepository(repository)
    const endpoint = this.repoEndpoint(repo, "items", workspace, "parameters")
    return this.withApiError(
      () =>
        this.request<WorkspaceParameter[]>(endpoint, {
          signal,
          cacheHint: false, // Disable header-insensitive caching
          repositoryContext: repo, // Add repository context for proper cache scoping
        }),
      "WORKSPACE_PARAMETERS_ERROR",
      "WORKSPACE_PARAMETERS_ERROR"
    )
  }

  // Generic request method
  async getRepositoryItems(
    repository: string,
    type?: string,
    limit?: number,
    offset?: number,
    signal?: AbortSignal
  ): Promise<
    ApiResponse<{
      items: any[]
      totalCount?: number
      limit?: number
      offset?: number
    }>
  > {
    const repo = this.resolveRepository(repository)
    const endpoint = this.repoEndpoint(repo, "items")
    const query: PrimitiveParams = {}
    if (type) query.type = type
    if (typeof limit === "number") query.limit = limit
    if (typeof offset === "number") query.offset = offset
    return this.withApiError(
      () =>
        this.request(endpoint, {
          signal,
          cacheHint: false, // Avoid cross-repo/token contamination
          repositoryContext: repo, // Add repository context for proper cache scoping
          query,
        }),
      "REPOSITORY_ITEMS_ERROR",
      "REPOSITORY_ITEMS_ERROR"
    )
  }

  async getWorkspaceItem(
    workspace: string,
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<any>> {
    const repo = this.resolveRepository(repository)
    const endpoint = this.repoEndpoint(repo, "items", workspace)
    return this.withApiError(
      () =>
        this.request<any>(endpoint, {
          signal,
          cacheHint: false, // Avoid cross-repo/token contamination
          repositoryContext: repo, // Add repository context for proper cache scoping
        }),
      "WORKSPACE_ITEM_ERROR",
      "WORKSPACE_ITEM_ERROR"
    )
  }

  async submitJob(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResult>> {
    const repo = this.resolveRepository(repository)
    const endpoint = this.transformEndpoint("submit", repo, workspace)
    const jobRequest = this.formatJobParams(parameters)
    return this.withApiError(
      () =>
        this.request<JobResult>(endpoint, {
          method: HttpMethod.POST,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jobRequest),
          signal,
          cacheHint: false,
        }),
      "JOB_SUBMISSION_ERROR",
      "JOB_SUBMISSION_ERROR"
    )
  }

  async submitSyncJob(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResult>> {
    const repo = this.resolveRepository(repository)
    const endpoint = this.transformEndpoint("transact", repo, workspace)
    const jobRequest = this.formatJobParams(parameters)
    return this.request<JobResult>(endpoint, {
      method: HttpMethod.POST,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobRequest),
      signal,
    })
  }

  async submitGeometryJob(
    workspace: string,
    geometry: __esri.Geometry,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResult>> {
    const geometryParams = await this.toFmeParams(geometry)
    return this.submitJob(
      workspace,
      { ...parameters, ...geometryParams },
      repository,
      signal
    )
  }

  async getJobStatus(
    jobId: number,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResult>> {
    const endpoint = buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "transformations",
      "jobs",
      jobId.toString()
    )
    return this.request<JobResult>(endpoint, { signal })
  }

  async cancelJob(
    jobId: number,
    signal?: AbortSignal
  ): Promise<ApiResponse<{ success: boolean }>> {
    const endpoint = buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "transformations",
      "jobs",
      jobId.toString(),
      "cancel"
    )
    return this.request<{ success: boolean }>(endpoint, {
      method: HttpMethod.POST,
      signal,
    })
  }

  async runDataDownload(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    const targetRepository = this.resolveRepository(repository)
    return await this.runDownloadWebhook(
      workspace,
      parameters,
      targetRepository,
      signal
    )
  }

  async runDataStreaming(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<
    ApiResponse<{
      blob: Blob
      fileName?: string
      contentType?: string | null
    }>
  > {
    const targetRepository = this.resolveRepository(repository)

    // Build streaming service URL and POST body
    const serviceUrl = this.buildServiceUrl(
      "fmedatastreaming",
      targetRepository,
      workspace
    )

    return this.withApiError(
      async () => {
        // Prepare URLSearchParams body, excluding TM directives which are control-plane only
        const params = buildParams(
          parameters,
          ["tm_ttc", "tm_ttl", "tm_tag"],
          false
        )
        // Show result inline (lets FME stream the generated content)
        params.set("opt_showresult", "true")
        appendWebhookTmParams(params, parameters)

        // Append token as query param (consistent with webhook auth model)
        let url = serviceUrl
        if (this.config.token) {
          const u = new URL(url, globalThis.location?.origin || "http://d")
          u.searchParams.set("token", this.config.token)
          url = u.toString()
        }

        // Best-effort safe logging without sensitive params
        safeLogParams(
          "STREAMING_CALL",
          url.split("?")[0],
          params,
          API.WEBHOOK_LOG_WHITELIST
        )

        await ensureEsri()
        const esriRequestFn = asEsriRequest(_esriRequest)
        if (!esriRequestFn) {
          throw makeFlowError("ARCGIS_MODULE_ERROR")
        }

        // Honor client timeout by composing a timeout-aware AbortSignal for esriRequest
        const controller = new AbortController()
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        let didTimeout = false
        const onAbort = () => {
          controller.abort()
        }
        try {
          if (signal) {
            if (signal.aborted) controller.abort()
            else signal.addEventListener("abort", onAbort)
          }

          const timeoutMs =
            typeof this.config.timeout === "number" && this.config.timeout > 0
              ? this.config.timeout
              : undefined
          if (timeoutMs) {
            timeoutId = setTimeout(() => {
              didTimeout = true
              try {
                controller.abort()
              } catch {}
            }, timeoutMs)
          }

          const response = await esriRequestFn(url, {
            method: "post",
            responseType: "blob",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
            signal: controller.signal,
            timeout: timeoutMs,
          })

          const status =
            typeof response?.httpStatus === "number"
              ? response.httpStatus
              : typeof response?.status === "number"
                ? response.status
                : 200
          if (status < 200 || status >= 300) {
            throw makeFlowError("DATA_STREAMING_ERROR", status)
          }

          const blob = response?.data as Blob
          const headers = response?.headers
          const contentType =
            typeof headers?.get === "function"
              ? headers.get("content-type")
              : null

          // Attempt to extract filename from Content-Disposition header
          const cd =
            typeof headers?.get === "function"
              ? headers.get("content-disposition") || ""
              : ""
          let fileName: string | undefined
          const m = /filename\*=UTF-8''([^;]+)|filename="?([^;"]+)"?/i.exec(cd)
          if (m) {
            const raw = decodeURIComponent(m[1] || m[2] || "").trim()
            fileName = raw || undefined
          }

          return {
            data: { blob, fileName, contentType },
            status,
            statusText: response?.statusText,
          }
        } catch (e: any) {
          if (isAbortError(e)) {
            if (didTimeout) {
              // Map timeout to HTTP 408 for user-friendly translation
              throw new FmeFlowApiError("timeout", "REQUEST_TIMEOUT", 408)
            }
          }
          throw e instanceof Error ? e : new Error(String(e))
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
          try {
            if (signal) signal.removeEventListener("abort", onAbort)
          } catch {}
        }
      },
      "DATA_STREAMING_ERROR",
      "DATA_STREAMING_ERROR"
    )
  }

  async runWorkspace(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    service: "download" | "stream" = "download",
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    // Detect schedule mode from parameters and route to REST API instead of webhook
    const serviceMode = parameters?.opt_servicemode
    const isScheduleMode = serviceMode === "schedule"

    if (isScheduleMode) {
      // Schedule jobs must use the REST API submit endpoint, not webhooks
      return await this.submitJob(workspace, parameters, repository, signal)
    }

    if (service === "stream") {
      return await this.runDataStreaming(
        workspace,
        parameters,
        repository,
        signal
      )
    } else {
      return await this.runDataDownload(
        workspace,
        parameters,
        repository,
        signal
      )
    }
  }

  private async runDownloadWebhook(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    try {
      const webhookUrl = buildUrl(
        this.config.serverUrl,
        "fmedatadownload",
        repository,
        workspace
      )
      const params = buildParams(
        parameters,
        [...API.WEBHOOK_EXCLUDE_KEYS, "tm_ttc", "tm_ttl", "tm_tag"],
        true
      )

      // Append token if available
      if (this.config.token) {
        params.set("token", this.config.token)
      }

      // Ensure tm_* values are present if provided
      appendWebhookTmParams(params, parameters)

      const q = params.toString()
      const fullUrl = `${webhookUrl}?${q}`

      const maxLen = getMaxUrlLength()
      if (Number.isFinite(maxLen) && maxLen > 0 && fullUrl.length > maxLen) {
        throw makeError("URL_TOO_LONG", 0)
      }

      // Best-effort safe logging without sensitive params
      safeLogParams(
        "WEBHOOK_CALL",
        webhookUrl,
        params,
        API.WEBHOOK_LOG_WHITELIST
      )

      await ensureEsri()
      const esriRequestFn = asEsriRequest(_esriRequest)
      if (!esriRequestFn) {
        throw makeFlowError("ARCGIS_MODULE_ERROR")
      }

      // Honor client timeout by composing a timeout-aware AbortSignal for esriRequest
      const controller = new AbortController()
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let didTimeout = false
      const onAbort = () => {
        controller.abort()
      }
      try {
        if (signal) {
          if (signal.aborted) controller.abort()
          else signal.addEventListener("abort", onAbort)
        }

        const timeoutMs =
          typeof this.config.timeout === "number" && this.config.timeout > 0
            ? this.config.timeout
            : undefined
        if (timeoutMs) {
          timeoutId = setTimeout(() => {
            didTimeout = true
            try {
              controller.abort()
            } catch {}
          }, timeoutMs)
        }

        const response = await esriRequestFn(fullUrl, {
          method: "get",
          responseType: "json",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
          },
          signal: controller.signal,
          timeout: timeoutMs,
        })

        return this.parseWebhookResponse(response)
      } catch (e: any) {
        if (isAbortError(e)) {
          if (didTimeout) {
            throw makeError("WEBHOOK_TIMEOUT", 408, e)
          }
        }
        throw e instanceof Error ? e : new Error(String(e))
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        try {
          if (signal) signal.removeEventListener("abort", onAbort)
        } catch {}
      }
    } catch (err) {
      if (err instanceof FmeFlowApiError) throw err
      if ((err as { code?: string } | null)?.code) {
        throw err instanceof Error ? err : new Error(String(err))
      }
      const status = extractHttpStatus(err)
      throw makeFlowError("DATA_DOWNLOAD_ERROR", status || 0)
    }
  }

  async customRequest<T>(
    url: string,
    method: HttpMethod = HttpMethod.GET,
    parameters?: PrimitiveParams,
    contentType?: string
  ): Promise<ApiResponse<T>> {
    const headers: { [key: string]: string } = {}
    if (contentType) headers["Content-Type"] = contentType

    let body: unknown
    let query: PrimitiveParams | undefined

    if (parameters) {
      if (method.toUpperCase() === "GET") {
        query = parameters
      } else {
        body =
          contentType === "application/x-www-form-urlencoded"
            ? buildParams(parameters).toString()
            : JSON.stringify(parameters)
      }
    }

    return this.request<T>(url, { method, query, headers, body })
  }

  cancelAllRequests(): void {
    this.safeAbortController()
  }

  createAbortController(): AbortController {
    this.safeAbortController()
    this.abortController = new AbortController()
    return this.abortController
  }

  private async parseWebhookResponse(
    response:
      | Response
      | {
          data?: any
          headers?: { get: (name: string) => string | null }
          status?: number
          statusText?: string
          httpStatus?: number
        }
  ): Promise<ApiResponse> {
    const rawStatus =
      typeof (response as any)?.status === "number"
        ? (response as any).status
        : typeof (response as any)?.httpStatus === "number"
          ? (response as any).httpStatus
          : undefined
    const status = typeof rawStatus === "number" ? rawStatus : 0

    if (status === 401 || status === 403) {
      throw makeError("WEBHOOK_AUTH_ERROR", status)
    }

    const headers =
      typeof (response as any)?.headers?.get === "function"
        ? ((response as any).headers as {
            get: (name: string) => string | null
          })
        : undefined
    const contentType = headers?.get("content-type") || undefined

    let data: any

    if (typeof (response as any)?.json === "function") {
      try {
        data = await (response as any).json()
      } catch (error) {
        throw makeError("WEBHOOK_NON_JSON", status, error)
      }
    } else if ((response as any)?.data !== undefined) {
      data = (response as any).data
    } else if ((response as any)?.json !== undefined) {
      data = (response as any).json
    } else if (typeof (response as any)?.text === "string") {
      try {
        data = JSON.parse((response as any).text)
      } catch (error) {
        throw makeError("WEBHOOK_NON_JSON", status, error)
      }
    }

    if (!data || typeof data !== "object") {
      throw makeError("WEBHOOK_NON_JSON", status, response)
    }

    if (contentType && !isJson(contentType)) {
      // Non-JSON content types are suspicious; treat them as non-JSON responses
      throw makeError("WEBHOOK_NON_JSON", status, { contentType })
    }

    return {
      data,
      status,
      statusText: (response as any)?.statusText,
    }
  }

  private async toFmeParams(
    geometry: __esri.Geometry
  ): Promise<PrimitiveParams> {
    if (!geometry) {
      throw new Error("GEOMETRY_MISSING")
    }

    if (geometry.type !== "polygon") {
      throw new Error("GEOMETRY_TYPE_INVALID")
    }

    const polygon = geometry as __esri.Polygon
    const extent = polygon.extent

    if (!extent) {
      throw new Error("GEOMETRY_MISSING")
    }

    // Reproject to WGS84
    const projectedGeometry = (await toWgs84(geometry)) as __esri.Polygon

    const geoJsonPolygon = makeGeoJson(projectedGeometry)

    // Convert to Esri JSON for FME
    const esriJson = projectedGeometry.toJSON()

    let polygonArea = 0
    try {
      await ensureGeometryEngines()
      const areaModules = {
        geometryEngine: asGeometryEngine(_geometryEngine),
        geometryEngineAsync: asGeometryEngineAsync(_geometryEngineAsync),
      }
      polygonArea = await calcArea(projectedGeometry, areaModules)
    } catch {}

    const fallbackArea = Math.abs(extent.width * extent.height)
    const resolvedArea =
      polygonArea && polygonArea > 0 ? polygonArea : fallbackArea

    return {
      MAXX: extent.xmax,
      MAXY: extent.ymax,
      MINX: extent.xmin,
      MINY: extent.ymin,
      AREA: resolvedArea,
      AreaOfInterest: JSON.stringify(esriJson),
      ExtentGeoJson: JSON.stringify(geoJsonPolygon),
    }
  }

  private async request<T>(
    endpoint: string,
    options: Partial<RequestConfig> = {}
  ): Promise<ApiResponse<T>> {
    if (this.disposed) {
      throw makeFlowError("CLIENT_DISPOSED")
    }

    try {
      await this.setupPromise
    } catch (error) {
      this.queueSetup(this.config)
      try {
        await this.setupPromise
      } catch {
        throw makeFlowError("ARCGIS_MODULE_ERROR")
      }
    }
    await ensureEsri()
    const url = resolveRequestUrl(
      endpoint,
      this.config.serverUrl,
      this.basePath
    )

    try {
      const headers: { [key: string]: string } = {
        ...(options.headers || {}),
      }
      const query: any = { ...(options.query || {}) }
      // Add a stable scope query param for GET requests to vary cache keys per token/server/repository
      const isGet = !options.method || options.method === HttpMethod.GET
      if (isGet) {
        const scope = makeScopeId(
          this.config.serverUrl,
          this.config.token,
          options.repositoryContext
        )
        if (query.__scope === undefined) query.__scope = scope
      }

      const requestOptions: any = {
        method: (options.method?.toLowerCase() as any) || "get",
        query,
        responseType: "json",
        headers,
        signal: options.signal,
      }

      // BYPASS INTERCEPTOR - Add FME authentication directly
      try {
        const serverHostKey = extractHostFromUrl(
          this.config.serverUrl
        )?.toLowerCase()
        const requestHostKey = new URL(
          url,
          globalThis.location?.origin || "http://d"
        ).host.toLowerCase()
        if (
          serverHostKey &&
          requestHostKey === serverHostKey &&
          this.config.token
        ) {
          // Add Authorization header with correct FME Flow format
          requestOptions.headers = requestOptions.headers || {}
          requestOptions.headers.Authorization = `fmetoken token=${this.config.token}`
        }
      } catch {}

      // Prefer explicit timeout from options, else fall back to client config
      const timeoutMs =
        typeof options.timeout === "number"
          ? options.timeout
          : typeof this.config.timeout === "number"
            ? this.config.timeout
            : undefined
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        requestOptions.timeout = timeoutMs
      }
      if (options.cacheHint !== undefined)
        requestOptions.cacheHint = options.cacheHint
      if (options.body !== undefined) requestOptions.body = options.body
      const esriRequestFn = asEsriRequest(_esriRequest)
      if (!esriRequestFn) {
        throw makeFlowError("ARCGIS_MODULE_ERROR")
      }

      const response = await esriRequestFn(url, requestOptions)

      return {
        data: response.data,
        status: response.httpStatus || response.status || 200,
        statusText: response.statusText,
      }
    } catch (err) {
      // Handle specific error cases
      if (
        (err as { name?: string } | null | undefined)?.name === "AbortError"
      ) {
        return handleAbortError<T>()
      }
      // Preserve specific API errors thrown intentionally (e.g., ARCGIS_MODULE_ERROR)
      if (err instanceof FmeFlowApiError) {
        throw err
      }

      const httpStatus = extractHttpStatus(err) || 0
      const message = extractErrorMessage(err)

      // Determine error code for programmatic identification (simpler logic)
      let errorCode = "REQUEST_FAILED"
      if (message.includes("Unexpected token")) {
        errorCode = "INVALID_RESPONSE_FORMAT"
      }

      // Get user-friendly translation key using centralized error mapping
      const translationKey = mapErrorToKey(err, httpStatus)

      throw new FmeFlowApiError(translationKey, errorCode, httpStatus)
    }
  }
}

const normalizeConfigParams = (config: FmeExportConfig): FmeFlowConfig => ({
  serverUrl: config.fmeServerUrl || (config as any).fme_server_url || "",
  token:
    config.fmeServerToken ||
    (config as any).fme_server_token ||
    (config as any).fmw_server_token ||
    "",
  repository: config.repository || "",
  timeout: config.requestTimeout,
})

/**
 * Factory to construct the API client with normalized config and validation.
 */
export function createFmeFlowClient(config: FmeExportConfig): FmeFlowApiClient {
  const normalizedConfig = normalizeConfigParams(config)
  try {
    validateRequiredConfig(normalizedConfig)
  } catch {
    throw makeFlowError("INVALID_CONFIG")
  }

  return new FmeFlowApiClient({
    ...normalizedConfig,
    serverUrl: normalizedConfig.serverUrl.replace(/\/$/, ""),
  })
}

export { FmeFlowApiClient as default }
