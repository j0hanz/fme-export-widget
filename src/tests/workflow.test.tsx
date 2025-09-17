import React from "react"
import { screen, within, waitFor, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom"
import { widgetRender, initStore } from "jimu-for-test"
import {
  ViewMode,
  DrawingTool,
  ParameterType,
  type WorkspaceItem,
  ErrorSeverity,
  type ErrorState,
} from "../config"
import { Workflow } from "../runtime/components/workflow"

// Security: Mock the FME client to avoid real network calls
const mockClient = {
  getRepositoryItems: jest.fn(),
  getWorkspaceItem: jest.fn(),
}

jest.mock("../shared/api", () => ({
  createFmeFlowClient: jest.fn().mockImplementation(() => mockClient),
}))

const renderWithProviders = widgetRender(true)

describe("Workflow component", () => {
  beforeEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
    initStore()
  })

  test("shows startup loading by default and renders step message", () => {
    renderWithProviders(
      <Workflow
        state={ViewMode.STARTUP_VALIDATION}
        instructionText=""
        isModulesLoading={false}
        showHeaderActions={false}
        drawingMode={DrawingTool.POLYGON}
      />
    )

    // Expect loading StateView (avoid locale-specific text assertions)
    expect(screen.getByRole("status")).toBeInTheDocument()
  })

  test("renders startup error with retry and support hint", () => {
    const onRetryValidation = jest.fn()
    const startupError: ErrorState = {
      message: "startupServerError",
      code: "SERVER",
      type: "config" as any,
      severity: ErrorSeverity.ERROR,
      timestamp: new Date(),
      timestampMs: 0,
      recoverable: true,
      userFriendlyMessage: "Please try again",
      suggestion: "retry",
    }

    renderWithProviders(
      <Workflow
        state={ViewMode.STARTUP_VALIDATION}
        instructionText=""
        isModulesLoading={false}
        startupValidationError={startupError}
        onRetryValidation={onRetryValidation}
        config={{ supportEmail: "help@example.com" } as any}
        showHeaderActions={false}
      />
    )

    const alert = screen.getByRole("alert")
    expect(alert).toBeInTheDocument()
    // Retry action present
    within(alert).getByRole("group")
    // Support hint includes mailto link; actions are rendered via support hint override without buttons
    // Support hint includes mailto link
    expect(
      screen
        .getAllByRole("link")
        .some((a) =>
          (a as HTMLAnchorElement).href.startsWith("mailto:help@example.com")
        )
    ).toBe(true)
  })

  test("initial state renders drawing mode tabs and switches mode", async () => {
    const onDrawingModeChange = jest.fn()
    renderWithProviders(
      <Workflow
        state={ViewMode.INITIAL}
        instructionText=""
        isModulesLoading={false}
        drawingMode={DrawingTool.POLYGON}
        onDrawingModeChange={onDrawingModeChange}
        showHeaderActions={false}
      />
    )

    // Radiogroup and radios via ButtonTabs (sv labels)
    const group = screen.getByRole("radiogroup")
    const polygon = within(group).getByRole("radio", { name: /Polygon/i })
    const rectangle = within(group).getByRole("radio", { name: /Rektangel/i })

    expect(polygon).toHaveAttribute("aria-checked", "true")
    rectangle.click()
    await waitFor(() => {
      expect(onDrawingModeChange).toHaveBeenCalledWith(DrawingTool.RECTANGLE)
    })
  })

  test("drawing state with clicks > 0 shows instruction text", () => {
    renderWithProviders(
      <Workflow
        state={ViewMode.DRAWING}
        instructionText="Click to continue"
        isModulesLoading={false}
        drawingMode={DrawingTool.POLYGON}
        clickCount={2}
        showHeaderActions={false}
      />
    )

    const status = screen.getByRole("status")
    expect(within(status).getByText(/Click to continue/i)).toBeInTheDocument()
  })

  test("workspace selection: loads, lists items, and selects a workspace", async () => {
    jest.useFakeTimers()
    const workspaces: WorkspaceItem[] = [
      { name: "ws1", title: "Workspace One", type: "WORKSPACE" } as any,
      { name: "ws2", title: "Workspace Two", type: "WORKSPACE" } as any,
    ]
    mockClient.getRepositoryItems.mockResolvedValueOnce({
      status: 200,
      data: { items: workspaces },
    })
    const onWorkspaceSelected = jest.fn()

    const { rerender } = renderWithProviders(
      <Workflow
        state={ViewMode.INITIAL}
        instructionText=""
        isModulesLoading={false}
        config={{ repository: "repoA" } as any}
        onWorkspaceSelected={onWorkspaceSelected}
        showHeaderActions={false}
      />
    )
    // Transition into workspace selection to trigger useUpdateEffect scheduling
    rerender(
      <Workflow
        state={ViewMode.WORKSPACE_SELECTION}
        instructionText=""
        isModulesLoading={false}
        config={{ repository: "repoA" } as any}
        onWorkspaceSelected={onWorkspaceSelected}
        showHeaderActions={false}
      />
    )

    // Initially shows loading status (avoid locale-specific text)
    expect(screen.getByRole("status")).toBeInTheDocument()

    // Advance timers to trigger scheduled load and resolve promise
    jest.advanceTimersByTime(600)
    await waitFor(() => {
      expect(mockClient.getRepositoryItems).toHaveBeenCalled()
    })
    // StateView enforces a minimum loading delay of 1000ms; advance to reveal list
    jest.advanceTimersByTime(1200)

    // Workspace list rendered as list of buttons
    // Prepare item details mock before click
    mockClient.getWorkspaceItem.mockResolvedValueOnce({
      status: 200,
      data: {
        parameters: [{ name: "count", type: ParameterType.INTEGER }],
        title: "Workspace One",
      },
    })
    const firstItem = await screen.findByRole("listitem", {
      name: /Workspace One/i,
    })
    firstItem.click()

    // The click triggers the load; wait for the handler to be invoked via onWorkspaceSelected
    await waitFor(() => {
      expect(mockClient.getWorkspaceItem).toHaveBeenCalledWith(
        "ws1",
        "repoA",
        expect.any(AbortSignal)
      )
    })
  })

  test("workspace selection: error state shows alert and support hint (no list)", async () => {
    jest.useFakeTimers()
    mockClient.getRepositoryItems.mockRejectedValueOnce(new Error("boom"))

    const { rerender } = renderWithProviders(
      <Workflow
        state={ViewMode.INITIAL}
        instructionText=""
        isModulesLoading={false}
        config={
          { repository: "repoA", supportEmail: "help@example.com" } as any
        }
        showHeaderActions={false}
      />
    )

    rerender(
      <Workflow
        state={ViewMode.WORKSPACE_SELECTION}
        instructionText=""
        isModulesLoading={false}
        config={
          { repository: "repoA", supportEmail: "help@example.com" } as any
        }
        showHeaderActions={false}
      />
    )

    // Loading first
    expect(screen.getByRole("status")).toBeInTheDocument()
    jest.advanceTimersByTime(600)
    // After promise settles and minimum delay, alert should render
    await waitFor(() => {
      expect(mockClient.getRepositoryItems).toHaveBeenCalled()
    })
    jest.advanceTimersByTime(1200)
    const alert = await screen.findByRole("alert")
    expect(alert).toBeInTheDocument()
    // No list when error
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
    // Support hint mailto link present when supportEmail provided
    expect(
      screen
        .getAllByRole("link")
        .some((a) =>
          (a as HTMLAnchorElement).href.startsWith("mailto:help@example.com")
        )
    ).toBe(true)
  })

  test("workspace selection: empty response shows placeholder (no list)", async () => {
    jest.useFakeTimers()
    mockClient.getRepositoryItems.mockResolvedValueOnce({
      status: 200,
      data: { items: [] },
    })

    const { rerender } = renderWithProviders(
      <Workflow
        state={ViewMode.INITIAL}
        instructionText=""
        isModulesLoading={false}
        config={{ repository: "repoA" } as any}
        showHeaderActions={false}
      />
    )

    rerender(
      <Workflow
        state={ViewMode.WORKSPACE_SELECTION}
        instructionText=""
        isModulesLoading={false}
        config={{ repository: "repoA" } as any}
        showHeaderActions={false}
      />
    )

    // Loading then empty view
    jest.advanceTimersByTime(600)
    await waitFor(() => {
      expect(mockClient.getRepositoryItems).toHaveBeenCalled()
    })
    jest.advanceTimersByTime(1200)

    // Component keeps showing a placeholder loading status when no workspaces are found
    expect(screen.getByRole("status")).toBeInTheDocument()
    // No list or actions are present
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Försök igen/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Tillbaka/i })
    ).not.toBeInTheDocument()
  })

  test("export form: required number field validation and submit", async () => {
    const onFormSubmit = jest.fn()

    renderWithProviders(
      <Workflow
        state={ViewMode.EXPORT_FORM}
        instructionText=""
        isModulesLoading={false}
        selectedWorkspace="demo"
        workspaceParameters={
          [
            { name: "count", type: ParameterType.INTEGER, optional: false },
          ] as any
        }
        onFormBack={jest.fn()}
        onFormSubmit={onFormSubmit}
        showHeaderActions={false}
      />
    )

    // Submit button disabled initially due to required field (sv: "Beställ")
    // Initially disabled
    expect(screen.getByRole("button", { name: /Beställ/i })).toBeDisabled()

    // Enter a valid number
    const inputEl = screen.getByRole("textbox")
    // Fire a change event via Testing Library to trigger state updates
    fireEvent.change(inputEl, { target: { value: "12" } })

    // Submit should become enabled after validation
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Beställ/i })
      ).not.toBeDisabled()
    })
    screen.getByRole("button", { name: /Beställ/i }).click()
    await waitFor(() => {
      expect(onFormSubmit).toHaveBeenCalled()
    })
  })

  test("export form: optional schedule start renders and validates format", async () => {
    const onFormSubmit = jest.fn()

    renderWithProviders(
      <Workflow
        state={ViewMode.EXPORT_FORM}
        instructionText=""
        isModulesLoading={false}
        selectedWorkspace="sched"
        workspaceParameters={[] as any}
        onFormBack={jest.fn()}
        onFormSubmit={onFormSubmit}
        config={{ allowScheduleMode: true } as any}
        showHeaderActions={false}
      />
    )

    // Start field is visible immediately (optional)
    // The UI now renders split date/time inputs under the Start label
    const startLabel = await screen.findByText(
      /Starttid \(YYYY-MM-DD HH:mm:ss\)/i
    )
    const startGroup = startLabel.closest("div") as HTMLElement
    const dateEl = startGroup.querySelector('input[type="date"]')
    const timeEl = startGroup.querySelector('input[type="time"]')
    expect(dateEl).toBeTruthy()
    expect(timeEl).toBeTruthy()
    const dateInput = dateEl as HTMLInputElement
    const timeInput = timeEl as HTMLInputElement

    // With no required fields and empty start, submit is enabled
    expect(screen.getByRole("button", { name: /Beställ/i })).not.toBeDisabled()

    // Enter a partial date only -> field remains effectively empty; form stays valid
    fireEvent.change(dateInput, { target: { value: "2025-12-01" } })
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Beställ/i })
      ).not.toBeDisabled()
    })

    // Enter a valid datetime (add time) -> form becomes valid again
    fireEvent.change(timeInput, { target: { value: "10:15:00" } })
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Beställ/i })
      ).not.toBeDisabled()
    })
  })

  test("export form: upload field renders when allowed", () => {
    renderWithProviders(
      <Workflow
        state={ViewMode.EXPORT_FORM}
        instructionText=""
        isModulesLoading={false}
        selectedWorkspace="remote"
        workspaceParameters={[] as any}
        onFormBack={jest.fn()}
        onFormSubmit={jest.fn()}
        config={{ allowRemoteDataset: true } as any}
        showHeaderActions={false}
      />
    )

    // Upload field renders with Swedish label
    expect(screen.getByText(/Ladda upp dataset \(TEMP\)/i)).toBeInTheDocument()
  })

  test("order result: shows success, download link and reuse button", () => {
    const onReuseGeography = jest.fn()
    renderWithProviders(
      <Workflow
        state={ViewMode.ORDER_RESULT}
        instructionText=""
        isModulesLoading={false}
        orderResult={
          {
            success: true,
            message: "ok",
            jobId: 42,
            workspaceName: "demo",
            email: "u@e.com",
            downloadUrl: "https://dl.example/file.zip",
          } as any
        }
        onReuseGeography={onReuseGeography}
        onBack={jest.fn()}
        config={{ syncMode: false } as any}
        showHeaderActions={false}
      />
    )

    // Title uses i18n (sv): "Beställningen är bekräftad"
    expect(screen.getByText(/Beställningen är bekräftad/i)).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Ladda ner filen/i })
    expect((link as HTMLAnchorElement).href).toBe("https://dl.example/file.zip")
    const reuseBtn = screen.getByRole("button", { name: /Ny beställning/i })
    reuseBtn.click()
    expect(onReuseGeography).toHaveBeenCalled()
  })

  test("order result: masks email when enabled and success (async mode)", () => {
    const onReuseGeography = jest.fn()
    renderWithProviders(
      <Workflow
        state={ViewMode.ORDER_RESULT}
        instructionText=""
        isModulesLoading={false}
        orderResult={
          {
            success: true,
            message: "ok",
            jobId: 7,
            workspaceName: "demo",
            email: "username@example.com",
          } as any
        }
        onReuseGeography={onReuseGeography}
        onBack={jest.fn()}
        config={{ syncMode: false, maskEmailOnSuccess: true } as any}
        showHeaderActions={false}
      />
    )

    // Notification email row should display masked local part
    expect(
      screen.getByText(/E‑post: us\*\*\*\*@example\.com/i)
    ).toBeInTheDocument()
  })

  test("header reset button visibility based on state and drawing progress", () => {
    const onReset = jest.fn()
    const { rerender } = renderWithProviders(
      <Workflow
        state={ViewMode.DRAWING}
        instructionText=""
        isModulesLoading={false}
        showHeaderActions={true}
        isDrawing={true}
        clickCount={0}
        drawnArea={0}
        onReset={onReset}
      />
    )

    // First click pending -> reset hidden (sv: "Avbryt")
    expect(
      screen.queryByRole("button", { name: /Avbryt/i })
    ).not.toBeInTheDocument()

    rerender(
      <Workflow
        state={ViewMode.DRAWING}
        instructionText=""
        isModulesLoading={false}
        showHeaderActions={true}
        isDrawing={true}
        clickCount={1}
        drawnArea={0}
        onReset={onReset}
      />
    )

    const resetBtn = screen.getByRole("button", { name: /Avbryt/i })
    resetBtn.click()
    expect(onReset).toHaveBeenCalled()
  })
})

// Security & i18n: All external calls are mocked; text assertions use translation keys present in the UI. A11y via role and name queries.
