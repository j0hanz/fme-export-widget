import type {
  TranslateFn,
  EsriModules,
  FmeExportConfig,
  ErrorState,
  PrimitiveParams,
} from "../config"
import { ErrorType, ErrorSeverity } from "../config"
import { SessionManager, css, hooks } from "jimu-core"
import type { CSSProperties, Dispatch, SetStateAction } from "react"
import { logDebug } from "./logging"

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

export function formatErrorForView(
  translate: TranslateFn,
  baseKeyOrMessage: string,
  code?: string,
  supportEmail?: string,
  userFriendly?: string
): { message: string; code?: string; hint?: string } {
  let message = ""
  try {
    message = resolveMessageOrKey(baseKeyOrMessage, translate)
  } catch {
    message = baseKeyOrMessage
  }
  const hint = buildSupportHintText(translate, supportEmail, userFriendly)
  return { message: message || baseKeyOrMessage, code, hint }
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

export const useLatestAbortController = () => {
  const controllerRef = hooks.useLatest<AbortController | null>(null)

  const cancel = hooks.useEventCallback(() => {
    const controller = controllerRef.current
    if (controller) {
      safeAbort(controller)
    }
    controllerRef.current = null
  })

  const abortAndCreate = hooks.useEventCallback(() => {
    cancel()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  })

  const finalize = hooks.useEventCallback(
    (controller?: AbortController | null) => {
      if (!controller) return
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  )

  return {
    controllerRef,
    abortAndCreate,
    cancel,
    finalize,
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

const DEFAULT_ERROR_ICON = "error"

const ICON_BY_EXACT_CODE = Object.freeze<{ [code: string]: string }>({
  GEOMETRY_SERIALIZATION_FAILED: "polygon",
  MAP_MODULES_LOAD_FAILED: "map",
  FORM_INVALID: "warning",
})

const TOKEN_ICON_PRIORITY: ReadonlyArray<{ token: string; icon: string }> =
  Object.freeze([
    { token: "GEOMETRY", icon: "polygon" },
    { token: "AREA", icon: "polygon" },
    { token: "MAP", icon: "map" },
    { token: "MODULE", icon: "map" },
    { token: "FORM", icon: "warning" },
    { token: "TOKEN", icon: "person-lock" },
    { token: "AUTH", icon: "person-lock" },
    { token: "REPOSITORY", icon: "folder" },
    { token: "REPO", icon: "folder" },
    { token: "DATA", icon: "data" },
    { token: "NETWORK", icon: "shared-no" },
    { token: "OFFLINE", icon: "shared-no" },
    { token: "CONNECTION", icon: "shared-no" },
    { token: "REQUEST", icon: "shared-no" },
    { token: "SERVER", icon: "feature-service" },
    { token: "GATEWAY", icon: "feature-service" },
    { token: "URL", icon: "link-tilted" },
    { token: "TIMEOUT", icon: "time" },
    { token: "CONFIG", icon: "setting" },
    { token: "EMAIL", icon: "email" },
  ])

const normalizeCodeForMatching = (raw: string): string =>
  raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()

export const getErrorIconSrc = (code?: string): string => {
  if (typeof code !== "string") return DEFAULT_ERROR_ICON

  const trimmed = code.trim()
  if (!trimmed) return DEFAULT_ERROR_ICON

  const normalized = normalizeCodeForMatching(trimmed)

  const exact = ICON_BY_EXACT_CODE[normalized]
  if (exact) return exact

  const tokens = normalized.split(/[^A-Z0-9]+/).filter(Boolean)
  const tokenSet = new Set(tokens)

  for (const { token, icon } of TOKEN_ICON_PRIORITY) {
    if (tokenSet.has(token) || normalized.includes(token)) {
      return icon
    }
  }

  return DEFAULT_ERROR_ICON
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

type CoordinateTuple = readonly number[]

const normalizeCoordinate = (vertex: unknown): number[] | null => {
  if (!Array.isArray(vertex) || vertex.length < 2) return null
  const values = vertex.map((part) =>
    typeof part === "string" ? Number(part) : (part as number)
  )
  const x = values[0]
  const y = values[1]
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  const result: number[] = [x, y]
  const z = values[2]
  const m = values[3]
  if (Number.isFinite(z)) result.push(z)
  if (Number.isFinite(m)) result.push(m)
  return result
}

const coordinatesEqual = (a: CoordinateTuple, b: CoordinateTuple): boolean => {
  if (!a || !b) return false
  const len = Math.min(a.length, b.length, 2)
  for (let i = 0; i < len; i++) {
    const av = a[i]
    const bv = b[i]
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return false
    if (Math.abs(av - bv) > 1e-9) return false
  }
  return true
}

const normalizeRing = (ring: unknown): number[][] => {
  if (!Array.isArray(ring)) return []
  const coords: number[][] = []
  for (const vertex of ring) {
    const tuple = normalizeCoordinate(vertex)
    if (tuple) coords.push(tuple)
  }
  if (coords.length < 3) return []

  const first = coords[0]
  const last = coords[coords.length - 1]
  if (!coordinatesEqual(first, last)) {
    coords.push([...first])
  }
  return coords
}

const extractRings = (poly: any): any[] => {
  if (!poly || typeof poly !== "object") return []

  if (Array.isArray(poly.rings)) return poly.rings
  if (Array.isArray(poly.geometry?.rings)) return poly.geometry.rings

  if (typeof poly.toJSON === "function") {
    try {
      const json = poly.toJSON()
      if (json && Array.isArray(json.rings)) return json.rings
    } catch {}
  }

  return []
}

const formatNumberForWkt = (value: number): string => {
  if (!Number.isFinite(value)) return "0"
  const str = value.toString()
  if (!/[eE]/.test(str)) {
    return str.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")
  }
  const fixed = value
    .toFixed(12)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1")
  return fixed || "0"
}

export const polygonJsonToGeoJson = (poly: any): any => {
  if (!poly) return null

  try {
    const rings = extractRings(poly)
    if (!rings.length) return null

    const normalized = rings
      .map((ring) => normalizeRing(ring))
      .filter((ring) => ring.length >= 4)

    return normalized.length
      ? {
          type: "Polygon",
          coordinates: normalized,
        }
      : null
  } catch (error) {
    logDebug("polygonJsonToGeoJson conversion failed", error)
    return null
  }
}

export const polygonJsonToWkt = (poly: any): string => {
  const geojson = polygonJsonToGeoJson(poly)
  if (!geojson) return "POLYGON EMPTY"

  const rings = Array.isArray(geojson?.coordinates)
    ? (geojson.coordinates as number[][][])
    : []

  if (!rings.length) return "POLYGON EMPTY"

  const ringStrings = rings
    .map((ring) => {
      if (!Array.isArray(ring)) return []
      const parts: string[] = []
      for (const coords of ring) {
        if (!Array.isArray(coords) || coords.length < 2) continue
        const serializedValues: string[] = []
        for (const raw of coords) {
          const num = typeof raw === "number" ? raw : Number(raw)
          if (!Number.isFinite(num)) {
            serializedValues.length = 0
            break
          }
          serializedValues.push(formatNumberForWkt(num))
        }
        if (serializedValues.length >= 2) {
          parts.push(serializedValues.join(" "))
        }
      }
      return parts
    })
    .filter((parts) => parts.length >= 4)
    .map((parts) => `(${parts.join(", ")})`)

  const serialized = ringStrings.filter(
    (ring) => ring !== "()" && ring !== "( )"
  )
  if (!serialized.length) return "POLYGON EMPTY"

  return `POLYGON(${serialized.join(", ")})`
}

export const toWgs84PolygonJson = (
  polyJson: any,
  modules: EsriModules | null | undefined
): any => {
  if (!modules?.Polygon) return polyJson

  try {
    const poly = modules.Polygon.fromJSON(polyJson)
    if (!poly) return polyJson

    const sr = (poly as any).spatialReference as
      | (__esri.SpatialReference & { isWGS84?: boolean })
      | undefined
    if (sr?.isWGS84 || sr?.wkid === 4326) {
      return poly.toJSON()
    }

    const projection = modules.projection
    const SpatialReferenceCtor = modules.SpatialReference as any
    if (projection?.project && SpatialReferenceCtor) {
      const target =
        SpatialReferenceCtor.WGS84 ||
        (typeof SpatialReferenceCtor === "function"
          ? new SpatialReferenceCtor({ wkid: 4326 })
          : { wkid: 4326 })
      const projected = projection.project(poly, target) as
        | __esri.Polygon
        | readonly __esri.Geometry[]
        | null
        | undefined

      if (projected && Array.isArray(projected) && projected[0]) {
        const first = projected[0] as __esri.Polygon
        if (first?.toJSON) return first.toJSON()
      } else if (projected && (projected as __esri.Polygon).toJSON) {
        return (projected as __esri.Polygon).toJSON()
      }
    }

    const wmUtils = modules.webMercatorUtils
    if (wmUtils?.webMercatorToGeographic) {
      const geographic = wmUtils.webMercatorToGeographic(poly) as __esri.Polygon
      if (geographic?.toJSON) {
        return geographic.toJSON()
      }
    }

    return poly.toJSON()
  } catch (error) {
    logDebug("Failed to convert polygon to WGS84", error)
    return polyJson
  }
}

const createAoiSerializationError = (): ErrorState => ({
  message: "GEOMETRY_SERIALIZATION_FAILED",
  type: ErrorType.GEOMETRY,
  code: "GEOMETRY_SERIALIZATION_FAILED",
  severity: ErrorSeverity.ERROR,
  recoverable: true,
  timestamp: new Date(),
  timestampMs: Date.now(),
})

interface DerivedParamNames {
  geoJsonName?: string
  wktName?: string
}

const sanitizeOptionalParamName = (name: unknown): string | undefined => {
  const sanitized = sanitizeParamKey(name, "")
  return sanitized || undefined
}

const resolveDerivedParamNames = (
  config?: FmeExportConfig
): DerivedParamNames => ({
  geoJsonName: sanitizeOptionalParamName(config?.aoiGeoJsonParamName),
  wktName: sanitizeOptionalParamName(config?.aoiWktParamName),
})

const extractPolygonJson = (
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): unknown => {
  if (isPolygonGeometry(geometryJson)) {
    return "geometry" in (geometryJson as any)
      ? (geometryJson as any).geometry
      : geometryJson
  }

  const geometryToUse = currentGeometry?.toJSON()
  return isPolygonGeometry(geometryToUse) ? geometryToUse : null
}

const safeStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const maybeProjectPolygonToWgs84 = (
  aoiJson: unknown,
  modules: EsriModules | null | undefined
): any => {
  try {
    return toWgs84PolygonJson(aoiJson, modules)
  } catch {
    return null
  }
}

const appendDerivedAoiOutputs = (
  target: { [key: string]: unknown },
  wgs84Polygon: any,
  names: DerivedParamNames
) => {
  if (!wgs84Polygon) return
  const { geoJsonName, wktName } = names

  if (geoJsonName) {
    try {
      const geojson = polygonJsonToGeoJson(wgs84Polygon)
      if (geojson) {
        target[geoJsonName] = JSON.stringify(geojson)
      }
    } catch {}
  }

  if (wktName) {
    try {
      target[wktName] = polygonJsonToWkt(wgs84Polygon)
    } catch {}
  }
}

export const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  const paramName = sanitizeParamKey(config?.aoiParamName, "AreaOfInterest")
  const aoiJson = extractPolygonJson(geometryJson, currentGeometry)
  if (!aoiJson) {
    return base
  }

  const serialized = safeStringify(aoiJson)
  if (!serialized) {
    return { ...base, __aoi_error__: createAoiSerializationError() }
  }

  const result: { [key: string]: unknown } = {
    ...base,
    [paramName]: serialized,
  }

  const derivedNames = resolveDerivedParamNames(config)
  if (!derivedNames.geoJsonName && !derivedNames.wktName) {
    return result
  }

  const wgs84Polygon = maybeProjectPolygonToWgs84(aoiJson, modules)
  appendDerivedAoiOutputs(result, wgs84Polygon, derivedNames)

  return result
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
  const withAoi = attachAoi(
    base,
    geometryJson,
    currentGeometry,
    modules,
    config
  )
  return applyDirectiveDefaults(withAoi, config)
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
    logDebug(label, {
      url: sanitizedUrl,
      params: safeParams.toString(),
    })
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
      if (!it || !it._fmeInterceptor) return false
      const rx: any = it.urls
      if (rx instanceof RegExp) {
        return rx.source === pattern.source && rx.flags === pattern.flags
      }
      // Fallback: treat urls as string and test against host pattern
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

export const makeGeoJson = (polygon: __esri.Polygon) => {
  if (!polygon) {
    return { type: "Polygon" as const, coordinates: [] as const }
  }

  try {
    const polyJson =
      typeof (polygon as any)?.toJSON === "function"
        ? (polygon as any).toJSON()
        : { rings: (polygon as any)?.rings }
    const geo = polygonJsonToGeoJson(polyJson)
    if (geo) return geo
  } catch (error) {
    logDebug("makeGeoJson conversion failed", error)
  }

  const rings = Array.isArray((polygon as any)?.rings)
    ? (polygon as any).rings
    : []

  const normalized: number[][][] = rings
    .map((ring: any) => normalizeRing(ring))
    .filter((ring) => ring.length >= 4)

  if (!normalized.length) {
    return { type: "Polygon" as const, coordinates: [] as number[][][] }
  }

  return {
    type: "Polygon" as const,
    coordinates: normalized,
  }
}

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
  // Clamp hours and minutes to valid range
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
  return { ...rest, timestampMs: ts, kind: "serializable" as const }
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
