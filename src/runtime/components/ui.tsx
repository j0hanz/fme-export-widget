/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, type SerializedStyles } from "jimu-core"
import {
  TextInput,
  Tooltip as JimuTooltip,
  Button as JimuButton,
  AdvancedButtonGroup,
  Select as JimuSelect,
  Option as JimuOption,
  FormGroup,
  Label,
  TextArea as JimuTextArea,
  Loading,
  LoadingType,
  Checkbox as JimuCheckbox,
  UrlInput as JimuUrlInput,
  Switch as JimuSwitch,
  Radio as JimuRadio,
  Slider as JimuSlider,
  NumericInput as JimuNumericInput,
  TagInput as JimuTagInput,
  MultiSelect,
  SVG,
  Table as JimuTable,
  RichDisplayer,
  Alert as JimuAlert,
} from "jimu-ui"
import type { SVGProps } from "jimu-ui"
import { ColorPicker as JimuColorPicker } from "jimu-ui/basic/color-picker"
import { DatePicker as JimuDatePicker } from "jimu-ui/basic/date-picker"
import {
  useUniqueId,
  useControlledValue,
  useLoadingLatch,
} from "../../shared/hooks"
import {
  EMAIL_PLACEHOLDER,
  config as styleConfig,
  useUiStyles,
} from "../../config/index"
import defaultMessages from "./translations/default"
import {
  styleCss,
  getErrorIconSrc,
  getBtnAria,
  ariaDesc,
  pad2,
} from "../../shared/utils"
import dataIcon from "../../assets/icons/data.svg"
import emailIcon from "../../assets/icons/email.svg"
import errorIcon from "../../assets/icons/error.svg"
import featureServiceIcon from "../../assets/icons/feature-service.svg"
import folderIcon from "../../assets/icons/folder.svg"
import infoIcon from "../../assets/icons/info.svg"
import linkTiltedIcon from "../../assets/icons/link-tilted.svg"
import mapIcon from "../../assets/icons/map.svg"
import personLockIcon from "../../assets/icons/person-lock.svg"
import polygonIcon from "../../assets/icons/polygon.svg"
import settingIcon from "../../assets/icons/setting.svg"
import sharedNoIcon from "../../assets/icons/shared-no.svg"
import successIcon from "../../assets/icons/success.svg"
import timeIcon from "../../assets/icons/time.svg"
import warningIcon from "../../assets/icons/warning.svg"
import type {
  ViewAction,
  ButtonProps,
  GroupButtonConfig,
  ButtonGroupProps,
  OptionItem,
  SelectProps,
  TabItem,
  ButtonTabsProps,
  InputProps,
  TextAreaProps,
  TooltipProps,
  FormProps,
  FieldProps,
  BtnContentProps,
  StateViewProps,
  TranslateFn,
  UiStyles,
} from "../../config/index"

// Configuration & Constants
export const config = styleConfig

const LOCAL_ICON_SOURCES: { readonly [key: string]: string } = {
  error: errorIcon,
  map: mapIcon,
  polygon: polygonIcon,
  warning: warningIcon,
  "person-lock": personLockIcon,
  folder: folderIcon,
  data: dataIcon,
  "shared-no": sharedNoIcon,
  "feature-service": featureServiceIcon,
  "link-tilted": linkTiltedIcon,
  time: timeIcon,
  setting: settingIcon,
  email: emailIcon,
  info: infoIcon,
  success: successIcon,
}

type AlertVariant = NonNullable<React.ComponentProps<typeof JimuAlert>["type"]>

const ALERT_ICON_MAP: { [K in AlertVariant]: string | undefined } = {
  warning: "warning",
  error: "error",
  info: "info",
  success: "success",
}

// Styling Helpers
export const useStyles = (): UiStyles => useUiStyles()

// Alias imported hooks for internal use
const useId = useUniqueId
const useValue = useControlledValue

// Utility Helpers

const withId = (
  child: React.ReactNode,
  readOnly: boolean,
  fallbackId: string
): { id: string | undefined; child: React.ReactNode } => {
  if (readOnly || !React.isValidElement(child)) {
    return { id: undefined, child }
  }

  const childProps = (child.props || {}) as { [key: string]: unknown }
  const id = (childProps.id as string) || fallbackId

  if (childProps.id) {
    return { id, child }
  }

  const cloned = React.cloneElement(child as React.ReactElement, { id })
  return { id, child: cloned }
}

// Style composition helpers
const applyComponentStyles = (
  base: Array<SerializedStyles | undefined>,
  customStyle?: React.CSSProperties
) => [...base, styleCss(customStyle)].filter(Boolean)

const applyFullWidthStyles = (
  styles: UiStyles,
  customStyle?: React.CSSProperties
) => applyComponentStyles([styles.fullWidth], customStyle)

// Build common ARIA attributes for form inputs/areas
const getFormAria = (opts: {
  id?: string
  required?: boolean
  errorText?: string | boolean
  errorSuffix?: string
}) => {
  const { id, required, errorText, errorSuffix } = opts || {}
  return {
    "aria-required": !!required,
    "aria-invalid": !!errorText,
    "aria-describedby": errorText && id ? ariaDesc(id, errorSuffix) : undefined,
  } as const
}

// Wrap an element with Tooltip and layout wrapper when tooltip is provided
const wrapWithTooltip = (
  element: React.ReactElement,
  opts: {
    tooltip?: React.ReactNode
    placement?: any
    block?: boolean
    jimuCss?: any
    jimuStyle?: React.CSSProperties
    styles: UiStyles
  }
) => {
  const { tooltip, placement, block, jimuCss, jimuStyle, styles } = opts
  if (!tooltip) return element

  const wrapperCss = [
    jimuCss,
    styleCss(jimuStyle),
    block ? styles.tooltipWrap.block : styles.tooltipWrap.inline,
  ]

  return (
    <span css={wrapperCss as any}>
      <Tooltip content={tooltip} placement={placement}>
        <span css={styles.tooltipWrap.anchor}>{element}</span>
      </Tooltip>
    </span>
  )
}

const sanitizeTooltipPlacement = (placement: TooltipProps["placement"]) =>
  (placement as any) === "auto" ? config.tooltip.position.top : placement

const createTooltipAnchor = (
  child: React.ReactElement,
  tooltipContent: React.ReactNode
) => {
  const childProps = (child as any)?.props || {}
  const isDisabled = childProps.disabled || childProps["aria-disabled"]

  if (!isDisabled) return child

  const ariaLabel =
    typeof tooltipContent === "string" ? tooltipContent : undefined

  return (
    <span aria-disabled="true" tabIndex={0} aria-label={ariaLabel}>
      {child}
    </span>
  )
}

const getRequiredMark = (
  translate: (k: string, vars?: any) => string,
  styles: UiStyles
) => (
  <Tooltip content={translate("requiredField")} placement="bottom">
    <span
      css={styles.typo.required}
      aria-label={translate("ariaRequired")}
      role="img"
      aria-hidden="false"
    >
      {config.required}
    </span>
  </Tooltip>
)

// Primitive UI Components

// Button content component
const BtnContent: React.FC<BtnContentProps> = ({
  loading,
  children,
  text,
  icon,
  alignText,
}) => {
  const styles = useStyles()

  if (loading) return <Loading type={LoadingType.Donut} />
  if (children) return <>{children}</>

  const hasIcon =
    (typeof icon === "string" && icon.length > 0) ||
    (icon != null && React.isValidElement(icon))
  const hasText = !!text

  if (!hasIcon && !hasText) return null
  if (hasIcon && !hasText) {
    return typeof icon === "string" ? (
      <Icon src={icon} size={config.icon.large} />
    ) : (
      (icon as React.ReactElement)
    )
  }
  if (hasText && !hasIcon) return <>{text}</>

  const iconEl =
    typeof icon === "string" ? (
      <Icon src={icon} size={config.icon.medium} />
    ) : (
      (icon as React.ReactElement)
    )

  const iconWithPosition = (
    <span css={styles.btn.icon} aria-hidden="true">
      {iconEl}
    </span>
  )

  return (
    <>
      {/* left icon not supported */}
      <div css={styles.btn.text(alignText)}>{text}</div>
      {iconWithPosition}
    </>
  )
}

// Icon component
export const Icon: React.FC<SVGProps> = ({
  src,
  size = config.icon.medium,
  className,
  style,
  role = "img",
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
  ...props
}) => {
  const resolved = LOCAL_ICON_SOURCES[src] ?? src
  const computedHidden = ariaHidden ?? !ariaLabel

  return (
    <SVG
      {...props}
      src={resolved}
      size={size}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-hidden={computedHidden}
      css={applyComponentStyles([], style as any)}
    />
  )
}

// Tooltip component
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  showArrow = config.tooltip.showArrow,
  placement = config.tooltip.position.top,
  disabled = false,
  ...otherProps
}) => {
  const tooltipContent = content
  if (!React.isValidElement(children) || !tooltipContent || disabled) {
    return <>{children}</>
  }
  const anchor = createTooltipAnchor(children, tooltipContent)
  const placementProp = sanitizeTooltipPlacement(placement)

  return (
    <JimuTooltip
      title={tooltipContent as any}
      showArrow={showArrow}
      placement={placementProp as any}
      {...otherProps}
    >
      {anchor}
    </JimuTooltip>
  )
}

// Form controls

// Checkbox component
export const Checkbox: React.FC<React.ComponentProps<typeof JimuCheckbox>> = (
  props
) => <JimuCheckbox {...props} />

// Input Component
export const Input: React.FC<InputProps> = ({
  value: controlled,
  defaultValue,
  required = false,
  maxLength,
  errorText,
  type = "text",
  step,
  onChange,
  onBlur,
  onFileChange,
  ...props
}) => {
  const styles = useStyles()
  const [value, handleValueChange] = useValue(controlled, defaultValue || "")

  const handleChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = evt.target.value
      handleValueChange(newValue)

      if (type === "file" && onFileChange) {
        onFileChange(evt)
      } else if (onChange) {
        onChange(newValue)
      }
    }
  )

  const handleBlur = hooks.useEventCallback(
    (evt: React.FocusEvent<HTMLInputElement>) => {
      if (onBlur) {
        onBlur(evt.target.value)
      }
    }
  )

  const aria = getFormAria({ id: (props as any).id, required, errorText })

  return (
    <TextInput
      {...props}
      type={type as any}
      value={value as string | number}
      step={step as any}
      onChange={handleChange}
      onBlur={handleBlur}
      required={required}
      maxLength={maxLength}
      title={errorText}
      {...aria}
      css={applyFullWidthStyles(styles, (props as any).style)}
    />
  )
}

// TextArea component
export const TextArea: React.FC<TextAreaProps> = ({
  value: controlled,
  defaultValue,
  onChange,
  onBlur,
  ...props
}) => {
  const styles = useStyles()
  const [value, handleValueChange] = useValue(controlled, defaultValue || "")

  const handleChange = hooks.useEventCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value
      handleValueChange(newValue)
      onChange?.(newValue)
    }
  )

  const handleBlur = hooks.useEventCallback(
    (event: React.FocusEvent<HTMLTextAreaElement>) => {
      onBlur?.(event.target.value)
    }
  )

  const validationMessage = (props as any).validationMessage || props.errorText

  const aria = getFormAria({
    id: (props as any).id,
    required: (props as any).required,
    errorText: validationMessage,
    errorSuffix: "error",
  })

  return (
    <JimuTextArea
      {...props}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      css={applyComponentStyles(
        [styles.fullWidth, styles.textareaResize],
        props.style as any
      )}
      {...aria}
    />
  )
}

// UrlInput component
export const UrlInput: React.FC<{
  value?: string
  defaultValue?: string
  placeholder?: string
  style?: React.CSSProperties
  onChange?: (value: string) => void
}> = ({ value, defaultValue, placeholder, style, onChange }) => {
  const styles = useStyles()
  return (
    <JimuUrlInput
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      schemes={["https"] as any}
      onChange={(res) => {
        const raw = (res?.value || "").trim()
        const sanitized = raw
        onChange?.(sanitized)
      }}
      css={applyFullWidthStyles(styles, style)}
    />
  )
}

// Switch component
export const Switch: React.FC<React.ComponentProps<typeof JimuSwitch>> = (
  props
) => <JimuSwitch {...props} />

// Radio component
export const Radio: React.FC<{
  options: Array<{ label: string; value: string }>
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  style?: React.CSSProperties
  disabled?: boolean
  "aria-label"?: string
}> = ({
  options,
  value,
  defaultValue,
  onChange,
  style,
  disabled,
  "aria-label": ariaLabel,
}) => {
  const styles = useStyles()
  const isControlled = value !== undefined
  return (
    <div
      css={applyFullWidthStyles(styles, style)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <JimuRadio
          key={option.value}
          value={option.value}
          {...(isControlled
            ? { checked: value === option.value }
            : { defaultChecked: defaultValue === option.value })}
          disabled={disabled}
          onChange={(e) => {
            onChange?.(e.target.value)
          }}
        >
          {option.label}
        </JimuRadio>
      ))}
    </div>
  )
}

// Slider component
export const Slider: React.FC<{
  value?: number
  defaultValue?: number
  min?: number
  max?: number
  step?: number
  onChange?: (value: number) => void
  style?: React.CSSProperties
  disabled?: boolean
  "aria-label"?: string
}> = ({
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
  style,
  disabled,
  "aria-label": ariaLabel,
}) => {
  const styles = useStyles()
  return (
    <JimuSlider
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const numValue = parseFloat(e.target.value)
        if (!Number.isNaN(numValue) && Number.isFinite(numValue)) {
          onChange?.(numValue)
        }
      }}
      css={applyFullWidthStyles(styles, style)}
    />
  )
}

// NumericInput component
export const NumericInput: React.FC<{
  value?: number
  defaultValue?: number
  min?: number
  max?: number
  step?: number
  precision?: number
  placeholder?: string
  onChange?: (value: number) => void
  style?: React.CSSProperties
  disabled?: boolean
  "aria-label"?: string
}> = ({
  value,
  defaultValue,
  min,
  max,
  step,
  precision,
  placeholder,
  onChange,
  style,
  disabled,
  "aria-label": ariaLabel,
}) => {
  const styles = useStyles()
  return (
    <JimuNumericInput
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      precision={precision}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(value) => {
        if (typeof value === "number") {
          onChange?.(value)
        }
      }}
      css={applyFullWidthStyles(styles, style)}
    />
  )
}

// TagInput component
export const TagInput: React.FC<{
  value?: string[]
  suggestions?: string[]
  placeholder?: string
  onChange?: (values: string[]) => void
  style?: React.CSSProperties
}> = ({ value, suggestions, placeholder, onChange, style }) => {
  const styles = useStyles()
  return (
    <JimuTagInput
      values={value}
      suggestions={suggestions}
      placeholder={placeholder}
      onChange={(vals) => {
        onChange?.(vals)
      }}
      css={applyFullWidthStyles(styles, style)}
    />
  )
}

export const Table: React.FC<React.ComponentProps<typeof JimuTable>> = (
  props
) => <JimuTable {...props} />

// ColorPicker component
export const ColorPickerWrapper: React.FC<{
  value?: string
  defaultValue?: string
  onChange?: (color: string) => void
  style?: React.CSSProperties
  "aria-label"?: string
}> = ({ value, defaultValue, onChange, style, "aria-label": ariaLabel }) => {
  const styles = useStyles()
  return (
    <JimuColorPicker
      color={value || defaultValue || "#000000"}
      onChange={(color) => {
        onChange?.(color)
      }}
      aria-label={ariaLabel}
      css={applyFullWidthStyles(styles, style)}
      showArrow
    />
  )
}

const ISO_LOCAL_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
const ISO_LOCAL_TIME = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/

const parseIsoLocalDateTime = (value?: string): Date | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00`
  const [datePart = "", timePart = ""] = normalized.split("T")

  const dateMatch = ISO_LOCAL_DATE.exec(datePart)
  const timeMatch = ISO_LOCAL_TIME.exec(timePart)
  if (!dateMatch || !timeMatch) return null

  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const second = timeMatch[3] ? Number(timeMatch[3]) : 0

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null
  }

  const parsed = new Date(year, month - 1, day, hour, minute, second, 0)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatIsoLocalDateTime = (value: Date | null | undefined): string => {
  if (!value) return ""
  const timestamp = value.getTime()
  if (Number.isNaN(timestamp)) return ""
  const yyyy = value.getFullYear()
  const mm = pad2(value.getMonth() + 1)
  const dd = pad2(value.getDate())
  const hh = pad2(value.getHours())
  const mi = pad2(value.getMinutes())
  const ss = pad2(value.getSeconds())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`
}

// DateTimePicker component
export const DateTimePickerWrapper: React.FC<{
  value?: string // ISO local: YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss
  defaultValue?: string
  onChange?: (dateTime: string) => void
  style?: React.CSSProperties
  disabled?: boolean
  "aria-label"?: string
  mode?: "date-time" | "date"
}> = ({
  value,
  defaultValue,
  onChange,
  style,
  disabled,
  "aria-label": ariaLabel,
  mode = "date-time",
}) => {
  const styles = useStyles()
  const [currentValue, setCurrentValue] = useValue(
    value,
    defaultValue,
    onChange
  )

  const buildFallbackDate = () => {
    const base = new Date()
    if (mode === "date") base.setHours(0, 0, 0, 0)
    return base
  }
  const fallbackDateRef = React.useRef<Date>(buildFallbackDate())

  hooks.useUpdateEffect(() => {
    fallbackDateRef.current = buildFallbackDate()
  }, [mode])

  const fallbackDate = fallbackDateRef.current

  const selectedDate =
    parseIsoLocalDateTime(currentValue) ||
    parseIsoLocalDateTime(defaultValue) ||
    fallbackDate

  const handleChange = hooks.useEventCallback(
    (rawValue: any, _label: string) => {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        const next = new Date(rawValue)
        if (mode === "date") next.setHours(0, 0, 0, 0)
        setCurrentValue(formatIsoLocalDateTime(next))
        return
      }

      if (rawValue instanceof Date) {
        const next = new Date(rawValue.getTime())
        if (mode === "date") next.setHours(0, 0, 0, 0)
        setCurrentValue(formatIsoLocalDateTime(next))
        return
      }

      if (rawValue == null) {
        setCurrentValue("")
      }
    }
  )

  const containerStyles = applyComponentStyles(
    [styles.fullWidth, styles.relative],
    style
  )

  const picker = (
    <div css={containerStyles}>
      <JimuDatePicker
        selectedDate={selectedDate}
        runtime={false}
        showTimeInput={mode === "date-time"}
        isLongTime={mode === "date-time"}
        supportVirtualDateList={false}
        disablePortal
        onChange={handleChange}
        aria-label={ariaLabel}
      />
    </div>
  )

  if (disabled) {
    return (
      <span aria-disabled="true" css={styles.disabledPicker}>
        {picker}
      </span>
    )
  }

  return picker
}

export const RichText: React.FC<{
  html?: string
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}> = ({ html, placeholder, className, style }) => {
  if (!html || html.trim().length === 0) {
    return (
      <div className={className} css={styleCss(style)}>
        {placeholder || ""}
      </div>
    )
  }

  return (
    <RichDisplayer className={className} css={styleCss(style)} value={html} />
  )
}

// Select component
export const Select: React.FC<SelectProps> = ({
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder,
  disabled = false,
  style,
  coerce,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useStyles()
  const [internalValue, setInternalValue] = useValue(value, defaultValue)
  const resolvedPlaceholder =
    placeholder || translate("placeholderSelectGeneric")

  const coerceValue = hooks.useEventCallback((val: unknown): unknown => {
    if (coerce === "number") {
      if (Array.isArray(val)) {
        return (val as Array<string | number>).map((v) =>
          typeof v === "number"
            ? v
            : Number.isFinite(Number(v))
              ? Number(v)
              : (v as any)
        )
      }
      if (typeof val === "string") {
        const n = Number(val)
        return Number.isFinite(n) ? n : val
      }
    }
    return val
  })

  const handleSingleSelectChange = hooks.useEventCallback(
    (evt: unknown, selectedValue?: string | number) => {
      const rawValue =
        selectedValue !== undefined
          ? selectedValue
          : (evt as any)?.target?.value
      const newValue = coerceValue(rawValue)
      setInternalValue(newValue)
      onChange?.(newValue)
    }
  )

  // Normalize internal value to string for comparison
  const stringValue =
    internalValue != null &&
    (typeof internalValue === "string" || typeof internalValue === "number")
      ? String(internalValue)
      : undefined

  return (
    <JimuSelect
      value={stringValue}
      onChange={handleSingleSelectChange}
      disabled={disabled}
      placeholder={resolvedPlaceholder}
      zIndex={config.zIndex.selectMenu}
      css={applyFullWidthStyles(styles, style)}
    >
      {(options || [])
        .map((option) => {
          if (!option || option.value == null) {
            return null
          }
          return (
            <JimuOption
              key={String(option.value)}
              value={option.value}
              active={String(option.value) === stringValue}
              disabled={Boolean(option.disabled)}
              onClick={() => {
                if (!option.disabled && String(option.value) !== stringValue) {
                  handleSingleSelectChange(undefined, option.value)
                }
              }}
            >
              {!option.hideLabel && (option.label || String(option.value))}
            </JimuOption>
          )
        })
        .filter(Boolean)}
    </JimuSelect>
  )
}

// MultiSelectControl component
export const MultiSelectControl: React.FC<{
  options?: readonly OptionItem[]
  values?: Array<string | number>
  defaultValues?: Array<string | number>
  onChange?: (values: Array<string | number>) => void
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
}> = ({
  options = [],
  values,
  defaultValues = [],
  onChange,
  placeholder,
  disabled = false,
  style,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useStyles()

  const [current, setCurrent] = useValue<Array<string | number>>(
    values,
    defaultValues
  )

  // Default placeholder if none provided
  const finalPlaceholder = placeholder || translate("placeholderSelectGeneric")

  const handleChange = hooks.useEventCallback(
    (_value: string | number, newValues: Array<string | number>) => {
      setCurrent(newValues || [])
      onChange?.(newValues || [])
    }
  )

  // Filter out invalid options and map to expected format
  const items = options
    .filter((opt) => opt && opt.value != null && opt.label != null)
    .map((opt) => ({
      value: opt.value,
      label: String(opt.label),
      disabled: Boolean(opt.disabled),
    }))

  return (
    <div css={applyComponentStyles([], style)}>
      <MultiSelect
        values={current || []}
        defaultValues={defaultValues}
        onChange={handleChange}
        placeholder={finalPlaceholder}
        disabled={disabled}
        items={items}
        css={styles.fullWidth}
      />
    </div>
  )
}

// Composite controls

// Button component
export const Button: React.FC<ButtonProps> = ({
  text,
  icon,
  alignText = "start",
  tooltip,
  type,
  tooltipDisabled = false,
  tooltipPlacement = config.button.defaults.tooltipPosition,
  loading = false,
  onClick,
  children,
  block = config.button.defaults.block,
  size,
  variant = "contained",
  color,
  htmlType = "button",
  ...jimuProps
}) => {
  const styles = useStyles()
  const translate = hooks.useTranslation(defaultMessages)

  const handleClick = hooks.useEventCallback(() => {
    if (jimuProps.disabled || loading || !onClick) return
    onClick()
  })

  // Extract aria-label
  const explicitAriaLabel = jimuProps["aria-label"]
  const ariaLabel = getBtnAria(
    text,
    !!icon,
    explicitAriaLabel,
    tooltip,
    translate("ariaButtonLabel")
  )

  // Absorb potential style/css from incoming props so no inline style attribute is forwarded
  const { style: jimuStyle, css: jimuCss, ...restJimuProps } = jimuProps as any

  const hasTooltip = !!tooltip && !tooltipDisabled

  const buttonElement = (
    <JimuButton
      {...restJimuProps}
      type={type as any}
      color={color}
      variant={variant}
      size={size}
      htmlType={htmlType}
      icon={!text && !!icon}
      onClick={handleClick}
      disabled={jimuProps.disabled || loading}
      aria-busy={loading}
      aria-live={loading ? "polite" : undefined}
      aria-label={ariaLabel}
      title={tooltip ? undefined : jimuProps.title}
      css={[
        styles.relative,
        // When not using tooltip, carry caller styles directly on the button
        !hasTooltip && jimuCss,
        !hasTooltip && styleCss(jimuStyle),
      ]}
      block={block}
      tabIndex={jimuProps.tabIndex ?? 0}
    >
      <BtnContent
        loading={loading}
        text={text}
        icon={icon}
        alignText={alignText}
      >
        {children}
      </BtnContent>
    </JimuButton>
  )
  return hasTooltip
    ? wrapWithTooltip(buttonElement, {
        tooltip,
        placement: tooltipPlacement,
        block,
        jimuCss,
        jimuStyle,
        styles,
      })
    : buttonElement
}

type AlertDisplayVariant = "default" | "icon"

type AlertComponentBaseProps = React.ComponentProps<typeof JimuAlert>

type AlertComponentProps = Omit<
  AlertComponentBaseProps,
  "variant" | "withIcon"
> & {
  variant?: AlertDisplayVariant
  jimuVariant?: AlertComponentBaseProps["variant"]
  tooltipPlacement?: TooltipProps["placement"]
  withIcon?: AlertComponentBaseProps["withIcon"]
}

export const Alert: React.FC<AlertComponentProps> = ({
  className,
  style,
  text,
  children,
  type = "warning",
  withIcon: _withIcon,
  variant = "default",
  jimuVariant,
  tooltipPlacement = config.tooltip.position.top,
  ...rest
}) => {
  const styles = useStyles()
  const iconKey = ALERT_ICON_MAP[type as AlertVariant]
  const messageContent = children ?? (text != null ? <span>{text}</span> : null)
  const resolvedVariant: AlertDisplayVariant =
    variant === "icon" && !iconKey ? "default" : variant

  const { css: jimuCss, ...restAlertProps } = rest as any

  if (resolvedVariant === "icon") {
    const tooltipContent =
      typeof text === "string"
        ? text
        : typeof children === "string"
          ? children
          : messageContent
    const shouldWrapWithTooltip = Boolean(tooltipContent)
    const accessibleLabel =
      typeof text === "string"
        ? text
        : typeof children === "string"
          ? children
          : undefined

    const alertElement = (
      <JimuAlert
        {...restAlertProps}
        type={type}
        withIcon={false}
        variant={jimuVariant}
        className={className}
        css={applyComponentStyles(
          [styles.alert, shouldWrapWithTooltip ? undefined : jimuCss],
          style as any
        )}
      >
        {iconKey ? (
          <div css={styles.alertIcon}>
            <Icon src={iconKey} aria-label={accessibleLabel} />
          </div>
        ) : null}
      </JimuAlert>
    )

    if (!shouldWrapWithTooltip) {
      return alertElement
    }

    return wrapWithTooltip(alertElement, {
      tooltip: tooltipContent,
      placement: sanitizeTooltipPlacement(tooltipPlacement),
      block: true,
      jimuCss,
      jimuStyle: style,
      styles,
    })
  }

  if (messageContent == null && !iconKey) {
    return (
      <JimuAlert
        {...restAlertProps}
        type={type}
        withIcon={false}
        variant={jimuVariant}
        className={className}
        css={applyComponentStyles([styles.alert, jimuCss], style as any)}
      />
    )
  }

  return (
    <JimuAlert
      {...restAlertProps}
      type={type}
      withIcon={false}
      variant={jimuVariant}
      className={className}
      css={applyComponentStyles([styles.alert, jimuCss], style as any)}
    >
      <div css={styles.alertContent}>
        {iconKey ? (
          <div css={styles.alertIcon}>
            <Icon src={iconKey} size={config.icon.small} />
          </div>
        ) : null}
        {messageContent ? (
          <div css={styles.alertMessage}>{messageContent}</div>
        ) : null}
      </div>
    </JimuAlert>
  )
}

// ButtonTabs component
export const ButtonTabs: React.FC<ButtonTabsProps> = ({
  items,
  value: controlled,
  defaultValue,
  onChange,
  onTabChange,
  ariaLabel,
}) => {
  const styles = useStyles()
  const [uncontrolledValue, setUncontrolledValue] = useValue(
    undefined,
    defaultValue || items[0]?.value
  )
  const isControlled = controlled !== undefined
  const currentValue = isControlled ? controlled : uncontrolledValue

  const handleChange = hooks.useEventCallback((newValue: string | number) => {
    const final = typeof controlled === "number" ? Number(newValue) : newValue
    if (!isControlled) {
      setUncontrolledValue(final as any)
    }
    onChange?.(final as any)
    onTabChange?.(final as any)
  })

  return (
    <AdvancedButtonGroup
      role="tablist"
      aria-label={ariaLabel}
      css={[styles.row]}
    >
      {items.map((item, i) => {
        const active = currentValue === item.value
        return (
          <Button
            key={
              typeof item.value === "string" || typeof item.value === "number"
                ? String(item.value)
                : `tab-${i}-${item.label}`
            }
            icon={item.icon}
            size="lg"
            text={!item.hideLabel ? item.label : undefined}
            active={active}
            aria-label={item.label}
            type={active ? "primary" : "tertiary"}
            role="tab"
            aria-selected={active}
            tooltip={item.tooltip}
            tooltipPlacement="bottom"
            disabled={item.disabled}
            onClick={() => {
              if (active) {
                return
              }
              handleChange(item.value)
            }}
            block={false}
          />
        )
      })}
    </AdvancedButtonGroup>
  )
}

// View components

// StateView component
const StateView: React.FC<StateViewProps> = ({
  state,
  className,
  style,
  renderActions,
  center,
}) => {
  const styles = useStyles()
  const translate = hooks.useTranslation(defaultMessages)
  const { showLoading, snapshot } = useLoadingLatch(state, config.loading.delay)

  const defaultActionsRenderer = hooks.useEventCallback(
    ({
      actions,
      ariaLabel,
    }: {
      actions?: readonly ViewAction[]
      ariaLabel: string
    }): React.ReactNode => {
      if (!actions?.length) return null

      return (
        <div role="group" aria-label={ariaLabel} css={styles.btn.group}>
          {actions.map((action, index) => (
            <Button
              key={index}
              onClick={action.onClick}
              disabled={action.disabled}
              variant={action.variant}
              text={action.label}
              block
            />
          ))}
        </div>
      )
    }
  )

  const renderActionsFn: ({
    actions,
    ariaLabel,
  }: {
    actions?: readonly ViewAction[]
    ariaLabel: string
  }) => React.ReactNode = renderActions
    ? ({
        actions,
        ariaLabel,
      }: {
        actions?: readonly ViewAction[]
        ariaLabel: string
      }) => renderActions(actions, ariaLabel)
    : defaultActionsRenderer

  const renderLoadingState = () => {
    const message = snapshot?.message
    const detail = snapshot?.detail

    return (
      <div css={styles.centered} role="status" aria-live="polite">
        {showLoading && (
          <Loading
            type={LoadingType.Donut}
            width={config.loading.width}
            height={config.loading.height}
          />
        )}
        {(message || detail) && (
          <div
            css={styles.overlay}
            aria-label={translate("ariaLoadingDetails")}
          >
            {message && <div>{message}</div>}
            {detail && <div css={styles.typo.caption}>{detail}</div>}
          </div>
        )}
      </div>
    )
  }

  const renderStateByKind = (): React.ReactNode => {
    switch (state.kind) {
      case "error": {
        const actions = renderActionsFn({
          actions: state.actions,
          ariaLabel: translate("ariaErrorActions"),
        })

        const detailNode =
          state.detail == null ? null : (
            <div css={styles.typo.caption}>{state.detail}</div>
          )

        return (
          <div role="alert" aria-live="assertive" css={styles.stateView.error}>
            <div css={styles.stateView.errorContent}>
              <div css={[styles.row, styles.rowAlignCenter]}>
                <Icon
                  src={getErrorIconSrc((state as any).code)}
                  size={config.icon.large}
                />
                <div css={styles.typo.title}>{state.message}</div>
              </div>
              <>
                {detailNode}
                {state.code ? (
                  <div>
                    {translate("errorCode")}: {state.code}
                  </div>
                ) : null}
              </>
            </div>
            {actions ? (
              <div css={styles.stateView.errorActions}>{actions}</div>
            ) : null}
          </div>
        )
      }
      case "empty":
        return (
          <div role="status" aria-live="polite">
            <div>{state.message}</div>
            {renderActionsFn({
              actions: state.actions,
              ariaLabel: translate("ariaEmptyActions"),
            })}
          </div>
        )
      case "success":
        return (
          <div role="status" aria-live="polite">
            {state.title && <div css={styles.typo.title}>{state.title}</div>}
            {state.message && (
              <div css={styles.typo.caption}>{state.message}</div>
            )}
            {renderActionsFn({
              actions: state.actions,
              ariaLabel: translate("ariaSuccessActions"),
            })}
          </div>
        )
      case "content":
        return <>{state.node}</>
      case "loading":
        return renderLoadingState()
    }
  }

  const content =
    state.kind === "loading" || showLoading
      ? renderLoadingState()
      : renderStateByKind()

  const shouldCenter = typeof center === "boolean" ? center : showLoading

  return (
    <div
      className={className}
      css={applyComponentStyles(
        [styles.stateView.frame, shouldCenter ? styles.centered : undefined],
        style as any
      )}
    >
      {content}
    </div>
  )
}

// ButtonGroup component
export const ButtonGroup: React.FC<ButtonGroupProps> = (props) => {
  const { buttons, secondaryButton, primaryButton, className, style } = props
  const styles = useStyles()

  const resolvedButtons: Array<{
    readonly config: GroupButtonConfig
    readonly role: "secondary" | "primary"
    readonly key: string
  }> = buttons?.length
    ? buttons.map((config, index) => ({
        config,
        role: index === buttons.length - 1 ? "primary" : "secondary",
        key: index.toString(),
      }))
    : [
        secondaryButton
          ? {
              config: secondaryButton,
              role: "secondary" as const,
              key: "secondary",
            }
          : null,
        primaryButton
          ? { config: primaryButton, role: "primary" as const, key: "primary" }
          : null,
      ].filter(
        (
          entry
        ): entry is {
          readonly config: GroupButtonConfig
          readonly role: "secondary" | "primary"
          readonly key: string
        } => entry != null
      )

  if (!resolvedButtons.length) {
    return null
  }

  return (
    <div
      css={applyComponentStyles([styles.btn.group], style as any)}
      className={className}
    >
      {resolvedButtons.map(({ config, role, key }) => {
        const fallbackType =
          role === "primary" ? ("primary" as const) : ("default" as const)
        const buttonProps = {
          ...config,
          type: config.type ?? fallbackType,
        }
        return (
          <Button
            key={key}
            {...buttonProps}
            block={true}
            css={styles.btn.flex}
          />
        )
      })}
    </div>
  )
}

// Form layout components

// Form component
export const Form: React.FC<FormProps> = (props) => {
  const { variant, className, style, children } = props
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useStyles()

  if (variant === "layout") {
    const {
      title,
      subtitle,
      onBack,
      onSubmit,
      isValid = true,
      loading = false,
    } = props

    return (
      <div
        className={className}
        css={applyComponentStyles([styles.form.layout], style)}
      >
        <div css={styles.form.header}>
          {title && <div css={styles.typo.title}>{title}</div>}
          {subtitle && <div css={styles.typo.caption}>{subtitle}</div>}
        </div>
        <div css={styles.form.content}>
          <div css={styles.form.body}>{children}</div>
          <div css={styles.form.footer}>
            <ButtonGroup
              secondaryButton={
                onBack
                  ? {
                      text: translate("back"),
                      onClick: onBack,
                      disabled: loading,
                      tooltip: translate("tooltipBackToOptions"),
                    }
                  : undefined
              }
              primaryButton={{
                text: translate("submit"),
                onClick: onSubmit,
                disabled: !isValid || loading,
                loading,
                tooltip: translate("tooltipSubmitOrder"),
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  if (variant === "field") {
    const { label, helper, required = false, readOnly = false, error } = props
    return (
      <Field
        className={className}
        style={style}
        label={label}
        helper={helper}
        required={required}
        readOnly={readOnly}
        error={error}
      >
        {children}
      </Field>
    )
  }

  throw new Error(`Unknown Form variant: ${variant}`)
}

// Standalone Field component (for reuse outside of Form)
export const Field: React.FC<FieldProps> = ({
  className,
  style,
  label,
  helper,
  required = false,
  readOnly = false,
  check = false,
  error,
  children,
}) => {
  const styles = useStyles()
  const translate = hooks.useTranslation(defaultMessages)
  const autoId = useId()
  const { id: fieldId, child: renderedChild } = withId(
    children,
    readOnly,
    autoId
  )

  return (
    <FormGroup
      className={className}
      css={applyComponentStyles([styles.field], style)}
    >
      {check ? (
        <Label css={[styles.typo.label, styles.checkLabel]} check={true}>
          <span>
            {label}
            {required && getRequiredMark(translate, styles)}
          </span>
          {!readOnly && renderedChild}
        </Label>
      ) : (
        <>
          <Label css={styles.typo.label} check={false} for={fieldId}>
            {label}
            {required && getRequiredMark(translate, styles)}
          </Label>
          {!readOnly && renderedChild}
        </>
      )}
      {helper && !error && (
        <div
          css={styles.typo.hint}
          id={fieldId ? `${fieldId}-help` : undefined}
        >
          {helper}
        </div>
      )}
      {error && (
        <div
          id={fieldId ? `${fieldId}-error` : undefined}
          className="d-block"
          role="alert"
        >
          {error}
        </div>
      )}
    </FormGroup>
  )
}

export { Button as default, StateView }

export type {
  StateViewProps,
  ButtonProps,
  ButtonGroupProps,
  AlertComponentProps as AlertProps,
  TooltipProps,
  FormProps,
  FieldProps,
  GroupButtonConfig,
  InputProps,
  OptionItem,
  SelectProps,
  TextAreaProps,
  ButtonTabsProps,
  TabItem,
}

// Render support hint with optional email link
export const renderSupportHint = (
  supportEmail: string | undefined,
  translate: TranslateFn,
  styles: ReturnType<typeof useStyles>,
  fallbackText: string
): React.ReactNode => {
  if (!supportEmail) return <>{fallbackText}</>

  const fullText = translate("contactSupportEmail")
  const parts = fullText.split(EMAIL_PLACEHOLDER)

  if (parts.length < 2) {
    // Fallback if the translation doesn't contain the email placeholder
    return (
      <>
        {fullText}{" "}
        <a
          href={`mailto:${supportEmail}`}
          css={styles.typo.link}
          aria-label={translate("contactSupportEmail", {
            email: supportEmail,
          })}
        >
          {supportEmail}
        </a>
      </>
    )
  }

  return parts.map((part, idx) => {
    if (idx < parts.length - 1) {
      return (
        <React.Fragment key={idx}>
          {part}
          <a
            href={`mailto:${supportEmail}`}
            css={styles.typo.link}
            aria-label={translate("contactSupportEmail", {
              email: supportEmail,
            })}
          >
            {supportEmail}
          </a>
        </React.Fragment>
      )
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>
  })
}
