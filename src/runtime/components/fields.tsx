/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
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
  DatePickerWrapper,
  DateTimePickerWrapper,
  Button,
  RichText,
} from "./ui"
import {
  FormFieldType,
  type DynamicFieldProps,
  type FormPrimitive,
  type SelectValue,
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
} from "../../shared/utils"

// makePlaceholders is now imported from shared/utils

// Input rendering helper
export const renderInputField = (
  type: "text" | "password" | "number",
  fieldValue: FormPrimitive,
  placeholder: string,
  onChange: (value: FormPrimitive) => void,
  readOnly?: boolean
): JSX.Element => {
  const handleChange = (val: string) => {
    if (type === "number") {
      if (val === "") {
        onChange("")
        return
      }
      // Accept locales with comma decimals by normalizing to dot
      const num = Number(val.replace(/,/g, "."))
      onChange(Number.isFinite(num) ? (num as FormPrimitive) : "")
    } else {
      onChange(val)
    }
  }

  const displayValue =
    typeof fieldValue === "string" || typeof fieldValue === "number"
      ? String(fieldValue)
      : ""

  return (
    <Input
      type={type === "number" ? "text" : type}
      value={displayValue}
      placeholder={placeholder}
      onChange={handleChange}
      disabled={readOnly}
    />
  )
}

// Dynamic field component renders various form fields based on configuration
export const DynamicField: React.FC<DynamicFieldProps> = ({
  field,
  value,
  onChange,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const isMulti = field.type === FormFieldType.MULTI_SELECT
  const fieldValue = normalizeFormValue(value, isMulti)
  const placeholders = makePlaceholders(translate, field.label)

  // Determine if the field is a select type
  const isSelectType =
    field.type === FormFieldType.SELECT ||
    field.type === FormFieldType.MULTI_SELECT
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
        // Minimal table: array of strings; allow add/remove rows
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
            {rows.length === 0 && <>{translate("tableEmpty")}</>}
            <div role="table" aria-label={field.label}>
              {rows.map((r, i) => (
                <div key={i} role="row">
                  <div role="cell">
                    <Input
                      type="text"
                      value={r}
                      placeholder={field.placeholder || placeholders.enter}
                      onChange={(val) => {
                        const s = typeof val === "string" ? val : ""
                        updateRow(i, s)
                      }}
                      disabled={field.readOnly}
                    />
                  </div>
                  <div role="cell">
                    <Button
                      text={translate("deleteRow")}
                      variant="text"
                      onClick={() => {
                        removeRow(i)
                      }}
                      aria-label={translate("deleteRow")}
                    />
                  </div>
                </div>
              ))}
            </div>
            <>
              <Button
                text={translate("addRow")}
                variant="outlined"
                onClick={addRow}
                aria-label={translate("addRow")}
              />
            </>
          </div>
        )
      }
      case FormFieldType.SELECT: {
        const options = field.options || []

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
              const out = inputToFmeDateTime(v)
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
        return renderInputField(
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
        return (
          <Input
            type="password"
            value={asString(fieldValue)}
            placeholder={getTextPlaceholder(field, placeholders, translate)}
            onChange={(val) => {
              onChange(val as FormPrimitive)
            }}
            disabled={field.readOnly}
            maxLength={field.maxLength}
          />
        )
      case FormFieldType.FILE:
        return (
          <Input
            type="file"
            onFileChange={(evt) => {
              const files = evt.target.files
              onChange(
                files
                  ? (files[0] as unknown as FormPrimitive)
                  : (null as FormPrimitive)
              )
            }}
            disabled={field.readOnly}
            aria-label={field.label}
          />
        )
      case FormFieldType.SWITCH:
        return (
          <div css={css({ margin: "4px 0" })}>
            <Switch
              checked={Boolean(fieldValue)}
              onChange={(_evt, checked) => {
                onChange(checked)
              }}
              disabled={field.readOnly}
              aria-label={field.label}
            />
          </div>
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
        const initial =
          typeof fieldValue === "string"
            ? normalizedRgbToHex(fieldValue) || fieldValue
            : undefined
        const val =
          typeof initial === "string" && initial.startsWith("#")
            ? initial
            : "#000000"
        return (
          <ColorPickerWrapper
            value={val}
            onChange={(color) => {
              const normalized = hexToNormalizedRgb(color) || color
              onChange(normalized as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.DATE: {
        const val =
          typeof fieldValue === "string" ? fmeDateToInput(fieldValue) : ""
        return (
          <DatePickerWrapper
            value={val}
            onChange={(date) => {
              const out = inputToFmeDate(date)
              onChange(out as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.MONTH: {
        const val = asString(fieldValue)
        return (
          <Input
            type="month"
            value={val}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
            disabled={field.readOnly}
            placeholder={getTextPlaceholder(field, placeholders, translate)}
          />
        )
      }
      case FormFieldType.WEEK: {
        const val = asString(fieldValue)
        return (
          <Input
            type="week"
            value={val}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
            disabled={field.readOnly}
            placeholder={getTextPlaceholder(field, placeholders, translate)}
          />
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
              const out = inputToFmeTime(value as string)
              onChange(out as FormPrimitive)
            }}
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.EMAIL: {
        const val = asString(fieldValue)
        return (
          <Input
            type="email"
            value={val}
            placeholder={getTextPlaceholder(
              field,
              placeholders,
              translate,
              "email"
            )}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.PHONE: {
        const val = asString(fieldValue)
        return (
          <Input
            type="tel"
            value={val}
            placeholder={getTextPlaceholder(
              field,
              placeholders,
              translate,
              "phone"
            )}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.SEARCH: {
        const val = asString(fieldValue)
        return (
          <Input
            type="search"
            value={val}
            placeholder={getTextPlaceholder(
              field,
              placeholders,
              translate,
              "search"
            )}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.TEXT:
        return (
          <Input
            type="text"
            value={asString(fieldValue)}
            placeholder={getTextPlaceholder(field, placeholders, translate)}
            onChange={(val) => {
              onChange(val as FormPrimitive)
            }}
            disabled={field.readOnly}
            maxLength={field.maxLength}
          />
        )
    }
  }

  return renderByType()
}

export default DynamicField
// Re-export for backwards compatibility in tests and callers
export { makePlaceholders } from "../../shared/utils"
