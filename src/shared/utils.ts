import type {
  TranslateFn,
  EsriModules,
  FmeExportConfig,
  ErrorState,
  PrimitiveParams,
} from "../config"
import { ErrorType, ErrorSeverity } from "../config"
import { SessionManager, css } from "jimu-core"
import type { CSSProperties, Dispatch, SetStateAction } from "react"

export const isEmpty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") return v.trim().length === 0
  return false
}

export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (/no-?reply/i.test(email)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const getSupportEmail = (
  configuredEmailRaw: unknown
): string | undefined => {
  const cfg =
    typeof configuredEmailRaw === "string" ? configuredEmailRaw.trim() : ""
  return isValidEmail(cfg) ? cfg : undefined
}

export const asString = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : ""

export const makePlaceholders = (
  translate: TranslateFn,
  fieldLabel: string
) => ({
  enter: translate("placeholderEnter", { field: fieldLabel }),
  select: translate("placeholderSelect", { field: fieldLabel }),
})

export const getTextPlaceholder = (
  field: { placeholder?: string } | undefined,
  placeholders: { enter: string },
  translate: TranslateFn,
  kind?: "email" | "phone" | "search"
): string => {
  if (field?.placeholder) return field.placeholder
  if (kind === "email") return translate("placeholderEmail")
  if (kind === "phone") return translate("placeholderPhone")
  if (kind === "search") return translate("placeholderSearch")
  return placeholders.enter
}

export const computeSelectCoerce = (
  isSelectType: boolean,
  selectOptions: ReadonlyArray<{ readonly value?: unknown }>
): "number" | undefined => {
  if (!isSelectType || !selectOptions?.length) return undefined
  const vals = selectOptions.map((o) => o.value)
  const allNumeric = vals.every((v) => {
    if (typeof v === "number") return Number.isFinite(v)
    if (typeof v === "string") {
      if (v.trim() === "") return false
      const n = Number(v)
      return Number.isFinite(n) && String(n) === v
    }
    return false
  })
  return allNumeric ? "number" : undefined
}

export const parseTableRows = (value: unknown): string[] => {
  const v = value as any
  if (Array.isArray(v))
    return v.map((x) => (typeof x === "string" ? x : String(x)))
  if (typeof v === "string") {
    try {
      const arr = JSON.parse(v)
      return Array.isArray(arr) ? arr.map((x) => String(x)) : v ? [v] : []
    } catch {
      return v ? [v] : []
    }
  }
  return []
}

export function resolveMessageOrKey(
  raw: string,
  translate: TranslateFn
): string {
  if (!raw) return raw
  const exact = translate(raw)
  if (exact && exact !== raw) return exact
  const camelKey = raw
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  const camel = translate(camelKey)
  return camel && camel !== camelKey ? camel : raw
}

export const maskEmailForDisplay = (email: unknown): string => {
  if (typeof email !== "string") return ""
  const trimmed = email.trim()
  if (!isValidEmail(trimmed)) return trimmed
  const atIdx = trimmed.indexOf("@")
  if (atIdx <= 1) return `**${trimmed.slice(atIdx)}`

  const local = trimmed.slice(0, atIdx)
  const domain = trimmed.slice(atIdx)
  const visible = local.slice(0, 2)
  return `${visible}****${domain}`
}

export const EMAIL_PLACEHOLDER = /\{\s*email\s*\}/i

export const buildSupportHintText = (
  translate: TranslateFn,
  supportEmail?: string,
  userFriendly?: string
): string => {
  if (supportEmail) {
    return translate("contactSupportWithEmail").replace(
      EMAIL_PLACEHOLDER,
      supportEmail
    )
  }
  if (typeof userFriendly === "string" && userFriendly.trim()) {
    return userFriendly
  }
  return ""
}

export const stripHtmlToText = (input?: string): string => {
  if (!input) return ""
  let out = input.replace(
    /<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  )
  out = out.replace(/<[^>]*>/g, "")
  return out
}

export const styleCss = (style?: CSSProperties) =>
  style ? css(style as any) : undefined

export const setError = <T extends { [k: string]: any }>(
  set: Dispatch<SetStateAction<T>>,
  key: keyof T,
  value?: T[keyof T]
) => {
  set((prev) => ({ ...prev, [key]: value as any }))
}

export const clearErrors = <T extends { [k: string]: any }>(
  set: Dispatch<SetStateAction<T>>,
  keys: Array<keyof T>
) => {
  set((prev) => {
    const next: any = { ...prev }
    for (const k of keys) next[k as string] = undefined
    return next
  })
}

export const safeAbort = (ctrl: AbortController | null) => {
  if (ctrl) {
    try {
      ctrl.abort()
    } catch {}
  }
}

export const maskToken = (token: string): string =>
  token ? `****${token.slice(-4)}` : ""

export const ariaDesc = (id?: string, suffix = "error"): string | undefined =>
  id ? `${id}-${suffix}` : undefined

export const getBtnAria = (
  text?: any,
  icon?: string | boolean,
  jimuAriaLabel?: string,
  tooltip?: string,
  fallbackLabel?: string
): string | undefined => {
  if (jimuAriaLabel) return jimuAriaLabel
  if (typeof text === "string" && text.length > 0) return text
  if (!icon) return undefined
  return (typeof tooltip === "string" && tooltip) || fallbackLabel
}

export const getErrorIconSrc = (code?: string): string => {
  if (!code) return "error"

  const k = code.trim().toUpperCase()

  if (k.includes("TOKEN") || k.includes("AUTH")) return "user-x"

  if (k.includes("SERVER") || k.includes("GATEWAY")) return "server"

  if (k.includes("REPOSITORY") || k.includes("REPO")) return "folder-x"

  if (k.includes("NETWORK") || k.includes("OFFLINE")) return "wifi-off"

  if (k.includes("URL")) return "link-off"
  if (k.includes("TIMEOUT")) return "timer-off"
  if (k.includes("CONFIG")) return "settings"
  if (k.includes("EMAIL")) return "mail-x"

  return "error"
}

export const MS_LOADING = 500

export const WORKSPACE_ITEM_TYPE = "WORKSPACE"

export const ERROR_NAMES = {
  CANCELLED_PROMISE: "CancelledPromiseError",
  ABORT: "AbortError",
} as const

const GEOMETRY_CONSTS = {
  M2_PER_KM2: 1_000_000,
  AREA_DECIMALS: 2,
} as const

type ServiceMode = "sync" | "async" | "schedule"
const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = [
  "sync",
  "async",
  "schedule",
] as const
const SCHEDULE_TRIGGER_DEFAULT = "runonce"

export const sanitizeParamKey = (name: unknown, fallback: string): string => {
  let raw: string
  if (typeof name === "string") raw = name
  else if (typeof name === "number" && Number.isFinite(name)) raw = String(name)
  else return fallback
  const safe = raw.replace(/[^A-Za-z0-9_\-]/g, "").trim()
  return safe || fallback
}

export const isPolygonGeometry = (
  value: unknown
): value is { rings: unknown } | { geometry: { rings: unknown } } => {
  if (!value || typeof value !== "object") return false

  const geom =
    "geometry" in (value as any)
      ? (value as { geometry: unknown }).geometry
      : value
  if (!geom || typeof geom !== "object") return false

  const rings =
    "rings" in (geom as any) ? (geom as { rings: unknown }).rings : undefined
  if (!Array.isArray(rings) || rings.length === 0) return false

  const isValidTuple = (pt: unknown) =>
    Array.isArray(pt) &&
    pt.length >= 2 &&
    pt.length <= 4 &&
    pt.every((n) => Number.isFinite(n))
  const isValidRing = (ring: unknown) =>
    Array.isArray(ring) && ring.length >= 3 && ring.every(isValidTuple)
  return (rings as unknown[]).every(isValidRing)
}

export const determineServiceMode = (
  formData: unknown,
  config?: FmeExportConfig
): ServiceMode => {
  const data = (formData as any)?.data || {}
  const startValRaw = data.start as unknown
  const hasStart =
    typeof startValRaw === "string" && startValRaw.trim().length > 0
  if (config?.allowScheduleMode && hasStart) return "schedule"
  const override = data._serviceMode as string
  if (override === "sync" || override === "async" || override === "schedule") {
    return override as ServiceMode
  }
  return config?.syncMode ? "sync" : "async"
}

export const buildFmeParams = (
  formData: unknown,
  userEmail: string,
  serviceMode: ServiceMode = "async"
): { [key: string]: unknown } => {
  const data = (formData as { data?: { [key: string]: unknown } })?.data || {}
  const mode = (ALLOWED_SERVICE_MODES as readonly string[]).includes(
    serviceMode
  )
    ? serviceMode
    : "async"
  const base = {
    ...data,
    opt_servicemode: mode,
    opt_responseformat: "json",
    opt_showresult: "true",
  } as { [key: string]: unknown }
  if (mode === "async" && typeof userEmail === "string" && userEmail.trim()) {
    base.opt_requesteremail = userEmail
  }
  return base
}

export const polygonJsonToGeoJson = (poly: any): any => {
  const rings = Array.isArray(poly?.rings) ? poly.rings : []
  const coords = rings.map((ring: any[]) =>
    (Array.isArray(ring) ? ring : []).map((pt: any) => [pt[0], pt[1]])
  )
  return { type: "Polygon", coordinates: coords }
}

export const polygonJsonToWkt = (poly: any): string => {
  const rings = Array.isArray(poly?.rings) ? poly.rings : []
  if (!rings.length) return "POLYGON EMPTY"

  const ringToText = (ring: any[]): string => {
    const arr = Array.isArray(ring) ? ring.slice() : []
    if (arr.length > 0) {
      const first = arr[0]
      const last = arr[arr.length - 1]
      const same =
        Array.isArray(first) &&
        Array.isArray(last) &&
        first.length >= 2 &&
        last.length >= 2 &&
        first[0] === last[0] &&
        first[1] === last[1]
      if (!same) arr.push(first)
    }
    const coords = arr.map((pt: any) => `${pt[0]} ${pt[1]}`).join(", ")
    return `(${coords})`
  }

  const wktRings = rings.map(ringToText).join(", ")
  return `POLYGON(${wktRings})`
}

export const toWgs84PolygonJson = (
  polyJson: any,
  modules: EsriModules | null | undefined
): any => {
  try {
    const Polygon = modules?.Polygon
    const wmUtils = modules?.webMercatorUtils
    if (!Polygon) return polyJson

    const poly = Polygon.fromJSON(polyJson)
    const wkid = poly?.spatialReference?.wkid

    if (wkid === 4326) return poly.toJSON()

    if (
      (wkid === 3857 || wkid === 102100) &&
      wmUtils?.webMercatorToGeographic
    ) {
      const g = wmUtils.webMercatorToGeographic(poly) as __esri.Polygon
      return g?.toJSON?.() ?? poly.toJSON()
    }
    return poly.toJSON()
  } catch {
    return polyJson
  }
}

export type AttachAoiResult =
  | { ok: true; params: { [key: string]: unknown } }
  | { ok: false; error: ErrorState }

export const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  config?: FmeExportConfig
): AttachAoiResult => {
  const paramName = sanitizeParamKey(config?.aoiParamName, "AreaOfInterest")
  let aoiJson: unknown = null

  if (isPolygonGeometry(geometryJson)) {
    aoiJson =
      "geometry" in (geometryJson as any)
        ? (geometryJson as any).geometry
        : geometryJson
  } else {
    const geometryToUse = currentGeometry?.toJSON()
    if (isPolygonGeometry(geometryToUse)) {
      aoiJson = geometryToUse
    }
  }

  if (aoiJson) {
    try {
      const serialized = JSON.stringify(aoiJson)
      const out: { [key: string]: unknown } = {
        ...base,
        [paramName]: serialized,
      }

      const gjNameRaw = sanitizeParamKey(config?.aoiGeoJsonParamName, "")
      const wktNameRaw = sanitizeParamKey(config?.aoiWktParamName, "")
      const needsDerived = Boolean(gjNameRaw || wktNameRaw)
      let wgs84Poly: any = null
      if (needsDerived) {
        try {
          wgs84Poly = toWgs84PolygonJson(aoiJson, modules)
        } catch {
          wgs84Poly = null
        }
      }
      if (gjNameRaw && wgs84Poly) {
        try {
          const geojson = polygonJsonToGeoJson(wgs84Poly)
          out[gjNameRaw] = JSON.stringify(geojson)
        } catch {}
      }
      if (wktNameRaw && wgs84Poly) {
        try {
          const wkt = polygonJsonToWkt(wgs84Poly)
          out[wktNameRaw] = wkt
        } catch {}
      }

      return { ok: true, params: out }
    } catch (_) {
      const err: ErrorState = {
        message: "GEOMETRY_SERIALIZATION_FAILED",
        type: ErrorType.GEOMETRY,
        code: "GEOMETRY_SERIALIZATION_FAILED",
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestamp: new Date(),
        timestampMs: Date.now(),
      }
      return { ok: false, error: err }
    }
  }

  return { ok: true, params: base }
}

export const applyDirectiveDefaults = (
  params: { [key: string]: unknown },
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  if (!config) return params
  const out: { [key: string]: unknown } = { ...params }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(out, k)

  const toPosInt = (v: unknown): number | undefined => {
    const n = typeof v === "string" ? Number(v) : (v as number)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
  }

  if (!has("tm_ttc")) {
    const v = toPosInt(config.tm_ttc)
    if (v !== undefined) out.tm_ttc = v
  }
  if (!has("tm_ttl")) {
    const v = toPosInt(config.tm_ttl)
    if (v !== undefined) out.tm_ttl = v
  }
  if (!has("tm_tag")) {
    const v = typeof config.tm_tag === "string" ? config.tm_tag.trim() : ""
    if (v) out.tm_tag = v.substring(0, 128)
  }

  return out
}

export const prepFmeParams = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  const original = (formData as any)?.data || {}
  const chosen = determineServiceMode({ data: original }, config)
  const data =
    chosen === "schedule" && !original.trigger
      ? { ...original, trigger: SCHEDULE_TRIGGER_DEFAULT }
      : original

  const base = buildFmeParams({ data }, userEmail, chosen)
  const aoiRes = attachAoi(base, geometryJson, currentGeometry, modules, config)
  if (!aoiRes.ok) {
    // escalate as error to let callers handle it explicitly
    const errCode = (aoiRes as { ok: false; error: ErrorState }).error.code
    const errType = (aoiRes as { ok: false; error: ErrorState }).error.type
    const e = new Error(errCode || "GEOMETRY_SERIALIZATION_FAILED")
    ;(e as any).code = errCode
    ;(e as any).type = errType
    throw e
  }
  return applyDirectiveDefaults(
    (aoiRes as { ok: true; params: any }).params,
    config
  )
}

export function formatArea(area: number, modules: EsriModules): string {
  if (!area || Number.isNaN(area) || area <= 0) return "0 m²"

  const formatNumber = (value: number, decimals: number): string => {
    const intlModule = (modules as any)?.intl
    if (intlModule && typeof intlModule.formatNumber === "function") {
      return intlModule.formatNumber(value, {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      })
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })
  }

  if (area >= GEOMETRY_CONSTS.M2_PER_KM2) {
    const areaInSqKm = area / GEOMETRY_CONSTS.M2_PER_KM2
    const formatted = formatNumber(areaInSqKm, GEOMETRY_CONSTS.AREA_DECIMALS)
    return `${formatted} km²`
  }

  const roundedArea = Math.round(area)
  const formatted = formatNumber(roundedArea, 0)
  return `${formatted} m²`
}

export const getEmail = async (_config?: FmeExportConfig): Promise<string> => {
  const user = await SessionManager.getInstance().getUserInfo()
  const email = user?.email
  if (!email) {
    const err = new Error("MISSING_REQUESTER_EMAIL")
    err.name = "MISSING_REQUESTER_EMAIL"
    throw err
  }
  if (!isValidEmail(email)) {
    const err = new Error("INVALID_EMAIL")
    err.name = "INVALID_EMAIL"
    throw err
  }
  return email
}

export const toStr = (val: unknown): string => {
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

export const buildUrl = (serverUrl: string, ...segments: string[]): string => {
  const base = serverUrl
    .replace(/\/(?:fmeserver|fmerest(?:\/v\d+)?)\/?$/i, "")
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

  return path ? `${base}/${path}` : base
}

export const resolveRequestUrl = (
  endpoint: string,
  serverUrl: string,
  basePath: string
): string => {
  if (endpoint.startsWith("http")) return endpoint
  if (endpoint.startsWith("/fme")) return buildUrl(serverUrl, endpoint.slice(1))
  return buildUrl(serverUrl, basePath.slice(1), endpoint.slice(1))
}

export const buildParams = (
  params: PrimitiveParams = {},
  excludeKeys: string[] = [],
  webhookDefaults = false
): URLSearchParams => {
  const urlParams = new URLSearchParams()
  if (!params || typeof params !== "object") return urlParams

  const excludeSet = new Set(excludeKeys)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || excludeSet.has(key)) continue

    if (isFileObject(value)) {
      urlParams.append(key, getFileDisplayName(value))
      continue
    }

    urlParams.append(key, toStr(value))
  }

  if (webhookDefaults) {
    /**
     * Data Download webhook expects sync|async only; schedule is not supported.
     * We coerce schedule->async here to align with FME Flow webhook behavior.
     * For REST v3 job submissions, scheduling is handled via submit APIs, not webhooks.
     */
    urlParams.append("opt_responseformat", "json")
    urlParams.append("opt_showresult", "true")
    const raw = (params as any)?.opt_servicemode
    const requested = typeof raw === "string" ? raw.trim().toLowerCase() : ""
    const mode = requested === "sync" ? "sync" : "async"
    urlParams.append("opt_servicemode", mode)
  }

  return urlParams
}

export const safeLogParams = (
  label: string,
  url: string,
  params: URLSearchParams,
  whitelist: readonly string[]
): void => {
  try {
    const safeParams = new URLSearchParams()
    for (const k of whitelist) {
      const v = params.get(k)
      if (v !== null) safeParams.set(k, v)
    }
    // Avoid logging full URLs with sensitive query strings (e.g., token).
    const u = safeParseUrl(url)
    const sanitizedUrl = u
      ? `${u.origin}${u.pathname}`
      : url.split("?")[0] || url
    console.log(label, sanitizedUrl, `params=${safeParams.toString()}`)
  } catch {}
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
      return it._fmeInterceptor && it.urls && pattern.test(it.urls.toString())
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

export const makeGeoJson = (polygon: __esri.Polygon) => ({
  type: "Polygon" as const,
  coordinates: (polygon.rings || []).map((ring: any[]) =>
    ring.map((pt: any) => [pt[0], pt[1]] as [number, number])
  ),
})

export const isJson = (contentType: string | null): boolean =>
  (contentType ?? "").toLowerCase().includes("application/json")

export const safeParseUrl = (raw: string): URL | null => {
  try {
    return new URL((raw || "").trim())
  } catch {
    return null
  }
}

export const extractHostFromUrl = (serverUrl: string): string | null => {
  const u = safeParseUrl(serverUrl)
  return u ? u.hostname || null : null
}

export const extractErrorMessage = (error: unknown): string => {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (typeof error === "number") return error.toString()
  if (error instanceof Error) return error.message || "Error object"

  if (typeof error === "object" && error !== null) {
    const obj = error as { [key: string]: unknown }
    for (const prop of ["message", "error", "details", "description"]) {
      const v = obj[prop]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
  }

  return "Unknown error occurred"
}

export const parseNonNegativeInt = (val: string): number | undefined => {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

export const pad2 = (n: number): string => String(n).padStart(2, "0")

export const fmeDateTimeToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length < 12) return ""
  const y = s.slice(0, 4)
  const m = s.slice(4, 6)
  const d = s.slice(6, 8)
  const hh = s.slice(8, 10)
  const mm = s.slice(10, 12)
  const ss = s.length >= 14 ? s.slice(12, 14) : ""
  return `${y}-${m}-${d}T${hh}:${mm}${ss ? `:${ss}` : ""}`
}

export const inputToFmeDateTime = (v: string): string => {
  if (!v) return ""
  const s = v.trim()
  const [date, time] = s.split("T")
  if (!date || !time) return ""

  const [y, m, d] = date.split("-")
  const [hh, mi, ssRaw] = time.split(":")

  if (!y || y.length !== 4 || !/^[0-9]{4}$/.test(y)) return ""

  const safePad2 = (part?: string): string | null => {
    if (!part) return null
    const n = Number(part)
    return Number.isFinite(n) && n >= 0 && n <= 99 ? pad2(n) : null
  }

  const m2 = safePad2(m)
  const d2 = safePad2(d)
  const hh2 = safePad2(hh)
  const mi2 = safePad2(mi)
  if (!m2 || !d2 || !hh2 || !mi2) return ""

  const ss2 = ssRaw ? safePad2(ssRaw) : "00"
  if (ss2 === null) return ""

  return `${y}${m2}${d2}${hh2}${mi2}${ss2}`
}

export const fmeDateToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length !== 8) return ""
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export const inputToFmeDate = (v: string): string =>
  v ? v.replace(/-/g, "") : ""

export const fmeTimeToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`
  if (s.length >= 6) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
  return ""
}

export const inputToFmeTime = (v: string): string => {
  if (!v) return ""
  const parts = v.split(":").map((x) => x || "")
  const hh = parts[0] || ""
  const mm = parts[1] || ""
  const ss = parts[2] || ""

  const nH = Number(hh)
  const nM = Number(mm)
  if (!Number.isFinite(nH) || !Number.isFinite(nM)) return ""

  const nS = Number(ss)
  const finalSS = Number.isFinite(nS) ? pad2(nS) : "00"

  return `${pad2(nH)}${pad2(nM)}${finalSS}`
}

export const normalizedRgbToHex = (v: string): string | null => {
  const parts = (v || "").split(",").map((s) => s.trim())
  if (parts.length < 3) return null
  const to255 = (f: string) => {
    const n = Number(f)
    return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 255) : null
  }
  const r = to255(parts[0])
  const g = to255(parts[1])
  const b = to255(parts[2])
  if (r == null || g == null || b == null) return null
  const toHex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export const hexToNormalizedRgb = (hex: string): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const f = (x: number) => Number((x / 255).toFixed(6)).toString()
  return `${f(r)},${f(g)},${f(b)}`
}

export const toIsoLocal = (spaceDateTime: string | undefined): string => {
  const s = (spaceDateTime || "").trim()
  if (!s) return ""
  const parts = s.split(" ")
  if (parts.length !== 2) return ""
  const [d, t] = parts
  const tParts = t.split(":")
  const hh = tParts[0] || "00"
  const mm = tParts[1] || "00"
  const ss = tParts[2] || "00"
  return `${d}T${hh}:${mm}:${ss}`
}

export const fromIsoLocal = (isoLocal: string | undefined): string => {
  const s = (isoLocal || "").trim()
  if (!s) return ""
  const parts = s.split("T")
  if (parts.length !== 2) return ""
  const [d, t] = parts
  const tParts = t.split(":")
  const hh = tParts[0] || "00"
  const mm = tParts[1] || "00"
  const ss = tParts[2] || "00"
  return `${d} ${hh}:${mm}:${ss}`
}

export const normalizeFormValue = (value: any, isMultiSelect: boolean): any => {
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  if (isMultiSelect) {
    return Array.isArray(value) ? value : [value]
  }
  return typeof value === "string" || typeof value === "number" ? value : ""
}

export const toSerializable = (error: any): any => {
  if (!error) return null
  const ts =
    typeof error.timestampMs === "number"
      ? error.timestampMs
      : error.timestamp instanceof Date
        ? error.timestamp.getTime()
        : 0
  const { retry, timestamp, ...rest } = error
  return { ...rest, timestampMs: ts }
}

export const isFileObject = (value: unknown): value is File => {
  try {
    return (
      value instanceof File ||
      (typeof value === "object" &&
        value !== null &&
        "name" in (value as any) &&
        "size" in (value as any) &&
        "type" in (value as any))
    )
  } catch {
    return false
  }
}

export const getFileDisplayName = (file: File): string => {
  const name = (file as any).name
  return typeof name === "string" && name.trim() ? name.trim() : "unnamed-file"
}

export const stripErrorLabel = (errorText?: string): string | undefined => {
  const text = (errorText ?? "").replace(/<[^>]*>/g, "").trim()
  if (!text) return undefined

  const colonIdx = text.indexOf(":")
  if (colonIdx > -1) return text.substring(colonIdx + 1).trim()

  return text
}

export const initFormValues = (
  formConfig: readonly any[]
): { [key: string]: any } => {
  const result: { [key: string]: any } = {}
  for (const field of formConfig) {
    if (field?.name) {
      result[field.name] = field.defaultValue ?? ""
    }
  }
  return result
}

export const canResetButton = (
  onReset: (() => void) | undefined,
  canResetFlag: boolean,
  state: string,
  drawnArea: number,
  isDrawing?: boolean,
  clickCount?: number
): boolean => {
  if (!onReset || !canResetFlag || state === "order-result") return false
  if (state === "drawing")
    return Boolean(clickCount && clickCount > 0) || Boolean(isDrawing)
  return drawnArea > 0 && state !== "initial"
}

export const shouldShowWorkspaceLoading = (
  isLoading: boolean,
  workspaces: readonly any[],
  state: string,
  hasError?: boolean
): boolean => {
  if (hasError) return false
  const needsLoading =
    state === "workspace-selection" || state === "export-options"
  return isLoading || (!workspaces.length && needsLoading)
}
