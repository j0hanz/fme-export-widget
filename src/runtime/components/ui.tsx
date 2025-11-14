/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  css,
  hooks,
  jsx,
  React,
  type SerializedStyles,
  type URIScheme,
} from "jimu-core";
import { ColorPicker as JimuColorPicker } from "jimu-ui/basic/color-picker";
import {
  AdvancedButtonGroup,
  FormGroup,
  Alert as JimuAlert,
  Button as JimuButton,
  Checkbox as JimuCheckbox,
  NumericInput as JimuNumericInput,
  Option as JimuOption,
  Radio as JimuRadio,
  Select as JimuSelect,
  Slider as JimuSlider,
  Switch as JimuSwitch,
  Table as JimuTable,
  TextArea as JimuTextArea,
  Tooltip as JimuTooltip,
  UrlInput as JimuUrlInput,
  Label,
  Loading,
  LoadingType,
  SVG,
  TextInput,
} from "jimu-ui";
import type { SVGProps } from "jimu-ui";
import {
  EMAIL_PLACEHOLDER,
  config as styleConfig,
  useUiStyles,
} from "../../config/index";
import type {
  BtnContentProps,
  ButtonGroupProps,
  ButtonProps,
  ButtonTabsProps,
  FieldProps,
  FormProps,
  GroupButtonConfig,
  InputProps,
  OptionItem,
  SelectProps,
  StateViewProps,
  TabItem,
  TextAreaProps,
  TooltipProps,
  TranslateFn,
  UiStyles,
  ViewAction,
} from "../../config/index";
import {
  useControlledValue,
  useLoadingLatch,
  useUniqueId,
} from "../../shared/hooks";
import {
  ariaDesc,
  flattenHierarchicalOptions,
  formatNumericDisplay,
  getBtnAria,
  getErrorIconSrc,
  resolveMessageOrKey,
  styleCss,
} from "../../shared/utils";
import defaultMessages from "../translations/default";
// Removed schedule validation imports from "../../shared/validations"
import dataIcon from "../../assets/icons/data.svg";
import emailIcon from "../../assets/icons/email.svg";
import errorIcon from "../../assets/icons/error.svg";
import featureServiceIcon from "../../assets/icons/feature-service.svg";
import folderIcon from "../../assets/icons/folder.svg";
import infoIcon from "../../assets/icons/info.svg";
import linkTiltedIcon from "../../assets/icons/link-tilted.svg";
import mapIcon from "../../assets/icons/map.svg";
import personLockIcon from "../../assets/icons/person-lock.svg";
import polygonIcon from "../../assets/icons/polygon.svg";
import rectangleIcon from "../../assets/icons/rectangle.svg";
import settingIcon from "../../assets/icons/setting.svg";
import sharedNoIcon from "../../assets/icons/shared-no.svg";
import successIcon from "../../assets/icons/success.svg";
import timeIcon from "../../assets/icons/time.svg";
import warningIcon from "../../assets/icons/warning.svg";

// Konfiguration och konstanter
export const config = styleConfig;

// Lokala ikonkällor mappar nyckel till importerad ikon
const LOCAL_ICON_SOURCES: { readonly [key: string]: string } = {
  error: errorIcon,
  map: mapIcon,
  polygon: polygonIcon,
  rectangle: rectangleIcon,
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
};

type AlertVariant = NonNullable<React.ComponentProps<typeof JimuAlert>["type"]>;

// Mappar alert-typ till ikonnamn
const ALERT_ICON_MAP: { [K in AlertVariant]: string | undefined } = {
  warning: "warning",
  error: "error",
  info: "info",
  success: "success",
};

// Stilhjälpare
export const useStyles = (): UiStyles => useUiStyles();

// Aliaser för importerade hooks för intern användning
const useId = useUniqueId;
const useValue = useControlledValue;

// Verktygshjälpare

// Tilldelar ID till barn-element om det saknas
const withId = (
  child: React.ReactNode,
  readOnly: boolean,
  fallbackId: string
): { id: string | undefined; child: React.ReactNode } => {
  if (readOnly || !React.isValidElement(child)) {
    return { id: undefined, child };
  }

  const childProps = (child.props || {}) as { [key: string]: unknown };
  const id = (childProps.id as string) || fallbackId;

  if (childProps.id) {
    return { id, child };
  }

  const cloned = React.cloneElement(child as React.ReactElement, { id });
  return { id, child: cloned };
};

// Kombinerar bas-stilar med anpassade stilar
const applyComponentStyles = (
  base: Array<SerializedStyles | undefined>,
  customStyle?: React.CSSProperties
) => [...base, styleCss(customStyle)].filter(Boolean);

// Applicerar fullbredd-stil med anpassad stil
const applyFullWidthStyles = (
  styles: UiStyles,
  customStyle?: React.CSSProperties
) => applyComponentStyles([styles.fullWidth], customStyle);

// Bygger vanliga ARIA-attribut för formulärinmatningar
const getFormAria = (opts: {
  id?: string;
  required?: boolean;
  errorText?: string | boolean;
  errorSuffix?: string;
}) => {
  const { id, required, errorText, errorSuffix } = opts || {};
  return {
    "aria-required": !!required,
    "aria-invalid": !!errorText,
    "aria-describedby": errorText && id ? ariaDesc(id, errorSuffix) : undefined,
  } as const;
};

// Lindar element med Tooltip och layout-wrapper när tooltip finns
const wrapWithTooltip = (
  element: React.ReactElement,
  opts: {
    tooltip?: React.ReactNode;
    placement?: TooltipProps["placement"] | "auto";
    block?: boolean;
    jimuCss?: SerializedStyles | readonly SerializedStyles[];
    jimuStyle?: React.CSSProperties;
    styles: UiStyles;
  }
) => {
  const { tooltip, placement, block, jimuCss, jimuStyle, styles } = opts;
  if (!tooltip) return element;

  const normalizedCss: SerializedStyles[] = Array.isArray(jimuCss)
    ? jimuCss.filter(Boolean)
    : jimuCss
      ? [jimuCss]
      : [];

  const wrapperCss = applyComponentStyles(
    [
      ...normalizedCss,
      block ? styles.tooltipWrap.block : styles.tooltipWrap.inline,
    ],
    jimuStyle
  );

  const tooltipPlacement = sanitizeTooltipPlacement(placement);

  return (
    <span css={wrapperCss}>
      <Tooltip content={tooltip} placement={tooltipPlacement}>
        <span css={styles.tooltipWrap.anchor}>{element}</span>
      </Tooltip>
    </span>
  );
};

// Sanerar tooltip-placering (ersätter auto med top)
const sanitizeTooltipPlacement = (
  placement: TooltipProps["placement"] | "auto" | undefined
) => (placement === "auto" ? config.tooltip.position.top : placement);

// Skapar tooltip-ankare med stöd för disabled element
const createTooltipAnchor = (
  child: React.ReactElement,
  tooltipContent: React.ReactNode
) => {
  const childProps = (child.props || {}) as {
    disabled?: boolean;
    "aria-disabled"?: boolean;
  };
  const isDisabled = childProps.disabled || childProps["aria-disabled"];

  if (!isDisabled) return child;

  const ariaLabel =
    typeof tooltipContent === "string" ? tooltipContent : undefined;

  // Inaktiverade element ska INTE vara fokusbara enligt WCAG 2.1.1
  return (
    <span aria-disabled="true" aria-label={ariaLabel}>
      {child}
    </span>
  );
};

// Returnerar required-markering med tooltip
const getRequiredMark = (translate: TranslateFn, styles: UiStyles) => (
  <Tooltip content={translate("valRequiredField")} placement="bottom">
    <span
      css={styles.typo.required}
      aria-label={translate("ariaRequired")}
      role="img"
      aria-hidden="false"
    >
      {config.required}
    </span>
  </Tooltip>
);

// Primitiva UI-komponenter

// Knappinnehålls-komponent
const BtnContent: React.FC<BtnContentProps> = ({
  loading,
  children,
  text,
  icon,
  alignText,
}) => {
  const styles = useStyles();

  if (loading) return <Loading type={LoadingType.Donut} />;
  if (children) return <>{children}</>;

  const hasIcon =
    (typeof icon === "string" && icon.length > 0) ||
    (icon != null && React.isValidElement(icon));
  const hasText = !!text;

  if (!hasIcon && !hasText) return null;
  if (hasIcon && !hasText) {
    return typeof icon === "string" ? (
      <Icon src={icon} size={config.icon.large} />
    ) : (
      (icon as React.ReactElement)
    );
  }
  if (hasText && !hasIcon) return <>{text}</>;

  const iconEl =
    typeof icon === "string" ? (
      <Icon src={icon} size={config.icon.medium} />
    ) : (
      (icon as React.ReactElement)
    );

  const iconWithPosition = (
    <span css={styles.btn.icon} aria-hidden="true">
      {iconEl}
    </span>
  );

  return (
    <>
      {/* left icon not supported */}
      <div css={styles.btn.text(alignText)}>{text}</div>
      {iconWithPosition}
    </>
  );
};

// Ikon-komponent
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
  const resolved = LOCAL_ICON_SOURCES[src] ?? src;
  const computedHidden = ariaHidden ?? !ariaLabel;

  return (
    <SVG
      {...props}
      src={resolved}
      size={size}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-hidden={computedHidden}
      css={applyComponentStyles([], style)}
    />
  );
};

// Tooltip-komponent
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  showArrow = config.tooltip.showArrow,
  placement = config.tooltip.position.top,
  disabled = false,
  ...otherProps
}) => {
  const tooltipContent = content;
  if (!React.isValidElement(children) || !tooltipContent || disabled) {
    return <>{children}</>;
  }
  const anchor = createTooltipAnchor(children, tooltipContent);
  const placementProp = sanitizeTooltipPlacement(placement);

  return (
    <JimuTooltip
      title={tooltipContent}
      showArrow={showArrow}
      placement={placementProp}
      {...otherProps}
    >
      {anchor}
    </JimuTooltip>
  );
};

// Formulärkontroller

// Checkbox-komponent
export const Checkbox: React.FC<React.ComponentProps<typeof JimuCheckbox>> = (
  props
) => <JimuCheckbox {...props} />;

// Input-komponent
export const Input: React.FC<InputProps> = (props) => {
  const {
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
    style,
    id,
    ...restProps
  } = props;
  const styles = useStyles();
  const isFileInput = type === "file";

  const [hookValue, hookHandleValueChange] = useValue(
    controlled,
    defaultValue || ""
  );
  const [value, handleValueChange] = isFileInput
    ? [undefined, undefined]
    : [hookValue, hookHandleValueChange];

  const handleChange = hooks.useEventCallback(
    (evt: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = evt.target.value;

      if (!isFileInput) {
        handleValueChange(newValue);
      }

      if (isFileInput && onFileChange) {
        onFileChange(evt);
      } else if (onChange) {
        onChange(newValue);
      }
    }
  );

  const handleBlur = hooks.useEventCallback(
    (evt: React.FocusEvent<HTMLInputElement>) => {
      if (onBlur) {
        onBlur(isFileInput ? "" : evt.target.value);
      }
    }
  );

  const aria = getFormAria({ id, required, errorText });

  if (isFileInput) {
    return (
      <input
        {...restProps}
        id={id}
        style={style}
        type="file"
        onChange={handleChange}
        onBlur={handleBlur}
        required={required}
        title={errorText}
        {...aria}
        css={applyFullWidthStyles(styles, style)}
      />
    );
  }

  const supportedTypes: ReadonlySet<
    React.ComponentProps<typeof TextInput>["type"]
  > = new Set([
    "text",
    "email",
    "password",
    "search",
    "tel",
    "date",
    "datetime-local",
    "month",
    "time",
    "week",
    "datetime",
    "select",
    "file",
  ]);
  const textInputType =
    type !== "number" &&
    supportedTypes.has(type as React.ComponentProps<typeof TextInput>["type"])
      ? (type as React.ComponentProps<typeof TextInput>["type"])
      : "text";
  const textInputValue =
    typeof value === "number" || typeof value === "string" ? value : "";

  return (
    <TextInput
      {...restProps}
      id={id}
      style={style}
      type={textInputType}
      value={textInputValue}
      step={step}
      onChange={handleChange}
      onBlur={handleBlur}
      required={required}
      maxLength={maxLength}
      title={errorText}
      {...aria}
      css={applyFullWidthStyles(styles, style)}
    />
  );
};

// TextArea-komponent
export const TextArea: React.FC<TextAreaProps> = ({
  value: controlled,
  defaultValue,
  onChange,
  rows = 2,
  onBlur,
  ...props
}) => {
  const styles = useStyles();
  const [value, handleValueChange] = useValue(controlled, defaultValue || "");

  const handleChange = hooks.useEventCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      handleValueChange(newValue);
      onChange?.(newValue);
    }
  );

  const handleBlur = hooks.useEventCallback(
    (event: React.FocusEvent<HTMLTextAreaElement>) => {
      onBlur?.(event.target.value);
    }
  );

  const validationMessage = props.validationMessage ?? props.errorText;

  const aria = getFormAria({
    id: props.id,
    required: props.required,
    errorText: validationMessage,
    errorSuffix: "error",
  });

  const restProps = props;

  const textAreaProps = {
    ...restProps,
    value,
    onChange: handleChange,
    onBlur: handleBlur,
    css: applyComponentStyles(
      [styles.fullWidth, styles.textareaResize],
      props.style
    ),
    ...aria,
    rows,
  };

  return (
    <JimuTextArea
      {...(textAreaProps as React.ComponentProps<typeof JimuTextArea>)}
    />
  );
};

// UrlInput-komponent
export const UrlInput: React.FC<{
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  style?: React.CSSProperties;
  onChange?: (value: string) => void;
}> = ({ value, defaultValue, placeholder, style, onChange }) => {
  const styles = useStyles();
  const schemes: URIScheme[] = ["https"];
  return (
    <JimuUrlInput
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      schemes={schemes}
      onChange={(res) => {
        const raw = (res?.value || "").trim();
        const sanitized = raw;
        onChange?.(sanitized);
      }}
      css={applyFullWidthStyles(styles, style)}
    />
  );
};

// Switch-komponent
export const Switch: React.FC<React.ComponentProps<typeof JimuSwitch>> = (
  props
) => <JimuSwitch {...props} />;

// Radio-komponent
export const Radio: React.FC<{
  options: Array<{ label: string; value: string }>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
  disabled?: boolean;
  "aria-label"?: string;
}> = ({
  options,
  value,
  defaultValue,
  onChange,
  style,
  disabled,
  "aria-label": ariaLabel,
}) => {
  const styles = useStyles();
  const isControlled = value !== undefined;

  return (
    <div
      css={applyFullWidthStyles(styles, style)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option, index) => (
        <Label key={`${option.value}-${index}`} check centric>
          <JimuRadio
            value={option.value}
            {...(isControlled
              ? { checked: value === option.value }
              : { defaultChecked: defaultValue === option.value })}
            disabled={disabled}
            onChange={(e) => {
              onChange?.(e.target.value);
            }}
          />
          {option.label}
        </Label>
      ))}
    </div>
  );
};

// Slider-komponent
export const Slider: React.FC<{
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  style?: React.CSSProperties;
  disabled?: boolean;
  "aria-label"?: string;
  decimalPrecision?: number;
  showValue?: boolean;
  valueFormatter?: (value: number) => string;
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
  decimalPrecision,
  showValue = true,
  valueFormatter,
}) => {
  const styles = useStyles();

  const formatValue = hooks.useEventCallback((val: number): string => {
    if (typeof valueFormatter === "function") {
      return valueFormatter(val);
    }
    return formatNumericDisplay(val, decimalPrecision);
  });

  const resolvedValue = (() => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof defaultValue === "number" && Number.isFinite(defaultValue)) {
      return defaultValue;
    }
    return undefined;
  })();

  const displayValue =
    showValue && typeof resolvedValue === "number"
      ? formatValue(resolvedValue)
      : "";

  return (
    <div css={styles.form.sliderField}>
      <JimuSlider
        value={value}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          const numValue = parseFloat(e.target.value);
          if (!Number.isNaN(numValue) && Number.isFinite(numValue)) {
            onChange?.(numValue);
          }
        }}
        css={applyFullWidthStyles(styles, style)}
      />
      {showValue && displayValue !== "" ? (
        <div css={styles.form.sliderValue} aria-live="polite" role="status">
          {displayValue}
        </div>
      ) : null}
    </div>
  );
};

// NumericInput-komponent
type NumericInputProps = Omit<
  React.ComponentProps<typeof JimuNumericInput>,
  "css" | "onChange" | "style"
> & {
  style?: React.CSSProperties;
  onChange?: (value: number | undefined) => void;
};

export const NumericInput: React.FC<NumericInputProps> = ({
  style,
  onChange,
  ...rest
}) => {
  const styles = useStyles();
  return (
    <JimuNumericInput
      {...rest}
      onChange={(value) => {
        if (typeof value === "number" && !Number.isNaN(value)) {
          onChange?.(value);
          return;
        }
        if (value == null || Number.isNaN(value)) {
          onChange?.(undefined);
        }
      }}
      css={applyFullWidthStyles(styles, style)}
    />
  );
};

// Table-komponent
export const Table: React.FC<React.ComponentProps<typeof JimuTable>> = (
  props
) => <JimuTable {...props} />;

// ColorPicker-komponent
export const ColorPickerWrapper: React.FC<{
  value?: string;
  defaultValue?: string;
  onChange?: (color: string) => void;
  style?: React.CSSProperties;
  "aria-label"?: string;
}> = ({ value, defaultValue, onChange, style, "aria-label": ariaLabel }) => {
  const styles = useStyles();
  return (
    <JimuColorPicker
      color={value || defaultValue || "#000000"}
      onChange={(color) => {
        onChange?.(color);
      }}
      aria-label={ariaLabel}
      css={applyFullWidthStyles(styles, style)}
      showArrow
    />
  );
};

// Select-komponent
export const Select: React.FC<SelectProps> = ({
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder,
  disabled = false,
  style,
  coerce,
  allowSearch = false,
  allowCustomValues = false,
  hierarchical = false,
}) => {
  const translate = hooks.useTranslation(defaultMessages);
  const styles = useStyles();
  const [internalValue, setInternalValue] = useValue(value, defaultValue);
  const [searchTerm, setSearchTerm] = React.useState("");
  const resolvedPlaceholder = placeholder || translate("phSelectOption");

  const coerceValue = hooks.useEventCallback((val: unknown): unknown => {
    if (coerce === "number" && typeof val === "string") {
      const n = Number(val);
      return Number.isFinite(n) ? n : val;
    }
    return val;
  });

  type SelectChangeEvent = { target?: { value?: string | number } } | undefined;

  const handleSingleSelectChange = hooks.useEventCallback(
    (evt: SelectChangeEvent, selectedValue?: string | number) => {
      const rawValue =
        selectedValue !== undefined ? selectedValue : evt?.target?.value;
      const newValue = coerceValue(rawValue);
      setInternalValue(newValue);
      onChange?.(newValue);
    }
  );

  const commitCustomValue = hooks.useEventCallback((raw: string) => {
    if (!allowCustomValues) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const newValue = coerceValue(trimmed);
    if (Object.is(newValue, internalValue)) {
      return;
    }
    setInternalValue(newValue);
    onChange?.(newValue);
  });

  const showFilter = allowSearch || allowCustomValues;

  const flattenedEntries = flattenHierarchicalOptions(options, hierarchical);
  const trimmedSearch = showFilter ? searchTerm.trim() : "";
  const normalizedSearch = trimmedSearch.toLowerCase();
  const filteredEntries = normalizedSearch
    ? flattenedEntries.filter(({ option }) => {
        const baseLabel =
          option.label && option.label.trim()
            ? option.label.trim()
            : String(option.value);
        return baseLabel.toLowerCase().includes(normalizedSearch);
      })
    : flattenedEntries;

  let displayEntries = filteredEntries;

  if (allowCustomValues) {
    const ensureEntryForValue = (candidate: unknown) => {
      if (
        candidate === undefined ||
        candidate === null ||
        (typeof candidate !== "string" && typeof candidate !== "number")
      ) {
        return;
      }
      const candidateKey = String(candidate);
      const exists = displayEntries.some(
        ({ option }) => String(option.value) === candidateKey
      );
      if (!exists) {
        displayEntries = [
          ...displayEntries,
          {
            option: {
              value: candidate,
              label: candidateKey,
            } as OptionItem,
            depth: 0,
          },
        ];
      }
    };

    ensureEntryForValue(internalValue);

    if (trimmedSearch) {
      const rawCustomValue = coerceValue(trimmedSearch);
      const customValue =
        typeof rawCustomValue === "number" || typeof rawCustomValue === "string"
          ? rawCustomValue
          : trimmedSearch;
      const customKey = String(customValue);
      const exists = displayEntries.some(
        ({ option }) => String(option.value) === customKey
      );
      if (!exists) {
        displayEntries = [
          {
            option: {
              value: customValue,
              label: trimmedSearch,
            } as OptionItem,
            depth: 0,
          },
          ...displayEntries,
        ];
      }
    }
  }

  const stringValue =
    internalValue != null &&
    (typeof internalValue === "string" || typeof internalValue === "number")
      ? String(internalValue)
      : undefined;

  const containerStyles = applyComponentStyles([styles.fullWidth], style);

  return (
    <div css={containerStyles}>
      {showFilter ? (
        <Input
          type="search"
          value={searchTerm}
          placeholder={translate("phSearch")}
          onChange={(val) => {
            setSearchTerm(typeof val === "string" ? val : "");
          }}
          onKeyDown={(evt: React.KeyboardEvent<HTMLInputElement>) => {
            if (evt.key === "Enter" && allowCustomValues) {
              evt.preventDefault();
              commitCustomValue(evt.currentTarget.value);
              setSearchTerm("");
            }
          }}
          disabled={disabled}
        />
      ) : null}
      <JimuSelect
        value={stringValue}
        onChange={handleSingleSelectChange}
        disabled={disabled}
        placeholder={resolvedPlaceholder}
        zIndex={config.zIndex.selectMenu}
        css={styles.fullWidth}
      >
        {displayEntries
          .map(({ option, depth }, idx) => {
            if (!option || option.value == null) {
              return null;
            }
            const optionKey = String(option.value);
            const isActive = optionKey === stringValue;
            const baseLabel =
              option.label && option.label.trim()
                ? option.label.trim()
                : optionKey;
            const resolvedLabel = resolveMessageOrKey(baseLabel, translate);
            const renderedLabel = option.hideLabel
              ? ""
              : hierarchical && depth > 0
                ? `${"- ".repeat(depth)}${resolvedLabel}`
                : resolvedLabel;

            return (
              <JimuOption
                key={`${optionKey}-${depth}-${idx}`}
                value={option.value}
                active={isActive}
                disabled={Boolean(option.disabled)}
                onClick={() => {
                  if (!option.disabled && optionKey !== stringValue) {
                    handleSingleSelectChange(undefined, option.value);
                  }
                }}
              >
                {option.hideLabel ? null : renderedLabel}
              </JimuOption>
            );
          })
          .filter(Boolean)}
      </JimuSelect>
    </div>
  );
};

// Sammansatta kontroller

// Knapp-komponent
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
  const styles = useStyles();
  const translate = hooks.useTranslation(defaultMessages);

  const handleClick = hooks.useEventCallback(() => {
    if (jimuProps.disabled || loading || !onClick) return;
    onClick();
  });

  // Extraherar aria-label
  const explicitAriaLabel = jimuProps["aria-label"];
  const ariaLabel = getBtnAria(
    text,
    !!icon,
    explicitAriaLabel,
    tooltip,
    translate("ariaButton")
  );

  // Absorberar stil/css från inkommande props så inga inline-attribut vidare
  const { style: jimuStyle, css: jimuCss, ...restJimuProps } = jimuProps;
  const normalizedJimuCss: SerializedStyles[] = Array.isArray(jimuCss)
    ? [...jimuCss]
    : jimuCss
      ? [jimuCss]
      : [];
  const hasTooltip = !!tooltip && !tooltipDisabled;
  const buttonCss = !hasTooltip
    ? applyComponentStyles([styles.relative, ...normalizedJimuCss], jimuStyle)
    : [styles.relative];
  const resolvedType:
    | React.ComponentProps<typeof JimuButton>["type"]
    | undefined = type;
  const resolvedColor:
    | React.ComponentProps<typeof JimuButton>["color"]
    | undefined = color;
  const resolvedSize = size;
  const resolvedVariant:
    | React.ComponentProps<typeof JimuButton>["variant"]
    | undefined = variant;

  const buttonElement = (
    <JimuButton
      {...restJimuProps}
      type={resolvedType}
      color={resolvedColor}
      variant={resolvedVariant}
      size={resolvedSize}
      htmlType={htmlType}
      icon={!text && !!icon}
      onClick={handleClick}
      disabled={jimuProps.disabled || loading}
      aria-busy={loading}
      aria-live={loading ? "polite" : undefined}
      aria-label={ariaLabel}
      title={tooltip ? undefined : jimuProps.title}
      css={buttonCss}
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
  );
  return hasTooltip
    ? wrapWithTooltip(buttonElement, {
        tooltip,
        placement: tooltipPlacement,
        block,
        jimuCss: normalizedJimuCss,
        jimuStyle,
        styles,
      })
    : buttonElement;
};

// Alert-komponent med stöd för ikon och default-varianter
type AlertDisplayVariant = "default" | "icon";

type AlertComponentBaseProps = React.ComponentProps<typeof JimuAlert>;

type AlertComponentProps = Omit<
  AlertComponentBaseProps,
  "variant" | "withIcon"
> & {
  variant?: AlertDisplayVariant;
  jimuVariant?: AlertComponentBaseProps["variant"];
  tooltipPlacement?: TooltipProps["placement"];
  withIcon?: AlertComponentBaseProps["withIcon"];
  css?: SerializedStyles | readonly SerializedStyles[];
};

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
  const styles = useStyles();
  const iconKey = ALERT_ICON_MAP[type as AlertVariant];
  const messageContent =
    children ?? (text != null ? <span>{text}</span> : null);
  const resolvedVariant: AlertDisplayVariant =
    variant === "icon" && !iconKey ? "default" : variant;

  const { css: jimuCss, ...restAlertProps } = rest;
  const normalizedJimuCss: SerializedStyles[] = Array.isArray(jimuCss)
    ? [...jimuCss]
    : jimuCss
      ? [jimuCss]
      : [];

  if (resolvedVariant === "icon") {
    const tooltipContent =
      typeof text === "string"
        ? text
        : typeof children === "string"
          ? children
          : messageContent;
    const shouldWrapWithTooltip = Boolean(tooltipContent);
    const accessibleLabel =
      typeof text === "string"
        ? text
        : typeof children === "string"
          ? children
          : undefined;

    const alertElement = (
      <JimuAlert
        {...restAlertProps}
        type={type}
        withIcon={false}
        variant={jimuVariant}
        className={className}
        css={
          shouldWrapWithTooltip
            ? [styles.alert]
            : applyComponentStyles([styles.alert, ...normalizedJimuCss], style)
        }
      >
        {iconKey ? (
          <div css={styles.alertIcon}>
            <Icon src={iconKey} aria-label={accessibleLabel} />
          </div>
        ) : null}
      </JimuAlert>
    );

    if (!shouldWrapWithTooltip) {
      return alertElement;
    }

    return wrapWithTooltip(alertElement, {
      tooltip: tooltipContent,
      placement: sanitizeTooltipPlacement(tooltipPlacement),
      block: true,
      jimuCss: normalizedJimuCss,
      jimuStyle: style,
      styles,
    });
  }

  if (messageContent == null && !iconKey) {
    return (
      <JimuAlert
        {...restAlertProps}
        type={type}
        withIcon={false}
        variant={jimuVariant}
        className={className}
        css={applyComponentStyles([styles.alert, ...normalizedJimuCss], style)}
      />
    );
  }

  return (
    <JimuAlert
      {...restAlertProps}
      type={type}
      withIcon={false}
      variant={jimuVariant}
      className={className}
      css={applyComponentStyles([styles.alert, ...normalizedJimuCss], style)}
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
  );
};

// ButtonTabs-komponent för tabbnavigering
export const ButtonTabs: React.FC<ButtonTabsProps> = ({
  items,
  value: controlled,
  defaultValue,
  onChange,
  onTabChange,
  ariaLabel,
}) => {
  const styles = useStyles();
  const [uncontrolledValue, setUncontrolledValue] = useValue(
    undefined,
    defaultValue || items[0]?.value
  );
  const isControlled = controlled !== undefined;
  const currentValue = isControlled ? controlled : uncontrolledValue;

  const handleChange = hooks.useEventCallback((newValue: TabItem["value"]) => {
    const targetItem = items.find((item) => item.value === newValue);
    const finalValue = targetItem ? targetItem.value : newValue;
    if (!isControlled) {
      setUncontrolledValue(finalValue);
    }
    onChange?.(finalValue);
    onTabChange?.(finalValue);
  });

  return (
    <AdvancedButtonGroup
      role="tablist"
      aria-label={ariaLabel}
      css={[styles.row]}
    >
      {items.map((item, i) => {
        const active = currentValue === item.value;
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
                return;
              }
              handleChange(item.value);
            }}
            block={false}
          />
        );
      })}
    </AdvancedButtonGroup>
  );
};

// Vy-komponenter

// StateView-komponent med laddningsmeddelande-rotation
const StateView: React.FC<StateViewProps> = ({
  state,
  className,
  style,
  renderActions,
  center,
}) => {
  const styles = useStyles();
  const translate = hooks.useTranslation(defaultMessages);
  const { showLoading, snapshot } = useLoadingLatch(
    state,
    config.loading.delay
  );
  const [activeLoadingMessageIndex, setActiveLoadingMessageIndex] =
    React.useState(0);

  // Samlar unika laddningsmeddelanden
  const seenStrings = new Set<string>();
  const loadingMessages: React.ReactNode[] = [];
  const appendLoadingMessage = (
    value: React.ReactNode | null | undefined
  ): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || seenStrings.has(trimmed)) {
        return;
      }
      seenStrings.add(trimmed);
      loadingMessages.push(trimmed);
      return;
    }

    loadingMessages.push(value);
  };

  const loadingMessageFromState =
    state.kind === "loading" ? state.message : undefined;
  const loadingDetailFromState =
    state.kind === "loading" ? state.detail : undefined;
  const loadingExtrasFromState =
    state.kind === "loading" && Array.isArray(state.messages)
      ? state.messages
      : undefined;

  appendLoadingMessage(snapshot?.message ?? loadingMessageFromState);
  appendLoadingMessage(snapshot?.detail ?? loadingDetailFromState);

  const extraMessages =
    (snapshot?.messages && Array.isArray(snapshot.messages)
      ? snapshot.messages
      : loadingExtrasFromState) ?? [];

  for (const message of extraMessages) {
    appendLoadingMessage(message);
  }

  const messageCount = loadingMessages.length;
  const messageSignature = loadingMessages
    .map((value, index) => {
      if (typeof value === "string") return value;
      if (React.isValidElement(value) && value.key != null) {
        return String(value.key);
      }
      return `node-${index}`;
    })
    .join("|");

  // Återställer meddelandeindex vid ändring
  hooks.useEffectWithPreviousValues(() => {
    setActiveLoadingMessageIndex(0);
  }, [messageSignature, showLoading]);

  hooks.useEffectWithPreviousValues(() => {
    if (messageCount === 0 && activeLoadingMessageIndex !== 0) {
      setActiveLoadingMessageIndex(0);
      return;
    }

    if (messageCount > 0 && activeLoadingMessageIndex >= messageCount) {
      setActiveLoadingMessageIndex(messageCount - 1);
    }
  }, [messageCount, activeLoadingMessageIndex]);

  // Cyklar genom meddelanden om det finns fler än ett
  hooks.useEffectWithPreviousValues(() => {
    if (!showLoading || messageCount <= 1) {
      return undefined;
    }

    const detailDelay = config.loading.detailDelay ?? config.loading.delay;
    const cycleInterval = config.loading.cycleInterval ?? 0;

    let detailTimer: ReturnType<typeof setTimeout> | null = null;
    let cycleTimer: ReturnType<typeof setInterval> | null = null;

    detailTimer = setTimeout(() => {
      setActiveLoadingMessageIndex((prev) => {
        if (messageCount <= 1) {
          return 0;
        }
        const normalized = prev % messageCount;
        return normalized === 0 ? 1 : normalized;
      });

      if (cycleInterval > 0) {
        if (cycleTimer) clearInterval(cycleTimer);
        cycleTimer = setInterval(() => {
          setActiveLoadingMessageIndex((prev) => {
            if (messageCount <= 1) {
              return 0;
            }
            return (prev + 1) % messageCount;
          });
        }, cycleInterval);
      }
    }, detailDelay);

    return () => {
      if (detailTimer) clearTimeout(detailTimer);
      if (cycleTimer) clearInterval(cycleTimer);
    };
  }, [showLoading, messageCount, messageSignature]);

  const activeLoadingMessage =
    messageCount > 0 && activeLoadingMessageIndex >= 0
      ? loadingMessages[Math.max(0, activeLoadingMessageIndex) % messageCount]
      : null;

  const defaultActionsRenderer = hooks.useEventCallback(
    ({
      actions,
      ariaLabel,
    }: {
      actions?: readonly ViewAction[];
      ariaLabel: string;
    }): React.ReactNode => {
      if (!actions?.length) return null;

      return (
        <div role="group" aria-label={ariaLabel} css={styles.btn.group}>
          {actions.map((action, index) => (
            <Button
              key={index}
              onClick={action.onClick}
              disabled={action.disabled}
              type={action.type}
              variant={action.variant}
              text={action.label}
              block
            />
          ))}
        </div>
      );
    }
  );

  const renderActionsFn: ({
    actions,
    ariaLabel,
  }: {
    actions?: readonly ViewAction[];
    ariaLabel: string;
  }) => React.ReactNode = renderActions
    ? ({
        actions,
        ariaLabel,
      }: {
        actions?: readonly ViewAction[];
        ariaLabel: string;
      }) => renderActions(actions, ariaLabel)
    : defaultActionsRenderer;

  const renderLoadingState = () => (
    <div
      css={styles.centered}
      role="status"
      aria-live="polite"
      aria-atomic={true}
    >
      {showLoading && (
        <div css={styles.loadingSpinner}>
          <Loading
            type={LoadingType.Donut}
            width={config.loading.width}
            height={config.loading.height}
          />
        </div>
      )}
      {activeLoadingMessage ? (
        <div css={[styles.typo.loadingMessage, styles.loadingText]}>
          {activeLoadingMessage}
        </div>
      ) : null}
    </div>
  );

  const renderStateByKind = (): React.ReactNode => {
    switch (state.kind) {
      case "error": {
        const actions = renderActionsFn({
          actions: state.actions,
          ariaLabel: translate("ariaErrorActions"),
        });

        const detailNode =
          state.detail == null ? null : (
            <div css={styles.typo.caption}>{state.detail}</div>
          );

        return (
          <div role="alert" aria-live="assertive" css={styles.stateView.error}>
            <div css={styles.stateView.errorContent}>
              <div css={[styles.row, styles.rowAlignCenter]}>
                <Icon
                  src={getErrorIconSrc(state.code)}
                  size={config.icon.large}
                />
                <div css={styles.typo.title}>{state.message}</div>
              </div>
              <>
                {detailNode}
                {state.code ? (
                  <div>
                    {translate("lblErrorCode")}: {state.code}
                  </div>
                ) : null}
              </>
            </div>
            {actions ? (
              <div css={styles.stateView.errorActions}>{actions}</div>
            ) : null}
          </div>
        );
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
        );
      case "success": {
        const actions = renderActionsFn({
          actions: state.actions,
          ariaLabel: translate("ariaSuccessActions"),
        });

        return (
          <div role="status" aria-live="polite" css={styles.stateView.error}>
            {state.title && <div css={styles.typo.title}>{state.title}</div>}
            {state.message && (
              <div css={styles.typo.caption}>{state.message}</div>
            )}
            {state.detail && (
              <div
                css={[
                  styles.typo.caption,
                  css({ "& > div": styles.stateView.infoLine }),
                ]}
              >
                {typeof state.detail === "string" ? (
                  <span>{state.detail}</span>
                ) : (
                  state.detail
                )}
              </div>
            )}

            {actions ? (
              <div css={styles.stateView.errorActions}>{actions}</div>
            ) : null}
          </div>
        );
      }
      case "content":
        return <>{state.node}</>;
      case "loading":
        return renderLoadingState();
    }
  };

  const content =
    state.kind === "loading" || showLoading
      ? renderLoadingState()
      : renderStateByKind();

  const shouldCenter = typeof center === "boolean" ? center : showLoading;

  return (
    <div
      className={className}
      css={applyComponentStyles(
        [styles.stateView.frame, shouldCenter ? styles.centered : undefined],
        style
      )}
    >
      {content}
    </div>
  );
};

// ButtonGroup-komponent
export const ButtonGroup: React.FC<ButtonGroupProps> = (props) => {
  const { buttons, secondaryButton, primaryButton, className, style } = props;
  const styles = useStyles();

  const resolvedButtons: Array<{
    readonly config: GroupButtonConfig;
    readonly role: "secondary" | "primary";
    readonly key: string;
  }> = buttons?.length
    ? buttons.map((config, index) => ({
        config,
        role: index === buttons.length - 1 ? "primary" : "secondary",
        key: index.toString(),
      }))
    : [
        primaryButton
          ? { config: primaryButton, role: "primary" as const, key: "primary" }
          : null,
        secondaryButton
          ? {
              config: secondaryButton,
              role: "secondary" as const,
              key: "secondary",
            }
          : null,
      ].filter(
        (
          entry
        ): entry is {
          readonly config: GroupButtonConfig;
          readonly role: "secondary" | "primary";
          readonly key: string;
        } => entry != null
      );

  if (!resolvedButtons.length) {
    return null;
  }

  return (
    <div
      css={applyComponentStyles([styles.btn.group], style)}
      className={className}
    >
      {resolvedButtons.map(({ config, role, key }) => {
        const fallbackType =
          role === "primary" ? ("primary" as const) : ("default" as const);
        const buttonProps = {
          ...config,
          type: config.type ?? fallbackType,
        };
        return (
          <Button
            key={key}
            {...buttonProps}
            block={true}
            css={styles.btn.flex}
          />
        );
      })}
    </div>
  );
};

// Formulärlayout-komponenter

// Form-komponent
export const Form: React.FC<FormProps> = (props) => {
  const { variant, className, style, children } = props;
  const translate = hooks.useTranslation(defaultMessages);
  const styles = useStyles();

  if (variant === "layout") {
    const {
      title,
      subtitle,
      onBack,
      onSubmit,
      isValid = true,
      loading = false,
    } = props;

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
                      text: translate("btnBack"),
                      onClick: onBack,
                      disabled: loading,
                    }
                  : undefined
              }
              primaryButton={{
                text: translate("btnSubmit"),
                onClick: onSubmit,
                disabled: !isValid || loading,
                loading,
                tooltip: translate("tipSubmitOrder"),
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (variant === "field") {
    const { label, helper, required = false, readOnly = false, error } = props;
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
    );
  }

  throw new Error(`Unknown Form variant: ${variant}`);
};

// Fristående Field-komponent (för återanvändning utanför Form)
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
  const styles = useStyles();
  const translate = hooks.useTranslation(defaultMessages);
  const autoId = useId();
  const { id: fieldId, child: renderedChild } = withId(
    children,
    readOnly,
    autoId
  );

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
          css={styles.typo.errorMessage}
          role="alert"
        >
          {error}
        </div>
      )}
    </FormGroup>
  );
};

export { Button as default, StateView };

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
};

// Removed ScheduleFields component

// Renderar supporthjälp med valfri e-postlänk
export const renderSupportHint = (
  supportEmail: string | undefined,
  translate: TranslateFn,
  styles: ReturnType<typeof useStyles>,
  fallbackText: string
): React.ReactNode => {
  if (!supportEmail) return <>{fallbackText}</>;

  const fullText = translate("msgContactSupport");
  const parts = fullText.split(EMAIL_PLACEHOLDER);

  if (parts.length < 2) {
    // Fallback om översättningen inte innehåller e-postplatshållaren
    return (
      <>
        {fullText}{" "}
        <a
          href={`mailto:${supportEmail}`}
          css={styles.typo.link}
          aria-label={translate("msgContactSupport", {
            email: supportEmail,
          })}
        >
          {supportEmail}
        </a>
      </>
    );
  }

  return parts.map((part, idx) => {
    if (idx < parts.length - 1) {
      return (
        <React.Fragment key={idx}>
          {part}
          <a
            href={`mailto:${supportEmail}`}
            css={styles.typo.link}
            aria-label={translate("msgContactSupport", {
              email: supportEmail,
            })}
          >
            {supportEmail}
          </a>
        </React.Fragment>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
};
