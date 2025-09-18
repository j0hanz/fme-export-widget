import {
  isEmpty,
  resolveMessageOrKey,
  buildSupportHintText,
} from "../shared/utils"
import {
  isInt,
  isNum,
  isValidEmail,
  normalizeBaseUrl,
  validateServerUrl,
  validateToken,
  validateRepository,
  extractErrorMessage,
  extractHttpStatus,
  getSupportEmail,
  isAuthError,
} from "../shared/validations"
describe("shared/utils", () => {
  test("isEmpty handles primitives and arrays", () => {
    expect(isEmpty(undefined)).toBe(true)
    expect(isEmpty(null)).toBe(true)
    expect(isEmpty(0)).toBe(false)
    expect(isEmpty("")).toBe(true)
    expect(isEmpty("   ")).toBe(true)
    expect(isEmpty("a")).toBe(false)
    expect(isEmpty([])).toBe(true)
    expect(isEmpty([1])).toBe(false)
    expect(isEmpty({})).toBe(false)
  })

  test("isAuthError matches 401/403", () => {
    expect(isAuthError(401)).toBe(true)
    expect(isAuthError(403)).toBe(true)
    expect(isAuthError(404)).toBe(false)
  })

  test("isInt validates integers including numeric strings", () => {
    expect(isInt(5)).toBe(true)
    expect(isInt(5.1)).toBe(false)
    expect(isInt("42")).toBe(true)
    expect(isInt(" 42 ")).toBe(true)
    expect(isInt("-10")).toBe(true)
    expect(isInt("3.14")).toBe(false)
    expect(isInt("abc")).toBe(false)
    expect(isInt({} as any)).toBe(false)
  })

  test("isNum validates finite numbers including numeric strings", () => {
    expect(isNum(3.14)).toBe(true)
    expect(isNum(-2)).toBe(true)
    expect(isNum(Infinity)).toBe(false)
    expect(isNum("3.14")).toBe(true)
    expect(isNum("-2")).toBe(true)
    expect(isNum("Infinity")).toBe(false)
    expect(isNum("NaN")).toBe(false)
    expect(isNum("abc")).toBe(false)
  })

  test("resolveMessageOrKey returns translated exact key or camelized fallback", () => {
    const map: { [key: string]: string } = {
      exact_key: "Exact Translation",
      tooltipSubmitOrder: "Skicka beställningen",
    }
    const translate = (key: string) => map[key] || key

    // exact key exists -> use it
    expect(resolveMessageOrKey("exact_key", translate)).toBe(
      "Exact Translation"
    )
    // no exact but camelized exists -> use camelized
    expect(resolveMessageOrKey("tooltip_submit_order", translate)).toBe(
      "Skicka beställningen"
    )
    // no mapping -> return raw
    expect(resolveMessageOrKey("missing_key", translate)).toBe("missing_key")
  })

  test("isValidEmail rejects no-reply and invalid patterns", () => {
    expect(isValidEmail("user@example.com")).toBe(true)
    expect(isValidEmail("No-Reply@domain.com")).toBe(false)
    expect(isValidEmail("noreply@domain.com")).toBe(false)
    expect(isValidEmail("bad@domain")).toBe(false)
    expect(isValidEmail(123 as any)).toBe(false)
  })

  test("normalizeBaseUrl strips /fmerest and ensures trailing slash; invalid URL returns empty", () => {
    const a = normalizeBaseUrl("https://example.com/fmerest/v3/")
    expect(a).toBe("https://example.com/")

    const b = normalizeBaseUrl("https://example.com/base")
    expect(b).toBe("https://example.com/base/")

    const c = normalizeBaseUrl("not a url")
    expect(c).toBe("")
  })

  test("validateServerUrl enforces protocol, host, credentials, and path rules", () => {
    // Missing
    expect(validateServerUrl("").key).toBe("errorMissingServerUrl")
    // Invalid parse
    expect(validateServerUrl("bad").key).toBe("errorInvalidServerUrl")
    // Unsupported protocol
    expect(validateServerUrl("ftp://example.com").key).toBe(
      "errorInvalidServerUrl"
    )
    // Embedded credentials forbidden
    expect(validateServerUrl("http://user:pass@example.com").key).toBe(
      "errorInvalidServerUrl"
    )
    // Forbidden FME path
    expect(validateServerUrl("https://example.com/fmerest/v3").key).toBe(
      "errorBadBaseUrl"
    )
    // Single-label hosts may be allowed (e.g., dev hostnames); ensure it does not produce an error
    expect(validateServerUrl("https://bad").ok).toBe(true)
    // Valid cases
    expect(validateServerUrl("https://localhost").ok).toBe(true)
    expect(validateServerUrl("http://192.168.0.1").ok).toBe(true)
    expect(validateServerUrl("https://example.com").ok).toBe(true)
    expect(validateServerUrl("https://my-fmeflow").ok).toBe(true)
  })

  test("validateToken enforces length, whitespace, control chars, and blacklist of symbols", () => {
    expect(validateToken("").key).toBe("errorMissingToken")
    expect(validateToken("short").key).toBe("errorTokenIsInvalid")
    expect(validateToken("has space 12345").key).toBe("errorTokenIsInvalid")
    // Control character \x01
    expect(validateToken("validtoken1" + String.fromCharCode(1)).key).toBe(
      "errorTokenIsInvalid"
    )
    expect(validateToken("bad<token>12345").key).toBe("errorTokenIsInvalid")
    expect(validateToken("good_token_12345").ok).toBe(true)
  })

  test("validateRepository checks required and existence when repos provided", () => {
    expect(validateRepository("", null).ok).toBe(true)
    expect(validateRepository("", []).ok).toBe(true)
    expect(validateRepository("", ["A"]).key).toBe("errorRepoRequired")
    expect(validateRepository("B", ["A"]).key).toBe("errorRepositoryNotFound")
    expect(validateRepository("A", ["A"]).ok).toBe(true)
  })

  // getEmailValidationError removed in new validations; email checks use isValidEmail

  test("extractErrorMessage handles primitives, Error, common fields, and object fallback", () => {
    expect(extractErrorMessage(undefined)).toBe("Unknown error")
    expect(extractErrorMessage("msg")).toBe("msg")
    expect(extractErrorMessage(404)).toBe("404")
    expect(extractErrorMessage(new Error("boom"))).toBe("boom")
    expect(extractErrorMessage({ message: "m" })).toBe("m")
    expect(extractErrorMessage({ error: "e" })).toBe("e")
    expect(extractErrorMessage({ description: "d" })).toBe("d")
    // 'detail' now falls back to JSON stringification
    expect(extractErrorMessage({ detail: "x" })).toBe(
      JSON.stringify({ detail: "x" })
    )
    // unknown fields like 'reason' fall back to JSON stringification
    expect(extractErrorMessage({ reason: "r" })).toBe(
      JSON.stringify({ reason: "r" })
    )
    expect(extractErrorMessage({ a: 1, b: 2 })).toBe(
      JSON.stringify({ a: 1, b: 2 })
    )
  })

  test("extractHttpStatus reads numeric and string status in range 100-599", () => {
    expect(extractHttpStatus(undefined)).toBeUndefined()
    expect(extractHttpStatus({})).toBeUndefined()
    expect(extractHttpStatus({ status: 200 })).toBe(200)
    expect(extractHttpStatus({ statusCode: 404 })).toBe(404)
    expect(extractHttpStatus({ httpStatus: "500" })).toBe(500)
    expect(extractHttpStatus({ code: "403" })).toBe(403)
    // out of range ignored
    expect(extractHttpStatus({ status: 99 })).toBeUndefined()
    expect(extractHttpStatus({ status: 600 })).toBeUndefined()
  })

  test("buildSupportHintText uses email placeholder when provided; else userFriendly; else fallback", () => {
    const translate = (key: string) =>
      key === "contactSupportWithEmail" ? "Contact us at {email} for help" : key

    // with email -> placeholder replacement
    expect(buildSupportHintText(translate, "help@ex.com", undefined)).toBe(
      "Contact us at help@ex.com for help"
    )
    // with user-friendly message
    expect(buildSupportHintText(translate, undefined, "Custom help")).toBe(
      "Custom help"
    )
    // fallback now empty string when no email/user-friendly provided
    expect(buildSupportHintText(translate, undefined, undefined)).toBe("")
  })

  test("getSupportEmail returns valid trimmed email and rejects invalid or noreply", () => {
    expect(getSupportEmail("  user@example.com  ")).toBe("user@example.com")
    expect(getSupportEmail("no-reply@ex.com")).toBeUndefined()
    expect(getSupportEmail("bad@ex")).toBeUndefined()
    expect(getSupportEmail(123 as any)).toBeUndefined()
  })
})
