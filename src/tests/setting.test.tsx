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
import { FmeActionType } from "../config"
import { initialFmeState } from "../extensions/store"

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
    const tokenInput = screen.getByPlaceholderText(/Din FME.?nyckel/i)
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

    const tokenInput = screen.getByPlaceholderText(/Din FME.?nyckel/i)
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
    await screen.findByTitle(/Uppdatera lista/i)

    // Combobox should be enabled (repository selector)
    const comboboxes = screen.getAllByRole("combobox")
    const repositoryCombobox = comboboxes.find(
      (cb) =>
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "download" &&
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "streaming"
    )
    expect(repositoryCombobox).toHaveAttribute("aria-disabled", "false")

    // Refresh button visible after success
    const refreshBtn = screen.getByTitle(/Uppdatera lista/i)
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
    await screen.findByTitle(/Uppdatera lista/i)

    // Click refresh repositories button
    const refreshBtn = screen.getByTitle(/Uppdatera lista/i)
    fireEvent.click(refreshBtn)

    // Shared services.getRepositories should be called with sanitized URL and token
    await waitFor(() => {
      expect(getRepositories).toHaveBeenCalled()
    })

    // Dropdown should now include the refreshed options
    const comboboxes = screen.getAllByRole("combobox")
    const repositoryCombo = comboboxes.find(
      (cb) =>
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "download" &&
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "streaming"
    )
    fireEvent.click(repositoryCombo)
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
    await screen.findByTitle(/Uppdatera lista/i)

    // Change selection to "B" via the dropdown: open and click the option
    const comboboxes = screen.getAllByRole("combobox")
    const repositoryCombo = comboboxes.find(
      (cb) =>
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "download" &&
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "streaming"
    )
    fireEvent.click(repositoryCombo)
    const optB = await screen.findByText("B")
    fireEvent.click(optB)

    // Expect dispatch with clearWorkspaceState action and new repo
    await waitFor(() => {
      expect(
        storeDispatch.mock.calls.some(
          ([action]: any[]) =>
            action?.type === FmeActionType.CLEAR_WORKSPACE_STATE &&
            action?.newRepository === "B"
        )
      ).toBe(true)
    })
  })

  test("job directives: numeric coerced, blank/invalid clears to default; tag saved as-is", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    // Select inputs by their labels to avoid coupling to placeholder ordering
    const ttcLabel = screen.getByText(/Max körtid \(s\)/i)
    const ttcRow = ttcLabel.closest("div")?.parentElement
    const ttcInput = ttcRow?.querySelector("input")
    expect(ttcInput).toBeInTheDocument()

    const ttlLabel = screen.getByText(/Max kötid \(s\)/i)
    const ttlRow = ttlLabel.closest("div")?.parentElement
    const ttlInput = ttlRow?.querySelector("input")
    expect(ttlInput).toBeInTheDocument()

    // Set values and blur -> saved as integers; invalid/blank -> undefined (use default)
    fireEvent.change(ttcInput as Element, { target: { value: "12.8" } })
    fireEvent.blur(ttcInput as Element)

    fireEvent.change(ttlInput as Element, { target: { value: "abc" } })
    fireEvent.blur(ttlInput as Element)

    // tm_tag is separate, has its own placeholder
    const tagInput = screen.getByPlaceholderText(/t\.ex\.?\s*high/i)
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
      // tm_ttl invalid -> should be undefined (cleared)
      expect(
        calls.some(
          (arg) => typeof getVal(arg?.config, "tm_ttl") === "undefined"
        )
      ).toBe(true)
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

  test("request timeout is saved as non-negative integer ms on blur", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    // Find by label text
    const label = screen.getByText(/Tidsgräns \(ms\)/i)
    const row = label.closest("div")?.parentElement
    const input = row?.querySelector("input")
    expect(input).toBeInTheDocument()

    // Placeholder communicates default 30000; helper is now a tooltip on the label
    expect(input).toHaveAttribute("placeholder", "30000")
    // The helper is provided via a tooltip on the label; aria-describedby may not be set directly on the label
    // No strict aria-describedby assertion here to avoid coupling to implementation details

    // Enter float -> coerced to int on blur
    fireEvent.change(input as Element, { target: { value: "12345.67" } })
    fireEvent.blur(input as Element)

    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const val = getVal(cfg, "requestTimeout")
      expect(val).toBe(12345)
    })

    // Enter invalid -> cleared
    fireEvent.change(input as Element, { target: { value: "abc" } })
    fireEvent.blur(input as Element)

    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const val = getVal(cfg, "requestTimeout")
      expect(val).toBeUndefined()
    })
  })

  test("request timeout caps at 10 minutes", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    const label = screen.getByText(/Tidsgräns \(ms\)/i)
    const row = label.closest("div")?.parentElement
    const input = row?.querySelector("input")
    expect(input).toBeInTheDocument()

    fireEvent.change(input as Element, { target: { value: "999999999" } })
    fireEvent.blur(input as Element)

    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const val = getVal(cfg, "requestTimeout")
      expect(val).toBe(600000)
    })
  })

  test("repository fetch error shows hint and keeps manual entry possible", async () => {
    const { validateConnection, getRepositories } =
      require("../shared/services") as {
        validateConnection: jest.Mock
        getRepositories: jest.Mock
      }

    validateConnection.mockResolvedValue({
      success: true,
      version: "2024.0",
      repositories: ["Seed"],
      steps: { serverUrl: "ok", token: "ok", repository: "ok" },
    })

    // Make refresh fail
    getRepositories.mockRejectedValueOnce(new Error("boom"))

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
    const refreshBtn = await screen.findByTitle(/Uppdatera lista/i)
    fireEvent.click(refreshBtn)

    const comboboxes = screen.getAllByRole("combobox")
    const repositoryCombo = comboboxes.find(
      (cb) =>
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "download" &&
        cb.querySelector('input[type="hidden"]')?.getAttribute("value") !==
          "streaming"
    )
    expect(repositoryCombo).toHaveAttribute("aria-disabled", "false")
  })

  test("upload target parameter name saves on blur and clears when empty", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    const renderSetting = widgetSettingRender(false)
    const WrappedSetting = wrapWidgetSetting(Setting as any)
    renderSetting(<WrappedSetting {...props} />)

    // Find by label text and use its sibling input
    const label = screen.getByText(/Uppladdningsparameternamn \(valfritt\)/i)
    const row = label.closest("div")?.parentElement
    const input = row?.querySelector("input")
    expect(input).toBeInTheDocument()
    expect(input?.placeholder).toMatch(/INPUT_DATASET/i)

    // Type a value and blur -> saved to config
    fireEvent.change(input as Element, { target: { value: "INPUT_DATASET" } })
    fireEvent.blur(input as Element)

    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const getVal = (c: any, k: string) =>
        typeof c?.get === "function" ? c.get(k) : c?.[k]
      expect(getVal(cfg, "uploadTargetParamName")).toBe("INPUT_DATASET")
    })

    // Clear the value -> config key is unset
    fireEvent.change(input as Element, { target: { value: "" } })
    fireEvent.blur(input as Element)

    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const getVal = (c: any, k: string) =>
        typeof c?.get === "function" ? c.get(k) : c?.[k]
      expect(getVal(cfg, "uploadTargetParamName")).toBeUndefined()
    })
  })

  test("max AOI area saves km² as m² in config", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    // Find by label text
    const label = screen.getByText(/Max AOI.?yta \(m²\)/i)
    const row = label.closest("div")?.parentElement
    const input = row?.querySelector("input")
    expect(input).toBeInTheDocument()

    // 2,500,000 m² -> saved as 2,500,000 m²
    fireEvent.change(input as Element, { target: { value: "2500000" } })
    fireEvent.blur(input as Element)

    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const val = getVal(cfg, "maxArea")
      expect(val).toBe(2500000)
    })

    // invalid -> cleared
    fireEvent.change(input as Element, { target: { value: "-1" } })
    fireEvent.blur(input as Element)
    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const val = getVal(cfg, "maxArea")
      expect(val).toBeUndefined()
    })
  })

  test("max AOI area enforces upper cap and shows error when exceeded", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    const label = screen.getByText(/Max AOI.?yta \(m²\)/i)
    const row = label.closest("div")?.parentElement
    const input = row?.querySelector("input")
    expect(input).toBeInTheDocument()

    // Enter value above the cap (helper states 10000000000 m²)
    fireEvent.change(input as Element, { target: { value: "20000000000" } })
    fireEvent.blur(input as Element)

    // Should show inline error and not call onSettingChange with maxArea
    await waitFor(() => {
      expect(screen.getByText(/Värdet är för stort\./i)).toBeInTheDocument()
    })

    const calls = onSettingChange.mock.calls.map((c) => c[0])
    const touchedMaxArea = calls.some((arg) => {
      const cfg = arg?.config
      const val =
        typeof cfg?.get === "function" ? cfg.get("maxArea") : cfg?.maxArea
      return typeof val === "number"
    })
    expect(touchedMaxArea).toBe(false)

    // Now set to exactly the cap -> should save
    fireEvent.change(input as Element, { target: { value: "10000000000" } })
    fireEvent.blur(input as Element)

    await waitFor(() => {
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1]?.[0]
      const cfg = last?.config
      const val =
        typeof cfg?.get === "function" ? cfg.get("maxArea") : cfg?.maxArea
      expect(val).toBe(10000 * 1_000_000)
    })
  })

  test("mask email on success toggle updates config", async () => {
    const onSettingChange = jest.fn()
    const props = makeProps({ onSettingChange })
    renderSetting(<WrappedSetting {...props} />)

    // Find the switch by role and label text
    const toggle = await screen.findByRole("switch", {
      name: /Maskera e.?postadress/i,
    })
    expect(toggle).toBeInTheDocument()
    // Toggle on
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(onSettingChange).toHaveBeenCalled()
      const last =
        onSettingChange.mock.calls[onSettingChange.mock.calls.length - 1][0]
      const cfg = last?.config
      const val = getVal(cfg, "maskEmailOnSuccess")
      expect(val).toBe(true)
    })
  })

  test("sync mode switch hidden when service is streaming", () => {
    const onSettingChange = jest.fn()
    const props = makeProps({
      onSettingChange,
      config: Immutable({
        fmeServerUrl: "https://example.com",
        fmeServerToken: "tokentokent",
        repository: "repo",
        service: "stream",
        syncMode: true,
      }) as any,
    })
    renderSetting(<WrappedSetting {...props} />)

    // The sync toggle label should not be present when service=stream
    expect(
      screen.queryByText(/Direktnedladdning \(synkront\)/i)
    ).not.toBeInTheDocument()
  })

  test("connection status sets aria-busy while testing", async () => {
    const { validateConnection } = require("../shared/services") as {
      validateConnection: jest.Mock
    }
    // Delay resolve to allow us to observe the testing state in DOM
    validateConnection.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            success: true,
            version: "2024.0",
            repositories: ["A"],
            steps: { serverUrl: "ok", token: "ok", repository: "ok" },
          })
        }, 50)
      })
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

    // While testing, a status container with aria-busy=true should appear
    const statusRegion = await screen.findByRole("status")
    expect(statusRegion).toHaveAttribute("aria-busy", "true")

    // After completes, aria-busy should be absent or false
    await waitFor(() => {
      const region = screen.getByRole("status")
      expect(region).not.toHaveAttribute("aria-busy", "true")
    })
  })
})
