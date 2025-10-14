import { React, hooks } from "jimu-core"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
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
  ValidateConnectionVariables,
  UseDebounceOptions,
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
  logIfNotAbort,
  createFmeClient,
  buildTokenCacheKey,
} from "./utils"
import { healthCheck, validateConnection } from "./services"

/* ArcGIS Resource Utilities */

// Kör operation säkert på resurs, ignorerar fel
const executeSafely = <T>(
  resource: T | null | undefined,
  operation: (value: T) => void
): void => {
  if (!resource) return
  try {
    operation(resource)
  } catch {}
}

// Avbryter aktiv sketch-operation säkert
export const safeCancelSketch = (vm?: __esri.SketchViewModel | null): void => {
  executeSafely(vm, (model) => {
    model.cancel()
  })
}

// Rensar alla grafik från layer säkert
export const safeClearLayer = (layer?: __esri.GraphicsLayer | null): void => {
  executeSafely(layer, (graphics) => {
    graphics.removeAll()
  })
}

// Förstör GraphicsLayer-objekt säkert
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

// Tar bort GraphicsLayer från karta säkert
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

/* Debounce Hook */

// Debounced-funktion med cancel/flush/isPending-metoder
type DebouncedFn<T extends (...args: any[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void
  flush: () => void
  isPending: () => boolean
}

// Hook för debounced callback med delay och optional pending-notifiering
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

  // Notifierar pending-state-förändring via callback
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

  // Avbryter pending debounce och rensar state
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

  // Kör callback efter delay, notifierar pending under väntan
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

  // Kör callback omedelbart med senaste args (avbryter debounce)
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

  // Skapar stabil debounced-funktion med cancel/flush/isPending
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

/* ArcGIS Modules Loader Hook */

// Hook för att ladda ArcGIS-moduler asynkront med error-hantering
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

    // Behåll moduler om reloadSignal är 0, annars rensa och ladda om
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

        // Ladda projection-modul om det har load-metod
        try {
          const proj = projection as any
          if (proj?.load && typeof proj.load === "function") {
            await proj.load()
          }
        } catch {}

        // Extrahera geometry operators från async eller sync engine
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

/* Map Resources Management Hook */

// Hook för att hantera kartresurser (JimuMapView, SketchViewModel, layers)
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

  // Uppdaterar enskild resurs och kör cleanup om nödvändigt
  const updateResource = hooks.useEventCallback(
    <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => {
      setState((prev) => {
        // Kör cleanup på gammal SketchViewModel om den ersätts
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

        // Kör cleanup-handles om de ersätts
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

  // Frigör drawing-resurser (VM, layer, handles) med optional MapView-reset
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

  // Tar ner drawing-resurser utan att rensa JimuMapView
  const teardownDrawingResources = hooks.useEventCallback(() => {
    releaseDrawingResources(false)
  })

  // Rensar alla resurser inklusive JimuMapView
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

/* Error Handling Hooks */

// Hook för att dispatcha fel till Redux store med standardiserad struktur
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

/* Form State Management Hook */

// Hook för formulärhantering med validering och onChange-notifiering
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

  // Synkar värden och notifierar onChange-callback
  const syncValues = hooks.useEventCallback((next: FormValues) => {
    setValues(next)
    onValuesChange?.(next)
  })

  // Uppdaterar enskilt fält och synkar
  const updateField = hooks.useEventCallback(
    (field: string, value: FormPrimitive) => {
      const updated = { ...values, [field]: value }
      syncValues(updated)
    }
  )

  // Validerar formulär och uppdaterar isValid/errors
  const validateForm = hooks.useEventCallback(() => {
    const validation = validator.validateValues(values)
    setIsValid(validation.isValid)
    setErrors(validation.errors)
    return validation
  })

  // Återställer formulär till initialvärden
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

/* Settings Panel Hooks */

// Selector för builder-state (fallback till runtime state)
export const useBuilderSelector = <T>(selector: (state: any) => T): T => {
  return useSelector((state: any) => {
    const builderState = state?.appStateInBuilder
    const effectiveState = builderState ?? state
    return selector(effectiveState)
  })
}

// Hook för config-uppdateringar (använder Immutable.set om tillgänglig)
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

// Config-value getters för type-safe access med defaults

// Hämtar string-värde från config med fallback
export const useStringConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback((key: string, defaultValue = ""): string => {
    const v = configRef.current?.[key]
    return typeof v === "string" ? v : defaultValue
  })
}

// Hämtar boolean-värde från config med fallback
export const useBooleanConfigValue = (config: { [key: string]: any }) => {
  const configRef = hooks.useLatest(config)
  return hooks.useEventCallback(
    (key: string, defaultValue = false): boolean => {
      const v = configRef.current?.[key]
      return typeof v === "boolean" ? v : defaultValue
    }
  )
}

// Hämtar number-värde från config med fallback
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

// Hook för att skapa styled-components från jimu-theme
export const useSettingStyles = (createStylesFn: (theme: any) => any) => {
  const jimuTheme = require("jimu-theme")
  const theme = jimuTheme.useTheme()
  return createStylesFn(theme)
}

/* UI Component Hooks */

let idSeq = 0

// Genererar unikt ID för UI-komponenter (persistent över renders)
export const useUniqueId = (): string => {
  const idRef = React.useRef<string>()
  if (!idRef.current) {
    idSeq += 1
    idRef.current = `fme-${idSeq}`
  }
  return idRef.current
}

// Hook för controlled value med onChange-callback (via useControlled)
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

/* Loading Latch Hook */

// Hook för att låsa loading-state i minsta tid (undviker flicker)
export const useLoadingLatch = (
  state: { kind: string; [key: string]: any },
  delay: number
): { showLoading: boolean; snapshot: LoadingSnapshot } => {
  // Skapar snapshot av loading-meddelanden
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
      // Uppdatera snapshot och starta latch
      snapshotRef.current = createSnapshot(state)
      if (startRef.current == null) {
        startRef.current = Date.now()
      }
      setLatched(true)
    } else if (startRef.current != null) {
      // Håll latch tills delay löpt ut
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

/* Abort Controller Hooks */

// Hook för att hantera senaste AbortController med cancel/create
export const useLatestAbortController = () => {
  const controllerRef = hooks.useLatest<AbortController | null>(null)

  // Avbryter aktuell controller och rensar referens
  const cancel = hooks.useEventCallback(() => {
    const controller = controllerRef.current
    if (controller) {
      try {
        controller.abort()
      } catch {}
    }
    controllerRef.current = null
  })

  // Avbryter befintlig och skapar ny AbortController
  const abortAndCreate = hooks.useEventCallback(() => {
    cancel()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  })

  // Rensar controller-referens om den matchar given controller
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

/* Query System Domain Hooks (React Query) */

// Hook för att hämta workspaces från repository
export function useWorkspaces(
  config: {
    repository?: string
    fmeServerUrl?: string
    fmeServerToken?: string
  },
  options?: { enabled?: boolean }
) {
  return useQuery<WorkspaceItem[]>({
    queryKey: [
      "fme",
      "workspaces",
      config.repository || DEFAULT_REPOSITORY,
      config.fmeServerUrl,
      buildTokenCacheKey(config.fmeServerToken),
    ],
    queryFn: async ({ signal }) => {
      const client = createFmeClient(
        config.fmeServerUrl,
        config.fmeServerToken,
        config.repository
      )
      if (!client) {
        throw new Error("FME client not initialized")
      }

      const repositoryName = config.repository || DEFAULT_REPOSITORY
      const response = await client.getRepositoryItems(
        repositoryName,
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
  })
}

// Hook för att hämta workspace-item med parametrar
export function useWorkspaceItem(
  workspace: string | undefined,
  config: {
    repository?: string
    fmeServerUrl?: string
    fmeServerToken?: string
  },
  options?: { enabled?: boolean }
) {
  return useQuery<{
    item: WorkspaceItemDetail
    parameters: WorkspaceParameter[]
  }>({
    queryKey: [
      "fme",
      "workspace-item",
      workspace,
      config.repository || DEFAULT_REPOSITORY,
      config.fmeServerUrl,
      buildTokenCacheKey(config.fmeServerToken),
    ],
    queryFn: async ({ signal }) => {
      if (!workspace) {
        throw new Error("Workspace name required")
      }

      const client = createFmeClient(
        config.fmeServerUrl,
        config.fmeServerToken,
        config.repository
      )
      if (!client) {
        throw new Error("FME client not initialized")
      }

      const repositoryName = config.repository || DEFAULT_REPOSITORY
      const [itemResp, paramsResp] = await Promise.all([
        client.getWorkspaceItem(workspace, repositoryName, signal),
        client.getWorkspaceParameters(workspace, repositoryName, signal),
      ])

      const parameters = Array.isArray(paramsResp?.data) ? paramsResp.data : []

      return {
        item: itemResp.data,
        parameters,
      }
    },
    enabled:
      (options?.enabled ?? true) &&
      Boolean(workspace && config.fmeServerUrl && config.fmeServerToken),
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
  })
}

// Hook för att prefetcha workspaces i chunks med progress-callback
export function usePrefetchWorkspaces(
  workspaces: readonly WorkspaceItem[] | undefined,
  config: {
    repository?: string
    fmeServerUrl?: string
    fmeServerToken?: string
  },
  options?: {
    enabled?: boolean
    chunkSize?: number
    onProgress?: (loaded: number, total: number) => void
  }
) {
  const queryClient = useQueryClient()

  const [state, setState] = React.useState<{
    isPrefetching: boolean
    progress: { loaded: number; total: number } | null
    prefetchStatus: "idle" | "loading" | "success" | "error"
  }>(() => ({
    isPrefetching: false,
    progress: null,
    prefetchStatus: "idle",
  }))

  const enabled = options?.enabled ?? true
  const chunkSize = options?.chunkSize ?? 10

  const configRef = hooks.useLatest(config)
  const workspacesRef = hooks.useLatest(workspaces)
  const onProgressRef = hooks.useLatest(options?.onProgress)

  React.useEffect(() => {
    const workspacesSnapshot = workspacesRef.current
    if (!enabled || !workspacesSnapshot?.length) {
      setState({
        isPrefetching: false,
        progress: null,
        prefetchStatus: "idle",
      })
      return
    }

    const configSnapshot = configRef.current ?? {}
    const repository = configSnapshot.repository || DEFAULT_REPOSITORY
    const fmeServerUrl = configSnapshot.fmeServerUrl
    const fmeServerToken = configSnapshot.fmeServerToken
    if (!fmeServerUrl || !fmeServerToken) return

    const client = createFmeClient(fmeServerUrl, fmeServerToken, repository)
    if (!client) return

    let cancelled = false
    const abortControllers = new Set<AbortController>()

    const registerAbortController = (
      controller: AbortController
    ): (() => void) => {
      abortControllers.add(controller)
      return () => {
        abortControllers.delete(controller)
      }
    }

    const abortAllControllers = (reason?: unknown): void => {
      abortControllers.forEach((controller) => {
        try {
          if (!controller.signal.aborted) {
            controller.abort(reason)
          }
        } catch {
          controller.abort()
        }
      })
      abortControllers.clear()
    }

    const linkSignals = (
      source: AbortSignal | undefined,
      controller: AbortController
    ): (() => void) => {
      if (!source) {
        return () => undefined
      }

      const abortHandler = () => {
        const reason = (source as { reason?: unknown }).reason
        try {
          if (!controller.signal.aborted) {
            controller.abort(reason)
          }
        } catch {
          controller.abort()
        }
      }

      source.addEventListener("abort", abortHandler)

      return () => {
        try {
          source.removeEventListener("abort", abortHandler)
        } catch {}
      }
    }

    const prefetch = async () => {
      setState({
        isPrefetching: true,
        progress: { loaded: 0, total: workspacesSnapshot.length },
        prefetchStatus: "loading",
      })

      // Dela workspaces i chunks för batch-prefetch
      const chunks: WorkspaceItem[][] = []
      for (let i = 0; i < workspacesSnapshot.length; i += chunkSize) {
        chunks.push(workspacesSnapshot.slice(i, i + chunkSize))
      }

      let loaded = 0

      try {
        for (const chunk of chunks) {
          if (cancelled) break

          // Prefetcha chunk parallellt
          await Promise.all(
            chunk.map((ws) =>
              queryClient.prefetchQuery({
                queryKey: [
                  "fme",
                  "workspace-item",
                  ws.name,
                  repository,
                  fmeServerUrl,
                  buildTokenCacheKey(fmeServerToken),
                ],
                queryFn: async ({ signal }) => {
                  const controller = new AbortController()
                  const unregister = registerAbortController(controller)
                  const unlink = linkSignals(signal, controller)
                  try {
                    const effectiveSignal = controller.signal
                    const [itemResp, paramsResp] = await Promise.all([
                      client.getWorkspaceItem(
                        ws.name,
                        repository,
                        effectiveSignal
                      ),
                      client.getWorkspaceParameters(
                        ws.name,
                        repository,
                        effectiveSignal
                      ),
                    ])
                    return {
                      item: itemResp.data,
                      parameters: Array.isArray(paramsResp?.data)
                        ? paramsResp.data
                        : [],
                    }
                  } finally {
                    unlink()
                    unregister()
                  }
                },
                staleTime: 10 * 60 * 1000,
              })
            )
          )

          // Uppdatera progress efter varje chunk
          loaded += chunk.length
          setState((prev) => ({
            ...prev,
            progress: { loaded, total: workspacesSnapshot.length },
          }))
          onProgressRef.current?.(loaded, workspacesSnapshot.length)
        }

        if (!cancelled) {
          setState({
            isPrefetching: false,
            progress: null,
            prefetchStatus: "success",
          })
        }
      } catch (error) {
        if (!cancelled) {
          logIfNotAbort("Workspace prefetch error", error)
          setState({
            isPrefetching: false,
            progress: null,
            prefetchStatus: "error",
          })
        }
      } finally {
        abortAllControllers()
      }
    }

    void prefetch()

    return () => {
      cancelled = true
      abortAllControllers()
    }
  }, [enabled, queryClient, configRef, workspacesRef, onProgressRef, chunkSize])

  return state
}

// Hook för att hämta repositories från FME Flow
export function useRepositories(
  serverUrl: string | undefined,
  token: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery<Array<{ name: string }>>({
    queryKey: ["fme", "repositories", serverUrl, buildTokenCacheKey(token)],
    queryFn: async ({ signal }) => {
      const client = createFmeClient(serverUrl, token, DEFAULT_REPOSITORY)
      if (!client) {
        throw new Error("FME client not initialized")
      }

      const response = await client.getRepositories(signal)
      return response.data ?? []
    },
    enabled: (options?.enabled ?? true) && Boolean(serverUrl && token),
  })
}

// Hook för health-check mot FME Flow
export function useHealthCheck(
  serverUrl: string | undefined,
  token: string | undefined,
  options?: { enabled?: boolean; refetchOnWindowFocus?: boolean }
) {
  return useQuery({
    queryKey: ["fme", "health", serverUrl, buildTokenCacheKey(token)],
    queryFn: async ({ signal }) => {
      if (!serverUrl || !token) {
        throw new Error("Missing credentials")
      }
      return await healthCheck(serverUrl, token, signal)
    },
    enabled: (options?.enabled ?? true) && Boolean(serverUrl && token),
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
  })
}

// Hook för connection-validering med abort-hantering
export function useValidateConnection() {
  const controllerRef = React.useRef<AbortController | null>(null)

  // Avbryter pågående validering
  const cancel = hooks.useEventCallback(() => {
    const controller = controllerRef.current
    if (controller && !controller.signal.aborted) {
      try {
        controller.abort()
      } catch {}
    }
    controllerRef.current = null
  })

  const mutation = useMutation<
    ConnectionValidationResult,
    Error,
    ValidateConnectionVariables
  >({
    mutationFn: async (variables) => {
      return await validateConnection({
        serverUrl: variables.serverUrl,
        token: variables.token,
        repository: variables.repository,
        signal: controllerRef.current?.signal,
      })
    },
  })

  // Avbryter befintlig och kör ny validering
  const mutateAsync = hooks.useEventCallback(
    async (variables: ValidateConnectionVariables) => {
      cancel()
      const controller = new AbortController()
      controllerRef.current = controller
      try {
        return await mutation.mutateAsync(variables)
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null
        }
      }
    }
  )

  // Fire-and-forget variant av mutateAsync
  const mutate = hooks.useEventCallback(
    (variables: ValidateConnectionVariables) => {
      void mutateAsync(variables)
    }
  )

  // Avbryt pågående validering vid unmount
  hooks.useUnmount(() => {
    cancel()
  })

  return {
    ...mutation,
    mutate,
    mutateAsync,
  }
}
