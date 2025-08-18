import { React, hooks } from "jimu-core"
import {
  TextInput,
  Tooltip as JimuTooltip,
  Message as JimuMessage,
  Button as JimuButton,
  AdvancedButtonGroup,
  Select as JimuSelect,
  SVG,
  FormGroup,
  Label,
  TextArea as JimuTextArea,
  Loading,
  LoadingType,
  Checkbox as JimuCheckbox,
} from "jimu-ui"
import defaultMessages from "./translations/default"
import type {
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
  ViewState,
  ViewAction,
  BtnContentProps,
  IconProps,
  MessageProps,
} from "../../shared/types"

// UI style constants
export const UI_CSS = (() => {
  const ICON = {
    SIZE: {
      S: 15,
      M: 16,
      L: 17,
    },
  } as const
  const BTN_LAYOUT = {
    GROUP: {
      display: "flex" as const,
      gap: "0.5rem",
    } as React.CSSProperties,
    DEFAULT: {
      display: "flex",
      flexFlow: "column",
      width: "100%",
      gap: "0.5rem",
    } as React.CSSProperties,
    TEXT: {
      flex: 1,
      textAlign: "end",
    } as React.CSSProperties,
    ICON: {
      position: "absolute" as const,
      zIndex: 1 as const,
      top: "50%",
      transform: "translateY(-50%)",
    } as React.CSSProperties,
  } as const
  const BTN_DEFAULTS = {
    BLOCK: true,
    ICON_POS: "left" as const,
    TIP_POS: "top" as const,
  } as const
  const BTN = {
    ...BTN_LAYOUT,
    DEFAULTS: BTN_DEFAULTS,
    OFFSET: "10px",
    TEXT_PAD_LEFT: "18px",
    TEXT_PAD_RIGHT: "18px",
  } as const
  const TIP = {
    DELAY: {
      IN: 1000,
      NEXT: 500,
      OUT: 100,
      TOUCH: 500,
    },
    POS: {
      TOP: "top" as const,
      BOTTOM: "bottom" as const,
      LEFT: "left" as const,
      RIGHT: "right" as const,
    },
    SHOW_ARROW: true,
    DISABLED: false,
  } as const
  const CSS = {
    BTN_REL: { position: "relative" as const },
    TEXTAREA_RESIZE: { resize: "vertical" as const },
    DISABLED_CURSOR: {
      display: "contents" as const,
      cursor: "not-allowed" as const,
    },
    LABEL: { display: "block" as const },
  } as const
  const STATE = {
    CENTERED: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: "0.5rem",
      height: "100%",
    } as React.CSSProperties,
    TEXT: {
      position: "absolute" as const,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      textAlign: "center" as const,
      zIndex: 1000,
    } as React.CSSProperties,
  } as const
  const TYPOGRAPHY = {
    CAPTION: {
      fontSize: "0.8125rem",
      margin: "0.5rem 0",
    } as React.CSSProperties,
    LABEL: {
      display: "block",
      fontSize: "0.8125rem",
      marginBottom: 0,
    } as React.CSSProperties,
    REQUIRED: {
      marginLeft: "0.25rem",
    } as React.CSSProperties,
    TITLE: {
      fontSize: "1rem",
      fontWeight: 500,
    } as React.CSSProperties,
  } as const
  const A11Y = {
    REQUIRED: "*",
  } as const
  return {
    ICON,
    BTN,
    TIP,
    CSS,
    STATE,
    TYPOGRAPHY,
    A11Y,
  } as const
})()

// Utility Hooks / Helpers
let idSeq = 0
const useId = (prefix = "fme"): string => {
  const idRef = React.useRef<string>()
  if (!idRef.current) {
    idSeq += 1
    idRef.current = `${prefix}-${Date.now().toString(36)}-${idSeq}`
  }
  return idRef.current
}

const useValue = <T = string,>(
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

// Helper function to prepare control with ID
const withId = (
  child: React.ReactNode,
  readOnly: boolean,
  fallbackId: string
): { id: string | undefined; child: React.ReactNode } => {
  if (!readOnly && React.isValidElement(child)) {
    const childProps = (child.props || {}) as { [key: string]: any }
    const id = childProps.id || fallbackId
    if (!childProps.id) {
      const cloned = React.cloneElement(child as React.ReactElement, {
        id,
      })
      return { id, child: cloned }
    }
    return { id, child }
  }
  return { id: undefined, child }
}

// Helper functions for accessibility
const ariaDesc = (id?: string, suffix = "error"): string | undefined => {
  return id ? `${id}-${suffix}` : undefined
}

const getBtnAria = (
  text?: React.ReactNode,
  icon?: string | boolean,
  jimuAriaLabel?: string,
  tooltip?: string,
  fallbackLabel?: string
): string | undefined => {
  if (text || !icon) return jimuAriaLabel
  return (typeof tooltip === "string" && tooltip) || fallbackLabel
}

// Helper for tooltip content resolution
const getTipContent = (
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

// Button content component extracted from Button
const BtnContent: React.FC<BtnContentProps> = ({
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
      <Icon src={icon} size={UI_CSS.ICON.SIZE.L} />
    ) : (
      (icon as React.ReactElement)
    )
  if (hasText && !hasIcon) return <>{text}</>

  const iconEl =
    typeof icon === "string" ? (
      <Icon src={icon} size={UI_CSS.ICON.SIZE.S} />
    ) : (
      (icon as React.ReactElement)
    )
  const iconWithPosition = React.cloneElement(iconEl, {
    style: {
      ...UI_CSS.BTN.ICON,
      [iconPosition]: UI_CSS.BTN.OFFSET,
    },
  })

  return (
    <>
      {iconPosition === "left" && iconWithPosition}
      <div
        style={{
          ...UI_CSS.BTN.TEXT,
          textAlign: alignText,
          paddingLeft:
            iconPosition === "left" ? UI_CSS.BTN.TEXT_PAD_LEFT : undefined,
          paddingRight:
            iconPosition === "right" ? UI_CSS.BTN.TEXT_PAD_RIGHT : undefined,
        }}
      >
        {text}
      </div>
      {iconPosition === "right" && iconWithPosition}
    </>
  )
}

// Icon component
export const Icon: React.FC<IconProps> = ({
  src,
  size = UI_CSS.ICON.SIZE.M,
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
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  showArrow = UI_CSS.TIP.SHOW_ARROW,
  placement = UI_CSS.TIP.POS.TOP,
  enterDelay = UI_CSS.TIP.DELAY.IN,
  enterNextDelay = UI_CSS.TIP.DELAY.NEXT,
  enterTouchDelay = UI_CSS.TIP.DELAY.TOUCH,
  leaveDelay = UI_CSS.TIP.DELAY.OUT,
  disabled = UI_CSS.TIP.DISABLED,
  title,
  ...otherProps
}) => {
  const autoId = useId("tooltip")
  // Ensure children is a valid React element
  if (!React.isValidElement(children)) return <>{children}</>

  const tooltipContent = getTipContent(title, content, children)
  if (!tooltipContent || disabled) return children

  const tooltipId = otherProps.id || autoId

  const isDisabled =
    (children.props as any)?.disabled ||
    (children.props as any)?.["aria-disabled"]
  const baseChildProps = (children.props || {}) as { [key: string]: any }
  // Omit title to avoid conflicts with tooltip
  const { title: _omitTitle, ...safeChildProps } = baseChildProps
  const cloned = React.cloneElement(children as any, {
    ...safeChildProps,
    "aria-describedby": tooltipId,
  })
  const child = isDisabled ? (
    <span style={UI_CSS.CSS.DISABLED_CURSOR}>{cloned}</span>
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
export const Message: React.FC<MessageProps> = ({
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
}) => {
  // Check if JimuMessage is available
  const hasJimuMessage = typeof (JimuMessage as any) === "function"
  const isProd =
    (typeof process !== "undefined" && process?.env?.NODE_ENV) === "production"

  // Fallback rendering if JimuMessage is not available or in production
  if (!hasJimuMessage || isProd) {
    return (
      <div role={role} aria-live={ariaLive} className={className} style={style}>
        {/* Fallback message rendering */}
        <div>
          {withIcon ? "" : null}
          {String(message)}
        </div>
      </div>
    )
  }

  return (
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
}

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
          ? ariaDesc(props.id || "input")
          : undefined
      }
      style={{ width: "100%", ...(props as any).style }}
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
  const [value, handleValueChange] = useValue(controlled, defaultValue || "")

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
        ...UI_CSS.CSS.TEXTAREA_RESIZE,
        ...props.style,
      }}
      aria-required={props.required}
      aria-invalid={!!validationMessage}
      aria-describedby={
        validationMessage
          ? ariaDesc(props.id || "textarea", "error")
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
    placeholder,
    disabled = false,
    ariaLabel,
    ariaDescribedBy,
    style,
    coerce,
  } = props
  const translate = hooks.useTranslation(defaultMessages)
  const isMulti = Array.isArray(controlled)
  const [value, handleValueChange] = useValue(controlled, defaultValue)

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

  const renderOption = (option: OptionItem) => (
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

  const resolvedAriaDescribedBy = ariaDesc(ariaDescribedBy)
  const resolvedPlaceholder =
    placeholder ?? translate("placeholderSelectGeneric")

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
      placeholder={resolvedPlaceholder}
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
  iconPosition = UI_CSS.BTN.DEFAULTS.ICON_POS,
  alignText = "end",
  tooltip,
  tooltipDisabled = false,
  tooltipPlacement = UI_CSS.BTN.DEFAULTS.TIP_POS,
  tooltipEnterDelay,
  tooltipEnterNextDelay,
  tooltipLeaveDelay,
  loading = false,
  onClick,
  children,
  block = UI_CSS.BTN.DEFAULTS.BLOCK,
  preset,
  ...jimuProps
}) => {
  const translate = hooks.useTranslation(defaultMessages)
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

  const buttonStyle = jimuProps.style
    ? { ...UI_CSS.CSS.BTN_REL, ...jimuProps.style }
    : UI_CSS.CSS.BTN_REL
  const ariaLabel = getBtnAria(
    text,
    !!icon,
    jimuProps["aria-label"],
    tooltip,
    translate("ariaButtonLabel")
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
      <BtnContent
        loading={loading}
        text={text}
        icon={icon}
        iconPosition={iconPosition}
        alignText={alignText}
      >
        {children}
      </BtnContent>
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

// ButtonTabs component
export const ButtonTabs: React.FC<ButtonTabsProps> = ({
  items,
  value: controlled,
  defaultValue,
  onChange,
  onTabChange,
  ariaLabel,
  style,
}) => {
  const [value, handleValueChange] = useValue(
    controlled,
    defaultValue || items[0]?.value
  )

  const handleChange = hooks.useEventCallback((newValue: string | number) => {
    const final = typeof controlled === "number" ? Number(newValue) : newValue
    const previous = value
    handleValueChange(final as any)
    onChange?.(final as any)
    onTabChange?.(final as any, previous)
  })

  return (
    <AdvancedButtonGroup
      role="radiogroup"
      gap="1rem"
      aria-label={ariaLabel}
      style={{ ...style, gap: "0.5rem", display: "flex" }}
      variant="contained"
    >
      {items.map((item) => {
        const active = value === item.value
        return (
          <Button
            key={String(item.value)}
            icon={item.icon}
            text={!item.hideLabel ? item.label : undefined}
            active={active}
            aria-label={item.label}
            role="radio"
            aria-checked={active}
            tooltip={item.tooltip}
            tooltipPlacement="top"
            disabled={item.disabled}
            onClick={() => handleChange(item.value)}
            block={false}
          />
        )
      })}
    </AdvancedButtonGroup>
  )
}

// Helper functions for StateView component
const renderLoading = (
  state: Extract<ViewState, { kind: "loading" }>,
  ariaDetailsLabel: string
) => (
  <div style={UI_CSS.STATE.CENTERED} role="status" aria-live="polite">
    <Loading type={LoadingType.Donut} width={200} height={200} />
    {(state.message || state.detail) && (
      <div style={UI_CSS.STATE.TEXT} aria-label={ariaDetailsLabel}>
        {state.message && <div>{state.message}</div>}
      </div>
    )}
  </div>
)

const renderError = (
  state: Extract<ViewState, { kind: "error" }>,
  Actions: React.ComponentType<{
    actions?: readonly ViewAction[]
    ariaLabel: string
  }>,
  codeLabel: string,
  actionsAriaLabel: string
) => (
  <div role="alert" aria-live="assertive">
    <div style={UI_CSS.TYPOGRAPHY.TITLE}>{state.message}</div>
    {state.code && (
      <div style={UI_CSS.TYPOGRAPHY.CAPTION}>
        {codeLabel}: {state.code}
      </div>
    )}
    <Actions actions={state.actions} ariaLabel={actionsAriaLabel} />
  </div>
)

const renderEmpty = (
  state: Extract<ViewState, { kind: "empty" }>,
  Actions: React.ComponentType<{
    actions?: readonly ViewAction[]
    ariaLabel: string
  }>,
  actionsAriaLabel: string
) => (
  <div role="status" aria-live="polite">
    <div>{state.message}</div>
    <Actions actions={state.actions} ariaLabel={actionsAriaLabel} />
  </div>
)

const renderSuccess = (
  state: Extract<ViewState, { kind: "success" }>,
  Actions: React.ComponentType<{
    actions?: readonly ViewAction[]
    ariaLabel: string
  }>,
  actionsAriaLabel: string
) => (
  <div role="status" aria-live="polite">
    {state.title && <div style={UI_CSS.TYPOGRAPHY.TITLE}>{state.title}</div>}
    {state.message && (
      <div style={UI_CSS.TYPOGRAPHY.CAPTION}>{state.message}</div>
    )}
    <Actions actions={state.actions} ariaLabel={actionsAriaLabel} />
  </div>
)

// StateView component
const StateView: React.FC<{ state: ViewState }> = React.memo(({ state }) => {
  const translate = hooks.useTranslation(defaultMessages)
  const Actions = hooks.useEventCallback(
    ({
      actions,
      ariaLabel,
    }: {
      actions?: readonly ViewAction[]
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
      return renderLoading(state, translate("ariaLoadingDetails"))
    case "error":
      return renderError(
        state,
        Actions,
        translate("errorCode"),
        translate("ariaErrorActions")
      )
    case "empty":
      return renderEmpty(state, Actions, translate("ariaEmptyActions"))
    case "success":
      return renderSuccess(state, Actions, translate("ariaSuccessActions"))
    case "content":
      return <>{state.node}</>
  }
})

// Tabs component removed per request

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
  // Generate a stable auto ID for field elements
  const fieldAutoId = useId("field")

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
          <div style={UI_CSS.TYPOGRAPHY.TITLE}>{title}</div>
          <div style={UI_CSS.TYPOGRAPHY.CAPTION}>{subtitle}</div>
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

    const { id: fieldId, child: renderedChild } = withId(
      children,
      readOnly,
      fieldAutoId
    )

    return (
      <FormGroup className={className} style={style}>
        <Label
          style={{ ...UI_CSS.CSS.LABEL, ...UI_CSS.TYPOGRAPHY.LABEL }}
          check={false}
          for={fieldId}
        >
          {label}
          {required && (
            <Tooltip content={translate("requiredField")} placement="bottom">
              <span
                style={UI_CSS.TYPOGRAPHY.REQUIRED}
                aria-label={translate("ariaRequired")}
                role="img"
                aria-hidden="false"
              >
                {UI_CSS.A11Y.REQUIRED}
              </span>
            </Tooltip>
          )}
        </Label>
        {!readOnly && renderedChild}
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
  const autoId = useId("field")
  const { id: fieldId, child: renderedChild } = withId(
    children,
    readOnly,
    autoId
  )
  return (
    <FormGroup className={className} style={style}>
      <Label
        style={{ ...UI_CSS.CSS.LABEL, ...UI_CSS.TYPOGRAPHY.LABEL }}
        check={false}
        for={fieldId}
      >
        {label}
        {required && (
          <Tooltip content={translate("requiredField")} placement="bottom">
            <span
              style={UI_CSS.TYPOGRAPHY.REQUIRED}
              aria-label={translate("ariaRequired")}
              role="img"
              aria-hidden="false"
            >
              {UI_CSS.A11Y.REQUIRED}
            </span>
          </Tooltip>
        )}
      </Label>
      {!readOnly && renderedChild}
      {helper && !error && <>{helper}</>}
      {error && <div className="d-block">{error}</div>}
    </FormGroup>
  )
}

export { Button as default, StateView }

export type {
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
