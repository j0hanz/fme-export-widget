import { initExtensions, initStore } from "jimu-for-test"
import { ErrorHandlingService, ParameterFormService } from "../shared/services"
import {
  type WorkspaceParameter,
  ParameterType,
  FormFieldType,
} from "../shared/types"

describe("shared/services", () => {
  beforeAll(() => {
    // Not strictly required for pure services, but safe for EXB test env
    initExtensions()
    initStore()
  })

  describe("ParameterFormService.convertParametersToFields", () => {
    const svc = new ParameterFormService()

    const params: WorkspaceParameter[] = [
      {
        name: "AreaOfInterest",
        description: "AOI",
        type: ParameterType.TEXT,
        model: "M",
        optional: true,
      },
      {
        name: "Title",
        description: "Title",
        type: ParameterType.TEXT,
        model: "M",
        optional: false,
      },
      {
        name: "Description",
        description: "Description",
        type: ParameterType.TEXT_EDIT,
        model: "M",
        optional: true,
      },
      {
        name: "Count",
        description: "Count",
        type: ParameterType.INTEGER,
        model: "M",
        optional: true,
      },
      {
        name: "Price",
        description: "Price",
        type: ParameterType.FLOAT,
        model: "M",
        optional: true,
      },
      {
        name: "Secret",
        description: "Secret",
        type: ParameterType.PASSWORD,
        model: "M",
        optional: true,
      },
      {
        name: "Agree",
        description: "Agree",
        type: ParameterType.BOOLEAN,
        model: "M",
        optional: true,
      },
      {
        name: "File",
        description: "File",
        type: ParameterType.FILENAME,
        model: "M",
        optional: true,
      },
      {
        name: "Choice",
        description: "Choice",
        type: ParameterType.TEXT,
        model: "M",
        optional: true,
        listOptions: [
          { caption: "Alpha", value: "A" } as any,
          { caption: "", value: "B" } as any,
        ],
      },
      {
        name: "MultiChoice",
        description: "MultiChoice",
        type: ParameterType.LISTBOX,
        model: "M",
        optional: true,
        listOptions: [
          { caption: "One", value: 1 } as any,
          { caption: "Two", value: 2 } as any,
        ],
      },
    ]

    test("skips reserved params and maps field types/options correctly", () => {
      const fields = svc.convertParametersToFields(params)
      const names = fields.map((f) => f.name)
      expect(names).not.toContain("AreaOfInterest")
      const byName = (n: string) => {
        const f = fields.find((f) => f.name === n)
        expect(f).toBeDefined()
        return f as unknown as {
          name: string
          type: FormFieldType
          options?: ReadonlyArray<{ label: string; value: unknown }>
          rows?: number
        }
      }

      expect(byName("Title").type).toBe(FormFieldType.TEXT)
      const desc = byName("Description")
      expect(desc.type).toBe(FormFieldType.TEXTAREA)
      expect((desc as any).rows).toBe(3)
      expect(byName("Count").type).toBe(FormFieldType.NUMBER)
      expect(byName("Price").type).toBe(FormFieldType.NUMBER)
      expect(byName("Secret").type).toBe(FormFieldType.PASSWORD)
      expect(byName("Agree").type).toBe(FormFieldType.CHECKBOX)
      expect(byName("File").type).toBe(FormFieldType.FILE)

      const choice = byName("Choice")
      expect(choice.type).toBe(FormFieldType.SELECT)
      expect(choice.options?.length).toBe(2)
      expect(choice.options?.[0]).toEqual({ label: "Alpha", value: "A" })
      expect(choice.options?.[1]).toEqual({ label: "B", value: "B" })

      const multi = byName("MultiChoice")
      expect(multi.type).toBe(FormFieldType.MULTI_SELECT)
      expect(multi.options?.[0]).toEqual({ label: "One", value: 1 })
    })
  })

  describe("ParameterFormService.validateParameters", () => {
    const svc = new ParameterFormService()
    const parameters: WorkspaceParameter[] = [
      {
        name: "RequiredField",
        description: "RequiredField",
        type: ParameterType.TEXT,
        model: "M",
        optional: false,
      },
      {
        name: "IntField",
        description: "IntField",
        type: ParameterType.INTEGER,
        model: "M",
        optional: true,
      },
      {
        name: "FloatField",
        description: "FloatField",
        type: ParameterType.FLOAT,
        model: "M",
        optional: true,
      },
      {
        name: "Choice",
        description: "Choice",
        type: ParameterType.TEXT,
        model: "M",
        optional: true,
        listOptions: [{ caption: "Alpha", value: "A" } as any],
      },
      {
        name: "Multi",
        description: "Multi",
        type: ParameterType.LISTBOX,
        model: "M",
        optional: true,
        listOptions: [{ caption: "One", value: 1 } as any],
      },
    ]

    test("detects missing required, integer/number, and list choice errors", () => {
      const data = {
        IntField: "1.5", // not integer
        FloatField: "abc", // not number
        Choice: "X", // invalid choice
        Multi: [2, 3], // invalid choices
      } as { [key: string]: unknown }

      const res = svc.validateParameters(data, parameters)
      expect(res.isValid).toBe(false)
      expect(res.errors).toEqual(
        expect.arrayContaining([
          "RequiredField:required",
          "IntField:integer",
          "FloatField:number",
          "Choice:choice",
          "Multi:choice",
        ])
      )
    })

    test("passes on valid values", () => {
      const ok = svc.validateParameters(
        {
          RequiredField: "x",
          IntField: 2,
          FloatField: 3.14,
          Choice: "A",
          Multi: [1],
        },
        parameters
      )
      expect(ok.isValid).toBe(true)
      expect(ok.errors.length).toBe(0)
    })
  })

  describe("ParameterFormService.validateFormValues", () => {
    const svc = new ParameterFormService()
    const params: WorkspaceParameter[] = [
      {
        name: "Title",
        description: "Title",
        type: ParameterType.TEXT,
        model: "M",
        optional: false,
      },
      {
        name: "Amount",
        description: "Amount",
        type: ParameterType.FLOAT,
        model: "M",
        optional: true,
      },
    ]
    const fields = svc.convertParametersToFields(params)

    test("required fields produce empty-string error; number type enforces numeric", () => {
      const values = { Title: "", Amount: "abc" } as { [key: string]: unknown }
      const res = svc.validateFormValues(values, fields)
      expect(res.isValid).toBe(false)
      expect(res.errors.Title).toBe("")
      expect(res.errors.Amount).toBe("Amount must be a number")
    })

    test("valid values yield no errors", () => {
      const values = { Title: "T", Amount: 10 } as { [key: string]: unknown }
      const res = svc.validateFormValues(values, fields)
      expect(res.isValid).toBe(true)
      expect(Object.keys(res.errors).length).toBe(0)
    })
  })

  describe("ErrorHandlingService", () => {
    const svc = new ErrorHandlingService()
    const t = (k: string) => `t:${k}`

    test("createError populates defaults and custom fields", () => {
      const e1 = svc.createError("msg")
      expect(e1.message).toBe("msg")
      expect(e1.code).toBe("UNKNOWN_ERROR")
      expect(e1.severity).toBeDefined()
      expect(e1.timestamp).toBeInstanceOf(Date)
      expect(typeof e1.timestampMs).toBe("number")

      const retry = jest.fn()
      const e2 = svc.createError("oops", undefined, {
        code: "C1",
        severity: 1 as any, // ErrorSeverity.WARNING likely enum, keep flexible
        details: { a: 1 },
        recoverable: true,
        retry,
        userFriendlyMessage: "Call support",
        suggestion: "Check config",
      })
      expect(e2.code).toBe("C1")
      expect(e2.recoverable).toBe(true)
      expect(e2.details).toEqual({ a: 1 })
      expect(e2.retry).toBe(retry)
      expect(e2.userFriendlyMessage).toBe("Call support")
      expect(e2.suggestion).toBe("Check config")
    })

    test("deriveStartupError maps known codes", () => {
      expect(svc.deriveStartupError({ code: "UserEmailMissing" }, t)).toEqual({
        code: "UserEmailMissing",
        message: "t:userEmailMissing",
      })
      expect(svc.deriveStartupError({ name: "INVALID_CONFIG" }, t)).toEqual({
        code: "INVALID_CONFIG",
        message: "t:invalidConfiguration",
      })
      expect(
        svc.deriveStartupError({ message: "WEBHOOK_AUTH_ERROR" }, t)
      ).toEqual({
        code: "WEBHOOK_AUTH_ERROR",
        message: "t:authenticationFailed",
      })
    })

    test("deriveStartupError handles HTTP statuses", () => {
      expect(svc.deriveStartupError({ status: 401 }, t)).toEqual({
        code: "AUTH_ERROR",
        message: "t:startupValidationFailed",
      })
      expect(svc.deriveStartupError({ status: 403 }, t)).toEqual({
        code: "AUTH_ERROR",
        message: "t:startupValidationFailed",
      })
      expect(svc.deriveStartupError({ status: 404 }, t)).toEqual({
        code: "REPO_NOT_FOUND",
        message: "t:repoNotFound",
      })
      expect(svc.deriveStartupError({ status: 500 }, t)).toEqual({
        code: "SERVER_ERROR",
        message: "t:serverError",
      })
      expect(svc.deriveStartupError({ status: 429 }, t)).toEqual({
        code: "HTTP_ERROR",
        message: "t:connectionFailed",
      })
    })

    test("deriveStartupError handles network/timeout/bad response and default", () => {
      expect(
        svc.deriveStartupError({ message: "Timeout exceeded" }, t)
      ).toEqual({ code: "TIMEOUT", message: "t:timeout" })
      expect(svc.deriveStartupError({ message: "Failed to fetch" }, t)).toEqual(
        { code: "NETWORK_ERROR", message: "t:networkError" }
      )
      expect(
        svc.deriveStartupError({ name: "TypeError", message: "boom" }, t)
      ).toEqual({ code: "NETWORK_ERROR", message: "t:networkError" })
      expect(
        svc.deriveStartupError({ message: "Unexpected token in JSON" }, t)
      ).toEqual({ code: "BAD_RESPONSE", message: "t:badResponse" })
      expect(svc.deriveStartupError({ message: "Something else" }, t)).toEqual({
        code: "STARTUP_ERROR",
        message: "t:startupValidationFailed",
      })
    })
  })
})
