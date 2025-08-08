import { React, hooks, ReactRedux, getAppStore } from "jimu-core"
import type { IMState } from "jimu-core"
import { Loading, LoadingType } from "jimu-ui"
import type {
  ErrorState,
  LoadingConfig,
  StateActionButton,
  StateControllerReturn,
  StateRendererProps,
  FmeWidgetState,
} from "../../shared/types"
import {
  ErrorType,
  ErrorSeverity,
  StateType as StateTypeEnum,
} from "../../shared/types"
import { Button } from "./ui"
import { fmeActions } from "../../extensions/store"
import { STYLES } from "../../shared/css"

// State Management Utilities
export const getFmeWidgetState = (
  state: IMState,
  widgetId: string
): FmeWidgetState | undefined => {
  return state.widgetsState?.[widgetId]?.["fme-state"]
}

export const getUiStateSlice = (state: IMState, widgetId: string) => {
  const fmeState = getFmeWidgetState(state, widgetId)
  return {
    uiState: fmeState?.uiState || StateTypeEnum.IDLE,
    uiStateData: fmeState?.uiStateData || {},
  }
}

// Helper function to create error state from string or ErrorState
const createErrorState = (error: ErrorState | string): ErrorState => {
  return typeof error === "string"
    ? {
        message: error,
        severity: ErrorSeverity.ERROR,
        type: ErrorType.API,
        timestamp: new Date(),
      }
    : error
}

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

export const useStateController = (widgetId: string): StateControllerReturn => {
  const { uiState, uiStateData } = ReactRedux.useSelector((state: any) =>
    getUiStateSlice(state, widgetId)
  )

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
    (error: ErrorState | string, actions?: StateActionButton[]) => {
      const errorState = createErrorState(error)
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
