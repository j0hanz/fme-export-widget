import fetchMock from "jest-fetch-mock"
import FmeFlowApiClient, {
  createFmeFlowClient,
  resetEsriCache,
  isWebhookUrlTooLong,
} from "../shared/api"
import { HttpMethod, FmeFlowApiError } from "../config"

// Secure JSAPI mocks: never import @arcgis/core; provide globals used by ensureEsri()
const setupEsriGlobals = () => {
  ;(global as any).esriRequest = jest.fn((url: string, options: any) => ({
    data: { ok: true, url, options },
    httpStatus: 200,
    statusText: "OK",
  }))
  ;(global as any).esriConfig = {
    request: { maxUrlLength: 1000, interceptors: [] },
  }
  ;(global as any).webMercatorUtils = {
    webMercatorToGeographic: jest.fn((g: any) => ({
      ...g,
      spatialReference: { wkid: 4326 },
    })),
  }
  ;(global as any).projection = {
    load: jest.fn().mockResolvedValue(undefined),
    project: jest.fn((geoms: any[]) => geoms),
  }
  ;(global as any).SpatialReference = function (this: any, props: any) {
    Object.assign(this, props)
  } as any
}

const makeClient = (
  overrides?: Partial<{
    url: string
    token: string
    repo: string
    timeout: number
  }>
) =>
  new FmeFlowApiClient({
    serverUrl: (overrides?.url ?? "https://fme.example.com").replace(/\/$/, ""),
    token: overrides?.token ?? "superSecretToken1234",
    repository: overrides?.repo ?? "demo",
    timeout: overrides?.timeout,
  })

const makePolygon = (srWkid = 4326) => {
  const rings = [
    [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
      [10, 10],
    ],
  ]
  const extent = {
    xmin: 10,
    ymin: 10,
    xmax: 20,
    ymax: 20,
    width: 10,
    height: 10,
  }
  const spatialReference = { wkid: srWkid }
  const poly: any = {
    type: "polygon",
    rings,
    spatialReference,
    extent,
    toJSON: () => ({ rings, spatialReference }),
  }
  return poly as __esri.Polygon
}

describe("shared/api FmeFlowApiClient", () => {
  let consoleErrorSpy: jest.SpyInstance
  let consoleWarnSpy: jest.SpyInstance

  beforeEach(() => {
    fetchMock.resetMocks()
    jest.clearAllMocks()
    resetEsriCache()
    setupEsriGlobals()
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    resetEsriCache()
  })

  test("createFmeFlowClient validates required fields and normalizes URL", async () => {
    expect(() =>
      createFmeFlowClient({
        fmeServerUrl: "",
        fmeServerToken: "",
        repository: "",
      } as any)
    ).toThrowError(FmeFlowApiError)

    const client = createFmeFlowClient({
      fmeServerUrl: "https://host.example.com/",
      fmeServerToken: "tkn",
      repository: "repo",
    } as any)

    // Trigger a simple call to inspect URL resolution
    await client.testConnection()
    const [calledUrl] = ((global as any).esriRequest as jest.Mock).mock.calls[0]
    expect(calledUrl).toBe("https://host.example.com/fmerest/v3/info")
  })

  test("GET requests add __scope and install interceptor; absolute URL is preserved", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()
    await client.validateRepository("repo1")

    const [, options] = esriRequest.mock.calls[0]
    expect(options.method).toBe("get")
    expect(typeof options.query.__scope).toBe("string")
    expect(options.query.__scope.length).toBeGreaterThan(0)

    // Interceptor should be installed for host and inject fmetoken via before() hook
    const interceptors = (global as any).esriConfig.request.interceptors
    expect(Array.isArray(interceptors)).toBe(true)
    const fmeInterceptor = interceptors.find((i: any) => i && i._fmeInterceptor)
    expect(fmeInterceptor).toBeTruthy()
    // Simulate esri/request invoking before() to ensure it injects token
    const params: any = {
      url: "https://fme.example.com/fmerest/v3/repositories/repo1",
      requestOptions: { query: {} },
    }
    fmeInterceptor.before(params)
    expect(params.requestOptions.query.fmetoken).toBe("superSecretToken1234")

    // Absolute URL remains unchanged
    await client.customRequest<any>("https://example.com/path", HttpMethod.GET)
    const [absUrl] = esriRequest.mock.calls[1]
    expect(absUrl).toBe("https://example.com/path")
  })

  test("setApiSettings sets esriConfig.request.maxUrlLength to at least 4000", async () => {
    const client = makeClient()
    // Trigger an async path to ensure settings applied
    await client.testConnection()
    expect(
      (global as any).esriConfig.request.maxUrlLength
    ).toBeGreaterThanOrEqual(4000)
  })

  test("getRepositories normalizes array and nested items responses", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()

    // Case 1: array
    esriRequest.mockResolvedValueOnce({
      data: [{ name: "a" }, { name: "" }, { name: "b" }],
      httpStatus: 200,
      statusText: "OK",
    })
    const res1 = await client.getRepositories()
    expect(res1.data).toEqual([{ name: "a" }, { name: "b" }])

    // Case 2: nested { items: [...] }
    esriRequest.mockResolvedValueOnce({
      data: { items: [{ name: "x" }, { name: null }, { name: "y" }] },
      httpStatus: 200,
      statusText: "OK",
    })
    const res2 = await client.getRepositories()
    expect(res2.data).toEqual([{ name: "x" }, { name: "y" }])
  })

  test("getRepositoryItems includes query filters and cache hints; interceptor can inject token", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()
    await client.getRepositoryItems("repoA", "FMW", 10, 5)
    const [, options] = esriRequest.mock.calls[0]
    expect(options.cacheHint).toBe(false)
    expect(options.query).toEqual(
      expect.objectContaining({
        type: "FMW",
        limit: 10,
        offset: 5,
        __scope: expect.any(String),
      })
    )
    // Verify interceptor can inject token
    const interceptors = (global as any).esriConfig.request.interceptors
    const fmeInterceptor = interceptors.find((i: any) => i && i._fmeInterceptor)
    const params: any = {
      url: "https://fme.example.com/fmerest/v3/repositories/repoA/items",
      requestOptions: { query: { ...options.query } },
    }
    fmeInterceptor.before(params)
    expect(params.requestOptions.query.fmetoken).toBe("superSecretToken1234")
  })

  test("interceptor uses latest token after updateConfig (no duplicates)", async () => {
    const client = makeClient({ token: "firstToken" })
    // Trigger interceptor setup
    await client.validateRepository("repo1")
    const interceptors = (global as any).esriConfig.request.interceptors
    const beforeCount = interceptors.filter(
      (i: any) => i && i._fmeInterceptor
    ).length
    // Rotate token
    client.updateConfig({ token: "secondToken9999" })
    const afterCount = interceptors.filter(
      (i: any) => i && i._fmeInterceptor
    ).length
    expect(afterCount).toBe(beforeCount) // no duplicate interceptors
    const fmeInterceptor = interceptors.find((i: any) => i && i._fmeInterceptor)
    const params: any = {
      url: "https://fme.example.com/fmerest/v3/repositories/repo1",
      requestOptions: { query: {} },
    }
    fmeInterceptor.before(params)
    expect(params.requestOptions.query.fmetoken).toBe("secondToken9999")
  })

  test("workspace endpoints target correct paths and disable caching", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()
    await client.getWorkspaceParameter("roads.fmw", "Param1", "repoZ")
    let [url, options] = esriRequest.mock.calls[0]
    expect(url).toBe(
      "https://fme.example.com/fmerest/v3/repositories/repoZ/items/roads.fmw/parameters/Param1"
    )
    expect(options.cacheHint).toBe(false)

    await client.getWorkspaceItem("roads.fmw", "repoZ")
    ;[url, options] = esriRequest.mock.calls[1]
    expect(url).toBe(
      "https://fme.example.com/fmerest/v3/repositories/repoZ/items/roads.fmw"
    )
    expect(options.cacheHint).toBe(false)
  })

  test("submitJob builds POST body with publishedParameters and TMDirectives", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()
    await client.submitJob(
      "roads.fmw",
      { a: 1, tm_ttc: "30", tm_ttl: 45, tm_tag: "alpha" },
      "r1"
    )
    const [url, options] = esriRequest.mock.calls[0]
    expect(url).toBe(
      "https://fme.example.com/fmerest/v3/transformations/submit/r1/roads.fmw"
    )
    expect(options.method).toBe("post")
    const payload = JSON.parse(options.body)
    expect(payload.publishedParameters).toEqual(
      expect.arrayContaining([{ name: "a", value: 1 }])
    )
    expect(payload.TMDirectives).toEqual({ ttc: 30, ttl: 45, tag: "alpha" })
  })

  test("submitSyncJob posts to transact endpoint", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()
    await client.submitSyncJob("roads.fmw", { a: 1 }, "r1")
    const [url, options] = esriRequest.mock.calls[0]
    expect(url).toBe(
      "https://fme.example.com/fmerest/v3/transformations/transact/r1/roads.fmw"
    )
    expect(options.method).toBe("post")
  })

  test("submitGeometryJob converts polygon to FME parameters and posts", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()
    const polygon = makePolygon(3857) // triggers webMercatorToGeographic
    await client.submitGeometryJob(
      "clip.fmw",
      polygon,
      { extra: "yes" },
      "geoRepo"
    )
    const [url, options] = esriRequest.mock.calls[0]
    expect(url).toBe(
      "https://fme.example.com/fmerest/v3/transformations/submit/geoRepo/clip.fmw"
    )
    const body = JSON.parse(options.body)
    const pairs = new Map<string, any>(
      body.publishedParameters.map((p: any) => [p.name, p.value])
    )
    expect(pairs.get("MAXX")).toBe(20)
    expect(pairs.get("MINX")).toBe(10)
    expect(pairs.get("AREA")).toBe(100)
    expect(() => JSON.parse(pairs.get("AreaOfInterest"))).not.toThrow()
    expect(() => JSON.parse(pairs.get("ExtentGeoJson"))).not.toThrow()
    expect(pairs.get("extra")).toBe("yes")
  })

  test("submitGeometryJob rejects non-polygon or missing extent", async () => {
    const client = makeClient()
    await expect(
      client.submitGeometryJob("x.fmw", { type: "point" } as any, {})
    ).rejects.toThrow(/GEOMETRY_TYPE_INVALID/)

    const badPoly: any = makePolygon(4326)
    badPoly.extent = null
    await expect(
      client.submitGeometryJob("x.fmw", badPoly, {})
    ).rejects.toThrow(/GEOMETRY_MISSING/)
  })

  test("getJobStatus and cancelJob call correct endpoints", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()
    await client.getJobStatus(123)
    await client.cancelJob(123)
    const [url1, opt1] = esriRequest.mock.calls[0]
    const [url2, opt2] = esriRequest.mock.calls[1]
    expect(url1).toBe(
      "https://fme.example.com/fmerest/v3/transformations/jobs/123"
    )
    expect(opt1.method).toBe("get")
    expect(url2).toBe(
      "https://fme.example.com/fmerest/v3/transformations/jobs/123/cancel"
    )
    expect(opt2.method).toBe("post")
  })

  test("customRequest builds GET query and POST bodies correctly", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient()

    await client.customRequest<any>("/custom", HttpMethod.GET, { x: 1 })
    let [, opt] = esriRequest.mock.calls[0]
    expect(opt.method).toBe("get")
    expect(opt.query.x).toBe(1)

    await client.customRequest<any>(
      "/form",
      HttpMethod.POST,
      { a: "b" },
      "application/x-www-form-urlencoded"
    )
    ;[, opt] = esriRequest.mock.calls[1]
    expect(opt.method).toBe("post")
    expect(opt.body).toBe("a=b")

    await client.customRequest<any>(
      "/json",
      HttpMethod.POST,
      { a: 1 },
      "application/json"
    )
    ;[, opt] = esriRequest.mock.calls[2]
    expect(opt.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(opt.body)).toEqual({ a: 1 })
  })

  test("AbortError returns canceled ApiResponse without throwing", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    esriRequest.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    )
    const client = makeClient()
    const res = await client.testConnection()
    expect(res.status).toBe(0)
    expect(res.statusText).toBe("requestAborted")
  })

  test("Unexpected token error maps to INVALID_RESPONSE_FORMAT and masks token in logs (security)", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    esriRequest.mockRejectedValueOnce(
      new Error("Unexpected token < in JSON at position 0")
    )
    const client = makeClient({ token: "myVerySensitiveToken9999" })
    await expect(client.testConnection()).rejects.toMatchObject({
      name: "FmeFlowApiError",
      code: "INVALID_RESPONSE_FORMAT",
    })
    // Security: token must be masked in logs
    const errorLogs = consoleErrorSpy.mock.calls
      .flat()
      .map((arg) => {
        try {
          return typeof arg === "string" ? arg : JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
      .join("\n")
    expect(errorLogs).toContain("***9999")
    expect(errorLogs).not.toContain("myVerySensitiveToken9999")
  })

  test("runDataDownload builds webhook URL with token and handles JSON response", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
      statusText: "OK",
    })
    const client = makeClient({ url: "https://fme.acme.com" })
    const res = await client.runDataDownload(
      "export.fmw",
      { p: "1", tm_tag: "session-1" },
      "repo1"
    )
    expect(res.status).toBe(200)
    const calledUrl = fetchMock.mock.calls[0][0] as string
    // Ensure token present on webhook
    expect(calledUrl).toMatch(/token=superSecretToken1234/)
    // Ensure tm_tag included
    expect(calledUrl).toMatch(/tm_tag=session-1/)
  })

  test("runDataDownload enforces URL length guard", async () => {
    // shrink max URL length to force error
    ;(global as any).esriConfig.request.maxUrlLength = 16
    const client = makeClient()
    await expect(
      client.runDataDownload("x", { a: "b" }, "r")
    ).rejects.toMatchObject({
      name: "FmeFlowApiError",
      code: "URL_TOO_LONG",
      message: "URL_TOO_LONG",
    })
  })

  test("Webhook coercion: opt_servicemode 'schedule' becomes 'async'", async () => {
    // Mock JSON response to avoid network failure
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200,
      statusText: "OK",
    })
    const client = makeClient({ url: "https://fme.acme.com" })
    await client.runDataDownload(
      "export.fmw",
      { p: "1", opt_servicemode: "schedule" },
      "repo1"
    )
    const calledUrl = fetchMock.mock.calls[0][0] as string
    // Ensure webhooks never send schedule; coerced to async
    expect(calledUrl).toMatch(/opt_servicemode=async/)
    expect(calledUrl).not.toMatch(/opt_servicemode=schedule/)
  })

  test("runDataStreaming posts parameters with token and returns Blob", async () => {
    // Mock streaming response as plain text with filename
    fetchMock.mockResponseOnce("hello world", {
      headers: {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="out.txt"',
      },
      status: 200,
      statusText: "OK",
    })

    const client = makeClient()
    const res = await client.runDataStreaming("stream.fmw", { a: "1" }, "repoX")

    // Validate fetch call
    const [calledUrl, init] = fetchMock.mock.calls[0]
    expect(typeof calledUrl).toBe("string")
    expect(calledUrl).toBe(
      "https://fme.example.com/fmedatastreaming/repoX/stream.fmw?token=superSecretToken1234"
    )
    expect((init as any)?.method).toBe("POST")
    const body = ((init as any)?.body || "") as string
    expect(body).toContain("opt_showresult=true")
    expect(body).toContain("a=1")

    // Validate response shape
    expect(res.status).toBe(200)
    expect(res.data.blob).toBeTruthy()
    expect(typeof (res.data.blob as any).size).not.toBeUndefined()
    expect(res.data.contentType).toBe("text/plain")
    expect(res.data.fileName).toBe("out.txt")
  })

  test("runWorkspace delegates to streaming or download based on service arg", async () => {
    const client = makeClient()
    const spyStream = jest
      .spyOn(client as any, "runDataStreaming")
      .mockResolvedValue({ status: 200 })
    const spyDownload = jest
      .spyOn(client as any, "runDataDownload")
      .mockResolvedValue({ status: 200 })

    await client.runWorkspace("ws.fmw", { p: 1 }, "r1", "stream")
    expect(spyStream).toHaveBeenCalled()
    await client.runWorkspace("ws.fmw", { p: 2 }, "r1", "download")
    expect(spyDownload).toHaveBeenCalled()
  })

  test("runDataDownload throws for non-JSON or malformed JSON and for auth errors", async () => {
    const client = makeClient()

    // Non-JSON content-type
    fetchMock.mockResponseOnce("<html></html>", {
      headers: { "content-type": "text/html" },
      status: 200,
      statusText: "OK",
    })
    await expect(client.runDataDownload("w", {}, "r")).rejects.toMatchObject({
      code: "WEBHOOK_AUTH_ERROR",
    })

    // Malformed JSON
    fetchMock.mockResponseOnce("not json", {
      headers: { "content-type": "application/json" },
      status: 200,
      statusText: "OK",
    })
    await expect(client.runDataDownload("w", {}, "r")).rejects.toMatchObject({
      code: "WEBHOOK_AUTH_ERROR",
    })

    // Auth error
    fetchMock.mockResponseOnce(JSON.stringify({ err: true }), {
      headers: { "content-type": "application/json" },
      status: 401,
      statusText: "Unauthorized",
    })
    await expect(client.runDataDownload("w", {}, "r")).rejects.toMatchObject({
      code: "WEBHOOK_AUTH_ERROR",
      status: 401,
    })
  })

  test("createAbortController aborts previous controller; cancelAllRequests aborts current", () => {
    const client = makeClient()
    const ac1 = client.createAbortController()
    expect(ac1.signal.aborted).toBe(false)
    const ac2 = client.createAbortController()
    expect(ac1.signal.aborted).toBe(true)
    expect(ac2.signal.aborted).toBe(false)
    client.cancelAllRequests()
    expect(ac2.signal.aborted).toBe(true)
  })

  test("ARCGIS_MODULE_ERROR when esriRequest is unavailable after ensureEsri", async () => {
    // Force loader to return null for esri/request and ensure no global mocks are present
    resetEsriCache()
    delete (global as any).esriRequest
    delete (global as any).esriConfig
    delete (global as any).projection
    delete (global as any).webMercatorUtils
    delete (global as any).SpatialReference
    ;(global as any).__ESRI_TEST_STUB__ = () => [
      null,
      { request: { maxUrlLength: 4000, interceptors: [] } },
      {},
      {},
      function SR(this: any, p: any) {
        Object.assign(this, p)
      },
    ]
    const client = makeClient()
    await expect(client.testConnection()).rejects.toMatchObject({
      code: "ARCGIS_MODULE_ERROR",
    })
    delete (global as any).__ESRI_TEST_STUB__
  })

  test("isWebhookUrlTooLong computes length including defaults and token", () => {
    const tooShort = isWebhookUrlTooLong(
      "https://fme.example.com",
      "repo",
      "ws",
      { a: "1", opt_servicemode: "sync" },
      10,
      "tok"
    )
    expect(tooShort).toBe(true)

    const ample = isWebhookUrlTooLong(
      "https://fme.example.com",
      "repo",
      "ws",
      { a: "1" },
      10000
    )
    expect(ample).toBe(false)
  })

  test("uploadToTemp posts binary to TEMP resources and returns path", async () => {
    const esriRequest = (global as any).esriRequest as jest.Mock
    const client = makeClient({ url: "https://fme.upload.com", repo: "data" })

    // Mock successful upload response with a path
    esriRequest.mockResolvedValueOnce({
      data: { path: "$(FME_SHAREDRESOURCE_TEMP)/widget_w1/data.json" },
      httpStatus: 200,
      statusText: "OK",
    })

    // Use a File to ensure Content-Disposition filename is set
    const file = new File([JSON.stringify({ a: 1 })], "data.json", {
      type: "application/json",
    })
    const res = await client.uploadToTemp(file, { subfolder: "widget_w1" })

    // Validate request
    const [calledUrl, options] = esriRequest.mock.calls[0]
    expect(typeof calledUrl).toBe("string")
    expect(calledUrl).toContain(
      "/fmerest/v3/resources/connections/FME_SHAREDRESOURCE_TEMP/filesys"
    )
    expect(calledUrl).toContain("widget_w1")
    expect(options.method).toBe("post")
    // Headers
    expect(options.headers.Accept).toBe("application/json")
    expect(options.headers["Content-Type"]).toBe("application/octet-stream")
    expect(
      String(options.headers["Content-Disposition"]).toLowerCase()
    ).toContain('filename="data.json"')
    // Response shape
    expect(res.status).toBe(200)
    expect(res.data.path).toBe("$(FME_SHAREDRESOURCE_TEMP)/widget_w1/data.json")
  })
})
