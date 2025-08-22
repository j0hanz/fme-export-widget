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
    initExtensions()
    initStore()
  })

  test("extension metadata and action creators", () => {
    const ext = new FmeReduxStoreExtension()
    expect(ext.id).toBe("fme-export_store")
    expect(ext.getStoreKey()).toBe("fme-state")
    expect(ext.getActions().sort()).toEqual(Object.values(FmeActionType).sort())

    // Test action creator shapes
    expect(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION)).toEqual({
      type: FmeActionType.SET_VIEW_MODE,
      viewMode: ViewMode.WORKSPACE_SELECTION,
    })

    expect(
      fmeActions.setStartupValidationState(true, "Testing...", null)
    ).toEqual({
      type: FmeActionType.SET_STARTUP_VALIDATION_STATE,
      isValidating: true,
      validationStep: "Testing...",
      validationError: null,
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
  })

  test("initial state defaults", () => {
    const ext = new FmeReduxStoreExtension()
    const state = ext.getInitLocalState()

    expect(state.viewMode).toBe(ViewMode.STARTUP_VALIDATION)
    expect(state.isStartupValidating).toBe(true)
    expect(state.startupValidationStep).toBeUndefined()
    expect(state.startupValidationError).toBeNull()
    expect(state.isDrawing).toBe(false)
    expect(state.drawnArea).toBe(0)
    expect(state.geometryJson).toBeNull()
    expect(state.formValues).toEqual({})
    expect(state.workspaceItems).toEqual([])
  })

  describe("reducer transitions", () => {
    const ext = new FmeReduxStoreExtension()
    const reducer = ext.getReducer()

    const makeState = () => Immutable(initialFmeState)

    test("SET_VIEW_MODE transitions and RESET_STATE", () => {
      const state = makeState()

      // Initial transition
      const s1 = reducer(state as any, fmeActions.setViewMode(ViewMode.DRAWING))
      expect((s1 as any).previousViewMode).toBe(ViewMode.STARTUP_VALIDATION)
      expect((s1 as any).viewMode).toBe(ViewMode.DRAWING)

      // No-op when unchanged
      const s2 = reducer(s1 as any, fmeActions.setViewMode(ViewMode.DRAWING))
      expect(s2).toBe(s1)

      // Multiple transitions update previousViewMode
      const s3 = reducer(
        s1 as any,
        fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION)
      )
      expect((s3 as any).previousViewMode).toBe(ViewMode.DRAWING)
      expect((s3 as any).viewMode).toBe(ViewMode.WORKSPACE_SELECTION)

      // RESET_STATE restores initial state
      const modifiedState = makeState()
        .set("isDrawing", true)
        .set("drawnArea", 100)
      const resetState = reducer(modifiedState as any, fmeActions.resetState())
      expect((resetState as any).isDrawing).toBe(false)
      expect((resetState as any).viewMode).toBe(ViewMode.STARTUP_VALIDATION)
      expect((resetState as any).drawnArea).toBe(0)
    })

    test("startup validation state management", () => {
      let state = makeState()

      // SET_STARTUP_VALIDATION_STATE updates validation fields
      const validationError = {
        message: "Config error",
        severity: ErrorSeverity.ERROR,
        type: ErrorType.CONFIG,
        timestamp: new Date(0),
      }

      state = reducer(
        state as any,
        fmeActions.setStartupValidationState(
          true,
          "Validating connection...",
          null
        )
      )
      expect((state as any).isStartupValidating).toBe(true)
      expect((state as any).startupValidationStep).toBe(
        "Validating connection..."
      )
      expect((state as any).startupValidationError).toBeNull()

      // Update with error
      state = reducer(
        state as any,
        fmeActions.setStartupValidationState(false, undefined, validationError)
      )
      expect((state as any).isStartupValidating).toBe(false)
      expect((state as any).startupValidationStep).toBeUndefined()
      expect((state as any).startupValidationError).toEqual(validationError)

      // Clear validation state
      state = reducer(
        state as any,
        fmeActions.setStartupValidationState(false, undefined, null)
      )
      expect((state as any).isStartupValidating).toBe(false)
      expect((state as any).startupValidationStep).toBeUndefined()
      expect((state as any).startupValidationError).toBeNull()
    })

    test("drawing state and geometry management", () => {
      let state = makeState()

      // SET_GEOMETRY stores JSON and area
      const mockGeo = { toJSON: () => ({ type: "polygon", rings: [[[0, 0]]] }) }
      state = reducer(
        state as any,
        fmeActions.setGeometry(mockGeo as any, 123.45)
      )
      expect((state as any).geometryJson).toEqual({
        type: "polygon",
        rings: [[[0, 0]]],
      })
      expect((state as any).drawnArea).toBe(123.45)

      // Null geometry clears data
      state = reducer(state as any, fmeActions.setGeometry(null))
      expect((state as any).geometryJson).toBeNull()
      expect((state as any).drawnArea).toBe(0)

      // SET_DRAWING_STATE with all parameters
      state = reducer(
        state as any,
        fmeActions.setDrawingState(true, 2, DrawingTool.RECTANGLE)
      )
      expect((state as any).isDrawing).toBe(true)
      expect((state as any).clickCount).toBe(2)
      expect((state as any).drawingTool).toBe(DrawingTool.RECTANGLE)

      // SET_DRAWING_STATE with partial parameters preserves unchanged values
      state = reducer(state as any, fmeActions.setDrawingState(false))
      expect((state as any).isDrawing).toBe(false)
      expect((state as any).clickCount).toBe(2) // unchanged
      expect((state as any).drawingTool).toBe(DrawingTool.RECTANGLE) // unchanged

      // Individual drawing actions
      state = reducer(
        state as any,
        fmeActions.setDrawingTool(DrawingTool.POLYGON)
      )
      expect((state as any).drawingTool).toBe(DrawingTool.POLYGON)

      state = reducer(state as any, fmeActions.setClickCount(5))
      expect((state as any).clickCount).toBe(5)
    })

    test("form values and order results", () => {
      let state = makeState()

      // SET_FORM_VALUES stores provided values
      const values = {
        Foo: "bar",
        Count: 3,
        Flag: true,
        List: ["a", "b"] as const,
      }
      state = reducer(state as any, fmeActions.setFormValues(values) as any)
      expect((state as any).formValues).toEqual(values)

      // SET_ORDER_RESULT stores result and clears isSubmittingOrder
      const orderResult = { success: true, jobId: 42, workspaceName: "ws" }
      const stateWithSubmitting = state.set("isSubmittingOrder", true)
      state = reducer(
        stateWithSubmitting as any,
        fmeActions.setOrderResult(orderResult as any)
      )
      expect((state as any).orderResult).toEqual(orderResult)
      expect((state as any).isSubmittingOrder).toBe(false)
    })

    test("workspace management and loading flags", () => {
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

      // Workspace actions
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

      // Loading flags - individual and combined
      state = reducer(
        state as any,
        fmeActions.setLoadingFlags({ isModulesLoading: true })
      )
      expect((state as any).isModulesLoading).toBe(true)
      expect((state as any).isSubmittingOrder).toBe(false) // unchanged

      state = reducer(
        state as any,
        fmeActions.setLoadingFlags({
          isModulesLoading: false,
          isSubmittingOrder: true,
        })
      )
      expect((state as any).isModulesLoading).toBe(false)
      expect((state as any).isSubmittingOrder).toBe(true)
    })

    test("error state management", () => {
      const baseError = {
        message: "Oops",
        severity: ErrorSeverity.ERROR,
        type: ErrorType.NETWORK,
        timestamp: new Date(0),
      }

      let state = makeState()

      // Setting errors in different buckets
      state = reducer(state as any, fmeActions.setError(baseError))
      expect((state as any).error).toEqual(baseError)

      const importErr = { ...baseError, message: "Import" }
      state = reducer(state as any, fmeActions.setImportError(importErr))
      expect((state as any).importError).toEqual(importErr)

      const exportErr = { ...baseError, message: "Export" }
      state = reducer(state as any, fmeActions.setExportError(exportErr))
      expect((state as any).exportError).toEqual(exportErr)

      // Clearing errors with null
      state = reducer(state as any, fmeActions.setError(null))
      expect((state as any).error).toBeNull()

      state = reducer(state as any, fmeActions.setImportError(null))
      expect((state as any).importError).toBeNull()

      state = reducer(state as any, fmeActions.setExportError(null))
      expect((state as any).exportError).toBeNull()
    })
  })
})
