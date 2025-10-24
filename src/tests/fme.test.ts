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
  applyDirectiveDefaults,
  normalizeServiceModeConfig,
} from "../shared/utils"
import {
  ErrorType,
  FormFieldType,
  ParameterType,
  type DynamicFieldConfig,
  type VisibilityExpression,
  type VisibilityState,
  type WorkspaceParameter,
} from "../config/index"
import { VisibilityEvaluator } from "../shared/visibility"
import { processFmeResponse } from "../shared/utils/fme"

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

const makeBaseField = (
  name: string,
  visibility?: VisibilityExpression,
  visibilityState?: VisibilityState
): DynamicFieldConfig => ({
  name,
  label: name,
  type: FormFieldType.TEXT,
  required: false,
  readOnly: false,
  ...(visibility && { visibility }),
  ...(visibilityState && { visibilityState }),
})

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

  describe("normalizeServiceModeConfig", () => {
    it("coerces syncMode values to booleans", () => {
      const config = {
        fmeServerUrl: "https://flow.example.com",
        fmeServerToken: "token",
        repository: "Repo",
        syncMode: "1",
        tm_ttc: 30,
      } as any

      const normalized = normalizeServiceModeConfig(config)

      expect(normalized?.syncMode).toBe(true)
      expect(normalized?.tm_ttc).toBe(30)
    })

    it("returns original reference when no changes are needed", () => {
      const config = {
        fmeServerUrl: "https://flow.example.com",
        fmeServerToken: "token",
        repository: "Repo",
        syncMode: false,
      } as any

      const normalized = normalizeServiceModeConfig(config)

      expect(normalized).toBe(config)
    })
  })

  describe("applyDirectiveDefaults", () => {
    const baseConfig = {
      fmeServerUrl: "https://flow.example.com",
      fmeServerToken: "token",
      repository: "Repo",
      tm_ttc: 90,
      tm_ttl: 120,
    } as any

    it("excludes tm_ttc defaults when mode is async", () => {
      const params = applyDirectiveDefaults(
        { opt_servicemode: "async" },
        baseConfig
      )

      expect(params.tm_ttc).toBeUndefined()
      expect(params.tm_ttl).toBe(120)
    })

    it("applies tm_ttc defaults when mode is sync", () => {
      const params = applyDirectiveDefaults(
        { opt_servicemode: "sync" },
        baseConfig
      )

      expect(params.tm_ttc).toBe(90)
      expect(params.tm_ttl).toBe(120)
    })

    it("removes existing tm_ttc values for async mode", () => {
      const params = applyDirectiveDefaults(
        { opt_servicemode: "async", tm_ttc: 45 },
        baseConfig
      )

      expect(params.tm_ttc).toBeUndefined()
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
      expect(result.cancelled).toBe(true)
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
      expect(result.cancelled).toBe(true)
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

    it("returns numeric input when description says NO Slider", () => {
      const param: WorkspaceParameter = {
        name: "NUMBER",
        type: ParameterType.RANGE_SLIDER,
        description: "Enter seven NO Slider",
        optional: false,
        minimum: 6,
        maximum: 8,
        decimalPrecision: 0,
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.type).toBe(FormFieldType.NUMERIC_INPUT)
      expect(field.min).toBe(6)
      expect(field.max).toBe(8)
      expect(field.decimalPrecision).toBe(0)
    })

    it("returns slider UI when description mentions Slider", () => {
      const param: WorkspaceParameter = {
        name: "NUMBER_2",
        type: ParameterType.RANGE_SLIDER,
        description: "Enter greater then seven less then 12 Slider",
        optional: false,
        minimum: 1,
        maximum: 12,
        decimalPrecision: 0,
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.type).toBe(FormFieldType.SLIDER)
      expect(field.step).toBe(1)
      expect(field.decimalPrecision).toBe(0)
    })

    it("returns numeric input when control.useRangeSlider is false", () => {
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

    it("retains slider UI when control.useRangeSlider is true", () => {
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

    it("defaults to numeric input when no slider indicator present", () => {
      const param: WorkspaceParameter = {
        name: "DEFAULT_SLIDER",
        type: ParameterType.RANGE_SLIDER,
        optional: false,
        minimum: 0,
        maximum: 10,
        decimalPrecision: 0,
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.type).toBe(FormFieldType.SLIDER)
      expect(field.min).toBe(0)
      expect(field.max).toBe(10)
      expect(field.step).toBe(1)
    })

    it("validates integer precision (no decimals allowed)", () => {
      const param: WorkspaceParameter = {
        name: "INT_PARAM",
        type: ParameterType.RANGE_SLIDER,
        optional: false,
        minimum: 1,
        maximum: 10,
        decimalPrecision: 0,
        control: { useRangeSlider: false },
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.type).toBe(FormFieldType.NUMERIC_INPUT)
      expect(field.decimalPrecision).toBe(0)

      // Validerar att decimalvärden avvisas
      const validation = service.validateFormValues({ INT_PARAM: 7.5 }, [field])
      expect(validation.isValid).toBe(false)
      expect(validation.errors.INT_PARAM).toBeDefined()
    })

    it("validates float precision (decimals allowed)", () => {
      const param: WorkspaceParameter = {
        name: "FLOAT_PARAM",
        type: ParameterType.RANGE_SLIDER,
        optional: false,
        minimum: 0,
        maximum: 100,
        decimalPrecision: 2,
        control: { useRangeSlider: false },
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.type).toBe(FormFieldType.NUMERIC_INPUT)
      expect(field.decimalPrecision).toBe(2)

      // Validerar att decimalvärden accepteras
      const validation1 = service.validateFormValues({ FLOAT_PARAM: 75.25 }, [
        field,
      ])
      expect(validation1.isValid).toBe(true)

      // Validerar att heltalsvärden också accepteras
      const validation2 = service.validateFormValues({ FLOAT_PARAM: 75 }, [
        field,
      ])
      expect(validation2.isValid).toBe(true)
    })

    it("validates min/max exclusive boundaries", () => {
      const param: WorkspaceParameter = {
        name: "EXCLUSIVE_PARAM",
        type: ParameterType.RANGE_SLIDER,
        optional: false,
        minimum: 5,
        maximum: 10,
        minimumExclusive: true,
        maximumExclusive: true,
        decimalPrecision: 0,
        control: { useRangeSlider: false },
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.minExclusive).toBe(true)
      expect(field.maxExclusive).toBe(true)

      // Value equal to min should fail (exclusive)
      const validation1 = service.validateFormValues({ EXCLUSIVE_PARAM: 5 }, [
        field,
      ])
      expect(validation1.isValid).toBe(false)

      // Value equal to max should fail (exclusive)
      const validation2 = service.validateFormValues({ EXCLUSIVE_PARAM: 10 }, [
        field,
      ])
      expect(validation2.isValid).toBe(false)

      // Value within exclusive range should pass
      const validation3 = service.validateFormValues({ EXCLUSIVE_PARAM: 7 }, [
        field,
      ])
      expect(validation3.isValid).toBe(true)
    })

    it("validates min/max inclusive boundaries", () => {
      const param: WorkspaceParameter = {
        name: "INCLUSIVE_PARAM",
        type: ParameterType.RANGE_SLIDER,
        optional: false,
        minimum: 5,
        maximum: 10,
        minimumExclusive: false,
        maximumExclusive: false,
        decimalPrecision: 0,
        control: { useRangeSlider: false },
      }

      const [field] = service.convertParametersToFields([param])

      expect(field.minExclusive).toBe(false)
      expect(field.maxExclusive).toBe(false)

      // Value equal to min should pass (inclusive)
      const validation1 = service.validateFormValues({ INCLUSIVE_PARAM: 5 }, [
        field,
      ])
      expect(validation1.isValid).toBe(true)

      // Value equal to max should pass (inclusive)
      const validation2 = service.validateFormValues({ INCLUSIVE_PARAM: 10 }, [
        field,
      ])
      expect(validation2.isValid).toBe(true)

      // Value outside range should fail
      const validation3 = service.validateFormValues({ INCLUSIVE_PARAM: 11 }, [
        field,
      ])
      expect(validation3.isValid).toBe(false)
    })
  })

  describe("ParameterFormService - dynamic visibility", () => {
    const service = new ParameterFormService()

    it("extracts visibility expressions from parameter metadata", () => {
      const params: WorkspaceParameter[] = [
        {
          name: "MODE",
          type: ParameterType.CHOICE,
          optional: false,
          description: "Mode selector",
          listOptions: [
            { caption: "Advanced", value: "advanced" },
            { caption: "Basic", value: "basic" },
          ],
        },
        {
          name: "OUTPUT_PATH",
          type: ParameterType.TEXT,
          optional: false,
          description: "Output path",
          metadata: {
            visibility: {
              if: [
                {
                  then: "visible_enabled",
                  $equals: { parameter: "MODE", value: "advanced" },
                },
                {
                  then: "visible_disabled",
                  $equals: { parameter: "MODE", value: "basic" },
                },
              ],
              default: { value: "hidden_disabled" },
            },
          },
        },
      ]

      const fields = service.convertParametersToFields(params)
      const outputField = fields.find((field) => field.name === "OUTPUT_PATH")

      expect(outputField?.visibility).toEqual({
        if: [
          {
            then: "visibleEnabled",
            $equals: { parameter: "MODE", value: "advanced" },
          },
          {
            then: "visibleDisabled",
            $equals: { parameter: "MODE", value: "basic" },
          },
        ],
        default: { value: "hiddenDisabled", override: false },
      })
    })

    it("skips validation for required fields that are not visibleEnabled", () => {
      const fields: DynamicFieldConfig[] = [
        {
          name: "VISIBLE",
          label: "Visible",
          type: FormFieldType.TEXT,
          required: true,
          readOnly: false,
          visibilityState: "visibleEnabled",
        },
        {
          name: "HIDDEN",
          label: "Hidden",
          type: FormFieldType.TEXT,
          required: true,
          readOnly: false,
          visibilityState: "hiddenDisabled",
        },
        {
          name: "DISABLED",
          label: "Disabled",
          type: FormFieldType.TEXT,
          required: true,
          readOnly: false,
          visibilityState: "visibleDisabled",
        },
        {
          name: "HIDDEN_ENABLED",
          label: "Hidden enabled",
          type: FormFieldType.TEXT,
          required: true,
          readOnly: false,
          visibilityState: "hiddenEnabled",
        },
      ]

      const result = service.validateFormValues({ VISIBLE: "ok" }, fields)

      expect(result.isValid).toBe(true)
      expect(result.errors.VISIBLE).toBeUndefined()
      expect(result.errors.HIDDEN).toBeUndefined()
      expect(result.errors.DISABLED).toBeUndefined()
      expect(result.errors.HIDDEN_ENABLED).toBeUndefined()
    })

    it("enforces validation when field remains visibleEnabled", () => {
      const fields: DynamicFieldConfig[] = [
        {
          name: "VISIBLE",
          label: "Visible",
          type: FormFieldType.TEXT,
          required: true,
          readOnly: false,
          visibilityState: "visibleEnabled",
        },
      ]

      const result = service.validateFormValues({}, fields)

      expect(result.isValid).toBe(false)
      expect(result.errors.VISIBLE).toBeDefined()
    })
  })

  describe("VisibilityEvaluator", () => {
    const makeVisibilityExpression = (
      condition: VisibilityExpression["if"][number],
      defaultState: VisibilityState = "hiddenDisabled"
    ): VisibilityExpression => ({
      if: [condition],
      default: { value: defaultState, override: false },
    })

    it("evaluates chained visibility and updates dependent states", () => {
      const fields: DynamicFieldConfig[] = [
        {
          name: "MODE",
          label: "Mode",
          type: FormFieldType.TEXT,
          required: false,
          readOnly: false,
        },
        {
          name: "DEPENDENT",
          label: "Dependent",
          type: FormFieldType.TEXT,
          required: false,
          readOnly: false,
          visibility: makeVisibilityExpression({
            then: "visibleEnabled",
            $equals: { parameter: "MODE", value: "advanced" },
          }),
        },
        {
          name: "CHILD",
          label: "Child",
          type: FormFieldType.TEXT,
          required: false,
          readOnly: false,
          visibility: makeVisibilityExpression({
            then: "visibleEnabled",
            $isEnabled: { parameter: "DEPENDENT" },
          }),
        },
      ]

      const evaluator = new VisibilityEvaluator({ MODE: "advanced" }, fields)

      const dependentState = evaluator.evaluate(
        fields[1].visibility,
        fields[1].name
      )
      const childState = evaluator.evaluate(
        fields[2].visibility,
        fields[2].name
      )

      expect(dependentState).toBe("visibleEnabled")
      expect(childState).toBe("visibleEnabled")
    })

    it("honours prior visibility states for $isEnabled comparisons", () => {
      const dependentVisibility = makeVisibilityExpression({
        then: "visibleEnabled",
        $isEnabled: { parameter: "TRIGGER" },
      })

      const enabledTrigger = makeBaseField(
        "TRIGGER",
        undefined,
        "visibleEnabled"
      )
      const disabledTrigger = makeBaseField(
        "TRIGGER",
        undefined,
        "hiddenDisabled"
      )

      const dependentField = makeBaseField("DEPENDENT", dependentVisibility)

      const enabledEvaluator = new VisibilityEvaluator({}, [
        enabledTrigger,
        dependentField,
      ])
      const disabledEvaluator = new VisibilityEvaluator({}, [
        disabledTrigger,
        dependentField,
      ])

      expect(enabledEvaluator.evaluate(dependentVisibility, "DEPENDENT")).toBe(
        "visibleEnabled"
      )
      expect(disabledEvaluator.evaluate(dependentVisibility, "DEPENDENT")).toBe(
        "hiddenDisabled"
      )
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
