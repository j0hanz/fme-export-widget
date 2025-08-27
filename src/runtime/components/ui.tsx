/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, css, jsx } from "jimu-core"
import {
  TextInput,
  Tooltip as JimuTooltip,
  Button as JimuButton,
  AdvancedButtonGroup,
  Select as JimuSelect,
  Option as JimuOption,
  MultiSelect,
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
  ViewAction,
  BtnContentProps,
  IconProps,
  StateViewProps,
} from "../../shared/types"

// Consolidated UI constants and styles
export const config = {
  icon: { small: 14, medium: 16, large: 18 },
  tooltip: {
    delay: { enter: 1000, next: 500, leave: 100, touch: 500 },
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
      iconPosition: "right" as const,
      tooltipPosition: "top" as const,
    },
    offset: "10px",
    textPadding: "18px",
  },
  zIndex: { selectMenu: 1005, overlay: 1000 },
  loading: { width: 200, height: 200 },
  required: "*",
} as const

// Centralized styles using emotion CSS
export const styles = {
  // Layout utilities
  row: css({ display: "flex" }),
  col: css({ display: "flex", flexDirection: "column" }),
  flex1: css({ flex: 1 }),
  fullWidth: css({ width: "100%" }),
  relative: css({ position: "relative" }),
  block: css({ display: "block" }),

  // Spacing utilities
  gapSmall: css({ gap: "0.5rem" }),
  gapMedium: css({ gap: "1rem" }),
  gapLarge: css({ gap: "2rem" }),
  paddingSmall: css({ padding: "0.5rem" }),

  // Text utilities
  textCenter: css({ textAlign: "center" }),
  textEnd: css({ textAlign: "end" }),

  // Interactive utilities
  disabledCursor: css({ display: "contents", cursor: "not-allowed" }),
  textareaResize: css({ resize: "vertical" }),

  // Common flex patterns
  flexCentered: css({
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  }),

  flexBetween: css({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  }),

  // Layout patterns
  parent: css({
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    height: "100%",
    position: "relative",
    padding: "0.4rem",
  }),

  header: css({
    display: "flex",
    justifyContent: "end",
    flexShrink: 0,
  }),

  content: css({
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flex: "1 1 auto",
  }),

  headerRow: css({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "0.5rem",
  }),

  // State patterns
  centered: css({
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "0.5rem",
    height: "100%",
  }),

  overlay: css({
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    textAlign: "center",
    zIndex: config.zIndex.overlay,
  }),

  // Typography styles
  typography: {
    caption: css({
      fontSize: "0.8125rem",
      margin: "0.5rem 0",
    }),

    label: css({
      display: "block",
      fontSize: "0.8125rem",
      marginBottom: 0,
    }),

    title: css({
      fontSize: "1rem",
      fontWeight: 500,
    }),

    instruction: css({
      fontSize: "0.8125rem",
      margin: "1rem 0",
      textAlign: "center",
    }),

    link: css({
      fontSize: "0.875rem",
      fontWeight: 500,
      textDecoration: "underline",
      wordBreak: "break-all",
    }),

    required: css({
      marginLeft: "0.25rem",
    }),
  },

  // Button patterns
  button: {
    group: css({
      display: "flex",
      gap: "0.5rem",
    }),

    default: css({
      display: "flex",
      flexFlow: "column",
      width: "100%",
      gap: "1rem",
    }),

    text: css({
      flex: 1,
      textAlign: "end",
    }),

    icon: css({
      position: "absolute",
      zIndex: 1,
      top: "50%",
      transform: "translateY(-50%)",
    }),
  },
} as const

// Utility Hooks and Helper Functions
let idSeq = 0

const utils = {
  // ID generation utility
  useId: (prefix = "fme"): string => {
    const idRef = React.useRef<string>()
    if (!idRef.current) {
      idSeq += 1
      idRef.current = `${prefix}-${idSeq}`
    }
    return idRef.current
  },

  // Controlled/uncontrolled value helper
  useValue: (
    controlled?: any,
    defaultValue?: any,
    onChange?: (value: any) => void
  ) => {
    const [value, setValue] = hooks.useControlled({
      controlled,
      default: defaultValue,
    })

    const handleChange = hooks.useEventCallback((newValue: any) => {
      setValue(newValue)
      onChange?.(newValue)
    })

    return [value, handleChange] as const
  },

  // Accessibility helpers
  ariaDesc: (id?: string, suffix = "error"): string | undefined =>
    id ? `${id}-${suffix}` : undefined,

  getBtnAria: (
    text?: React.ReactNode,
    icon?: string | boolean,
    jimuAriaLabel?: string,
    tooltip?: string,
    fallbackLabel?: string
  ): string | undefined => {
    if (text || !icon) return jimuAriaLabel
    return (typeof tooltip === "string" && tooltip) || fallbackLabel
  },

  // Form control ID management
  withId: (
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
  },

  // Tooltip content resolution
  getTipContent: (
    title?: React.ReactNode,
    content?: React.ReactNode,
    children?: React.ReactElement
  ): React.ReactNode => {
    if (title || content) return title || content
    if (React.isValidElement(children)) {
      const props = children.props as { [key: string]: unknown }
      return (
        (props?.title as React.ReactNode) ||
        (props?.["aria-label"] as React.ReactNode)
      )
    }
    return undefined
  },
} as const

// Export individual utilities for backward compatibility
const { useId, useValue, ariaDesc, getBtnAria, withId, getTipContent } = utils

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
    <span
      css={[styles.button.icon, css({ [iconPosition]: config.button.offset })]}
      aria-hidden="true"
    >
      {iconEl}
    </span>
  )

  return (
    <>
      {iconPosition === "left" && iconWithPosition}
      <div
        css={[
          styles.button.text,
          css({
            textAlign: alignText as any,
            paddingLeft:
              iconPosition === "left" ? config.button.textPadding : undefined,
            paddingRight:
              iconPosition === "right" ? config.button.textPadding : undefined,
          }),
        ]}
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
  size = config.icon.medium,
  className,
  ariaLabel,
  style,
}) => {
  return (
    <SVG
      src={src}
      size={size}
      className={className}
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
  showArrow = config.tooltip.showArrow,
  placement = config.tooltip.position.top,
  enterDelay = config.tooltip.delay.enter,
  enterNextDelay = config.tooltip.delay.next,
  enterTouchDelay = config.tooltip.delay.touch,
  leaveDelay = config.tooltip.delay.leave,
  disabled = false,
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
    <span css={styles.disabledCursor} aria-disabled="true">
      {cloned}
    </span>
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
      css={styles.fullWidth}
      style={(props as any).style}
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
      css={styles.textareaResize}
      style={props.style}
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

  const isMulti = Array.isArray(controlled)
  const [value, setValue] = useValue(controlled, defaultValue)
  const translate = hooks.useTranslation(defaultMessages)
  const coerceValue = hooks.useEventCallback(
    (raw: string | number | undefined) => {
      if (raw === undefined || raw === null) return raw
      if (coerce === "number") return Number(raw)
      if (coerce === "string") return String(raw)
      const sample = Array.isArray(controlled) ? controlled[0] : controlled
      if (typeof sample === "number") {
        const n = Number(raw)
        return isNaN(n) ? raw : n
      }
      return raw
    }
  )

  const handleSingleChange = hooks.useEventCallback(
    (evt: unknown, selectedValue?: string | number) => {
      const raw =
        selectedValue !== undefined
          ? selectedValue
          : (evt as any)?.target?.value
      const finalVal = coerceValue(raw)
      setValue(finalVal)
      onChange?.(finalVal)
    }
  )

  const handleMultiChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLSelectElement>) => {
      const target = evt?.target
      if (!target?.selectedOptions) return
      const selected: any[] = []
      for (const option of Array.from(target.selectedOptions)) {
        selected.push(coerceValue(option.value))
      }
      setValue(selected as any)
      onChange?.(selected as any)
    }
  )

  // Normalize the value to strings for the underlying select component(s).
  const normalizedValue: any = isMulti
    ? Array.isArray(value)
      ? value.map((v) => String(v))
      : []
    : value !== undefined
      ? String(value)
      : undefined

  const resolvedPlaceholder =
    placeholder ?? translate("placeholderSelectGeneric")

  if (isMulti) {
    const Multi: any = (MultiSelect as any) || null
    if (Multi) {
      const items = options.map((opt) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled,
      }))
      // Wrap in a styled container to ensure width/inline styles are reflected in the DOM
      return (
        <div style={style}>
          <Multi
            items={items}
            values={normalizedValue}
            onChange={(vals: any[]) => {
              const coerced = vals.map((v) => coerceValue(v))
              setValue(coerced as any)
              onChange?.(coerced as any)
            }}
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
          />
        </div>
      )
    }
    // Fallback native multi select
    return (
      <select
        multiple
        value={normalizedValue as string[]}
        onChange={handleMultiChange}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        style={style}
      >
        {options.map((opt) => (
          <option
            key={String(opt.value)}
            value={String(opt.value)}
            disabled={opt.disabled}
            aria-label={opt.label}
          >
            {!opt.hideLabel && opt.label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <JimuSelect
      value={normalizedValue}
      onChange={handleSingleChange}
      disabled={disabled}
      placeholder={resolvedPlaceholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      zIndex={config.zIndex.selectMenu}
      style={style}
    >
      {options.map((option) => (
        <JimuOption
          key={String(option.value)}
          value={option.value}
          active={String(option.value) === String(normalizedValue)}
          disabled={option.disabled}
          onClick={() => {
            if (!option.disabled) {
              const isSame =
                String(option.value) === String(normalizedValue ?? "")
              if (!isSame) {
                handleSingleChange(undefined as any, option.value)
              }
            }
          }}
        >
          {!option.hideLabel && option.label}
        </JimuOption>
      ))}
    </JimuSelect>
  )
}

// Button component
export const Button: React.FC<ButtonProps> = ({
  text,
  icon,
  iconPosition = config.button.defaults.iconPosition,
  alignText = "start",
  tooltip,
  tooltipDisabled = false,
  tooltipPlacement = config.button.defaults.tooltipPosition,
  tooltipEnterDelay,
  tooltipEnterNextDelay,
  tooltipLeaveDelay,
  loading = false,
  onClick,
  children,
  block = config.button.defaults.block,
  preset,
  size = "default",
  variant = "contained",
  color = "inherit",
  htmlType = "button",
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

  const ariaLabel = getBtnAria(
    text,
    !!icon,
    jimuProps["aria-label"],
    tooltip,
    translate("ariaButtonLabel")
  )

  const presetProps =
    preset === "primary"
      ? { color: "primary" as const, variant: "contained" as const }
      : preset === "secondary"
        ? { color: "default" as const, variant: "outlined" as const }
        : {
            color:
              color === "tertiary" || color === "danger"
                ? ("default" as const)
                : color,
            variant,
          }

  const buttonElement = (
    <JimuButton
      {...jimuProps}
      {...presetProps}
      size={size}
      htmlType={htmlType}
      icon={!text && !!icon}
      onClick={handleClick}
      disabled={jimuProps.disabled || loading}
      aria-busy={loading}
      aria-live={loading ? "polite" : undefined}
      aria-label={ariaLabel}
      title={
        tooltip ? undefined : typeof text === "string" ? text : jimuProps.title
      }
      css={styles.relative}
      style={{ position: "relative", ...(jimuProps.style as any) }}
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
      aria-label={ariaLabel}
      css={[styles.row, styles.gapLarge]}
      style={style}
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
            block={true}
          />
        )
      })}
    </AdvancedButtonGroup>
  )
}

// StateView component
const StateView: React.FC<StateViewProps> = ({
  state,
  className,
  style,
  renderActions,
  testId,
  center,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const DefaultActions = hooks.useEventCallback(
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

  const Actions = renderActions
    ? ({
        actions,
        ariaLabel,
      }: {
        actions?: readonly ViewAction[]
        ariaLabel: string
      }) => renderActions(actions, ariaLabel)
    : DefaultActions

  const content = (() => {
    switch (state.kind) {
      case "loading":
        return (
          <div css={styles.centered} role="status" aria-live="polite">
            <Loading
              type={LoadingType.Donut}
              width={config.loading.width}
              height={config.loading.height}
            />
            {(state.message || state.detail) && (
              <div
                css={styles.overlay}
                aria-label={translate("ariaLoadingDetails")}
              >
                {state.message && <div>{state.message}</div>}
              </div>
            )}
          </div>
        )
      case "error":
        return (
          <div role="alert" aria-live="assertive">
            <div css={styles.typography.title}>{state.message}</div>
            {state.code && (
              <div css={styles.typography.caption}>
                {translate("errorCode")}: {state.code}
              </div>
            )}
            <Actions
              actions={state.actions}
              ariaLabel={translate("ariaErrorActions")}
            />
          </div>
        )
      case "empty":
        return (
          <div role="status" aria-live="polite">
            <div>{state.message}</div>
            <Actions
              actions={state.actions}
              ariaLabel={translate("ariaEmptyActions")}
            />
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
            <Actions
              actions={state.actions}
              ariaLabel={translate("ariaSuccessActions")}
            />
          </div>
        )
      case "content":
        return <>{state.node}</>
    }
  })()

  const shouldCenter =
    typeof center === "boolean" ? center : state.kind === "loading"

  return (
    <div
      className={className}
      style={style}
      data-testid={testId}
      css={shouldCenter ? styles.centered : undefined}
    >
      {content}
    </div>
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

  const groupStyle: React.CSSProperties = style ? { ...style } : undefined

  const createButton = (
    buttonConfig: GroupButtonConfig,
    side: "left" | "right"
  ) => {
    const btnConfig = {
      ...buttonConfig,
      variant:
        buttonConfig.variant || (side === "left" ? "outlined" : "contained"),
      color: buttonConfig.color || (side === "left" ? "default" : "primary"),
      key: side,
    }
    return <Button {...btnConfig} block={false} css={styles.flex1} />
  }

  return (
    <div css={styles.button.group} className={className} style={groupStyle}>
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
        {/* Header */}
        <div>
          {title && <div css={styles.typography.title}>{title}</div>}
          {subtitle && <div css={styles.typography.caption}>{subtitle}</div>}
        </div>
        {/* Form contents */}
        {children}
        {/* Action buttons */}
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
        css={[styles.block, styles.typography.label]}
        check={false}
        for={fieldId}
      >
        {label}
        {required && (
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
        )}
      </Label>
      {!readOnly && renderedChild}
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
