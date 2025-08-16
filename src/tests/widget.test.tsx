import { React, getAppStore } from "jimu-core"
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
  loadArcGISJSAPIModules: jest.fn(() =>
    Promise.resolve([
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
  ),
}))

describe("FME Export Widget", () => {
  const renderWidget = widgetRender(false)

  beforeAll(() => {
    initExtensions()
    initStore()
    setTheme(mockTheme)
  })

  test("shows loading state initially while modules load", () => {
    const Wrapped = wrapWidget(Widget as any)
    renderWidget(<Wrapped widgetId="w1" />)

    // Loading message should be present (Swedish default messages)
    const el = screen.getByText(/Laddar karttjänster/i)
    expect(el).toBeTruthy()
  })

  test("error view renders and Retry clears error via dispatch", async () => {
    const Wrapped = wrapWidget(Widget as any)
    const state: FmeWidgetState = {
      ...initialFmeState,
      error: {
        message: "geometryMissing",
        severity: "error" as any,
        type: "ValidationError" as any,
        timestamp: new Date(0),
      },
    }
    // Seed global store state used by mapExtraStateProps
    updateStore({ "fme-state": state })
    // Spy on app store dispatch (connect injects this into widget props)
    const storeDispatch = jest.spyOn(getAppStore(), "dispatch")
    renderWidget(
      <Wrapped
        widgetId="w1"
        // Provide minimal valid config to avoid Workflow useMemo errors if rendered
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
        }}
      />
    )

    // Wait for modules to finish loading (loading view disappears)
    await waitFor(() => {
      expect(screen.queryByText(/Laddar karttjänster/i)).toBeNull()
    })

    // Retry button (Swedish: Försök igen)
    const retryBtn = await screen.findByRole("button", { name: /Försök igen/i })
    fireEvent.click(retryBtn)

    // Expect a dispatch to clear error (action type FME_SET_ERROR with null)
    const dispatched = storeDispatch.mock.calls.map((c) => c[0])
    expect(
      dispatched.some(
        (a: any) => a?.type === "FME_SET_ERROR" && a?.error === null
      )
    ).toBe(true)
  })

  test("formatArea produces expected metric strings", () => {
    expect(formatArea(NaN)).toBe("0 m²")
    expect(formatArea(0)).toBe("0 m²")
    expect(formatArea(12.3)).toBe("12 m²")
    // 1,234,567 m² => 1.23 km² (sv-SE locale uses comma as decimal separator, but testing library env may vary)
    const out = formatArea(1_234_567)
    expect(out.endsWith(" km²")).toBe(true)
  })

  test("ORDER_RESULT success allows reuse which navigates to workspace selection", async () => {
    const Wrapped = wrapWidget(Widget as any)
    const state: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.ORDER_RESULT,
      orderResult: {
        success: true,
        jobId: 1,
        workspaceName: "ws",
        email: "a@b.com",
      },
    }
    updateStore({ "fme-state": state })
    const storeDispatch = jest.spyOn(getAppStore(), "dispatch")
    renderWidget(
      <Wrapped
        widgetId="w1"
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
        }}
      />
    )

    // Wait for modules to finish loading
    await waitFor(() => {
      expect(screen.queryByText(/Laddar karttjänster/i)).toBeNull()
    })

    // Button text from component translations: Ny beställning
    const reuseBtn = await screen.findByRole("button", {
      name: /Ny beställning/i,
    })
    fireEvent.click(reuseBtn)

    const dispatched = storeDispatch.mock.calls.map((c) => c[0])
    expect(
      dispatched.some(
        (a: any) =>
          a?.type === "FME_SET_VIEW_MODE" &&
          a?.viewMode === ViewMode.WORKSPACE_SELECTION
      )
    ).toBe(true)
  })

  test("EXPORT_FORM submission with area too large dispatches validation error", async () => {
    const Wrapped = wrapWidget(Widget as any)
    const state: FmeWidgetState = {
      ...initialFmeState,
      viewMode: ViewMode.EXPORT_FORM,
      selectedWorkspace: "ws1",
      workspaceParameters: [],
      drawnArea: 2000, // over the max
      geometryJson: { type: "polygon", rings: [[[0, 0]]] } as any,
    }
    updateStore({ "fme-state": state })
    const storeDispatch = jest.spyOn(getAppStore(), "dispatch")
    renderWidget(
      <Wrapped
        widgetId="w1"
        config={{
          fmeServerUrl: "http://example.com",
          fmeServerToken: "t",
          repository: "repo",
          maxArea: 1000,
        }}
      />
    )

    // Wait for modules to finish loading
    await waitFor(() => {
      expect(screen.queryByText(/Laddar karttjänster/i)).toBeNull()
    })

    // Submit button text from components translations: Beställ
    const submitBtn = await screen.findByRole("button", { name: /Beställ/i })
    fireEvent.click(submitBtn)

    // Expect a validation error dispatched
    const dispatched = storeDispatch.mock.calls.map((c) => c[0])
    expect(
      dispatched.some(
        (a: any) =>
          a?.type === "FME_SET_ERROR" && a?.error?.code === "AREA_TOO_LARGE"
      )
    ).toBe(true)
  })
})
