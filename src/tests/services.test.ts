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

  const params: readonly WorkspaceParameter[] = [
    {
      name: "MAXX",
      description: "ignored",
      type: ParameterType.INTEGER,
      model: "MODEL",
    },
    {
      name: "AreaOfInterest",
      description: "geometry",
      type: ParameterType.GEOMETRY,
      model: "MODEL",
    },
    {
      name: "Title",
      description: "A title",
      type: ParameterType.TEXT,
      model: "MODEL",
      optional: false,
      defaultValue: "Untitled",
    },
    {
      name: "Notes",
      description: "Long text",
      type: ParameterType.TEXT_EDIT,
      model: "MODEL",
      optional: true,
    },
    {
      name: "Count",
      description: "An integer",
      type: ParameterType.INTEGER,
      model: "MODEL",
    },
    {
      name: "Ratio",
      description: "A float",
      type: ParameterType.FLOAT,
      model: "MODEL",
    },
    {
      name: "Secret",
      description: "Password",
      type: ParameterType.PASSWORD,
      model: "MODEL",
    },
    {
      name: "Agree",
      description: "Accept terms",
      type: ParameterType.BOOLEAN,
      model: "MODEL",
      optional: true,
    },
    {
      name: "Upload",
      description: "File",
      type: ParameterType.FILENAME,
      model: "MODEL",
      optional: true,
    },
    {
      name: "ChoiceOne",
      description: "Pick one",
      type: ParameterType.CHOICE,
      model: "MODEL",
      listOptions: [
        { caption: "A", value: "a" },
        { caption: "B", value: "b" },
      ],
    },
    {
      name: "Multi",
      description: "Pick many",
      type: ParameterType.LISTBOX,
      model: "MODEL",
      listOptions: [
        { caption: "One", value: "1" },
        { caption: "Two", value: "2" },
      ],
    },
  ] as const

  test("skips internal parameters and maps field types", () => {
    const fields = svc.convertParametersToFields(params)
    const names = fields.map((f) => f.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "Title",
        "Notes",
        "Count",
        "Ratio",
        "Secret",
        "Agree",
        "Upload",
        "ChoiceOne",
        "Multi",
      ])
    )
    // Ensure skipped params are not present
    expect(names).not.toContain("MAXX")
    expect(names).not.toContain("AreaOfInterest")

    const find = (n: string) => {
      const f = fields.find((f) => f.name === n)
      if (!f) throw new Error(`Field ${n} not found`)
      return f
    }

    expect(find("Title").type).toBe(FormFieldType.TEXT)
    expect(find("Notes").type).toBe(FormFieldType.TEXTAREA)
    const notes = find("Notes")
    expect(notes.rows).not.toBeUndefined()
    if (typeof notes.rows === "number") {
      expect(notes.rows).toBeGreaterThan(0)
    }
    expect(find("Count").type).toBe(FormFieldType.NUMBER)
    expect(find("Ratio").type).toBe(FormFieldType.NUMBER)
    expect(find("Secret").type).toBe(FormFieldType.PASSWORD)
    expect(find("Agree").type).toBe(FormFieldType.CHECKBOX)
    expect(find("Upload").type).toBe(FormFieldType.FILE)

    const choice = find("ChoiceOne")
    expect(choice.type).toBe(FormFieldType.SELECT)
    expect(choice.options).toEqual([
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ])

    const multi = find("Multi")
    expect(multi.type).toBe(FormFieldType.MULTI_SELECT)
    expect(multi.options).toEqual([
      { label: "One", value: "1" },
      { label: "Two", value: "2" },
    ])
  })

  test("maps lookup list types correctly (single vs multi)", () => {
    const lookupParams: readonly WorkspaceParameter[] = [
      {
        name: "LookupOne",
        description: "Lookup single",
        type: ParameterType.LOOKUP_CHOICE,
        model: "MODEL",
        listOptions: [
          { caption: "First", value: "1" },
          { caption: "Second", value: "2" },
        ],
      },
      {
        name: "LookupMulti",
        description: "Lookup multi",
        type: ParameterType.LOOKUP_LISTBOX,
        model: "MODEL",
        listOptions: [
          { caption: "A", value: "a" },
          { caption: "B", value: "b" },
        ],
      },
    ] as const

    const fields = svc.convertParametersToFields(lookupParams)
    const find = (n: string) => {
      const f = fields.find((f) => f.name === n)
      if (!f) throw new Error(`Field ${n} not found`)
      return f
    }
    const single = find("LookupOne")
    const multi = find("LookupMulti")
    expect(single.type).toBe(FormFieldType.SELECT)
    expect(multi.type).toBe(FormFieldType.MULTI_SELECT)
    expect(single.options).toEqual([
      { label: "First", value: "1" },
      { label: "Second", value: "2" },
    ])
    expect(multi.options).toEqual([
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ])
  })
})

describe("ParameterFormService.validateParameters", () => {
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
      description: "An integer",
      type: ParameterType.INTEGER,
      model: "MODEL",
      optional: false,
    },
    {
      name: "Ratio",
      description: "A float",
      type: ParameterType.FLOAT,
      model: "MODEL",
      optional: true,
    },
    {
      name: "ChoiceOne",
      description: "Pick one",
      type: ParameterType.CHOICE,
      model: "MODEL",
      listOptions: [
        { caption: "A", value: "a" },
        { caption: "B", value: "b" },
      ],
    },
    {
      name: "Multi",
      description: "Pick many",
      type: ParameterType.LISTBOX,
      model: "MODEL",
      listOptions: [
        { caption: "One", value: "1" },
        { caption: "Two", value: "2" },
      ],
      optional: true,
    },
    // Skipped should be ignored by validator
    {
      name: "MAXX",
      description: "ignored",
      type: ParameterType.INTEGER,
      model: "MODEL",
    },
  ] as const

  test("required validation and type checks", () => {
    const { isValid, errors } = svc.validateParameters(
      { Title: "", Count: "abc", Ratio: "not-a-number", ChoiceOne: "a" },
      params
    )
    expect(isValid).toBe(false)
    expect(errors).toEqual(
      expect.arrayContaining([
        "Title:required",
        "Count:integer",
        // Ratio is optional; empty would be fine, but when present must be number
        "Ratio:number",
      ])
    )
  })

  test("list choice validation for single and multi-select", () => {
    const oneBad = svc.validateParameters(
      { Title: "X", Count: 1, ChoiceOne: "z" },
      params
    )
    expect(oneBad.isValid).toBe(false)
    expect(oneBad.errors).toContain("ChoiceOne:choice")

    const multiBad = svc.validateParameters(
      { Title: "X", Count: 1, Multi: ["1", "3"] },
      params
    )
    expect(multiBad.isValid).toBe(false)
    expect(multiBad.errors).toContain("Multi:choice")

    const ok = svc.validateParameters(
      { Title: "X", Count: 2, ChoiceOne: "a", Multi: ["1", "2"] },
      params
    )
    expect(ok.isValid).toBe(true)
    expect(ok.errors).toEqual([])
  })

  test("lookup list validation for single and multi-select", () => {
    const params2: readonly WorkspaceParameter[] = [
      {
        name: "Title",
        description: "A title",
        type: ParameterType.TEXT,
        model: "MODEL",
        optional: false,
      },
      {
        name: "Count",
        description: "An integer",
        type: ParameterType.INTEGER,
        model: "MODEL",
        optional: false,
      },
      {
        name: "LookupOne",
        description: "Lookup single",
        type: ParameterType.LOOKUP_CHOICE,
        model: "MODEL",
        listOptions: [
          { caption: "First", value: "1" },
          { caption: "Second", value: "2" },
        ],
      },
      {
        name: "LookupMulti",
        description: "Lookup multi",
        type: ParameterType.LOOKUP_LISTBOX,
        model: "MODEL",
        listOptions: [
          { caption: "A", value: "a" },
          { caption: "B", value: "b" },
        ],
        optional: true,
      },
    ] as const

    const badSingle = svc.validateParameters(
      { Title: "X", Count: 1, LookupOne: "9" },
      params2
    )
    expect(badSingle.isValid).toBe(false)
    expect(badSingle.errors).toContain("LookupOne:choice")

    const badMulti = svc.validateParameters(
      { Title: "X", Count: 1, LookupMulti: ["a", "z"] },
      params2
    )
    expect(badMulti.isValid).toBe(false)
    expect(badMulti.errors).toContain("LookupMulti:choice")

    const ok = svc.validateParameters(
      { Title: "X", Count: 2, LookupOne: "1", LookupMulti: ["a", "b"] },
      params2
    )
    expect(ok.isValid).toBe(true)
    expect(ok.errors).toEqual([])
  })

  test("optional numeric parameter omitted passes; present invalid fails", () => {
    const params3: readonly WorkspaceParameter[] = [
      {
        name: "Title",
        description: "A title",
        type: ParameterType.TEXT,
        model: "MODEL",
      },
      {
        name: "Count",
        description: "An integer",
        type: ParameterType.INTEGER,
        model: "MODEL",
      },
      {
        name: "OptionalRatio",
        description: "Optional float",
        type: ParameterType.FLOAT,
        model: "MODEL",
        optional: true,
      },
    ] as const

    const omitted = svc.validateParameters({ Title: "T", Count: 1 }, params3)
    expect(omitted.isValid).toBe(true)
    expect(omitted.errors).toEqual([])

    const presentInvalid = svc.validateParameters(
      { Title: "T", Count: 1, OptionalRatio: "bad" },
      params3
    )
    expect(presentInvalid.isValid).toBe(false)
    expect(presentInvalid.errors).toContain("OptionalRatio:number")
  })
})

describe("ParameterFormService.validateFormValues", () => {
  const svc = new ParameterFormService()
  const fields: readonly DynamicFieldConfig[] = [
    {
      name: "Title",
      label: "Title",
      type: FormFieldType.TEXT,
      required: true,
    },
    {
      name: "Count",
      label: "Count",
      type: FormFieldType.NUMBER,
      required: true,
    },
    {
      name: "Ratio",
      label: "Ratio",
      type: FormFieldType.NUMBER,
      required: false,
    },
  ] as const

  test("required fields and number coercion errors are reported", () => {
    const result = svc.validateFormValues(
      { Title: "", Count: "abc", Ratio: "xyz" },
      fields
    )
    expect(result.isValid).toBe(false)
    expect(result.errors).toMatchObject({
      Title: "Title is required",
      Count: "Count must be a number",
      Ratio: "Ratio must be a number",
    })
  })

  test("valid values pass validation", () => {
    const result = svc.validateFormValues(
      { Title: "Hello", Count: 3, Ratio: 1.5 },
      fields
    )
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual({})
  })

  test("optional number field omitted passes; present invalid fails", () => {
    const svc2 = new ParameterFormService()
    const ok = svc2.validateFormValues({ Title: "T", Count: 1 }, fields)
    expect(ok.isValid).toBe(true)
    expect(ok.errors).toEqual({})

    const bad = svc2.validateFormValues(
      { Title: "T", Count: 1, Ratio: "abc" },
      fields
    )
    expect(bad.isValid).toBe(false)
    expect(bad.errors).toMatchObject({ Ratio: "Ratio must be a number" })
  })
})
