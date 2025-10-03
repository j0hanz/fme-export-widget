import { initGlobal } from "jimu-for-test"
import FmeReduxStoreExtension, {
  fmeActions,
  initialFmeState,
} from "../extensions/store"
import {
  DrawingTool,
  ErrorSeverity,
  ErrorType,
  ParameterType,
  ViewMode,
  type ErrorState,
  type ExportResult,
  type FmeWidgetState,
  type IMFmeGlobalState,
  type WorkspaceParameter,
} from "../config"
import { sanitizeFormValues } from "../shared/validations"

jest.mock("../shared/validations", () => {
  const actual = jest.requireActual("../shared/validations")
  return {
    ...actual,
    sanitizeFormValues: jest.fn((values: any) => ({
      __sanitized__: true,
      ...values,
    })),
  }
})

const sanitizeFormValuesMock = sanitizeFormValues as jest.MockedFunction<
  typeof sanitizeFormValues
>

const widgetId = "widget-test"

// Key state behaviors verified in these tests:
// - Lazy widget sub-state creation and reset lifecycle
// - Geometry, drawing, and workspace repository state transitions
// - Error serialization, loading flags, and workspace clearing flows

const createReducer = () => new FmeReduxStoreExtension().getReducer()

const toPlainState = (
  state: IMFmeGlobalState,
  id: string = widgetId
): FmeWidgetState => {
  const rootState = state as any
  const sub = rootState?.byId?.[id]
  if (!sub) {
    throw new Error(`Missing state for widget ${id}`)
  }
  return sub.asMutable({ deep: true })
}

beforeAll(() => {
  initGlobal()
})

beforeEach(() => {
  sanitizeFormValuesMock.mockClear()
})

describe("FME Redux state management", () => {
  it("creates widget sub-state lazily and tracks view history", () => {
    // Arrange
    const reducer = createReducer()

    // Act
    const nextState = reducer(
      undefined,
      fmeActions.setViewMode(ViewMode.INITIAL, widgetId)
    )

    // Assert
    const plain = toPlainState(nextState)
    expect(plain.viewMode).toBe(ViewMode.INITIAL)
    expect(plain.previousViewMode).toBe(ViewMode.STARTUP_VALIDATION)
  })

  it("keeps state immutable when view mode is unchanged", () => {
    // Arrange
    const reducer = createReducer()
    const stateAfterFirst = reducer(
      undefined,
      fmeActions.setViewMode(ViewMode.INITIAL, widgetId)
    )

    // Act
    const stateAfterSecond = reducer(
      stateAfterFirst,
      fmeActions.setViewMode(ViewMode.INITIAL, widgetId)
    )

    // Assert
    expect(stateAfterSecond).toBe(stateAfterFirst)
  })

  it("resets widget state back to the immutable initial snapshot", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setDrawingTool(DrawingTool.RECTANGLE, widgetId)
    )
    state = reducer(state, fmeActions.setViewMode(ViewMode.DRAWING, widgetId))

    // Act
    const resetState = reducer(state, fmeActions.resetState(widgetId))

    // Assert
    const plain = toPlainState(resetState)
    expect(plain).toEqual(initialFmeState)
  })

  it("captures startup validation state and serializes runtime errors", () => {
    // Arrange
    const reducer = createReducer()
    const runtimeError: ErrorState = {
      message: "Startup failed",
      type: ErrorType.CONFIG,
      code: "CFG",
      severity: ErrorSeverity.ERROR,
      recoverable: true,
      details: { reason: "missing-config" },
      timestamp: new Date(1_700_000_000_000),
      timestampMs: 1_700_000_000_000,
    }

    // Act
    const nextState = reducer(
      undefined,
      fmeActions.setStartupValidationState(
        false,
        "loading-modules",
        runtimeError,
        widgetId
      )
    )

    // Assert
    const plain = toPlainState(nextState)
    expect(plain.isStartupValidating).toBe(false)
    expect(plain.startupValidationStep).toBe("loading-modules")
    const serialized = plain.startupValidationError
    if (!serialized) {
      throw new Error("Expected serialized startup error")
    }
    expect(serialized.timestampMs).toBe(1_700_000_000_000)
    expect(serialized.kind).toBe("serializable")
  })

  it("stores geometry JSON output and normalizes drawn area", () => {
    // Arrange
    const reducer = createReducer()
    const geometryJson = { type: "polygon" }
    const geometry = { toJSON: jest.fn(() => geometryJson) }

    // Act
    const nextState = reducer(
      undefined,
      fmeActions.setGeometry(geometry as any, undefined, widgetId)
    )

    // Assert
    const plain = toPlainState(nextState)
    expect(geometry.toJSON).toHaveBeenCalled()
    expect(plain.geometryJson).toEqual(geometryJson)
    expect(plain.drawnArea).toBe(0)
  })

  it("toggles the area warning flag", () => {
    // Arrange
    const reducer = createReducer()

    // Act
    let state = reducer(undefined, fmeActions.setAreaWarning(true, widgetId))

    // Assert
    let plain = toPlainState(state)
    expect(plain.areaWarning).toBe(true)

    state = reducer(state, fmeActions.setAreaWarning(false, widgetId))
    plain = toPlainState(state)
    expect(plain.areaWarning).toBe(false)
  })

  it("advances view state when drawing completes", () => {
    // Arrange
    const reducer = createReducer()
    const geometryJson = { type: "polygon" }
    const geometry = { toJSON: () => geometryJson }
    let state = reducer(
      undefined,
      fmeActions.setViewMode(ViewMode.DRAWING, widgetId)
    )

    // Act
    state = reducer(
      state,
      fmeActions.completeDrawing(
        geometry as any,
        42,
        ViewMode.EXPORT_FORM,
        widgetId
      )
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.geometryJson).toEqual(geometryJson)
    expect(plain.drawnArea).toBe(42)
    expect(plain.previousViewMode).toBe(ViewMode.DRAWING)
    expect(plain.viewMode).toBe(ViewMode.EXPORT_FORM)
  })

  it("switches drawing tool while leaving other state untouched", () => {
    // Arrange
    const reducer = createReducer()

    // Act
    const nextState = reducer(
      undefined,
      fmeActions.setDrawingTool(DrawingTool.RECTANGLE, widgetId)
    )

    // Assert
    const plain = toPlainState(nextState)
    expect(plain.drawingTool).toBe(DrawingTool.RECTANGLE)
  })

  it("sanitizes form values using workspace parameters as context", () => {
    // Arrange
    const reducer = createReducer()
    const parameters: WorkspaceParameter[] = [
      {
        name: "city",
        type: ParameterType.TEXT,
        optional: false,
      },
    ]
    let state = reducer(
      undefined,
      fmeActions.setWorkspaceParameters(
        parameters,
        "DemoWorkspace",
        "repo-1",
        widgetId
      )
    )
    const rawValues = { city: "Stockholm", extra: "value" }

    // Act
    state = reducer(state, fmeActions.setFormValues(rawValues, widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.formValues).toEqual({ __sanitized__: true, ...rawValues })
    expect(sanitizeFormValuesMock).toHaveBeenCalledWith(rawValues, parameters)
  })

  it("captures order results and clears submitting flag", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setLoadingFlags({ isSubmittingOrder: true }, widgetId)
    )
    const orderResult: ExportResult = {
      success: true,
      message: "done",
    }

    // Act
    state = reducer(state, fmeActions.setOrderResult(orderResult, widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.orderResult).toEqual(orderResult)
    expect(plain.isSubmittingOrder).toBe(false)
  })

  it("updates workspace items and repository context", () => {
    // Arrange
    const reducer = createReducer()
    const items = [{ name: "workspace" }]

    // Act
    let state = reducer(
      undefined,
      fmeActions.setWorkspaceItems(items, "repo-a", widgetId)
    )
    const withRepo = toPlainState(state)
    expect(withRepo.workspaceItems).toEqual(items)
    expect(withRepo.currentRepository).toBe("repo-a")

    state = reducer(
      state,
      fmeActions.setWorkspaceItems(items, undefined, widgetId)
    )

    // Assert
    const clearedRepo = toPlainState(state)
    expect(clearedRepo.currentRepository).toBeNull()
  })

  it("tracks workspace parameters, selection, and repository", () => {
    // Arrange
    const reducer = createReducer()
    const parameters: WorkspaceParameter[] = [
      {
        name: "threshold",
        type: ParameterType.INTEGER,
        optional: true,
      },
    ]

    // Act
    const state = reducer(
      undefined,
      fmeActions.setWorkspaceParameters(
        parameters,
        "BufferCity",
        "repo-b",
        widgetId
      )
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceParameters).toEqual(parameters)
    expect(plain.selectedWorkspace).toBe("BufferCity")
    expect(plain.currentRepository).toBe("repo-b")
  })

  it("retains repository context when selection updates without explicit repo", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setWorkspaceItems([], "repo-c", widgetId)
    )

    // Act
    state = reducer(
      state,
      fmeActions.setSelectedWorkspace("Clipper", undefined, widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.selectedWorkspace).toBe("Clipper")
    expect(plain.currentRepository).toBe("repo-c")
  })

  it("stores detailed workspace item metadata with repository affinity", () => {
    // Arrange
    const reducer = createReducer()
    const item = { name: "Clipper", title: "Clip polygons" }

    // Act
    const state = reducer(
      undefined,
      fmeActions.setWorkspaceItem(item as any, "repo-x", widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceItem).toEqual(item)
    expect(plain.currentRepository).toBe("repo-x")
  })

  it("toggles loading flags independently", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setLoadingFlags({ isModulesLoading: true }, widgetId)
    )

    // Act
    state = reducer(
      state,
      fmeActions.setLoadingFlags({ isSubmittingOrder: true }, widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.isModulesLoading).toBe(true)
    expect(plain.isSubmittingOrder).toBe(true)
  })

  it("clears workspace-specific state and updates repository context", () => {
    // Arrange
    const reducer = createReducer()
    const parameters: WorkspaceParameter[] = [
      {
        name: "Area",
        type: ParameterType.GEOMETRY,
        optional: false,
      },
    ]
    let state = reducer(
      undefined,
      fmeActions.setWorkspaceParameters(
        parameters,
        "Clipper",
        "repo-initial",
        widgetId
      )
    )
    state = reducer(state, fmeActions.setFormValues({ Area: 10 }, widgetId))
    state = reducer(
      state,
      fmeActions.setLoadingFlags({ isSubmittingOrder: true }, widgetId)
    )

    // Act
    state = reducer(
      state,
      fmeActions.clearWorkspaceState("repo-next", widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceItems).toEqual([])
    expect(plain.workspaceParameters).toEqual([])
    expect(plain.selectedWorkspace).toBeNull()
    expect(plain.workspaceItem).toBeNull()
    expect(plain.formValues).toEqual({})
    expect(plain.isSubmittingOrder).toBe(false)
    expect(plain.currentRepository).toBe("repo-next")
  })

  it("serializes error payloads for general, import, and export flows", () => {
    // Arrange
    const reducer = createReducer()
    const error: ErrorState = {
      message: "Network issue",
      type: ErrorType.NETWORK,
      code: "NET",
      severity: ErrorSeverity.ERROR,
      recoverable: false,
      timestamp: new Date(100),
      timestampMs: 100,
    }

    // Act
    let state = reducer(undefined, fmeActions.setError(error, widgetId))
    state = reducer(state, fmeActions.setImportError(error, widgetId))
    state = reducer(state, fmeActions.setExportError(error, widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.error?.timestampMs).toBe(100)
    expect(plain.importError?.timestampMs).toBe(100)
    expect(plain.exportError?.timestampMs).toBe(100)
    expect(plain.error?.kind).toBe("serializable")
    expect(plain.importError?.kind).toBe("serializable")
    expect(plain.exportError?.kind).toBe("serializable")
  })

  it("removes widget state entirely when requested", () => {
    // Arrange
    const reducer = createReducer()
    const populated = reducer(
      undefined,
      fmeActions.setViewMode(ViewMode.INITIAL, widgetId)
    )

    // Act
    const cleared = reducer(populated, {
      type: "fme/REMOVE_WIDGET_STATE",
      widgetId,
    })

    // Assert
    expect((cleared as any).byId[widgetId]).toBeUndefined()
  })

  it("ignores actions without a widget identifier", () => {
    // Arrange
    const reducer = createReducer()
    const populated = reducer(
      undefined,
      fmeActions.setViewMode(ViewMode.INITIAL, widgetId)
    )

    // Act
    const untouched = reducer(populated, {
      type: fmeActions.setViewMode(ViewMode.DRAWING, widgetId).type,
      viewMode: ViewMode.DRAWING,
    })

    // Assert
    expect(untouched).toBe(populated)
  })

  it("isolates updates between multiple widget instances", () => {
    // Arrange
    const reducer = createReducer()
    const otherId = "widget-other"

    // Act
    let state = reducer(
      undefined,
      fmeActions.setViewMode(ViewMode.INITIAL, widgetId)
    )
    state = reducer(state, fmeActions.setViewMode(ViewMode.DRAWING, otherId))

    // Assert
    const base = toPlainState(state, widgetId)
    const other = toPlainState(state, otherId)
    expect(base.viewMode).toBe(ViewMode.INITIAL)
    expect(other.viewMode).toBe(ViewMode.DRAWING)
  })
})
