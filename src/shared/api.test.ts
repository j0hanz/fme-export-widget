// Modernized FME Flow API Client Tests
// Tests the modernized API that uses esri/request instead of fetch

import { FmeFlowApiClient, createFmeFlowClient } from "./api"
import {
  initExtensions,
  initStore,
  setTheme,
  mockTheme,
  waitForMilliseconds,
} from "jimu-for-test"
import type {
  FmeExportConfig,
  FmeFlowConfig,
  JobResponse,
  JobResult,
  WorkspaceParameter,
} from "./types"
import {
  FmeFlowApiError,
  JobStatus,
  ParameterType,
  ParameterModel,
} from "./types"
import esriRequest from "esri/request"
import esriConfig from "esri/config"

// Mock esri/request for all tests
jest.mock("esri/request", () => ({
  __esModule: true,
  default: jest.fn(),
}))

const mockEsriRequest = esriRequest as jest.MockedFunction<typeof esriRequest>

// Mock esri/config
jest.mock("esri/config", () => ({
  __esModule: true,
  default: {
    request: {
      interceptors: [],
      maxUrlLength: 2000,
      proxyUrl: undefined,
      proxyRules: [],
      trustedServers: [],
    },
  },
}))

const mockEsriConfig = esriConfig

// Mock geometry operators
jest.mock("esri/geometry/operators/geodeticAreaOperator", () => ({
  __esModule: true,
  default: {
    execute: jest.fn(),
    isLoaded: jest.fn(() => true),
    load: jest.fn(() => Promise.resolve()),
  },
}))

jest.mock("esri/geometry/support/webMercatorUtils", () => ({
  __esModule: true,
  default: {
    webMercatorToGeographic: jest.fn(),
    geographicToWebMercator: jest.fn(),
  },
}))

// Mock jimu-arcgis loadArcGISJSAPIModules
jest.mock("jimu-arcgis", () => ({
  __esModule: true,
  loadArcGISJSAPIModules: jest.fn(() => Promise.resolve({})),
}))

// TEST SETUP & CONFIGURATION
// Global test setup
beforeAll(() => {
  initExtensions()
  initStore()
  setTheme(mockTheme)
})

// MOCK HELPER FUNCTIONS
// Creates a mock esri/request response with success data
const mockEsriRequestSuccess = (data: any, status = 200, statusText = "OK") => {
  return Promise.resolve({
    data,
    status,
    statusText,
  })
}

// Creates a mock esri/request response with an error
const mockEsriRequestError = (
  status = 500,
  error = { error: { code: "ERROR_CODE", message: "Error message" } },
  statusText = "Server Error"
) => {
  const errorResponse = new Error(`Request failed with status ${status}`)
  ;(errorResponse as any).status = status
  ;(errorResponse as any).statusText = statusText
  ;(errorResponse as any).details = error
  return Promise.reject(errorResponse)
}

// Creates a network error mock
const mockNetworkError = (errorMessage = "Network failure") => {
  const error = new Error(errorMessage)
  ;(error as any).name = "NetworkError"
  return Promise.reject(error)
}

// Creates a timeout error mock
const mockTimeoutError = () => {
  const error = new DOMException("The operation was aborted", "AbortError")
  return Promise.reject(error)
}

// TEST FACTORY FUNCTIONS
// Creates a test configuration with default values
const createTestConfig = (
  overrides: Partial<FmeExportConfig> = {}
): FmeExportConfig => ({
  fmeServerUrl: "https://example.com",
  fmeServerToken: "mock-token",
  repository: "test-repo",
  ...overrides,
})

// Creates a test client instance with default configuration
const createTestClient = (config?: Partial<FmeFlowConfig>): FmeFlowApiClient =>
  new FmeFlowApiClient({
    serverUrl: "https://example.com",
    token: "mock-token",
    repository: "test-repo",
    ...config,
  })

// MAIN TEST SUITE
describe("FME Flow API Client - Modernized", () => {
  // Test suite setup
  beforeEach(() => {
    jest.resetAllMocks()
    mockEsriRequest.mockClear()
    // Reset esri/config interceptors
    mockEsriConfig.request.interceptors.length = 0
  })

  afterAll(async () => {
    await waitForMilliseconds(10)
  })

  // CLIENT CONFIGURATION TESTS
  describe("Client Configuration", () => {
    test("should create FmeFlowApiClient instance", () => {
      const config = createTestConfig()
      const client = createFmeFlowClient(config)
      expect(client).toBeInstanceOf(FmeFlowApiClient)
    })

    test("should configure esri/config interceptors on creation", () => {
      const config = createTestConfig()
      createFmeFlowClient(config)

      // Should have configured interceptors for token injection
      expect(mockEsriConfig.request.interceptors.length).toBeGreaterThan(0)
    })

    test("should handle legacy configuration properties", () => {
      const config = {
        fme_server_url: "https://example.com",
        fmw_server_token: "mock-token",
        repository: "test-repo",
      }

      const client = createFmeFlowClient(config as any)
      expect(client).toBeInstanceOf(FmeFlowApiClient)
    })

    test("should throw error with missing server URL", () => {
      const config = createTestConfig({ fmeServerUrl: "" })
      expect(() => createFmeFlowClient(config)).toThrow(
        "Missing required FME Flow configuration"
      )
    })
  })

  // CONNECTION & AUTHENTICATION TESTS
  describe("Connection Management", () => {
    describe("testConnection()", () => {
      test("should make request to /info endpoint using esri/request", async () => {
        const mockInfoResponse = { build: "123", version: "1.0" }
        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestSuccess(mockInfoResponse)
        )

        const client = createTestClient()
        const response = await client.testConnection()

        expect(mockEsriRequest).toHaveBeenCalledTimes(1)
        expect(mockEsriRequest).toHaveBeenCalledWith(
          "https://example.com/fmerest/v3/info",
          expect.objectContaining({
            method: "get",
            responseType: "json",
          })
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual(mockInfoResponse)
      })

      test("should handle server errors with modern error handling", async () => {
        const errorResponse = {
          error: {
            code: "SERVER_ERROR",
            message: "Internal server error",
          },
        }
        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestError(500, errorResponse)
        )

        const client = createTestClient()

        await expect(client.testConnection()).rejects.toThrow(
          "Internal server error"
        )
      })

      test("should handle network errors", async () => {
        mockEsriRequest.mockImplementationOnce(() =>
          mockNetworkError("Network connection failed")
        )

        const client = createTestClient()

        await expect(client.testConnection()).rejects.toThrow(
          "Network connection failed"
        )
      })

      test("should handle timeout with AbortSignal", async () => {
        mockEsriRequest.mockImplementationOnce(() => mockTimeoutError())
        const client = createTestClient()

        await expect(client.testConnection()).rejects.toThrow(
          "The operation was aborted"
        )
      })
    })
  })

  // REPOSITORY & WORKSPACE MANAGEMENT TESTS
  describe("Repository Operations", () => {
    describe("getRepositories()", () => {
      test("should return list of repositories with caching", async () => {
        const mockRepositories = [
          { name: "repo1" },
          { name: "repo2" },
          { name: "test-repo" },
        ]

        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestSuccess(mockRepositories)
        )

        const client = createTestClient()
        const response = await client.getRepositories()

        expect(mockEsriRequest).toHaveBeenCalledWith(
          "https://example.com/fmerest/v3/repositories",
          expect.objectContaining({
            method: "get",
            responseType: "json",
            cacheHint: true,
          })
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual(mockRepositories)
      })
    })

    describe("getRepositoryItems()", () => {
      test("should return workspace items with query parameters", async () => {
        const mockItems = {
          items: [
            {
              name: "workspace1",
              title: "Test Workspace",
              description: "Test",
              type: "WORKSPACE" as const,
              lastModified: "2023-01-01",
              services: ["job-submitter"],
              isRunnable: true,
              userName: "admin",
            },
          ],
          totalCount: 1,
          limit: 100,
          offset: 0,
        }

        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestSuccess(mockItems)
        )

        const client = createTestClient()
        const response = await client.getRepositoryItems()

        expect(mockEsriRequest).toHaveBeenCalledWith(
          "https://example.com/fmerest/v3/repositories/test-repo/items",
          expect.objectContaining({
            method: "get",
            responseType: "json",
            cacheHint: true,
          })
        )

        expect(response.status).toBe(200)
        expect(response.data.items.length).toBe(1)
        expect(response.data.items[0].name).toBe("workspace1")
      })
    })

    describe("getWorkspaceParameters()", () => {
      test("should return workspace parameters with caching", async () => {
        const mockParameters: WorkspaceParameter[] = [
          {
            name: "param1",
            description: "Parameter 1",
            type: ParameterType.TEXT,
            defaultValue: "default",
            model: ParameterModel.STRING,
            optional: true,
          },
        ]

        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestSuccess(mockParameters)
        )

        const client = createTestClient()
        const response =
          await client.getWorkspaceParameters("test-workspace.fmw")

        expect(mockEsriRequest).toHaveBeenCalledWith(
          "https://example.com/fmerest/v3/repositories/test-repo/items/test-workspace.fmw/parameters",
          expect.objectContaining({
            method: "get",
            responseType: "json",
            cacheHint: true,
          })
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual(mockParameters)
      })
    })
  })

  // JOB EXECUTION TESTS
  describe("Job Management", () => {
    describe("submitJob()", () => {
      test("should submit job using modern request patterns", async () => {
        const mockJobResponse: JobResponse = {
          id: 123,
          status: JobStatus.QUEUED,
          timeRequested: "2023-01-01T12:00:00Z",
          priority: 1,
          userName: "admin",
        }

        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestSuccess(mockJobResponse)
        )

        const client = createTestClient()
        const parameters = {
          param1: "value1",
          param2: "value2",
        }

        const response = await client.submitJob(
          "test-workspace.fmw",
          parameters
        )

        expect(mockEsriRequest).toHaveBeenCalledWith(
          "https://example.com/fmerest/v3/transformations/submit/test-repo/test-workspace.fmw",
          expect.objectContaining({
            method: "post",
            responseType: "json",
            cacheHint: false,
            query: expect.objectContaining({
              publishedParameters: expect.any(Array),
            }),
          })
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual(mockJobResponse)
        expect(response.data.id).toBe(123)
        expect(response.data.status).toBe(JobStatus.QUEUED)
      })
    })

    describe("getJobStatus()", () => {
      test("should retrieve job status", async () => {
        const mockJobResult: JobResult = {
          id: 789,
          status: JobStatus.RUNNING,
          statusMessage: "Job is running",
          timeRequested: "2023-01-01T12:00:00Z",
          timeStarted: "2023-01-01T12:00:01Z",
          numFeaturesOutput: 0,
          priority: 1,
        }

        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestSuccess(mockJobResult)
        )

        const client = createTestClient()
        const response = await client.getJobStatus(789)

        expect(mockEsriRequest).toHaveBeenCalledWith(
          "https://example.com/fmerest/v3/transformations/jobs/789",
          expect.objectContaining({
            method: "get",
            responseType: "json",
          })
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual(mockJobResult)
        expect(response.data.status).toBe(JobStatus.RUNNING)
      })
    })

    describe("cancelJob()", () => {
      test("should cancel running job", async () => {
        const mockResponse = { success: true }

        mockEsriRequest.mockImplementationOnce(() =>
          mockEsriRequestSuccess(mockResponse)
        )

        const client = createTestClient()
        const response = await client.cancelJob(123)

        expect(mockEsriRequest).toHaveBeenCalledWith(
          "https://example.com/fmerest/v3/transformations/jobs/123/cancel",
          expect.objectContaining({
            method: "post",
            responseType: "json",
          })
        )

        expect(response.status).toBe(200)
        expect(response.data.success).toBe(true)
      })
    })
  })

  // LEGACY DATA SERVICES TESTS
  describe("Legacy Data Services", () => {
    describe("runDataDownload()", () => {
      test("should make webhook request for data download", async () => {
        // Mock global fetch for webhook calls (not esri/request)
        const mockFetch = jest.fn()
        global.fetch = mockFetch

        const mockResponse = {
          serviceResponse: {
            statusInfo: {
              status: "success",
              mode: "async",
            },
            jobID: "12345",
            url: "https://example.com/download/result.zip",
          },
        }

        mockFetch.mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            headers: {
              get: () => "application/json",
            },
            json: () => Promise.resolve(mockResponse),
          } as unknown as Response)
        )

        const client = createTestClient()
        const parameters = {
          param1: "value1",
          format: "json",
        }

        const response = await client.runDataDownload(
          "test-workspace.fmw",
          parameters
        )

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining(
            "https://example.com/fmedatadownload/test-repo/test-workspace.fmw"
          ),
          expect.objectContaining({
            method: "GET",
            headers: expect.objectContaining({
              Authorization: expect.stringContaining("fmetoken token="),
            }),
          })
        )

        expect(response.status).toBe(200)
        expect(response.data).toEqual(mockResponse)
      })
    })
  })

  // ERROR HANDLING TESTS
  describe("Error Handling", () => {
    describe("FmeFlowApiError", () => {
      test("should provide structured error information", () => {
        const error401 = new FmeFlowApiError(
          "Unauthorized",
          "UNAUTHORIZED",
          401
        )
        expect(error401.status).toBe(401)
        expect(error401.code).toBe("UNAUTHORIZED")
        expect(error401.message).toBe("Unauthorized")

        const error500 = new FmeFlowApiError(
          "Server Error",
          "SERVER_ERROR",
          500
        )
        expect(error500.status).toBe(500)
        expect(error500.code).toBe("SERVER_ERROR")
      })
    })

    describe("Network Error Handling", () => {
      test("should handle AbortSignal cancellation", async () => {
        const abortController = new AbortController()
        mockEsriRequest.mockImplementationOnce(() => {
          return new Promise((_resolve, reject) => {
            abortController.signal.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted", "AbortError")
              )
            })
          })
        })

        const client = createTestClient()

        // Cancel the request immediately
        setTimeout(() => {
          abortController.abort()
        }, 10)

        await expect(
          client.testConnection(abortController.signal)
        ).rejects.toThrow("The operation was aborted")
      })
    })
  })

  // PERFORMANCE & CACHING TESTS
  describe("Performance Optimizations", () => {
    test("should use cacheHint for static data queries", async () => {
      const mockData = [{ name: "repo1" }]
      mockEsriRequest.mockImplementationOnce(() =>
        mockEsriRequestSuccess(mockData)
      )

      const client = createTestClient()
      await client.getRepositories()

      expect(mockEsriRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cacheHint: true,
        })
      )
    })

    test("should not use cacheHint for dynamic job submissions", async () => {
      const mockJobResponse = { id: 123, status: "QUEUED" }
      mockEsriRequest.mockImplementationOnce(() =>
        mockEsriRequestSuccess(mockJobResponse)
      )

      const client = createTestClient()
      await client.submitJob("workspace.fmw", { param: "value" })

      expect(mockEsriRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cacheHint: false,
        })
      )
    })
  })
})

// Basic integration test placeholder (disabled by default)
describe.skip("Integration Tests", () => {
  test("should connect to real FME server", async () => {
    // Integration tests would go here
    // Requires real FME server configuration
  })
})
