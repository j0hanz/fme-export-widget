import {
  resolveMessageOrKey,
  isAuthError,
  getErrorMessage,
  isValidEmail,
  getSupportEmail,
  buildSupportHintText,
  EMAIL_PLACEHOLDER,
} from "../shared/utils"

// Simple translator factory: looks up keys in a dict; otherwise returns the key
const makeTranslator = (dict: { [key: string]: string }) => (key: string) =>
  Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key

describe("utils helpers", () => {
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

    test("getErrorMessage extracts message from Error-like objects", () => {
      expect(getErrorMessage(new Error("boom"))).toBe("boom")
      expect(getErrorMessage({ message: 123 })).toBe("123")
      expect(getErrorMessage({})).toBe("")
      expect(getErrorMessage(null)).toBe("")
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
})
