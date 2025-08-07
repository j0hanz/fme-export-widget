import { React, hooks, ReactRedux, getAppStore } from "jimu-core"
import { Loading, LoadingType } from "jimu-ui"
import type {
  ErrorState,
  LoadingConfig,
  StateActionButton,
  StateControllerReturn,
  StateRendererProps,
} from "../../shared/types"
import {
  ErrorType,
  ErrorSeverity,
  StateType as StateTypeEnum,
} from "../../shared/types"
import { fmeActions } from "../../extensions/store"
import { getUiStateSlice } from "../../shared/utils"
import { STYLES } from "../../shared/css"

export const useStateController = (widgetId: string): StateControllerReturn => {
  // Get current state from Redux store using optimized selector
  const { uiState, uiStateData } = ReactRedux.useSelector((state: any) =>
    getUiStateSlice(state, widgetId)
  )

  // Use getAppStore for proper dispatch typing in Experience Builder
  const dispatch = hooks.useEventCallback((action: any) => {
    getAppStore().dispatch(action)
  })

  const setIdle = hooks.useEventCallback(() => {
    dispatch(fmeActions.setUiState(StateTypeEnum.IDLE))
    dispatch(fmeActions.setUiStateData({}))
  })

  const setLoading = hooks.useEventCallback(
    (message?: string, detail?: string, config?: LoadingConfig) => {
      dispatch(fmeActions.setUiState(StateTypeEnum.LOADING))
      dispatch(fmeActions.setUiStateData({ message, detail, config }))
    }
  )

  const setError = hooks.useEventCallback(
    (
      error: ErrorState | string,
      actions?: StateActionButton[],
      context?: {
        details?: { [key: string]: any }
        userAction?: string
        troubleshooting?: string
        recoverable?: boolean
        retry?: () => void
      }
    ) => {
      let errorState: ErrorState

      if (typeof error === "string") {
        // Create an enhanced error with context if provided
        if (context) {
          errorState = {
            message: error,
            severity: ErrorSeverity.ERROR,
            type: ErrorType.API,
            timestamp: new Date(),
            details: context.details || {},
            recoverable: context.recoverable || false,
            retry: context.retry,
          }
        } else {
          // Simple string error with no context
          errorState = {
            message: error,
            severity: ErrorSeverity.ERROR,
            type: ErrorType.API,
            timestamp: new Date(),
          }
        }
      } else {
        // We already have an ErrorState object
        errorState = error

        // If context is provided, enhance the existing error
        if (context) {
          const { details, userAction, troubleshooting } = context
          let enhancedMessage = errorState.message

          if (userAction) {
            enhancedMessage += `\n\nRecommended action: ${userAction}`
          }

          if (troubleshooting) {
            enhancedMessage += `\n\nTroubleshooting: ${troubleshooting}`
          }

          errorState = {
            ...errorState,
            message: enhancedMessage,
            details: details || {},
            recoverable:
              context.recoverable !== undefined
                ? context.recoverable
                : errorState.recoverable,
            retry: context.retry || errorState.retry,
          }
        }
      }

      dispatch(fmeActions.setUiState(StateTypeEnum.ERROR))
      dispatch(fmeActions.setUiStateData({ error: errorState, actions }))
    }
  )

  const setSuccess = hooks.useEventCallback(
    (message?: string, detail?: string, actions?: StateActionButton[]) => {
      dispatch(fmeActions.setUiState(StateTypeEnum.SUCCESS))
      dispatch(fmeActions.setUiStateData({ message, detail, actions }))
    }
  )

  const setContent = hooks.useEventCallback((_children: React.ReactNode) => {
    dispatch(fmeActions.setUiState(StateTypeEnum.CONTENT))
    dispatch(fmeActions.setUiStateData({}))
  })

  const setEmpty = hooks.useEventCallback((message?: string) => {
    dispatch(fmeActions.setUiState(StateTypeEnum.EMPTY))
    dispatch(fmeActions.setUiStateData({ message }))
  })

  const reset = hooks.useEventCallback(() => {
    dispatch(fmeActions.setUiState(StateTypeEnum.IDLE))
    dispatch(fmeActions.setUiStateData({}))
  })

  return {
    currentState: uiState,
    data: uiStateData,
    isLoading: uiState === StateTypeEnum.LOADING,
    hasError: uiState === StateTypeEnum.ERROR,
    isEmpty: uiState === StateTypeEnum.EMPTY,
    isSuccess: uiState === StateTypeEnum.SUCCESS,
    hasContent: uiState === StateTypeEnum.CONTENT,

    // Actions
    setIdle,
    setLoading,
    setError,
    setSuccess,
    setContent,
    setEmpty,
    reset,
  }
}

export const StateRenderer: React.FC<StateRendererProps> = ({
  state,
  data = {},
  children,
}) => {
  if (state === StateTypeEnum.LOADING) {
    const loadingType = LoadingType.Donut

    return (
      <div style={STYLES.state.detail} role="status" aria-live="polite">
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
    // Extract error details
    const errorState = data.error
    const message = errorState?.message || "An error occurred"
    const code = errorState?.code
    const severity = errorState?.severity || ErrorSeverity.ERROR
    const isRecoverable = errorState?.recoverable || false
    const retryFn = errorState?.retry

    // Generate dynamic action buttons based on error properties
    const dynamicActions: StateActionButton[] = []

    // Add retry action if the error is recoverable
    if (isRecoverable && retryFn) {
      dynamicActions.push({
        label: "Retry",
        onClick: retryFn,
        variant: "primary",
      })
    }

    // Combine provided actions with dynamic actions
    const combinedActions = [...(data.actions || []), ...dynamicActions]

    // Parse message to extract contextual information
    const hasNewLines = message.includes("\n")
    const messageLines = hasNewLines
      ? message.split("\n").filter(Boolean)
      : [message]

    // First line is always the main error message
    const mainMessage = messageLines[0]

    // Find recommended action if present
    const recommendedActionLine = messageLines.find((line) =>
      line.toLowerCase().includes("recommended action:")
    )

    // Find troubleshooting info if present
    const troubleshootingLine = messageLines.find((line) =>
      line.toLowerCase().includes("troubleshooting:")
    )

    return (
      <div role="alert" aria-live="assertive">
        <div>
          <div>{mainMessage}</div>
          {code && <div>Error code: {code}</div>}

          {/* Severity indicators */}
          {severity === ErrorSeverity.WARNING && (
            <div role="status">
              Warning: This operation may have partially succeeded.
            </div>
          )}
          {severity === ErrorSeverity.INFO && (
            <div role="status">Info: This is an informational message.</div>
          )}

          {/* Enhanced contextual information */}
          {recommendedActionLine && <div>{recommendedActionLine}</div>}
          {troubleshootingLine && <div>{troubleshootingLine}</div>}
        </div>

        {/* Action buttons */}
        {combinedActions.length > 0 && (
          <div role="group" aria-label="Error recovery actions">
            {combinedActions.map((action, index) => (
              <button
                key={index}
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={`${action.label} - ${action.disabled ? "disabled" : "available"}`}
                tabIndex={action.disabled ? -1 : 0}
              >
                {action.label}
              </button>
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
              <button
                key={index}
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={`${action.label} - ${action.disabled ? "disabled" : "available"}`}
                tabIndex={action.disabled ? -1 : 0}
              >
                {action.label}
              </button>
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
