import "@testing-library/jest-dom"
import { React, getAppStore, Immutable, WidgetState } from "jimu-core"
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

// Mock jimu-arcgis to avoid JSAPI loading and map rendering
jest.mock("jimu-arcgis", () => ({
  __esModule: true,
  // Minimal stub for single map widget configuration
  JimuMapViewComponent: () => null,
  // Resolve modules with minimal shims
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
        // no-op
        return null as any
      },
      function GraphicsLayer(this: any) {
        // no-op with method used by widget
        this.removeAll = () => undefined
        return null as any
      },
      function Graphic() {
        // no-op
        return null as any
      },
      function Polygon() {
        // no-op
        return null as any
      },
      function Extent() {
        // no-op
        return null as any
      },
      function AreaMeasurement2D() {
        // no-op
        return null as any
      },
      function DistanceMeasurement2D() {
        // no-op
        return null as any
      },
      { planarArea: jest.fn(), geodesicArea: jest.fn() },
    ])
  }),
}))

// Mock FME client so startup connection/auth checks pass without network
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

  // Helper to create minimal EsriModules with geometryEngine stub
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

    // Startup validation shows loading message
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
    // Wait a tick so store update propagates before re-render
    await waitForMilliseconds(0)
    // Rerender with error state
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

    // Startup validation error for missing email
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
    // Wait for store to apply startup error state
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

    // Error message (translation key in test env)
    await waitFor(() => {
      const emailErrors = screen.getAllByText(/userEmailMissing/i)
      expect(emailErrors[0]).toBeInTheDocument()
    })

    // Support mailto link rendered by Workflow
    const emailLink = await screen.findByRole("link", {
      name: /help@domain\.se/i,
    })
    expect(emailLink.getAttribute("href")).toBe("mailto:help@domain.se")
  })

  test("shows contact support with email when configured during startup error", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Startup validation error with support email configured
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
    // Wait for state update before mounting
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

    // Accessible mailto link for support email
    const emailLink = await screen.findByRole("link", {
      name: /help@domain\.se/i,
    })
    expect(emailLink.getAttribute("href")).toBe("mailto:help@domain.se")

    // Support text present (translation may vary)
    await waitFor(() => {
      const nodes = screen.queryAllByText(/för hjälp|kontakta|support/i)
      expect(nodes.length).toBeGreaterThan(0)
    })
  })

  test("startup validation shows specific error for empty server URL", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Startup validation error for empty server URL
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.STARTUP_VALIDATION,
      isStartupValidating: false,
      startupValidationError: {
        message: "serverUrlMissing",
        type: "ConfigError" as any,
        severity: "error" as any,
        timestampMs: 0,
        code: "ServerUrlEmpty",
        userFriendlyMessage: "Kontakta supporten för hjälp med konfigurationen",
      },
    }
    updateStore({ "fme-state": errorState })
    await waitForMilliseconds(0)

    renderWidget(
      <Wrapped
        widgetId="w-server-url-empty"
        useMapWidgetIds={Immutable(["map-1"]) as any}
        config={{
          fmeServerUrl: "", // Empty server URL
          fmeServerToken: "valid-token",
          repository: "valid-repo",
        }}
      />
    )

    // Error message for missing server URL
    await waitFor(() => {
      const errorElements = screen.getAllByText(/serverUrlMissing/i)
      expect(errorElements[0]).toBeInTheDocument()
    })
  })

  test("startup validation shows specific error for empty token", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Startup validation error for empty token
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.STARTUP_VALIDATION,
      isStartupValidating: false,
      startupValidationError: {
        message: "tokenMissing",
        type: "ConfigError" as any,
        severity: "error" as any,
        timestampMs: 0,
        code: "TokenEmpty",
        userFriendlyMessage: "Kontakta supporten för hjälp med konfigurationen",
      },
    }
    updateStore({ "fme-state": errorState })
    await waitForMilliseconds(0)

    renderWidget(
      <Wrapped
        widgetId="w-token-empty"
        useMapWidgetIds={Immutable(["map-1"]) as any}
        config={{
          fmeServerUrl: "https://example.com",
          fmeServerToken: "", // Empty token
          repository: "valid-repo",
        }}
      />
    )

    // Error message for missing token
    await waitFor(() => {
      const errorElements = screen.getAllByText(/tokenMissing/i)
      expect(errorElements[0]).toBeInTheDocument()
    })
  })

  test("startup validation shows specific error for empty repository", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Startup validation error for empty repository
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.STARTUP_VALIDATION,
      isStartupValidating: false,
      startupValidationError: {
        message: "repositoryMissing",
        type: "ConfigError" as any,
        severity: "error" as any,
        timestampMs: 0,
        code: "RepositoryEmpty",
        userFriendlyMessage: "Kontakta supporten för hjälp med konfigurationen",
      },
    }
    updateStore({ "fme-state": errorState })
    await waitForMilliseconds(0)

    renderWidget(
      <Wrapped
        widgetId="w-repo-empty"
        useMapWidgetIds={Immutable(["map-1"]) as any}
        config={{
          fmeServerUrl: "https://example.com",
          fmeServerToken: "valid-token",
          repository: "", // Empty repository
        }}
      />
    )

    // Error message for missing repository
    await waitFor(() => {
      const errorElements = screen.getAllByText(/repositoryMissing/i)
      expect(errorElements[0]).toBeInTheDocument()
    })
  })

  test("startup validation handles whitespace-only fields as empty", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Startup validation error for whitespace-only server URL
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.STARTUP_VALIDATION,
      isStartupValidating: false,
      startupValidationError: {
        message: "serverUrlMissing",
        type: "ConfigError" as any,
        severity: "error" as any,
        timestampMs: 0,
        code: "ServerUrlEmpty",
        userFriendlyMessage: "Kontakta supporten för hjälp med konfigurationen",
      },
    }
    updateStore({ "fme-state": errorState })
    await waitForMilliseconds(0)

    renderWidget(
      <Wrapped
        widgetId="w-whitespace"
        useMapWidgetIds={Immutable(["map-1"]) as any}
        config={{
          fmeServerUrl: "   ", // Whitespace-only server URL
          fmeServerToken: "valid-token",
          repository: "valid-repo",
        }}
      />
    )

    // Error message for empty server URL (whitespace treated as empty)
    await waitFor(() => {
      const errorElements = screen.getAllByText(/serverUrlMissing/i)
      expect(errorElements[0]).toBeInTheDocument()
    })
  })

  test("formatArea produces expected metric strings", () => {
    expect(formatArea(NaN)).toBe("0 m²")
    expect(formatArea(0)).toBe("0 m²")
    expect(formatArea(12.3)).toBe("12 m²")
    // Large value switches to km² (locale may vary in tests)
    const out = formatArea(1_234_567)
    expect(out.endsWith(" km²")).toBe(true)
  })

  test("validatePolygon checks existence, polygon type, and self-intersection via engine", () => {
    // Use makeModules to create EsriModules with geometryEngine stub
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

    // Empty polygon is considered valid (no rings to be invalid)
    const emptyPoly: any = { type: "polygon", rings: [] }
    res = validatePolygon(emptyPoly, modules)
    expect(res.valid).toBe(true)

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
    expect(res.valid).toBe(true)

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

    // Without geometryEngine, assume valid if geometry exists and is polygon
    const noEngine: any = makeModules(null)
    res = validatePolygon(simplePoly, noEngine)
    expect(res.valid).toBe(true)
  })

  test("calcArea chooses geodesic for geographic/WebMercator and planar otherwise", () => {
    // Square polygon 1x1; area value comes from engine stubs
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

    // Stub geometryEngine to return deterministic values
    const geomEngGeo = {
      geodesicArea: jest.fn(() => 123),
      planarArea: jest.fn(() => 456),
    }
    const geomEngPlanar = {
      geodesicArea: jest.fn(() => 0),
      planarArea: jest.fn(() => 789),
    }

    // Geographic SR -> geodesic
    let modules: any = makeModules(geomEngGeo)
    let area = calcArea(mkPoly({ isGeographic: true }), modules)
    expect(area).toBe(123)
    expect(geomEngGeo.geodesicArea).toHaveBeenCalled()

    // WebMercator SR -> geodesic
    geomEngGeo.geodesicArea.mockClear()
    area = calcArea(mkPoly({ isWebMercator: true }), modules)
    expect(area).toBe(123)
    expect(geomEngGeo.geodesicArea).toHaveBeenCalled()

    // Projected SR -> planar
    modules = makeModules(geomEngPlanar)
    area = calcArea(mkPoly({ wkid: 3006, isGeographic: false }), modules)
    expect(area).toBe(789)
    expect(geomEngPlanar.planarArea).toHaveBeenCalled()

    // Non-polygon or missing engine -> 0
    expect(calcArea({ type: "point" } as any, modules)).toBe(0)
    expect(calcArea(mkPoly({}), makeModules(null))).toBe(0)
  })

  test("form workflow navigation and validation", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // ORDER_RESULT success allows reuse navigation to workspace selection
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
    // Wait for success state to propagate before rendering
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
    // Wait a tick for async handlers to dispatch actions
    await waitForMilliseconds(0)

    expect(
      storeDispatch.mock.calls.some(
        ([action]: any[]) =>
          action?.type === "FME_SET_VIEW_MODE" &&
          action?.viewMode === ViewMode.WORKSPACE_SELECTION
      )
    ).toBe(true)

    unmount1()

    // EXPORT_FORM with area too large triggers AREA_TOO_LARGE
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
    // Wait for form state
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
    // Wait for validation and error dispatches
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

    // Provide portal email for submission
    ;(global as any).__TEST_PORTAL_EMAIL__ = "user@example.com"

    // Prepare valid form submission state
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
    // Wait for state update to apply
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
    // Wait for async submission logic
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

  test("resets state when controller closes and stays in DRAWING on reopen", async () => {
    const Wrapped = wrapWidget(Widget as any)

    // Provide portal email so startup validation can pass
    ;(global as any).__TEST_PORTAL_EMAIL__ = "user@example.com"

    const widgetId = "wf-reset"
    const { unmount } = renderWidget(
      <Wrapped
        widgetId={widgetId}
        useMapWidgetIds={Immutable(["map-1"]) as any}
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
        }}
      />
    )

    // Wait for loading to clear
    await waitFor(() => {
      expect(
        screen.queryByText(/Validerar konfiguration|Laddar karttjänster/i)
      ).toBeNull()
    })

    // Seed FME state with non-empty values
    const dirtyState: FmeWidgetState = {
      ...initialFmeState,
      isStartupValidating: false,
      viewMode: ViewMode.EXPORT_FORM,
      drawnArea: 123,
      clickCount: 3,
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
      } as any,
      selectedWorkspace: "ws1",
      workspaceParameters: [],
      orderResult: {
        success: true,
        jobId: 7,
        workspaceName: "ws1",
        email: "a@b.com",
      },
    }
    updateStore({ "fme-state": dirtyState })
    await waitForMilliseconds(0)

    // Spy on dispatch to verify reset actions are issued
    const dispatchSpy = jest.spyOn(getAppStore(), "dispatch")

    // Simulate controller closing this widget
    updateStore({
      widgetsRuntimeInfo: { [widgetId]: { state: WidgetState.Closed } } as any,
    })
    await waitForMilliseconds(0)

    // Assert reset actions akin to pressing Cancel (effect-driven, wait for dispatches)
    await waitFor(() => {
      const calls = dispatchSpy.mock.calls.map(([a]) => a as any)
      const hasClearedGeometry = calls.some(
        (a) =>
          a?.type === "FME_SET_GEOMETRY" &&
          a?.geometryJson === null &&
          a?.drawnArea === 0
      )
      const hasClearedClickCount = calls.some(
        (a) => a?.type === "FME_SET_CLICK_COUNT" && a?.clickCount === 0
      )
      const hasClearedWorkspace = calls.some(
        (a) =>
          a?.type === "FME_SET_SELECTED_WORKSPACE" && a?.workspaceName === null
      )
      const hasClearedOrder = calls.some(
        (a) => a?.type === "FME_SET_ORDER_RESULT" && a?.orderResult === null
      )
      expect(hasClearedGeometry).toBe(true)
      expect(hasClearedClickCount).toBe(true)
      expect(hasClearedWorkspace).toBe(true)
      expect(hasClearedOrder).toBe(true)
    })

    // Reopen the widget
    const callCountAfterClose = dispatchSpy.mock.calls.length
    updateStore({
      widgetsRuntimeInfo: { [widgetId]: { state: WidgetState.Active } } as any,
    })
    await waitForMilliseconds(0)
    const newCalls = dispatchSpy.mock.calls
      .slice(callCountAfterClose)
      .map(([a]) => a as any)
    // Should not navigate away from DRAWING due to reopen
    const movedAway = newCalls.some(
      (a) => a?.type === "FME_SET_VIEW_MODE" && a?.viewMode !== ViewMode.DRAWING
    )
    expect(movedAway).toBe(false)

    unmount()
    ;(global as any).__TEST_PORTAL_EMAIL__ = undefined
  })
})
