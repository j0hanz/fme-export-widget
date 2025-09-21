import {
  isInt,
  isNum,
  normalizeBaseUrl,
  validateServerUrl,
  validateToken,
  validateRepository,
  extractHttpStatus,
  mapErrorToKey,
  isValidExternalUrlForOptGetUrl,
  validateRequiredConfig,
  validateConfigFields,
  HTTP_STATUS_CODES,
  isAuthError,
  validateConnectionInputs,
  validateRequiredFields,
  createError,
  validateDateTimeFormat,
  sanitizeFormValues,
  calcArea,
  validatePolygon,
  checkMaxArea,
  processFmeResponse,
} from "../shared/validations"
import { ErrorSeverity } from "../config"

// Partially mock utils to keep maskToken deterministic, while using real implementations for others
jest.mock("../shared/utils", () => {
  const actual = jest.requireActual("../shared/utils")
  return {
    ...actual,
    maskToken: (v: string) => `****${v.slice(-4)}`,
  }
})

describe("number helpers", () => {
  test("isInt detects integers from number and string", () => {
    expect(isInt(5)).toBe(true)
    expect(isInt(-3)).toBe(true)
    expect(isInt(5.1)).toBe(false)
    expect(isInt("10")).toBe(true)
    expect(isInt("  20  ")).toBe(true)
    expect(isInt("3.14")).toBe(false)
    expect(isInt(undefined as any)).toBe(false)
  })

  test("isNum detects finite numbers from number and string", () => {
    expect(isNum(0)).toBe(true)
    expect(isNum(-123.45)).toBe(true)
    expect(isNum(Infinity)).toBe(false)
    expect(isNum("1.5")).toBe(true)
    expect(isNum("  -2  ")).toBe(true)
    expect(isNum("abc")).toBe(false)
    expect(isNum(null as any)).toBe(false)
  })
})

describe("URL helpers", () => {
  test("normalizeBaseUrl strips /fmerest and trailing bits", () => {
    expect(
      normalizeBaseUrl("https://example.com/fmerest/v3/resources?x=1#y")
    ).toBe("https://example.com")
  })

  test("normalizeBaseUrl preserves base path and removes trailing slash", () => {
    expect(normalizeBaseUrl("https://ex.com/base/")).toBe("https://ex.com/base")
    expect(normalizeBaseUrl("https://ex.com/")).toBe("https://ex.com")
  })

  test("validateServerUrl basic acceptance and rejections", () => {
    expect(validateServerUrl("")).toEqual({
      ok: false,
      key: "errorMissingServerUrl",
    })
    expect(validateServerUrl("notaurl")).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
    expect(validateServerUrl("ftp://example.com")).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
    expect(validateServerUrl("http://user:pass@example.com")).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
    expect(validateServerUrl("https://ex.com/base?x=1")).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
    expect(validateServerUrl("https://ex.com/#frag")).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
    expect(validateServerUrl("https://ex.com/fmerest")).toEqual({
      ok: false,
      key: "errorBadBaseUrl",
    })
    expect(validateServerUrl("https://host.")).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })

    expect(validateServerUrl("http://ex.com")).toEqual({ ok: true })
    expect(validateServerUrl("https://ex.com", { requireHttps: true })).toEqual(
      { ok: true }
    )
    expect(validateServerUrl("http://ex.com", { requireHttps: true })).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
  })

  test("validateServerUrl strict host heuristic", () => {
    expect(validateServerUrl("http://a", { strict: true })).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
    expect(validateServerUrl("http://localhost", { strict: true })).toEqual({
      ok: false,
      key: "errorInvalidServerUrl",
    })
    expect(validateServerUrl("http://good.host", { strict: true })).toEqual({
      ok: true,
    })
  })

  test("isValidExternalUrlForOptGetUrl enforces https and no creds", () => {
    expect(isValidExternalUrlForOptGetUrl(undefined)).toBe(false)
    expect(isValidExternalUrlForOptGetUrl(" ")).toBe(false)
    expect(isValidExternalUrlForOptGetUrl("http://ex.com/file.zip")).toBe(false)
    expect(
      isValidExternalUrlForOptGetUrl("https://user:pass@ex.com/file.zip")
    ).toBe(false)
    expect(isValidExternalUrlForOptGetUrl("https://ex.com/file.zip")).toBe(true)
  })
})

describe("token & repository validators", () => {
  test("validateToken: various invalid cases", () => {
    expect(validateToken("")).toEqual({ ok: false, key: "errorMissingToken" })
    expect(validateToken("short")).toEqual({
      ok: false,
      key: "errorTokenIsInvalid",
    })
    expect(validateToken("contains space ")).toEqual({
      ok: false,
      key: "errorTokenIsInvalid",
    })
    expect(validateToken("bad<chars>here")).toEqual({
      ok: false,
      key: "errorTokenIsInvalid",
    })
    // control char (charCode 7)
    expect(validateToken("goodprefix" + String.fromCharCode(7))).toEqual({
      ok: false,
      key: "errorTokenIsInvalid",
    })
  })

  test("validateToken: accepts long safe strings", () => {
    expect(validateToken("abcdefghijklmnopqrstuvwxyz0123456789")).toEqual({
      ok: true,
    })
  })

  test("validateRepository with available list", () => {
    expect(validateRepository("", ["A", "B"])).toEqual({
      ok: false,
      key: "errorRepoRequired",
    })
    expect(validateRepository("Z", ["A", "B"])).toEqual({
      ok: false,
      key: "errorRepositoryNotFound",
    })
    expect(validateRepository("A", ["A", "B"])).toEqual({ ok: true })
  })

  test("validateRepository when list not loaded (null)", () => {
    expect(validateRepository("anything", null)).toEqual({ ok: true })
  })
})

describe("error mapping & extraction", () => {
  test("extractHttpStatus from direct fields and details/message", () => {
    expect(extractHttpStatus({ status: 404 })).toBe(404)
    expect(extractHttpStatus({ statusCode: 502 })).toBe(502)
    expect(extractHttpStatus({ httpStatus: 431 })).toBe(431)
    expect(extractHttpStatus({ details: { status: 503 } })).toBe(503)
    expect(extractHttpStatus({ details: { httpStatus: 429 } })).toBe(429)
    expect(
      extractHttpStatus({ message: "something status: 401 happened" })
    ).toBe(401)
    expect(extractHttpStatus({})).toBeUndefined()
  })

  test("mapErrorToKey respects code mapping and status heuristics", () => {
    expect(mapErrorToKey({ code: "INVALID_RESPONSE_FORMAT" })).toBe(
      "startupTokenError"
    )
    expect(mapErrorToKey({ code: "REQUEST_FAILED" }, 404)).toBe(
      "connectionFailed"
    )
    expect(mapErrorToKey({ code: "REQUEST_FAILED" }, 0)).toBe(
      "startupNetworkError"
    )
    expect(mapErrorToKey({ code: "REQUEST_FAILED" }, 500)).toBe(
      "startupServerError"
    )
    expect(mapErrorToKey({}, 401)).toBe("startupTokenError")
    expect(mapErrorToKey(new Error("Failed to fetch"))).toBe(
      "startupNetworkError"
    )
    expect(mapErrorToKey(new Error("timeout while waiting"))).toBe("timeout")
    expect(mapErrorToKey(new Error("CORS blocked"))).toBe("corsError")
    expect(mapErrorToKey(new Error("URL too large"))).toBe("urlTooLong")
    expect(mapErrorToKey(new Error("unmapped"))).toBe("unknownErrorOccurred")
  })
})

describe("config validators", () => {
  test("validateRequiredConfig throws when any missing", () => {
    expect(() => {
      validateRequiredConfig({})
    }).toThrow("Missing required configuration")
    expect(() => {
      validateRequiredConfig({ serverUrl: "x", token: "y" })
    }).toThrow()
  })

  test("validateRequiredConfig passes with all fields", () => {
    expect(() => {
      validateRequiredConfig({ serverUrl: "x", token: "y", repository: "r" })
    }).not.toThrow()
  })

  test("validateConfigFields returns missing field keys", () => {
    const none = validateConfigFields({
      fmeServerUrl: "https://ex.com",
      fmeServerToken: "0123456789abcdef",
      repository: "repo",
    } as any)
    expect(none).toEqual({ isValid: true, missingFields: [] })

    const some = validateConfigFields({
      fmeServerUrl: " ",
      fmeServerToken: "",
      repository: "",
    } as any)
    expect(some.isValid).toBe(false)
    expect(new Set(some.missingFields)).toEqual(
      new Set(["fmeServerUrl", "fmeServerToken", "repository"])
    )
  })

  test("validateConnectionInputs aggregates errors and respects repo list state", () => {
    const res1 = validateConnectionInputs({
      url: "https://ex.com",
      token: "bad",
      repository: "",
      availableRepos: ["A"],
    })
    expect(res1.ok).toBe(false)
    expect(res1.errors.serverUrl).toBeUndefined()
    expect(res1.errors.token).toBe("errorTokenIsInvalid")
    expect(res1.errors.repository).toBe("errorRepoRequired")

    const res2 = validateConnectionInputs({
      url: "notaurl",
      token: "abcdefghij",
      repository: "X",
      availableRepos: null, // skip repo validation
    })
    expect(res2.ok).toBe(false)
    expect(res2.errors.serverUrl).toBe("errorInvalidServerUrl")
    expect(res2.errors.repository).toBeUndefined()
  })

  test("validateRequiredFields derives canProceed flags", () => {
    const ok = validateRequiredFields(
      { fmeServerUrl: "u", fmeServerToken: "t", repository: "r" } as any,
      (k) => k
    )
    expect(ok).toEqual({
      isValid: true,
      canProceed: true,
      requiresSettings: false,
    })

    const missing = validateRequiredFields({} as any, (k) => k)
    expect(missing).toEqual({
      isValid: false,
      canProceed: false,
      requiresSettings: true,
    })
  })

  test("validateRequiredFields considers mapConfigured flag", () => {
    const cfg = {
      fmeServerUrl: "https://ex",
      fmeServerToken: "0123456789abcdef",
      repository: "repo",
    } as any
    const res = validateRequiredFields(cfg, (k) => k, { mapConfigured: false })
    expect(res).toEqual({
      isValid: false,
      canProceed: false,
      requiresSettings: true,
    })
  })
})

describe("error object factory", () => {
  test("createError uses i18n and defaults", () => {
    const translate = (k: string) =>
      k === "checkConnectionSettings" ? "Check settings" : `T:${k}`
    const e = createError("messageKey", 1 as any, "CODE", translate)
    expect(e.message).toBe("T:messageKey")
    expect(e.suggestion).toBe("Check settings")
    expect(e.severity).toBe(ErrorSeverity.ERROR)
    expect(typeof e.timestampMs).toBe("number")
    expect(e.recoverable).toBe(true)

    const e2 = createError("msg", 1 as any, "CODE", () => "")
    expect(e2.message).toBe("msg")
    expect(e2.suggestion).toBe("")
  })
})

describe("date/time format", () => {
  test("validateDateTimeFormat strict pattern", () => {
    expect(validateDateTimeFormat("2024-01-31 23:59:59")).toBe(true)
    expect(validateDateTimeFormat("2024-1-31 23:59:59")).toBe(false)
    expect(validateDateTimeFormat("2024-01-31T23:59:59")).toBe(false)
    expect(validateDateTimeFormat("invalid")).toBe(false)
  })
})

describe("form values sanitization", () => {
  test("sanitizeFormValues masks only PASSWORD fields", () => {
    const values = { a: "one", secret: "mysecretvalue" }
    const params = [
      { name: "secret", type: "PASSWORD" },
      { name: "a", type: "TEXT" },
    ]
    const masked = sanitizeFormValues(values, params)
    expect(masked.a).toBe("one")
    expect(masked.secret).toBe("****alue") // last 4 preserved by mocked maskToken
  })

  test("sanitizeFormValues no-op when no passwords or falsy input", () => {
    expect(sanitizeFormValues(null as any, [])).toBeNull()
    const values = { a: "one" }
    expect(sanitizeFormValues(values, [{ name: "b", type: "TEXT" }])).toBe(
      values
    )
  })
})

describe("geometry helpers (no JSAPI)", () => {
  test("calcArea handles missing modules/geometry", () => {
    expect(calcArea(undefined as any, {})).toBe(0)
    expect(calcArea({ type: "point" } as any, { geometryEngine: {} })).toBe(0)
  })

  test("calcArea returns finite non-negative or 0 on bad result/exception", () => {
    const polygon = { type: "polygon" } as any
    const modules1 = { geometryEngine: { planarArea: () => 1234.56 } }
    expect(calcArea(polygon, modules1)).toBe(1234.56)

    const modules2 = { geometryEngine: { planarArea: () => -10 } }
    expect(calcArea(polygon, modules2)).toBe(0)

    const modules3 = {
      geometryEngine: {
        planarArea: () => {
          throw new Error("boom")
        },
      },
    }
    expect(calcArea(polygon, modules3)).toBe(0)
  })

  test("validatePolygon covers cases", () => {
    const res1 = validatePolygon(undefined as any, {})
    expect(res1.valid).toBe(false)
    expect(res1.error?.code).toBe("NO_GEOMETRY")

    const res2 = validatePolygon({ type: "point" } as any, {})
    expect(res2.valid).toBe(false)
    expect(res2.error?.code).toBe("INVALID_GEOMETRY_TYPE")

    const res3 = validatePolygon({ type: "polygon" } as any, {})
    expect(res3.valid).toBe(true) // no geometryEngine implies skip validation

    const modules = { geometryEngine: { isSimple: () => false } }
    const res4 = validatePolygon({ type: "polygon" } as any, modules)
    expect(res4.valid).toBe(false)
    expect(res4.error?.code).toBe("INVALID_GEOMETRY")

    const modulesThrow = {
      geometryEngine: {
        isSimple: () => {
          throw new Error("boom")
        },
      },
    }
    const res5 = validatePolygon({ type: "polygon" } as any, modulesThrow)
    expect(res5.valid).toBe(false)
    expect(res5.error?.code).toBe("GEOMETRY_VALIDATION_ERROR")
  })

  test("checkMaxArea enforces configured limit", () => {
    expect(checkMaxArea(10, undefined)).toEqual({ ok: true })
    expect(checkMaxArea(5, 10)).toEqual({ ok: true })
    expect(checkMaxArea(15, 10)).toEqual({
      ok: false,
      message: "AREA_TOO_LARGE",
      code: "AREA_TOO_LARGE",
    })
  })
})

describe("FME response processing", () => {
  const t = (k: string) => k

  test("returns failure when no data present", () => {
    const out = processFmeResponse({}, "ws", "user@ex.com", t)
    expect(out.success).toBe(false)
    expect(out.message).toBe("noDataInResponse")
    expect(out.code).toBe("NO_DATA")
  })

  test("handles blob download response", () => {
    const blob = new Blob(["abc"], { type: "application/zip" })
    const out = processFmeResponse({ data: { blob } }, "myws", "u@e.com", t)
    expect(out.success).toBe(true)
    expect(out.blob).toBe(blob)
    expect(out.downloadFilename).toBe("myws_export.zip")
  })

  test("handles service response success by status or direct URL", () => {
    const byStatus = processFmeResponse(
      { data: { serviceResponse: { status: "success", jobID: 42 } } },
      "ws",
      "u@e.com",
      t
    )
    expect(byStatus.success).toBe(true)
    expect(byStatus.jobId).toBe(42)

    const byUrl = processFmeResponse(
      { data: { url: "https://ex.com/file.zip", id: 7 } },
      "ws",
      "u@e.com",
      t
    )
    expect(byUrl.success).toBe(true)
    expect(byUrl.downloadUrl).toBe("https://ex.com/file.zip")
    expect(byUrl.downloadFilename).toBe("ws_export.zip")
  })

  test("handles service response failure with message precedence", () => {
    const m1 = processFmeResponse(
      {
        data: {
          serviceResponse: { statusInfo: { status: "failed", message: "m1" } },
        },
      },
      "ws",
      "u@e.com",
      t
    )
    expect(m1.success).toBe(false)
    expect(m1.message).toBe("m1")

    const m2 = processFmeResponse(
      { data: { message: "fallback" } },
      "ws",
      "u@e.com",
      t
    )
    expect(m2.success).toBe(false)
    expect(m2.message).toBe("fallback")

    const m3 = processFmeResponse({ data: {} }, "ws", "u@e.com", t)
    expect(m3.success).toBe(false)
    expect(m3.message).toBe("fmeJobSubmissionFailed")
  })
})

describe("HTTP constants and helpers", () => {
  test("isAuthError true only for 401/403", () => {
    expect(isAuthError(HTTP_STATUS_CODES.UNAUTHORIZED)).toBe(true)
    expect(isAuthError(HTTP_STATUS_CODES.FORBIDDEN)).toBe(true)
    expect(isAuthError(HTTP_STATUS_CODES.NOT_FOUND)).toBe(false)
    expect(isAuthError(500)).toBe(false)
  })
})
