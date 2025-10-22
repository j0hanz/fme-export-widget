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
import { SCHEDULE_TRIGGER_DEFAULT } from "../../config/index"
import { validateScheduleMetadata } from "../validations"
import { collectGeometryParamNames, attachAoi } from "./geometry"
import {
  collectStringsFromProp,
  uniqueStrings,
  sanitizeOptGetUrlParam,
} from "./form"
import { toBooleanValue, toTrimmedString } from "./conversion"

const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = [
  "sync",
  "async",
  "schedule",
] as const

const SCHEDULE_METADATA_FIELDS = [
  "start",
  "name",
  "category",
  "description",
  "trigger",
] as const

const SCHEDULE_METADATA_KEYS = new Set<string>(SCHEDULE_METADATA_FIELDS)

const hasScheduleData = (data: { [key: string]: unknown }): boolean => {
  const startVal = toTrimmedString(data.start)
  const category = toTrimmedString(data.category)
  const name = toTrimmedString(data.name)

  if (!startVal || !category || !name) return false

  const validation = validateScheduleMetadata({
    start: startVal,
    name,
    category,
    description: toTrimmedString(data.description),
  })

  if (validation.warnings?.pastTime) {
    console.log(
      "Schedule start time is in the past - job may execute immediately or fail",
      { startTime: startVal, warnings: validation.warnings }
    )
  }

  if (!validation.valid && validation.errors) {
    console.log("Schedule metadata validation failed", {
      errors: validation.errors,
    })
  }

  return validation.valid
}

const filterScheduleFields = (data: {
  [key: string]: unknown
}): { [key: string]: unknown } => {
  const filtered: { [key: string]: unknown } = {}
  for (const [key, value] of Object.entries(data)) {
    if (!SCHEDULE_METADATA_KEYS.has(key)) filtered[key] = value
  }
  return filtered
}

// Normaliserar schemaläggningsmetadata beroende på körläge
const normalizeScheduleMetadata = (
  data: { [key: string]: unknown },
  mode: ServiceMode
): { [key: string]: unknown } => {
  if (mode !== "schedule") {
    return filterScheduleFields(data)
  }

  const sanitized: { [key: string]: unknown } = {}
  for (const [key, value] of Object.entries(data)) {
    if (!SCHEDULE_METADATA_KEYS.has(key)) {
      sanitized[key] = value
    } else if (key === "trigger") {
      sanitized.trigger = toTrimmedString(value) ?? SCHEDULE_TRIGGER_DEFAULT
    } else {
      const trimmedValue = toTrimmedString(value)
      if (trimmedValue) sanitized[key] = trimmedValue
    }
  }

  if (sanitized.trigger === undefined) {
    sanitized.trigger = SCHEDULE_TRIGGER_DEFAULT
  }

  return sanitized
}

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

  if (config?.allowScheduleMode && hasScheduleData(data)) {
    return "schedule"
  }

  const override =
    typeof data._serviceMode === "string"
      ? data._serviceMode.trim().toLowerCase()
      : ""

  if (override === "schedule" && config?.allowScheduleMode) {
    return "schedule"
  }

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
  if ((mode === "async" || mode === "schedule") && trimmedEmail) {
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

  const sanitized = normalizeScheduleMetadata(publicFields, chosen)

  const base = buildFmeParams(
    { data: sanitized },
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
