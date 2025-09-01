/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, css, jsx, type IMThemeVariables } from "jimu-core"
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
import { useTheme } from "jimu-theme"
import defaultMessages from "./translations/default"
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
  IconProps,
  StateViewProps,
} from "../../shared/types"

type TranslateFn = (key: string, params?: any) => string

// Email placeholder pattern for support links
const EMAIL_PLACEHOLDER = /\{\s*email\s*\}/i

// Configuration
export const config = {
  icon: { small: 14, medium: 16, large: 20 },
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

// Create theme-aware styles
const createStyles = (theme: IMThemeVariables) =>
  ({
    // Layout utilities
    row: css({ display: "flex" }),
    col: css({ display: "flex", flexDirection: "column" }),
    flex1: css({ flex: 1 }),
    fullWidth: css({ width: "100%" }),
    relative: css({ position: "relative" }),
    block: css({ display: "block" }),
    marginTop: (value: number) => css({ marginTop: value }),
    gapBtnGroup: css({ gap: theme.sys.spacing?.(2) }),

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

    parent: css({
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
      height: "100%",
      position: "relative",
      padding: theme.sys.spacing?.(1),
      backgroundColor: theme.sys.color.surface?.paper,
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
      gap: theme.sys.spacing?.(1),
    }),

    // State patterns
    centered: css({
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: theme.sys.spacing?.(1),
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

    // Typography styles with theme support
    typography: {
      caption: css({
        fontSize: theme?.sys?.typography?.label2?.fontSize,
        color: theme.sys.color.surface?.backgroundText,
        margin: `${theme.sys.spacing?.(1)} 0`,
      }),

      label: css({
        display: "block",
        fontSize: theme?.sys?.typography?.label2?.fontSize,
        color: theme.sys.color.surface?.backgroundText,
        marginBottom: 0,
      }),

      title: css({
        fontSize: theme?.sys?.typography?.body1?.fontSize,
        fontWeight: theme?.sys?.typography?.body1?.fontWeight,
        color: theme.sys.color.surface?.backgroundText,
      }),

      instruction: css({
        fontSize: theme?.sys?.typography?.label2?.fontSize,
        color: theme.sys.color.surface?.backgroundText,
        margin: `${theme.sys.spacing?.(3)} 0`,
        textAlign: "center",
      }),

      link: css({
        fontSize: theme?.sys?.typography?.body1?.fontSize,
        fontWeight: theme?.sys?.typography?.body1?.fontWeight,
        color: theme.sys.color.action.link?.default,
        textDecoration: "underline",
        wordBreak: "break-all",
        "&:hover": {
          color: theme.sys.color.action.link?.hover,
          textDecoration: "underline",
        },
      }),

      required: css({
        marginLeft: "0.25rem",
        color: theme.sys.color?.error.main,
      }),
    },

    // Button patterns with theme support
    button: {
      group: css({
        display: "flex",
        gap: theme.sys.spacing?.(1),
      }),

      default: css({
        display: "flex",
        flexFlow: "column",
        width: "100%",
        gap: theme.sys.spacing?.(1),
      }),

      text: css({
        flex: 1,
      }),

      icon: css({
        position: "absolute",
        zIndex: 1,
        top: "50%",
        transform: "translateY(-50%)",
      }),
    },
  }) as const

// Export theme-aware styles hook
export const useStyles = () => {
  const theme = useTheme()
  const stylesRef = React.useRef<ReturnType<typeof createStyles>>(
    createStyles(theme)
  )
  const themeRef = React.useRef<IMThemeVariables>(theme)
  if (themeRef.current !== theme) {
    stylesRef.current = createStyles(theme)
    themeRef.current = theme
  }
  return stylesRef.current
}

// Utility functions
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

const getTipContent = (
  title?: React.ReactNode,
  content?: React.ReactNode
): React.ReactNode => {
  return title ?? content
}

// Helper functions
const ariaDesc = (id?: string, suffix = "error"): string | undefined =>
  id ? `${id}-${suffix}` : undefined

const getBtnAria = (
  text?: React.ReactNode,
  icon?: string | boolean,
  jimuAriaLabel?: string,
  tooltip?: string,
  fallbackLabel?: string
): string | undefined => {
  // If there's an explicit aria-label, use it
  if (jimuAriaLabel) return jimuAriaLabel
  // If there's visible text, use it
  if (typeof text === "string" && text.length > 0) return text
  // if no icon, no need for aria-label
  if (!icon) return undefined
  // If there's an icon but no text, use tooltip or fallback label
  return (typeof tooltip === "string" && tooltip) || fallbackLabel
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
  disabled = false,
  title,
  ...otherProps
}) => {
  const styles = useStyles()
  const autoId = useId()

  // Ensure children is a valid React element
  if (!React.isValidElement(children)) return <>{children}</>

  const tooltipContent = getTipContent(title, content)
  if (!tooltipContent || disabled) return children

  const tooltipId = otherProps.id || autoId

  const isDisabled =
    children.props?.disabled || children.props?.["aria-disabled"]
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
      enterDelay={config.tooltip.delay.enter}
      enterNextDelay={config.tooltip.delay.next}
      enterTouchDelay={config.tooltip.delay.touch}
      leaveDelay={config.tooltip.delay.leave}
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
  errorText,
  type = "text",
  onChange,
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

  return (
    <TextInput
      {...props}
      type={type as any}
      value={value as string | number}
      onChange={handleChange}
      required={required}
      maxLength={maxLength}
      title={errorText}
      aria-required={required}
      aria-invalid={!!errorText}
      aria-describedby={errorText ? ariaDesc(props.id || "input") : undefined}
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
  const styles = useStyles()
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
      value={value as string}
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

// Multi-select rendering component
const MultiSelectComponent: React.FC<{
  options: readonly OptionItem[]
  normalizedValue: Array<string | number>
  setValue: (val: Array<string | number>) => void
  onChange?: (val: Array<string | number>) => void
  placeholder: string
  disabled: boolean
  style?: React.CSSProperties
}> = ({
  options,
  normalizedValue,
  setValue,
  onChange,
  placeholder,
  disabled,
  style,
}) => {
  const items = React.useMemo(
    () =>
      options.map((opt) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled,
      })),
    [options]
  )

  const handleMultiSelectChange = hooks.useEventCallback(
    (vals: Array<string | number>) => {
      setValue(vals)
      onChange?.(vals)
    }
  )

  return (
    <div style={style}>
      <MultiSelect
        items={items as any}
        values={normalizedValue}
        onChange={handleMultiSelectChange}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
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
    style,
  } = props

  const isMulti = Array.isArray(controlled)
  const [value, setValue] = useValue(controlled, defaultValue)
  const translate = hooks.useTranslation(defaultMessages)

  // Normalize the value to strings for the underlying select component(s)
  const normalizedValue: string | Array<string | number> = React.useMemo(
    () =>
      isMulti
        ? Array.isArray(value)
          ? value.map((v) => String(v))
          : []
        : value !== undefined &&
            (typeof value === "string" || typeof value === "number")
          ? String(value)
          : undefined,
    [isMulti, value]
  )

  const resolvedPlaceholder = React.useMemo(
    () => placeholder ?? translate("placeholderSelectGeneric"),
    [placeholder, translate]
  )

  // Handle single select change
  const handleSingleChange = hooks.useEventCallback(
    (evt: unknown, selectedValue?: string | number) => {
      const raw =
        selectedValue !== undefined
          ? selectedValue
          : (evt as any)?.target?.value
      setValue(raw)
      onChange?.(raw)
    }
  )

  const optionElements = React.useMemo(
    () =>
      options.map((option) => (
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
      )),
    [options, normalizedValue, handleSingleChange]
  )

  if (isMulti) {
    return (
      <MultiSelectComponent
        options={options}
        normalizedValue={normalizedValue as Array<string | number>}
        setValue={setValue}
        onChange={onChange}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        style={style}
      />
    )
  }

  return (
    <JimuSelect
      value={normalizedValue as string}
      onChange={handleSingleChange}
      disabled={disabled}
      placeholder={resolvedPlaceholder}
      zIndex={config.zIndex.selectMenu}
      style={style}
    >
      {optionElements}
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
  loading = false,
  onClick,
  children,
  block = config.button.defaults.block,
  size = "default",
  variant = "contained",
  color = "default",
  htmlType = "button",
  ...jimuProps
}) => {
  const styles = useStyles()
  const translate = hooks.useTranslation(defaultMessages)

  const handleClick = hooks.useEventCallback(() => {
    if (jimuProps.disabled || loading || !onClick) return
    onClick()
  })

  const ariaLabel = getBtnAria(
    text,
    !!icon,
    jimuProps["aria-label"],
    tooltip,
    translate("ariaButtonLabel")
  )

  const safeColor: "default" | "inherit" | "primary" | "secondary" = (():
    | "default"
    | "inherit"
    | "primary"
    | "secondary" => {
    switch (color) {
      case "default":
      case "inherit":
      case "primary":
      case "secondary":
        return color
      default:
        return "default"
    }
  })()

  const buttonElement = (
    <JimuButton
      {...jimuProps}
      color={safeColor}
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
      css={styles.relative}
      style={{ position: "relative", ...jimuProps.style }}
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
    <Tooltip content={tooltip} placement={tooltipPlacement}>
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
}) => {
  const styles = useStyles()
  const [value, handleValueChange] = useValue(
    controlled,
    defaultValue || items[0]?.value
  )

  const handleChange = hooks.useEventCallback((newValue: string | number) => {
    const final = typeof controlled === "number" ? Number(newValue) : newValue
    handleValueChange(final as any)
    onChange?.(final as any)
    onTabChange?.(final as any)
  })

  return (
    <AdvancedButtonGroup
      role="radiogroup"
      aria-label={ariaLabel}
      css={[styles.row, styles.gapBtnGroup]}
    >
      {items.map((item, i) => {
        const active = value === item.value
        return (
          <Button
            key={
              typeof item.value === "string" || typeof item.value === "number"
                ? String(item.value)
                : `tab-${i}-${item.label}`
            }
            icon={item.icon}
            text={!item.hideLabel ? item.label : undefined}
            active={active}
            aria-label={item.label}
            variant="contained"
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
  const styles = useStyles()
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
  const styles = useStyles()

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
          }}
          rightButton={{
            text: translate("submit"),
            onClick: onSubmit,
            disabled: !isValid || loading,
            loading: loading,
            tooltip: translate("tooltipSubmitOrder"),
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
  const styles = useStyles()
  const translate = hooks.useTranslation(defaultMessages)
  const autoId = useId()
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
