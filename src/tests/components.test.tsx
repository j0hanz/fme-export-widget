import "@testing-library/jest-dom"
import { act, screen } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal, mockTheme, withThemeIntlRender } from "jimu-for-test"
import { DynamicField } from "../runtime/components/fields"
import { StateView, Icon } from "../runtime/components/ui"
import { FormFieldType } from "../config/index"

initGlobal()

const renderWithTheme = withThemeIntlRender(mockTheme as any)

const getSliderLiveValue = (expected: string) =>
  screen.getByText((content, element) => {
    return (
      content === expected && element?.getAttribute("aria-live") === "polite"
    )
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
