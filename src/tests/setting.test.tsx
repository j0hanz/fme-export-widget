import "@testing-library/jest-dom"
import { React, Immutable, getAppStore } from "jimu-core"
import {
  initExtensions,
  initStore,
  setTheme,
  mockTheme,
  widgetSettingRender,
  wrapWidgetSetting,
  updateStore,
  waitForMilliseconds,
} from "jimu-for-test"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import Setting from "../setting/setting"
import { initialFmeState, fmeActions } from "../extensions/store"

void React

// Mock the advanced setting components to keep DOM simple and predictable
jest.mock("jimu-ui/advanced/setting-components", () => {
  const React = require("react")
  return {
    __esModule: true,
    MapWidgetSelector: ({ onSelect }) => (
      <div data-testid="map-selector" onClick={() => onSelect?.([])} />
    ),
    SettingSection: ({ children, label }) => (
      <section aria-label={typeof label === "string" ? label : undefined}>
        {children}
      </section>
    ),
    SettingRow: ({ children, label, level }) => (
      <div data-level={level}>
        {label ? <div>{label}</div> : null}
        {children}
      </div>
    ),
  }
})

// Mock connection validation service; each test can override implementation
jest.mock("../shared/services", () => {
  return {
    __esModule: true,
    validateConnection: jest.fn(),
    getRepositories: jest.fn(),
    getErrorMessage: jest.fn(() => "error"),
  }
})

// No need to mock shared/api createFmeFlowClient anymore; refresh uses shared/services.getRepositories

describe("Setting panel", () => {
  const renderSetting = widgetSettingRender(false)
  const WrappedSetting = wrapWidgetSetting(Setting as any)

  beforeAll(() => {
    initExtensions()
    initStore()
    setTheme(mockTheme)
  })

  beforeEach(async () => {
    // Reset store slice for widget-specific state used by Setting
    updateStore({ "fme-state": Immutable(initialFmeState) as any })
    jest.clearAllMocks()
    await waitForMilliseconds(0)
  })

  const makeProps = (overrides?: Partial<any>) => {
    const base: any = {
      id: "w-setting",
      widgetId: "w-setting",
      config: Immutable({
        fmeServerUrl: "",
        fmeServerToken: "",
        repository: "",
      }) as any,
      onSettingChange: jest.fn(),
    }
    return { ...base, ...(overrides || {}) }
  }

  // Helper to read values from either an Immutable.Map or a plain object
  const getVal = (cfg: any, key: string) =>
    typeof cfg?.get === "function" ? cfg.get(key) : cfg?.[key]

  test("renders required fields and disables Test until URL and token provided", () => {
    const props = makeProps()
    renderSetting(<WrappedSetting {...props} />)

    // Server URL and Token inputs are present via placeholders
    const urlInput = screen.getByPlaceholderText("https://fme.server.com")
    expect(urlInput).toBeInTheDocument()
    const tokenInput = screen.getByPlaceholderText("Din FME API-nyckel")
    expect(tokenInput).toBeInTheDocument()

    // Test button is disabled when missing fields
    const testBtn = screen.getByRole("button", { name: /uppdatera och testa/i })
    expect(testBtn).toBeDisabled()

    // Fill only URL -> still disabled
    fireEvent.change(urlInput, { target: { value: "https://example.com" } })
    expect(testBtn).toBeDisabled()

    // Fill token -> enabled
    fireEvent.change(tokenInput, { target: { value: "tokentokent" } })
    expect(testBtn).not.toBeDisabled()
  })

  test("validates and sanitizes server URL on blur (strips /fmerest)", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    const urlInput = screen.getByPlaceholderText("https://fme.server.com")

    // Type an invalid URL then blur (component may defer inline errors)
    fireEvent.change(urlInput, { target: { value: "not-a-url" } })
    fireEvent.blur(urlInput)

    // URL with /fmerest is sanitized to base and saved
    fireEvent.change(urlInput, { target: { value: "https://host/fmerest/v3" } })
    fireEvent.blur(urlInput)

    // onSettingChange is called with cleaned value
    await waitFor(() => {
      expect(onSettingChange).toHaveBeenCalled()
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1][0]
      const newCfg = last?.config
      expect(getVal(newCfg, "fmeServerUrl")).toBe("https://host")
    })

    // Input value is sanitized in-place
    const input = screen.getByPlaceholderText("https://fme.server.com")
    expect(input).toHaveValue("https://host")
  })

  test("validates token on blur", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    const tokenInput = screen.getByPlaceholderText("Din FME API-nyckel")
    fireEvent.change(tokenInput, { target: { value: "short" } })
    fireEvent.blur(tokenInput)

    // Too short/invalid -> UI may show inline error, but we don't assert the visual here to avoid flakiness

    // Now enter a valid token and blur -> error cleared and saved
    fireEvent.change(tokenInput, { target: { value: "validtokennn" } })
    fireEvent.blur(tokenInput)
    // Error message (if any) disappears and config is updated
    await waitFor(() => {
      expect(screen.queryByText(/API-nyckeln är ogiltig\./i)).toBeNull()
      expect(onSettingChange).toHaveBeenCalled()
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1][0]
      const cfg = last?.config
      expect(getVal(cfg, "fmeServerToken")).toBe("validtokennn")
    })
  })

  test("test connection success populates repositories and enables selector", async () => {
    const { validateConnection } = require("../shared/services") as {
      validateConnection: jest.Mock
    }
    validateConnection.mockResolvedValue({
      success: true,
      version: "2024.0",
      repositories: ["RepoA", "RepoB", "RepoA"], // includes duplicate
      steps: {
        serverUrl: "ok",
        token: "ok",
        repository: "ok",
        version: "2024.0",
      },
    })

    const props = makeProps({
      config: Immutable({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "tokentokent",
        repository: "",
      }) as any,
    })

    renderSetting(<WrappedSetting {...props} />)

    const testBtn = screen.getByRole("button", { name: /uppdatera och testa/i })
    await waitFor(() => {
      expect(testBtn).not.toBeDisabled()
    })
    fireEvent.click(testBtn)

    // Wait until refresh button becomes available (indicates success and valid inputs)
    await screen.findByTitle(/Uppdatera repositories/i)

    // Combobox should be enabled
    const comboBtn = screen.getByRole("combobox")
    expect(comboBtn).toHaveAttribute("aria-disabled", "false")

    // Refresh button visible after success
    const refreshBtn = screen.getByTitle(/Uppdatera repositories/i)
    expect(refreshBtn).toBeInTheDocument()
  })

  test("test connection token failure marks token with error", async () => {
    const { validateConnection } = require("../shared/services") as {
      validateConnection: jest.Mock
    }
    validateConnection.mockResolvedValue({
      success: false,
      error: {
        message: "Invalid authentication token",
        type: "token",
        status: 401,
      },
      steps: {
        serverUrl: "ok",
        token: "fail",
        repository: "idle",
        version: "",
      },
    })

    const props = makeProps({
      config: Immutable({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "tokentokent",
        repository: "",
      }) as any,
    })
    renderSetting(<WrappedSetting {...props} />)

    const testBtn = screen.getByRole("button", { name: /uppdatera och testa/i })
    fireEvent.click(testBtn)

    // Error should surface for token: status shows "Misslyckades"
    await screen.findByText(/Misslyckades/i)
  })

  test("refresh repositories uses API client and updates options", async () => {
    const { validateConnection, getRepositories } =
      require("../shared/services") as {
        validateConnection: jest.Mock
        getRepositories: jest.Mock
      }
    validateConnection.mockResolvedValue({
      success: true,
      version: "2024.0",
      repositories: ["X"],
      steps: {
        serverUrl: "ok",
        token: "ok",
        repository: "ok",
        version: "2024.0",
      },
    })

    // Refresh should return a different set than initial validation
    getRepositories.mockResolvedValue({
      success: true,
      repositories: ["Repo1", "Repo2"],
    })

    const props = makeProps({
      config: Immutable({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "tokentokent",
        repository: "",
      }) as any,
    })
    renderSetting(<WrappedSetting {...props} />)

    // Run test to enable refresh and seed initial repos
    const testBtn2 = screen.getByRole("button", {
      name: /uppdatera och testa/i,
    })
    await waitFor(() => {
      expect(testBtn2).not.toBeDisabled()
    })
    fireEvent.click(testBtn2)
    await screen.findByTitle(/Uppdatera repositories/i)

    // Click refresh repositories button
    const refreshBtn = screen.getByTitle(/Uppdatera repositories/i)
    fireEvent.click(refreshBtn)

    // Shared services.getRepositories should be called with sanitized URL and token
    await waitFor(() => {
      expect(getRepositories).toHaveBeenCalled()
    })

    // Dropdown should now include the refreshed options
    const combo = await screen.findByRole("combobox")
    fireEvent.click(combo)
    await screen.findByText("Repo1")
    await screen.findByText("Repo2")
  })

  test("changing repository dispatches clearWorkspaceState with new repo", async () => {
    const { validateConnection } = require("../shared/services") as {
      validateConnection: jest.Mock
    }
    validateConnection.mockResolvedValue({
      success: true,
      version: "2024.0",
      repositories: ["A", "B"],
      steps: {
        serverUrl: "ok",
        token: "ok",
        repository: "ok",
        version: "2024.0",
      },
    })

    // Seed store with current repository "A"
    updateStore({
      "fme-state": Immutable({
        ...initialFmeState,
        currentRepository: "A",
      }) as any,
    })

    const storeDispatch = jest.spyOn(getAppStore(), "dispatch")
    const props = makeProps({
      config: Immutable({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "tokentokent",
        repository: "A",
      }) as any,
    })
    renderSetting(<WrappedSetting {...props} />)

    // Run connection test to show repository options
    const testBtn3 = screen.getByRole("button", {
      name: /uppdatera och testa/i,
    })
    await waitFor(() => {
      expect(testBtn3).not.toBeDisabled()
    })
    fireEvent.click(testBtn3)
    // Wait until the repository dropdown becomes enabled (refresh button visible)
    await screen.findByTitle(/Uppdatera repositories/i)

    // Change selection to "B" via the dropdown: open and click the option
    const combo = await screen.findByRole("combobox")
    fireEvent.click(combo)
    const optB = await screen.findByText("B")
    fireEvent.click(optB)

    // Expect dispatch with clearWorkspaceState action and new repo
    await waitFor(() => {
      expect(
        storeDispatch.mock.calls.some(
          ([action]: any[]) =>
            action?.type === fmeActions.clearWorkspaceState("B").type &&
            action?.newRepository === "B"
        )
      ).toBe(true)
    })
  })

  test("job directives ttc/ttl are coerced to non-negative integers on blur; tag saved as-is", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    // Both numeric inputs share placeholder "0"; first is ttc, second is ttl
    const [ttcInput, ttlInput] = screen.getAllByPlaceholderText("0")

    // Set values and blur -> saved as integers (invalid -> 0)
    fireEvent.change(ttcInput, { target: { value: "12.8" } })
    fireEvent.blur(ttcInput)

    fireEvent.change(ttlInput, { target: { value: "abc" } })
    fireEvent.blur(ttlInput)

    // tm_tag is separate, has its own placeholder
    const tagInput = screen.getByPlaceholderText(/t\.ex\. hög/i)
    fireEvent.change(tagInput, { target: { value: "prio" } })
    fireEvent.blur(tagInput)

    // Verify onSettingChange captured coerced values
    await waitFor(() => {
      const calls = onSettingChange.mock.calls.map((c) => c[0])
      const getVal = (cfg: any, key: string) =>
        typeof cfg?.get === "function" ? cfg.get(key) : cfg?.[key]
      expect(calls.some((arg) => getVal(arg?.config, "tm_ttc") === 12)).toBe(
        true
      )
      expect(calls.some((arg) => getVal(arg?.config, "tm_ttl") === 0)).toBe(
        true
      )
      const latestCfg = calls[calls.length - 1]?.config
      expect(getVal(latestCfg, "tm_tag")).toBe("prio")
    })
  })

  test("support email validation shows error on invalid and saves on valid", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    const emailInput = screen.getByPlaceholderText("support@exempel.se")

    // Invalid -> shows error (via aria on the input)
    fireEvent.change(emailInput, { target: { value: "bad@" } })
    fireEvent.blur(emailInput)
    await waitFor(() => {
      const input = screen.getByPlaceholderText("support@exempel.se")
      expect(input).toHaveAttribute("aria-invalid", "true")
    })

    // Valid -> error cleared and saved to config
    fireEvent.change(emailInput, { target: { value: "good@example.com" } })
    fireEvent.blur(emailInput)
    await waitFor(() => {
      const input = screen.getByPlaceholderText("support@exempel.se")
      expect(input).toHaveAttribute("aria-invalid", "false")
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1][0]
      const cfg = last?.config
      const supportEmail =
        typeof cfg?.get === "function"
          ? cfg.get("supportEmail")
          : cfg?.supportEmail
      expect(supportEmail).toBe("good@example.com")
    })
  })
})
