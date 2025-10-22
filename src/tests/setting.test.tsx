import "@testing-library/jest-dom"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal, mockTheme, widgetSettingRender } from "jimu-for-test"
import { QueryClientProvider } from "@tanstack/react-query"
import { fmeQueryClient } from "../shared/query-client"
import Setting from "../setting/setting"

// Mock jimu-ui NumericInput to prevent theme/Tooltip initialization errors
jest.mock("jimu-ui", () => {
  const actual = jest.requireActual("jimu-ui")
  return {
    ...actual,
    NumericInput: jest.fn((props) => {
      const {
        value,
        defaultValue,
        onChange,
        min,
        max,
        placeholder,
        disabled,
        ...rest
      } = props
      return (
        <input
          {...rest}
          type="number"
          value={value ?? defaultValue ?? ""}
          onChange={(e) => {
            const val =
              e.target.value === "" ? undefined : parseFloat(e.target.value)
            onChange?.(val)
          }}
          min={min}
          max={max}
          placeholder={placeholder}
          disabled={disabled}
        />
      )
    }),
  }
})

// Mock jimu-ui/advanced/setting-components to prevent module loading errors
jest.mock("jimu-ui/advanced/setting-components", () => ({
  MapWidgetSelector: jest.fn(({ onSelect, useMapWidgetIds }) => (
    <div data-testid="map-widget-selector">
      <button onClick={() => onSelect?.(useMapWidgetIds)}>
        Select Map Widgets
      </button>
    </div>
  )),
  SettingSection: jest.fn(({ children, title }) => (
    <div data-testid="setting-section" title={title}>
      {children}
    </div>
  )),
  SettingRow: jest.fn(({ children, label }) => (
    <div data-testid="setting-row" aria-label={label}>
      {children}
    </div>
  )),
}))

const repositoriesMock = {
  data: [{ name: "RepoOne" }],
  error: null,
  isError: false,
  isSuccess: true,
  refetch: jest.fn(),
}

const validateConnectionMock = {
  mutateAsync: jest.fn().mockResolvedValue({
    success: true,
    steps: {
      serverUrl: "ok",
      token: "ok",
      repository: "ok",
      version: "2025.0",
    },
  }),
  mutate: jest.fn(),
}

const abortControllerMock = {
  abortAndCreate: () => new AbortController(),
  cancel: jest.fn(),
  finalize: jest.fn(),
}

jest.mock("../shared/hooks", () => {
  const actual = jest.requireActual("../shared/hooks")
  return {
    ...actual,
    useBuilderSelector: jest.fn(() => false),
    useRepositories: jest.fn(() => repositoriesMock),
    useValidateConnection: jest.fn(() => validateConnectionMock),
    useLatestAbortController: jest.fn(() => abortControllerMock),
    useDebounce: jest.fn((fn: any) => {
      const debounced: any = (...args: any[]) => fn(...args)
      debounced.cancel = jest.fn()
      debounced.flush = jest.fn()
      debounced.isPending = jest.fn(() => false)
      return debounced
    }),
  }
})

initGlobal()

const baseRender = widgetSettingRender(true, mockTheme as any)

// Wrapper som inkluderar QueryClientProvider för React Query hooks och Redux Provider
const renderWithTheme = (ui: React.ReactElement) =>
  baseRender(
    <QueryClientProvider client={fmeQueryClient}>{ui}</QueryClientProvider>
  )

const createConfig = (overrides?: { [key: string]: any }) => {
  const base = {
    fmeServerUrl: "https://flow.example.com",
    fmeServerToken: "token",
    repository: "RepoOne",
    syncMode: false,
    tm_ttc: undefined,
    tm_ttl: undefined,
  }

  const values = { ...base, ...overrides }
  const build = (vals: { [key: string]: any }) =>
    Object.assign(
      {
        set(key: string, value: any) {
          return build({ ...vals, [key]: value })
        },
      },
      vals
    )

  return build(values)
}

describe("Setting panel service mode", () => {
  const renderSetting = (
    configOverrides?: { [key: string]: any },
    onSettingChange?: jest.Mock
  ) => {
    const config = createConfig(configOverrides)
    const handler = onSettingChange ?? jest.fn()
    const props = {
      id: "widget_1",
      widgetId: "widget_1",
      useMapWidgetIds: ["mapWidget"] as any,
      onSettingChange: handler,
      config: config as any,
    }
    renderWithTheme(<Setting {...(props as any)} />)
    return handler
  }

  beforeEach(() => {
    repositoriesMock.refetch.mockClear()
    validateConnectionMock.mutateAsync.mockClear()
  })

  it("renders delivery mode select with localized options", () => {
    renderSetting()

    const select = screen.getByRole("combobox", { name: "Leveransläge" })
    expect(select).toBeInTheDocument()

    const options = screen.getAllByRole("option")
    const optionLabels = options.map((opt) => opt.textContent)
    expect(optionLabels).toContain("E-postmeddelande (async)")
    expect(optionLabels).toContain("Direkt nerladdning (sync)")
  })

  it("reveals tm_ttc field only in sync mode and clears value when returning to async", async () => {
    const onSettingChange = renderSetting({}, jest.fn())

    expect(screen.queryByLabelText("Max körtid (s)")).not.toBeInTheDocument()

    const select = screen.getByRole("combobox", { name: "Leveransläge" })
    fireEvent.change(select, { target: { value: "sync" } })

    const ttcField = await screen.findByLabelText("Max körtid (s)")
    fireEvent.change(ttcField, { target: { value: "45" } })
    fireEvent.blur(ttcField)

    expect(onSettingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ tm_ttc: 45 }),
      })
    )

    fireEvent.change(select, { target: { value: "async" } })

    await waitFor(() => {
      expect(screen.queryByLabelText("Max körtid (s)")).not.toBeInTheDocument()
    })

    const lastCall = onSettingChange.mock.calls.at(-1)
    expect(lastCall?.[0]?.config?.tm_ttc).toBeUndefined()
  })
})
