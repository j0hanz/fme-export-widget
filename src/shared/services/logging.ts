import { getAppStore } from "jimu-core";
import type {
  FmeDebugObject,
  FmeExportConfig,
  FmeWidgetState,
  IMStateWithFmeExport,
} from "../../config/index";
import { ErrorSeverity, ErrorType } from "../../config/index";
import { fmeActions } from "../../extensions/store";
import { clearNetworkHistory, getNetworkHistory } from "../api";
import { fmeQueryClient } from "../query-client";
import { formatArea } from "../utils/format";
import { maskToken } from "../utils/network";

export interface FmeDebugContext {
  readonly widgetId: string | null | undefined;
  readonly config: FmeExportConfig | null | undefined;
}

interface NetworkRequest {
  method: string;
  path: string;
  status?: number;
  ok?: boolean;
  durationMs: number;
  timestamp: number;
}

const SLOW_REQUEST_THRESHOLD_MS = 1000;

/* Module-level flag for conditional logging */
let isLoggingEnabled = false;

/* Sets logging state (called by runtime widget when config changes) */
export const setLoggingEnabled = (enabled: boolean): void => {
  isLoggingEnabled = enabled;
};

/* Gets current logging state */
export const getLoggingEnabled = (): boolean => isLoggingEnabled;

/* Conditional logging helpers - respect enableLogging flag */
export const conditionalLog = (...args: any[]): void => {
  if (isLoggingEnabled) {
    console.log(...args);
  }
};

export const conditionalTable = (
  data: any,
  columns?: readonly string[]
): void => {
  if (isLoggingEnabled) {
    console.table(data, columns as any);
  }
};

export const conditionalWarn = (...args: any[]): void => {
  if (isLoggingEnabled) {
    console.warn(...args);
  }
};

/* Critical errors always log regardless of flag (HTTP errors, auth failures) */
export const criticalError = (...args: any[]): void => {
  console.error(...args);
};

export const DEBUG_STYLES = {
  success: "color: #28a745; font-weight: bold",
  info: "color: #007bff; font-weight: bold",
  warn: "color: #ffc107; font-weight: bold",
  error: "color: #dc3545; font-weight: bold",
  action: "color: #0078d4; font-weight: bold",
} as const;

const logDebugMessage = (
  message: string,
  style: "success" | "info" | "warn" | "error" | "action" = "info",
  ...args: any[]
): void => {
  if (isLoggingEnabled) {
    console.log(`%c[FME Debug] ${message}`, DEBUG_STYLES[style], ...args);
  }
};

const getDebugObject = (): FmeDebugObject | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return (window as any).__FME_DEBUG__ ?? null;
};

const buildSafeConfig = (config: FmeExportConfig | null) => {
  if (!config) {
    return null;
  }
  return {
    serverUrl: config.fmeServerUrl || "[NONE]",
    repository: config.repository || "[NONE]",
    token: config.fmeServerToken ? maskToken(config.fmeServerToken) : "[NONE]",
    timeout: config.requestTimeout,
    largeArea: config.largeArea,
    maxArea: config.maxArea,
  };
};

const buildSafeState = (state: FmeWidgetState | null) => {
  if (!state) {
    return null;
  }
  return {
    viewMode: state.viewMode,
    drawingTool: state.drawingTool,
    hasGeometry: !!state.geometryJson,
    drawnArea: state.drawnArea,
    selectedWorkspace: state.selectedWorkspace,
    hasError: !!(state.errors && Object.keys(state.errors).length > 0),
  };
};

const calculateNetworkStats = (history: readonly NetworkRequest[]) => ({
  total: history.length,
  failed: history.filter((r) => r.ok !== undefined && !r.ok).length,
  avgDurationMs:
    history.length > 0
      ? Math.round(
          history.reduce((sum, r) => sum + r.durationMs, 0) / history.length
        )
      : 0,
  slowRequests: history.filter((r) => r.durationMs > SLOW_REQUEST_THRESHOLD_MS)
    .length,
});

const filterNetworkHistory = (
  history: readonly NetworkRequest[],
  filter?: { failed?: boolean; slow?: boolean }
) => {
  let filtered = [...history];
  if (filter?.failed) {
    filtered = filtered.filter((r) => r.ok !== undefined && !r.ok);
  }
  if (filter?.slow) {
    filtered = filtered.filter((r) => r.durationMs > SLOW_REQUEST_THRESHOLD_MS);
  }
  return filtered;
};

const formatNetworkRequest = (request: NetworkRequest) => ({
  method: request.method ?? "[UNKNOWN]",
  path: request.path ?? "[UNKNOWN]",
  status: request.status ?? "?",
  duration: (request.durationMs ?? 0) + "ms",
  ok: request.ok === undefined ? "?" : request.ok ? "✓" : "✗",
  time: new Date(request.timestamp).toLocaleTimeString(),
});

const copyToClipboard = (text: string): void => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          logDebugMessage("Copied to clipboard", "success");
        },
        (err) => {
          logDebugMessage("Could not copy to clipboard", "error");
          conditionalLog("Clipboard error:", err);
        }
      );
    } else {
      logDebugMessage("Clipboard API not available", "warn");
    }
  } catch (err) {
    logDebugMessage(
      "Clipboard API not available or permissions denied",
      "warn"
    );
    conditionalLog("Clipboard error:", err);
  }
};

const createMockIntlModules = () => ({
  intl: {
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => {
      return value.toLocaleString(undefined, {
        minimumFractionDigits: options?.minimumFractionDigits ?? 0,
        maximumFractionDigits: options?.maximumFractionDigits ?? 2,
      });
    },
  },
});

const collectDebugTargets = (): Window[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const targets: Window[] = [];
  const seen = new Set<Window>();

  const addTarget = (candidate: Window | null | undefined) => {
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    targets.push(candidate);
  };

  let current: Window | null = window;
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Safety limit

  while (current && iterations < MAX_ITERATIONS) {
    addTarget(current);
    let next: Window | null = null;
    try {
      next = current.parent;
    } catch {
      // Cross-origin frame access blocked
      break;
    }
    if (!next || next === current || seen.has(next)) {
      break;
    }
    current = next;
    iterations++;
  }

  try {
    addTarget(window.opener as Window);
  } catch {
    // No opener or cross-origin
  }

  return targets;
};

const safeAssignDebugObject = (
  target: Window,
  debugObj: FmeDebugObject
): void => {
  try {
    Object.defineProperty(target, "__FME_DEBUG__", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: debugObj,
    });
  } catch {
    // defineProperty not supported, fall back to direct assignment
    try {
      (target as any).__FME_DEBUG__ = debugObj;
    } catch {
      // Assignment failed, ignore
    }
  }
};

const safeGetDebugObject = (target: Window): FmeDebugObject | null => {
  try {
    return (target as any).__FME_DEBUG__ ?? null;
  } catch {
    return null;
  }
};

const assignDebugObjectToTargets = (
  debugObj: FmeDebugObject,
  targets: Window[]
): void => {
  targets.forEach((target) => {
    safeAssignDebugObject(target, debugObj);
  });
};

const findExistingDebugObject = (targets: Window[]): FmeDebugObject | null => {
  for (const candidate of targets) {
    const existing = safeGetDebugObject(candidate);
    if (existing) {
      return existing;
    }
  }
  return null;
};

const getWidgetState = (widgetId: string): FmeWidgetState | null => {
  const store = getAppStore();
  const state = store.getState() as IMStateWithFmeExport;
  const globalState = state["fme-state"] as
    | {
        readonly byId?: { readonly [key: string]: FmeWidgetState | undefined };
      }
    | undefined;
  return globalState?.byId?.[widgetId] ?? null;
};

const createStateInspectionHelper = (): (() => void) => {
  return () => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    const state = debugObj.getState?.();
    if (!state) {
      logDebugMessage("No state found", "error");
      return;
    }
    logDebugMessage("Widget State:", "success");
    conditionalTable({
      viewMode: state.viewMode,
      drawingTool: state.drawingTool,
      hasGeometry: !!state.geometryJson,
      drawnArea: state.drawnArea,
      selectedWorkspace: state.selectedWorkspace,
    });
  };
};

const createQueryInspectionHelper = (): (() => void) => {
  return () => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    const queries = debugObj.getQueryCache?.() ?? [];
    logDebugMessage("Query Cache:", "info");
    conditionalTable(
      queries.map((query: any) => ({
        queryKey: JSON.stringify(query.queryKey),
        status: query.state.status,
        hasData: !!query.state.data,
      }))
    );
  };
};

const createResetHelper = (widgetId: string): (() => void) => {
  return () => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    debugObj.dispatch(debugObj.actions.resetState(widgetId));
    logDebugMessage("Widget reset to drawing state", "success");
  };
};

const createTestErrorHelper = (
  widgetId: string
): ((errorType?: string, code?: string) => void) => {
  return (errorType: string = ErrorType.NETWORK, code = "TEST_ERROR") => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    debugObj.dispatch(
      debugObj.actions.setError(
        "general",
        {
          type: errorType as ErrorType,
          code,
          message: "Test error message",
          severity: ErrorSeverity.ERROR,
          recoverable: true,
          timestampMs: Date.now(),
        },
        widgetId
      )
    );
    logDebugMessage("Test error dispatched", "warn");
  };
};

const formatRequestStatus = (request: NetworkRequest): string => {
  const symbol = request.ok === undefined ? "?" : request.ok ? "✓" : "✗";
  const status =
    request.status ?? (request.ok !== undefined && !request.ok ? "error" : "");
  return `${symbol} ${status}`;
};

const createNetworkInspectionHelper = (): ((filter?: {
  failed?: boolean;
  slow?: boolean;
}) => void) => {
  return (filter?: { failed?: boolean; slow?: boolean }) => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    const history = debugObj.getNetworkHistory?.() ?? [];
    const filtered = filterNetworkHistory(history, filter);

    if (filtered.length === 0) {
      logDebugMessage("No network requests found", "warn");
      return;
    }

    logDebugMessage(`Network History (${filtered.length} requests):`, "warn");
    conditionalTable(filtered.map(formatNetworkRequest));
  };
};

const createFullStateHelper = (): (() => void) => {
  return () => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    const state = debugObj.getState?.();
    if (!state) {
      logDebugMessage("No state found", "error");
      return;
    }
    logDebugMessage("Full Widget State:", "success");
    conditionalLog(state);
  };
};

const createConfigHelper = (): (() => void) => {
  return () => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    const config = debugObj.getConfig?.();
    const safeConfig = buildSafeConfig(config);
    if (!safeConfig) {
      logDebugMessage("No config found", "error");
      return;
    }
    logDebugMessage("Widget Config:", "success");
    conditionalTable(safeConfig);
  };
};

const createTimelineHelper = (): (() => void) => {
  return () => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return;
    }
    const network = debugObj.getNetworkHistory?.() ?? [];
    const state = debugObj.getState?.();

    if (network.length === 0) {
      logDebugMessage("No timeline data", "warn");
      return;
    }

    logDebugMessage("Timeline:", "info");

    const timeline = network.map((r: NetworkRequest) => ({
      time: new Date(r.timestamp).toLocaleTimeString(),
      event: `${r.method} ${r.path}`,
      status: formatRequestStatus(r),
      duration: r.durationMs + "ms",
    }));

    conditionalTable(timeline);

    if (state) {
      conditionalLog("Current State:");
      conditionalLog("  View Mode:", state.viewMode);
      conditionalLog("  Has Geometry:", !!state.geometryJson);
      conditionalLog(
        "  Selected Workspace:",
        state.selectedWorkspace || "[NONE]"
      );
    }
  };
};

const createExportDebugInfoHelper = (): (() => string) => {
  return () => {
    const debugObj = getDebugObject();
    if (!debugObj) {
      return "";
    }
    const state = debugObj.getState?.();
    const config = debugObj.getConfig?.();
    const network = debugObj.getNetworkHistory?.() ?? [];
    const queries = debugObj.getQueryCache?.() ?? [];

    const safeConfig = buildSafeConfig(config);
    const safeState = buildSafeState(state);
    const networkSummary = calculateNetworkStats(network);

    const debugPackage = {
      timestamp: new Date().toISOString(),
      widgetId: debugObj.widgetId,
      config: safeConfig,
      state: safeState,
      networkSummary,
      queryCacheSize: queries.length,
      recentRequests: network.slice(-10).map((r: NetworkRequest) => ({
        method: r.method,
        path: r.path,
        status: r.status,
        ok: r.ok,
        durationMs: r.durationMs,
        time: new Date(r.timestamp).toISOString(),
      })),
    };

    const json = JSON.stringify(debugPackage, null, 2);

    logDebugMessage("Debug Package:", "success");
    conditionalLog(json);
    copyToClipboard(json);

    return json;
  };
};

const createDebugObject = (context: {
  readonly widgetId: string;
  readonly config: FmeExportConfig;
}): FmeDebugObject => ({
  widgetId: context.widgetId,
  getConfig: () => context.config,
  getState: () => getWidgetState(context.widgetId),
  getQueryCache: () => {
    const cache = fmeQueryClient.getQueryCache();
    return cache.getAll().map((query) => ({
      queryKey: query.queryKey,
      state: query.state,
      queryHash: query.queryHash,
    }));
  },
  getMutationCache: () => {
    const cache = fmeQueryClient.getMutationCache();
    return cache.getAll().map((mutation) => ({
      mutationId: mutation.mutationId,
      state: mutation.state,
    }));
  },
  clearQueryCache: () => {
    fmeQueryClient.clear();
    logDebugMessage("Query cache cleared", "warn");
  },
  invalidateQueries: (filters?: any) => {
    fmeQueryClient.invalidateQueries(filters);
    logDebugMessage("Queries invalidated", "warn", filters);
  },
  getAppState: () => {
    const store = getAppStore();
    return store.getState();
  },
  dispatch: (action: any) => {
    const store = getAppStore();
    logDebugMessage("Dispatching action:", "action", action);
    store.dispatch(action);
  },
  actions: fmeActions,
  getNetworkHistory: () => getNetworkHistory(),
  clearNetworkHistory: () => {
    clearNetworkHistory();
    logDebugMessage("Network history cleared", "warn");
  },
  utils: {
    maskToken: (token: string) => maskToken(token),
    formatArea: (area: number, spatialReference?: __esri.SpatialReference) =>
      formatArea(area, createMockIntlModules() as any, spatialReference),
    safeLogParams: (params: { [key: string]: any }) => params,
  },
  helpers: {
    inspectState: createStateInspectionHelper(),
    inspectQueries: createQueryInspectionHelper(),
    resetToDrawing: createResetHelper(context.widgetId),
    testError: createTestErrorHelper(context.widgetId),
    inspectNetwork: createNetworkInspectionHelper(),
    showFullState: createFullStateHelper(),
    showConfig: createConfigHelper(),
    showTimeline: createTimelineHelper(),
    exportDebugInfo: createExportDebugInfoHelper(),
  },
});

const normalizeWidgetId = (raw: string | null | undefined): string | null => {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const validateDebugContext = (
  context: FmeDebugContext
): { widgetId: string; config: FmeExportConfig; targets: Window[] } | null => {
  const widgetId = normalizeWidgetId(context.widgetId);
  if (!widgetId || !context.config) {
    return null;
  }

  const targets = collectDebugTargets();
  if (targets.length === 0) {
    return null;
  }

  return { widgetId, config: context.config, targets };
};

export const setupFmeDebugTools = (context: FmeDebugContext): void => {
  const validated = validateDebugContext(context);
  if (!validated) {
    return;
  }

  const { widgetId, config, targets } = validated;

  const hadExisting = Boolean(findExistingDebugObject(targets));
  const debugObj = createDebugObject({ widgetId, config });

  assignDebugObjectToTargets(debugObj, targets);

  if (!hadExisting) {
    logDebugMessage(
      "Global debug object available at window.__FME_DEBUG__",
      "action"
    );
    logDebugMessage(
      "Try: __FME_DEBUG__.getState() or __FME_DEBUG__.getConfig()",
      "action"
    );
    logDebugMessage(
      "Helpers: __FME_DEBUG__.helpers.inspectState() | inspectQueries() | inspectNetwork()",
      "action"
    );
    logDebugMessage(
      "Export: __FME_DEBUG__.helpers.exportDebugInfo() | showTimeline() | showConfig()",
      "action"
    );
  }
};

export const updateFmeDebugTools = (context: FmeDebugContext): void => {
  const validated = validateDebugContext(context);
  if (!validated) {
    return;
  }

  const { widgetId, config, targets } = validated;

  if (!findExistingDebugObject(targets)) {
    return;
  }

  const debugObj = createDebugObject({ widgetId, config });
  assignDebugObjectToTargets(debugObj, targets);
};
