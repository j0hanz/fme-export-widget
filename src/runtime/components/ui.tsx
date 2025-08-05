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
import defaultMessages from "../../translations/default"
import handleDotVerticalIcon from "../../assets/icons/handle-dot-vertical.svg"

// Shared controlled value hook
const useControlledValue = <T = string,>(
  controlledValue?: T,
  defaultValue?: T,
  onChange?: (value: T) => void
) => {
  const [value, setValue] = hooks.useControlled({
    controlled: controlledValue,
    default: defaultValue,
  })
  const handleChange = hooks.useEventCallback((newValue: T) => {
    setValue(newValue)
    onChange?.(newValue)
  })
  return [value, handleChange] as const
}

// Shared logging hook
const useComponentLogger = (
  logging?: { enabled?: boolean; prefix?: string },
  defaultPrefix = "Component"
) => {
  const logAction = hooks.useEventCallback(
    (action: string, data?: { [key: string]: unknown }) => {
      // Logging disabled for production
    }
  )
  return logAction
}

// Tooltip content resolver
const resolveTooltipContent = (
  title?: React.ReactNode,
  content?: React.ReactNode,
  childProps?: any
): React.ReactNode => {
  return title || content || childProps?.title || childProps?.["aria-label"]
}

// Event handler creator
const createEventHandler = (
  onClick?: () => void,
  logAction?: (action: string, data?: { [key: string]: unknown }) => void,
  disabled = false,
  loading = false,
  label = "Action"
) => {
  return hooks.useEventCallback(() => {
    if (disabled || loading || !onClick) return
    logAction?.("clicked", { label, disabled, loading })
    onClick()
  })
}

// Button config resolver
const resolveButtonConfig = (config: any, side: "left" | "right") => {
  const isLeft = side === "left"
  return {
    ...config,
    variant: config.variant || (isLeft ? "outlined" : "contained"),
    color: config.color || (isLeft ? "default" : "primary"),
    key: side,
  }
}

// Tooltip wrapper with consistent behavior and centralized logic
export const Tooltip: React.FC<CustomTooltipProps> = ({
  content,
  children,
  showArrow = TOOLTIP_STYLES.showArrow,
  placement = TOOLTIP_PLACEMENTS.TOP,
  enterDelay = TOOLTIP_DELAYS.ENTER,
  enterNextDelay = TOOLTIP_DELAYS.NEXT,
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
    <span style={{ display: "contents", cursor: "not-allowed" }}>
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

// Button component with centralized event handling and content rendering
export const Button: React.FC<ButtonProps> = ({
  text,
  icon,
  iconPosition = UI_CONSTANTS.BUTTON_DEFAULTS.ICON_POSITION,
  tooltip,
  tooltipDisabled = false,
  tooltipPlacement = UI_CONSTANTS.BUTTON_DEFAULTS.TOOLTIP_PLACEMENT,
  tooltipEnterDelay = UI_CONSTANTS.DEFAULT_TOOLTIP_DELAYS.ENTER,
  tooltipEnterNextDelay = UI_CONSTANTS.DEFAULT_TOOLTIP_DELAYS.ENTER_NEXT,
  tooltipLeaveDelay,
  logging = { enabled: false, prefix: "Button" },
  loading = false,
  onClick,
  children,
  block = UI_CONSTANTS.BUTTON_DEFAULTS.BLOCK,
  ...jimuProps
}) => {
  const logAction = useComponentLogger(logging, "Button")
  const handleClick = createEventHandler(
    onClick,
    logAction,
    jimuProps.disabled || false,
    loading,
    text || jimuProps.title || "Button"
  )

  const renderButtonContent = () => {
    if (loading) return <Loading type={LoadingType.Donut} />
    if (children) return children
    if (!text && !icon) return null

    const hasIcon = !!icon
    const hasText = !!text

    if (hasIcon && !hasText) {
      return (
        <SVG
          src={icon as string}
          size={UI_CONSTANTS.DEFAULT_ICON_SIZE}
          currentColor={true}
          role="img"
          aria-hidden="true"
        />
      )
    }

    if (hasText && !hasIcon) {
      return <span style={{ flex: 1 }}>{text}</span>
    }

    if (hasText && hasIcon) {
      const iconStyle: React.CSSProperties = {
        position: "absolute",
        [iconPosition]: "10px",
        zIndex: 1,
      }

      return (
        <>
          {iconPosition === "left" && (
            <SVG
              src={icon as string}
              size={14}
              style={iconStyle}
              currentColor={true}
              role="img"
              aria-hidden="true"
            />
          )}
          <span style={{ flex: 1 }}>{text}</span>
          {iconPosition === "right" && (
            <SVG
              src={icon as string}
              size={14}
              style={iconStyle}
              currentColor={true}
              role="img"
              aria-hidden="true"
            />
          )}
        </>
      )
    }

    return null
  }

  const buttonElement = (
    <JimuButton
      {...jimuProps}
      icon={!text && !!icon}
      onClick={handleClick}
      disabled={jimuProps.disabled || loading}
      aria-busy={loading}
      aria-label={
        !text && !!icon
          ? (typeof text === "string" ? text : "") ||
            (typeof jimuProps["aria-label"] === "string"
              ? jimuProps["aria-label"]
              : "") ||
            (typeof tooltip === "string" ? tooltip : "") ||
            "Button"
          : jimuProps["aria-label"] || undefined
      }
      aria-describedby={
        tooltip ? `${jimuProps.id || "button"}-tooltip` : undefined
      }
      title={tooltip ? undefined : text || jimuProps.title}
      style={{ position: "relative", ...jimuProps.style }}
      block={block}
      tabIndex={jimuProps.tabIndex ?? 0}
    >
      {renderButtonContent()}
    </JimuButton>
  )

  return tooltip && !tooltipDisabled ? (
    <Tooltip
      content={tooltip}
      placement={tooltipPlacement}
      enterDelay={tooltipEnterDelay}
      leaveDelay={tooltipLeaveDelay}
    >
      {buttonElement}
    </Tooltip>
  ) : (
    buttonElement
  )
}

// ButtonGroup component for grouping buttons with layout and logging
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
    <div className={className} style={{ ...STYLES.button.group, ...style }}>
      {leftButton && createButton(leftButton, "left")}
      {rightButton && createButton(rightButton, "right")}
    </div>
  )
}

// Input component with controlled state management
export const Input: React.FC<InputProps> = ({
  value: controlledValue,
  defaultValue,
  required = false,
  maxLength,
  pattern,
  validationMessage,
  logging = { enabled: false, prefix: "Input" },
  onChange,
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
      onChange?.(evt)
      logAction("changed", {
        value: newValue,
        controlled: controlledValue !== undefined,
      })
    }
  )

  return (
    <TextInput
      {...props}
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

// TextArea component with controlled state management
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
      onChange?.(event)
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
      style={{ resize: "vertical", ...props.style }}
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

// Select component with controlled state management and logging
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
          {option.icon && (
            <SVG
              src={option.icon as string}
              size={16}
              currentColor={true}
              role="img"
              aria-hidden="true"
            />
          )}
          {!option.hideLabel && option.label}
        </Option>
      ))}
    </JimuSelect>
  )
}

// Dropdown component with centralized item handling and logging
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
    if (item.disabled || !item.onClick) return
    logAction("item clicked", {
      itemId: item.id,
      label: item.label,
      disabled: item.disabled,
    })
    item.onClick()
  })

  const renderButtonContent = () => {
    if (buttonText && buttonIcon) {
      return (
        <div className="d-flex align-items-center">
          <SVG
            src={buttonIcon as string}
            size={UI_CONSTANTS.DEFAULT_ICON_SIZE}
            className="mr-2"
            currentColor={true}
            role="img"
            aria-hidden="true"
          />
          {buttonText}
        </div>
      )
    }
    if (buttonIcon)
      return (
        <SVG
          src={buttonIcon as string}
          size={UI_CONSTANTS.DEFAULT_ICON_SIZE}
          currentColor={true}
          role="img"
          aria-label={ariaLabel || buttonTitle || "Menu"}
        />
      )
    if (buttonText) return buttonText
    return (
      <SVG
        src={handleDotVerticalIcon}
        size={UI_CONSTANTS.DEFAULT_ICON_SIZE}
        currentColor={true}
        role="img"
        aria-label={ariaLabel || "Options menu"}
      />
    )
  }

  const visibleItems = items.filter((item) => !item.hidden)
  if (visibleItems.length === 0) return null

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
              {item.icon && (
                <SVG
                  src={item.icon as string}
                  size={UI_CONSTANTS.DEFAULT_ICON_SIZE}
                  className="mr-2"
                  currentColor={true}
                  role="img"
                  aria-hidden="true"
                />
              )}
              {item.label}
            </JimuDropdownItem>
          )

          return item.tooltip && !item.disabled ? (
            <Tooltip
              key={item.id}
              title={item.tooltip}
              placement={item.tooltipPlacement || "top"}
              enterDelay={UI_CONSTANTS.DEFAULT_TOOLTIP_DELAYS.ENTER}
              enterNextDelay={UI_CONSTANTS.DEFAULT_TOOLTIP_DELAYS.ENTER_NEXT}
            >
              {itemElement}
            </Tooltip>
          ) : (
            itemElement
          )
        })}
      </JimuDropdownMenu>
    </JimuDropdown>
  )
}

// Form component with layout and field variants
const FormHeader: React.FC<{
  title: string
  subtitle: string
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
                aria-label={translate("required")}
                role="img"
                aria-hidden="false"
              >
                *
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
