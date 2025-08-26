import { React } from "jimu-core"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { widgetRender } from "jimu-for-test"
import Setting from "../setting/setting"

// Mock builder setting components to simple primitives
jest.mock("jimu-ui/advanced/setting-components", () => {
  return {
    MapWidgetSelector: ({ onSelect }: any) => (
      <button
        aria-label="MapWidgetSelector"
        onClick={() => onSelect(["map-1"])}
      >
        Select Map
      </button>
    ),
    SettingSection: ({ children, title }: any) => (
      <section aria-label={title}>{children}</section>
    ),
    SettingRow: ({ children, label }: any) => (
      <div>
        {label ? <span>{label}</span> : null}
        {children}
      </div>
    ),
  }
})

// Mock UI kit used in Setting to simple HTML primitives
jest.mock("../runtime/components/ui", () => {
  const styles = {
    required: { color: "#d93025", marginLeft: 4 },
  }

  const config = {
    required: "*",
  }

  return {
    styles,
    config,
    Tooltip: ({ children }: any) => <span>{children}</span>,
    Checkbox: ({ checked, onChange, id, "aria-label": ariaLabel }: any) => (
      <input
        role="checkbox"
        type="checkbox"
        id={id}
        aria-label={ariaLabel}
        checked={!!checked}
        onChange={(e) => onChange?.(e)}
      />
    ),
    Button: ({ text, onClick, disabled }: any) => (
      <button aria-label={text} disabled={disabled} onClick={onClick}>
        {text}
      </button>
    ),
    Input: ({ value, onChange, placeholder, type }: any) => (
      <input
        aria-label={placeholder || "input"}
        placeholder={placeholder}
        type={type || "text"}
        value={value || ""}
        onChange={(e: any) => onChange(e.target.value)}
      />
    ),
    Field: ({ label, children }: any) => (
      <label>
        {label ? <span>{label}</span> : null}
        {children}
      </label>
    ),
    Select: ({ options = [], value, onChange, disabled, placeholder }: any) => (
      <select
        aria-label={placeholder || "select"}
        disabled={disabled}
        value={value || ""}
        onChange={(e: any) => onChange(e.target.value)}
      >
        {/* Placeholder option when no value selected */}
        <option value="" disabled>
          {placeholder || "Select"}
        </option>
        {options.map((opt: any) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
  }
})

// Mock FME Flow API client used by Setting
jest.mock("../shared/api", () => {
  class FmeFlowApiClientMock {
    testConnection = jest
      .fn()
      .mockResolvedValue({ data: { version: "2024.1" } })
    getRepositories = jest
      .fn()
      .mockResolvedValue({ data: [{ name: "RepoA" }, { name: "NewRepo" }] })
    validateRepository = jest.fn().mockImplementation((repo: string) => {
      if (["RepoA", "NewRepo", "OldRepo"].includes(repo))
        return Promise.resolve({ data: { valid: true } })
      return Promise.reject(new Error("Invalid repository"))
    })
  }
  return { __esModule: true, default: FmeFlowApiClientMock }
})

describe("Setting (builder)", () => {
  const renderWithProviders = widgetRender(true)
  const SettingAny = Setting as any

  function makeConfig(initial: { [key: string]: any }) {
    // set returns a new plain object with updated prop and the set method itself
    function set(this: any, prop: string, value: any) {
      return { ...this, [prop]: value, set }
    }
    return { ...initial, set }
  }

  test("modern property handling for URL and token", () => {
    const onSettingChange = jest.fn()

    // Modern fmeServerUrl handling
    const urlConfig = makeConfig({ fmeServerUrl: "https://modern.example" })
    const { unmount: unmount1 } = renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={urlConfig as any}
      />
    )

    const urlInput = screen.getByPlaceholderText("https://fme.server.com")
    expect(screen.getByDisplayValue("https://modern.example")).toBeTruthy()

    fireEvent.change(urlInput, { target: { value: "https://new.example" } })
    expect(onSettingChange).toHaveBeenCalled()

    const urlCallArg = (onSettingChange.mock.calls[0] || [])[0] || {}
    expect(urlCallArg.id).toBe("w1")
    expect(urlCallArg.config?.fmeServerUrl).toBe("https://new.example")

    unmount1()

    // Modern fmeServerToken handling
    onSettingChange.mockClear()
    const tokenConfig = makeConfig({ fmeServerToken: "modern-token" })
    renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={tokenConfig as any}
      />
    )

    // Token input is localized; select it by its current value instead of placeholder
    const tokenInput = screen.getByDisplayValue("modern-token")
    expect(tokenInput).toBeTruthy()

    fireEvent.change(tokenInput, { target: { value: "new-token" } })
    const tokenCalls = onSettingChange.mock.calls
    const tokenLast = tokenCalls[tokenCalls.length - 1]?.[0] || {}
    expect(tokenLast.id).toBe("w1")
    expect(tokenLast.config?.fmeServerToken).toBe("new-token")
  })

  test("setting field updates for repository and map widget selection", async () => {
    const onSettingChange = jest.fn()

    // Repository field updates now use a Select fed by Test connection
    const repoConfig = makeConfig({
      repository: "OldRepo",
      fmeServerUrl: "https://server.example",
      fmeServerToken: "token-1234567890123456",
    })
    const { unmount: unmount1 } = renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={repoConfig as any}
      />
    )

    // Test connection button
    const allButtons = screen.getAllByRole("button")
    const testBtn = allButtons.find(
      (b: HTMLElement) => b.getAttribute("aria-label") !== "MapWidgetSelector"
    ) as HTMLButtonElement | undefined
    expect(testBtn).toBeTruthy()
    if (testBtn) fireEvent.click(testBtn)

    // Wait until options are available and select is enabled
    const repoSelect = screen.getByRole("combobox")
    await waitFor(() => {
      const opts = screen.getAllByRole("option")
      expect(opts.length).toBeGreaterThan(1)
    })

    // Change selection to NewRepo
    fireEvent.change(repoSelect, { target: { value: "NewRepo" } })
    const repoCalls = onSettingChange.mock.calls
    const repoLast = repoCalls[repoCalls.length - 1]?.[0] || {}
    expect(repoLast.config?.repository).toBe("NewRepo")

    unmount1()

    // Map widget selection
    onSettingChange.mockClear()
    const mapConfig = makeConfig({})
    renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={mapConfig as any}
      />
    )

    const mapBtn = screen.getByRole("button", { name: /MapWidgetSelector/i })
    fireEvent.click(mapBtn)

    expect(onSettingChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", useMapWidgetIds: ["map-1"] })
    )
  })

  test("renders default placeholders when config is empty", () => {
    const onSettingChange = jest.fn()
    const config = makeConfig({})

    renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={config as any}
      />
    )

    // Present placeholders
    expect(screen.getByPlaceholderText("https://fme.server.com")).toBeTruthy()
    // Password input is localized; select it by its placeholder
    const passwordInput = document.querySelector('input[type="password"]')
    expect(passwordInput).toBeTruthy()

    // Repository now uses a Select which is disabled until repos are loaded
    const repoSelect = screen.getByRole("combobox")
    expect((repoSelect as any).disabled).toBe(true)

    // Support email input is optional
    const emailInput = screen.getByPlaceholderText("support@exempel.se")
    expect(emailInput).toBeTruthy()
  })

  test("updates supportEmail in config and validates format", () => {
    const onSettingChange = jest.fn()
    const config = makeConfig({ supportEmail: "old@exempel.se" })

    widgetRender(true)(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={config as any}
      />
    )

    const emailInput = screen.getByDisplayValue("old@exempel.se")
    fireEvent.change(emailInput, { target: { value: "new@example.com" } })

    const last = onSettingChange.mock.calls.pop()?.[0] || {}
    expect(last.config?.supportEmail).toBe("new@example.com")

    // Enter invalid email and expect inline error
    fireEvent.change(emailInput, { target: { value: "not-an-email" } })
    expect(screen.getByText(/Ogiltig e‑postadress/i)).toBeTruthy()
  })

  test("admin job directives fields persist and coerce values", async () => {
    const onSettingChange = jest.fn()
    const config = makeConfig({
      fmeServerUrl: "https://server.example",
      fmeServerToken: "token-1234567890123",
      repository: "RepoA",
      tm_ttc: 0,
      tm_ttl: 0,
      tm_tag: "",
    })

    widgetRender(true)(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={config as any}
      />
    )

    // Collect all textboxes; last three are job directives in current layout
    const inputs = screen.getAllByRole("textbox")
    const [ttcInput, ttlInput, tagInput] = inputs.slice(-3)

    fireEvent.change(ttcInput, { target: { value: "-5" } })
    const callTtc = onSettingChange.mock.calls.pop()?.[0] || {}
    expect(callTtc.id).toBe("w1")
    expect(callTtc.config?.tm_ttc).toBe(0) // negative coerced to 0

    fireEvent.change(ttlInput, { target: { value: "10.9" } })
    const callTtl = onSettingChange.mock.calls.pop()?.[0] || {}
    expect(callTtl.config?.tm_ttl).toBe(10) // floor

    fireEvent.change(tagInput, { target: { value: " high " } })
    const callTag = onSettingChange.mock.calls.pop()?.[0] || {}
    expect(typeof callTag.config?.tm_tag).toBe("string")

    // Clearing tag should set empty string
    fireEvent.change(tagInput, { target: { value: "" } })
    // Verify the input reflects the cleared value (persisted locally)
    await waitFor(() => {
      expect((tagInput as HTMLInputElement).value).toBe("")
    })
  })
})
