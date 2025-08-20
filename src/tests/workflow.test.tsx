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

  test("ORDER_RESULT state handling for success and error scenarios", async () => {
    // Success state renders reuse button and triggers callback
    const onReuseGeography = jest.fn()
    const successResult: ExportResult = {
      success: true,
      jobId: 123,
      workspaceName: "ws",
      email: "x@y.z",
    }

    const { unmount: unmount1 } = renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.ORDER_RESULT}
        orderResult={successResult}
        onReuseGeography={onReuseGeography}
      />
    )

    const reuseBtn = await screen.findByRole("button", {
      name: /Återanvänd geometri|Ny beställning/i,
    })
    fireEvent.click(reuseBtn)
    expect(onReuseGeography).toHaveBeenCalled()

    unmount1()

    // Error state renders retry button and triggers onBack
    const onBack = jest.fn()
    const errorResult: ExportResult = {
      success: false,
      workspaceName: "ws",
      message: "Something went wrong",
      code: "ERR",
    }

    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.ORDER_RESULT}
        orderResult={errorResult}
        onBack={onBack}
      />
    )

    const retryBtn = await screen.findByRole("button", {
      name: /Försök igen/i,
    })
    fireEvent.click(retryBtn)
    expect(onBack).toHaveBeenCalled()
  })

  test("header reset functionality in different states", () => {
    const onReset = jest.fn()

    // In DRAWING state, Cancel should be hidden until first click
    const { unmount: unmount1 } = renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.DRAWING}
        onReset={onReset}
        canReset={true}
        showHeaderActions={true}
        drawnArea={0}
        isDrawing={true}
        clickCount={0}
      />
    )

    const absentBtn = screen.queryByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    expect(absentBtn).toBeNull()

    unmount1()

    // After first click in DRAWING: Cancel should be visible and enabled
    const { unmount: unmount2 } = renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.DRAWING}
        onReset={onReset}
        canReset={true}
        showHeaderActions={true}
        drawnArea={0}
        isDrawing={true}
        clickCount={1}
      />
    )

    const headerBtn = screen.getByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    expect(headerBtn.getAttribute("aria-disabled")).toBe("false")
    fireEvent.click(headerBtn)
    expect(onReset).toHaveBeenCalled()

    unmount2()

    // In INITIAL state (even with area): Cancel should be hidden
    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.INITIAL}
        onReset={onReset}
        canReset={true}
        showHeaderActions={true}
        drawnArea={200}
      />
    )

    const initialBtn = screen.queryByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    expect(initialBtn).toBeNull()
  })

  test("EXPORT_FORM submission behavior for valid and invalid scenarios", async () => {
    // Invalid submission does not call onSubmit
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

    const { unmount: unmount1 } = renderWithProviders(
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

    const submitBtn1 = screen.queryByRole("button", {
      name: /Beställ|Skicka|Submit|Order/i,
    })
    if (submitBtn1) {
      fireEvent.click(submitBtn1)
      expect(onFormSubmit).not.toHaveBeenCalled()
    } else {
      const missingCfg = screen.queryByText(
        /Saknar exportkonfiguration|Missing export configuration/i
      )
      expect(missingCfg).toBeTruthy()
      expect(onFormSubmit).not.toHaveBeenCalled()
    }

    unmount1()

    // Valid submission calls onSubmit with expected data
    const onFormBack = jest.fn()
    const validWorkspaceParameters = [
      {
        name: "Title",
        description: "Titel",
        type: "TEXT",
        model: "MODEL",
        optional: false,
        defaultValue: "Hello",
      },
    ] as any

    onFormSubmit.mockClear()
    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.EXPORT_FORM}
        workspaceParameters={validWorkspaceParameters}
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

    const submitBtn2 = await screen.findByRole("button", {
      name: /Beställ|Skicka|Submit|Order/i,
    })
    fireEvent.click(submitBtn2)

    expect(onFormSubmit).toHaveBeenCalled()
    const arg = onFormSubmit.mock.calls[0][0]
    expect(arg.type).toBe("ws")
    expect(arg.data).toMatchObject({ Title: "Hello" })
  })

  test("startup validation state handling", () => {
    const onRetryValidation = jest.fn()

    // Loading state during validation
    const { unmount: unmount1 } = renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.STARTUP_VALIDATION}
        isStartupValidating={true}
        startupValidationStep="Validating connection..."
      />
    )

    screen.getByText("Validating connection...")
    unmount1()

    // Error state with retry button
    const validationError = {
      message: "Configuration error",
      severity: "error" as any,
      type: "ConfigError" as any,
      timestamp: new Date(),
    }

    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.STARTUP_VALIDATION}
        isStartupValidating={false}
        startupValidationError={validationError}
        onRetryValidation={onRetryValidation}
      />
    )

    const retryBtn = screen.getByRole("button", { name: /Försök igen/i })
    fireEvent.click(retryBtn)
    expect(onRetryValidation).toHaveBeenCalled()
  })
})
