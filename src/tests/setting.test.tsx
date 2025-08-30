import { React, Immutable } from "jimu-core"
import {
  initExtensions,
  initStore,
  widgetSettingRender,
  waitForMilliseconds,
} from "jimu-for-test"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import Setting from "../setting/setting"
const S = Setting as any

// Mock API client to avoid network calls in Setting tests
jest.mock("../shared/api", () => ({
  __esModule: true,
  default: class FmeFlowApiClient {
    serverUrl: string
    token: string
    repository: string
    constructor(opts: any) {
      this.serverUrl = opts.serverUrl
      this.token = opts.token
      this.repository = opts.repository
    }
    getRepositories() {
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        data: [{ name: "repo" }],
      })
    }
    validateRepository() {
      return Promise.resolve({ status: 200, statusText: "OK" })
    }
    testConnection() {
      return Promise.resolve({ status: 200, statusText: "OK", data: {} })
    }
  },
}))

// Mock builder-only components to avoid DataSourceSelector rendering issues in tests
jest.mock("jimu-ui/advanced/setting-components", () => ({
  __esModule: true,
  // Provide minimal stand-ins that won't throw during render
  MapWidgetSelector: () => null,
  DataSourceSelector: () => null,
  JimuMapViewSelector: () => null,
  SettingRow: ({ children }: any) => children || null,
  SettingSection: ({ children }: any) => children || null,
}))

describe("Setting component", () => {
  const renderSetting = widgetSettingRender()

  /**
   * Helper to find the test connection button.
   * Many tests need to trigger the connection test; centralizing
   * this logic makes it easier to update the selector if the
   * underlying UI label or role changes in the future.
   */
  const getTestButton = () => {
    // Try to locate by accessible name first
    const candidates = screen.queryAllByRole("button", {
      name: /test|anslut|connection|kontrollera|verify/i,
    })
    if (candidates.length > 0) return candidates[0]
    // Fallback: find the first non-disabled button
    const allButtons = screen.queryAllByRole("button")
    return allButtons.find((b) => !b.hasAttribute("disabled")) || null
  }

  beforeAll(() => {
    initExtensions()
    initStore()
  })

  afterEach(() => {
    // Restore all jest mocks and spies between tests to avoid leakage
    jest.restoreAllMocks()
  })

  const baseConfig = Immutable({
    fmeServerUrl: "",
    fmeServerToken: "",
    repository: "",
    supportEmail: "",
    syncMode: false,
  }) as any

  test("renders core inputs by id", () => {
    const onSettingChange = jest.fn()
    const { container } = renderSetting(
      <S
        id="s1"
        widgetId="w-s1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={baseConfig}
      />
    )

    // Inputs use Setting.ID constants
    expect(container.querySelector("#setting-server-url")).toBeTruthy()
    expect(container.querySelector("#setting-token")).toBeTruthy()
    // Repository select should be rendered (look for the select component)
    const repoControl =
      container.querySelector('[role="combobox"]') ||
      container.querySelector("select") ||
      container.querySelector(".jimu-widget-select")
    expect(repoControl).toBeTruthy()
    expect(container.querySelector("#setting-support-email")).toBeTruthy()
  })

  test("test connection button disabled until serverUrl and token present", () => {
    const onSettingChange = jest.fn()
    renderSetting(
      <S
        id="s2"
        widgetId="w-s2"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={baseConfig}
      />
    )

    const btn = getTestButton()
    expect(btn).toBeTruthy()
    // The button should be disabled when url or token are missing
    expect(
      btn?.getAttribute("disabled") !== null ||
        btn?.getAttribute("aria-disabled") === "true"
    ).toBe(true)
  })

  test("sanitizes serverUrl by stripping /fmeserver and triggers onSettingChange", async () => {
    const onSettingChange = jest.fn()
    const { container } = renderSetting(
      <S
        id="s3"
        widgetId="w-s3"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={baseConfig}
      />
    )

    const serverInput = container.querySelector<HTMLInputElement>(
      "#setting-server-url"
    )
    const tokenInput =
      container.querySelector<HTMLInputElement>("#setting-token")
    expect(serverInput).toBeTruthy()
    expect(tokenInput).toBeTruthy()

    // Enter a URL that includes /fmeserver and a valid token
    if (serverInput)
      fireEvent.change(serverInput, {
        target: { value: "https://example.com/fmeserver" },
      })
    if (tokenInput)
      fireEvent.change(tokenInput, { target: { value: "abcdefghij" } })

    // Click a button that triggers connection test (which sanitizes URL)
    const testBtn = getTestButton()
    if (testBtn) {
      fireEvent.click(testBtn)
      await waitForMilliseconds(0)
      // Expect at least one onSettingChange call with cleaned URL applied
      const calls = onSettingChange.mock.calls as Array<[any]>
      const hadCleaned = calls.some((args) => {
        const cfg = args?.[0]?.config
        const val = cfg?.get?.("fmeServerUrl") ?? cfg?.fmeServerUrl
        return val === "https://example.com"
      })
      expect(hadCleaned).toBe(true)
    }
  })

  test("invalid single-label host shows server URL error; dotted host passes", () => {
    const onSettingChange = jest.fn()
    const { container } = renderSetting(
      <S
        id="s4"
        widgetId="w-s4"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={baseConfig}
      />
    )

    const serverInput = container.querySelector<HTMLInputElement>(
      "#setting-server-url"
    )
    expect(serverInput).toBeTruthy()

    // Enter single-label host (should be invalid per stricter rules)
    if (serverInput)
      fireEvent.change(serverInput, { target: { value: "https://fmef" } })

    // Expect an inline error alert to be present for the server URL field
    const inlineErr = container.querySelector(
      "#setting-server-url-error, [id^=setting-server-url-error]"
    )
    expect(inlineErr).toBeTruthy()

    // Now enter a dotted host which should be valid
    if (serverInput)
      fireEvent.change(serverInput, {
        target: { value: "https://example.com" },
      })

    // Inline error should clear
    const inlineErrAfter = container.querySelector(
      "#setting-server-url-error, [id^=setting-server-url-error]"
    )
    expect(inlineErrAfter).toBeFalsy()
  })

  test("shows token inline error for invalid tokens", () => {
    const onSettingChange = jest.fn()
    const { container } = renderSetting(
      <S
        id="s5"
        widgetId="w-s5"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={baseConfig}
      />
    )

    const tokenInput =
      container.querySelector<HTMLInputElement>("#setting-token")
    expect(tokenInput).toBeTruthy()

    if (tokenInput) {
      // too short
      fireEvent.change(tokenInput, { target: { value: "short" } })
      const err = container.querySelector("#setting-token-error")
      expect(err).toBeTruthy()

      // contains whitespace
      fireEvent.change(tokenInput, { target: { value: "abcd efghij" } })
      const err2 = container.querySelector("#setting-token-error")
      expect(err2).toBeTruthy()
    }
  })

  test("support email validation shows and clears inline error", () => {
    const onSettingChange = jest.fn()
    const { container } = renderSetting(
      <S
        id="s6"
        widgetId="w-s6"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={baseConfig}
      />
    )

    const emailInput = container.querySelector<HTMLInputElement>(
      "#setting-support-email"
    )
    expect(emailInput).toBeTruthy()

    if (emailInput) {
      fireEvent.change(emailInput, { target: { value: "not-an-email" } })
      const err = container.querySelector("#setting-support-email-error")
      expect(err).toBeTruthy()

      fireEvent.change(emailInput, { target: { value: "a@b.com" } })
      const errAfter = container.querySelector("#setting-support-email-error")
      expect(errAfter).toBeFalsy()
    }
  })

  test("sanitizes serverUrl immediately on change and triggers onSettingChange", async () => {
    const onSettingChange = jest.fn()
    const { container } = renderSetting(
      <S
        id="s7"
        widgetId="w-s7"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={baseConfig}
      />
    )

    const serverInput = container.querySelector<HTMLInputElement>(
      "#setting-server-url"
    )
    expect(serverInput).toBeTruthy()

    if (serverInput) {
      fireEvent.change(serverInput, {
        target: { value: "https://example.com/fmeserver" },
      })
      // allow handlers to run
      await waitForMilliseconds(0)

      const calls = onSettingChange.mock.calls as Array<[any]>
      const hadCleaned = calls.some((args) => {
        const cfg = args?.[0]?.config
        const val = cfg?.get?.("fmeServerUrl") ?? cfg?.fmeServerUrl
        return val === "https://example.com"
      })
      expect(hadCleaned).toBe(true)
    }
  })

  test("test connection button enabled when serverUrl and token present", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    renderSetting(
      <S
        id="s8"
        widgetId="w-s8"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={cfg}
      />
    )

    // wait a tick for useEffect to sync config -> local state
    await waitForMilliseconds(0)

    const btn = getTestButton()
    expect(btn).toBeTruthy()
    // wait a tick for useEffect to sync config -> local state is above; ensure enabled
    expect(btn?.hasAttribute("disabled")).toBe(false)
  })

  test("401 Unauthorized during testConnection marks token invalid", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    // arrange: make testConnection reject with 401 before component mounts
    const Api: any = require("../shared/api").default
    const spy = jest
      .spyOn(Api.prototype, "testConnection")
      .mockRejectedValue({ status: 401 })

    const { container } = renderSetting(
      <S
        id="s9"
        widgetId="w-s9"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={cfg}
      />
    )

    // act: click the test button (component may auto-run, but clicking is safe)
    const testBtn = getTestButton()
    expect(testBtn).toBeTruthy()
    if (testBtn) fireEvent.click(testBtn)

    // assert: connection status shows token failure
    await waitFor(() => {
      const status = container.querySelector('[role="status"]')
      expect(status).toBeTruthy()
      // should show API key (token) row and a failure state
      expect(status?.textContent).toMatch(/API-nyckel[\s\S]*Misslyckades/)
    })

    spy.mockRestore()
  })

  test("404 Not Found during testConnection marks server URL error", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    // arrange: spy before render
    const Api2: any = require("../shared/api").default
    const spy2 = jest
      .spyOn(Api2.prototype, "testConnection")
      .mockRejectedValue({ status: 404 })

    const { container: container2 } = renderSetting(
      <S
        id="s10"
        widgetId="w-s10"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={cfg}
      />
    )

    const testBtn2 = getTestButton()
    expect(testBtn2).toBeTruthy()
    if (testBtn2) fireEvent.click(testBtn2)

    await waitFor(() => {
      const status = container2.querySelector('[role="status"]')
      expect(status).toBeTruthy()
      // server URL row should report failure
      expect(status?.textContent).toMatch(/Server-URL[\s\S]*Misslyckades/)
    })

    spy2.mockRestore()
  })

  test("timeout (408) during testConnection shows server timeout error", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    const Api3: any = require("../shared/api").default
    const spy3 = jest
      .spyOn(Api3.prototype, "testConnection")
      .mockRejectedValue({ status: 408 })

    const { container: container3 } = renderSetting(
      <S
        id="s11"
        widgetId="w-s11"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={cfg}
      />
    )

    const testBtn3 = getTestButton()
    expect(testBtn3).toBeTruthy()
    if (testBtn3) fireEvent.click(testBtn3)

    await waitFor(() => {
      const status = container3.querySelector('[role="status"]')
      expect(status).toBeTruthy()
      // timeout should surface as a server/server-url failure in the status area
      expect(status?.textContent).toMatch(/Server-URL[\s\S]*Misslyckades/)
    })

    spy3.mockRestore()
  })
})
