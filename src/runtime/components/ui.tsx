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
  Checkbox as JimuCheckbox,
} from "jimu-ui"
import { STYLES } from "../../shared/css"
import defaultMessages from "./translations/default"
import type {
  ButtonProps,
  ButtonGroupProps,
  CustomTooltipProps,
  FormProps,
  FieldProps,
  GroupButtonConfig,
  InputProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
  TabsProps,
  TabItem,
  UiViewState,
  UiAction,
  ButtonContentProps,
} from "../../shared/types"

// UI style constants
export const UI_CSS = {
  ICON_SIZES: {
    SMALL: 14,
    DEFAULT: 16,
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
  BTN_DEFAULTS: {
    BLOCK: true,
    ICON_POSITION: "left" as const,
    TOOLTIP_PLACEMENT: "top" as const,
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
  TOOLTIP: {
    DELAYS: {
      ENTER: 1000,
      ENTER_NEXT: 500,
      LEAVE: 100,
      TOUCH: 500,
    },
    PLACEMENTS: {
      TOP: "top" as const,
      BOTTOM: "bottom" as const,
      LEFT: "left" as const,
      RIGHT: "right" as const,
    },
    STYLES: {
      showArrow: true,
      disabled: false,
    },
  },
  SELECT_DEFAULTS: { PLACEHOLDER: "Välj ett alternativ" },
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
let autoIdCounter = 0
const useAutoId = (prefix = "fme"): string => {
  const idRef = React.useRef<string>()
  if (!idRef.current) {
    autoIdCounter += 1
    idRef.current = `${prefix}-${Date.now().toString(36)}-${autoIdCounter}`
  }
  return idRef.current
}

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

// Helper functions for accessibility
const generateAriaDescribedBy = (
  id?: string,
  suffix = "error"
): string | undefined => {
  return id ? `${id}-${suffix}` : undefined
}

const getButtonAriaLabel = (
  text?: React.ReactNode,
  icon?: string | boolean,
  jimuAriaLabel?: string,
  tooltip?: string
): string | undefined => {
  if (text || !icon) return jimuAriaLabel
  return (
    (typeof tooltip === "string" && tooltip) ||
    UI_CSS.ACCESSIBILITY.DEFAULT_BUTTON_LABEL
  )
}

// Helper for tooltip content resolution
const resolveTooltipContent = (
  title?: React.ReactNode,
  content?: React.ReactNode,
  children?: React.ReactElement
): React.ReactNode => {
  if (title || content) return title || content
  if (React.isValidElement(children)) {
    const props = children.props as any
    return props?.title || props?.["aria-label"]
  }
  return undefined
}

// Helper for button style merging
const mergeButtonStyles = (
  baseStyle: React.CSSProperties,
  userStyle?: React.CSSProperties
): React.CSSProperties => {
  return userStyle ? { ...baseStyle, ...userStyle } : baseStyle
}

// Button content component extracted from Button
const ButtonContent: React.FC<ButtonContentProps> = ({
  loading,
  children,
  text,
  icon,
  iconPosition,
  alignText,
}) => {
  if (loading) return <Loading type={LoadingType.Donut} />
  if (children) return <>{children}</>
  const hasIcon =
    (typeof icon === "string" && icon.length > 0) ||
    (icon != null && React.isValidElement(icon))
  const hasText = !!text

  if (!hasIcon && !hasText) return null
  if (hasIcon && !hasText)
    return typeof icon === "string" ? (
      <Icon src={icon} size={UI_CSS.ICON_SIZES.LARGE} />
    ) : (
      (icon as React.ReactElement)
    )
  if (hasText && !hasIcon) return <>{text}</>

  const iconEl =
    typeof icon === "string" ? (
      <Icon src={icon} size={UI_CSS.ICON_SIZES.SMALL} />
    ) : (
      (icon as React.ReactElement)
    )
  const iconWithPosition = React.cloneElement(iconEl, {
    style: {
      ...UI_CSS.BTN.ICON,
      [iconPosition]: UI_CSS.SPACING.ICON_OFFSET,
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

// Icon component
export interface IconProps {
  src: string
  size?: number | "s" | "m" | "l"
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
}) => {
  return (
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
}

// Tooltip component
export const Tooltip: React.FC<CustomTooltipProps> = ({
  content,
  children,
  showArrow = UI_CSS.TOOLTIP.STYLES.showArrow,
  placement = UI_CSS.TOOLTIP.PLACEMENTS.TOP,
  enterDelay = UI_CSS.TOOLTIP.DELAYS.ENTER,
  enterNextDelay = UI_CSS.TOOLTIP.DELAYS.ENTER_NEXT,
  enterTouchDelay = UI_CSS.TOOLTIP.DELAYS.TOUCH,
  leaveDelay = UI_CSS.TOOLTIP.DELAYS.LEAVE,
  disabled = UI_CSS.TOOLTIP.STYLES.disabled,
  title,
  ...otherProps
}) => {
  const autoId = useAutoId("tooltip")
  // Ensure children is a valid React element
  if (!React.isValidElement(children)) return <>{children}</>

  const tooltipContent = resolveTooltipContent(title, content, children)
  if (!tooltipContent || disabled) return children

  const tooltipId = otherProps.id || autoId

  const isDisabled =
    (children.props as any)?.disabled ||
    (children.props as any)?.["aria-disabled"]
  const baseChildProps = (children.props || {}) as { [key: string]: any }
  // Remove native title to prevent duplicate tooltip semantics
  if ("title" in baseChildProps) delete baseChildProps.title
  const cloned = React.cloneElement(children as any, {
    ...baseChildProps,
    "aria-describedby": tooltipId,
  })
  const child = isDisabled ? (
    <span style={UI_CSS.STYLES.DISABLED_CURSOR}>{cloned}</span>
  ) : (
    cloned
  )

  return (
    <JimuTooltip
      id={tooltipId}
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
  open?: boolean
  role?: "alert" | "status"
  ariaLive?: "assertive" | "polite" | "off"
}

export const Message: React.FC<AppMessageProps> = ({
  message,
  severity = "info",
  autoHideDuration = null,
  withIcon = false,
  className,
  style,
  onClose,
  open = true,
  role,
  ariaLive,
}) => (
  <div role={role} aria-live={ariaLive}>
    <JimuMessage
      className={className}
      style={style}
      severity={severity}
      message={message}
      withIcon={withIcon}
      autoHideDuration={autoHideDuration}
      open={open}
      onClose={onClose}
    />
  </div>
)

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
  pattern,
  validationMessage,
  errorText,
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
      title={validationMessage || errorText}
      aria-required={required}
      aria-invalid={!!(validationMessage || errorText)}
      aria-describedby={
        validationMessage || errorText
          ? generateAriaDescribedBy(props.id || "input")
          : undefined
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

  const validationMessage = (props as any).validationMessage || props.errorText

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
      aria-invalid={!!validationMessage}
      aria-describedby={
        validationMessage
          ? generateAriaDescribedBy(props.id || "textarea", "error")
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
    placeholder = UI_CSS.SELECT_DEFAULTS.PLACEHOLDER,
    disabled = false,
    ariaLabel,
    ariaDescribedBy,
    style,
    coerce,
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
        const selected = Array.from(evt.target.selectedOptions).map((o) => {
          const raw = o.value
          if (coerce === "number") return Number(raw)
          if (coerce === "string") return String(raw)
          return typeof first === "number" && !isNaN(Number(raw))
            ? Number(raw)
            : raw
        })
        handleValueChange(selected as any)
        onChange?.(selected as any)
      } else {
        const rawValue = evt.target.value
        const finalValue = coerce
          ? coerce === "number"
            ? Number(rawValue)
            : String(rawValue)
          : typeof controlled === "number" && !isNaN(Number(rawValue))
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

  const resolvedAriaDescribedBy = generateAriaDescribedBy(ariaDescribedBy)

  return isMulti ? (
    <select
      multiple
      value={normalizedValue as string[]}
      onChange={handleChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={resolvedAriaDescribedBy}
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
      aria-describedby={resolvedAriaDescribedBy}
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
  iconPosition = UI_CSS.BTN_DEFAULTS.ICON_POSITION,
  alignText = "end",
  tooltip,
  tooltipDisabled = false,
  tooltipPlacement = UI_CSS.BTN_DEFAULTS.TOOLTIP_PLACEMENT,
  tooltipEnterDelay,
  tooltipEnterNextDelay,
  tooltipLeaveDelay,
  loading = false,
  onClick,
  children,
  block = UI_CSS.BTN_DEFAULTS.BLOCK,
  preset,
  ...jimuProps
}) => {
  const handleClick = hooks.useEventCallback(() => {
    if (jimuProps.disabled || loading || !onClick) return
    if (jimuProps.logging?.enabled) {
      try {
        // Lightweight client-side logging hook
        console.debug(`[${jimuProps.logging.prefix || "Button"}] clicked`, {
          id: jimuProps.id,
          text: typeof text === "string" ? text : undefined,
        })
      } catch {
        // no-op
      }
    }
    onClick()
  })

  const buttonStyle = mergeButtonStyles(
    UI_CSS.STYLES.BUTTON_RELATIVE,
    jimuProps.style
  )
  const ariaLabel = getButtonAriaLabel(
    text,
    !!icon,
    jimuProps["aria-label"],
    tooltip
  )

  const buttonElement = (
    <JimuButton
      {...jimuProps}
      {...(preset === "primary"
        ? { color: "primary", variant: "contained" }
        : preset === "secondary"
          ? { color: "default", variant: "outlined" }
          : {})}
      icon={!text && !!icon}
      onClick={handleClick}
      disabled={jimuProps.disabled || loading}
      aria-busy={loading}
      aria-live={loading ? "polite" : undefined}
      aria-label={ariaLabel}
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
    <Tooltip
      content={tooltip}
      placement={tooltipPlacement}
      enterDelay={tooltipEnterDelay}
      enterNextDelay={tooltipEnterNextDelay}
      leaveDelay={tooltipLeaveDelay}
    >
      {buttonElement}
    </Tooltip>
  ) : (
    buttonElement
  )
}

// Helper functions for StateView component
const renderLoadingState = (
  state: Extract<UiViewState, { kind: "loading" }>
) => (
  <div style={STYLES.state.centered} role="status" aria-live="polite">
    <Loading type={LoadingType.Donut} width={200} height={200} />
    {(state.message || state.detail) && (
      <div style={STYLES.state.text} aria-label="Loading details">
        {state.message && <div>{state.message}</div>}
      </div>
    )}
  </div>
)

const renderErrorState = (
  state: Extract<UiViewState, { kind: "error" }>,
  Actions: React.ComponentType<{
    actions?: readonly UiAction[]
    ariaLabel: string
  }>
) => (
  <div role="alert" aria-live="assertive">
    <div style={STYLES.typography.title}>{state.message}</div>
    {state.code && (
      <div style={STYLES.typography.caption}>Code: {state.code}</div>
    )}
    <Actions actions={state.actions} ariaLabel="Error actions" />
  </div>
)

const renderEmptyState = (
  state: Extract<UiViewState, { kind: "empty" }>,
  Actions: React.ComponentType<{
    actions?: readonly UiAction[]
    ariaLabel: string
  }>
) => (
  <div role="status" aria-live="polite">
    <div>{state.message}</div>
    <Actions actions={state.actions} ariaLabel="Empty actions" />
  </div>
)

const renderSuccessState = (
  state: Extract<UiViewState, { kind: "success" }>,
  Actions: React.ComponentType<{
    actions?: readonly UiAction[]
    ariaLabel: string
  }>
) => (
  <div role="status" aria-live="polite">
    {state.title && <div style={STYLES.typography.title}>{state.title}</div>}
    {state.message && (
      <div style={STYLES.typography.caption}>{state.message}</div>
    )}
    <Actions actions={state.actions} ariaLabel="Success actions" />
  </div>
)

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
      return renderLoadingState(state)
    case "error":
      return renderErrorState(state, Actions)
    case "empty":
      return renderEmptyState(state, Actions)
    case "success":
      return renderSuccessState(state, Actions)
    case "content":
      return <>{state.node}</>
  }
})

// Tabs component
export const Tabs: React.FC<TabsProps> = ({
  items,
  value: controlled,
  defaultValue,
  onChange,
  onTabChange,
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
    const previous = value
    handleValueChange(newValue)
    onChange?.(newValue)
    onTabChange?.(newValue, previous)
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

// Standalone Field component (for reuse outside of Form)
export const Field: React.FC<FieldProps> = ({
  className,
  style,
  label,
  helper,
  required = false,
  readOnly = false,
  error,
  children,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
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

export { Button as default, StateView }

export type {
  ButtonProps,
  ButtonGroupProps,
  CustomTooltipProps,
  FormProps,
  FieldProps,
  GroupButtonConfig,
  InputProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
  TabsProps,
  TabItem,
}
