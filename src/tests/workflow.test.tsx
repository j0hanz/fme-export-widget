import { React } from "jimu-core"
import { screen, fireEvent } from "@testing-library/react"
import { widgetRender, initExtensions, initStore } from "jimu-for-test"
import { Workflow } from "../runtime/components/workflow"
import { ViewMode, type ExportResult } from "../shared/types"

describe("Workflow component", () => {
  const baseProps = {
    instructionText: "Rita inom området",
    isModulesLoading: false,
  }

  beforeAll(() => {
    initExtensions()
    initStore()
  })

  const renderWithProviders = widgetRender(true)

  test("renders instruction text in DRAWING state", () => {
    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.DRAWING}
        canStartDrawing={true}
        drawnArea={0}
      />
    )

    const el = screen.getByText(baseProps.instructionText)
    expect(el).toBeTruthy()
  })

  test("ORDER_RESULT success renders reuse button and triggers callback", async () => {
    const onReuseGeography = jest.fn()
    const result: ExportResult = {
      success: true,
      jobId: 123,
      workspaceName: "ws",
      email: "x@y.z",
    }

    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.ORDER_RESULT}
        orderResult={result}
        onReuseGeography={onReuseGeography}
      />
    )

    // Label may vary by locale; accept common Swedish labels
    const reuseBtn = await screen.findByRole("button", {
      name: /Återanvänd geometri|Ny beställning/i,
    })
    fireEvent.click(reuseBtn)
    expect(onReuseGeography).toHaveBeenCalled()
  })

  test("ORDER_RESULT error renders retry button and triggers onBack", async () => {
    const onBack = jest.fn()
    const result: ExportResult = {
      success: false,
      workspaceName: "ws",
      message: "Something went wrong",
      code: "ERR",
    }

    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.ORDER_RESULT}
        orderResult={result}
        onBack={onBack}
      />
    )

    // Swedish: Försök igen
    const retryBtn = await screen.findByRole("button", {
      name: /Försök igen/i,
    })
    fireEvent.click(retryBtn)
    expect(onBack).toHaveBeenCalled()
  })

  test("header reset is enabled in DRAWING and triggers onReset", () => {
    const onReset = jest.fn()
    widgetRender(true)(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.DRAWING}
        onReset={onReset}
        canReset={true}
        showHeaderActions={true}
        drawnArea={0}
      />
    )

    const headerBtns = screen.getAllByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    const headerBtn = headerBtns[0]
    // aria-disabled should be false when enabled
    expect(headerBtn.getAttribute("aria-disabled")).toBe("false")
    headerBtn && fireEvent.click(headerBtn)
    expect(onReset).toHaveBeenCalled()
  })

  test("header reset disabled in INITIAL even with area", () => {
    const onReset = jest.fn()

    // INITIAL + area > 0 => disabled
    widgetRender(true)(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.INITIAL}
        onReset={onReset}
        canReset={true}
        showHeaderActions={true}
        drawnArea={200}
      />
    )
    const headerBtns = screen.getAllByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    const headerBtn = headerBtns[0]
    expect(headerBtn.getAttribute("aria-disabled")).toBe("true")

    // No assertion for other states here to avoid coupling to internal rules
  })

  test("EXPORT_FORM invalid submission does not call onSubmit", () => {
    const onFormSubmit = jest.fn()
    const workspaceParameters = [
      {
        name: "Title",
        description: "Titel",
        type: "TEXT",
        model: "MODEL",
        optional: false,
      },
    ] as any

    widgetRender(true)(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.EXPORT_FORM}
        workspaceParameters={workspaceParameters}
        workspaceName="ws"
        onFormSubmit={onFormSubmit}
        config={
          {
            fmeServerUrl: "https://example.com",
            fmeServerToken: "t",
            repository: "repo",
          } as any
        }
      />
    )

    // Submit button may vary by locale; if missing config error is shown, no submit is present
    const submitBtn = screen.queryByRole("button", {
      name: /Beställ|Skicka|Submit|Order/i,
    })
    if (submitBtn) {
      fireEvent.click(submitBtn)
      expect(onFormSubmit).not.toHaveBeenCalled()
    } else {
      // Fallback: ensure error state rendered and no submit occurred
      const missingCfg = screen.queryByText(
        /Saknar exportkonfiguration|Missing export configuration/i
      )
      expect(missingCfg).toBeTruthy()
      expect(onFormSubmit).not.toHaveBeenCalled()
    }
  })

  test("EXPORT_FORM valid submission calls onSubmit with expected data", async () => {
    const onFormSubmit = jest.fn()
    const onFormBack = jest.fn()
    const workspaceParameters = [
      {
        name: "Title",
        description: "Titel",
        type: "TEXT",
        model: "MODEL",
        optional: false,
        defaultValue: "Hello",
      },
    ] as any

    widgetRender(true)(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.EXPORT_FORM}
        workspaceParameters={workspaceParameters}
        selectedWorkspace="ws"
        onFormBack={onFormBack}
        onFormSubmit={onFormSubmit}
        config={
          {
            fmeServerUrl: "https://example.com",
            fmeServerToken: "t",
            repository: "repo",
          } as any
        }
      />
    )

    const submitBtn = await screen.findByRole("button", {
      name: /Beställ|Skicka|Submit|Order/i,
    })
    submitBtn && fireEvent.click(submitBtn)

    expect(onFormSubmit).toHaveBeenCalled()
    const arg = onFormSubmit.mock.calls[0][0]
    expect(arg.type).toBe("ws")
    expect(arg.data).toMatchObject({ Title: "Hello" })
  })
})
