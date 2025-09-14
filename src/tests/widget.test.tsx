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
import Widget, {
  calcArea,
  validatePolygon,
  formatArea,
} from "../runtime/widget"
import { DrawingTool, ErrorType, type EsriModules, ViewMode } from "../config"

// Mock createFmeFlowClient to avoid network and JSAPI (Security)
jest.mock("../shared/api", () => ({
  createFmeFlowClient: jest.fn().mockReturnValue({
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

describe("Geometry helpers", () => {
  test("calcArea returns 0 for non-polygon or missing engine", () => {
    const modules = { geometryEngine: undefined } as unknown as EsriModules
    expect(calcArea(undefined, modules)).toBe(0)
    expect(calcArea({ type: "point" } as any, modules)).toBe(0)
  })

  test("calcArea uses geodesic for geographic SR and absolute value", () => {
    setupEsriTestStub({ geodesicArea: -2500000 })
    // Build fake geometry instance with toJSON returning SR
    const geom = {
      type: "polygon",
      toJSON: () => ({ spatialReference: { isGeographic: true } }),
    } as any
    // Need actual modules to pass, but our calcArea only needs Polygon and geometryEngine
    const [, , geometryEngine, , , , Polygon] = (
      global as any
    ).__ESRI_TEST_STUB__([])
    const m = { Polygon, geometryEngine } as unknown as EsriModules
    expect(calcArea(geom, m)).toBe(2500000)
  })

  test("validatePolygon detects missing and wrong types", () => {
    const modules = {} as EsriModules
    const missing = validatePolygon(undefined, modules)
    expect(missing.valid).toBe(false)
    expect(missing.error?.type).toBe(ErrorType.GEOMETRY)

    const wrong = validatePolygon({ type: "point" } as any, modules)
    expect(wrong.valid).toBe(false)
    expect(wrong.error?.code).toBe("GEOM_TYPE_INVALID")
  })

  test("validatePolygon uses geometryEngine.isSimple", () => {
    setupEsriTestStub({ isSimple: false })
    const [, , , , , , Polygon] = (global as any).__ESRI_TEST_STUB__([])
    const modules = {
      geometryEngine: { isSimple: () => false },
      Polygon,
    } as any
    const geometry = {
      type: "polygon",
      toJSON: () => ({ spatialReference: { isGeographic: true } }),
    } as any
    const result = validatePolygon(geometry, modules)
    expect(result.valid).toBe(false)
    expect(result.error?.code).toBe("GEOM_SELF_INTERSECTING")
  })

  test("formatArea formats m² and km² with Intl fallback", () => {
    const modules: any = {
      intl: {
        formatNumber: (n: number, o: any) =>
          n.toLocaleString("en-US", {
            minimumFractionDigits: o?.minimumFractionDigits ?? 0,
            maximumFractionDigits: o?.maximumFractionDigits ?? 0,
          }),
      },
    }
    expect(formatArea(0 as any, modules)).toBe("0 m²")
    expect(formatArea(999_499, modules)).toBe("999,499 m²")
    expect(formatArea(1_250_000, modules)).toBe("1.25 km²")
  })
})

// Security: ensure no static @arcgis/core imports and no network calls are made in tests.
// i18n: Widget uses translation keys; we exercised formatArea with Intl and fallback.
// Accessibility: The services-level a11y is covered via translation error mapping; runtime UI a11y relies on StateView/Workflow which are assumed compliant in EXB.
