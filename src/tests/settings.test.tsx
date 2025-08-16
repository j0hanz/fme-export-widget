import { React } from "jimu-core"
import { screen, fireEvent } from "@testing-library/react"
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

// Mock Input to a standard HTML input
jest.mock("../runtime/components/ui", () => {
  return {
    Input: ({ value, onChange, placeholder, type }: any) => (
      <input
        aria-label={placeholder || "input"}
        placeholder={placeholder}
        type={type || "text"}
        value={value || ""}
        onChange={(e: any) => onChange(e.target.value)}
      />
    ),
  }
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

  test("legacy property handling and migration for URL and token", () => {
    const onSettingChange = jest.fn()

    // Legacy fme_server_url handling
    const urlConfig = makeConfig({ fme_server_url: "https://legacy.example" })
    const { unmount: unmount1 } = renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={urlConfig as any}
      />
    )

    const urlInput = screen.getByPlaceholderText("https://fme.server.com")
    expect(screen.getByDisplayValue("https://legacy.example")).toBeTruthy()

    fireEvent.change(urlInput, { target: { value: "https://new.example" } })
    expect(onSettingChange).toHaveBeenCalled()

    const urlCallArg = (onSettingChange.mock.calls[0] || [])[0] || {}
    expect(urlCallArg.id).toBe("w1")
    expect(urlCallArg.config?.fmeServerUrl).toBe("https://new.example")

    unmount1()

    // Legacy fmw_server_token handling
    onSettingChange.mockClear()
    const tokenConfig = makeConfig({ fmw_server_token: "legacy-token" })
    renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={tokenConfig as any}
      />
    )

    const tokenInput = screen.getByPlaceholderText("Enter FME Server token")
    expect(screen.getByDisplayValue("legacy-token")).toBeTruthy()

    fireEvent.change(tokenInput, { target: { value: "new-token" } })
    const tokenCalls = onSettingChange.mock.calls
    const tokenLast = tokenCalls[tokenCalls.length - 1]?.[0] || {}
    expect(tokenLast.id).toBe("w1")
    expect(tokenLast.config?.fmeServerToken).toBe("new-token")
  })

  test("setting field updates for repository and map widget selection", () => {
    const onSettingChange = jest.fn()

    // Repository field updates
    const repoConfig = makeConfig({ repository: "OldRepo" })
    const { unmount: unmount1 } = renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={repoConfig as any}
      />
    )

    const repoInput = screen.getByPlaceholderText("MyRepository")
    expect(screen.getByDisplayValue("OldRepo")).toBeTruthy()

    fireEvent.change(repoInput, { target: { value: "NewRepo" } })
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
    expect(screen.getByPlaceholderText("Enter FME Server token")).toBeTruthy()
    expect(screen.getByPlaceholderText("MyRepository")).toBeTruthy()
  })
})
