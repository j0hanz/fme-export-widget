import type {
  WorkspaceParameter,
  DynamicFieldConfig,
  ScriptedFieldConfig,
  TableFieldConfig,
  TableColumnConfig,
  TableColumnType,
  DateTimeFieldConfig,
  SelectFieldConfig,
  FileFieldConfig,
  ColorFieldConfig,
  ScriptedOptionNode,
  OptionItem,
  FormPrimitive,
  CheckSteps,
  ConnectionValidationOptions,
  ConnectionValidationResult,
  StartupValidationResult,
  StartupValidationOptions,
  TextOrFileValue,
  EsriModules,
  RemoteDatasetOptions,
  SubmissionPreparationOptions,
  SubmissionPreparationResult,
  DrawingSessionState,
  MutableParams,
  ApiResponse,
  MutableNode,
} from "../config/index"
import {
  ParameterType,
  FormFieldType,
  ErrorType,
  LAYER_CONFIG,
  DrawingTool,
  ViewMode,
  SKIPPED_PARAMETER_NAMES,
  ALWAYS_SKIPPED_TYPES,
  LIST_REQUIRED_TYPES,
  MULTI_SELECT_TYPES,
  PARAMETER_FIELD_TYPE_MAP,
} from "../config/index"
import type { JimuMapView } from "jimu-arcgis"
import {
  isEmpty,
  extractErrorMessage,
  isAbortError,
  isFileObject,
  toTrimmedString,
  extractTemporalParts,
  shouldApplyRemoteDatasetUrl,
  shouldUploadRemoteDataset,
  removeAoiErrorMarker,
  applyUploadedDatasetParam,
  parseSubmissionFormData,
  normalizeSketchCreateTool,
  prepFmeParams,
  applyDirectiveDefaults,
  logIfNotAbort,
  toArray,
  isPlainObject,
  pickString,
  pickBoolean,
  pickNumber,
  mergeMetadata,
  unwrapArray,
  toMetadataRecord,
  normalizeParameterValue,
  buildChoiceSet,
  createFmeClient,
  sanitizeOptGetUrlParam,
  resolveUploadTargetParam,
} from "./utils"
import {
  isInt,
  isNum,
  extractHttpStatus,
  validateServerUrl,
  validateRequiredFields,
  createError,
  mapErrorToKey,
} from "./validations"
import { safeCancelSketch } from "./hooks"
import { fmeActions } from "../extensions/store"

/* Inflight Request Cache för request-deduplicering */

// Generisk cache för inflight requests med automatisk cleanup
class InflightCache<T> {
  private readonly cache = new Map<string, Promise<T>>()

  // Kör factory om inget inflight request finns, annars returnera befintligt
  async execute(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.cache.get(key)
    if (existing) return existing

    const promise = factory()
    this.cache.set(key, promise)

    // Rensa cache när request är klar
    return promise.finally(() => {
      this.cache.delete(key)
    })
  }
}

// Inflight request-cacher för vanliga operationer
const inFlight = {
  healthCheck: new InflightCache<{
    reachable: boolean
    version?: string
    responseTime?: number
    error?: string
    status?: number
  }>(),
  validateConnection: new InflightCache<ConnectionValidationResult>(),
}

/* Network Error Detection */

// Indikatorer för nätverksfel i felmeddelanden
const NETWORK_INDICATORS = Object.freeze([
  "Failed to fetch",
  "NetworkError",
  "net::",
  "DNS",
  "ENOTFOUND",
  "ECONNREFUSED",
  "timeout",
  "Name or service not known",
  "ERR_NAME_NOT_RESOLVED",
  "Unable to load",
  "/sharing/proxy",
  "proxy",
])

// Indikatorer för proxy-relaterade fel
const PROXY_INDICATORS = Object.freeze([
  "Unable to load",
  "/sharing/proxy",
  "proxy",
])

// Kontrollerar om felmeddelande indikerar nätverksfel
const hasNetworkError = (message: string): boolean =>
  NETWORK_INDICATORS.some((indicator) =>
    message.toLowerCase().includes(indicator.toLowerCase())
  )

// Kontrollerar om felmeddelande indikerar proxy-fel
const hasProxyError = (message: string): boolean =>
  PROXY_INDICATORS.some((indicator) =>
    message.toLowerCase().includes(indicator.toLowerCase())
  )

/* Parameter Service - Formulärgenerering och validering */

// Service för att konvertera FME-parametrar till dynamiska formulärfält
export class ParameterFormService {
  // Kontrollerar om parameter ska renderas som formulärfält
  private isRenderableParam(
    p: WorkspaceParameter | null | undefined
  ): p is WorkspaceParameter {
    if (!p || typeof p.name !== "string") return false
    if (SKIPPED_PARAMETER_NAMES.has(p.name)) return false
    if (ALWAYS_SKIPPED_TYPES.has(p.type)) return false
    if (LIST_REQUIRED_TYPES.has(p.type)) {
      return (
        (Array.isArray(p.listOptions) && p.listOptions.length > 0) ||
        (p.defaultValue !== null &&
          p.defaultValue !== undefined &&
          p.defaultValue !== "")
      )
    }

    return true
  }

  // Filtrerar och returnerar endast renderbara parametrar
  private getRenderableParameters(
    parameters: readonly WorkspaceParameter[]
  ): WorkspaceParameter[] {
    return parameters.filter((parameter) => this.isRenderableParam(parameter))
  }

  // Mappar FME listOptions till OptionItem-format
  private mapListOptions(
    list: WorkspaceParameter["listOptions"]
  ): readonly OptionItem[] | undefined {
    if (!list?.length) return undefined
    return list.map((o) => {
      const normalizedValue = normalizeParameterValue(o.value)
      const label =
        (typeof o.caption === "string" && o.caption.trim()) ||
        String(normalizedValue)

      return {
        label,
        value: normalizedValue,
        ...(o.description && { description: o.description }),
        ...(typeof o.path === "string" && o.path && { path: o.path }),
        ...(o.disabled && { disabled: true }),
        ...(o.metadata && { metadata: o.metadata }),
      }
    })
  }

  // Normaliserar decimalprecision till heltal >= 0 (max 6 för att undvika flyttalsfel)
  private getDecimalPrecision(param: WorkspaceParameter): number | undefined {
    const raw = param.decimalPrecision
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      return undefined
    }
    const clamped = Math.floor(raw)
    return clamped >= 0 ? Math.min(clamped, 6) : undefined
  }

  // Extraherar slider-/range-metadata (min/max/step/exklusivitet)
  private getSliderMeta(
    param: WorkspaceParameter,
    precision: number | undefined,
    useSliderUi: boolean
  ): {
    min?: number
    max?: number
    step?: number
    minExclusive?: boolean
    maxExclusive?: boolean
  } {
    const minExclusive =
      typeof param.minimumExclusive === "boolean"
        ? param.minimumExclusive
        : false
    const maxExclusive =
      typeof param.maximumExclusive === "boolean"
        ? param.maximumExclusive
        : false

    if (param.type !== ParameterType.RANGE_SLIDER) {
      return {
        min: typeof param.minimum === "number" ? param.minimum : undefined,
        max: typeof param.maximum === "number" ? param.maximum : undefined,
        minExclusive,
        maxExclusive,
      }
    }

    const hasMin = typeof param.minimum === "number"
    const hasMax = typeof param.maximum === "number"
    const resolvedPrecision =
      typeof precision === "number" && precision >= 0
        ? Math.floor(precision)
        : undefined

    const min = hasMin ? param.minimum : useSliderUi ? 0 : undefined
    const max = hasMax ? param.maximum : useSliderUi ? 100 : undefined

    let step: number | undefined
    if (resolvedPrecision !== undefined) {
      step =
        resolvedPrecision > 0
          ? Number(`0.${"0".repeat(resolvedPrecision - 1)}1`)
          : 1
    } else if (useSliderUi) {
      step = 1
    }

    return {
      min,
      max,
      step,
      minExclusive,
      maxExclusive,
    }
  }

  // Tolkar booleanliknande värden från metadata
  private resolveBooleanFlag(
    source: { readonly [key: string]: unknown } | null | undefined,
    keys: readonly string[]
  ): boolean | undefined {
    if (!isPlainObject(source)) return undefined
    for (const key of keys) {
      if (!(key in source)) continue
      const raw = (source as { readonly [key: string]: unknown })[key]
      if (typeof raw === "boolean") return raw
      if (typeof raw === "number") {
        if (raw === 1) return true
        if (raw === 0) return false
      }
      if (typeof raw === "string") {
        const normalized = raw.trim().toLowerCase()
        if (["true", "1", "yes", "y", "on"].includes(normalized)) {
          return true
        }
        if (["false", "0", "no", "n", "off"].includes(normalized)) {
          return false
        }
      }
    }
    return undefined
  }

  // Avgör om RANGE_SLIDER ska använda slider-UI eller numeriskt fält
  private shouldUseRangeSliderUi(param: WorkspaceParameter): boolean {
    if (param.type !== ParameterType.RANGE_SLIDER) return false
    if (param.control && typeof param.control === "object") {
      const controlAny = param.control as any
      if (typeof controlAny.useRangeSlider === "boolean") {
        return controlAny.useRangeSlider
      }
      if (typeof controlAny.useSlider === "boolean") {
        return controlAny.useSlider
      }
    }
    const description = (param.description || "").toLowerCase()
    const name = (param.name || "").toLowerCase()
    if (
      description.includes("no slider") ||
      description.includes("noslider") ||
      description.includes("without slider")
    ) {
      return false
    }

    // Om beskrivningen innehåller "slider", använd slider-UI
    if (description.includes("slider") || name.includes("slider")) {
      return true
    }
    return false
  }

  // Samlar metadata från olika källor (metadata, attributes, definition etc.)
  private getParameterMetadata(param: WorkspaceParameter): {
    readonly [key: string]: unknown
  } {
    const defaultValueMeta = isPlainObject(param.defaultValue)
      ? (param.defaultValue as { readonly [key: string]: unknown })
      : undefined
    return mergeMetadata([
      param.metadata,
      param.attributes,
      param.definition,
      param.control,
      param.schema,
      param.ui,
      param.extra,
      defaultValueMeta,
    ])
  }

  // Normaliserar enskilt option-item till enhetligt format
  private normalizeOptionItem(item: unknown, index: number): OptionItem | null {
    if (item == null) return null

    if (typeof item === "string" || typeof item === "number") {
      const normalized = normalizeParameterValue(item)
      return {
        label: String(normalized),
        value: normalized,
        isLeaf: true,
      }
    }

    if (!isPlainObject(item)) return null

    const obj = item as { readonly [key: string]: unknown }
    const label =
      pickString(obj, ["caption", "label", "name", "title", "displayName"]) ??
      `Option ${index + 1}`
    const rawValue =
      obj.value ??
      obj.id ??
      obj.code ??
      obj.path ??
      obj.name ??
      obj.key ??
      label ??
      index
    const normalizedValue = normalizeParameterValue(rawValue)

    const childEntries = unwrapArray(obj.children)
    const children = childEntries
      ?.map((child, childIndex) => this.normalizeOptionItem(child, childIndex))
      .filter((child): child is OptionItem => child != null)

    return {
      label,
      value: normalizedValue,
      ...(pickString(obj, [
        "description",
        "detail",
        "tooltip",
        "hint",
        "helper",
      ]) && {
        description: pickString(obj, [
          "description",
          "detail",
          "tooltip",
          "hint",
          "helper",
        ]),
      }),
      ...(pickString(obj, ["path", "fullPath", "groupPath", "folder"]) && {
        path: pickString(obj, ["path", "fullPath", "groupPath", "folder"]),
      }),
      ...((obj.disabled === true ||
        obj.readOnly === true ||
        obj.selectable === false) && {
        disabled: true,
      }),
      ...(children?.length && { children }),
      ...(toMetadataRecord(obj) && { metadata: toMetadataRecord(obj) }),
      ...(children?.length ? {} : { isLeaf: true }),
    }
  }

  // Söker efter options i metadata under vanliga nycklar
  private collectMetaOptions(meta: {
    readonly [key: string]: unknown
  }): readonly OptionItem[] | undefined {
    const candidateKeys = [
      "options",
      "items",
      "values",
      "choices",
      "entries",
      "list",
      "records",
      "data",
      "nodes",
      "children",
    ]

    for (const key of candidateKeys) {
      const arr = unwrapArray(meta[key])
      if (!arr?.length) continue
      const normalized = arr
        .map((item, index) => this.normalizeOptionItem(item, index))
        .filter((item): item is OptionItem => item != null)
      if (normalized.length) {
        return normalized
      }
    }

    return undefined
  }

  // Extraherar scriptade options från parameter-metadata
  private extractScriptedOptions(
    param: WorkspaceParameter,
    baseOptions?: readonly OptionItem[]
  ): readonly OptionItem[] | undefined {
    const meta = this.getParameterMetadata(param)
    const metaOptions = this.collectMetaOptions(meta)
    if (metaOptions?.length) return metaOptions
    return baseOptions
  }

  // Bygger hierarkisk nodstruktur från path-baserade options
  private buildScriptedNodes(
    options: readonly OptionItem[] | undefined,
    separator: string
  ): readonly ScriptedOptionNode[] | undefined {
    if (!options?.length) return undefined

    const hasHierarchy = options.some(
      (opt) => opt.children && opt.children.length > 0
    )

    return hasHierarchy
      ? this.buildNodesFromHierarchy(options, separator)
      : this.buildNodesFromPaths(options, separator)
  }

  // Bygger noder från befintlig children-hierarki
  private buildNodesFromHierarchy(
    options: readonly OptionItem[],
    separator: string
  ): ScriptedOptionNode[] {
    const convert = (
      option: OptionItem,
      parentPath: readonly string[] | undefined
    ): ScriptedOptionNode => {
      const resolvedPath = option.path
        ? option.path
            .split(separator)
            .map((segment) => segment.trim())
            .filter(Boolean)
        : parentPath
          ? [...parentPath, option.label]
          : [option.label]

      const id =
        (option.metadata &&
          typeof option.metadata.id === "string" &&
          option.metadata.id) ||
        (option.value != null ? String(option.value) : resolvedPath.join("|"))

      const childNodes = option.children?.length
        ? option.children.map((child) => convert(child, resolvedPath))
        : undefined

      return {
        id,
        label: option.label,
        path: resolvedPath,
        ...(option.value !== undefined ? { value: option.value } : {}),
        ...(option.disabled ? { disabled: true } : {}),
        ...(option.metadata ? { metadata: option.metadata } : {}),
        ...(childNodes && childNodes.length
          ? { children: childNodes }
          : { isLeaf: true }),
      }
    }

    return options.map((option) => convert(option, undefined))
  }

  // Bygger hierarkisk struktur från path-strängar
  private buildNodesFromPaths(
    options: readonly OptionItem[],
    separator: string
  ): ScriptedOptionNode[] {
    const separatorRegex = new RegExp(
      `[${separator.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}]`
    )
    const roots: MutableNode[] = []
    const nodeMap = new Map<string, MutableNode>()

    const ensureNode = (
      segments: readonly string[],
      option?: OptionItem
    ): MutableNode => {
      const key = segments.join("|") || (option ? String(option.value) : "root")
      const existing = nodeMap.get(key)
      if (existing) return existing

      const label = segments[segments.length - 1] || option?.label || key
      const node: MutableNode = {
        id: key,
        label,
        path: [...segments],
        children: [],
      }
      nodeMap.set(key, node)

      if (segments.length > 1) {
        const parentSegments = segments.slice(0, -1)
        const parent = ensureNode(parentSegments)
        parent.children.push(node)
      } else {
        roots.push(node)
      }

      return node
    }

    for (const option of options) {
      const pathSegments = option.path
        ? option.path
            .split(separatorRegex)
            .map((segment) => segment.trim())
            .filter(Boolean)
        : [option.label]

      const leaf = ensureNode(pathSegments, option)
      leaf.value = option.value
      if (option.metadata) {
        leaf.metadata = { ...(leaf.metadata || {}), ...option.metadata }
      }
      if (option.disabled) {
        leaf.disabled = true
      }
      if (option.description) {
        leaf.metadata = {
          ...(leaf.metadata || {}),
          description: option.description,
        }
      }
    }

    const finalize = (node: MutableNode): ScriptedOptionNode => {
      const children = node.children.map((child) => finalize(child))
      return {
        id: node.id,
        label: node.label,
        path: node.path,
        ...(node.value !== undefined ? { value: node.value } : {}),
        ...(node.disabled ? { disabled: true } : {}),
        ...(node.metadata ? { metadata: node.metadata } : {}),
        ...(children.length ? { children } : { isLeaf: true }),
      }
    }

    return roots.map((root) => finalize(root))
  }

  // Extraherar och validerar tabell-konfiguration från metadata
  private deriveTableConfig(
    param: WorkspaceParameter
  ): TableFieldConfig | undefined {
    const meta = this.getParameterMetadata(param)
    const columnCandidates =
      unwrapArray(meta.columns) ??
      unwrapArray(meta.fields) ??
      unwrapArray(meta.tableColumns) ??
      unwrapArray(meta.schema)

    if (!columnCandidates?.length) return undefined

    const columns = columnCandidates
      .map((column, index) => this.normalizeTableColumn(column, index))
      .filter((column): column is TableColumnConfig => column != null)

    const validatedColumns = this.validateTableColumns(columns)

    if (!validatedColumns.length) return undefined

    const minRowsRaw = pickNumber(meta, [
      "minRows",
      "minimumRows",
      "minRowCount",
    ])
    const maxRowsRaw = pickNumber(meta, [
      "maxRows",
      "maximumRows",
      "maxRowCount",
    ])

    const bounds = this.normalizeRowBounds(minRowsRaw, maxRowsRaw)

    return {
      columns: validatedColumns,
      ...(bounds.minRows !== undefined && { minRows: bounds.minRows }),
      ...(bounds.maxRows !== undefined && { maxRows: bounds.maxRows }),
      ...(pickString(meta, ["addRowLabel", "addLabel"]) && {
        addRowLabel: pickString(meta, ["addRowLabel", "addLabel"]),
      }),
      ...(pickString(meta, ["removeRowLabel", "removeLabel"]) && {
        removeRowLabel: pickString(meta, ["removeRowLabel", "removeLabel"]),
      }),
      ...(pickString(meta, ["helper", "helperText", "instructions"]) && {
        helperText: pickString(meta, ["helper", "helperText", "instructions"]),
      }),
      ...(pickBoolean(meta, ["allowReorder", "reorder"], false) && {
        allowReorder: true,
      }),
      ...(pickBoolean(meta, ["showHeader", "displayHeader"], true) && {
        showHeader: true,
      }),
    }
  }

  // Validerar tabell-kolumner och tar bort dubbletter
  private validateTableColumns(
    columns: readonly TableColumnConfig[]
  ): TableColumnConfig[] {
    if (!columns?.length) return []

    const seen = new Set<string>()
    const valid: TableColumnConfig[] = []

    for (const column of columns) {
      if (!column?.key) continue
      if (seen.has(column.key)) continue
      if (
        column.type === "select" &&
        (!column.options || column.options.length === 0)
      ) {
        continue
      }
      valid.push(column)
      seen.add(column.key)
    }

    return valid
  }

  // Normaliserar och säkerställer giltiga min/max-radgränser
  private normalizeRowBounds(
    minRows: number | undefined,
    maxRows: number | undefined
  ): { minRows?: number; maxRows?: number } {
    const resolvedMin =
      typeof minRows === "number" && Number.isFinite(minRows) && minRows >= 0
        ? Math.floor(minRows)
        : undefined
    let resolvedMax =
      typeof maxRows === "number" && Number.isFinite(maxRows) && maxRows >= 0
        ? Math.floor(maxRows)
        : undefined

    if (
      resolvedMin !== undefined &&
      resolvedMax !== undefined &&
      resolvedMin > resolvedMax
    ) {
      resolvedMax = resolvedMin
    }

    return { minRows: resolvedMin, maxRows: resolvedMax }
  }

  // Normaliserar enskild tabell-kolumn från metadata
  private normalizeTableColumn(
    column: unknown,
    index: number
  ): TableColumnConfig | null {
    if (!isPlainObject(column)) return null

    const data = column as { readonly [key: string]: unknown }
    const key =
      pickString(data, ["key", "name", "field", "id"]) ?? `column_${index}`
    const label = pickString(data, ["label", "title", "caption", "name"]) ?? key

    const typeMap: { readonly [key: string]: TableColumnType } = {
      text: "text",
      string: "text",
      number: "number",
      numeric: "number",
      float: "number",
      integer: "number",
      select: "select",
      choice: "select",
      dropdown: "select",
      list: "select",
      boolean: "boolean",
      checkbox: "boolean",
      date: "date",
      time: "time",
      datetime: "datetime",
      "date-time": "datetime",
    }
    const typeRaw = pickString(data, ["type", "inputType", "fieldType"])
    const type = typeRaw ? typeMap[typeRaw.toLowerCase()] : undefined

    const optionsRaw =
      unwrapArray(data.options) ??
      unwrapArray(data.choices) ??
      unwrapArray(data.values)
    const options = optionsRaw
      ?.map((item, idx) => this.normalizeOptionItem(item, idx))
      .filter((item): item is OptionItem => item != null)

    return {
      key,
      label,
      ...(type && { type }),
      ...(pickBoolean(data, ["required", "isRequired"], false) && {
        required: true,
      }),
      ...(pickBoolean(data, ["readOnly", "readonly"], false) && {
        readOnly: true,
      }),
      ...(pickString(data, ["placeholder", "prompt"]) && {
        placeholder: pickString(data, ["placeholder", "prompt"]),
      }),
      ...(pickNumber(data, ["min", "minimum"]) !== undefined && {
        min: pickNumber(data, ["min", "minimum"]),
      }),
      ...(pickNumber(data, ["max", "maximum"]) !== undefined && {
        max: pickNumber(data, ["max", "maximum"]),
      }),
      ...(pickNumber(data, ["step", "increment"]) !== undefined && {
        step: pickNumber(data, ["step", "increment"]),
      }),
      ...(pickString(data, ["pattern", "regex"]) && {
        pattern: pickString(data, ["pattern", "regex"]),
      }),
      ...(options?.length && { options }),
      ...(pickString(data, ["description", "detail", "helper", "hint"]) && {
        description: pickString(data, [
          "description",
          "detail",
          "helper",
          "hint",
        ]),
      }),
      ...(data.defaultValue !== undefined && {
        defaultValue: data.defaultValue,
      }),
      ...(data.width !== undefined && { width: data.width as number | string }),
    }
  }

  // Extraherar scriptad fält-konfiguration med hierarkiska options
  private deriveScriptedConfig(
    param: WorkspaceParameter,
    baseOptions?: readonly OptionItem[]
  ): ScriptedFieldConfig | undefined {
    if (param.type !== ParameterType.SCRIPTED) return undefined

    const meta = this.getParameterMetadata(param)
    const options = this.extractScriptedOptions(param, baseOptions)
    const separator =
      pickString(meta, ["breadcrumbSeparator", "pathSeparator", "delimiter"]) ||
      "/"
    const nodes = this.buildScriptedNodes(options, separator)

    const allowMultiple = pickBoolean(
      meta,
      ["allowMultiple", "multiple", "multiSelect", "supportsMultiple"],
      Array.isArray(param.defaultValue)
    )
    const allowManualEntry = pickBoolean(
      meta,
      ["allowManualEntry", "allowManual", "allowCustom", "allowFreeform"],
      false
    )
    const allowSearch = pickBoolean(
      meta,
      ["allowSearch", "searchable", "enableSearch", "supportsSearch"],
      (options?.length ?? 0) > 15
    )
    const pageSize = pickNumber(meta, [
      "pageSize",
      "page_size",
      "limit",
      "pageLimit",
    ])
    const instructions =
      pickString(meta, ["instructions", "instruction", "helper", "hint"]) ||
      toTrimmedString(param.description)
    const searchPlaceholder = pickString(meta, [
      "searchPlaceholder",
      "searchLabel",
      "searchPrompt",
    ])
    const autoSelectSingleLeaf = pickBoolean(
      meta,
      ["autoSelectSingleLeaf", "autoSelectSingle", "autoSelect"],
      true
    )
    const maxResultsHint = pickString(meta, [
      "maxResultsHint",
      "resultsHint",
      "resultsMessage",
    ])

    const hierarchical = Boolean(
      nodes?.some((node) => node.children && node.children.length > 0)
    )

    return {
      allowMultiple,
      allowSearch,
      hierarchical,
      allowManualEntry,
      searchPlaceholder,
      instructions,
      breadcrumbSeparator: separator,
      pageSize,
      maxResultsHint,
      autoSelectSingleLeaf,
      nodes,
    }
  }

  // Extraherar datum/tid-konfiguration från parameter
  private deriveDateTimeConfig(
    param: WorkspaceParameter
  ): DateTimeFieldConfig | undefined {
    const dateTimeTypes = [
      ParameterType.DATE_TIME,
      ParameterType.DATETIME,
      ParameterType.TIME,
    ]
    if (!dateTimeTypes.includes(param.type)) return undefined

    const meta = this.getParameterMetadata(param)
    const includeSeconds = pickBoolean(
      meta,
      ["includeSeconds", "showSeconds", "seconds"],
      true
    )

    const defaultValue =
      typeof param.defaultValue === "string" ? param.defaultValue : undefined
    const temporalParts = defaultValue
      ? extractTemporalParts(defaultValue)
      : { fraction: "", offset: "", base: "" }

    const includeMilliseconds =
      pickBoolean(
        meta,
        ["includeMilliseconds", "milliseconds", "fractional"],
        false
      ) ||
      (temporalParts.fraction && temporalParts.fraction.length > 1)

    const timezoneOptionsRaw =
      unwrapArray(meta.timezones) ?? unwrapArray(meta.timezoneOptions)
    const timezoneOptions = timezoneOptionsRaw
      ?.map((item, idx) => this.normalizeOptionItem(item, idx))
      .filter((item): item is OptionItem => item != null)

    const defaultTimezone =
      pickString(meta, ["defaultTimezone", "timezoneDefault"]) ||
      pickString(meta, ["timezoneOffset", "defaultOffset"]) ||
      temporalParts.offset ||
      undefined

    const rawTimezoneMode = pickString(meta, [
      "timezoneMode",
      "timezone",
      "tzMode",
    ])
    const timezoneMode: DateTimeFieldConfig["timezoneMode"] =
      rawTimezoneMode === "fixed" || rawTimezoneMode === "select"
        ? rawTimezoneMode
        : timezoneOptions?.length
          ? "select"
          : temporalParts.offset || rawTimezoneMode === "offset"
            ? "offset"
            : undefined

    return {
      includeSeconds,
      includeMilliseconds,
      ...(timezoneMode && { timezoneMode }),
      ...(temporalParts.offset && { timezoneOffset: temporalParts.offset }),
      ...(timezoneOptions?.length && { timezoneOptions }),
      ...(defaultTimezone && { defaultTimezone }),
      ...(pickString(meta, ["helper", "hint", "instructions"]) && {
        helperText: pickString(meta, ["helper", "hint", "instructions"]),
      }),
      showTimezoneBadge: Boolean(temporalParts.offset),
    }
  }

  // Extraherar select-fält-konfiguration med sökning och options
  private deriveSelectConfig(
    type: FormFieldType,
    param: WorkspaceParameter,
    options?: readonly OptionItem[]
  ): SelectFieldConfig | undefined {
    const selectableTypes = new Set<FormFieldType>([
      FormFieldType.SELECT,
      FormFieldType.MULTI_SELECT,
      FormFieldType.COORDSYS,
      FormFieldType.ATTRIBUTE_NAME,
      FormFieldType.ATTRIBUTE_LIST,
      FormFieldType.DB_CONNECTION,
      FormFieldType.WEB_CONNECTION,
      FormFieldType.REPROJECTION_FILE,
    ])

    if (!selectableTypes.has(type)) return undefined

    const meta = this.getParameterMetadata(param)
    const allowSearch = pickBoolean(
      meta,
      ["allowSearch", "searchable", "enableSearch"],
      (options?.length ?? 0) > 25
    )
    const allowCustomValues = pickBoolean(
      meta,
      ["allowCustomValues", "allowCustom", "allowManual", "allowFreeform"],
      false
    )
    const pageSize = pickNumber(meta, [
      "pageSize",
      "page_size",
      "limit",
      "pageLimit",
    ])
    const instructions = pickString(meta, ["instructions", "hint", "helper"])
    const hierarchical = pickBoolean(
      meta,
      ["hierarchical", "tree", "grouped", "nested"],
      Boolean(options?.some((opt) => opt.children && opt.children.length > 0))
    )

    // Only return config if at least one non-default value exists
    if (
      !allowSearch &&
      !allowCustomValues &&
      !pageSize &&
      !instructions &&
      !hierarchical
    ) {
      return undefined
    }

    return {
      allowSearch,
      allowCustomValues,
      hierarchical,
      ...(pageSize && { pageSize }),
      ...(instructions && { instructions }),
    }
  }

  // Extraherar fil-fält-konfiguration med accept och size-begränsningar
  private deriveFileConfig(
    type: FormFieldType,
    param: WorkspaceParameter
  ): FileFieldConfig | undefined {
    const fileCapableTypes = new Set<FormFieldType>([
      FormFieldType.FILE,
      FormFieldType.TEXT_OR_FILE,
      FormFieldType.REPROJECTION_FILE,
    ])
    if (!fileCapableTypes.has(type)) return undefined

    const meta = this.getParameterMetadata(param)
    const acceptRaw = meta.accept ?? meta.accepted ?? meta.extensions

    const acceptList = (() => {
      if (!acceptRaw) return undefined
      if (Array.isArray(acceptRaw)) {
        const list = (acceptRaw as unknown[])
          .map((item) => toTrimmedString(item))
          .filter((item): item is string => Boolean(item))
        return list.length ? list : undefined
      }
      if (typeof acceptRaw === "string") {
        const parts = acceptRaw
          .split(/[,;\s]+/)
          .map((part) => part.trim())
          .filter(Boolean)
        return parts.length ? parts : undefined
      }
      return undefined
    })()

    const maxSizeMb = pickNumber(meta, [
      "maxSizeMb",
      "maxSize",
      "fileSizeMb",
      "maxUploadMb",
    ])
    const allowMultiple = pickBoolean(
      meta,
      ["allowMultiple", "multiple", "multi"],
      false
    )
    const helperText = pickString(meta, ["helper", "hint", "instructions"])
    const capture = pickString(meta, ["capture", "captureMode"])

    // Only return config if at least one value exists
    if (
      !acceptList &&
      !maxSizeMb &&
      !allowMultiple &&
      !helperText &&
      !capture
    ) {
      return undefined
    }

    return {
      ...(acceptList && { accept: acceptList }),
      ...(maxSizeMb !== undefined && { maxSizeMb }),
      ...(allowMultiple && { multiple: true }),
      ...(helperText && { helperText }),
      ...(capture && { capture }),
    }
  }

  // Extraherar färg-fält-konfiguration från parameter
  private deriveColorConfig(
    param: WorkspaceParameter
  ): ColorFieldConfig | undefined {
    if (
      param.type !== ParameterType.COLOR &&
      param.type !== ParameterType.COLOR_PICK
    ) {
      return undefined
    }

    const meta = this.getParameterMetadata(param)
    const spaceRaw = pickString(meta, [
      "colorSpace",
      "colourSpace",
      "space",
      "colorModel",
      "colourModel",
    ])
    const normalizedSpace = spaceRaw?.trim().toLowerCase()
    let space: ColorFieldConfig["space"]

    if (normalizedSpace === "cmyk") {
      space = "cmyk"
    } else if (normalizedSpace === "rgb") {
      space = "rgb"
    }

    if (!space) {
      const defaultString =
        typeof param.defaultValue === "string" ? param.defaultValue : ""
      const parts = defaultString
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
      if (!space) {
        if (parts.length === 4) {
          space = "cmyk"
        } else if (parts.length === 3) {
          space = "rgb"
        }
      }
    }

    const alpha = pickBoolean(
      meta,
      ["alpha", "allowAlpha", "hasAlpha", "supportsAlpha", "includeAlpha"],
      false
    )

    if (!space && !alpha) return undefined

    return {
      ...(space && { space }),
      ...(alpha && { alpha: true }),
    }
  }

  // Validerar värden mot parameter-definitioner (required/type/choices)
  validateParameters(
    data: { [key: string]: unknown },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = []
    const validParams = this.getRenderableParameters(parameters)

    for (const param of validParams) {
      if (param.type === ParameterType.GEOMETRY) {
        continue
      }
      const value = data[param.name]
      const isMissingRequired = !param.optional && isEmpty(value)
      if (isMissingRequired) {
        errors.push(`${param.name}:required`)
        continue
      }

      if (!isEmpty(value)) {
        const typeError = this.validateParameterType(param, value)
        if (typeError) {
          errors.push(typeError)
          continue
        }

        const choiceError = this.validateParameterChoices(param, value)
        if (choiceError) {
          errors.push(choiceError)
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  // Validerar primitiv typ-matchning för parameter-värde
  private validateParameterType(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    switch (param.type) {
      case ParameterType.INTEGER:
        return isInt(value) ? null : `${param.name}:integer`
      case ParameterType.FLOAT:
        return isNum(value) ? null : `${param.name}:number`
      default:
        return null
    }
  }

  // Validerar att värde matchar tillåtna choices i parameter
  private validateParameterChoices(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    const validChoices = buildChoiceSet(param.listOptions)
    if (!validChoices) return null

    if (MULTI_SELECT_TYPES.has(param.type)) {
      const values = Array.isArray(value) ? value : [value]
      if (values.some((v) => !validChoices.has(normalizeParameterValue(v)))) {
        return `${param.name}:choice`
      }
    } else if (!validChoices.has(normalizeParameterValue(value))) {
      return `${param.name}:choice`
    }

    return null
  }

  // Konverterar parametrar till dynamiska formulärfält
  convertParametersToFields(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    if (!parameters?.length) return []

    return this.getRenderableParameters(parameters).map((param) => {
      const baseType = this.getFieldType(param)
      const decimalPrecision = this.getDecimalPrecision(param)
      const sliderUiPreferred =
        param.type === ParameterType.RANGE_SLIDER
          ? this.shouldUseRangeSliderUi(param)
          : false
      const type =
        param.type === ParameterType.RANGE_SLIDER && !sliderUiPreferred
          ? FormFieldType.NUMERIC_INPUT
          : baseType
      const options = this.mapListOptions(param.listOptions)
      const scripted = this.deriveScriptedConfig(param, options)
      const tableConfig = this.deriveTableConfig(param)
      const dateTimeConfig = this.deriveDateTimeConfig(param)
      const selectConfig = this.deriveSelectConfig(type, param, options)
      const fileConfig = this.deriveFileConfig(type, param)
      const colorConfig = this.deriveColorConfig(param)
      const readOnly = this.isReadOnlyField(type, scripted)
      const helper =
        scripted?.instructions ??
        tableConfig?.helperText ??
        dateTimeConfig?.helperText ??
        fileConfig?.helperText ??
        selectConfig?.instructions
      const { min, max, step, minExclusive, maxExclusive } = this.getSliderMeta(
        param,
        decimalPrecision,
        sliderUiPreferred
      )

      const field: DynamicFieldConfig = {
        name: param.name,
        label: param.description || param.name,
        type,
        required: !param.optional,
        readOnly,
        description: param.description,
        defaultValue:
          type === FormFieldType.PASSWORD
            ? ("" as FormPrimitive)
            : param.type === ParameterType.GEOMETRY
              ? ("" as FormPrimitive)
              : type === FormFieldType.MULTI_SELECT
                ? (toArray(param.defaultValue) as FormPrimitive)
                : (param.defaultValue as FormPrimitive),
        placeholder: param.description || "",
        ...(options?.length && { options: [...options] }),
        ...(param.type === ParameterType.TEXT_EDIT && { rows: 3 }),
        ...((min !== undefined || max !== undefined || step !== undefined) && {
          min,
          max,
          step,
        }),
        ...((type === FormFieldType.SLIDER ||
          type === FormFieldType.NUMERIC_INPUT) &&
          decimalPrecision !== undefined && {
            decimalPrecision,
          }),
        ...((type === FormFieldType.SLIDER ||
          type === FormFieldType.NUMERIC_INPUT) &&
          minExclusive !== undefined && {
            minExclusive,
          }),
        ...((type === FormFieldType.SLIDER ||
          type === FormFieldType.NUMERIC_INPUT) &&
          maxExclusive !== undefined && {
            maxExclusive,
          }),
        ...(helper && { helper }),
        ...(scripted && { scripted }),
        ...(tableConfig && { tableConfig }),
        ...(dateTimeConfig && { dateTimeConfig }),
        ...(selectConfig && { selectConfig }),
        ...(fileConfig && { fileConfig }),
        ...(colorConfig && { colorConfig }),
      }
      return field
    }) as readonly DynamicFieldConfig[]
  }

  // Mappar parameter-typ till UI-fälttyp
  private getFieldType(param: WorkspaceParameter): FormFieldType {
    const override = PARAMETER_FIELD_TYPE_MAP[param.type]
    if (override) return override

    const hasOptions = param.listOptions?.length > 0
    if (hasOptions) {
      return MULTI_SELECT_TYPES.has(param.type)
        ? FormFieldType.MULTI_SELECT
        : FormFieldType.SELECT
    }

    return FormFieldType.TEXT
  }

  // Kontrollerar om fält ska vara read-only baserat på typ och config
  private isReadOnlyField(
    type: FormFieldType,
    scripted?: ScriptedFieldConfig
  ): boolean {
    if (type === FormFieldType.MESSAGE || type === FormFieldType.GEOMETRY) {
      return true
    }
    if (type === FormFieldType.SCRIPTED) {
      const hasInteractiveNodes = Boolean(
        scripted?.allowManualEntry ||
          (scripted?.nodes && scripted.nodes.length > 0)
      )
      return !hasInteractiveNodes
    }
    return false
  }

  // Validerar formulärvärden mot fält-definitioner
  validateFormValues(
    values: { [key: string]: unknown },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    if (!values || !fields?.length) return { isValid: true, errors: {} }

    const errors: { [key: string]: string } = {}

    for (const field of fields) {
      const value = values[field.name]
      const hasValue = !isEmpty(value)

      if (field.type === FormFieldType.GEOMETRY) {
        continue
      }

      if (field.type === FormFieldType.TEXT_OR_FILE) {
        const tf = value as TextOrFileValue | undefined
        const hasText =
          typeof tf?.text === "string" && tf.text.trim().length > 0
        const hasFile = isFileObject(tf?.file)
        if (field.required && !hasText && !hasFile) {
          errors[field.name] = ""
        }
        continue
      }

      if (field.required && !hasValue) {
        errors[field.name] = ""
      } else if (
        hasValue &&
        (field.type === FormFieldType.NUMBER ||
          field.type === FormFieldType.NUMERIC_INPUT) &&
        !isNum(value)
      ) {
        errors[field.name] = ""
        continue
      }

      if (
        hasValue &&
        (field.type === FormFieldType.NUMBER ||
          field.type === FormFieldType.NUMERIC_INPUT ||
          field.type === FormFieldType.SLIDER)
      ) {
        const numericValue = Number(value)
        if (!Number.isFinite(numericValue)) {
          errors[field.name] = ""
          continue
        }

        if (typeof field.min === "number") {
          const belowMin = field.minExclusive
            ? numericValue <= field.min
            : numericValue < field.min
          if (belowMin) {
            errors[field.name] = ""
            continue
          }
        }

        if (typeof field.max === "number") {
          const aboveMax = field.maxExclusive
            ? numericValue >= field.max
            : numericValue > field.max
          if (aboveMax) {
            errors[field.name] = ""
            continue
          }
        }
      }

      if (
        hasValue &&
        field.type === FormFieldType.NUMERIC_INPUT &&
        typeof field.decimalPrecision === "number" &&
        field.decimalPrecision >= 0 &&
        Number.isFinite(Number(value))
      ) {
        const numericValue = Number(value)
        const precisionScale = Math.pow(10, field.decimalPrecision)
        if (Number.isFinite(precisionScale)) {
          const scaled = numericValue * precisionScale
          const rounded = Math.round(scaled)
          if (Math.abs(scaled - rounded) > Number.EPSILON) {
            errors[field.name] = ""
          }
        } else {
          errors[field.name] = ""
        }
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors }
  }
}

/* Utility Functions för FME Flow Integration */

// Extraherar FME-version från server-respons
function extractFmeVersion(info: unknown): string {
  if (!info) return ""

  const data = (info as any)?.data ?? info
  const versionPattern = /\b(\d+\.\d+(?:\.\d+)?|20\d{2}(?:\.\d+)?)\b/

  const directKeys = [
    "version",
    "fmeVersion",
    "fmeflowVersion",
    "app.version",
    "about.version",
    "server.version",
    "edition",
    "build",
    "productName",
    "product",
    "name",
  ]

  for (const key of directKeys) {
    const value = key.includes(".")
      ? key.split(".").reduce((obj, k) => obj?.[k], data)
      : data?.[key]

    if (typeof value === "string") {
      const match = value.match(versionPattern)
      if (match) return match[1]
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  // Search all values as fallback
  try {
    const allValues = Object.values(data || {})
    for (const val of allValues) {
      if (typeof val === "string") {
        const match = val.match(versionPattern)
        if (match) return match[1]
      }
    }
  } catch {
    // Ignore
  }

  return ""
}

// Kontrollerar FME Flow server-hälsa och version
export async function healthCheck(
  serverUrl: string,
  token: string,
  signal?: AbortSignal
): Promise<{
  reachable: boolean
  version?: string
  responseTime?: number
  error?: string
  status?: number
}> {
  const key = `${serverUrl}|${token}`
  const urlValidation = validateServerUrl(serverUrl)
  if (!urlValidation.ok) {
    return {
      reachable: false,
      responseTime: 0,
      error: "invalidUrl",
      status: 0,
    }
  }

  return await inFlight.healthCheck.execute(key, async () => {
    const startTime = Date.now()
    try {
      const client = createFmeClient(serverUrl, token)
      const response = await client.testConnection(signal)
      const elapsed = Date.now() - startTime
      const responseTime =
        Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0

      return {
        reachable: true,
        version: extractFmeVersion(response),
        responseTime,
      }
    } catch (error) {
      const elapsed = Date.now() - startTime
      const responseTime =
        Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0
      const status = extractHttpStatus(error)
      const errorMessage = extractErrorMessage(error)

      if (status === 401 || status === 403) {
        if (hasNetworkError(errorMessage)) {
          return {
            reachable: false,
            responseTime,
            error: errorMessage,
            status,
          }
        }

        const strictValidation = validateServerUrl(serverUrl, { strict: true })
        if (!strictValidation.ok) {
          return {
            reachable: false,
            responseTime,
            error: "invalidUrl",
            status,
          }
        }
        return { reachable: true, responseTime, status }
      }

      return {
        reachable: false,
        responseTime,
        error: errorMessage,
        status,
      }
    }
  })
}

// Validerar FME Flow-anslutning steg-för-steg (URL, token, repository)
export async function validateConnection(
  options: ConnectionValidationOptions
): Promise<ConnectionValidationResult> {
  const { serverUrl, token, repository, signal } = options
  const key = `${serverUrl}|${token}|${repository || "_"}`
  const steps: CheckSteps = {
    serverUrl: "pending",
    token: "pending",
    repository: repository ? "pending" : "skip",
    version: "",
  }

  return await inFlight.validateConnection.execute(
    key,
    async (): Promise<ConnectionValidationResult> => {
      try {
        const client = createFmeClient(serverUrl, token, repository)

        if (!client) {
          return {
            success: false,
            steps,
            error: {
              message: "connectionFailedMessage",
              type: "server",
              status: 0,
            },
          }
        }

        // Step 1: Test connection and get server info
        let serverInfo: any
        try {
          serverInfo = await client.testConnection(signal)
          steps.serverUrl = "ok"
          steps.token = "ok"
          steps.version = extractFmeVersion(serverInfo)
        } catch (error) {
          if (isAbortError(error)) {
            return {
              success: false,
              steps,
              error: {
                message: (error as Error).message || "aborted",
                type: "generic",
                status: 0,
              },
            }
          }
          const status = extractHttpStatus(error)

          if (status === 401) {
            steps.serverUrl = "ok"
            steps.token = "fail"
            return {
              success: false,
              steps,
              error: {
                message: mapErrorToKey(error, status),
                type: "token",
                status,
              },
            }
          } else if (status === 403) {
            const rawMessage = extractErrorMessage(error)
            if (hasProxyError(rawMessage)) {
              steps.serverUrl = "fail"
              steps.token = "skip"
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorToKey(error, status),
                  type: "server",
                  status,
                },
              }
            }
            try {
              const healthResult = await healthCheck(serverUrl, token, signal)

              if (healthResult.reachable) {
                steps.serverUrl = "ok"
                steps.token = "fail"
                return {
                  success: false,
                  steps,
                  error: {
                    message: mapErrorToKey(error, status),
                    type: "token",
                    status,
                  },
                }
              } else {
                steps.serverUrl = "fail"
                steps.token = "skip"
                return {
                  success: false,
                  steps,
                  error: {
                    message: mapErrorToKey(error, status),
                    type: "server",
                    status,
                  },
                }
              }
            } catch (healthError) {
              steps.serverUrl = "fail"
              steps.token = "skip"
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorToKey(error, status),
                  type: "server",
                  status,
                },
              }
            }
          } else {
            steps.serverUrl = "fail"
            steps.token = "skip"
            return {
              success: false,
              steps,
              error: {
                message: mapErrorToKey(error, status),
                type: status === 0 ? "network" : "server",
                status,
              },
            }
          }
        }

        const warnings: string[] = []

        // Step 3: Validate specific repository if provided
        if (repository) {
          try {
            await client.validateRepository(repository, signal)
            steps.repository = "ok"
          } catch (error) {
            const status = extractHttpStatus(error)
            if (status === 401 || status === 403) {
              steps.repository = "skip"
              warnings.push("repositoryNotAccessible")
            } else {
              steps.repository = "fail"
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorToKey(error, status),
                  type: "repository",
                  status,
                },
              }
            }
          }
        }

        return {
          success: true,
          version: typeof steps.version === "string" ? steps.version : "",
          steps,
          warnings: warnings.length ? warnings : undefined,
        }
      } catch (error) {
        if (isAbortError(error)) {
          return {
            success: false,
            steps,
            error: {
              message: (error as Error).message || "aborted",
              type: "generic",
              status: 0,
            },
          }
        }

        const status = extractHttpStatus(error)
        return {
          success: false,
          steps,
          error: {
            message: mapErrorToKey(error, status),
            type: "generic",
            status,
          },
        }
      }
    }
  )
}

// Löser remote dataset genom att ladda upp eller länka via opt_geturl
export async function resolveRemoteDataset({
  params,
  remoteUrl,
  uploadFile,
  config,
  workspaceParameters,
  makeCancelable,
  fmeClient,
  signal,
  subfolder,
  workspaceName,
}: RemoteDatasetOptions): Promise<void> {
  sanitizeOptGetUrlParam(params, config)

  if (shouldApplyRemoteDatasetUrl(remoteUrl, config)) {
    params.opt_geturl = remoteUrl
    return
  }

  if (!shouldUploadRemoteDataset(config, uploadFile)) {
    return
  }

  const targetWorkspace = toTrimmedString(workspaceName)
  if (!targetWorkspace) {
    throw new Error("REMOTE_DATASET_WORKSPACE_REQUIRED")
  }

  if (typeof params.opt_geturl !== "undefined") {
    delete params.opt_geturl
  }

  const uploadResponse = await makeCancelable<ApiResponse<{ path: string }>>(
    fmeClient.uploadToTemp(uploadFile, {
      subfolder,
      signal,
      repository: config?.repository,
      workspace: targetWorkspace,
    })
  )

  const uploadedPath = uploadResponse.data?.path
  applyUploadedDatasetParam({
    finalParams: params,
    uploadedPath,
    parameters: workspaceParameters,
    explicitTarget: resolveUploadTargetParam(config),
  })
}

// Förbereder submission-parametrar med AOI och remote dataset-upplösning
export async function prepareSubmissionParams({
  rawFormData,
  userEmail,
  geometryJson,
  geometry,
  modules,
  config,
  workspaceParameters,
  workspaceItem,
  selectedWorkspaceName,
  areaWarning,
  drawnArea,
  makeCancelable,
  fmeClient,
  signal,
  remoteDatasetSubfolder,
  onStatusChange,
}: SubmissionPreparationOptions): Promise<SubmissionPreparationResult> {
  onStatusChange?.("normalizing")
  const { sanitizedFormData, uploadFile, remoteUrl } =
    parseSubmissionFormData(rawFormData)

  const baseParams = prepFmeParams(
    {
      data: sanitizedFormData,
    },
    userEmail,
    geometryJson,
    geometry || undefined,
    modules,
    {
      config,
      workspaceParameters,
      workspaceItem,
      areaWarning,
      drawnArea,
    }
  )

  const aoiError = (baseParams as MutableParams).__aoi_error__
  if (aoiError) {
    onStatusChange?.("complete")
    return { params: null, aoiError }
  }

  const params: MutableParams = { ...baseParams }

  const shouldResolveRemoteDataset = Boolean(
    uploadFile || (typeof remoteUrl === "string" && remoteUrl.trim())
  )

  if (shouldResolveRemoteDataset) {
    onStatusChange?.("resolvingDataset")
  }

  await resolveRemoteDataset({
    params,
    remoteUrl,
    uploadFile,
    config,
    workspaceParameters,
    makeCancelable,
    fmeClient,
    signal,
    subfolder: remoteDatasetSubfolder,
    workspaceName:
      toTrimmedString(workspaceItem?.name) ||
      toTrimmedString(selectedWorkspaceName) ||
      null,
  })

  onStatusChange?.("applyingDefaults")
  const paramsWithDefaults = applyDirectiveDefaults(params, config || undefined)
  removeAoiErrorMarker(paramsWithDefaults as MutableParams)

  onStatusChange?.("complete")
  return { params: paramsWithDefaults }
}

// Skapar GraphicsLayers för ritning och preview
export function createLayers(
  jmv: JimuMapView,
  modules: EsriModules,
  setGraphicsLayer: (layer: __esri.GraphicsLayer) => void
): __esri.GraphicsLayer {
  const layer = new modules.GraphicsLayer(LAYER_CONFIG)
  jmv.view.map.add(layer)
  setGraphicsLayer(layer)

  return layer
}

// Konfigurerar event-handlers för SketchViewModel (create/update/undo/redo)
export function setupSketchEventHandlers({
  sketchViewModel,
  onDrawComplete,
  dispatch,
  widgetId,
  onDrawingSessionChange,
  onSketchToolStart,
}: {
  sketchViewModel: __esri.SketchViewModel
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void
  dispatch: (action: unknown) => void
  widgetId: string
  onDrawingSessionChange: (updates: Partial<DrawingSessionState>) => void
  onSketchToolStart: (tool: DrawingTool) => void
}): () => void {
  let clickCount = 0

  const createHandle = sketchViewModel.on(
    "create",
    (evt: __esri.SketchCreateEvent) => {
      switch (evt.state) {
        case "start": {
          clickCount = 0
          const normalizedTool = normalizeSketchCreateTool(evt.tool)
          if (!normalizedTool) {
            safeCancelSketch(sketchViewModel)
            onDrawingSessionChange({ isActive: false, clickCount: 0 })
            return
          }
          onDrawingSessionChange({ isActive: true, clickCount: 0 })
          onSketchToolStart(
            normalizedTool === "rectangle"
              ? DrawingTool.RECTANGLE
              : DrawingTool.POLYGON
          )
          break
        }

        case "active": {
          const normalizedTool = normalizeSketchCreateTool(evt.tool)
          if (normalizedTool === "polygon" && evt.graphic?.geometry) {
            const geometry = evt.graphic.geometry as __esri.Polygon
            const vertices = geometry.rings?.[0]
            const actualClicks = vertices ? Math.max(0, vertices.length - 1) : 0
            if (actualClicks > clickCount) {
              clickCount = actualClicks
              onDrawingSessionChange({
                clickCount: actualClicks,
                isActive: true,
              })
              if (actualClicks === 1) {
                dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
              }
            }
          } else if (normalizedTool === "rectangle" && clickCount !== 1) {
            clickCount = 1
            onDrawingSessionChange({ clickCount: 1, isActive: true })
          }
          break
        }

        case "complete":
          clickCount = 0
          onDrawingSessionChange({ isActive: false, clickCount: 0 })
          try {
            onDrawComplete(evt)
          } catch (err: unknown) {
            logIfNotAbort("onDrawComplete error", err)
          }
          break

        case "cancel":
          clickCount = 0
          onDrawingSessionChange({ isActive: false, clickCount: 0 })
          break
      }
    }
  )

  const updateHandle = sketchViewModel.on(
    "update",
    (evt: __esri.SketchUpdateEvent) => {
      if (
        evt.state === "complete" &&
        Array.isArray(evt.graphics) &&
        evt.graphics.length > 0 &&
        (evt.graphics[0] as any)?.geometry
      ) {
        const normalizedTool = normalizeSketchCreateTool((evt as any)?.tool)
        try {
          onDrawComplete({
            graphic: evt.graphics[0] as any,
            state: "complete",
            tool: normalizedTool ?? (evt as any).tool,
          } as any)
        } catch (err: unknown) {
          logIfNotAbort("onDrawComplete update error", err)
        }
      }
    }
  )

  return () => {
    try {
      createHandle?.remove()
    } catch {}
    try {
      updateHandle?.remove()
    } catch {}
    try {
      ;(sketchViewModel as any).__fmeCleanup__ = undefined
    } catch {}
  }
}

// Skapar SketchViewModel med event-handlers och cleanup-funktioner
export function createSketchVM({
  jmv,
  modules,
  layer,
  onDrawComplete,
  dispatch,
  widgetId,
  symbols,
  onDrawingSessionChange,
  onSketchToolStart,
}: {
  jmv: JimuMapView
  modules: EsriModules
  layer: __esri.GraphicsLayer
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void
  dispatch: (action: unknown) => void
  widgetId: string
  symbols: {
    polygon: any
    polyline: any
    point: any
  }
  onDrawingSessionChange: (updates: Partial<DrawingSessionState>) => void
  onSketchToolStart: (tool: DrawingTool) => void
}): {
  sketchViewModel: __esri.SketchViewModel
  cleanup: () => void
} {
  const sketchViewModel = new modules.SketchViewModel({
    view: jmv.view,
    layer,
    polygonSymbol: symbols.polygon,
    polylineSymbol: symbols.polyline,
    pointSymbol: symbols.point,
    defaultCreateOptions: {
      hasZ: false,
      mode: "click",
    },
    defaultUpdateOptions: {
      tool: "reshape",
      toggleToolOnClick: false,
      enableRotation: true,
      enableScaling: true,
      preserveAspectRatio: false,
    },
    snappingOptions: {
      enabled: true,
      selfEnabled: true,
      featureEnabled: true,
    },
    tooltipOptions: {
      enabled: true,
      inputEnabled: true,
      visibleElements: {
        area: true,
        totalLength: true,
        distance: true,
        coordinates: false,
        elevation: false,
        rotation: false,
        scale: false,
        size: false,
        radius: true,
        direction: true,
        header: true,
        helpMessage: true,
      },
    },
    valueOptions: {
      directionMode: "relative",
      displayUnits: {
        length: "meters",
        verticalLength: "meters",
        area: "square-meters",
      },
      inputUnits: {
        length: "meters",
        verticalLength: "meters",
        area: "square-meters",
      },
    },
  })

  const cleanup = setupSketchEventHandlers({
    sketchViewModel,
    onDrawComplete,
    dispatch,
    widgetId,
    onDrawingSessionChange,
    onSketchToolStart,
  })
  ;(sketchViewModel as any).__fmeCleanup__ = cleanup
  return { sketchViewModel, cleanup }
}

/* Widget Startup Validation */

// Validerar widget-uppstart: config, required fields, FME-anslutning
export async function validateWidgetStartup(
  options: StartupValidationOptions
): Promise<StartupValidationResult> {
  const { config, translate, signal, mapConfigured } = options

  // Step 1: Check if config exists
  if (!config) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "errorSetupRequired",
        ErrorType.CONFIG,
        "configMissing",
        translate,
        {
          suggestion: translate("actionOpenSettings"),
          userFriendlyMessage: translate("hintSetupWidget"),
        }
      ),
    }
  }

  // Step 2: Validate required config fields
  const requiredFieldsResult = validateRequiredFields(config, translate, {
    mapConfigured: mapConfigured ?? true,
  })
  if (!requiredFieldsResult.isValid) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "errorSetupRequired",
        ErrorType.CONFIG,
        "CONFIG_INCOMPLETE",
        translate
      ),
    }
  }

  // Step 3: Test FME Flow connection
  try {
    const connectionResult = await validateConnection({
      serverUrl: config.fmeServerUrl,
      token: config.fmeServerToken,
      repository: config.repository,
      signal,
    })

    if (!connectionResult.success) {
      return {
        isValid: false,
        canProceed: false,
        requiresSettings: true,
        error: createError(
          connectionResult.error?.message || "errorConnectionIssue",
          ErrorType.NETWORK,
          connectionResult.error?.type?.toUpperCase() || "CONNECTION_ERROR",
          translate,
          {
            suggestion:
              connectionResult.error?.type === "token"
                ? translate("tokenSettingsHint")
                : connectionResult.error?.type === "server"
                  ? translate("serverUrlSettingsHint")
                  : connectionResult.error?.type === "repository"
                    ? translate("repositorySettingsHint")
                    : translate("connectionSettingsHint"),
          }
        ),
      }
    }

    // All validation passed
    return {
      isValid: true,
      canProceed: true,
      requiresSettings: false,
    }
  } catch (error) {
    if (isAbortError(error)) {
      // Don't treat abort as an error - just return neutral state
      return {
        isValid: false,
        canProceed: false,
        requiresSettings: false,
      }
    }

    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "errorNetworkIssue",
        ErrorType.NETWORK,
        "STARTUP_NETWORK_ERROR",
        translate,
        {
          suggestion: translate("networkConnectionHint"),
        }
      ),
    }
  }
}
