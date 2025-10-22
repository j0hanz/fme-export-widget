/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  type AllWidgetProps,
  hooks,
  jsx,
  ReactRedux,
  type IMState,
  WidgetState,
  appActions,
  getAppStore,
  ReactDOM,
} from "jimu-core"
import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { JimuMapViewComponent, type JimuMapView } from "jimu-arcgis"
import { fmeQueryClient } from "../shared/query-client"
import { Workflow } from "./components/workflow"
import { StateView, renderSupportHint, useStyles } from "./components/ui"
import { createFmeFlowClient } from "../shared/api"
import defaultMessages from "./translations/default"
import type {
  FmeExportConfig,
  ExportResult,
  ServiceMode,
  IMStateWithFmeExport,
  FmeWidgetState,
  WorkspaceParameter,
  WorkspaceItemDetail,
  ErrorState,
  SerializableErrorState,
  DrawingSessionState,
  SubmissionPhase,
  SubmissionPreparationStatus,
  ModeNotice,
  ServiceModeOverrideInfo,
  EsriModules,
} from "../config/index"
import {
  makeErrorView,
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  VIEW_ROUTES,
  DEFAULT_DRAWING_HEX,
} from "../config/index"
import {
  prepareSubmissionParams,
  createLayers,
  createSketchVM,
  runStartupValidationFlow,
  processDrawingCompletion,
} from "../shared/services"
import { getSupportEmail } from "../shared/validations"
import { processFmeResponse } from "../shared/utils/fme"
import { mapErrorToKey } from "../shared/utils/error"
import { checkMaxArea, evaluateArea } from "../shared/utils/geometry"
import { initialFmeState, createFmeSelectors } from "../extensions/store"
import {
  resolveMessageOrKey,
  buildSupportHintText,
  getEmail,
  determineServiceMode,
  formatArea,
  formatErrorForView,
  useLatestAbortController,
  toTrimmedString,
  logIfNotAbort,
  safeAbort,
  popupSuppressionManager,
  hexToRgbArray,
  buildSymbols,
  isNavigatorOffline,
  computeWidgetsToClose,
  isAbortError,
  createFmeDispatcher,
  shouldSuppressError,
  buildErrorContext,
  createErrorActions,
} from "../shared/utils"
import {
  useEsriModules,
  useMapResources,
  useErrorDispatcher,
  safeCancelSketch,
  safeClearLayer,
  usePrefetchWorkspaces,
} from "../shared/hooks"

/* Huvudkomponent för FME Export widget runtime */
function WidgetContent(
  props: AllWidgetProps<FmeExportConfig>
): React.ReactElement {
  const {
    id,
    widgetId: widgetIdProp,
    useMapWidgetIds,
    dispatch,
    config,
  } = props

  /* Bestämmer unikt widget-ID för Redux state management */
  const widgetId =
    (id as unknown as string) ?? (widgetIdProp as unknown as string)

  /* Skapar Redux-selektorer för detta widget */
  const selectors = createFmeSelectors(widgetId)

  /* Hämtar individuella state-properties med optimerad memoization */
  const viewMode = ReactRedux.useSelector(selectors.selectViewMode)
  const drawingTool = ReactRedux.useSelector(selectors.selectDrawingTool)
  const geometryJson = ReactRedux.useSelector(selectors.selectGeometryJson)
  const drawnArea = ReactRedux.useSelector(selectors.selectDrawnArea)
  const workspaceItems = ReactRedux.useSelector(selectors.selectWorkspaceItems)
  const workspaceParameters = ReactRedux.useSelector(
    selectors.selectWorkspaceParameters
  )
  const workspaceItem = ReactRedux.useSelector(selectors.selectWorkspaceItem)
  const selectedWorkspace = ReactRedux.useSelector(
    selectors.selectSelectedWorkspace
  )
  const orderResult = ReactRedux.useSelector(selectors.selectOrderResult)
  const loadingState = ReactRedux.useSelector(selectors.selectLoading)
  const isSubmitting = ReactRedux.useSelector(
    selectors.selectLoadingFlag("submission")
  )
  const canExport = ReactRedux.useSelector(selectors.selectCanExport)
  const scopedError = ReactRedux.useSelector(selectors.selectPrimaryError)

  const previousViewMode = hooks.usePrevious(viewMode)

  /* Expanderar serializable error från Redux till komplett ErrorState */
  const expandSerializableError = hooks.useEventCallback(
    (error: SerializableErrorState | null | undefined): ErrorState | null => {
      if (!error) return null
      const timestampMs =
        typeof error.timestampMs === "number" ? error.timestampMs : Date.now()
      return {
        ...error,
        timestamp: new Date(timestampMs),
        timestampMs,
        kind: "runtime",
      }
    }
  )

  const generalErrorDetails =
    scopedError?.scope === "general" ? scopedError.details : null
  const generalError = expandSerializableError(generalErrorDetails)
  const hasCriticalGeneralError =
    generalErrorDetails?.severity === ErrorSeverity.ERROR
  const workflowError = scopedError?.details ?? null
  const configuredRepository = config?.repository ?? null

  const workspacePrefetchResult = usePrefetchWorkspaces(
    workspaceItems,
    {
      repository: config?.repository ?? undefined,
      fmeServerUrl: (config as { fmeServerUrl?: string })?.fmeServerUrl,
      fmeServerToken: (config as { fmeServerToken?: string })?.fmeServerToken,
    },
    {
      enabled:
        viewMode === ViewMode.WORKSPACE_SELECTION &&
        workspaceItems.length > 0 &&
        !hasCriticalGeneralError,
    }
  )

  const {
    isPrefetching: isPrefetchingWorkspaces,
    progress: prefetchProgressState,
    prefetchStatus: workspacePrefetchStatus,
  } = workspacePrefetchResult

  const workspacePrefetchProgress = prefetchProgressState
    ? {
        loaded: prefetchProgressState.loaded,
        total: prefetchProgressState.total,
      }
    : null

  const styles = useStyles()
  const translateWidget = hooks.useTranslation(defaultMessages)

  /* Wrapper för översättningsfunktion med stabila callbacks */
  const translate = hooks.useEventCallback((key: string): string => {
    return translateWidget(key)
  })

  const makeCancelable = hooks.useCancelablePromiseMaker()
  /* Refs som alltid håller senaste config/viewMode/drawingTool */
  const configRef = hooks.useLatest(config)
  const viewModeRef = hooks.useLatest(viewMode)
  const drawingToolRef = hooks.useLatest(drawingTool)
  /* Flagga för auto-start av ritning efter initialisering */
  const [shouldAutoStart, setShouldAutoStart] = React.useState(false)
  /* FME Flow API-klient med cache för att undvika onödiga recreates */
  const fmeClientRef = React.useRef<ReturnType<
    typeof createFmeFlowClient
  > | null>(null)
  const fmeClientKeyRef = React.useRef<string | null>(null)
  /* Race condition-guard: förhindrar multipla draw-complete-triggers */
  const isCompletingRef = React.useRef(false)
  const completionControllerRef = React.useRef<AbortController | null>(null)
  /* Unik identifierare för popup-suppression i denna widget-instans */
  const popupClientIdRef = React.useRef<symbol>(
    Symbol(widgetId ? `fme-popup-${widgetId}` : "fme-popup")
  )
  /* Timer för fördröjd repository cache warmup */
  const warmupTimerRef = React.useRef<number | null>(null)

  /* Ger enkel åtkomst till Redux-dispatch med widgetId */
  const fmeDispatchRef = React.useRef(createFmeDispatcher(dispatch, widgetId))
  hooks.useUpdateEffect(() => {
    fmeDispatchRef.current = createFmeDispatcher(dispatch, widgetId)
  }, [dispatch, widgetId])
  const fmeDispatch = fmeDispatchRef.current

  /* Spårar aktiv ritningssession och antal klick */
  const [drawingSession, setDrawingSession] =
    React.useState<DrawingSessionState>({
      isActive: false,
      clickCount: 0,
    })

  /* Spårar submission-fas för feedback under export */
  const [submissionPhase, setSubmissionPhase] =
    React.useState<SubmissionPhase>("idle")
  const [announcement, setAnnouncement] = React.useState("")

  const updateDrawingSession = hooks.useEventCallback(
    (updates: Partial<DrawingSessionState>) => {
      setDrawingSession((prev) => {
        return { ...prev, ...updates }
      })
    }
  )

  const handlePreparationStatus = hooks.useEventCallback(
    (status: SubmissionPreparationStatus) => {
      if (status === "normalizing") {
        setSubmissionPhase("preparing")
        return
      }

      if (status === "resolvingDataset") {
        setSubmissionPhase("uploading")
        return
      }

      if (status === "applyingDefaults" || status === "complete") {
        setSubmissionPhase("finalizing")
      }
    }
  )

  const handleSketchToolStart = hooks.useEventCallback((tool: DrawingTool) => {
    if (drawingToolRef.current === tool) {
      return
    }

    fmeDispatch.setDrawingTool(tool)
  })

  const [areaWarning, setAreaWarning] = React.useState(false)
  const [modeNotice, setModeNotice] = React.useState<ModeNotice | null>(null)
  /* Textstatus under startup-validering */
  const [startupStep, setStartupStep] = React.useState<string | undefined>()

  /* Beräknar startup-validerings-tillstånd */
  const isStartupPhase = viewMode === ViewMode.STARTUP_VALIDATION
  const startupValidationErrorDetails: SerializableErrorState | null =
    isStartupPhase && generalErrorDetails ? generalErrorDetails : null
  const startupGeneralError = isStartupPhase ? generalError : null
  const isStartupValidating = isStartupPhase && !startupValidationErrorDetails
  const startupValidationStep = isStartupPhase ? startupStep : undefined

  const updateAreaWarning = hooks.useEventCallback((next: boolean) => {
    setAreaWarning(Boolean(next))
  })

  const clearModeNotice = hooks.useEventCallback(() => {
    setModeNotice(null)
  })

  /* Hanterar övergång vid tvingad async-läge */
  const setForcedModeNotice = hooks.useEventCallback(
    (
      info: ServiceModeOverrideInfo | null,
      currentModules: EsriModules | null,
      currentView: JimuMapView | null
    ) => {
      if (!info) {
        setModeNotice(null)
        return
      }

      const params: { [key: string]: unknown } = {}
      if (typeof info.value === "number") {
        params.area =
          currentModules && currentView?.view?.spatialReference
            ? formatArea(
                info.value,
                currentModules,
                currentView.view.spatialReference
              )
            : Math.max(0, Math.round(info.value)).toLocaleString()
      }
      if (typeof info.threshold === "number") {
        params.threshold =
          currentModules && currentView?.view?.spatialReference
            ? formatArea(
                info.threshold,
                currentModules,
                currentView.view.spatialReference
              )
            : Math.max(0, Math.round(info.threshold)).toLocaleString()
      }

      setModeNotice({
        messageKey: "forcedAsyncArea",
        severity: "warning",
        params,
      })
    }
  )

  const clearWarmupTimer = hooks.useEventCallback(() => {
    if (warmupTimerRef.current != null) {
      if (typeof window !== "undefined") {
        window.clearTimeout(warmupTimerRef.current)
      }
      warmupTimerRef.current = null
    }
  })

  /* Removed scheduleRepositoryWarmup function */

  hooks.useUpdateEffect(() => {
    if (!isStartupPhase) {
      setStartupStep(undefined)
    }
  }, [isStartupPhase])

  /* Aktiverar popup-blockering när widget är aktiv */
  const enablePopupGuard = hooks.useEventCallback(
    (view: JimuMapView | null | undefined) => {
      if (!view?.view) return
      const mapView = view.view
      const popup = (mapView as any)?.popup as __esri.Popup | undefined
      if (popup) {
        popupSuppressionManager.acquire(
          popupClientIdRef.current,
          popup,
          mapView
        )
      }
      try {
        if (typeof (mapView as any).closePopup === "function") {
          ;(mapView as any).closePopup()
        } else if (popup && typeof popup.close === "function") {
          popup.close()
        }
      } catch (error) {
        logIfNotAbort("Failed to close map popup", error)
      }
    }
  )

  const disablePopupGuard = hooks.useEventCallback(() => {
    popupSuppressionManager.release(popupClientIdRef.current)
  })

  /* Stänger andra öppna widgets enligt autoCloseOtherWidgets-inställning */
  const closeOtherWidgets = hooks.useEventCallback(() => {
    const autoCloseSetting = configRef.current?.autoCloseOtherWidgets
    if (autoCloseSetting !== undefined && !autoCloseSetting) {
      return
    }
    try {
      const store = typeof getAppStore === "function" ? getAppStore() : null
      const state = store?.getState?.()
      const runtimeInfo = state?.widgetsRuntimeInfo as
        | { [id: string]: { state?: WidgetState | string } | undefined }
        | undefined
      const targets = computeWidgetsToClose(runtimeInfo, widgetId)
      if (targets.length) {
        dispatch(appActions.closeWidgets(targets))
      }
    } catch (err) {
      logIfNotAbort("closeOtherWidgets error", err)
    }
  })

  /* Felhantering via Redux dispatch */
  const dispatchError = useErrorDispatcher(dispatch, widgetId)
  const submissionAbort = useLatestAbortController()

  const navigateTo = hooks.useEventCallback((nextView: ViewMode) => {
    fmeDispatch.clearError("export")
    fmeDispatch.clearError("import")
    fmeDispatch.setViewMode(nextView)
  })

  /* Bygger symboler från konfigurerad drawingColor (config är källa) */
  const currentHex = (config as any)?.drawingColor || DEFAULT_DRAWING_HEX
  const symbolsRef = React.useRef(buildSymbols(hexToRgbArray(currentHex)))

  hooks.useUpdateEffect(() => {
    symbolsRef.current = buildSymbols(hexToRgbArray(currentHex))
  }, [currentHex])

  /* Rensar FME-klient och nollställer cache-nyckel */
  const disposeFmeClient = hooks.useEventCallback(() => {
    if (fmeClientRef.current?.dispose) {
      try {
        fmeClientRef.current.dispose()
      } catch (error) {
        logIfNotAbort("Failed to dispose FME client", error)
      }
    }
    fmeClientRef.current = null
    fmeClientKeyRef.current = null
  })

  /* Skapar eller återanvänder FME-klient baserat på cache-nyckel */
  const getOrCreateFmeClient = hooks.useEventCallback(() => {
    const latestConfig = configRef.current
    if (!latestConfig) {
      throw new Error("FME client configuration unavailable")
    }

    const keyParts = [
      latestConfig.fmeServerUrl ?? (latestConfig as any).fme_server_url ?? "",
      latestConfig.fmeServerToken ??
        (latestConfig as any).fme_server_token ??
        (latestConfig as any).fmw_server_token ??
        "",
      latestConfig.repository ?? "",
      latestConfig.requestTimeout ?? "",
    ].map((part) => ((part ?? part === 0) ? String(part) : ""))
    const key = keyParts.join("|")

    if (!fmeClientRef.current || fmeClientKeyRef.current !== key) {
      disposeFmeClient()
      fmeClientRef.current = createFmeFlowClient(latestConfig as any)
      fmeClientKeyRef.current = key
    }

    if (!fmeClientRef.current) {
      throw new Error("Failed to initialize FME client")
    }

    return fmeClientRef.current
  })

  hooks.useUpdateEffect(() => {
    if (!config) {
      disposeFmeClient()
    }
  }, [config])

  hooks.useUpdateEffect(() => {
    if (!config?.fmeServerUrl || !config?.fmeServerToken) {
      clearWarmupTimer()
    }
  }, [
    config?.fmeServerUrl,
    config?.fmeServerToken,
    config?.repository,
    clearWarmupTimer,
  ])

  hooks.useUnmount(() => {
    submissionAbort.cancel()
    startupAbort.cancel()
    disposeFmeClient()
    disablePopupGuard()
    clearWarmupTimer()
    safeAbort(completionControllerRef.current)
    completionControllerRef.current = null
  })

  /* Centraliserade Redux-återställnings-hjälpfunktioner */
  const resetReduxForRevalidation = hooks.useEventCallback(() => {
    const activeTool = drawingToolRef.current

    fmeDispatch.resetState()
    updateAreaWarning(false)

    fmeDispatch.clearWorkspaceState()

    if (activeTool) {
      fmeDispatch.setDrawingTool(activeTool)
    }
  })

  const resetReduxToInitialDrawing = hooks.useEventCallback(() => {
    fmeDispatch.resetToDrawing()
    updateAreaWarning(false)
    updateDrawingSession({ isActive: false, clickCount: 0 })
  })

  const [moduleRetryKey, setModuleRetryKey] = React.useState(0)

  const requestModuleReload = hooks.useEventCallback(() => {
    setModuleRetryKey((prev) => prev + 1)
  })

  /* Renderar felvy med översättning och support-ledtrådar */
  const renderWidgetError = hooks.useEventCallback(
    (
      error: ErrorState | null,
      onRetry?: () => void
    ): React.ReactElement | null => {
      if (shouldSuppressError(error)) return null

      const supportEmail = getSupportEmail(configRef.current?.supportEmail)
      const context = buildErrorContext(
        error,
        supportEmail,
        translate,
        formatErrorForView
      )
      const resolvedMessage = resolveMessageOrKey(context.message, translate)

      /* Bygger retry-action som rensar fel och återgår till ritläge */
      const defaultRetryHandler = () => {
        fmeDispatch.clearError("general")
        const codeUpper = (error?.code || "").toUpperCase()
        const isAoiRetryable =
          codeUpper === "GEOMETRY_INVALID" ||
          codeUpper === "INVALID_GEOMETRY" ||
          codeUpper === "AREA_TOO_LARGE"

        if (isAoiRetryable) {
          setShouldAutoStart(true)
          fmeDispatch.setViewMode(ViewMode.DRAWING)
          try {
            if (!sketchViewModel && modules && jimuMapView) {
              handleMapViewReady(jimuMapView)
            }
          } catch {}
        }
      }

      const actions = createErrorActions(
        error,
        {
          onRetry: onRetry ?? defaultRetryHandler,
          onReload: isNavigatorOffline()
            ? () => {
                try {
                  ;(globalThis as any).location?.reload()
                } catch {}
              }
            : undefined,
        },
        translate
      )

      const hintText = toTrimmedString(context.hint)
      const supportDetail = !hintText
        ? undefined
        : context.suppressSupport
          ? hintText
          : renderSupportHint(supportEmail, translate, styles, hintText)

      return (
        <StateView
          state={makeErrorView(resolvedMessage, {
            code: context.code,
            actions,
            detail: supportDetail,
          })}
        />
      )
    }
  )

  const {
    modules,
    loading: modulesLoading,
    errorKey: modulesErrorKey,
  } = useEsriModules(moduleRetryKey)

  const mapResources = useMapResources()

  /* Destrukturerar kartresurser från custom hook */
  const {
    jimuMapView,
    setJimuMapView,
    sketchViewModel,
    setSketchViewModel,
    graphicsLayer,
    setGraphicsLayer,
    setCleanupHandles,
    teardownDrawingResources,
    cleanupResources,
  } = mapResources

  /* Synkar modulers laddningsstatus med Redux */
  hooks.useEffectWithPreviousValues(() => {
    fmeDispatchRef.current.setLoadingFlag("modules", Boolean(modulesLoading))
  }, [modulesLoading])

  hooks.useUpdateEffect(() => {
    if (!modulesErrorKey) {
      return
    }
    dispatchError(modulesErrorKey, ErrorType.MODULE, "MAP_MODULES_LOAD_FAILED")
  }, [modulesErrorKey, dispatchError])

  hooks.useUpdateEffect(() => {
    if (
      !modulesLoading &&
      modules &&
      generalError?.code === "MAP_MODULES_LOAD_FAILED"
    ) {
      fmeDispatchRef.current.clearError("general")
    }
  }, [modulesLoading, modules, generalError?.code])

  /* Annonserar viktiga vyändringar för skärmläsare */
  hooks.useUpdateEffect(() => {
    if (viewMode === ViewMode.WORKSPACE_SELECTION) {
      setAnnouncement(translate("workspaceSelectionReady"))
      return
    }

    if (viewMode === ViewMode.EXPORT_FORM) {
      setAnnouncement(translate("formReady"))
      return
    }

    if (viewMode === ViewMode.ORDER_RESULT) {
      const key = orderResult?.success ? "orderSuccess" : "orderFailed"
      setAnnouncement(translate(key))
      return
    }

    setAnnouncement("")
  }, [viewMode, orderResult?.success, translate])

  const getActiveGeometry = hooks.useEventCallback(() => {
    if (!geometryJson || !modules?.Polygon) {
      return null
    }
    const polygonCtor: any = modules.Polygon
    try {
      if (typeof polygonCtor?.fromJSON === "function") {
        return polygonCtor.fromJSON(geometryJson as any)
      }
    } catch {
      return null
    }
    return null
  })

  hooks.useUpdateEffect(() => {
    if (viewMode !== ViewMode.EXPORT_FORM || !configRef.current) {
      clearModeNotice()
      return
    }

    let forcedInfo: ServiceModeOverrideInfo | null = null
    determineServiceMode({ data: {} }, configRef.current, {
      workspaceItem,
      areaWarning,
      drawnArea,
      onModeOverride: (info) => {
        forcedInfo = info
      },
    })

    forcedInfo
      ? setForcedModeNotice(forcedInfo, modules, jimuMapView)
      : clearModeNotice()
  }, [
    viewMode,
    workspaceItem,
    areaWarning,
    drawnArea,
    modules,
    jimuMapView,
    config?.syncMode,
    config?.largeArea,
    clearModeNotice,
    setForcedModeNotice,
  ])

  /* Aktivitetsstatus för widgeten från Redux */
  const isActive = hooks.useWidgetActived(widgetId)

  const endSketchSession = hooks.useEventCallback(
    (options?: { clearLocalGeometry?: boolean }) => {
      setShouldAutoStart(false)
      if (options?.clearLocalGeometry) {
        updateDrawingSession({ clickCount: 0 })
      }
      if (sketchViewModel) {
        safeCancelSketch(sketchViewModel)
      }
      updateDrawingSession({ isActive: false })
    }
  )

  const exitDrawingMode = hooks.useEventCallback(
    (nextViewMode: ViewMode, options?: { clearLocalGeometry?: boolean }) => {
      endSketchSession(options)
      fmeDispatch.setViewMode(nextViewMode)
    }
  )

  // Uppdaterar uppstarts-valideringssteg
  const setValidationStep = hooks.useEventCallback((step: string) => {
    setStartupStep(step)
  })

  const setValidationSuccess = hooks.useEventCallback(() => {
    setStartupStep(undefined)
    fmeDispatch.clearError("general")
    fmeDispatch.completeStartup()
    /* Removed scheduleRepositoryWarmup call */
    const currentViewMode = viewModeRef.current
    const isUnset =
      currentViewMode === null || typeof currentViewMode === "undefined"
    const isStartupPhase =
      currentViewMode === ViewMode.STARTUP_VALIDATION ||
      currentViewMode === ViewMode.INITIAL
    if (isUnset || isStartupPhase) {
      navigateTo(ViewMode.DRAWING)
    }
  })

  const setValidationError = hooks.useEventCallback((error: ErrorState) => {
    setStartupStep(undefined)
    fmeDispatch.setError("general", error)
  })

  /* Skapar konsekvent startup-valideringsfel med retry-callback */
  const createStartupError = hooks.useEventCallback(
    (messageKey: string, code: string, retry?: () => void): ErrorState => ({
      message: translate(messageKey),
      type: ErrorType.CONFIG,
      code,
      severity: ErrorSeverity.ERROR,
      recoverable: true,
      timestamp: new Date(),
      timestampMs: Date.now(),
      userFriendlyMessage: config?.supportEmail
        ? String(config.supportEmail)
        : "",
      suggestion: translate("actionRetryValidation"),
      retry,
      kind: "runtime",
    })
  )

  /* AbortController för att kunna avbryta pågående startup-validering */
  const startupAbort = useLatestAbortController()

  /* Kör startup-validering: karta, config, FME-anslutning, e-post */
  const runStartupValidation = hooks.useEventCallback(async () => {
    const controller = startupAbort.abortAndCreate()
    fmeDispatch.clearError("general")

    try {
      await runStartupValidationFlow({
        config,
        useMapWidgetIds: (useMapWidgetIds
          ? [...useMapWidgetIds]
          : []) as string[],
        translate,
        signal: controller.signal,
        onProgress: setValidationStep,
      })
      setValidationSuccess()
    } catch (err: unknown) {
      if (isAbortError(err)) {
        return
      }

      let parsedError: any = null
      try {
        if (err instanceof Error && err.message) {
          parsedError = JSON.parse(err.message)
        }
      } catch {}

      const errorToUse = parsedError || err
      const errorKey = mapErrorToKey(errorToUse) || "errorUnknown"
      const errorCode =
        typeof errorToUse === "object" &&
        errorToUse !== null &&
        "code" in errorToUse
          ? String(errorToUse.code)
          : "STARTUP_VALIDATION_FAILED"
      setValidationError(
        createStartupError(errorKey, errorCode, runStartupValidation)
      )
    } finally {
      startupAbort.finalize(controller)
    }
  })

  const retryModulesAndValidation = hooks.useEventCallback(() => {
    requestModuleReload()
    runStartupValidation()
  })

  /* Kör startup-validering när widgeten först laddas */
  hooks.useEffectOnce(() => {
    runStartupValidation()
    return () => {
      startupAbort.cancel()
    }
  })

  /* Återställer widget-state för ny validering */
  const resetForRevalidation = hooks.useEventCallback(
    (alsoCleanupMapResources = false) => {
      submissionAbort.cancel()
      startupAbort.cancel()

      setStartupStep(undefined)
      setShouldAutoStart(false)

      if (alsoCleanupMapResources) {
        cleanupResources()
      } else {
        teardownDrawingResources()
      }

      updateDrawingSession({ isActive: false, clickCount: 0 })
      resetReduxForRevalidation()
    }
  )

  /* Spårar tidigare anslutningsinställningar för att upptäcka ändringar */
  hooks.useEffectWithPreviousValues(
    (prevValues) => {
      const prevConfig = prevValues[0] as FmeExportConfig | undefined
      /* Hoppar över första renderingen för att bevara initial laddning */
      if (!prevConfig) return
      const nextConfig = config

      const serverChanged =
        prevConfig?.fmeServerUrl !== nextConfig?.fmeServerUrl
      const tokenChanged =
        prevConfig?.fmeServerToken !== nextConfig?.fmeServerToken
      const repoChanged = prevConfig?.repository !== nextConfig?.repository

      try {
        if (serverChanged || tokenChanged || repoChanged) {
          /* Full omvalidering krävs vid byte av anslutning eller repository */
          resetForRevalidation(false)
          /* Fördröjer validering något för att låta ev. UI-övergångar slutföras */
          const timerId = window.setTimeout(() => {
            runStartupValidation()
          }, 50)
          return () => {
            window.clearTimeout(timerId)
          }
        }
      } catch {}
    },
    [config]
  )

  /* Kör om startup-validering vid ändring av kartkonfiguration */
  hooks.useUpdateEffect(() => {
    try {
      /* Om ingen karta konfigurerad, rensa även kartresurser */
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
      resetForRevalidation(!hasMapConfigured)
    } catch {}

    /* Kör om validering med ny kartkonfiguration */
    runStartupValidation()
  }, [useMapWidgetIds])

  /* Återställer grafik och mätningar utan att röra kartresurser */
  const resetGraphicsAndMeasurements = hooks.useEventCallback(() => {
    safeClearLayer(graphicsLayer)
  })

  /* Hanterar slutförd ritning med geometri-validering och area-beräkning */
  const onDrawComplete = hooks.useEventCallback(
    async (evt: __esri.SketchCreateEvent) => {
      if (!evt.graphic?.geometry) return

      const previousController = completionControllerRef.current
      if (previousController && !previousController.signal.aborted) {
        safeAbort(previousController)
      }

      const controller = new AbortController()
      completionControllerRef.current = controller
      isCompletingRef.current = true

      try {
        endSketchSession()
        updateAreaWarning(false)

        const result = await processDrawingCompletion({
          geometry: evt.graphic.geometry,
          modules,
          graphicsLayer,
          config,
          signal: controller.signal,
        })

        if (controller.signal.aborted) return

        if (!result.success) {
          try {
            graphicsLayer?.remove(evt.graphic as any)
          } catch {}

          if (!controller.signal.aborted) {
            teardownDrawingResources()
            fmeDispatch.setGeometry(null, 0)
            updateAreaWarning(false)
            exitDrawingMode(ViewMode.INITIAL, { clearLocalGeometry: true })

            if (result.error) {
              if (result.error.code === "ZERO_AREA") {
                dispatchError(
                  translate("geometryInvalidCode"),
                  ErrorType.VALIDATION,
                  "ZERO_AREA"
                )
              } else if (result.error.message) {
                dispatchError(
                  result.error.message,
                  ErrorType.VALIDATION,
                  result.error.code
                )
              } else {
                fmeDispatch.setError("general", result.error)
              }
            }
          }
          return
        }

        updateAreaWarning(result.shouldWarn || false)

        if (evt.graphic && result.geometry) {
          evt.graphic.geometry = result.geometry
          const highlightSymbol = symbolsRef.current?.HIGHLIGHT_SYMBOL
          if (highlightSymbol) {
            evt.graphic.symbol = highlightSymbol as any
          }
        }

        if (result.geometry && result.area !== undefined) {
          fmeDispatch.completeDrawing(
            result.geometry,
            result.area,
            ViewMode.WORKSPACE_SELECTION
          )
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          updateAreaWarning(false)
          dispatchError(
            translate("errorDrawingComplete"),
            ErrorType.VALIDATION,
            "DRAWING_COMPLETE_ERROR"
          )
        }
      } finally {
        if (completionControllerRef.current === controller) {
          completionControllerRef.current = null
        }
        isCompletingRef.current = false
      }
    }
  )

  // Slutför orderprocessen genom att spara resultat i Redux och navigera
  const finalizeOrder = hooks.useEventCallback((result: ExportResult) => {
    const currentRuntimeState = runtimeState
    if (currentRuntimeState === WidgetState.Closed) {
      return
    }

    fmeDispatch.setOrderResult(result)
    navigateTo(ViewMode.ORDER_RESULT)
  })

  /* Removed extractScheduleMetadata function */

  /* Hanterar lyckad submission och bygger resultat-objekt */
  const handleSubmissionSuccess = (
    fmeResponse: unknown,
    workspace: string,
    userEmail: string,
    formData: { [key: string]: unknown } | undefined,
    serviceMode?: ServiceMode | null
  ) => {
    const baseResult = processFmeResponse(
      fmeResponse,
      workspace,
      userEmail,
      translate
    )

    const nextResult: ExportResult = {
      ...baseResult,
      ...(serviceMode ? { serviceMode } : {}),
    }

    finalizeOrder(nextResult)
  }

  /* Hanterar submission-fel och bygger användarmeddelande */
  const handleSubmissionError = (
    error: unknown,
    serviceMode?: ServiceMode | null
  ) => {
    if (isAbortError(error)) {
      return
    }

    /* Översätter fel till lokaliserad nyckel */
    const rawKey = mapErrorToKey(error) || "errorUnknown"
    let localizedErr = ""
    try {
      localizedErr = resolveMessageOrKey(rawKey, translate)
    } catch {
      localizedErr = translate("errorUnknown")
    }
    /* Bygger felmeddelande med support-ledtråd */
    const configured = getSupportEmail(configRef.current?.supportEmail)
    const contactHint = buildSupportHintText(translate, configured)
    const baseFailMessage = translate("errorOrderFailed")
    const resultMessage =
      `${baseFailMessage}. ${localizedErr}. ${contactHint}`.trim()
    const result: ExportResult = {
      success: false,
      message: resultMessage,
      code: (error as { code?: string }).code || "SUBMISSION_ERROR",
      ...(serviceMode ? { serviceMode } : {}),
    }
    finalizeOrder(result)
  }

  /* Hanterar formulär-submission: validerar, förbereder, kör workspace */
  const handleFormSubmit = hooks.useEventCallback(async (formData: unknown) => {
    if (isSubmitting || !canExport) return

    const maxCheck = checkMaxArea(drawnArea, config?.maxArea)
    if (!maxCheck.ok && maxCheck.message) {
      setSubmissionPhase("idle")
      dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code)
      return
    }

    fmeDispatch.setLoadingFlag("submission", true)
    setSubmissionPhase("preparing")

    let controller: AbortController | null = null
    let serviceMode: ServiceMode | null = null

    try {
      const latestConfig = configRef.current
      const rawDataEarly = ((formData as any)?.data || {}) as {
        [key: string]: unknown
      }
      clearModeNotice()

      const determinedMode = determineServiceMode(
        { data: rawDataEarly },
        latestConfig,
        {
          workspaceItem,
          areaWarning,
          drawnArea,
          onModeOverride: setForcedModeNotice,
        }
      )
      serviceMode =
        determinedMode === "sync" || determinedMode === "async"
          ? determinedMode
          : null

      const fmeClient = getOrCreateFmeClient()
      const userEmail =
        serviceMode === "async" ? await getEmail(latestConfig) : ""
      const workspace = selectedWorkspace

      if (!workspace) {
        setSubmissionPhase("idle")
        return
      }

      controller = submissionAbort.abortAndCreate()
      const subfolder = `widget_${(props as any)?.id || "fme"}`

      const preparation = await prepareSubmissionParams({
        rawFormData: rawDataEarly,
        userEmail,
        geometryJson,
        geometry: getActiveGeometry() || undefined,
        modules,
        config: latestConfig,
        workspaceParameters,
        workspaceItem,
        selectedWorkspaceName: workspace,
        areaWarning,
        drawnArea,
        makeCancelable,
        fmeClient,
        signal: controller.signal,
        remoteDatasetSubfolder: subfolder,
        onStatusChange: handlePreparationStatus,
      })

      if (preparation.aoiError) {
        setSubmissionPhase("idle")
        fmeDispatch.setError("general", preparation.aoiError)
        return
      }

      const finalParams = preparation.params
      if (!finalParams)
        throw new Error("Submission parameter preparation failed")

      setSubmissionPhase("submitting")
      const fmeResponse = await makeCancelable(
        fmeClient.runWorkspace(
          workspace,
          finalParams,
          undefined,
          controller.signal
        )
      )

      if (!controller.signal.aborted) {
        handleSubmissionSuccess(
          fmeResponse,
          workspace,
          userEmail,
          rawDataEarly,
          serviceMode
        )
      }
    } catch (error) {
      handleSubmissionError(error, serviceMode)
    } finally {
      setSubmissionPhase("idle")
      fmeDispatch.setLoadingFlag("submission", false)
      submissionAbort.finalize(controller)
    }
  })

  /* Hanterar ny kartvy: skapar lager och SketchViewModel */
  const handleMapViewReady = hooks.useEventCallback((jmv: JimuMapView) => {
    /* Fångar alltid aktiv JimuMapView */
    setJimuMapView(jmv)
    if (!modules) {
      return
    }
    try {
      /* Säkerställer att kart-popups undertrycks när widget är aktiv */
      enablePopupGuard(jmv)

      const layer = createLayers(jmv, modules, setGraphicsLayer)
      try {
        /* Lokaliserar ritnings-lagrets titel */
        ;(layer as unknown as { [key: string]: any }).title =
          translate("labelDrawingLayer")
      } catch {}
      const { sketchViewModel: svm, cleanup } = createSketchVM({
        jmv,
        modules,
        layer,
        onDrawComplete,
        dispatch,
        widgetId,
        symbols: (symbolsRef.current as any)?.DRAWING_SYMBOLS,
        onDrawingSessionChange: updateDrawingSession,
        onSketchToolStart: handleSketchToolStart,
      })
      setCleanupHandles(cleanup)
      setSketchViewModel(svm)
    } catch (error) {
      dispatchError(
        translate("errorMapInit"),
        ErrorType.MODULE,
        "MAP_INIT_ERROR"
      )
    }
  })

  hooks.useUpdateEffect(() => {
    if (modules && jimuMapView && !sketchViewModel) {
      handleMapViewReady(jimuMapView)
    }
  }, [modules, jimuMapView, sketchViewModel, handleMapViewReady])

  hooks.useUpdateEffect(() => {
    if (!shouldAutoStart || !sketchViewModel) {
      return
    }

    setShouldAutoStart(false)

    const tool = drawingTool ?? DrawingTool.POLYGON
    const arg: "rectangle" | "polygon" =
      tool === DrawingTool.RECTANGLE ? "rectangle" : "polygon"

    try {
      const maybePromise = (sketchViewModel as any).create?.(arg)
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch((err: any) => {
          logIfNotAbort("Sketch create promise error", err)
        })
      }
    } catch (err: any) {
      logIfNotAbort("Sketch auto-start error", err)
    }
  }, [shouldAutoStart, sketchViewModel, drawingTool])

  /* Uppdaterar symboler när drawingColor ändras */
  hooks.useUpdateEffect(() => {
    const syms = (symbolsRef.current as any)?.DRAWING_SYMBOLS
    if (syms) {
      if (sketchViewModel) {
        try {
          ;(sketchViewModel as any).polygonSymbol = syms.polygon
          ;(sketchViewModel as any).polylineSymbol = syms.polyline
          ;(sketchViewModel as any).pointSymbol = syms.point
        } catch {}
      }
      if (graphicsLayer) {
        try {
          graphicsLayer.graphics.forEach((g: any) => {
            if (g?.geometry?.type === "polygon") {
              g.symbol = syms.polygon
            }
          })
        } catch {}
      }
    }
  }, [sketchViewModel, graphicsLayer, (config as any)?.drawingColor])

  /* Avbryter ritning om widget förlorar aktivering */
  hooks.useUpdateEffect(() => {
    if (!isActive && sketchViewModel) {
      safeCancelSketch(sketchViewModel)
    }
  }, [isActive, sketchViewModel])

  /* Rensar resurser vid kartvy-byte */
  hooks.useUpdateEffect(() => {
    const currentView = jimuMapView
    return () => {
      if (currentView) {
        cleanupResources()
      }
    }
  }, [jimuMapView, cleanupResources])

  /* Rensar alla resurser vid unmount */
  hooks.useEffectOnce(() => {
    return () => {
      /* Avbryter väntande requests */
      submissionAbort.cancel()
      startupAbort.cancel()
      /* Rensar FME-klient och frigör resurser */
      disposeFmeClient()
      /* Rensar kart-/ritresurser */
      cleanupResources()
      /* Tar bort widget-state från Redux */
      fmeDispatch.removeWidgetState()
    }
  })

  /* Returnerar instruktionstext beroende på ritverktyg och fas */
  const getDrawingInstructions = hooks.useEventCallback(
    (tool: DrawingTool, isDrawing: boolean, clickCount: number) => {
      /* Visar allmän instruktion före första klicket */
      if (clickCount === 0) {
        return translate("hintStartDrawing")
      }

      /* Efter första klicket, visa verktygsspecifika instruktioner */
      if (tool === DrawingTool.RECTANGLE) {
        return translate("hintDrawRectangle")
      }

      if (tool === DrawingTool.POLYGON) {
        if (clickCount < 3) {
          return translate("hintDrawPolygonContinue")
        }
        return translate("hintDrawPolygonComplete")
      }

      return translate("hintSelectDrawingMode")
    }
  )

  /* Startar ritning med valt verktyg */
  const handleStartDrawing = hooks.useEventCallback((tool: DrawingTool) => {
    if (!sketchViewModel) {
      return
    }

    ReactDOM.unstable_batchedUpdates(() => {
      /* Sätter verktyg och uppdaterar session-state */
      updateDrawingSession({ isActive: true, clickCount: 0 })

      fmeDispatch.setDrawingTool(tool)

      fmeDispatch.setViewMode(ViewMode.DRAWING)

      updateAreaWarning(false)
    })

    /* Rensar grafik och döljer mätningar */

    resetGraphicsAndMeasurements()

    /* Avbryter endast om SketchViewModel är aktivt ritande */
    try {
      const anyVm = sketchViewModel as any
      const isActive = Boolean(anyVm?.state === "active" || anyVm?._creating)

      if (isActive) {
        safeCancelSketch(sketchViewModel)
      }
    } catch {
      // fallback för avbrytning om allt annat misslyckas
      safeCancelSketch(sketchViewModel)
    } /* Startar ritning omedelbart; tidigare cancel undviker överlappning */
    const arg: "rectangle" | "polygon" =
      tool === DrawingTool.RECTANGLE ? "rectangle" : "polygon"

    if (sketchViewModel?.create) {
      try {
        const maybePromise = (sketchViewModel as any).create(arg)
        if (maybePromise && typeof maybePromise.catch === "function") {
          maybePromise.catch((err: any) => {
            logIfNotAbort("Sketch create promise error", err)
          })
        }
      } catch (err: any) {
        /* Sväljer oskadliga AbortError från racing cancel/create */

        logIfNotAbort("Sketch create error", err)
      }
    }
  })

  /* Spårar runtime-state (Controller) för att koordinera auto-start */
  const runtimeState = ReactRedux.useSelector(
    (state: IMState) => state.widgetsRuntimeInfo?.[widgetId]?.state
  )

  /* Tidigare runtime-state och repository för jämförelse */
  const prevRuntimeState = hooks.usePrevious(runtimeState)
  const prevRepository = hooks.usePrevious(configuredRepository)

  /* Auto-start ritning när i DRAWING-läge */
  const canAutoStartDrawing =
    viewMode === ViewMode.DRAWING &&
    drawingSession.clickCount === 0 &&
    !drawingSession.isActive &&
    !isCompletingRef.current &&
    sketchViewModel &&
    !isSubmitting &&
    !hasCriticalGeneralError

  hooks.useUpdateEffect(() => {
    /* Auto-startar endast om inte redan startat och widget ej stängd */
    if (canAutoStartDrawing && runtimeState !== WidgetState.Closed) {
      handleStartDrawing(drawingTool)
    }
  }, [
    viewMode,
    drawingSession.clickCount,
    drawingSession.isActive,
    drawingTool,
    sketchViewModel,
    isSubmitting,
    handleStartDrawing,
    runtimeState,
    hasCriticalGeneralError,
  ])

  /* Återställer widget vid stängning */
  const handleReset = hooks.useEventCallback(() => {
    submissionAbort.cancel()
    setSubmissionPhase("idle")
    /* Rensar grafik och mätningar men behåller kartresurser */
    resetGraphicsAndMeasurements()

    /* Rensar varningar och lokalt rittillstånd */
    updateAreaWarning(false)
    updateDrawingSession({ isActive: false, clickCount: 0 })

    /* Avbryter pågående ritning */
    if (sketchViewModel) {
      safeCancelSketch(sketchViewModel)
    }
    resetReduxToInitialDrawing()
    closeOtherWidgets()
    if (jimuMapView) {
      enablePopupGuard(jimuMapView)
    }
  })
  hooks.useUpdateEffect(() => {
    /* Återställer vid stängning av widget */
    if (
      runtimeState === WidgetState.Closed &&
      prevRuntimeState !== WidgetState.Closed
    ) {
      handleReset()
    }
  }, [runtimeState, prevRuntimeState, handleReset])

  /* Stänger popups när widget öppnas */
  hooks.useUpdateEffect(() => {
    const isShowing =
      runtimeState === WidgetState.Opened || runtimeState === WidgetState.Active
    const wasClosed =
      prevRuntimeState === WidgetState.Closed ||
      prevRuntimeState === WidgetState.Hidden ||
      typeof prevRuntimeState === "undefined"

    if (isShowing && wasClosed) {
      closeOtherWidgets()
      if (jimuMapView) {
        enablePopupGuard(jimuMapView)
      }
      const currentViewMode = viewModeRef.current
      if (
        currentViewMode === ViewMode.ORDER_RESULT ||
        currentViewMode === ViewMode.EXPORT_FORM ||
        currentViewMode === ViewMode.WORKSPACE_SELECTION
      ) {
        resetReduxToInitialDrawing()
      }

      /* Kör alltid validering när widget öppnas igen */
      runStartupValidation()
    }
  }, [
    runtimeState,
    prevRuntimeState,
    jimuMapView,
    closeOtherWidgets,
    enablePopupGuard,
    resetReduxToInitialDrawing,
  ])

  /* Rensar ritresurser vid kritiska fel */
  hooks.useUpdateEffect(() => {
    if (hasCriticalGeneralError) {
      teardownDrawingResources()
    }
  }, [hasCriticalGeneralError, teardownDrawingResources])

  /* Uppdaterar area-varning när geometri eller trösklar ändras */
  hooks.useUpdateEffect(() => {
    const hasGeometry = Boolean(geometryJson)
    if (!hasGeometry) {
      if (areaWarning) {
        updateAreaWarning(false)
      }
      return
    }

    const evaluation = evaluateArea(drawnArea, {
      maxArea: config?.maxArea,
      largeArea: config?.largeArea,
    })
    const shouldWarn = evaluation.shouldWarn
    if (shouldWarn !== areaWarning) {
      updateAreaWarning(shouldWarn)
    }
  }, [
    geometryJson,
    drawnArea,
    areaWarning,
    config?.largeArea,
    config?.maxArea,
    updateAreaWarning,
  ])

  /* Rensar area-varning vid repository-byte */
  hooks.useUpdateEffect(() => {
    if (configuredRepository !== prevRepository && areaWarning) {
      updateAreaWarning(false)
    }
  }, [configuredRepository, prevRepository, areaWarning, updateAreaWarning])

  /* Inaktiverar popup-guard när widget stängs eller döljs */
  hooks.useUpdateEffect(() => {
    if (
      runtimeState === WidgetState.Closed ||
      runtimeState === WidgetState.Hidden
    ) {
      disablePopupGuard()
    }
  }, [runtimeState, disablePopupGuard])

  /* Inaktiverar popup-guard när kartvy tas bort */
  hooks.useUpdateEffect(() => {
    if (!jimuMapView) {
      disablePopupGuard()
    }
  }, [jimuMapView, disablePopupGuard])

  /* Workspace-hanterare */
  const handleWorkspaceSelected = hooks.useEventCallback(
    (
      workspaceName: string,
      parameters: readonly WorkspaceParameter[],
      workspaceItem: WorkspaceItemDetail
    ) => {
      fmeDispatchRef.current.applyWorkspaceData({
        workspaceName,
        parameters,
        item: workspaceItem,
      })
      navigateTo(ViewMode.EXPORT_FORM)
    }
  )

  const handleWorkspaceBack = hooks.useEventCallback(() => {
    navigateTo(ViewMode.INITIAL)
  })

  const navigateBack = hooks.useEventCallback(() => {
    const currentViewMode = viewModeRef.current ?? viewMode
    const defaultRoute = VIEW_ROUTES[currentViewMode] || ViewMode.INITIAL
    const target =
      previousViewMode && previousViewMode !== currentViewMode
        ? previousViewMode
        : defaultRoute
    navigateTo(target)
  })

  /* Renderar laddningsvy om moduler fortfarande laddas */
  if (modulesLoading) {
    return (
      <div css={styles.parent}>
        <StateView
          state={{
            kind: "loading",
            message: translate("statusPreparingMapTools"),
          }}
        />
      </div>
    )
  }
  if (!modules) {
    return (
      <div css={styles.parent}>
        {renderWidgetError(
          {
            message: "errorMapInit",
            type: ErrorType.MODULE,
            code: "MAP_MODULES_LOAD_FAILED",
            severity: ErrorSeverity.ERROR,
            recoverable: true,
            timestamp: new Date(),
            timestampMs: Date.now(),
          },
          retryModulesAndValidation
        )}
      </div>
    )
  }

  /* Felläge - prioriterar startup-valideringsfel, sedan generella fel */
  if (startupGeneralError) {
    /* Hanterar alltid startup-valideringsfel först */
    return (
      <div css={styles.parent}>
        {renderWidgetError(startupGeneralError, runStartupValidation)}
      </div>
    )
  }

  if (!isStartupPhase && hasCriticalGeneralError && generalError) {
    /* Hanterar andra fel (ej startup-validering) */
    return <div css={styles.parent}>{renderWidgetError(generalError)}</div>
  }

  /* Beräknar enkla view-booleans för läsbarhet */
  const showHeaderActions =
    (drawingSession.isActive || drawnArea > 0) &&
    !isSubmitting &&
    !modulesLoading

  /* Förkompilerar UI-booleans */
  const hasSingleMapWidget = Boolean(
    useMapWidgetIds && useMapWidgetIds.length === 1
  )

  /* Säkerhetskopierar config utan känsliga fält */
  let workflowConfig = config
  if (config) {
    const rest = { ...(config as any) }
    delete rest.fme_server_token
    delete rest.fmw_server_token
    workflowConfig = {
      ...rest,
      fmeServerToken: config.fmeServerToken,
    } as FmeExportConfig
  }

  return (
    <div css={styles.parent}>
      {hasSingleMapWidget && (
        <JimuMapViewComponent
          useMapWidgetId={useMapWidgetIds[0]}
          onActiveViewChange={handleMapViewReady}
        />
      )}

      <div
        aria-live="assertive"
        aria-atomic="true"
        style={{
          position: "absolute",
          left: "-10000px",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        {announcement}
      </div>

      <Workflow
        widgetId={widgetId}
        config={workflowConfig}
        geometryJson={geometryJson}
        workspaceItems={workspaceItems}
        state={viewMode}
        error={workflowError}
        instructionText={getDrawingInstructions(
          drawingTool,
          drawingSession.isActive,
          drawingSession.clickCount
        )}
        loadingState={{
          ...loadingState,
          modules: modulesLoading,
          submission: isSubmitting,
        }}
        isPrefetchingWorkspaces={isPrefetchingWorkspaces}
        workspacePrefetchProgress={workspacePrefetchProgress}
        workspacePrefetchStatus={workspacePrefetchStatus}
        modules={modules}
        canStartDrawing={!!sketchViewModel}
        submissionPhase={submissionPhase}
        modeNotice={modeNotice}
        onFormBack={() => navigateTo(ViewMode.WORKSPACE_SELECTION)}
        onFormSubmit={handleFormSubmit}
        orderResult={orderResult}
        onReuseGeography={() => navigateTo(ViewMode.WORKSPACE_SELECTION)}
        onBack={navigateBack}
        drawnArea={drawnArea}
        areaWarning={areaWarning}
        formatArea={(area: number) =>
          formatArea(area, modules, jimuMapView?.view?.spatialReference)
        }
        drawingMode={drawingTool}
        onDrawingModeChange={(tool) => {
          fmeDispatchRef.current.setDrawingTool(tool)
          if (sketchViewModel) {
            safeCancelSketch(sketchViewModel)
            updateDrawingSession({ isActive: false, clickCount: 0 })
          }
        }}
        // Ritnings-props
        isDrawing={drawingSession.isActive}
        clickCount={drawingSession.clickCount}
        isCompleting={isCompletingRef.current}
        // Header-props
        showHeaderActions={
          viewMode !== ViewMode.STARTUP_VALIDATION && showHeaderActions
        }
        onReset={handleReset}
        canReset={true}
        onWorkspaceSelected={handleWorkspaceSelected}
        onWorkspaceBack={handleWorkspaceBack}
        selectedWorkspace={selectedWorkspace}
        workspaceParameters={workspaceParameters}
        workspaceItem={workspaceItem}
        // Uppstarts-valideringsProps
        isStartupValidating={isStartupValidating}
        startupValidationStep={startupValidationStep}
        startupValidationError={startupValidationErrorDetails}
        onRetryValidation={runStartupValidation}
      />
    </div>
  )
}

/* Huvudexport med React Query provider */
export default function Widget(
  props: AllWidgetProps<FmeExportConfig>
): React.ReactElement {
  return (
    <QueryClientProvider client={fmeQueryClient}>
      <WidgetContent {...props} />
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}

/* Mappar extra Redux state-props för widgeten */
Reflect.set(
  Widget as any,
  "mapExtraStateProps",
  (state: IMStateWithFmeExport, ownProps: AllWidgetProps<any>) => {
    const globalState = state["fme-state"] as any
    const wid =
      (ownProps?.id as unknown as string) || (ownProps as any)?.widgetId
    const sub = (globalState?.byId && wid && globalState.byId[wid]) as
      | FmeWidgetState
      | undefined
    return { state: sub || initialFmeState }
  }
)
