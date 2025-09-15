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
} from "./ui"
import {
  FormFieldType,
  type DynamicFieldProps,
  type FormPrimitive,
  type SelectValue,
} from "../../config"
import defaultMessages from "./translations/default"

const pad2 = (n: number) => String(n).padStart(2, "0")

const fmeDateTimeToInput = (v: string): string => {
  // YYYYMMDDHHmmss -> YYYY-MM-DDTHH:mm[:ss]
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

const inputToFmeDateTime = (v: string): string => {
  // YYYY-MM-DDTHH:mm[:ss] -> YYYYMMDDHHmmss
  if (!v) return ""
  const [date, time] = v.split("T")
  if (!date || !time) return ""
  const [y, m, d] = date.split("-").map((x) => x || "")
  const [hh, mm, ss] = time.split(":").map((x) => x || "")
  return `${y}${m}${d}${hh}${mm}${ss || "00"}`
}

const fmeDateToInput = (v: string): string => {
  // YYYYMMDD -> YYYY-MM-DD
  const s = (v || "").replace(/\D/g, "")
  if (s.length !== 8) return ""
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

const inputToFmeDate = (v: string): string => (v ? v.replace(/-/g, "") : "")
// HHmmss or HHmm -> HH:mm[:ss]
const fmeTimeToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`
  if (s.length >= 6) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
  return ""
}

const inputToFmeTime = (v: string): string => {
  // HH:mm or HH:mm:ss -> HHmmss
  if (!v) return ""
  const parts = v.split(":").map((x) => x || "")
  const hh = parts[0] || "00"
  const mm = parts[1] || "00"
  const ss = parts[2] || "00"
  return `${pad2(Number(hh))}${pad2(Number(mm))}${pad2(Number(ss))}`
}

const normalizedRgbToHex = (v: string): string | null => {
  // "r,g,b[,a]" floats (0..1) -> "#RRGGBB"
  const parts = (v || "").split(",").map((s) => s.trim())
  if (parts.length < 3) return null
  const to255 = (f: string) => {
    const n = Number(f)
    if (!Number.isFinite(n)) return null
    const clamped = Math.max(0, Math.min(1, n))
    return Math.round(clamped * 255)
  }
  const r = to255(parts[0])
  const g = to255(parts[1])
  const b = to255(parts[2])
  if (r == null || g == null || b == null) return null
  const toHex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const hexToNormalizedRgb = (hex: string): string | null => {
  // "#RRGGBB" -> "r,g,b" floats (0..1)
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const f = (x: number) => Number((x / 255).toFixed(6)).toString()
  return `${f(r)},${f(g)},${f(b)}`
}

// Utility functions for field handling
export const normalizeFormValue = (
  value: FormPrimitive | undefined,
  isMultiSelect: boolean
): FormPrimitive | SelectValue => {
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  if (isMultiSelect) {
    return Array.isArray(value) ? (value as ReadonlyArray<string | number>) : []
  }
  return typeof value === "string" || typeof value === "number" ? value : ""
}

export const makePlaceholders = (
  translate: (k: string, p?: any) => string,
  fieldLabel: string
) => ({
  enter: translate("placeholderEnter", { field: fieldLabel }),
  select: translate("placeholderSelect", { field: fieldLabel }),
})

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
  const computeSelectCoerce = (): "number" | "string" | undefined => {
    if (!isSelectType || !selectOptions.length) return undefined
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
  const selectCoerce = computeSelectCoerce()

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
          <Input
            type="datetime-local"
            value={val}
            step={1}
            placeholder={field.placeholder || placeholders.enter}
            onChange={(v) => {
              const out = inputToFmeDateTime(v as string)
              onChange(out as FormPrimitive)
            }}
            readOnly={field.readOnly}
          />
        )
      }
      case FormFieldType.URL: {
        const val = typeof fieldValue === "string" ? fieldValue : ""
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
            value={fieldValue as string}
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
            value={(fieldValue as string) || ""}
            placeholder={field.placeholder || placeholders.enter}
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
        const val = typeof fieldValue === "string" ? fieldValue : ""
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
            aria-label={translate(field.label)}
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
        const val = typeof fieldValue === "string" ? fieldValue : ""
        return (
          <Input
            type="email"
            value={val}
            placeholder={field.placeholder || translate("placeholderEmail")}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.PHONE: {
        const val = typeof fieldValue === "string" ? fieldValue : ""
        return (
          <Input
            type="text"
            value={val}
            placeholder={field.placeholder || translate("placeholderPhone")}
            onChange={(value) => {
              onChange(value as FormPrimitive)
            }}
            disabled={field.readOnly}
          />
        )
      }
      case FormFieldType.SEARCH: {
        const val = typeof fieldValue === "string" ? fieldValue : ""
        return (
          <Input
            type="text"
            value={val}
            placeholder={field.placeholder || translate("placeholderSearch")}
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
            value={(fieldValue as string) || ""}
            placeholder={field.placeholder || placeholders.enter}
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
