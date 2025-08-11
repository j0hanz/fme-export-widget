import { React } from "jimu-core"
import { Loading, LoadingType } from "jimu-ui"
import type { StateActionButton, StateRendererProps } from "../../shared/types"
import { ErrorSeverity, StateType as StateTypeEnum } from "../../shared/types"
import { Button } from "./ui"
import { STYLES } from "../../shared/css"

// Helper function to combine actions with retry action if available
const combineActionsWithRetry = (
  actions: StateActionButton[] = [],
  isRecoverable: boolean,
  retryFn?: () => void
): StateActionButton[] => {
  const combinedActions = [...actions]
  if (isRecoverable && retryFn) {
    combinedActions.push({
      label: "Retry",
      onClick: retryFn,
      variant: "primary",
    })
  }
  return combinedActions
}

// Helper function to render severity indicators
const SeverityIndicator: React.FC<{ severity: ErrorSeverity }> = ({
  severity,
}) => {
  if (severity === ErrorSeverity.WARNING) {
    return (
      <div role="status">
        Warning: This operation may have partially succeeded.
      </div>
    )
  }
  if (severity === ErrorSeverity.INFO) {
    return <div role="status">Info: This is an informational message.</div>
  }
  return null
}

// Optimized StateRenderer with React.memo to prevent unnecessary re-renders
export const StateRenderer: React.FC<StateRendererProps> = React.memo(
  ({ state, data = {}, children }) => {
    if (state === StateTypeEnum.LOADING) {
      const loadingType = LoadingType.Donut
      return (
        <div style={STYLES.state.centered} role="status" aria-live="polite">
          <Loading type={loadingType} width={200} height={200} />
          {(data.message || data.detail) && (
            <div style={STYLES.state.text} aria-label="Loading details">
              {data.message && <div>{data.message}</div>}
            </div>
          )}
        </div>
      )
    }

    if (state === StateTypeEnum.CONTENT) {
      // Use children prop first, then fall back to data.children
      const contentChildren = children || data.children
      return contentChildren ? <>{contentChildren}</> : null
    }

    if (state === StateTypeEnum.ERROR) {
      const errorState = data.error
      const message = errorState?.message || "An error occurred"
      const code = errorState?.code
      const severity = errorState?.severity || ErrorSeverity.ERROR
      const isRecoverable = errorState?.recoverable || false
      const retryFn = errorState?.retry

      const combinedActions = combineActionsWithRetry(
        data.actions,
        isRecoverable,
        retryFn
      )

      return (
        <div role="alert" aria-live="assertive" style={STYLES.state.centered}>
          <div>{message}</div>
          {code && <div>Error code: {code}</div>}

          <SeverityIndicator severity={severity} />

          {combinedActions.length > 0 && (
            <div role="group" aria-label="Error recovery actions">
              {combinedActions.map((action, index) => (
                <Button
                  key={index}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  aria-label={`${action.label} - ${action.disabled ? "disabled" : "available"}`}
                  tabIndex={action.disabled ? -1 : 0}
                  text={action.label}
                />
              ))}
            </div>
          )}
        </div>
      )
    }

    if (state === StateTypeEnum.SUCCESS) {
      return (
        <div role="status" aria-live="polite">
          {data.actions && data.actions.length > 0 && (
            <div role="group" aria-label="Success actions">
              {data.actions.map((action, index) => (
                <Button
                  key={index}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  aria-label={`${action.label} - ${action.disabled ? "disabled" : "available"}`}
                  tabIndex={action.disabled ? -1 : 0}
                  text={action.label}
                />
              ))}
            </div>
          )}
        </div>
      )
    }

    if (state === StateTypeEnum.EMPTY) {
      return (
        <div role="status" aria-live="polite">
          <div>{data.message || "No data available"}</div>
        </div>
      )
    }

    return null
  }
)
