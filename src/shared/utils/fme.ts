import type {
  DetermineServiceModeOptions,
  FmeExportConfig,
  ForceAsyncResult,
  ServiceMode,
  WorkspaceItem,
  WorkspaceItemDetail,
  WorkspaceParameter,
  EsriModules,
} from "../../config/index"
import { collectGeometryParamNames, attachAoi } from "./geometry"
import {
  collectStringsFromProp,
  uniqueStrings,
  sanitizeOptGetUrlParam,
} from "./form"
import { toBooleanValue } from "./conversion"

const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = ["sync", "async"] as const

const shouldForceAsyncMode = (
  config: FmeExportConfig | undefined,
  options?: {
    workspaceItem?: WorkspaceItem | WorkspaceItemDetail | null
    areaWarning?: boolean
    drawnArea?: number
  }
): ForceAsyncResult | null => {
  if (!options) return null

  if (options.areaWarning) {
    return {
      reason: "area",
      value: options.drawnArea,
      threshold: config?.largeArea,
    }
  }

  if (typeof config?.largeArea === "number" && options.drawnArea != null) {
    if (options.drawnArea > config.largeArea) {
      return {
        reason: "area",
        value: options.drawnArea,
        threshold: config.largeArea,
      }
    }
  }

  return null
}

export const normalizeServiceModeConfig = (
  config: FmeExportConfig | null | undefined
): FmeExportConfig | undefined => {
  if (!config) return config ?? undefined

  const rawValue = config.syncMode
  let normalized =
    typeof rawValue === "boolean" ? rawValue : toBooleanValue(rawValue)

  if (normalized === undefined) {
    normalized = Boolean(rawValue)
  }

  if (typeof rawValue === "boolean" && rawValue === normalized) {
    return config
  }

  const cloned = { ...config, syncMode: normalized }
  if (typeof (config as any).set === "function") {
    Object.defineProperty(cloned, "set", {
      value: (config as any).set,
      writable: true,
      configurable: true,
    })
  }
  return cloned
}

export const determineServiceMode = (
  formData: unknown,
  config?: FmeExportConfig,
  options?: DetermineServiceModeOptions
): ServiceMode => {
  const data = (formData as any)?.data || {}

  const override =
    typeof data._serviceMode === "string"
      ? data._serviceMode.trim().toLowerCase()
      : ""

  let resolved: ServiceMode
  if (override === "sync" || override === "async") {
    resolved = override as ServiceMode
  } else {
    resolved = config?.syncMode ? "sync" : "async"
  }

  const forceInfo = shouldForceAsyncMode(config, {
    workspaceItem: options?.workspaceItem,
    areaWarning: options?.areaWarning,
    drawnArea: options?.drawnArea,
  })

  if (forceInfo && resolved === "sync") {
    options?.onModeOverride?.({
      forcedMode: "async",
      previousMode: "sync",
      reason: forceInfo.reason,
      value: forceInfo.value,
      threshold: forceInfo.threshold,
    })
    return "async"
  }

  return resolved
}

export const buildFmeParams = (
  formData: unknown,
  userEmail: string,
  serviceMode: ServiceMode = "async",
  config?: FmeExportConfig | null
): { [key: string]: unknown } => {
  const data = (formData as { data?: { [key: string]: unknown } })?.data || {}
  const mode = ALLOWED_SERVICE_MODES.includes(serviceMode)
    ? serviceMode
    : "async"
  const includeResult = config?.showResult ?? true

  const base: { [key: string]: unknown } = {
    ...data,
    opt_servicemode: mode,
    opt_responseformat: "json",
    opt_showresult: includeResult ? "true" : "false",
  }

  const trimmedEmail = typeof userEmail === "string" ? userEmail.trim() : ""
  if (mode === "async" && trimmedEmail) {
    base.opt_requesteremail = trimmedEmail
  }

  return base
}

export const applyDirectiveDefaults = (
  params: { [key: string]: unknown },
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  if (!config) return params

  const out: { [key: string]: unknown } = { ...params }
  const toPosInt = (v: unknown): number | undefined => {
    const n = typeof v === "string" ? Number(v) : (v as number)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
  }

  const rawMode = (() => {
    const candidate = (params as { opt_servicemode?: unknown }).opt_servicemode
    if (typeof candidate === "string") return candidate
    const cloned = out.opt_servicemode
    return typeof cloned === "string" ? cloned : ""
  })()

  const normalizedMode =
    typeof rawMode === "string" ? rawMode.trim().toLowerCase() : ""

  const allowTmTtc =
    normalizedMode === "sync" || (!normalizedMode && Boolean(config?.syncMode))

  if (!allowTmTtc && typeof out.tm_ttc !== "undefined") {
    delete out.tm_ttc
  } else if (allowTmTtc && !("tm_ttc" in out)) {
    const v = toPosInt(config?.tm_ttc)
    if (v !== undefined) out.tm_ttc = v
  }
  if (!("tm_ttl" in out)) {
    const v = toPosInt(config?.tm_ttl)
    if (v !== undefined) out.tm_ttl = v
  }

  return out
}

export const parseNonNegativeInt = (val: string): number | undefined => {
  const trimmed = typeof val === "string" ? val.trim() : String(val)
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

export const prepFmeParams = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  options?: {
    config?: FmeExportConfig
    workspaceParameters?: readonly WorkspaceParameter[] | null
    workspaceItem?: WorkspaceItemDetail | null
    areaWarning?: boolean
    drawnArea?: number
  }
): { [key: string]: unknown } => {
  const {
    config: rawConfig,
    workspaceParameters,
    workspaceItem,
    areaWarning,
    drawnArea,
  } = options || {}
  const normalizedConfig = normalizeServiceModeConfig(rawConfig)
  const original = ((formData as any)?.data || {}) as {
    [key: string]: unknown
  }
  const chosen = determineServiceMode({ data: original }, normalizedConfig, {
    workspaceItem,
    areaWarning,
    drawnArea,
  })
  const {
    _serviceMode: _ignoredServiceMode,
    __upload_file__: _ignoredUpload,
    __remote_dataset_url__: _ignoredRemote,
    ...publicFields
  } = original

  const base = buildFmeParams(
    { data: publicFields },
    userEmail,
    chosen,
    normalizedConfig
  )
  const geometryParamNames = collectGeometryParamNames(workspaceParameters)
  const withAoi = attachAoi(
    base,
    geometryJson,
    currentGeometry,
    modules,
    normalizedConfig,
    geometryParamNames
  )
  const withDirectives = applyDirectiveDefaults(withAoi, normalizedConfig)
  sanitizeOptGetUrlParam(withDirectives, normalizedConfig)
  return withDirectives
}

export const extractRepositoryNames = (source: unknown): string[] => {
  if (Array.isArray(source)) {
    return uniqueStrings(collectStringsFromProp(source, "name"))
  }

  const record = typeof source === "object" && source !== null ? source : null
  const items = (record as any)?.items

  if (Array.isArray(items)) {
    return uniqueStrings(collectStringsFromProp(items, "name"))
  }

  return []
}
