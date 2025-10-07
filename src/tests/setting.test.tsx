import "@testing-library/jest-dom"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { initGlobal, widgetSettingRender } from "jimu-for-test"
import { React, Immutable, getAppStore } from "jimu-core"
import type { FmeExportConfig, IMWidgetConfig } from "../config"
import Setting from "../setting/setting"

jest.mock("jimu-ui", () => {
  const React = require("react")
  return {
    Alert: ({ text, ...rest }: any) => (
      <div role="alert" {...rest}>
        {text}
      </div>
    ),
    Loading: (props: any) => <div data-testid="loading" {...props} />,
    LoadingType: { Bar: "bar" },
    Switch: ({ checked, onChange, ...rest }: any) => (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange?.(event)}
        {...rest}
      />
    ),
  }
})

jest.mock("jimu-ui/advanced/setting-components", () => ({
  MapWidgetSelector: ({ onSelect }: any) => (
    <select
      aria-label="Kartinställningar"
      onChange={(event) => onSelect?.([event.target.value])}
    >
      <option value="" />
      <option value="map-1">Map 1</option>
    </select>
  ),
  SettingSection: ({ children }: any) => <section>{children}</section>,
  SettingRow: ({ label, children, tag = "div" }: any) => {
    if (tag === "label") {
      return (
        <label>
          {label}
          {children}
        </label>
      )
    }
    return (
      <div>
        {label}
        {children}
      </div>
    )
  },
}))

jest.mock("../runtime/components/ui", () => {
  const Button = React.forwardRef(
    (
      { text, children, onClick, disabled, type = "button", ...rest }: any,
      ref: any
    ) => (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        onClick={(event) => {
          it("toggles auto-close widget behavior", () => {
            const { onSettingChange } = renderSetting({
              autoCloseOtherWidgets: true,
            })

            const toggle = getByLabel(
              "Stäng andra widgets automatiskt"
            ) as HTMLInputElement

            expect(toggle).toBeChecked()
            fireEvent.click(toggle)

            const configs = extractConfigs(onSettingChange)
            expect(
              configs.some(
                (cfg) =>
                  cfg.autoCloseOtherWidgets !== undefined &&
                  !cfg.autoCloseOtherWidgets
              )
            ).toBe(true)
          })
          if (disabled) return
          onClick?.(event)
        }}
        {...rest}
      >
        {text ?? children}
      </button>
    )
  )
  Button.displayName = "MockButton"

  const Input = React.forwardRef(
    ({ onChange, onBlur, value, ...rest }: any, ref: any) => (
      <input
        ref={ref}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        onBlur={(event) => onBlur?.(event.target.value)}
        {...rest}
      />
    )
  )
  Input.displayName = "MockInput"

  const TextArea = React.forwardRef(
    ({ onChange, onBlur, value, ...rest }: any, ref: any) => (
      <textarea
        ref={ref}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        onBlur={(event) => onBlur?.(event.target.value)}
        {...rest}
      />
    )
  )
  TextArea.displayName = "MockTextArea"

  const Select = ({
    options = [],
    value,
    onChange,
    placeholder,
    disabled,
    ...rest
  }: any) => (
    <select
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
      disabled={disabled}
      {...rest}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option: any) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label ?? String(option.value)}
        </option>
      ))}
    </select>
  )

  const Tooltip = ({ children }: any) => <span>{children}</span>

  const ColorPickerWrapper = ({ value, onChange, ...rest }: any) => (
    <input
      type="color"
      value={(value && String(value)) || "#000000"}
      onChange={(event) => onChange?.(event.target.value)}
      {...rest}
    />
  )

  const useStyles = () => ({ typography: { required: {} } })

  const config = { required: "*" }

  const Icon = () => null

  return {
    Button,
    Icon,
    Input,
    TextArea,
    Select,
    Tooltip,
    ColorPickerWrapper,
    useStyles,
    config,
    default: Button,
  }
})

type SettingComponentProps = React.ComponentProps<typeof Setting>

const buildConfig = (
  overrides: Partial<FmeExportConfig> = {}
): IMWidgetConfig =>
  Immutable({
    fmeServerUrl: "",
    fmeServerToken: "",
    repository: "",
    service: "download",
    syncMode: false,
    allowRemoteDataset: false,
    allowRemoteUrlDataset: false,
    maskEmailOnSuccess: false,
    allowScheduleMode: false,
    ...overrides,
  }) as IMWidgetConfig

const renderSetting = (
  configOverrides: Partial<FmeExportConfig> = {},
  propsOverrides: Partial<SettingComponentProps> = {}
) => {
  const render = widgetSettingRender(true)
  const onSettingChange = jest.fn()

  let currentConfig = buildConfig(configOverrides)
  const baseProps = {
    id: "test-widget",
    widgetId: "test-widget",
    label: "FME Export",
    icon: "icon",
    config: currentConfig,
    useMapWidgetIds: Immutable([]) as any,
    onSettingChange,
    ...propsOverrides,
  } as SettingComponentProps

  const result = render(<Setting {...baseProps} />)

  const rerenderWithConfig = (overrides: Partial<FmeExportConfig>) => {
    currentConfig =
      (currentConfig.merge(overrides) as IMWidgetConfig) || currentConfig
    baseProps.config = currentConfig
    result.rerender(<Setting {...baseProps} />)
  }

  return { ...result, onSettingChange, rerenderWithConfig }
}

beforeAll(() => {
  initGlobal()
})

beforeEach(() => {
  getAppStore().dispatch({
    type: "fme/REMOVE_WIDGET_STATE",
    widgetId: "test-widget",
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

const extractConfigs = (mockFn: jest.Mock) =>
  mockFn.mock.calls.map((args) => args[0].config as unknown as FmeExportConfig)

const labelNormalizer = (label: string) => label.replace(/\u2011/g, "-")

const getByLabel = (text: string): HTMLElement =>
  screen.getByLabelText(text, {
    normalizer: labelNormalizer,
    exact: false,
  })

const queryByLabel = (text: string): HTMLElement | null =>
  screen.queryByLabelText(text, {
    normalizer: labelNormalizer,
    exact: false,
  })

describe("Setting builder interactions", () => {
  it("resets remote dataset options when switching to streaming service", async () => {
    const { onSettingChange } = renderSetting({
      allowRemoteDataset: true,
      allowRemoteUrlDataset: true,
      maskEmailOnSuccess: true,
      uploadTargetParamName: "INPUT_DATASET",
    })

    const serviceSelect = getByLabel("Tjänstetyp") as HTMLSelectElement
    const remoteDatasetToggle = getByLabel(
      "Tillåt filuppladdning (TEMP)"
    ) as HTMLInputElement
    const remoteUrlToggle = getByLabel(
      "Tillåt fjärr-URL (HTTPS)"
    ) as HTMLInputElement
    const maskEmailToggle = getByLabel(
      "Maskera e-postadress"
    ) as HTMLInputElement

    expect(remoteDatasetToggle).toBeChecked()
    expect(remoteUrlToggle).toBeChecked()
    expect(maskEmailToggle).toBeChecked()
    expect(getByLabel("Parameternamn för uppladdning")).toBeInTheDocument()

    fireEvent.change(serviceSelect, { target: { value: "stream" } })

    await waitFor(() => {
      expect(serviceSelect.value).toBe("stream")
    })
    await waitFor(() => {
      expect(
        queryByLabel("Tillåt filuppladdning (TEMP)")
      ).not.toBeInTheDocument()
      expect(queryByLabel("Tillåt fjärr-URL (HTTPS)")).not.toBeInTheDocument()
      expect(queryByLabel("Maskera e-postadress")).not.toBeInTheDocument()
    })
    expect(
      queryByLabel("Parameternamn för uppladdning")
    ).not.toBeInTheDocument()

    const configs = extractConfigs(onSettingChange)
    const hasConfig = (predicate: (cfg: FmeExportConfig) => boolean) =>
      configs.some(predicate)
    expect(hasConfig((cfg) => cfg.service === "stream")).toBe(true)
    expect(hasConfig((cfg) => !cfg.allowRemoteDataset)).toBe(true)
    expect(hasConfig((cfg) => !cfg.allowRemoteUrlDataset)).toBe(true)
    expect(hasConfig((cfg) => !cfg.maskEmailOnSuccess)).toBe(true)
    expect(
      hasConfig((cfg) => typeof cfg.uploadTargetParamName === "undefined")
    ).toBe(true)
  })

  it("validates support email on blur and persists sanitized value", async () => {
    const { onSettingChange } = renderSetting()

    const supportEmail = getByLabel("Support-e-post") as HTMLInputElement

    fireEvent.change(supportEmail, { target: { value: "not-an-email" } })
    fireEvent.blur(supportEmail, { target: { value: "not-an-email" } })

    const errorAlert = await screen.findByRole("alert")
    expect(errorAlert).toHaveTextContent("Ogiltig")
    expect(onSettingChange).not.toHaveBeenCalled()

    fireEvent.change(supportEmail, { target: { value: "agent@example.com" } })
    fireEvent.blur(supportEmail, { target: { value: "agent@example.com" } })

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    const configs = extractConfigs(onSettingChange)
    expect(
      configs.some((cfg) => cfg.supportEmail === "agent@example.com")
    ).toBe(true)
  })

  it("prevents saving large area above max area", async () => {
    const { onSettingChange } = renderSetting({
      maxArea: 1000,
      largeArea: 500,
    })

    const largeAreaInput = getByLabel("AOI-varning (m²)") as HTMLInputElement

    fireEvent.change(largeAreaInput, { target: { value: "1500" } })
    fireEvent.blur(largeAreaInput, { target: { value: "1500" } })

    const alerts = await screen.findAllByRole("alert")
    expect(
      alerts.some((alert) =>
        /lägre än maxgränsen/i.test(alert.textContent ?? "")
      )
    ).toBe(true)

    const configs = extractConfigs(onSettingChange)
    expect(configs.some((cfg) => cfg.largeArea === 1500)).toBe(false)
  })

  it("clamps large area when max area decreases", async () => {
    const { onSettingChange } = renderSetting({
      maxArea: 1500,
      largeArea: 1400,
    })

    const maxAreaInput = getByLabel("Max AOI-yta (m²)") as HTMLInputElement
    fireEvent.change(maxAreaInput, { target: { value: "800" } })
    fireEvent.blur(maxAreaInput, { target: { value: "800" } })

    await waitFor(() => {
      expect(maxAreaInput.value).toBe("800")
    })

    const largeAreaInput = getByLabel("AOI-varning (m²)") as HTMLInputElement
    await waitFor(() => {
      expect(largeAreaInput.value).toBe("800")
    })

    const configs = extractConfigs(onSettingChange)
    expect(
      configs.some((cfg) => cfg.maxArea === 800 && cfg.largeArea === 800)
    ).toBe(true)

    expect(screen.queryByText(/Varningsgränsen/)).not.toBeInTheDocument()
    expect(screen.queryByText(/lägre än maxgränsen/i)).not.toBeInTheDocument()
  })

  it("disables custom large-area message until threshold is saved", async () => {
    const { onSettingChange, rerenderWithConfig } = renderSetting()

    const messageField = getByLabel(
      "Varningsmeddelande (stor AOI)"
    ) as HTMLTextAreaElement
    const infoField = getByLabel(
      "Informationsmeddelande (stor AOI)"
    ) as HTMLTextAreaElement
    expect(messageField).toBeDisabled()
    expect(infoField).toBeDisabled()

    const largeAreaInput = getByLabel("AOI-varning (m²)") as HTMLInputElement
    fireEvent.change(largeAreaInput, { target: { value: "400" } })
    fireEvent.blur(largeAreaInput, { target: { value: "400" } })

    const configs = extractConfigs(onSettingChange)
    const latestConfig = configs[configs.length - 1]
    expect(latestConfig?.largeArea).toBe(400)

    rerenderWithConfig(latestConfig ?? {})

    await waitFor(() => {
      expect(
        getByLabel("Varningsmeddelande (stor AOI)") as HTMLTextAreaElement
      ).not.toBeDisabled()
      expect(
        getByLabel("Informationsmeddelande (stor AOI)") as HTMLTextAreaElement
      ).not.toBeDisabled()
    })
  })

  it("persists sanitized large-area message and clears when empty", () => {
    const { onSettingChange, rerenderWithConfig } = renderSetting({
      largeArea: 500,
    })

    rerenderWithConfig({ largeArea: 500 })

    const messageField = getByLabel(
      "Varningsmeddelande (stor AOI)"
    ) as HTMLTextAreaElement
    const infoField = getByLabel(
      "Informationsmeddelande (stor AOI)"
    ) as HTMLTextAreaElement
    expect(messageField).not.toBeDisabled()
    expect(infoField).not.toBeDisabled()

    fireEvent.change(messageField, {
      target: { value: "  AOI {current}  är stor." },
    })
    fireEvent.blur(messageField, {
      target: { value: "  AOI {current}  är stor." },
    })

    let configs = extractConfigs(onSettingChange)
    expect(
      configs.some(
        (cfg) => cfg.largeAreaWarningMessage === "AOI {current} är stor."
      )
    ).toBe(true)

    fireEvent.change(infoField, {
      target: { value: "  Kontrollera {threshold}  innan export." },
    })
    fireEvent.blur(infoField, {
      target: { value: "  Kontrollera {threshold}  innan export." },
    })

    configs = extractConfigs(onSettingChange)
    expect(
      configs.some(
        (cfg) =>
          cfg.customInfoMessage ===
          "Kontrollera {threshold} innan export."
      )
    ).toBe(true)

    fireEvent.change(messageField, { target: { value: "" } })
    fireEvent.blur(messageField, { target: { value: "" } })

    fireEvent.change(infoField, { target: { value: "" } })
    fireEvent.blur(infoField, { target: { value: "" } })

    configs = extractConfigs(onSettingChange)
    const clearedConfig = configs[configs.length - 1]
    expect(clearedConfig?.largeAreaWarningMessage).toBeUndefined()
    expect(clearedConfig?.customInfoMessage).toBeUndefined()
  })
})
