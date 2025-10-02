import { React } from "jimu-core"
import "@testing-library/jest-dom"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { initGlobal, withThemeIntlRender } from "jimu-for-test"
import {
  Tooltip,
  Button,
  Icon,
  Input,
  TextArea,
  Select,
  MultiSelectControl,
  DateTimePickerWrapper,
  StateView,
  Form,
  Field,
  renderSupportHint,
  config,
} from "../runtime/components/ui"
import { DynamicField } from "../runtime/components/fields"
import { FormFieldType, type DynamicFieldConfig } from "../config"

jest.mock("jimu-ui", () => {
  const React = require("react")
  const filterProps = (props: any = {}) => {
    const { css: _css, block: _block, style: inlineStyle, ...rest } = props
    return inlineStyle ? { ...rest, style: inlineStyle } : rest
  }

  const TextInput = React.forwardRef((props: any, ref: any) => {
    const { onChange, onBlur, type = "text", ...rest } = filterProps(props)
    return (
      <input
        ref={ref}
        type={type}
        data-testid="mock-text-input"
        {...rest}
        onChange={(event) => onChange?.(event)}
        onBlur={(event) => onBlur?.(event)}
      />
    )
  })
  TextInput.displayName = "MockTextInput"

  const JimuTooltip = ({ title, placement, children, ...rest }) => (
    <div
      data-testid="mock-tooltip"
      data-title={title}
      data-placement={placement}
      {...filterProps(rest)}
    >
      {children}
    </div>
  )

  const LoadingType = { Donut: "donut" }
  const Loading = (props: any) => (
    <div
      data-testid="mock-loading"
      data-type={props.type}
      {...filterProps(props)}
    />
  )

  const JimuButton = React.forwardRef((props: any, ref: any) => {
    const { children, onClick, disabled, type, style, ...rest } =
      filterProps(props)
    return (
      <button
        ref={ref}
        type={type || "button"}
        disabled={disabled}
        style={style}
        {...rest}
        onClick={(event) => {
          if (disabled) return
          onClick?.(event)
        }}
      >
        {children}
      </button>
    )
  })
  JimuButton.displayName = "MockJimuButton"

  const AdvancedButtonGroup = (props: any) => (
    <div data-testid="mock-advanced-button-group" {...filterProps(props)}>
      {props.children}
    </div>
  )

  const JimuOption = (props: any) => {
    const { value, children, onClick, disabled, active, ...rest } = props
    return (
      <button
        {...filterProps(rest)}
        type="button"
        data-value={value}
        aria-pressed={active}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event)
        }}
      >
        {children}
      </button>
    )
  }

  const JimuSelect = (props: any) => {
    const { children, ...rest } = props
    const optionElements = React.Children.toArray(children).map(
      (child: any, index: number) => {
        if (!React.isValidElement(child)) return child
        const optionValue = child.props.value
        const disabled = child.props.disabled
        const active = String(optionValue) === String(props.value ?? "")
        return (
          <button
            key={child.key ?? index}
            type="button"
            data-value={optionValue}
            data-active={active}
            disabled={disabled}
            onClick={(event) => {
              child.props.onClick?.(event)
            }}
          >
            {child.props.children}
          </button>
        )
      }
    )
    return (
      <div
        data-testid="mock-select"
        data-value={props.value ?? ""}
        data-placeholder={props.placeholder}
        {...filterProps(rest)}
      >
        {optionElements}
      </div>
    )
  }

  const FormGroup = (props: any) => (
    <div data-testid="mock-form-group" {...filterProps(props)}>
      {props.children}
    </div>
  )

  const Label = (props: any) => {
    const { for: htmlFor, check, children, ...rest } = props
    return (
      <label {...filterProps(rest)} htmlFor={htmlFor} data-check={check}>
        {children}
      </label>
    )
  }

  const JimuTextArea = (props: any) => {
    const { onChange, onBlur, ...rest } = filterProps(props)
    return (
      <textarea
        data-testid="mock-textarea"
        {...rest}
        onChange={(event) => onChange?.(event)}
        onBlur={(event) => onBlur?.(event)}
      />
    )
  }

  const JimuCheckbox = (props: any) => {
    const { onChange, ...rest } = filterProps(props)
    return (
      <input
        type="checkbox"
        data-testid="mock-checkbox"
        {...rest}
        onChange={(event) => onChange?.(event)}
      />
    )
  }

  const JimuUrlInput = (props: any) => {
    const { onChange, value, defaultValue, ...rest } = filterProps(props)
    return (
      <input
        type="url"
        defaultValue={defaultValue}
        value={value}
        data-testid="mock-url-input"
        {...rest}
        onChange={(event) => onChange?.({ value: event.target.value })}
      />
    )
  }

  const JimuSwitch = (props: any) => {
    const { checked, onChange, ...rest } = filterProps(props)
    return (
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        data-testid="mock-switch"
        {...rest}
        onChange={(event) => onChange?.(event, event.target.checked)}
      />
    )
  }

  const JimuRadio = (props: any) => {
    const { value, checked, defaultChecked, onChange, disabled, children } =
      props
    return (
      <label>
        <input
          type="radio"
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onChange={(event) => onChange?.(event)}
        />
        <span>{children}</span>
      </label>
    )
  }

  const JimuSlider = (props: any) => {
    const { onChange, ...rest } = filterProps(props)
    return (
      <input
        type="range"
        data-testid="mock-slider"
        {...rest}
        onChange={(event) => onChange?.(event)}
      />
    )
  }

  const JimuNumericInput = (props: any) => {
    const { onChange, ...rest } = filterProps(props)
    return (
      <input
        type="number"
        data-testid="mock-numeric-input"
        {...rest}
        onChange={(event) => {
          const value = event.target.value
          const num = Number(value)
          onChange?.(Number.isFinite(num) ? num : value)
        }}
      />
    )
  }

  const JimuTagInput = (props: any) => {
    const { onChange, values, ...rest } = filterProps(props)
    return (
      <input
        type="text"
        defaultValue={(values || []).join(",")}
        data-testid="mock-tag-input"
        {...rest}
        onChange={(event) =>
          onChange?.(event.target.value.split(",").map((v) => v.trim()))
        }
      />
    )
  }

  const MultiSelect = (props: any) => {
    const { items = [], values = [], onChange, ...rest } = filterProps(props)
    return (
      <div data-testid="mock-multi-select" {...rest}>
        {items.map((item: any) => {
          const active = values.includes(item.value)
          return (
            <button
              key={item.value}
              type="button"
              data-value={item.value}
              data-active={active}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return
                const exists = values.includes(item.value)
                const next = exists
                  ? values.filter((v) => v !== item.value)
                  : [...values, item.value]
                onChange?.(item.value, next)
              }}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    )
  }

  const SVG = (props: any) => {
    const { src, size, role = "img", ...rest } = filterProps(props)
    return (
      <svg
        role={role}
        data-testid="mock-svg"
        data-src={src}
        data-size={size}
        {...rest}
      />
    )
  }

  const JimuTable = (props: any) => (
    <table data-testid="mock-table" {...filterProps(props)}>
      {props.children}
    </table>
  )

  const RichDisplayer = (props: any) => (
    <div
      data-testid="mock-rich-displayer"
      dangerouslySetInnerHTML={{ __html: props.value || "" }}
    />
  )

  return {
    TextInput,
    Tooltip: JimuTooltip,
    Button: JimuButton,
    AdvancedButtonGroup,
    Select: JimuSelect,
    Option: JimuOption,
    FormGroup,
    Label,
    TextArea: JimuTextArea,
    Loading,
    LoadingType,
    Checkbox: JimuCheckbox,
    UrlInput: JimuUrlInput,
    Switch: JimuSwitch,
    Radio: JimuRadio,
    Slider: JimuSlider,
    NumericInput: JimuNumericInput,
    TagInput: JimuTagInput,
    MultiSelect,
    SVG,
    Table: JimuTable,
    RichDisplayer,
  }
})

jest.mock("jimu-ui/basic/color-picker", () => {
  const filterProps = (props: any = {}) => {
    const { css: _css, ...rest } = props
    return rest
  }
  return {
    ColorPicker: (props: any) => {
      const { onChange, color, ...rest } = filterProps(props)
      return (
        <input
          type="color"
          data-testid="mock-color-picker"
          defaultValue={color}
          {...rest}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )
    },
  }
})

const datePickerPropsRef: {
  lastProps?: any
  changeHandler?: (value: any, label: string) => void
} = {}

jest.mock("jimu-ui/basic/date-picker", () => {
  const filterProps = (props: any = {}) => {
    const { css: _css, ...rest } = props
    return rest
  }
  const DatePicker = (props: any) => {
    datePickerPropsRef.lastProps = props
    const { onChange, onSelectedDateChange, selectedDate, ...rest } =
      filterProps(props)
    const handler =
      typeof onChange === "function"
        ? onChange
        : typeof onSelectedDateChange === "function"
          ? onSelectedDateChange
          : undefined
    datePickerPropsRef.changeHandler = handler
    return (
      <button
        type="button"
        data-testid="mock-date-picker"
        {...rest}
        onClick={() =>
          handler?.(selectedDate ? selectedDate.getTime() : Date.now(), "")
        }
      >
        mock-date-picker
      </button>
    )
  }
  return {
    DatePicker,
    __triggerChange: (value: any, label = "") => {
      datePickerPropsRef.changeHandler?.(value, label)
    },
    __getLastProps: () => datePickerPropsRef.lastProps,
    __hasChangeHandler: () =>
      typeof datePickerPropsRef.changeHandler === "function",
  }
})

const renderWithProviders = withThemeIntlRender()

beforeAll(() => {
  initGlobal()
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe("Tooltip component", () => {
  it("wraps children when content is provided and sanitizes placement", () => {
    renderWithProviders(
      <Tooltip content="Info" placement={"auto" as unknown as any}>
        <button type="button">Child</button>
      </Tooltip>
    )
    const tooltip = screen.getByTestId("mock-tooltip")
    expect(tooltip).toHaveAttribute("data-placement", "top")
    const child = screen.getByRole("button", { name: "Child" })
    expect(child).toBeInTheDocument()
  })

  it("returns children untouched when disabled", () => {
    renderWithProviders(
      <Tooltip content="Disabled" disabled>
        <button type="button">Target</button>
      </Tooltip>
    )
    expect(screen.queryByTestId("mock-tooltip")).toBeNull()
    expect(screen.getByRole("button", { name: "Target" })).toBeInTheDocument()
  })
})

describe("Button component", () => {
  it("calls onClick when enabled and wraps with tooltip", () => {
    const handleClick = jest.fn()
    renderWithProviders(
      <Button text="Run" tooltip="Go" onClick={handleClick} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    expect(handleClick).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("mock-tooltip")).toHaveAttribute(
      "data-title",
      "Go"
    )
  })

  it("prevents clicks while loading and sets aria-busy flag", () => {
    const handleClick = jest.fn()
    renderWithProviders(
      <Button text="Load" loading tooltip="Busy" onClick={handleClick} />
    )
    const button = screen.getByRole("button", { name: "Load" })
    fireEvent.click(button)
    expect(handleClick).not.toHaveBeenCalled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(screen.getByTestId("mock-loading")).toBeInTheDocument()
  })
})

describe("Icon component", () => {
  it("defaults to aria-hidden when no label is provided", () => {
    renderWithProviders(<Icon src="warning" />)
    const icon = screen.getByRole("img", { hidden: true })
    expect(icon).toHaveAttribute("aria-hidden", "true")
  })

  it("exposes aria-label when provided", () => {
    renderWithProviders(<Icon src="warning" aria-label="Warning icon" />)
    const icon = screen.getByLabelText("Warning icon")
    expect(icon).toHaveAttribute("aria-hidden", "false")
  })
})

describe("Input components", () => {
  it("forwards change and blur events with validation attributes", () => {
    const handleChange = jest.fn()
    const handleBlur = jest.fn()
    renderWithProviders(
      <Input
        required
        errorText="Error"
        onChange={handleChange}
        onBlur={handleBlur}
      />
    )
    const input = screen.getByTestId("mock-text-input")
    fireEvent.change(input, { target: { value: "abc" } })
    expect(handleChange).toHaveBeenCalledWith("abc")
    expect(input).toHaveAttribute("aria-required", "true")
    fireEvent.blur(input, { target: { value: "abc" } })
    expect(handleBlur).toHaveBeenCalledWith("abc")
  })

  it("normalizes numeric values via DynamicField", () => {
    const handleValue = jest.fn()
    const field: DynamicFieldConfig = {
      type: FormFieldType.NUMBER,
      name: "testNumber",
      label: "Test Number",
      required: false,
      readOnly: false,
    }
    renderWithProviders(
      <DynamicField
        field={field}
        value=""
        onChange={handleValue}
        translate={undefined}
      />
    )
    const input = screen.getByTestId("mock-text-input")
    fireEvent.change(input, { target: { value: "1,5" } })
    expect(handleValue).toHaveBeenLastCalledWith(1.5)
    fireEvent.change(input, { target: { value: "abc" } })
    expect(handleValue).toHaveBeenLastCalledWith("")
  })
})

describe("Select controls", () => {
  it("coerces selected values to numbers when requested", () => {
    const handleSelect = jest.fn()
    renderWithProviders(
      <Select
        options={[
          { label: "One", value: "1" },
          { label: "Two", value: "2" },
        ]}
        value="1"
        onChange={handleSelect}
        coerce="number"
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Two" }))
    expect(handleSelect).toHaveBeenCalledWith(2)
  })

  it("emits multi-select changes with sanitized values", () => {
    const handleChange = jest.fn()
    renderWithProviders(
      <MultiSelectControl
        options={[
          { label: "Alpha", value: "a" },
          { label: "Bravo", value: "b" },
        ]}
        onChange={handleChange}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }))
    expect(handleChange).toHaveBeenLastCalledWith(["a"])
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }))
    expect(handleChange).toHaveBeenLastCalledWith([])
  })
})

describe("DateTimePickerWrapper", () => {
  it("forwards aria-label and renders picker button", () => {
    renderWithProviders(<DateTimePickerWrapper aria-label="Start" />)
    const pickerButton = screen.getByRole("button", { name: "Start" })
    expect(pickerButton).toHaveAttribute("data-testid", "mock-date-picker")
    expect(pickerButton).toHaveAttribute("aria-label", "Start")
  })

  it("renders disabled wrapper with aria-disabled set", () => {
    renderWithProviders(
      <DateTimePickerWrapper value="2025-10-02T08:15:00" disabled />
    )
    const disabledWrapper = screen
      .getByTestId("mock-date-picker")
      .closest('span[aria-disabled="true"]')
    expect(disabledWrapper).not.toBeNull()
  })
})

describe("StateView component", () => {
  it("renders error state with action buttons", () => {
    const handleRetry = jest.fn()
    renderWithProviders(
      <StateView
        state={{
          kind: "error",
          message: "Oops",
          code: "CFG",
          actions: [
            { label: "Retry", onClick: handleRetry, variant: "contained" },
          ],
        }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(handleRetry).toHaveBeenCalled()
    expect(screen.getByText("Oops")).toBeInTheDocument()
  })

  it("latches loading indicator until delay elapses", () => {
    jest.useFakeTimers()
    const { rerender } = renderWithProviders(
      <StateView
        state={{
          kind: "loading",
          message: "Loading",
          detail: "Please wait",
        }}
      />
    )
    expect(screen.getByTestId("mock-loading")).toBeInTheDocument()
    rerender(
      <StateView state={{ kind: "success", message: "Done", actions: [] }} />
    )
    expect(screen.getByTestId("mock-loading")).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(config.loading.delay)
    })
    expect(screen.queryByTestId("mock-loading")).toBeNull()
    jest.useRealTimers()
  })
})

describe("Form and Field components", () => {
  it("renders layout variant with primary and secondary actions", () => {
    const handleBack = jest.fn()
    const handleSubmit = jest.fn()
    renderWithProviders(
      <Form
        variant="layout"
        title="Title"
        subtitle="Subtitle"
        onBack={handleBack}
        onSubmit={handleSubmit}
      >
        <TextArea defaultValue="Body" />
      </Form>
    )
    expect(screen.getByText("Title")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tillbaka" }))
    expect(handleBack).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Beställ" }))
    expect(handleSubmit).toHaveBeenCalled()
  })

  it("renders required mark and helper text inside Field wrapper", () => {
    renderWithProviders(
      <Field label="Name" required helper="Helper text">
        <Input defaultValue="" onChange={jest.fn()} />
      </Field>
    )
    expect(screen.getByText("Helper text")).toBeInTheDocument()
    expect(screen.getByText("*")).toBeInTheDocument()
  })
})

describe("renderSupportHint", () => {
  const translateStub = (key: string, vars?: { [key: string]: unknown }) => {
    if (key === "contactSupportWithEmail") {
      const email = typeof vars?.email === "string" ? vars.email : "{email}"
      return `Contact ${email}`
    }
    return key
  }

  it("returns fallback text when no email is configured", () => {
    renderWithProviders(
      <React.Fragment>
        {renderSupportHint(
          undefined,
          translateStub,
          { typography: { link: {} } } as any,
          "Fallback"
        )}
      </React.Fragment>
    )
    expect(screen.getByText("Fallback")).toBeInTheDocument()
  })

  it("renders mailto link when email is provided", () => {
    renderWithProviders(
      <React.Fragment>
        {renderSupportHint(
          "support@example.com",
          translateStub,
          { typography: { link: {} } } as any,
          "Fallback"
        )}
      </React.Fragment>
    )
    const link = screen.getByText("support@example.com")
    expect(link).toHaveAttribute("href", "mailto:support@example.com")
  })
})

describe("DynamicField component", () => {
  const baseField = (
    overrides: Partial<DynamicFieldConfig> = {}
  ): DynamicFieldConfig => ({
    name: "field",
    label: "Field",
    type: FormFieldType.TEXT,
    required: false,
    readOnly: false,
    options: [],
    ...overrides,
  })

  it("auto-selects single option dropdowns", async () => {
    const handleChange = jest.fn()
    renderWithProviders(
      <DynamicField
        field={baseField({
          type: FormFieldType.SELECT,
          options: [{ label: "Only", value: "only" }],
        })}
        value=""
        onChange={handleChange}
        translate={(key: string) => key}
      />
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(handleChange).toHaveBeenCalledWith("only")
  })

  it("switches between text and file modes for text-or-file fields", async () => {
    const handleChange = jest.fn()
    const Wrapper: React.FC = () => {
      const [fieldValue, setFieldValue] = React.useState<any>({
        mode: "text",
        text: "initial",
      })
      return (
        <DynamicField
          field={baseField({ type: FormFieldType.TEXT_OR_FILE })}
          value={fieldValue}
          onChange={(val) => {
            setFieldValue(val)
            handleChange(val as any)
          }}
          translate={(key: string) => key}
        />
      )
    }
    renderWithProviders(<Wrapper />)
    fireEvent.click(screen.getByRole("tab", { name: "fileInput" }))
    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "file", file: null })
      )
    })
    const file = new File(["dummy"], "dummy.txt", { type: "text/plain" })
    const fileNodes = await screen.findAllByLabelText("Field")
    const fileInput = fileNodes.find(
      (node): node is HTMLInputElement =>
        node instanceof HTMLInputElement && node.type === "file"
    )
    if (!fileInput) {
      throw new Error("File input element was not found")
    }
    fireEvent.change(fileInput, {
      target: { files: [file] },
    })
    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "file", file, fileName: "dummy.txt" })
      )
    })
  })

  it("renders geometry placeholder when no value is provided", () => {
    renderWithProviders(
      <DynamicField
        field={baseField({ type: FormFieldType.GEOMETRY })}
        value=""
        onChange={jest.fn()}
        translate={(key: string) => key}
      />
    )
    expect(screen.getByText("geometryFieldMissing")).toBeInTheDocument()
  })
})
