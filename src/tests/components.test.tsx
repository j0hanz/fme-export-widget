import "@testing-library/jest-dom"
import { act, screen, fireEvent } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal, mockTheme, withThemeIntlRender } from "jimu-for-test"
import { DynamicField } from "../runtime/components/fields"
import { StateView, Icon, Slider } from "../runtime/components/ui"
import { FormFieldType } from "../config/index"

// Mock jimu-ui NumericInput to prevent theme/Tooltip initialization errors
jest.mock("jimu-ui", () => {
  const actual = jest.requireActual("jimu-ui")
  return {
    ...actual,
    NumericInput: jest.fn((props) => {
      const {
        value,
        defaultValue,
        onChange,
        min,
        max,
        placeholder,
        disabled,
        ...rest
      } = props
      return (
        <input
          {...rest}
          type="number"
          value={value ?? defaultValue ?? ""}
          onChange={(e) => {
            const val =
              e.target.value === "" ? undefined : parseFloat(e.target.value)
            onChange?.(val)
          }}
          min={min}
          max={max}
          placeholder={placeholder}
          disabled={disabled}
        />
      )
    }),
  }
})

initGlobal()

const renderWithTheme = withThemeIntlRender(mockTheme as any)

const getSliderLiveValue = (expected: string) =>
  screen.getByText((content, element) => {
    if (content !== expected || !element) return false
    const ariaLive = element.getAttribute("aria-live")
    const role = element.getAttribute("role")
    return ariaLive === "polite" && role === "status"
  })

describe("runtime components", () => {
  describe("StateView", () => {
    it("renders an error message with accessible roles", () => {
      const retry = jest.fn()
      const actions = [
        {
          label: "Retry",
          onClick: retry,
          disabled: false,
          variant: "contained" as const,
        },
      ]

      renderWithTheme(
        <StateView
          state={{
            kind: "error",
            message: "Unable to load",
            code: "ERR42",
            detail: "Network timeout",
            recoverable: true,
            actions,
          }}
        />
      )

      const alert = screen.getByRole("alert")
      expect(alert).toHaveTextContent("Unable to load")
      expect(alert).toHaveTextContent("ERR42")

      const button = screen.getByRole("button", { name: "Retry" })
      button.click()
      expect(retry).toHaveBeenCalledTimes(1)
    })

    it("cycles through queued loading messages", () => {
      jest.useFakeTimers()

      const state = {
        kind: "loading" as const,
        message: "Preparing",
        detail: "Fetching data",
        messages: ["Validating", "Finalising"],
      }

      renderWithTheme(<StateView state={state} />)

      const status = screen.getByRole("status")
      expect(status).toHaveTextContent("Preparing")

      act(() => {
        jest.advanceTimersByTime(1700)
      })

      expect(screen.getByRole("status")).toHaveTextContent("Fetching data")

      act(() => {
        jest.advanceTimersByTime(5200)
      })

      expect(screen.getByRole("status")).toHaveTextContent("Validating")

      act(() => {
        jest.advanceTimersByTime(5200)
      })

      expect(screen.getByRole("status")).toHaveTextContent("Finalising")

      jest.useRealTimers()
    })
  })

  describe("DynamicField - range slider", () => {
    it("shows current slider value with integer precision", () => {
      renderWithTheme(
        <DynamicField
          field={{
            name: "range",
            label: "Range",
            type: FormFieldType.SLIDER,
            required: true,
            readOnly: false,
            min: 6,
            max: 8,
            step: 1,
            decimalPrecision: 0,
          }}
          value={7}
          onChange={jest.fn()}
          translate={(key) => key}
        />
      )

      expect(getSliderLiveValue("7")).toBeInTheDocument()
    })

    it("formats slider label using provided decimal precision", () => {
      const field = {
        name: "range",
        label: "Range",
        type: FormFieldType.SLIDER,
        required: true,
        readOnly: false,
        min: 1,
        max: 10,
        step: 0.01,
        decimalPrecision: 2,
      } as const
      const handleChange = jest.fn()

      const { rerender } = renderWithTheme(
        <DynamicField
          field={field}
          value={7.25}
          onChange={handleChange}
          translate={(key) => key}
        />
      )

      expect(getSliderLiveValue("7.25")).toBeInTheDocument()

      rerender(
        <DynamicField
          field={field}
          value={6.5}
          onChange={handleChange}
          translate={(key) => key}
        />
      )

      expect(getSliderLiveValue("6.50")).toBeInTheDocument()
    })
  })

  describe("Slider component", () => {
    it("hides value display when showValue is false", () => {
      renderWithTheme(
        <Slider
          value={5}
          min={0}
          max={10}
          showValue={false}
          onChange={jest.fn()}
        />
      )

      expect(screen.queryByRole("status")).toBeNull()
    })

    it("falls back to string formatting without decimal precision", () => {
      renderWithTheme(
        <Slider value={6.5} min={0} max={10} onChange={jest.fn()} />
      )

      expect(getSliderLiveValue("6.5")).toBeInTheDocument()
    })

    it("updates displayed value when user changes slider", () => {
      const Wrapper: React.FC = () => {
        const [current, setCurrent] = React.useState(2)
        return (
          <Slider
            value={current}
            min={0}
            max={10}
            decimalPrecision={0}
            onChange={setCurrent}
          />
        )
      }

      renderWithTheme(<Wrapper />)

      const input = screen.getByRole("slider")
      fireEvent.change(input, { target: { value: "5" } })

      expect(getSliderLiveValue("5")).toBeInTheDocument()
    })
  })

  describe("DynamicField - numeric input validation", () => {
    it("displays error for decimal input when integer required", () => {
      const translate = (key: string, params?: any) => {
        if (key === "integerRequired")
          return "Heltal krävs (decimaler ej tillåtna)"
        return key
      }

      renderWithTheme(
        <DynamicField
          field={{
            name: "int_param",
            label: "Integer Parameter",
            type: FormFieldType.NUMERIC_INPUT,
            required: true,
            readOnly: false,
            min: 1,
            max: 10,
            decimalPrecision: 0,
          }}
          value={7.5}
          onChange={jest.fn()}
          translate={translate}
        />
      )

      const error = screen.getByTestId("numeric-input-error")
      expect(error).toHaveTextContent("Heltal krävs (decimaler ej tillåtna)")
      expect(error).toHaveAttribute("role", "alert")
    })

    it("displays error when value exceeds exclusive maximum", () => {
      const translate = (key: string, params?: any) => {
        if (key === "mustBeLessThan")
          return `Måste vara mindre än ${params.value}`
        return key
      }

      renderWithTheme(
        <DynamicField
          field={{
            name: "exclusive_param",
            label: "Exclusive Parameter",
            type: FormFieldType.NUMERIC_INPUT,
            required: true,
            readOnly: false,
            min: 0,
            max: 10,
            maxExclusive: true,
            decimalPrecision: 0,
          }}
          value={10}
          onChange={jest.fn()}
          translate={translate}
        />
      )

      const error = screen.getByTestId("numeric-input-error")
      expect(error).toHaveTextContent("Måste vara mindre än 10")
    })

    it("displays error when value is below exclusive minimum", () => {
      const translate = (key: string, params?: any) => {
        if (key === "mustBeGreaterThan")
          return `Måste vara större än ${params.value}`
        return key
      }

      renderWithTheme(
        <DynamicField
          field={{
            name: "exclusive_min",
            label: "Exclusive Min",
            type: FormFieldType.NUMERIC_INPUT,
            required: true,
            readOnly: false,
            min: 5,
            max: 15,
            minExclusive: true,
            decimalPrecision: 0,
          }}
          value={5}
          onChange={jest.fn()}
          translate={translate}
        />
      )

      const error = screen.getByTestId("numeric-input-error")
      expect(error).toHaveTextContent("Måste vara större än 5")
    })

    it("does not display error for valid decimal input with float precision", () => {
      renderWithTheme(
        <DynamicField
          field={{
            name: "float_param",
            label: "Float Parameter",
            type: FormFieldType.NUMERIC_INPUT,
            required: true,
            readOnly: false,
            min: 0,
            max: 100,
            decimalPrecision: 2,
          }}
          value={75.25}
          onChange={jest.fn()}
          translate={(key) => key}
        />
      )

      const error = screen.queryByTestId("numeric-input-error")
      expect(error).not.toBeInTheDocument()
    })

    it("does not display error for integer value with float precision", () => {
      renderWithTheme(
        <DynamicField
          field={{
            name: "float_param",
            label: "Float Parameter",
            type: FormFieldType.NUMERIC_INPUT,
            required: true,
            readOnly: false,
            min: 0,
            max: 100,
            decimalPrecision: 2,
          }}
          value={75}
          onChange={jest.fn()}
          translate={(key) => key}
        />
      )

      const error = screen.queryByTestId("numeric-input-error")
      expect(error).not.toBeInTheDocument()
    })

    it("does not display error for value within inclusive bounds", () => {
      renderWithTheme(
        <DynamicField
          field={{
            name: "inclusive_param",
            label: "Inclusive Parameter",
            type: FormFieldType.NUMERIC_INPUT,
            required: true,
            readOnly: false,
            min: 5,
            max: 10,
            minExclusive: false,
            maxExclusive: false,
            decimalPrecision: 0,
          }}
          value={5}
          onChange={jest.fn()}
          translate={(key) => key}
        />
      )

      const error = screen.queryByTestId("numeric-input-error")
      expect(error).not.toBeInTheDocument()
    })
  })

  describe("Icon", () => {
    it("resolves bundled icons to inline svg", () => {
      const { container } = renderWithTheme(
        <Icon src="warning" aria-label="warning" />
      )

      const svg = container.querySelector("svg")
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute("class")).toContain("jimu-svg")
    })
  })
})
