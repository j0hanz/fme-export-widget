import type {
  ChoiceSetConfig,
  ColorFieldConfig,
  DateTimeFieldConfig,
  DynamicFieldConfig,
  DynamicPropertyClause,
  FileFieldConfig,
  FormPrimitive,
  MutableNode,
  OptionItem,
  ScriptedFieldConfig,
  ScriptedOptionNode,
  SelectFieldConfig,
  TableColumnConfig,
  TableColumnType,
  TableFieldConfig,
  TextOrFileValue,
  ToggleFieldConfig,
  ToggleOptionEntry,
  ToggleValue,
  ToggleValuePair,
  VisibilityExpression,
  VisibilityState,
  WorkspaceParameter,
  WorkspaceParameterWithChoices,
} from "../../config/index";
import {
  ALWAYS_SKIPPED_TYPES,
  DEFAULT_SEPARATOR_REGEX,
  FormFieldType,
  LIST_REQUIRED_TYPES,
  MAX_SEPARATOR_LENGTH,
  MULTI_SELECT_TYPES,
  NO_SLIDER_KEYWORDS,
  PARAMETER_FIELD_TYPE_MAP,
  ParameterType,
  SKIPPED_PARAMETER_NAMES,
} from "../../config/index";
import {
  areToggleValuesEqual,
  buildChoiceSet,
  extractTemporalParts,
  isEmpty,
  isFileObject,
  isFiniteNumber,
  isNonEmptyTrimmedString,
  isNonNegativeNumber,
  isNumericString,
  isPlainObject,
  isStringOrNumber,
  mergeMetadata,
  normalizeParameterValue,
  normalizeToggleValue,
  normalizeToLowerCase,
  pickBoolean,
  pickNumber,
  pickString,
  toArray,
  toBooleanValue,
  toMetadataRecord,
  toNonEmptyTrimmedString,
  toStringValue,
  toTrimmedString,
  unwrapArray,
} from "../utils";
import { logWarn } from "../utils/logging";
import { createSafeRegExp, escapeForCharacterClass } from "../utils/regex";
import {
  validateParameterChoices as validateParamChoices,
  validateParameterType as validateParamType,
} from "../validations";

/* Parameter Service - Formulärgenerering och validering */

// Service för att konvertera FME-parametrar till dynamiska formulärfält
export class ParameterFormService {
  // Cache heavy derived structures per parameter to avoid repeated work
  private readonly metadataCache = new WeakMap<
    WorkspaceParameter,
    { readonly [key: string]: unknown }
  >();

  private readonly optionsCache = new WeakMap<
    WorkspaceParameter,
    readonly OptionItem[] | undefined
  >();

  private readonly fieldCache = new WeakMap<
    WorkspaceParameter,
    DynamicFieldConfig
  >();

  private readonly scriptedNodesCache = new WeakMap<
    readonly OptionItem[],
    Map<string, readonly ScriptedOptionNode[] | undefined>
  >();

  private readonly separatorRegexCache = new Map<string, RegExp>();

  private deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
      value.forEach((item) => this.deepFreeze(item));
      Object.freeze(value);
      return value;
    }

    if (value && typeof value === "object" && isPlainObject(value)) {
      const obj = value as { [key: string]: unknown };
      Object.keys(obj).forEach((key) => {
        this.deepFreeze(obj[key]);
      });
      Object.freeze(obj);
      return value;
    }

    return value;
  }

  private getSeparatorRegex(separator: string): {
    regex: RegExp;
    usedFallback: boolean;
    key: string;
  } {
    const trimmed = separator ? separator.slice(0, MAX_SEPARATOR_LENGTH) : "|";
    const cacheKey = trimmed || "|";
    const existing = this.separatorRegexCache.get(cacheKey);
    if (existing) {
      return {
        regex: existing,
        usedFallback: existing === DEFAULT_SEPARATOR_REGEX && cacheKey !== "|",
        key: cacheKey,
      };
    }

    const escaped = escapeForCharacterClass(cacheKey);
    const pattern = `[${escaped}]`;
    const regex =
      createSafeRegExp(pattern, "", {
        maxLength: pattern.length + 2,
      }) || DEFAULT_SEPARATOR_REGEX;

    this.separatorRegexCache.set(cacheKey, regex);

    return {
      regex,
      usedFallback: regex === DEFAULT_SEPARATOR_REGEX && cacheKey !== "|",
      key: cacheKey,
    };
  }

  private getOptionsForParameter(
    param: WorkspaceParameter
  ): readonly OptionItem[] | undefined {
    const cached = this.optionsCache.get(param);
    if (cached) {
      return cached;
    }

    const mapped = this.mapListOptions(param);
    const frozen = mapped ? this.deepFreeze(mapped) : undefined;
    this.optionsCache.set(param, frozen);
    return frozen;
  }

  // Kontrollerar om parameter ska renderas som formulärfält
  private isRenderableParam(
    p: WorkspaceParameter | null | undefined
  ): p is WorkspaceParameter {
    if (!p || typeof p.name !== "string") return false;
    if (SKIPPED_PARAMETER_NAMES.has(p.name)) return false;
    if (ALWAYS_SKIPPED_TYPES.has(p.type)) return false;
    if (LIST_REQUIRED_TYPES.has(p.type)) {
      const choiceSettings = this.getChoiceSettings(p);
      const choices = choiceSettings?.choices;
      const hasChoices = Array.isArray(choices) && choices.length > 0;

      return (
        hasChoices ||
        (p.defaultValue !== null &&
          p.defaultValue !== undefined &&
          p.defaultValue !== "")
      );
    }

    return true;
  }

  // Filtrerar och returnerar endast renderbara parametrar
  private getRenderableParameters(
    parameters: readonly WorkspaceParameter[]
  ): WorkspaceParameter[] {
    return parameters.filter((parameter) => this.isRenderableParam(parameter));
  }

  private getChoiceSettings(
    param: WorkspaceParameter
  ): WorkspaceParameterWithChoices["choiceSettings"] | undefined {
    const paramWithChoices = param as WorkspaceParameterWithChoices;
    if (paramWithChoices.choiceSettings) {
      return paramWithChoices.choiceSettings;
    }

    if (param.control && isPlainObject(param.control)) {
      const nested = (param.control as { [key: string]: unknown })
        .choiceSettings;
      if (nested) {
        return nested as WorkspaceParameterWithChoices["choiceSettings"];
      }
    }

    return undefined;
  }

  // Mappar FME V4 choiceSettings.choices till OptionItem-format
  private mapListOptions(
    param: WorkspaceParameter
  ): readonly OptionItem[] | undefined {
    const paramWithChoices = param as WorkspaceParameterWithChoices;
    const choiceSettings = this.getChoiceSettings(param);
    if (!choiceSettings || !Array.isArray(choiceSettings.choices)) {
      return undefined;
    }
    const nodeDelimiter = paramWithChoices.nodeDelimiter;
    const isTree = param.type === ParameterType.tree;

    return choiceSettings.choices.map((choiceOption) => {
      const rawValue =
        choiceOption.value ?? choiceOption.id ?? choiceOption.code;
      const normalizedValue = normalizeParameterValue(rawValue);
      const displayValue =
        choiceOption.display ??
        choiceOption.caption ??
        choiceOption.label ??
        choiceOption.name;
      const label = toNonEmptyTrimmedString(
        displayValue,
        String(normalizedValue)
      );
      const path =
        isTree && nodeDelimiter && typeof displayValue === "string"
          ? displayValue
          : typeof choiceOption.path === "string" && choiceOption.path
            ? choiceOption.path
            : undefined;

      return {
        label,
        value: normalizedValue,
        ...(choiceOption.description && {
          description: choiceOption.description,
        }),
        ...(path && { path }),
        ...(choiceOption.disabled && { disabled: true }),
        ...(choiceOption.metadata && { metadata: choiceOption.metadata }),
      };
    });
  }

  private extractToggleMetaValue(
    meta: { readonly [key: string]: unknown } | undefined,
    keys: readonly string[]
  ): string | number | undefined {
    if (!meta) return undefined;
    for (const key of keys) {
      if (!(key in meta)) continue;
      const candidate = normalizeToggleValue(
        (meta as { readonly [key: string]: unknown })[key]
      );
      if (candidate !== undefined) {
        return candidate;
      }
    }
    return undefined;
  }

  // Normaliserar decimalprecision till heltal >= 0 (max 6 för att undvika flyttalsfel)
  private getDecimalPrecision(param: WorkspaceParameter): number | undefined {
    const raw = param.decimalPrecision;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      return undefined;
    }
    const clamped = Math.floor(raw);
    return clamped >= 0 ? Math.min(clamped, 6) : undefined;
  }

  // Extraherar slider-/range-metadata (min/max/step/exklusivitet)
  private getSliderMeta(
    param: WorkspaceParameter,
    precision: number | undefined,
    useSliderUi: boolean
  ): {
    min?: number;
    max?: number;
    step?: number;
    minExclusive?: boolean;
    maxExclusive?: boolean;
  } {
    const minExclusive =
      typeof param.minimumExclusive === "boolean"
        ? param.minimumExclusive
        : false;
    const maxExclusive =
      typeof param.maximumExclusive === "boolean"
        ? param.maximumExclusive
        : false;

    if (param.type !== ParameterType.RANGE_SLIDER) {
      return {
        min: typeof param.minimum === "number" ? param.minimum : undefined,
        max: typeof param.maximum === "number" ? param.maximum : undefined,
        minExclusive,
        maxExclusive,
      };
    }

    const hasMin = typeof param.minimum === "number";
    const hasMax = typeof param.maximum === "number";
    const resolvedPrecision =
      typeof precision === "number" && precision >= 0
        ? Math.floor(precision)
        : undefined;

    const min = hasMin ? param.minimum : useSliderUi ? 0 : undefined;
    const max = hasMax ? param.maximum : useSliderUi ? 100 : undefined;

    let step: number | undefined;
    if (resolvedPrecision !== undefined) {
      step =
        resolvedPrecision > 0
          ? Number(`0.${"0".repeat(resolvedPrecision - 1)}1`)
          : 1;
    } else if (useSliderUi) {
      step = 1;
    }

    return {
      min,
      max,
      step,
      minExclusive,
      maxExclusive,
    };
  }

  // Avgör om RANGE_SLIDER ska använda slider-UI eller numeriskt fält
  private shouldUseRangeSliderUi(param: WorkspaceParameter): boolean {
    if (param.type !== ParameterType.RANGE_SLIDER) return false;

    if (param.control && typeof param.control === "object") {
      const controlRecord = param.control as { [key: string]: unknown };
      if (typeof controlRecord.useRangeSlider === "boolean")
        return controlRecord.useRangeSlider;
      if (typeof controlRecord.useSlider === "boolean")
        return controlRecord.useSlider;
    }

    const description = (param.description || "").toLowerCase();
    return !NO_SLIDER_KEYWORDS.some((keyword) => description.includes(keyword));
  }

  // Samlar metadata från olika källor (metadata, attributes, definition etc.)
  private getParameterMetadata(param: WorkspaceParameter): {
    readonly [key: string]: unknown;
  } {
    const cached = this.metadataCache.get(param);
    if (cached) {
      return cached;
    }
    const defaultValueMeta = isPlainObject(param.defaultValue)
      ? (param.defaultValue as { readonly [key: string]: unknown })
      : undefined;
    const merged =
      mergeMetadata([
        param.metadata,
        param.attributes,
        param.definition,
        param.control,
        param.schema,
        param.ui,
        param.extra,
        defaultValueMeta,
      ]) || {};
    const frozen = this.deepFreeze(merged);
    this.metadataCache.set(param, frozen);
    return frozen;
  }

  // Normaliserar enskilt option-item till enhetligt format
  private normalizeOptionItem(item: unknown, index: number): OptionItem | null {
    if (item == null) return null;

    if (isStringOrNumber(item)) {
      const normalized = normalizeParameterValue(item);
      return {
        label: String(normalized),
        value: normalized,
        isLeaf: true,
      };
    }

    if (!isPlainObject(item)) return null;

    const obj = item as { readonly [key: string]: unknown };
    const label =
      pickString(obj, ["caption", "label", "name", "title", "displayName"]) ??
      `Option ${index + 1}`;
    const rawValue =
      obj.value ??
      obj.id ??
      obj.code ??
      obj.path ??
      obj.name ??
      obj.key ??
      label ??
      index;
    const normalizedValue = normalizeParameterValue(rawValue);

    const childEntries = unwrapArray(obj.children);
    const children = childEntries
      ?.map((child, childIndex) => this.normalizeOptionItem(child, childIndex))
      .filter((child): child is OptionItem => child != null);

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
    };
  }

  // Söker efter options i metadata under vanliga nycklar
  private collectMetaOptions(meta: {
    readonly [key: string]: unknown;
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
    ];

    for (const key of candidateKeys) {
      const arr = unwrapArray(meta[key]);
      if (!arr?.length) continue;
      const normalized = arr
        .map((item, index) => this.normalizeOptionItem(item, index))
        .filter((item): item is OptionItem => item != null);
      if (normalized.length) {
        return normalized;
      }
    }

    return undefined;
  }

  // Extraherar scriptade options från parameter-metadata
  private extractScriptedOptions(
    param: WorkspaceParameter,
    baseOptions?: readonly OptionItem[]
  ): readonly OptionItem[] | undefined {
    const meta = this.getParameterMetadata(param);
    const metaOptions = this.collectMetaOptions(meta);
    if (metaOptions?.length) return metaOptions;
    return baseOptions;
  }

  // Bygger hierarkisk nodstruktur från path-baserade options
  private buildScriptedNodes(
    options: readonly OptionItem[] | undefined,
    separator: string
  ): readonly ScriptedOptionNode[] | undefined {
    if (!options?.length) return undefined;

    const normalizedSeparator = separator || "/";
    let cacheBySeparator = this.scriptedNodesCache.get(options);
    if (!cacheBySeparator) {
      cacheBySeparator = new Map();
      this.scriptedNodesCache.set(options, cacheBySeparator);
    }

    if (cacheBySeparator.has(normalizedSeparator)) {
      return cacheBySeparator.get(normalizedSeparator);
    }

    const nodes = this.buildScriptedNodeTree(options, normalizedSeparator);
    cacheBySeparator.set(normalizedSeparator, nodes);
    return nodes;
  }

  private buildScriptedNodeTree(
    options: readonly OptionItem[],
    separator: string
  ): readonly ScriptedOptionNode[] | undefined {
    const hasHierarchy = options.some(
      (opt) => opt.children && opt.children.length > 0
    );

    return hasHierarchy
      ? this.buildNodesFromHierarchy(options, separator)
      : this.buildNodesFromPaths(options, separator);
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
          : [option.label];

      const id =
        (option.metadata &&
          typeof option.metadata.id === "string" &&
          option.metadata.id) ||
        (option.value != null ? String(option.value) : resolvedPath.join("|"));

      const childNodes = option.children?.length
        ? option.children.map((child) => convert(child, resolvedPath))
        : undefined;

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
      };
    };

    return options.map((option) => convert(option, undefined));
  }

  // Bygger hierarkisk struktur från path-strängar
  private buildNodesFromPaths(
    options: readonly OptionItem[],
    separator: string
  ): ScriptedOptionNode[] {
    const {
      regex: separatorRegex,
      usedFallback,
      key,
    } = this.getSeparatorRegex(separator);

    if (usedFallback) {
      logWarn("ParameterFormService: Using fallback path separator", {
        separatorLength: key.length,
      });
    }
    const roots: MutableNode[] = [];
    const nodeMap = new Map<string, MutableNode>();

    const ensureNode = (
      segments: readonly string[],
      option?: OptionItem
    ): MutableNode => {
      const key =
        segments.join("|") || (option ? String(option.value) : "root");
      const existing = nodeMap.get(key);
      if (existing) return existing;

      const label = segments[segments.length - 1] || option?.label || key;
      const node: MutableNode = {
        id: key,
        label,
        path: [...segments],
        children: [],
      };
      nodeMap.set(key, node);

      if (segments.length > 1) {
        const parentSegments = segments.slice(0, -1);
        const parent = ensureNode(parentSegments);
        parent.children.push(node);
      } else {
        roots.push(node);
      }

      return node;
    };

    for (const option of options) {
      const pathSegments = option.path
        ? option.path
            .split(separatorRegex)
            .map((segment) => segment.trim())
            .filter(Boolean)
        : [option.label];

      const leaf = ensureNode(pathSegments, option);
      leaf.value = option.value;
      if (option.metadata) {
        leaf.metadata = { ...(leaf.metadata || {}), ...option.metadata };
      }
      if (option.disabled) {
        leaf.disabled = true;
      }
      if (option.description) {
        leaf.metadata = {
          ...(leaf.metadata || {}),
          description: option.description,
        };
      }
    }

    const finalize = (node: MutableNode): ScriptedOptionNode => {
      const children = node.children.map((child) => finalize(child));
      return {
        id: node.id,
        label: node.label,
        path: node.path,
        ...(node.value !== undefined ? { value: node.value } : {}),
        ...(node.disabled ? { disabled: true } : {}),
        ...(node.metadata ? { metadata: node.metadata } : {}),
        ...(children.length ? { children } : { isLeaf: true }),
      };
    };

    return roots.map((root) => finalize(root));
  }

  // Extraherar och validerar tabell-konfiguration från metadata
  private deriveTableConfig(
    param: WorkspaceParameter
  ): TableFieldConfig | undefined {
    const meta = this.getParameterMetadata(param);
    const columnCandidates =
      unwrapArray(meta.columns) ??
      unwrapArray(meta.fields) ??
      unwrapArray(meta.tableColumns) ??
      unwrapArray(meta.schema);

    if (!columnCandidates?.length) return undefined;

    const columns = columnCandidates
      .map((column, index) => this.normalizeTableColumn(column, index))
      .filter((column): column is TableColumnConfig => column != null);

    const validatedColumns = this.validateTableColumns(columns);

    if (!validatedColumns.length) return undefined;

    const minRowsRaw = pickNumber(meta, [
      "minRows",
      "minimumRows",
      "minRowCount",
    ]);
    const maxRowsRaw = pickNumber(meta, [
      "maxRows",
      "maximumRows",
      "maxRowCount",
    ]);

    const bounds = this.normalizeRowBounds(minRowsRaw, maxRowsRaw);

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
    };
  }

  // Validerar tabell-kolumner och tar bort dubbletter
  private validateTableColumns(
    columns: readonly TableColumnConfig[]
  ): TableColumnConfig[] {
    if (!columns?.length) return [];

    const seen = new Set<string>();
    const valid: TableColumnConfig[] = [];

    for (const column of columns) {
      if (!column?.key) continue;
      if (seen.has(column.key)) continue;
      if (
        column.type === "select" &&
        (!column.options || column.options.length === 0)
      ) {
        continue;
      }
      valid.push(column);
      seen.add(column.key);
    }

    return valid;
  }

  // Normaliserar och säkerställer giltiga min/max-radgränser
  private normalizeRowBounds(
    minRows: number | undefined,
    maxRows: number | undefined
  ): { minRows?: number; maxRows?: number } {
    const resolvedMin =
      typeof minRows === "number" && isNonNegativeNumber(minRows)
        ? Math.floor(minRows)
        : undefined;
    let resolvedMax =
      typeof maxRows === "number" && isNonNegativeNumber(maxRows)
        ? Math.floor(maxRows)
        : undefined;

    if (
      resolvedMin !== undefined &&
      resolvedMax !== undefined &&
      resolvedMin > resolvedMax
    ) {
      resolvedMax = resolvedMin;
    }

    return { minRows: resolvedMin, maxRows: resolvedMax };
  }

  // Normaliserar enskild tabell-kolumn från metadata
  private normalizeTableColumn(
    column: unknown,
    index: number
  ): TableColumnConfig | null {
    if (!isPlainObject(column)) return null;

    const data = column as { readonly [key: string]: unknown };
    const key =
      pickString(data, ["key", "name", "field", "id"]) ?? `column_${index}`;
    const label =
      pickString(data, ["label", "title", "caption", "name"]) ?? key;

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
    };
    const typeRaw = pickString(data, ["type", "inputType", "fieldType"]);
    const type = typeRaw ? typeMap[typeRaw.toLowerCase()] : undefined;

    const optionsRaw =
      unwrapArray(data.options) ??
      unwrapArray(data.choices) ??
      unwrapArray(data.values);
    const options = optionsRaw
      ?.map((item, idx) => this.normalizeOptionItem(item, idx))
      .filter((item): item is OptionItem => item != null);

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
    };
  }

  // Extraherar scriptad fält-konfiguration med hierarkiska options
  private deriveScriptedConfig(
    param: WorkspaceParameter,
    baseOptions?: readonly OptionItem[]
  ): ScriptedFieldConfig | undefined {
    if (param.type !== ParameterType.SCRIPTED) return undefined;

    const meta = this.getParameterMetadata(param);
    const options = this.extractScriptedOptions(param, baseOptions);
    const paramRecord = param as unknown as { [key: string]: unknown };
    const nodeDelimiter =
      (typeof paramRecord.nodeDelimiter === "string"
        ? paramRecord.nodeDelimiter
        : undefined) ||
      (typeof paramRecord.delimiter === "string"
        ? paramRecord.delimiter
        : undefined);
    const separator =
      nodeDelimiter ||
      pickString(meta, ["breadcrumbSeparator", "pathSeparator", "delimiter"]) ||
      "/";
    const nodes = this.buildScriptedNodes(options, separator);

    const allowMultiple = pickBoolean(
      meta,
      ["allowMultiple", "multiple", "multiSelect", "supportsMultiple"],
      Array.isArray(param.defaultValue)
    );
    const allowManualEntry = pickBoolean(
      meta,
      ["allowManualEntry", "allowManual", "allowCustom", "allowFreeform"],
      false
    );
    const allowSearch = pickBoolean(
      meta,
      ["allowSearch", "searchable", "enableSearch", "supportsSearch"],
      (options?.length ?? 0) > 15
    );
    const pageSize = pickNumber(meta, [
      "pageSize",
      "page_size",
      "limit",
      "pageLimit",
    ]);
    const instructions =
      pickString(meta, ["instructions", "instruction", "helper", "hint"]) ||
      toTrimmedString(param.description);
    const searchPlaceholder = pickString(meta, [
      "searchPlaceholder",
      "searchLabel",
      "searchPrompt",
    ]);
    const autoSelectSingleLeaf = pickBoolean(
      meta,
      ["autoSelectSingleLeaf", "autoSelectSingle", "autoSelect"],
      true
    );
    const maxResultsHint = pickString(meta, [
      "maxResultsHint",
      "resultsHint",
      "resultsMessage",
    ]);

    const hierarchical = Boolean(
      nodes?.some((node) => node.children && node.children.length > 0)
    );

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
    };
  }

  // Extraherar datum/tid-konfiguration från parameter
  private deriveDateTimeConfig(
    param: WorkspaceParameter
  ): DateTimeFieldConfig | undefined {
    const dateTimeTypes = [
      ParameterType.DATE_TIME,
      ParameterType.DATETIME,
      ParameterType.TIME,
    ];
    if (!dateTimeTypes.includes(param.type)) return undefined;

    const meta = this.getParameterMetadata(param);
    const includeSeconds = pickBoolean(
      meta,
      ["includeSeconds", "showSeconds", "seconds"],
      true
    );

    const defaultValue =
      typeof param.defaultValue === "string" ? param.defaultValue : undefined;
    const temporalParts = defaultValue
      ? extractTemporalParts(defaultValue)
      : { fraction: "", offset: "", base: "" };

    const includeMilliseconds =
      pickBoolean(
        meta,
        ["includeMilliseconds", "milliseconds", "fractional"],
        false
      ) ||
      (temporalParts.fraction && temporalParts.fraction.length > 1);

    const timezoneOptionsRaw =
      unwrapArray(meta.timezones) ?? unwrapArray(meta.timezoneOptions);
    const timezoneOptions = timezoneOptionsRaw
      ?.map((item, idx) => this.normalizeOptionItem(item, idx))
      .filter((item): item is OptionItem => item != null);

    const defaultTimezone =
      pickString(meta, ["defaultTimezone", "timezoneDefault"]) ||
      pickString(meta, ["timezoneOffset", "defaultOffset"]) ||
      temporalParts.offset ||
      undefined;

    const rawTimezoneMode = pickString(meta, [
      "timezoneMode",
      "timezone",
      "tzMode",
    ]);
    const timezoneMode: DateTimeFieldConfig["timezoneMode"] =
      rawTimezoneMode === "fixed" || rawTimezoneMode === "select"
        ? rawTimezoneMode
        : timezoneOptions?.length
          ? "select"
          : temporalParts.offset || rawTimezoneMode === "offset"
            ? "offset"
            : undefined;

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
    };
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
    ]);

    if (!selectableTypes.has(type)) return undefined;

    const meta = this.getParameterMetadata(param);
    const isTreeParam = param.type === ParameterType.tree;
    const hasPathsInOptions = Boolean(
      options?.some(
        (opt) => opt.path || (opt.children && opt.children.length > 0)
      )
    );

    const hierarchical = pickBoolean(
      meta,
      ["hierarchical", "tree", "grouped", "nested"],
      isTreeParam || hasPathsInOptions
    );

    const allowSearch = pickBoolean(
      meta,
      ["allowSearch", "searchable", "enableSearch"],
      (options?.length ?? 0) > 25
    );
    const allowCustomValues = pickBoolean(
      meta,
      ["allowCustomValues", "allowCustom", "allowManual", "allowFreeform"],
      false
    );
    const pageSize = pickNumber(meta, [
      "pageSize",
      "page_size",
      "limit",
      "pageLimit",
    ]);
    const instructions = pickString(meta, ["instructions", "hint", "helper"]);

    // Only return config if at least one non-default value exists
    if (
      !allowSearch &&
      !allowCustomValues &&
      !pageSize &&
      !instructions &&
      !hierarchical
    ) {
      return undefined;
    }

    return {
      allowSearch,
      allowCustomValues,
      hierarchical,
      ...(pageSize && { pageSize }),
      ...(instructions && { instructions }),
    };
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
    ]);
    if (!fileCapableTypes.has(type)) return undefined;

    const meta = this.getParameterMetadata(param);
    const acceptRaw = meta.accept ?? meta.accepted ?? meta.extensions;

    const acceptList = (() => {
      if (!acceptRaw) return undefined;
      if (Array.isArray(acceptRaw)) {
        const list = (acceptRaw as unknown[])
          .map((item) => toTrimmedString(item))
          .filter((item): item is string => Boolean(item));
        return list.length ? list : undefined;
      }
      if (typeof acceptRaw === "string") {
        const parts = acceptRaw
          .split(/[,;\s]+/)
          .map((part) => part.trim())
          .filter(Boolean);
        return parts.length ? parts : undefined;
      }
      return undefined;
    })();

    const maxSizeMb = pickNumber(meta, [
      "maxSizeMb",
      "maxSize",
      "fileSizeMb",
      "maxUploadMb",
    ]);
    const allowMultiple = pickBoolean(
      meta,
      ["allowMultiple", "multiple", "multi"],
      false
    );
    const helperText = pickString(meta, ["helper", "hint", "instructions"]);
    const capture = pickString(meta, ["capture", "captureMode"]);

    // Only return config if at least one value exists
    if (
      !acceptList &&
      !maxSizeMb &&
      !allowMultiple &&
      !helperText &&
      !capture
    ) {
      return undefined;
    }

    return {
      ...(acceptList && { accept: acceptList }),
      ...(maxSizeMb !== undefined && { maxSizeMb }),
      ...(allowMultiple && { multiple: true }),
      ...(helperText && { helperText }),
      ...(capture && { capture }),
    };
  }

  // ============================================
  // Choice Set Extraction (Added: Oct 24, 2025)
  // ============================================

  public extractChoiceSetConfig(
    param: WorkspaceParameter
  ): ChoiceSetConfig | undefined {
    if (!param || !param.choiceSet) return undefined;

    const choiceSet = param.choiceSet;
    const type = choiceSet.type;

    if (!type) return undefined;

    switch (type) {
      case "attributeNames":
        // Spread bevarar framtida FME-properties
        return {
          type: "attributeNames",
          ...choiceSet,
        };

      case "coordinateSystems":
        // Spread bevarar framtida FME-properties
        return {
          type: "coordinateSystems",
          ...choiceSet,
        };

      case "dbConnections":
        // Spread bevarar framtida FME-properties
        return {
          type: "dbConnections",
          ...choiceSet,
        };

      case "webConnections":
        // Spread bevarar framtida FME-properties
        return {
          type: "webConnections",
          ...choiceSet,
        };
    }
  }

  // Helper: Parse option entries for toggle fields
  private parseToggleOptionEntries(
    options?: readonly OptionItem[]
  ): readonly ToggleOptionEntry[] {
    if (!Array.isArray(options)) return [];

    return options
      .map(
        (opt): ToggleOptionEntry => ({
          value: normalizeToggleValue(opt?.value),
          label: toTrimmedString(opt?.label) ?? undefined,
        })
      )
      .filter((entry) => entry.value !== undefined || entry.label);
  }

  // Helper: Resolve checked/unchecked values from option entries
  private resolveToggleOptionsFromEntries(
    optionEntries: readonly ToggleOptionEntry[],
    normalizedDefault: ToggleValue | undefined,
    meta: { [key: string]: unknown } | undefined
  ): ToggleValuePair {
    let checkedValue = this.extractToggleMetaValue(meta, [
      "checkedValue",
      "checked_value",
      "trueValue",
      "true_value",
      "onValue",
      "on_value",
      "yesValue",
      "yes_value",
    ]);
    let uncheckedValue = this.extractToggleMetaValue(meta, [
      "uncheckedValue",
      "unchecked_value",
      "falseValue",
      "false_value",
      "offValue",
      "off_value",
      "noValue",
      "no_value",
    ]);

    if (optionEntries.length === 2) {
      const [first, second] = optionEntries;

      if (normalizedDefault !== undefined && uncheckedValue === undefined) {
        if (
          first.value !== undefined &&
          areToggleValuesEqual(first.value, normalizedDefault)
        ) {
          uncheckedValue = first.value as string | number;
          if (checkedValue === undefined && second.value !== undefined) {
            checkedValue = second.value as string | number;
          }
        } else if (
          second.value !== undefined &&
          areToggleValuesEqual(second.value, normalizedDefault)
        ) {
          uncheckedValue = second.value as string | number;
          if (checkedValue === undefined && first.value !== undefined) {
            checkedValue = first.value as string | number;
          }
        }
      }

      if (checkedValue === undefined) {
        const fallbackValue = first.value ?? second.value;
        if (fallbackValue !== undefined) {
          checkedValue = fallbackValue as string | number;
        }
      }

      if (uncheckedValue === undefined) {
        const fallback = second.value ?? first.value;
        if (
          fallback !== undefined &&
          checkedValue !== undefined &&
          areToggleValuesEqual(fallback, checkedValue) &&
          first.value !== undefined &&
          !areToggleValuesEqual(first.value, checkedValue)
        ) {
          uncheckedValue = first.value as string | number;
        } else if (fallback !== undefined) {
          uncheckedValue = fallback as string | number;
        }
      }
    } else if (optionEntries.length === 1) {
      if (checkedValue === undefined && optionEntries[0].value !== undefined) {
        checkedValue = optionEntries[0].value as string | number;
      }
    }

    return { checkedValue, uncheckedValue };
  }

  // Helper: Apply default values to toggle options
  private applyToggleDefaults(
    checkedValue: ToggleValue | undefined,
    uncheckedValue: ToggleValue | undefined,
    normalizedDefault: ToggleValue | undefined,
    defaultBoolean: boolean | undefined
  ): ToggleValuePair {
    let finalChecked = checkedValue;
    let finalUnchecked = uncheckedValue;

    if (defaultBoolean !== undefined) {
      if (finalChecked === undefined && defaultBoolean) {
        finalChecked = normalizeToggleValue(true);
      }

      if (finalUnchecked === undefined && !defaultBoolean) {
        finalUnchecked = normalizeToggleValue(false);
      }
    }

    if (finalUnchecked === undefined && normalizedDefault !== undefined) {
      finalUnchecked = normalizedDefault;
    }

    // Avoid duplicate values
    if (
      finalChecked !== undefined &&
      finalUnchecked !== undefined &&
      areToggleValuesEqual(finalChecked, finalUnchecked)
    ) {
      finalUnchecked = undefined;
    }

    return { checkedValue: finalChecked, uncheckedValue: finalUnchecked };
  }

  // Helper: Extract toggle labels from metadata or options
  private extractToggleLabels(
    meta: { [key: string]: unknown },
    optionEntries: readonly ToggleOptionEntry[],
    checkedValue: string | number | boolean | undefined,
    uncheckedValue: string | number | boolean | undefined
  ): { checkedLabel?: string; uncheckedLabel?: string } {
    const checkedLabel =
      pickString(meta, [
        "checkedLabel",
        "checked_caption",
        "checkedText",
        "checked_label",
        "trueLabel",
      ]) ||
      optionEntries.find(
        (entry) =>
          entry.label &&
          checkedValue !== undefined &&
          entry.value !== undefined &&
          areToggleValuesEqual(entry.value, checkedValue)
      )?.label;

    const uncheckedLabel =
      pickString(meta, [
        "uncheckedLabel",
        "unchecked_caption",
        "uncheckedText",
        "unchecked_label",
        "falseLabel",
      ]) ||
      optionEntries.find(
        (entry) =>
          entry.label &&
          uncheckedValue !== undefined &&
          entry.value !== undefined &&
          areToggleValuesEqual(entry.value, uncheckedValue)
      )?.label;

    return { checkedLabel, uncheckedLabel };
  }

  private deriveToggleConfig(
    type: FormFieldType,
    param: WorkspaceParameter,
    options?: readonly OptionItem[]
  ): ToggleFieldConfig | undefined {
    if (type !== FormFieldType.SWITCH && type !== FormFieldType.CHECKBOX) {
      return undefined;
    }

    const meta = this.getParameterMetadata(param);
    const normalizedDefault = normalizeToggleValue(param.defaultValue);
    const defaultBoolean = toBooleanValue(param.defaultValue);

    // Step 1: Parse option entries
    const optionEntries = this.parseToggleOptionEntries(options);

    // Step 2: Resolve checked/unchecked values from entries
    let { checkedValue, uncheckedValue } = this.resolveToggleOptionsFromEntries(
      optionEntries,
      normalizedDefault,
      meta
    );

    // Step 3: Apply defaults
    const finalValues = this.applyToggleDefaults(
      checkedValue,
      uncheckedValue,
      normalizedDefault,
      defaultBoolean
    );
    checkedValue = finalValues.checkedValue;
    uncheckedValue = finalValues.uncheckedValue;

    // Step 4: Extract labels
    const { checkedLabel, uncheckedLabel } = this.extractToggleLabels(
      meta,
      optionEntries,
      checkedValue,
      uncheckedValue
    );

    // Build result
    const result: ToggleFieldConfig = {
      ...(checkedValue !== undefined && { checkedValue }),
      ...(uncheckedValue !== undefined && { uncheckedValue }),
      ...(checkedLabel && { checkedLabel }),
      ...(uncheckedLabel && { uncheckedLabel }),
    };

    return Object.keys(result).length ? result : undefined;
  }

  // Extraherar färg-fält-konfiguration från parameter
  private deriveColorConfig(
    param: WorkspaceParameter
  ): ColorFieldConfig | undefined {
    if (
      param.type !== ParameterType.COLOR &&
      param.type !== ParameterType.COLOR_PICK
    ) {
      return undefined;
    }

    const meta = this.getParameterMetadata(param);
    const spaceRaw = pickString(meta, [
      "colorSpace",
      "colourSpace",
      "space",
      "colorModel",
      "colourModel",
    ]);
    const normalizedSpace = spaceRaw
      ? normalizeToLowerCase(spaceRaw)
      : undefined;
    let space: ColorFieldConfig["space"];

    if (normalizedSpace === "cmyk") {
      space = "cmyk";
    } else if (normalizedSpace === "rgb") {
      space = "rgb";
    }

    if (!space) {
      const defaultString =
        typeof param.defaultValue === "string" ? param.defaultValue : "";
      const parts = defaultString
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (!space) {
        if (parts.length === 4) {
          space = "cmyk";
        } else if (parts.length === 3) {
          space = "rgb";
        }
      }
    }

    const alpha = pickBoolean(
      meta,
      ["alpha", "allowAlpha", "hasAlpha", "supportsAlpha", "includeAlpha"],
      false
    );

    if (!space && !alpha) return undefined;

    return {
      ...(space && { space }),
      ...(alpha && { alpha: true }),
    };
  }

  // Validering av parameter-värden mot typ och valbara alternativ
  validateParameters(
    data: { [key: string]: unknown },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const validParams = this.getRenderableParameters(parameters);

    for (const param of validParams) {
      if (param.type === ParameterType.GEOMETRY) {
        continue;
      }
      const value = data[param.name];
      const isMissingRequired = !param.optional && isEmpty(value);
      if (isMissingRequired) {
        errors.push(`${param.name}:required`);
        continue;
      }

      if (!isEmpty(value)) {
        const typeError = validateParamType(param.type, param.name, value);
        if (typeError) {
          errors.push(typeError);
          continue;
        }

        // Validering av valbara alternativ (choices)
        const choiceSettings = this.getChoiceSettings(param);
        const choices = Array.isArray(choiceSettings?.choices)
          ? choiceSettings?.choices
          : undefined;
        const validChoices = buildChoiceSet(choices);
        const choiceError = validateParamChoices(
          param.name,
          value,
          validChoices,
          MULTI_SELECT_TYPES.has(param.type)
        );
        if (choiceError) {
          errors.push(choiceError);
        }
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  // Parser för condition clause från raw object
  private parseConditionClause(clauseObj: {
    readonly [key: string]: unknown;
  }): DynamicPropertyClause<VisibilityState> | null {
    const thenValue = this.parseVisibilityState(clauseObj.then);
    if (!thenValue) return null;

    const conditionKeys = Object.keys(clauseObj).filter((key) =>
      key.startsWith("$")
    );

    // Enkel clause utan villkor (bara then)
    if (conditionKeys.length === 0) {
      return { then: thenValue };
    }

    // Clause med villkor ($ keys) - via unknown för strikt typing
    const clauseWithCondition: { [key: string]: unknown } = {
      then: thenValue,
    };
    for (const key of conditionKeys) {
      clauseWithCondition[key] = clauseObj[key];
    }

    return clauseWithCondition as unknown as DynamicPropertyClause<VisibilityState>;
  }

  // Bygger visibility expression från clauses och default state
  private buildVisibilityExpression(
    clauses: Array<DynamicPropertyClause<VisibilityState>>,
    defaultObj?: unknown
  ): VisibilityExpression {
    const defaultValue = isPlainObject(defaultObj)
      ? this.parseVisibilityState(
          (defaultObj as { readonly [key: string]: unknown }).value
        )
      : undefined;

    const result: VisibilityExpression = {
      if: clauses,
      ...(defaultValue && {
        default: {
          value: defaultValue,
          override: pickBoolean(
            defaultObj as { readonly [key: string]: unknown },
            ["override"],
            false
          ),
        },
      }),
    };

    return result;
  }

  // Extraherar synlighets-konfiguration från parameter-metadata (förenklad)
  private deriveVisibilityConfig(
    param: WorkspaceParameter
  ): VisibilityExpression | undefined {
    const meta = this.getParameterMetadata(param);
    const visibilityRaw = meta.visibility;
    if (!isPlainObject(visibilityRaw)) return undefined;

    const visibilityObj = visibilityRaw as { readonly [key: string]: unknown };
    const ifArray = unwrapArray(visibilityObj.if);
    if (!ifArray?.length) return undefined;

    const clauses: Array<DynamicPropertyClause<VisibilityState>> = [];

    for (const clause of ifArray) {
      if (!isPlainObject(clause)) continue;

      const clauseObj = clause as { readonly [key: string]: unknown };
      const parsedClause = this.parseConditionClause(clauseObj);
      if (parsedClause) {
        clauses.push(parsedClause);
      }
    }

    if (!clauses.length) return undefined;

    return this.buildVisibilityExpression(clauses, visibilityObj.default);
  }

  // Parser för enskild visibility state från sträng
  // Accepterar både V3 snake_case och V4 camelCase för bakåtkompabilitet
  private parseVisibilityState(value: unknown): VisibilityState | undefined {
    if (typeof value !== "string") return undefined;

    const normalized = normalizeToLowerCase(value);
    switch (normalized) {
      case "visibleenabled":
      case "visible_enabled":
        return "visibleEnabled";
      case "visibledisabled":
      case "visible_disabled":
        return "visibleDisabled";
      case "hiddenenabled":
      case "hidden_enabled":
        return "hiddenEnabled";
      case "hiddendisabled":
      case "hidden_disabled":
        return "hiddenDisabled";
      default:
        return undefined;
    }
  }

  // Konverterar parametrar till dynamiska formulärfält
  convertParametersToFields(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    if (!parameters?.length) return [];

    const renderable = this.getRenderableParameters(parameters);
    if (!renderable.length) {
      return [];
    }

    const fields = new Array<DynamicFieldConfig>(renderable.length);
    for (let i = 0; i < renderable.length; i++) {
      fields[i] = this.getFieldConfig(renderable[i]);
    }
    return fields as readonly DynamicFieldConfig[];
  }

  private getFieldConfig(param: WorkspaceParameter): DynamicFieldConfig {
    const cached = this.fieldCache.get(param);
    if (cached) {
      return cached;
    }

    const field = this.buildFieldConfig(param);
    const frozen = this.deepFreeze(field);
    this.fieldCache.set(param, frozen);
    return frozen;
  }

  private buildFieldConfig(param: WorkspaceParameter): DynamicFieldConfig {
    const baseType = this.getFieldType(param);
    const decimalPrecision = this.getDecimalPrecision(param);
    const sliderUiPreferred =
      param.type === ParameterType.RANGE_SLIDER
        ? this.shouldUseRangeSliderUi(param)
        : false;
    const type =
      param.type === ParameterType.RANGE_SLIDER && !sliderUiPreferred
        ? FormFieldType.NUMERIC_INPUT
        : baseType;
    const options = this.getOptionsForParameter(param);
    const scripted = this.deriveScriptedConfig(param, options);
    const tableConfig = this.deriveTableConfig(param);
    const dateTimeConfig = this.deriveDateTimeConfig(param);
    const selectConfig = this.deriveSelectConfig(type, param, options);
    const fileConfig = this.deriveFileConfig(type, param);
    const colorConfig = this.deriveColorConfig(param);
    const toggleConfig = this.deriveToggleConfig(type, param, options);
    const visibility = this.deriveVisibilityConfig(param);
    const choiceSetConfig = this.extractChoiceSetConfig(param);
    const readOnly = this.isReadOnlyField(type, scripted);
    const helper =
      scripted?.instructions ??
      tableConfig?.helperText ??
      dateTimeConfig?.helperText ??
      fileConfig?.helperText ??
      selectConfig?.instructions;
    const { min, max, step, minExclusive, maxExclusive } = this.getSliderMeta(
      param,
      decimalPrecision,
      sliderUiPreferred
    );
    const defaultValue = (() => {
      if (type === FormFieldType.PASSWORD) {
        return "" as FormPrimitive;
      }
      if (param.type === ParameterType.GEOMETRY) {
        return "" as FormPrimitive;
      }
      if (type === FormFieldType.MULTI_SELECT) {
        return toArray(param.defaultValue) as FormPrimitive;
      }
      if (
        (type === FormFieldType.SWITCH || type === FormFieldType.CHECKBOX) &&
        toggleConfig
      ) {
        const normalizedDefault = normalizeToggleValue(param.defaultValue);
        if (
          normalizedDefault !== undefined &&
          toggleConfig.checkedValue !== undefined &&
          areToggleValuesEqual(normalizedDefault, toggleConfig.checkedValue)
        ) {
          return toggleConfig.checkedValue as FormPrimitive;
        }
        if (
          normalizedDefault !== undefined &&
          toggleConfig.uncheckedValue !== undefined &&
          areToggleValuesEqual(normalizedDefault, toggleConfig.uncheckedValue)
        ) {
          return toggleConfig.uncheckedValue as FormPrimitive;
        }
        const booleanDefault = toBooleanValue(param.defaultValue);
        if (booleanDefault !== undefined) {
          if (booleanDefault && toggleConfig.checkedValue !== undefined) {
            return toggleConfig.checkedValue as FormPrimitive;
          }
          if (!booleanDefault && toggleConfig.uncheckedValue !== undefined) {
            return toggleConfig.uncheckedValue as FormPrimitive;
          }
        }
        if (normalizedDefault !== undefined) {
          return normalizedDefault as FormPrimitive;
        }
        if (toggleConfig.uncheckedValue !== undefined) {
          return toggleConfig.uncheckedValue as FormPrimitive;
        }
        if (toggleConfig.checkedValue !== undefined) {
          return toggleConfig.checkedValue as FormPrimitive;
        }
      }
      return param.defaultValue as FormPrimitive;
    })();

    const promptValue =
      param.attributes && isPlainObject(param.attributes)
        ? (param.attributes as { [key: string]: unknown }).prompt
        : undefined;

    return {
      name: param.name,
      label: toStringValue(promptValue) || param.description || param.name,
      type,
      required: !param.optional,
      readOnly,
      description: toStringValue(promptValue) || param.description,
      defaultValue,
      placeholder: toStringValue(promptValue) || param.description || "",
      ...(options?.length && { options }),
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
      ...(toggleConfig && { toggleConfig }),
      ...(choiceSetConfig && { choiceSetConfig }),
      ...(visibility && { visibility }),
    };
  }

  // Mappar parameter-typ till UI-fälttyp
  private getFieldType(param: WorkspaceParameter): FormFieldType {
    // Direkt hantering av multi-select typer
    if (MULTI_SELECT_TYPES.has(param.type)) {
      return FormFieldType.MULTI_SELECT;
    }

    // Hantera valbara alternativ (choices)
    const choiceSettings = this.getChoiceSettings(param);
    const choices = choiceSettings?.choices;
    const hasOptions = Array.isArray(choices) && choices.length > 0;

    if (hasOptions) {
      // Bestäm om multi-select baserat på defaultValue
      const defaultIsArray = Array.isArray(param.defaultValue);
      return defaultIsArray ? FormFieldType.MULTI_SELECT : FormFieldType.SELECT;
    }

    // Typ-override via mappning
    const override = PARAMETER_FIELD_TYPE_MAP[param.type];
    if (override) return override;

    // Specifik hantering för text-typer med editor
    if (
      param.type === ParameterType.text ||
      param.type === ParameterType.TEXT
    ) {
      const editorValue =
        param.attributes && isPlainObject(param.attributes)
          ? (param.attributes as { [key: string]: unknown }).editor
          : undefined;
      const editor = toStringValue(editorValue);

      if (editor === "plaintext") {
        return FormFieldType.TEXTAREA;
      }

      if (editor === "url") {
        return FormFieldType.URL;
      }

      // Kontrollera valueType för stringEncoded
      const valueTypeValue =
        param.attributes && isPlainObject(param.attributes)
          ? (param.attributes as { [key: string]: unknown }).valueType
          : undefined;
      const valueType = toStringValue(valueTypeValue);
      if (valueType === "stringEncoded") {
        return FormFieldType.TEXTAREA;
      }
    }

    return FormFieldType.TEXT;
  }

  // Kontrollerar om fält ska vara read-only baserat på typ och config
  private isReadOnlyField(
    type: FormFieldType,
    scripted?: ScriptedFieldConfig
  ): boolean {
    if (type === FormFieldType.MESSAGE || type === FormFieldType.GEOMETRY) {
      return true;
    }
    if (type === FormFieldType.SCRIPTED) {
      const hasInteractiveNodes = Boolean(
        scripted?.allowManualEntry ||
          (scripted?.nodes && scripted.nodes.length > 0)
      );
      return !hasInteractiveNodes;
    }
    return false;
  }

  // Validerar formulärvärden mot fält-definitioner
  validateFormValues(
    values: { [key: string]: unknown },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    if (!values || !fields?.length) return { isValid: true, errors: {} };

    const errors: { [key: string]: string } = {};

    for (const field of fields) {
      const visibilityState = field.visibilityState;
      if (visibilityState && visibilityState !== "visibleEnabled") {
        continue;
      }
      const value = values[field.name];
      const hasValue = !isEmpty(value);

      if (field.type === FormFieldType.GEOMETRY) {
        continue;
      }

      if (field.type === FormFieldType.TEXT_OR_FILE) {
        const tf = value as TextOrFileValue | undefined;
        const hasText = isNonEmptyTrimmedString(tf?.text);
        const hasFile = isFileObject(tf?.file);
        if (field.required && !hasText && !hasFile) {
          errors[field.name] = "";
        }
        continue;
      }

      if (field.required && !hasValue) {
        errors[field.name] = "";
      } else if (
        hasValue &&
        (field.type === FormFieldType.NUMBER ||
          field.type === FormFieldType.NUMERIC_INPUT) &&
        !(isFiniteNumber(value) || isNumericString(value))
      ) {
        errors[field.name] = "";
        continue;
      }

      if (
        hasValue &&
        (field.type === FormFieldType.NUMBER ||
          field.type === FormFieldType.NUMERIC_INPUT ||
          field.type === FormFieldType.SLIDER)
      ) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          errors[field.name] = "";
          continue;
        }

        if (typeof field.min === "number") {
          const belowMin = field.minExclusive
            ? numericValue <= field.min
            : numericValue < field.min;
          if (belowMin) {
            errors[field.name] = "";
            continue;
          }
        }

        if (typeof field.max === "number") {
          const aboveMax = field.maxExclusive
            ? numericValue >= field.max
            : numericValue > field.max;
          if (aboveMax) {
            errors[field.name] = "";
            continue;
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
        const numericValue = Number(value);
        const precisionScale = Math.pow(10, field.decimalPrecision);
        if (Number.isFinite(precisionScale)) {
          const scaled = numericValue * precisionScale;
          const rounded = Math.round(scaled);
          if (Math.abs(scaled - rounded) > Number.EPSILON) {
            errors[field.name] = "";
          }
        } else {
          errors[field.name] = "";
        }
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors };
  }
}
