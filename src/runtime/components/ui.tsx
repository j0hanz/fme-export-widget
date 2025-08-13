import { React, hooks } from "jimu-core"
import {
  TextInput,
  Tooltip as JimuTooltip,
  Message as JimuMessage,
  Button as JimuButton,
  Tabs as JimuTabs,
  Tab,
  Select as JimuSelect,
  SVG,
  FormGroup,
  Label,
  TextArea as JimuTextArea,
  Loading,
  LoadingType,
} from "jimu-ui"
import { STYLES } from "../../shared/css"
import defaultMessages from "./translations/default"
import type {
  ButtonProps,
  ButtonGroupProps,
  CustomTooltipProps,
  FormProps,
  GroupButtonConfig,
  InputProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
  TabsProps,
  TabItem,
  UiViewState,
  UiAction,
} from "../../shared/types"
import {
  UI_CONSTANTS,
  TOOLTIP_DELAYS,
  TOOLTIP_PLACEMENTS,
  TOOLTIP_STYLES,
} from "../../shared/types"
// handleDotVerticalIcon removed with Dropdown elimination

// UI style constants
export const UI_CSS = {
  ICON_SIZES: {
    SMALL: 14,
    DEFAULT: UI_CONSTANTS.DEFAULT_ICON_SIZE,
    MEDIUM: 16,
    LARGE: 20,
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

// Utility Hooks
const useControlledValue = <T = string,>(
  controlled?: T,
  defaultValue?: T,
  onChange?: (value: T) => void
) => {
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

// StateView component
const StateView: React.FC<{ state: UiViewState }> = React.memo(({ state }) => {
  switch (state.kind) {
    case "loading":
      return (
        <div style={STYLES.state.centered} role="status" aria-live="polite">
          <Loading type={LoadingType.Donut} width={200} height={200} />
          {(state.message || state.detail) && (
            <div style={STYLES.state.text} aria-label="Loading details">
              {state.message && <div>{state.message}</div>}
            </div>
          )}
        </div>
      )
    case "error":
      return (
        <div role="alert" aria-live="assertive">
          <div style={STYLES.typography.title}>{state.message}</div>
          {state.code && (
            <div style={STYLES.typography.caption}>Code: {state.code}</div>
          )}
          {state.actions?.length ? (
            <div role="group" aria-label="Error actions">
              {state.actions.map((a: UiAction, i) => (
                <Button
                  key={i}
                  onClick={a.onClick}
                  disabled={a.disabled}
                  variant={a.variant}
                  text={a.label}
                  block
                />
              ))}
            </div>
          ) : null}
        </div>
      )
    case "empty":
      return (
        <div role="status" aria-live="polite">
          <div>{state.message}</div>
          {state.actions?.length ? (
            <div role="group" aria-label="Empty actions">
              {state.actions.map((a: UiAction, i) => (
                <Button
                  key={i}
                  onClick={a.onClick}
                  disabled={a.disabled}
                  variant={a.variant}
                  text={a.label}
                  block
                />
              ))}
            </div>
          ) : null}
        </div>
      )
    case "success":
      return (
        <div role="status" aria-live="polite">
          {state.title && (
            <div style={STYLES.typography.title}>{state.title}</div>
          )}
          {state.message && (
            <div style={STYLES.typography.caption}>{state.message}</div>
          )}
          {state.actions?.length ? (
            <div role="group" aria-label="Success actions">
              {state.actions.map((a: UiAction, i) => (
                <Button
                  key={i}
                  onClick={a.onClick}
                  disabled={a.disabled}
                  variant={a.variant}
                  text={a.label}
                  block
                />
              ))}
            </div>
          ) : null}
        </div>
      )
    case "content":
      return <>{state.node}</>
  }
})

// Icon component
export interface IconProps {
  src: string
  size?: number
  className?: string
  ariaLabel?: string
  style?: React.CSSProperties
}

export const Icon: React.FC<IconProps> = ({
  src,
  size = UI_CSS.ICON_SIZES.DEFAULT,
  className,
  ariaLabel,
  style,
}) => (
  <SVG
    src={src}
    size={size}
    className={className}
    currentColor
    role="img"
    aria-hidden={!ariaLabel}
    aria-label={ariaLabel}
    style={style}
  />
)

// Tooltip component
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
  const tooltipContent =
    title || content || children.props?.title || children.props?.["aria-label"]

  if (!tooltipContent || disabled) return children

  const isDisabled =
    children.props?.disabled || children.props?.["aria-disabled"]
  const child = isDisabled ? (
    <span style={UI_CSS.STYLES.DISABLED_CURSOR}>
      {React.cloneElement(children, {
        ...children.props,
        title: undefined,
        "aria-describedby": otherProps.id,
      })}
    </span>
  ) : (
    React.cloneElement(children, {
      ...children.props,
      title: undefined,
      "aria-describedby": otherProps.id,
    })
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

// Message component
export interface AppMessageProps {
  message: string
  severity?: "info" | "warning" | "error" | "success"
  autoHideDuration?: number | null
  withIcon?: boolean
  className?: string
  style?: React.CSSProperties
  onClose?: () => void
}

export const Message: React.FC<AppMessageProps> = ({
  message,
  severity = "info",
  autoHideDuration = null,
  withIcon = false,
  className,
  style,
  onClose,
}) => (
  <JimuMessage
    className={className}
    style={style}
    severity={severity}
    message={message}
    withIcon={withIcon}
    autoHideDuration={autoHideDuration}
    open
    onClose={onClose}
  />
)

// Input Component
export const Input: React.FC<InputProps> = ({
  value: controlled,
  defaultValue,
  required = false,
  maxLength,
  pattern,
  validationMessage,
  type = "text",
  onChange,
  onFileChange,
  ...props
}) => {
  const [value, handleValueChange] = useControlledValue(
    controlled,
    defaultValue || ""
  )

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

// TextArea component
export const TextArea: React.FC<TextAreaProps> = ({
  value: controlled,
  defaultValue,
  onChange,
  ...props
}) => {
  const [value, handleValueChange] = useControlledValue(
    controlled,
    defaultValue || ""
  )

  const handleChange = hooks.useEventCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value
      handleValueChange(newValue)
      onChange?.(newValue)
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

// Select component
export const Select: React.FC<SelectProps> = ({
  options = [],
  value: controlled,
  defaultValue,
  onChange,
  placeholder = UI_CONSTANTS.SELECT_DEFAULTS.PLACEHOLDER,
  disabled = false,
  ariaLabel,
  ariaDescribedBy,
  style,
}) => {
  const [value, handleValueChange] = useControlledValue(
    controlled,
    defaultValue
  )

  const handleChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLSelectElement> | string | number) => {
      const rawValue = typeof evt === "object" ? evt.target.value : evt
      const finalValue =
        typeof controlled === "number" && !isNaN(Number(rawValue))
          ? Number(rawValue)
          : rawValue

      handleValueChange(finalValue)
      onChange?.(finalValue)
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
        <option
          key={String(option.value)}
          value={String(option.value)}
          disabled={option.disabled}
          aria-label={option.label}
        >
          {!option.hideLabel && option.label}
        </option>
      ))}
    </JimuSelect>
  )
}

// Button component
export const Button: React.FC<ButtonProps> = ({
  text,
  icon,
  iconPosition = UI_CONSTANTS.BUTTON_DEFAULTS.ICON_POSITION,
  alignText = "end",
  tooltip,
  tooltipDisabled = false,
  tooltipPlacement = UI_CONSTANTS.BUTTON_DEFAULTS.TOOLTIP_PLACEMENT,
  loading = false,
  onClick,
  children,
  block = UI_CONSTANTS.BUTTON_DEFAULTS.BLOCK,
  ...jimuProps
}) => {
  const handleClick = hooks.useEventCallback(() => {
    if (jimuProps.disabled || loading || !onClick) return
    onClick()
  })

  const renderContent = () => {
    if (loading) return <Loading type={LoadingType.Donut} />
    if (children) return children

    const hasIcon = !!icon
    const hasText = !!text

    if (!hasIcon && !hasText) return null
    if (hasIcon && !hasText)
      return <Icon src={icon as string} size={UI_CSS.ICON_SIZES.LARGE} />
    if (hasText && !hasIcon) return <>{text}</>

    const iconEl = <Icon src={icon as string} size={UI_CSS.ICON_SIZES.SMALL} />
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
        <span style={{ ...UI_CSS.BTN.TEXT, textAlign: alignText }}>{text}</span>
        {iconPosition === "right" && iconWithPosition}
      </>
    )
  }

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
      aria-live={loading ? "polite" : undefined}
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

  return tooltip && !tooltipDisabled ? (
    <Tooltip content={tooltip} placement={tooltipPlacement}>
      {buttonElement}
    </Tooltip>
  ) : (
    buttonElement
  )
}

// Tabs component
export const Tabs: React.FC<TabsProps> = ({
  items,
  value: controlled,
  defaultValue,
  onChange,
  ariaLabel,
  style,
  fill = true,
  type = "default",
}) => {
  const [value, handleValueChange] = useControlledValue(
    controlled,
    defaultValue || items[0]?.value
  )

  const handleTabChange = hooks.useEventCallback((tabValue: string) => {
    const newValue =
      typeof controlled === "number" ? Number(tabValue) : tabValue
    handleValueChange(newValue)
    onChange?.(newValue)
  })

  const normalizedValue = value !== undefined ? String(value) : undefined

  return (
    <JimuTabs
      value={normalizedValue}
      defaultValue={defaultValue ? String(defaultValue) : undefined}
      onChange={handleTabChange}
      type={type}
      fill={fill}
      aria-label={ariaLabel}
      style={style}
    >
      {items.map((item) => {
        const tabContent = (
          <>
            {item.icon && (
              <Icon src={item.icon} size={UI_CSS.ICON_SIZES.LARGE} />
            )}
            {!item.hideLabel && item.label}
          </>
        )

        const tabTitle = item.tooltip ? (
          <Tooltip
            content={item.tooltip}
            placement="top"
            disabled={item.disabled}
          >
            <span>{tabContent}</span>
          </Tooltip>
        ) : (
          tabContent
        )

        return (
          <Tab
            key={String(item.value)}
            id={String(item.value)}
            title={tabTitle}
            disabled={item.disabled}
          >
            <div />
          </Tab>
        )
      })}
    </JimuTabs>
  )
}

// ButtonGroup component
export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  leftButton,
  rightButton,
  className,
  style,
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
    const config = {
      ...buttonConfig,
      variant:
        buttonConfig.variant || (side === "left" ? "outlined" : "contained"),
      color: buttonConfig.color || (side === "left" ? "default" : "primary"),
      key: side,
    }

    return <Button {...config} block={false} style={{ flex: 1 }} />
  }

  return (
    <div className={className} style={{ ...UI_CSS.BTN.GROUP, ...style }}>
      {leftButton && createButton(leftButton, "left")}
      {rightButton && createButton(rightButton, "right")}
    </div>
  )
}

// Dropdown component removed (single header action now uses standalone Button)

// Form helpers
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

// Form component
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

export { Button as default, StateView }

export type {
  ButtonProps,
  ButtonGroupProps,
  CustomTooltipProps,
  FormProps,
  GroupButtonConfig,
  InputProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
  TabsProps,
  TabItem,
}
