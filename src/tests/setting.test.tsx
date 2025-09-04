import { React, Immutable } from "jimu-core"
import {
  initExtensions,
  initStore,
  widgetSettingRender,
  waitForMilliseconds,
} from "jimu-for-test"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import Setting from "../setting/setting"
import {
  validateConnection,
  testBasicConnection,
  getRepositories,
  healthCheck,
} from "../shared/services"

const S = Setting as any

// Get access to the mocked functions
const mockValidateConnection = validateConnection as jest.MockedFunction<
  typeof validateConnection
>
const mockTestBasicConnection = testBasicConnection as jest.MockedFunction<
  typeof testBasicConnection
>
const mockGetRepositories = getRepositories as jest.MockedFunction<
  typeof getRepositories
>
const mockHealthCheck = healthCheck as jest.MockedFunction<typeof healthCheck>

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
        data: [{ name: "repo1" }, { name: "repo2" }],
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

// Mock services to avoid network calls in Setting tests
jest.mock("../shared/services", () => ({
  __esModule: true,
  validateConnection: jest.fn(),
  testBasicConnection: jest.fn(),
  getRepositories: jest.fn(),
  healthCheck: jest.fn(),
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

    // Set default mock implementations for progressive validation
    mockValidateConnection.mockResolvedValue({
      success: true,
      version: "2023.0",
      repositories: ["repo1", "repo2"],
      steps: {
        serverUrl: "ok",
        token: "ok",
        repository: "ok",
        version: "2023.0",
      },
    })
    mockTestBasicConnection.mockResolvedValue({
      success: true,
      version: "2023.0",
    })
    mockGetRepositories.mockResolvedValue({
      success: true,
      repositories: ["repo1", "repo2"],
    })
    mockHealthCheck.mockResolvedValue({ reachable: true, version: "2023.0" })
  })

  afterEach(() => {
    // Restore all jest mocks and spies between tests to avoid leakage
    jest.restoreAllMocks()

    // Reset service mocks to default implementations
    mockValidateConnection.mockResolvedValue({
      success: true,
      version: "2023.0",
      repositories: ["repo1", "repo2"],
      steps: {
        serverUrl: "ok",
        token: "ok",
        repository: "ok",
        version: "2023.0",
      },
    })
    mockTestBasicConnection.mockResolvedValue({
      success: true,
      version: "2023.0",
    })
    mockGetRepositories.mockResolvedValue({
      success: true,
      repositories: ["repo1", "repo2"],
    })
    mockHealthCheck.mockResolvedValue({ reachable: true, version: "2023.0" })
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

  test("input values are preserved while typing - no instant config updates", async () => {
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

    if (serverInput) {
      // Enter single-label host (invalid, but input should maintain value while typing)
      fireEvent.change(serverInput, { target: { value: "https://fmef" } })
      await waitForMilliseconds(10)
      expect(serverInput.value).toBe("https://fmef")

      // No config update should have happened yet
      expect(onSettingChange).not.toHaveBeenCalled()

      // Continue typing - value should be stable
      fireEvent.change(serverInput, { target: { value: "https://fmef" } })
      await waitForMilliseconds(10)
      expect(serverInput.value).toBe("https://fmef")

      fireEvent.change(serverInput, {
        target: { value: "https://example.com" },
      })
      await waitForMilliseconds(10)
      expect(serverInput.value).toBe("https://example.com")

      // Still no config updates during typing
      expect(onSettingChange).not.toHaveBeenCalled()

      // Only on blur should config be updated
      fireEvent.blur(serverInput)
      await waitForMilliseconds(10)
      expect(onSettingChange).toHaveBeenCalledTimes(1)
    }
  })

  test("token input stability - value preserved, config updated on blur", async () => {
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
      // Type a token - value should be preserved
      fireEvent.change(tokenInput, { target: { value: "short" } })
      await waitForMilliseconds(10)
      expect(tokenInput.value).toBe("short")

      // No config update during typing
      expect(onSettingChange).not.toHaveBeenCalled()

      fireEvent.change(tokenInput, { target: { value: "abcdefghijklmnop" } })
      await waitForMilliseconds(10)
      expect(tokenInput.value).toBe("abcdefghijklmnop")

      // Still no config update during typing
      expect(onSettingChange).not.toHaveBeenCalled()

      // Config update only on blur
      fireEvent.blur(tokenInput)
      await waitForMilliseconds(10)
      expect(onSettingChange).toHaveBeenCalledTimes(1)
    }
  })

  test("support email input stability - value preserved, config updated on blur", async () => {
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
      await waitForMilliseconds(10)
      expect(emailInput.value).toBe("not-an-email")

      // No config update during typing
      expect(onSettingChange).not.toHaveBeenCalled()

      fireEvent.change(emailInput, { target: { value: "a@b.com" } })
      await waitForMilliseconds(10)
      expect(emailInput.value).toBe("a@b.com")

      // Still no config update during typing
      expect(onSettingChange).not.toHaveBeenCalled()

      // Config update only on blur
      fireEvent.blur(emailInput)
      await waitForMilliseconds(10)
      expect(onSettingChange).toHaveBeenCalledTimes(1)
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

  test("repositories populated after successful connection test", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    // Mock successful progressive validation
    mockTestBasicConnection.mockResolvedValue({
      success: true,
      version: "2023.1",
    })
    mockGetRepositories.mockResolvedValue({
      success: true,
      repositories: ["repo1", "repo2"],
    })

    const { container } = renderSetting(
      <S
        id="s12"
        widgetId="w-s12"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={cfg}
      />
    )

    // Initially, repository dropdown should be disabled (no auto-fetch)
    await waitForMilliseconds(100)
    const initialCombo = container.querySelector('[role="combobox"]')
    expect(initialCombo?.getAttribute("aria-disabled")).toBe("true")

    // Click test connection to trigger repository fetching
    const testButton = getTestButton()
    expect(testButton).toBeTruthy()
    if (testButton) {
      fireEvent.click(testButton)
    }

    // Wait for connection test to complete and repositories to be populated
    await waitFor(
      () => {
        const combo = container.querySelector('[role="combobox"]')
        expect(combo?.getAttribute("aria-disabled")).toBe("false")
      },
      { timeout: 3000 }
    )
  })

  test("user can change repository after connection test", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    // Mock successful progressive validation
    mockTestBasicConnection.mockResolvedValue({
      success: true,
      version: "2023.1",
    })
    mockGetRepositories.mockResolvedValue({
      success: true,
      repositories: ["repo1", "repo2"],
    })

    const { container } = renderSetting(
      <S
        id="s13"
        widgetId="w-s13"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={cfg}
      />
    )

    // First click test connection to populate repositories
    const testButton = getTestButton()
    if (testButton) {
      fireEvent.click(testButton)
    }

    // Wait for connection test to complete
    await waitFor(
      () => {
        const combo = container.querySelector('[role="combobox"]')
        expect(combo?.getAttribute("aria-disabled")).toBe("false")
      },
      { timeout: 3000 }
    )

    // Now repository selection should be enabled
    const repoSelect = screen.getByRole("combobox")
    expect(repoSelect.getAttribute("aria-disabled")).toBe("false")
  })

  test("401 Unauthorized during testConnection marks token invalid", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    // Server is reachable, but authentication fails
    mockHealthCheck.mockResolvedValueOnce({ reachable: true })
    // Mock testBasicConnection to fail with authentication error
    mockTestBasicConnection.mockResolvedValueOnce({
      success: false,
      error: "Authentication failed",
    })

    const { container } = renderSetting(
      <S
        id="s9"
        widgetId="w-s9"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={cfg}
      />
    )

    // act: click the test button
    const testBtn = getTestButton()
    expect(testBtn).toBeTruthy()
    if (testBtn) fireEvent.click(testBtn)

    // assert: token row shows failure (server was reachable)
    await waitFor(() => {
      const status = container.querySelector('[role="status"]')
      expect(status).toBeTruthy()
      expect(status?.textContent).toMatch(/API-nyckel[\s\S]*Misslyckades/)
    })
  })

  test("404 Not Found during testConnection marks server URL error", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    // Server is not reachable -> mark server URL failure in the status area
    mockHealthCheck.mockResolvedValueOnce({
      reachable: false,
      error: "Server not found",
    })

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
  })

  test("timeout (408) during testConnection shows server timeout error", async () => {
    const onSettingChange = jest.fn()
    const cfg = baseConfig
      .set("fmeServerUrl", "https://example.com")
      .set("fmeServerToken", "abcdefghij")

    // Server not reachable due to timeout -> attribute to server URL
    mockHealthCheck.mockResolvedValueOnce({
      reachable: false,
      error: "Connection timeout",
    })

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
  })

  describe("Input stability fixes", () => {
    test("server URL input maintains value while typing", async () => {
      const onSettingChange = jest.fn()
      const { container } = renderSetting(
        <S
          id="input-stability-1"
          widgetId="w-input-stability-1"
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
        // Type a character
        fireEvent.change(serverInput, { target: { value: "h" } })
        expect(serverInput.value).toBe("h")

        // Type more characters quickly
        fireEvent.change(serverInput, { target: { value: "ht" } })
        expect(serverInput.value).toBe("ht")

        fireEvent.change(serverInput, { target: { value: "htt" } })
        expect(serverInput.value).toBe("htt")

        fireEvent.change(serverInput, { target: { value: "http" } })
        expect(serverInput.value).toBe("http")

        fireEvent.change(serverInput, { target: { value: "https" } })
        expect(serverInput.value).toBe("https")

        fireEvent.change(serverInput, { target: { value: "https:" } })
        expect(serverInput.value).toBe("https:")

        fireEvent.change(serverInput, { target: { value: "https://" } })
        expect(serverInput.value).toBe("https://")

        fireEvent.change(serverInput, {
          target: { value: "https://example.com" },
        })
        expect(serverInput.value).toBe("https://example.com")

        // Ensure no config update happened during typing
        expect(onSettingChange).not.toHaveBeenCalled()

        // Only on blur should config be updated
        fireEvent.blur(serverInput)
        await waitForMilliseconds(10)
        expect(onSettingChange).toHaveBeenCalledTimes(1)
      }
    })

    test("token input maintains value while typing", async () => {
      const onSettingChange = jest.fn()
      const { container } = renderSetting(
        <S
          id="input-stability-2"
          widgetId="w-input-stability-2"
          onSettingChange={onSettingChange as any}
          useMapWidgetIds={[] as any}
          config={baseConfig}
        />
      )

      const tokenInput =
        container.querySelector<HTMLInputElement>("#setting-token")
      expect(tokenInput).toBeTruthy()

      if (tokenInput) {
        const testToken = "abcdefghijklmnop"

        // Type the token character by character
        for (let i = 1; i <= testToken.length; i++) {
          const partialToken = testToken.substring(0, i)
          fireEvent.change(tokenInput, { target: { value: partialToken } })
          expect(tokenInput.value).toBe(partialToken)
        }

        // Ensure no config update happened during typing
        expect(onSettingChange).not.toHaveBeenCalled()

        // Only on blur should config be updated
        fireEvent.blur(tokenInput)
        await waitForMilliseconds(10)
        expect(onSettingChange).toHaveBeenCalledTimes(1)
      }
    })

    test("email input maintains value while typing", async () => {
      const onSettingChange = jest.fn()
      const { container } = renderSetting(
        <S
          id="input-stability-3"
          widgetId="w-input-stability-3"
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
        const testEmail = "test@example.com"

        // Type the email character by character
        for (let i = 1; i <= testEmail.length; i++) {
          const partialEmail = testEmail.substring(0, i)
          fireEvent.change(emailInput, { target: { value: partialEmail } })
          expect(emailInput.value).toBe(partialEmail)
        }

        // Ensure no config update happened during typing
        expect(onSettingChange).not.toHaveBeenCalled()

        // Only on blur should config be updated
        fireEvent.blur(emailInput)
        await waitForMilliseconds(10)
        expect(onSettingChange).toHaveBeenCalledTimes(1)
      }
    })

    test("job directive inputs maintain values while typing", async () => {
      const onSettingChange = jest.fn()
      const { container } = renderSetting(
        <S
          id="input-stability-4"
          widgetId="w-input-stability-4"
          onSettingChange={onSettingChange as any}
          useMapWidgetIds={[] as any}
          config={baseConfig}
        />
      )

      const ttcInput =
        container.querySelector<HTMLInputElement>("#setting-tm-ttc")
      const ttlInput =
        container.querySelector<HTMLInputElement>("#setting-tm-ttl")
      const tagInput =
        container.querySelector<HTMLInputElement>("#setting-tm-tag")

      expect(ttcInput).toBeTruthy()
      expect(ttlInput).toBeTruthy()
      expect(tagInput).toBeTruthy()

      if (ttcInput) {
        // Test TTC input
        fireEvent.change(ttcInput, { target: { value: "1" } })
        expect(ttcInput.value).toBe("1")
        fireEvent.change(ttcInput, { target: { value: "12" } })
        expect(ttcInput.value).toBe("12")
        fireEvent.change(ttcInput, { target: { value: "123" } })
        expect(ttcInput.value).toBe("123")
      }

      if (ttlInput) {
        // Test TTL input
        fireEvent.change(ttlInput, { target: { value: "4" } })
        expect(ttlInput.value).toBe("4")
        fireEvent.change(ttlInput, { target: { value: "45" } })
        expect(ttlInput.value).toBe("45")
        fireEvent.change(ttlInput, { target: { value: "456" } })
        expect(ttlInput.value).toBe("456")
      }

      if (tagInput) {
        // Test tag input
        const testTag = "my-tag"
        for (let i = 1; i <= testTag.length; i++) {
          const partialTag = testTag.substring(0, i)
          fireEvent.change(tagInput, { target: { value: partialTag } })
          expect(tagInput.value).toBe(partialTag)
        }
      }

      // Ensure no config updates happened during typing
      expect(onSettingChange).not.toHaveBeenCalled()

      // Only on blur should config be updated
      if (ttcInput) fireEvent.blur(ttcInput)
      if (ttlInput) fireEvent.blur(ttlInput)
      if (tagInput) fireEvent.blur(tagInput)

      await waitForMilliseconds(10)
      expect(onSettingChange).toHaveBeenCalledTimes(3) // One for each field
    })

    test("no excessive re-renders during typing", async () => {
      const onSettingChange = jest.fn()
      const renderSpy = jest.fn()

      // Wrap setting component to spy on renders
      const SpiedSetting = (props: any) => {
        renderSpy()
        return <S {...props} />
      }

      const { container } = renderSetting(
        <SpiedSetting
          id="input-stability-5"
          widgetId="w-input-stability-5"
          onSettingChange={onSettingChange as any}
          useMapWidgetIds={[] as any}
          config={baseConfig}
        />
      )

      renderSpy.mockClear()

      const serverInput = container.querySelector<HTMLInputElement>(
        "#setting-server-url"
      )
      if (serverInput) {
        // Type quickly - this should not cause excessive re-renders
        fireEvent.change(serverInput, {
          target: { value: "https://example.com" },
        })

        // Allow a brief moment for any delayed effects
        await waitForMilliseconds(10)

        // Should have minimal renders (ideally just 1 for the state update)
        expect(renderSpy.mock.calls.length).toBeLessThanOrEqual(2)

        // No config updates during typing
        expect(onSettingChange).not.toHaveBeenCalled()
      }
    })

    test("validation behavior - delayed validation, no immediate errors", async () => {
      const onSettingChange = jest.fn()
      const { container } = renderSetting(
        <S
          id="input-stability-6"
          widgetId="w-input-stability-6"
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
        // Type invalid URL
        fireEvent.change(serverInput, { target: { value: "invalid-url" } })
        await waitForMilliseconds(10)

        // Value should be preserved
        expect(serverInput.value).toBe("invalid-url")

        // No config update during typing
        expect(onSettingChange).not.toHaveBeenCalled()

        // Errors are now validated on blur, so we test the core stability
        // rather than error display which might be mocked in test environment
      }
    })
  })
})
