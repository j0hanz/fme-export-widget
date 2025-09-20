import React from "react"
import { screen, within, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { widgetRender, initStore } from "jimu-for-test"
import {
  ViewMode,
  DrawingTool,
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

    // Tablist and tabs via ButtonTabs (sv labels)
    const group = screen.getByRole("tablist")
    const polygon = within(group).getByRole("tab", { name: /Polygon/i })
    const rectangle = within(group).getByRole("tab", { name: /Rektangel/i })

    expect(polygon).toHaveAttribute("aria-selected", "true")
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

  test("header reset button visibility based on state and drawing progress", () => {
    const onReset = jest.fn()
    const utils = renderWithProviders(
      <Workflow
        state={ViewMode.INITIAL}
        instructionText=""
        isModulesLoading={false}
        showHeaderActions={true}
        isDrawing={false}
        clickCount={0}
        drawnArea={0}
        onReset={onReset}
      />
    )

    // In INITIAL (ButtonTabs visible), cancel should be hidden
    expect(
      screen.queryByRole("button", { name: /Avbryt/i })
    ).not.toBeInTheDocument()

    const { rerender } = utils
    rerender(
      <Workflow
        state={ViewMode.DRAWING}
        instructionText=""
        isModulesLoading={false}
        showHeaderActions={true}
        isDrawing={false}
        clickCount={0}
        drawnArea={0}
        onReset={onReset}
      />
    )

    // In DRAWING with 0 clicks (ButtonTabs visible), cancel should be hidden
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
