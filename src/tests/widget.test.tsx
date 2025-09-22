import React from "react"
import { waitFor, act, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
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
import runtimeMsgs2 from "../runtime/translations/default"

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
      const fakeJmv = {
        view: {
          map: fakeMap,
          popup: { close: jest.fn() },
        },
      } as any
      // Align with runtime which calls view.closePopup()
      fakeJmv.view.closePopup = jest.fn(() => fakeJmv.view.popup.close())
      ;(global as any).__LAST_JMV__ = fakeJmv
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

  test("closes open map popup when widget opens (issue #19)", async () => {
    setupEsriTestStub()

    const Wrapped = wrap({})
    updateStore({
      "fme-state": {
        byId: {
          w3: {
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
        id="w3"
        widgetId="w3"
        useMapWidgetIds={["map_3"] as any}
        config={cfgAny}
      />
    )

    // Wait until SketchViewModel exists (map initialized)
    await waitFor(() => {
      expect((global as any).__SVM_INST__).toBeTruthy()
    })

    // Access fake popup via the JimuMapView mock location
    // Pull the fake jmv from the onActiveViewChange call by reading the stored object on global
    const fakeJmv = (global as any).__LAST_JMV__
    const popup = fakeJmv?.view?.popup
    expect(popup && typeof popup.close === "function").toBe(true)
    // The widget effect should have closed it once on open
    // We need to yield to effects
    await waitFor(() => {
      expect(popup.close).toHaveBeenCalled()
    })
  })
})

describe("Widget runtime - startup CONFIG_INCOMPLETE error handling", () => {
  test("renders simple error without code or support link", async () => {
    setupEsriTestStub()

    // Render first to let the widget mount and start its validation flow

    const Wrapped = wrap({})
    const renderWithProviders = widgetRender(true)
    renderWithProviders(
      <Wrapped
        theme={mockTheme}
        id="wCI"
        widgetId="wCI"
        // Map configured so validation proceeds to service layer
        useMapWidgetIds={["map_CI"] as any}
        // Provide supportEmail to ensure it is NOT rendered for CONFIG_INCOMPLETE
        config={{ supportEmail: "help@example.com" } as any}
      />
    )

    // Ensure modules and map view are initialized
    await waitFor(() => {
      expect((global as any).__SVM_INST__).toBeTruthy()
    })

    // Inject startup validation error after mount to avoid racing the initial validation effect
    updateStore({
      "fme-state": {
        byId: {
          wCI: {
            viewMode: ViewMode.STARTUP_VALIDATION,
            clickCount: 0,
            isSubmittingOrder: false,
            drawingTool: DrawingTool.POLYGON,
            drawnArea: 0,
            isStartupValidating: false,
            startupValidationError: {
              message: "startupConfigError",
              type: "config",
              code: "CONFIG_INCOMPLETE",
              severity: "error",
              recoverable: true,
              timestamp: new Date(),
              timestampMs: Date.now(),
            },
          },
        },
      },
    })

    // Error alert should be displayed
    const alert = await screen.findByRole("alert")
    expect(alert).toBeInTheDocument()
    // Title/message present (translated)
    expect(screen.getByText(runtimeMsgs2.startupConfigError)).toBeTruthy()
    // Retry action available
    expect(
      screen.getByRole("button", { name: runtimeMsgs2.retry })
    ).toBeTruthy()
    const links = screen.queryAllByRole("link")
    expect(
      links.some((a) => (a as HTMLAnchorElement).href.startsWith("mailto:"))
    ).toBe(false)

    // Error code must NOT be displayed for CONFIG_INCOMPLETE
    expect(screen.queryByText(/CONFIG_INCOMPLETE/i)).toBeNull()
  })
})

describe("Widget runtime - geometry error prevents drawing until retry", () => {
  test("does not auto-start drawing when GEOMETRY_INVALID error active; resumes after retry", async () => {
    const { createSpy } = setupEsriTestStub()

    const Wrapped = wrap({})
    // Start in INITIAL without error so map and SVM can initialize
    updateStore({
      "fme-state": {
        byId: {
          wG: {
            viewMode: ViewMode.INITIAL,
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
        id="wG"
        widgetId="wG"
        useMapWidgetIds={["map_G"] as any}
        config={cfgAny}
      />
    )

    // Wait until SketchViewModel is created
    await waitFor(() => {
      expect((global as any).__SVM_INST__).toBeTruthy()
    })

    // Inject geometry error and set view to INITIAL (as real flow does on invalid geometry)
    updateStore({
      "fme-state": {
        byId: {
          wG: {
            viewMode: ViewMode.INITIAL,
            clickCount: 0,
            isSubmittingOrder: false,
            drawingTool: DrawingTool.POLYGON,
            drawnArea: 0,
            error: {
              message: runtimeMsgs2.GEOMETRY_INVALID,
              type: "validation",
              code: "GEOMETRY_INVALID",
              severity: "error",
              recoverable: true,
              timestamp: new Date(),
              timestampMs: Date.now(),
            },
          },
        },
      },
    })

    // Ensure no auto-start draw occurs while error is active
    expect(createSpy).not.toHaveBeenCalled()
    // Error view should be rendered with retry button visible
    const alert = await screen.findByRole("alert")
    expect(alert).toBeInTheDocument()

    // Click Retry button in error view
    const retryBtn = await screen.findByRole("button", {
      name: runtimeMsgs2.retry,
    })
    expect(retryBtn).toBeInTheDocument()
    act(() => {
      retryBtn.click()
    })

    // After retry, drawing should auto-start (create should be invoked)
    await waitFor(
      () => {
        expect(createSpy).toHaveBeenCalled()
      },
      { timeout: 3000 }
    )
  })
})
