import "@testing-library/jest-dom"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { initGlobal, widgetSettingRender } from "jimu-for-test"
import { React, Immutable, getAppStore } from "jimu-core"
import type { WidgetConfig, IMWidgetConfig } from "../config"
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

const buildConfig = (overrides: Partial<WidgetConfig> = {}): IMWidgetConfig =>
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
  configOverrides: Partial<WidgetConfig> = {},
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

  const rerenderWithConfig = (overrides: Partial<WidgetConfig>) => {
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
  mockFn.mock.calls.map((args) => args[0].config as unknown as WidgetConfig)

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
    const hasConfig = (predicate: (cfg: WidgetConfig) => boolean) =>
      configs.some(predicate)
    expect(hasConfig((cfg) => cfg.service === "stream")).toBe(true)
    expect(hasConfig((cfg) => !cfg.allowRemoteDataset)).toBe(true)
    expect(hasConfig((cfg) => !cfg.allowRemoteUrlDataset)).toBe(true)
    expect(hasConfig((cfg) => !cfg.maskEmailOnSuccess)).toBe(true)
    expect(
      hasConfig((cfg) => typeof cfg.uploadTargetParamName === "undefined")
    ).toBe(true)

    await waitFor(() => {
      const state = getAppStore().getState() as any
      const widgetState = state?.["fme-state"]?.byId?.["test-widget"]
      expect(widgetState?.currentRepository ?? null).toBeNull()
    })
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
})
