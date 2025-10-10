import type { PrimitiveParams } from "../config/types"
import { extractHttpStatus } from "./validations"
import { extractErrorMessage, isAbortError, safeParseUrl } from "./utils"

// Types
type LogLevel = "silent" | "warn" | "debug"

interface NetworkConfig {
  readonly enabled: boolean
  readonly logLevel: LogLevel
  readonly bodyPreviewLimit: number
  readonly warnSlowMs: number
}

interface InstrumentedRequestOptions<T> {
  method: string
  url: string
  transport: string
  execute: () => Promise<T>
  body?: unknown
  query?: PrimitiveParams | URLSearchParams | string | null
  caller?: string
  correlationId?: string
  retryAttempt?: number
  responseInterpreter?: {
    status?: (response: T) => number | undefined
    ok?: (response: T) => boolean | undefined
    size?: (response: T) => number | undefined
  }
}

interface RequestLog {
  readonly timestamp: number
  readonly method: string
  readonly url: string
  readonly path: string
  readonly status?: number
  readonly ok?: boolean
  readonly durationMs: number
  readonly correlationId: string
  readonly caller?: string
  readonly transport: string
  readonly retryAttempt?: number
  readonly responseSize?: number
  readonly isAbort?: boolean
}

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
