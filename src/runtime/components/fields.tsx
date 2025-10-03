/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx } from "jimu-core"
import {
  Select,
  MultiSelectControl,
  TextArea,
  Input,
  UrlInput,
  Checkbox,
  Switch,
  Radio,
  Slider,
  NumericInput,
  TagInput,
  ColorPickerWrapper,
  DateTimePickerWrapper,
  Button,
  ButtonTabs,
  RichText,
  Table,
} from "./ui"
import {
  FormFieldType,
  type DynamicFieldProps,
  type FormPrimitive,
  type SelectValue,
  type TextOrFileMode,
  type NormalizedTextOrFile,
  type TableColumnConfig,
} from "../../config"
import defaultMessages from "./translations/default"
import {
  asString,
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
} from "../../shared/utils"

// makePlaceholders is now imported from shared/utils

const SELECT_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  FormFieldType.SELECT,
  FormFieldType.COORDSYS,
  FormFieldType.ATTRIBUTE_NAME,
  FormFieldType.DB_CONNECTION,
  FormFieldType.WEB_CONNECTION,
  FormFieldType.REPROJECTION_FILE,
])

const MULTI_VALUE_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  FormFieldType.MULTI_SELECT,
  FormFieldType.ATTRIBUTE_LIST,
])

const TEXT_OR_FILE_MODES = {
  TEXT: "text" as const,
  FILE: "file" as const,
}

// Helper: Render simple text-based input fields
const renderTextInput = (
  inputType: "text" | "email" | "tel" | "search" | "password" | "number",
  value: FormPrimitive,
  placeholder: string,
  onChange: (value: FormPrimitive) => void,
  readOnly?: boolean,
  maxLength?: number
): JSX.Element => {
  const handleChange = (val: string) => {
    if (inputType === "number") {
      if (val === "") {
        onChange("")
        return
      }
      const num = Number(val.replace(/,/g, "."))
      onChange(Number.isFinite(num) ? (num as FormPrimitive) : "")
    } else {
      onChange(val)
    }
  }

  const stringValue =
    typeof value === "string" || typeof value === "number" ? String(value) : ""

  return (
    <Input
      type={inputType === "number" ? "text" : inputType}
      value={stringValue}
      placeholder={placeholder}
      onChange={handleChange}
      disabled={readOnly}
      maxLength={maxLength}
    />
  )
}

// Helper: Render date/time input with HTML5 types
const renderDateTimeInput = (
  inputType: "date" | "time" | "month" | "week",
  value: FormPrimitive,
  placeholder: string,
  onChange: (value: FormPrimitive) => void,
  readOnly?: boolean
): JSX.Element => (
  <Input
    type={inputType}
    value={asString(value)}
    placeholder={placeholder}
    onChange={(val) => {
      onChange(val as FormPrimitive)
    }}
    disabled={readOnly}
  />
)

// Helper: Normalize TEXT_OR_FILE value to consistent shape
const normalizeTextOrFileValue = (rawValue: unknown): NormalizedTextOrFile => {
  if (
    rawValue &&
    typeof rawValue === "object" &&
    !Array.isArray(rawValue) &&
    "mode" in rawValue
  ) {
    return rawValue as NormalizedTextOrFile
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
    text: asString(rawValue),
  }
}

// Helper: Check if value is a plain object
const isPlainObject = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Helper: Normalize table rows from various input formats
const normalizeTableRows = (
  raw: unknown,
  columns: readonly TableColumnConfig[]
): Array<{ [key: string]: unknown }> => {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (isPlainObject(item)) {
        const normalized: { [key: string]: unknown } = {}
        for (const col of columns) {
          if (col.key in item) {
            normalized[col.key] = item[col.key]
          }
        }
        for (const [key, val] of Object.entries(item)) {
          if (!(key in normalized)) normalized[key] = val
        }
        return normalized
      }
      return { value: item }
    })
  }

  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return normalizeTableRows(parsed, columns)
      }
    } catch {
      return raw
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => ({ value: entry }))
    }
  }

  return []
}

// Helper: Create a new table row with default values
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

export const DynamicField: React.FC<DynamicFieldProps> = ({
  field,
  value,
  onChange,
  translate: translateProp,
}) => {
  const fallbackTranslate = hooks.useTranslation(defaultMessages)
  const translate = translateProp ?? fallbackTranslate
  const isMulti = MULTI_VALUE_FIELD_TYPES.has(field.type)
  const bypassNormalization = field.type === FormFieldType.TEXT_OR_FILE
  const fieldValue = bypassNormalization
    ? value
    : normalizeFormValue(value, isMulti)
  const placeholders = makePlaceholders(translate, field.label)

  // Determine if the field is a select type
  const isSelectType =
    SELECT_FIELD_TYPES.has(field.type) ||
    MULTI_VALUE_FIELD_TYPES.has(field.type)
  const selectOptions = (field.options || []) as ReadonlyArray<{
    readonly value?: unknown
  }>
  const isSingleOption = isSelectType && !isMulti && selectOptions.length === 1
  const onlyVal = isSingleOption ? selectOptions[0]?.value : undefined

  // Compute if select values can be coerced to numbers
  const selectCoerce = computeSelectCoerce(isSelectType, selectOptions)

  hooks.useEffectOnce(() => {
    if (!isSingleOption) return
    const current = fieldValue as SelectValue
    const isUnset =
      current === undefined || (typeof current === "string" && current === "")
    if (onlyVal !== undefined && (isUnset || current !== onlyVal)) {
      onChange(onlyVal as FormPrimitive)
    }
  })

  // Render field based on its type
  const renderByType = (): JSX.Element => {
    switch (field.type) {
      case FormFieldType.HIDDEN: {
        // Hidden field: keep value in form but render nothing
        return <></>
      }
      case FormFieldType.MESSAGE: {
        const html = field.description || field.label || ""
        return <RichText html={html} />
      }
      case FormFieldType.TABLE: {
        const tableConfig = field.tableConfig
        if (!tableConfig?.columns?.length) {
          const rows = parseTableRows(value)

          const updateRow = (idx: number, val: string) => {
            const next = [...rows]
            next[idx] = val
            onChange(next as unknown as FormPrimitive)
          }

          const addRow = () => {
            onChange([...(rows || []), ""] as unknown as FormPrimitive)
          }

          const removeRow = (idx: number) => {
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
                            disabled={field.readOnly}
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
                            disabled={field.readOnly}
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
                disabled={field.readOnly}
              />
            </div>
          )
        }

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

        const rows = normalizeTableRows(value, columns)
        const minRows = tableConfig?.minRows ?? 0
        const maxRows = tableConfig?.maxRows
        const allowReorder = tableConfig?.allowReorder ?? false
        const showHeader = tableConfig?.showHeader ?? true
        const addLabel = tableConfig?.addRowLabel || translate("addRow")
        const removeLabel =
          tableConfig?.removeRowLabel || translate("deleteRow")

        const canRemove = !field.readOnly && rows.length > minRows
        const canAddRow =
          !field.readOnly && (maxRows === undefined || rows.length < maxRows)

        const handleCellChange = (
          rowIndex: number,
          columnKey: string,
          newValue: unknown
        ) => {
          const next = rows.map((row, idx) =>
            idx === rowIndex ? { ...row, [columnKey]: newValue } : row
          )
          onChange(next as unknown as FormPrimitive)
        }

        const handleAddRow = () => {
          if (!canAddRow) return
          const nextRow = prepareNewTableRow(columns)
          onChange([...rows, nextRow] as unknown as FormPrimitive)
        }

        const handleRemoveRow = (rowIndex: number) => {
          if (!canRemove) return
          const next = rows.filter((_, idx) => idx !== rowIndex)
          onChange(next as unknown as FormPrimitive)
        }

        const handleMoveRow = (rowIndex: number, direction: -1 | 1) => {
          const target = rowIndex + direction
          if (target < 0 || target >= rows.length) return
          const next = [...rows]
          const [moved] = next.splice(rowIndex, 1)
          next.splice(target, 0, moved)
          onChange(next as unknown as FormPrimitive)
        }

        const renderCell = (
          column: TableColumnConfig,
          rowIndex: number,
          rowValue: { [key: string]: unknown }
        ) => {
          const cellValue = rowValue[column.key]
          const disabled = field.readOnly || column.readOnly
          const placeholder =
            column.placeholder || field.placeholder || placeholders.enter

          switch (column.type) {
            case "number":
              return (
                <Input
                  type="number"
                  value={asString(cellValue)}
                  onChange={(val) => {
                    handleCellChange(rowIndex, column.key, val as FormPrimitive)
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
                  value={asString(cellValue)}
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
                  value={asString(cellValue)}
                  onChange={(val) => {
                    handleCellChange(rowIndex, column.key, val as FormPrimitive)
                  }}
                  disabled={disabled}
                />
              )
            case "datetime":
              return (
                <DateTimePickerWrapper
                  value={asString(cellValue)}
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
                  value={asString(cellValue)}
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
                  {rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {columns.map((column) => (
                        <td key={`${rowIndex}-${column.key}`}>
                          {renderCell(column, rowIndex, row)}
                        </td>
                      ))}
                      <td>
                        <Button
                          text={removeLabel}
                          variant="text"
                          type="tertiary"
                          onClick={() => {
                            handleRemoveRow(rowIndex)
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
                                handleMoveRow(rowIndex, -1)
                              }}
                              aria-label={translate("tableMoveUp")}
                              disabled={field.readOnly || rowIndex === 0}
                            />
                            <Button
                              text={translate("tableMoveDown")}
                              variant="text"
                              type="tertiary"
                              onClick={() => {
                                handleMoveRow(rowIndex, 1)
                              }}
                              aria-label={translate("tableMoveDown")}
                              disabled={
                                field.readOnly || rowIndex === rows.length - 1
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
        const options = field.options || []

        if (options.length === 0) {
          return renderTextInput(
            "text",
            fieldValue as FormPrimitive,
            placeholders.enter,
            onChange,
            field.readOnly
          )
        }

        return (
          <Select
            value={
              isSingleOption
                ? (options[0]?.value as SelectValue)
                : (fieldValue as SelectValue)
            }
            options={options}
            placeholder={placeholders.select}
            onChange={(val) => {
              onChange(val as FormPrimitive)
            }}
            aria-label={field.label}
            disabled={field.readOnly || isSingleOption}
            coerce={selectCoerce}
          />
        )
      }
      case FormFieldType.DATE_TIME: {
        // Render as local datetime without seconds; store as FME datetime string
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
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.URL: {
        const val = asString(fieldValue)
        return (
          <UrlInput
            value={val}
            placeholder={field.placeholder || placeholders.enter}
            onChange={(v) => {
              onChange(v)
            }}
          />
        )
      }
      case FormFieldType.ATTRIBUTE_LIST:
      case FormFieldType.MULTI_SELECT: {
        const options = field.options || []
        const values = Array.isArray(fieldValue)
          ? (fieldValue as ReadonlyArray<string | number>)
          : []
        return (
          <MultiSelectControl
            options={options}
            values={[...values] as Array<string | number>}
            placeholder={placeholders.select}
            disabled={field.readOnly}
            onChange={(vals) => {
              onChange(vals as unknown as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.TEXTAREA:
        return (
          <TextArea
            value={asString(fieldValue)}
            placeholder={placeholders.enter}
            onChange={(val) => {
              onChange(val as FormPrimitive)
            }}
            disabled={field.readOnly}
            rows={field.rows}
          />
        )
      case FormFieldType.NUMBER:
        return renderTextInput(
          "number",
          fieldValue as FormPrimitive,
          placeholders.enter,
          onChange,
          field.readOnly
        )
      case FormFieldType.CHECKBOX:
        return (
          <Checkbox
            checked={Boolean(fieldValue)}
            onChange={(evt) => {
              onChange(evt.target.checked)
            }}
            disabled={field.readOnly}
            aria-label={field.label}
          />
        )
      case FormFieldType.PASSWORD:
      case FormFieldType.EMAIL:
      case FormFieldType.PHONE:
      case FormFieldType.SEARCH:
      case FormFieldType.TEXT: {
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
          field.readOnly,
          field.maxLength
        )
      }
      case FormFieldType.FILE:
        return (
          <Input
            type="file"
            onFileChange={(evt) => {
              const files = evt.target.files
              onChange(files ? files[0] : null)
            }}
            disabled={field.readOnly}
            aria-label={field.label}
          />
        )
      case FormFieldType.TEXT_OR_FILE: {
        const currentValue: NormalizedTextOrFile =
          normalizeTextOrFileValue(fieldValue)
        const resolvedMode: TextOrFileMode =
          currentValue.mode === TEXT_OR_FILE_MODES.FILE
            ? TEXT_OR_FILE_MODES.FILE
            : TEXT_OR_FILE_MODES.TEXT

        const handleModeChange = (nextMode: TextOrFileMode) => {
          if (nextMode === TEXT_OR_FILE_MODES.FILE) {
            onChange({
              mode: TEXT_OR_FILE_MODES.FILE,
              file: isFileObject(currentValue.file) ? currentValue.file : null,
              fileName: currentValue.fileName,
            } as unknown as FormPrimitive)
          } else {
            onChange({
              mode: TEXT_OR_FILE_MODES.TEXT,
              text: asString(currentValue.text),
            } as unknown as FormPrimitive)
          }
        }

        const handleTextChange = (val: string) => {
          onChange({
            mode: TEXT_OR_FILE_MODES.TEXT,
            text: val,
          } as unknown as FormPrimitive)
        }

        const handleFileChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
          const files = evt.target.files
          const file = files && files.length > 0 ? files[0] : null
          onChange({
            mode: TEXT_OR_FILE_MODES.FILE,
            file,
            fileName: file ? getFileDisplayName(file) : undefined,
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
                value={asString(currentValue.text)}
                placeholder={field.placeholder || placeholders.enter}
                onChange={handleTextChange}
                disabled={field.readOnly}
                rows={field.rows}
              />
            ) : (
              <div>
                <Input
                  type="file"
                  onFileChange={handleFileChange}
                  disabled={field.readOnly}
                  aria-label={field.label}
                />
                {isFileObject(currentValue.file) ? (
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
        const content =
          typeof fieldValue === "string" && fieldValue.trim().length > 0
            ? fieldValue
            : asString(field.defaultValue) || field.description || field.label
        return <RichText html={content || ""} />
      }
      case FormFieldType.SWITCH:
        return (
          <Switch
            checked={Boolean(fieldValue)}
            onChange={(_evt, checked) => {
              onChange(checked)
            }}
            disabled={field.readOnly}
            aria-label={field.label}
          />
        )
      case FormFieldType.RADIO: {
        const options = field.options || []
        const val = asString(fieldValue)
        return (
          <Radio
            options={options.map((opt) => ({
              label: opt.label,
              value: String(opt.value),
            }))}
            value={val}
            onChange={(value) => {
              onChange(value)
            }}
            disabled={field.readOnly}
            aria-label={field.label}
          />
        )
      }
      case FormFieldType.GEOMETRY: {
        const trimmed = asString(fieldValue).trim()
        if (!trimmed) {
          return (
            <React.Fragment data-testid="geometry-field">
              {translate("geometryFieldMissing")}
            </React.Fragment>
          )
        }

        let rings = 0
        let vertices = 0
        let preview = trimmed

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
          // Keep fallback preview and zero counts
        }

        const truncated =
          preview.length > 1500 ? `${preview.slice(0, 1500)}…` : preview

        return (
          <React.Fragment data-testid="geometry-field">
            <>
              {translate("geometryFieldReady", {
                rings,
                vertices,
              })}
            </>
            {truncated ? (
              <pre aria-label={translate("geometryFieldPreviewLabel")}>
                {truncated}
              </pre>
            ) : null}
          </React.Fragment>
        )
      }
      case FormFieldType.SLIDER: {
        const val = typeof fieldValue === "number" ? fieldValue : 0
        return (
          <Slider
            value={val}
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            onChange={(value) => {
              onChange(value)
            }}
            disabled={field.readOnly}
            aria-label={field.label}
          />
        )
      }
      case FormFieldType.NUMERIC_INPUT: {
        const val = typeof fieldValue === "number" ? fieldValue : undefined
        return (
          <NumericInput
            value={val}
            placeholder={field.placeholder || placeholders.enter}
            min={field.min}
            max={field.max}
            step={field.step}
            precision={2}
            disabled={field.readOnly}
            aria-label={field.label}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.TAG_INPUT: {
        const values = Array.isArray(fieldValue) ? (fieldValue as string[]) : []
        return (
          <TagInput
            value={values}
            placeholder={field.placeholder || translate("placeholderTags")}
            onChange={(values) => {
              onChange(values as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.COLOR: {
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
              const normalized = hexToNormalizedRgb(color, colorConfig) || color
              onChange(normalized as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.DATE: {
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
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.MONTH:
      case FormFieldType.WEEK: {
        const inputType = field.type === FormFieldType.MONTH ? "month" : "week"
        return renderDateTimeInput(
          inputType,
          fieldValue as FormPrimitive,
          getTextPlaceholder(field, placeholders, translate),
          onChange,
          field.readOnly
        )
      }
      case FormFieldType.TIME: {
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
            disabled={field.readOnly}
          />
        )
      }
    }
  }

  return renderByType()
}

export default DynamicField
export { makePlaceholders } from "../../shared/utils"
