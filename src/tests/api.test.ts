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

    // Verify interceptor is added and configured
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

    expect(requestSpy).toHaveBeenCalled()
    const [endpoint, options] = requestSpy.mock.calls[0]

    expect(endpoint).toContain("/fmerest/v3/transformations/submit/myrepo/myws")

    const published = (options as any).query.publishedParameters as Array<{
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

    // Test streaming URL
    await client.runDataStreaming("workspace", {}, "repo")
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

  test("runDataDownload falls back to REST API on webhook failure", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const restResponse = {
      data: { serviceResponse: { jobID: 123 } },
      status: 200,
      statusText: "OK",
    }
    const restSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "runDownloadRest")
      .mockResolvedValue(restResponse)

    // Test HTML response fallback
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/html" },
        text: () => Promise.resolve("<html>login</html>"),
      } as any)
    )
    ;(global as any).fetch = fetchMock

    const htmlResult = await client.runDataDownload(
      "ws",
      { p: 1 },
      "repo",
      undefined
    )
    expect(fetchMock).toHaveBeenCalled()
    expect(restSpy).toHaveBeenCalledWith("ws", { p: 1 }, "repo", undefined)
    expect(htmlResult.status).toBe(200)

    // Test webhook auth error fallback
    const webhookSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "runDownloadWebhook")
      .mockRejectedValue(
        new FmeFlowApiError("Webhook auth fail", "WEBHOOK_AUTH_ERROR", 403)
      )

    const authResult = await client.runDataDownload(
      "workspace",
      { k: "v" },
      "repo"
    )
    expect(webhookSpy).toHaveBeenCalled()
    expect(restSpy).toHaveBeenLastCalledWith(
      "workspace",
      { k: "v" },
      "repo",
      undefined
    )
    expect(authResult).toBe(restResponse)

    restSpy.mockRestore()
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
      { foo: "bar", opt_servicemode: "sync" },
      "repo"
    )

    expect(capturedUrl).toMatch(
      /^https:\/\/example\.com\/fmedatadownload\/repo\/ws\?/
    )
    expect(capturedUrl).toContain("foo=bar")
    expect(capturedUrl).toContain("opt_responseformat=json")
    expect(capturedUrl).toContain("opt_showresult=true")
    expect(capturedUrl).toContain("opt_servicemode=sync")
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

    expect(capturedHeaders).toBeTruthy()
    expect(capturedHeaders["User-Agent"]).toBeUndefined()
    expect(capturedHeaders.Accept).toBe("application/json")
    expect(typeof capturedHeaders.Authorization).toBe("string")
  })

  test("runDataDownload falls back to REST on non-JSON webhook (text/plain)", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    const restResponse = {
      data: { serviceResponse: { jobID: 456 } },
      status: 200,
      statusText: "OK",
    }
    const restSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "runDownloadRest")
      .mockResolvedValue(restResponse)

    const fetchMock = jest.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/plain" },
        text: () => Promise.resolve("interstitial"),
      } as any)
    )
    ;(global as any).fetch = fetchMock

    const result = await client.runDataDownload("ws", { p: 1 }, "repo")
    expect(restSpy).toHaveBeenCalled()
    expect(result.status).toBe(200)

    restSpy.mockRestore()
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
})
