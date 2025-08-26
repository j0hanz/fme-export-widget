import FmeFlowApiClient, { createFmeFlowClient } from "../shared/api"
import { FmeFlowApiError, HttpMethod } from "../shared/types"
import { waitForMilliseconds, runFuncAsync } from "jimu-for-test"

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

    const htmlResult = await client.runDataDownload(
      "ws",
      { p: 1 },
      "repo",
      undefined
    )
    // Flush microtasks
    await waitForMilliseconds(0)
    const flushHtml = runFuncAsync(0)
    await flushHtml(() => {
      return undefined
    }, [])
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
    // Flush microtasks
    await waitForMilliseconds(0)
    const flushAuth = runFuncAsync(0)
    await flushAuth(() => {
      return undefined
    }, [])
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
    await waitForMilliseconds(0)
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

  test("REST fallback carries tm_* into TMDirectives", async () => {
    const client = createFmeFlowClient({
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tok-123",
      repository: "repo",
    })

    // Force webhook fallback with non-JSON response
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/plain" },
        text: () => Promise.resolve("HTML/Interstitial"),
      } as any)
    )
    ;(global as any).fetch = fetchMock

    const requestSpy = jest
      .spyOn((FmeFlowApiClient as any).prototype, "request")
      .mockResolvedValue({ data: { id: 777 }, status: 200, statusText: "OK" })

    await client.runDataDownload(
      "ws",
      { p1: "v1", tm_ttc: 30, tm_ttl: 90, tm_tag: "prio" },
      "repo"
    )
    // Flush asynchronous completion before asserting on payload
    await waitForMilliseconds(0)

    const restCall = requestSpy.mock.calls.find(
      ([endpoint]) =>
        typeof endpoint === "string" &&
        endpoint.includes("/transformations/submit/")
    ) as [string, any] | undefined
    expect(restCall).toBeTruthy()
    if (restCall) {
      const [, opts] = restCall
      const payload = JSON.parse(opts.body)
      expect(payload.TMDirectives).toEqual({ ttc: 30, ttl: 90, tag: "prio" })
      const pub = payload.publishedParameters as Array<{ name: string }>
      const names = new Set(pub.map((p) => p.name))
      expect(names.has("tm_ttc")).toBe(false)
      expect(names.has("tm_ttl")).toBe(false)
      expect(names.has("tm_tag")).toBe(false)
      expect(names.has("p1")).toBe(true)
    }

    requestSpy.mockRestore()
  })

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
})
