import "@testing-library/jest-dom"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal, mockTheme, withThemeIntlRender } from "jimu-for-test"
import Setting from "../setting/setting"

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
    useDebounce: jest.fn((fn: any) => fn),
  }
})

initGlobal()

const renderWithTheme = withThemeIntlRender(mockTheme as any)

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
