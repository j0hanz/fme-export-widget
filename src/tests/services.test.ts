import { ErrorHandlingService, ParameterFormService } from "../shared/services"
import {
  ErrorSeverity,
  ErrorType,
  FormFieldType,
  type DynamicFieldConfig,
  ParameterType,
  type WorkspaceParameter,
} from "../shared/types"

describe("ErrorHandlingService", () => {
  test("createError uses sensible defaults and preserves options", () => {
    const svc = new ErrorHandlingService()
    const retry = jest.fn()
    const err = svc.createError("Oops")
    expect(err.message).toBe("Oops")
    expect(err.type).toBe(ErrorType.VALIDATION)
    expect(err.code).toBe("UNKNOWN_ERROR")
    expect(err.severity).toBe(ErrorSeverity.ERROR)
    expect(typeof err.timestamp.getTime()).toBe("number")

    const custom = svc.createError("Bad", ErrorType.API, {
      code: "X123",
      severity: ErrorSeverity.WARNING,
      details: { a: 1 },
      recoverable: true,
      retry,
    })
    expect(custom.message).toBe("Bad")
    expect(custom.type).toBe(ErrorType.API)
    expect(custom.code).toBe("X123")
    expect(custom.severity).toBe(ErrorSeverity.WARNING)
    expect(custom.details).toEqual({ a: 1 })
    expect(custom.recoverable).toBe(true)
    expect(custom.retry).toBe(retry)
  })
})

describe("ParameterFormService.convertParametersToFields", () => {
  const svc = new ParameterFormService()

  test("skips internal parameters and maps field types correctly", () => {
    const params: readonly WorkspaceParameter[] = [
      {
        name: "MAXX",
        type: ParameterType.INTEGER,
        model: "MODEL",
        description: "skipped",
      },
      {
        name: "AreaOfInterest",
        type: ParameterType.GEOMETRY,
        model: "MODEL",
        description: "skipped",
      },
      {
        name: "Title",
        type: ParameterType.TEXT,
        model: "MODEL",
        description: "A title",
      },
      {
        name: "Notes",
        type: ParameterType.TEXT_EDIT,
        model: "MODEL",
        description: "Notes",
      },
      {
        name: "Count",
        type: ParameterType.INTEGER,
        model: "MODEL",
        description: "Count",
      },
      {
        name: "Secret",
        type: ParameterType.PASSWORD,
        model: "MODEL",
        description: "Password",
      },
      {
        name: "Agree",
        type: ParameterType.BOOLEAN,
        model: "MODEL",
        description: "Checkbox",
      },
      {
        name: "Upload",
        type: ParameterType.FILENAME,
        model: "MODEL",
        description: "File",
      },
      {
        name: "Choice",
        type: ParameterType.CHOICE,
        model: "MODEL",
        description: "Select",
        listOptions: [{ caption: "A", value: "a" }],
      },
      {
        name: "Multi",
        type: ParameterType.LISTBOX,
        model: "MODEL",
        description: "Multi-select",
        listOptions: [{ caption: "One", value: "1" }],
      },
    ] as const

    const fields = svc.convertParametersToFields(params)
    const fieldMap = new Map(fields.map((f) => [f.name, f]))

    // Verify skipped parameters
    expect(fieldMap.has("MAXX")).toBe(false)
    expect(fieldMap.has("AreaOfInterest")).toBe(false)

    // Verify field type mappings
    expect(fieldMap.get("Title")?.type).toBe(FormFieldType.TEXT)
    expect(fieldMap.get("Notes")?.type).toBe(FormFieldType.TEXTAREA)
    expect(fieldMap.get("Notes")?.rows).toBeGreaterThan(0)
    expect(fieldMap.get("Count")?.type).toBe(FormFieldType.NUMBER)
    expect(fieldMap.get("Secret")?.type).toBe(FormFieldType.PASSWORD)
    expect(fieldMap.get("Agree")?.type).toBe(FormFieldType.CHECKBOX)
    expect(fieldMap.get("Upload")?.type).toBe(FormFieldType.FILE)
    expect(fieldMap.get("Choice")?.type).toBe(FormFieldType.SELECT)
    expect(fieldMap.get("Multi")?.type).toBe(FormFieldType.MULTI_SELECT)
  })

  test("handles lookup parameter types", () => {
    const params: readonly WorkspaceParameter[] = [
      {
        name: "LookupSingle",
        type: ParameterType.LOOKUP_CHOICE,
        model: "MODEL",
        description: "Single lookup",
        listOptions: [{ caption: "First", value: "1" }],
      },
      {
        name: "LookupMulti",
        type: ParameterType.LOOKUP_LISTBOX,
        model: "MODEL",
        description: "Multi lookup",
        listOptions: [{ caption: "A", value: "a" }],
      },
    ] as const

    const fields = svc.convertParametersToFields(params)
    const fieldMap = new Map(fields.map((f) => [f.name, f]))

    expect(fieldMap.get("LookupSingle")?.type).toBe(FormFieldType.SELECT)
    expect(fieldMap.get("LookupMulti")?.type).toBe(FormFieldType.MULTI_SELECT)
  })
})

describe("ParameterFormService.validateParameters", () => {
  const svc = new ParameterFormService()

  const testParams: readonly WorkspaceParameter[] = [
    {
      name: "Title",
      description: "A title",
      type: ParameterType.TEXT,
      model: "MODEL",
      optional: false,
    },
    {
      name: "Count",
      description: "Count",
      type: ParameterType.INTEGER,
      model: "MODEL",
      optional: false,
    },
    {
      name: "Ratio",
      description: "Ratio",
      type: ParameterType.FLOAT,
      model: "MODEL",
      optional: true,
    },
    {
      name: "MAXX",
      description: "Max X",
      type: ParameterType.INTEGER,
      model: "MODEL",
    }, // Should be skipped
    {
      name: "Choice",
      description: "Choice field",
      type: ParameterType.CHOICE,
      model: "MODEL",
      listOptions: [
        { caption: "A", value: "a" },
        { caption: "B", value: "b" },
      ],
    },
    {
      name: "Multi",
      description: "Multi field",
      type: ParameterType.LISTBOX,
      model: "MODEL",
      optional: true,
      listOptions: [
        { caption: "One", value: "1" },
        { caption: "Two", value: "2" },
      ],
    },
    {
      name: "LookupChoice",
      description: "Lookup choice",
      type: ParameterType.LOOKUP_CHOICE,
      model: "MODEL",
      listOptions: [
        { caption: "First", value: "1" },
        { caption: "Second", value: "2" },
      ],
    },
  ] as const

  test("validates required fields and type constraints", () => {
    const { isValid, errors } = svc.validateParameters(
      {
        Title: "",
        Count: "abc",
        Ratio: "not-number",
        Choice: "a",
        LookupChoice: "1",
      },
      testParams
    )

    expect(isValid).toBe(false)
    expect(errors).toEqual(
      expect.arrayContaining([
        "Title:required",
        "Count:integer",
        "Ratio:number",
      ])
    )
  })

  test("validates list choices for single and multi-select", () => {
    const invalidChoice = svc.validateParameters(
      { Title: "Valid", Count: 1, Choice: "invalid" },
      testParams
    )
    expect(invalidChoice.isValid).toBe(false)
    expect(invalidChoice.errors).toContain("Choice:choice")

    const invalidMulti = svc.validateParameters(
      { Title: "Valid", Count: 1, Multi: ["1", "invalid"] },
      testParams
    )
    expect(invalidMulti.isValid).toBe(false)
    expect(invalidMulti.errors).toContain("Multi:choice")

    const invalidLookup = svc.validateParameters(
      { Title: "Valid", Count: 1, LookupChoice: "invalid" },
      testParams
    )
    expect(invalidLookup.isValid).toBe(false)
    expect(invalidLookup.errors).toContain("LookupChoice:choice")
  })

  test("does not drop 0 from multi-select values (detects invalid 0 when not allowed)", () => {
    const svc = new ParameterFormService()
    const params: readonly WorkspaceParameter[] = [
      {
        name: "Title",
        description: "A title",
        type: ParameterType.TEXT,
        model: "MODEL",
        optional: false,
      },
      {
        name: "Count",
        description: "Count",
        type: ParameterType.INTEGER,
        model: "MODEL",
        optional: false,
      },
      {
        name: "Multi",
        description: "Multi field",
        type: ParameterType.LISTBOX,
        model: "MODEL",
        optional: false,
        // Use numeric values deliberately; cast to any to simulate upstream variability.
        listOptions: [{ caption: "One", value: 1 }] as unknown as any,
      },
    ] as const

    // 0 is not part of valid options; ensure it is not dropped and triggers a choice error.
    const invalid = svc.validateParameters(
      { Title: "Valid", Count: 1, Multi: [0] },
      params
    )
    expect(invalid.isValid).toBe(false)
    expect(invalid.errors).toContain("Multi:choice")
  })

  test("allows valid data and handles optional fields correctly", () => {
    const valid = svc.validateParameters(
      {
        Title: "Valid",
        Count: 2,
        Choice: "a",
        Multi: ["1", "2"],
        LookupChoice: "1",
      },
      testParams
    )
    expect(valid.isValid).toBe(true)
    expect(valid.errors).toEqual([])

    const omittedOptional = svc.validateParameters(
      { Title: "Valid", Count: 1, Choice: "a", LookupChoice: "1" },
      testParams
    )
    expect(omittedOptional.isValid).toBe(true)
  })
})

describe("ParameterFormService.validateFormValues", () => {
  const svc = new ParameterFormService()
  const fields: readonly DynamicFieldConfig[] = [
    { name: "Title", label: "Title", type: FormFieldType.TEXT, required: true },
    {
      name: "Count",
      label: "Count",
      type: FormFieldType.NUMBER,
      required: true,
    },
    {
      name: "OptionalRatio",
      label: "Ratio",
      type: FormFieldType.NUMBER,
      required: false,
    },
  ] as const

  test("validates required fields and number types", () => {
    const invalid = svc.validateFormValues(
      { Title: "", Count: "abc", OptionalRatio: "xyz" },
      fields
    )
    expect(invalid.isValid).toBe(false)
    expect(invalid.errors).toMatchObject({
      Title: "Title is required",
      Count: "Count must be a number",
      OptionalRatio: "Ratio must be a number",
    })

    const valid = svc.validateFormValues(
      { Title: "Hello", Count: 3, OptionalRatio: 1.5 },
      fields
    )
    expect(valid.isValid).toBe(true)
    expect(valid.errors).toEqual({})
  })

  test("handles optional fields correctly", () => {
    const omittedOptional = svc.validateFormValues(
      { Title: "Valid", Count: 1 },
      fields
    )
    expect(omittedOptional.isValid).toBe(true)
    expect(omittedOptional.errors).toEqual({})
  })
})
