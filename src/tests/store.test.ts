import { Immutable } from "jimu-core"
import StoreExtension, {
  fmeActions,
  initialFmeState,
} from "../extensions/store"
import {
  ViewMode,
  DrawingTool,
  FmeActionType,
  type FmeWidgetState,
  type SerializableErrorState,
} from "../config"

describe("FME Redux store extension", () => {
  const makeState = (patch?: Partial<FmeWidgetState>) =>
    Immutable({ ...initialFmeState, ...patch }) as any

  test("Store extension metadata and API", () => {
    const ext = new StoreExtension()
    expect(ext.id).toBe("fme-export_store")
    expect(ext.getStoreKey()).toBe("fme-state")
    expect(ext.getInitLocalState()).toEqual(initialFmeState)

    const actions = ext.getActions()
    const expected = Object.values(FmeActionType)
    expect(actions).toEqual(expected as any)

    const reducer = ext.getReducer()
    expect(typeof reducer).toBe("function")
    // Smoke: reduce a simple action
    const after = reducer(
      Immutable(initialFmeState) as any,
      fmeActions.setViewMode(ViewMode.DRAWING) as any
    )
    expect(after.viewMode).toBe(ViewMode.DRAWING)
    expect(after.previousViewMode).toBe(ViewMode.STARTUP_VALIDATION)
  })

  test("resetState restores initial state", () => {
    const reducer = new StoreExtension().getReducer()
    const dirty = makeState({ viewMode: ViewMode.DRAWING, clickCount: 3 })
    const reset = reducer(dirty, fmeActions.resetState() as any)
    expect(reset).toEqual(Immutable(initialFmeState))
  })

  test("setViewMode updates current and previous; idempotent when same", () => {
    const reducer = new StoreExtension().getReducer()
    const s1 = Immutable(initialFmeState) as any
    const s2 = reducer(s1, fmeActions.setViewMode(ViewMode.DRAWING) as any)
    expect(s2.viewMode).toBe(ViewMode.DRAWING)
    expect(s2.previousViewMode).toBe(ViewMode.STARTUP_VALIDATION)
    // Setting the same mode returns the same reference (idempotent)
    const s3 = reducer(s2, fmeActions.setViewMode(ViewMode.DRAWING) as any)
    expect(s3).toBe(s2)
  })

  test("setStartupValidationState toggles flags and serializes error", () => {
    const reducer = new StoreExtension().getReducer()
    const start = Immutable(initialFmeState) as any
    const eDate = new Date(1710000000000)
    // Pass an error-like object without timestampMs to test Date path
    const err: any = {
      message: "oops",
      type: "network",
      code: "E",
      severity: "error",
      recoverable: true,
      timestamp: eDate,
    }
    const next = reducer(
      start,
      fmeActions.setStartupValidationState(false, "step-a", err) as any
    )
    expect(next.isStartupValidating).toBe(false)
    expect(next.startupValidationStep).toBe("step-a")
    expect(next.startupValidationError?.message).toBe("oops")
    expect(next.startupValidationError?.timestampMs).toBe(eDate.getTime())

    const cleared = reducer(
      next,
      fmeActions.setStartupValidationState(true, undefined, null) as any
    )
    expect(cleared.isStartupValidating).toBe(true)
    expect(cleared.startupValidationError).toBeNull()
  })

  test("setGeometry stores JSON and drawnArea with defaults", () => {
    const reducer = new StoreExtension().getReducer()
    const s0 = Immutable(initialFmeState) as any
    const geom = {
      toJSON: () => ({ rings: [[[0, 0]]], spatialReference: { wkid: 3006 } }),
    }
    const s1 = reducer(s0, fmeActions.setGeometry(geom as any, 123.45) as any)
    expect(s1.geometryJson).toEqual({
      rings: [[[0, 0]]],
      spatialReference: { wkid: 3006 },
    })
    expect(s1.drawnArea).toBe(123.45)

    const s2 = reducer(s1, fmeActions.setGeometry(null as any) as any)
    expect(s2.geometryJson).toBeNull()
    expect(s2.drawnArea).toBe(0)
  })

  test("drawing state: setDrawingState, setDrawingTool, setClickCount", () => {
    const r = new StoreExtension().getReducer()
    const s0 = Immutable(initialFmeState) as any
    const s1 = r(
      s0,
      fmeActions.setDrawingState(true, 2, DrawingTool.RECTANGLE) as any
    )
    expect(s1.isDrawing).toBe(true)
    expect(s1.clickCount).toBe(2)
    expect(s1.drawingTool).toBe(DrawingTool.RECTANGLE)

    const s2 = r(s1, fmeActions.setDrawingState(false) as any)
    expect(s2.isDrawing).toBe(false)
    // Fallback preserves prior clickCount and tool
    expect(s2.clickCount).toBe(2)
    expect(s2.drawingTool).toBe(DrawingTool.RECTANGLE)

    const s3 = r(s2, fmeActions.setDrawingTool(DrawingTool.POLYGON) as any)
    expect(s3.drawingTool).toBe(DrawingTool.POLYGON)

    const s4 = r(s3, fmeActions.setClickCount(9) as any)
    expect(s4.clickCount).toBe(9)
  })

  test("form and order: setFormValues, setOrderResult toggles isSubmittingOrder=false", () => {
    const r = new StoreExtension().getReducer()
    const s0 = makeState({ isSubmittingOrder: true })
    const s1 = r(s0, fmeActions.setFormValues({ a: 1, b: "x" }) as any)
    expect(s1.formValues).toEqual({ a: 1, b: "x" })
    const s2 = r(
      s1,
      fmeActions.setOrderResult({
        success: true,
        message: "ok",
        jobId: 7,
      } as any) as any
    )
    expect(s2.orderResult).toEqual({ success: true, message: "ok", jobId: 7 })
    expect(s2.isSubmittingOrder).toBe(false)
  })

  test("workspace: items, parameters, selection, item, with repository scoping", () => {
    const r = new StoreExtension().getReducer()
    const s0 = makeState()
    const s1 = r(
      s0,
      fmeActions.setWorkspaceItems(
        [{ name: "ws1" }, { name: "ws2" }],
        "RepoA"
      ) as any
    )
    expect(s1.workspaceItems).toEqual([{ name: "ws1" }, { name: "ws2" }])
    expect(s1.currentRepository).toBe("RepoA")

    const s2 = r(
      s1,
      fmeActions.setWorkspaceParameters(
        [{ name: "P1", optional: true, type: "TEXT" } as any],
        "ws1",
        "RepoB"
      ) as any
    )
    expect(s2.workspaceParameters[0].name).toBe("P1")
    expect(s2.selectedWorkspace).toBe("ws1")
    expect(s2.currentRepository).toBe("RepoB")

    const s3 = r(s2, fmeActions.setSelectedWorkspace("ws2", "RepoC") as any)
    expect(s3.selectedWorkspace).toBe("ws2")
    expect(s3.currentRepository).toBe("RepoC")

    const itemDetail = {
      name: "ws2",
      parameters: [{ name: "X", optional: true, type: "TEXT" } as any],
    }
    const s4 = r(
      s3,
      fmeActions.setWorkspaceItem(itemDetail as any, "RepoC") as any
    )
    expect(s4.workspaceItem).toEqual(itemDetail)
    expect(s4.currentRepository).toBe("RepoC")
  })

  test("loading flags: isModulesLoading and isSubmittingOrder only", () => {
    const r = new StoreExtension().getReducer()
    const s0 = makeState({ isSubmittingOrder: false, isModulesLoading: false })
    const s1 = r(
      s0,
      fmeActions.setLoadingFlags({ isModulesLoading: true }) as any
    )
    expect(s1.isModulesLoading).toBe(true)
    expect(s1.isSubmittingOrder).toBe(false)

    const s2 = r(
      s1,
      fmeActions.setLoadingFlags({ isSubmittingOrder: true }) as any
    )
    expect(s2.isModulesLoading).toBe(true)
    expect(s2.isSubmittingOrder).toBe(true)
  })

  test("clearWorkspaceState resets related fields and repository", () => {
    const r = new StoreExtension().getReducer()
    const s0 = makeState({
      workspaceItems: [{ name: "a" } as any],
      workspaceParameters: [{ name: "P", optional: true, type: "TEXT" } as any],
      selectedWorkspace: "a",
      workspaceItem: { name: "a" } as any,
      formValues: { x: 1 },
      currentRepository: "RepoX",
      isLoadingWorkspaces: true,
      isLoadingParameters: true,
    })
    const s1 = r(s0, fmeActions.clearWorkspaceState("RepoY") as any)
    expect(s1.workspaceItems).toEqual([])
    expect(s1.workspaceParameters).toEqual([])
    expect(s1.selectedWorkspace).toBeNull()
    expect(s1.workspaceItem).toBeNull()
    expect(s1.formValues).toEqual({})
    expect(s1.currentRepository).toBe("RepoY")
    expect(s1.isLoadingWorkspaces).toBe(false)
    expect(s1.isLoadingParameters).toBe(false)
  })

  test("errors: setError, setImportError, setExportError serialize and store", () => {
    const r = new StoreExtension().getReducer()
    const s0 = makeState()
    const errWithMs: any = {
      message: "m1",
      type: "network",
      code: "C1",
      severity: "error",
      recoverable: false,
      timestampMs: 123,
    }
    const s1 = r(s0, fmeActions.setError(errWithMs) as any)
    expect((s1.error as SerializableErrorState)?.timestampMs).toBe(123)
    expect((s1.error as SerializableErrorState)?.message).toBe("m1")

    const s2 = r(s1, fmeActions.setImportError(errWithMs) as any)
    expect((s2.importError as SerializableErrorState)?.code).toBe("C1")

    const s3 = r(s2, fmeActions.setExportError(errWithMs) as any)
    expect((s3.exportError as SerializableErrorState)?.code).toBe("C1")
  })
})
