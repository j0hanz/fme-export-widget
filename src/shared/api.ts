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
} from "../config"
import { FmeFlowApiError, HttpMethod } from "../config"
import { isAuthError } from "./utils"

// Inline loader helper for EXB with error handling
async function loadEsriModules(modules: readonly string[]): Promise<unknown[]> {
  // Check test environment first for better performance
  if (process.env.NODE_ENV === "test") {
    const stub = (global as any).__ESRI_TEST_STUB__
    if (typeof stub === "function") return stub(modules)
  }

  // Use dynamic import for better EXB integration
  try {
    const mod = await import("jimu-arcgis")
    const loader = mod.loadArcGISJSAPIModules
    if (typeof loader !== "function") {
      throw new Error("ArcGIS module loader not available")
    }
    const loaded = await loader(modules as string[])
    const unwrap = (m: any) => m?.default ?? m
    return (loaded || []).map(unwrap)
  } catch (error) {
    console.error("Failed to load ArcGIS modules:", error)
    throw new Error("Failed to load ArcGIS modules")
  }
}

// ArcGIS module references
let _esriRequest: unknown
let _esriConfig: unknown
let _projection: unknown
let _webMercatorUtils: unknown
let _SpatialReference: unknown
let _loadPromise: Promise<void> | null = null

// Reset loaded ArcGIS modules (for testing purposes)
export function resetEsriCache(): void {
  _esriRequest = undefined
  _esriConfig = undefined
  _projection = undefined
  _webMercatorUtils = undefined
  _SpatialReference = undefined
  _loadPromise = null
}

const isTestEnv = (): boolean =>
  typeof process !== "undefined" &&
  !!(process as any).env &&
  (!!(process as any).env.JEST_WORKER_ID ||
    (process as any).env.NODE_ENV === "test")

// ESRI module loading with caching and error handling
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

  _loadPromise = (async () => {
    // In test environment, check for global mocks first before trying to load modules
    if (isTestEnv()) {
      const globalAny = global as any

      // If we have global mocks set up, use them directly
      if (
        globalAny.esriRequest ||
        globalAny.esriConfig ||
        globalAny.projection ||
        globalAny.webMercatorUtils ||
        globalAny.SpatialReference
      ) {
        console.warn("FME API - Using global mocks in test environment")
        _esriRequest =
          globalAny.esriRequest || (() => Promise.resolve({ data: null }))
        _esriConfig = globalAny.esriConfig || {
          request: { maxUrlLength: 4000, interceptors: [] },
        }
        _projection = globalAny.projection || {}
        _webMercatorUtils = globalAny.webMercatorUtils || {}
        _SpatialReference =
          globalAny.SpatialReference ||
          function () {
            return {}
          }
        return
      }
    }

    try {
      const [
        requestMod,
        configMod,
        projectionMod,
        webMercatorMod,
        spatialRefMod,
      ] = await loadEsriModules([
        "esri/request",
        "esri/config",
        "esri/geometry/projection",
        "esri/geometry/support/webMercatorUtils",
        "esri/geometry/SpatialReference",
      ])

      const unwrap = (m: any) => m?.default ?? m
      _esriRequest = unwrap(requestMod)
      _esriConfig = unwrap(configMod)
      _projection = unwrap(projectionMod)
      _webMercatorUtils = unwrap(webMercatorMod)
      _SpatialReference = unwrap(spatialRefMod)

      // Load projection dependencies for client-side transformation
      const projection = asProjection(_projection)
      if (projection && typeof projection.load === "function") {
        await projection.load()
      }
    } catch (error) {
      // Eliminate legacy fallbacks: fail fast if modules cannot be loaded
      console.error("FME API - Failed to load ArcGIS modules:", error)
      throw new Error("Failed to load ArcGIS modules")
    }
  })()

  return _loadPromise
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
  project?: (geometries: any[], spatialReference: any) => Promise<any[]>
  load?: () => Promise<void>
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

async function addFmeInterceptor(
  serverUrl: string,
  token: string
): Promise<void> {
  if (!serverUrl || !token) return
  await ensureEsri()
  const esriConfig = asEsriConfig(_esriConfig)
  if (!esriConfig) return
  let host: string
  try {
    host = new URL(serverUrl).host
  } catch {
    return
  }
  const escapedHost = host.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
  const pattern = new RegExp(`^https?://${escapedHost}`, "i")
  const exists = esriConfig.request.interceptors?.some((it: any) => {
    return it._fmeInterceptor && it.urls && pattern.test(it.urls.toString())
  })
  if (exists) return
  esriConfig.request.interceptors?.push({
    urls: pattern,
    before(params: any) {
      if (!params || !params.requestOptions) {
        params.requestOptions = {}
      }
      const ro: any = params.requestOptions
      ro.query = ro.query || {}
      if (token && !ro.query.fmetoken) {
        ro.query.fmetoken = token
      }
    },
    _fmeInterceptor: true,
  })
}
// Get max URL length from esriConfig if available; otherwise use default
const getMaxUrlLength = (): number => {
  const cfg = asEsriConfig(_esriConfig)
  const n = cfg?.request?.maxUrlLength
  return typeof n === "number" && n > 0 ? n : API.MAX_URL_LENGTH
}

// Error handling utilities
const toStr = (val: unknown): string => {
  if (typeof val === "string") return val
  if (typeof val === "number" || typeof val === "boolean") return String(val)
  if (val && typeof val === "object") {
    try {
      return JSON.stringify(val)
    } catch {
      console.warn(
        "FME API - Failed to stringify value for parameter conversion:",
        val
      )
      return Object.prototype.toString.call(val)
    }
  }
  return val === undefined
    ? "undefined"
    : val === null
      ? "null"
      : Object.prototype.toString.call(val)
}

const extractStatusFromMessage = (message: string): number | undefined => {
  // Match patterns like "Unable to load [URL] status: 401" or "status: 401" or just "401"
  const statusMatch =
    message.match(/status:\s*(\d{3})/i) ||
    message.match(
      /\b(\d{3})\s*\((?:Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error|Service Unavailable|Gateway)/i
    ) ||
    message.match(/\b(\d{3})\b/)
  if (statusMatch) {
    return parseInt(statusMatch[1], 10)
  }
  return undefined
}

const getErrorInfo = (
  err: unknown
): {
  message: string
  status?: number
  details?: unknown
} => {
  if (err && typeof err === "object") {
    const anyErr = err as any

    // Try multiple ways to extract status code
    const status =
      anyErr.status ||
      anyErr.httpStatus ||
      anyErr.httpCode ||
      anyErr.code ||
      anyErr.response?.status ||
      anyErr.details?.httpCode ||
      (typeof anyErr.message === "string"
        ? extractStatusFromMessage(anyErr.message)
        : undefined)

    return {
      message:
        typeof anyErr.message === "string"
          ? anyErr.message
          : toStr(anyErr.message),
      status: typeof status === "number" ? status : undefined,
      details: anyErr.details,
    }
  }
  return { message: toStr(err) }
}

const isJson = (contentType: string | null): boolean =>
  contentType?.includes("application/json") ?? false

// Mask token for logs (show at most last 4 chars)
const maskToken = (token: string): string =>
  token ? `***${token.slice(-4)}` : ""

// URL building utilities
const buildUrl = (serverUrl: string, ...segments: string[]): string => {
  // Normalize server base by removing trailing /fmeserver or /fmerest and any trailing slash
  const base = serverUrl
    .replace(/\/(?:fmeserver|fmerest)$/i, "")
    .replace(/\/$/, "")

  // Encode each provided segment, while preserving internal slashes inside a segment string
  const encodePath = (s: string): string =>
    s
      .split("/")
      .filter(Boolean)
      .map((p) => encodeURIComponent(p))
      .join("/")

  const path = segments
    .filter((seg): seg is string => typeof seg === "string" && seg.length > 0)
    .map((seg) => encodePath(seg))
    .join("/")

  return path ? `${base}/${path}` : base
}

// Create a stable scope ID from server URL, token, and repository for caching purposes
function makeScopeId(
  serverUrl: string,
  token: string,
  repository?: string
): string {
  const s = `${serverUrl}::${token || ""}::${repository || ""}`
  // DJB2 hash function
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
  }
  const n = Math.abs(h >>> 0)
  return n.toString(36)
}

// Check if a webhook URL with parameters would exceed max length
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
  // Add tm_* values if present
  if (token) {
    params.set("token", token)
  }
  const fullUrl = `${webhookUrl}?${params.toString()}`
  return typeof maxLen === "number" && maxLen > 0 && fullUrl.length > maxLen
}

const resolveRequestUrl = (
  endpoint: string,
  serverUrl: string,
  basePath: string
): string => {
  if (endpoint.startsWith("http")) {
    return endpoint
  }
  if (endpoint.startsWith("/fme")) {
    return buildUrl(serverUrl, endpoint.slice(1))
  }
  return buildUrl(serverUrl, basePath.slice(1), endpoint.slice(1))
}

// Parameter building
const buildParams = (
  params: PrimitiveParams = {},
  excludeKeys: string[] = [],
  webhookDefaults = false
): URLSearchParams => {
  const urlParams = new URLSearchParams()
  if (!params || typeof params !== "object") return urlParams

  const excludeSet = new Set(excludeKeys)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || excludeSet.has(key)) continue
    urlParams.append(key, toStr(value))
  }

  // Add webhook-specific defaults if requested
  if (webhookDefaults) {
    urlParams.append("opt_responseformat", "json")
    urlParams.append("opt_showresult", "true")
    urlParams.append(
      "opt_servicemode",
      (params.opt_servicemode as string) || "async"
    )
  }

  return urlParams
}

// Geometry processing: coordinate transformation
const toWgs84 = async (geometry: __esri.Geometry): Promise<__esri.Geometry> => {
  if (geometry.spatialReference?.wkid === 4326) return geometry

  try {
    await ensureEsri()

    // Use webMercatorUtils for Web Mercator (most common case)
    if (geometry.spatialReference?.wkid === 3857) {
      const webMercatorUtils = asWebMercatorUtils(_webMercatorUtils)
      if (webMercatorUtils?.webMercatorToGeographic) {
        return webMercatorUtils.webMercatorToGeographic(geometry) || geometry
      }
    }

    // Use projection engine for other coordinate systems
    const projection = asProjection(_projection)
    const SpatialReference = asSpatialReference(_SpatialReference)
    if (projection?.project && SpatialReference) {
      const wgs84SR = new SpatialReference({ wkid: 4326 })
      const projected = await projection.project([geometry], wgs84SR)
      return projected?.[0] || geometry
    }

    return geometry // Fallback to original
  } catch (error) {
    console.warn("FME API - Coordinate transformation failed:", error)
    return geometry
  }
}

const makeGeoJson = (polygon: __esri.Polygon) => ({
  type: "Polygon" as const,
  coordinates: (polygon.rings || []).map((ring: any[]) =>
    ring.map((pt: any) => [pt[0], pt[1]] as [number, number])
  ),
})

async function setApiSettings(config: FmeFlowConfig): Promise<void> {
  await ensureEsri()
  const esriConfig = asEsriConfig(_esriConfig)
  if (!esriConfig) return

  // Preserve existing platform value; ensure it is at least our safe default.
  // Do not reduce a higher platform-provided limit.
  esriConfig.request.maxUrlLength = Math.max(
    Number(esriConfig.request.maxUrlLength) || 0,
    API.MAX_URL_LENGTH
  )
}

// Request Processing Utilities

const handleAbortError = <T>(): ApiResponse<T> => ({
  data: undefined as unknown as T,
  status: 0,
  statusText: "Canceled",
})

const processRequestError = (
  err: unknown,
  url: string,
  token: string
): { errorMessage: string; errorCode: string; httpStatus: number } => {
  const { message, status, details } = getErrorInfo(err)
  const httpStatus = status || 0

  console.error("FME API - request error", {
    url,
    token: maskToken(token),
    message,
  })

  let errorMessage = `Request failed: ${message}`
  let errorCode = "NETWORK_ERROR"

  if (message.includes("Unexpected token")) {
    console.error("FME API - Received HTML response instead of JSON. URL:", url)
    errorMessage = `Server returned HTML instead of JSON. This usually indicates an authentication or endpoint issue. URL: ${url}`
    errorCode = "INVALID_RESPONSE_FORMAT"
  }

  const det = details as any
  if (det?.error) {
    errorMessage = det.error.message || errorMessage
    errorCode = det.error.code || errorCode
  }

  return { errorMessage, errorCode, httpStatus }
}

export class FmeFlowApiClient {
  private config: FmeFlowConfig
  private readonly basePath = API.BASE_PATH
  private abortController: AbortController | null = null

  constructor(config: FmeFlowConfig) {
    this.config = config
    void setApiSettings(config)
    void addFmeInterceptor(config.serverUrl, config.token)
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

    if (ttc !== undefined) tmDirectives.ttc = ttc
    if (ttl !== undefined) tmDirectives.ttl = ttl
    if (tag !== undefined) tmDirectives.tag = tag

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
      const { message, status } = getErrorInfo(err)
      throw new FmeFlowApiError(
        `${errorMessage}: ${message}`,
        errorCode,
        status || 0
      )
    }
  }

  updateConfig(config: Partial<FmeFlowConfig>): void {
    this.config = { ...this.config, ...config }
    void setApiSettings(this.config)
    void addFmeInterceptor(this.config.serverUrl, this.config.token)
  }

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
        let items: Array<{ name: string }>
        if (Array.isArray(data)) {
          items = data
            .map((r: any) => ({ name: String(r?.name ?? "") }))
            .filter((r) => r.name.length > 0)
        } else if (
          data &&
          Array.isArray((data as unknown as { items?: unknown[] }).items)
        ) {
          const arr = (data as unknown as { items?: unknown[] }).items || []
          items = arr
            .map((r: any) => ({ name: String(r?.name ?? "") }))
            .filter((r) => r.name.length > 0)
        } else {
          items = []
        }

        return {
          data: items,
          status: raw.status,
          statusText: raw.statusText,
        }
      },
      "Failed to get repositories",
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
      "Failed to get repository items",
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
      "Failed to get workspace item details",
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
      "Failed to submit job",
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
  ): Promise<ApiResponse> {
    const targetRepository = this.resolveRepository(repository)
    const endpoint = this.buildServiceUrl(
      "fmedatastreaming",
      targetRepository,
      workspace
    )
    return this.withApiError(
      async () => {
        const params = buildParams(parameters)
        params.append("opt_showresult", "true")
        return await this.request(endpoint, {
          method: HttpMethod.POST,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal,
        })
      },
      "Failed to run data streaming",
      "DATA_STREAMING_ERROR"
    )
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
      // For webhook, tm_* must be added as query params directly
      // Exclude tm_* from the initial query build so we can control empty handling
      const params = buildParams(
        parameters,
        [...API.WEBHOOK_EXCLUDE_KEYS, "tm_ttc", "tm_ttl", "tm_tag"],
        true
      )

      // Add FME token as query parameter for webhook (use 'token' only)
      if (this.config.token) {
        params.set("token", this.config.token)
      }

      // Ensure tm_* values are present if provided
      const maybeAppend = (k: string) => {
        const v = (parameters as any)[k]
        if (v !== undefined && v !== null && String(v).length > 0) {
          params.set(k, String(v))
        }
      }
      maybeAppend("tm_ttc")
      maybeAppend("tm_ttl")
      maybeAppend("tm_tag")

      const q = params.toString()
      const fullUrl = `${webhookUrl}?${q}`

      // Guard: if URL exceeds configured max length, abort with a clear error
      try {
        const maxLen = getMaxUrlLength()
        if (
          typeof maxLen === "number" &&
          maxLen > 0 &&
          fullUrl.length > maxLen
        ) {
          throw new FmeFlowApiError(
            "Webhook URL too long",
            "DATA_DOWNLOAD_ERROR",
            0
          )
        }
      } catch (lenErr) {
        if (lenErr instanceof FmeFlowApiError) throw lenErr
        // If any unexpected error occurs during length validation, proceed with webhook
      }

      try {
        const safeParams = new URLSearchParams()
        for (const k of API.WEBHOOK_LOG_WHITELIST) {
          const v = params.get(k)
          if (v !== null) safeParams.set(k, v)
        }
        console.log(
          "FME Export - Webhook call",
          webhookUrl,
          `params=${safeParams.toString()}`
        )
      } catch {
        console.warn("FME API - Failed to log webhook parameters safely")
        /* ignore logging issues */
      }

      const response = await fetch(fullUrl, {
        method: "GET",
        signal,
      })

      return this.parseWebhookResponse(response)
    } catch (err) {
      if (err instanceof FmeFlowApiError) throw err
      const { message, status } = getErrorInfo(err)
      throw new FmeFlowApiError(
        `Failed to run data download webhook: ${message}`,
        "DATA_DOWNLOAD_ERROR",
        status || 0
      )
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
      } catch (error) {
        console.warn("FME API - Error aborting controller:", error)
      }
    }
    this.abortController = null
  }

  createAbortController(): AbortController {
    // Safely abort existing controller
    if (this.abortController && !this.abortController.signal.aborted) {
      try {
        this.abortController.abort()
      } catch (error) {
        console.warn("FME API - Error aborting previous controller:", error)
      }
    }

    this.abortController = new AbortController()
    return this.abortController
  }

  private async parseWebhookResponse(response: Response): Promise<ApiResponse> {
    const contentType = response.headers.get("content-type")

    if (!isJson(contentType)) {
      throw new FmeFlowApiError(
        "Webhook returned a non-JSON response",
        "WEBHOOK_AUTH_ERROR",
        response.status
      )
    }

    let responseData: any
    try {
      responseData = await response.json()
    } catch {
      console.warn("FME API - Failed to parse webhook JSON response")
      throw new FmeFlowApiError(
        "Webhook returned malformed JSON",
        "WEBHOOK_AUTH_ERROR",
        response.status
      )
    }

    if (isAuthError(response.status)) {
      throw new FmeFlowApiError(
        "Webhook authentication failed",
        "WEBHOOK_AUTH_ERROR",
        response.status
      )
    }

    return {
      data: responseData,
      status: response.status,
      statusText: response.statusText,
    }
  }

  private async toFmeParams(
    geometry: __esri.Geometry
  ): Promise<PrimitiveParams> {
    if (!geometry) {
      throw new Error("Geometry is required but was null or undefined")
    }

    if (geometry.type !== "polygon") {
      throw new Error(
        `Only polygon geometries are supported, received: ${geometry.type}`
      )
    }

    const polygon = geometry as __esri.Polygon
    const extent = polygon.extent

    if (!extent) {
      throw new Error("Polygon geometry must have a valid extent")
    }

    // Reproject to WGS84
    const projectedGeometry = await toWgs84(geometry)

    const geoJsonPolygon = makeGeoJson(projectedGeometry as __esri.Polygon)

    // Convert to Esri JSON for FME
    const esriJson = (projectedGeometry as __esri.Polygon).toJSON()

    return {
      MAXX: extent.xmax,
      MAXY: extent.ymax,
      MINX: extent.xmin,
      MINY: extent.ymin,
      AREA: Math.abs(extent.width * extent.height),
      AreaOfInterest: JSON.stringify(esriJson),
      ExtentGeoJson: JSON.stringify(geoJsonPolygon),
    }
  }

  private async request<T>(
    endpoint: string,
    options: Partial<RequestConfig> = {}
  ): Promise<ApiResponse<T>> {
    await ensureEsri()
    const url = resolveRequestUrl(
      endpoint,
      this.config.serverUrl,
      this.basePath
    )

    console.log("FME API - Making request to:", url)

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

        // Security-conscious token propagation: only attach fmetoken for requests to the configured FME host
        try {
          const serverHost = new URL(this.config.serverUrl).host.toLowerCase()
          const requestHost = new URL(url).host.toLowerCase()
          if (
            this.config.token &&
            serverHost &&
            requestHost &&
            serverHost === requestHost &&
            query.fmetoken === undefined
          ) {
            query.fmetoken = this.config.token
          }
        } catch {
          // Ignore URL parsing errors; do not attach token if uncertain
        }
      }

      const requestOptions: any = {
        method: (options.method?.toLowerCase() as any) || "get",
        query,
        responseType: "json",
        headers,
        signal: options.signal,
      }
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
        throw new FmeFlowApiError(
          "ArcGIS request module unavailable",
          "ARCGIS_MODULE_ERROR"
        )
      }

      const response = await esriRequestFn(url, requestOptions)

      return {
        data: response.data,
        status: response.httpStatus || response.status || 200,
        statusText: response.statusText || "OK",
      }
    } catch (err) {
      // Handle specific error cases
      if (
        (err as { name?: string } | null | undefined)?.name === "AbortError"
      ) {
        return handleAbortError<T>()
      }
      const { errorMessage, errorCode, httpStatus } = processRequestError(
        err,
        url,
        this.config.token
      )
      throw new FmeFlowApiError(errorMessage, errorCode, httpStatus)
    }
  }
}

// Configuration Processing Utilities
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

const validateRequiredConfig = (config: FmeFlowConfig): void => {
  if (!config.serverUrl || !config.token || !config.repository) {
    throw new FmeFlowApiError(
      "Missing required FME Flow configuration. Required: serverUrl (fmeServerUrl or fme_server_url), token (fmeServerToken or fme_server_token), and repository",
      "INVALID_CONFIG"
    )
  }
}

export function createFmeFlowClient(config: FmeExportConfig): FmeFlowApiClient {
  const normalizedConfig = normalizeConfigParams(config)
  validateRequiredConfig(normalizedConfig)

  return new FmeFlowApiClient({
    ...normalizedConfig,
    serverUrl: normalizedConfig.serverUrl.replace(/\/$/, ""),
  })
}

export { FmeFlowApiClient as default }
