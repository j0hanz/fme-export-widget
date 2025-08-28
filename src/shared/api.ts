import type {
  FmeFlowConfig,
  FmeExportConfig,
  RequestConfig,
  ApiResponse,
  WorkspaceParameter,
  JobResponse,
  JobResult,
  PrimitiveParams,
} from "./types"
import { FmeFlowApiError, HttpMethod } from "./types"
import { isAuthError } from "./utils"

// Import ArcGIS JSAPI modules dynamically with runtime helper
let _esriRequest: unknown
let _esriConfig: unknown
let _webMercatorUtils: unknown
let _loadPromise: Promise<void> | null = null

const isTestEnv = (): boolean =>
  typeof process !== "undefined" &&
  !!(process as any).env &&
  (!!(process as any).env.JEST_WORKER_ID ||
    (process as any).env.NODE_ENV === "test")

async function loadArcgisHelper(): Promise<
  (modules: string[]) => Promise<any[]>
> {
  // Try dynamic import first
  try {
    const pkg: any = await import("jimu-arcgis")
    if (pkg && typeof pkg.loadArcGISJSAPIModules === "function") {
      return pkg.loadArcGISJSAPIModules
    }
  } catch {
    console.warn("FME API - Failed to import jimu-arcgis module")
    // ignore and try globals
  }
  const g: any = globalThis as any
  const fn = g.loadArcGISJSAPIModules || g.jimuArcgis?.loadArcGISJSAPIModules
  if (typeof fn === "function") return fn
  throw new Error("loadArcGISJSAPIModules not available")
}

async function ensureEsri(): Promise<void> {
  if (_esriRequest && _esriConfig && _webMercatorUtils) return
  if (_loadPromise) return _loadPromise
  _loadPromise = (async () => {
    try {
      const helper = await loadArcgisHelper()
      const [esriRequest, esriConfig, webMercatorUtils] = await helper([
        "esri/request",
        "esri/config",
        "esri/geometry/support/webMercatorUtils",
      ])
      const reqMod: any = esriRequest
      const cfgMod: any = esriConfig
      const wmMod: any = webMercatorUtils
      _esriRequest = reqMod && reqMod.default ? reqMod.default : reqMod
      _esriConfig = cfgMod && cfgMod.default ? cfgMod.default : cfgMod
      _webMercatorUtils = wmMod && wmMod.default ? wmMod.default : wmMod
    } catch (e) {
      if (isTestEnv()) {
        // Minimal shims for unit tests (no ArcGIS runtime)
        _esriRequest = async (url: string, options: any) => {
          const resp = await fetch(url, {
            method: (options?.method || "get").toUpperCase(),
            headers: options?.headers,
            body: options?.body,
            signal: options?.signal,
          })
          const ct = resp.headers.get("content-type") || ""
          const data = ct.includes("application/json")
            ? await resp.json()
            : await resp.text()
          return { data, httpStatus: resp.status }
        }
        _esriConfig = { request: { maxUrlLength: 4000, interceptors: [] } }
        _webMercatorUtils = {}
      } else {
        _loadPromise = null
        const error = e instanceof Error ? e : new Error(String(e))
        console.error("FME API - Failed to load ArcGIS modules:", error)
        throw error
      }
    }
  })()
  return _loadPromise
}

// ArcGIS Module Validation Utilities
const asEsriRequest = (
  v: unknown
): ((url: string, options: any) => Promise<any>) | null => {
  const fn = v as any
  return typeof fn === "function" ? fn : null
}

const asEsriConfig = (
  v: unknown
): { request: { maxUrlLength: number; interceptors: any[] } } | null => {
  const cfg = v as any
  if (cfg && cfg.request && Array.isArray(cfg.request.interceptors)) return cfg
  return null
}

const asWebMercatorUtils = (
  v: unknown
): { webMercatorToGeographic?: (g: any) => any } | null => {
  const u = v as any
  return u || null
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
// Helper: get max URL length from esriConfig if available, else default
const getMaxUrlLength = (): number => {
  const cfg = asEsriConfig(_esriConfig)
  const n = cfg?.request?.maxUrlLength
  return typeof n === "number" && n > 0 ? n : API.MAX_URL_LENGTH
}

// Error Handling Utilities
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

// URL Building Utilities
const normalizeUrl = (serverUrl: string): string =>
  serverUrl.replace(/\/fme(?:server|rest)$/, "")

const makeEndpoint = (basePath: string, ...segments: string[]): string => {
  const cleanSegments = segments.filter(Boolean).join("/")
  return `${basePath}/${cleanSegments}`
}

const buildServiceUrl = (
  serverUrl: string,
  service: string,
  repository: string,
  workspace: string
): string => `${normalizeUrl(serverUrl)}/${service}/${repository}/${workspace}`

// Alias for webhook URLs (same as buildServiceUrl)
const buildWebhook = buildServiceUrl

const resolveRequestUrl = (
  endpoint: string,
  serverUrl: string,
  basePath: string
): string => {
  if (endpoint.startsWith("http")) {
    return endpoint
  }
  if (endpoint.startsWith("/fme")) {
    return `${normalizeUrl(serverUrl)}${endpoint}`
  }
  return `${normalizeUrl(serverUrl)}${basePath}${endpoint}`
}

// Parameter Building Utilities
const buildQuery = (
  params: PrimitiveParams = {},
  excludeKeys: string[] = []
): URLSearchParams => {
  const urlParams = new URLSearchParams()
  if (!params || typeof params !== "object") return urlParams
  const excludeSet = new Set(excludeKeys)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || excludeSet.has(key)) continue
    urlParams.append(key, toStr(value))
  }
  return urlParams
}

const buildWebhookParams = (
  parameters: PrimitiveParams,
  excludeKeys: readonly string[]
): URLSearchParams => {
  const params = buildQuery(parameters, [...excludeKeys])
  params.append("opt_responseformat", "json")
  params.append("opt_showresult", "true")
  params.append(
    "opt_servicemode",
    (parameters.opt_servicemode as string) || "async"
  )
  return params
}

// Geometry Processing Utilities
const toWgs84 = (geometry: __esri.Geometry): __esri.Geometry => {
  // Convert Web Mercator to WGS84 if necessary
  if (geometry.spatialReference?.wkid === 3857) {
    try {
      const webMercatorUtils = asWebMercatorUtils(_webMercatorUtils)
      if (webMercatorUtils?.webMercatorToGeographic) {
        return webMercatorUtils.webMercatorToGeographic(geometry) || geometry
      }
    } catch (error) {
      console.warn(
        "FME API - Web Mercator conversion failed, using original geometry:",
        error
      )
      // Fall back to original geometry if conversion fails
    }
  }
  return geometry
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
  const serverDomain = new URL(config.serverUrl).origin

  // Avoid duplicate interceptor
  const hasExistingInterceptor = esriConfig.request.interceptors.some(
    (interceptor: any) => {
      const urls = interceptor.urls as Array<string | RegExp> | undefined
      if (!urls || !Array.isArray(urls)) return false
      return urls.some((u: string | RegExp) =>
        typeof u === "string" ? u.includes(serverDomain) : u.test(serverDomain)
      )
    }
  )

  if (!hasExistingInterceptor) {
    esriConfig.request.interceptors.push({
      urls: [serverDomain],
      before: (params: any) => {
        if (!params.requestOptions.headers) {
          params.requestOptions.headers = {}
        }
        params.requestOptions.headers.Authorization = `fmetoken token=${config.token}`
        // Prefer JSON responses to keep parsing deterministic
        if (!params.requestOptions.headers.Accept) {
          params.requestOptions.headers.Accept = "application/json"
        }
        if (!params.requestOptions.responseType) {
          params.requestOptions.responseType = "json"
        }
      },
    })
  }
}

// Request Processing Utilities
const buildRequestHeaders = (
  existingHeaders: { [key: string]: string } = {},
  token?: string
): { [key: string]: string } => {
  const headers = { ...existingHeaders }
  if (token && !headers.Authorization) {
    headers.Authorization = `fmetoken token=${token}`
  }
  if (!headers.Accept) {
    headers.Accept = "application/json"
  }
  return headers
}

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
  }

  private resolveRepository(repository?: string): string {
    return repository || this.config.repository
  }

  private buildServiceUrl(
    service: string,
    repository: string,
    workspace: string
  ): string {
    return buildServiceUrl(
      this.config.serverUrl,
      service,
      repository,
      workspace
    )
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
    return makeEndpoint(this.basePath, "repositories", repository, ...segments)
  }

  // Build transformation endpoint
  private transformEndpoint(
    action: string,
    repository: string,
    workspace: string
  ): string {
    return makeEndpoint(
      this.basePath,
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
        const listEndpoint = makeEndpoint(this.basePath, "repositories")
        const raw = await this.request<any>(listEndpoint, {
          signal,
          cacheHint: true,
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
      cacheHint: true,
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
          cacheHint: true,
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
          cacheHint: true,
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
    const geometryParams = this.toFmeParams(geometry)
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
    const endpoint = makeEndpoint(
      this.basePath,
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
    const endpoint = makeEndpoint(
      this.basePath,
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
        const params = buildQuery(parameters)
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
      const webhookUrl = buildWebhook(
        this.config.serverUrl,
        "fmedatadownload",
        repository,
        workspace
      )
      // For webhook, tm_* must be added as query params directly
      // Exclude tm_* from the initial query build so we can control empty handling
      const params = buildWebhookParams(parameters, [
        ...API.WEBHOOK_EXCLUDE_KEYS,
        "tm_ttc",
        "tm_ttl",
        "tm_tag",
      ])
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
        headers: {
          Accept: "application/json",
          Authorization: `fmetoken token=${this.config.token}`,
        },
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
            ? buildQuery(parameters).toString()
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

  private toFmeParams(geometry: __esri.Geometry): PrimitiveParams {
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

    const projectedGeometry = toWgs84(geometry)
    const geoJsonPolygon = makeGeoJson(projectedGeometry as __esri.Polygon)

    // Sanitize polygon Esri JSON: drop Z/M and ensure spatialReference
    const esriJson = (projectedGeometry as __esri.Polygon).toJSON()
    if (esriJson?.rings) {
      esriJson.rings = esriJson.rings.map((ring: unknown[]) => {
        if (!Array.isArray(ring)) {
          throw new Error("Invalid polygon ring structure - expected array")
        }
        return ring.map((pt: unknown) => {
          if (!Array.isArray(pt) || pt.length < 2) {
            throw new Error(
              "Invalid polygon point structure - expected [x, y] coordinate array"
            )
          }
          const [x, y] = pt as number[]
          if (typeof x !== "number" || typeof y !== "number") {
            throw new Error(
              "Invalid polygon coordinates - expected numeric x,y values"
            )
          }
          return [x, y] as [number, number]
        })
      })
      delete esriJson.hasZ
      delete esriJson.hasM
    }

    if (!esriJson?.spatialReference && projectedGeometry.spatialReference) {
      const sr = projectedGeometry.spatialReference as any
      esriJson.spatialReference = sr.toJSON?.() || { wkid: sr.wkid }
    }

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
      const headers = buildRequestHeaders(options.headers, this.config.token)
      const requestOptions: any = {
        method: (options.method?.toLowerCase() as any) || "get",
        query: options.query as any,
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
        status: response.httpStatus || 200,
        statusText: "OK",
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
