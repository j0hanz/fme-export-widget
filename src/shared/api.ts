import esriRequest from "esri/request"
import esriConfig from "esri/config"
import * as projection from "esri/geometry/support/webMercatorUtils"

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

// API constants
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

// Extract error information from an unknown error object
function getErrorInfo(err: unknown): {
  message: string
  status?: number
  details?: unknown
} {
  if (err && typeof err === "object") {
    const anyErr = err as any

    // Try multiple ways to extract status code
    let status =
      anyErr.status ||
      anyErr.httpStatus ||
      anyErr.httpCode ||
      anyErr.code ||
      anyErr.response?.status ||
      anyErr.details?.httpCode

    // If no direct status property, try to extract from message
    if (typeof status !== "number" && typeof anyErr.message === "string") {
      // Match patterns like "Unable to load [URL] status: 401" or "status: 401" or just "401"
      const statusMatch =
        anyErr.message.match(/status:\s*(\d{3})/i) ||
        anyErr.message.match(
          /\b(\d{3})\s*\((?:Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error|Service Unavailable|Gateway)/i
        ) ||
        anyErr.message.match(/\b(\d{3})\b/)
      if (statusMatch) {
        status = parseInt(statusMatch[1], 10)
      }
    }

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

// Convert unknown values to string representation
function toStr(val: unknown): string {
  if (typeof val === "string") return val
  if (typeof val === "number" || typeof val === "boolean") return String(val)
  if (val && typeof val === "object") {
    try {
      return JSON.stringify(val)
    } catch {
      return Object.prototype.toString.call(val)
    }
  }
  return val === undefined
    ? "undefined"
    : val === null
      ? "null"
      : Object.prototype.toString.call(val)
}

// Build endpoint path
const makeEndpoint = (basePath: string, ...segments: string[]): string => {
  const clean = segments.filter(Boolean).join("/")
  return `${basePath}/${clean}`
}

// Build query params
const buildQuery = (
  params: PrimitiveParams = {},
  excludeKeys: string[] = []
): URLSearchParams => {
  const urlParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || excludeKeys.includes(key))
      continue
    urlParams.append(key, toStr(value))
  }
  return urlParams
}

// URL building helpers
const buildWebhook = (
  serverUrl: string,
  service: string,
  repository: string,
  workspace: string
): string => `${normalizeUrl(serverUrl)}/${service}/${repository}/${workspace}`

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

// Normalize server URL
const normalizeUrl = (serverUrl: string): string =>
  serverUrl.replace(/\/fmeserver$/, "").replace(/\/fmerest$/, "")

// Calculate polygon area
const calcArea = (polygon: __esri.Polygon): number => {
  try {
    const extent = polygon.extent
    const widthMeters = extent.width
    const heightMeters = extent.height

    return Math.abs(widthMeters * heightMeters)
  } catch (error) {
    console.warn("Failed to calculate polygon area, using extent area", error)
    const extent = polygon.extent
    return extent.width * extent.height
  }
}

const toWgs84 = (geometry: __esri.Geometry): __esri.Geometry => {
  // Convert Web Mercator to WGS84 if necessary
  if (geometry.spatialReference?.wkid === 3857) {
    return (
      projection.webMercatorToGeographic(geometry as __esri.Polygon) || geometry
    )
  }
  return geometry
}

const makeGeoJson = (polygon: __esri.Polygon) => ({
  type: "Polygon" as const,
  coordinates: (polygon.rings || []).map((ring: any[]) =>
    ring.map((pt: any) => [pt[0], pt[1]] as [number, number])
  ),
})

const isAuthError = (status: number): boolean =>
  status === 403 || status === 401

const isJson = (contentType: string | null): boolean =>
  contentType?.includes("application/json") ?? false

// Mask token for logs (show at most last 4 chars)
const maskToken = (token: string): string =>
  token ? `***${token.slice(-4)}` : ""

function setApiSettings(config: FmeFlowConfig): void {
  esriConfig.request.maxUrlLength = API.MAX_URL_LENGTH
  const serverDomain = new URL(config.serverUrl).origin

  // Avoid duplicate interceptor
  const hasExistingInterceptor = esriConfig.request.interceptors.some(
    (interceptor) => {
      const urls = interceptor.urls as Array<string | RegExp> | undefined
      if (!urls || !Array.isArray(urls)) return false
      return urls.some((url) =>
        typeof url === "string"
          ? url.includes(serverDomain)
          : url.test(serverDomain)
      )
    }
  )

  if (!hasExistingInterceptor) {
    esriConfig.request.interceptors.push({
      urls: [serverDomain],
      before: (params) => {
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

export class FmeFlowApiClient {
  private config: FmeFlowConfig
  private readonly basePath = API.BASE_PATH
  private abortController: AbortController | null = null

  constructor(config: FmeFlowConfig) {
    this.config = config
    setApiSettings(config)
  }

  private resolveRepository(repository?: string): string {
    return repository || this.config.repository
  }

  private buildServiceUrl(
    service: string,
    repository: string,
    workspace: string
  ): string {
    return `${normalizeUrl(this.config.serverUrl)}/${service}/${repository}/${workspace}`
  }

  // addQuery helper removed (unused)

  private formatJobParams(
    parameters: PrimitiveParams = {}
  ):
    | { publishedParameters: Array<{ name: string; value: unknown }> }
    | PrimitiveParams {
    return (parameters as any).publishedParameters
      ? parameters
      : {
          publishedParameters: Object.entries(parameters).map(
            ([name, value]) => ({ name, value })
          ),
        }
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
    setApiSettings(this.config)
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
    try {
      return await this.runDownloadWebhook(
        workspace,
        parameters,
        targetRepository,
        signal
      )
    } catch (error) {
      const isAbort =
        (error as { name?: string } | null | undefined)?.name ===
          "AbortError" || Boolean(signal?.aborted)
      if (
        error instanceof FmeFlowApiError &&
        (error.code === "WEBHOOK_AUTH_ERROR" ||
          (error.code === "DATA_DOWNLOAD_ERROR" && !isAbort))
      ) {
        console.log(
          "FME Export - Webhook authentication failed, falling back to REST API job submission"
        )
        return await this.runDownloadRest(
          workspace,
          parameters,
          targetRepository,
          signal
        )
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
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
      const params = buildWebhookParams(parameters, API.WEBHOOK_EXCLUDE_KEYS)

      const q = params.toString()
      const fullUrl = `${webhookUrl}?${q}`

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

  private async runDownloadRest(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    try {
      console.log(
        "FME Export - Using REST API job submission for data download"
      )

      // Remove webhook-only params
      const jobParameters: PrimitiveParams = { ...parameters }
      for (const key of API.WEBHOOK_EXCLUDE_KEYS)
        delete (jobParameters as any)[key]

      const jobResponse = await this.submitJob(
        workspace,
        jobParameters,
        repository,
        signal
      )

      return {
        data: {
          serviceResponse: {
            statusInfo: {
              status: "success",
              message: "Job submitted for processing",
            },
            jobID: jobResponse.data?.id,
            mode: "async",
            url: undefined,
          },
        },
        status: 200,
        statusText: "OK",
      }
    } catch (err) {
      const { message, status } = getErrorInfo(err)
      throw new FmeFlowApiError(
        `Failed to run data download via REST API: ${message}`,
        "REST_API_FALLBACK_ERROR",
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
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  createAbortController(): AbortController {
    if (this.abortController) this.abortController.abort()
    this.abortController = new AbortController()
    return this.abortController
  }

  private async parseWebhookResponse(response: Response): Promise<ApiResponse> {
    const contentType = response.headers.get("content-type")

    let responseData: any
    if (isJson(contentType)) {
      responseData = await response.json()
      // Check for specific error codes in JSON response
      if (isAuthError(response.status)) {
        throw new FmeFlowApiError(
          "Webhook authentication failed - falling back to REST API",
          "WEBHOOK_AUTH_ERROR",
          response.status
        )
      }
    } else {
      const textContent = await response.text()
      responseData = {
        message: textContent,
        status: response.status,
        contentType: contentType || "text/plain",
      }
      // If the response is not JSON, we assume it's an error
      throw new FmeFlowApiError(
        "Webhook returned a non-JSON response - falling back to REST API",
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
    if (geometry.type !== "polygon") {
      throw new Error("Only polygon geometries are supported")
    }

    const polygon = geometry as __esri.Polygon

    // Calculate area using extent-based approach for SDK 4.29 compatibility
    const area = calcArea(polygon)
    const extent = polygon.extent
    const projectedGeometry = toWgs84(geometry)
    const geoJsonPolygon = makeGeoJson(projectedGeometry as __esri.Polygon)

    // sanitize polygon Esri JSON: drop Z/M and ensure spatialReference
    const aoj = (() => {
      const json = (projectedGeometry as __esri.Polygon).toJSON()
      if (json && Array.isArray(json.rings)) {
        json.rings = json.rings.map((ring: any[]) =>
          ring.map((pt: any) => [pt[0], pt[1]])
        )
      }
      if (json) {
        delete json.hasZ
        delete json.hasM
      }
      if (
        !json?.spatialReference &&
        (projectedGeometry as __esri.Polygon).spatialReference
      ) {
        const sr = (projectedGeometry as __esri.Polygon).spatialReference as any
        json.spatialReference =
          typeof sr.toJSON === "function" ? sr.toJSON() : { wkid: sr.wkid }
      }
      return json
    })()

    return {
      MAXX: extent.xmax,
      MAXY: extent.ymax,
      MINX: extent.xmin,
      MINY: extent.ymin,
      AREA: area,
      AreaOfInterest: JSON.stringify(aoj),
      ExtentGeoJson: JSON.stringify(geoJsonPolygon),
    }
  }

  private async request<T>(
    endpoint: string,
    options: Partial<RequestConfig> = {}
  ): Promise<ApiResponse<T>> {
    let url: string
    if (endpoint.startsWith("http")) {
      url = endpoint
    } else if (endpoint.startsWith("/fme")) {
      url = `${normalizeUrl(this.config.serverUrl)}${endpoint}`
    } else {
      url = `${normalizeUrl(this.config.serverUrl)}${this.basePath}${endpoint}`
    }

    console.log("FME API - Making request to:", url)

    try {
      const headers: { [key: string]: string } = { ...(options.headers || {}) }
      if (this.config.token && !headers.Authorization) {
        headers.Authorization = `fmetoken token=${this.config.token}`
      }
      if (!headers.Accept) {
        headers.Accept = "application/json"
      }
      const requestOptions: any = {
        method: (options.method?.toLowerCase() as any) || "get",
        query: options.query as any,
        responseType: "json",
        headers,
        signal: options.signal,
      }
      if (options.cacheHint !== undefined)
        requestOptions.cacheHint = options.cacheHint
      if (options.body !== undefined) requestOptions.body = options.body
      const response = await esriRequest(url, requestOptions)

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
        return {
          data: undefined as unknown as T,
          status: 0,
          statusText: "Canceled",
        }
      }
      const { message, status, details } = getErrorInfo(err)
      let errorMessage = `Request failed: ${message}`
      let errorCode = "NETWORK_ERROR"
      const httpStatus = status || 0
      // Log the error with masked token
      console.error("FME API - request error", {
        url,
        token: maskToken(this.config.token),
        message,
      })
      if (message.includes("Unexpected token")) {
        console.error(
          "FME API - Received HTML response instead of JSON. URL:",
          url
        )
        errorMessage = `Server returned HTML instead of JSON. This usually indicates an authentication or endpoint issue. URL: ${url}`
        errorCode = "INVALID_RESPONSE_FORMAT"
      }
      const det: any = details as any
      if (det?.error) {
        errorMessage = det.error.message || errorMessage
        errorCode = det.error.code || errorCode
      }
      throw new FmeFlowApiError(errorMessage, errorCode, httpStatus)
    }
  }
}

export function createFmeFlowClient(config: FmeExportConfig): FmeFlowApiClient {
  const normalizedConfig: FmeFlowConfig = {
    serverUrl: config.fmeServerUrl || (config as any).fme_server_url || "",
    token:
      config.fmeServerToken ||
      (config as any).fme_server_token ||
      (config as any).fmw_server_token ||
      "",
    repository: config.repository || "",
    timeout: config.requestTimeout,
  }

  if (
    !normalizedConfig.serverUrl ||
    !normalizedConfig.token ||
    !normalizedConfig.repository
  ) {
    throw new FmeFlowApiError(
      "Missing required FME Flow configuration. Required: serverUrl (fmeServerUrl or fme_server_url), token (fmeServerToken or fme_server_token), and repository",
      "INVALID_CONFIG"
    )
  }

  return new FmeFlowApiClient({
    ...normalizedConfig,
    serverUrl: normalizedConfig.serverUrl.replace(/\/$/, ""),
  })
}

export { FmeFlowApiClient as default }
