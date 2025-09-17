import React from "react"
import { waitFor, act } from "@testing-library/react"
import {
  wrapWidget,
  initStore,
  mockTheme,
  updateStore,
  widgetRender,
} from "jimu-for-test"
import type { AllWidgetProps } from "jimu-core"
import Widget from "../runtime/widget"
import { DrawingTool, ViewMode } from "../config"

// Mock createFmeFlowClient to avoid network and JSAPI (Security)
jest.mock("../shared/api", () => ({
  createFmeFlowClient: jest.fn().mockReturnValue({
    // Upload returns a TEMP path for mapping
    uploadToTemp: jest.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      data: { path: "$(FME_SHAREDRESOURCE_TEMP)/widget_wtest/file.txt" },
    }),
    // runWorkspace used by widget submission path
    runWorkspace: jest.fn().mockResolvedValue({
      status: 200,
      data: {
        serviceResponse: {
          status: "success",
          jobID: 202,
          url: "https://download.example/test",
        },
      },
    }),
    // Keep legacy method for any direct calls in other tests
    runDataDownload: jest.fn().mockResolvedValue({
      data: {
        serviceResponse: {
          status: "success",
          jobID: 101,
          url: "https://download.example/test",
        },
      },
    }),
  }),
}))

// Mock shared services: allow startup validation to pass without backend (Security)
jest.mock("../shared/services", () => {
  const actual = jest.requireActual("../shared/services")
  return {
    ...actual,
    validateWidgetStartup: jest.fn().mockResolvedValue({
      isValid: true,
      canProceed: true,
      requiresSettings: false,
    }),
  }
})

// Mock JimuMapViewComponent to immediately invoke onActiveViewChange with a fake map view
jest.mock("jimu-arcgis", () => ({
  JimuMapViewComponent: ({ onActiveViewChange }: any) => {
    React.useEffect(() => {
      const fakeMap = {
        layers: [],
        add: jest.fn(function (layer: any) {
          this.layers.push(layer)
        }),
        remove: jest.fn(function (layer: any) {
          this.layers = this.layers.filter((l: any) => l !== layer)
        }),
      }
      const fakeJmv = { view: { map: fakeMap } }
      onActiveViewChange?.(fakeJmv)
    }, [onActiveViewChange])
    return null
  },
}))

// Provide ArcGIS module stub via test hook used in the widget loader
const setupEsriTestStub = (options?: {
  geodesicArea?: number
  planarArea?: number
  isSimple?: boolean
}) => {
  const createSpy = jest.fn()

  class SketchViewModel {
    options: any
    activeTool: string | null = null
    create = createSpy
    cancel = jest.fn()
    destroy = jest.fn()
    private _handlers: { [k: string]: (evt: any) => void } = {}
    constructor(opts: any) {
      this.options = opts
      ;(global as any).__SVM_INST__ = this
    }
    on(event: string, cb: (evt: any) => void) {
      this._handlers[event] = cb
    }
    __emitCreate(evt: any) {
      this._handlers.create?.(evt)
    }
  }

  class GraphicsLayer {
    parent: any = {}
    removeAll = jest.fn()
    private readonly _cfg: any
    constructor(cfg: any) {
      this._cfg = cfg
    }
  }

  const geometryEngine = {
    simplify: jest.fn((poly: any) => poly),
    geodesicArea: jest.fn(() => options?.geodesicArea ?? 1234.56),
    planarArea: jest.fn(() => options?.planarArea ?? 789.12),
    isSimple: jest.fn(() => options?.isSimple ?? true),
  }

  const webMercatorUtils = {}
  const reactiveUtils = {}
  class Polyline {
    __ = 1
  }
  class Polygon {
    spatialReference: any
    toJSON() {
      return { spatialReference: this.spatialReference }
    }
    static fromJSON(json: any) {
      const p = new Polygon()
      p.spatialReference = json?.spatialReference ?? { isGeographic: true }
      return p
    }
  }
  class Graphic {
    __ = 1
  }

  ;(global as any).__ESRI_TEST_STUB__ = (_modules: readonly string[]) => [
    SketchViewModel,
    GraphicsLayer,
    geometryEngine,
    webMercatorUtils,
    reactiveUtils,
    Polyline,
    Polygon,
    Graphic,
  ]

  return { createSpy }
}

const wrap = (props?: Partial<AllWidgetProps<any>>) =>
  wrapWidget(Widget as any, props as any)

beforeAll(() => {
  initStore()
  // Mock SessionManager to provide user email for getEmail
  const { SessionManager } = require("jimu-core")
  jest.spyOn(SessionManager, "getInstance").mockReturnValue({
    getUserInfo: () => Promise.resolve({ email: "user@example.com" }),
  })
  // Polyfill URL.createObjectURL for Blob in JSDOM
  if (!(global as any).URL.createObjectURL) {
    ;(global as any).URL.createObjectURL = jest.fn(() => "blob:mock-url")
  }
})

describe("Widget runtime - module loading and auto-start", () => {
  test("loads modules via test stub and auto-starts drawing for polygon tool", async () => {
    const { createSpy } = setupEsriTestStub()

    const Wrapped = wrap({})
    // Prime Redux with drawing state for widget w1 (byId shape)
    updateStore({
      "fme-state": {
        byId: {
          w1: {
            viewMode: ViewMode.DRAWING,
            clickCount: 0,
            isSubmittingOrder: false,
            drawingTool: DrawingTool.POLYGON,
            drawnArea: 0,
          },
        },
      },
    })
    const cfgAny = {} as any
    const renderWithProviders = widgetRender(true)
    renderWithProviders(
      <Wrapped
        theme={mockTheme}
        id="w1"
        widgetId="w1"
        // Map configured
        useMapWidgetIds={["map_1"] as any}
        config={cfgAny}
      />
    )

    // Wait until SketchViewModel is created
    await waitFor(() => {
      expect((global as any).__SVM_INST__).toBeTruthy()
    })
    // Nudge Redux to ensure update effect runs with DRAWING state
    updateStore({
      "fme-state": {
        byId: {
          w1: {
            viewMode: ViewMode.DRAWING,
            clickCount: 0,
            isSubmittingOrder: false,
            drawingTool: DrawingTool.POLYGON,
            drawnArea: 0,
          },
        },
      },
    })
    // Wait for auto-start create call
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("polygon")
    })
  })

  test("cleanup on unmount cancels and clears resources without errors", () => {
    setupEsriTestStub()
    const Wrapped = wrap({})
    const cfgAny = {} as any
    const renderWithProviders = widgetRender(true)
    const { unmount } = renderWithProviders(
      <Wrapped
        theme={mockTheme}
        id="w2"
        widgetId="w2"
        useMapWidgetIds={["map_2"] as any}
        config={cfgAny}
      />
    )

    // Unmount triggers cleanup useEffectOnce teardown
    act(() => {
      unmount()
    })
  })
})
