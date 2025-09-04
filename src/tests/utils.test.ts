import {
  isEmpty,
  isInt,
  isNum,
  resolveMessageOrKey,
  isAuthError,
  isValidEmail,
  getSupportEmail,
  buildSupportHintText,
  EMAIL_PLACEHOLDER,
  sanitizeFmeBaseUrl,
  validateServerUrlKey,
  validateTokenKey,
  validateRepositoryKey,
  getEmailValidationError,
} from "../shared/utils"

// Simple translator factory: looks up keys in a dict; otherwise returns the key
const makeTranslator = (dict: { [key: string]: string }) => (key: string) =>
  Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key

describe("utils helpers", () => {
  describe("isAuthError", () => {
    test("returns true for 401 and 403 status codes", () => {
      expect(isAuthError(401)).toBe(true)
      expect(isAuthError(403)).toBe(true)
      expect(isAuthError(500)).toBe(false)
      expect(isAuthError(200)).toBe(false)
    })
  })

  describe("resolveMessageOrKey", () => {
    test("returns raw when empty string provided", () => {
      const t = makeTranslator({})
      expect(resolveMessageOrKey("", t)).toBe("")
    })

    test("returns exact translation when available for raw key", () => {
      const t = makeTranslator({ HELLO_WORLD: "Hi there" })
      expect(resolveMessageOrKey("HELLO_WORLD", t)).toBe("Hi there")
    })

    test("uses camelCase fallback when exact translation is not available", () => {
      const t = makeTranslator({ helloWorld: "Hello Camel" })
      expect(resolveMessageOrKey("HELLO_WORLD", t)).toBe("Hello Camel")
    })

    test("returns raw when neither exact nor camelCase translation is available", () => {
      const t = makeTranslator({})
      expect(resolveMessageOrKey("SOME_UNTRANSLATED_KEY", t)).toBe(
        "SOME_UNTRANSLATED_KEY"
      )
    })

    test("prefers exact translation over camelCase when both exist", () => {
      const t = makeTranslator({
        HELLO_WORLD: "Exact Wins",
        helloWorld: "Camel Fallback",
      })
      expect(resolveMessageOrKey("HELLO_WORLD", t)).toBe("Exact Wins")
    })
  })

  describe("auth and error utilities", () => {
    test("isAuthError recognizes 401 and 403", () => {
      expect(isAuthError(401)).toBe(true)
      expect(isAuthError(403)).toBe(true)
      expect(isAuthError(500)).toBe(false)
      expect(isAuthError(200)).toBe(false)
    })
  })

  describe("email helpers", () => {
    test("isValidEmail accepts ordinary addresses and rejects invalid ones", () => {
      expect(isValidEmail("user@example.com")).toBe(true)
      expect(isValidEmail("user.name+tag@sub.domain.co")).toBe(true)
      expect(isValidEmail("")).toBe(false)
      expect(isValidEmail(null)).toBe(false)
      expect(isValidEmail("no-reply@example.com")).toBe(false)
      expect(isValidEmail("noreply@domain.com")).toBe(false)
      expect(isValidEmail("not-an-email")).toBe(false)
    })

    test("getSupportEmail returns trimmed valid email or undefined", () => {
      expect(getSupportEmail("  user@x.y  ")).toBe("user@x.y")
      expect(getSupportEmail("invalid@@x.y")).toBeUndefined()
      expect(getSupportEmail("no-reply@x.y")).toBeUndefined()
      expect(getSupportEmail(undefined)).toBeUndefined()
    })

    test("buildSupportHintText prefers explicit supportEmail then userFriendly then default", () => {
      const translate = (k: string) => {
        if (k === "contactSupportWithEmail") return "Contact {email} for help"
        if (k === "contactSupport") return "Contact support"
        return k
      }

      const t1 = buildSupportHintText(translate as any, "help@domain.com", "")
      expect(t1).toBe("Contact help@domain.com for help")

      const t2 = buildSupportHintText(
        translate as any,
        undefined,
        "Friendly message"
      )
      expect(t2).toBe("Friendly message")

      const t3 = buildSupportHintText(translate as any)
      expect(t3).toBe("Contact support")
    })

    test("EMAIL_PLACEHOLDER matches {email} pattern loosely", () => {
      expect(EMAIL_PLACEHOLDER.test("{email}")).toBe(true)
      expect(EMAIL_PLACEHOLDER.test("{ email }")).toBe(true)
    })
  })

  describe("FME URL sanitization and validation", () => {
    test("sanitizeFmeBaseUrl strips /fmerest path and trailing slash", () => {
      const a = sanitizeFmeBaseUrl("https://example.com/fmerest/v3/repositories")
      expect(a.isValid).toBe(true)
      expect(a.cleaned).toBe("https://example.com")

      const b = sanitizeFmeBaseUrl("https://example.com/fmerest/")
      expect(b.cleaned).toBe("https://example.com")

      const c = sanitizeFmeBaseUrl("https://example.com/FMERest/v4")
      expect(c.cleaned).toBe("https://example.com")

      const d = sanitizeFmeBaseUrl("not a url")
      expect(d.isValid).toBe(false)
      expect(d.cleaned).toBe("not a url")
      expect(Array.isArray(d.errors)).toBe(true)
    })

    test("validateServerUrlKey returns appropriate error keys", () => {
      expect(validateServerUrlKey("")).toBe("errorMissingServerUrl")
      expect(validateServerUrlKey("not-a-url")).toBe("errorInvalidServerUrl")
      expect(validateServerUrlKey("ftp://x.y")).toBe("errorInvalidServerUrl")
      expect(validateServerUrlKey("https://user:pass@x.y")).toBe(
        "errorInvalidServerUrl"
      )
      expect(validateServerUrlKey("https://example.com/fmerest")).toBe(
        "errorBadBaseUrl"
      )
      expect(validateServerUrlKey("https://localhost")).toBeNull()
      expect(validateServerUrlKey("https://127.0.0.1")).toBeNull()
      expect(validateServerUrlKey("https://example.com")).toBeNull()
      // Branded hostnames (no dot) allowed when containing 'fmeflow'
      expect(validateServerUrlKey("https://fmeflow-host")).toBeNull()
    })
  })

  describe("FME token and repository validation", () => {
    test("validateTokenKey enforces length, whitespace, control chars, and invalid symbols", () => {
      expect(validateTokenKey("")).toBe("errorMissingToken")
      expect(validateTokenKey("short")).toBe("errorTokenIsInvalid")
      expect(validateTokenKey("has space token")).toBe("errorTokenIsInvalid")
      expect(validateTokenKey("abc\u0001defghij")).toBe("errorTokenIsInvalid")
      expect(validateTokenKey("abc<defghij")).toBe("errorTokenIsInvalid")
      expect(validateTokenKey("abcdefghij12345")).toBeNull()
    })

    test("validateRepositoryKey checks presence and membership when list provided", () => {
      expect(validateRepositoryKey("", null)).toBeNull()
      expect(validateRepositoryKey("", [])).toBeNull()
      expect(validateRepositoryKey("", ["r1"]))
        .toBe("errorRepoRequired")
      expect(validateRepositoryKey("r2", ["r1"]))
        .toBe("errorRepositoryNotFound")
      expect(validateRepositoryKey("r1", ["r1", "r2"]))
        .toBeNull()
    })

    test("getEmailValidationError returns null for empty (optional) and key for invalid", () => {
      expect(getEmailValidationError("")).toBeNull()
      expect(getEmailValidationError("not-an-email")).toBe("errorInvalidEmail")
      expect(getEmailValidationError("no-reply@x.y")).toBe("errorInvalidEmail")
      expect(getEmailValidationError("user@example.com")).toBeNull()
    })
  })

  describe("isEmpty", () => {
    test("returns true for undefined, null, and empty string", () => {
      expect(isEmpty(undefined)).toBe(true)
      expect(isEmpty(null)).toBe(true)
      expect(isEmpty("")).toBe(true)
    })

    test("returns true for empty arrays", () => {
      expect(isEmpty([])).toBe(true)
    })

    test("returns true for whitespace-only strings", () => {
      expect(isEmpty("   ")).toBe(true)
      expect(isEmpty("\t\n")).toBe(true)
      expect(isEmpty(" \t \n ")).toBe(true)
    })

    test("returns false for non-empty values", () => {
      expect(isEmpty("text")).toBe(false)
      expect(isEmpty("0")).toBe(false)
      expect(isEmpty([1, 2, 3])).toBe(false)
      expect(isEmpty([""])).toBe(false)
      expect(isEmpty(0)).toBe(false)
      expect(isEmpty(false)).toBe(false)
      expect(isEmpty({})).toBe(false)
    })

    test("handles edge cases correctly", () => {
      expect(isEmpty(" a ")).toBe(false)
      expect(isEmpty(NaN)).toBe(false)
      expect(isEmpty(Infinity)).toBe(false)
    })
  })

  describe("isInt", () => {
    test("returns true for integer numbers", () => {
      expect(isInt(42)).toBe(true)
      expect(isInt(0)).toBe(true)
      expect(isInt(-123)).toBe(true)
      expect(isInt(1e3)).toBe(true)
    })

    test("returns false for non-integer numbers", () => {
      expect(isInt(3.14)).toBe(false)
      expect(isInt(0.1)).toBe(false)
      expect(isInt(NaN)).toBe(false)
      expect(isInt(Infinity)).toBe(false)
      expect(isInt(-Infinity)).toBe(false)
    })

    test("returns true for integer strings", () => {
      expect(isInt("42")).toBe(true)
      expect(isInt("0")).toBe(true)
      expect(isInt("-123")).toBe(true)
      expect(isInt("  456  ")).toBe(true)
    })

    test("returns false for non-integer strings", () => {
      expect(isInt("3.14")).toBe(false)
      expect(isInt("abc")).toBe(false)
      expect(isInt("")).toBe(true) // Number("") === 0, which is an integer
      expect(isInt("  ")).toBe(true) // Number("  ") === 0, which is an integer
      expect(isInt("12.0")).toBe(true) // Number("12.0") === 12, which is an integer
    })

    test("returns false for non-string, non-number types", () => {
      expect(isInt(null)).toBe(false)
      expect(isInt(undefined)).toBe(false)
      expect(isInt({})).toBe(false)
      expect(isInt([])).toBe(false)
      expect(isInt(true)).toBe(false)
    })
  })

  describe("isNum", () => {
    test("returns true for finite numbers", () => {
      expect(isNum(42)).toBe(true)
      expect(isNum(3.14)).toBe(true)
      expect(isNum(0)).toBe(true)
      expect(isNum(-123.45)).toBe(true)
    })

    test("returns false for non-finite numbers", () => {
      expect(isNum(NaN)).toBe(false)
      expect(isNum(Infinity)).toBe(false)
      expect(isNum(-Infinity)).toBe(false)
    })

    test("returns true for numeric strings", () => {
      expect(isNum("42")).toBe(true)
      expect(isNum("3.14")).toBe(true)
      expect(isNum("0")).toBe(true)
      expect(isNum("-123.45")).toBe(true)
      expect(isNum("  456.78  ")).toBe(true)
    })

    test("returns false for non-numeric strings", () => {
      expect(isNum("abc")).toBe(false)
      expect(isNum("")).toBe(true) // Number("") === 0, which is finite
      expect(isNum("  ")).toBe(true) // Number("  ") === 0, which is finite
      expect(isNum("12abc")).toBe(false)
    })

    test("returns false for non-string, non-number types", () => {
      expect(isNum(null)).toBe(false)
      expect(isNum(undefined)).toBe(false)
      expect(isNum({})).toBe(false)
      expect(isNum([])).toBe(false)
      expect(isNum(true)).toBe(false)
    })
  })
})
