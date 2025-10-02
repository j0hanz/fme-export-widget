import { initGlobal } from "jimu-for-test"
import {
  determineServiceMode,
  attachAoi,
  applyDirectiveDefaults,
  prepFmeParams,
} from "../shared/utils"
import {
  sanitizeFormValues,
  isValidExternalUrlForOptGetUrl,
  processFmeResponse,
} from "../shared/validations"
import { ParameterFormService } from "../shared/services"
import {
  ParameterType,
  FormFieldType,
  type WorkspaceParameter,
  type FmeExportConfig,
} from "../config"

beforeAll(() => {
  initGlobal()
})

const buildConfig = (
  overrides: Partial<FmeExportConfig> = {}
): FmeExportConfig => ({
  fmeServerUrl: "https://example.com",
  fmeServerToken: "token-1234567890",
  repository: "demo-repo",
  ...overrides,
})

const makePolygon = () => ({
  rings: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ],
  ],
  spatialReference: { wkid: 4326 },
})

describe("determineServiceMode", () => {
  it("prefers schedule when allowed and start value present", () => {
    const mode = determineServiceMode(
      { data: { start: " 2025-10-02 08:00:00 " } },
      buildConfig({ allowScheduleMode: true })
    )
    expect(mode).toBe("schedule")
  })

  it("honors explicit override to sync", () => {
    const mode = determineServiceMode(
      { data: { _serviceMode: "sync" } },
      buildConfig({ syncMode: false })
    )
    expect(mode).toBe("sync")
  })

  it("falls back to config sync mode when no override", () => {
    const mode = determineServiceMode(
      { data: {} },
      buildConfig({ syncMode: true })
    )
    expect(mode).toBe("sync")
  })

  it("defaults to async when schedule disallowed", () => {
    const mode = determineServiceMode({ data: { start: "now" } }, buildConfig())
    expect(mode).toBe("async")
  })
})

describe("attachAoi", () => {
  it("returns base object untouched when no geometry is supplied", () => {
    const base = { existing: true }
    const result = attachAoi(base, null, undefined, null, undefined, [])
    expect(result).toBe(base)
    expect(result).toEqual({ existing: true })
  })

  it("serializes geometry, clones to extra names, and emits derived outputs", () => {
    const base = { field: "value" }
    const geometryJson = makePolygon()
    const config = buildConfig({
      aoiParamName: "CustomAOI",
      aoiGeoJsonParamName: "aoi_geojson",
      aoiWktParamName: "aoi_wkt",
    })
    const result = attachAoi(base, geometryJson, undefined, null, config, [
      "SecondaryAOI",
    ])

    expect(result).not.toBe(base)
    expect(result.field).toBe("value")
    expect(result.CustomAOI).toBeDefined()

    const parsed = JSON.parse(result.CustomAOI as string)
    expect(parsed.rings[0][0]).toEqual([0, 0])
    expect(result.SecondaryAOI).toBe(result.CustomAOI)
    expect(result).toHaveProperty("aoi_geojson")
    expect(result).toHaveProperty("aoi_wkt")
    expect(typeof result.aoi_wkt).toBe("string")
    expect(result.aoi_wkt).toMatch(/^POLYGON/)
  })

  it("signals serialization failure when JSON encoding throws", () => {
    const problematic = {
      ...makePolygon(),
      toJSON() {
        throw new Error("boom")
      },
    }

    const result = attachAoi({}, problematic, undefined, null, undefined, [])
    expect(result.__aoi_error__).toBeDefined()
    const aoiError = result.__aoi_error__ as { code?: string }
    expect(aoiError?.code).toBe("GEOMETRY_SERIALIZATION_FAILED")
  })
})

describe("applyDirectiveDefaults", () => {
  it("applies numeric and text defaults without overwriting existing values", () => {
    const config = buildConfig({
      tm_ttc: "300",
      tm_ttl: 900,
      tm_tag: " fast-mode ",
      tm_description: "A long description".repeat(60),
    })

    const base = {
      tm_ttl: 120,
      tm_tag: "explicit",
    }

    const result = applyDirectiveDefaults(base, config)
    expect(result.tm_ttc).toBe(300)
    expect(result.tm_ttl).toBe(120)
    expect(result.tm_tag).toBe("explicit")
    expect((result.tm_description as string).length).toBeLessThanOrEqual(512)
  })
})

describe("prepFmeParams", () => {
  it("builds full payload including schedule metadata, directives, and AOI cloning", () => {
    const config = buildConfig({
      allowScheduleMode: true,
      tm_ttc: "400",
      tm_description: " Schedule job ",
      aoiParamName: "CustomAOI",
      aoiGeoJsonParamName: "aoi_geojson",
      aoiWktParamName: "aoi_wkt",
    })

    const workspaceParameters: WorkspaceParameter[] = [
      {
        name: "SecondaryAOI",
        type: ParameterType.GEOMETRY,
        optional: true,
      },
    ]

    const rawFormData = {
      data: {
        start: " 2025-10-02 08:00:00 ",
        trigger: " ",
        name: "  Run name  ",
        category: "  Category  ",
        tm_tag: "manual",
        description: " kept ",
        fme_existing: "form",
      },
    }

    const result = prepFmeParams(
      rawFormData,
      "user@example.com",
      makePolygon(),
      undefined,
      null,
      {
        config,
        workspaceParameters,
      }
    )

    expect(result.opt_servicemode).toBe("schedule")
    expect(result.opt_responseformat).toBe("json")
    expect(result.opt_showresult).toBe("true")
    expect(result.opt_requesteremail).toBe("user@example.com")
    expect(result.start).toBe("2025-10-02 08:00:00")
    expect(result.trigger).toBe("runonce")
    expect(result.name).toBe("Run name")
    expect(result.category).toBe("Category")
    expect(result.tm_ttc).toBe(400)
    expect(result.tm_description).toBe("Schedule job")
    expect(result.tm_tag).toBe("manual")
    expect(result).toHaveProperty("CustomAOI")
    expect(result).toHaveProperty("SecondaryAOI")
    expect(result.SecondaryAOI).toBe(result.CustomAOI)
    expect(result).toHaveProperty("aoi_geojson")
    expect(result).toHaveProperty("aoi_wkt")
    expect(result.fme_existing).toBe("form")
  })
})

describe("ParameterFormService", () => {
  const service = new ParameterFormService()

  const parameters: WorkspaceParameter[] = [
    {
      name: "AreaOfInterest",
      type: ParameterType.GEOMETRY,
      optional: true,
    },
    {
      name: "tm_tag",
      type: ParameterType.TEXT,
      optional: true,
    },
    {
      name: "city",
      type: ParameterType.TEXT,
      description: "City",
      optional: false,
    },
    {
      name: "mode",
      type: ParameterType.CHOICE,
      optional: false,
      listOptions: [
        { caption: "Async", value: "async" },
        { caption: "Sync", value: "sync" },
      ],
    },
    {
      name: "layers",
      type: ParameterType.LISTBOX,
      optional: true,
      listOptions: [
        { caption: "Roads", value: "roads" },
        { caption: "Parcels", value: "parcels" },
      ],
    },
    {
      name: "range",
      type: ParameterType.RANGE_SLIDER,
      optional: true,
      minimum: 1,
      maximum: 5,
      decimalPrecision: 0,
    },
    {
      name: "message",
      type: ParameterType.MESSAGE,
      optional: true,
      description: "info",
    },
    {
      name: "document",
      type: ParameterType.TEXT_OR_FILE,
      optional: false,
    },
    {
      name: "height",
      type: ParameterType.INTEGER,
      optional: false,
    },
  ]

  it("converts parameters into dynamic field configs with expected metadata", () => {
    const fields = service.convertParametersToFields(parameters)
    const fieldNames = fields.map((f) => f.name)

    expect(fieldNames).toContain("city")
    expect(fieldNames).toContain("mode")
    expect(fieldNames).toContain("layers")
    expect(fieldNames).toContain("range")
    expect(fieldNames).toContain("message")
    expect(fieldNames).toContain("document")
    expect(fieldNames).toContain("height")
    expect(fieldNames).not.toContain("AreaOfInterest")
    expect(fieldNames).not.toContain("tm_tag")

    const modeField = fields.find((f) => f.name === "mode")
    const layersField = fields.find((f) => f.name === "layers")
    const rangeField = fields.find((f) => f.name === "range")
    const messageField = fields.find((f) => f.name === "message")
    const docField = fields.find((f) => f.name === "document")

    expect(modeField?.type).toBe(FormFieldType.RADIO)
    expect(modeField?.options).toHaveLength(2)
    expect(layersField?.type).toBe(FormFieldType.MULTI_SELECT)
    expect(rangeField?.type).toBe(FormFieldType.SLIDER)
    expect(rangeField?.min).toBe(1)
    expect(rangeField?.max).toBe(5)
    expect(rangeField?.step).toBe(1)
    expect(messageField?.readOnly).toBe(true)
    expect(docField?.type).toBe(FormFieldType.TEXT_OR_FILE)
  })

  it("validates parameter values and reports missing or invalid entries", () => {
    const validation = service.validateParameters(
      {
        mode: "unknown",
        layers: ["roads", "unknown"],
        height: "abc",
      },
      parameters
    )

    expect(validation.isValid).toBe(false)
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        "city:required",
        "mode:choice",
        "layers:choice",
        "height:integer",
      ])
    )
  })

  it("validates form values produced for dynamic fields", () => {
    const fields = service.convertParametersToFields(parameters)
    const { errors, isValid } = service.validateFormValues(
      {
        city: "",
        mode: "async",
        height: "abc",
        document: { mode: "text", text: "  " },
      },
      fields
    )

    expect(isValid).toBe(false)
    expect(errors).toHaveProperty("city")
    expect(errors).toHaveProperty("height")
    expect(errors).toHaveProperty("document")
  })
})

describe("sanitizeFormValues", () => {
  it("masks values for password parameters while leaving others intact", () => {
    const masked = sanitizeFormValues(
      { password: "secret123", other: "value" },
      [
        { name: "password", type: "PASSWORD" },
        { name: "ignored", type: "TEXT" },
      ]
    )

    expect(masked.password).toBe("****t123")
    expect(masked.other).toBe("value")
  })
})

describe("isValidExternalUrlForOptGetUrl", () => {
  it("accepts https URLs without credentials", () => {
    expect(isValidExternalUrlForOptGetUrl("https://example.com/data.zip")).toBe(
      true
    )
  })

  it("rejects non-https URLs", () => {
    expect(isValidExternalUrlForOptGetUrl("http://example.com")).toBe(false)
  })

  it("rejects URLs with embedded credentials", () => {
    expect(
      isValidExternalUrlForOptGetUrl("https://user:pass@example.com/data.zip")
    ).toBe(false)
  })
})

describe("processFmeResponse", () => {
  const translate = (key: string) =>
    ({
      noDataInResponse: "No data",
      fmeJobSubmissionFailed: "Failed",
    })[key] ?? key

  it("handles blob responses for streaming services", () => {
    const blob = new Blob(["test"], { type: "text/plain" })
    const result = processFmeResponse(
      { data: { blob } },
      "workspace1",
      "user@example.com",
      translate
    )
    expect(result.success).toBe(true)
    expect(result.downloadFilename).toBe("workspace1_export.zip")
    expect(result.blob).toBe(blob)
  })

  it("normalizes success responses with direct download URLs", () => {
    const response = {
      data: {
        serviceResponse: {
          statusInfo: { status: "success", message: "ok" },
          url: "https://example.com/download",
          jobID: 42,
        },
      },
    }

    const result = processFmeResponse(
      response,
      "workspace1",
      "user@example.com",
      translate
    )
    expect(result.success).toBe(true)
    expect(result.downloadUrl).toBe("https://example.com/download")
    expect(result.jobId).toBe(42)
  })

  it("falls back to failure state when service indicates error", () => {
    const response = {
      data: {
        serviceResponse: {
          statusInfo: { status: "FME_FAILURE", message: "Server error" },
        },
      },
    }

    const result = processFmeResponse(
      response,
      "workspace1",
      "user@example.com",
      translate
    )
    expect(result.success).toBe(false)
    expect(result.code).toBe("FME_JOB_FAILURE")
    expect(result.message).toBe("Server error")
  })

  it("handles completely missing data payloads", () => {
    const result = processFmeResponse(
      {},
      "workspace1",
      "user@example.com",
      translate
    )
    expect(result.success).toBe(false)
    expect(result.message).toBe("No data")
    expect(result.code).toBe("NO_DATA")
  })
})
