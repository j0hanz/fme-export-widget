import esriRequest from "esri/request"
import esriConfig from "esri/config"
import * as projection from "esri/geometry/support/webMercatorUtils"

import type {
  FmeFlowConfig,
  FmeExportConfig,
  RequestConfig,
  ApiResponse,
  RepositoryItems,
  WorkspaceParameter,
  JobResponse,
  JobResult,
  UploadWorkspaceParams,
  PrimitiveParams,
} from "./types"
import { FmeFlowApiError, HttpMethod } from "./types"

// API constants
const API = {
  BASE_PATH: "/fmerest/v3",
  MAX_URL_LENGTH: 4000,
  SESSION_ID_RANGE: 1_000_000_000,
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
  DEFAULT_UPLOAD_OPTIONS: {
    opt_extractarchive: "false",
    opt_pathlevel: "3",
    opt_fullpath: "true",
  },
  COMMON_HEADERS: {
    "User-Agent": "ArcGIS-Experience-Builder-FME-Widget/1.0",
    "Content-Type": "application/x-www-form-urlencoded",
  },
} as const

// Extract error information from an unknown error object
function getErrorInfo(err: unknown): {
  message: string
  status?: number
  details?: any
} {
  if (err && typeof err === "object") {
    const anyErr = err as any
    return {
      message:
        typeof anyErr.message === "string"
          ? anyErr.message
          : toStr(anyErr.message),
      status: anyErr.status || anyErr.httpStatus,
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

// Geometry conversion helpers
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
  // If geometry is already in WGS84, return it as is
  if (geometry.spatialReference?.wkid === 3857) {
    return (
      projection.webMercatorToGeographic(geometry as __esri.Polygon) || geometry
    )
  }
  return geometry
}

const makeGeoJson = (polygon: __esri.Polygon) => ({
  type: "Polygon" as const,
  coordinates: polygon.rings as Array<Array<[number, number]>>,
})

const isAuthError = (status: number): boolean =>
  status === 403 || status === 401

const isHtml = (contentType: string | null): boolean =>
  contentType?.includes("text/html") ?? false

const isJson = (contentType: string | null): boolean =>
  contentType?.includes("application/json") ?? false

// Normalize server URL
const normalizeUrl = (serverUrl: string): string =>
  serverUrl.replace(/\/fmeserver$/, "").replace(/\/fmerest$/, "")

// Mask token for logs
const maskToken = (token: string): string =>
  token ? `${token.substring(0, 4)}***` : ""

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

function setApiSettings(config: FmeFlowConfig): void {
  esriConfig.request.maxUrlLength = API.MAX_URL_LENGTH
  const serverDomain = new URL(config.serverUrl).origin

  // Add trusted server
  if (!esriConfig.request.trustedServers.includes(serverDomain)) {
    esriConfig.request.trustedServers.push(serverDomain)
  }

  // Avoid duplicate interceptor
  const hasExistingInterceptor = esriConfig.request.interceptors.some(
    (interceptor) =>
      interceptor.urls &&
      Array.isArray(interceptor.urls) &&
      interceptor.urls.some(
        (url) => typeof url === "string" && url.includes(serverDomain)
      )
  )

  if (!hasExistingInterceptor) {
    esriConfig.request.interceptors.push({
      urls: [serverDomain],
      before: (params) => {
        if (!params.requestOptions.headers) {
          params.requestOptions.headers = {}
        }
        params.requestOptions.headers.Authorization = `fmetoken token=${config.token}`
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

  private addQuery(
    baseEndpoint: string,
    queryParams: { [key: string]: string | boolean }
  ): string {
    const params = buildQuery(queryParams)
    const q = params.toString()
    return q ? `${baseEndpoint}?${q}` : baseEndpoint
  }

  private makeFormData(files: File[] | FileList): FormData {
    const formData = new FormData()
    const fileArray = Array.isArray(files) ? files : Array.from(files)
    for (const file of fileArray) formData.append("files[]", file)
    return formData
  }

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

  private encodePath(path: string): string {
    return encodeURIComponent(path).replace(/%2F/g, "/")
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
      () =>
        this.request<Array<{ name: string }>>(this.repoEndpoint(""), {
          signal,
          cacheHint: true,
        }),
      "Failed to get repositories",
      "REPOSITORIES_ERROR"
    )
  }

  async getRepositoryItems(
    repository?: string,
    type?: "WORKSPACE" | "CUSTOM_FORMAT" | "CUSTOM_TRANSFORMER",
    limit?: number,
    offset?: number,
    signal?: AbortSignal
  ): Promise<ApiResponse<RepositoryItems>> {
    const repo = this.resolveRepository(repository)
    const query = buildQuery({ type, limit, offset })
    const endpoint = this.repoEndpoint(repo, "items")

    return this.request<RepositoryItems>(endpoint, {
      query: Object.fromEntries(query),
      signal,
      cacheHint: true,
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
          cacheHint: true,
        }),
      "Failed to get workspace parameters",
      "PARAMETERS_ERROR"
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
          query: jobRequest,
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
      query: jobRequest,
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
      if (
        error instanceof FmeFlowApiError &&
        error.code === "WEBHOOK_AUTH_ERROR"
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
    repository?: string
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
          "User-Agent": API.COMMON_HEADERS["User-Agent"],
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

  async createUploadSession(
    workspace: string,
    repository?: string
  ): Promise<ApiResponse<{ sessionId: string; url: string }>> {
    const targetRepository = this.resolveRepository(repository)
    const endpoint = this.buildServiceUrl(
      "fmedataupload",
      targetRepository,
      workspace
    )

    return this.withApiError(
      async () => {
        const sessionId = Math.floor(Math.random() * API.SESSION_ID_RANGE) + 1
        const params = buildQuery({
          ...API.DEFAULT_UPLOAD_OPTIONS,
          opt_namespace: sessionId.toString(),
        })

        const response = await this.request(endpoint, {
          method: HttpMethod.POST,
          headers: {
            "Content-Type": API.COMMON_HEADERS["Content-Type"],
          },
          body: params.toString(),
        })

        return {
          ...response,
          data: { sessionId: sessionId.toString(), url: endpoint },
        }
      },
      "Failed to create upload session",
      "UPLOAD_SESSION_ERROR"
    )
  }

  async uploadFiles(
    workspace: string,
    files: File[] | FileList,
    sessionId?: string,
    repository?: string
  ): Promise<ApiResponse<{ submit?: boolean; id?: string; files?: any[] }>> {
    const targetRepository = this.resolveRepository(repository)
    const baseEndpoint = this.buildServiceUrl(
      "fmedataupload",
      targetRepository,
      workspace
    )

    const queryParams = sessionId
      ? { opt_namespace: sessionId, opt_fullpath: "true" }
      : { opt_fullpath: "true" }

    const endpoint = this.addQuery(baseEndpoint, queryParams)

    return this.withApiError(
      () =>
        this.request<{ submit?: boolean; id?: string; files?: any[] }>(
          endpoint,
          {
            method: HttpMethod.POST,
            body: this.makeFormData(files),
          }
        ),
      "Failed to upload files",
      "FILE_UPLOAD_ERROR"
    )
  }

  async getUploadedFiles(
    workspace: string,
    sessionId?: string,
    repository?: string
  ): Promise<ApiResponse<{ files: any[] }>> {
    const targetRepository = this.resolveRepository(repository)
    const baseEndpoint = this.buildServiceUrl(
      "fmedataupload",
      targetRepository,
      workspace
    )

    const endpoint = sessionId
      ? this.addQuery(baseEndpoint, {
          opt_namespace: sessionId,
          opt_fullpath: "true",
        })
      : baseEndpoint

    return this.withApiError(
      () => this.request<{ files: any[] }>(endpoint),
      "Failed to get uploaded files",
      "GET_UPLOADS_ERROR"
    )
  }

  async runWorkspaceWithData(
    workspace: string,
    uploadParams: UploadWorkspaceParams,
    repository?: string
  ): Promise<ApiResponse> {
    const targetRepository = this.resolveRepository(repository)
    const service = uploadParams.service || "fmedatadownload"
    const endpoint = this.buildServiceUrl(service, targetRepository, workspace)
    return this.withApiError(
      () => {
        let params = `${uploadParams.filename}=%22%22`
        uploadParams.files.forEach((file) => {
          params += file.path + "%22%20%22"
        })
        if (uploadParams.params) params += "&" + uploadParams.params
        params += "&opt_responseformat=json"
        return this.request(`${endpoint}?${params}`)
      },
      "Failed to run workspace with data",
      "WORKSPACE_WITH_DATA_ERROR"
    )
  }

  async getResources(): Promise<ApiResponse<any[]>> {
    return this.withApiError(
      () => this.request("/resources/connections"),
      "Failed to get resources",
      "GET_RESOURCES_ERROR"
    )
  }

  async getResourceDetails(resource: string): Promise<ApiResponse> {
    return this.withApiError(
      () => this.request(`/resources/connections/${resource}`),
      "Failed to get resource details",
      "GET_RESOURCE_DETAILS_ERROR"
    )
  }

  async getResourceContents(
    resource: string,
    path: string = "/",
    depth: number = 1
  ): Promise<ApiResponse> {
    const encodedPath = this.encodePath(path)
    return this.withApiError(
      () =>
        this.request(
          `/resources/connections/${resource}/filesys${encodedPath}?depth=${depth}`
        ),
      "Failed to get resource contents",
      "GET_RESOURCE_CONTENTS_ERROR"
    )
  }

  async deleteResource(
    resource: string,
    path: string
  ): Promise<ApiResponse<{ delete: boolean }>> {
    const encodedPath = this.encodePath(path)
    return this.withApiError(
      () =>
        this.request<{ delete: boolean }>(
          `/resources/connections/${resource}/filesys${encodedPath}`,
          {
            method: HttpMethod.DELETE,
          }
        ),
      "Failed to delete resource",
      "DELETE_RESOURCE_ERROR"
    )
  }

  downloadResourceFile(resource: string, path: string): string {
    // Construct the URL for downloading a resource file
    const encodedPath = this.encodePath(path)
    return `${normalizeUrl(this.config.serverUrl)}${this.basePath}/resources/connections/${resource}/filesys${encodedPath}?accept=contents`
  }

  async uploadResourceFile(
    resource: string,
    path: string,
    files: File[] | FileList,
    overwrite: boolean = false,
    createFolders: boolean = false
  ): Promise<ApiResponse> {
    const encodedPath = this.encodePath(path)
    const url = `/resources/connections/${resource}/filesys${encodedPath}?createDirectories=${createFolders}&overwrite=${overwrite}&type=FILE`
    return this.withApiError(
      () =>
        this.request(url, {
          method: HttpMethod.POST,
          body: this.makeFormData(files),
        }),
      "Failed to upload resource file",
      "UPLOAD_RESOURCE_ERROR"
    )
  }

  public generateFormItems(
    containerId: string,
    parameters: WorkspaceParameter[],
    values: PrimitiveParams = {}
  ): HTMLElement[] {
    const container = document.getElementById(containerId)
    if (!container)
      throw new Error(`Container with id '${containerId}' not found`)

    const formItems: HTMLElement[] = []
    const paramArray = Array.isArray(parameters) ? parameters : [parameters]

    paramArray.forEach((param) => {
      const span = document.createElement("span")
      span.className = `${param.name} fmes-form-component`

      const label = document.createElement("label")
      label.innerHTML = param.description || param.name
      span.appendChild(label)

      let input:
        | HTMLElement
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      const defaultVal = param.defaultValue?.toString() || ""

      switch (param.type) {
        case "FILE_OR_URL":
        case "FILENAME_MUSTEXIST":
        case "FILENAME":
          input = this.createInput("file", param.name)
          break

        case "LISTBOX":
        case "LOOKUP_LISTBOX":
          input = document.createElement("div")
          param.listOptions?.forEach((option) => {
            const checkbox = this.createInput(
              "checkbox",
              param.name,
              option.value
            )
            checkbox.checked = checkbox.value === param.defaultValue
            input.appendChild(checkbox)
            const caption = document.createElement("label")
            caption.innerHTML = option.caption
            input.appendChild(caption)
          })
          break

        case "LOOKUP_CHOICE":
        case "STRING_OR_CHOICE":
        case "CHOICE":
          input = document.createElement("select")
          ;(input as HTMLSelectElement).name = param.name
          param.listOptions?.forEach((option) => {
            const opt = document.createElement("option")
            opt.innerHTML = option.caption
            opt.value = option.value
            opt.selected = opt.value === param.defaultValue
            ;(input as HTMLSelectElement).appendChild(opt)
          })
          break

        case "TEXT_EDIT":
          input = document.createElement("textarea")
          ;(input as HTMLTextAreaElement).name = param.name
          ;(input as HTMLTextAreaElement).value = defaultVal
          break

        case "INTEGER":
          input = this.createInput("number", param.name, defaultVal)
          break

        case "FLOAT": {
          const floatInput = this.createInput("number", param.name, defaultVal)
          floatInput.step = "0.01"
          input = floatInput
          break
        }

        case "PASSWORD":
          input = this.createInput("password", param.name)
          break

        case "BOOLEAN": {
          const booleanInput = this.createInput("checkbox", param.name)
          booleanInput.checked = Boolean(param.defaultValue)
          input = booleanInput
          break
        }

        default:
          input = this.createInput("text", param.name, defaultVal)
      }

      input.id = param.name
      if (!param.optional) input.setAttribute("required", "true")

      span.appendChild(input)
      container.appendChild(span)
      formItems.push(span)
    })

    return formItems
  }

  private createInput(
    type: string,
    name: string,
    value?: string
  ): HTMLInputElement {
    const input = document.createElement("input")
    input.type = type
    input.name = name
    if (value) input.value = value
    return input
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
      // If the response is HTML, treat it as an authentication error
      if (isHtml(contentType)) {
        throw new FmeFlowApiError(
          "Webhook authentication failed or returned HTML - falling back to REST API",
          "WEBHOOK_AUTH_ERROR",
          response.status
        )
      }
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

    return {
      MAXX: extent.xmax,
      MAXY: extent.ymax,
      MINX: extent.xmin,
      MINY: extent.ymin,
      AREA: area,
      AreaOfInterest: JSON.stringify(projectedGeometry.toJSON()),
      extent: JSON.stringify(geoJsonPolygon),
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
      const { message, status, details } = getErrorInfo(err)
      let errorMessage = `Request failed: ${message}`
      let errorCode = "NETWORK_ERROR"
      const httpStatus = status || 0
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
      if (details?.error) {
        errorMessage = details.error.message || errorMessage
        errorCode = details.error.code || errorCode
      }
      throw new FmeFlowApiError(errorMessage, errorCode, httpStatus)
    }
  }
}

export function createFmeFlowClient(config: FmeExportConfig): FmeFlowApiClient {
  const normalizedConfig: FmeFlowConfig = {
    serverUrl: config.fmeServerUrl || (config as any).fme_server_url || "",
    token: config.fmeServerToken || (config as any).fmw_server_token || "",
    repository: config.repository || "",
    timeout: config.requestTimeout,
  }

  if (
    !normalizedConfig.serverUrl ||
    !normalizedConfig.token ||
    !normalizedConfig.repository
  ) {
    throw new FmeFlowApiError(
      "Missing required FME Flow configuration. Required: serverUrl (fme_server_url), token (fmw_server_token), and repository",
      "INVALID_CONFIG"
    )
  }

  return new FmeFlowApiClient({
    ...normalizedConfig,
    serverUrl: normalizedConfig.serverUrl.replace(/\/$/, ""),
  })
}

export { FmeFlowApiClient as default }
