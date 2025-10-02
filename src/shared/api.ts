// types moved to central config
import type {
  FmeFlowConfig,
  FmeExportConfig,
  RequestConfig,
  ApiResponse,
  WorkspaceParameter,
  JobResponse,
  JobResult,
  PrimitiveParams,
  EsriRequestConfig,
  EsriMockKey,
} from "../config"
import { FmeFlowApiError, HttpMethod } from "../config"
import {
  extractHttpStatus,
  validateRequiredConfig,
  isAuthError,
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
const makeError = (code: string, status?: number) =>
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

const ESRI_GLOBAL_MOCK_KEYS: readonly EsriMockKey[] = [
  "esriRequest",
  "esriConfig",
  "projection",
  "webMercatorUtils",
  "SpatialReference",
] as const

const getEsriMockFallback = (key: EsriMockKey): unknown => {
  switch (key) {
    case "esriRequest":
      return () => Promise.resolve({ data: null })
    case "esriConfig":
      return {
        request: { maxUrlLength: 4000, interceptors: [] },
      }
    case "projection":
    case "webMercatorUtils":
      return {}
    case "SpatialReference":
      return function spatialReferenceMock() {
        return {}
      }
  }
}

const applyGlobalEsriMocks = (source: any): void => {
  for (const key of ESRI_GLOBAL_MOCK_KEYS) {
    const value = source?.[key] ?? getEsriMockFallback(key)
    switch (key) {
      case "esriRequest":
        _esriRequest = value
        break
      case "esriConfig":
        _esriConfig = value
        break
      case "projection":
        _projection = value
        break
      case "webMercatorUtils":
        _webMercatorUtils = value
        break
      case "SpatialReference":
        _SpatialReference = value
        break
    }
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

/**
 * Ensure ArcGIS modules are loaded once with caching and test-mode injection.
 */
async function ensureEsri(): Promise<void> {
  // Quick return if already loaded
  if (
    _esriRequest &&
    _esriConfig &&
    _projection &&
    _webMercatorUtils &&
    _SpatialReference
  ) {
    return
  }

  // Return existing promise if loading is in progress
  if (_loadPromise) return _loadPromise

  const loadPromise = (async () => {
    // In test environment, check for global mocks first before trying to load modules
    const globalAny =
      typeof globalThis !== "undefined" ? (globalThis as any) : undefined

    if (
      globalAny &&
      ESRI_GLOBAL_MOCK_KEYS.some((key) => Boolean(globalAny?.[key]))
    ) {
      applyGlobalEsriMocks(globalAny)
      return
    }

    try {
      const [
        requestMod,
        configMod,
        projectionMod,
        webMercatorMod,
        spatialRefMod,
      ] = await loadArcgisModules([
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

      // Load projection dependencies for client-side transformation
      const projection = asProjection(_projection)
      if (projection && typeof projection.load === "function") {
        await projection.load()
      }
    } catch (error) {
      // Eliminate legacy fallbacks: fail fast if modules cannot be loaded
      throw new Error("ARCGIS_MODULE_ERROR")
    }
  })()

  _loadPromise = loadPromise

  try {
    await loadPromise
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error))
    resetEsriCache()
    throw normalizedError
  }

  return loadPromise
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

// ArcGIS module validation helpers
const asEsriRequest = (
  v: unknown
): ((url: string, options: any) => Promise<any>) | null => {
  return typeof v === "function" ? (v as any) : null
}

const asEsriConfig = (
  v: unknown
): { request: { maxUrlLength: number; interceptors: any[] } } | null => {
  if (!v || typeof v !== "object") return null
  const obj = v as any
  return obj.request ? obj : null
}

const asProjection = (
  v: unknown
): {
  project?: (geometry: any, spatialReference: any) => any
  load?: () => Promise<void>
  isLoaded?: () => boolean
} | null => {
  if (!v || typeof v !== "object") return null
  return v as any
}

const asWebMercatorUtils = (
  v: unknown
): {
  webMercatorToGeographic?: (geometry: any) => any
  geographicToWebMercator?: (geometry: any) => any
} | null => {
  if (!v || typeof v !== "object") return null
  return v as any
}

const asSpatialReference = (v: unknown): new (props: any) => any => {
  return typeof v === "function" ? (v as any) : ((() => ({})) as any)
}

const asGeometryEngine = (v: unknown): any =>
  v && typeof v === "object" ? (v as any) : null

const asGeometryEngineAsync = (v: unknown): any =>
  v && typeof v === "object" ? (v as any) : null
const API = {
  BASE_PATH: "/fmerest/v3",
  MAX_URL_LENGTH: 4000,
  WEBHOOK_EXCLUDE_KEYS: [
    "opt_servicemode",
    "opt_responseformat",
    "opt_showresult",
  ],
  WEBHOOK_LOG_WHITELIST: [
    "opt_responseformat",
    "opt_showresult",
    "opt_servicemode",
  ],
} as const

// // Add interceptor to append fmetoken to requests to the specified server URL
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
    const hadCachedToken = Object.prototype.hasOwnProperty.call(
      _fmeTokensByHost,
      hostKey
    )
    delete _fmeTokensByHost[hostKey]

    if (!hadCachedToken) {
      return
    }

    let esriConfig: EsriRequestConfig | null
    try {
      esriConfig = await getEsriConfig()
    } catch {
      return
    }

    removeMatchingInterceptors(esriConfig?.request?.interceptors, pattern)

    return
  }

  // Always record the latest token for this host
  _fmeTokensByHost[hostKey] = token

  let esriConfig: EsriRequestConfig | null
  try {
    esriConfig = await getEsriConfig()
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
  if (!esriConfig) return

  const interceptors = esriConfig.request.interceptors
  if (!interceptors) return

  if (interceptorExists(interceptors, pattern)) {
    return
  }

  interceptors.push({
    urls: pattern,
    before(params: any) {
      if (!params || !params.requestOptions) {
        params.requestOptions = {}
      }
      const ro: any = params.requestOptions
      ro.query = ro.query || {}
      ro.headers = ro.headers || {}

      // Always use the token stored for this host pattern
      const currentToken = _fmeTokensByHost[hostKey]
      if (currentToken) {
        // Add token as query parameter if not already present
        if (!ro.query.fmetoken) {
          ro.query.fmetoken = currentToken
        }
        // Always set Authorization header with correct FME Flow format
        ro.headers.Authorization = `fmetoken token=${currentToken}`
      }
    },
    _fmeInterceptor: true,
  })
}

// Determine maximum URL length from Esri config or use default
let _cachedMaxUrlLength: number | null = null
const getMaxUrlLength = (): number => {
  if (_cachedMaxUrlLength !== null) return _cachedMaxUrlLength

  const cfg = asEsriConfig(_esriConfig)
  const n = cfg?.request?.maxUrlLength
  _cachedMaxUrlLength = typeof n === "number" && n > 0 ? n : API.MAX_URL_LENGTH
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

// Geometry processing: coordinate transformation
const toWgs84 = async (geometry: __esri.Geometry): Promise<__esri.Geometry> => {
  const spatialRef = geometry?.spatialReference as
    | (__esri.SpatialReference & { isWGS84?: boolean })
    | undefined

  if (!spatialRef || spatialRef.isWGS84 || spatialRef.wkid === 4326) {
    return geometry
  }

  try {
    await ensureEsri()
    const projection = asProjection(_projection)
    const SpatialReference = asSpatialReference(_SpatialReference) as any

    if (projection?.project && SpatialReference) {
      const target =
        SpatialReference?.WGS84 ||
        (typeof SpatialReference === "function"
          ? new SpatialReference({ wkid: 4326 })
          : { wkid: 4326 })

      const projected = projection.project(geometry, target)
      if (projected) {
        if (Array.isArray(projected) && projected[0]) {
          return (projected[0] as __esri.Geometry) || geometry
        }
        if ((projected as __esri.Geometry).type) {
          return (projected as __esri.Geometry) || geometry
        }
      }
    }

    const webMercatorUtils = asWebMercatorUtils(_webMercatorUtils)
    if (webMercatorUtils?.webMercatorToGeographic) {
      const converted =
        webMercatorUtils.webMercatorToGeographic(geometry) || geometry
      return converted
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

const appendWebhookTmParams = (
  params: URLSearchParams,
  source: PrimitiveParams = {}
): void => {
  const toPosInt = (v: unknown): number | undefined => {
    const n = typeof v === "string" ? Number(v) : (v as number)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
  }

  const numericKeys: Array<"tm_ttc" | "tm_ttl"> = ["tm_ttc", "tm_ttl"]
  for (const key of numericKeys) {
    const value = toPosInt((source as any)[key])
    if (value !== undefined) params.set(key, String(value))
  }

  const normalizeText = (value: unknown, limit: number): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, limit) : undefined
  }

  const tag = normalizeText((source as any).tm_tag, 128)
  if (tag) params.set("tm_tag", tag)
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
        const normalizedError =
          error instanceof Error ? error : new Error(String(error))
        throw normalizedError
      })
  }

  private queueTeardown(serverUrl: string): void {
    this.setupPromise = (this.setupPromise || Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await addFmeInterceptor(serverUrl, "")
      })
      .catch(() => undefined)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    if (this.abortController && !this.abortController.signal.aborted) {
      try {
        this.abortController.abort()
      } catch {}
    }
    this.abortController = null

    this.queueTeardown(this.config.serverUrl)
  }

  /** Upload a file/blob to FME temp shared resource. */
  async uploadToTemp(
    file: File | Blob,
    options?: { subfolder?: string; signal?: AbortSignal }
  ): Promise<ApiResponse<{ path: string }>> {
    await ensureEsri()

    // Validate file input
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
      // Split safe subfolder into path segments
      for (const s of sub.split("/")) if (s) segments.push(s)
    }

    const endpoint = buildUrl(this.config.serverUrl, ...segments)

    // Determine filename from File or provide a fallback
    const fileName = (file as any)?.name
      ? String((file as any).name)
      : `upload_${Date.now()}`

    const headers: { [key: string]: string } = {
      Accept: "application/json",
      "Content-Type": "application/octet-stream",
      // RFC 6266 style Content-Disposition
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
    }

    // Some deployments require explicit createDirectories flag
    const query: PrimitiveParams = { createDirectories: "true" }

    return this.request<{ path?: string; fullpath?: string; files?: any[] }>(
      endpoint,
      {
        method: HttpMethod.POST,
        headers,
        body: file as unknown as any,
        query,
        signal: options?.signal,
      }
    ).then((resp) => {
      const data: any = resp?.data || {}
      // Try to resolve the absolute/engine-usable path from typical response shapes
      let resolvedPath: string | undefined =
        (typeof data.path === "string" && data.path) ||
        (typeof data.fullpath === "string" && data.fullpath)

      if (!resolvedPath && Array.isArray(data.files) && data.files.length) {
        const first = data.files[0]
        resolvedPath =
          (typeof first?.path === "string" && first.path) ||
          (typeof first?.fullpath === "string" && first.fullpath)
      }

      // If still not found, construct a best-effort path using known conventions
      if (!resolvedPath) {
        const joined = (sub ? `${sub.replace(/\/+$/g, "")}/` : "") + fileName
        resolvedPath = `$(FME_SHAREDRESOURCE_TEMP)/${joined}`
      }

      return {
        data: { path: resolvedPath },
        status: resp.status,
        statusText: resp.statusText,
      }
    })
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

    // Extract Task Manager directives
    const params = parameters as any
    const toPosInt = (v: unknown) => {
      const n = typeof v === "string" ? Number(v) : (v as number)
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
    }

    const publishedParameters = Object.entries(parameters)
      .filter(([name]) => !name.startsWith("tm_"))
      .map(([name, value]) => ({ name, value }))

    const job: any = { publishedParameters }

    // Add TM directives if present
    const tmDirectives: any = {}
    const ttc = toPosInt(params.tm_ttc)
    const ttl = toPosInt(params.tm_ttl)
    const tag =
      typeof params.tm_tag === "string" && params.tm_tag.trim()
        ? params.tm_tag.trim()
        : undefined
    let rtc: boolean | undefined
    if (typeof params.tm_rtc === "boolean") {
      rtc = params.tm_rtc
    } else if (typeof params.tm_rtc === "string") {
      const normalizedRtc = params.tm_rtc.trim().toLowerCase()
      if (normalizedRtc === "true" || normalizedRtc === "1") rtc = true
      else if (normalizedRtc === "false" || normalizedRtc === "0") rtc = false
    }
    const description =
      typeof params.tm_description === "string" && params.tm_description.trim()
        ? params.tm_description.trim().slice(0, 512)
        : undefined

    if (ttc !== undefined) tmDirectives.ttc = ttc
    if (ttl !== undefined) tmDirectives.ttl = ttl
    if (tag !== undefined) tmDirectives.tag = tag
    if (typeof rtc === "boolean") tmDirectives.rtc = rtc
    if (description !== undefined) tmDirectives.description = description

    if (Object.keys(tmDirectives).length > 0) {
      job.TMDirectives = tmDirectives
    }

    return job
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
  ): Promise<ApiResponse<JobResponse>> {
    const repo = this.resolveRepository(repository)
    const endpoint = this.transformEndpoint("submit", repo, workspace)
    const jobRequest = this.formatJobParams(parameters)
    return this.withApiError(
      () =>
        this.request<JobResponse>(endpoint, {
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
  ): Promise<ApiResponse<JobResponse>> {
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
          throw makeError("ARCGIS_MODULE_ERROR")
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
            throw makeError("DATA_STREAMING_ERROR", status)
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
      try {
        const maxLen = getMaxUrlLength()
        if (
          typeof maxLen === "number" &&
          maxLen > 0 &&
          fullUrl.length > maxLen
        ) {
          // Emit a dedicated error code for URL length issues
          throw makeError("URL_TOO_LONG", 0)
        }
      } catch (lenErr) {
        if (lenErr instanceof FmeFlowApiError) throw lenErr
        // If any unexpected error occurs during length validation, proceed with webhook
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
        throw makeError("ARCGIS_MODULE_ERROR")
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
          signal: controller.signal,
          timeout: timeoutMs,
        })

        return this.parseWebhookResponse(response)
      } catch (e: any) {
        if (isAbortError(e)) {
          if (didTimeout) {
            throw new FmeFlowApiError("timeout", "REQUEST_TIMEOUT", 408)
          }
        }
        if (
          e &&
          typeof e.message === "string" &&
          /unexpected token|json/i.test(e.message)
        ) {
          const status = extractHttpStatus(e) || 0
          throw makeError("WEBHOOK_AUTH_ERROR", status)
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
      const status = extractHttpStatus(err)
      // Surface a code-only message; services will localize
      throw makeError("DATA_DOWNLOAD_ERROR", status || 0)
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
    if (this.abortController && !this.abortController.signal.aborted) {
      try {
        this.abortController.abort()
      } catch {}
    }
    this.abortController = null
  }

  createAbortController(): AbortController {
    // Safely abort existing controller
    if (this.abortController && !this.abortController.signal.aborted) {
      try {
        this.abortController.abort()
      } catch {}
    }

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
    const isFetchResponse =
      typeof (response as any)?.json === "function" &&
      typeof (response as any)?.headers?.get === "function"

    if (isFetchResponse) {
      const fetchResponse = response as Response
      const contentType = fetchResponse.headers.get("content-type")

      if (!isJson(contentType)) {
        throw makeError("WEBHOOK_AUTH_ERROR", fetchResponse.status)
      }

      try {
        const responseData = await fetchResponse.json()
        if (isAuthError(fetchResponse.status)) {
          throw makeError("WEBHOOK_AUTH_ERROR", fetchResponse.status)
        }

        return {
          data: responseData,
          status: fetchResponse.status,
          statusText: fetchResponse.statusText,
        }
      } catch (error) {
        if (error instanceof FmeFlowApiError) throw error
        throw makeError("WEBHOOK_AUTH_ERROR", fetchResponse.status)
      }
    }

    const esriResponse = response as {
      data?: any
      headers?: { get: (name: string) => string | null }
      status?: number
      statusText?: string
      httpStatus?: number
    }

    const status =
      typeof esriResponse.httpStatus === "number"
        ? esriResponse.httpStatus
        : typeof esriResponse.status === "number"
          ? esriResponse.status
          : 200

    const headers = esriResponse.headers
    const contentType =
      typeof headers?.get === "function" ? headers.get("content-type") : ""
    if (headers && !isJson(contentType)) {
      throw makeError("WEBHOOK_AUTH_ERROR", status)
    }

    if (esriResponse.data === undefined) {
      throw makeError("WEBHOOK_AUTH_ERROR", status)
    }

    let payload = esriResponse.data
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload)
      } catch (error) {
        throw makeError("WEBHOOK_AUTH_ERROR", status)
      }
    }

    if (isAuthError(status)) {
      throw makeError("WEBHOOK_AUTH_ERROR", status)
    }

    return {
      data: payload,
      status,
      statusText: esriResponse.statusText,
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
      throw makeError("CLIENT_DISPOSED")
    }

    try {
      await this.setupPromise
    } catch (error) {
      this.queueSetup(this.config)
      try {
        await this.setupPromise
      } catch {
        throw makeError("ARCGIS_MODULE_ERROR")
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
          // Add token as query parameter
          if (!requestOptions.query.fmetoken) {
            requestOptions.query.fmetoken = this.config.token
          }
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
        throw makeError("ARCGIS_MODULE_ERROR")
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
    throw makeError("INVALID_CONFIG")
  }

  return new FmeFlowApiClient({
    ...normalizedConfig,
    serverUrl: normalizedConfig.serverUrl.replace(/\/$/, ""),
  })
}

export { FmeFlowApiClient as default }
