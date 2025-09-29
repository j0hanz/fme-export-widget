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
} from "../config"

describe("FME Redux store extension", () => {
  const WID = "w1"
  const WID2 = "w2"

  const makeGlobal = (patch?: Partial<FmeWidgetState>) =>
    Immutable({ byId: { [WID]: { ...initialFmeState, ...patch } } }) as any

  const emptyGlobal = () =>
    Immutable(new StoreExtension().getInitLocalState()) as any

  const sub = (globalState: any, wid: string = WID): FmeWidgetState =>
    globalState.byId?.[wid]

  test("Store extension metadata and API", () => {
    const ext = new StoreExtension()
    expect(ext.id).toBe("fme-export_store")
    expect(ext.getStoreKey()).toBe("fme-state")
    expect(ext.getInitLocalState()).toEqual({ byId: {} })

    const actions = ext.getActions()
    const expected = Object.values(FmeActionType)
    expect(actions).toEqual(expected as any)

    const reducer = ext.getReducer()
    expect(typeof reducer).toBe("function")
    // Smoke: reduce a simple action into empty global → creates substate
    const g0 = emptyGlobal()
    const g1 = reducer(g0, fmeActions.setViewMode(ViewMode.DRAWING, WID) as any)
    expect(sub(g1).viewMode).toBe(ViewMode.DRAWING)
    expect(sub(g1).previousViewMode).toBe(ViewMode.STARTUP_VALIDATION)
  })

  test("resetState restores initial state", () => {
    const reducer = new StoreExtension().getReducer()
    const dirty = makeGlobal({ viewMode: ViewMode.DRAWING, clickCount: 3 })
    const resetG = reducer(dirty, fmeActions.resetState(WID) as any)
    expect(sub(resetG)).toEqual(Immutable(initialFmeState))
  })

  test("setViewMode updates current and previous; idempotent when same", () => {
    const reducer = new StoreExtension().getReducer()
    const g0 = emptyGlobal()
    const g1 = reducer(g0, fmeActions.setViewMode(ViewMode.DRAWING, WID) as any)
    const sub1 = sub(g1)
    expect(sub1.viewMode).toBe(ViewMode.DRAWING)
    expect(sub1.previousViewMode).toBe(ViewMode.STARTUP_VALIDATION)
    // Setting the same mode returns the same substate reference
    const g2 = reducer(g1, fmeActions.setViewMode(ViewMode.DRAWING, WID) as any)
    const sub2 = sub(g2)
    expect(sub2).toBe(sub1)
  })

  test("setStartupValidationState toggles flags and serializes error", () => {
    const reducer = new StoreExtension().getReducer()
    const start = emptyGlobal()
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
    const nextG = reducer(
      start,
      fmeActions.setStartupValidationState(false, "step-a", err, WID) as any
    )
    expect(sub(nextG).isStartupValidating).toBe(false)
    expect(sub(nextG).startupValidationStep).toBe("step-a")
    expect(sub(nextG).startupValidationError?.message).toBe("oops")
    expect(sub(nextG).startupValidationError?.timestampMs).toBe(eDate.getTime())

    const clearedG = reducer(
      nextG,
      fmeActions.setStartupValidationState(true, undefined, null, WID) as any
    )
    expect(sub(clearedG).isStartupValidating).toBe(true)
    expect(sub(clearedG).startupValidationError).toBeNull()
  })

  test("setGeometry stores JSON and drawnArea with defaults", () => {
    const reducer = new StoreExtension().getReducer()
    const g0 = emptyGlobal()
    const geom = {
      toJSON: () => ({ rings: [[[0, 0]]], spatialReference: { wkid: 3006 } }),
    }
    const g1 = reducer(
      g0,
      fmeActions.setGeometry(geom as any, 123.45, WID) as any
    )
    expect(sub(g1).geometryJson).toEqual({
      rings: [[[0, 0]]],
      spatialReference: { wkid: 3006 },
    })
    expect(sub(g1).drawnArea).toBe(123.45)

    const g2 = reducer(
      g1,
      fmeActions.setGeometry(null as any, undefined, WID) as any
    )
    expect(sub(g2).geometryJson).toBeNull()
    expect(sub(g2).drawnArea).toBe(0)
  })

  test("drawing state: setDrawingState, setDrawingTool, setClickCount", () => {
    const r = new StoreExtension().getReducer()
    const g0 = emptyGlobal()
    const g1 = r(
      g0,
      fmeActions.setDrawingState(true, 2, DrawingTool.RECTANGLE, WID) as any
    )
    expect(sub(g1).isDrawing).toBe(true)
    expect(sub(g1).clickCount).toBe(2)
    expect(sub(g1).drawingTool).toBe(DrawingTool.RECTANGLE)

    const g2 = r(
      g1,
      fmeActions.setDrawingState(false, undefined, undefined, WID) as any
    )
    expect(sub(g2).isDrawing).toBe(false)
    // Fallback preserves prior clickCount and tool
    expect(sub(g2).clickCount).toBe(2)
    expect(sub(g2).drawingTool).toBe(DrawingTool.RECTANGLE)

    const g3 = r(g2, fmeActions.setDrawingTool(DrawingTool.POLYGON, WID) as any)
    expect(sub(g3).drawingTool).toBe(DrawingTool.POLYGON)

    const g4 = r(g3, fmeActions.setClickCount(9, WID) as any)
    expect(sub(g4).clickCount).toBe(9)
  })

  test("form and order: setFormValues, setOrderResult toggles isSubmittingOrder=false", () => {
    const r = new StoreExtension().getReducer()
    const g0 = makeGlobal({ isSubmittingOrder: true })
    const g1 = r(g0, fmeActions.setFormValues({ a: 1, b: "x" }, WID) as any)
    expect(sub(g1).formValues).toEqual({ a: 1, b: "x" })
    const g2 = r(
      g1,
      fmeActions.setOrderResult(
        {
          success: true,
          message: "ok",
          jobId: 7,
        } as any,
        WID
      ) as any
    )
    expect(sub(g2).orderResult).toEqual({
      success: true,
      message: "ok",
      jobId: 7,
    })
    expect(sub(g2).isSubmittingOrder).toBe(false)
  })

  test("workspace: items, parameters, selection, item, with repository scoping", () => {
    const r = new StoreExtension().getReducer()
    const g0 = makeGlobal()
    const g1 = r(
      g0,
      fmeActions.setWorkspaceItems(
        [{ name: "ws1" }, { name: "ws2" }],
        "RepoA",
        WID
      ) as any
    )
    expect(sub(g1).workspaceItems).toEqual([{ name: "ws1" }, { name: "ws2" }])
    expect(sub(g1).currentRepository).toBe("RepoA")

    const g2 = r(
      g1,
      fmeActions.setWorkspaceParameters(
        [{ name: "P1", optional: true, type: "TEXT" } as any],
        "ws1",
        "RepoB",
        WID
      ) as any
    )
    expect(sub(g2).workspaceParameters[0].name).toBe("P1")
    expect(sub(g2).selectedWorkspace).toBe("ws1")
    expect(sub(g2).currentRepository).toBe("RepoB")

    const g3 = r(
      g2,
      fmeActions.setSelectedWorkspace("ws2", "RepoC", WID) as any
    )
    expect(sub(g3).selectedWorkspace).toBe("ws2")
    expect(sub(g3).currentRepository).toBe("RepoC")

    const itemDetail = {
      name: "ws2",
      parameters: [{ name: "X", optional: true, type: "TEXT" } as any],
    }
    const g4 = r(
      g3,
      fmeActions.setWorkspaceItem(itemDetail as any, "RepoC", WID) as any
    )
    expect(sub(g4).workspaceItem).toEqual(itemDetail)
    expect(sub(g4).currentRepository).toBe("RepoC")
  })

  test("loading flags mirror module, submission, and workspace status", () => {
    const r = new StoreExtension().getReducer()
    const g0 = makeGlobal({
      isSubmittingOrder: false,
      isModulesLoading: false,
      isLoadingWorkspaces: false,
      isLoadingParameters: false,
    })

    const g1 = r(
      g0,
      fmeActions.setLoadingFlags({ isModulesLoading: true }, WID) as any
    )
    expect(sub(g1).isModulesLoading).toBe(true)
    expect(sub(g1).isSubmittingOrder).toBe(false)
    expect(sub(g1).isLoadingWorkspaces).toBe(false)
    expect(sub(g1).isLoadingParameters).toBe(false)

    const g2 = r(
      g1,
      fmeActions.setLoadingFlags({ isSubmittingOrder: true }, WID) as any
    )
    expect(sub(g2).isModulesLoading).toBe(true)
    expect(sub(g2).isSubmittingOrder).toBe(true)

    const g3 = r(
      g2,
      fmeActions.setLoadingFlags({ isLoadingWorkspaces: true }, WID) as any
    )
    expect(sub(g3).isLoadingWorkspaces).toBe(true)

    const g4 = r(
      g3,
      fmeActions.setLoadingFlags({ isLoadingParameters: true }, WID) as any
    )
    expect(sub(g4).isLoadingParameters).toBe(true)

    const g5 = r(
      g4,
      fmeActions.setLoadingFlags(
        { isLoadingWorkspaces: false, isLoadingParameters: false },
        WID
      ) as any
    )
    expect(sub(g5).isLoadingWorkspaces).toBe(false)
    expect(sub(g5).isLoadingParameters).toBe(false)
  })

  test("clearWorkspaceState resets related fields and repository", () => {
    const r = new StoreExtension().getReducer()
    const g0 = makeGlobal({
      workspaceItems: [{ name: "a" } as any],
      workspaceParameters: [{ name: "P", optional: true, type: "TEXT" } as any],
      selectedWorkspace: "a",
      workspaceItem: { name: "a" } as any,
      formValues: { x: 1 },
      currentRepository: "RepoX",
      isLoadingWorkspaces: true,
      isLoadingParameters: true,
    })
    const g1 = r(g0, fmeActions.clearWorkspaceState("RepoY", WID) as any)
    expect(sub(g1).workspaceItems).toEqual([])
    expect(sub(g1).workspaceParameters).toEqual([])
    expect(sub(g1).selectedWorkspace).toBeNull()
    expect(sub(g1).workspaceItem).toBeNull()
    expect(sub(g1).formValues).toEqual({})
    expect(sub(g1).currentRepository).toBe("RepoY")
    expect(sub(g1).isLoadingWorkspaces).toBe(false)
    expect(sub(g1).isLoadingParameters).toBe(false)
  })

  test("errors: setError, setImportError, setExportError serialize and store", () => {
    const r = new StoreExtension().getReducer()
    const g0 = makeGlobal()
    const errWithMs: any = {
      message: "m1",
      type: "network",
      code: "C1",
      severity: "error",
      recoverable: false,
      timestampMs: 123,
    }
    const g1 = r(g0, fmeActions.setError(errWithMs, WID) as any)
    expect(sub(g1).error?.timestampMs).toBe(123)
    expect(sub(g1).error?.message).toBe("m1")

    const g2 = r(g1, fmeActions.setImportError(errWithMs, WID) as any)
    expect(sub(g2).importError?.code).toBe("C1")

    const g3 = r(g2, fmeActions.setExportError(errWithMs, WID) as any)
    expect(sub(g3).exportError?.code).toBe("C1")
  })

  test("multi-instance isolation: actions on W1 do not affect W2", () => {
    const r = new StoreExtension().getReducer()
    const g0 = emptyGlobal()
    const g1 = r(g0, fmeActions.setViewMode(ViewMode.DRAWING, WID) as any)
    // W1 changed
    expect(sub(g1, WID).viewMode).toBe(ViewMode.DRAWING)
    // W2 remains undefined (no substate yet)
    expect(sub(g1, WID2)).toBeUndefined()

    const g2 = r(g1, fmeActions.setClickCount(5, WID) as any)
    expect(sub(g2, WID).clickCount).toBe(5)
    expect(sub(g2, WID2)).toBeUndefined()
  })

  test("removeWidgetState removes only the specified widget substate", () => {
    const r = new StoreExtension().getReducer()
    // Seed both W1 and W2
    const g0a = r(
      emptyGlobal(),
      fmeActions.setViewMode(ViewMode.DRAWING, WID) as any
    )
    const g0 = r(g0a, fmeActions.setViewMode(ViewMode.EXPORT_FORM, WID2) as any)
    expect(sub(g0, WID)).toBeTruthy()
    expect(sub(g0, WID2)).toBeTruthy()
    const g1 = r(g0, fmeActions.removeWidgetState(WID) as any)
    expect(sub(g1, WID)).toBeUndefined()
    expect(sub(g1, WID2)).toBeTruthy()
  })
})
