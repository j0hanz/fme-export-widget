import { Immutable } from "jimu-core"
import {
  DrawingTool,
  ErrorSeverity,
  ErrorType,
  FmeActionType,
  ParameterType,
  type WorkspaceItem,
  type WorkspaceItemDetail,
  type WorkspaceParameter,
  ViewMode,
} from "../shared/types"
import FmeReduxStoreExtension, {
  fmeActions,
  initialFmeState,
} from "../extensions/store"
import { initExtensions, initStore } from "jimu-for-test"

describe("FME store - Redux store extension and reducer", () => {
  beforeAll(() => {
    // Initialize testing environment (safe no-ops for these tests but ensures EXB deps are registered)
    initExtensions()
    initStore()
  })

  it("exposes extension metadata and actions", () => {
    const ext = new FmeReduxStoreExtension()
    expect(ext.id).toBe("fme-export_store")
    expect(ext.getStoreKey()).toBe("fme-state")
    expect(ext.getActions().sort()).toEqual(Object.values(FmeActionType).sort())
  })

  it("action creators: setViewMode and setError produce correct shapes", () => {
    const a = fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION)
    expect(a).toEqual({
      type: FmeActionType.SET_VIEW_MODE,
      viewMode: ViewMode.WORKSPACE_SELECTION,
    })

    const err = {
      message: "boom",
      severity: ErrorSeverity.ERROR,
      type: ErrorType.NETWORK,
      timestamp: new Date(0),
    }
    expect(fmeActions.setError(err)).toEqual({
      type: FmeActionType.SET_ERROR,
      error: err,
    })
    expect(fmeActions.setImportError(err)).toEqual({
      type: FmeActionType.SET_IMPORT_ERROR,
      error: err,
    })
    expect(fmeActions.setExportError(err)).toEqual({
      type: FmeActionType.SET_EXPORT_ERROR,
      error: err,
    })
  })

  it("provides the expected initial state", () => {
    const ext = new FmeReduxStoreExtension()
    expect(ext.getInitLocalState()).toEqual(initialFmeState)
    // Spot-check a few defaults
    const s = ext.getInitLocalState()
    expect(s.viewMode).toBe(ViewMode.INITIAL)
    expect(s.isDrawing).toBe(false)
    expect(s.drawnArea).toBe(0)
    expect(s.geometryJson).toBeNull()
  })

  describe("reducer transitions", () => {
    const ext = new FmeReduxStoreExtension()
    const reducer = ext.getReducer()

    const makeState = () => Immutable(initialFmeState)

    it("SET_VIEW_MODE sets previous and current view; no-op when unchanged", () => {
      const state = makeState()
      const a1 = fmeActions.setViewMode(ViewMode.DRAWING)
      const s1 = reducer(state as any, a1)
      expect((s1 as any).previousViewMode).toBe(ViewMode.INITIAL)
      expect((s1 as any).viewMode).toBe(ViewMode.DRAWING)

      // Dispatching same view should return same reference (early return)
      const s2 = reducer(s1 as any, fmeActions.setViewMode(ViewMode.DRAWING))
      expect(s2).toBe(s1)
    })

    it("SET_VIEW_MODE updates previousViewMode across multiple transitions", () => {
      const state = makeState()
      const s1 = reducer(state as any, fmeActions.setViewMode(ViewMode.DRAWING))
      expect((s1 as any).previousViewMode).toBe(ViewMode.INITIAL)
      expect((s1 as any).viewMode).toBe(ViewMode.DRAWING)

      const s2 = reducer(
        s1 as any,
        fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION)
      )
      expect((s2 as any).previousViewMode).toBe(ViewMode.DRAWING)
      expect((s2 as any).viewMode).toBe(ViewMode.WORKSPACE_SELECTION)
    })

    it("RESET_STATE restores initial state", () => {
      let state = makeState()
      state = state.set("isDrawing", true)
      const s1 = reducer(state as any, fmeActions.resetState())
      expect((s1 as any).isDrawing).toBe(false)
      expect((s1 as any).viewMode).toBe(ViewMode.INITIAL)
      expect((s1 as any).drawnArea).toBe(0)
      expect((s1 as any).geometryJson).toBeNull()
    })

    it("SET_GEOMETRY stores JSON and area; null clears geometry and sets area=0 by default", () => {
      const mockGeo = { toJSON: () => ({ type: "polygon", rings: [[[0, 0]]] }) }
      const state = makeState()
      const s1 = reducer(
        state as any,
        fmeActions.setGeometry(mockGeo as any, 123.45)
      )
      expect((s1 as any).geometryJson).toEqual({
        type: "polygon",
        rings: [[[0, 0]]],
      })
      expect((s1 as any).drawnArea).toBe(123.45)

      const s2 = reducer(s1 as any, fmeActions.setGeometry(null))
      expect((s2 as any).geometryJson).toBeNull()
      expect((s2 as any).drawnArea).toBe(0)
    })

    it("SET_DRAWING_STATE updates drawing flags, click count and tool when provided", () => {
      const state = makeState()
      const s1 = reducer(
        state as any,
        fmeActions.setDrawingState(true, 2, DrawingTool.RECTANGLE)
      )
      expect((s1 as any).isDrawing).toBe(true)
      expect((s1 as any).clickCount).toBe(2)
      expect((s1 as any).drawingTool).toBe(DrawingTool.RECTANGLE)

      const s2 = reducer(s1 as any, fmeActions.setDrawingState(false))
      expect((s2 as any).isDrawing).toBe(false)
      // clickCount remains unchanged when omitted
      expect((s2 as any).clickCount).toBe(2)
      // drawingTool remains unchanged when omitted
      expect((s2 as any).drawingTool).toBe(DrawingTool.RECTANGLE)
    })

    it("SET_DRAWING_TOOL and SET_CLICK_COUNT update individually", () => {
      let state = makeState()
      state = reducer(
        state as any,
        fmeActions.setDrawingTool(DrawingTool.RECTANGLE)
      )
      expect((state as any).drawingTool).toBe(DrawingTool.RECTANGLE)

      state = reducer(state as any, fmeActions.setClickCount(5))
      expect((state as any).clickCount).toBe(5)
    })

    it("SET_FORM_VALUES stores provided values", () => {
      const values = {
        Foo: "bar",
        Count: 3,
        Flag: true,
        List: ["a", "b"] as const,
      }
      const s1 = reducer(
        makeState() as any,
        fmeActions.setFormValues(values) as any
      )
      expect((s1 as any).formValues).toEqual(values)
    })

    it("SET_ORDER_RESULT stores result and clears isSubmittingOrder", () => {
      const orderResult = { success: true, jobId: 42, workspaceName: "ws" }
      const state = makeState().set("isSubmittingOrder", true)
      const s1 = reducer(
        state as any,
        fmeActions.setOrderResult(orderResult as any)
      )
      expect((s1 as any).orderResult).toEqual(orderResult)
      expect((s1 as any).isSubmittingOrder).toBe(false)
    })

    it("workspace actions update items, parameters+selection, selection, and item detail", () => {
      const items: readonly WorkspaceItem[] = [
        { name: "ws1", title: "WS 1", description: "d1", type: "WORKSPACE" },
      ]
      const params: readonly WorkspaceParameter[] = [
        {
          name: "Param1",
          description: "desc",
          type: ParameterType.TEXT,
          defaultValue: "x",
          model: "MODEL",
        },
      ]
      const detail: WorkspaceItemDetail = {
        name: "ws1",
        title: "WS 1",
        description: "d1",
        type: "WORKSPACE",
        parameters: params,
      }

      let state = makeState()
      state = reducer(state as any, fmeActions.setWorkspaceItems(items))
      expect((state as any).workspaceItems).toEqual(items)

      state = reducer(
        state as any,
        fmeActions.setWorkspaceParameters(params, "ws1")
      )
      expect((state as any).workspaceParameters).toEqual(params)
      expect((state as any).selectedWorkspace).toBe("ws1")

      state = reducer(state as any, fmeActions.setSelectedWorkspace("ws2"))
      expect((state as any).selectedWorkspace).toBe("ws2")

      state = reducer(state as any, fmeActions.setWorkspaceItem(detail))
      expect((state as any).workspaceItem).toEqual(detail)
    })

    it("SET_LOADING_FLAGS updates flags individually and together", () => {
      let state = makeState()
      state = reducer(
        state as any,
        fmeActions.setLoadingFlags({ isModulesLoading: true })
      )
      expect((state as any).isModulesLoading).toBe(true)
      expect((state as any).isSubmittingOrder).toBe(false)

      state = reducer(
        state as any,
        fmeActions.setLoadingFlags({ isSubmittingOrder: true })
      )
      expect((state as any).isSubmittingOrder).toBe(true)

      state = reducer(
        state as any,
        fmeActions.setLoadingFlags({
          isModulesLoading: false,
          isSubmittingOrder: false,
        })
      )
      expect((state as any).isModulesLoading).toBe(false)
      expect((state as any).isSubmittingOrder).toBe(false)
    })

    it("error actions set appropriate error buckets", () => {
      const baseError = {
        message: "Oops",
        severity: ErrorSeverity.ERROR,
        type: ErrorType.NETWORK,
        timestamp: new Date(),
      }
      let state = makeState()

      state = reducer(state as any, fmeActions.setError(baseError))
      expect((state as any).error).toEqual(baseError)

      const importErr = { ...baseError, message: "Import" }
      state = reducer(state as any, fmeActions.setImportError(importErr))
      expect((state as any).importError).toEqual(importErr)

      const exportErr = { ...baseError, message: "Export" }
      state = reducer(state as any, fmeActions.setExportError(exportErr))
      expect((state as any).exportError).toEqual(exportErr)
    })

    it("error actions clear buckets when payload is null", () => {
      const baseError = {
        message: "Oops",
        severity: ErrorSeverity.ERROR,
        type: ErrorType.NETWORK,
        timestamp: new Date(0),
      }

      let state = makeState()
      // Generic error
      state = reducer(state as any, fmeActions.setError(baseError))
      expect((state as any).error).toEqual(baseError)
      state = reducer(state as any, fmeActions.setError(null))
      expect((state as any).error).toBeNull()

      // Import error
      state = reducer(state as any, fmeActions.setImportError(baseError))
      expect((state as any).importError).toEqual(baseError)
      state = reducer(state as any, fmeActions.setImportError(null))
      expect((state as any).importError).toBeNull()

      // Export error
      state = reducer(state as any, fmeActions.setExportError(baseError))
      expect((state as any).exportError).toEqual(baseError)
      state = reducer(state as any, fmeActions.setExportError(null))
      expect((state as any).exportError).toBeNull()
    })
  })
})
