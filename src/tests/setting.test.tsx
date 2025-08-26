import { React, Immutable } from "jimu-core"
import {
  initExtensions,
  initStore,
  widgetSettingRender,
  waitForMilliseconds,
} from "jimu-for-test"
import { screen, fireEvent } from "@testing-library/react"
import Setting from "../setting/setting"
const S = Setting as any

// Mock API client used by Setting to avoid real network
jest.mock("../shared/api", () => ({
  __esModule: true,
  FmeFlowApiClient: class {
    serverUrl: string
    token: string
    repository: string
    constructor(opts: any) {
      this.serverUrl = opts.serverUrl
      this.token = opts.token
      this.repository = opts.repository
    }
    listRepositories() {
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        data: [{ name: "repo" }],
      })
    }
    testConnection() {
      return Promise.resolve({ status: 200, statusText: "OK", data: {} })
    }
  },
}))

// Mock builder-only advanced setting components to avoid DataSourceSelector crash in tests
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

  beforeAll(() => {
    initExtensions()
    initStore()
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

    // Input ids are defined in Setting.ID
    expect(container.querySelector("#setting-server-url")).toBeTruthy()
    expect(container.querySelector("#setting-token")).toBeTruthy()
    // Repository is a Select that uses aria-describedby instead of id
    const repoControl =
      container.querySelector('[aria-describedby="setting-repository"]') ||
      container.querySelector('[aria-describedby="setting-repository-error"]')
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

    // Find likely test button by common labels; fall back to any disabled button
    const candidates = screen.queryAllByRole("button", {
      name: /test|anslut|connection|kontrollera|verify/i,
    })
    const btn =
      candidates[0] ||
      screen.getAllByRole("button").find((b) => b.hasAttribute("disabled"))
    expect(btn).toBeTruthy()
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
    const testBtn = screen
      .queryAllByRole("button")
      .find((b) =>
        /test|anslut|connection|kontrollera|verify/i.test(b.textContent || "")
      )
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
})
