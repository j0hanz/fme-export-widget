import { React } from "jimu-core"
import { screen, fireEvent } from "@testing-library/react"
import { widgetRender } from "jimu-for-test"
import Setting from "./setting"

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

  test("uses legacy fme_server_url for initial value and updates fmeServerUrl on change", () => {
    const onSettingChange = jest.fn()
    const config = makeConfig({ fme_server_url: "https://legacy.example" })

    renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={config as any}
      />
    )

    const urlInput = screen.getByPlaceholderText("https://fme.server.com")
    expect(screen.getByDisplayValue("https://legacy.example")).toBeTruthy()

    fireEvent.change(urlInput, { target: { value: "https://new.example" } })
    expect(onSettingChange).toHaveBeenCalled()

    const callArg = (onSettingChange.mock.calls[0] || [])[0] || {}
    expect(callArg.id).toBe("w1")
    expect(callArg.config?.fmeServerUrl).toBe("https://new.example")
  })

  test("MapWidgetSelector selection triggers useMapWidgetIds update", () => {
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

    const mapBtn = screen.getByRole("button", { name: /MapWidgetSelector/i })
    fireEvent.click(mapBtn)

    expect(onSettingChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", useMapWidgetIds: ["map-1"] })
    )
  })

  test("uses legacy fmw_server_token for initial value and updates fmeServerToken on change", () => {
    const onSettingChange = jest.fn()
    const config = makeConfig({ fmw_server_token: "legacy-token" })

    renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={config as any}
      />
    )

    // Password field uses placeholder "Enter FME Server token"
    const tokenInput = screen.getByPlaceholderText("Enter FME Server token")
    expect(screen.getByDisplayValue("legacy-token")).toBeTruthy()

    fireEvent.change(tokenInput, { target: { value: "new-token" } })
    const calls = onSettingChange.mock.calls
    const last = calls[calls.length - 1]?.[0] || {}
    expect(last.id).toBe("w1")
    expect(last.config?.fmeServerToken).toBe("new-token")
  })

  test("updates repository on change", () => {
    const onSettingChange = jest.fn()
    const config = makeConfig({ repository: "OldRepo" })

    renderWithProviders(
      <SettingAny
        id="w1"
        onSettingChange={onSettingChange as any}
        useMapWidgetIds={[] as any}
        config={config as any}
      />
    )

    const repoInput = screen.getByPlaceholderText("MyRepository")
    expect(screen.getByDisplayValue("OldRepo")).toBeTruthy()

    fireEvent.change(repoInput, { target: { value: "NewRepo" } })
    const calls = onSettingChange.mock.calls
    const last = calls[calls.length - 1]?.[0] || {}
    expect(last.config?.repository).toBe("NewRepo")
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
