import type { FmeExportConfig } from "../config"

import {
  isEmpty,
  isValidEmail,
  getSupportEmail,
  asString,
  makePlaceholders,
  getTextPlaceholder,
  computeSelectCoerce,
  parseTableRows,
  resolveMessageOrKey,
  maskEmailForDisplay,
  EMAIL_PLACEHOLDER,
  buildSupportHintText,
  stripHtmlToText,
  styleCss,
  setError,
  clearErrors,
  safeAbort,
  maskToken,
  ariaDesc,
  getBtnAria,
  getErrorIconSrc,
  sanitizeParamKey,
  collectTrimmedStrings,
  uniqueStrings,
  extractRepositoryNames,
  isPolygonGeometry,
  determineServiceMode,
  buildFmeParams,
  polygonJsonToGeoJson,
  polygonJsonToWkt,
  toWgs84PolygonJson,
  attachAoi,
  applyDirectiveDefaults,
  applyEngineDirectives,
  prepFmeParams,
  formatArea,
  getEmail,
  toStr,
  buildUrl,
  resolveRequestUrl,
  buildParams,
  coerceFormValueForSubmission,
  safeLogParams,
  createHostPattern,
  interceptorExists,
  makeScopeId,
  makeGeoJson,
  isJson,
  safeParseUrl,
  extractHostFromUrl,
  extractErrorMessage,
  parseNonNegativeInt,
  pad2,
  fmeDateTimeToInput,
  inputToFmeDateTime,
  fmeDateToInput,
  inputToFmeDate,
  fmeTimeToInput,
  inputToFmeTime,
  normalizedRgbToHex,
  hexToNormalizedRgb,
  toIsoLocal,
  fromIsoLocal,
  normalizeFormValue,
  toSerializable,
  isFileObject,
  getFileDisplayName,
  stripErrorLabel,
  initFormValues,
  canResetButton,
  shouldShowWorkspaceLoading,
} from "../shared/utils"
import { ParameterType } from "../config"
import * as logging from "../shared/logging"

// Mock jimu-core: SessionManager and css helper
let mockUserEmail: any = null
jest.mock("jimu-core", () => {
  return {
    SessionManager: {
      getInstance: () => ({
        getUserInfo: jest.fn(() => Promise.resolve({ email: mockUserEmail })),
      }),
    },
    css: jest.fn(() => "__css__"),
  }
})

const t = (key: string, params?: { [k: string]: unknown }) =>
  params && "field" in params ? `${key}:${params.field as string}` : key

describe("shared/utils", () => {
  describe("primitives and strings", () => {
    test("isEmpty handles basic cases", () => {
      expect(isEmpty(undefined)).toBe(true)
      expect(isEmpty(null)).toBe(true)
      expect(isEmpty("")).toBe(true)
      expect(isEmpty("   ")).toBe(true)
      expect(isEmpty([])).toBe(true)
      expect(isEmpty([1])).toBe(false)
      expect(isEmpty("x")).toBe(false)
    })

    test("isValidEmail and getSupportEmail", () => {
      expect(isValidEmail("user@example.com")).toBe(true)
      expect(isValidEmail("no-reply@x.com")).toBe(false)
      expect(getSupportEmail("  admin@org.com  ")).toBe("admin@org.com")
      expect(getSupportEmail("bad")).toBeUndefined()
    })

    test("asString converts numbers only", () => {
      expect(asString("abc")).toBe("abc")
      expect(asString(123)).toBe("123")
      expect(asString(true as any)).toBe("")
    })

    test("placeholders and getTextPlaceholder", () => {
      const ph = makePlaceholders(t, "Email")
      expect(ph.enter).toBe("placeholderEnter:Email")
      expect(ph.select).toBe("placeholderSelect:Email")
      expect(getTextPlaceholder({ placeholder: "Custom" }, ph, t)).toBe(
        "Custom"
      )
      expect(getTextPlaceholder(undefined, ph, t, "email")).toBe(
        "placeholderEmail"
      )
      expect(getTextPlaceholder(undefined, ph, t, "search")).toBe(
        "placeholderSearch"
      )
      expect(getTextPlaceholder(undefined, ph, t)).toBe(ph.enter)
    })

    test("computeSelectCoerce detects numeric options", () => {
      expect(computeSelectCoerce(true, [{ value: "1" }, { value: "2" }])).toBe(
        "number"
      )
      expect(
        computeSelectCoerce(true, [{ value: "1" }, { value: "x" }])
      ).toBeUndefined()
      expect(computeSelectCoerce(false, [{ value: "1" }])).toBeUndefined()
      expect(computeSelectCoerce(true, [])).toBeUndefined()
    })

    test("parseTableRows handles arrays and strings", () => {
      expect(parseTableRows([1, "a"])).toEqual(["1", "a"])
      // Invalid JSON falls back to returning the original string as one row
      expect(parseTableRows("[1,2,'x']")).toEqual(["[1,2,'x']"])
      expect(parseTableRows("plain")).toEqual(["plain"])
      expect(parseTableRows(123 as any)).toEqual([])
    })

    test("collectTrimmedStrings removes blanks and non-strings", () => {
      expect(collectTrimmedStrings([" a ", "", null, 42, undefined])).toEqual([
        "a",
      ])
    })

    test("uniqueStrings preserves order and removes duplicates", () => {
      expect(uniqueStrings(["a", "b", "a", "a", "c"])).toEqual(["a", "b", "c"])
    })

    test("extractRepositoryNames handles arrays and nested collections", () => {
      expect(
        extractRepositoryNames([
          { name: " RepoA " },
          { name: "" },
          { name: null },
        ])
      ).toEqual(["RepoA"])

      expect(
        extractRepositoryNames({
          items: [{ name: "RepoB" }, { name: "RepoA" }],
        })
      ).toEqual(["RepoB", "RepoA"])
    })

    test("resolveMessageOrKey exact and camel-case", () => {
      const tr = (k: string) => (k === "hello_world" ? "Hola" : k)
      expect(resolveMessageOrKey("hello_world", tr)).toBe("Hola")
      const tr2 = (k: string) => (k === "helloWorld" ? "Bonjour" : k)
      expect(resolveMessageOrKey("HELLO_WORLD", tr2)).toBe("Bonjour")
      const tr3 = (k: string) => k
      expect(resolveMessageOrKey("NotFound", tr3)).toBe("NotFound")
    })

    test("maskEmailForDisplay and support hint", () => {
      expect(maskEmailForDisplay("x@a.com")).toBe("**@a.com")
      expect(maskEmailForDisplay("john.doe@esri.com")).toBe("jo****@esri.com")
      expect(EMAIL_PLACEHOLDER.test("{ email } ")).toBe(true)
      const hint = buildSupportHintText(
        (k) => (k === "contactSupportWithEmail" ? "email: {email}" : k),
        "help@org.com"
      )
      expect(hint).toBe("email: help@org.com")
      expect(buildSupportHintText((k) => k, undefined, "Use portal")).toBe(
        "Use portal"
      )
      expect(buildSupportHintText((k) => k)).toBe("")
    })

    test("stripHtmlToText removes tags, script/style", () => {
      const html =
        "<div>Hello <b>World</b><style>x{}</style><script>1</script></div>"
      expect(stripHtmlToText(html)).toBe("Hello World")
      expect(stripHtmlToText(undefined)).toBe("")
    })

    test("styleCss calls css when style provided", () => {
      const res = styleCss({ color: "red" } as any)
      expect(res).toBe("__css__")
      expect(styleCss(undefined)).toBeUndefined()
    })

    test("setError and clearErrors update state object", () => {
      let state: any = { a: 1, err: "old" }
      const set = (updater: any) => {
        state = updater(state)
      }
      setError(set, "err", "bad")
      expect(state.err).toBe("bad")
      clearErrors(set, ["err", "missing" as any])
      expect(state.err).toBeUndefined()
      expect(state.a).toBe(1)
    })

    test("safeAbort calls controller.abort", () => {
      const ctrl = { abort: jest.fn() } as any
      safeAbort(ctrl)
      expect(ctrl.abort).toHaveBeenCalled()
      safeAbort(null)
    })

    test("maskToken, ariaDesc, getBtnAria, getErrorIconSrc", () => {
      expect(maskToken("abcdef")).toBe("****cdef")
      expect(ariaDesc("id")).toBe("id-error")
      expect(getBtnAria("Text", true)).toBe("Text")
      expect(getBtnAria(undefined, false)).toBeUndefined()
      expect(getBtnAria(undefined, true, undefined, "Tip", "Fb")).toBe("Tip")
      expect(getErrorIconSrc()).toBe("error")
      expect(getErrorIconSrc("network error")).toBe("shared-no")
      expect(getErrorIconSrc("token invalid")).toBe("person-lock")
      expect(getErrorIconSrc("server down")).toBe("feature-service")
      expect(getErrorIconSrc("repo missing")).toBe("folder")
      expect(getErrorIconSrc("url bad")).toBe("link-tilted")
      expect(getErrorIconSrc("timeout")).toBe("time")
      expect(getErrorIconSrc("config")).toBe("setting")
      expect(getErrorIconSrc("email")).toBe("email")
      expect(getErrorIconSrc("geometry_serialization_failed")).toBe("polygon")
      expect(getErrorIconSrc("area_too_large")).toBe("polygon")
      expect(getErrorIconSrc("FORM_INVALID")).toBe("warning")
      expect(getErrorIconSrc("mapModulesLoadFailed")).toBe("map")
      expect(getErrorIconSrc("no_data")).toBe("data")
      expect(getErrorIconSrc("DATA_DOWNLOAD_ERROR")).toBe("data")
      expect(getErrorIconSrc("connection_error")).toBe("shared-no")
      expect(getErrorIconSrc("REQUEST_FAILED")).toBe("shared-no")
    })
  })

  describe("geometry and AOI", () => {
    test("sanitizeParamKey and isPolygonGeometry", () => {
      expect(sanitizeParamKey(" Area Of Interest! ", "Fallback")).toBe(
        "AreaOfInterest"
      )
      expect(sanitizeParamKey(123, "x")).toBe("123")
      expect(sanitizeParamKey({}, "x" as any)).toBe("x")

      const poly = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
      }
      expect(isPolygonGeometry(poly)).toBe(true)
      expect(isPolygonGeometry({})).toBe(false)
    })

    test("determineServiceMode", () => {
      expect(
        determineServiceMode({ data: { start: "2024-01-01" } }, {
          allowScheduleMode: true,
        } as any)
      ).toBe("schedule")
      expect(
        determineServiceMode({ data: { _serviceMode: "sync" } }, undefined)
      ).toBe("sync")
      expect(
        determineServiceMode({ data: {} }, { syncMode: true } as any)
      ).toBe("sync")
      expect(
        determineServiceMode({ data: { _serviceMode: "schedule" } }, {
          allowScheduleMode: false,
        } as any)
      ).toBe("async")
    })

    test("buildFmeParams includes async defaults and requester email", () => {
      const params = buildFmeParams({ data: { a: 1 } }, " user@x.com ", "async")
      expect(params.opt_servicemode).toBe("async")
      expect(params.opt_responseformat).toBe("json")
      expect(params.opt_showresult).toBe("true")
      expect(params.opt_requesteremail).toBe("user@x.com")
    })

    test("buildFmeParams respects config overrides", () => {
      const params = buildFmeParams({ data: {} }, "user@x.com", "sync", {
        config: {
          optResponseFormat: "xml",
          optShowResult: false,
        } as unknown as FmeExportConfig,
      })
      expect(params.opt_servicemode).toBe("sync")
      expect(params.opt_responseformat).toBe("xml")
      expect(params.opt_showresult).toBe("false")
      expect(params.opt_requesteremail).toBeUndefined()
    })

    test("polygon conversions: GeoJSON and WKT", () => {
      const poly = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
      }
      const gj = polygonJsonToGeoJson(poly)
      expect(gj.type).toBe("Polygon")
      expect(gj.coordinates[0][0]).toEqual([0, 0])
      const wkt = polygonJsonToWkt(poly)
      expect(wkt).toMatch(/^POLYGON\(/)
      expect(polygonJsonToWkt({})).toBe("POLYGON EMPTY")
    })

    test("toWgs84PolygonJson respects modules", () => {
      const wgsPoly = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
        spatialReference: { wkid: 4326 },
      }
      const modules1: any = {
        Polygon: { fromJSON: (j: any) => ({ ...j, toJSON: () => j }) },
      }
      expect(toWgs84PolygonJson(wgsPoly, modules1)).toEqual(wgsPoly)

      // WebMercator to Geographic
      const wmPoly = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
        spatialReference: { wkid: 3857 },
      }
      const modules2: any = {
        Polygon: {
          fromJSON: (j: any) => ({
            spatialReference: j.spatialReference,
            toJSON: () => j,
          }),
        },
        webMercatorUtils: {
          webMercatorToGeographic: (p: any) => ({
            toJSON: () => ({ ...p, spatialReference: { wkid: 4326 } }),
          }),
        },
      }
      const converted = toWgs84PolygonJson(wmPoly, modules2)
      const sr = (converted as { spatialReference?: { wkid?: number } })
        .spatialReference
      expect(sr?.wkid).toBe(4326)

      // No Polygon provided
      expect(toWgs84PolygonJson(wmPoly, null as any)).toEqual(wmPoly)
    })

    test("attachAoi serializes geometry and optional outputs", () => {
      const base = { x: 1 }
      const poly = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
        spatialReference: { wkid: 4326 },
      }
      const modules: any = {
        Polygon: { fromJSON: (j: any) => ({ ...j, toJSON: () => j }) },
      }
      const out = attachAoi(base, { geometry: poly }, undefined, modules, {
        aoiGeoJsonParamName: "AOI_GJ",
        aoiWktParamName: "AOI_WKT",
      } as any)
      expect(out.x).toBe(1)
      expect(typeof out.AreaOfInterest).toBe("string")
      expect(typeof out.AOI_GJ).toBe("string")
      expect(out.AOI_WKT).toMatch(/^POLYGON/)
    })

    test("attachAoi duplicates serialized AOI for geometry workspace parameters", () => {
      const geometry = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
        spatialReference: { wkid: 4326 },
      }
      const modules: any = {
        Polygon: { fromJSON: (j: any) => ({ ...j, toJSON: () => j }) },
      }
      const params = prepFmeParams(
        { data: {} },
        "user@x.com",
        geometry,
        undefined as any,
        modules,
        {
          workspaceParameters: [
            { name: "User AOI", type: ParameterType.GEOMETRY } as any,
            { name: "AreaOfInterest", type: ParameterType.GEOMETRY } as any,
            { name: "User AOI", type: ParameterType.GEOMETRY } as any,
          ],
        }
      )

      expect(params.AreaOfInterest).toBeDefined()
      expect(params.UserAOI).toBeDefined()
      expect(params.UserAOI).toBe(params.AreaOfInterest)
      expect(Object.keys(params).filter((k) => k === "UserAOI")).toHaveLength(1)
    })

    test("attachAoi returns error on serialization failure", () => {
      const base = {}
      const bad: any = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
        spatialReference: { wkid: 4326 },
      }
      bad.self = bad // create circular reference to break JSON.stringify
      const modules: any = {
        Polygon: { fromJSON: (j: any) => ({ ...j, toJSON: () => j }) },
      }
      const out = attachAoi(base, bad, undefined as any, modules)
      expect(Object.keys(out)).toContain("__aoi_error__")
      const err = (out as any).__aoi_error__
      expect(err.code).toBe("GEOMETRY_SERIALIZATION_FAILED")
    })

    test("applyDirectiveDefaults respects config, prepFmeParams integrates", () => {
      const cfg: any = {
        tm_ttc: "30",
        tm_ttl: 60,
        tm_tag: " tag ",
        tm_queue: " queue ",
        tm_priority: "8",
        tm_rtc: true,
        tm_description: " detail ",
        syncMode: false,
      }
      const params = applyDirectiveDefaults({ a: 1 }, cfg)
      expect(params.tm_ttc).toBe(30)
      expect(params.tm_ttl).toBe(60)
      expect(params.tm_tag).toBe("tag")
      expect(params.tm_queue).toBe("queue")
      expect(params.tm_priority).toBe(8)
      expect(params.tm_rtc).toBe(true)
      expect(params.tm_description).toBe("detail")

      const modules: any = {
        Polygon: { fromJSON: (j: any) => ({ ...j, toJSON: () => j }) },
      }
      const p = prepFmeParams(
        { data: { start: "2024-01-01" } },
        "user@x.com",
        {
          rings: [
            [
              [0, 0],
              [1, 1],
              [2, 2],
            ],
          ],
          spatialReference: { wkid: 4326 },
        },
        undefined as any,
        modules,
        {
          config: {
            allowScheduleMode: true,
            tm_ttc: 10,
            tm_queue: "Q1",
          } as any,
        }
      )
      expect(p.opt_servicemode).toBe("schedule")
      // requester email is only set for async mode
      expect((p as any).opt_requesteremail).toBeUndefined()
      expect(p.tm_ttc).toBe(10)
      expect(p.tm_queue).toBe("Q1")
      expect(p.AreaOfInterest).toBeTruthy()
      expect(Object.prototype.hasOwnProperty.call(p, "_serviceMode")).toBe(
        false
      )
      expect(p.start).toBe("2024-01-01")
    })

    test("applyEngineDirectives sanitizes keys and preserves existing values", () => {
      const base = { existing: 1, fme_QUEUE: "keep" }
      const params = applyEngineDirectives(base, {
        engineDirectives: {
          " fme_queue ": " override ",
          fme_long: "x".repeat(1105),
          fme_bool: false,
          other: "ignored",
        },
      } as unknown as FmeExportConfig)

      expect(params.existing).toBe(1)
      expect(params.fme_QUEUE).toBe("keep")
      expect(params.fme_LONG).toBeDefined()
      expect((params.fme_LONG as string).length).toBe(1024)
      expect(params.fme_BOOL).toBe("false")
      expect(params).not.toHaveProperty("other")
    })

    test("prepFmeParams removes schedule metadata when mode is sync", () => {
      const result = prepFmeParams(
        {
          data: {
            _serviceMode: "sync",
            start: " 2024-01-01 ",
            name: " report ",
            trigger: " custom ",
          },
        },
        "user@x.com",
        null,
        undefined as any,
        null,
        {
          config: { syncMode: true } as any,
        }
      ) as any

      expect(result.opt_servicemode).toBe("sync")
      expect(result.start).toBeUndefined()
      expect(result.name).toBeUndefined()
      expect(result.trigger).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(result, "_serviceMode")).toBe(
        false
      )
    })
  })

  describe("formatting and dates", () => {
    test("formatArea uses intl when available", () => {
      const modules: any = {
        intl: {
          formatNumber: (v: number, opts: any) =>
            v.toFixed(opts.maximumFractionDigits),
        },
      }
      expect(formatArea(1500000, modules)).toBe("1.50 km²")
      expect(formatArea(123.4, modules)).toBe("123 m²")
      expect(formatArea(-1, modules)).toBe("0 m²")
    })

    test("getEmail reads from SessionManager and validates", async () => {
      mockUserEmail = "user@esri.com"
      await expect(getEmail()).resolves.toBe("user@esri.com")
      mockUserEmail = "bad-email"
      await expect(getEmail()).rejects.toMatchObject({ name: "INVALID_EMAIL" })
      mockUserEmail = null
      await expect(getEmail()).rejects.toMatchObject({
        name: "MISSING_REQUESTER_EMAIL",
      })
    })

    test("toStr handles types", () => {
      expect(toStr("x")).toBe("x")
      expect(toStr(1)).toBe("1")
      expect(toStr(true)).toBe("true")
      expect(toStr({ a: 1 })).toBe('{"a":1}')
    })

    test("date/time conversions", () => {
      expect(fmeDateTimeToInput("20240102131415")).toBe("2024-01-02T13:14:15")
      expect(fmeDateTimeToInput("202401021314")).toBe("2024-01-02T13:14")
      expect(fmeDateTimeToInput("20240102131415.25-08:00")).toBe(
        "2024-01-02T13:14:15"
      )
      expect(fmeDateTimeToInput("bad")).toBe("")

      expect(inputToFmeDateTime("2024-01-02T13:14:15")).toBe("20240102131415")
      expect(inputToFmeDateTime("2024-01-02T13:14")).toBe("20240102131400")
      expect(
        inputToFmeDateTime("2024-01-02T13:14:15", "20240102131415-08:00")
      ).toBe("20240102131415-08:00")
      expect(
        inputToFmeDateTime("2024-01-02T13:14:15", "20240102131415.25+0530")
      ).toBe("20240102131415.25+0530")
      expect(inputToFmeDateTime("2024-01-02T13:14:15.500Z")).toBe(
        "20240102131415.500Z"
      )
      expect(inputToFmeDateTime("bad")).toBe("")

      expect(fmeDateToInput("20240102")).toBe("2024-01-02")
      expect(inputToFmeDate("2024-01-02")).toBe("20240102")

      expect(fmeTimeToInput("1314")).toBe("13:14")
      expect(fmeTimeToInput("131415")).toBe("13:14:15")
      expect(fmeTimeToInput("131415.5-08:00")).toBe("13:14:15")
      expect(inputToFmeTime("13:14:15")).toBe("131415")
      expect(inputToFmeTime("13:14")).toBe("131400")
      expect(inputToFmeTime("13:14", "131400-08:00")).toBe("131400-08:00")
      expect(inputToFmeTime("13:14:00.75+05:30")).toBe("131400.75+05:30")
    })

    test("color conversions", () => {
      expect(normalizedRgbToHex("1,0,0")).toBe("#ff0000")
      expect(normalizedRgbToHex("0.5,0.5,0.5")).toBe("#808080")
      expect(normalizedRgbToHex("bad")).toBeNull()

      expect(hexToNormalizedRgb("#ffffff")).toBe("1,1,1")
      expect(hexToNormalizedRgb("#000000")).toBe("0,0,0")
      expect(hexToNormalizedRgb("bad")).toBeNull()
    })

    test("ISO local helpers", () => {
      expect(toIsoLocal("2024-01-02 03:04:05")).toBe("2024-01-02T03:04:05")
      expect(fromIsoLocal("2024-01-02T03:04:05")).toBe("2024-01-02 03:04:05")
      expect(toIsoLocal(undefined)).toBe("")
    })
  })

  describe("URL and params", () => {
    test("buildUrl and resolveRequestUrl", () => {
      expect(buildUrl("https://host/fmeserver", "/fmerest", "/v3")).toBe(
        "https://host/fmerest/v3"
      )
      expect(resolveRequestUrl("http://x/y", "https://h", "/fmerest")).toBe(
        "http://x/y"
      )
      expect(resolveRequestUrl("/fme/v3/jobs", "https://h", "/fmerest")).toBe(
        "https://h/fme/v3/jobs"
      )
      expect(resolveRequestUrl("/v3/jobs", "https://h", "/fmerest")).toBe(
        "https://h/fmerest/v3/jobs"
      )
      expect(resolveRequestUrl("jobs", "https://h", "/fmerest/v3")).toBe(
        "https://h/fmerest/v3/jobs"
      )
    })

    test("buildParams handles primitives, files, and defaults", () => {
      const fakeFile: any = { name: "a.txt", size: 1, type: "text/plain" }
      expect(isFileObject(fakeFile)).toBe(true)
      const p = buildParams(
        {
          a: 1,
          b: true,
          c: "x",
          file: fakeFile,
          skip: "z",
          opt_servicemode: "sync",
        } as any,
        ["skip"],
        true
      )
      const str = p.toString()
      expect(str).toContain("a=1")
      expect(str).toContain("b=true")
      expect(str).toContain("c=x")
      expect(str).toContain("file=a.txt")
      expect(str).toContain("opt_responseformat=json")
      expect(str).toContain("opt_showresult=true")
      expect(str).toContain("opt_servicemode=sync")
    })

    test("coerceFormValueForSubmission normalizes composite text or file values", () => {
      const file = new File(["abc"], "doc.txt", { type: "text/plain" })
      const textComposite = { mode: "text", text: "line" } as const
      const fileComposite = { mode: "file", file } as const
      const fallbackComposite = {
        mode: "file",
        file: null,
        fileName: "fallback.txt",
      } as const

      expect(coerceFormValueForSubmission(textComposite)).toBe("line")
      expect(coerceFormValueForSubmission(fileComposite)).toBe(file)
      expect(coerceFormValueForSubmission(fallbackComposite)).toBe(
        "fallback.txt"
      )
    })

    test("buildParams normalizes text-or-file composites before appending", () => {
      const file = new File(["content"], "payload.zip", {
        type: "application/zip",
      })
      const params = buildParams(
        {
          note: { mode: "text", text: "ready" },
          attachment: { mode: "file", file },
        } as any,
        []
      )

      expect(params.get("note")).toBe("ready")
      expect(params.get("attachment")).toBe("payload.zip")
    })

    test("safeLogParams only logs whitelisted and sanitized URL", () => {
      const spy = jest.spyOn(logging, "logDebug").mockImplementation(jest.fn())
      const url = "https://host/path?token=secret"
      const params = new URLSearchParams({ token: "x", opt_showresult: "true" })
      safeLogParams("label", url, params, ["opt_showresult"])
      expect(spy).toHaveBeenCalled()
      const [message, details] = spy.mock.calls[0]
      expect(message).toBe("label")
      const payload = (details || {}) as { url?: string; params?: string }
      expect(payload.url).toBe("https://host/path")
      expect(String(payload.params)).toContain("opt_showresult=true")
      spy.mockRestore()
    })

    test("host pattern and interceptorExists", () => {
      const pattern = createHostPattern("fmeserver.org")
      expect(pattern.test("https://fmeserver.org/x")).toBe(true)
      const interceptors = [
        { _fmeInterceptor: true, urls: "https://fmeserver.org/path" },
        { urls: /other/ },
      ]
      expect(interceptorExists(interceptors as any, pattern)).toBe(true)
    })

    test("makeScopeId deterministic", () => {
      const id1 = makeScopeId("https://h", "tok", "repo")
      const id2 = makeScopeId("https://h", "tok", "repo")
      expect(id1).toBe(id2)
    })

    test("geojson, json helpers, and URL parsing", () => {
      const poly: any = {
        rings: [
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        ],
        spatialReference: { wkid: 4326 },
      }
      const gj = makeGeoJson({ rings: poly.rings } as any)
      expect(gj.type).toBe("Polygon")
      expect(isJson("application/json;charset=utf-8")).toBe(true)
      expect(isJson("text/html")).toBe(false)
      expect(safeParseUrl("http://a/b")?.hostname).toBe("a")
      expect(safeParseUrl("bad")).toBeNull()
      expect(extractHostFromUrl("http://a/b")).toBe("a")
    })

    test("extractErrorMessage covers shapes", () => {
      expect(extractErrorMessage(undefined)).toBe("Unknown error")
      expect(extractErrorMessage("oops")).toBe("oops")
      expect(extractErrorMessage(404)).toBe("404")
      expect(extractErrorMessage(new Error("boom"))).toBe("boom")
      expect(extractErrorMessage({ message: "hi" })).toBe("hi")
      expect(extractErrorMessage({ error: "err" })).toBe("err")
      expect(extractErrorMessage({})).toBe("Unknown error occurred")
    })

    test("parseNonNegativeInt and pad2", () => {
      expect(parseNonNegativeInt("10")).toBe(10)
      expect(parseNonNegativeInt("-1")).toBeUndefined()
      expect(parseNonNegativeInt("bad")).toBeUndefined()
      expect(pad2(3)).toBe("03")
    })
  })

  describe("form helpers and errors", () => {
    test("normalizeFormValue", () => {
      expect(normalizeFormValue(undefined, false)).toBe("")
      expect(normalizeFormValue(undefined, true)).toEqual([])
      expect(normalizeFormValue("x", false)).toBe("x")
      expect(normalizeFormValue(1, false)).toBe(1)
      expect(normalizeFormValue("x", true)).toEqual(["x"])
    })

    test("toSerializable removes retry and normalizes timestampMs", () => {
      const err: any = {
        message: "m",
        timestamp: new Date(1700000000000),
        retry: jest.fn(),
      }
      const s = toSerializable(err)
      expect(s.retry).toBeUndefined()
      expect(s.timestampMs).toBe(1700000000000)
    })

    test("getFileDisplayName and stripErrorLabel", () => {
      const f: any = { name: "  file.txt  " }
      expect(getFileDisplayName(f)).toBe("file.txt")
      expect(getFileDisplayName({} as any)).toBe("unnamed-file")
      expect(stripErrorLabel("<b>Error</b>: Something bad")).toBe(
        "Something bad"
      )
      expect(stripErrorLabel("")).toBeUndefined()
    })

    test("initFormValues builds defaults", () => {
      const cfg = [{ name: "a", defaultValue: 1 }, { name: "b" }, {}] as any
      const v = initFormValues(cfg)
      expect(v).toEqual({ a: 1, b: "" })
    })

    test("canResetButton and shouldShowWorkspaceLoading", () => {
      const fn = jest.fn()
      expect(canResetButton(fn, true, "order-result", 10)).toBe(false)
      expect(canResetButton(fn, true, "drawing", 0, true)).toBe(true)
      expect(canResetButton(fn, true, "initial", 10)).toBe(false)
      expect(canResetButton(undefined, true, "initial", 10)).toBe(false)

      expect(shouldShowWorkspaceLoading(true, [], "workspace-selection")).toBe(
        true
      )
      expect(
        shouldShowWorkspaceLoading(false, [], "export-options", true)
      ).toBe(false)
    })
  })
})
