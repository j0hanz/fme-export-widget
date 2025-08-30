import { React } from "jimu-core"
import { screen, fireEvent } from "@testing-library/react"
import {
  initExtensions,
  initStore,
  widgetRender,
  withStoreThemeIntlRender,
  waitForMilliseconds,
} from "jimu-for-test"
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
  const renderSTI = withStoreThemeIntlRender()

  // Test helpers
  const headerCancelQuery = () =>
    screen.queryByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })

  const expectMailto = (email: string) => {
    const emailLink = screen.queryByRole("link", {
      name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    })
    expect(emailLink).toBeTruthy()
    if (emailLink)
      expect(emailLink.getAttribute("href")).toBe(`mailto:${email}`)
  }

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

    const { unmount: unmount1 } = renderSTI(
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

    renderSTI(
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

    // In DRAWING, Cancel hidden until first click
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

    const absentBtn = headerCancelQuery()
    expect(absentBtn).toBeNull()

    unmount1()

    // After first click, Cancel visible and enabled
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

    // In INITIAL (even with area), Cancel hidden
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

    const initialBtn = headerCancelQuery()
    expect(initialBtn).toBeNull()
  })

  test("Cancel button is hidden when showing ORDER_RESULT", () => {
    const onReset = jest.fn()
    const result: ExportResult = {
      success: true,
      jobId: 1,
      workspaceName: "ws",
      email: "a@b.c",
    }

    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.ORDER_RESULT}
        orderResult={result}
        onReset={onReset}
        canReset={true}
        showHeaderActions={true}
        drawnArea={500}
      />
    )

    const headerBtn = screen.queryByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    expect(headerBtn).toBeNull()
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

    const { unmount: unmount1 } = renderSTI(
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
      const inlineReq1 = screen.queryByText(/is required/i)
      expect(inlineReq1).toBeNull()
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
    renderSTI(
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

  test("startup validation state handling", async () => {
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

    // Error state with email support configured
    const validationError = {
      message: "Configuration error",
      severity: "error" as any,
      type: "ConfigError" as any,
      timestampMs: Date.now(),
      userFriendlyMessage: "support@example.com", // Email passed for mailto link
    }

    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.STARTUP_VALIDATION}
        isStartupValidating={false}
        startupValidationError={validationError}
        onRetryValidation={onRetryValidation}
        config={
          {
            fmeServerUrl: "https://example.com",
            supportEmail: "support@example.com",
          } as any
        }
      />
    )

    // Flush microtasks
    await waitForMilliseconds(0)

    // Error rendered by Workflow's StateView
    expect(screen.queryByText(/Configuration error/i)).toBeTruthy()

    // Mailto link present due to email in userFriendlyMessage
    expectMailto("support@example.com")
  })

  test("ORDER_RESULT sync mode shows direct download and hides email", async () => {
    const result: ExportResult = {
      success: true,
      jobId: 987,
      workspaceName: "ws",
      email: "dl@sample.io",
      downloadUrl: "https://downloads.example.com/file.zip",
      message: "Ready",
    }

    renderSTI(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.ORDER_RESULT}
        orderResult={result}
        config={{ syncMode: true } as any}
      />
    )

    // Wait for any effect flush (no-op if not needed)
    await waitForMilliseconds(0)

    // Email should be hidden in sync mode
    expect(screen.queryByText("dl@sample.io")).toBeNull()

    // Download link should be present with expected href
    const links = screen.getAllByRole("link")
    const dlLink = links.find(
      (a) => a.getAttribute("href") === result.downloadUrl
    )
    expect(dlLink).toBeTruthy()
  })

  test("ORDER_RESULT async mode renders success without download link", async () => {
    const result: ExportResult = {
      success: true,
      jobId: 654,
      workspaceName: "ws",
      email: "notify@sample.io",
      message: "Notification sent",
    }

    renderSTI(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.ORDER_RESULT}
        orderResult={result}
        config={{ syncMode: false } as any}
      />
    )

    await waitForMilliseconds(0)
    // No direct download link should be present in async mode without downloadUrl
    const links = screen.queryAllByRole("link")
    // Expect zero or at least no http/mailto links
    const actionable = links.filter((a) => {
      const href = a.getAttribute("href") || ""
      return href.startsWith("http") || href.startsWith("mailto:")
    })
    expect(actionable.length).toBe(0)
    // Success button should be present (reuse/new order)
    const reuseBtn = await screen.findByRole("button", {
      name: /Återanvänd geometri|Ny beställning/i,
    })
    expect(reuseBtn).toBeTruthy()
  })

  test("header reset hidden when canReset=false even after first click", () => {
    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.DRAWING}
        onReset={jest.fn()}
        canReset={false}
        showHeaderActions={true}
        drawnArea={0}
        isDrawing={true}
        clickCount={1}
      />
    )

    const headerBtn = screen.queryByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    expect(headerBtn).toBeNull()
  })

  test("in DRAWING, reset visible when not actively drawing even before first click", () => {
    const onReset = jest.fn()
    renderWithProviders(
      <Workflow
        {...(baseProps as any)}
        state={ViewMode.DRAWING}
        onReset={onReset}
        canReset={true}
        showHeaderActions={true}
        drawnArea={0}
        isDrawing={false}
        clickCount={0}
      />
    )

    const headerBtn = screen.getByRole("button", {
      name: /Avbryt|Cancel|Ångra|Stäng|Close/i,
    })
    expect(headerBtn.getAttribute("aria-disabled")).toBe("false")
    fireEvent.click(headerBtn)
    expect(onReset).toHaveBeenCalled()
  })
})
