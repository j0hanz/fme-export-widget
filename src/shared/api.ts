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
import {
  extractHostFromUrl,
  extractErrorMessage,
  extractHttpStatus,
  isJson,
  maskToken,
  isFileObject,
  getFileDisplayName,
  validateRequiredConfig,
  isAuthError,
  mapErrorToKey,
} from "./validations"

const makeError = (code: string, status?: number) =>
  new FmeFlowApiError(code, code, status)

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
      // Use key only (no fallback English)
      throw new Error("ARCGIS_MODULE_ERROR")
    }
    const loaded = await loader(modules as string[])
    const unwrap = (m: any) => m?.default ?? m
    return (loaded || []).map(unwrap)
  } catch (error) {
    console.error("Failed to load ArcGIS modules:", error)
    // Throw a code that downstream can localize
    throw new Error("ARCGIS_MODULE_ERROR")
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
  _cachedMaxUrlLength = null
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
      console.error("ARCGIS_MODULE_ERROR", { error })
      throw new Error("ARCGIS_MODULE_ERROR")
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

// Add interceptor to append fmetoken to requests to the specified server URL

// Create a regex pattern to match the host in URLs
const createHostPattern = (host: string): RegExp => {
  const escapedHost = host.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
  return new RegExp(`^https?://${escapedHost}`, "i")
}

// Check if an interceptor for the given host pattern already exists
const interceptorExists = (interceptors: any[], pattern: RegExp): boolean => {
  return (
    interceptors?.some((it: any) => {
      return it._fmeInterceptor && it.urls && pattern.test(it.urls.toString())
    }) ?? false
  )
}

async function addFmeInterceptor(
  serverUrl: string,
  token: string
): Promise<void> {
  if (!serverUrl || !token) return
  await ensureEsri()
  const esriConfig = asEsriConfig(_esriConfig)
  if (!esriConfig) return

  const host = extractHostFromUrl(serverUrl)
  if (!host) return

  const pattern = createHostPattern(host)
  if (interceptorExists(esriConfig.request.interceptors, pattern)) return

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
// Cache the result to avoid repeated config lookups
let _cachedMaxUrlLength: number | null = null
const getMaxUrlLength = (): number => {
  if (_cachedMaxUrlLength !== null) return _cachedMaxUrlLength

  const cfg = asEsriConfig(_esriConfig)
  const n = cfg?.request?.maxUrlLength
  _cachedMaxUrlLength = typeof n === "number" && n > 0 ? n : API.MAX_URL_LENGTH
  return _cachedMaxUrlLength
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
      .filter((part) => Boolean(part) && part !== "." && part !== "..")
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

    // Special handling for File objects: use file name instead of full object
    if (isFileObject(value)) {
      urlParams.append(key, getFileDisplayName(value))
      continue
    }

    urlParams.append(key, toStr(value))
  }

  // Add webhook-specific defaults if requested
  if (webhookDefaults) {
    urlParams.append("opt_responseformat", "json")
    urlParams.append("opt_showresult", "true")
    // Default to async unless explicitly set to "sync"
    const raw = (params as any)?.opt_servicemode
    const requested = typeof raw === "string" ? raw.trim().toLowerCase() : ""
    const mode = requested === "sync" ? "sync" : "async"
    urlParams.append("opt_servicemode", mode)
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
  statusText: "requestAborted",
})

export class FmeFlowApiClient {
  private config: FmeFlowConfig
  private readonly basePath = API.BASE_PATH
  private abortController: AbortController | null = null

  constructor(config: FmeFlowConfig) {
    this.config = config
    void setApiSettings(config)
    void addFmeInterceptor(config.serverUrl, config.token)
  }

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
      const status = extractHttpStatus(err)
      throw new FmeFlowApiError(errorMessage, errorCode, status || 0)
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

        // Append token as query param (consistent with webhook auth model)
        let url = serviceUrl
        if (this.config.token) {
          const u = new URL(url, globalThis.location?.origin || "http://d")
          u.searchParams.set("token", this.config.token)
          url = u.toString()
        }

        // Best-effort safe logging without sensitive params
        try {
          const safeParams = new URLSearchParams()
          for (const k of API.WEBHOOK_LOG_WHITELIST) {
            const v = params.get(k)
            if (v !== null) safeParams.set(k, v)
          }
          console.log(
            "STREAMING_CALL",
            url.split("?")[0],
            `params=${safeParams.toString()}`
          )
        } catch {
          /* ignore logging issues */
        }

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal,
        })

        // Non-2xx -> surface as error for consistent handling
        if (!response.ok) {
          throw makeError("DATA_STREAMING_ERROR", response.status)
        }

        // Always read as Blob; callers can decode based on content-type
        const blob = await response.blob()
        const contentType = response.headers.get("content-type")

        // Attempt to extract filename from Content-Disposition header
        const cd = response.headers.get("content-disposition") || ""
        let fileName: string | undefined
        const m = /filename\*=UTF-8''([^;]+)|filename="?([^;"]+)"?/i.exec(cd)
        if (m) {
          const raw = decodeURIComponent(m[1] || m[2] || "").trim()
          fileName = raw || undefined
        }

        return {
          data: { blob, fileName, contentType },
          status: response.status,
          statusText: response.statusText,
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

      try {
        const safeParams = new URLSearchParams()
        for (const k of API.WEBHOOK_LOG_WHITELIST) {
          const v = params.get(k)
          if (v !== null) safeParams.set(k, v)
        }
        console.log(
          "WEBHOOK_CALL",
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
      throw makeError("WEBHOOK_AUTH_ERROR", response.status)
    }

    let responseData: any
    try {
      responseData = await response.json()
    } catch {
      console.warn("FME API - Failed to parse webhook JSON response")
      throw makeError("WEBHOOK_AUTH_ERROR", response.status)
    }

    if (isAuthError(response.status)) {
      throw makeError("WEBHOOK_AUTH_ERROR", response.status)
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

      // Debug logging to help identify error structure
      if (process.env.NODE_ENV !== "production") {
        console.debug("FME API - error structure debug", {
          errorType: typeof err,
          errorKeys: err && typeof err === "object" ? Object.keys(err) : [],
          extractedStatus: httpStatus,
          rawError: err,
        })
      }

      console.error("FME API - request error", {
        url,
        token: maskToken(this.config.token),
        message: extractErrorMessage(err),
        status: httpStatus,
      })

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
