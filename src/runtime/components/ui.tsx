import { React, hooks } from "jimu-core"
import {
  Button as JimuButton,
  Dropdown as JimuDropdown,
  DropdownButton as JimuDropdownButton,
  DropdownMenu as JimuDropdownMenu,
  DropdownItem as JimuDropdownItem,
  FormGroup,
  SVG,
  Label,
  Loading,
  LoadingType,
  Option,
  Select as JimuSelect,
  TextArea as JimuTextArea,
  TextInput,
  Tooltip as JimuTooltip,
} from "jimu-ui"
import { STYLES } from "../../shared/css"
import defaultMessages from "./translations/default"
import type {
  ButtonProps,
  ButtonGroupProps,
  CustomTooltipProps,
  DropdownItemConfig,
  DropdownProps,
  FormProps,
  GroupButtonConfig,
  InputProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
} from "../../shared/types"
import {
  UI_CONSTANTS,
  TOOLTIP_DELAYS,
  TOOLTIP_PLACEMENTS,
  TOOLTIP_STYLES,
} from "../../shared/types"
import handleDotVerticalIcon from "../../assets/icons/handle-dot-vertical.svg"

// UI style constants
export const UI_CSS = {
  ICON_SIZES: {
    SMALL: 14,
    DEFAULT: UI_CONSTANTS.DEFAULT_ICON_SIZE,
    MEDIUM: 16,
  },
  SPACING: {
    ICON_OFFSET: "10px",
    ICON_MARGIN: "mr-2",
  },
  ACCESSIBILITY: {
    DEFAULT_BUTTON_LABEL: "Button",
    DEFAULT_MENU_LABEL: "Options menu",
    REQUIRED_INDICATOR: "*",
  },
  BTN: {
    GROUP: {
      display: "flex" as const,
      gap: "1rem",
      marginTop: "1rem",
    } as React.CSSProperties,
    DEFAULT: {
      display: "flex",
      flexFlow: "column",
      width: "100%",
      gap: "1rem",
    } as React.CSSProperties,
    ROW: {
      display: "flex" as const,
      width: "100%",
      flexDirection: "row",
      gap: 0,
    } as React.CSSProperties,
    TEXT: {
      flex: 1,
      textAlign: "end",
    } as React.CSSProperties,
    SELECT: {
      width: 50,
      height: 32,
      minWidth: 50,
      padding: 0,
    } as React.CSSProperties,
  },
  STYLES: {
    BUTTON_RELATIVE: { position: "relative" as const },
    TEXTAREA_RESIZE: { resize: "vertical" as const },
    DROPDOWN_FLEX: "d-flex align-items-center",
    DISABLED_CURSOR: {
      display: "contents" as const,
      cursor: "not-allowed" as const,
    },
  },
} as const

// Create icon element
const createIconElement = (
  icon: string,
  size: number = UI_CSS.ICON_SIZES.DEFAULT,
  className?: string,
  ariaLabel?: string
) => (
  <SVG
    src={icon}
    size={size}
    className={className}
    currentColor
    role="img"
    aria-hidden={!ariaLabel}
    aria-label={ariaLabel}
  />
)

const withConditionalTooltip = (
  el: React.ReactElement,
  tooltip?: React.ReactNode,
  disabled = false,
  placement: "top" | "bottom" | "left" | "right" = "top",
  enterDelay = UI_CONSTANTS.TOOLTIP.DELAYS.ENTER
): React.ReactElement =>
  tooltip && !disabled ? (
    <Tooltip content={tooltip} placement={placement} enterDelay={enterDelay}>
      {el}
    </Tooltip>
  ) : (
    el
  )

// Controlled value hook
const useControlledValue = <T = string,>(
  controlledValue?: T,
  defaultValue?: T,
  onChange?: (value: T) => void
) => {
  const [value, setValue] = hooks.useControlled({
    controlled: controlledValue,
    default: defaultValue,
  })

  // Event callback for change
  const handleChange = hooks.useEventCallback((newValue: T) => {
    setValue(newValue)
    onChange?.(newValue)
  })

  return [value, handleChange] as const
}

// Logging hook
const useComponentLogger = (
  logging?: { enabled?: boolean; prefix?: string },
  defaultPrefix = "Component"
) => {
  // Event callback
  const logAction = hooks.useEventCallback(
    (action: string, data?: { [key: string]: unknown }) => {
      if (logging?.enabled) {
        console.log(`[${logging.prefix || defaultPrefix}] ${action}`, data)
      }
    }
  )
  return logAction
}

// Resolve tooltip content
const resolveTooltipContent = (
  title?: React.ReactNode,
  content?: React.ReactNode,
  childProps?: any
): React.ReactNode =>
  title || content || childProps?.title || childProps?.["aria-label"]

// Normalize button config
const resolveButtonConfig = (config: any, side: "left" | "right") => ({
  ...config,
  variant: config.variant || (side === "left" ? "outlined" : "contained"),
  color: config.color || (side === "left" ? "default" : "primary"),
  key: side,
})

// Tooltip wrapper
export const Tooltip: React.FC<CustomTooltipProps> = ({
  content,
  children,
  showArrow = TOOLTIP_STYLES.showArrow,
  placement = TOOLTIP_PLACEMENTS.TOP,
  enterDelay = TOOLTIP_DELAYS.ENTER,
  enterNextDelay = TOOLTIP_DELAYS.ENTER_NEXT,
  enterTouchDelay = TOOLTIP_DELAYS.TOUCH,
  leaveDelay = TOOLTIP_DELAYS.LEAVE,
  disabled = TOOLTIP_STYLES.disabled,
  title,
  ...otherProps
}) => {
  const tooltipContent = resolveTooltipContent(title, content, children.props)

  if (!tooltipContent || disabled) {
    return children
  }

  const isDisabled =
    children.props?.disabled || children.props?.["aria-disabled"]
  const childProps = {
    ...children.props,
    title: undefined,
    "aria-describedby": otherProps.id,
  }

  const child = isDisabled ? (
    <span style={UI_CSS.STYLES.DISABLED_CURSOR}>
      {React.cloneElement(children, childProps)}
    </span>
  ) : (
    React.cloneElement(children, childProps)
  )

  return (
    <JimuTooltip
      title={tooltipContent}
      showArrow={showArrow}
      placement={placement}
      enterDelay={enterDelay}
      enterNextDelay={enterNextDelay}
      enterTouchDelay={enterTouchDelay}
      leaveDelay={leaveDelay}
      disabled={disabled}
      {...otherProps}
    >
      {child}
    </JimuTooltip>
  )
}

// Button
export const Button: React.FC<ButtonProps> = ({
  text,
  icon,
  iconPosition = UI_CONSTANTS.BUTTON_DEFAULTS.ICON_POSITION,
  tooltip,
  tooltipDisabled = false,
  tooltipPlacement = UI_CONSTANTS.BUTTON_DEFAULTS.TOOLTIP_PLACEMENT,
  tooltipEnterDelay = UI_CONSTANTS.TOOLTIP.DELAYS.ENTER,
  logging = { enabled: false, prefix: "Button" },
  loading = false,
  onClick,
  children,
  block = UI_CONSTANTS.BUTTON_DEFAULTS.BLOCK,
  ...jimuProps
}) => {
  // Click handler
  const handleClick = hooks.useEventCallback(() => {
    if (jimuProps.disabled || loading || !onClick) return
    if (logging?.enabled) {
      const label =
        typeof text === "string" ? text : jimuProps.title || "Button"
      console.log(`[${logging.prefix}] clicked`, {
        label,
        disabled: jimuProps.disabled,
        loading,
      })
    }
    onClick()
  })

  // Render content
  const renderContent = () => {
    if (loading) return <Loading type={LoadingType.Donut} />
    if (children) return children

    const hasIcon = !!icon
    const hasText = !!text

    if (!hasIcon && !hasText) return null
    if (hasIcon && !hasText)
      return createIconElement(icon as string, UI_CSS.ICON_SIZES.DEFAULT)
    if (hasText && !hasIcon) return <>{text}</>
    const iconEl = createIconElement(icon as string, UI_CSS.ICON_SIZES.SMALL)
    const iconWithPosition = React.cloneElement(iconEl, {
      style: {
        position: "absolute",
        [iconPosition]: UI_CSS.SPACING.ICON_OFFSET,
        zIndex: 1,
      },
    })

    return (
      <>
        {iconPosition === "left" && iconWithPosition}
        <span style={UI_CSS.BTN.TEXT}>{text}</span>
        {iconPosition === "right" && iconWithPosition}
      </>
    )
  }

  // ARIA label
  const getAriaLabel = () =>
    text || !icon
      ? jimuProps["aria-label"]
      : (typeof tooltip === "string" && tooltip) ||
        UI_CSS.ACCESSIBILITY.DEFAULT_BUTTON_LABEL

  const buttonElement = (
    <JimuButton
      {...jimuProps}
      icon={!text && !!icon}
      onClick={handleClick}
      disabled={jimuProps.disabled || loading}
      aria-busy={loading}
      aria-label={getAriaLabel()}
      aria-describedby={
        tooltip ? `${jimuProps.id || "button"}-tooltip` : undefined
      }
      title={
        tooltip ? undefined : typeof text === "string" ? text : jimuProps.title
      }
      style={{
        ...UI_CSS.STYLES.BUTTON_RELATIVE,
        ...jimuProps.style,
      }}
      block={block}
      tabIndex={jimuProps.tabIndex ?? 0}
    >
      {renderContent()}
    </JimuButton>
  )

  // Optional tooltip
  return tooltip && !tooltipDisabled ? (
    <Tooltip
      content={tooltip}
      placement={tooltipPlacement}
      enterDelay={tooltipEnterDelay}
    >
      {buttonElement}
    </Tooltip>
  ) : (
    buttonElement
  )
}

// Button group
export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  leftButton,
  rightButton,
  className,
  style,
  logging = { enabled: false, prefix: "ButtonGroup" },
}) => {
  if (!leftButton && !rightButton) {
    console.warn(
      "ButtonGroup requires at least one button (leftButton or rightButton)"
    )
    return null
  }

  const createButton = (
    buttonConfig: GroupButtonConfig,
    side: "left" | "right"
  ) => {
    const config = resolveButtonConfig(buttonConfig, side)

    return (
      <Button
        {...config}
        logging={{
          enabled: logging?.enabled,
          prefix: `${logging?.prefix}.${side}`,
        }}
        block={false}
        style={{ flex: 1 }}
      />
    )
  }

  return (
    <div className={className} style={UI_CSS.BTN.GROUP}>
      {leftButton && createButton(leftButton, "left")}
      {rightButton && createButton(rightButton, "right")}
    </div>
  )
}

// Input
export const Input: React.FC<InputProps> = ({
  value: controlledValue,
  defaultValue,
  required = false,
  maxLength,
  pattern,
  validationMessage,
  type = "text",
  logging = { enabled: false, prefix: "Input" },
  onChange,
  onFileChange,
  ...props
}) => {
  const logAction = useComponentLogger(logging, "Input")
  const [value, handleValueChange] = useControlledValue(
    controlledValue,
    defaultValue || ""
  )

  const handleChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = evt.target.value
      handleValueChange(newValue)

      // File input branch
      if (type === "file" && onFileChange) {
        onFileChange(evt)
      } else if (onChange) {
        onChange(newValue)
      }

      logAction("changed", {
        value: newValue,
        controlled: controlledValue !== undefined,
      })
    }
  )

  return (
    <TextInput
      {...props}
      type={type as any}
      value={value}
      onChange={handleChange}
      required={required}
      maxLength={maxLength}
      pattern={pattern?.source}
      title={validationMessage}
      aria-required={required}
      aria-invalid={!!validationMessage}
      aria-describedby={
        validationMessage ? `${props.id || "input"}-error` : undefined
      }
    />
  )
}

// TextArea
export const TextArea: React.FC<TextAreaProps> = ({
  value: controlledValue,
  defaultValue,
  logEvent = false,
  logPrefix = "TextArea",
  onChange,
  ...props
}) => {
  const logAction = useComponentLogger(
    { enabled: logEvent, prefix: logPrefix },
    "TextArea"
  )
  const [value, handleValueChange] = useControlledValue(
    controlledValue,
    defaultValue || ""
  )

  const handleChange = hooks.useEventCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value
      handleValueChange(newValue)
      onChange?.(newValue)
      logAction("changed", {
        value: newValue,
        length: newValue.length,
        controlled: controlledValue !== undefined,
        disabled: props.disabled,
      })
    }
  )

  return (
    <JimuTextArea
      {...props}
      value={value}
      onChange={handleChange}
      style={{
        ...UI_CSS.STYLES.TEXTAREA_RESIZE,
        ...props.style,
      }}
      aria-required={props.required}
      aria-invalid={!!(props as any).validationMessage}
      aria-describedby={
        (props as any).validationMessage
          ? `${props.id || "textarea"}-error`
          : undefined
      }
    />
  )
}

// Select
export const Select: React.FC<SelectProps> = ({
  options = [],
  value: controlledValue,
  defaultValue,
  onChange,
  placeholder = UI_CONSTANTS.SELECT_DEFAULTS.PLACEHOLDER,
  disabled = false,
  logging = { enabled: false, prefix: "Select" },
  ariaLabel,
  ariaDescribedBy,
  style,
}) => {
  const logAction = useComponentLogger(logging, "Select")
  const [value, handleValueChange] = useControlledValue(
    controlledValue,
    defaultValue
  )

  const handleChange = hooks.useEventCallback(
    (
      evt: React.ChangeEvent<HTMLSelectElement> | string | number,
      selectedValue?: string | number
    ) => {
      const rawValue =
        typeof evt === "object"
          ? evt.target.value
          : (evt ?? selectedValue ?? "")
      const finalValue =
        typeof controlledValue === "number" && !isNaN(Number(rawValue))
          ? Number(rawValue)
          : rawValue

      handleValueChange(finalValue)
      onChange?.(finalValue)

      const option = options.find(
        (opt) => String(opt.value) === String(finalValue)
      )
      logAction("changed", {
        value: finalValue,
        label: option?.label,
        controlled: controlledValue !== undefined,
      })
    }
  )

  const normalizedValue = value !== undefined ? String(value) : undefined

  return (
    <JimuSelect
      value={normalizedValue}
      onChange={handleChange}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      style={style}
    >
      {options.map((option) => (
        <Option
          key={String(option.value)}
          value={String(option.value)}
          disabled={option.disabled}
          aria-label={option.label}
        >
          {option.icon &&
            createIconElement(option.icon, UI_CSS.ICON_SIZES.MEDIUM)}
          {!option.hideLabel && option.label}
        </Option>
      ))}
    </JimuSelect>
  )
}

// Dropdown
export const Dropdown: React.FC<DropdownProps> = ({
  items = [],
  buttonIcon,
  buttonText,
  buttonTitle,
  buttonVariant = "tertiary",
  buttonSize = "sm",
  openMode = "hover",
  "aria-label": ariaLabel,
  "a11y-description": a11yDescription,
  logging = { enabled: false, prefix: "Dropdown" },
  ...jimuProps
}) => {
  const logAction = useComponentLogger(logging, "Dropdown")

  const handleItemClick = hooks.useEventCallback((item: DropdownItemConfig) => {
    if (item.disabled) return
    logAction("item clicked", {
      itemId: item.id,
      label: item.label,
      disabled: item.disabled,
    })
    item.onClick?.()
  })

  const renderButtonContent = () => {
    if (buttonText && buttonIcon)
      return (
        <div className={UI_CSS.STYLES.DROPDOWN_FLEX}>
          {createIconElement(
            buttonIcon,
            UI_CSS.ICON_SIZES.DEFAULT,
            UI_CSS.SPACING.ICON_MARGIN
          )}
          {buttonText}
        </div>
      )
    if (buttonIcon)
      return createIconElement(
        buttonIcon,
        UI_CSS.ICON_SIZES.DEFAULT,
        undefined,
        ariaLabel || buttonTitle || "Menu"
      )
    if (buttonText) return buttonText
    return createIconElement(
      handleDotVerticalIcon,
      UI_CSS.ICON_SIZES.DEFAULT,
      undefined,
      ariaLabel || UI_CSS.ACCESSIBILITY.DEFAULT_MENU_LABEL
    )
  }

  const visibleItems = items.filter((i) => !i.hidden)
  if (!visibleItems.length) return null

  return (
    <JimuDropdown isSubMenuItem openMode={openMode} {...jimuProps}>
      <JimuDropdownButton
        icon={!buttonText}
        size={buttonSize}
        type={buttonVariant}
        title={buttonTitle}
        aria-label={ariaLabel || buttonTitle || buttonText || "Options menu"}
        a11y-description={a11yDescription}
        aria-haspopup="menu"
        aria-expanded="false"
      >
        {renderButtonContent()}
      </JimuDropdownButton>
      <JimuDropdownMenu>
        {visibleItems.map((item) => {
          const itemElement = (
            <JimuDropdownItem
              key={item.id}
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
              aria-label={item.label}
              role="menuitem"
            >
              {item.icon &&
                createIconElement(
                  item.icon,
                  UI_CSS.ICON_SIZES.DEFAULT,
                  UI_CSS.SPACING.ICON_MARGIN
                )}
              {item.label}
            </JimuDropdownItem>
          )

          return withConditionalTooltip(
            itemElement,
            item.tooltip,
            item.disabled,
            item.tooltipPlacement || "top",
            UI_CONSTANTS.TOOLTIP.DELAYS.ENTER
          )
        })}
      </JimuDropdownMenu>
    </JimuDropdown>
  )
}

// Form
const FormHeader: React.FC<{
  title: React.ReactNode
  subtitle: React.ReactNode
  className?: string
}> = ({ title, subtitle, className }) => (
  <div className={className}>
    <div style={STYLES.typography.title}>{title}</div>
    <div style={STYLES.typography.caption}>{subtitle}</div>
  </div>
)

export const Form: React.FC<FormProps> = (props) => {
  const { variant, className, style, children } = props
  const translate = hooks.useTranslation(defaultMessages)

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
      <>
        <FormHeader title={title} subtitle={subtitle} />
        {children}
        <ButtonGroup
          leftButton={{
            text: translate("back"),
            onClick: onBack,
            disabled: loading,
            tooltip: translate("tooltipBackToOptions"),
            tooltipPlacement: "bottom",
          }}
          rightButton={{
            text: translate("submit"),
            onClick: onSubmit,
            disabled: !isValid || loading,
            loading: loading,
            tooltip: translate("tooltipSubmitOrder"),
            tooltipPlacement: "bottom",
          }}
          logging={{ enabled: true, prefix: "FME-Export" }}
        />
      </>
    )
  }

  if (variant === "field") {
    const { label, helper, required = false, readOnly = false, error } = props

    return (
      <FormGroup className={className} style={style}>
        <Label
          className="d-block"
          style={STYLES.typography.label}
          check={false}
        >
          {label}
          {required && (
            <Tooltip content={translate("requiredField")} placement="bottom">
              <span
                style={STYLES.typography.required}
                aria-label="required"
                role="img"
                aria-hidden="false"
              >
                {UI_CSS.ACCESSIBILITY.REQUIRED_INDICATOR}
              </span>
            </Tooltip>
          )}
        </Label>
        {!readOnly && children}
        {helper && !error && <>{helper}</>}
        {error && <div className="d-block">{error}</div>}
      </FormGroup>
    )
  }

  throw new Error(`Unknown Form variant: ${variant}`)
}

// Default export
export { Button as default }

export type {
  ButtonProps,
  ButtonGroupProps,
  CustomTooltipProps,
  DropdownItemConfig,
  DropdownProps,
  FormProps,
  GroupButtonConfig,
  InputProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
}
