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
} from "./types"
import { FmeFlowApiError, HttpMethod } from "./types"

function configureFmeApiSettings(config: FmeFlowConfig): void {
  esriConfig.request.maxUrlLength = 4000
  const serverDomain = new URL(config.serverUrl).origin
  if (!esriConfig.request.trustedServers.includes(serverDomain)) {
    esriConfig.request.trustedServers.push(serverDomain)
  }

  const existingInterceptor = esriConfig.request.interceptors.find(
    (interceptor) =>
      interceptor.urls &&
      Array.isArray(interceptor.urls) &&
      interceptor.urls.some(
        (url) => typeof url === "string" && url.includes(serverDomain)
      )
  )

  if (!existingInterceptor) {
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
  private readonly basePath = "/fmerest/v3"
  private abortController: AbortController | null = null

  constructor(config: FmeFlowConfig) {
    this.config = config
    configureFmeApiSettings(config)
  }

  private resolveRepository(repository?: string): string {
    return repository || this.config.repository
  }

  private buildServiceUrl(
    service: string,
    repository: string,
    workspace: string
  ): string {
    return `${this.normalizeServerUrl()}/${service}/${repository}/${workspace}`
  }

  private normalizeServerUrl(): string {
    let serverRoot = this.config.serverUrl
    // Remove /fmeserver path as FME Flow REST API v3 doesn't use it
    if (serverRoot.endsWith("/fmeserver"))
      serverRoot = serverRoot.replace("/fmeserver", "")
    if (serverRoot.endsWith("/fmerest"))
      serverRoot = serverRoot.replace("/fmerest", "")
    return serverRoot
  }

  private buildEndpointWithQuery(
    baseEndpoint: string,
    queryParams: { [key: string]: string | boolean }
  ): string {
    const params = new URLSearchParams()
    Object.entries(queryParams).forEach(([key, value]) => {
      params.append(key, String(value))
    })
    return `${baseEndpoint}?${params.toString()}`
  }

  private createUrlSearchParams(
    parameters: { [key: string]: any } = {},
    excludeKeys: string[] = []
  ): URLSearchParams {
    const params = new URLSearchParams()
    Object.entries(parameters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && !excludeKeys.includes(key)) {
        params.append(key, String(value))
      }
    })
    return params
  }

  private createFormData(files: File[] | FileList): FormData {
    const formData = new FormData()
    const fileArray = Array.isArray(files) ? files : Array.from(files)
    fileArray.forEach((file) => {
      formData.append("files[]", file)
    })
    return formData
  }

  private formatJobParameters(parameters: { [key: string]: any } = {}): any {
    return parameters.publishedParameters
      ? parameters
      : {
          publishedParameters: Object.entries(parameters).map(
            ([name, value]) => ({ name, value })
          ),
        }
  }

  private encodeResourcePath(path: string): string {
    return encodeURIComponent(path).replace(/%2F/g, "/")
  }

  private async handleApiError<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    errorCode: string
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw new FmeFlowApiError(
        `${errorMessage}: ${error.message}`,
        errorCode,
        error.status || 0
      )
    }
  }

  updateConfig(config: Partial<FmeFlowConfig>): void {
    this.config = { ...this.config, ...config }
    configureFmeApiSettings(this.config)
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
    return this.request<{ name: string }>(`/repositories/${repo}`, { signal })
  }

  async getRepositories(
    signal?: AbortSignal
  ): Promise<ApiResponse<Array<{ name: string }>>> {
    return this.handleApiError(
      () =>
        this.request<Array<{ name: string }>>("/repositories", {
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
    const query: { [key: string]: any } = {}
    if (type) query.type = type
    if (limit) query.limit = limit
    if (offset) query.offset = offset

    return this.request<RepositoryItems>(`/repositories/${repo}/items`, {
      query,
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
    const endpoint = `/repositories/${repo}/items/${workspace}/parameters`
    return this.handleApiError(
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
    return this.request<WorkspaceParameter>(
      `/repositories/${repo}/items/${workspace}/parameters/${parameter}`,
      { signal, cacheHint: true }
    )
  }

  async getWorkspaceItem(
    workspace: string,
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<any>> {
    const repo = this.resolveRepository(repository)
    return this.handleApiError(
      () =>
        this.request<any>(`/repositories/${repo}/items/${workspace}`, {
          signal,
          cacheHint: true,
        }),
      "Failed to get workspace item details",
      "WORKSPACE_ITEM_ERROR"
    )
  }

  async submitJob(
    workspace: string,
    parameters: { [key: string]: any } = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResponse>> {
    const repo = this.resolveRepository(repository)
    const endpoint = `/transformations/submit/${repo}/${workspace}`
    const jobRequest = this.formatJobParameters(parameters)
    return this.handleApiError(
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
    parameters: { [key: string]: any } = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResult>> {
    const repo = this.resolveRepository(repository)
    const jobRequest = this.formatJobParameters(parameters)
    return this.request<JobResult>(
      `/transformations/transact/${repo}/${workspace}`,
      {
        method: HttpMethod.POST,
        query: jobRequest,
        signal,
      }
    )
  }

  async submitGeometryJob(
    workspace: string,
    geometry: __esri.Geometry,
    parameters: { [key: string]: any } = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResponse>> {
    const geometryParams = await this.convertGeometryToFmeParams(geometry)
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
    return this.request<JobResult>(`/transformations/jobs/${jobId}`, { signal })
  }

  async cancelJob(
    jobId: number,
    signal?: AbortSignal
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>(
      `/transformations/jobs/${jobId}/cancel`,
      {
        method: HttpMethod.POST,
        signal,
      }
    )
  }

  async runDataDownload(
    workspace: string,
    parameters: { [key: string]: any } = {},
    repository?: string
  ): Promise<ApiResponse> {
    const targetRepository = this.resolveRepository(repository)
    try {
      return await this.runDataDownloadWebhook(
        workspace,
        parameters,
        targetRepository
      )
    } catch (error) {
      if (
        error instanceof FmeFlowApiError &&
        error.code === "WEBHOOK_AUTH_ERROR"
      ) {
        console.log(
          "FME Export - Webhook authentication failed, falling back to REST API job submission"
        )
        return await this.runDataDownloadViaRestApi(
          workspace,
          parameters,
          targetRepository
        )
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async runDataStreaming(
    workspace: string,
    parameters: { [key: string]: any } = {},
    repository?: string
  ): Promise<ApiResponse> {
    const targetRepository = this.resolveRepository(repository)
    const endpoint = this.buildServiceUrl(
      "fmedatastreaming",
      targetRepository,
      workspace
    )
    return this.handleApiError(
      async () => {
        const params = this.createUrlSearchParams(parameters)
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

  private async runDataDownloadWebhook(
    workspace: string,
    parameters: { [key: string]: any } = {},
    repository: string
  ): Promise<ApiResponse> {
    try {
      const webhookUrl = this.buildServiceUrl(
        "fmedatadownload",
        repository,
        workspace
      )
      const webhookExcludeKeys = [
        "opt_servicemode",
        "opt_responseformat",
        "opt_showresult",
      ]
      const params = this.createUrlSearchParams(parameters, webhookExcludeKeys)

      params.append("opt_responseformat", "json")
      params.append("opt_showresult", "true")
      params.append("opt_servicemode", parameters.opt_servicemode || "async")

      const fullUrl = `${webhookUrl}?${params.toString()}`
      console.log(
        "FME Export - Webhook URL being called:",
        fullUrl.replace(this.config.token, "***TOKEN***")
      )

      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `fmetoken token=${this.config.token}`,
          "User-Agent": "ArcGIS-Experience-Builder-FME-Widget/1.0",
        },
      })

      return this.parseWebhookResponse(response)
    } catch (error) {
      if (error instanceof FmeFlowApiError) throw error
      throw new FmeFlowApiError(
        `Failed to run data download webhook: ${error.message}`,
        "DATA_DOWNLOAD_ERROR",
        error.status || 0
      )
    }
  }

  private async runDataDownloadViaRestApi(
    workspace: string,
    parameters: { [key: string]: any } = {},
    repository: string
  ): Promise<ApiResponse> {
    try {
      console.log(
        "FME Export - Using REST API job submission for data download"
      )
      const jobParameters: { [key: string]: any } = { ...parameters }
      delete jobParameters.opt_servicemode
      delete jobParameters.opt_responseformat
      delete jobParameters.opt_showresult

      const jobResponse = await this.submitJob(
        workspace,
        jobParameters,
        repository
      )
      return {
        data: {
          status: "success",
          message: "Job submitted successfully via REST API",
          jobID: jobResponse.data.id,
          mode: "async",
          statusInfo: {
            status: "success",
            message: "Job submitted for processing",
          },
        },
        status: 200,
        statusText: "OK",
      }
    } catch (error) {
      throw new FmeFlowApiError(
        `Failed to run data download via REST API: ${error.message}`,
        "REST_API_FALLBACK_ERROR",
        error.status || 0
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
    return this.handleApiError(
      async () => {
        const sessionId = Math.floor(Math.random() * 1000000000) + 1
        const params = this.createUrlSearchParams({
          opt_extractarchive: "false",
          opt_pathlevel: "3",
          opt_fullpath: "true",
          opt_namespace: sessionId.toString(),
        })

        const response = await this.request(endpoint, {
          method: HttpMethod.POST,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

    const endpoint = this.buildEndpointWithQuery(baseEndpoint, queryParams)

    return this.handleApiError(
      () =>
        this.request<{ submit?: boolean; id?: string; files?: any[] }>(
          endpoint,
          {
            method: HttpMethod.POST,
            body: this.createFormData(files),
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
      ? this.buildEndpointWithQuery(baseEndpoint, {
          opt_namespace: sessionId,
          opt_fullpath: "true",
        })
      : baseEndpoint

    return this.handleApiError(
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
    return this.handleApiError(
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
    return this.handleApiError(
      () => this.request("/resources/connections"),
      "Failed to get resources",
      "GET_RESOURCES_ERROR"
    )
  }

  async getResourceDetails(resource: string): Promise<ApiResponse> {
    return this.handleApiError(
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
    const encodedPath = this.encodeResourcePath(path)
    return this.handleApiError(
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
    const encodedPath = this.encodeResourcePath(path)
    return this.handleApiError(
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
    const encodedPath = this.encodeResourcePath(path)
    return `${this.normalizeServerUrl()}${this.basePath}/resources/connections/${resource}/filesys${encodedPath}?accept=contents&token=${this.config.token}`
  }

  async uploadResourceFile(
    resource: string,
    path: string,
    files: File[] | FileList,
    overwrite: boolean = false,
    createFolders: boolean = false
  ): Promise<ApiResponse> {
    const encodedPath = this.encodeResourcePath(path)
    const url = `/resources/connections/${resource}/filesys${encodedPath}?createDirectories=${createFolders}&overwrite=${overwrite}&type=FILE`
    return this.handleApiError(
      () =>
        this.request(url, {
          method: HttpMethod.POST,
          body: this.createFormData(files),
        }),
      "Failed to upload resource file",
      "UPLOAD_RESOURCE_ERROR"
    )
  }

  public generateFormItems(
    containerId: string,
    parameters: WorkspaceParameter[],
    values: { [key: string]: any } = {}
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
    parameters?: { [key: string]: any },
    contentType?: string
  ): Promise<ApiResponse<T>> {
    const headers: { [key: string]: string } = {}
    if (contentType) headers["Content-Type"] = contentType

    let body: any
    let query: { [key: string]: any } | undefined

    if (parameters) {
      if (method.toUpperCase() === "GET") {
        query = parameters
      } else {
        body =
          contentType === "application/x-www-form-urlencoded"
            ? this.createUrlSearchParams(parameters).toString()
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
    const isJson = contentType?.includes("application/json")

    let responseData: any
    if (isJson) {
      responseData = await response.json()
    } else {
      const textContent = await response.text()
      responseData = {
        message: textContent,
        status: response.status,
        contentType: contentType || "text/plain",
      }

      if (contentType?.includes("text/html")) {
        if (response.status === 403) {
          throw new FmeFlowApiError(
            "Webhook authentication failed - falling back to REST API",
            "WEBHOOK_AUTH_ERROR",
            response.status
          )
        } else {
          throw new FmeFlowApiError(
            `FME Data Download service returned HTML instead of JSON. This usually means the webhook URL is incorrect or the service is not properly configured. Response: ${textContent.substring(0, 500)}...`,
            "INVALID_WEBHOOK_RESPONSE",
            response.status
          )
        }
      }
    }

    return {
      data: responseData,
      status: response.status,
      statusText: response.statusText,
    }
  }

  private async convertGeometryToFmeParams(
    geometry: __esri.Geometry
  ): Promise<{ [key: string]: any }> {
    if (geometry.type !== "polygon")
      throw new Error("Only polygon geometries are supported")

    const polygon = geometry as __esri.Polygon
    let area = 0
    try {
      // Use legacy geometryEngine for 4.29 compatibility
      const { loadArcGISJSAPIModules } = await import("jimu-arcgis")
      const [geometryEngine] = await loadArcGISJSAPIModules([
        "esri/geometry/geometryEngine",
      ])

      // Use geodesic area for more accurate calculations
      area = Math.abs(geometryEngine.geodesicArea(polygon, "square-meters"))
    } catch (error) {
      console.warn(
        "Failed to calculate geodetic area, using extent area",
        error
      )
      const extent = polygon.extent
      area = extent.width * extent.height
    }

    const extent = polygon.extent
    let projectedGeometry = geometry
    if (
      geometry.spatialReference.wkid !== 4326 &&
      geometry.spatialReference.wkid !== 3857
    ) {
      if (geometry.spatialReference.wkid === 3857) {
        projectedGeometry =
          projection.webMercatorToGeographic(polygon) || geometry
      }
    }

    const geoJsonPolygon = {
      type: "Polygon",
      coordinates: (projectedGeometry as __esri.Polygon).rings as Array<
        Array<[number, number]>
      >,
    }

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
      url = `${this.normalizeServerUrl()}${endpoint}`
    } else {
      url = `${this.normalizeServerUrl()}${this.basePath}${endpoint}`
    }

    console.log("FME API - Making request to:", url)

    try {
      const headers: { [key: string]: string } = {}

      // Add FME Flow authentication token (fallback if interceptor doesn't work)
      if (this.config.token) {
        headers.Authorization = `fmetoken token=${this.config.token}`
      }

      const response = await esriRequest(url, {
        method: (options.method?.toLowerCase() as any) || "get",
        query: options.query,
        responseType: "json",
        headers,
        signal: options.signal,
        ...(options.cacheHint !== undefined && {
          cacheHint: options.cacheHint,
        }),
      })

      return {
        data: response.data,
        status: response.httpStatus || 200,
        statusText: "OK",
      }
    } catch (error) {
      let errorMessage = `Request failed: ${error.message}`
      let errorCode = "NETWORK_ERROR"
      const status = error.httpStatus || 0

      // Check if we got an HTML response instead of JSON
      if (error.message && error.message.includes("Unexpected token")) {
        console.error(
          "FME API - Received HTML response instead of JSON. URL:",
          url
        )
        console.error("FME API - Full error:", error)
        errorMessage = `Server returned HTML instead of JSON. This usually indicates an authentication or endpoint issue. URL: ${url}`
        errorCode = "INVALID_RESPONSE_FORMAT"
      }

      if (error.details?.error) {
        errorMessage = error.details.error.message || errorMessage
        errorCode = error.details.error.code || errorCode
      }

      throw new FmeFlowApiError(errorMessage, errorCode, status)
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
