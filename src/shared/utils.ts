import type {
  TranslateFn,
  EsriModules,
  FmeExportConfig,
  ErrorState,
  PrimitiveParams,
  TextOrFileValue,
  WorkspaceParameter,
  WorkspaceItem,
  WorkspaceItemDetail,
  ServiceMode,
  CoordinateTuple,
  ColorFieldConfig,
  MutableParams,
  PopupSuppressionRecord,
  AreaDisplay,
  UnitConversion,
  DetermineServiceModeOptions,
  ForceAsyncResult,
} from "../config/index"
import {
  ErrorType,
  ErrorSeverity,
  ParameterType,
  DEFAULT_DRAWING_HEX,
  DEFAULT_REPOSITORY,
  UPLOAD_PARAM_TYPES,
  EMAIL_PLACEHOLDER,
  EMAIL_REGEX,
  NO_REPLY_REGEX,
  FORBIDDEN_HOSTNAME_SUFFIXES,
  PRIVATE_IPV4_RANGES,
  ALLOWED_FILE_EXTENSIONS,
  MAX_URL_LENGTH,
} from "../config/index"
import type FmeFlowApiClient from "./api"
import { createFmeFlowClient } from "./api"
import { SessionManager, css, WidgetState } from "jimu-core"
import type { CSSProperties, Dispatch, SetStateAction } from "react"
import { validateScheduleMetadata } from "./validations"

// STRING & TYPE UTILITIES
export const isEmpty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") return v.trim().length === 0
  return false
}

export const isPlainObject = (
  value: unknown
): value is { readonly [key: string]: unknown } => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  return undefined
}

export const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false
  }
  return undefined
}

export const toNumberValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    return Number.isFinite(numeric) ? numeric : undefined
  }
  return undefined
}

export const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value]

export const pickFromObject = <T>(
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[],
  converter: (value: unknown) => T | undefined,
  fallback?: T
): T | undefined => {
  if (!data) return fallback
  for (const key of keys) {
    const result = converter((data as { readonly [key: string]: unknown })[key])
    if (result !== undefined) return result
  }
  return fallback
}

export const pickString = (
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[]
): string | undefined => pickFromObject(data, keys, toStringValue)

export const pickBoolean = (
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[],
  fallback = false
): boolean => pickFromObject(data, keys, toBooleanValue, fallback) ?? fallback

export const pickNumber = (
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[]
): number | undefined => pickFromObject(data, keys, toNumberValue)

export const mergeMetadata = (
  sources: ReadonlyArray<{ readonly [key: string]: unknown } | undefined>
): { readonly [key: string]: unknown } => {
  const merged: { [key: string]: unknown } = {}
  for (const source of sources) {
    if (!isPlainObject(source)) continue
    for (const [key, value] of Object.entries(source)) {
      if (value != null && !(key in merged)) {
        merged[key] = value
      }
    }
  }
  return merged
}

export const unwrapArray = (value: unknown): readonly unknown[] | undefined => {
  if (Array.isArray(value)) return value
  if (isPlainObject(value)) {
    for (const key of ["data", "items", "options"]) {
      const arr = (value as { readonly [key: string]: unknown })[key]
      if (Array.isArray(arr)) return arr
    }
  }
  return undefined
}

export const toMetadataRecord = (
  value: unknown
): { readonly [key: string]: unknown } | undefined => {
  if (!isPlainObject(value)) return undefined
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return entries.length ? Object.fromEntries(entries) : undefined
}

export const normalizeParameterValue = (value: unknown): string | number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "true" : "false"
  return JSON.stringify(value ?? null)
}

export const buildChoiceSet = (
  list: WorkspaceParameter["listOptions"]
): Set<string | number> | null =>
  list?.length
    ? new Set(list.map((opt) => normalizeParameterValue(opt.value)))
    : null

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
    ...(typeof timeout === "number" && Number.isFinite(timeout)
      ? { requestTimeout: timeout }
      : {}),
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

export const asString = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : ""

export const toStr = (val: unknown): string => {
  if (typeof val === "string") return val
  if (typeof val === "number" || typeof val === "boolean") return String(val)
  if (val === undefined) return "undefined"
  if (val === null) return "null"
  if (val && typeof val === "object") {
    try {
      return JSON.stringify(val)
    } catch {
      return Object.prototype.toString.call(val)
    }
  }
  return Object.prototype.toString.call(val)
}

export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (NO_REPLY_REGEX.test(email)) return false
  return EMAIL_REGEX.test(email)
}

export const getSupportEmail = (
  configuredEmailRaw: unknown
): string | undefined => {
  const cfg = toTrimmedString(configuredEmailRaw)
  return cfg && isValidEmail(cfg) ? cfg : undefined
}

// Placeholder and translation helpers
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

  const kindMap = {
    email: "placeholderEmail",
    phone: "placeholderPhone",
    search: "placeholderSearch",
  }

  return kind ? translate(kindMap[kind]) : placeholders.enter
}

export const computeSelectCoerce = (
  isSelectType: boolean,
  selectOptions: ReadonlyArray<{ readonly value?: unknown }>
): "number" | undefined => {
  if (!isSelectType || !selectOptions?.length) return undefined

  const isNumericValue = (v: unknown): boolean => {
    if (typeof v === "number") return Number.isFinite(v)
    if (typeof v === "string") {
      const trimmed = v.trim()
      if (!trimmed) return false
      const n = Number(trimmed)
      return Number.isFinite(n) && String(n) === trimmed
    }
    return false
  }

  const allNumeric = selectOptions.every((o) => isNumericValue(o.value))
  return allNumeric ? "number" : undefined
}

export const parseTableRows = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((x) => (typeof x === "string" ? x : String(x)))
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : value ? [value] : []
    } catch {
      return value ? [value] : []
    }
  }

  return []
}

export const formatByteSize = (size: unknown): string | null => {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return null
  }

  const UNITS = ["B", "KB", "MB", "GB", "TB"] as const
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const shouldUseSingleDecimal = unitIndex > 0 && value < 10
  const formatted = shouldUseSingleDecimal
    ? value.toFixed(1)
    : Math.round(value).toString()

  return `${formatted} ${UNITS[unitIndex]}`
}

export function resolveMessageOrKey(
  raw: string,
  translate: TranslateFn
): string {
  if (!raw) return ""

  return translate(raw)
}

export const maskEmailForDisplay = (email: unknown): string => {
  const trimmed = toTrimmedString(email)
  if (!trimmed || !isValidEmail(trimmed)) return trimmed || ""

  const atIdx = trimmed.indexOf("@")
  if (atIdx <= 1) return `**${trimmed.slice(atIdx)}`

  const local = trimmed.slice(0, atIdx)
  const domain = trimmed.slice(atIdx)
  const visible = local.slice(0, 2)

  return `${visible}****${domain}`
}

export const buildSupportHintText = (
  translate: TranslateFn,
  supportEmail?: string,
  userFriendly?: string
): string => {
  const sanitizedEmail = toTrimmedString(supportEmail)
  if (sanitizedEmail) {
    const template = translate("contactSupportEmail")
    return template.replace(EMAIL_PLACEHOLDER, sanitizedEmail)
  }

  return toTrimmedString(userFriendly) || ""
}

const parseIpv4 = (hostname: string): number[] | null => {
  const parts = hostname.split(".")
  if (parts.length !== 4) return null

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return NaN
    const value = Number(part)
    return value >= 0 && value <= 255 ? value : NaN
  })

  return octets.every(Number.isInteger) ? octets : null
}

const isPrivateIpv4 = (octets: number[]): boolean => {
  return PRIVATE_IPV4_RANGES.some(({ start, end }) => {
    for (let i = 0; i < 4; i++) {
      if (octets[i] < start[i] || octets[i] > end[i]) return false
    }
    return true
  })
}

const isPrivateIpv6 = (hostname: string): boolean => {
  const lower = hostname.toLowerCase()
  return (
    lower === "::1" ||
    lower === "0:0:0:0:0:0:0:1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  )
}

const hasDisallowedSuffix = (hostname: string): boolean => {
  const lower = hostname.toLowerCase()
  return FORBIDDEN_HOSTNAME_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(suffix)
  )
}

export const isValidExternalUrlForOptGetUrl = (s: string): boolean => {
  const trimmed = (s || "").trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return false

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }

  if (url.username || url.password || url.protocol !== "https:") return false

  const host = url.hostname.toLowerCase()
  if (!host || hasDisallowedSuffix(host)) return false

  const ipv4 = parseIpv4(host)
  if (ipv4 && isPrivateIpv4(ipv4)) return false
  if (host.includes(":") && isPrivateIpv6(host)) return false

  const hasFileExtension = /\.[^/]+$/.test(url.pathname)
  if (hasFileExtension) {
    const pathWithQuery = `${url.pathname}${url.search}`
    if (!ALLOWED_FILE_EXTENSIONS.test(pathWithQuery)) return false
  }

  return true
}

export const buildSymbols = (rgb: readonly [number, number, number]) => {
  const base = [rgb[0], rgb[1], rgb[2]] as [number, number, number]
  const highlight = {
    type: "simple-fill" as const,
    color: [...base, 0.2] as [number, number, number, number],
    outline: {
      color: base,
      width: 2,
      style: "solid" as const,
    },
  }
  const symbols = {
    polygon: highlight,
    polyline: {
      type: "simple-line",
      color: base,
      width: 2,
      style: "solid",
    },
    point: {
      type: "simple-marker",
      style: "circle",
      size: 8,
      color: base,
      outline: {
        color: [255, 255, 255],
        width: 1,
      },
    },
  } as const
  return { HIGHLIGHT_SYMBOL: highlight, DRAWING_SYMBOLS: symbols }
}

export const normalizeSketchCreateTool = (
  tool: string | null | undefined
): "polygon" | "rectangle" | null => {
  if (!tool) return null
  const normalized = tool.toLowerCase()
  if (normalized === "extent" || normalized === "rectangle") {
    return "rectangle"
  }
  if (normalized === "polygon") {
    return "polygon"
  }
  return null
}

export const parseSubmissionFormData = (rawData: {
  [key: string]: unknown
}): {
  sanitizedFormData: { [key: string]: unknown }
  uploadFile: File | null
  remoteUrl: string
} => {
  const {
    __upload_file__: uploadField,
    __remote_dataset_url__: remoteDatasetField,
    opt_geturl: optGetUrlField,
    ...restFormData
  } = rawData

  const sanitizedOptGetUrl = toTrimmedString(optGetUrlField)
  const sanitizedFormData = sanitizedOptGetUrl
    ? { ...restFormData, opt_geturl: sanitizedOptGetUrl }
    : { ...restFormData }

  const normalizedFormData: { [key: string]: unknown } = {}
  for (const [key, val] of Object.entries(sanitizedFormData)) {
    normalizedFormData[key] = coerceFormValueForSubmission(val)
  }

  const uploadFile = uploadField instanceof File ? uploadField : null
  const remoteUrl = toTrimmedString(remoteDatasetField) ?? ""

  return { sanitizedFormData: normalizedFormData, uploadFile, remoteUrl }
}

export const applyUploadedDatasetParam = ({
  finalParams,
  uploadedPath,
  parameters,
  explicitTarget,
}: {
  finalParams: { [key: string]: unknown }
  uploadedPath?: string
  parameters?: readonly WorkspaceParameter[] | null
  explicitTarget: string | null
}): void => {
  if (!uploadedPath) return

  if (explicitTarget) {
    finalParams[explicitTarget] = uploadedPath
    return
  }

  const candidate = (parameters ?? []).find((param) => {
    const normalizedType = String(
      param?.type
    ) as (typeof UPLOAD_PARAM_TYPES)[number]
    return UPLOAD_PARAM_TYPES.includes(normalizedType)
  })

  if (candidate?.name) {
    finalParams[candidate.name] = uploadedPath
    return
  }

  if (
    typeof (finalParams as { SourceDataset?: unknown }).SourceDataset ===
    "undefined"
  ) {
    ;(finalParams as { SourceDataset?: unknown }).SourceDataset = uploadedPath
  }
}

export const isNavigatorOffline = (): boolean => {
  try {
    const nav = (globalThis as any)?.navigator
    return Boolean(nav && nav.onLine === false)
  } catch {
    return false
  }
}

export const shouldApplyRemoteDatasetUrl = (
  remoteUrl: unknown,
  config: FmeExportConfig | null | undefined
): boolean => {
  if (!config?.allowRemoteDataset) return false
  if (!config?.allowRemoteUrlDataset) return false

  const trimmed = toTrimmedString(remoteUrl)
  if (!trimmed) return false

  return isValidExternalUrlForOptGetUrl(trimmed)
}

export const shouldUploadRemoteDataset = (
  config: FmeExportConfig | null | undefined,
  uploadFile: File | Blob | null | undefined
): boolean => {
  if (!config?.allowRemoteDataset) return false
  if (!uploadFile) return false

  if (typeof Blob !== "undefined" && uploadFile instanceof Blob) {
    return true
  }

  return isFileObject(uploadFile)
}

export const removeAoiErrorMarker = (params: MutableParams): void => {
  if (typeof params.__aoi_error__ !== "undefined") {
    delete params.__aoi_error__
  }
}

export const computeWidgetsToClose = (
  runtimeInfo:
    | { [id: string]: { state?: WidgetState | string } | undefined }
    | null
    | undefined,
  widgetId: string
): string[] => {
  if (!runtimeInfo) return []

  const ids: string[] = []

  for (const [id, info] of Object.entries(runtimeInfo)) {
    if (id === widgetId || !info) continue
    const stateRaw = info.state
    if (!stateRaw) continue
    const normalized =
      typeof stateRaw === "string"
        ? stateRaw.toUpperCase()
        : String(stateRaw).toUpperCase()

    if (
      normalized === WidgetState.Closed ||
      normalized === WidgetState.Hidden
    ) {
      continue
    }

    ids.push(id)
  }

  return ids
}

export const clearPopupSuppression = (
  ref: { current: PopupSuppressionRecord | null } | null | undefined
): void => {
  const record = ref?.current
  if (!record) return
  releasePopupSuppressionRecord(record)
  ref.current = null
}

export const applyPopupSuppression = (
  ref: { current: PopupSuppressionRecord | null } | null | undefined,
  popup: __esri.Popup | null | undefined,
  view: __esri.MapView | __esri.SceneView | null | undefined
): void => {
  if (!ref) return

  if (!popup) {
    clearPopupSuppression(ref)
    return
  }

  if (ref.current?.popup === popup) {
    try {
      if (view && typeof (view as any).closePopup === "function") {
        ;(view as any).closePopup()
      } else if (typeof popup.close === "function") {
        popup.close()
      }
    } catch {}
    return
  }

  clearPopupSuppression(ref)

  const record = createPopupSuppressionRecord(popup, view)
  ref.current = record
}

export function formatErrorForView(
  translate: TranslateFn,
  baseKeyOrMessage: string,
  code?: string,
  supportEmail?: string,
  userFriendly?: string
): { message: string; code?: string; hint?: string } {
  const message =
    resolveMessageOrKey(baseKeyOrMessage, translate) || baseKeyOrMessage
  const hint = buildSupportHintText(translate, supportEmail, userFriendly)
  return { message, code, hint }
}

const HTML_ENTITY_MAP = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
})

const HTML_ENTITY_REGEX = /&(?:amp|lt|gt|quot|#39);/g

const MAX_HTML_CODE_POINT = 0x10ffff

const decodeHtmlNumericEntity = (value: string, base: number): string => {
  const parsed = Number.parseInt(value, base)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_HTML_CODE_POINT)
    return ""
  try {
    return String.fromCodePoint(parsed)
  } catch {
    return ""
  }
}

const decodeDecimalEntity = (_match: string, value: string): string =>
  decodeHtmlNumericEntity(value, 10)

const decodeHexEntity = (_match: string, value: string): string =>
  decodeHtmlNumericEntity(value, 16)

const replaceNamedEntities = (value: string): string =>
  value.replace(HTML_ENTITY_REGEX, (match) => HTML_ENTITY_MAP[match] || match)

export const stripHtmlToText = (input?: string): string => {
  if (!input) return ""

  const noTags = input
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")

  const decoded = replaceNamedEntities(
    noTags
      .replace(/&#(\d+);/g, decodeDecimalEntity)
      .replace(/&#x([\da-f]+);/gi, decodeHexEntity)
  )

  return decoded.replace(/\s+/g, " ").trim()
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
    } catch {
      // Ignore abort errors
    }
  }
}

const ABORT_REGEX = /abort/i

export const isAbortError = (error: unknown): boolean => {
  if (!error) return false
  if (typeof error === "string") return ABORT_REGEX.test(error)
  if (typeof error !== "object") return false

  const candidate = error as {
    name?: unknown
    code?: unknown
    message?: unknown
  }
  const name = toStr(candidate.name ?? candidate.code)
  const message = toStr(candidate.message)

  return ABORT_REGEX.test(name) || ABORT_REGEX.test(message)
}

export const logIfNotAbort = (_context: string, error: unknown): void => {
  // Intentionally no-op to prevent logging sensitive data
  void (_context, error)
}

const restorePopupAutoOpen = (record: PopupSuppressionRecord): void => {
  const popupAny = record.popup as unknown as { autoOpenEnabled?: boolean }
  try {
    const restore =
      typeof record.prevAutoOpen === "boolean" ? record.prevAutoOpen : true
    popupAny.autoOpenEnabled = restore
  } catch {}
}

const closePopupSafely = (
  view: __esri.MapView | __esri.SceneView | null | undefined,
  popup: __esri.Popup | null | undefined
): void => {
  try {
    if (view && typeof (view as any).closePopup === "function") {
      ;(view as any).closePopup()
    } else if (popup && typeof popup.close === "function") {
      popup.close()
    }
  } catch {}
}

export const createPopupSuppressionRecord = (
  popup: __esri.Popup | null | undefined,
  view: __esri.MapView | __esri.SceneView | null | undefined
): PopupSuppressionRecord | null => {
  if (!popup) return null

  const popupAny = popup as unknown as { autoOpenEnabled?: boolean }
  const previousAutoOpen =
    typeof popupAny.autoOpenEnabled === "boolean"
      ? popupAny.autoOpenEnabled
      : undefined

  closePopupSafely(view, popup)

  try {
    popupAny.autoOpenEnabled = false
  } catch {}

  let handle: __esri.WatchHandle | null = null
  if (typeof popup.watch === "function") {
    try {
      handle = popup.watch("visible", (value: boolean) => {
        if (value) {
          closePopupSafely(view, popup)
        }
      })
    } catch {}
  }

  return {
    popup,
    view: view || null,
    handle,
    prevAutoOpen: previousAutoOpen,
  }
}

export const releasePopupSuppressionRecord = (
  record: PopupSuppressionRecord | null | undefined
): void => {
  if (!record) return

  try {
    record.handle?.remove?.()
  } catch {}

  restorePopupAutoOpen(record)
}

class PopupSuppressionManager {
  private record: PopupSuppressionRecord | null = null

  private readonly owners = new Set<symbol>()

  acquire(
    ownerId: symbol,
    popup: __esri.Popup | null | undefined,
    view: __esri.MapView | __esri.SceneView | null | undefined
  ): void {
    if (!popup) {
      this.release(ownerId)
      return
    }

    const activePopup = this.record?.popup
    if (!activePopup || activePopup !== popup) {
      this.teardown()
      this.owners.clear()
      const record = createPopupSuppressionRecord(popup, view)
      if (!record) return
      this.record = record
    }

    this.owners.add(ownerId)
  }

  release(ownerId: symbol): void {
    if (!this.owners.delete(ownerId)) return
    if (this.owners.size === 0) {
      this.teardown()
    }
  }

  releaseAll(): void {
    if (this.owners.size === 0 && !this.record) return
    this.owners.clear()
    this.teardown()
  }

  private teardown(): void {
    if (!this.record) return
    releasePopupSuppressionRecord(this.record)
    this.record = null
  }
}

export const popupSuppressionManager = new PopupSuppressionManager()

// Collection utilities
const isIterable = (value: unknown): value is Iterable<unknown> =>
  typeof value !== "string" &&
  typeof (value as any)?.[Symbol.iterator] === "function"

const mapDefined = <T, R>(
  values: Iterable<T> | null | undefined,
  mapper: (value: T, index: number) => R | null | undefined
): R[] => {
  if (!values || !isIterable(values)) return []

  const result: R[] = []
  let index = 0

  for (const value of values) {
    const mapped = mapper(value, index++)
    if (mapped != null) result.push(mapped)
  }

  return result
}

export const collectTrimmedStrings = (
  values: Iterable<unknown> | null | undefined
): string[] => mapDefined(values, toTrimmedString)

const toRecord = (value: unknown): { [key: string]: unknown } | null =>
  value && typeof value === "object"
    ? (value as { [key: string]: unknown })
    : null

const collectStringsFromProp = (
  values: Iterable<unknown> | null | undefined,
  prop: string
): string[] =>
  mapDefined(values, (value) => {
    const record = toRecord(value)
    return record ? toTrimmedString(record[prop]) : undefined
  })

export const uniqueStrings = (values: Iterable<string>): string[] => {
  if (!values || !isIterable(values)) return []

  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }

  return result
}

export const extractRepositoryNames = (source: unknown): string[] => {
  if (Array.isArray(source)) {
    return uniqueStrings(collectStringsFromProp(source, "name"))
  }

  const record = toRecord(source)
  const items = record?.items

  if (Array.isArray(items)) {
    return uniqueStrings(collectStringsFromProp(items, "name"))
  }

  return []
}

// Re-export useLatestAbortController from hooks for backward compatibility
export { useLatestAbortController } from "./hooks"

export const maskToken = (token: string): string => {
  if (!token) return ""
  if (token.length <= 4) return "****"
  return `****${token.slice(-4)}`
}

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

// AREA & UNIT CONVERSION
const GEOMETRY_CONSTS = {
  M2_PER_KM2: 1_000_000,
  AREA_DECIMALS: 2,
  METERS_PER_KILOMETER: 1_000,
  SQUARE_FEET_PER_SQUARE_MILE: 27_878_400,
} as const

const UNIT_CONVERSIONS: readonly UnitConversion[] = [
  {
    factor: 0.3048,
    label: "ft²",
    keywords: ["foot", "feet"],
    largeUnit: {
      threshold: GEOMETRY_CONSTS.SQUARE_FEET_PER_SQUARE_MILE,
      factor: GEOMETRY_CONSTS.SQUARE_FEET_PER_SQUARE_MILE,
      label: "mi²",
    },
  },
  { factor: 0.3048006096, label: "ft²", keywords: [] },
  { factor: 1609.344, label: "mi²", keywords: ["mile"] },
  {
    factor: GEOMETRY_CONSTS.METERS_PER_KILOMETER,
    label: "km²",
    keywords: ["kilometer"],
  },
  { factor: 0.9144, label: "yd²", keywords: ["yard"] },
  { factor: 0.0254, label: "in²", keywords: ["inch"] },
  { factor: 0.01, label: "cm²", keywords: ["centimeter"] },
  { factor: 0.001, label: "mm²", keywords: ["millimeter"] },
  { factor: 1852, label: "nm²", keywords: ["nautical"] },
  { factor: 1, label: "m²", keywords: ["meter"] },
] as const

const approxLengthUnit = (
  value: number | undefined,
  target: number
): boolean => {
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  const tolerance = Math.max(1e-9, Math.abs(target) * 1e-6)
  return Math.abs(value - target) <= tolerance
}

const getDecimalPlaces = (value: number, isLargeUnit = false): number => {
  if (isLargeUnit) return 2
  if (value >= 100) return 0
  if (value >= 10) return 1
  return 2
}

const normalizeUnitLabel = (unit?: string): string => {
  if (!unit) return "units²"

  const trimmed = unit.replace(/^esri/i, "").trim()
  if (!trimmed) return "units²"

  const lower = trimmed.toLowerCase()

  switch (lower) {
    case "meters":
      return "m²"
    case "feet":
    case "internationalfeet":
    case "ussfeet":
      return "ft²"
    case "kilometers":
      return "km²"
    case "miles":
      return "mi²"
    case "yards":
      return "yd²"
    case "inches":
      return "in²"
    case "centimeters":
      return "cm²"
    case "millimeters":
      return "mm²"
    case "nauticalmiles":
      return "nm²"
    default:
      return `${lower}²`
  }
}

export const buildLargeAreaWarningMessage = ({
  currentAreaText,
  thresholdAreaText,
  translate,
}: {
  currentAreaText?: string | null
  thresholdAreaText?: string | null
  translate: TranslateFn
}): string | null => {
  const current = toTrimmedString(currentAreaText)
  if (!current) return null

  const threshold = toTrimmedString(thresholdAreaText)

  if (threshold) {
    return translate("largeAreaWarningWithThreshold", {
      current,
      threshold,
    })
  }

  return translate("largeAreaWarning", { current })
}

const resolveMetricDisplay = (area: number): AreaDisplay => {
  if (area >= GEOMETRY_CONSTS.M2_PER_KM2) {
    return {
      value: area / GEOMETRY_CONSTS.M2_PER_KM2,
      label: "km²",
      decimals: GEOMETRY_CONSTS.AREA_DECIMALS,
    }
  }

  if (area >= 1) {
    return {
      value: Math.round(area),
      label: "m²",
      decimals: 0,
    }
  }

  return {
    value: Number(area.toFixed(2)),
    label: "m²",
    decimals: 2,
  }
}

const matchesUnitKeywords = (
  unitId: string,
  keywords: readonly string[]
): boolean => {
  return keywords.some((keyword) => unitId.includes(keyword))
}

const convertAreaByUnit = (
  area: number,
  factor: number,
  conversion: UnitConversion
): AreaDisplay => {
  const convertedValue = area / (factor * factor)

  if (
    conversion.largeUnit &&
    convertedValue >= conversion.largeUnit.threshold
  ) {
    return {
      value: convertedValue / conversion.largeUnit.factor,
      label: conversion.largeUnit.label,
      decimals: 2,
    }
  }

  const decimals = getDecimalPlaces(
    convertedValue,
    conversion.label.includes("km²") || conversion.label.includes("mi²")
  )
  return { value: convertedValue, label: conversion.label, decimals }
}

const resolveAreaForSpatialReference = (
  area: number,
  spatialReference?: __esri.SpatialReference | null
): AreaDisplay => {
  if (!spatialReference) {
    return resolveMetricDisplay(area)
  }

  const metersPerUnit = spatialReference.metersPerUnit
  const hasValidFactor =
    typeof metersPerUnit === "number" && Number.isFinite(metersPerUnit)

  if (!hasValidFactor) {
    return resolveMetricDisplay(area)
  }

  const unitId =
    typeof spatialReference.unit === "string"
      ? spatialReference.unit.toLowerCase()
      : ""

  const factor = metersPerUnit

  for (const conversion of UNIT_CONVERSIONS) {
    if (
      approxLengthUnit(factor, conversion.factor) ||
      matchesUnitKeywords(unitId, conversion.keywords)
    ) {
      return convertAreaByUnit(area, factor, conversion)
    }
  }

  const value = area / (factor * factor)
  const decimals = getDecimalPlaces(value)
  return { value, label: normalizeUnitLabel(spatialReference.unit), decimals }
}

// GEOMETRY VALIDATION & CONVERSION

const isValidCoordinateTuple = (pt: unknown): boolean =>
  Array.isArray(pt) &&
  pt.length >= 2 &&
  pt.length <= 4 &&
  pt.every((n) => Number.isFinite(n))

const isValidRing = (ring: unknown): boolean =>
  Array.isArray(ring) && ring.length >= 3 && ring.every(isValidCoordinateTuple)

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

  return Array.isArray(rings) && rings.length > 0 && rings.every(isValidRing)
}

export const sanitizeParamKey = (name: unknown, fallback: string): string => {
  const raw =
    typeof name === "string"
      ? name
      : typeof name === "number" && Number.isFinite(name)
        ? String(name)
        : ""

  const safe = raw.replace(/[^A-Za-z0-9_\-]/g, "").trim()
  return safe || fallback
}

// FME PARAMETER BUILDING & SERVICE MODE
const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = [
  "sync",
  "async",
  "schedule",
] as const
const SCHEDULE_TRIGGER_DEFAULT = "runonce"
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

  // Quick check for presence
  const hasRequiredFields = Boolean(startVal && category && name)
  if (!hasRequiredFields) {
    return false
  }

  // Validate schedule metadata
  const validation = validateScheduleMetadata({
    start: startVal,
    name,
    category,
    description: toTrimmedString(data.description),
  })

  // Log warnings (using logIfNotAbort for consistency)
  if (validation.warnings?.pastTime) {
    logIfNotAbort(
      "Schedule start time is in the past - job may execute immediately or fail",
      { startTime: startVal, warnings: validation.warnings }
    )
  }

  // Log errors (using logIfNotAbort for consistency)
  if (!validation.valid && validation.errors) {
    logIfNotAbort("Schedule metadata validation failed", {
      errors: validation.errors,
    })
  }

  return validation.valid
}

const sanitizeScheduleMetadata = (
  data: { [key: string]: unknown },
  mode: ServiceMode
): { [key: string]: unknown } => {
  if (mode !== "schedule") {
    const pruned: { [key: string]: unknown } = {}
    for (const [key, value] of Object.entries(data)) {
      if (!SCHEDULE_METADATA_KEYS.has(key)) {
        pruned[key] = value
      }
    }
    return pruned
  }

  const sanitized: { [key: string]: unknown } = {}
  for (const [key, value] of Object.entries(data)) {
    if (!SCHEDULE_METADATA_KEYS.has(key)) {
      sanitized[key] = value
      continue
    }

    if (key === "trigger") {
      const trimmedTrigger = toTrimmedString(value)
      sanitized.trigger = trimmedTrigger ?? SCHEDULE_TRIGGER_DEFAULT
      continue
    }

    const trimmedValue = toTrimmedString(value)
    if (trimmedValue) {
      sanitized[key] = trimmedValue
    }
  }

  if (sanitized.trigger === undefined) {
    sanitized.trigger = SCHEDULE_TRIGGER_DEFAULT
  }

  return sanitized
}

const RUNTIME_ASYNC_THRESHOLD_SECONDS = 5
const TRANSFORMER_ASYNC_THRESHOLD = 120
const FILE_SIZE_ASYNC_THRESHOLD_BYTES = 25 * 1024 * 1024

const RUNTIME_PROPERTY_KEYS = Object.freeze([
  "estimatedRuntimeSeconds",
  "estimatedRunSeconds",
  "estimatedDurationSeconds",
  "avgRuntimeSeconds",
  "averageRuntimeSeconds",
  "expectedRuntimeSeconds",
  "expectedRunTimeSeconds",
  "estimated_runtime_seconds",
  "estimated_run_seconds",
  "estimated_duration_seconds",
])

const TRANSFORMER_PROPERTY_KEYS = Object.freeze([
  "transformerCount",
  "transformer_count",
  "estimatedTransformerCount",
])

const FILE_SIZE_PROPERTY_KEYS = Object.freeze([
  "fileSizeBytes",
  "fileSize",
  "estimatedDataSizeBytes",
  "estimatedDataSize",
  "estimatedFileSize",
])

const parseRuntimeSeconds = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value
  }

  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const lower = trimmed.toLowerCase()

  const isoMatch = lower.match(/^pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (isoMatch) {
    const hours = Number(isoMatch[1] || 0)
    const minutes = Number(isoMatch[2] || 0)
    const seconds = Number(isoMatch[3] || 0)
    return hours * 3600 + minutes * 60 + seconds
  }

  const hmsMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (hmsMatch) {
    const hours = Number(hmsMatch[1] || 0)
    const minutes = Number(hmsMatch[2] || 0)
    const seconds = Number(hmsMatch[3] || 0)
    return hours * 3600 + minutes * 60 + seconds
  }

  const numericMatch = trimmed.match(/(-?\d+(?:\.\d+)?)/)
  if (!numericMatch) return null

  const numeric = Number(numericMatch[1])
  if (!Number.isFinite(numeric) || numeric < 0) return null

  if (lower.includes("hour")) return numeric * 3600
  if (lower.includes("min")) return numeric * 60
  if (lower.includes("ms")) return numeric / 1000
  if (lower.includes("sec") || lower.endsWith("s")) return numeric

  return numeric
}

const getFirstNumericProperty = (
  source: { readonly [key: string]: unknown } | undefined,
  keys: readonly string[],
  parser: (value: unknown) => number | null
): number | null => {
  if (!isPlainObject(source)) return null
  for (const key of keys) {
    if (!(key in source)) continue
    const parsed = parser(source[key])
    if (parsed !== null && parsed !== undefined) {
      return parsed
    }
  }
  return null
}

const extractRuntimeSeconds = (
  workspace?: WorkspaceItem | WorkspaceItemDetail | null
): number | null => {
  if (!workspace) return null

  const direct = parseRuntimeSeconds(
    (workspace as { estimatedRuntimeSeconds?: unknown }).estimatedRuntimeSeconds
  )
  if (direct != null) return direct

  const props = isPlainObject(workspace.properties)
    ? (workspace.properties as { readonly [key: string]: unknown })
    : undefined

  const fromProps = getFirstNumericProperty(
    props,
    RUNTIME_PROPERTY_KEYS,
    parseRuntimeSeconds
  )
  if (fromProps != null) return fromProps

  const nestedPerformance = isPlainObject((props as any)?.performance)
    ? ((props as any).performance as { readonly [key: string]: unknown })
    : undefined
  const fromPerformance = getFirstNumericProperty(
    nestedPerformance,
    RUNTIME_PROPERTY_KEYS,
    parseRuntimeSeconds
  )
  if (fromPerformance != null) return fromPerformance

  const fallbackKeys = [
    "estimatedRuntime",
    "estimatedRuntimeSec",
    "expectedRuntime",
  ]
  for (const key of fallbackKeys) {
    const value = parseRuntimeSeconds((workspace as any)[key])
    if (value != null) return value
  }

  return null
}

const toPositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value)
  }
  if (typeof value === "string") {
    const match = value.match(/(\d+)/)
    if (match) {
      const parsed = Number(match[1])
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.round(parsed)
      }
    }
  }
  return null
}

const extractTransformerCount = (
  workspace?: WorkspaceItem | WorkspaceItemDetail | null
): number | null => {
  if (!workspace) return null
  const direct = toPositiveInteger((workspace as any).transformerCount)
  if (direct != null) return direct

  const props = isPlainObject(workspace.properties)
    ? (workspace.properties as { readonly [key: string]: unknown })
    : undefined

  const fromProps = getFirstNumericProperty(
    props,
    TRANSFORMER_PROPERTY_KEYS,
    toPositiveInteger
  )
  if (fromProps != null) return fromProps

  return null
}

const parseFileSizeBytes = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (value > 4096) {
      return value
    }
    return value * 1024 * 1024
  }

  if (typeof value !== "string") return null

  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null

  const match = trimmed.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null

  const numeric = Number(match[1])
  if (!Number.isFinite(numeric) || numeric <= 0) return null

  if (trimmed.includes("gb")) return numeric * 1024 * 1024 * 1024
  if (trimmed.includes("mb")) return numeric * 1024 * 1024
  if (trimmed.includes("kb")) return numeric * 1024
  if (trimmed.includes("byte")) return numeric

  if (numeric > 4096) return numeric
  if (numeric > 1024) return numeric

  return numeric * 1024 * 1024
}

const extractFileSizeBytes = (
  workspace?: WorkspaceItem | WorkspaceItemDetail | null
): number | null => {
  if (!workspace) return null
  const direct = parseFileSizeBytes((workspace as any).fileSize)
  if (direct != null) return direct

  const props = isPlainObject(workspace.properties)
    ? (workspace.properties as { readonly [key: string]: unknown })
    : undefined

  const fromProps = getFirstNumericProperty(
    props,
    FILE_SIZE_PROPERTY_KEYS,
    parseFileSizeBytes
  )
  if (fromProps != null) return fromProps

  return null
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

  const runtimeSeconds = extractRuntimeSeconds(options.workspaceItem)
  if (
    runtimeSeconds != null &&
    runtimeSeconds >= RUNTIME_ASYNC_THRESHOLD_SECONDS
  ) {
    return {
      reason: "runtime",
      value: runtimeSeconds,
      threshold: RUNTIME_ASYNC_THRESHOLD_SECONDS,
    }
  }

  const transformerCount = extractTransformerCount(options.workspaceItem)
  if (
    transformerCount != null &&
    transformerCount >= TRANSFORMER_ASYNC_THRESHOLD
  ) {
    return {
      reason: "transformers",
      value: transformerCount,
      threshold: TRANSFORMER_ASYNC_THRESHOLD,
    }
  }

  const fileSizeBytes = extractFileSizeBytes(options.workspaceItem)
  if (
    fileSizeBytes != null &&
    fileSizeBytes >= FILE_SIZE_ASYNC_THRESHOLD_BYTES
  ) {
    return {
      reason: "fileSize",
      value: fileSizeBytes,
      threshold: FILE_SIZE_ASYNC_THRESHOLD_BYTES,
    }
  }

  return null
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

export const buildScheduleSummary = (data: {
  [key: string]: unknown
}): string | null => {
  const startVal = toTrimmedString(data.start)
  const name = toTrimmedString(data.name)
  const category = toTrimmedString(data.category)
  const description = toTrimmedString(data.description)

  if (!startVal || !name || !category) {
    return null
  }

  const parts = [
    `Job Name: ${name}`,
    `Category: ${category}`,
    `Start Time: ${startVal} (FME Server time)`,
  ]

  if (description) {
    parts.push(`Description: ${description}`)
  }

  return parts.join("\n")
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
  const hasScientific = /[eE]/.test(str)
  const raw = hasScientific ? value.toFixed(12) : str
  const trimmed = raw.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")

  return trimmed || "0"
}

export const polygonJsonToGeoJson = (poly: any): any => {
  if (!poly) return null

  try {
    const rings = extractRings(poly)
    if (!rings.length) return null

    const normalized = rings
      .map(normalizeRing)
      .filter((ring) => ring.length >= 4)

    if (!normalized.length) return null

    return {
      type: "Polygon",
      coordinates: normalized,
    }
  } catch {
    return null
  }
}

const serializeCoordinate = (coords: unknown): string | null => {
  if (!Array.isArray(coords) || coords.length < 2) return null

  const values: string[] = []
  for (const raw of coords) {
    const num = typeof raw === "number" ? raw : Number(raw)
    if (!Number.isFinite(num)) return null
    values.push(formatNumberForWkt(num))
  }

  return values.length >= 2 ? values.join(" ") : null
}

const serializeRing = (ring: unknown): string[] => {
  if (!Array.isArray(ring)) return []

  const parts: string[] = []
  for (const vertex of ring) {
    const serialized = serializeCoordinate(vertex)
    if (serialized) parts.push(serialized)
  }

  return parts
}

export const polygonJsonToWkt = (poly: any): string => {
  const geojson = polygonJsonToGeoJson(poly)
  if (!geojson) return "POLYGON EMPTY"

  const rings = Array.isArray(geojson?.coordinates)
    ? (geojson.coordinates as number[][][])
    : []

  if (!rings.length) return "POLYGON EMPTY"

  const serialized = rings
    .map(serializeRing)
    .filter((parts) => parts.length >= 4)
    .map((parts) => `(${parts.join(", ")})`)
    .filter((ring) => ring !== "()" && ring !== "( )")

  if (!serialized.length) return "POLYGON EMPTY"

  return `POLYGON(${serialized.join(", ")})`
}

const isWgs84Spatial = (sr: any): boolean =>
  sr?.isWGS84 === true || sr?.wkid === 4326

const projectToWgs84 = (
  poly: __esri.Polygon,
  modules: EsriModules
): __esri.Polygon | null => {
  const { projection, SpatialReference } = modules
  if (!projection?.project || !SpatialReference) return null

  const SpatialRefCtor = SpatialReference as any
  const target =
    SpatialRefCtor.WGS84 ||
    (typeof SpatialRefCtor === "function"
      ? new SpatialRefCtor({ wkid: 4326 })
      : { wkid: 4326 })

  const projected = projection.project(poly, target)
  if (Array.isArray(projected)) {
    return (projected[0] as __esri.Polygon) || null
  }
  return (projected as __esri.Polygon) || null
}

export const toWgs84PolygonJson = (
  polyJson: any,
  modules: EsriModules | null | undefined
): any => {
  if (!modules?.Polygon) return polyJson

  try {
    const poly = modules.Polygon.fromJSON(polyJson)
    if (!poly) return polyJson

    const sr = (poly as any).spatialReference
    if (isWgs84Spatial(sr)) {
      return poly.toJSON()
    }

    const projected = projectToWgs84(poly, modules)
    if (projected?.toJSON) {
      return projected.toJSON()
    }

    const { webMercatorUtils } = modules
    if (webMercatorUtils?.webMercatorToGeographic) {
      const geographic = webMercatorUtils.webMercatorToGeographic(
        poly
      ) as __esri.Polygon
      if (geographic?.toJSON) {
        return geographic.toJSON()
      }
    }

    return poly.toJSON()
  } catch {
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

const collectGeometryParamNames = (
  params?: readonly WorkspaceParameter[] | null
): readonly string[] => {
  if (!params?.length) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const param of params) {
    if (!param || param.type !== ParameterType.GEOMETRY) continue
    const trimmed = toTrimmedString(param.name)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    names.push(trimmed)
  }
  return names
}

const extractPolygonJson = (
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): unknown => {
  if (isPolygonGeometry(geometryJson)) {
    const asAny = geometryJson as any
    return "geometry" in asAny ? asAny.geometry : geometryJson
  }

  const fallback = currentGeometry?.toJSON()
  return isPolygonGeometry(fallback) ? fallback : null
}

const safeStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  _modules: EsriModules | null | undefined,
  config?: FmeExportConfig,
  geometryParamNames?: readonly string[]
): { [key: string]: unknown } => {
  const paramName = sanitizeParamKey(config?.aoiParamName, "AreaOfInterest")
  const aoiJson = extractPolygonJson(geometryJson, currentGeometry)
  if (!aoiJson) return base

  const serialized = safeStringify(aoiJson)
  if (!serialized) {
    return { ...base, __aoi_error__: createAoiSerializationError() }
  }

  const result: { [key: string]: unknown } = {
    ...base,
    [paramName]: serialized,
  }

  if (geometryParamNames?.length) {
    const extras = new Set<string>()
    for (const name of geometryParamNames) {
      const sanitized = sanitizeParamKey(name, "")
      if (sanitized && sanitized !== paramName) extras.add(sanitized)
    }
    for (const extra of extras) {
      result[extra] = serialized
    }
  }

  return result
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

  if (!("tm_ttc" in out)) {
    const v = toPosInt(config.tm_ttc)
    if (v !== undefined) out.tm_ttc = v
  }
  if (!("tm_ttl" in out)) {
    const v = toPosInt(config.tm_ttl)
    if (v !== undefined) out.tm_ttl = v
  }

  return out
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
  const { config, workspaceParameters, workspaceItem, areaWarning, drawnArea } =
    options || {}
  const original = ((formData as any)?.data || {}) as {
    [key: string]: unknown
  }
  const chosen = determineServiceMode({ data: original }, config, {
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

  const sanitized = sanitizeScheduleMetadata(publicFields, chosen)

  const base = buildFmeParams({ data: sanitized }, userEmail, chosen, config)
  const geometryParamNames = collectGeometryParamNames(workspaceParameters)
  const withAoi = attachAoi(
    base,
    geometryJson,
    currentGeometry,
    modules,
    config,
    geometryParamNames
  )
  const withDirectives = applyDirectiveDefaults(withAoi, config)
  return withDirectives
}

export function formatArea(
  area: number,
  modules: EsriModules,
  spatialReference?: __esri.SpatialReference | null
): string {
  const safeArea = Number.isFinite(area) && area > 0 ? area : 0
  const display = resolveAreaForSpatialReference(safeArea, spatialReference)

  const formatNumber = (value: number, decimals: number): string => {
    const intlModule = (modules as any)?.intl
    if (intlModule && typeof intlModule.formatNumber === "function") {
      const result = intlModule.formatNumber(value, {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      })
      return typeof result === "number" ? result.toString() : result
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })
  }

  if (!display.value || display.value <= 0) {
    return `0 ${display.label}`
  }

  const formatted = formatNumber(display.value, display.decimals)
  return `${formatted} ${display.label}`
}

export const getEmail = async (_config?: FmeExportConfig): Promise<string> => {
  const user = await SessionManager.getInstance().getUserInfo()
  const email = (user?.email || _config?.defaultRequesterEmail || "")
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

  const stripLeadingSlash = (value: string): string =>
    value.startsWith("/") ? value.slice(1) : value

  if (endpoint.startsWith("/fme")) {
    return buildUrl(serverUrl, stripLeadingSlash(endpoint))
  }

  const normalizedBase = stripLeadingSlash(basePath || "")
  const normalizedEndpoint = stripLeadingSlash(endpoint)

  return normalizedEndpoint
    ? buildUrl(serverUrl, normalizedBase, normalizedEndpoint)
    : buildUrl(serverUrl, normalizedBase)
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

    const normalized = coerceFormValueForSubmission(value)
    if (normalized === undefined || normalized === null) continue

    if (isFileObject(normalized)) {
      urlParams.append(key, getFileDisplayName(normalized))
      continue
    }

    urlParams.append(key, toStr(normalized))
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
    const normalizedMode =
      modeRaw === "sync"
        ? "sync"
        : modeRaw === "schedule"
          ? "schedule"
          : "async"
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
  // Intentionally a no-op to avoid logging sensitive data; reference params to prevent unused-var lint errors
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
    void error
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

// TEMPORAL UTILITIES (DATE/TIME PARSING & FORMATTING)
export const pad2 = (n: number): string => String(n).padStart(2, "0")

const OFFSET_SUFFIX_RE = /(Z|[+-]\d{2}(?::?\d{2})?)$/i
const FRACTION_SUFFIX_RE = /\.(\d{1,9})$/

const parseTemporalComponents = (
  input: string
): { base: string; fraction: string; offset: string } => {
  if (!input) return { base: "", fraction: "", offset: "" }

  let base = input
  let offset = ""
  const offsetMatch = OFFSET_SUFFIX_RE.exec(base)
  if (offsetMatch?.[1]) {
    offset = offsetMatch[1]
    base = base.slice(0, -offset.length)
  }

  let fraction = ""
  const fractionMatch = FRACTION_SUFFIX_RE.exec(base)
  if (fractionMatch?.[0]) {
    fraction = fractionMatch[0]
    base = base.slice(0, -fraction.length)
  }

  return { base, fraction, offset }
}

export const extractTemporalParts = (
  raw: string
): { base: string; fraction: string; offset: string } => {
  const trimmed = (raw || "").trim()
  return parseTemporalComponents(trimmed)
}

const normalizeIsoTimeParts = (
  time: string
): { time: string; fraction: string; offset: string } => {
  const { base, fraction, offset } = parseTemporalComponents(time)
  return { time: base, fraction, offset }
}

const safePad2 = (part?: string): string | null => {
  if (!part) return null
  const n = Number(part)
  return Number.isFinite(n) && n >= 0 && n <= 99 ? pad2(n) : null
}

export const fmeDateToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length !== 8) return ""
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export const inputToFmeDate = (v: string): string =>
  v ? v.replace(/-/g, "") : ""

export const fmeDateTimeToInput = (v: string): string => {
  const { base } = extractTemporalParts(v)
  const digits = base.replace(/\D/g, "")
  if (digits.length < 12) return ""
  const y = digits.slice(0, 4)
  const m = digits.slice(4, 6)
  const d = digits.slice(6, 8)
  const hh = digits.slice(8, 10)
  const mm = digits.slice(10, 12)
  const ss = digits.length >= 14 ? digits.slice(12, 14) : ""
  return `${y}-${m}-${d}T${hh}:${mm}${ss ? `:${ss}` : ""}`
}

export const inputToFmeDateTime = (v: string, original?: string): string => {
  if (!v) return ""
  const s = v.trim()
  const [date, time] = s.split("T")
  if (!date || !time) return ""

  const [y, m, d] = date.split("-")
  const {
    time: timePart,
    fraction: isoFraction,
    offset: isoOffset,
  } = normalizeIsoTimeParts(time)
  const [hh, mi, ssRaw] = timePart.split(":")

  if (!y || y.length !== 4 || !/^\d{4}$/.test(y)) return ""

  const m2 = safePad2(m)
  const d2 = safePad2(d)
  const hh2 = safePad2(hh)
  const mi2 = safePad2(mi)
  if (!m2 || !d2 || !hh2 || !mi2) return ""

  const ss2 = ssRaw ? safePad2(ssRaw) : "00"
  if (ss2 === null) return ""

  const base = `${y}${m2}${d2}${hh2}${mi2}${ss2}`
  const originalExtras = original ? extractTemporalParts(original) : null
  const fraction = isoFraction || originalExtras?.fraction || ""
  const offset = isoOffset || originalExtras?.offset || ""

  return `${base}${fraction}${offset}`
}

export const fmeTimeToInput = (v: string): string => {
  const { base } = extractTemporalParts(v)
  const s = base.replace(/\D/g, "")
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`
  if (s.length >= 6) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
  return ""
}

export const inputToFmeTime = (v: string, original?: string): string => {
  if (!v) return ""
  const {
    time: timePart,
    fraction: isoFraction,
    offset: isoOffset,
  } = normalizeIsoTimeParts(v)
  const parts = timePart.split(":").map((x) => x || "")
  const hh = parts[0] || ""
  const mm = parts[1] || ""
  const ss = parts[2] || ""

  const nH = Number(hh)
  const nM = Number(mm)
  if (!Number.isFinite(nH) || !Number.isFinite(nM)) return ""

  const nS = Number(ss)
  const finalSS = Number.isFinite(nS) ? pad2(nS) : "00"
  const base = `${pad2(nH)}${pad2(nM)}${finalSS}`

  const originalExtras = original ? extractTemporalParts(original) : null
  const fraction = isoFraction || originalExtras?.fraction || ""
  const offset = isoOffset || originalExtras?.offset || ""

  return `${base}${fraction}${offset}`
}

// COLOR CONVERSION UTILITIES
const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const clamp01 = (value: number): number => clamp(value, 0, 1)
const clamp255 = (value: number): number => clamp(value, 0, 255)

const toHexComponent = (value: number): string =>
  Math.round(clamp255(value)).toString(16).padStart(2, "0")

const formatUnitFraction = (value: number): string =>
  Number(clamp01(value).toFixed(6)).toString()

const formatRgbFraction = (value: number): string =>
  formatUnitFraction(value / 255)

const rgbToHexString = (r: number, g: number, b: number): string =>
  `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`

const cmykToRgb = (
  c: number,
  m: number,
  y: number,
  k: number
): { r: number; g: number; b: number } => {
  const cc = clamp01(c)
  const mm = clamp01(m)
  const yy = clamp01(y)
  const kk = clamp01(k)
  return {
    r: clamp255(255 * (1 - cc) * (1 - kk)),
    g: clamp255(255 * (1 - mm) * (1 - kk)),
    b: clamp255(255 * (1 - yy) * (1 - kk)),
  }
}

const rgbToCmyk = (
  r: number,
  g: number,
  b: number
): { c: number; m: number; y: number; k: number } => {
  const rn = clamp01(r / 255)
  const gn = clamp01(g / 255)
  const bn = clamp01(b / 255)
  const k = 1 - Math.max(rn, gn, bn)

  if (k >= 0.999999) return { c: 0, m: 0, y: 0, k: 1 }

  const denom = 1 - k
  return {
    c: clamp01((1 - rn - k) / denom),
    m: clamp01((1 - gn - k) / denom),
    y: clamp01((1 - bn - k) / denom),
    k: clamp01(k),
  }
}

const parseNormalizedParts = (value: string): number[] =>
  (value || "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(Number)

export const hexToRgbArray = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  const n = m ? parseInt(m[1], 16) : parseInt(DEFAULT_DRAWING_HEX.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

export const normalizedRgbToHex = (
  v: string,
  config?: ColorFieldConfig
): string | null => {
  const parts = parseNormalizedParts(v)
  if (!parts.length) return null

  const treatAsCmyk =
    config?.space === "cmyk" ||
    (!config?.space && !config?.alpha && parts.length === 4)

  if (treatAsCmyk) {
    if (parts.length < 4 || !parts.slice(0, 4).every(Number.isFinite))
      return null
    const [c, m, y, k] = parts
    const rgb = cmykToRgb(c, m, y, k)
    return rgbToHexString(rgb.r, rgb.g, rgb.b)
  }

  if (parts.length < 3 || !parts.slice(0, 3).every(Number.isFinite)) return null
  const [rPart, gPart, bPart] = parts
  const r = clamp255(Math.round(clamp01(rPart) * 255))
  const g = clamp255(Math.round(clamp01(gPart) * 255))
  const b = clamp255(Math.round(clamp01(bPart) * 255))
  return rgbToHexString(r, g, b)
}

export const hexToNormalizedRgb = (
  hex: string,
  config?: ColorFieldConfig
): string | null => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!match) return null

  const numeric = parseInt(match[1], 16)
  const r = (numeric >> 16) & 0xff
  const g = (numeric >> 8) & 0xff
  const b = numeric & 0xff

  if (config?.space === "cmyk") {
    const { c, m, y, k } = rgbToCmyk(r, g, b)
    return [c, m, y, k].map(formatUnitFraction).join(",")
  }

  return [r, g, b].map(formatRgbFraction).join(",")
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
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof value === "boolean") return value
  return ""
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

// FORM VALUE HANDLING & FILE UTILITIES
export function isFileObject(value: unknown): value is File {
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
  const name = toTrimmedString((file as any)?.name)
  return name || "unnamed-file"
}

const isCompositeValue = (
  value: unknown
): value is { mode: string; [key: string]: unknown } => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "mode" in value
  )
}

const extractFileValue = (composite: TextOrFileValue): unknown => {
  if (isFileObject(composite.file)) {
    return composite.file
  }
  return toTrimmedString(composite.fileName) ?? asString(composite.fileName)
}

export const coerceFormValueForSubmission = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value
  }

  if (!isCompositeValue(value)) {
    return value
  }

  const composite = value as TextOrFileValue
  if (composite.mode === "file") {
    return extractFileValue(composite)
  }

  if (composite.mode === "text") {
    return asString(composite.text)
  }

  return value
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

const unwrapDynamicModule = (module: unknown) =>
  (module as any)?.default ?? module

export async function loadArcgisModules(
  modules: readonly string[]
): Promise<unknown[]> {
  if (!Array.isArray(modules) || !modules.length) {
    return []
  }

  const globalScope =
    typeof globalThis !== "undefined" ? (globalThis as any) : undefined
  const stub = globalScope?.__ESRI_TEST_STUB__
  if (typeof stub === "function") {
    return stub(modules)
  }

  try {
    const mod = await import("jimu-arcgis")
    const loader = (mod as any)?.loadArcGISJSAPIModules
    if (typeof loader !== "function") {
      throw new Error("ARCGIS_MODULE_ERROR")
    }
    const loaded = await loader(modules as string[])
    return (loaded || []).map(unwrapDynamicModule)
  } catch {
    throw new Error("ARCGIS_MODULE_ERROR")
  }
}
