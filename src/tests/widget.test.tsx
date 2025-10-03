import { React, hooks, WidgetState } from "jimu-core"
import "@testing-library/jest-dom"
import { act, render, waitFor } from "@testing-library/react"
import { initGlobal } from "jimu-for-test"
import type { JimuMapView } from "jimu-arcgis"
import {
  hexToRgbArray,
  buildSymbols,
  parseSubmissionFormData,
  applyUploadedDatasetParam,
  sanitizeOptGetUrlParam,
  shouldApplyRemoteDatasetUrl,
  shouldUploadRemoteDataset,
  removeAoiErrorMarker,
  resolveRemoteDataset,
  prepareSubmissionParams,
  useEsriModules,
  useMapResources,
  useErrorDispatcher,
  createLayers,
  createSketchVM,
  applyPopupSuppression,
  clearPopupSuppression,
  computeWidgetsToClose,
  popupSuppressionManager,
  type PopupSuppressionRecord,
} from "../runtime/widget"
import {
  DEFAULT_DRAWING_HEX,
  ParameterType,
  FmeActionType,
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  LAYER_CONFIG,
  type FmeExportConfig,
  type WorkspaceParameter,
  type EsriModules,
  type MutableParams,
  type ErrorState,
  type MakeCancelableFn,
} from "../config"
import * as sharedUtils from "../shared/utils"

jest.mock("../shared/utils", () => {
  const actual = jest.requireActual("../shared/utils")
  return {
    ...actual,
    loadArcgisModules: jest.fn(),
  }
})

const loadArcgisModulesMock =
  sharedUtils.loadArcgisModules as jest.MockedFunction<
    typeof sharedUtils.loadArcgisModules
  >

const makeConfig = (
  overrides: Partial<FmeExportConfig> = {}
): FmeExportConfig => ({
  fmeServerUrl: "https://server.example.com",
  fmeServerToken: "token-1234567890",
  repository: "demo-repo",
  ...overrides,
})

const makeCancelable: MakeCancelableFn = (promise) => promise

const makeFile = () =>
  new File(["data"], "dataset.zip", {
    type: "application/zip",
  })

beforeAll(() => {
  initGlobal()
})

afterEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
  popupSuppressionManager.releaseAll()
})

describe("color helpers", () => {
  it("converts hex colors to rgb arrays and falls back to default", () => {
    expect(hexToRgbArray("#ffcc00")).toEqual([255, 204, 0])

    const fallback = hexToRgbArray("not-a-hex")
    const expected = hexToRgbArray(DEFAULT_DRAWING_HEX)
    expect(fallback).toEqual(expected)
  })

  it("builds highlight and drawing symbols from rgb values", () => {
    const { HIGHLIGHT_SYMBOL, DRAWING_SYMBOLS } = buildSymbols([10, 20, 30])

    expect(HIGHLIGHT_SYMBOL.color).toEqual([10, 20, 30, 0.2])
    expect(DRAWING_SYMBOLS.polygon).toBe(HIGHLIGHT_SYMBOL)
    expect(DRAWING_SYMBOLS.polyline.color).toEqual([10, 20, 30])
    expect(DRAWING_SYMBOLS.point.outline).toEqual({
      color: [255, 255, 255],
      width: 1,
    })
  })
})

describe("submission form preparation", () => {
  it("normalizes raw submission data and extracts file inputs", () => {
    const file = makeFile()
    const result = parseSubmissionFormData({
      name: "Test",
      opt_geturl: " https://example.com/source ",
      __remote_dataset_url__: " https://example.com/data.zip ",
      __upload_file__: file,
      custom: { mode: "text", text: "  value  " },
    })

    expect(result.uploadFile).toBe(file)
    expect(result.remoteUrl).toBe("https://example.com/data.zip")
    expect(result.sanitizedFormData.opt_geturl).toBe(
      "https://example.com/source"
    )
    expect(result.sanitizedFormData.custom).toBe("  value  ")
    expect(result.sanitizedFormData).not.toHaveProperty(
      "__remote_dataset_url__"
    )
    expect(result.sanitizedFormData).not.toHaveProperty("__upload_file__")
  })

  it("applies uploaded dataset path to explicit targets, parameter matches, or SourceDataset", () => {
    const uploadedPath = "/tmp/data/file.gdb"

    const explicitParams: { [key: string]: unknown } = {}
    applyUploadedDatasetParam({
      finalParams: explicitParams,
      uploadedPath,
      parameters: null,
      explicitTarget: "RemoteDataset",
    })
    expect(explicitParams.RemoteDataset).toBe(uploadedPath)

    const matchingParams: { [key: string]: unknown } = {}
    const parameters: WorkspaceParameter[] = [
      { name: "UploadParam", type: ParameterType.FILENAME, optional: true },
    ]
    applyUploadedDatasetParam({
      finalParams: matchingParams,
      uploadedPath,
      parameters,
      explicitTarget: null,
    })
    expect(matchingParams.UploadParam).toBe(uploadedPath)

    const fallbackParams: { [key: string]: unknown } = {}
    applyUploadedDatasetParam({
      finalParams: fallbackParams,
      uploadedPath,
      parameters: [],
      explicitTarget: null,
    })
    expect(fallbackParams.SourceDataset).toBe(uploadedPath)

    const existingParams: { [key: string]: unknown } = {
      SourceDataset: "keep-me",
    }
    applyUploadedDatasetParam({
      finalParams: existingParams,
      uploadedPath,
      parameters: [],
      explicitTarget: null,
    })
    expect(existingParams.SourceDataset).toBe("keep-me")
  })

  it("sanitizes opt_geturl based on config permissions", () => {
    const validConfig = makeConfig({ allowRemoteUrlDataset: true })
    const invalidConfig = makeConfig({ allowRemoteUrlDataset: false })

    const params: MutableParams = {
      opt_geturl: " https://datasets.example.com/resource ",
    }
    sanitizeOptGetUrlParam(params, validConfig)
    expect(params.opt_geturl).toBe("https://datasets.example.com/resource")

    const disallowed: MutableParams = {
      opt_geturl: " https://datasets.example.com/resource ",
    }
    sanitizeOptGetUrlParam(disallowed, invalidConfig)
    expect(disallowed).not.toHaveProperty("opt_geturl")

    const nonString: MutableParams = { opt_geturl: 42 }
    sanitizeOptGetUrlParam(nonString, validConfig)
    expect(nonString).not.toHaveProperty("opt_geturl")
  })

  it("evaluates remote dataset helpers", () => {
    const remoteConfig = makeConfig({
      allowRemoteUrlDataset: true,
      allowRemoteDataset: true,
    })
    const localConfig = makeConfig({
      allowRemoteUrlDataset: false,
      allowRemoteDataset: false,
    })
    const file = makeFile()

    expect(
      shouldApplyRemoteDatasetUrl(
        "https://datasets.example.com/file.zip",
        remoteConfig
      )
    ).toBe(true)
    expect(
      shouldApplyRemoteDatasetUrl(
        "http://insecure.example.com/file.zip",
        remoteConfig
      )
    ).toBe(false)
    expect(
      shouldApplyRemoteDatasetUrl(
        "https://datasets.example.com/file.zip",
        localConfig
      )
    ).toBe(false)

    expect(shouldUploadRemoteDataset(remoteConfig, file)).toBe(true)
    expect(shouldUploadRemoteDataset(remoteConfig, null)).toBe(false)
    expect(shouldUploadRemoteDataset(localConfig, file)).toBe(false)
  })

  it("removes AOI error markers after processing", () => {
    const params: MutableParams = {
      __aoi_error__: { code: "ERR" } as any,
    }
    removeAoiErrorMarker(params)
    expect(params).not.toHaveProperty("__aoi_error__")
  })
})

describe("remote dataset resolution", () => {
  it("prefers remote dataset URLs when allowed", async () => {
    const params: MutableParams = {
      opt_geturl: " https://old.example.com/data ",
    }
    const fmeClient = { uploadToTemp: jest.fn() }

    await resolveRemoteDataset({
      params,
      remoteUrl: "https://datasets.example.com/data.zip",
      uploadFile: null,
      config: makeConfig({ allowRemoteUrlDataset: true }),
      workspaceParameters: [],
      makeCancelable,
      fmeClient: fmeClient as any,
      signal: new AbortController().signal,
      subfolder: "remote",
    })

    expect(params.opt_geturl).toBe("https://datasets.example.com/data.zip")
    expect(fmeClient.uploadToTemp).not.toHaveBeenCalled()
  })

  it("uploads local datasets when remote URLs are unavailable", async () => {
    const file = makeFile()
    const params: MutableParams = {
      opt_geturl: " https://invalid.example.com ",
    }
    const uploadResponse = {
      data: { path: "/temp/uploaded/path" },
      status: 200,
      statusText: "OK",
    }
    const fmeClient = {
      uploadToTemp: jest.fn().mockResolvedValue(uploadResponse),
    }

    const signal = new AbortController().signal

    await resolveRemoteDataset({
      params,
      remoteUrl: "",
      uploadFile: file,
      config: makeConfig({
        allowRemoteDataset: true,
        allowRemoteUrlDataset: false,
        uploadTargetParamName: "UploadParam",
      }),
      workspaceParameters: [],
      makeCancelable,
      fmeClient: fmeClient as any,
      signal,
      subfolder: "temp",
    })

    expect(fmeClient.uploadToTemp).toHaveBeenCalledWith(file, {
      subfolder: "temp",
      signal,
    })
    expect(params).not.toHaveProperty("opt_geturl")
    expect(params.UploadParam).toBe("/temp/uploaded/path")
  })
})

describe("prepareSubmissionParams", () => {
  it("returns AOI errors from prepFmeParams immediately", async () => {
    const aoiError: ErrorState = {
      message: "AOI invalid",
      type: ErrorType.GEOMETRY,
      code: "GEOMETRY_SERIALIZATION_FAILED",
      severity: ErrorSeverity.ERROR,
      recoverable: false,
      timestamp: new Date(),
      timestampMs: Date.now(),
      kind: "runtime",
    }

    jest
      .spyOn(sharedUtils, "prepFmeParams")
      .mockReturnValue({ __aoi_error__: aoiError })
    const applySpy = jest.spyOn(sharedUtils, "applyDirectiveDefaults")

    const result = await prepareSubmissionParams({
      rawFormData: {},
      userEmail: "user@example.com",
      geometryJson: null,
      geometry: null,
      modules: null,
      config: makeConfig(),
      workspaceParameters: [],
      makeCancelable,
      fmeClient: { uploadToTemp: jest.fn() } as any,
      signal: new AbortController().signal,
      remoteDatasetSubfolder: "datasets",
    })

    expect(result.params).toBeNull()
    expect(result.aoiError).toBe(aoiError)
    expect(applySpy).not.toHaveBeenCalled()
  })

  it("prepares params, resolves remote URLs, and strips AOI markers", async () => {
    const baseParams: MutableParams = {
      foo: "bar",
      __aoi_error__: null,
    }
    jest.spyOn(sharedUtils, "prepFmeParams").mockReturnValue(baseParams)
    const applySpy = jest
      .spyOn(sharedUtils, "applyDirectiveDefaults")
      .mockImplementation((params: MutableParams) => ({
        ...params,
        applied: true,
        __aoi_error__: "should-remove",
      }))

    const result = await prepareSubmissionParams({
      rawFormData: {
        field: "value",
        __remote_dataset_url__: "https://datasets.example.com/data.zip",
      },
      userEmail: "user@example.com",
      geometryJson: null,
      geometry: null,
      modules: null,
      config: makeConfig({ allowRemoteUrlDataset: true }),
      workspaceParameters: [],
      makeCancelable,
      fmeClient: { uploadToTemp: jest.fn() } as any,
      signal: new AbortController().signal,
      remoteDatasetSubfolder: "datasets",
    })

    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(result.aoiError).toBeUndefined()
    expect(result.params).toEqual({
      foo: "bar",
      applied: true,
      opt_geturl: "https://datasets.example.com/data.zip",
    })
  })
})

describe("useEsriModules", () => {
  const buildModules = () => {
    class MockSketchViewModel {
      constructor(...args: any[]) {
        this.args = args
      }
      readonly args: any[]
    }
    class MockGraphicsLayer {
      constructor(...args: any[]) {
        this.args = args
      }
      readonly args: any[]
    }
    const geometryEngine = {}
    const geometryEngineAsync = {}
    const webMercatorUtils = {}
    const projection = { load: jest.fn().mockResolvedValue(undefined) }
    class MockSpatialReference {
      constructor(...args: any[]) {
        this.args = args
      }
      readonly args: any[]
    }
    class MockPolyline {
      constructor(...args: any[]) {
        this.args = args
      }
      readonly args: any[]
    }
    class MockPolygon {
      constructor(...args: any[]) {
        this.args = args
      }
      readonly args: any[]
    }
    class MockGraphic {
      constructor(...args: any[]) {
        this.args = args
      }
      readonly args: any[]
    }

    return [
      MockSketchViewModel,
      MockGraphicsLayer,
      geometryEngine,
      geometryEngineAsync,
      webMercatorUtils,
      projection,
      MockSpatialReference,
      MockPolyline,
      MockPolygon,
      MockGraphic,
    ] as unknown[]
  }

  it("loads ArcGIS modules and exposes them via state", async () => {
    loadArcgisModulesMock.mockResolvedValueOnce(buildModules())

    const states: Array<{ modules: EsriModules | null; loading: boolean }> = []

    const Harness: React.FC<{ reload: number }> = ({ reload }) => {
      const state = useEsriModules(reload)
      hooks.useEffectWithPreviousValues(() => {
        states.push(state)
      }, [state])
      return null
    }

    const { rerender } = render(<Harness reload={0} />)

    await waitFor(() => {
      const latest = states.at(-1)
      expect(latest?.loading).toBe(false)
      expect(latest?.modules?.SketchViewModel).toBeDefined()
    })

    loadArcgisModulesMock.mockResolvedValueOnce(buildModules())

    rerender(<Harness reload={1} />)

    await waitFor(() => {
      const latest = states.at(-1)
      expect(latest?.loading).toBe(false)
      expect(loadArcgisModulesMock).toHaveBeenCalledTimes(2)
    })
  })
})

describe("useMapResources", () => {
  it("tracks lifecycle of SketchViewModel and GraphicsLayer instances", async () => {
    let latest: ReturnType<typeof useMapResources> | null = null

    const Harness: React.FC = () => {
      const resources = useMapResources()
      hooks.useEffectWithPreviousValues(() => {
        latest = resources
      }, [resources])
      return null
    }

    render(<Harness />)

    await waitFor(() => {
      expect(latest).toBeTruthy()
    })

    const mapRemove = jest.fn()
    const mapAdd = jest.fn()
    const view = {
      view: { map: { add: mapAdd, remove: mapRemove } },
    } as unknown as JimuMapView
    const sketch = {
      cancel: jest.fn(),
      destroy: jest.fn(),
    } as unknown as __esri.SketchViewModel
    const graphicsLayer = {
      removeAll: jest.fn(),
      parent: {},
    } as unknown as __esri.GraphicsLayer

    act(() => {
      latest?.setJimuMapView(view)
      latest?.setSketchViewModel(sketch)
      latest?.setGraphicsLayer(graphicsLayer)
    })

    await waitFor(() => {
      expect(latest?.jimuMapView).toBe(view)
      expect(latest?.sketchViewModel).toBe(sketch)
      expect(latest?.graphicsLayer).toBe(graphicsLayer)
    })

    act(() => {
      latest?.teardownDrawingResources()
    })

    expect(sketch.cancel).toHaveBeenCalledTimes(1)
    expect(sketch.destroy).toHaveBeenCalledTimes(1)
    expect(graphicsLayer.removeAll).toHaveBeenCalledTimes(1)
    expect(mapRemove).toHaveBeenCalledWith(graphicsLayer)
    expect(latest?.jimuMapView).toBe(view)
    expect(latest?.graphicsLayer).toBeNull()

    const graphicsLayer2 = {
      removeAll: jest.fn(),
      parent: {},
    } as unknown as __esri.GraphicsLayer
    const sketch2 = {
      cancel: jest.fn(),
      destroy: jest.fn(),
    } as unknown as __esri.SketchViewModel

    act(() => {
      latest?.setSketchViewModel(sketch2)
      latest?.setGraphicsLayer(graphicsLayer2)
    })

    act(() => {
      latest?.cleanupResources()
    })

    expect(sketch2.cancel).toHaveBeenCalledTimes(1)
    expect(graphicsLayer2.removeAll).toHaveBeenCalledTimes(1)
    expect(mapRemove).toHaveBeenCalledWith(graphicsLayer2)
    expect(latest?.jimuMapView).toBeNull()
  })
})

describe("useErrorDispatcher", () => {
  it("dispatches serialized runtime errors", () => {
    const dispatch = jest.fn()
    let emitError: ReturnType<typeof useErrorDispatcher> | null = null

    const Harness: React.FC = () => {
      const handler = useErrorDispatcher(dispatch, "widget-1")
      hooks.useEffectWithPreviousValues(() => {
        emitError = handler
      }, [handler])
      return null
    }

    render(<Harness />)

    expect(emitError).toBeTruthy()
    act(() => {
      emitError?.("Something went wrong", ErrorType.CONFIG, "CONFIG_ERROR")
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    const action = dispatch.mock.calls[0][0]
    expect(action.type).toBe(FmeActionType.SET_ERROR)
    expect(action.widgetId).toBe("widget-1")
    expect(action.error.message).toBe("Something went wrong")
    expect(action.error.severity).toBe(ErrorSeverity.ERROR)
    expect(action.error.kind).toBe("serializable")
  })
})

describe("createLayers and createSketchVM", () => {
  it("initializes graphics layer and registers it with the map view", () => {
    const addedLayers: any[] = []
    const mapView = {
      view: {
        map: {
          add: (layer: any) => {
            addedLayers.push(layer)
          },
        },
      },
    } as unknown as JimuMapView

    class MockGraphicsLayer {
      constructor(public readonly config: unknown) {}
    }

    const modules = {
      GraphicsLayer: MockGraphicsLayer,
    } as unknown as EsriModules

    const setGraphicsLayer = jest.fn()

    const layer = createLayers(mapView, modules, setGraphicsLayer)

    expect(layer).toBeInstanceOf(MockGraphicsLayer)
    expect(addedLayers[0]).toBe(layer)
    expect(setGraphicsLayer).toHaveBeenCalledWith(layer)
    expect((layer as any).config).toEqual(LAYER_CONFIG)
  })

  it("configures SketchViewModel and reacts to drawing events", () => {
    interface ListenerMap {
      [key: string]: Array<(evt: any) => void>
    }

    class MockSketchViewModel {
      listeners: ListenerMap = {}
      constructor(public readonly options: any) {}
      on(eventName: string, handler: (evt: any) => void) {
        this.listeners[eventName] = this.listeners[eventName] || []
        this.listeners[eventName].push(handler)
      }
      emit(eventName: string, evt: any) {
        for (const handler of this.listeners[eventName] || []) {
          handler(evt)
        }
      }
    }

    const modules = {
      SketchViewModel: MockSketchViewModel,
    } as unknown as EsriModules

    const layer = {} as __esri.GraphicsLayer
    const dispatch = jest.fn()
    const onDrawComplete = jest.fn()
    const onDrawingSessionChange = jest.fn()

    const view = { view: {} } as JimuMapView
    const symbols = buildSymbols([0, 120, 200]).DRAWING_SYMBOLS

    const vm = createSketchVM({
      jmv: view,
      modules,
      layer,
      onDrawComplete,
      dispatch,
      widgetId: "widget-123",
      symbols,
      onDrawingSessionChange,
    }) as unknown as MockSketchViewModel

    expect(vm.options.layer).toBe(layer)
    expect(vm.options.polygonSymbol).toBe(symbols.polygon)

    vm.emit("create", { state: "start", tool: "polygon" })
    expect(onDrawingSessionChange).toHaveBeenCalledWith({
      isActive: true,
      clickCount: 0,
    })
    expect(dispatch.mock.calls[0][0]).toEqual({
      type: FmeActionType.SET_DRAWING_TOOL,
      drawingTool: DrawingTool.POLYGON,
      widgetId: "widget-123",
    })

    vm.emit("create", {
      state: "active",
      tool: "polygon",
      graphic: {
        geometry: {
          rings: [
            [
              [0, 0],
              [1, 1],
            ],
          ],
        },
      },
    })
    expect(onDrawingSessionChange).toHaveBeenCalledWith({
      clickCount: 1,
      isActive: true,
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: FmeActionType.SET_VIEW_MODE,
      viewMode: ViewMode.DRAWING,
      widgetId: "widget-123",
    })

    const completeEvent = {
      state: "complete",
      tool: "polygon",
      graphic: { geometry: {} },
    }
    vm.emit("create", completeEvent)
    expect(onDrawingSessionChange).toHaveBeenCalledWith({
      isActive: false,
      clickCount: 0,
    })
    expect(onDrawComplete).toHaveBeenCalledWith(completeEvent)

    vm.emit("update", {
      state: "complete",
      graphics: [
        {
          geometry: {
            rings: [
              [
                [0, 0],
                [1, 1],
                [2, 2],
              ],
            ],
          },
        },
      ],
      tool: "polygon",
    })
    expect(onDrawComplete).toHaveBeenCalledTimes(2)
  })
})

describe("popup suppression helpers", () => {
  it("disables popup auto-open and registers a watcher", () => {
    const ref: { current: PopupSuppressionRecord | null } = { current: null }
    const remove = jest.fn()
    let visibleHandler: ((value: boolean) => void) | null = null
    const popup: any = {
      autoOpenEnabled: true,
      close: jest.fn(),
      watch: jest.fn((prop: string, handler: (value: boolean) => void) => {
        if (prop === "visible") {
          visibleHandler = handler
        }
        return { remove }
      }),
    }

    applyPopupSuppression(ref, popup)

    expect(popup.close).toHaveBeenCalledTimes(1)
    expect(popup.autoOpenEnabled).toBe(false)
    expect(ref.current?.popup).toBe(popup)
    expect(ref.current?.prevAutoOpen).toBe(true)
    expect(typeof visibleHandler).toBe("function")

    visibleHandler?.(true)
    expect(popup.close).toHaveBeenCalledTimes(2)

    clearPopupSuppression(ref)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(popup.autoOpenEnabled).toBe(true)
    expect(ref.current).toBeNull()
  })

  it("ignores missing popup references", () => {
    const ref: { current: PopupSuppressionRecord | null } = { current: null }
    applyPopupSuppression(ref, null)
    expect(ref.current).toBeNull()
    clearPopupSuppression(ref)
    expect(ref.current).toBeNull()
  })
})

describe("popupSuppressionManager", () => {
  it("keeps popups suppressed until all owners release", () => {
    const remove = jest.fn()
    const popup: any = {
      autoOpenEnabled: true,
      close: jest.fn(),
      watch: jest.fn(() => ({ remove })),
    }

    const ownerA = Symbol("ownerA")
    const ownerB = Symbol("ownerB")

    popupSuppressionManager.acquire(ownerA, popup)
    popupSuppressionManager.acquire(ownerB, popup)

    expect(popup.close).toHaveBeenCalledTimes(1)
    expect(popup.autoOpenEnabled).toBe(false)

    popupSuppressionManager.release(ownerA)
    expect(remove).not.toHaveBeenCalled()
    expect(popup.autoOpenEnabled).toBe(false)

    popupSuppressionManager.release(ownerB)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(popup.autoOpenEnabled).toBe(true)
  })

  it("tears down prior popup when a new popup is acquired", () => {
    const removeA = jest.fn()
    const popupA: any = {
      autoOpenEnabled: true,
      close: jest.fn(),
      watch: jest.fn(() => ({ remove: removeA })),
    }
    const ownerA = Symbol("ownerA")
    popupSuppressionManager.acquire(ownerA, popupA)

    expect(popupA.close).toHaveBeenCalledTimes(1)
    expect(popupA.autoOpenEnabled).toBe(false)

    const removeB = jest.fn()
    const popupB: any = {
      autoOpenEnabled: true,
      close: jest.fn(),
      watch: jest.fn(() => ({ remove: removeB })),
    }
    const ownerB = Symbol("ownerB")
    popupSuppressionManager.acquire(ownerB, popupB)

    expect(removeA).toHaveBeenCalledTimes(1)
    expect(popupB.close).toHaveBeenCalledTimes(1)
    expect(popupB.autoOpenEnabled).toBe(false)
  })
})

describe("computeWidgetsToClose", () => {
  it("selects other widgets that are open or active", () => {
    const runtimeInfo = {
      fme: { state: WidgetState.Opened },
      searchWidget: { state: "ACTIVE" },
      legendWidget: { state: WidgetState.Hidden },
      detailsWidget: { state: WidgetState.Closed },
      drawWidget: { state: WidgetState.Opened },
    }

    const targets = computeWidgetsToClose(runtimeInfo, "fme")
    expect(targets).toEqual(["searchWidget", "drawWidget"])

    const none = computeWidgetsToClose(null, "fme")
    expect(none).toEqual([])
  })
})
