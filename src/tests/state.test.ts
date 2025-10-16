import { createStore } from "redux"
import FmeReduxStoreExtension, {
  fmeActions,
  createFmeSelectors,
} from "../extensions/store"
import {
  DrawingTool,
  ErrorSeverity,
  ErrorType,
  ViewMode,
} from "../config/index"

const extension = new FmeReduxStoreExtension()
const reducer = extension.getReducer()
const widgetId = "widget-test"

const wrapState = (state: ReturnType<typeof reducer>) =>
  ({
    "fme-state": state,
  }) as any

describe("fme Redux state", () => {
  it("tracks geometry updates", () => {
    let state = reducer(undefined, { type: "@@INIT" })
    const selectors = createFmeSelectors(widgetId)

    const stubGeometryJson = { rings: [[[0, 0]]] }
    const stubGeometry = {
      toJSON: () => stubGeometryJson,
    } as any

    state = reducer(state, fmeActions.setGeometry(stubGeometry, 1250, widgetId))

    const wrapped = wrapState(state)
    expect(selectors.selectGeometryJson(wrapped)).toEqual(stubGeometryJson)
    expect(selectors.selectDrawnArea(wrapped)).toBe(1250)

    state = reducer(state, fmeActions.setGeometry(stubGeometry, 1250, widgetId))
    expect(selectors.selectGeometryJson(wrapState(state))).toEqual(
      stubGeometryJson
    )
    expect(selectors.selectDrawnArea(wrapState(state))).toBe(1250)

    const updatedGeometry = {
      toJSON: () => ({ rings: [[[1, 1]]] }),
    } as any
    state = reducer(
      state,
      fmeActions.setGeometry(updatedGeometry, 3000, widgetId)
    )
    expect(selectors.selectGeometryJson(wrapState(state))).toEqual({
      rings: [[[1, 1]]],
    })
    expect(selectors.selectDrawnArea(wrapState(state))).toBe(3000)
  })

  it("derives export availability from combined state", () => {
    let state = reducer(undefined, { type: "@@INIT" })
    const selectors = createFmeSelectors(widgetId)
    const geometryStub = {
      toJSON: () => ({ rings: [[[10, 10]]] }),
    } as any

    state = reducer(state, fmeActions.setGeometry(geometryStub, 500, widgetId))

    state = reducer(
      state,
      fmeActions.setWorkspaceParameters(
        [
          {
            name: "paramA",
            value: "alpha",
            description: "",
            optional: true,
            orderIndex: 0,
            dataType: "string",
          } as any,
        ],
        "WorkspaceA",
        widgetId
      )
    )

    state = reducer(
      state,
      fmeActions.setSelectedWorkspace("WorkspaceA", widgetId)
    )

    expect(selectors.selectCanExport(wrapState(state))).toBe(true)

    state = reducer(state, fmeActions.setError("general", null, widgetId))
    expect(selectors.selectCanExport(wrapState(state))).toBe(true)

    const blockingError = {
      message: "fatal",
      type: ErrorType.CONFIG,
      code: "FATAL",
      severity: ErrorSeverity.ERROR,
      recoverable: false,
      timestampMs: Date.now(),
    }

    state = reducer(
      state,
      fmeActions.setError("general", blockingError, widgetId)
    )

    expect(selectors.selectCanExport(wrapState(state))).toBe(false)
  })

  it("prioritises highest severity scoped errors", () => {
    let state = reducer(undefined, { type: "@@INIT" })
    const selectors = createFmeSelectors(widgetId)

    const warning = {
      message: "warn",
      type: ErrorType.NETWORK,
      code: "WARN",
      severity: ErrorSeverity.WARNING,
      recoverable: true,
      timestampMs: Date.now(),
    }

    const critical = {
      message: "fail",
      type: ErrorType.NETWORK,
      code: "FAIL",
      severity: ErrorSeverity.ERROR,
      recoverable: false,
      timestampMs: Date.now(),
    }

    state = reducer(state, fmeActions.setErrors({ general: warning }, widgetId))
    expect(selectors.selectPrimaryError(wrapState(state))?.scope).toBe(
      "general"
    )

    state = reducer(state, fmeActions.setErrors({ export: critical }, widgetId))

    const active = selectors.selectPrimaryError(wrapState(state))
    expect(active?.scope).toBe("export")
    expect(active?.details.severity).toBe(ErrorSeverity.ERROR)
  })

  it("resetToDrawing clears export state but keeps drawing mode", () => {
    const store = createStore(reducer)
    store.dispatch({ type: "@@INIT" })

    store.dispatch(
      fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION, widgetId)
    )
    store.dispatch(fmeActions.setDrawingTool(DrawingTool.RECTANGLE, widgetId))

    const geometry = {
      toJSON: () => ({ rings: [[[5, 5]]] }),
    } as any

    store.dispatch(fmeActions.setGeometry(geometry, 800, widgetId))
    store.dispatch(
      fmeActions.setWorkspaceParameters(
        [
          {
            name: "param",
            value: "value",
            description: "",
            optional: false,
            orderIndex: 0,
            dataType: "string",
          } as any,
        ],
        "WorkspaceB",
        widgetId
      )
    )

    store.dispatch(fmeActions.resetToDrawing(widgetId))

    const selectors = createFmeSelectors(widgetId)
    const wrapped = wrapState(store.getState())

    expect(selectors.selectViewMode(wrapped)).toBe(ViewMode.DRAWING)
    expect(selectors.selectGeometryJson(wrapped)).toBeNull()
    expect(selectors.selectWorkspaceParameters(wrapped)).toHaveLength(0)
    expect(selectors.selectDrawingTool(wrapped)).toBe(DrawingTool.RECTANGLE)
  })
})
