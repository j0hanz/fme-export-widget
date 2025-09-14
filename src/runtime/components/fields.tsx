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
  DatePickerWrapper,
} from "./ui"
import {
  FormFieldType,
  type DynamicFieldProps,
  type FormPrimitive,
  type SelectValue,
} from "../../config"

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
      const num = Number(val)
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
  translate,
}) => {
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
        // Use native input type datetime-local to avoid adding new dependencies
        // Value should be an ISO-like string acceptable by input[type=datetime-local]
        const val = typeof fieldValue === "string" ? fieldValue : ""
        return (
          <Input
            type="datetime-local"
            value={val}
            placeholder={field.placeholder || placeholders.enter}
            onChange={(v) => {
              onChange((v as string) || "")
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
          <Switch
            value={Boolean(fieldValue)}
            onChange={(checked) => {
              onChange(checked)
            }}
            disabled={field.readOnly}
            aria-label={field.label}
            style={{ margin: "4px 0" }}
          />
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
            placeholder={field.placeholder || "Enter tags separated by commas"}
            onChange={(values) => {
              onChange(values as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.COLOR: {
        const val = typeof fieldValue === "string" ? fieldValue : "#000000"
        return (
          <ColorPickerWrapper
            value={val}
            onChange={(color) => {
              onChange(color as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.DATE: {
        const val = typeof fieldValue === "string" ? fieldValue : ""
        return (
          <DatePickerWrapper
            value={val}
            onChange={(date) => {
              onChange(date as FormPrimitive)
            }}
          />
        )
      }
      case FormFieldType.TIME: {
        const val = typeof fieldValue === "string" ? fieldValue : ""
        return (
          <Input
            type="time"
            value={val}
            onChange={(value) => {
              onChange(value as FormPrimitive)
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
            placeholder={field.placeholder || "Enter email address"}
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
            placeholder={field.placeholder || "Enter phone number"}
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
            placeholder={field.placeholder || "Search..."}
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
