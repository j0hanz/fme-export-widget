import { React, hooks } from "jimu-core"
import { useSelector } from "react-redux"
import type { JimuMapView } from "jimu-arcgis"
import type {
  EsriModules,
  ErrorState,
  ErrorType,
  WorkspaceLoaderOptions,
  WorkspaceParameter,
  WorkspaceItemDetail,
  WorkspaceItem,
  FormPrimitive,
  FormValues,
  LoadingSnapshot,
} from "../config/index"
import {
  ErrorSeverity,
  LOADING_TIMEOUT_MS,
  ESRI_MODULES_TO_LOAD,
  MS_LOADING,
  WORKSPACE_ITEM_TYPE,
} from "../config/index"
import { fmeActions } from "../extensions/store"
import {
  loadArcgisModules,
  resolveMessageOrKey,
  toTrimmedString,
  isAbortError,
} from "./utils"

// ArcGIS Resource Utilities
const executeSafely = <T>(
  resource: T | null | undefined,
  operation: (value: T) => void
): void => {
  if (!resource) return
  try {
    operation(resource)
  } catch {}
}

export const safeCancelSketch = (vm?: __esri.SketchViewModel | null): void => {
  executeSafely(vm, (model) => {
    model.cancel()
  })
}

export const safeClearLayer = (layer?: __esri.GraphicsLayer | null): void => {
  executeSafely(layer, (graphics) => {
    graphics.removeAll()
  })
}

export const destroyGraphicsLayer = (
  layer?: __esri.GraphicsLayer | null
): void => {
  executeSafely(layer, (graphics) => {
    const destroyFn = (graphics as { destroy?: () => void }).destroy
    if (typeof destroyFn === "function") {
      destroyFn.call(graphics)
    }
  })
}

export const removeLayerFromMap = (
  jmv?: JimuMapView | null,
  layer?: __esri.GraphicsLayer | null
): void => {
  if (!jmv?.view?.map) return
  executeSafely(layer, (graphicsLayer) => {
    if (graphicsLayer.parent) {
      jmv.view.map.remove(graphicsLayer)
    }
  })
}

type DebouncedFn<T extends (...args: any[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void
  flush: () => void
  isPending: () => boolean
}

interface UseDebounceOptions {
  onPendingChange?: (pending: boolean) => void
}

export const useDebounce = <T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
  options?: UseDebounceOptions
): DebouncedFn<T> => {
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = React.useRef(false)
  const lastArgsRef = React.useRef<Parameters<T> | null>(null)
  const callbackRef = hooks.useLatest(callback)
  const optionsRef = hooks.useLatest(options)

  const notifyPending = hooks.useEventCallback((next: boolean) => {
    if (pendingRef.current === next) {
      return
    }
    pendingRef.current = next
    const handler = optionsRef.current?.onPendingChange
    if (typeof handler === "function") {
      try {
        handler(next)
      } catch {}
    }
  })

  const cancel = hooks.useEventCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    lastArgsRef.current = null
    if (pendingRef.current) {
      notifyPending(false)
    }
  })

  const run = hooks.useEventCallback((...args: Parameters<T>) => {
    lastArgsRef.current = args
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    notifyPending(true)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      lastArgsRef.current = null
      try {
        callbackRef.current(...args)
      } finally {
        notifyPending(false)
      }
    }, delay)
  })

  const flush = hooks.useEventCallback(() => {
    if (!lastArgsRef.current) {
      return
    }
    const args = lastArgsRef.current
    cancel()
    callbackRef.current(...args)
  })

  const debouncedRef = React.useRef<DebouncedFn<T> | null>(null)
  const runRef = hooks.useLatest(run)
  const cancelRef = hooks.useLatest(cancel)
  const flushRef = hooks.useLatest(flush)

  if (!debouncedRef.current) {
    const runner = ((...args: Parameters<T>) => {
      runRef.current(...args)
    }) as DebouncedFn<T>
    runner.cancel = () => cancelRef.current()
    runner.flush = () => flushRef.current()
    runner.isPending = () => pendingRef.current
    debouncedRef.current = runner
  }

  hooks.useEffectOnce(() => {
    return () => {
      cancelRef.current()
    }
  })

  const debounced = debouncedRef.current
  if (!debounced) {
    throw new Error('debounceUnavailable')
  }
  return debounced
}

// ArcGIS Modules Loader Hook
export const useEsriModules = (
  reloadSignal: number
): {
  modules: EsriModules | null
  loading: boolean
  errorKey: string | null
} => {
  const [state, setState] = React.useState<{
    modules: EsriModules | null
    loading: boolean
    errorKey: string | null
  }>({ modules: null, loading: true, errorKey: null })

  hooks.useEffectWithPreviousValues(() => {
    let cancelled = false

    setState((prev) => ({
      modules: reloadSignal === 0 ? prev.modules : null,
      loading: true,
      errorKey: null,
    }))

    const loadModules = async () => {
      try {
        const loaded = await loadArcgisModules(ESRI_MODULES_TO_LOAD)
        if (cancelled) return

        const [
          SketchViewModel,
          GraphicsLayer,
          geometryEngine,
          geometryEngineAsync,
          webMercatorUtils,
          projection,
          SpatialReference,
          normalizeUtils,
          Polyline,
          Polygon,
          Graphic,
        ] = loaded

        try {
          const proj = projection as any
          if (proj?.load && typeof proj.load === "function") {
            await proj.load()
          }
        } catch {}

        const geometryOperators =
          (geometryEngineAsync as any)?.operators ??
          (geometryEngine as any)?.operators ??
          null

        setState({
          modules: {
            SketchViewModel,
            GraphicsLayer,
            geometryEngine,
            geometryEngineAsync,
            webMercatorUtils,
            projection,
            SpatialReference,
            normalizeUtils,
            Polyline,
            Polygon,
            Graphic,
            geometryOperators,
          } as EsriModules,
          loading: false,
          errorKey: null,
        })
      } catch (error) {
        if (!cancelled) {
          setState({ modules: null, loading: false, errorKey: "errorMapInit" })
        }
      }
    }

    void loadModules()
    return () => {
      cancelled = true
    }
  }, [reloadSignal])

  return state
}

// Map Resources Management
export const useMapResources = () => {
  const [state, setState] = React.useState<{
    jimuMapView: JimuMapView | null
    sketchViewModel: __esri.SketchViewModel | null
    graphicsLayer: __esri.GraphicsLayer | null
    cleanupHandles: (() => void) | null
  }>({
    jimuMapView: null,
    sketchViewModel: null,
    graphicsLayer: null,
    cleanupHandles: null,
  })

  const updateResource = hooks.useEventCallback(
    <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => {
      setState((prev) => {
        if (
          key === "sketchViewModel" &&
          prev.sketchViewModel &&
          prev.sketchViewModel !== value
        ) {
          try {
            const cleaner = (prev.sketchViewModel as any)?.__fmeCleanup__
            if (typeof cleaner === "function") {
              cleaner()
            }
          } catch {}
        }

        if (
          key === "cleanupHandles" &&
          prev.cleanupHandles &&
          prev.cleanupHandles !== value
        ) {
          try {
            prev.cleanupHandles()
          } catch {}
        }

        return { ...prev, [key]: value }
      })
    }
  )

  const releaseDrawingResources = hooks.useEventCallback(
    (resetMapView: boolean) => {
      const { sketchViewModel, graphicsLayer, jimuMapView, cleanupHandles } =
        state

      if (cleanupHandles) {
        try {
          cleanupHandles()
        } catch {}
      }

      safeCancelSketch(sketchViewModel)
      executeSafely(sketchViewModel, (model) => {
        if (typeof model.destroy === "function") {
          model.destroy()
        }
      })

      removeLayerFromMap(jimuMapView, graphicsLayer)
      safeClearLayer(graphicsLayer)
      destroyGraphicsLayer(graphicsLayer)

      setState((prev) => ({
        ...prev,
        jimuMapView: resetMapView ? null : prev.jimuMapView,
        sketchViewModel: null,
        graphicsLayer: null,
        cleanupHandles: null,
      }))
    }
  )

  const teardownDrawingResources = hooks.useEventCallback(() => {
    releaseDrawingResources(false)
  })

  const cleanupResources = hooks.useEventCallback(() => {
    releaseDrawingResources(true)
  })

  return {
    ...state,
    setJimuMapView: (view: JimuMapView | null) =>
      updateResource("jimuMapView", view),
    setSketchViewModel: (vm: __esri.SketchViewModel | null) =>
      updateResource("sketchViewModel", vm),
    setGraphicsLayer: (layer: __esri.GraphicsLayer | null) =>
      updateResource("graphicsLayer", layer),
    setCleanupHandles: (cleanup: (() => void) | null) =>
      updateResource("cleanupHandles", cleanup),
    teardownDrawingResources,
    cleanupResources,
  }
}

// Error Handling Hooks
export const useErrorDispatcher = (
  dispatch: (action: unknown) => void,
  widgetId: string
) =>
  hooks.useEventCallback((message: string, type: ErrorType, code?: string) => {
    const error: ErrorState = {
      message,
      type,
      code: code || "UNKNOWN",
      severity: ErrorSeverity.ERROR,
      recoverable: true,
      timestamp: new Date(),
      timestampMs: Date.now(),
      kind: "runtime",
    }
    dispatch(fmeActions.setError("general", error, widgetId))
  })

// Form State Management
export const useFormStateManager = (
  validator: {
    initializeValues: () => FormValues
    validateValues: (values: FormValues) => {
      isValid: boolean
      errors: { [key: string]: string }
    }
  },
  onValuesChange?: (values: FormValues) => void
) => {
  const [values, setValues] = React.useState<FormValues>(() =>
    validator.initializeValues()
  )
  const [isValid, setIsValid] = React.useState(true)
  const [errors, setErrors] = React.useState<{ [key: string]: string }>({})

  const syncValues = hooks.useEventCallback((next: FormValues) => {
    setValues(next)
    onValuesChange?.(next)
  })

  const updateField = hooks.useEventCallback(
    (field: string, value: FormPrimitive) => {
      const updated = { ...values, [field]: value }
      syncValues(updated)
    }
  )

  const validateForm = hooks.useEventCallback(() => {
    const validation = validator.validateValues(values)
    setIsValid(validation.isValid)
    setErrors(validation.errors)
    return validation
  })

  const resetForm = hooks.useEventCallback(() => {
    const nextValues = validator.initializeValues()
    setErrors({})
    setIsValid(true)
    syncValues(nextValues)
  })

  return {
    values,
    isValid,
    errors,
    updateField,
    validateForm,
    resetForm,
    setValues: syncValues,
    setIsValid,
    setErrors,
  }
}

// Format error message based on error type and context
const formatLoadError = (
  err: unknown,
  baseKey: string,
  translate: (key: string) => string,
  isMounted: boolean
): string | null => {
  if (isAbortError(err) || !isMounted) {
    return null
  }

  try {
    return resolveMessageOrKey(baseKey, translate)
  } catch {
    return translate(baseKey)
  }
}

// Custom hook for loading workspace data from FME Flow.
export const useWorkspaceLoader = (opts: WorkspaceLoaderOptions) => {
  const {
    config,
    getFmeClient,
    translate,
    makeCancelable,
    widgetId,
    onWorkspaceSelected,
    dispatch: reduxDispatch,
  } = opts

  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const isMountedRef = React.useRef(true)
  const loadingScopeRef = React.useRef<"workspaces" | "parameters" | null>(
    null
  )

  const { abortAndCreate, cancel, finalize } = useLatestAbortController()

  const dispatchAction = hooks.useEventCallback((action: unknown) => {
    reduxDispatch(action)
  })

  const beginLoading = hooks.useEventCallback(
    (scope: "workspaces" | "parameters") => {
      loadingScopeRef.current = scope
      reduxDispatch(fmeActions.setLoadingFlag(scope, true, widgetId))
      setIsLoading(true)
    }
  )

  const finishLoading = hooks.useEventCallback(
    (
      scope: "workspaces" | "parameters",
      options?: { resetLocal?: boolean }
    ) => {
      const shouldUpdateLocal = options?.resetLocal ?? true
      dispatchAction(fmeActions.setLoadingFlag(scope, false, widgetId))

      if (loadingScopeRef.current === scope) {
        loadingScopeRef.current = null
      }

      if (shouldUpdateLocal && isMountedRef.current) {
        if (!loadingScopeRef.current) {
          setIsLoading(false)
        }
      }
    }
  )

  const cancelCurrent = hooks.useEventCallback(() => {
    cancel()
    const scope = loadingScopeRef.current
    if (scope) {
      finishLoading(scope)
    } else {
      setIsLoading(false)
    }
  })

  const finalizeSelection = hooks.useEventCallback(
    (
      repoName: string,
      workspaceName: string,
      workspaceItem: WorkspaceItemDetail,
      parameters: readonly WorkspaceParameter[]
    ) => {
      if (!isMountedRef.current) return

      if (onWorkspaceSelected) {
        onWorkspaceSelected(workspaceName, parameters, workspaceItem)
        return
      }

      dispatchAction(
        fmeActions.applyWorkspaceData(
          { workspaceName, parameters, item: workspaceItem },
          widgetId
        )
      )
    }
  )

  const loadAll = hooks.useEventCallback(async () => {
    const fmeClient = getFmeClient()
    const targetRepository = toTrimmedString(config?.repository)

    if (!fmeClient || !targetRepository) {
      cancelCurrent()
      if (isMountedRef.current) {
        dispatchAction(fmeActions.clearWorkspaceState(widgetId))
        if (!targetRepository) {
          setError(null)
        }
      }
      return
    }

    cancelCurrent()
    const controller = abortAndCreate()
    beginLoading("workspaces")
    setError(null)

    try {
      const response = await makeCancelable(
        fmeClient.getRepositoryItems(
          targetRepository,
          WORKSPACE_ITEM_TYPE,
          undefined,
          undefined,
          controller.signal
        )
      )

      if (controller.signal.aborted) return

      if (response.status !== 200 || !response.data.items) {
        throw new Error(translate("failedToLoadWorkspaces"))
      }

      const items = (response.data.items as readonly WorkspaceItem[]).filter(
        (item) => item.type === WORKSPACE_ITEM_TYPE
      )

      const scoped = items.filter((item) => {
        const repoName = toTrimmedString(
          (item as { repository?: string })?.repository
        )
        return !repoName || repoName === targetRepository
      })

      const sorted = scoped.slice().sort((a, b) =>
        (a.title || a.name).localeCompare(b.title || b.name, undefined, {
          sensitivity: "base",
        })
      )

      if (isMountedRef.current) {
        dispatchAction(fmeActions.setWorkspaceItems(sorted, widgetId))
      }
    } catch (err) {
      const msg = formatLoadError(
        err,
        "failedToLoadWorkspaces",
        translate,
        isMountedRef.current
      )
      if (msg && isMountedRef.current) {
        setError(msg)
      }
    } finally {
      if (isMountedRef.current) {
        finishLoading("workspaces")
      } else {
        reduxDispatch(fmeActions.setLoadingFlag("workspaces", false, widgetId))
        loadingScopeRef.current =
          loadingScopeRef.current === "workspaces"
            ? null
            : loadingScopeRef.current
      }
      finalize(controller)
    }
  })

  const loadItem = hooks.useEventCallback(
    async (workspaceName: string, repositoryName?: string) => {
      const fmeClient = getFmeClient()
      const repoToUse =
        toTrimmedString(repositoryName) ?? toTrimmedString(config?.repository)

      if (!fmeClient || !repoToUse) {
        return
      }

      let controller: AbortController | null = null
      try {
        cancelCurrent()
        controller = abortAndCreate()
        beginLoading("parameters")
        setError(null)

        const [itemResponse, parametersResponse] = await Promise.all([
          makeCancelable(
            fmeClient.getWorkspaceItem(
              workspaceName,
              repoToUse,
              controller.signal
            )
          ),
          makeCancelable(
            fmeClient.getWorkspaceParameters(
              workspaceName,
              repoToUse,
              controller.signal
            )
          ),
        ])

        if (controller.signal.aborted) {
          return
        }

        if (itemResponse.status !== 200 || parametersResponse.status !== 200) {
          throw new Error(translate("failedToLoadWorkspaceDetails"))
        }

        const workspaceItem = itemResponse.data as WorkspaceItemDetail
        const parameters = (parametersResponse.data ||
          []) as readonly WorkspaceParameter[]

        finalizeSelection(repoToUse, workspaceName, workspaceItem, parameters)
      } catch (err) {
        const msg = formatLoadError(
          err,
          "failedToLoadWorkspaceDetails",
          translate,
          isMountedRef.current
        )
        if (msg && isMountedRef.current) setError(msg)
      } finally {
        if (isMountedRef.current) {
          finishLoading("parameters")
        } else {
          reduxDispatch(
            fmeActions.setLoadingFlag("parameters", false, widgetId)
          )
          loadingScopeRef.current =
            loadingScopeRef.current === "parameters"
              ? null
              : loadingScopeRef.current
        }
        if (controller) finalize(controller)
      }
    }
  )

  const debouncedLoadAll = useDebounce(() => {
    void loadAll()
  }, MS_LOADING)

  const scheduleLoad = hooks.useEventCallback(() => {
    debouncedLoadAll()
    return () => {
      debouncedLoadAll.cancel()
    }
  })

  // Cleanup on unmount
  hooks.useEffectOnce(() => {
    return () => {
      isMountedRef.current = false
      cancel()
      const scope = loadingScopeRef.current
      if (scope) {
        reduxDispatch(fmeActions.setLoadingFlag(scope, false, widgetId))
        loadingScopeRef.current = null
      }
      debouncedLoadAll.cancel()
    }
  })

  // Clear workspaces when repository changes to prevent stale selections
  hooks.useUpdateEffect(() => {
    if (isMountedRef.current) {
      cancelCurrent()
      dispatchAction(fmeActions.clearWorkspaceState(widgetId))
      setError(null)
      setIsLoading(false)
    }
  }, [config?.repository])

  // Safety: reset loading state if stuck for too long
  hooks.useUpdateEffect(() => {
    if (!isLoading || !isMountedRef.current) return

    const timeoutId = setTimeout(() => {
      if (isMountedRef.current && isLoading) {
        const scope = loadingScopeRef.current
        if (scope) {
          finishLoading(scope)
        } else {
          setIsLoading(false)
        }
        setError(translate("errorLoadingTimeout"))
      }
    }, LOADING_TIMEOUT_MS)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [isLoading, finishLoading, translate])

  return { isLoading, error, loadAll, loadItem, scheduleLoad }
}

// Settings Panel Hooks
export const useBuilderSelector = <T>(selector: (state: any) => T): T => {
  return useSelector((state: any) => {
    const builderState = state?.appStateInBuilder
    const effectiveState = builderState ?? state
    return selector(effectiveState)
  })
}

// Small helper to centralize config updates
export const useUpdateConfig = (
  id: string,
  config: { [key: string]: any; set?: (key: string, value: any) => any },
  onSettingChange: (update: { id: string; config: any }) => void
) => {
  return hooks.useEventCallback((key: string, value: any) => {
    onSettingChange({
      id,
      config: config.set ? config.set(key, value) : config,
    })
  })
}

// Config value getters to avoid repetitive type assertions
export const useStringConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback((key: string, defaultValue = ""): string => {
    const v = configRef.current?.[key]
    return typeof v === "string" ? v : defaultValue
  })
}

export const useBooleanConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback(
    (key: string, defaultValue = false): boolean => {
      const v = configRef.current?.[key]
      return typeof v === "boolean" ? v : defaultValue
    }
  )
}

export const useNumberConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback(
    (key: string, defaultValue?: number): number | undefined => {
      const v = configRef.current?.[key]
      if (typeof v === "number" && Number.isFinite(v)) return v
      return defaultValue
    }
  )
}

// Theme-aware styles hook for settings
export const useSettingStyles = (createStylesFn: (theme: any) => any) => {
  const jimuTheme = require("jimu-theme")
  const theme = jimuTheme.useTheme()
  return createStylesFn(theme)
}

// UI Component Hooks
let idSeq = 0

// Generate unique IDs for UI components
export const useUniqueId = (): string => {
  const idRef = React.useRef<string>()
  if (!idRef.current) {
    idSeq += 1
    idRef.current = `fme-${idSeq}`
  }
  return idRef.current
}

// Controlled value hook for form components
export const useControlledValue = <T = unknown>(
  controlled?: T,
  defaultValue?: T,
  onChange?: (value: T) => void
): readonly [T, (value: T) => void] => {
  const [value, setValue] = hooks.useControlled({
    controlled,
    default: defaultValue,
  })

  const handleChange = hooks.useEventCallback((newValue: T) => {
    setValue(newValue)
    onChange?.(newValue)
  })

  return [value, handleChange] as const
}

// Loading latch hook to prevent flickering during quick state transitions
export const useLoadingLatch = (
  state: { kind: string; [key: string]: any },
  delay: number
): { showLoading: boolean; snapshot: LoadingSnapshot } => {
  const createSnapshot = (
    source:
      | {
          [key: string]: any
        }
      | null
      | undefined
  ): LoadingSnapshot => {
    if (!source) return null
    const message = source.message as React.ReactNode | undefined
    const detail = source.detail as React.ReactNode | undefined
    const rawMessages = source.messages as
      | readonly React.ReactNode[]
      | undefined
    const messages = Array.isArray(rawMessages)
      ? (rawMessages.filter(
          (entry) => entry !== null && entry !== undefined
        ) as readonly React.ReactNode[])
      : undefined

    if (
      message == null &&
      detail == null &&
      (!messages || messages.length === 0)
    ) {
      return null
    }

    return { message, detail, messages }
  }

  const [latched, setLatched] = React.useState(state.kind === "loading")
  const startRef = React.useRef<number | null>(
    state.kind === "loading" ? Date.now() : null
  )
  const snapshotRef = React.useRef<LoadingSnapshot>(
    state.kind === "loading" ? createSnapshot(state) : null
  )

  hooks.useEffectWithPreviousValues(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    if (state.kind === "loading") {
      snapshotRef.current = createSnapshot(state)
      if (startRef.current == null) {
        startRef.current = Date.now()
      }
      setLatched(true)
    } else if (startRef.current != null) {
      const elapsed = Date.now() - startRef.current
      const remaining = Math.max(0, delay - elapsed)

      if (remaining > 0) {
        timer = setTimeout(() => {
          setLatched(false)
          startRef.current = null
          snapshotRef.current = null
        }, remaining)
      } else {
        setLatched(false)
        startRef.current = null
        snapshotRef.current = null
      }
    } else {
      setLatched(false)
      snapshotRef.current = null
    }

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [state, delay])

  const isLoading = state.kind === "loading"
  const snapshot = isLoading ? createSnapshot(state) : snapshotRef.current

  return {
    showLoading: isLoading || latched,
    snapshot,
  }
}

// Abort Controller Hooks
export const useLatestAbortController = () => {
  const controllerRef = hooks.useLatest<AbortController | null>(null)

  const cancel = hooks.useEventCallback(() => {
    const controller = controllerRef.current
    if (controller) {
      try {
        controller.abort()
      } catch {}
    }
    controllerRef.current = null
  })

  const abortAndCreate = hooks.useEventCallback(() => {
    cancel()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  })

  const finalize = hooks.useEventCallback(
    (controller?: AbortController | null) => {
      if (!controller) return
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  )

  return {
    controllerRef,
    abortAndCreate,
    cancel,
    finalize,
  }
}
