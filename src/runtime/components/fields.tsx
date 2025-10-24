/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx } from "jimu-core"
import {
  TagInput as JimuTagInput,
  MultiSelect,
  RichDisplayer,
  defaultMessages as jimuDefaultMessages,
} from "jimu-ui"
import { DatePicker as JimuDatePicker } from "jimu-ui/basic/date-picker"
import {
  Select,
  TextArea,
  Input,
  UrlInput,
  Checkbox,
  Switch,
  Radio,
  Slider,
  NumericInput,
  Button,
  ButtonTabs,
  Table,
  ColorPickerWrapper,
  Alert,
  useStyles as useUiStyles,
} from "./ui"
import {
  FormFieldType,
  FILE_UPLOAD,
  type DynamicFieldProps,
  type FormPrimitive,
  type SelectValue,
  type TextOrFileMode,
  type NormalizedTextOrFile,
  type TableColumnConfig,
  type FileFieldConfig,
  type FileValidationResult,
  type ToggleFieldConfig,
  type OptionItem,
  type UiStyles,
  type TranslateFn,
} from "../../config/index"
import { useUiStyles as useConfigStyles } from "../../config/style"
import defaultMessages from "./translations/default"
import {
  makePlaceholders,
  getTextPlaceholder,
  computeSelectCoerce,
  parseTableRows,
  fmeDateTimeToInput,
  inputToFmeDateTime,
  fmeDateToInput,
  inputToFmeDate,
  fmeTimeToInput,
  inputToFmeTime,
  normalizedRgbToHex,
  hexToNormalizedRgb,
  normalizeFormValue,
  isFileObject,
  getFileDisplayName,
  toTrimmedString,
  toStringValue,
  resolveMessageOrKey,
  toBooleanValue,
  areToggleValuesEqual,
  isNonEmptyTrimmedString,
  parseIsoLocalDateTime,
  formatIsoLocalDateTime,
  flattenHierarchicalOptions,
  styleCss,
  collectLayerAttributes,
  attributesToOptions,
} from "../../shared/utils"
import { useControlledValue } from "../../shared/hooks"

// Fälttyper som använder select/dropdown-komponenter
const SELECT_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  FormFieldType.SELECT,
  FormFieldType.COORDSYS,
  FormFieldType.ATTRIBUTE_NAME,
  FormFieldType.DB_CONNECTION,
  FormFieldType.WEB_CONNECTION,
  FormFieldType.REPROJECTION_FILE,
])

// Fälttyper som stödjer flera värden (array)
const MULTI_VALUE_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  FormFieldType.MULTI_SELECT,
  FormFieldType.ATTRIBUTE_LIST,
])

// Lägen för TEXT_OR_FILE-fält (text vs filuppladdning)
const TEXT_OR_FILE_MODES = {
  TEXT: "text" as const,
  FILE: "file" as const,
}

const toDisplayString = (value: unknown): string => toStringValue(value) ?? ""

const resolveToggleChecked = (
  current: unknown,
  config?: ToggleFieldConfig
): boolean => {
  if (config) {
    if (
      config.checkedValue !== undefined &&
      areToggleValuesEqual(current, config.checkedValue)
    ) {
      return true
    }
    if (
      config.uncheckedValue !== undefined &&
      areToggleValuesEqual(current, config.uncheckedValue)
    ) {
      return false
    }
  }

  const booleanCandidate = toBooleanValue(current)
  if (booleanCandidate !== undefined) {
    return booleanCandidate
  }

  if (typeof current === "number") {
    return current !== 0
  }

  if (typeof current === "string") {
    const trimmed = current.trim()
    if (!trimmed) return false
    if (trimmed === "0") return false
  }

  return Boolean(current)
}

const resolveToggleOutputValue = (
  checked: boolean,
  config?: ToggleFieldConfig
): FormPrimitive => {
  if (checked) {
    if (config?.checkedValue !== undefined) {
      return config.checkedValue as FormPrimitive
    }
    return true as FormPrimitive
  }
  if (config?.uncheckedValue !== undefined) {
    return config.uncheckedValue as FormPrimitive
  }
  return false as FormPrimitive
}

/* Hjälpfunktioner för rendering */

// Renderar textbaserade inmatningsfält med typvalidering
const renderTextInput = (
  inputType: "text" | "email" | "tel" | "search" | "password" | "number",
  value: FormPrimitive,
  placeholder: string,
  onChange: (value: FormPrimitive) => void,
  options: {
    readOnly?: boolean
    maxLength?: number
    overrides?: Partial<React.ComponentProps<typeof Input>>
  } = {}
): JSX.Element => {
  const { readOnly, maxLength, overrides } = options
  // Hanterar numerisk input med komma-till-punkt-konvertering
  const handleChange = (val: string) => {
    if (inputType === "number") {
      if (val === "") {
        onChange(null)
        return
      }
      const num = Number(val.replace(/,/g, "."))
      onChange(Number.isFinite(num) ? num : null)
    } else {
      onChange(val)
    }
  }

  // Konverterar värde till sträng för input
  const stringValue =
    typeof value === "string" || typeof value === "number" ? String(value) : ""

  // Kombinerar readOnly och overrides.disabled
  const finalDisabled =
    overrides && typeof overrides.disabled !== "undefined"
      ? overrides.disabled
      : readOnly

  return (
    <Input
      {...overrides}
      type={inputType === "number" ? "text" : inputType}
      value={stringValue}
      placeholder={placeholder}
      onChange={handleChange}
      disabled={finalDisabled}
      maxLength={maxLength}
    />
  )
}

// Renderar datum/tid-fält med HTML5-inputtyper
const renderDateTimeInput = (
  inputType: "date" | "time" | "month" | "week",
  value: FormPrimitive,
  placeholder: string,
  onChange: (value: FormPrimitive) => void,
  disabled?: boolean
): JSX.Element => (
  <Input
    type={inputType}
    value={toDisplayString(value)}
    placeholder={placeholder}
    onChange={(val) => {
      onChange(val as FormPrimitive)
    }}
    disabled={disabled}
  />
)

// Normaliserar TEXT_OR_FILE-värde till konsistent struktur
const normalizeTextOrFileValue = (
  rawValue: unknown,
  translate?: TranslateFn
): NormalizedTextOrFile => {
  if (
    rawValue &&
    typeof rawValue === "object" &&
    !Array.isArray(rawValue) &&
    "mode" in rawValue
  ) {
    const obj = rawValue as { [key: string]: unknown }
    if (obj.mode === TEXT_OR_FILE_MODES.FILE && isFileObject(obj.file)) {
      return {
        mode: TEXT_OR_FILE_MODES.FILE,
        file: obj.file,
        fileName:
          typeof obj.fileName === "string"
            ? obj.fileName
            : getFileDisplayName(obj.file, translate),
      }
    }
    if (obj.mode === TEXT_OR_FILE_MODES.TEXT) {
      return {
        mode: TEXT_OR_FILE_MODES.TEXT,
        text: toDisplayString(obj.text),
      }
    }
  }
  if (isFileObject(rawValue)) {
    return {
      mode: TEXT_OR_FILE_MODES.FILE,
      file: rawValue,
      fileName: getFileDisplayName(rawValue, translate),
    }
  }
  return {
    mode: TEXT_OR_FILE_MODES.TEXT,
    text: toDisplayString(rawValue),
  }
}

// Kontrollerar om värde är ett vanligt objekt (ej array/null)
const isPlainObject = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Normaliserar tabellrader från olika inputformat till enhetlig struktur
const normalizeTableRows = (
  raw: unknown,
  columns: readonly TableColumnConfig[]
): Array<{ [key: string]: unknown }> => {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (isPlainObject(item)) {
        const normalized: { [key: string]: unknown } = {}
        for (const col of columns) {
          normalized[col.key] =
            (item as { [key: string]: unknown })[col.key] ?? ""
        }
        return normalized
      }
      return { value: item }
    })
  }

  if (isNonEmptyTrimmedString(raw)) {
    const trimmed = raw.trim()
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return normalizeTableRows(parsed, columns)
      }
      return []
    } catch {
      return trimmed
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => ({ value: entry }))
    }
  }

  return []
}

// Skapar en ny tabellrad med standardvärden från kolumnkonfiguration
const prepareNewTableRow = (
  columns: readonly TableColumnConfig[]
): { [key: string]: unknown } => {
  const row: { [key: string]: unknown } = {}
  for (const column of columns) {
    row[column.key] =
      column.defaultValue !== undefined ? column.defaultValue : ""
  }
  return row
}

/* Filvalidering */

// Normaliserar accept-token (filtyp/MIME) till enhetligt format
const normalizeAcceptToken = (token: string): string | null => {
  const trimmed = toTrimmedString(token).toLowerCase()
  if (!trimmed) return null
  if (trimmed === "*/*" || trimmed.endsWith("/*") || trimmed.includes("/")) {
    return trimmed
  }
  if (trimmed.startsWith("*.")) {
    return `.${trimmed.slice(2)}`
  }
  if (trimmed.startsWith(".")) {
    return trimmed
  }
  return `.${trimmed.replace(/^\*+/, "")}`
}

// Bygger lista med accepterade filtyper från fältkonfiguration
const buildAcceptList = (config?: FileFieldConfig): readonly string[] => {
  if (!config?.accept?.length) return []
  return config.accept
    .map((token) => normalizeAcceptToken(token))
    .filter((token): token is string => Boolean(token))
}

// Validerar filstorlek och filtyp mot konfiguration
const validateFile = (
  file: File | null | undefined,
  config?: FileFieldConfig
): FileValidationResult => {
  if (!file) {
    return { valid: false, error: "fileInvalid" }
  }

  const acceptList = buildAcceptList(config)
  // Beräknar maximal tillåten filstorlek från konfiguration, maxSizeMb <= 0 stänger av storlekskontrollen
  const configuredMaxMb =
    typeof config?.maxSizeMb === "number" && Number.isFinite(config.maxSizeMb)
      ? config.maxSizeMb
      : undefined
  const effectiveMaxMb =
    configuredMaxMb === undefined
      ? FILE_UPLOAD.DEFAULT_MAX_SIZE_MB
      : configuredMaxMb > 0
        ? configuredMaxMb
        : undefined

  // Kontrollerar om filen överskrider storleksgränsen
  if (
    effectiveMaxMb !== undefined &&
    file.size > effectiveMaxMb * FILE_UPLOAD.ONE_MB_IN_BYTES
  ) {
    return {
      valid: false,
      error: "fileTooLarge",
      maxSizeMB: Math.floor(effectiveMaxMb),
    }
  }

  // Normaliserar filnamn och MIME-typ till gemener
  const fileNameLower = (file.name || "").toLowerCase()
  const fileTypeLower = (file.type || "").toLowerCase()

  // Validerar mot accept-listan om angiven
  if (acceptList.length) {
    const matchesAccept = acceptList.some((token) => {
      if (token === "*/*") return true
      if (token.endsWith("/*")) {
        const prefix = token.slice(0, token.length - 1)
        return fileTypeLower ? fileTypeLower.startsWith(prefix) : false
      }
      if (token.includes("/")) {
        return fileTypeLower ? fileTypeLower === token : false
      }
      return fileNameLower.endsWith(token)
    })

    if (!matchesAccept) {
      return { valid: false, error: "fileTypeNotAllowed" }
    }
  } else {
    // Använder standardvalidering om ingen accept-lista angavs
    const matchesDefaultExtension = FILE_UPLOAD.DEFAULT_ALLOWED_EXTENSIONS.some(
      (ext) => fileNameLower.endsWith(ext)
    )
    if (!matchesDefaultExtension) {
      return { valid: false, error: "fileTypeNotAllowed" }
    }

    if (!FILE_UPLOAD.DEFAULT_ALLOWED_MIME_TYPES.has(fileTypeLower)) {
      return { valid: false, error: "fileTypeNotAllowed" }
    }
  }

  return { valid: true }
}

// Extraherar läsbar sökväg/namn från FME dataset-metadata
const resolveFileDisplayValue = (
  raw: unknown,
  translate?: TranslateFn
): string | undefined => {
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    return trimmed || undefined
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw)
  }
  if (!raw) return undefined
  if (isFileObject(raw)) {
    return getFileDisplayName(raw, translate)
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const resolved = resolveFileDisplayValue(entry, translate)
      if (resolved) return resolved
    }
    return undefined
  }
  if (isPlainObject(raw)) {
    const obj = raw as { [key: string]: unknown }
    for (const key of FILE_UPLOAD.FILE_DISPLAY_KEYS) {
      if (key in obj) {
        const resolved = resolveFileDisplayValue(obj[key], translate)
        if (resolved) return resolved
      }
    }
  }
  return undefined
}

// ============================================
// Attribute Names Field (Added: Oct 24, 2025)
// ============================================

interface AttributeNamesFieldProps {
  readonly value: FormPrimitive
  readonly onChange: (value: FormPrimitive) => void
  readonly field: DynamicFieldProps["field"]
  readonly jimuMapView?: __esri.MapView | __esri.SceneView | null
  readonly translate?: TranslateFn
  readonly disabled?: boolean
  readonly placeholder?: string
}

const AttributeNamesField: React.FC<AttributeNamesFieldProps> = ({
  value,
  onChange,
  field,
  jimuMapView,
  translate,
  disabled,
  placeholder,
}) => {
  const [runtimeOptions, setRuntimeOptions] = React.useState<
    ReadonlyArray<{ readonly value: string; readonly label: string }>
  >([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Dynamically load attributes from map layers
  React.useEffect(() => {
    if (
      !field.choiceSetConfig ||
      field.choiceSetConfig.type !== "attributeNames"
    ) {
      return
    }

    if (!jimuMapView) {
      setError("No map view available")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = collectLayerAttributes(jimuMapView)
      const options = attributesToOptions(result)
      setRuntimeOptions(options)
      setLoading(false)
    } catch (err) {
      console.log("Failed to collect layer attributes", err)
      setError("Failed to load attributes")
      setLoading(false)
    }
  }, [field.choiceSetConfig, jimuMapView])

  // Merge static options (from field.options) with runtime discovered options
  const staticOptions = field.options || []
  const mergedOptions =
    runtimeOptions.length === 0
      ? staticOptions
      : (() => {
          const seen = new Set<string>()
          const combined: Array<{ value: string; label: string }> = []

          // Add static options first
          staticOptions.forEach((opt) => {
            const val = String(opt.value ?? "")
            if (val && !seen.has(val)) {
              seen.add(val)
              combined.push({ value: val, label: opt.label ?? val })
            }
          })

          // Add runtime options
          runtimeOptions.forEach((opt) => {
            if (!seen.has(opt.value)) {
              seen.add(opt.value)
              combined.push(opt)
            }
          })

          return combined
        })()

  if (error) {
    return (
      <Alert type="warning" withIcon>
        {error}
      </Alert>
    )
  }

  if (loading) {
    return (
      <Select
        value={value as SelectValue}
        options={[]}
        placeholder="Loading attributes..."
        disabled
        aria-label={field.label}
      />
    )
  }

  if (mergedOptions.length === 0) {
    // Fallback to text input if no options available
    return (
      <Input
        type="text"
        value={toDisplayString(value)}
        placeholder={placeholder || "Enter attribute name"}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const val = e.target.value
          onChange(val as FormPrimitive)
        }}
        disabled={disabled}
        aria-label={field.label}
      />
    )
  }

  const isSelectType = SELECT_FIELD_TYPES.has(field.type)
  const selectOptions = mergedOptions as ReadonlyArray<{
    readonly value?: unknown
  }>
  const selectCoerce = computeSelectCoerce(isSelectType, selectOptions)
  const selectConfig = field.selectConfig

  return (
    <Select
      value={value as SelectValue}
      options={mergedOptions}
      placeholder={placeholder || "Select attribute"}
      onChange={(val) => {
        onChange(val as FormPrimitive)
      }}
      aria-label={field.label}
      disabled={disabled}
      coerce={selectCoerce}
      allowSearch={selectConfig?.allowSearch ?? true}
      allowCustomValues={selectConfig?.allowCustomValues ?? true}
      hierarchical={selectConfig?.hierarchical}
    />
  )
}

/* Huvudkomponent för dynamiska formulärfält */

export const DynamicField: React.FC<DynamicFieldProps> = ({
  field,
  value,
  onChange,
  translate: translateProp,
  disabled: disabledProp,
  jimuMapView,
}) => {
  const fallbackTranslate = hooks.useTranslation(
    defaultMessages,
    jimuDefaultMessages
  )
  const translate = translateProp ?? fallbackTranslate
  const styles = useUiStyles()
  // Bestämmer om fältet är flervärdigt (multi-select, attribute list)
  const isMulti = MULTI_VALUE_FIELD_TYPES.has(field.type)
  // TEXT_OR_FILE kräver särskild hantering utan normalisering
  const bypassNormalization = field.type === FormFieldType.TEXT_OR_FILE
  const fieldValue = bypassNormalization
    ? value
    : normalizeFormValue(value, isMulti)
  const placeholders = makePlaceholders(translate, field.label)

  const isDisabled = Boolean(disabledProp || field.readOnly)

  // Felmeddelande för filvalidering
  const [fileError, setFileError] = React.useState<string | null>(null)

  // Kontrollerar om fältet är select-typ och hanterar single-option-fall
  const isSelectType =
    SELECT_FIELD_TYPES.has(field.type) ||
    MULTI_VALUE_FIELD_TYPES.has(field.type)
  const selectOptions = (field.options || []) as ReadonlyArray<{
    readonly value?: unknown
  }>
  const isSingleOption = isSelectType && !isMulti && selectOptions.length === 1
  const onlyVal = isSingleOption ? selectOptions[0]?.value : undefined

  // Tvingar värde till det enda tillgängliga alternativet om select har 1 val
  const enforceSingleOptionValue = hooks.useEventCallback(() => {
    if (onlyVal !== undefined) {
      const current = fieldValue as SelectValue
      if (!Object.is(current, onlyVal)) {
        onChange(onlyVal as FormPrimitive)
      }
    }
  })

  // Beräknar om select-värden kan tvingas till nummer (coerce)
  const selectCoerce = computeSelectCoerce(isSelectType, selectOptions)

  // Initialiserar fält med single-option till det värdet
  hooks.useEffectWithPreviousValues(() => {
    if (!isSingleOption || onlyVal === undefined) return
    const current = fieldValue as SelectValue
    const isUnset =
      current === undefined ||
      current === null ||
      (typeof current === "string" && !isNonEmptyTrimmedString(current))
    if (isUnset || !Object.is(current, onlyVal)) {
      onChange(onlyVal as FormPrimitive)
    }
  }, [isSingleOption, onlyVal, fieldValue, onChange])

  const renderHiddenField = (): JSX.Element => {
    // Dolt fält: behåll värde i form men rendera inget
    return <></>
  }

  const renderMessageField = (): JSX.Element => {
    // Renderar meddelande/instruktion som info-alert
    const message = field.description || field.label || ""
    if (!message.trim()) return <></>
    return <Alert type="info" withIcon open text={message} aria-live="polite" />
  }

  const renderTextBasedField = (): JSX.Element => {
    // Mappar fälttyp till HTML input-typ
    const inputTypeMap: {
      [key: string]: "text" | "email" | "tel" | "search" | "password"
    } = {
      [FormFieldType.PASSWORD]: "password",
      [FormFieldType.EMAIL]: "email",
      [FormFieldType.PHONE]: "tel",
      [FormFieldType.SEARCH]: "search",
      [FormFieldType.TEXT]: "text",
    }
    const inputType = inputTypeMap[field.type] || "text"
    // Bestämmer placeholder-typ baserat på fälttyp
    const placeholderType =
      field.type === FormFieldType.PHONE
        ? "phone"
        : field.type === FormFieldType.EMAIL
          ? "email"
          : field.type === FormFieldType.SEARCH
            ? "search"
            : undefined
    const placeholder =
      field.type === FormFieldType.PASSWORD
        ? getTextPlaceholder(field, placeholders, translate)
        : getTextPlaceholder(field, placeholders, translate, placeholderType)

    return renderTextInput(
      inputType,
      fieldValue as FormPrimitive,
      placeholder,
      onChange,
      {
        readOnly: isDisabled,
        maxLength: field.maxLength,
      }
    )
  }

  const renderNumberField = (): JSX.Element => {
    // Renderar numeriskt inmatningsfält
    return renderTextInput(
      "number",
      fieldValue as FormPrimitive,
      placeholders.enter,
      onChange,
      {
        readOnly: isDisabled,
      }
    )
  }

  const renderTextareaField = (): JSX.Element => {
    // Renderar flerradigt textfält
    return (
      <TextArea
        value={toDisplayString(fieldValue)}
        placeholder={placeholders.enter}
        onChange={(val) => {
          onChange(val as FormPrimitive)
        }}
        disabled={isDisabled}
        rows={field.rows}
      />
    )
  }

  const renderUrlField = (): JSX.Element => {
    const val = toDisplayString(fieldValue)
    return (
      <UrlInput
        value={val}
        placeholder={field.placeholder || placeholders.enter}
        onChange={(v) => {
          if (isDisabled) return
          onChange(v)
        }}
      />
    )
  }

  const renderTableField = (): JSX.Element => {
    const tableConfig = field.tableConfig
    // Enkel tabellrad-vy om inga kolumner konfigurerats
    if (!tableConfig?.columns?.length) {
      const rows = parseTableRows(value)

      const updateRow = (idx: number, val: string) => {
        if (isDisabled) return
        const next = [...rows]
        next[idx] = val
        onChange(next as unknown as FormPrimitive)
      }

      const addRow = () => {
        if (isDisabled) return
        onChange([...(rows || []), ""] as unknown as FormPrimitive)
      }

      const removeRow = (idx: number) => {
        if (isDisabled) return
        const next = rows.filter((_, i) => i !== idx)
        onChange(next as unknown as FormPrimitive)
      }

      return (
        <div data-testid="table-field">
          {rows.length === 0 ? (
            <div>{translate("msgTableEmpty")}</div>
          ) : (
            <Table responsive hover aria-label={field.label}>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <Input
                        type="text"
                        value={r}
                        placeholder={field.placeholder || placeholders.enter}
                        onChange={(val) => {
                          const s = typeof val === "string" ? val : ""
                          updateRow(i, s)
                        }}
                        disabled={isDisabled}
                      />
                    </td>
                    <td>
                      <Button
                        text={translate("btnDeleteRow")}
                        variant="text"
                        type="tertiary"
                        onClick={() => {
                          removeRow(i)
                        }}
                        aria-label={translate("btnDeleteRow")}
                        disabled={isDisabled}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Button
            text={translate("btnAddRow")}
            variant="outlined"
            onClick={addRow}
            aria-label={translate("btnAddRow")}
            disabled={isDisabled}
          />
        </div>
      )
    }

    // Normaliserar kolumner från config eller använder standardkolumn
    const columns =
      tableConfig.columns && tableConfig.columns.length
        ? tableConfig.columns
        : [
            {
              key: "value",
              label: field.label || translate("lblColumnDefault"),
              type: "text" as const,
            },
          ]

    // Normaliserar och hämtar konfigurerbara tabellbegränsningar
    const rows = normalizeTableRows(value, columns).map((row, index) => ({
      ...row,
      __rowId: `${field.name}-row-${index}-${Date.now()}`,
    }))
    const minRows = tableConfig?.minRows ?? 0
    const maxRows = tableConfig?.maxRows
    const allowReorder = tableConfig?.allowReorder ?? false
    const showHeader = tableConfig?.showHeader ?? true
    const addLabel = tableConfig?.addRowLabel || translate("btnAddRow")
    const removeLabel = tableConfig?.removeRowLabel || translate("btnDeleteRow")

    // Bestämmer om användaren kan lägga till/ta bort rader
    const canRemove = !isDisabled && rows.length > minRows
    const canAddRow =
      !isDisabled && (maxRows === undefined || rows.length < maxRows)

    // Uppdaterar en cells värde i en specifik rad
    const handleCellChange = (
      rowIndex: number,
      columnKey: string,
      newValue: unknown
    ) => {
      if (isDisabled) return
      const next = rows.map((row, idx) =>
        idx === rowIndex ? { ...row, [columnKey]: newValue } : row
      )
      onChange(next as unknown as FormPrimitive)
    }

    // Lägger till ny tabellrad med standardvärden
    const handleAddRow = () => {
      if (!canAddRow) return
      const nextRow = prepareNewTableRow(columns)
      onChange([...rows, nextRow] as unknown as FormPrimitive)
    }

    // Tar bort rad från tabell
    const handleRemoveRow = (rowIndex: number) => {
      if (isDisabled || !canRemove) return
      const next = rows.filter((_, idx) => idx !== rowIndex)
      onChange(next as unknown as FormPrimitive)
    }

    // Flyttar rad uppåt eller nedåt i tabell
    const handleMoveRow = (rowIndex: number, direction: -1 | 1) => {
      if (isDisabled) return
      const target = rowIndex + direction
      if (target < 0 || target >= rows.length) return
      const next = [...rows]
      const [moved] = next.splice(rowIndex, 1)
      next.splice(target, 0, moved)
      onChange(next as unknown as FormPrimitive)
    }

    // Renderar enskild tabellcell baserat på kolumntyp
    const renderCell = (
      column: TableColumnConfig,
      rowIndex: number,
      rowValue: { [key: string]: unknown }
    ) => {
      const cellValue = rowValue[column.key]
      const disabled = isDisabled || column.readOnly
      const placeholder =
        column.placeholder || field.placeholder || placeholders.enter

      switch (column.type) {
        case "number":
          return (
            <Input
              type="number"
              value={toDisplayString(cellValue)}
              onChange={(val) => {
                const numVal =
                  val === "" ? null : Number((val as string).replace(/,/g, "."))
                handleCellChange(
                  rowIndex,
                  column.key,
                  Number.isFinite(numVal) ? numVal : null
                )
              }}
              disabled={disabled}
              placeholder={placeholder}
            />
          )
        case "select":
          return (
            <Select
              value={cellValue as SelectValue}
              options={column.options || []}
              placeholder={placeholder}
              onChange={(val) => {
                handleCellChange(rowIndex, column.key, val as FormPrimitive)
              }}
              disabled={disabled}
            />
          )
        case "boolean":
          return (
            <Checkbox
              checked={Boolean(cellValue)}
              onChange={(evt) => {
                handleCellChange(rowIndex, column.key, evt.target.checked)
              }}
              disabled={disabled}
              aria-label={column.label}
            />
          )
        case "date":
          return (
            <Input
              type="date"
              value={toDisplayString(cellValue)}
              onChange={(val) => {
                handleCellChange(rowIndex, column.key, val as FormPrimitive)
              }}
              disabled={disabled}
              placeholder={placeholder}
            />
          )
        case "time":
          return (
            <Input
              type="time"
              value={toDisplayString(cellValue)}
              onChange={(val) => {
                handleCellChange(rowIndex, column.key, val as FormPrimitive)
              }}
              disabled={disabled}
            />
          )
        case "datetime":
          return (
            <DateTimePickerWrapper
              value={toDisplayString(cellValue)}
              onChange={(val) => {
                handleCellChange(rowIndex, column.key, val as FormPrimitive)
              }}
              disabled={disabled}
              aria-label={column.label}
            />
          )
        default:
          return (
            <Input
              type="text"
              value={toDisplayString(cellValue)}
              onChange={(val) => {
                handleCellChange(rowIndex, column.key, val as FormPrimitive)
              }}
              disabled={disabled}
              placeholder={placeholder}
            />
          )
      }
    }

    return (
      <div data-testid="table-field">
        {rows.length === 0 ? (
          <div>{translate("msgTableEmpty")}</div>
        ) : (
          <Table responsive hover aria-label={field.label}>
            {showHeader ? (
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                  <th>{translate("lblActions")}</th>
                </tr>
              </thead>
            ) : null}
            <tbody>
              {rows.map((row) => (
                <tr key={row.__rowId || `fallback-${Math.random()}`}>
                  {columns.map((column) => (
                    <td key={`${row.__rowId}-${column.key}`}>
                      {renderCell(
                        column,
                        rows.findIndex((r) => r.__rowId === row.__rowId),
                        row
                      )}
                    </td>
                  ))}
                  <td>
                    <Button
                      text={removeLabel}
                      variant="text"
                      type="tertiary"
                      onClick={() => {
                        handleRemoveRow(
                          rows.findIndex((r) => r.__rowId === row.__rowId)
                        )
                      }}
                      aria-label={removeLabel}
                      disabled={!canRemove}
                    />
                    {allowReorder ? (
                      <React.Fragment>
                        <Button
                          text={translate("btnMoveUp")}
                          variant="text"
                          type="tertiary"
                          onClick={() => {
                            handleMoveRow(
                              rows.findIndex((r) => r.__rowId === row.__rowId),
                              -1
                            )
                          }}
                          aria-label={translate("btnMoveUp")}
                          disabled={
                            isDisabled ||
                            rows.findIndex((r) => r.__rowId === row.__rowId) ===
                              0
                          }
                        />
                        <Button
                          text={translate("btnMoveDown")}
                          variant="text"
                          type="tertiary"
                          onClick={() => {
                            handleMoveRow(
                              rows.findIndex((r) => r.__rowId === row.__rowId),
                              1
                            )
                          }}
                          aria-label={translate("btnMoveDown")}
                          disabled={
                            isDisabled ||
                            rows.findIndex((r) => r.__rowId === row.__rowId) ===
                              rows.length - 1
                          }
                        />
                      </React.Fragment>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Button
          text={addLabel}
          variant="outlined"
          onClick={() => {
            handleAddRow()
          }}
          aria-label={addLabel}
          disabled={!canAddRow}
        />
      </div>
    )
  }

  const renderSelectField = (): JSX.Element => {
    // Hanterar select-fält med dynamiska alternativ (COORDSYS, DB_CONNECTION, etc.)
    const options = field.options || []
    const selectConfig = field.selectConfig

    // Fallback till textinput om inga alternativ finns
    if (options.length === 0) {
      return renderTextInput(
        "text",
        fieldValue as FormPrimitive,
        placeholders.enter,
        onChange,
        {
          readOnly: isDisabled,
        }
      )
    }

    // Renderar read-only textfält när endast ett alternativ finns
    if (isSingleOption) {
      const soleOption = selectOptions[0] as {
        readonly label?: string
        readonly value?: unknown
      }
      const resolvedLabel = toTrimmedString(
        resolveMessageOrKey(soleOption?.label || "", translate)
      )
      const displayValue =
        resolvedLabel || toTrimmedString(soleOption?.value) || ""

      return renderTextInput(
        "text",
        displayValue,
        placeholders.select,
        enforceSingleOptionValue,
        {
          readOnly: true,
          overrides: {
            readOnly: true,
            disabled: true,
          },
        }
      )
    }

    return (
      <Select
        value={fieldValue as SelectValue}
        options={options}
        placeholder={placeholders.select}
        onChange={(val) => {
          onChange(val as FormPrimitive)
        }}
        aria-label={field.label}
        disabled={isDisabled}
        coerce={selectCoerce}
        allowSearch={selectConfig?.allowSearch}
        allowCustomValues={selectConfig?.allowCustomValues}
        hierarchical={selectConfig?.hierarchical}
      />
    )
  }

  const renderAttributeNamesField = (): JSX.Element => {
    // Use AttributeNamesField for runtime attribute discovery
    return (
      <AttributeNamesField
        value={fieldValue}
        onChange={onChange}
        field={field}
        jimuMapView={jimuMapView}
        translate={translate}
        disabled={isDisabled}
        placeholder={placeholders.select}
      />
    )
  }

  const renderDateTimeField = (): JSX.Element => {
    // Renderar lokal datetime (utan sekunder), lagrar som FME datetime-sträng
    const val =
      typeof fieldValue === "string" ? fmeDateTimeToInput(fieldValue) : ""
    return (
      <DateTimePickerWrapper
        value={val}
        onChange={(v) => {
          const original =
            typeof fieldValue === "string" ? fieldValue : undefined
          const out = inputToFmeDateTime(v, original)
          onChange(out as FormPrimitive)
        }}
        disabled={isDisabled}
      />
    )
  }

  const renderMultiSelectField = (): JSX.Element => {
    // Renderar multi-select för flera val
    const options = field.options || []
    const values = Array.isArray(fieldValue)
      ? (fieldValue as ReadonlyArray<string | number>)
      : []
    const selectConfig = field.selectConfig
    return (
      <MultiSelectControl
        options={options}
        values={[...values] as Array<string | number>}
        placeholder={placeholders.select}
        disabled={isDisabled}
        onChange={(vals) => {
          onChange(vals as unknown as FormPrimitive)
        }}
        allowSearch={selectConfig?.allowSearch}
        hierarchical={selectConfig?.hierarchical}
      />
    )
  }

  const renderToggleField = (): JSX.Element => {
    const toggleConfig = field.toggleConfig
    const rawValue =
      value !== undefined && value !== null && value !== ""
        ? value
        : field.defaultValue
    const isChecked = resolveToggleChecked(rawValue, toggleConfig)

    const handleToggleChange = (checked: boolean) => {
      if (isDisabled) return
      const nextValue = resolveToggleOutputValue(checked, toggleConfig)
      onChange(nextValue)
    }

    if (field.type === FormFieldType.CHECKBOX) {
      return (
        <Checkbox
          checked={isChecked}
          onChange={(evt) => {
            handleToggleChange(evt.target.checked)
          }}
          disabled={isDisabled}
          aria-label={field.label}
        />
      )
    }

    return (
      <Switch
        checked={isChecked}
        onChange={(_evt, checked) => {
          handleToggleChange(checked)
        }}
        disabled={isDisabled}
        aria-label={field.label}
      />
    )
  }

  const renderFileField = (): JSX.Element => {
    // Renderar filuppladdningsfält med validering
    const selectedFile = isFileObject(value) ? value : null
    const acceptTokens = buildAcceptList(field.fileConfig)
    const acceptAttr = acceptTokens.length ? acceptTokens.join(",") : undefined
    const resolvedDefault = !selectedFile
      ? (resolveFileDisplayValue(value, translate) ??
        resolveFileDisplayValue(fieldValue, translate) ??
        resolveFileDisplayValue(field.defaultValue, translate))
      : resolveFileDisplayValue(field.defaultValue, translate)
    const defaultDisplay = toTrimmedString(resolvedDefault) || ""
    const displayText = selectedFile
      ? getFileDisplayName(selectedFile, translate)
      : defaultDisplay
    const hasDisplay = Boolean(displayText)
    const message = hasDisplay ? displayText : null

    // Hanterar filändring och validerar fil
    const handleFileChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
      if (isDisabled) {
        evt.target.value = ""
        return
      }
      const files = evt.target.files
      const file = files && files.length > 0 ? files[0] : null

      if (!file) {
        setFileError(null)
        onChange(null)
        return
      }

      const validation = validateFile(file, field.fileConfig)
      if (!validation.valid) {
        setFileError(
          validation.error === "fileTooLarge"
            ? translate("errFileLarge", { maxSize: validation.maxSizeMB })
            : validation.error === "fileTypeNotAllowed"
              ? translate("errFileType")
              : translate("errFileInvalid")
        )
        evt.target.value = ""
        return
      }

      setFileError(null)
      onChange(file)
    }

    return (
      <div>
        <Input
          type="file"
          accept={acceptAttr}
          onFileChange={handleFileChange}
          disabled={isDisabled}
          aria-label={field.label}
        />
        {fileError ? (
          <div
            css={styles.typo.errorMessage}
            data-testid="file-field-error"
            role="alert"
          >
            {fileError}
          </div>
        ) : null}
        {message && !fileError ? (
          <div
            data-testid="file-field-display"
            aria-live="polite"
            css={styles.typo.hint}
          >
            {message}
          </div>
        ) : null}
      </div>
    )
  }

  const renderTextOrFileField = (): JSX.Element => {
    // Renderar fält med växel mellan text- och filuppladdningsläge
    const currentValue: NormalizedTextOrFile = normalizeTextOrFileValue(
      fieldValue,
      translate
    )
    const resolvedMode: TextOrFileMode =
      currentValue.mode === TEXT_OR_FILE_MODES.FILE
        ? TEXT_OR_FILE_MODES.FILE
        : TEXT_OR_FILE_MODES.TEXT
    const acceptTokens = buildAcceptList(field.fileConfig)
    const acceptAttr = acceptTokens.length ? acceptTokens.join(",") : undefined

    // Växlar mellan text- och filläge
    const handleModeChange = (nextMode: TextOrFileMode) => {
      if (isDisabled) return
      if (nextMode === TEXT_OR_FILE_MODES.FILE) {
        onChange({
          mode: TEXT_OR_FILE_MODES.FILE,
          file: isFileObject(currentValue.file) ? currentValue.file : null,
          fileName: currentValue.fileName,
        } as unknown as FormPrimitive)
      } else {
        onChange({
          mode: TEXT_OR_FILE_MODES.TEXT,
          text: toDisplayString(currentValue.text),
        } as unknown as FormPrimitive)
      }
    }

    // Uppdaterar textlägets värde
    const handleTextChange = (val: string) => {
      if (isDisabled) return
      onChange({
        mode: TEXT_OR_FILE_MODES.TEXT,
        text: val,
      } as unknown as FormPrimitive)
    }

    // Hanterar filuppladdning i TEXT_OR_FILE-läge
    const handleFileChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
      if (isDisabled) {
        evt.target.value = ""
        return
      }
      const files = evt.target.files
      const file = files && files.length > 0 ? files[0] : null

      if (!file) {
        setFileError(null)
        onChange({
          mode: TEXT_OR_FILE_MODES.FILE,
          file: null,
          fileName: undefined,
        } as unknown as FormPrimitive)
        return
      }

      const validation = validateFile(file, field.fileConfig)
      if (!validation.valid) {
        setFileError(
          validation.error === "fileTooLarge"
            ? translate("errFileLarge", { maxSize: validation.maxSizeMB })
            : validation.error === "fileTypeNotAllowed"
              ? translate("errFileType")
              : translate("errFileInvalid")
        )
        evt.target.value = ""
        return
      }

      setFileError(null)
      onChange({
        mode: TEXT_OR_FILE_MODES.FILE,
        file,
        fileName: getFileDisplayName(file, translate),
      } as unknown as FormPrimitive)
    }

    return (
      <>
        <ButtonTabs
          items={[
            {
              value: TEXT_OR_FILE_MODES.TEXT,
              label: translate("lblTextInput"),
            },
            {
              value: TEXT_OR_FILE_MODES.FILE,
              label: translate("lblFileInput"),
            },
          ]}
          value={resolvedMode}
          onChange={(val) => {
            handleModeChange(val as TextOrFileMode)
          }}
          ariaLabel={field.label}
        />
        {resolvedMode === TEXT_OR_FILE_MODES.TEXT ? (
          <TextArea
            value={toDisplayString(currentValue.text)}
            placeholder={field.placeholder || placeholders.enter}
            onChange={handleTextChange}
            disabled={isDisabled}
            rows={field.rows}
          />
        ) : (
          <div>
            <Input
              type="file"
              accept={acceptAttr}
              onFileChange={handleFileChange}
              disabled={isDisabled}
              aria-label={field.label}
            />
            {fileError ? (
              <div
                css={styles.typo.errorMessage}
                data-testid="text-or-file-error"
                role="alert"
              >
                {fileError}
              </div>
            ) : null}
            {isFileObject(currentValue.file) && !fileError ? (
              <div data-testid="text-or-file-name">
                {currentValue.fileName ||
                  getFileDisplayName(currentValue.file, translate)}
              </div>
            ) : null}
          </div>
        )}
      </>
    )
  }

  const renderScriptedField = (): JSX.Element => {
    // Renderar skriptgenererat innehåll som rich text
    const content = isNonEmptyTrimmedString(fieldValue)
      ? fieldValue
      : toDisplayString(field.defaultValue) || field.description || field.label
    return <RichText html={content || ""} />
  }

  const renderRadioField = (): JSX.Element => {
    // Renderar radioknappsgrupp med coerce-stöd
    const options = field.options || []
    const coerce = computeSelectCoerce(true, options)
    const stringValue =
      fieldValue === null || fieldValue === undefined
        ? undefined
        : String(fieldValue)

    const handleChange = (raw: string) => {
      if (coerce === "number") {
        const nextNumber = Number(raw)
        if (Number.isFinite(nextNumber)) {
          onChange(nextNumber as FormPrimitive)
        } else {
          const matchingOption = options.find(
            (opt) => String(opt.value) === raw
          )
          onChange(matchingOption?.value ?? raw)
        }
        return
      }
      onChange(raw as FormPrimitive)
    }

    return (
      <Radio
        options={options.map((opt) => ({
          label: opt.label,
          value: String(opt.value),
        }))}
        value={stringValue}
        onChange={handleChange}
        disabled={isDisabled}
        aria-label={field.label}
      />
    )
  }

  const renderGeometryField = (): JSX.Element => {
    // Renderar geometri (AOI polygon) med statistik
    const trimmed = toDisplayString(fieldValue).trim()
    if (!trimmed) {
      return (
        <div css={styles.typo.hint} data-testid="geometry-field">
          {translate("msgNoGeometry")}
        </div>
      )
    }

    // Parsar geometri och beräknar statistik (ringar, hörn)
    let rings = 0
    let vertices = 0
    let preview = trimmed
    let parseError = false

    try {
      const parsed = JSON.parse(trimmed)
      const parsedRings = Array.isArray(parsed?.rings) ? parsed.rings : []
      rings = parsedRings.length
      vertices = parsedRings.reduce((count, ring) => {
        return (
          count + (Array.isArray(ring) ? ring.filter(Array.isArray).length : 0)
        )
      }, 0)
      preview = JSON.stringify(parsed, null, 2)
    } catch {
      parseError = true
    }

    // Trunkerar för lång geometri-JSON
    const truncated =
      preview.length > FILE_UPLOAD.GEOMETRY_PREVIEW_MAX_LENGTH
        ? `${preview.slice(0, FILE_UPLOAD.GEOMETRY_PREVIEW_MAX_LENGTH)}…`
        : preview

    return (
      <div data-testid="geometry-field">
        <div css={styles.typo.hint}>
          {parseError
            ? translate("errGeomParse")
            : translate("msgGeomReady", {
                rings,
                vertices,
              })}
        </div>
        {truncated ? (
          <pre aria-label={translate("ariaGeomPreview")}>{truncated}</pre>
        ) : null}
      </div>
    )
  }

  const renderSliderField = (): JSX.Element => {
    // Renderar slider-kontroll med min/max/step och aktuell värdeetikett
    const numericValue =
      typeof fieldValue === "number"
        ? fieldValue
        : isNonEmptyTrimmedString(fieldValue)
          ? Number(fieldValue.trim())
          : typeof field.defaultValue === "number"
            ? field.defaultValue
            : (field.min ?? 0)
    const safeValue = Number.isFinite(numericValue)
      ? numericValue
      : (field.min ?? 0)
    const precision =
      typeof field.decimalPrecision === "number" && field.decimalPrecision >= 0
        ? field.decimalPrecision
        : undefined
    return (
      <Slider
        value={safeValue}
        min={field.min ?? 0}
        max={field.max ?? 100}
        step={field.step ?? 1}
        decimalPrecision={precision}
        onChange={(value) => {
          onChange(value)
        }}
        disabled={isDisabled}
        aria-label={field.label}
      />
    )
  }

  const renderNumericInputField = (): JSX.Element => {
    // Renderar numerisk input med precision och begränsningar
    const numericValue =
      typeof fieldValue === "number"
        ? fieldValue
        : isNonEmptyTrimmedString(fieldValue)
          ? Number(fieldValue.trim())
          : undefined
    const defaultNumeric =
      numericValue === undefined && typeof field.defaultValue === "number"
        ? field.defaultValue
        : undefined
    const precision =
      typeof field.decimalPrecision === "number" && field.decimalPrecision >= 0
        ? field.decimalPrecision
        : 2

    // Validera numerisk input och generera felmeddelande
    let validationError: string | null = null
    if (numericValue !== undefined && Number.isFinite(numericValue)) {
      // Kontrollera om decimaltal är tillåtet (precision = 0 => endast heltal)
      if (precision === 0) {
        const hasDecimals = numericValue % 1 !== 0
        if (hasDecimals) {
          validationError = translate("valIntegerOnly")
        }
      }

      // Kontrollera min-begränsning
      if (!validationError && typeof field.min === "number") {
        const belowMin = field.minExclusive
          ? numericValue <= field.min
          : numericValue < field.min
        if (belowMin) {
          validationError = field.minExclusive
            ? translate("valGreaterThan", { value: field.min })
            : translate("valAtLeast", { value: field.min })
        }
      }

      // Kontrollera max-begränsning
      if (!validationError && typeof field.max === "number") {
        const aboveMax = field.maxExclusive
          ? numericValue >= field.max
          : numericValue > field.max
        if (aboveMax) {
          validationError = field.maxExclusive
            ? translate("valLessThan", { value: field.max })
            : translate("valAtMost", { value: field.max })
        }
      }
    }

    const numericProps =
      numericValue === undefined && defaultNumeric !== undefined
        ? { defaultValue: defaultNumeric }
        : { value: numericValue }

    return (
      <div>
        <NumericInput
          {...numericProps}
          placeholder={field.placeholder || placeholders.enter}
          min={field.min}
          max={field.max}
          step={field.step}
          precision={precision}
          disabled={isDisabled}
          aria-label={field.label}
          aria-invalid={!!validationError}
          aria-describedby={validationError ? `${field.name}-error` : undefined}
          onChange={(value) => {
            if (value === undefined) {
              onChange(null)
              return
            }
            onChange(value)
          }}
        />
        {validationError && (
          <div
            id={`${field.name}-error`}
            css={styles.typo.errorMessage}
            role="alert"
            data-testid="numeric-input-error"
          >
            {validationError}
          </div>
        )}
      </div>
    )
  }

  const renderTagInputField = (): JSX.Element => {
    // Renderar tag-input för array av strängar
    const values = Array.isArray(fieldValue) ? (fieldValue as string[]) : []
    return (
      <TagInput
        value={values}
        placeholder={field.placeholder || translate("phTags")}
        onChange={(values) => {
          if (isDisabled) return
          onChange(values as FormPrimitive)
        }}
      />
    )
  }

  const renderColorField = (): JSX.Element => {
    // Renderar färgväljare; lagrar normaliserade RGB-värden
    const colorConfig = field.colorConfig
    const initial =
      typeof fieldValue === "string"
        ? normalizedRgbToHex(fieldValue, colorConfig) || fieldValue
        : undefined
    const val =
      typeof initial === "string" && initial.startsWith("#")
        ? initial
        : "#000000"
    return (
      <ColorPickerWrapper
        value={val}
        onChange={(color) => {
          if (isDisabled) return
          const normalized = hexToNormalizedRgb(color, colorConfig) || color
          onChange(normalized as FormPrimitive)
        }}
      />
    )
  }

  const renderDateField = (): JSX.Element => {
    // Renderar datumväljare (utan tid), lagrar som FME date-sträng
    const val = typeof fieldValue === "string" ? fmeDateToInput(fieldValue) : ""
    const isoValue = val ? `${val}T00:00:00` : ""
    return (
      <DateTimePickerWrapper
        mode="date"
        value={isoValue}
        onChange={(dateTime) => {
          const raw = typeof dateTime === "string" ? dateTime : ""
          const datePart = raw.split("T")[0] || ""
          const out = inputToFmeDate(datePart)
          onChange(out as FormPrimitive)
        }}
        aria-label={field.label}
        disabled={isDisabled}
      />
    )
  }

  const renderMonthWeekField = (): JSX.Element => {
    // Renderar månad/vecka-väljare med HTML5-inputtyp
    const inputType = field.type === FormFieldType.MONTH ? "month" : "week"
    return renderDateTimeInput(
      inputType,
      fieldValue as FormPrimitive,
      getTextPlaceholder(field, placeholders, translate),
      onChange,
      isDisabled
    )
  }

  const renderTimeField = (): JSX.Element => {
    // Renderar tidsväljare, lagrar som FME time-sträng
    const val = typeof fieldValue === "string" ? fmeTimeToInput(fieldValue) : ""
    return (
      <Input
        type="time"
        value={val}
        onChange={(value) => {
          const original =
            typeof fieldValue === "string" ? fieldValue : undefined
          const out = inputToFmeTime(value as string, original)
          onChange(out as FormPrimitive)
        }}
        disabled={isDisabled}
      />
    )
  }

  // Main render dispatch function
  const renderByType = (): JSX.Element => {
    switch (field.type) {
      case FormFieldType.HIDDEN:
        return renderHiddenField()
      case FormFieldType.MESSAGE:
        return renderMessageField()
      case FormFieldType.TEXT:
      case FormFieldType.PASSWORD:
      case FormFieldType.EMAIL:
      case FormFieldType.PHONE:
      case FormFieldType.SEARCH:
        return renderTextBasedField()
      case FormFieldType.NUMBER:
        return renderNumberField()
      case FormFieldType.TEXTAREA:
        return renderTextareaField()
      case FormFieldType.URL:
        return renderUrlField()
      case FormFieldType.TABLE:
        return renderTableField()
      case FormFieldType.COORDSYS:
      case FormFieldType.DB_CONNECTION:
      case FormFieldType.WEB_CONNECTION:
      case FormFieldType.REPROJECTION_FILE:
      case FormFieldType.SELECT:
        return renderSelectField()
      case FormFieldType.ATTRIBUTE_NAME:
      case FormFieldType.ATTRIBUTE_LIST:
        return renderAttributeNamesField()
      case FormFieldType.DATE_TIME:
        return renderDateTimeField()
      case FormFieldType.MULTI_SELECT:
        return renderMultiSelectField()
      case FormFieldType.CHECKBOX:
      case FormFieldType.SWITCH:
        return renderToggleField()
      case FormFieldType.FILE:
        return renderFileField()
      case FormFieldType.TEXT_OR_FILE:
        return renderTextOrFileField()
      case FormFieldType.SCRIPTED:
        return renderScriptedField()
      case FormFieldType.RADIO:
        return renderRadioField()
      case FormFieldType.GEOMETRY:
        return renderGeometryField()
      case FormFieldType.SLIDER:
        return renderSliderField()
      case FormFieldType.NUMERIC_INPUT:
        return renderNumericInputField()
      case FormFieldType.TAG_INPUT:
        return renderTagInputField()
      case FormFieldType.COLOR:
        return renderColorField()
      case FormFieldType.DATE:
        return renderDateField()
      case FormFieldType.MONTH:
      case FormFieldType.WEEK:
        return renderMonthWeekField()
      case FormFieldType.TIME:
        return renderTimeField()
    }
  }

  return renderByType()
}

// ============================================================================
// Form-Specific UI Components (moved from ui.tsx)
// ============================================================================

// Local helpers for moved components
const useStyles = (): UiStyles => useConfigStyles()
const useValue = useControlledValue

const applyComponentStyles = (base: any[], customStyle?: React.CSSProperties) =>
  [...base, styleCss(customStyle)].filter(Boolean)

const applyFullWidthStyles = (
  styles: UiStyles,
  customStyle?: React.CSSProperties
) => applyComponentStyles([styles.fullWidth], customStyle)

// TagInput component
export const TagInput: React.FC<{
  value?: string[]
  suggestions?: string[]
  placeholder?: string
  onChange?: (values: string[]) => void
  style?: React.CSSProperties
}> = ({ value, suggestions, placeholder, onChange, style }) => {
  const styles = useStyles()
  return (
    <JimuTagInput
      values={value}
      suggestions={suggestions}
      placeholder={placeholder}
      onChange={(vals) => {
        onChange?.(vals)
      }}
      css={applyFullWidthStyles(styles, style)}
    />
  )
}

// DateTimePicker component
export const DateTimePickerWrapper: React.FC<{
  value?: string // ISO lokal: YYYY-MM-DDTHH:mm:ss eller FME: YYYY-MM-DD HH:mm:ss
  defaultValue?: string
  onChange?: (dateTime: string) => void
  style?: React.CSSProperties
  disabled?: boolean
  "aria-label"?: string
  mode?: "date-time" | "date"
  format?: "iso" | "fme" // Utdataformat: iso (standard) eller fme (mellanslag)
}> = ({
  value,
  defaultValue,
  onChange,
  style,
  disabled,
  "aria-label": ariaLabel,
  mode = "date-time",
  format = "iso",
}) => {
  const styles = useStyles()
  const [currentValue, setCurrentValue] = useValue(
    value,
    defaultValue,
    onChange
  )

  // Bygger fallback-datum beroende på läge
  const buildFallbackDate = () => {
    const base = new Date()
    if (mode === "date") base.setHours(0, 0, 0, 0)
    return base
  }
  const fallbackDateRef = React.useRef<Date>(buildFallbackDate())

  hooks.useUpdateEffect(() => {
    fallbackDateRef.current = buildFallbackDate()
  }, [mode])

  const fallbackDate = fallbackDateRef.current

  const selectedDate =
    parseIsoLocalDateTime(currentValue) ||
    parseIsoLocalDateTime(defaultValue) ||
    fallbackDate

  const handleChange = hooks.useEventCallback(
    (rawValue: any, _label: string) => {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        const next = new Date(rawValue)
        if (mode === "date") next.setHours(0, 0, 0, 0)
        setCurrentValue(formatIsoLocalDateTime(next, format))
        return
      }

      if (rawValue instanceof Date) {
        const next = new Date(rawValue.getTime())
        if (mode === "date") next.setHours(0, 0, 0, 0)
        setCurrentValue(formatIsoLocalDateTime(next, format))
        return
      }

      if (rawValue == null) {
        setCurrentValue("")
      }
    }
  )

  const containerStyles = applyComponentStyles(
    [styles.fullWidth, styles.relative],
    style
  )

  const picker = (
    <div css={containerStyles}>
      <JimuDatePicker
        selectedDate={selectedDate}
        runtime={false}
        showTimeInput={mode === "date-time"}
        isLongTime={mode === "date-time"}
        supportVirtualDateList={false}
        disablePortal
        onChange={handleChange}
        aria-label={ariaLabel}
      />
    </div>
  )

  if (disabled) {
    return (
      <span aria-disabled="true" css={styles.disabledPicker}>
        {picker}
      </span>
    )
  }

  return picker
}

// RichText component
export const RichText: React.FC<{
  html?: string
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}> = ({ html, placeholder, className, style }) => {
  if (!html || html.trim().length === 0) {
    return (
      <div className={className} css={styleCss(style)}>
        {placeholder || ""}
      </div>
    )
  }

  return (
    <RichDisplayer className={className} css={styleCss(style)} value={html} />
  )
}

// MultiSelectControl component
export const MultiSelectControl: React.FC<{
  options?: readonly OptionItem[]
  values?: Array<string | number>
  defaultValues?: Array<string | number>
  onChange?: (values: Array<string | number>) => void
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
  allowSearch?: boolean
  hierarchical?: boolean
}> = ({
  options = [],
  values,
  defaultValues = [],
  onChange,
  placeholder,
  disabled = false,
  style,
  allowSearch = false,
  hierarchical = false,
}) => {
  const translate = hooks.useTranslation(defaultMessages, jimuDefaultMessages)
  const styles = useStyles()

  const [current, setCurrent] = useValue<Array<string | number>>(
    values,
    defaultValues
  )
  const [searchTerm, setSearchTerm] = React.useState("")

  const finalPlaceholder = placeholder || translate("phSelectOption")
  const trimmedSearch = allowSearch ? searchTerm.trim() : ""
  const normalizedSearch = trimmedSearch.toLowerCase()

  const flattenedEntries = flattenHierarchicalOptions(options, hierarchical)
  const filteredEntries = normalizedSearch
    ? flattenedEntries.filter(({ option }) => {
        const baseLabel =
          option.label && option.label.trim()
            ? option.label.trim()
            : String(option.value)
        return baseLabel.toLowerCase().includes(normalizedSearch)
      })
    : flattenedEntries

  const entriesToDisplay = filteredEntries

  const items = entriesToDisplay
    .map(({ option, depth }) => {
      if (!option || option.value == null) {
        return null
      }
      const baseLabel =
        option.label && option.label.trim()
          ? option.label.trim()
          : String(option.value)
      const label =
        hierarchical && depth > 0
          ? `${"- ".repeat(depth)}${baseLabel}`
          : baseLabel
      return {
        value: option.value,
        label,
        disabled: Boolean(option.disabled),
      }
    })
    .filter(Boolean) as Array<{
    value: string | number
    label: string
    disabled: boolean
  }>

  const handleChange = hooks.useEventCallback(
    (_value: string | number, newValues: Array<string | number>) => {
      const normalized = Array.isArray(newValues)
        ? newValues.filter(
            (nextValue): nextValue is string | number => nextValue != null
          )
        : []
      setCurrent(normalized)
      onChange?.(normalized)
    }
  )

  return (
    <div css={applyComponentStyles([styles.fullWidth], style)}>
      {allowSearch ? (
        <Input
          type="search"
          value={searchTerm}
          placeholder={translate("phSearch")}
          onChange={(val) => {
            setSearchTerm(typeof val === "string" ? val : "")
          }}
          disabled={disabled}
        />
      ) : null}
      <MultiSelect
        values={current || []}
        defaultValues={defaultValues}
        onChange={handleChange}
        placeholder={finalPlaceholder}
        disabled={disabled}
        items={items}
        css={styles.fullWidth}
      />
    </div>
  )
}

export default DynamicField
export { makePlaceholders } from "../../shared/utils"
