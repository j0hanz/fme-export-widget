import React from "react"
import { screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom"
import { widgetRender, initStore, setTheme, mockTheme } from "jimu-for-test"
import {
  DynamicField,
  makePlaceholders,
  renderInputField,
} from "../runtime/components/fields"
import { normalizeFormValue } from "../shared/validations"
import { FormFieldType, type DynamicFieldConfig } from "../config"

// Mock UI components to avoid rendering complexity in unit tests
jest.mock("../runtime/components/ui", () => ({
  RichText: ({ html }) => {
    const strip = (input?: string) => {
      if (!input) return ""
      let out = input.replace(
        /<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
        ""
      )
      out = out.replace(/<[^>]*>/g, "")
      return out
    }
    return <div data-testid="rich-text">{strip(html)}</div>
  },
  Select: ({
    value,
    onChange,
    options,
    placeholder,
    disabled,
    "aria-label": ariaLabel,
  }) => (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="select"
    >
      <option value="">{placeholder}</option>
      {options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
  MultiSelectControl: ({ values, onChange, options, disabled }) => (
    <div data-testid="multi-select" aria-disabled={disabled}>
      {options?.map((opt) => (
        <label key={opt.value}>
          <input
            type="checkbox"
            checked={values?.includes(opt.value)}
            onChange={(e) => {
              const newValues = e.target.checked
                ? [...(values || []), opt.value]
                : (values || []).filter((v) => v !== opt.value)
              onChange(newValues)
            }}
          />
          {opt.label}
        </label>
      ))}
    </div>
  ),
  TextArea: ({ value, onChange, placeholder, disabled, rows }) => (
    <textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      data-testid="textarea"
    />
  ),
  Input: ({
    value,
    onChange,
    placeholder,
    disabled,
    type,
    maxLength,
    onFileChange,
    readOnly,
  }) => {
    if (type === "file") {
      return (
        <input
          type="file"
          onChange={onFileChange}
          disabled={disabled}
          data-testid="file-input"
        />
      )
    }
    return (
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || readOnly}
        type={type || "text"}
        maxLength={maxLength}
        data-testid="input"
      />
    )
  },
  UrlInput: ({ value, onChange, placeholder }) => (
    <input
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type="url"
      data-testid="url-input"
    />
  ),
  Checkbox: ({ checked, onChange, disabled, "aria-label": ariaLabel }) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onChange({ target: { checked: e.target.checked } })}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="checkbox"
    />
  ),
  Switch: ({ checked, onChange, disabled, "aria-label": ariaLabel }) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onChange(e, e.target.checked)}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="switch"
    />
  ),
  Radio: ({ options, value, onChange, disabled, "aria-label": ariaLabel }) => (
    <div role="radiogroup" aria-label={ariaLabel} data-testid="radio-group">
      {options?.map((opt) => (
        <label key={opt.value}>
          <input
            type="radio"
            name="radio-group"
            value={opt.value}
            checked={value === opt.value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
          {opt.label}
        </label>
      ))}
    </div>
  ),
  Slider: ({
    value,
    onChange,
    min,
    max,
    step,
    disabled,
    "aria-label": ariaLabel,
  }) => (
    <input
      type="range"
      value={value || min || 0}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="slider"
    />
  ),
  NumericInput: ({
    value,
    onChange,
    min,
    max,
    step,
    precision,
    disabled,
    placeholder,
    "aria-label": ariaLabel,
  }) => (
    <input
      type="number"
      value={value || ""}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid="numeric-input"
    />
  ),
  TagInput: ({ value, onChange, placeholder }) => (
    <input
      value={Array.isArray(value) ? value.join(", ") : ""}
      onChange={(e) => onChange(e.target.value.split(", ").filter(Boolean))}
      placeholder={placeholder}
      data-testid="tag-input"
    />
  ),
  Table: ({ children, "aria-label": ariaLabel }: any) => (
    <table aria-label={ariaLabel} data-testid="table">
      {children}
    </table>
  ),
  ColorPickerWrapper: ({ value, onChange }) => (
    <input
      type="color"
      value={value || "#000000"}
      onChange={(e) => onChange(e.target.value)}
      data-testid="color-picker"
    />
  ),
  DateTimePickerWrapper: ({ value, onChange }) => (
    <input
      type="datetime-local"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      data-testid="input"
    />
  ),
  Button: ({ text, onClick, variant, "aria-label": ariaLabel }) => (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      data-variant={variant}
      data-testid="button"
    >
      {text}
    </button>
  ),
  ButtonTabs: ({ items, value, onChange, ariaLabel }) => (
    <div data-testid="button-tabs" aria-label={ariaLabel}>
      {items?.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          data-active={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

describe("Fields module", () => {
  const renderWithProviders = widgetRender(true)

  // Mock translate function
  const mockTranslate = jest.fn((key: string, params?: any) => {
    const translations = {
      placeholderEnter: `Enter ${params?.field}`,
      placeholderSelect: `Select ${params?.field}`,
      placeholderSearch: "Search...",
      placeholderEmail: "Enter email address",
      placeholderPhone: "Enter phone number",
      placeholderTags: "Enter tags separated by commas",
      testField: "Test Field",
      textInput: "Text",
      fileInput: "File",
      geometryFieldMissing: "No geometry provided",
      geometryFieldPreviewLabel: "Geometry preview",
    }
    if (key === "geometryFieldReady") {
      return `Geometry ready (${params?.rings ?? 0} rings, ${
        params?.vertices ?? 0
      } vertices)`
    }
    return translations[key] || key
  })

  beforeEach(() => {
    initStore()
    setTheme(mockTheme)
    jest.clearAllMocks()
  })

  describe("normalizeFormValue", () => {
    test("returns empty string for undefined/null in single select", () => {
      expect(normalizeFormValue(undefined, false)).toBe("")
      expect(normalizeFormValue(null, false)).toBe("")
    })

    test("returns empty array for undefined/null in multi select", () => {
      expect(normalizeFormValue(undefined, true)).toEqual([])
      expect(normalizeFormValue(null, true)).toEqual([])
    })

    test("preserves string and number values for single select", () => {
      expect(normalizeFormValue("test", false)).toBe("test")
      expect(normalizeFormValue(42, false)).toBe(42)
    })

    test("converts arrays properly for multi select", () => {
      expect(normalizeFormValue(["a", "b"], true)).toEqual(["a", "b"])
      expect(normalizeFormValue([1, 2], true)).toEqual([1, 2])
    })

    test("converts non-arrays to array for multi select", () => {
      expect(normalizeFormValue("single", true)).toEqual(["single"])
      expect(normalizeFormValue(42, true)).toEqual([42])
    })

    test("preserves boolean values for single select", () => {
      expect(normalizeFormValue(true, false)).toBe(true)
      expect(normalizeFormValue(false, false)).toBe(false)
    })

    test("converts unsupported types to empty string for single select", () => {
      expect(normalizeFormValue({} as any, false)).toBe("")
      expect(normalizeFormValue([] as any, false)).toBe("")
    })
  })

  describe("makePlaceholders", () => {
    test("creates placeholders with field interpolation", () => {
      const placeholders = makePlaceholders(mockTranslate, "Name")

      expect(placeholders.enter).toBe("Enter Name")
      expect(placeholders.select).toBe("Select Name")
      expect(mockTranslate).toHaveBeenCalledWith("placeholderEnter", {
        field: "Name",
      })
      expect(mockTranslate).toHaveBeenCalledWith("placeholderSelect", {
        field: "Name",
      })
    })
  })

  describe("renderInputField", () => {
    test("renders text input correctly", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("text", "test value", "Enter text", onChange)
      )

      const input = container.querySelector('input[type="text"]')
      expect(input).toHaveValue("test value")
      expect(input).toHaveAttribute("placeholder", "Enter text")
    })

    test("renders password input correctly", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("password", "", "Enter password", onChange)
      )

      const input = container.querySelector('input[type="password"]')
      expect(input).toBeInTheDocument()
    })

    test("renders number input as text with number validation", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("number", 42, "Enter number", onChange)
      )

      const input = container.querySelector('input[type="text"]')
      expect(input).toHaveValue("42")
    })

    test("handles number input changes correctly", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("number", "", "Enter number", onChange)
      )

      const input = container.querySelector('input[type="text"]')
      fireEvent.change(input, { target: { value: "123" } })
      expect(onChange).toHaveBeenCalledWith(123)
    })

    test("handles invalid number input", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("number", "", "Enter number", onChange)
      )

      const input = container.querySelector('input[type="text"]')
      fireEvent.change(input, { target: { value: "invalid" } })
      expect(onChange).toHaveBeenCalledWith("")
    })

    test("handles empty number input", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("number", 42, "Enter number", onChange)
      )

      const input = container.querySelector('input[type="text"]')
      fireEvent.change(input, { target: { value: "" } })
      expect(onChange).toHaveBeenCalledWith("")
    })

    test("handles comma decimal number input", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("number", "", "Enter number", onChange)
      )

      const input = container.querySelector('input[type="text"]')
      fireEvent.change(input, { target: { value: "12,5" } })
      expect(onChange).toHaveBeenCalledWith(12.5)
    })

    test("respects readOnly property", () => {
      const onChange = jest.fn()
      const { container } = renderWithProviders(
        renderInputField("text", "readonly", "Enter text", onChange, true)
      )

      const input = container.querySelector("input")
      expect(input).toBeDisabled()
    })
  })

  describe("DynamicField component", () => {
    const createField = (
      overrides: Partial<DynamicFieldConfig> = {}
    ): DynamicFieldConfig => ({
      name: "testField",
      label: "Test Field",
      type: FormFieldType.TEXT,
      required: false,
      readOnly: false,
      ...overrides,
    })

    test("renders TEXT field correctly", () => {
      const field = createField({ type: FormFieldType.TEXT })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="test value"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveValue("test value")
      expect(input).toHaveAttribute("placeholder", "Test Field...")
    })

    test("renders SELECT field with options", () => {
      const field = createField({
        type: FormFieldType.SELECT,
        options: [
          { value: "opt1", label: "Option 1" },
          { value: "opt2", label: "Option 2" },
        ],
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="opt1"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const select = screen.getByTestId("select")
      expect(select).toHaveValue("opt1")
      expect(screen.getByText("Option 1")).toBeInTheDocument()
      expect(screen.getByText("Option 2")).toBeInTheDocument()
    })

    test("handles SELECT field changes", () => {
      const field = createField({
        type: FormFieldType.SELECT,
        options: [
          { value: "opt1", label: "Option 1" },
          { value: "opt2", label: "Option 2" },
        ],
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="opt1"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const select = screen.getByTestId("select")
      fireEvent.change(select, { target: { value: "opt2" } })
      expect(onChange).toHaveBeenCalledWith("opt2")
    })

    test("renders MULTI_SELECT field", () => {
      const field = createField({
        type: FormFieldType.MULTI_SELECT,
        options: [
          { value: "opt1", label: "Option 1" },
          { value: "opt2", label: "Option 2" },
        ],
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={["opt1"]}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const multiSelect = screen.getByTestId("multi-select")
      expect(multiSelect).toBeInTheDocument()

      const option1 = screen.getByLabelText("Option 1")
      const option2 = screen.getByLabelText("Option 2")
      expect(option1).toBeChecked()
      expect(option2).not.toBeChecked()
    })

    test("handles MULTI_SELECT changes", () => {
      const field = createField({
        type: FormFieldType.MULTI_SELECT,
        options: [
          { value: "opt1", label: "Option 1" },
          { value: "opt2", label: "Option 2" },
        ],
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={["opt1"]}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const option2 = screen.getByLabelText("Option 2")
      fireEvent.click(option2)
      expect(onChange).toHaveBeenCalledWith(["opt1", "opt2"])
    })

    test("renders TEXTAREA field", () => {
      const field = createField({
        type: FormFieldType.TEXTAREA,
        rows: 5,
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="textarea content"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const textarea = screen.getByTestId("textarea")
      expect(textarea).toHaveValue("textarea content")
      expect(textarea).toHaveAttribute("rows", "5")
    })

    test("renders CHECKBOX field", () => {
      const field = createField({ type: FormFieldType.CHECKBOX })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={true}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const checkbox = screen.getByTestId("checkbox")
      // normalizeFormValue converts boolean true to "", and Boolean("") is false
      expect(checkbox).not.toBeChecked()
    })

    test("handles CHECKBOX changes", () => {
      const field = createField({ type: FormFieldType.CHECKBOX })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={false}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const checkbox = screen.getByTestId("checkbox")
      fireEvent.click(checkbox)
      // The actual implementation calls onChange(evt.target.checked),
      // which means the parent onChange should receive the boolean value
      expect(onChange).toHaveBeenCalledWith(true)
    })

    test("renders PASSWORD field", () => {
      const field = createField({
        type: FormFieldType.PASSWORD,
        maxLength: 20,
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="secret"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveValue("secret")
      expect(input).toHaveAttribute("type", "password")
      expect(input).toHaveAttribute("maxLength", "20")
    })

    test("renders FILE field", () => {
      const field = createField({ type: FormFieldType.FILE })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={null}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const fileInput = screen.getByTestId("file-input")
      expect(fileInput).toBeInTheDocument()
      expect(fileInput).toHaveAttribute("type", "file")
    })

    test("renders SWITCH field", () => {
      const field = createField({ type: FormFieldType.SWITCH })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={true}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const switchEl = screen.getByTestId("switch")
      expect(switchEl).toBeChecked()
    })

    test("handles SWITCH changes", () => {
      const field = createField({ type: FormFieldType.SWITCH })
      const onChange = jest.fn()

      const { rerender } = renderWithProviders(
        <DynamicField
          field={field}
          value={false}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const switchEl = screen.getByTestId("switch")
      fireEvent.click(switchEl)
      expect(onChange).toHaveBeenCalledWith(true)

      rerender(
        <DynamicField
          field={field}
          value={true}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const switchElAfter = screen.getByTestId("switch")
      expect(switchElAfter).toBeChecked()
      fireEvent.click(switchElAfter)
      expect(onChange).toHaveBeenLastCalledWith(false)
    })

    test("renders RADIO field", () => {
      const field = createField({
        type: FormFieldType.RADIO,
        options: [
          { value: "opt1", label: "Option 1" },
          { value: "opt2", label: "Option 2" },
        ],
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="opt1"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const radioGroup = screen.getByTestId("radio-group")
      expect(radioGroup).toBeInTheDocument()

      const option1 = screen.getByLabelText("Option 1")
      const option2 = screen.getByLabelText("Option 2")
      expect(option1).toBeChecked()
      expect(option2).not.toBeChecked()
    })

    test("renders SLIDER field with configuration", () => {
      const field = createField({
        type: FormFieldType.SLIDER,
        min: 0,
        max: 100,
        step: 5,
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={50}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const slider = screen.getByTestId("slider")
      expect(slider).toHaveValue("50")
      expect(slider).toHaveAttribute("min", "0")
      expect(slider).toHaveAttribute("max", "100")
      expect(slider).toHaveAttribute("step", "5")
    })

    test("renders NUMERIC_INPUT field with configuration", () => {
      const field = createField({
        type: FormFieldType.NUMERIC_INPUT,
        min: 0,
        max: 100,
        step: 0.1,
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={42.5}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const numericInput = screen.getByTestId("numeric-input")
      expect(numericInput).toHaveValue(42.5)
      expect(numericInput).toHaveAttribute("min", "0")
      expect(numericInput).toHaveAttribute("max", "100")
      expect(numericInput).toHaveAttribute("step", "0.1")
    })

    test("renders URL field", () => {
      const field = createField({ type: FormFieldType.URL })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="https://example.com"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const urlInput = screen.getByTestId("url-input")
      expect(urlInput).toHaveValue("https://example.com")
      expect(urlInput).toHaveAttribute("type", "url")
    })

    test("renders DATE_TIME field", () => {
      const field = createField({ type: FormFieldType.DATE_TIME })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="20231225103000"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveValue("2023-12-25T10:30")
      expect(input).toHaveAttribute("type", "datetime-local")
    })

    test("DATE_TIME onChange converts to FME format", () => {
      const field = createField({ type: FormFieldType.DATE_TIME })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value=""
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      fireEvent.change(input, { target: { value: "2023-12-31T09:05" } })
      expect(onChange).toHaveBeenCalledWith("20231231090500")
    })

    test("renders TAG_INPUT field", () => {
      const field = createField({ type: FormFieldType.TAG_INPUT })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={["tag1", "tag2"]}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const tagInput = screen.getByTestId("tag-input")
      // normalizeFormValue converts array to "" when isMulti=false,
      // then TagInput gets empty array, so displays empty value
      expect(tagInput).toHaveValue("")
    })

    test("renders COLOR field", () => {
      const field = createField({ type: FormFieldType.COLOR })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="#ff0000"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const colorPicker = screen.getByTestId("color-picker")
      expect(colorPicker).toHaveValue("#ff0000")
      expect(colorPicker).toHaveAttribute("type", "color")
    })

    test("renders DATE field", () => {
      const field = createField({ type: FormFieldType.DATE })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="20231225"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const datePicker = screen.getByTestId("input")
      expect(datePicker).toHaveValue("2023-12-25T00:00:00")
      expect(datePicker).toHaveAttribute("type", "datetime-local")
    })

    test("renders MONTH field", () => {
      const field = createField({ type: FormFieldType.MONTH })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="2024-05"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveAttribute("type", "month")
      expect(input).toHaveValue("2024-05")
    })

    test("renders WEEK field", () => {
      const field = createField({ type: FormFieldType.WEEK })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="2024-W22"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveAttribute("type", "week")
      expect(input).toHaveValue("2024-W22")
    })

    test("renders HIDDEN field as no-op", () => {
      const field = createField({ type: FormFieldType.HIDDEN })
      const onChange = jest.fn()

      const { container } = renderWithProviders(
        <DynamicField
          field={field}
          value="secret"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      // Should produce no visible input element
      expect(container.querySelector("input")).toBeNull()
    })

    test("DATE onChange converts to FME format", () => {
      const field = createField({ type: FormFieldType.DATE })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value=""
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const datePicker = screen.getByTestId("input")
      fireEvent.change(datePicker, {
        target: { value: "2024-01-07T16:30:45" },
      })
      expect(onChange).toHaveBeenCalledWith("20240107")
    })

    test("renders TIME field", () => {
      const field = createField({ type: FormFieldType.TIME })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="1430"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveValue("14:30")
      expect(input).toHaveAttribute("type", "time")
    })

    test("TIME onChange converts to FME format (HHmmss)", () => {
      const field = createField({ type: FormFieldType.TIME })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value=""
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      fireEvent.change(input, { target: { value: "09:07" } })
      expect(onChange).toHaveBeenCalledWith("090700")
    })

    test("renders EMAIL field", () => {
      const field = createField({ type: FormFieldType.EMAIL })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="test@example.com"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveValue("test@example.com")
      expect(input).toHaveAttribute("type", "email")
    })

    test("COLOR onChange emits normalized rgb floats", () => {
      const field = createField({ type: FormFieldType.COLOR })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="#000000"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const colorPicker = screen.getByTestId("color-picker")
      fireEvent.change(colorPicker, { target: { value: "#ff0000" } })
      expect(onChange).toHaveBeenCalledWith("1,0,0")
    })

    test("renders PHONE field", () => {
      const field = createField({ type: FormFieldType.PHONE })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="+1234567890"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveValue("+1234567890")
      expect(input).toHaveAttribute("type", "tel")
    })

    test("renders SEARCH field", () => {
      const field = createField({ type: FormFieldType.SEARCH })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="search query"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveValue("search query")
      expect(input).toHaveAttribute("type", "search")
      expect(input).toHaveAttribute("placeholder", "Sök...")
    })

    test("respects readOnly property across field types", () => {
      const field = createField({
        type: FormFieldType.TEXT,
        readOnly: true,
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="readonly value"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toBeDisabled()
    })

    test("handles single option SELECT field auto-selection", () => {
      const field = createField({
        type: FormFieldType.SELECT,
        options: [{ value: "only", label: "Only Option" }],
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value=""
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      // Should auto-select the single option
      expect(onChange).toHaveBeenCalledWith("only")
    })

    test("handles numeric coercion for SELECT fields", () => {
      const field = createField({
        type: FormFieldType.SELECT,
        options: [
          { value: "1", label: "One" },
          { value: "2", label: "Two" },
        ],
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value="1"
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const select = screen.getByTestId("select")
      expect(select).toHaveValue("1")
    })

    test("renders field with custom placeholder", () => {
      const field = createField({
        type: FormFieldType.TEXT,
        placeholder: "Custom placeholder",
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value=""
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const input = screen.getByTestId("input")
      expect(input).toHaveAttribute("placeholder", "Custom placeholder")
    })

    test("renders MESSAGE field using sanitized rich text", () => {
      const field = createField({
        type: FormFieldType.MESSAGE,
        description: "Hello <script>alert('x')</script><b>World</b>",
      })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={undefined}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const msg = screen.getByTestId("rich-text")
      expect(msg).toBeInTheDocument()
      expect(msg).toHaveTextContent("Hello World")
    })

    test("renders TABLE field and supports add/remove/edit rows", () => {
      const field = createField({
        type: FormFieldType.TABLE,
        placeholder: "Row value",
      })
      const onChange = jest.fn()

      const { rerender } = renderWithProviders(
        <DynamicField
          field={field}
          value={[]}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      // Initially empty state
      expect(screen.getByText("Inga rader tillagda")).toBeInTheDocument()
      expect(screen.queryByRole("table")).not.toBeInTheDocument()

      // Add a row
      fireEvent.click(screen.getByRole("button", { name: "Lägg till rad" }))
      expect(onChange).toHaveBeenLastCalledWith([""])

      // Re-render with one empty row
      onChange.mockClear()
      rerender(
        <DynamicField
          field={field}
          value={[""]}
          onChange={onChange}
          translate={mockTranslate}
        />
      )
      expect(screen.getByRole("table")).toBeInTheDocument()
      const input = screen.getByTestId("input")
      fireEvent.change(input, { target: { value: "abc" } })
      expect(onChange).toHaveBeenLastCalledWith(["abc"])

      // Delete the row
      onChange.mockClear()
      fireEvent.click(screen.getByRole("button", { name: "Ta bort" }))
      expect(onChange).toHaveBeenLastCalledWith([])
    })

    test("renders TEXT_OR_FILE field with text mode by default", () => {
      const field = createField({ type: FormFieldType.TEXT_OR_FILE })
      const onChange = jest.fn()

      renderWithProviders(
        <DynamicField
          field={field}
          value={undefined}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      expect(screen.getByTestId("button-tabs")).toBeInTheDocument()
      const textarea = screen.getByTestId("textarea")
      expect(textarea).toBeInTheDocument()
      expect(textarea).toHaveAttribute("placeholder", "Enter Test Field")
    })

    test("TEXT_OR_FILE toggles to file mode and surfaces file name", () => {
      const field = createField({ type: FormFieldType.TEXT_OR_FILE })
      const onChange = jest.fn()

      const { rerender } = renderWithProviders(
        <DynamicField
          field={field}
          value={{ mode: "text", text: "hello" } as any}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const switchButtons = screen
        .getByTestId("button-tabs")
        .querySelectorAll("button")
      expect(switchButtons).toHaveLength(2)

      fireEvent.click(switchButtons[1])
      expect(onChange).toHaveBeenCalledWith({
        mode: "file",
        file: null,
        fileName: undefined,
      })

      const fileValue = {
        mode: "file",
        file: { name: "data.csv", size: 1, type: "text/csv" },
        fileName: "data.csv",
      }
      rerender(
        <DynamicField
          field={field}
          value={fileValue as any}
          onChange={onChange}
          translate={mockTranslate}
        />
      )

      const fileInput = screen.getByTestId("file-input")
      expect(fileInput).toBeInTheDocument()
      expect(screen.getByTestId("text-or-file-name")).toHaveTextContent(
        "data.csv"
      )
    })

    test("renders SCRIPTED field as read-only rich text", () => {
      const field = createField({
        type: FormFieldType.SCRIPTED,
        description: "<b>Generated value</b>",
      })

      renderWithProviders(
        <DynamicField
          field={field}
          value={"<script>alert('x')</script>Value"}
          onChange={jest.fn()}
          translate={mockTranslate}
        />
      )

      const rich = screen.getByTestId("rich-text")
      expect(rich).toHaveTextContent("Value")
    })

    test("renders GEOMETRY field placeholder when value missing", () => {
      const field = createField({
        type: FormFieldType.GEOMETRY,
        readOnly: true,
      })

      renderWithProviders(
        <DynamicField
          field={field}
          value=""
          onChange={jest.fn()}
          translate={mockTranslate}
        />
      )

      const geometry = screen.getByTestId("geometry-field")
      expect(geometry).toHaveTextContent("No geometry provided")
    })

    test("renders GEOMETRY field summary and JSON preview", () => {
      const field = createField({
        type: FormFieldType.GEOMETRY,
        readOnly: true,
      })
      const geometryJson = JSON.stringify({
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      })

      renderWithProviders(
        <DynamicField
          field={field}
          value={geometryJson}
          onChange={jest.fn()}
          translate={mockTranslate}
        />
      )

      expect(
        screen.getByText("Geometry ready (1 rings, 4 vertices)")
      ).toBeInTheDocument()
      const preview = screen.getByLabelText("Geometry preview")
      expect(preview.tagName).toBe("PRE")
      expect(preview).toHaveTextContent('\n  "rings":')
    })
  })
})
