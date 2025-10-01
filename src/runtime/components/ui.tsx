/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  hooks,
  css,
  jsx,
  type IMThemeVariables,
  type ImmutableObject,
} from "jimu-core"
import type { TypographyStyle } from "jimu-theme"
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
} from "jimu-ui"
import type { SVGProps } from "jimu-ui"
import { ColorPicker as JimuColorPicker } from "jimu-ui/basic/color-picker"
import { DatePicker as JimuDatePicker } from "jimu-ui/basic/date-picker"
import { useTheme } from "jimu-theme"
import defaultMessages from "./translations/default"
import {
  EMAIL_PLACEHOLDER,
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
import linkTiltedIcon from "../../assets/icons/link-tilted.svg"
import mapIcon from "../../assets/icons/map.svg"
import personLockIcon from "../../assets/icons/person-lock.svg"
import polygonIcon from "../../assets/icons/polygon.svg"
import settingIcon from "../../assets/icons/setting.svg"
import sharedNoIcon from "../../assets/icons/shared-no.svg"
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
} from "../../config"

// Configuration
export const config = {
  icon: { small: 14, medium: 16, large: 24 },
  tooltip: {
    delay: { enter: 100, next: 0, leave: 0, touch: 700 },
    position: {
      top: "top" as const,
      bottom: "bottom" as const,
      left: "left" as const,
      right: "right" as const,
    },
    showArrow: true,
  },
  button: {
    defaults: {
      block: true,
      tooltipPosition: "top" as const,
    },
    offset: "10px",
    textPadding: "18px",
  },
  zIndex: { selectMenu: 1005, overlay: 1000 },
  loading: { width: 200, height: 200, delay: 1000 },
  required: "*",
} as const

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
}

// Theme-aware styles
const getTypographyStyle = (
  typographyVariant: ImmutableObject<TypographyStyle>
) => {
  if (!typographyVariant) {
    return {}
  }
  return {
    fontFamily: typographyVariant.fontFamily,
    fontWeight: typographyVariant.fontWeight?.toString(),
    fontSize: typographyVariant.fontSize,
    fontStyle: typographyVariant.fontStyle,
    lineHeight: typographyVariant.lineHeight,
    color: typographyVariant.color,
  }
}

const createStyles = (theme: IMThemeVariables) => {
  // Cache commonly used spacing and color values
  const spacing = theme.sys.spacing
  const colors = theme.sys.color
  const typography = theme.sys.typography
  const gap = spacing?.(2)
  const flexAuto = "1 1 auto"

  const flexRow = (styles: { [key: string]: any } = {}) =>
    css({ display: "flex", flexFlow: "row wrap", ...styles })

  const flexColumn = (styles: { [key: string]: any } = {}) =>
    css({ display: "flex", flexFlow: "column nowrap", ...styles })

  const inlineFlexRow = (styles: { [key: string]: any } = {}) =>
    css({ display: "inline-flex", flexFlow: "row wrap", ...styles })

  return {
    // Layout utilities with better performance
    row: flexRow({ gap }),
    btnFlex: css({ flex: flexAuto }),
    buttonGroup: flexColumn({ inlineSize: "100%", gap }),
    fullWidth: flexColumn({
      inlineSize: "100%",
      flex: flexAuto,
      minInlineSize: 0,
    }),
    relative: css({ position: "relative" }),
    rowAlignCenter: css({ alignItems: "center" }),

    // Interactive utilities
    disabledPicker: flexRow({ pointerEvents: "none" }),
    textareaResize: css({ resize: "vertical" }),

    // Main layout styles
    parent: flexColumn({
      overflowY: "auto",
      blockSize: "100%",
      position: "relative",
      padding: spacing?.(1),
      backgroundColor: colors?.surface?.paper,
    }),

    header: flexRow({ placeContent: "end", flex: "0 0 auto" }),

    content: flexColumn({ flex: flexAuto, minBlockSize: 0, gap }),
    contentCentered: flexColumn({
      placeContent: "center",
      alignItems: "center",
      textAlign: "center",
      flex: flexAuto,
      minBlockSize: 0,
      gap,
    }),

    // State patterns
    centered: flexColumn({
      placeContent: "center",
      gap,
      blockSize: "100%",
    }),

    overlay: css({
      position: "absolute",
      inset: "50% auto auto 50%",
      transform: "translate(-50%, -50%)",
      textAlign: "center",
      zIndex: config.zIndex.overlay,
    }),

    // Typography styles
    typography: {
      caption: css({
        ...getTypographyStyle(typography?.body2),
        color: colors?.surface?.backgroundText,
        marginBlockEnd: spacing?.(3),
      }),

      label: flexRow({
        ...getTypographyStyle(typography?.label2),
        color: colors?.surface?.backgroundText,
        marginBlockEnd: 0,
      }),

      title: css({
        ...getTypographyStyle(typography?.title2),
        color: colors?.surface?.backgroundText,
        margin: `${spacing?.(1)} 0`,
      }),

      instruction: css({
        ...getTypographyStyle(typography?.body2),
        color: colors?.surface?.backgroundText,
        margin: `${spacing?.(3)} 0`,
        textAlign: "center",
      }),

      link: css({
        ...getTypographyStyle(typography?.body1),
        color: colors?.action.link?.default,
        textDecoration: "underline",
        wordBreak: "break-all",
        "&:hover": {
          color: colors?.action.link?.hover,
          textDecoration: "underline",
        },
      }),

      required: css({
        marginInlineStart: spacing?.(1),
        color: colors?.error.main,
      }),
    },

    // Button styles
    button: {
      default: flexColumn({ inlineSize: "100%", gap }),

      text: (align: BtnContentProps["alignText"]) =>
        css({
          flex: flexAuto,
          textAlign: (align || "start") as any,
          paddingInlineEnd: config.button.textPadding,
        }),

      icon: css({
        position: "absolute",
        zIndex: 1,
        insetBlockStart: "50%",
        insetInlineEnd: config.button.offset,
        transform: "translateY(-50%)",
      }),
    },

    form: {
      layout: flexColumn({ flex: flexAuto, minBlockSize: 0, gap }),
      header: css({ flex: "0 0 auto" }),
      content: flexColumn({
        flex: flexAuto,
        gap,
      }),
      body: flexColumn({
        flex: flexAuto,
        gap,
        overflowY: "auto",
      }),
      footer: flexColumn({ flex: "0 0 auto", gap }),
    },

    fieldGroup: css({
      marginBlockEnd: spacing?.(2),
    }),

    checkLabel: flexRow({
      alignItems: "center",
      justifyContent: "space-between",
      inlineSize: "100%",
    }),

    tooltipWrap: {
      block: flexRow({ inlineSize: "100%", minInlineSize: 0 }),
      inline: inlineFlexRow({ minInlineSize: 0 }),
      anchor: flexRow({
        flex: flexAuto,
        minInlineSize: 0,
        "& > *": { flex: flexAuto, minInlineSize: 0 },
      }),
    },
  } as const
}

type Styles = ReturnType<typeof createStyles>

// Theme-aware styles hook
export const useStyles = (): Styles => {
  const theme = useTheme()
  return createStyles(theme)
}

// Hooks & utility helpers
let idSeq = 0

const useId = (): string => {
  const idRef = React.useRef<string>()
  if (!idRef.current) {
    idSeq += 1
    idRef.current = `fme-${idSeq}`
  }
  return idRef.current
}

const useValue = <T = unknown,>(
  controlled?: T,
  defaultValue?: T,
  onChange?: (value: T) => void
): readonly [T, (value: T) => void] => {
  const [value, setValue] = hooks.useControlled({
    controlled,
    default: defaultValue,
  })

  const handleChange = hooks.useEventCallback((newValue: T) => {
    setValue(newValue)
    onChange?.(newValue)
  })

  return [value, handleChange] as const
}

const withId = (
  child: React.ReactNode,
  readOnly: boolean,
  fallbackId: string
): { id: string | undefined; child: React.ReactNode } => {
  if (!readOnly && React.isValidElement(child)) {
    const childProps = (child.props || {}) as { [key: string]: unknown }
    const id = (childProps.id as string) || fallbackId
    if (!childProps.id) {
      const cloned = React.cloneElement(child as React.ReactElement, { id })
      return { id, child: cloned }
    }
    return { id, child }
  }
  return { id: undefined, child }
}

// Compose common css arrays with optional custom styles
const applyComponentStyles = (
  base: Array<ReturnType<typeof css> | undefined>,
  customStyle?: React.CSSProperties
) => [...base, styleCss(customStyle)].filter(Boolean)

const applyFullWidthStyles = (
  styles: Styles,
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
    styles: Styles
  }
) => {
  const { tooltip, placement, block, jimuCss, jimuStyle, styles } = opts
  if (!tooltip) return element

  const wrapperCss = [
    jimuCss,
    styleCss(jimuStyle),
    block ? styles.tooltipWrap.block : styles.tooltipWrap.inline,
  ]

  const anchorCss = styles.tooltipWrap.anchor

  return (
    <span css={wrapperCss as any}>
      <Tooltip content={tooltip} placement={placement}>
        <span css={anchorCss}>{element}</span>
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
  const isChildDisabled = Boolean(
    childProps.disabled || childProps["aria-disabled"]
  )

  if (!isChildDisabled) {
    return child
  }

  const ariaLabel =
    typeof tooltipContent === "string" ? tooltipContent : undefined

  return (
    <span aria-disabled="true" tabIndex={0} aria-label={ariaLabel}>
      {child}
    </span>
  )
}

// Render the required mark with tooltip and proper aria
const getRequiredMark = (
  translate: (k: string, vars?: any) => string,
  styles: ReturnType<typeof useStyles>
) => (
  <Tooltip content={translate("requiredField")} placement="bottom">
    <span
      css={styles.typography.required}
      aria-label={translate("ariaRequired")}
      role="img"
      aria-hidden="false"
    >
      {config.required}
    </span>
  </Tooltip>
)

// Primitive UI elements

// Button content component extracted from Button
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
    <span css={styles.button.icon} aria-hidden="true">
      {iconEl}
    </span>
  )

  return (
    <>
      {/* left icon not supported */}
      <div css={styles.button.text(alignText)}>{text}</div>
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
      css={applyComponentStyles([styles.textareaResize], props.style as any)}
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
  const [datePart, timePart] = trimmed.split("T")
  if (!datePart || !timePart) return null

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
}> = ({
  value,
  defaultValue,
  onChange,
  style,
  disabled,
  "aria-label": ariaLabel,
}) => {
  const styles = useStyles()
  const [currentValue, setCurrentValue] = useValue(
    value,
    defaultValue,
    onChange
  )

  const fallbackDateRef = React.useRef<Date>(new Date())
  const fallbackDate = fallbackDateRef.current

  const selectedDate =
    parseIsoLocalDateTime(currentValue) ||
    parseIsoLocalDateTime(defaultValue) ||
    fallbackDate

  const handleChange = hooks.useEventCallback(
    (rawValue: any, _label: string) => {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        setCurrentValue(formatIsoLocalDateTime(new Date(rawValue)))
        return
      }

      if (rawValue instanceof Date) {
        setCurrentValue(formatIsoLocalDateTime(rawValue))
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
        showTimeInput
        isLongTime
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
    if (!isControlled) setUncontrolledValue(final as any)
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
            tooltipPlacement="top"
            disabled={item.disabled}
            onClick={() => {
              if (active) return
              handleChange(item.value)
            }}
            block={true}
          />
        )
      })}
    </AdvancedButtonGroup>
  )
}

type LoadingSnapshot = {
  readonly message?: React.ReactNode
  readonly detail?: React.ReactNode
} | null

const useLoadingLatch = (
  state: StateViewProps["state"],
  delay: number
): { showLoading: boolean; snapshot: LoadingSnapshot } => {
  const [latched, setLatched] = React.useState(state.kind === "loading")
  const startRef = React.useRef<number | null>(
    state.kind === "loading" ? Date.now() : null
  )
  const snapshotRef = React.useRef<LoadingSnapshot>(
    state.kind === "loading"
      ? { message: (state as any).message, detail: (state as any).detail }
      : null
  )

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    if (state.kind === "loading") {
      snapshotRef.current = {
        message: (state as any).message,
        detail: (state as any).detail,
      }
      if (startRef.current == null) {
        startRef.current = Date.now()
      }
      setLatched(true)
    } else if (startRef.current != null) {
      const elapsed = Date.now() - startRef.current
      const remaining = Math.max(0, delay - elapsed)

      if (remaining > 0) {
        timer = setTimeout(() => {
          setLatched(false)
          startRef.current = null
          snapshotRef.current = null
        }, remaining)
      } else {
        setLatched(false)
        startRef.current = null
        snapshotRef.current = null
      }
    } else {
      setLatched(false)
      snapshotRef.current = null
    }

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [state, delay])

  const isLoading = state.kind === "loading"
  const snapshot = isLoading
    ? { message: (state as any).message, detail: (state as any).detail }
    : snapshotRef.current

  return {
    showLoading: isLoading || latched,
    snapshot,
  }
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
        <div role="group" aria-label={ariaLabel}>
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
            {detail && <div css={styles.typography.caption}>{detail}</div>}
          </div>
        )}
      </div>
    )
  }

  const renderStateByKind = (): React.ReactNode => {
    switch (state.kind) {
      case "error":
        return (
          <div role="alert" aria-live="assertive">
            <div css={[styles.row, styles.rowAlignCenter]}>
              <Icon
                src={getErrorIconSrc((state as any).code)}
                size={config.icon.large}
              />
              <div css={styles.typography.title}>{state.message}</div>
            </div>
            {state.code && (
              <div css={styles.typography.caption}>
                {translate("errorCode")}: {state.code}
              </div>
            )}
            {renderActionsFn({
              actions: state.actions,
              ariaLabel: translate("ariaErrorActions"),
            })}
          </div>
        )
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
            {state.title && (
              <div css={styles.typography.title}>{state.title}</div>
            )}
            {state.message && (
              <div css={styles.typography.caption}>{state.message}</div>
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
        [shouldCenter ? styles.centered : undefined],
        style as any
      )}
    >
      {content}
    </div>
  )
}

// ButtonGroup component
export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  buttons,
  secondaryButton,
  primaryButton,
  className,
  style,
}) => {
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

  const createButton = ({
    config,
    role,
    key,
  }: {
    readonly config: GroupButtonConfig
    readonly role: "secondary" | "primary"
    readonly key: string
  }) => {
    const fallbackType =
      role === "primary" ? ("primary" as const) : ("default" as const)
    const btnConfig = {
      ...config,
      type: config.type ?? fallbackType,
      key,
    }
    return <Button {...btnConfig} block={true} css={styles.btnFlex} />
  }

  return (
    <div
      css={applyComponentStyles([styles.buttonGroup], style as any)}
      className={className}
    >
      {resolvedButtons.map(createButton)}
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
          {title && <div css={styles.typography.title}>{title}</div>}
          {subtitle && <div css={styles.typography.caption}>{subtitle}</div>}
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
      css={applyComponentStyles([styles.fieldGroup], style)}
    >
      {check ? (
        <Label css={[styles.typography.label, styles.checkLabel]} check={true}>
          <span>
            {label}
            {required && getRequiredMark(translate, styles)}
          </span>
          {!readOnly && renderedChild}
        </Label>
      ) : (
        <>
          <Label css={styles.typography.label} check={false} for={fieldId}>
            {label}
            {required && getRequiredMark(translate, styles)}
          </Label>
          {!readOnly && renderedChild}
        </>
      )}
      {helper && !error && (
        <div id={fieldId ? `${fieldId}-help` : undefined}>{helper}</div>
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

  const fullText = translate("contactSupportWithEmail")
  const parts = fullText.split(EMAIL_PLACEHOLDER)

  if (parts.length < 2) {
    // Fallback if the translation doesn't contain the email placeholder
    return (
      <>
        {fullText}{" "}
        <a
          href={`mailto:${supportEmail}`}
          css={styles.typography.link}
          aria-label={translate("contactSupportWithEmail", {
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
            css={styles.typography.link}
            aria-label={translate("contactSupportWithEmail", {
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
