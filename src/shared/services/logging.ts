import { getAppStore } from "jimu-core"
import { fmeQueryClient } from "../query-client"
import { fmeActions } from "../../extensions/store"
import type {
  FmeDebugObject,
  FmeExportConfig,
  FmeWidgetState,
  IMStateWithFmeExport,
} from "../../config/index"
import { ErrorSeverity, ErrorType } from "../../config/index"

export interface FmeDebugContext {
  readonly widgetId: string | null | undefined
  readonly config: FmeExportConfig | null | undefined
}

const collectDebugTargets = (): Window[] => {
  if (typeof window === "undefined") {
    return []
  }

  const targets: Window[] = []
  const seen = new Set<Window>()

  const addTarget = (candidate: Window | null | undefined) => {
    if (!candidate || seen.has(candidate)) {
      return
    }
    seen.add(candidate)
    targets.push(candidate)
  }

  let current: Window | null = window
  while (current) {
    addTarget(current)
    let next: Window | null = null
    try {
      next = current.parent
    } catch {
      break
    }
    if (!next || next === current) {
      break
    }
    current = next
  }

  try {
    addTarget(window.opener as Window)
  } catch {}

  return targets
}

const assignDebugObjectToTargets = (
  debugObj: FmeDebugObject,
  targets: Window[]
): void => {
  targets.forEach((target) => {
    try {
      Object.defineProperty(target, "__FME_DEBUG__", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: debugObj,
      })
    } catch {
      try {
        ;(target as any).__FME_DEBUG__ = debugObj
      } catch {}
    }
  })
}

const findExistingDebugObject = (targets: Window[]): any => {
  for (const candidate of targets) {
    try {
      const existing = (candidate as any).__FME_DEBUG__
      if (existing) {
        return existing
      }
    } catch {}
  }
  return null
}

const getWidgetState = (widgetId: string): FmeWidgetState | null => {
  const store = getAppStore()
  const state = store.getState() as IMStateWithFmeExport
  const globalState = state["fme-state"] as
    | {
        readonly byId?: { readonly [key: string]: FmeWidgetState | undefined }
      }
    | undefined
  return globalState?.byId?.[widgetId] ?? null
}

const createDebugObject = (context: {
  readonly widgetId: string
  readonly config: FmeExportConfig
}): FmeDebugObject => ({
  widgetId: context.widgetId,
  getConfig: () => context.config,
  getState: () => getWidgetState(context.widgetId),
  getQueryCache: () => {
    const cache = fmeQueryClient.getQueryCache()
    return cache.getAll().map((query) => ({
      queryKey: query.queryKey,
      state: query.state,
      queryHash: query.queryHash,
    }))
  },
  getMutationCache: () => {
    const cache = fmeQueryClient.getMutationCache()
    return cache.getAll().map((mutation) => ({
      mutationId: mutation.mutationId,
      state: mutation.state,
    }))
  },
  clearQueryCache: () => {
    fmeQueryClient.clear()
    console.log(
      "%c[FME Debug] Query cache cleared",
      "color: #FF9800; font-weight: bold"
    )
  },
  invalidateQueries: (filters?: any) => {
    fmeQueryClient.invalidateQueries(filters)
    console.log(
      "%c[FME Debug] Queries invalidated",
      "color: #FF9800; font-weight: bold",
      filters
    )
  },
  getAppState: () => {
    const store = getAppStore()
    return store.getState()
  },
  dispatch: (action: any) => {
    const store = getAppStore()
    console.log(
      "%c[FME Debug] Dispatching action:",
      "color: #9C27B0; font-weight: bold",
      action
    )
    store.dispatch(action)
  },
  actions: fmeActions,
  utils: {
    maskToken: (token: string) => {
      const { maskToken } = require("../utils/network")
      return maskToken(token)
    },
    formatArea: (area: number, spatialReference?: __esri.SpatialReference) => {
      const { formatArea } = require("../utils/format")
      const mockModules = {
        intl: {
          formatNumber: (value: number, options: any) => {
            return value.toLocaleString(undefined, {
              minimumFractionDigits: options.minimumFractionDigits || 0,
              maximumFractionDigits: options.maximumFractionDigits || 2,
            })
          },
        },
      }
      return formatArea(area, mockModules as any, spatialReference)
    },
    safeLogParams: (params: { [key: string]: any }) => {
      const { safeLogParams } = require("../utils/network")
      return safeLogParams(params)
    },
  },
  helpers: {
    inspectState: () => {
      const debugObj = (window as any).__FME_DEBUG__
      const state = debugObj?.getState?.()
      if (!state) {
        console.log("%c[FME Debug] No state found", "color: #F44336")
        return
      }
      console.log(
        "%c[FME Debug] Widget State:",
        "color: #4CAF50; font-weight: bold"
      )
      console.table({
        viewMode: state.viewMode,
        drawingTool: state.drawingTool,
        hasGeometry: !!state.geometryJson,
        drawnArea: state.drawnArea,
        selectedWorkspace: state.selectedWorkspace,
      })
    },
    inspectQueries: () => {
      const debugObj = (window as any).__FME_DEBUG__
      const queries = debugObj?.getQueryCache?.() ?? []
      console.log(
        "%c[FME Debug] Query Cache:",
        "color: #2196F3; font-weight: bold"
      )
      queries.forEach((query: any) => {
        console.log("Query:", query.queryKey)
        console.log("Status:", query.state.status)
        console.log("Data:", query.state.data)
        console.log("---")
      })
    },
    resetToDrawing: () => {
      const debugObj = (window as any).__FME_DEBUG__
      if (!debugObj) {
        return
      }
      debugObj.dispatch(debugObj.actions.resetState(context.widgetId))
      console.log(
        "%c[FME Debug] Widget reset to drawing state",
        "color: #4CAF50"
      )
    },
    testError: (
      errorType: ErrorType = ErrorType.NETWORK,
      code = "TEST_ERROR"
    ) => {
      const debugObj = (window as any).__FME_DEBUG__
      if (!debugObj) {
        return
      }
      debugObj.dispatch(
        debugObj.actions.setError(
          "general",
          {
            type: errorType,
            code,
            message: "Test error message",
            severity: ErrorSeverity.ERROR,
            scope: "general",
            recoverable: true,
            timestampMs: Date.now(),
          },
          context.widgetId
        )
      )
      console.log("%c[FME Debug] Test error dispatched", "color: #FF9800")
    },
  },
})

const normalizeWidgetId = (raw: string | null | undefined): string | null => {
  if (typeof raw !== "string") {
    return null
  }
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : null
}

export const setupFmeDebugTools = (context: FmeDebugContext): void => {
  const widgetId = normalizeWidgetId(context.widgetId)
  if (!widgetId || !context.config) {
    return
  }

  const targets = collectDebugTargets()
  if (targets.length === 0) {
    return
  }

  const hadExisting = Boolean(findExistingDebugObject(targets))
  const debugObj = createDebugObject({ widgetId, config: context.config })

  assignDebugObjectToTargets(debugObj, targets)

  if (!hadExisting) {
    console.log(
      "%c[FME Debug] Global debug object available at window.__FME_DEBUG__",
      "color: #4CAF50; font-weight: bold"
    )
    console.log(
      "%cTry: __FME_DEBUG__.getState() or __FME_DEBUG__.getConfig()",
      "color: #2196F3"
    )
    console.log(
      "%cHelpers: __FME_DEBUG__.helpers.inspectState() or __FME_DEBUG__.helpers.inspectQueries()",
      "color: #9C27B0"
    )
  }
}

export const updateFmeDebugTools = (context: FmeDebugContext): void => {
  const widgetId = normalizeWidgetId(context.widgetId)
  if (!widgetId || !context.config) {
    return
  }

  const targets = collectDebugTargets()
  if (targets.length === 0) {
    return
  }

  if (!findExistingDebugObject(targets)) {
    return
  }

  const debugObj = createDebugObject({ widgetId, config: context.config })
  assignDebugObjectToTargets(debugObj, targets)
}
