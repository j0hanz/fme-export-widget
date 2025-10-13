import "@testing-library/jest-dom"
import { act, screen } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal, mockTheme, withThemeIntlRender } from "jimu-for-test"
import { StateView, Icon } from "../runtime/components/ui"

initGlobal()

const renderWithTheme = withThemeIntlRender(mockTheme as any)

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
