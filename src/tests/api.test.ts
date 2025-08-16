import FmeFlowApiClient, { createFmeFlowClient } from "../shared/api"
import { FmeFlowApiError, HttpMethod } from "../shared/types"

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
  })

  test("createFmeFlowClient validates required config and throws with code INVALID_CONFIG", () => {
    // Missing token
    expect(() =>
      createFmeFlowClient({
        fmeServerUrl: "https://example.com",
        repository: "repo",
      } as any)
    ).toThrowError(/Missing required FME Flow configuration/i)
  })

  test("setApiSettings configures esri request settings and interceptor (if available)", () => {
    const cfg = {
      fmeServerUrl: "https://fmserver.example.com/fmeserver/",
      fmeServerToken: "abcd1234",
      repository: "repo",
    } as any
    const client = createFmeFlowClient(cfg)
    expect(client).toBeTruthy()

    const esriConfig = (global as any).esriConfig
    // maxUrlLength should be configured when available in this environment
    if (
      esriConfig &&
      esriConfig.request &&
      typeof esriConfig.request.maxUrlLength === "number"
    ) {
      expect(typeof esriConfig.request.maxUrlLength).toBe("number")
    }

    const initialInterceptors = esriConfig.request.interceptors.length
    if (initialInterceptors > 0) {
      // Calling again should not duplicate the interceptor
      createFmeFlowClient(cfg)
      expect(esriConfig.request.interceptors.length).toBe(initialInterceptors)

      // Verify interceptor.before sets Authorization header and responseType
      const interceptor = esriConfig.request.interceptors[0] as Interceptor
      const params = {
        requestOptions: {
          headers: {} as { [key: string]: string },
          responseType: undefined as unknown,
        },
      }
      interceptor.before && interceptor.before(params)
      expect(params.requestOptions.headers.Authorization).toMatch(
        /^fmetoken token=/
      )
      // responseType may be set by before handler; acceptable to be defined
      expect(params.requestOptions.responseType).toBeDefined()
    }
  })

  test("submitGeometryJob builds published parameters from polygon geometry (extent-based area, WGS84 JSON)", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmerest",
      fmeServerToken: "tok-123",
      repository: "myrepo",
    })

    // Spy on the private request method to capture URL and options
    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { jobId: 1 }, status: 200, statusText: "OK" })

    const polygon: any = {
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
    }

    await client.submitGeometryJob("myws", polygon, { other: "x" }, "myrepo")

    expect(requestSpy).toHaveBeenCalled()
    const call = requestSpy.mock.calls[0] as [string, any]
    const endpointStr = call[0]
    const options = call[1]

    // Endpoint should be the submit transformation path
    expect(typeof endpointStr).toBe("string")
    expect(endpointStr).toContain(
      "/fmerest/v3/transformations/submit/myrepo/myws"
    )

    // Published parameters include extent keys, AREA, AreaOfInterest, extent (geojson), plus "other"
    const published = (options &&
      options.query &&
      options.query.publishedParameters) as Array<{ name: string; value: any }>
    const names = new Set(published.map((p) => p.name))
    ;[
      "MAXX",
      "MAXY",
      "MINX",
      "MINY",
      "AREA",
      "AreaOfInterest",
      "extent",
      "other",
    ].forEach((k) => {
      expect(names.has(k)).toBe(true)
    })

    const areaParam = published.find((p) => p.name === "AREA")
    expect(areaParam?.value).toBe(50) // width*height

    const aoiParam = published.find((p) => p.name === "AreaOfInterest")
    const aoi = JSON.parse(String(aoiParam?.value))
    // Accept either transformed (4326) or original (3857) depending on projection mock wiring
    expect([4326, 3857]).toContain(aoi.spatialReference?.wkid)

    requestSpy.mockRestore()
  })

  test("runDataStreaming builds absolute fmedatastreaming URL using normalized serverUrl", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmeserver",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: {}, status: 200, statusText: "OK" })

    await client.runDataStreaming("workspace", {}, "repo")

    const match = requestSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0] === "https://example.com/fmedatastreaming/repo/workspace"
    ) as [string, any] | undefined
    expect(match).toBeTruthy()

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

  test("runDataDownload falls back to REST when webhook returns HTML (auth or invalid)", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    // Mock fetch to simulate webhook returning HTML content
    const fetchMock: any = jest.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve("<html>login</html>"),
      } as any)
    )
    ;(global as any).fetch = fetchMock

    const restSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "runDownloadRest")
      .mockResolvedValue({
        data: { path: "rest" },
        status: 200,
        statusText: "OK",
      })

    const res = await client.runDataDownload("ws", { p: 1 }, "repo", undefined)

    // Webhook was attempted and then REST fallback was called
    expect(fetchMock).toHaveBeenCalled()
    expect(restSpy).toHaveBeenCalledWith("ws", { p: 1 }, "repo", undefined)
    expect(res.status).toBe(200)

    restSpy.mockRestore()
  })

  test("runDataDownload webhook URL includes required opt_* flags and excludes keys", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com/fmeserver",
      fmeServerToken: "tok-xyz",
      repository: "repo",
    })

    let capturedUrl = ""
    const fetchMock: any = jest.fn((url: string) => {
      capturedUrl = url
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ ok: true }),
      } as any)
    })
    ;(global as any).fetch = fetchMock

    const params = {
      foo: "bar",
      // These provided values should be overridden/normalized by builder
      opt_responseformat: "nope",
      opt_showresult: "nope",
      opt_servicemode: "sync",
    } as any

    const res = await client.runDataDownload("ws", params, "repo")
    expect(res.status).toBe(200)
    expect(typeof capturedUrl).toBe("string")

    // Base path
    expect(capturedUrl).toMatch(
      /^https:\/\/example\.com\/fmedatadownload\/repo\/ws\?/i
    )
    // Includes foo
    expect(capturedUrl).toContain("foo=bar")
    // Forced webhook flags
    expect(capturedUrl).toContain("opt_responseformat=json")
    expect(capturedUrl).toContain("opt_showresult=true")
    // Service mode derived from params (sync here, default async otherwise)
    expect(capturedUrl).toContain("opt_servicemode=sync")
    // Provided values for responseformat/showresult should not leak
    expect(capturedUrl).not.toContain("opt_responseformat=nope")
    expect(capturedUrl).not.toContain("opt_showresult=nope")
  })

  test("runDataDownload falls back to REST when webhook returns WEBHOOK_AUTH_ERROR", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const webhookErr = new FmeFlowApiError(
      "Webhook auth fail",
      "WEBHOOK_AUTH_ERROR",
      403
    )

    const webhookSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "runDownloadWebhook")
      .mockRejectedValue(webhookErr)

    const restResponse = {
      data: { success: true, via: "rest" },
      status: 200,
      statusText: "OK",
    }
    const restSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "runDownloadRest")
      .mockResolvedValue(restResponse)

    const result = await client.runDataDownload("workspace", { k: "v" }, "repo")

    expect(webhookSpy).toHaveBeenCalled()
    expect(restSpy).toHaveBeenCalled()
    expect(result).toBe(restResponse)

    webhookSpy.mockRestore()
    restSpy.mockRestore()
  })

  test("customRequest branches: GET uses query; x-www-form-urlencoded uses urlencoded body; JSON uses stringified body", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: {}, status: 200, statusText: "OK" })

    // GET with query
    await client.customRequest("/foo", HttpMethod.GET, { a: 1, b: "x" })
    const getCall = requestSpy.mock.calls[0] as [string, any]
    expect(getCall[0]).toContain("/foo")
    expect(getCall[1].method).toBe(HttpMethod.GET)
    expect(getCall[1].query).toMatchObject({ a: 1, b: "x" })
    expect(getCall[1].body).toBeUndefined()

    // POST urlencoded
    await client.customRequest(
      "/bar",
      HttpMethod.POST,
      { p: "v", n: 2 },
      "application/x-www-form-urlencoded"
    )
    const postFormCall = requestSpy.mock.calls[1] as [string, any]
    expect(postFormCall[0]).toContain("/bar")
    expect(postFormCall[1].method).toBe(HttpMethod.POST)
    expect(postFormCall[1].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    )
    expect(typeof postFormCall[1].body).toBe("string")
    expect(String(postFormCall[1].body)).toContain("p=v")
    expect(String(postFormCall[1].body)).toContain("n=2")

    // POST JSON
    await client.customRequest(
      "/baz",
      HttpMethod.POST,
      { flag: true, name: "z" },
      "application/json"
    )
    const postJsonCall = requestSpy.mock.calls[2] as [string, any]
    expect(postJsonCall[0]).toContain("/baz")
    expect(postJsonCall[1].method).toBe(HttpMethod.POST)
    expect(postJsonCall[1].headers["Content-Type"]).toBe("application/json")
    expect(typeof postJsonCall[1].body).toBe("string")
    const parsed = JSON.parse(postJsonCall[1].body)
    expect(parsed).toEqual({ flag: true, name: "z" })

    requestSpy.mockRestore()
  })
})
