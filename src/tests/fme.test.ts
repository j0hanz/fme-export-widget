import "@testing-library/jest-dom"
import { initGlobal } from "jimu-for-test"
import { ParameterFormService, validateWidgetStartup } from "../shared/services"
import {
  createFmeFlowClient,
  instrumentedRequest,
  resetEsriCache,
} from "../shared/api"
import {
  applyUploadedDatasetParam,
  sanitizeOptGetUrlParam,
} from "../shared/utils"
import {
  ErrorType,
  FormFieldType,
  ParameterType,
  type WorkspaceParameter,
} from "../config/index"
import { processFmeResponse } from "../shared/validations"

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

    it("removes dataset url when URL uploads are disabled", () => {
      const params = { opt_geturl: "https://example.com/data.geojson" }

      sanitizeOptGetUrlParam(params, {
        allowRemoteDataset: true,
        allowRemoteUrlDataset: false,
      } as any)

      expect(params.opt_geturl).toBeUndefined()
    })
  })

  describe("applyUploadedDatasetParam", () => {
    it("applies uploaded path to explicit target parameter", () => {
      const params: { [key: string]: unknown } = {}

      applyUploadedDatasetParam({
        finalParams: params,
        uploadedPath: "/tmp/data/sample.zip",
        parameters: [],
        explicitTarget: "DEST_DATASET",
      })

      expect(params.DEST_DATASET).toBe("/tmp/data/sample.zip")
    })
  })

  describe("processFmeResponse", () => {
    const translate = (key: string): string => {
      const map: { [key: string]: string } = {
        jobCancelled: "Jobbet avbröts",
        jobCancelledTimeout: "Jobbet avbröts på grund av tidsgräns",
        jobFailed: "Jobbet misslyckades",
        errorJobSubmission: "Beställningen misslyckades",
        noDataInResponse: "Ingen data",
      }
      return map[key] ?? key
    }

    it("marks timeout cancellations with dedicated messaging", () => {
      const response = {
        data: {
          serviceResponse: {
            status: "CANCELLED",
            message: "Job cancelled after max execution time",
            jobID: 501,
          },
        },
      }

      const result = processFmeResponse(
        response,
        "Workspace",
        "user@example.com",
        translate
      )

      expect(result.success).toBe(false)
      expect(result.code).toBe("FME_JOB_CANCELLED_TIMEOUT")
      expect(result.message).toBe("Jobbet avbröts på grund av tidsgräns")
      expect(result.jobId).toBe(501)
      expect(result.status).toBe("CANCELLED")
    })

    it("maps generic cancellations to cancelled message", () => {
      const response = {
        data: {
          serviceResponse: {
            status: "CANCELLED",
            message: "Job cancelled by user",
            jobID: 777,
          },
        },
      }

      const result = processFmeResponse(
        response,
        "Workspace",
        "user@example.com",
        translate
      )

      expect(result.code).toBe("FME_JOB_CANCELLED")
      expect(result.message).toBe("Jobbet avbröts")
      expect(result.jobId).toBe(777)
    })

    it("falls back to failure messaging when status indicates failure", () => {
      const response = {
        data: {
          serviceResponse: {
            status: "FAILURE",
            message: "",
            jobID: 900,
          },
        },
      }

      const result = processFmeResponse(
        response,
        "Workspace",
        "user@example.com",
        translate
      )

      expect(result.code).toBe("FME_JOB_FAILURE")
      expect(result.message).toBe("Jobbet misslyckades")
      expect(result.status).toBe("FAILURE")
    })
  })

  describe("ParameterFormService - range slider rendering", () => {
    const service = new ParameterFormService()

    it("returns numeric input when slider UI is disabled", () => {
      const param: WorkspaceParameter = {
        name: "NUMBER",
        type: ParameterType.RANGE_SLIDER,
        optional: false,
        minimum: 6,
        maximum: 8,
        decimalPrecision: 0,
        control: { useRangeSlider: false },
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.type).toBe(FormFieldType.NUMERIC_INPUT)
      expect(field.min).toBe(6)
      expect(field.max).toBe(8)
      expect(field.decimalPrecision).toBe(0)
    })

    it("retains slider UI when metadata prefers slider", () => {
      const param: WorkspaceParameter = {
        name: "NUMBER",
        type: ParameterType.RANGE_SLIDER,
        optional: false,
        minimum: 1,
        maximum: 5,
        decimalPrecision: 2,
        control: { useRangeSlider: true },
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.type).toBe(FormFieldType.SLIDER)
      expect(field.step).toBeCloseTo(0.01)
      expect(field.decimalPrecision).toBe(2)
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
