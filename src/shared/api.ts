import type {
  PrimitiveParams,
  NetworkConfig,
  InstrumentedRequestOptions,
  RequestLog,
  FmeFlowConfig,
  FmeExportConfig,
  RequestConfig,
  ApiResponse,
  WorkspaceParameter,
  JobResult,
  EsriRequestConfig,
  EsriMockKey,
  AbortListenerRecord,
  WebhookErrorCode,
  TMDirectives,
  NMDirectives,
  WebhookArtifacts,
} from "../config/index"
import {
  FmeFlowApiError,
  HttpMethod,
  ESRI_GLOBAL_MOCK_KEYS,
  FME_FLOW_API,
  TM_NUMERIC_PARAM_KEYS,
  PUBLISHED_PARAM_EXCLUDE_SET,
  WEBHOOK_EXCLUDE_PARAMS,
} from "../config/index"
import {
  extractHttpStatus,
  isRetryableError,
  validateRequiredConfig,
  mapErrorToKey,
} from "./validations"
import {
  buildUrl,
  resolveRequestUrl,
  buildParams,
  createHostPattern,
  interceptorExists,
  safeParseUrl,
  safeLogParams,
  makeScopeId,
  isJson,
  extractHostFromUrl,
  extractErrorMessage,
  isAbortError,
  extractRepositoryNames,
  loadArcgisModules,
} from "./utils"

// Configuration
const DEFAULT_CONFIG: NetworkConfig = {
  enabled: true,
  logLevel: "debug",
  bodyPreviewLimit: 1024,
  warnSlowMs: 1000,
}

const config: NetworkConfig = { ...DEFAULT_CONFIG }

// Core Instrumentation
export function instrumentedRequest<T>(
  options: InstrumentedRequestOptions<T>
): Promise<T> {
  if (!config.enabled) return options.execute()

  const method = options.method.toUpperCase()
  const correlationId = options.correlationId || createCorrelationId()
  const startMs = Date.now()

  return options
    .execute()
    .then((response) => {
      const durationMs = Date.now() - startMs
      const status = options.responseInterpreter?.status?.(response)
      const ok = options.responseInterpreter?.ok?.(response) ?? inferOk(status)
      const responseSize = options.responseInterpreter?.size?.(response)

      const log: RequestLog = {
        timestamp: startMs,
        method,
        url: sanitizeUrl(options.url, options.query),
        path: extractPath(options.url),
        status,
        ok,
        durationMs,
        correlationId,
        caller: options.caller,
        transport: options.transport,
        retryAttempt: options.retryAttempt,
        responseSize,
        isAbort: false,
      }

      logRequest("success", log, options.body)
      return response
    })
    .catch((error) => {
      const durationMs = Date.now() - startMs
      const status = extractHttpStatus(error)
      const isAbort = isAbortError(error)

      const log: RequestLog = {
        timestamp: startMs,
        method,
        url: sanitizeUrl(options.url, options.query),
        path: extractPath(options.url),
        status,
        ok: false,
        durationMs,
        correlationId,
        caller: options.caller,
        transport: options.transport,
        retryAttempt: options.retryAttempt,
        isAbort,
      }

      logRequest("error", log, options.body, error)
      throw error instanceof Error
        ? error
        : new Error(extractErrorMessage(error))
    })
}

export function createCorrelationId(prefix = "net"): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${timestamp}_${random}`
}

// URL & Parameter Sanitization
function sanitizeUrl(
  url: string,
  query?: PrimitiveParams | URLSearchParams | string | null
): string {
  const parsed = parseUrl(url)
  const params = buildSearchParams(parsed, query)
  const sanitized = sanitizeParams(params)
  const search = serializeParams(sanitized)

  if (!parsed) {
    const base = redactSensitiveText(url.split("?")[0] || "")
    return search ? `${base}?${search}` : base
  }

  const base = `${parsed.origin}${parsed.pathname}`
  return search ? `${base}?${search}` : base
}

function parseUrl(url: string): URL | null {
  if (!url) return null
  try {
    const parsed = safeParseUrl(url)
    if (parsed) return parsed
    return new URL(url, "http://localhost")
  } catch {
    return null
  }
}

function extractPath(url: string): string {
  const parsed = parseUrl(url)
  return parsed?.pathname || url.split("?")[0] || url
}

function buildSearchParams(
  parsed: URL | null,
  query?: PrimitiveParams | URLSearchParams | string | null
): URLSearchParams {
  const params = new URLSearchParams(parsed?.search || "")
  if (!query) return params

  if (typeof query === "string") {
    const extra = new URLSearchParams(query)
    extra.forEach((value, key) => {
      params.set(key, value)
    })
    return params
  }

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => {
      params.set(key, value)
    })
    return params
  }

  Object.entries(query).forEach(([key, value]) => {
    if (value == null) return
    if (Array.isArray(value)) {
      params.delete(key)
      value.forEach((v) => {
        params.append(key, String(v))
      })
    } else {
      const stringValue =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value)
      params.set(key, stringValue)
    }
  })

  return params
}

function sanitizeParams(params: URLSearchParams): URLSearchParams {
  const sanitized = new URLSearchParams()
  params.forEach((value, key) => {
    if (isSensitiveKey(key.toLowerCase())) {
      sanitized.set(key, "[TOKEN]")
    } else {
      sanitized.set(key, redactSensitiveText(value))
    }
  })
  return sanitized
}

function serializeParams(params: URLSearchParams): string {
  const entries: Array<[string, string]> = []
  params.forEach((value, key) => entries.push([key, value]))
  entries.sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&")
}

function isSensitiveKey(key: string): boolean {
  return (
    key.includes("token") ||
    key.includes("auth") ||
    key.includes("secret") ||
    key.includes("key") ||
    key.includes("password")
  )
}

function redactSensitiveText(text: string): string {
  let result = text
  result = result.replace(
    /authorization="?[^"]+"?/gi,
    'authorization="[TOKEN]"'
  )
  result = result.replace(/(token|fmetoken)=([^&\s]+)/gi, "$1=[TOKEN]")
  return result
}

// Body Handling
function describeBody(body: unknown): string {
  if (body == null) return ""

  if (typeof body === "string") {
    const sanitized = redactSensitiveText(body)
    return truncate(sanitized, config.bodyPreviewLimit)
  }

  if (typeof body === "object") {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      return "[FormData]"
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return `[Blob:${body.size}]`
    }
    if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
      const size =
        body instanceof ArrayBuffer
          ? body.byteLength
          : body.buffer?.byteLength || 0
      return `[Binary:${size}]`
    }
  }

  try {
    const serialized = JSON.stringify(body)
    const sanitized = redactSensitiveText(serialized)
    return truncate(sanitized, config.bodyPreviewLimit)
  } catch {
    return "[Object]"
  }
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

// Logging
function logRequest(
  phase: "success" | "error",
  log: RequestLog,
  body?: unknown,
  error?: unknown
): void {
  if (config.logLevel === "silent") return

  const bodyPreview = body ? describeBody(body) : undefined
  const errorMessage = error ? extractErrorMessage(error) : undefined

  try {
    if (config.logLevel === "debug") {
      const icon = phase === "success" ? "✓" : "✗"
      const payload: { [key: string]: unknown } = {
        phase,
        method: log.method,
        url: log.url,
        status: log.status,
        durationMs: log.durationMs,
        correlationId: log.correlationId,
        caller: log.caller,
        transport: log.transport,
      }
      if (log.responseSize !== undefined)
        payload.responseSize = log.responseSize
      if (log.retryAttempt !== undefined) payload.retry = log.retryAttempt
      if (log.isAbort) payload.aborted = true
      if (bodyPreview) payload.body = bodyPreview
      if (errorMessage) payload.error = errorMessage

      console.log(`[FME][net] ${icon}`, payload)
    } else if (config.logLevel === "warn") {
      const summary = `[FME][net] ${phase} ${log.method} ${log.path} ${log.status || "?"} ${log.durationMs}ms`
      console.log(summary, {
        correlationId: log.correlationId,
        ...(log.caller && { caller: log.caller }),
      })
    }

    if (log.durationMs >= config.warnSlowMs) {
      console.log("[FME][net] slow", {
        method: log.method,
        path: log.path,
        durationMs: log.durationMs,
        correlationId: log.correlationId,
      })
    }
  } catch {
    // Suppress logging errors
  }
}

// Utilities
function inferOk(status?: number): boolean | undefined {
  if (typeof status !== "number") return undefined
  return status >= 200 && status < 400
}

const createAbortReason = (cause?: unknown): unknown => {
  if (cause !== undefined) return cause
  if (typeof DOMException === "function") {
    return new DOMException("Aborted", "AbortError")
  }
  const error = new Error("Aborted")
  error.name = "AbortError"
  return error
}

const noop = () => undefined

export class AbortControllerManager {
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Map<string, Set<AbortListenerRecord>>()
  private readonly pendingReasons = new Map<string, unknown>()

  register(key: string, controller: AbortController): void {
    if (!key) return

    this.controllers.set(key, controller)

    const pendingReason = this.pendingReasons.get(key)
    if (pendingReason !== undefined) {
      try {
        if (!controller.signal.aborted) {
          controller.abort(pendingReason)
        }
      } catch {
        try {
          controller.abort()
        } catch {}
      } finally {
        this.pendingReasons.delete(key)
      }
    }
  }

  release(key: string, controller?: AbortController | null): void {
    if (!key) return

    const tracked = this.controllers.get(key)
    if (controller && tracked && tracked !== controller) {
      return
    }

    this.controllers.delete(key)
    this.pendingReasons.delete(key)

    const records = this.listeners.get(key)
    if (!records?.size) return

    records.forEach((record) => {
      try {
        record.signal.removeEventListener("abort", record.handler)
      } catch {}
    })
    this.listeners.delete(key)
  }

  abort(key: string, reason?: unknown): void {
    if (!key) return

    const controller = this.controllers.get(key)
    if (!controller) {
      this.pendingReasons.set(key, reason ?? createAbortReason())
      return
    }

    const abortReason = reason ?? createAbortReason()

    try {
      if (!controller.signal.aborted) {
        controller.abort(abortReason)
      }
    } catch {
      try {
        controller.abort()
      } catch {}
    } finally {
      this.release(key, controller)
    }
  }

  linkExternal(key: string, signal?: AbortSignal | null): () => void {
    if (!key || !signal) {
      return noop
    }

    if (signal.aborted) {
      this.abort(key, (signal as { reason?: unknown }).reason)
      return noop
    }

    const record: AbortListenerRecord = {
      signal,
      handler: () => {
        const reason = (signal as { reason?: unknown }).reason
        this.abort(key, reason)
      },
    }

    signal.addEventListener("abort", record.handler)

    let records = this.listeners.get(key)
    if (!records) {
      records = new Set()
      this.listeners.set(key, records)
    }

    records.add(record)

    return () => {
      try {
        signal.removeEventListener("abort", record.handler)
      } catch {}

      const current = this.listeners.get(key)
      if (!current) return
      current.delete(record)
      if (current.size === 0) {
        this.listeners.delete(key)
      }
    }
  }

  abortAll(reason?: unknown): void {
    const entries = Array.from(this.controllers.entries())
    for (const [key, controller] of entries) {
      this.abort(key, reason)
      this.release(key, controller)
    }
  }
}

export const abortManager = new AbortControllerManager()

const isStatusRetryable = (status?: number): boolean => {
  if (!status || status < 100) return true
  if (status >= 500) return true
  return status === 408 || status === 429
}

// Construct a typed FME Flow API error with identical message and code.
const makeFlowError = (code: string, status?: number) =>
  new FmeFlowApiError(code, code, status, isStatusRetryable(status))

// Response interpreters for esriRequest responses
const getEsriResponseStatus = (response: any): number | undefined => {
  const httpStatus = response?.httpStatus
  const status = response?.status
  return typeof httpStatus === "number"
    ? httpStatus
    : typeof status === "number"
      ? status
      : undefined
}

const getEsriResponseOk = (response: any): boolean | undefined => {
  const status = getEsriResponseStatus(response)
  if (typeof status !== "number") return undefined
  return status >= 200 && status < 400
}

const getEsriResponseSize = (response: any): number | undefined => {
  try {
    const data = response?.data
    if (!data) return undefined
    if (typeof data === "string") return data.length
    const serialized = JSON.stringify(data)
    return serialized.length
  } catch {
    return undefined
  }
}

const unwrapModule = (module: unknown): any =>
  (module as any)?.default ?? module

// ArcGIS module references
let _esriRequest: unknown
let _esriConfig: unknown
let _projection: unknown
let _webMercatorUtils: unknown
let _SpatialReference: unknown
let _loadPromise: Promise<void> | null = null
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
    ro.query = ro.query || {}

    const currentToken = getCachedToken(hostKey)
    if (currentToken) {
      if (!ro.query.fmetoken) {
        ro.query.fmetoken = currentToken
      }
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
  maxLen: number = FME_FLOW_API.MAX_URL_LENGTH,
  token?: string
): boolean {
  const { fullUrl } = createWebhookArtifacts(
    serverUrl,
    repository,
    workspace,
    parameters,
    token
  )
  return typeof maxLen === "number" && maxLen > 0 && fullUrl.length > maxLen
}

// helper moved to utils.ts: resolveRequestUrl

// helper moved to utils.ts: buildParams

async function setApiSettings(config: FmeFlowConfig): Promise<void> {
  const esriConfig = await getEsriConfig()
  if (!esriConfig) return

  // Preserve existing platform value; ensure it is at least our safe default.
  // Do not reduce a higher platform-provided limit.
  esriConfig.request.maxUrlLength = Math.max(
    Number(esriConfig.request.maxUrlLength) || 0,
    FME_FLOW_API.MAX_URL_LENGTH
  )
}

// Request Processing Utilities

const toPosInt = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

const normalizeText = (value: unknown, limit: number): string | undefined => {
  const trimmed = toTrimmedString(value)
  return trimmed ? trimmed.slice(0, limit) : undefined
}

const appendWebhookTmParams = (
  params: URLSearchParams,
  source: PrimitiveParams = {}
): void => {
  for (const key of TM_NUMERIC_PARAM_KEYS) {
    const value = toPosInt((source as any)[key])
    if (value !== undefined) params.set(key, String(value))
  }

  const tag = normalizeText((source as any).tm_tag, 128)
  if (tag) params.set("tm_tag", tag)
}

const createWebhookArtifacts = (
  serverUrl: string,
  repository: string,
  workspace: string,
  parameters: PrimitiveParams = {},
  token?: string
): WebhookArtifacts => {
  const baseUrl = buildUrl(serverUrl, "fmedatadownload", repository, workspace)
  const params = buildParams(parameters, [...WEBHOOK_EXCLUDE_PARAMS], true)
  if (token) {
    params.set("token", token)
  }
  appendWebhookTmParams(params, parameters)
  return {
    baseUrl,
    params,
    fullUrl: `${baseUrl}?${params.toString()}`,
  }
}

const buildTMDirectives = (params: any): TMDirectives => {
  const ttc = toPosInt(params?.tm_ttc)
  const ttl = toPosInt(params?.tm_ttl)
  const tag = toTrimmedString(params?.tm_tag)

  const out: TMDirectives = {}
  if (ttc !== undefined) out.ttc = ttc
  if (ttl !== undefined) out.ttl = ttl
  if (tag) out.tag = tag
  return out
}

const buildNMDirectives = (params: any): NMDirectives | null => {
  const serviceMode = params?.opt_servicemode
  if (serviceMode !== "schedule") return null

  const start = toTrimmedString(params?.start)
  const name = toTrimmedString(params?.name)
  const category = toTrimmedString(params?.category)
  const trigger = toTrimmedString(params?.trigger) || "runonce"
  const description = toTrimmedString(params?.description)

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
  private readonly config: FmeFlowConfig
  private readonly basePath = FME_FLOW_API.BASE_PATH
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

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
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

    const publishedParameters = Object.entries(parameters)
      .filter(([name]) => !PUBLISHED_PARAM_EXCLUDE_SET.has(name))
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
      const retryable = isRetryableError(err)
      throw new FmeFlowApiError(errorMessage, errorCode, status || 0, retryable)
    }
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

  async runWorkspace(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    // Detect schedule mode from parameters and route to REST API instead of webhook
    const serviceMode = parameters?.opt_servicemode
    const isScheduleMode = serviceMode === "schedule"

    if (isScheduleMode) {
      // Schedule jobs must use the REST API submit endpoint, not webhooks
      return await this.submitJob(workspace, parameters, repository, signal)
    }

    return await this.runDataDownload(workspace, parameters, repository, signal)
  }

  private async runDownloadWebhook(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    try {
      const {
        baseUrl: webhookUrl,
        params,
        fullUrl,
      } = createWebhookArtifacts(
        this.config.serverUrl,
        repository,
        workspace,
        parameters,
        this.config.token
      )

      const maxLen = getMaxUrlLength()
      if (Number.isFinite(maxLen) && maxLen > 0 && fullUrl.length > maxLen) {
        throw makeError("URL_TOO_LONG", 0)
      }

      // Best-effort safe logging without sensitive params
      safeLogParams(
        "WEBHOOK_CALL",
        webhookUrl,
        params,
        FME_FLOW_API.WEBHOOK_LOG_WHITELIST
      )

      await ensureEsri()
      const esriRequestFn = asEsriRequest(_esriRequest)
      if (!esriRequestFn) {
        throw makeFlowError("ARCGIS_MODULE_ERROR")
      }

      const requestHeaders = {
        Accept: "application/json",
        "Cache-Control": "no-cache",
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

        const response = await instrumentedRequest({
          method: "GET",
          url: fullUrl,
          transport: "fme-webhook",
          query: params,
          correlationId: createCorrelationId("webhook"),
          responseInterpreter: {
            status: getEsriResponseStatus,
            ok: getEsriResponseOk,
            size: getEsriResponseSize,
          },
          execute: () =>
            esriRequestFn(fullUrl, {
              method: "get",
              responseType: "json",
              headers: requestHeaders,
              signal: controller.signal,
              timeout: timeoutMs,
            }),
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

    try {
      // BYPASS INTERCEPTOR - Add FME authentication directly
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
        if (!query.fmetoken) {
          query.fmetoken = this.config.token
        }
        // Add Authorization header with correct FME Flow format
        requestOptions.headers = requestOptions.headers || {}
        requestOptions.headers.Authorization = `fmetoken token=${this.config.token}`
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
        throw makeFlowError("ARCGIS_MODULE_ERROR")
      }

      const correlationId = createCorrelationId("fme")
      const response = await instrumentedRequest({
        method:
          typeof requestOptions.method === "string"
            ? requestOptions.method.toUpperCase()
            : "GET",
        url,
        transport: "fme-flow-api",
        body: requestOptions.body,
        query,
        correlationId,
        responseInterpreter: {
          status: getEsriResponseStatus,
          ok: getEsriResponseOk,
          size: getEsriResponseSize,
        },
        execute: () => esriRequestFn(url, requestOptions),
      })

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
      const retryable = isRetryableError(err)
      const message = extractErrorMessage(err)

      // Determine error code for programmatic identification (simpler logic)
      let errorCode = "REQUEST_FAILED"
      if (message.includes("Unexpected token")) {
        errorCode = "INVALID_RESPONSE_FORMAT"
      }

      // Get user-friendly translation key using centralized error mapping
      const translationKey = mapErrorToKey(err, httpStatus)

      throw new FmeFlowApiError(
        translationKey,
        errorCode,
        httpStatus,
        retryable
      )
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
