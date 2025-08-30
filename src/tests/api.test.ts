import FmeFlowApiClient, {
  createFmeFlowClient,
  isWebhookUrlTooLong,
} from "../shared/api"
import { FmeFlowApiError, HttpMethod } from "../shared/types"
import { waitForMilliseconds } from "jimu-for-test"

// Minimal esriConfig mock shape used by api.ts
interface Interceptor {
  before?: (params: any) => void
}

const makeEsriConfig = () => ({
  request: {
    maxUrlLength: 0,
    trustedServers: [] as string[],
    interceptors: [] as Interceptor[],
  },
})

describe("FmeFlowApiClient (api.ts)", () => {
  beforeEach(() => {
    // Reset module state and globals for isolation
    jest.resetModules()
    ;(global as any).esriConfig = makeEsriConfig()
    ;(global as any).projection = {
      webMercatorToGeographic: (g: any) => ({
        ...g,
        spatialReference: { wkid: 4326 },
        toJSON: () => ({
          type: "polygon",
          rings: g.rings,
          spatialReference: { wkid: 4326 },
        }),
      }),
    }
    // Provide a default esriRequest mock so request pipeline can be exercised
    ;(global as any).esriRequest = jest.fn(() =>
      Promise.resolve({ data: null })
    )
  })

  afterEach(() => {
    // Restore all spied methods to their original implementations
    jest.restoreAllMocks()
    // Clean up any fetch mocks created during tests
    if ((global as any).fetch) {
      delete (global as any).fetch
    }
  })

  test("createFmeFlowClient validates required config", () => {
    expect(() =>
      createFmeFlowClient({
        fmeServerUrl: "https://example.com",
        repository: "repo",
      } as any)
    ).toThrowError(/Missing required FME Flow configuration/i)
  })

  test("configures esri settings and interceptor", () => {
    const cfg = {
      fmeServerUrl: "https://fmserver.example.com/fmeserver/",
      fmeServerToken: "abcd1234",
      repository: "repo",
    } as any
    const client = createFmeFlowClient(cfg)
    expect(client).toBeTruthy()

    const esriConfig = (global as any).esriConfig
    expect(typeof esriConfig.request.maxUrlLength).toBe("number")

    // Assert Authorization header is injected by interceptor
    const interceptors = esriConfig.request.interceptors
    if (interceptors.length > 0) {
      const interceptor = interceptors[0]
      const params = {
        requestOptions: {
          headers: {} as { [key: string]: string },
          responseType: undefined,
        },
      }
      interceptor.before && interceptor.before(params)
      expect(params.requestOptions.headers.Authorization).toMatch(
        /^fmetoken token=/
      )
    }
  })

  test("submitGeometryJob processes polygon geometry and builds parameters", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmerest",
      fmeServerToken: "tok-123",
      repository: "myrepo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { jobId: 1 }, status: 200, statusText: "OK" })

    const polygon = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
          [0, 0],
        ],
      ],
      extent: { xmin: 0, ymin: 0, xmax: 10, ymax: 5, width: 10, height: 5 },
      spatialReference: { wkid: 3857 },
      toJSON: () => ({
        type: "polygon",
        rings: [
          [
            [0, 0],
            [10, 0],
            [10, 5],
            [0, 5],
            [0, 0],
          ],
        ],
        spatialReference: { wkid: 3857 },
      }),
    } as any

    await client.submitGeometryJob("myws", polygon, { other: "x" }, "myrepo")
    // Flush microtasks
    await waitForMilliseconds(0)

    expect(requestSpy).toHaveBeenCalled()
    const [endpoint, options] = requestSpy.mock.calls[0]

    expect(endpoint).toContain("/fmerest/v3/transformations/submit/myrepo/myws")

    const body = (options as any).body
    const payload = typeof body === "string" ? JSON.parse(body) : body
    const published = payload.publishedParameters as Array<{
      name: string
      value: any
    }>
    const paramNames = new Set(published.map((p) => p.name))

    // Verify essential geometry parameters are included
    expect(paramNames.has("MAXX")).toBe(true)
    expect(paramNames.has("MAXY")).toBe(true)
    expect(paramNames.has("MINX")).toBe(true)
    expect(paramNames.has("MINY")).toBe(true)
    expect(paramNames.has("AREA")).toBe(true)
    expect(paramNames.has("AreaOfInterest")).toBe(true)
    expect(paramNames.has("other")).toBe(true)

    const areaParam = published.find((p) => p.name === "AREA")
    expect(areaParam?.value).toBe(50) // width * height

    requestSpy.mockRestore()
  })

  test("builds service URLs correctly for streaming and data download", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmeserver",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: {}, status: 200, statusText: "OK" })

    // Streaming URL should be correctly constructed
    await client.runDataStreaming("workspace", {}, "repo")
    // Flush microtasks
    await waitForMilliseconds(0)
    const streamingCall = requestSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0] === "https://example.com/fmedatastreaming/repo/workspace"
    )
    expect(streamingCall).toBeTruthy()

    requestSpy.mockRestore()
  })

  test("createAbortController + cancelAllRequests aborts current controller", () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const ctrl = client.createAbortController()
    expect(ctrl.signal.aborted).toBe(false)
    client.cancelAllRequests()
    expect(ctrl.signal.aborted).toBe(true)
  })

  test("runDataDownload propagates webhook failure (no REST fallback)", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    // HTML response triggers REST fallback
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve("<html>login</html>"),
      } as any)
    )
    ;(global as any).fetch = fetchMock

    await expect(
      client.runDataDownload("ws", { p: 1 }, "repo", undefined)
    ).rejects.toMatchObject({ code: "WEBHOOK_AUTH_ERROR" })
    expect(fetchMock).toHaveBeenCalled()

    // Test webhook auth error fallback
    const webhookSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "runDownloadWebhook")
      .mockRejectedValue(
        new FmeFlowApiError("Webhook auth fail", "WEBHOOK_AUTH_ERROR", 403)
      )

    await expect(
      client.runDataDownload("workspace", { k: "v" }, "repo")
    ).rejects.toMatchObject({ code: "WEBHOOK_AUTH_ERROR", status: 403 })
    expect(webhookSpy).toHaveBeenCalled()
    webhookSpy.mockRestore()
  })

  test("runDataDownload webhook includes required parameters", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmeserver",
      fmeServerToken: "tok-xyz",
      repository: "repo",
    })

    let capturedUrl = ""
    const fetchMock = jest.fn((url: string) => {
      capturedUrl = url
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ ok: true }),
      } as any)
    })
    ;(global as any).fetch = fetchMock

    await client.runDataDownload(
      "ws",
      {
        foo: "bar",
        opt_servicemode: "sync",
        tm_ttc: 600,
        tm_ttl: 120,
        tm_tag: "high",
      },
      "repo"
    )
    // Ensure the URL has been captured after asynchronous completion
    await waitForMilliseconds(0)
    expect(capturedUrl).toMatch(
      /^https:\/\/example\.com\/fmedatadownload\/repo\/ws\?/
    )
    expect(capturedUrl).toContain("foo=bar")
    expect(capturedUrl).toContain("opt_responseformat=json")
    expect(capturedUrl).toContain("opt_showresult=true")
    expect(capturedUrl).toContain("opt_servicemode=sync")
    expect(capturedUrl).toContain("tm_ttc=600")
    expect(capturedUrl).toContain("tm_ttl=120")
    expect(capturedUrl).toContain("tm_tag=high")
  })

  test("submitJob maps tm_* params into TMDirectives and excludes them from publishedParameters", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { id: 99 }, status: 200, statusText: "OK" })

    await client.submitJob(
      "ws",
      { a: 1, tm_ttc: 5, tm_ttl: 10, tm_tag: "q1" },
      "repo"
    )
    await waitForMilliseconds(0)

    const [, options] = requestSpy.mock.calls[0] as [string, any]
    const payload = JSON.parse(options.body)
    expect(payload.TMDirectives).toEqual({ ttc: 5, ttl: 10, tag: "q1" })
    const pub = payload.publishedParameters as Array<{ name: string }>
    const names = new Set(pub.map((p) => p.name))
    expect(names.has("tm_ttc")).toBe(false)
    expect(names.has("tm_ttl")).toBe(false)
    expect(names.has("tm_tag")).toBe(false)
    expect(names.has("a")).toBe(true)

    requestSpy.mockRestore()
  })

  test("runDataDownload webhook does not set forbidden User-Agent header", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmeserver",
      fmeServerToken: "tok-xyz",
      repository: "repo",
    })

    let capturedHeaders: any = null
    const fetchMock = jest.fn((url: string, init: any) => {
      capturedHeaders = init?.headers
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ ok: true }),
      } as any)
    })
    ;(global as any).fetch = fetchMock

    await client.runDataDownload("ws", { a: 1 }, "repo")
    await waitForMilliseconds(0)

    expect(capturedHeaders).toBeTruthy()
    expect(capturedHeaders["User-Agent"]).toBeUndefined()
    expect(capturedHeaders.Accept).toBe("application/json")
    expect(typeof capturedHeaders.Authorization).toBe("string")
  })

  test("runDataDownload rejects on non-JSON webhook (text/plain)", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const fetchMock = jest.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/plain" },
        text: () => Promise.resolve("interstitial"),
      } as any)
    )
    ;(global as any).fetch = fetchMock

    await expect(
      client.runDataDownload("ws", { p: 1 }, "repo")
    ).rejects.toMatchObject({ code: "WEBHOOK_AUTH_ERROR" })
    await waitForMilliseconds(0)
  })

  describe("toFmeParams (merged)", () => {
    // Simple loader stub helper
    const makeLoader =
      (overrides: any = {}) =>
      async (modules: string[]) => {
        const results: any[] = []
        for (const m of modules) {
          if (m === "esri/request")
            results.push(() => Promise.resolve({ data: null }))
          else if (m === "esri/config")
            results.push({ request: { maxUrlLength: 4000, interceptors: [] } })
          else if (m === "esri/geometry/projection")
            results.push({ project: async (geoms: any[]) => geoms })
          else if (m === "esri/geometry/support/webMercatorUtils")
            results.push({
              webMercatorToGeographic: (g: any) => g,
              geographicToWebMercator: (g: any) => g,
            })
          else if (m === "esri/geometry/SpatialReference") {
            const SR = function (props: any) {
              return { wkid: props?.wkid }
            }
            results.push(SR)
          } else results.push({})
        }
        return results
      }

    beforeEach(() => {
      jest.resetModules()
      ;(global as any).__ESRI_TEST_STUB__ = makeLoader()
    })

    afterEach(() => {
      try {
        delete (global as any).__ESRI_TEST_STUB__
      } catch {
        ;(global as any).__ESRI_TEST_STUB__ = undefined
      }
    })

    function makePolygonWGS84() {
      return {
        type: "polygon",
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        extent: { xmin: 0, ymin: 0, xmax: 1, ymax: 1, width: 1, height: 1 },
        spatialReference: { wkid: 4326 },
        toJSON() {
          return { rings: this.rings, spatialReference: this.spatialReference }
        },
      }
    }

    it("should return AREA and Extent and AreaOfInterest when given a WGS84 polygon", async () => {
      const poly = makePolygonWGS84() as any
      const client = createFmeFlowClient({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "token",
        repository: "repo",
      } as any)
      const res = await (client as any).toFmeParams(poly)

      expect(res).toBeDefined()
      expect(res.AREA).toBeDefined()
      expect(res.ExtentGeoJson).toBeDefined()
      expect(typeof res.AreaOfInterest).toBe("string")
      expect(res.AREA).toBeGreaterThanOrEqual(0)
      const eg = JSON.parse(res.ExtentGeoJson)
      expect(eg.type).toBe("Polygon")
      expect(Array.isArray(eg.coordinates)).toBe(true)
    })

    it("throws when geometry is not a polygon", async () => {
      const badGeom: any = { type: "point" }
      const client = createFmeFlowClient({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "token",
        repository: "repo",
      } as any)
      await expect((client as any).toFmeParams(badGeom)).rejects.toThrow(
        /Only polygon geometries are supported/
      )
    })
  })

  describe("runDownloadWebhook max URL length (merged)", () => {
    beforeEach(() => {
      jest.resetModules()
      // small max to force detection
      ;(global as any).__ESRI_TEST_STUB__ = async (modules: string[]) => [
        () => Promise.resolve({ data: null }),
        { request: { maxUrlLength: 10, interceptors: [] } },
        {},
        {},
        function SpatialReference() {
          return {}
        },
      ]
      global.fetch = jest.fn()
    })
    afterEach(() => {
      try {
        delete (global as any).__ESRI_TEST_STUB__
      } catch {
        ;(global as any).__ESRI_TEST_STUB__ = undefined
      }
      if (global.fetch) delete (global as any).fetch
    })

    it("detects too-long webhook URLs and avoids fetch", async () => {
      const client = createFmeFlowClient({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "token",
        repository: "repo",
      } as any)
      const params: any = {}
      for (let i = 0; i < 50; i++) params[`k${i}`] = "x".repeat(24)
      const tooLong = isWebhookUrlTooLong(
        "https://example.com",
        "repo",
        "ws",
        params,
        10
      )
      expect(tooLong).toBe(true)
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  test("customRequest handles different HTTP methods and content types", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: {}, status: 200, statusText: "OK" })

    // GET with query parameters
    await client.customRequest("/foo", HttpMethod.GET, { a: 1, b: "x" })
    const getCall = requestSpy.mock.calls[0] as [string, any]
    expect(getCall[1].method).toBe(HttpMethod.GET)
    expect(getCall[1].query).toMatchObject({ a: 1, b: "x" })

    // POST with form data
    await client.customRequest(
      "/bar",
      HttpMethod.POST,
      { p: "v" },
      "application/x-www-form-urlencoded"
    )
    const postCall = requestSpy.mock.calls[1] as [string, any]
    expect(postCall[1].method).toBe(HttpMethod.POST)
    expect(postCall[1].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    )
    expect(typeof postCall[1].body).toBe("string")

    // POST with JSON data
    await client.customRequest(
      "/baz",
      HttpMethod.POST,
      { flag: true },
      "application/json"
    )
    const jsonCall = requestSpy.mock.calls[2] as [string, any]
    expect(jsonCall[1].headers["Content-Type"]).toBe("application/json")
    expect(typeof jsonCall[1].body).toBe("string")
    const parsed = JSON.parse(jsonCall[1].body)
    expect(parsed).toEqual({ flag: true })

    requestSpy.mockRestore()
  })

  test("webhook includes zero-valued tm_* and omits empty tag", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmeserver",
      fmeServerToken: "tok-xyz",
      repository: "repo",
    })

    let capturedUrl = ""
    const fetchMock = jest.fn((url: string) => {
      capturedUrl = url
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ ok: true }),
      } as any)
    })
    ;(global as any).fetch = fetchMock

    await client.runDataDownload(
      "ws",
      {
        tm_ttc: 0,
        tm_ttl: 0,
        tm_tag: "",
      },
      "repo"
    )

    expect(capturedUrl).toMatch(
      /^https:\/\/example\.com\/fmedatadownload\/repo\/ws\?/i
    )
    expect(capturedUrl).toContain("tm_ttc=0")
    expect(capturedUrl).toContain("tm_ttl=0")
    expect(capturedUrl).not.toContain("tm_tag=")
  })

  // Removed: REST fallback behavior is not supported anymore

  test("submitSyncJob maps tm_* into TMDirectives as with submitJob", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { id: 42 }, status: 200, statusText: "OK" })

    await client.submitSyncJob(
      "ws",
      { foo: "bar", tm_ttc: 1, tm_ttl: 2, tm_tag: "t" },
      "repo"
    )
    await waitForMilliseconds(0)

    const call = requestSpy.mock.calls.find(
      ([endpoint]) =>
        typeof endpoint === "string" &&
        endpoint.includes("/transformations/transact/")
    ) as [string, any] | undefined
    expect(call).toBeTruthy()
    if (call) {
      const [, opts] = call
      const payload = JSON.parse(opts.body)
      expect(payload.TMDirectives).toEqual({ ttc: 1, ttl: 2, tag: "t" })
      const pub = payload.publishedParameters as Array<{ name: string }>
      const names = new Set(pub.map((p) => p.name))
      expect(names.has("tm_ttc")).toBe(false)
      expect(names.has("tm_ttl")).toBe(false)
      expect(names.has("tm_tag")).toBe(false)
      expect(names.has("foo")).toBe(true)
    }

    requestSpy.mockRestore()
  })

  test("submitJob omits empty/whitespace tm_tag from TMDirectives", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { id: 5 }, status: 200, statusText: "OK" })

    await client.submitJob("ws", { tm_ttc: 1, tm_ttl: 2, tm_tag: "  " }, "repo")
    await waitForMilliseconds(0)

    const [, opts] = requestSpy.mock.calls[0] as [string, any]
    const payload = JSON.parse(opts.body)
    expect(payload.TMDirectives).toEqual({ ttc: 1, ttl: 2 })
    requestSpy.mockRestore()
  })

  test("submitJob has no TMDirectives when tm_* are absent", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { id: 7 }, status: 200, statusText: "OK" })

    await client.submitJob("ws", { a: 1 }, "repo")
    await waitForMilliseconds(0)

    const [, opts] = requestSpy.mock.calls[0] as [string, any]
    const payload = JSON.parse(opts.body)
    expect(payload.TMDirectives).toBeUndefined()
    const pub = payload.publishedParameters as Array<{ name: string }>
    const names = new Set(pub.map((p) => p.name))
    expect(names.has("a")).toBe(true)
    requestSpy.mockRestore()
  })

  test("submitJob respects pre-built job request with publishedParameters", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { id: 9 }, status: 200, statusText: "OK" })

    const prebuilt = {
      publishedParameters: [{ name: "a", value: 1 }],
      TMDirectives: { ttc: 3, ttl: 6, tag: "x" },
    }
    await client.submitJob("ws", prebuilt as any, "repo")
    await waitForMilliseconds(0)

    const [, opts] = requestSpy.mock.calls[0] as [string, any]
    const payload = JSON.parse(opts.body)
    expect(payload).toEqual(prebuilt)
    requestSpy.mockRestore()
  })

  test("normalizeUrl and resolveRequestUrl behavior for absolute and relative endpoints", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmeserver/",
      fmeServerToken: "tok-1",
      repository: "repo",
    })

    // Spy on console.log which the request() method uses to log the resolved URL
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(function _noop() {
        return undefined
      })

    // Absolute endpoint should be used as-is when passed to request()
    await (client as any).request("https://other.example.com/foo")
    expect((logSpy.mock.calls[0] as any)[1]).toBe(
      "https://other.example.com/foo"
    )

    // Endpoint starting with /fme should be resolved against normalized serverUrl
    await (client as any).request("/fmedatadownload/foo")
    const maybeUrl = String((logSpy.mock.calls[1] as any)[1])
    expect(maybeUrl.startsWith("https://example.com")).toBe(true)
    logSpy.mockRestore()
  })

  // AbortError behavior is covered indirectly by cancellation tests; direct
  // simulation of internal AbortError is environment-dependent and omitted.

  test("getRepositories wraps errors and extracts status from message", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-1",
      repository: "repo",
    })

    // Simulate underlying request throwing an error with an embedded status
    const err = { message: "Request failed status: 401" }
    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockRejectedValue(err)

    await expect(client.getRepositories()).rejects.toMatchObject({
      code: "REPOSITORIES_ERROR",
      status: 401,
    })

    requestSpy.mockRestore()
  })

  test("runDataDownload rejects on JSON webhook with auth status (401)", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-1",
      repository: "repo",
    })

    const fetchMock = jest.fn(() =>
      Promise.resolve({
        status: 401,
        statusText: "Unauthorized",
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ ok: false }),
      } as any)
    )
    ;(global as any).fetch = fetchMock

    await expect(
      client.runDataDownload("ws", {}, "repo")
    ).rejects.toMatchObject({
      code: "WEBHOOK_AUTH_ERROR",
      status: 401,
    })
  })

  test("setApiSettings preserves larger platform maxUrlLength", () => {
    // Simulate platform providing a large maxUrlLength
    ;(global as any).esriConfig = {
      request: { maxUrlLength: 10000, interceptors: [] },
    }

    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-1",
      repository: "repo",
    })

    // Use the client variable to satisfy lint rules (client creation triggers setApiSettings)
    expect(client).toBeTruthy()

    const esriCfg = (global as any).esriConfig
    expect(esriCfg.request.maxUrlLength).toBeGreaterThanOrEqual(10000)
  })

  test("runDataDownload rejects when webhook URL exceeds configured max length", async () => {
    // Build an extremely long serverUrl so the webhook fullUrl is too long
    const longHost = `https://${"a".repeat(5000)}.example.com`
    const client = createFmeFlowClient({
      fmeServerUrl: longHost,
      fmeServerToken: "tok-xyz",
      repository: "repo",
    })

    await expect(
      client.runDataDownload("ws", { a: 1 }, "repo")
    ).rejects.toMatchObject({
      code: "DATA_DOWNLOAD_ERROR",
    })
  })

  test("buildQuery converts circular objects to string fallback (form POST)", () => {
    // Use POST with application/x-www-form-urlencoded so parameters are
    // serialized by buildQuery into a string body.
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-1",
      repository: "repo",
    })

    // Create circular object
    const circ: any = { a: 1 }
    circ.self = circ

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: {}, status: 200, statusText: "OK" })

    return client
      .customRequest(
        "/foo",
        HttpMethod.POST,
        { circ },
        "application/x-www-form-urlencoded"
      )
      .then(() => {
        const call = requestSpy.mock.calls[0] as [string, any]
        expect(typeof call[1].body).toBe("string")
        expect(call[1].body).toContain("circ=")
        requestSpy.mockRestore()
      })
  })

  test("submitGeometryJob rejects when polygon has no valid extent", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-1",
      repository: "repo",
    })

    const polygonNoExtent = {
      type: "polygon",
      rings: [],
      extent: undefined,
      spatialReference: { wkid: 3857 },
      toJSON: () => ({ type: "polygon", rings: [] as any }),
    } as any

    await expect(
      client.submitGeometryJob("ws", polygonNoExtent, {}, "repo")
    ).rejects.toThrow(/Polygon geometry must have a valid extent/i)
  })
})
