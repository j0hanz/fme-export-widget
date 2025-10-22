/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx } from "jimu-core"
import { TagInput as JimuTagInput, MultiSelect, RichDisplayer } from "jimu-ui"
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
  useStyles as useUiStyles,
} from "./ui"
import {
  FormFieldType,
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
  normalizeParameterValue,
  isNonEmptyTrimmedString,
  parseIsoLocalDateTime,
  formatIsoLocalDateTime,
  flattenHierarchicalOptions,
  styleCss,
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

const compareToggleValues = (a: unknown, b: unknown): boolean => {
  if (a === undefined || a === null || b === undefined || b === null) {
    return false
  }

  try {
    const normalizedA = normalizeParameterValue(a)
    const normalizedB = normalizeParameterValue(b)
    return normalizedA === normalizedB
  } catch {
    return false
  }
}

const resolveToggleChecked = (
  current: unknown,
  config?: ToggleFieldConfig
): boolean => {
  if (config) {
    if (
      config.checkedValue !== undefined &&
      compareToggleValues(current, config.checkedValue)
    ) {
      return true
    }
    if (
      config.uncheckedValue !== undefined &&
      compareToggleValues(current, config.uncheckedValue)
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
const normalizeTextOrFileValue = (rawValue: unknown): NormalizedTextOrFile => {
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
            : getFileDisplayName(obj.file),
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
      fileName: getFileDisplayName(rawValue),
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

// Nycklar som används för att extrahera filnamn från dataset-metadata
const FILE_DISPLAY_KEYS = [
  "text",
  "path",
  "location",
  "value",
  "dataset",
  "defaultValue",
  "fileName",
  "filename",
  "file_path",
  "file",
  "uri",
  "url",
  "name",
] as const

/* Filvalidering */

// Standardgränser för filuppladdning
const DEFAULT_MAX_FILE_SIZE_MB = 150
const ONE_MB_IN_BYTES = 1024 * 1024
const GEOMETRY_PREVIEW_MAX_LENGTH = 1500
// Tillåtna filtyper om inget annat specificeras
const DEFAULT_ALLOWED_FILE_EXTENSIONS: readonly string[] = [
  ".zip",
  ".kmz",
  ".json",
  ".geojson",
  ".gml",
]
// Tillåtna MIME-typer för standardvalidering
const DEFAULT_ALLOWED_MIME_TYPES = new Set(
  [
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.google-earth.kmz",
    "application/json",
    "application/geo+json",
    "application/gml+xml",
    "text/plain",
    "",
  ].map((type) => type.toLowerCase())
)

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
      ? DEFAULT_MAX_FILE_SIZE_MB
      : configuredMaxMb > 0
        ? configuredMaxMb
        : undefined

  // Kontrollerar om filen överskrider storleksgränsen
  if (
    effectiveMaxMb !== undefined &&
    file.size > effectiveMaxMb * ONE_MB_IN_BYTES
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
    const matchesDefaultExtension = DEFAULT_ALLOWED_FILE_EXTENSIONS.some(
      (ext) => fileNameLower.endsWith(ext)
    )
    if (!matchesDefaultExtension) {
      return { valid: false, error: "fileTypeNotAllowed" }
    }

    if (!DEFAULT_ALLOWED_MIME_TYPES.has(fileTypeLower)) {
      return { valid: false, error: "fileTypeNotAllowed" }
    }
  }

  return { valid: true }
}

// Extraherar läsbar sökväg/namn från FME dataset-metadata
const resolveFileDisplayValue = (raw: unknown): string | undefined => {
  if (typeof raw === "string") return raw
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw)
  }
  if (!raw) return undefined
  if (isFileObject(raw)) {
    return getFileDisplayName(raw)
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const resolved = resolveFileDisplayValue(entry)
      if (resolved) return resolved
    }
    return undefined
  }
  if (isPlainObject(raw)) {
    const obj = raw as { [key: string]: unknown }
    for (const key of FILE_DISPLAY_KEYS) {
      if (key in obj) {
        const resolved = resolveFileDisplayValue(obj[key])
        if (resolved) return resolved
      }
    }
  }
  return undefined
}

/* Huvudkomponent för dynamiska formulärfält */

export const DynamicField: React.FC<DynamicFieldProps> = ({
  field,
  value,
  onChange,
  translate: translateProp,
  disabled: disabledProp,
}) => {
  const fallbackTranslate = hooks.useTranslation(defaultMessages)
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

  // Renderar fält baserat på fälttyp
  const renderByType = (): JSX.Element => {
    switch (field.type) {
      case FormFieldType.HIDDEN: {
        // Dolt fält: behåll värde i form men rendera inget
        return <></>
      }
      case FormFieldType.MESSAGE: {
        // Renderar meddelande/instruktion som rich text
        const html = field.description || field.label || ""
        return <RichText html={html} />
      }
      case FormFieldType.TABLE: {
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
                <div>{translate("tableEmpty")}</div>
              ) : (
                <Table responsive hover aria-label={field.label}>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <Input
                            type="text"
                            value={r}
                            placeholder={
                              field.placeholder || placeholders.enter
                            }
                            onChange={(val) => {
                              const s = typeof val === "string" ? val : ""
                              updateRow(i, s)
                            }}
                            disabled={isDisabled}
                          />
                        </td>
                        <td>
                          <Button
                            text={translate("deleteRow")}
                            variant="text"
                            type="tertiary"
                            onClick={() => {
                              removeRow(i)
                            }}
                            aria-label={translate("deleteRow")}
                            disabled={isDisabled}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <Button
                text={translate("addRow")}
                variant="outlined"
                onClick={addRow}
                aria-label={translate("addRow")}
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
                  label: field.label || translate("tableColumnDefault"),
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
        const addLabel = tableConfig?.addRowLabel || translate("addRow")
        const removeLabel =
          tableConfig?.removeRowLabel || translate("deleteRow")

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
                      val === ""
                        ? null
                        : Number((val as string).replace(/,/g, "."))
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
              <div>{translate("tableEmpty")}</div>
            ) : (
              <Table responsive hover aria-label={field.label}>
                {showHeader ? (
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                      <th>{translate("tableActionsHeader")}</th>
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
                              text={translate("tableMoveUp")}
                              variant="text"
                              type="tertiary"
                              onClick={() => {
                                handleMoveRow(
                                  rows.findIndex(
                                    (r) => r.__rowId === row.__rowId
                                  ),
                                  -1
                                )
                              }}
                              aria-label={translate("tableMoveUp")}
                              disabled={
                                isDisabled ||
                                rows.findIndex(
                                  (r) => r.__rowId === row.__rowId
                                ) === 0
                              }
                            />
                            <Button
                              text={translate("tableMoveDown")}
                              variant="text"
                              type="tertiary"
                              onClick={() => {
                                handleMoveRow(
                                  rows.findIndex(
                                    (r) => r.__rowId === row.__rowId
                                  ),
                                  1
                                )
                              }}
                              aria-label={translate("tableMoveDown")}
                              disabled={
                                isDisabled ||
                                rows.findIndex(
                                  (r) => r.__rowId === row.__rowId
                                ) ===
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
      case FormFieldType.COORDSYS:
      case FormFieldType.ATTRIBUTE_NAME:
      case FormFieldType.DB_CONNECTION:
      case FormFieldType.WEB_CONNECTION:
      case FormFieldType.REPROJECTION_FILE:
      case FormFieldType.SELECT: {
        // Hanterar select-fält med dynamiska alternativ
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
      case FormFieldType.DATE_TIME: {
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
      case FormFieldType.URL: {
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
      case FormFieldType.ATTRIBUTE_LIST:
      case FormFieldType.MULTI_SELECT: {
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
      case FormFieldType.TEXTAREA:
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
      case FormFieldType.NUMBER:
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
      case FormFieldType.CHECKBOX:
      case FormFieldType.SWITCH: {
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
      case FormFieldType.PASSWORD:
      case FormFieldType.EMAIL:
      case FormFieldType.PHONE:
      case FormFieldType.SEARCH:
      case FormFieldType.TEXT: {
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
            : getTextPlaceholder(
                field,
                placeholders,
                translate,
                placeholderType
              )

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
      case FormFieldType.FILE: {
        // Renderar filuppladdningsfält med validering
        const selectedFile = isFileObject(value) ? value : null
        const acceptTokens = buildAcceptList(field.fileConfig)
        const acceptAttr = acceptTokens.length
          ? acceptTokens.join(",")
          : undefined
        const resolvedDefault = !selectedFile
          ? (resolveFileDisplayValue(value) ??
            resolveFileDisplayValue(fieldValue) ??
            resolveFileDisplayValue(field.defaultValue))
          : resolveFileDisplayValue(field.defaultValue)
        const defaultDisplay = toTrimmedString(resolvedDefault) || ""
        const displayText = selectedFile
          ? getFileDisplayName(selectedFile)
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
                ? translate("fileTooLarge", { maxSize: validation.maxSizeMB })
                : validation.error === "fileTypeNotAllowed"
                  ? translate("fileTypeNotAllowed")
                  : translate("fileInvalid")
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
      case FormFieldType.TEXT_OR_FILE: {
        // Renderar fält med växel mellan text- och filuppladdningsläge
        const currentValue: NormalizedTextOrFile =
          normalizeTextOrFileValue(fieldValue)
        const resolvedMode: TextOrFileMode =
          currentValue.mode === TEXT_OR_FILE_MODES.FILE
            ? TEXT_OR_FILE_MODES.FILE
            : TEXT_OR_FILE_MODES.TEXT
        const acceptTokens = buildAcceptList(field.fileConfig)
        const acceptAttr = acceptTokens.length
          ? acceptTokens.join(",")
          : undefined

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
                ? translate("fileTooLarge", { maxSize: validation.maxSizeMB })
                : validation.error === "fileTypeNotAllowed"
                  ? translate("fileTypeNotAllowed")
                  : translate("fileInvalid")
            )
            evt.target.value = ""
            return
          }

          setFileError(null)
          onChange({
            mode: TEXT_OR_FILE_MODES.FILE,
            file,
            fileName: getFileDisplayName(file),
          } as unknown as FormPrimitive)
        }

        return (
          <>
            <ButtonTabs
              items={[
                {
                  value: TEXT_OR_FILE_MODES.TEXT,
                  label: translate("textInput"),
                },
                {
                  value: TEXT_OR_FILE_MODES.FILE,
                  label: translate("fileInput"),
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
                      getFileDisplayName(currentValue.file)}
                  </div>
                ) : null}
              </div>
            )}
          </>
        )
      }
      case FormFieldType.SCRIPTED: {
        // Renderar skriptgenererat innehåll som rich text
        const content = isNonEmptyTrimmedString(fieldValue)
          ? fieldValue
          : toDisplayString(field.defaultValue) ||
            field.description ||
            field.label
        return <RichText html={content || ""} />
      }
      case FormFieldType.RADIO: {
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
      case FormFieldType.GEOMETRY: {
        // Renderar geometri (AOI polygon) med statistik
        const trimmed = toDisplayString(fieldValue).trim()
        if (!trimmed) {
          return (
            <div css={styles.typo.hint} data-testid="geometry-field">
              {translate("geometryFieldMissing")}
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
              count +
              (Array.isArray(ring) ? ring.filter(Array.isArray).length : 0)
            )
          }, 0)
          preview = JSON.stringify(parsed, null, 2)
        } catch {
          parseError = true
        }

        // Trunkerar för lång geometri-JSON
        const truncated =
          preview.length > GEOMETRY_PREVIEW_MAX_LENGTH
            ? `${preview.slice(0, GEOMETRY_PREVIEW_MAX_LENGTH)}…`
            : preview

        return (
          <div data-testid="geometry-field">
            <div css={styles.typo.hint}>
              {parseError
                ? translate("geometryFieldParseError")
                : translate("geometryFieldReady", {
                    rings,
                    vertices,
                  })}
            </div>
            {truncated ? (
              <pre aria-label={translate("geometryFieldPreviewLabel")}>
                {truncated}
              </pre>
            ) : null}
          </div>
        )
      }
      case FormFieldType.SLIDER: {
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
          typeof field.decimalPrecision === "number" &&
          field.decimalPrecision >= 0
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
      case FormFieldType.NUMERIC_INPUT: {
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
          typeof field.decimalPrecision === "number" &&
          field.decimalPrecision >= 0
            ? field.decimalPrecision
            : 2

        // Validera numerisk input och generera felmeddelande
        let validationError: string | null = null
        if (numericValue !== undefined && Number.isFinite(numericValue)) {
          // Kontrollera om decimaltal är tillåtet (precision = 0 => endast heltal)
          if (precision === 0) {
            const hasDecimals = numericValue % 1 !== 0
            if (hasDecimals) {
              validationError = translate("integerRequired")
            }
          }

          // Kontrollera min-begränsning
          if (!validationError && typeof field.min === "number") {
            const belowMin = field.minExclusive
              ? numericValue <= field.min
              : numericValue < field.min
            if (belowMin) {
              validationError = field.minExclusive
                ? translate("mustBeGreaterThan", { value: field.min })
                : translate("mustBeAtLeast", { value: field.min })
            }
          }

          // Kontrollera max-begränsning
          if (!validationError && typeof field.max === "number") {
            const aboveMax = field.maxExclusive
              ? numericValue >= field.max
              : numericValue > field.max
            if (aboveMax) {
              validationError = field.maxExclusive
                ? translate("mustBeLessThan", { value: field.max })
                : translate("mustBeAtMost", { value: field.max })
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
              aria-describedby={
                validationError ? `${field.name}-error` : undefined
              }
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
      case FormFieldType.TAG_INPUT: {
        // Renderar tag-input för array av strängar
        const values = Array.isArray(fieldValue) ? (fieldValue as string[]) : []
        return (
          <TagInput
            value={values}
            placeholder={field.placeholder || translate("placeholderTags")}
            onChange={(values) => {
              if (isDisabled) return
              onChange(values as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.COLOR: {
        // Renderar färgväljare; lagrar normaliserade RGB-värden
        // Accept normalized floats string or hex; render as hex, store normalized string
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
      case FormFieldType.DATE: {
        // Renderar datumväljare (utan tid), lagrar som FME date-sträng
        const val =
          typeof fieldValue === "string" ? fmeDateToInput(fieldValue) : ""
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
      case FormFieldType.MONTH:
      case FormFieldType.WEEK: {
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
      case FormFieldType.TIME: {
        // Renderar tidsväljare, lagrar som FME time-sträng
        const val =
          typeof fieldValue === "string" ? fmeTimeToInput(fieldValue) : ""
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
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useStyles()

  const [current, setCurrent] = useValue<Array<string | number>>(
    values,
    defaultValues
  )
  const [searchTerm, setSearchTerm] = React.useState("")

  const finalPlaceholder = placeholder || translate("placeholderSelectGeneric")
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
          placeholder={translate("placeholderSearch")}
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
