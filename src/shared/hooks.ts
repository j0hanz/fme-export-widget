import { React, hooks } from "jimu-core"
import { useSelector } from "react-redux"
import type { JimuMapView } from "jimu-arcgis"
import type {
  EsriModules,
  ErrorState,
  ErrorType,
  WorkspaceParameter,
  WorkspaceItemDetail,
  WorkspaceItem,
  FormPrimitive,
  FormValues,
  LoadingSnapshot,
  ConnectionValidationResult,
  FmeExportConfig,
} from "../config/index"
import {
  ErrorSeverity,
  ESRI_MODULES_TO_LOAD,
  WORKSPACE_ITEM_TYPE,
  DEFAULT_REPOSITORY,
} from "../config/index"
import { fmeActions } from "../extensions/store"
import {
  loadArcgisModules,
  extractRepositoryNames,
  toTrimmedString,
} from "./utils"
import type FmeFlowApiClient from "./api"
import { createFmeFlowClient } from "./api"
import { useFmeQuery, useFmeMutation } from "./query"
import { healthCheck, validateConnection } from "./services"

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
    throw new Error("debounceUnavailable")
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

// ============================================
// Query System Domain Hooks
// ============================================

const buildFmeClient = (
  serverUrl?: string,
  token?: string,
  repository?: string
): FmeFlowApiClient | null => {
  const trimmedUrl = toTrimmedString(serverUrl)
  const trimmedToken = toTrimmedString(token)
  if (!trimmedUrl || !trimmedToken) {
    return null
  }

  const resolvedRepository = toTrimmedString(repository) || DEFAULT_REPOSITORY
  const baseConfig: FmeExportConfig = {
    fmeServerUrl: trimmedUrl,
    fmeServerToken: trimmedToken,
    repository: resolvedRepository,
  }

  try {
    return createFmeFlowClient(baseConfig)
  } catch {
    return null
  }
}

const buildTokenCacheKey = (token?: string): string => {
  const trimmed = toTrimmedString(token)
  if (!trimmed) {
    return "token:none"
  }

  let hash = 0
  for (let i = 0; i < trimmed.length; i += 1) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0
  }

  return `token:${hash.toString(36)}`
}

export function useWorkspaces(
  config: {
    repository?: string
    fmeServerUrl?: string
    fmeServerToken?: string
  },
  options?: { enabled?: boolean }
) {
  const getFmeClient = hooks.useEventCallback(() =>
    buildFmeClient(
      config.fmeServerUrl,
      config.fmeServerToken,
      config.repository
    )
  )

  return useFmeQuery<WorkspaceItem[]>({
    queryKey: [
      "workspaces",
      config.repository || DEFAULT_REPOSITORY,
      config.fmeServerUrl,
      buildTokenCacheKey(config.fmeServerToken),
    ],
    queryFn: async (signal) => {
      const client = getFmeClient()
      if (!client) {
        throw new Error("FME client not configured")
      }

      const response = await client.getRepositoryItems(
        config.repository || DEFAULT_REPOSITORY,
        WORKSPACE_ITEM_TYPE,
        undefined,
        undefined,
        signal
      )

      const items = Array.isArray(response?.data?.items)
        ? (response.data.items as WorkspaceItem[])
        : []
      return items
    },
    enabled:
      (options?.enabled ?? true) &&
      Boolean(config.fmeServerUrl && config.fmeServerToken),
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt - 1), 10000),
  })
}

export function useWorkspaceItem(
  workspace: string | undefined,
  config: {
    repository?: string
    fmeServerUrl?: string
    fmeServerToken?: string
  },
  options?: { enabled?: boolean }
) {
  const getFmeClient = hooks.useEventCallback(() =>
    buildFmeClient(
      config.fmeServerUrl,
      config.fmeServerToken,
      config.repository
    )
  )

  return useFmeQuery({
    queryKey: [
      "workspace-item",
      workspace,
      config.repository || DEFAULT_REPOSITORY,
      config.fmeServerUrl,
      buildTokenCacheKey(config.fmeServerToken),
    ],
    queryFn: async (signal) => {
      const client = getFmeClient()
      if (!client || !workspace) {
        throw new Error("Invalid workspace configuration")
      }

      const repositoryName = config.repository || DEFAULT_REPOSITORY
      const [itemResp, paramsResp] = await Promise.all([
        client.getWorkspaceItem(workspace, repositoryName, signal),
        client.getWorkspaceParameters(workspace, repositoryName, signal),
      ])

      const parameters = Array.isArray(paramsResp?.data)
        ? (paramsResp.data as WorkspaceParameter[])
        : []

      return {
        item: itemResp.data as WorkspaceItemDetail,
        parameters,
      }
    },
    enabled:
      (options?.enabled ?? true) &&
      Boolean(workspace && config.fmeServerUrl && config.fmeServerToken),
    staleTime: 10 * 60 * 1000,
    retry: 3,
  })
}

export function useRepositories(
  serverUrl: string | undefined,
  token: string | undefined,
  options?: { enabled?: boolean }
) {
  return useFmeQuery<Array<{ name: string }>>({
    queryKey: ["repositories", serverUrl, buildTokenCacheKey(token)],
    queryFn: async (signal) => {
      if (!serverUrl || !token) {
        throw new Error("Missing credentials")
      }

      const client = buildFmeClient(serverUrl, token, DEFAULT_REPOSITORY)
      if (!client) {
        throw new Error("Missing credentials")
      }

      const response = await client.getRepositories(signal)
      const names = extractRepositoryNames(response?.data)
      return names.map((name) => ({ name }))
    },
    enabled: (options?.enabled ?? true) && Boolean(serverUrl && token),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useHealthCheck(
  serverUrl: string | undefined,
  token: string | undefined,
  options?: { enabled?: boolean; refetchOnWindowFocus?: boolean }
) {
  return useFmeQuery({
    queryKey: ["health", serverUrl, token],
    queryFn: async (signal) => {
      if (!serverUrl || !token) {
        throw new Error("Missing credentials")
      }
      return await healthCheck(serverUrl, token, signal)
    },
    enabled: (options?.enabled ?? true) && Boolean(serverUrl && token),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
    retry: 1,
  })
}

interface ValidateConnectionVariables {
  serverUrl: string
  token: string
  repository?: string
}

export function useValidateConnection() {
  return useFmeMutation<
    ConnectionValidationResult,
    ValidateConnectionVariables
  >({
    mutationFn: async (variables, signal) => {
      return await validateConnection({
        serverUrl: variables.serverUrl,
        token: variables.token,
        repository: variables.repository,
        signal,
      })
    },
  })
}
