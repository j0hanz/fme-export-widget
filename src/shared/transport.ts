import type { PrimitiveParams, QueryKey } from "../config/types"
import { extractHttpStatus } from "./validations"
import {
  extractErrorMessage,
  isAbortError,
  maskToken,
  safeParseUrl,
} from "./utils"

type LogLevel = "silent" | "warn" | "debug"

interface NetworkMonitorConfig {
  readonly enabled: boolean
  readonly logLevel: LogLevel
  readonly telemetrySampleRate: number
  readonly duplicateWindowMs: number
  readonly previewLimit: number
  readonly summaryLimit: number
  readonly warnDuplicateThreshold: number
  readonly warnBurstThreshold: number
  readonly warnBurstWindowMs: number
  readonly warnDurationMs: number
  readonly warnSizeBytes: number
}

interface InstrumentedRequestOptions<T> {
  method: string
  url: string
  transport: string
  execute: () => Promise<T>
  headers?: Headers | { [key: string]: unknown }
  body?: unknown
  query?: PrimitiveParams | URLSearchParams | string | null
  signal?: AbortSignal
  timeoutMs?: number
  caller?: string
  correlationId?: string
  retryAttempt?: number
  metadata?: { [key: string]: unknown }
  dedupeKey?: string
  responseInterpreter?: {
    status?: (response: T) => number | undefined
    ok?: (response: T) => boolean | undefined
    headers?: (response: T) => Headers | null | undefined
    size?: (response: T) => number | undefined
  }
}

interface RequestLogEntry {
  readonly timestamp: number
  readonly method: string
  readonly url: string
  readonly path: string
  readonly host: string
  readonly status?: number
  readonly ok?: boolean
  readonly durationMs: number
  readonly duplicateCount?: number
  readonly correlationId: string
  readonly queryKeyHash?: string
  readonly caller?: string
  readonly transport: string
  readonly retryAttempt?: number
  readonly responseSize?: number
  readonly alert?: string
  readonly endTimestamp?: number
  readonly requestQueryHash?: string
  readonly requestBodyHash?: string
  readonly metadata?: { [key: string]: unknown }
}

interface DuplicateState {
  count: number
  firstAt: number
  lastAt: number
  method: string
  path: string
}

type QueryEventType =
  | "fetchStart"
  | "retry"
  | "success"
  | "error"
  | "cancel"
  | "cacheHit"
  | "refresh"
  | "stale"
  | "cacheMiss"

interface QueryEventRecord {
  readonly timestamp: number
  readonly type: QueryEventType
  readonly queryKeyHash: string
  readonly correlationId?: string
  readonly attempt?: number
  readonly durationMs?: number
  readonly reason?: string
  readonly error?: string
}

interface QueryContext {
  readonly queryKey: QueryKey
  readonly correlationId: string
  readonly attempt: number
  readonly startedAt: number
}

const isBrowser = typeof window !== "undefined"

const DEFAULT_CONFIG: NetworkMonitorConfig = {
  enabled: true,
  logLevel: "debug",
  telemetrySampleRate: 0,
  duplicateWindowMs: 5000,
  previewLimit: 1024,
  summaryLimit: 60,
  warnDuplicateThreshold: 3,
  warnBurstThreshold: 5,
  warnBurstWindowMs: 15000,
  warnDurationMs: 1000,
  warnSizeBytes: 1_048_576,
}

const config: NetworkMonitorConfig = resolveConfig(DEFAULT_CONFIG)

if (isBrowser && config.enabled) {
  try {
    console.log("[FME][net] Network instrumentation active", {
      logLevel: config.logLevel,
      enabled: config.enabled,
      telemetrySampleRate: config.telemetrySampleRate,
      inspector: "window.__FME_NET_MONITOR__",
    })
  } catch {}
}

const duplicates = new Map<string, DuplicateState>()
const recentRequests: RequestLogEntry[] = []
const recentQueryEvents: QueryEventRecord[] = []
const queryStack: QueryContext[] = []
const activeAttempts = new Map<string, number>()
const burstBuckets = {
  client: [] as number[],
  server: [] as number[],
}

let lastSummaryLog = 0

function sanitizeMetadata(meta?: {
  [key: string]: unknown
}): { [key: string]: unknown } | undefined {
  if (!meta) return undefined
  const sanitized: { [key: string]: unknown } = {}
  let count = 0
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue
    sanitized[key] = formatMetadataValue(value)
    count += 1
    if (count >= 10) break
  }
  return sanitized
}

function formatMetadataValue(value: unknown): string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") return truncate(redactString(value), 256)
  try {
    const serialized = JSON.stringify(value)
    return truncate(redactString(serialized), 256)
  } catch {
    return truncate(redactString(Object.prototype.toString.call(value)), 256)
  }
}

export function instrumentedRequest<T>(
  options: InstrumentedRequestOptions<T>
): Promise<T> {
  if (!config.enabled) return options.execute()

  const method = normalizeMethod(options.method)
  const queryCtx = getCurrentQueryContext()
  const correlationId =
    options.correlationId || queryCtx?.correlationId || createCorrelationId()
  const requestMeta = normalizeRequest(
    method,
    options.url,
    options.query,
    options.body,
    options.dedupeKey
  )

  const duplicateInfo = registerDuplicate(
    requestMeta.dedupeKey,
    method,
    requestMeta.path
  )

  const startMs = Date.now()
  const startPerf = nowPerf()

  return options
    .execute()
    .then((response) => {
      const endMs = Date.now()
      const durationMs = elapsedMs(startMs, endMs, startPerf)
      const status = options.responseInterpreter?.status?.(response)
      const ok = options.responseInterpreter?.ok?.(response) ?? inferOk(status)
      const headers = options.responseInterpreter?.headers?.(response)
      const responseSize =
        options.responseInterpreter?.size?.(response) ?? readContentLength(headers)

      const logEntry: RequestLogEntry = {
        timestamp: startMs,
        endTimestamp: endMs,
        method,
        url: requestMeta.sanitizedUrl,
        path: requestMeta.path,
        host: requestMeta.host,
        status,
        ok,
        durationMs,
        duplicateCount: duplicateInfo.count,
        correlationId,
        queryKeyHash: queryCtx ? hashQueryKey(queryCtx.queryKey) : undefined,
        caller: sanitizeCaller(options.caller),
        transport: options.transport,
        retryAttempt: options.retryAttempt,
        responseSize,
        alert: undefined,
        requestQueryHash: requestMeta.queryHash,
        requestBodyHash: requestMeta.bodyHash,
        metadata: sanitizeMetadata(options.metadata),
      }

      handleAlerts(logEntry)
      appendRecentRequest(logEntry)
      logRequest("success", logEntry, requestMeta.bodyPreview)
      maybeEmitTelemetry(logEntry, requestMeta)
      return response
    })
    .catch((error) => {
      const endMs = Date.now()
      const durationMs = endMs - startMs
      const status = extractHttpStatus(error)
      const logEntry: RequestLogEntry = {
        timestamp: startMs,
        endTimestamp: endMs,
        method,
        url: requestMeta.sanitizedUrl,
        path: requestMeta.path,
        host: requestMeta.host,
        status,
        ok: false,
        durationMs,
        duplicateCount: duplicateInfo.count,
        correlationId,
        queryKeyHash: queryCtx ? hashQueryKey(queryCtx.queryKey) : undefined,
        caller: sanitizeCaller(options.caller),
        transport: options.transport,
        retryAttempt: options.retryAttempt,
        responseSize: undefined,
        alert: isAbortError(error) ? "abort" : undefined,
        requestQueryHash: requestMeta.queryHash,
        requestBodyHash: requestMeta.bodyHash,
        metadata: sanitizeMetadata(options.metadata),
      }

      handleErrorAlerts(logEntry)
      appendRecentRequest(logEntry)
      logRequest("error", logEntry, requestMeta.bodyPreview, error)
      maybeEmitTelemetry(logEntry, requestMeta, error)
      throw error instanceof Error ? error : new Error(extractErrorMessage(error))
    })
}

export function recordQueryEvent(event: {
  type: QueryEventType
  queryKey: QueryKey
  correlationId?: string
  attempt?: number
  durationMs?: number
  reason?: string
  error?: unknown
}): void {
  if (!config.enabled) return
  const timestamp = Date.now()
  const queryKeyHash = hashQueryKey(event.queryKey)
  if (event.type === "fetchStart" || event.type === "retry") {
    const key = makeAttemptKey(event.correlationId, event.attempt)
    if (key) activeAttempts.set(key, timestamp)
  }

  let computedDuration = event.durationMs
  if (event.type === "success" || event.type === "error" || event.type === "cancel") {
    const key = makeAttemptKey(event.correlationId, event.attempt)
    if (key && activeAttempts.has(key)) {
      const startedAt = activeAttempts.get(key) || timestamp
      computedDuration = timestamp - startedAt
      activeAttempts.delete(key)
    }
  }

  const record: QueryEventRecord = {
    timestamp,
    type: event.type,
    queryKeyHash,
    correlationId: event.correlationId,
    attempt: event.attempt,
    durationMs: computedDuration,
    reason: sanitizeReason(event.reason),
    error: event.error ? sanitizeReason(extractErrorMessage(event.error)) : undefined,
  }

  recentQueryEvents.push(record)
  trimArray(recentQueryEvents, config.summaryLimit)
  logQuery(record)
}

export async function runWithQueryContext<T>(
  context: QueryContext,
  fn: () => Promise<T>
): Promise<T> {
  queryStack.push(context)
  try {
    return await fn()
  } finally {
    queryStack.pop()
  }
}

export function createCorrelationId(prefix = "net"): string {
  const base = `${prefix}_${Date.now().toString(36)}`
  const rand = Math.random().toString(36).slice(2, 10)
  return `${base}_${rand}`
}

export function getCurrentQueryContext(): QueryContext | null {
  if (!queryStack.length) return null
  return queryStack[queryStack.length - 1]
}

export function getNetworkMonitorConfig(): NetworkMonitorConfig {
  return config
}

export function getRecentNetworkRequests(): readonly RequestLogEntry[] {
  return recentRequests.slice()
}

export function getDuplicateSummary(): ReadonlyArray<{
  readonly method: string
  readonly path: string
  readonly count: number
  readonly firstAt: number
  readonly lastAt: number
}> {
  cleanupDuplicates()
  const entries: Array<{ method: string; path: string; count: number; firstAt: number; lastAt: number }> = []
  duplicates.forEach((value) => {
    if (value.count > 1) {
      entries.push({
        method: value.method,
        path: value.path,
        count: value.count,
        firstAt: value.firstAt,
        lastAt: value.lastAt,
      })
    }
  })
  return entries.sort((a, b) => b.count - a.count)
}

export function getRecentQueryEvents(): readonly QueryEventRecord[] {
  return recentQueryEvents.slice()
}

if (isBrowser) {
  const globalAny = window as any
  const inspector = {
    config,
    requests: getRecentNetworkRequests,
    duplicates: getDuplicateSummary,
    queries: getRecentQueryEvents,
    printSummary: () => {
      const summary = getDuplicateSummary()
      if (summary.length) console.log(summary)
      else console.log("[FME][net] No duplicate requests detected")
    },
    printRequests: () => {
      const requests = getRecentNetworkRequests()
      if (requests.length) console.log(requests)
      else console.log("[FME][net] No requests captured yet")
    },
    printQueries: () => {
      const queries = getRecentQueryEvents()
      if (queries.length) console.log(queries)
      else console.log("[FME][net] No query events captured yet")
    },
    enableDebug: () => {
      ;(config as any).logLevel = "debug"
      console.log("[FME][net] Debug logging enabled. Refresh to apply from start.")
    },
    disableDebug: () => {
      ;(config as any).logLevel = "warn"
      console.log("[FME][net] Debug logging disabled")
    },
    clear: () => {
      recentRequests.length = 0
      recentQueryEvents.length = 0
      duplicates.clear()
      burstBuckets.client.length = 0
      burstBuckets.server.length = 0
      console.log("[FME][net] Cleared all tracking data")
    },
  }
  if (!globalAny.__FME_NET_MONITOR__) {
    globalAny.__FME_NET_MONITOR__ = inspector
    console.log(
      "[FME][net] Inspector loaded. Try:",
      "\n  __FME_NET_MONITOR__.printSummary()",
      "\n  __FME_NET_MONITOR__.printRequests()",
      "\n  __FME_NET_MONITOR__.enableDebug()"
    )
  }
}

function resolveConfig(base: NetworkMonitorConfig): NetworkMonitorConfig {
  // Allow optional window overrides, but do NOT allow disabling logging via env/prod.
  const overrides: { [key: string]: unknown } = {}
  if (isBrowser) {
    const globalAny = window as any
    const cfg = globalAny.__FME_NET_CONFIG__
    if (cfg && typeof cfg === "object") {
      for (const [key, value] of Object.entries(cfg)) {
        if (key in base) (overrides as any)[key] = value
      }
    }
  }
  const next = { ...base, ...overrides } as NetworkMonitorConfig
  // Hard guarantees: logging stays enabled and at least warn. Default is debug.
  next.enabled = true
  if (next.logLevel === "silent") next.logLevel = "warn"
  return next
}

function normalizeMethod(method: string): string {
  return (method || "GET").toUpperCase()
}

function nowPerf(): number | null {
  try {
    if (typeof performance !== "undefined" && performance.now) return performance.now()
  } catch {}
  return null
}

function elapsedMs(startMs: number, endMs: number, startPerf: number | null): number {
  if (startPerf != null) {
    try {
      const now = performance.now()
      return Math.max(0, now - startPerf)
    } catch {}
  }
  return Math.max(0, endMs - startMs)
}

function inferOk(status?: number): boolean | undefined {
  if (typeof status !== "number") return undefined
  return status >= 200 && status < 400
}

function normalizeRequest(
  method: string,
  url: string,
  query: PrimitiveParams | URLSearchParams | string | null | undefined,
  body: unknown,
  dedupeKey?: string
): {
  sanitizedUrl: string
  path: string
  host: string
  queryHash: string
  bodyHash: string
  bodyPreview?: string
  dedupeKey: string
} {
  const parsed = parseUrl(url)
  const params = buildSearchParams(parsed, query)
  const sanitizedParams = sanitizeParams(params)
  const search = serializedParams(sanitizedParams)
  const sanitizedUrl = buildSanitizedUrl(parsed, search, url)
  const bodyInfo = describeBody(body)
  const key =
    dedupeKey ||
    hashString(`${method}::${sanitizedUrl}::${bodyInfo.hash || "none"}`)

  return {
    sanitizedUrl,
    path: parsed?.pathname || url,
    host: parsed?.host || "",
    queryHash: hashString(search || ""),
    bodyHash: bodyInfo.hash,
    bodyPreview: bodyInfo.preview,
    dedupeKey: key,
  }
}

function parseUrl(url: string): URL | null {
  if (!url) return null
  try {
    return (
      safeParseUrl(url) ||
      (isBrowser && window.location?.origin
        ? new URL(url, window.location.origin)
        : new URL(url, "http://localhost"))
    )
  } catch {
    return null
  }
}

function buildSearchParams(
  parsed: URL | null,
  query: PrimitiveParams | URLSearchParams | string | null | undefined
): URLSearchParams {
  const params = new URLSearchParams(parsed?.search || "")
  if (!query) return params

  if (typeof query === "string") {
    const extra = new URLSearchParams(query)
    extra.forEach((value, key) => params.set(key, value))
    return params
  }

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => params.set(key, value))
    return params
  }

  Object.entries(query).forEach(([key, value]) => {
    if (value == null) return
    if (Array.isArray(value)) {
      params.delete(key)
      value.forEach((v) => {
        params.append(key, toShortString(v))
      })
      return
    }
    params.set(key, toShortString(value))
  })
  return params
}

function sanitizeParams(params: URLSearchParams): URLSearchParams {
  const sanitized = new URLSearchParams()
  params.forEach((value, key) => {
    const sanitizedKey = key.toLowerCase()
    if (shouldRedactKey(sanitizedKey)) {
      sanitized.set(key, "[TOKEN]")
      return
    }
    sanitized.set(key, redactString(value))
  })
  return sanitized
}

function serializedParams(params: URLSearchParams): string {
  const entries: Array<[string, string]> = []
  params.forEach((value, key) => entries.push([key, value]))
  entries.sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
}

function buildSanitizedUrl(parsed: URL | null, search: string, originalUrl: string): string {
  if (!parsed) {
    const baseRaw = typeof originalUrl === "string" ? originalUrl.split("?")[0] : ""
    const base = baseRaw ? redactString(baseRaw) : ""
    if (search) return base ? `${base}?${search}` : `?${search}`
    return base || redactString(originalUrl)
  }
  const base = `${parsed.origin}${parsed.pathname}`
  return search ? `${base}?${search}` : base
}

function describeBody(body: unknown): { hash: string; preview?: string } {
  if (body == null) return { hash: "" }

  if (typeof body === "string") {
    const sanitized = redactString(body)
    return { hash: hashString(sanitized), preview: truncate(sanitized, config.previewLimit) }
  }

  if (typeof body === "object") {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const parts: string[] = []
      body.forEach((value, key) => parts.push(`${key}=${describeFormValue(value)}`))
      const joined = parts.join("&")
      return { hash: hashString(joined), preview: truncate(joined, config.previewLimit) }
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
      const size = typeof body.size === "number" ? body.size : 0
      const name = (body as any)?.name
      const descriptor = `blob(${size})${name ? `:${maskToken(String(name))}` : ""}`
      return { hash: hashString(descriptor), preview: descriptor }
    }

    if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
      const size = body instanceof ArrayBuffer ? body.byteLength : body.buffer?.byteLength
      const descriptor = `binary(${size || 0})`
      return { hash: hashString(descriptor), preview: descriptor }
    }
  }

  try {
    const serialized = JSON.stringify(body)
    const sanitized = redactString(serialized)
    return { hash: hashString(sanitized), preview: truncate(sanitized, config.previewLimit) }
  } catch {}

  const fallback = Object.prototype.toString.call(body)
  const sanitized = redactString(fallback)
  return { hash: hashString(sanitized), preview: truncate(sanitized, config.previewLimit) }
}

function describeFormValue(value: any): string {
  if (value == null) return "null"
  if (typeof value === "string") return truncate(redactString(value), 128)
  if (typeof value === "number" || typeof value === "boolean") return value.toString()
  if (typeof File !== "undefined" && value instanceof File) {
    return `file(${maskToken(value.name) || "blob"}:${value.size})`
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) return `blob(${value.size})`
  return truncate(redactString(Object.prototype.toString.call(value)), 128)
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function toShortString(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return value.toString()
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function appendRecentRequest(entry: RequestLogEntry): void {
  recentRequests.push(entry)
  trimArray(recentRequests, config.summaryLimit)
}

function trimArray(items: unknown[], max: number): void {
  if (items.length <= max) return
  items.splice(0, items.length - max)
}

function logRequest(
  phase: "success" | "error",
  entry: RequestLogEntry,
  bodyPreview?: string,
  error?: unknown
): void {
  const payload: { [key: string]: unknown } = {
    phase,
    method: entry.method,
    url: entry.url,
    status: entry.status,
    durationMs: entry.durationMs,
    duplicateCount: entry.duplicateCount,
    correlationId: entry.correlationId,
    caller: entry.caller,
    transport: entry.transport,
  }
  if (entry.endTimestamp !== undefined) payload.endedAt = entry.endTimestamp
  if (entry.responseSize !== undefined) payload.responseSize = entry.responseSize
  if (entry.queryKeyHash) payload.queryKey = entry.queryKeyHash
  if (entry.requestQueryHash) payload.queryHash = entry.requestQueryHash
  if (entry.requestBodyHash) payload.bodyHash = entry.requestBodyHash
  if (entry.metadata) payload.metadata = entry.metadata
  if (bodyPreview) payload.body = bodyPreview
  if (error) payload.error = sanitizeReason(extractErrorMessage(error))

  try {
    if (config.logLevel === "debug") {
      const icon = phase === "success" ? "✓" : "✗"
      console.log(`[FME][net] ${icon}`, payload)
    } else if (config.logLevel === "warn") {
      const summary = `[FME][net] ${phase} ${entry.method} ${entry.path} ${entry.status || "?"} ${entry.durationMs}ms`
      console.log(summary, { correlationId: entry.correlationId, caller: entry.caller })
    }
  } catch {}

  if (entry.duplicateCount && entry.duplicateCount > 1) {
    maybeLogSummary()
  }
}

function logQuery(record: QueryEventRecord): void {
  if (config.logLevel === "silent") return
  try {
    if (config.logLevel === "debug") {
      console.log("[FME][query]", record)
    } else {
      const summary = `[FME][query] ${record.type} ${record.queryKeyHash.slice(0, 8)}`
      console.log(summary, { correlationId: record.correlationId, attempt: record.attempt })
    }
  } catch {}
}

function sanitizeReason(value?: string): string | undefined {
  if (!value) return undefined
  return redactString(value)
}

function sanitizeCaller(value?: string): string | undefined {
  if (!value) return undefined
  return value
}

function redactString(value: string): string {
  let result = value
  result = result.replace(/authorization="?[^"]+"?/gi, 'authorization="[TOKEN]"')
  result = result.replace(/token=([^&\s]+)/gi, "token=[TOKEN]")
  result = result.replace(/fmetoken=([^&\s]+)/gi, "fmetoken=[TOKEN]")
  return result
}

function shouldRedactKey(key: string): boolean {
  return (
    key.includes("token") ||
    key.includes("auth") ||
    key.includes("secret") ||
    key.includes("key")
  )
}

function readContentLength(headers: Headers | null | undefined): number | undefined {
  if (!headers) return undefined
  try {
    const raw = headers.get("content-length")
    if (!raw) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function registerDuplicate(
  key: string,
  method: string,
  path: string
): { duplicate: boolean; count: number } {
  cleanupDuplicates()
  const existing = duplicates.get(key)
  const now = Date.now()
  if (existing && now - existing.lastAt <= config.duplicateWindowMs) {
    existing.count += 1
    existing.lastAt = now
    if (existing.count >= config.warnDuplicateThreshold) {
      warnDuplicate(method, path, existing.count)
    }
    return { duplicate: true, count: existing.count }
  }

  duplicates.set(key, { count: 1, firstAt: now, lastAt: now, method, path })
  return { duplicate: false, count: 1 }
}

function cleanupDuplicates(): void {
  const now = Date.now()
  duplicates.forEach((value, key) => {
    if (now - value.lastAt > config.duplicateWindowMs) duplicates.delete(key)
  })
}

function warnDuplicate(method: string, path: string, count: number): void {
  if (config.logLevel === "silent") return
  try {
    console.log("[FME][net] duplicate", { method, path, count })
  } catch {}
}

function maybeLogSummary(): void {
  const now = Date.now()
  if (now - lastSummaryLog < 2000) return
  lastSummaryLog = now
  const summary = getDuplicateSummary()
  if (!summary.length) return
  try {
    console.log(summary)
  } catch {}
}

function handleAlerts(entry: RequestLogEntry): void {
  if (config.logLevel === "silent") return
  if (entry.durationMs >= config.warnDurationMs) warnSlow(entry)
  if (typeof entry.responseSize === "number" && entry.responseSize >= config.warnSizeBytes) {
    warnLarge(entry)
  }
  if (entry.status) registerStatus(entry.status)
}

function handleErrorAlerts(entry: RequestLogEntry): void {
  if (config.logLevel === "silent") return
  registerStatus(entry.status)
}

function warnSlow(entry: RequestLogEntry): void {
  try {
    console.log("[FME][net] slow", {
      method: entry.method,
      path: entry.path,
      durationMs: entry.durationMs,
      correlationId: entry.correlationId,
    })
  } catch {}
}

function warnLarge(entry: RequestLogEntry): void {
  try {
    console.log("[FME][net] large-response", {
      method: entry.method,
      path: entry.path,
      size: entry.responseSize,
    })
  } catch {}
}

function registerStatus(status?: number): void {
  if (typeof status !== "number") return
  const now = Date.now()
  if (status >= 500) {
    burstBuckets.server.push(now)
    pruneBurst("server", config.warnBurstWindowMs)
    if (burstBuckets.server.length >= config.warnBurstThreshold) warnBurst("5xx", burstBuckets.server.length)
  } else if (status >= 400) {
    burstBuckets.client.push(now)
    pruneBurst("client", config.warnBurstWindowMs)
    if (burstBuckets.client.length >= config.warnBurstThreshold) warnBurst("4xx", burstBuckets.client.length)
  }
}

function pruneBurst(bucket: "client" | "server", windowMs: number): void {
  const cutoff = Date.now() - windowMs
  const times = burstBuckets[bucket]
  while (times.length && times[0] < cutoff) times.shift()
}

function warnBurst(label: string, count: number): void {
  try {
    console.log("[FME][net] error burst", { label, count })
  } catch {}
}

function maybeEmitTelemetry(
  entry: RequestLogEntry,
  requestMeta: { queryHash: string; bodyHash: string },
  error?: unknown
): void {
  if (config.telemetrySampleRate <= 0) return
  if (Math.random() > config.telemetrySampleRate) return

  const payload: { [key: string]: unknown } = {
    correlationId: entry.correlationId,
    method: entry.method,
    path: entry.path,
    host: entry.host,
    status: entry.status,
    ok: entry.ok,
    durationMs: entry.durationMs,
    duplicateCount: entry.duplicateCount,
    responseSize: entry.responseSize,
    queryHash: requestMeta.queryHash,
    bodyHash: requestMeta.bodyHash,
    transport: entry.transport,
    retryAttempt: entry.retryAttempt,
  }
  if (entry.queryKeyHash) payload.queryKey = entry.queryKeyHash
  if (error) payload.error = sanitizeReason(extractErrorMessage(error))

  emitTelemetry("net.request", payload)
}

function emitTelemetry(event: string, payload: { [key: string]: unknown }): void {
  if (!isBrowser) return
  const globalAny = (window as any)
  const candidate = globalAny?.fmeTelemetry || globalAny?.telemetry || globalAny?.appInsights || globalAny?.jimuTelemetry
  if (!candidate) return
  try {
    if (typeof candidate.emit === "function") candidate.emit(event, payload)
    else if (typeof candidate.trackEvent === "function") candidate.trackEvent({ name: event }, payload)
  } catch {}
}

function hashQueryKey(key: QueryKey): string {
  try {
    return hashString(JSON.stringify(key))
  } catch {
    return hashString(Object.prototype.toString.call(key))
  }
}

function makeAttemptKey(correlationId?: string, attempt?: number): string | null {
  if (!correlationId || typeof attempt !== "number") return null
  return `${correlationId}#${attempt}`
}
