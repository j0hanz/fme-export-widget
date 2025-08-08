export const STYLES = {
  parent: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    height: "100%",
    position: "relative" as const,
  } as React.CSSProperties,
  header: {
    display: "flex",
    justifyContent: "end",
    flexShrink: 0,
  } as React.CSSProperties,
  content: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flex: "1 1 auto",
    padding: "0.5rem",
  } as React.CSSProperties,

  state: {
    centered: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: "0.5rem",
      height: "100%",
    } as React.CSSProperties,
    text: {
      position: "absolute" as const,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      textAlign: "center" as const,
      zIndex: 1000,
    } as React.CSSProperties,
  },
  measureField: {
    display: "flex",
    flexDirection: "column" as const,
    position: "absolute" as const,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 1000,
  } as React.CSSProperties,

  measureItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
  } as React.CSSProperties,

  measureGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.5rem",
    width: "100%",
  } as React.CSSProperties,

  measureValue: {
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
  } as React.CSSProperties,

  icon: {
    muted: {
      opacity: 0.2,
    } as React.CSSProperties,
  },

  typography: {
    caption: {
      fontSize: "0.8125rem",
      margin: "0.5rem 0",
    } as React.CSSProperties,

    label: {
      display: "block",
      fontSize: "0.8125rem",
      marginBottom: 0,
    } as React.CSSProperties,

    required: {
      marginLeft: "0.25rem",
    } as React.CSSProperties,

    title: {
      fontSize: "1rem",
      fontWeight: 500,
    } as React.CSSProperties,
    instructionText: {
      fontSize: "0.8125rem",
      margin: "1rem 0",
      textAlign: "center",
    } as React.CSSProperties,
  },

  measurementLabel: {
    color: "black",
    fontFamily: "Arial",
    fontSize: 16,
    fontWeight: "bold" as const,
    haloColor: "white",
    haloSize: 2,
    horizontalAlignment: "center" as const,
    verticalAlignment: "middle" as const,
  },

  form: {
    input: {
      borderColor: undefined,
    } as React.CSSProperties,
    inputInvalid: {
      borderColor: "#dc3545",
    } as React.CSSProperties,
  },

  // Widget-specific styles from widget.tsx
  colors: {
    blackTransparent: [0, 0, 0, 0.8] as [number, number, number, number],
    white: [255, 255, 255, 1] as [number, number, number, number],
    orangeFill: [255, 165, 0, 0.2] as [number, number, number, number],
    orangeOutline: [255, 140, 0] as [number, number, number],
  },

  symbols: {
    highlight: {
      type: "simple-fill" as const,
      color: [255, 165, 0, 0.2] as [number, number, number, number],
      outline: {
        color: [255, 140, 0] as [number, number, number],
        width: 2,
        style: "solid" as const,
      },
    },
  },
}
