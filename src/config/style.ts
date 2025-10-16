import { css, type IMThemeVariables, type ImmutableObject } from "jimu-core"
import { useTheme } from "jimu-theme"
import type { TypographyStyle } from "jimu-theme"
import type { BtnContentProps } from "./types"

// UI component configuration constants
export const config = {
  icon: { small: 16, medium: 18, large: 24 },
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
    defaults: { block: true, tooltipPosition: "top" as const },
    offset: "10px",
    textPadding: "18px",
  },
  zIndex: { selectMenu: 1005, overlay: 1000 },
  loading: {
    width: 215,
    height: 215,
    delay: 1000,
    detailDelay: 1600,
    cycleInterval: 5200,
  },
  required: "*",
} as const

// Internal helpers
const typo = (variant: ImmutableObject<TypographyStyle>) => ({
  fontFamily: variant?.fontFamily,
  fontWeight: variant?.fontWeight?.toString(),
  fontSize: variant?.fontSize,
  fontStyle: variant?.fontStyle,
  lineHeight: variant?.lineHeight,
  color: variant?.color,
})

const flex = (
  dir: "row" | "column" | "inline",
  styles: { [key: string]: any } = {}
) =>
  css({
    display: dir === "inline" ? "inline-flex" : "flex",
    flexFlow:
      dir === "column"
        ? "column nowrap"
        : dir === "inline"
          ? "row wrap"
          : undefined,
    ...styles,
  })

// Runtime UI styles factory
export const createUiStyles = (theme: IMThemeVariables) => {
  const spacing = theme.sys.spacing
  const colors = theme.sys.color
  const typography = theme.sys.typography
  const gap = spacing?.(2)
  const auto = "1 1 auto"

  return {
    // Layout
    row: flex("row", { gap }),
    buttonGroup: flex("column", { inlineSize: "100%", gap }),
    fullWidth: flex("column", {
      inlineSize: "100%",
      flex: auto,
      minInlineSize: 0,
    }),
    relative: css({ position: "relative" }),
    rowAlignCenter: css({ alignItems: "center" }),
    disabledPicker: flex("row", { pointerEvents: "none" }),
    textareaResize: css({ resize: "vertical" }),
    parent: flex("column", {
      overflowY: "auto",
      blockSize: "100%",
      position: "relative",
      gap,
      padding: spacing?.(1),
      backgroundColor: colors?.surface?.paper,
    }),
    header: flex("row", {
      alignItems: "center",
      justifyContent: "flex-end",
      gap,
      marginBlockEnd: spacing?.(2),
    }),
    headerAlert: css({
      marginInlineEnd: "auto",
      display: "flex",
      alignItems: "center",
    }),
    content: flex("column", { flex: auto, minBlockSize: 0, gap }),
    centered: flex("column", {
      placeContent: "center",
      alignItems: "center",
      textAlign: "center",
      flex: auto,
      minBlockSize: 0,
      gap,
    }),
    loadingText: css({
      position: "absolute",
      inset: "50% auto auto 50%",
      transform: "translate(-50%, -50%)",
      textAlign: "center",
    }),
    overlay: css({
      position: "absolute",
      inset: "50% auto auto 50%",
      transform: "translate(-50%, -50%)",
      textAlign: "center",
      zIndex: config.zIndex.overlay,
    }),

    // Alerts
    alert: css({
      width: "100% !important",
      backgroundColor: "transparent !important",
      border: "none !important",
    }),
    alertInline: css({ opacity: 0.8 }),
    alertContent: flex("row", { alignItems: "flex-start", gap }),
    alertMessage: css({ flex: auto, ...typo(typography?.label2) }),
    alertIcon: css({
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
    }),

    // Typography
    typo: {
      caption: css({
        ...typo(typography?.body1),
        marginBlockEnd: spacing?.(3),
      }),
      label: css({
        ...typo(typography?.label1),
        fontWeight: "400",
        marginBlockEnd: 0,
      }),
      title: css({
        ...typo(typography?.title1),
        margin: `${spacing?.(1)} 0`,
      }),
      instruction: css({
        textAlign: "center",
        ...typo(typography?.body1),
        margin: `${spacing?.(3)} 0`,
      }),
      link: css({
        ...typo(typography?.body1),
        color: colors?.action.link?.default,
        textDecoration: "underline",
        wordBreak: "break-all",
        "&:hover": {
          color: colors?.action.link?.hover,
          textDecoration: "underline",
        },
      }),
      loadingMessage: css({
        ...typo(typography?.body2),
      }),
      required: css({ marginInlineStart: spacing?.(1) }),
      hint: css({
        ...typo(typography?.label2),
        marginBlockStart: spacing?.(1),
      }),
    },

    // Buttons
    btn: {
      flex: css({ flex: auto }),
      group: flex("column", { inlineSize: "100%", gap }),
      text: (align: BtnContentProps["alignText"]) =>
        css({
          flex: auto,
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

    // Forms
    form: {
      layout: flex("column", { flex: auto, minBlockSize: 0, gap }),
      header: css({ flex: "0 0 auto" }),
      sliderField: flex("column", { gap: spacing?.(1) }),
      sliderValue: css({
        ...typo(typography?.label2),
        textAlign: "center",
        userSelect: "none",
        marginBlockStart: spacing?.(0.5) || "4px",
        fontSize: typography?.body2?.fontSize || "0.875rem",
      }),
      content: flex("column", { flex: auto, gap }),
      body: flex("column", { flex: auto, gap, overflowY: "auto" }),
      footer: flex("column", { flex: "0 0 auto", gap }),
    },
    field: css({ marginBlockEnd: spacing?.(3) }),
    checkLabel: flex("row", {
      alignItems: "center",
      justifyContent: "space-between",
      inlineSize: "100%",
    }),

    // Selection
    selection: {
      container: flex("column", { flex: auto, gap, minBlockSize: 0 }),
      warning: css({ marginBlockStart: "auto" }),
      message: css({
        marginBlockStart: "auto",
        ...typo(typography?.body2),
      }),
    },

    // Tooltips
    tooltipWrap: {
      block: flex("row", { inlineSize: "100%", minInlineSize: 0 }),
      inline: flex("inline", { minInlineSize: 0 }),
      anchor: flex("row", {
        flex: auto,
        minInlineSize: 0,
        "& > *": { flex: auto, minInlineSize: 0 },
      }),
    },

    // State view layout helpers
    stateView: {
      frame: flex("column", {
        inlineSize: "100%",
        blockSize: "100%",
        minBlockSize: 0,
      }),
      error: flex("column", {
        flex: auto,
        inlineSize: "100%",
        blockSize: "100%",
        minBlockSize: 0,
        gap,
        alignItems: "stretch",
      }),
      errorContent: flex("column", {
        gap,
        flex: "1 1 auto",
        justifyContent: "center",
      }),
      errorIcon: css({
        marginBlockEnd: spacing?.(2) ?? 0,
      }),
      errorActions: css({
        inlineSize: "100%",
        marginBlockStart: "auto",
        alignSelf: "stretch",
      }),
    },
  } as const
}

export type UiStyles = ReturnType<typeof createUiStyles>

export const useUiStyles = (): UiStyles => {
  const theme = useTheme()
  return createUiStyles(theme)
}

// Settings panel styles factory
export const createSettingStyles = (theme: IMThemeVariables) => {
  const spacing = theme?.sys?.spacing
  const color = theme?.sys?.color
  const typography = theme?.sys?.typography

  return {
    row: css({ width: "100%" }),
    alertInline: css({ opacity: 0.8 }),
    labelWithButton: css({
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      gap: spacing?.(1),
    }),
    labelText: css({ marginInlineStart: spacing?.(1) }),
    fieldStatus: css({
      display: "flex",
      alignItems: "center",
      gap: spacing?.(1),
      opacity: 0.85,
    }),
    fieldStatusText: css({
      ...typo(typography?.label2),
    }),
    status: {
      container: css({
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }),
      list: css({
        display: "grid",
        ...typo(typography?.label2),
        opacity: 0.8,
        padding: 6,
      }),
      row: css({
        display: "flex",
        justifyContent: "space-between",
        lineHeight: 2,
      }),
      labelGroup: css({ display: "flex", alignItems: "center" }),
      color: {
        ok: css({ color: color?.success?.main }),
        fail: css({ color: color?.error?.main }),
        skip: css({ color: color?.warning?.main }),
        pending: css({ color: color?.info?.main }),
      },
    },
  } as const
}

export type SettingStyles = ReturnType<typeof createSettingStyles>

export const useSettingStyles = (): SettingStyles => {
  const theme = useTheme()
  return createSettingStyles(theme)
}
