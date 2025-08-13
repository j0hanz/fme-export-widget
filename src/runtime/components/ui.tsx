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
    ICON: { position: "absolute" as const, zIndex: 1 as const },
  },
  STYLES: {
    BUTTON_RELATIVE: { position: "relative" as const },
    TEXTAREA_RESIZE: { resize: "vertical" as const },
    DROPDOWN_FLEX: "d-flex align-items-center",
    DISABLED_CURSOR: {
      display: "contents" as const,
      cursor: "not-allowed" as const,
    },
    LABEL: { display: "block" as const },
  },
} as const

// Utility Hooks / Helpers
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
  // Ensure children is a valid React element
  if (!React.isValidElement(children)) return <>{children}</>
  const tooltipContent =
    title ||
    content ||
    (children.props as any)?.title ||
    (children.props as any)?.["aria-label"]

  if (!tooltipContent || disabled) return children

  const isDisabled =
    (children.props as any)?.disabled ||
    (children.props as any)?.["aria-disabled"]
  const baseChildProps = (children.props || {}) as { [key: string]: any }
  // Remove native title to prevent duplicate tooltip semantics
  if ("title" in baseChildProps) delete baseChildProps.title
  const cloned = React.cloneElement(children as any, {
    ...baseChildProps,
    "aria-describedby": otherProps.id,
  })
  const child = isDisabled ? (
    <span style={UI_CSS.STYLES.DISABLED_CURSOR}>{cloned}</span>
  ) : (
    cloned
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
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
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
export const Select: React.FC<SelectProps> = (props) => {
  const {
    options = [],
    value: controlled,
    defaultValue,
    onChange,
    placeholder = UI_CONSTANTS.SELECT_DEFAULTS.PLACEHOLDER,
    disabled = false,
    ariaLabel,
    ariaDescribedBy,
    style,
  } = props
  const isMulti = Array.isArray(controlled)
  const [value, handleValueChange] = useControlledValue(
    controlled,
    defaultValue
  )

  const handleChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLSelectElement>) => {
      if (isMulti) {
        const first = Array.isArray(controlled)
          ? (controlled as unknown[])[0]
          : undefined
        const selected = Array.from(evt.target.selectedOptions).map((o) =>
          typeof first === "number" && !isNaN(Number(o.value))
            ? Number(o.value)
            : o.value
        )
        handleValueChange(selected as any)
        onChange?.(selected as any)
      } else {
        const rawValue = evt.target.value
        const finalValue =
          typeof controlled === "number" && !isNaN(Number(rawValue))
            ? Number(rawValue)
            : rawValue
        handleValueChange(finalValue as any)
        onChange?.(finalValue as any)
      }
    }
  )

  const renderOption = (option: SelectOption) => (
    <option
      key={String(option.value)}
      value={String(option.value)}
      disabled={option.disabled}
      aria-label={option.label}
    >
      {!option.hideLabel && option.label}
    </option>
  )

  const normalizedValue = isMulti
    ? (Array.isArray(value) ? value : []).map(String)
    : value !== undefined
      ? String(value)
      : undefined

  return isMulti ? (
    <select
      multiple
      value={normalizedValue as string[]}
      onChange={handleChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
    >
      {options.map(renderOption)}
    </select>
  ) : (
    <JimuSelect
      value={normalizedValue as any}
      onChange={handleChange}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      style={style}
    >
      {options.map(renderOption)}
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

  // Small presentational sub-element for button content
  interface ButtonContentProps {
    readonly loading: boolean
    readonly children?: React.ReactNode
    readonly text?: React.ReactNode
    readonly icon?: string | boolean
    readonly iconPosition: "left" | "right"
    readonly alignText: "start" | "center" | "end"
  }

  const ButtonContent = hooks.useEventCallback(
    ({
      loading: isLoading,
      children: inner,
      text: label,
      icon: ico,
      iconPosition: pos,
      alignText: align,
    }: ButtonContentProps): JSX.Element | null => {
      if (isLoading) return <Loading type={LoadingType.Donut} />
      if (inner) return <>{inner}</>

      const hasIcon = !!ico
      const hasText = !!label

      if (!hasIcon && !hasText) return null
      if (hasIcon && !hasText)
        return <Icon src={ico as string} size={UI_CSS.ICON_SIZES.LARGE} />
      if (hasText && !hasIcon) return <>{label}</>

      const iconEl = <Icon src={ico as string} size={UI_CSS.ICON_SIZES.SMALL} />
      const iconWithPosition = React.cloneElement(iconEl, {
        style: {
          ...UI_CSS.BTN.ICON,
          [pos]: UI_CSS.SPACING.ICON_OFFSET,
        },
      })

      return (
        <>
          {pos === "left" && iconWithPosition}
          <span style={{ ...UI_CSS.BTN.TEXT, textAlign: align }}>{label}</span>
          {pos === "right" && iconWithPosition}
        </>
      )
    }
  )

  const getAriaLabel = () =>
    text || !icon
      ? jimuProps["aria-label"]
      : (typeof tooltip === "string" && tooltip) ||
        UI_CSS.ACCESSIBILITY.DEFAULT_BUTTON_LABEL

  const buttonStyle = jimuProps.style
    ? { ...UI_CSS.STYLES.BUTTON_RELATIVE, ...jimuProps.style }
    : UI_CSS.STYLES.BUTTON_RELATIVE
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
      style={buttonStyle}
      block={block}
      tabIndex={jimuProps.tabIndex ?? 0}
    >
      <ButtonContent
        loading={loading}
        text={text}
        icon={icon}
        iconPosition={iconPosition}
        alignText={alignText}
      >
        {children}
      </ButtonContent>
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

// StateView component
const StateView: React.FC<{ state: UiViewState }> = React.memo(({ state }) => {
  const Actions = hooks.useEventCallback(
    ({
      actions,
      ariaLabel,
    }: {
      actions?: readonly UiAction[]
      ariaLabel: string
    }): JSX.Element | null => {
      if (!actions?.length) return null
      return (
        <div role="group" aria-label={ariaLabel}>
          {actions.map((a, i) => (
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
      )
    }
  )
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
          <Actions actions={state.actions} ariaLabel="Error actions" />
        </div>
      )
    case "empty":
      return (
        <div role="status" aria-live="polite">
          <div>{state.message}</div>
          <Actions actions={state.actions} ariaLabel="Empty actions" />
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
          <Actions actions={state.actions} ariaLabel="Success actions" />
        </div>
      )
    case "content":
      return <>{state.node}</>
  }
  return null
})

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
  // Presentational title for a tab item
  const TabTitle = hooks.useEventCallback(
    ({
      icon,
      label,
      hideLabel,
      tooltip,
      disabled,
    }: {
      readonly icon?: string
      readonly label: string
      readonly hideLabel?: boolean
      readonly tooltip?: string
      readonly disabled?: boolean
    }): JSX.Element => {
      const content = (
        <>
          {icon && <Icon src={icon} size={UI_CSS.ICON_SIZES.LARGE} />}
          {!hideLabel && label}
        </>
      )
      return tooltip ? (
        <Tooltip content={tooltip} placement="top" disabled={disabled}>
          <span>{content}</span>
        </Tooltip>
      ) : (
        content
      )
    }
  )

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
      {items.map((item) => (
        <Tab
          key={String(item.value)}
          id={String(item.value)}
          title={
            <TabTitle
              icon={item.icon}
              label={item.label}
              hideLabel={item.hideLabel}
              tooltip={item.tooltip}
              disabled={item.disabled}
            />
          }
          disabled={item.disabled}
        >
          <div />
        </Tab>
      ))}
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

  const groupStyle: React.CSSProperties = style
    ? { ...UI_CSS.BTN.GROUP, ...style }
    : UI_CSS.BTN.GROUP

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
    <div className={className} style={groupStyle}>
      {leftButton && createButton(leftButton, "left")}
      {rightButton && createButton(rightButton, "right")}
    </div>
  )
}

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
        <div>
          <div style={STYLES.typography.title}>{title}</div>
          <div style={STYLES.typography.caption}>{subtitle}</div>
        </div>
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
          style={{ ...UI_CSS.STYLES.LABEL, ...STYLES.typography.label }}
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
