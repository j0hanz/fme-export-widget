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
} from "jimu-for-test"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import Widget, { formatArea } from "../runtime/widget"
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
        // Return no user to trigger email requirement error
        this.user = null
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
    })),
  }
})

describe("FME Export Widget", () => {
  const renderWidget = widgetRender(false)

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

    // Non-startup error state renders retry button and clears error on click
    const errorState: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.INITIAL, // Move past startup validation
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
    const storeDispatch = jest.spyOn(getAppStore(), "dispatch")

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

    const retryBtn = await screen.findByRole("button", { name: /Försök igen/i })
    fireEvent.click(retryBtn)

    const dispatched = storeDispatch.mock.calls.map((c) => c[0])
    expect(
      dispatched.some(
        (a: any) => a?.type === "FME_SET_ERROR" && a?.error === null
      )
    ).toBe(true)
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
      expect(screen.queryByText(/för hjälp|kontakta|support/i)).toBeTruthy()
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

    expect(
      storeDispatch.mock.calls.some(
        ([action]: any[]) =>
          action?.type === "FME_SET_ERROR" &&
          action?.error?.code === "AREA_TOO_LARGE"
      )
    ).toBe(true)
  })
})
