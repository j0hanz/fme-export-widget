import {
  isEmpty,
  isAuthError,
  isInt,
  isNum,
  resolveMessageOrKey,
  isValidEmail,
  sanitizeFmeBaseUrl,
  validateServerUrlKey,
  validateTokenKey,
  validateRepositoryKey,
  getEmailValidationError,
  extractErrorMessage,
  extractHttpStatus,
  buildSupportHintText,
  getSupportEmail,
} from "../shared/utils"

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

  test("sanitizeFmeBaseUrl strips /fmerest and trailing slash; invalid URL flagged", () => {
    const a = sanitizeFmeBaseUrl("https://example.com/fmerest/v3/")
    expect(a.isValid).toBe(true)
    expect(a.cleaned).toBe("https://example.com")
    expect(a.changed).toBe(true)
    expect(a.errors).toEqual([])

    const b = sanitizeFmeBaseUrl("https://example.com/base")
    expect(b.isValid).toBe(true)
    expect(b.cleaned).toBe("https://example.com/base")
    expect(b.changed).toBe(false)

    const c = sanitizeFmeBaseUrl("not a url")
    expect(c.isValid).toBe(false)
    expect(c.cleaned).toBe("not a url")
    expect(c.errors).toEqual(["invalidUrl"])
  })

  test("validateServerUrlKey enforces protocol, host, credentials, and path rules", () => {
    // Missing
    expect(validateServerUrlKey("")).toBe("errorMissingServerUrl")
    // Invalid parse
    expect(validateServerUrlKey("bad")).toBe("errorInvalidServerUrl")
    // Unsupported protocol
    expect(validateServerUrlKey("ftp://example.com")).toBe(
      "errorInvalidServerUrl"
    )
    // Embedded credentials forbidden
    expect(validateServerUrlKey("http://user:pass@example.com")).toBe(
      "errorInvalidServerUrl"
    )
    // Forbidden FME path
    expect(validateServerUrlKey("https://example.com/fmerest/v3")).toBe(
      "errorBadBaseUrl"
    )
    // Single-label hosts may be allowed (e.g., dev hostnames); ensure it does not produce an error
    expect(validateServerUrlKey("https://bad")).toBeNull()
    // Valid cases
    expect(validateServerUrlKey("https://localhost")).toBeNull()
    expect(validateServerUrlKey("http://192.168.0.1")).toBeNull()
    expect(validateServerUrlKey("https://example.com")).toBeNull()
    expect(validateServerUrlKey("https://my-fmeflow")).toBeNull()
  })

  test("validateTokenKey enforces length, whitespace, control chars, and blacklist of symbols", () => {
    expect(validateTokenKey("")).toBe("errorMissingToken")
    expect(validateTokenKey("short")).toBe("errorTokenIsInvalid")
    expect(validateTokenKey("has space 12345")).toBe("errorTokenIsInvalid")
    // Control character \x01
    expect(validateTokenKey("validtoken1" + String.fromCharCode(1))).toBe(
      "errorTokenIsInvalid"
    )
    expect(validateTokenKey("bad<token>12345")).toBe("errorTokenIsInvalid")
    expect(validateTokenKey("good_token_12345")).toBeNull()
  })

  test("validateRepositoryKey checks required and existence when repos provided", () => {
    expect(validateRepositoryKey("", null)).toBeNull()
    expect(validateRepositoryKey("", [])).toBeNull()
    expect(validateRepositoryKey("", ["A"])).toBe("errorRepoRequired")
    expect(validateRepositoryKey("B", ["A"])).toBe("errorRepositoryNotFound")
    expect(validateRepositoryKey("A", ["A"])).toBeNull()
  })

  test("getEmailValidationError is optional and validates format", () => {
    expect(getEmailValidationError("")).toBeNull()
    expect(getEmailValidationError("foo@bar")).toBe("errorInvalidEmail")
    expect(getEmailValidationError("user@ex.com")).toBeNull()
  })

  test("extractErrorMessage handles primitives, Error, common fields, and object fallback", () => {
    expect(extractErrorMessage(undefined)).toBe("unknownErrorOccurred")
    expect(extractErrorMessage("msg")).toBe("msg")
    expect(extractErrorMessage(404)).toBe("404")
    expect(extractErrorMessage(new Error("boom"))).toBe("boom")
    expect(extractErrorMessage({ message: "m" })).toBe("m")
    expect(extractErrorMessage({ error: "e" })).toBe("e")
    expect(extractErrorMessage({ description: "d" })).toBe("d")
    expect(extractErrorMessage({ detail: "x" })).toBe("x")
    expect(extractErrorMessage({ reason: "r" })).toBe("r")
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
