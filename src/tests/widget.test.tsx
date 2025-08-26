import "@testing-library/jest-dom"
import { React, getAppStore, Immutable } from "jimu-core"
import {
  initExtensions,
  initStore,
  setTheme,
  mockTheme,
  widgetRender,
  wrapWidget,
  updateStore,
  waitForMilliseconds,
  withStoreRender,
} from "jimu-for-test"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import Widget, {
  formatArea,
  calcArea,
  validatePolygon,
} from "../runtime/widget"
import { initialFmeState } from "../extensions/store"
import { ViewMode, type FmeWidgetState } from "../shared/types"

// Mock jimu-arcgis to avoid real JSAPI loading and map rendering
jest.mock("jimu-arcgis", () => ({
  __esModule: true,
  // Minimal stub; widget only renders this when a single map widget is configured
  JimuMapViewComponent: () => null,
  // Resolve modules immediately with minimal shims
  loadArcGISJSAPIModules: jest.fn((modules: string[]) => {
    // Handle Portal module loading for email validation
    if (modules.includes("esri/portal/Portal")) {
      const MockPortal = function (this: any) {
        this.load = () => Promise.resolve()
        // Allow tests to control presence of user email via global flag
        const email = (global as any).__TEST_PORTAL_EMAIL__
        this.user = email ? { email } : null
      }
      return Promise.resolve([MockPortal])
    }

    // Default sketch/graphics modules
    return Promise.resolve([
      function SketchViewModel() {
        // no-op stub
        return null as any
      },
      function GraphicsLayer(this: any) {
        // no-op stub with method used by widget
        this.removeAll = () => {
          return undefined
        }
        return null as any
      },
      function Graphic() {
        // no-op stub
        return null as any
      },
      function Polygon() {
        // no-op stub
        return null as any
      },
      function Extent() {
        // no-op stub
        return null as any
      },
      function AreaMeasurement2D() {
        // no-op stub
        return null as any
      },
      function DistanceMeasurement2D() {
        // no-op stub
        return null as any
      },
      { planarArea: jest.fn(), geodesicArea: jest.fn() },
    ])
  }),
}))

// Mock FME client so startup connection/auth checks pass without real network
jest.mock("../shared/api", () => {
  const ok = { status: 200, statusText: "OK", data: {} }
  return {
    __esModule: true,
    createFmeFlowClient: jest.fn(() => ({
      testConnection: jest.fn(() => Promise.resolve(ok)),
      validateRepository: jest.fn(() =>
        Promise.resolve({
          status: 200,
          statusText: "OK",
          data: { name: "repo" },
        })
      ),
      // Default runDataDownload mock resolves with success and echoes a jobID
      runDataDownload: jest.fn(() =>
        Promise.resolve({
          status: 200,
          statusText: "OK",
          data: {
            serviceResponse: {
              status: "success",
              jobID: 101,
              url: "http://example.com/file.zip",
            },
          },
        })
      ),
    })),
  }
})

describe("FME Export Widget", () => {
  const renderWidget = widgetRender(false)

  // Helper to create minimal EsriModules object with geometryEngine stub
  const makeModules = (geometryEngine: any) =>
    ({
      SketchViewModel: jest.fn() as any,
      GraphicsLayer: jest.fn() as any,
      Graphic: jest.fn() as any,
      Polygon: jest.fn() as any,
      Extent: jest.fn() as any,
      geometryEngine,
    }) as any

  beforeAll(() => {
    initExtensions()
    initStore()
    setTheme(mockTheme)
  })

  test("widget state management for loading and error handling", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Startup validation state shows loading message
    const { unmount: unmount1 } = renderWidget(<Wrapped widgetId="w1" />)
    screen.getByText(/Validerar konfiguration|Laddar karttjänster/i)
    unmount1()

    // Set up initial state with a non-startup error
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.INITIAL,
      isStartupValidating: false,
      // Non-startup error (not startupValidationError)
      error: {
        message: "geometryMissing",
        severity: "error" as any,
        type: "ValidationError" as any,
        timestampMs: 0,
      },
    }
    updateStore({ "fme-state": errorState })
    // Wait a tick to allow the store update to propagate before re‑rendering
    await waitForMilliseconds(0)
    // Rerender widget with error state
    renderWidget(
      <Wrapped
        widgetId="w2"
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
          supportEmail: "support@example.com",
        }}
      />
    )

    await waitFor(() => {
      expect(
        screen.queryByText(/Validerar konfiguration|Laddar karttjänster/i)
      ).toBeNull()
    })

    // Expect error actions group with a support mailto link
    const actionsGroup = await screen.findByRole("group", {
      name: /Felåtgärder/i,
    })
    expect(actionsGroup).toBeInTheDocument()
    const links = await screen.findAllByRole("link")
    const supportLink = links.find((el) =>
      /support@example\.com/i.test(el.textContent || "")
    ) as HTMLAnchorElement | undefined
    expect(supportLink).toBeTruthy()
    const href = supportLink && supportLink.getAttribute("href")
    expect(href).toBe("mailto:support@example.com")
  })

  test("startup validation fails when user email is missing and shows support link", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Set up initial state with a startup validation error for missing email
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.STARTUP_VALIDATION,
      isStartupValidating: false,
      startupValidationError: {
        message: "userEmailMissing",
        type: "ConfigError" as any,
        severity: "error" as any,
        timestampMs: 0,
        code: "UserEmailMissing",
        userFriendlyMessage: "help@domain.se", // Email passed as userFriendlyMessage for contact
      },
    }
    updateStore({ "fme-state": errorState })
    // Pause briefly to allow the Redux store to apply the startup error state
    await waitForMilliseconds(0)

    renderWidget(
      <Wrapped
        widgetId="w-email"
        useMapWidgetIds={Immutable(["map-1"]) as any}
        config={{
          fmeServerUrl: "https://example.com",
          fmeServerToken: "token",
          repository: "repo",
          supportEmail: "help@domain.se",
        }}
      />
    )

    // Look for the error message (translation key is displayed in test environment)
    await waitFor(() => {
      const emailErrors = screen.getAllByText(/userEmailMissing/i)
      expect(emailErrors[0]).toBeInTheDocument()
    })

    // And a support mailto link should be present (rendered by Workflow's renderError)
    const emailLink = await screen.findByRole("link", {
      name: /help@domain\.se/i,
    })
    expect(emailLink.getAttribute("href")).toBe("mailto:help@domain.se")
  })

  test("shows contact support with email when configured during startup error", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Error state with support email configured (startup validation error)
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.STARTUP_VALIDATION,
      isStartupValidating: false,
      startupValidationError: {
        message: "invalidConfiguration",
        type: "ConfigError" as any,
        severity: "error" as any,
        timestampMs: 0,
        userFriendlyMessage: "help@domain.se", // Email passed as userFriendlyMessage
      },
    }
    updateStore({ "fme-state": errorState })
    // Let the state update commit before mounting the widget
    await waitForMilliseconds(0)

    renderWidget(
      <Wrapped
        widgetId="w5"
        config={{
          fmeServerUrl: "",
          fmeServerToken: "",
          repository: "",
          supportEmail: "help@domain.se",
        }}
      />
    )

    // Expect an accessible mailto link for the support email (rendered by Workflow)
    const emailLink = await screen.findByRole("link", {
      name: /help@domain\.se/i,
    })
    expect(emailLink.getAttribute("href")).toBe("mailto:help@domain.se")

    // Check for translated support text (may vary based on translation)
    await waitFor(() => {
      const nodes = screen.queryAllByText(/för hjälp|kontakta|support/i)
      expect(nodes.length).toBeGreaterThan(0)
    })
  })

  test("formatArea produces expected metric strings", () => {
    expect(formatArea(NaN)).toBe("0 m²")
    expect(formatArea(0)).toBe("0 m²")
    expect(formatArea(12.3)).toBe("12 m²")
    // 1,234,567 m² => 1.23 km² (sv-SE locale uses comma as decimal separator, but testing library env may vary)
    const out = formatArea(1_234_567)
    expect(out.endsWith(" km²")).toBe(true)
  })

  test("validatePolygon enforces polygon-only and ring rules", () => {
    // Use simple=true to avoid self-intersection checks except where tested
    const modules: any = makeModules({ isSimple: () => true })
    // Invalid: no geometry
    let res = validatePolygon(undefined as any, modules)
    expect(res.valid).toBe(false)
    expect(res.error?.code).toBe("GEOM_MISSING")

    // Invalid: wrong type
    const notPolygon: any = { type: "point" }
    res = validatePolygon(notPolygon, modules)
    expect(res.valid).toBe(false)
    expect(res.error?.code).toBe("GEOM_TYPE_INVALID")

    // Invalid: empty rings
    const emptyPoly: any = { type: "polygon", rings: [] }
    res = validatePolygon(emptyPoly, modules)
    expect(res.valid).toBe(false)
    expect(res.error?.code).toBe("GEOM_NO_RINGS")

    // Invalid ring: fewer than 3 unique points
    const badRingPoly: any = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      ],
    }
    res = validatePolygon(badRingPoly, modules)
    expect(res.valid).toBe(false)
    expect(res.error?.code).toBe("GEOM_MIN_VERTICES")

    // Invalid ring: not closed
    const openRingPoly: any = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
    }
    res = validatePolygon(openRingPoly, modules)
    expect(res.valid).toBe(false)
    expect(res.error?.code).toBe("GEOM_RING_NOT_CLOSED")

    // Valid simple polygon (closed and simple)
    const simplePoly: any = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    }
    res = validatePolygon(simplePoly, modules)
    expect(res.valid).toBe(true)

    // Self-intersecting polygon detected by isSimple=false
    const modulesIntersect: any = makeModules({ isSimple: () => false })
    const bowtie: any = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [2, 2],
          [0, 2],
          [2, 0],
          [0, 0],
        ],
      ],
    }
    res = validatePolygon(bowtie, modulesIntersect)
    expect(res.valid).toBe(false)
    expect(res.error?.code).toBe("GEOM_SELF_INTERSECTING")
  })

  test("calcArea chooses geodesic for geographic/WebMercator and planar otherwise", () => {
    // Create a square polygon of 1x1 units; area depends on unit/system handled by engine stubs
    const mkPoly = (sr: any) =>
      ({
        type: "polygon",
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        spatialReference: sr,
      }) as any

    // Stub geometryEngine to record which method is called and return deterministic values
    const geomEngGeo = {
      geodesicArea: jest.fn(() => 123),
      planarArea: jest.fn(() => 456),
    }
    const geomEngPlanar = {
      geodesicArea: jest.fn(() => 0),
      planarArea: jest.fn(() => 789),
    }

    // Geographic SR → geodesic
    let modules: any = makeModules(geomEngGeo)
    let area = calcArea(mkPoly({ isGeographic: true }), modules)
    expect(area).toBe(123)
    expect(geomEngGeo.geodesicArea).toHaveBeenCalled()

    // WebMercator SR → geodesic
    geomEngGeo.geodesicArea.mockClear()
    area = calcArea(mkPoly({ isWebMercator: true }), modules)
    expect(area).toBe(123)
    expect(geomEngGeo.geodesicArea).toHaveBeenCalled()

    // Projected SR → planar
    modules = makeModules(geomEngPlanar)
    area = calcArea(mkPoly({ wkid: 3006, isGeographic: false }), modules)
    expect(area).toBe(789)
    expect(geomEngPlanar.planarArea).toHaveBeenCalled()

    // Non-polygon or missing engine → 0
    expect(calcArea({ type: "point" } as any, modules)).toBe(0)
    expect(calcArea(mkPoly({}), makeModules(null))).toBe(0)
  })

  test("form workflow navigation and validation", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // ORDER_RESULT success state allows reuse navigation to workspace selection
    const successState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.ORDER_RESULT,
      isStartupValidating: false, // Past startup validation
      orderResult: {
        success: true,
        jobId: 1,
        workspaceName: "ws",
        email: "a@b.com",
      },
    }
    updateStore({ "fme-state": successState })
    // Wait for the success state to be processed before rendering
    await waitForMilliseconds(0)
    const storeDispatch = jest.spyOn(getAppStore(), "dispatch")

    const { unmount: unmount1 } = renderWidget(
      <Wrapped
        widgetId="w3"
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
        }}
      />
    )

    await waitFor(() => {
      expect(
        screen.queryByText(/Validerar konfiguration|Laddar karttjänster/i)
      ).toBeNull()
    })

    const reuseBtn = await screen.findByRole("button", {
      name: /Ny beställning/i,
    })
    fireEvent.click(reuseBtn)
    // Wait a tick to give any asynchronous handlers time to dispatch actions
    await waitForMilliseconds(0)

    expect(
      storeDispatch.mock.calls.some(
        ([action]: any[]) =>
          action?.type === "FME_SET_VIEW_MODE" &&
          action?.viewMode === ViewMode.WORKSPACE_SELECTION
      )
    ).toBe(true)

    unmount1()

    // EXPORT_FORM with area too large triggers validation error
    const formState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.EXPORT_FORM,
      isStartupValidating: false, // Past startup validation
      selectedWorkspace: "ws1",
      workspaceParameters: [],
      drawnArea: 2000,
      geometryJson: { type: "polygon", rings: [[[0, 0]]] } as any,
    }
    updateStore({ "fme-state": formState })
    // Allow the form state to propagate prior to rendering
    await waitForMilliseconds(0)
    storeDispatch.mockClear()

    renderWidget(
      <Wrapped
        widgetId="w4"
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
          maxArea: 1000,
        }}
      />
    )

    await waitFor(() => {
      expect(
        screen.queryByText(/Validerar konfiguration|Laddar karttjänster/i)
      ).toBeNull()
    })

    const submitBtn = await screen.findByRole("button", { name: /Beställ/i })
    fireEvent.click(submitBtn)
    // Allow validation and error dispatches to complete before assertions
    await waitForMilliseconds(0)

    expect(
      storeDispatch.mock.calls.some(
        ([action]: any[]) =>
          action?.type === "FME_SET_ERROR" &&
          action?.error?.code === "AREA_TOO_LARGE"
      )
    ).toBe(true)
  })

  test("submits with opt_servicemode=sync when syncMode is enabled", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Ensure portal returns a valid email for submission
    ;(global as any).__TEST_PORTAL_EMAIL__ = "user@example.com"

    // Prepare a valid form submission state
    const formState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.EXPORT_FORM,
      isStartupValidating: false,
      selectedWorkspace: "ws-sync",
      workspaceParameters: [],
      drawnArea: 10,
      geometryJson: {
        type: "polygon",
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        spatialReference: { wkid: 3857 },
      } as any,
    }
    updateStore({ "fme-state": formState })
    // Pause briefly to ensure the state update has been applied
    await waitForMilliseconds(0)

    const { createFmeFlowClient } = require("../shared/api") as {
      createFmeFlowClient: jest.Mock
    }

    const { unmount } = renderWidget(
      <Wrapped
        widgetId="w-sync"
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
          syncMode: true,
        }}
      />
    )

    // Wait for loading to clear
    await waitFor(() => {
      expect(
        screen.queryByText(/Validerar konfiguration|Laddar karttjänster/i)
      ).toBeNull()
    })

    const submitBtn = await screen.findByRole("button", { name: /Beställ/i })
    fireEvent.click(submitBtn)
    // Allow asynchronous submission logic to run prior to assertions
    await waitForMilliseconds(0)

    // Assert runDataDownload received sync service mode
    await waitFor(() => {
      const results = createFmeFlowClient.mock.results
      const lastInstance = results[results.length - 1]?.value
      const calls = lastInstance?.runDataDownload?.mock?.calls || []
      expect(calls.length).toBeGreaterThan(0)
      const [, params] = calls[0]
      expect(params.opt_servicemode).toBe("sync")
      expect(typeof params.AreaOfInterest).toBe("string")
    })

    // Cleanup
    unmount()
    ;(global as any).__TEST_PORTAL_EMAIL__ = undefined
  })

  test("calcArea returns zero for non-polygon geometries", () => {
    // Use makeModules with null geometryEngine to simulate missing engine
    const modules: any = makeModules(null)
    const dummyRender = withStoreRender(false)
    expect(typeof dummyRender).toBe("function")
    const area = calcArea({ type: "point" } as any, modules)
    expect(area).toBe(0)
  })
})
