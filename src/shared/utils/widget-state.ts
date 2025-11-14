import { WidgetState } from "jimu-core";

/**
 * Widget state transition utilities
 * Provides helpers for detecting and reacting to widget lifecycle changes
 */

export interface StateTransitionConfig {
  readonly fromStates: readonly WidgetState[];
  readonly toStates: readonly WidgetState[];
}

/**
 * Checks if a state transition occurred from any fromState to any toState
 */
export const isStateTransition = (
  prevState: WidgetState | undefined,
  currentState: WidgetState | undefined,
  config: StateTransitionConfig
): boolean => {
  if (!prevState || !currentState) return false;

  const isFromState = config.fromStates.includes(prevState);
  const isToState = config.toStates.includes(currentState);

  return isFromState && isToState;
};

/**
 * Pre-defined common state transitions
 */
export const STATE_TRANSITIONS = {
  /** Widget was opened or activated */
  TO_ACTIVE: {
    fromStates: [WidgetState.Closed, WidgetState.Hidden] as const,
    toStates: [WidgetState.Opened, WidgetState.Active] as const,
  },
  /** Widget was closed or hidden */
  TO_INACTIVE: {
    fromStates: [WidgetState.Opened, WidgetState.Active] as const,
    toStates: [WidgetState.Closed, WidgetState.Hidden] as const,
  },
  /** Widget was fully closed (not just hidden) */
  TO_CLOSED: {
    fromStates: [WidgetState.Opened, WidgetState.Active] as const,
    toStates: [WidgetState.Closed] as const,
  },
  /** Widget was opened from closed */
  FROM_CLOSED: {
    fromStates: [WidgetState.Closed] as const,
    toStates: [WidgetState.Opened, WidgetState.Active] as const,
  },
} as const;

/**
 * Checks if widget is in an active state (opened or active)
 */
export const isWidgetActive = (
  state: WidgetState | string | undefined
): boolean => {
  if (!state) return false;
  const normalized = String(state).toUpperCase();
  return normalized === WidgetState.Opened || normalized === WidgetState.Active;
};

/**
 * Checks if widget is in an inactive state (closed or hidden)
 */
export const isWidgetInactive = (
  state: WidgetState | string | undefined
): boolean => {
  if (!state) return true;
  const normalized = String(state).toUpperCase();
  return normalized === WidgetState.Closed || normalized === WidgetState.Hidden;
};

/**
 * Logs widget state transitions for debugging
 */
export const logStateTransition = (
  widgetId: string,
  prevState: WidgetState | undefined,
  currentState: WidgetState | undefined,
  context?: { [key: string]: unknown }
): void => {
  const prevLabel = prevState || "undefined";
  const currentLabel = currentState || "undefined";

  console.log(
    `[FME Widget ${widgetId}] State transition: ${prevLabel} → ${currentLabel}`,
    context ? { ...context } : ""
  );
};

/**
 * Creates a state transition detector that can be reused
 */
export const createStateTransitionDetector = (widgetId: string) => {
  return {
    isTransition: (
      prevState: WidgetState | undefined,
      currentState: WidgetState | undefined,
      config: StateTransitionConfig
    ): boolean => {
      return isStateTransition(prevState, currentState, config);
    },

    log: (
      prevState: WidgetState | undefined,
      currentState: WidgetState | undefined,
      context?: { [key: string]: unknown }
    ): void => {
      logStateTransition(widgetId, prevState, currentState, context);
    },

    isActive: (state: WidgetState | string | undefined): boolean => {
      return isWidgetActive(state);
    },

    isInactive: (state: WidgetState | string | undefined): boolean => {
      return isWidgetInactive(state);
    },
  };
};
