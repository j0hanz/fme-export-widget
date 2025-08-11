import { React } from "jimu-core"
import { Loading, LoadingType } from "jimu-ui"
import type { StateActionButton, StateRendererProps } from "../../shared/types"
import { ErrorSeverity, StateType as StateTypeEnum } from "../../shared/types"
import { Button } from "./ui"
import { STYLES } from "../../shared/css"

// Append retry action if allowed
const combineActionsWithRetry = (
  actions: StateActionButton[] = [],
  recoverable: boolean,
  retry?: () => void
): StateActionButton[] =>
  recoverable && retry
    ? [...actions, { label: "Retry", onClick: retry, variant: "primary" }]
    : actions

// Severity indicator
const SeverityIndicator: React.FC<{ severity: ErrorSeverity }> = ({
  severity,
}) =>
  severity === ErrorSeverity.WARNING ? (
    <div role="status">Warning: Partial success.</div>
  ) : severity === ErrorSeverity.INFO ? (
    <div role="status">Info.</div>
  ) : null

// State renderer
export const StateRenderer: React.FC<StateRendererProps> = React.memo(
  ({ state, data = {}, children }) => {
    const renderActions = (
      actions?: StateActionButton[],
      label: string = "Actions"
    ) =>
      actions && actions.length > 0 ? (
        <div role="group" aria-label={label}>
          {actions.map((action, index) => (
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
      ) : null

    if (state === StateTypeEnum.LOADING) {
      return (
        <div style={STYLES.state.centered} role="status" aria-live="polite">
          <Loading type={LoadingType.Donut} width={200} height={200} />
          {(data.message || data.detail) && (
            <div style={STYLES.state.text} aria-label="Loading details">
              {data.message && <div>{data.message}</div>}
            </div>
          )}
        </div>
      )
    }

    if (state === StateTypeEnum.CONTENT) return <>{children || data.children}</>

    if (state === StateTypeEnum.ERROR) {
      const e = data.error
      const severity = e?.severity || ErrorSeverity.ERROR
      const actions = combineActionsWithRetry(
        data.actions,
        !!e?.recoverable,
        e?.retry
      )
      return (
        <div role="alert" aria-live="assertive">
          <div style={STYLES.typography.title}>
            {e?.userFriendlyMessage || e?.message || "An error occurred"}
          </div>
          {e?.userFriendlyMessage && e?.message && (
            <div style={STYLES.typography.caption}>Detaljer: {e.message}</div>
          )}
          {e?.code && (
            <div style={STYLES.typography.caption}>Code: {e.code}</div>
          )}
          {e?.suggestion && (
            <div style={STYLES.typography.caption}>{e.suggestion}</div>
          )}
          <div style={STYLES.typography.caption}>
            <SeverityIndicator severity={severity} />
          </div>
          {renderActions(actions, "Error actions")}
        </div>
      )
    }

    if (state === StateTypeEnum.SUCCESS)
      return (
        <div role="status" aria-live="polite">
          {renderActions(data.actions, "Success actions")}
        </div>
      )

    if (state === StateTypeEnum.EMPTY)
      return (
        <div role="status" aria-live="polite">
          <div>{data.message || "No data available"}</div>
        </div>
      )

    return null
  }
)
