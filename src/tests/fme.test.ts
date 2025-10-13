import "@testing-library/jest-dom"
import { initGlobal } from "jimu-for-test"
import { validateWidgetStartup } from "../shared/services"
import {
  createFmeFlowClient,
  instrumentedRequest,
  resetEsriCache,
} from "../shared/api"
import { sanitizeOptGetUrlParam } from "../shared/validations"
import { ErrorType } from "../config/index"

initGlobal()

const globalAny = globalThis as any
globalAny.esriRequest = jest.fn().mockResolvedValue({ data: null })
globalAny.esriConfig = {
  request: { maxUrlLength: 4000, interceptors: [] },
}
globalAny.projection = { load: jest.fn().mockResolvedValue(undefined) }
globalAny.webMercatorUtils = {}
globalAny.SpatialReference = function SpatialReference(props: any) {
  return props
}

describe("FME shared logic", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetEsriCache()
  })

  describe("validateWidgetStartup", () => {
    const translate = (key: string) => key

    it("fails fast when config is missing", async () => {
      const result = await validateWidgetStartup({
        config: undefined,
        translate,
        signal: undefined,
        mapConfigured: true,
      })

      expect(result.isValid).toBe(false)
      expect(result.requiresSettings).toBe(true)
      expect(result.error?.type).toBe(ErrorType.CONFIG)
    })

    it("surfaces configuration gaps before probing the server", async () => {
      const result = await validateWidgetStartup({
        config: {
          fmeServerUrl: "",
          fmeServerToken: "",
          repository: "",
        } as any,
        translate,
        signal: undefined,
        mapConfigured: true,
      })

      expect(result.isValid).toBe(false)
      expect(result.requiresSettings).toBe(true)
    })
  })

  describe("createFmeFlowClient", () => {
    it("normalises config and strips trailing slashes", () => {
      const client = createFmeFlowClient({
        fmeServerUrl: "https://flow.server.com/",
        fmeServerToken: "secret-token",
        repository: "CityData",
        requestTimeout: 15,
      } as any)

      expect(typeof client.testConnection).toBe("function")
      // Accessing private field via cast for assertion only
      const config = (client as any).config
      expect(config.serverUrl).toBe("https://flow.server.com")
      expect(config.repository).toBe("CityData")
    })

    it("throws when required properties are missing", () => {
      expect(() =>
        createFmeFlowClient({
          fmeServerUrl: "https://flow.server.com",
          fmeServerToken: "",
          repository: "",
        } as any)
      ).toThrow("INVALID_CONFIG")
    })
  })

  describe("sanitizeOptGetUrlParam", () => {
    it("removes unsafe dataset urls when remote datasets are disabled", () => {
      const params = { opt_geturl: "  https://example.com/data.csv  " }

      sanitizeOptGetUrlParam(params, { allowRemoteDataset: false } as any)

      expect(params.opt_geturl).toBeUndefined()
    })

    it("preserves dataset url when explicitly allowed", () => {
      const params = { opt_geturl: "https://example.com/data.zip" }

      sanitizeOptGetUrlParam(params, {
        allowRemoteDataset: true,
        allowRemoteUrlDataset: true,
        uploadTargetParamName: "target",
      } as any)

      expect(params.opt_geturl).toBe("https://example.com/data.zip")
    })
  })

  describe("instrumentedRequest", () => {
    const originalLog = console.log

    beforeAll(() => {
      console.log = jest.fn()
    })

    afterAll(() => {
      console.log = originalLog
    })

    it("records successful executions", async () => {
      const execute = jest.fn().mockResolvedValue({ data: "ok" })

      const response = await instrumentedRequest({
        method: "GET",
        url: "https://example.com/api",
        transport: "fetch",
        execute,
        responseInterpreter: {
          status: () => 200,
          ok: () => true,
          size: () => 512,
        },
      })

      expect(response).toEqual({ data: "ok" })
      expect(execute).toHaveBeenCalledTimes(1)
    })

    it("propagates errors with sanitized metadata", async () => {
      const error = Object.assign(new Error("boom"), { status: 503 })
      const execute = jest.fn().mockRejectedValue(error)

      await expect(
        instrumentedRequest({
          method: "POST",
          url: "https://example.com/api",
          transport: "fetch",
          body: { token: "secret" },
          execute,
          responseInterpreter: {
            status: () => 503,
            ok: () => false,
            size: () => undefined,
          },
        })
      ).rejects.toThrow("boom")

      expect(execute).toHaveBeenCalledTimes(1)
    })
  })
})
