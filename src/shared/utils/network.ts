import { SessionManager } from "jimu-core"
import type { FmeExportConfig, PrimitiveParams } from "../../config/index"
import { DEFAULT_REPOSITORY, EMAIL_REGEX } from "../../config/index"
import type FmeFlowApiClient from "../api"
import { createFmeFlowClient } from "../api"
import { coerceFormValueForSubmission, getFileDisplayName } from "./form"
import {
  isFileObject,
  toStr,
  toTrimmedString,
  toNonEmptyTrimmedString,
} from "./conversion"

export const maskToken = (token: string): string => {
  if (!token) return ""
  if (token.length <= 4) return "*".repeat(token.length)
  if (token.length <= 8)
    return `${token.slice(0, 2)}${"*".repeat(token.length - 4)}${token.slice(-2)}`
  return `${token.slice(0, 4)}${"*".repeat(Math.max(4, token.length - 8))}${token.slice(-4)}`
}

export const buildTokenCacheKey = (token?: string): string => {
  const trimmed = toTrimmedString(token)
  if (!trimmed) return "token:none"

  let hash = 0
  for (let i = 0; i < trimmed.length; i += 1) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0
  }

  return `token:${hash.toString(36)}`
}

export const createFmeClient = (
  serverUrl?: string,
  token?: string,
  repository?: string,
  timeout?: number
): FmeFlowApiClient | null => {
  const normalizedUrl = toTrimmedString(serverUrl)
  const normalizedToken = toTrimmedString(token)
  if (!normalizedUrl || !normalizedToken) {
    return null
  }

  const config: FmeExportConfig = {
    fmeServerUrl: normalizedUrl,
    fmeServerToken: normalizedToken,
    repository: toTrimmedString(repository) || DEFAULT_REPOSITORY,
    ...(Number.isFinite(timeout) ? { requestTimeout: timeout } : {}),
  }

  try {
    return createFmeFlowClient(config)
  } catch {
    return null
  }
}

export const getClientConnectionInfo = (
  client: FmeFlowApiClient | null | undefined
): {
  readonly serverUrl: string
  readonly repository: string
  readonly tokenHash: string
} | null => {
  if (!client) return null
  const rawConfig = (Reflect.get(client as object, "config") ?? null) as {
    serverUrl?: unknown
    repository?: unknown
    token?: unknown
  } | null
  if (!rawConfig) return null

  const serverUrl = toTrimmedString(rawConfig.serverUrl)
  if (!serverUrl) return null

  const repository = toTrimmedString(rawConfig.repository) || DEFAULT_REPOSITORY
  const tokenHash = buildTokenCacheKey(
    typeof rawConfig.token === "string" ? rawConfig.token : undefined
  )

  return { serverUrl, repository, tokenHash }
}

export const buildUrl = (serverUrl: string, ...segments: string[]): string =>
  _composeUrl(serverUrl, segments)

const _composeUrl = (base: string, segments: string[]): string => {
  const normalizedBase = base
    .replace(/\/(?:fmeserver|fmerest)$/i, "")
    .replace(/\/$/, "")

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

  return path ? `${normalizedBase}/${path}` : normalizedBase
}

export const buildParams = (
  params: PrimitiveParams = {},
  excludeKeys: string[] = [],
  webhookDefaults = false
): URLSearchParams => {
  const urlParams = new URLSearchParams()
  if (typeof params !== "object" || params === null) return urlParams

  const excludeSet = new Set(excludeKeys)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || excludeSet.has(key)) continue

    const normalized = coerceFormValueForSubmission(value)
    if (normalized === undefined || normalized === null) continue

    if (isFileObject(normalized)) {
      urlParams.append(key, getFileDisplayName(normalized))
      continue
    }

    const normalizedText = toNonEmptyTrimmedString(normalized)
    if (normalizedText) {
      urlParams.append(key, normalizedText)
    } else {
      urlParams.append(key, toStr(normalized))
    }
  }

  if (webhookDefaults) {
    const getRaw = (key: string): string => {
      const existing = urlParams.get(key)
      if (existing !== null) {
        return existing
      }
      const raw = (params as any)?.[key]
      return typeof raw === "string" ? raw : ""
    }

    const formatRaw = getRaw("opt_responseformat").trim().toLowerCase()
    const normalizedFormat = formatRaw === "xml" ? "xml" : "json"
    urlParams.set("opt_responseformat", normalizedFormat)

    const showRaw = getRaw("opt_showresult").trim().toLowerCase()
    const normalizedShow = showRaw === "false" ? "false" : "true"
    urlParams.set("opt_showresult", normalizedShow)

    const modeRaw = getRaw("opt_servicemode").trim().toLowerCase()
    const normalizedMode = modeRaw === "sync" ? "sync" : "async"
    urlParams.set("opt_servicemode", normalizedMode)
  }

  return urlParams
}

export const safeLogParams = (
  _label: string,
  _url: string,
  _params: URLSearchParams,
  _whitelist: readonly string[]
): void => {
  void (_label, _url, _params, _whitelist)
}

export const createHostPattern = (host: string): RegExp => {
  const escapedHost = host.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
  return new RegExp(`^https?://${escapedHost}`, "i")
}

export const interceptorExists = (
  interceptors: any[],
  pattern: RegExp
): boolean => {
  return (
    interceptors?.some((it: any) => {
      if (!it || !it._fmeInterceptor) return false
      const rx: any = it.urls
      if (rx instanceof RegExp) {
        return rx.source === pattern.source && rx.flags === pattern.flags
      }
      const s = typeof rx === "string" ? rx : String(rx || "")
      return pattern.test(s)
    }) ?? false
  )
}

export function makeScopeId(
  serverUrl: string,
  token: string,
  repository?: string
): string {
  const s = `${serverUrl}::${token || ""}::${repository || ""}`
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
  }
  const n = Math.abs(h >>> 0)
  return n.toString(36)
}

export const isJson = (contentType: string | null): boolean =>
  (contentType ?? "").toLowerCase().includes("application/json")

export const safeParseUrl = (raw: string): URL | null => {
  const trimmed = toNonEmptyTrimmedString(raw)
  if (!trimmed) return null

  try {
    return new URL(trimmed)
  } catch {
    return null
  }
}

export const extractHostFromUrl = (serverUrl: string): string | null => {
  const u = safeParseUrl(serverUrl)
  return u ? u.hostname || null : null
}

export const getEmail = async (config?: FmeExportConfig): Promise<string> => {
  const user = await SessionManager.getInstance().getUserInfo()
  const email = (user?.email || config?.defaultRequesterEmail || "")
    .trim()
    .toLowerCase()

  const isEmail = EMAIL_REGEX.test(email)
  if (!isEmail) {
    const err = new Error("MISSING_REQUESTER_EMAIL")
    err.name = "MISSING_REQUESTER_EMAIL"
    throw err
  }
  return email
}
