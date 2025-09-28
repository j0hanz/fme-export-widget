import React from "react"
import "@testing-library/jest-dom"
import { waitFor, screen, fireEvent } from "@testing-library/react"
import {
  wrapWidget,
  initStore,
  mockTheme,
  updateStore,
  widgetRender,
  setTheme,
  initExtensions,
} from "jimu-for-test"
import type { AllWidgetProps } from "jimu-core"
import {
  DrawingTool,
  ViewMode,
  ParameterType,
  FormFieldType,
  ErrorType,
  type WorkspaceParameter,
  type DynamicFieldConfig,
  type EsriModules,
  type ConnectionValidationOptions,
} from "../config"
import {
  attachAoi,
  prepFmeParams,
  getEmail,
  formatArea,
} from "../runtime/widget"
import {
  calcArea,
  validatePolygon,
  processFmeResponse,
} from "../shared/validations"
import {
  validateConnection,
  healthCheck,
  ParameterFormService,
} from "../shared/services"
import { DynamicField } from "../runtime/components/fields"
import runtimeMsgs from "../runtime/components/translations/default"
import settingMsgs from "../setting/translations/default"

// Centralized Workflow mock: submits whatever payload the test places in global.__WORKFLOW_FORM_DATA__
jest.mock("../runtime/components/workflow", () => {
  const React = require("react")
  const MockWorkflow = (props: any) => {
    const { onFormSubmit } = props
    React.useEffect(() => {
      const form = (global as any).__WORKFLOW_FORM_DATA__
      if (onFormSubmit && form) onFormSubmit(form)
    }, [onFormSubmit])
    return null
  }
  return { __esModule: true, Workflow: MockWorkflow }
})

// Mock API client for FME interactions
jest.mock("../shared/api", () => {
  // Shared mock client used by default unless tests override implementations
  const mockClient = {
    runWorkspace: jest.fn().mockResolvedValue({
      status: 200,
      data: {
        serviceResponse: {
          status: "success",
          jobID: 303,
          url: "https://download.example/test",
        },
      },
    }),
    uploadToTemp: jest.fn().mockResolvedValue({
      status: 200,
      data: { path: "$(FME_SHAREDRESOURCE_TEMP)/widget_wY/input.zip" },
    }),
    // Methods used by service-layer validation
    testConnection: jest
      .fn()
      .mockResolvedValue({ status: 200, data: { build: "2024.0" } }),
    getRepositories: jest.fn().mockResolvedValue({ status: 200, data: [] }),
    validateRepository: jest
      .fn()
      .mockResolvedValue({ status: 200, data: { exists: true } }),
  }

  // Default export: class constructor used by shared/services
  const Default = jest.fn().mockImplementation((_opts) => mockClient)
  // Named factory used by runtime widget
  const createFmeFlowClient = jest
    .fn()
    .mockImplementation((_config) => mockClient)

  return { __esModule: true, default: Default, createFmeFlowClient }
})

// Allow startup validation to pass quickly
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

// Provide a simple JimuMapViewComponent that immediately yields a fake view
jest.mock("jimu-arcgis", () => ({
  JimuMapViewComponent: ({ onActiveViewChange }: any) => {
    const React = require("react")
    React.useEffect(() => {
      const fakeMap = { layers: [], add: jest.fn(), remove: jest.fn() }
      const fakeJmv = { view: { map: fakeMap } }
      onActiveViewChange?.(fakeJmv)
    }, [onActiveViewChange])
    return null
  },
}))

// Use the real widget runtime (mocks above apply)
const Widget = require("../runtime/widget").default
const wrap = (props?: Partial<AllWidgetProps<any>>) =>
  wrapWidget(Widget, props as any)

beforeAll(() => {
  // Initialize EXB test environment similar to other UI tests
  initExtensions()
  initStore()
  setTheme(mockTheme)

  // Provide URL.createObjectURL for Blob handling in Node/JSDOM
  if (!(URL as any).createObjectURL) {
    ;(URL as any).createObjectURL = jest
      .fn()
      .mockImplementation(() => "blob:mock-url")
  }
  // Provide ArcGIS module stub used by the widget loader
  const createSpy = jest.fn()
  class SketchViewModel {
    options: any
    activeTool: string | null = null
    create = createSpy
    cancel = jest.fn()
    destroy = jest.fn()
    constructor(opts: any) {
      this.options = opts
    }
  }
  class GraphicsLayer {
    parent: any = {}
    removeAll = jest.fn()
  }
  const geometryEngine = {
    simplify: jest.fn((poly: any) => poly),
    geodesicArea: jest.fn(() => 1234.56),
    planarArea: jest.fn(() => 789.12),
    isSimple: jest.fn(() => true),
  }
  const geometryEngineAsync = {
    simplify: jest.fn((poly: any) => Promise.resolve(poly)),
    geodesicArea: jest.fn(() => Promise.resolve(1234.56)),
    planarArea: jest.fn(() => Promise.resolve(789.12)),
    isSimple: jest.fn(() => Promise.resolve(true)),
  }
  const webMercatorUtils = {}
  const projection = {
    load: jest.fn(() => Promise.resolve()),
    project: jest.fn((geom: any) => geom),
  }
  class SpatialReference {
    static WGS84 = { wkid: 4326 }
    wkid: number
    constructor(props: { wkid: number }) {
      this.wkid = props.wkid
    }
  }
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
    geometryEngineAsync,
    webMercatorUtils,
    projection,
    SpatialReference,
    Polyline,
    Polygon,
    Graphic,
  ]

  // Mock SessionManager to provide a user email for getEmail() and support jimu-ui internals
  ;(global as any).__TEST_EMAIL__ = "user@example.com"
  const { SessionManager } = require("jimu-core")
  jest.spyOn(SessionManager, "getInstance").mockReturnValue({
    getUserInfo: () =>
      Promise.resolve({ email: (global as any).__TEST_EMAIL__ || "" }),
    getMainSession: jest.fn(() => ({})),
  })
})

describe("FME dataset submission behavior", () => {
  test("prefers opt_geturl over upload when valid remote URL provided", async () => {
    const Wrapped = wrap({})
    const renderWithProviders = widgetRender(true)

    // Prime Redux so canSubmit() passes
    updateStore({
      "fme-state": {
        byId: {
          wX: {
            viewMode: ViewMode.EXPORT_FORM,
            clickCount: 0,
            isSubmittingOrder: false,
            drawingTool: DrawingTool.POLYGON,
            drawnArea: 1000,
            geometryJson: {
              rings: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            selectedWorkspace: "demo",
            workspaceParameters: [],
          },
        },
      },
    })

    // Configure Workflow mock payload
    ;(global as any).__WORKFLOW_FORM_DATA__ = {
      type: "demo",
      data: { __remote_dataset_url__: "https://data.example.com/sample.zip" },
    }

    renderWithProviders(
      <Wrapped
        theme={mockTheme}
        id="wX"
        widgetId="wX"
        useMapWidgetIds={["map_X"] as any}
        config={{ repository: "repoA", allowRemoteUrlDataset: true } as any}
      />
    )

    // Force widget into EXPORT_FORM mode post-mount to trigger Workflow effect
    updateStore({
      "fme-state": {
        byId: {
          wX: {
            viewMode: ViewMode.EXPORT_FORM,
            selectedWorkspace: "demo",
            workspaceParameters: [],
            isSubmittingOrder: false,
            drawnArea: 1000,
            geometryJson: {
              rings: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
        },
      },
    })

    await waitFor(() => {
      expect((global as any).__LAST_FME_CALL__).toBeTruthy()
    })
    const call = (global as any).__LAST_FME_CALL__
    expect(call.workspace).toBe("demo")
    expect(call.params.opt_geturl).toBe("https://data.example.com/sample.zip")
    expect(call.params.__upload_file__).toBeUndefined()
    expect(call.params.__remote_dataset_url__).toBeUndefined()
  })

  test("invalid remote URL falls back to upload and maps to target param", async () => {
    const Wrapped = wrap({})
    const renderWithProviders = widgetRender(true)

    // Prime Redux state to allow submission
    updateStore({
      "fme-state": {
        byId: {
          wY: {
            viewMode: ViewMode.EXPORT_FORM,
            clickCount: 0,
            isSubmittingOrder: false,
            drawingTool: DrawingTool.POLYGON,
            drawnArea: 1000,
            geometryJson: {
              rings: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            selectedWorkspace: "demo",
            workspaceParameters: [{ name: "INPUT_DATASET", type: "FILENAME" }],
          },
        },
      },
    })

    // Configure Workflow mock to provide invalid URL plus file
    const fakeFile = new File(["abc"], "input.zip", { type: "application/zip" })
    ;(global as any).__WORKFLOW_FORM_DATA__ = {
      type: "demo",
      data: {
        __remote_dataset_url__: "ftp://insecure.example/file.zip", // invalid per new validator (non-http/https)
        __upload_file__: fakeFile,
      },
    }

    renderWithProviders(
      <Wrapped
        theme={mockTheme}
        id="wY"
        widgetId="wY"
        useMapWidgetIds={["map_Y"] as any}
        config={
          {
            repository: "repoA",
            allowRemoteUrlDataset: true,
            allowRemoteDataset: true,
            uploadTargetParamName: "INPUT_DATASET",
          } as any
        }
      />
    )

    // Force widget into EXPORT_FORM mode post-mount to trigger Workflow effect
    updateStore({
      "fme-state": {
        byId: {
          wY: {
            viewMode: ViewMode.EXPORT_FORM,
            selectedWorkspace: "demo",
            workspaceParameters: [{ name: "INPUT_DATASET", type: "FILENAME" }],
            isSubmittingOrder: false,
            drawnArea: 1000,
            geometryJson: {
              rings: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
        },
      },
    })

    await waitFor(() => {
      expect((global as any).__LAST_FME_CALL__).toBeTruthy()
    })
    const call = (global as any).__LAST_FME_CALL__
    expect(call.workspace).toBe("demo")
    // URL invalid -> no opt_geturl
    expect(call.params.opt_geturl).toBeUndefined()
    // Upload fallback used and mapped to explicit param
    expect(call.params.INPUT_DATASET).toBe(
      "$(FME_SHAREDRESOURCE_TEMP)/widget_wY/input.zip"
    )
    // Ensure uploadToTemp was actually invoked - access from mocked module
    const { createFmeFlowClient } = require("../shared/api") as {
      createFmeFlowClient: jest.Mock
    }
    const mockClientInstance = createFmeFlowClient.mock.results[0].value
    expect(mockClientInstance.uploadToTemp).toHaveBeenCalled()
  })
})

describe("FME internal helper functions", () => {
  test("attachAoi uses custom aoiParamName with direct polygon json", () => {
    const base: any = { a: 1 }
    const polygon = {
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
    const cfg: any = { aoiParamName: "CustomAOI" }
    const out = attachAoi(base, polygon, undefined as any, null, cfg)
    expect(out.CustomAOI).toBeDefined()
    expect(() => JSON.parse(out.CustomAOI as string)).not.toThrow()
    expect(out.a).toBe(1)
  })

  test("prepFmeParams sets schedule defaults and preserves start field", () => {
    const formData = {
      data: { _serviceMode: "schedule", start: "2025-09-20 09:30:00" },
    }
    const out = prepFmeParams(
      formData,
      "user@example.com",
      {
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      undefined as any,
      { aoiParamName: "AreaOfInterest" } as any
    ) as any
    expect(out.opt_servicemode).toBe("schedule")
    expect(out.start).toBe("2025-09-20 09:30:00")
    expect(out.trigger).toBe("runonce")
    // requester email is only added for async mode now
    expect(out.opt_requesteremail).toBeUndefined()
  })

  test("prepFmeParams passes schedule metadata (name/category/description)", () => {
    const formData = {
      data: {
        _serviceMode: "schedule",
        start: "2025-09-20 09:30:00",
        name: "Night run",
        category: "One-offs",
        description: "Export AOI for project X",
      },
    }
    const out = prepFmeParams(
      formData,
      "user@example.com",
      {
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      undefined as any,
      { allowScheduleMode: true } as any
    ) as any
    expect(out.opt_servicemode).toBe("schedule")
    expect(out.start).toBe("2025-09-20 09:30:00")
    expect(out.trigger).toBe("runonce")
    expect(out.name).toBe("Night run")
    expect(out.category).toBe("One-offs")
    expect(out.description).toBe("Export AOI for project X")
  })

  test("getEmail returns valid email and throws coded errors for missing/invalid", async () => {
    // Valid email scenario
    ;(global as any).__TEST_EMAIL__ = "user@example.com"
    await expect(getEmail({} as any)).resolves.toBe("user@example.com")

    // Missing email scenario -> expect rejection
    ;(global as any).__TEST_EMAIL__ = ""
    await expect(getEmail({} as any)).rejects.toThrow("MISSING_REQUESTER_EMAIL")

    // Invalid email scenario -> expect rejection
    ;(global as any).__TEST_EMAIL__ = "invalid"
    await expect(getEmail({} as any)).rejects.toThrow("INVALID_EMAIL")
  })

  test("processFmeResponse handles streaming Blob", () => {
    // Construct a fake streaming API response
    const blob = new Blob(["{}"], { type: "application/json" })
    const fmeResponse = {
      data: { blob, fileName: "data.json", contentType: "application/json" },
    }
    const res = processFmeResponse(
      fmeResponse,
      "my.fmw",
      "user@example.com",
      (k: string) => k
    )
    expect(res.success).toBe(true)
    // New behavior returns blob and filename; no direct downloadUrl guaranteed
    expect(res.blob).toBeInstanceOf(Blob)
    expect(res.downloadFilename).toBe("my.fmw_export.zip")
  })
})

describe("FME workspace discovery in Workflow", () => {
  test("workspace selection: loads, lists items, and selects a workspace", async () => {
    jest.useFakeTimers()
    // Override the API client mock for this block to provide workspace methods
    const { createFmeFlowClient } = require("../shared/api") as {
      createFmeFlowClient: jest.Mock
    }
    const mockClient = {
      getRepositoryItems: jest.fn(),
      getWorkspaceItem: jest.fn(),
      getWorkspaceParameters: jest.fn(),
    }
    createFmeFlowClient.mockImplementation(() => mockClient)

    const workspaces = [
      { name: "ws1", title: "Workspace One", type: "WORKSPACE" },
      { name: "ws2", title: "Workspace Two", type: "WORKSPACE" },
    ]
    mockClient.getRepositoryItems.mockResolvedValueOnce({
      status: 200,
      data: { items: workspaces },
    })

    const { Workflow: RealWorkflow } = jest.requireActual(
      "../runtime/components/workflow"
    )
    const renderWithProviders = widgetRender(true)
    const onWorkspaceSelected = jest.fn()

    const { rerender } = renderWithProviders(
      <RealWorkflow
        state={ViewMode.INITIAL}
        instructionText=""
        isModulesLoading={false}
        config={{ repository: "repoA" } as any}
        onWorkspaceSelected={onWorkspaceSelected}
        showHeaderActions={false}
      />
    )

    // Transition into workspace selection to trigger scheduled load
    rerender(
      <RealWorkflow
        state={ViewMode.WORKSPACE_SELECTION}
        instructionText=""
        isModulesLoading={false}
        config={{ repository: "repoA" } as any}
        onWorkspaceSelected={onWorkspaceSelected}
        showHeaderActions={false}
      />
    )

    // Initially shows loading status
    expect(screen.getByRole("status")).toBeInTheDocument()
    // Advance timers to trigger debounced loading
    jest.advanceTimersByTime(600)
    await waitFor(() => {
      expect(mockClient.getRepositoryItems).toHaveBeenCalled()
    })
    // StateView minimum delay before list renders
    jest.advanceTimersByTime(1200)

    // Prepare item details and parameters mocks before click
    mockClient.getWorkspaceItem.mockResolvedValueOnce({
      status: 200,
      data: {
        title: "Workspace One",
        description: "Test workspace",
      },
    })

    mockClient.getWorkspaceParameters.mockResolvedValueOnce({
      status: 200,
      data: [{ name: "count", type: ParameterType.INTEGER }],
    })

    const firstItem = await screen.findByRole("listitem", {
      name: /Workspace One/i,
    })
    fireEvent.click(firstItem)

    await waitFor(() => {
      expect(onWorkspaceSelected).toHaveBeenCalled()
    })
  })

  test("workspace selection: error state shows alert and support hint (no list)", async () => {
    jest.useFakeTimers()
    const { createFmeFlowClient } = require("../shared/api") as {
      createFmeFlowClient: jest.Mock
    }
    const mockClient = {
      getRepositoryItems: jest.fn(),
      getWorkspaceItem: jest.fn(),
      getWorkspaceParameters: jest.fn(),
    }
    createFmeFlowClient.mockImplementation(() => mockClient)
    mockClient.getRepositoryItems.mockRejectedValueOnce(new Error("boom"))

    const { Workflow: RealWorkflow } = jest.requireActual(
      "../runtime/components/workflow"
    )
    const renderWithProviders = widgetRender(true)

    const { rerender } = renderWithProviders(
      <RealWorkflow
        state={ViewMode.INITIAL}
        instructionText=""
        isModulesLoading={false}
        config={
          { repository: "repoA", supportEmail: "help@example.com" } as any
        }
        showHeaderActions={false}
      />
    )

    rerender(
      <RealWorkflow
        state={ViewMode.WORKSPACE_SELECTION}
        instructionText=""
        isModulesLoading={false}
        config={
          { repository: "repoA", supportEmail: "help@example.com" } as any
        }
        showHeaderActions={false}
      />
    )

    expect(screen.getByRole("status")).toBeInTheDocument()
    jest.advanceTimersByTime(600)
    await waitFor(() => {
      expect(mockClient.getRepositoryItems).toHaveBeenCalled()
    })
    // Wait for error processing
    await waitFor(() => undefined)
    jest.advanceTimersByTime(1200)

    const alert = await screen.findByRole("alert")
    expect(alert).toBeInTheDocument()
  })
})

describe("FME geometry helpers", () => {
  test("calcArea returns 0 for non-polygon or missing engine", async () => {
    const modules = { geometryEngine: undefined } as unknown as EsriModules
    expect(await calcArea(undefined, modules)).toBe(0)
    expect(await calcArea({ type: "point" } as any, modules)).toBe(0)
  })

  test("calcArea uses planar area and clamps to non-negative", async () => {
    // Mock geometryEngine with geodesic area calculation
    const geometryEngine = {
      planarArea: jest.fn(() => 1000000),
      simplify: jest.fn((p: any) => p),
    }
    const Polygon = {
      fromJSON: jest.fn((json: any) => ({
        type: "polygon",
        spatialReference: json?.spatialReference ?? { isGeographic: true },
      })),
    }
    const modules = { geometryEngine, Polygon } as unknown as EsriModules

    // Build fake geometry instance with toJSON returning geographic SR
    const geom = {
      type: "polygon",
      toJSON: () => ({ spatialReference: { isGeographic: true } }),
    } as any

    expect(await calcArea(geom, modules)).toBe(1000000)
  })

  test("validatePolygon detects missing and wrong types", async () => {
    const modules = {} as EsriModules
    const missing = await validatePolygon(undefined, modules)
    expect(missing.valid).toBe(false)
    expect(missing.error?.type).toBe(ErrorType.GEOMETRY)

    const wrong = await validatePolygon({ type: "point" } as any, modules)
    expect(wrong.valid).toBe(false)
    expect(wrong.error?.code).toBe("INVALID_GEOMETRY_TYPE")
  })

  test("validatePolygon uses geometryEngine.isSimple", async () => {
    const geometryEngine = {
      isSimple: jest.fn(() => false),
    }
    const Polygon = {
      fromJSON: jest.fn((json: any) => ({
        type: "polygon",
        spatialReference: json?.spatialReference ?? { isGeographic: true },
      })),
    }
    const modules = { geometryEngine, Polygon } as any

    const geometry = {
      type: "polygon",
      toJSON: () => ({ spatialReference: { isGeographic: true } }),
    } as any

    const result = await validatePolygon(geometry, modules)
    expect(result.valid).toBe(false)
    expect(result.error?.code).toBe("INVALID_GEOMETRY")
    expect(geometryEngine.isSimple).toHaveBeenCalled()
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

describe("FME connection validation", () => {
  let mockClient: jest.Mocked<any>

  beforeEach(() => {
    mockClient = {
      testConnection: jest.fn(),
      getRepositories: jest.fn(),
      validateRepository: jest.fn(),
    }
    // Ensure both the factory and the default class return our mock client
    const apiMod = require("../shared/api") as {
      default: jest.Mock
      createFmeFlowClient: jest.Mock
    }
    apiMod.default.mockImplementation(() => mockClient)
    apiMod.createFmeFlowClient.mockImplementation(() => mockClient)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test("validateConnection handles successful connection", async () => {
    const options: ConnectionValidationOptions = {
      serverUrl: "https://fmeflow.example.com",
      token: "test-token",
      repository: "test-repo",
    }

    mockClient.testConnection.mockResolvedValue({
      status: 200,
      data: { build: "2024.0" },
    })
    mockClient.getRepositories.mockResolvedValue({
      status: 200,
      data: [{ name: "test-repo" }, { name: "other-repo" }],
    })
    mockClient.validateRepository.mockResolvedValue({
      status: 200,
      data: { exists: true },
    })

    const result = await validateConnection(options)

    expect(result.success).toBe(true)
    expect(result.version).toBe("2024.0")
    expect(result.repositories).toEqual(["test-repo", "other-repo"])
    expect(result.steps.serverUrl).toBe("ok")
    expect(result.steps.token).toBe("ok")
    expect(result.steps.repository).toBe("ok")
  })

  test("validateConnection handles server connection error", async () => {
    const options: ConnectionValidationOptions = {
      serverUrl: "https://unreachable.example.com",
      token: "test-token",
      repository: "test-repo",
    }

    mockClient.testConnection.mockRejectedValue(new Error("Network error"))

    const result = await validateConnection(options)

    expect(result.success).toBe(false)
    expect(result.error?.type).toBe("server")
    expect(result.steps.serverUrl).toBe("fail")
  })

  test("validateConnection handles authentication error", async () => {
    const options: ConnectionValidationOptions = {
      serverUrl: "https://fmeflow.example.com",
      token: "invalid-token",
      repository: "test-repo",
    }

    mockClient.testConnection.mockRejectedValue({
      status: 401,
      message: "Unauthorized",
    })

    const result = await validateConnection(options)

    expect(result.success).toBe(false)
    expect(result.error?.type).toBe("token")
    expect(result.steps.serverUrl).toBe("ok")
    expect(result.steps.token).toBe("fail")
  })

  test("healthCheck treats 401 as reachable server (auth required)", async () => {
    mockClient.testConnection.mockRejectedValue({
      status: 401,
      message: "Unauthorized",
    })

    const result = await healthCheck("https://fmeflow.example.com", "token")
    expect(result.reachable).toBe(true)
    expect(result.status).toBe(401)
  })

  test("healthCheck treats network error as unreachable", async () => {
    mockClient.testConnection.mockRejectedValue(
      new TypeError("Failed to fetch")
    )

    const result = await healthCheck("https://fmeflow.example.com", "token")
    expect(result.reachable).toBe(false)
    expect(result.error).toMatch(/failed to fetch/i)
  })
})

describe("FME parameter form service", () => {
  let service: ParameterFormService

  beforeEach(() => {
    service = new ParameterFormService()
  })

  const createMockParameter = (
    overrides: Partial<WorkspaceParameter> = {}
  ): WorkspaceParameter => ({
    name: "testParam",
    type: ParameterType.TEXT,
    description: "Test parameter",
    optional: false,
    ...overrides,
  })

  test("validates required FME parameters are present", () => {
    const parameters = [
      createMockParameter({ name: "required1", optional: false }),
      createMockParameter({ name: "optional1", optional: true }),
    ]
    const values = { required1: "value1" }

    const result = service.validateParameters(values, parameters)
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test("reports missing required FME parameters", () => {
    const parameters = [
      createMockParameter({ name: "required1", optional: false }),
      createMockParameter({ name: "required2", optional: false }),
    ]
    const values = { required1: "value1" }

    const result = service.validateParameters(values, parameters)
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain("required2:required")
  })

  test("converts FME parameters to field configs correctly", () => {
    const parameters: WorkspaceParameter[] = [
      {
        name: "textParam",
        type: ParameterType.TEXT,
        description: "Text parameter",
        optional: false,
      },
      {
        name: "choiceParam",
        type: ParameterType.CHOICE,
        description: "Choice parameter",
        optional: true,
        listOptions: [
          { caption: "Option 1", value: "opt1" },
          { caption: "Option 2", value: "opt2" },
        ],
      },
    ]

    const fields = service.convertParametersToFields(parameters)

    expect(fields).toHaveLength(2)
    expect(fields[0]).toEqual(
      expect.objectContaining({
        name: "textParam",
        type: FormFieldType.TEXT,
        required: true,
        label: "Text parameter",
      })
    )
    expect(fields[1]).toEqual(
      expect.objectContaining({
        name: "choiceParam",
        type: FormFieldType.SELECT,
        required: false,
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
        ],
      })
    )
  })

  test("handles FME parameter type mapping", () => {
    const typeMapping = [
      {
        fmeType: ParameterType.INTEGER,
        expectedFieldType: FormFieldType.NUMBER,
      },
      {
        fmeType: ParameterType.FLOAT,
        expectedFieldType: FormFieldType.NUMERIC_INPUT,
      },
      {
        fmeType: ParameterType.BOOLEAN,
        expectedFieldType: FormFieldType.SWITCH,
      },
      {
        fmeType: ParameterType.PASSWORD,
        expectedFieldType: FormFieldType.PASSWORD,
      },
    ]

    typeMapping.forEach(({ fmeType, expectedFieldType }) => {
      const param = createMockParameter({ type: fmeType })
      const fields = service.convertParametersToFields([param])
      expect(fields[0].type).toBe(expectedFieldType)
    })
  })
})

describe("FME dynamic field components", () => {
  const renderWithProviders = widgetRender(true)

  beforeEach(() => {
    initStore()
  })

  const createFmeField = (
    overrides: Partial<DynamicFieldConfig> = {}
  ): DynamicFieldConfig => ({
    name: "fmeParam",
    label: "FME Parameter",
    type: FormFieldType.TEXT,
    required: false,
    readOnly: false,
    ...overrides,
  })

  test("renders FME TEXT parameter field correctly", () => {
    const field = createFmeField({
      type: FormFieldType.TEXT,
      placeholder: "Enter text value",
    })
    const onChange = jest.fn()

    renderWithProviders(
      <DynamicField
        field={field}
        value=""
        onChange={onChange}
        translate={(key: string) => key}
      />
    )

    const input = screen.getByRole("textbox")
    expect(input).toHaveAttribute("placeholder", "Enter text value")

    fireEvent.change(input, { target: { value: "test-value" } })
    expect(onChange).toHaveBeenCalledWith("test-value")
  })

  test("renders FME SELECT parameter field with options", () => {
    const field = createFmeField({
      type: FormFieldType.SELECT,
      options: [
        { label: "Option 1", value: "opt1" },
        { label: "Option 2", value: "opt2" },
      ],
    })
    const onChange = jest.fn()

    renderWithProviders(
      <DynamicField
        field={field}
        value="opt1"
        onChange={onChange}
        translate={(key: string) => key}
      />
    )

    const select = screen.getByRole("combobox")
    expect(select).toBeInTheDocument()
    // The selected option should be visible
    expect(screen.getByText("Option 1")).toBeInTheDocument()
  })

  test("renders FME NUMBER parameter field with validation", () => {
    const field = createFmeField({
      type: FormFieldType.NUMBER,
      required: true,
    })
    const onChange = jest.fn()

    renderWithProviders(
      <DynamicField
        field={field}
        value=""
        onChange={onChange}
        translate={(key: string) => key}
      />
    )

    const input = screen.getByRole("textbox") // Number inputs are rendered as text for better validation

    fireEvent.change(input, { target: { value: "42" } })
    expect(onChange).toHaveBeenCalledWith(42)
  })

  test("renders FME CHECKBOX parameter field", () => {
    const field = createFmeField({
      type: FormFieldType.CHECKBOX,
      label: "Enable feature",
    })
    const onChange = jest.fn()

    renderWithProviders(
      <DynamicField
        field={field}
        value={false}
        onChange={onChange}
        translate={(key: string) => key}
      />
    )

    const checkbox = screen.getByRole("checkbox")
    expect(checkbox).not.toBeChecked()

    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe("FME translations coverage", () => {
  test("runtime translations contain expected keys", () => {
    const keys = [
      "drawingModePolygon",
      "drawingModeRectangle",
      "tooltipSubmitOrder",
      "remoteDatasetUrlLabel",
      "remoteDatasetUrlHelper",
      "remoteDatasetUploadLabel",
    ]
    for (const k of keys) {
      expect(runtimeMsgs[k as keyof typeof runtimeMsgs]).toBeTruthy()
    }
  })

  test("setting translations contain expected keys", () => {
    const keys = [
      "fmeServerUrl",
      "fmeServerToken",
      "fmeRepository",
      "testConnection",
      "allowRemoteDatasetLabel",
      "allowRemoteUrlDatasetLabel",
      "allowRemoteUrlDatasetHelper",
      "uploadTargetParamNameLabel",
    ]
    for (const k of keys) {
      expect(settingMsgs[k as keyof typeof settingMsgs]).toBeTruthy()
    }
  })
})
