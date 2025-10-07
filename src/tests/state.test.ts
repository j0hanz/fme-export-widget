import { initGlobal } from "jimu-for-test"
import FmeReduxStoreExtension, {
  fmeActions,
  initialFmeState,
  createFmeSelectors,
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
  type IMStateWithFmeExport,
  type WorkspaceParameter,
} from "../config/index"

const widgetId = "widget-test"

// Key state behaviors verified in these tests:
// - Lazy widget sub-state creation and reset lifecycle
// - Geometry, drawing, and workspace state transitions
// - Scoped error serialization and clearing flows

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

describe("FME Redux state management", () => {
  it("creates widget sub-state lazily and updates view mode", () => {
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

  it("captures order results", () => {
    // Arrange
    const reducer = createReducer()
    const orderResult: ExportResult = {
      success: true,
      message: "done",
    }

    // Act
    const state = reducer(
      undefined,
      fmeActions.setOrderResult(orderResult, widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.orderResult).toEqual(orderResult)
  })

  it("updates workspace items", () => {
    // Arrange
    const reducer = createReducer()
    const items = [{ name: "workspace" }]

    // Act
    const state = reducer(
      undefined,
      fmeActions.setWorkspaceItems(items, widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceItems).toEqual(items)
  })

  it("tracks workspace parameters and selection", () => {
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
      fmeActions.setWorkspaceParameters(parameters, "BufferCity", widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceParameters).toEqual(parameters)
    expect(plain.selectedWorkspace).toBe("BufferCity")
  })

  it("updates selected workspace independently", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setWorkspaceParameters([], "", widgetId)
    )

    // Act
    state = reducer(state, fmeActions.setSelectedWorkspace("Clipper", widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.selectedWorkspace).toBe("Clipper")
    expect(plain.workspaceParameters).toEqual([])
    expect(plain.workspaceItem).toBeNull()
    expect(plain.orderResult).toBeNull()
  })

  it("ignores stale workspace parameter responses", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setSelectedWorkspace("Clipper", widgetId)
    )

    // Act (stale response for a different workspace)
    state = reducer(
      state,
      fmeActions.setWorkspaceParameters(
        [{ name: "threshold", type: ParameterType.INTEGER, optional: false }],
        "Buffer",
        widgetId
      )
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.selectedWorkspace).toBe("Clipper")
    expect(plain.workspaceParameters).toEqual([])
  })

  it("ignores stale workspace item metadata", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setSelectedWorkspace("Clipper", widgetId)
    )

    // Act (workspace item for different selection)
    state = reducer(
      state,
      fmeActions.setWorkspaceItem({ name: "Buffer" } as any, widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceItem).toBeNull()
  })

  it("stores detailed workspace item metadata", () => {
    // Arrange
    const reducer = createReducer()
    const item = { name: "Clipper", title: "Clip polygons" }

    // Act
    const state = reducer(
      undefined,
      fmeActions.setWorkspaceItem(item as any, widgetId)
    )

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceItem).toEqual(item)
  })

  it("clears workspace-specific state", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.setWorkspaceParameters([], "Clipper", widgetId)
    )
    state = reducer(
      state,
      fmeActions.setWorkspaceItem({ name: "Clipper" } as any, widgetId)
    )
    state = reducer(
      state,
      fmeActions.setOrderResult({ success: true, message: "ok" }, widgetId)
    )

    // Act
    state = reducer(state, fmeActions.clearWorkspaceState(widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.workspaceItems).toEqual([])
    expect(plain.workspaceParameters).toEqual([])
    expect(plain.selectedWorkspace).toBeNull()
    expect(plain.workspaceItem).toBeNull()
    expect(plain.orderResult).toBeNull()
  })

  it("stores scoped errors and clears them by scope", () => {
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
    let state = reducer(
      undefined,
      fmeActions.setError("general", error, widgetId)
    )

    // Assert
    let plain = toPlainState(state)
    expect(plain.error?.scope).toBe("general")
    expect(plain.error?.details.timestampMs).toBe(100)
    expect(plain.error?.details.kind).toBe("serializable")

    // Act - clear scoped error
    state = reducer(state, fmeActions.clearError("general", widgetId))

    // Assert
    plain = toPlainState(state)
    expect(plain.error).toBeNull()
  })

  it("clears all errors when requested", () => {
    // Arrange
    const reducer = createReducer()
    const error: ErrorState = {
      message: "Import crashed",
      type: ErrorType.NETWORK,
      code: "NET",
      severity: ErrorSeverity.ERROR,
      recoverable: false,
      timestamp: new Date(200),
      timestampMs: 200,
    }

    // Act
    let state = reducer(
      undefined,
      fmeActions.setError("import", error, widgetId)
    )
    state = reducer(state, fmeActions.clearError("all", widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.error).toBeNull()
  })

  it("ignores clear requests for unrelated scopes", () => {
    // Arrange
    const reducer = createReducer()
    const error: ErrorState = {
      message: "General issue",
      type: ErrorType.CONFIG,
      code: "CFG",
      severity: ErrorSeverity.ERROR,
      recoverable: true,
      timestamp: new Date(300),
      timestampMs: 300,
    }

    // Act
    const initial = reducer(
      undefined,
      fmeActions.setError("general", error, widgetId)
    )
    const state = reducer(initial, fmeActions.clearError("import", widgetId))

    // Assert
    expect(state).toBe(initial)
  })

  it("resets to drawing mode while clearing export state", () => {
    // Arrange
    const reducer = createReducer()
    let state = reducer(
      undefined,
      fmeActions.completeDrawing(
        { toJSON: () => ({}) } as any,
        99,
        ViewMode.EXPORT_FORM,
        widgetId
      )
    )
    state = reducer(
      state,
      fmeActions.setWorkspaceParameters([], "Clipper", widgetId)
    )
    state = reducer(
      state,
      fmeActions.setWorkspaceItem({ name: "Clipper" } as any, widgetId)
    )
    state = reducer(
      state,
      fmeActions.setOrderResult({ success: true, message: "ok" }, widgetId)
    )
    state = reducer(
      state,
      fmeActions.setError(
        "general",
        {
          message: "oops",
          type: ErrorType.CONFIG,
          code: "CFG",
          severity: ErrorSeverity.ERROR,
          recoverable: true,
          timestamp: new Date(400),
          timestampMs: 400,
        },
        widgetId
      )
    )

    // Act
    state = reducer(state, fmeActions.resetToDrawing(widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.viewMode).toBe(ViewMode.DRAWING)
    expect(plain.geometryJson).toBeNull()
    expect(plain.drawnArea).toBe(0)
    expect(plain.workspaceParameters).toEqual([])
    expect(plain.workspaceItem).toBeNull()
    expect(plain.orderResult).toBeNull()
    expect(plain.error).toBeNull()
  })

  it("marks startup as complete", () => {
    // Arrange
    const reducer = createReducer()

    // Act
    const state = reducer(undefined, fmeActions.completeStartup(widgetId))

    // Assert
    const plain = toPlainState(state)
    expect(plain.viewMode).toBe(ViewMode.INITIAL)
  })

  it("removes widget state entirely when requested", () => {
    // Arrange
    const reducer = createReducer()
    const populated = reducer(
      undefined,
      fmeActions.setViewMode(ViewMode.INITIAL, widgetId)
    )

    // Act
    const cleared = reducer(populated, fmeActions.removeWidgetState(widgetId))

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

describe("FME selectors", () => {
  const wrapState = (global: IMFmeGlobalState): IMStateWithFmeExport =>
    ({ "fme-state": global }) as unknown as IMStateWithFmeExport

  it("provides initial values when widget slice is missing", () => {
    const selectors = createFmeSelectors(widgetId)
    const stateWithoutSlice = wrapState({ byId: {} } as any)

    expect(selectors.selectDrawingTool(stateWithoutSlice)).toBe(
      initialFmeState.drawingTool
    )
    expect(selectors.selectWorkspaceItems(stateWithoutSlice)).toEqual(
      initialFmeState.workspaceItems
    )
  })

  it("reads drawing tool and workspace items from widget slice", () => {
    const selectors = createFmeSelectors(widgetId)
    const reducer = createReducer()

    let globalState = reducer(
      undefined,
      fmeActions.setDrawingTool(DrawingTool.RECTANGLE, widgetId)
    )
    const workspaceItems = [{ name: "Clipper" }]
    globalState = reducer(
      globalState,
      fmeActions.setWorkspaceItems(workspaceItems as any, widgetId)
    )

    const wrapped = wrapState(globalState)
    const selectedItems = selectors.selectWorkspaceItems(wrapped)

    expect(selectors.selectDrawingTool(wrapped)).toBe(DrawingTool.RECTANGLE)
    expect(Array.isArray(selectedItems)).toBe(true)
    expect((selectedItems as any)[0].name).toBe("Clipper")
  })
})
