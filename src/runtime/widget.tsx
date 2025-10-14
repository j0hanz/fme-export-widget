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
  WorkspaceItem,
  ErrorState,
  SerializableErrorState,
  DrawingSessionState,
  SubmissionPhase,
  SubmissionPreparationStatus,
  ModeNotice,
  ServiceModeOverrideInfo,
} from "../config/index"
import {
  makeErrorView,
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  VIEW_ROUTES,
  DEFAULT_DRAWING_HEX,
  DEFAULT_REPOSITORY,
  WORKSPACE_ITEM_TYPE,
  MS_LOADING,
} from "../config/index"
import {
  validateWidgetStartup,
  prepareSubmissionParams,
  createLayers,
  createSketchVM,
} from "../shared/services"
import {
  mapErrorToKey,
  calcArea,
  validatePolygon,
  checkMaxArea,
  evaluateArea,
  processFmeResponse,
  validateRequiredFields,
} from "../shared/validations"
import {
  fmeActions,
  initialFmeState,
  createFmeSelectors,
} from "../extensions/store"
import {
  resolveMessageOrKey,
  buildSupportHintText,
  getEmail,
  determineServiceMode,
  formatArea,
  isValidEmail,
  getSupportEmail,
  formatErrorForView,
  useLatestAbortController,
  toTrimmedString,
  logIfNotAbort,
  popupSuppressionManager,
  hexToRgbArray,
  buildSymbols,
  isNavigatorOffline,
  computeWidgetsToClose,
  buildTokenCacheKey,
} from "../shared/utils"
import {
  useEsriModules,
  useMapResources,
  useErrorDispatcher,
  safeCancelSketch,
  safeClearLayer,
  useDebounce,
  usePrefetchWorkspaces,
} from "../shared/hooks"

/* Konverteringsfaktor för filstorlekar */
const BYTES_PER_MEGABYTE = 1024 * 1024

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
  /* Hämtar viewMode och drawingTool med optimerad memoization */
  const { viewMode, drawingTool } = ReactRedux.useSelector(
    (state: IMStateWithFmeExport) => {
      const vm = selectors.selectViewMode(state)
      const dt = selectors.selectDrawingTool(state)
      return { viewMode: vm, drawingTool: dt }
    },
    (prev, next) => {
      return (
        prev.viewMode === next.viewMode && prev.drawingTool === next.drawingTool
      )
    }
  )
  const geometryJson = ReactRedux.useSelector((state: IMStateWithFmeExport) => {
    return selectors.selectGeometryJson(state)
  })
  const drawnArea = ReactRedux.useSelector((state: IMStateWithFmeExport) => {
    return selectors.selectDrawnArea(state)
  })
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
  const scopedError = ReactRedux.useSelector(selectors.selectError)
  const previousViewMode = hooks.usePrevious(viewMode)
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
  /* Unik identifierare för popup-suppression i denna widget-instans */
  const popupClientIdRef = React.useRef<symbol>(
    Symbol(widgetId ? `fme-popup-${widgetId}` : "fme-popup")
  )
  /* Timer för fördröjd repository cache warmup */
  const warmupTimerRef = React.useRef<number | null>(null)

  /* Spårar aktiv ritningssession och antal klick */
  const [drawingSession, setDrawingSession] =
    React.useState<DrawingSessionState>(() => ({
      isActive: false,
      clickCount: 0,
    }))

  /* Spårar submission-fas för feedback under export */
  const [submissionPhase, setSubmissionPhase] =
    React.useState<SubmissionPhase>("idle")

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

    dispatch(fmeActions.setDrawingTool(tool, widgetId))
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

  /* Sätter modenotis baserat på tvingad servicemode (async/schedule) */
  const setForcedModeNotice = hooks.useEventCallback(
    (info: ServiceModeOverrideInfo | null) => {
      if (!info) {
        setModeNotice(null)
        return
      }

      const params: { [key: string]: unknown } = {}
      let messageKey = "forcedAsyncDefault"

      /* Bygger meddelandeparametrar beroende på tvångsskäl */
      switch (info.reason) {
        case "runtime": {
          if (typeof info.value === "number") {
            params.seconds = Math.max(0, Math.round(info.value))
          }
          if (typeof info.threshold === "number") {
            params.threshold = Math.max(0, Math.round(info.threshold))
          }
          messageKey = "forcedAsyncRuntime"
          break
        }
        case "transformers": {
          if (typeof info.value === "number") {
            params.count = Math.max(0, Math.round(info.value))
          }
          if (typeof info.threshold === "number") {
            params.threshold = Math.max(0, Math.round(info.threshold))
          }
          messageKey = "forcedAsyncTransformers"
          break
        }
        case "fileSize": {
          if (typeof info.value === "number") {
            const sizeMb = info.value / BYTES_PER_MEGABYTE
            params.sizeMb =
              sizeMb >= 10 ? Math.round(sizeMb) : sizeMb.toFixed(1)
          }
          if (typeof info.threshold === "number") {
            const thresholdMb = info.threshold / BYTES_PER_MEGABYTE
            params.thresholdMb =
              thresholdMb >= 10
                ? Math.round(thresholdMb)
                : thresholdMb.toFixed(1)
          }
          messageKey = "forcedAsyncFileSize"
          break
        }
        case "area": {
          if (typeof info.value === "number") {
            params.area =
              modules && jimuMapView?.view?.spatialReference
                ? formatArea(
                    info.value,
                    modules,
                    jimuMapView?.view?.spatialReference
                  )
                : Math.max(0, Math.round(info.value)).toLocaleString()
          }
          if (typeof info.threshold === "number") {
            params.threshold =
              modules && jimuMapView?.view?.spatialReference
                ? formatArea(
                    info.threshold,
                    modules,
                    jimuMapView?.view?.spatialReference
                  )
                : Math.max(0, Math.round(info.threshold)).toLocaleString()
          }
          messageKey = "forcedAsyncArea"
          break
        }
      }

      setModeNotice({
        messageKey,
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

  /* Förladdar workspace-listan från FME Flow för snabbare användarval */
  const warmRepositoryCache = hooks.useEventCallback(() => {
    const latestConfig = configRef.current
    if (!latestConfig?.fmeServerUrl || !latestConfig?.fmeServerToken) {
      return
    }

    const repository = latestConfig.repository || DEFAULT_REPOSITORY
    const tokenKey = buildTokenCacheKey(latestConfig.fmeServerToken)
    const queryKey = [
      "fme",
      "workspaces",
      repository,
      latestConfig.fmeServerUrl,
      tokenKey,
    ] as const

    void fmeQueryClient
      .fetchQuery<WorkspaceItem[]>({
        queryKey,
        staleTime: 5 * 60 * 1000,
        retry: 1,
        queryFn: async ({ signal }) => {
          const client = getOrCreateFmeClient()
          const response = await client.getRepositoryItems(
            repository,
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
      })
      .then((items) => {
        if (Array.isArray(items) && items.length) {
          dispatch(fmeActions.setWorkspaceItems(items, widgetId))
        }
      })
      .catch((error) => {
        logIfNotAbort("Repository warmup error", error)
      })
  })

  const scheduleRepositoryWarmup = hooks.useEventCallback(() => {
    clearWarmupTimer()
    if (typeof window === "undefined") {
      warmRepositoryCache()
      return
    }
    warmupTimerRef.current = window.setTimeout(() => {
      warmupTimerRef.current = null
      warmRepositoryCache()
    }, 300)
  })

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
    dispatch(fmeActions.clearError("export", widgetId))
    dispatch(fmeActions.clearError("import", widgetId))
    dispatch(fmeActions.setViewMode(nextView, widgetId))
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

  /* Expanderar serialiserat fel till fullt ErrorState-objekt */
  function expandSerializableError(
    error: SerializableErrorState | null | undefined
  ): ErrorState | null {
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

  hooks.useUpdateEffect(() => {
    if (!config) {
      disposeFmeClient()
    }
  }, [config, disposeFmeClient])

  hooks.useUpdateEffect(() => {
    if (!config?.fmeServerUrl || !config?.fmeServerToken) {
      clearWarmupTimer()
      return
    }

    scheduleRepositoryWarmup()
  }, [
    config?.fmeServerUrl,
    config?.fmeServerToken,
    config?.repository,
    scheduleRepositoryWarmup,
    clearWarmupTimer,
  ])

  hooks.useUnmount(() => {
    submissionAbort.cancel()
    startupAbort.cancel()
    disposeFmeClient()
    disablePopupGuard()
    clearWarmupTimer()
  })

  /* Centraliserade Redux-återställnings-hjälpfunktioner */
  const resetReduxForRevalidation = hooks.useEventCallback(() => {
    const activeTool = drawingToolRef.current

    dispatch(fmeActions.resetState(widgetId))
    updateAreaWarning(false)

    dispatch(fmeActions.clearWorkspaceState(widgetId))

    if (activeTool) {
      dispatch(fmeActions.setDrawingTool(activeTool, widgetId))
    }
  })

  const resetReduxToInitialDrawing = hooks.useEventCallback(() => {
    dispatch(fmeActions.resetToDrawing(widgetId))
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
      if (!error) return null

      /* Undertrycker avbrutna/cancelled fel från användargränssnittet */
      if (
        error.code === "CANCELLED" ||
        error.code === "ABORT" ||
        /cancel/i.test(error.message)
      ) {
        return null
      }

      /* Översätter felmeddelande och bestämmer användarhjälp */
      const baseMsgKey = error.message || "errorUnknown"
      const resolvedMessage = resolveMessageOrKey(baseMsgKey, translate)

      /* Avgör om support-ledtråd ska visas baserat på feltyp */
      const codeUpper = (error.code || "").toUpperCase()
      const isGeometryInvalid =
        codeUpper === "GEOMETRY_INVALID" || codeUpper === "INVALID_GEOMETRY"
      const isAreaTooLarge = codeUpper === "AREA_TOO_LARGE"
      const isAoiRetryableError = isGeometryInvalid || isAreaTooLarge
      const isConfigIncomplete = codeUpper === "CONFIG_INCOMPLETE"
      const suppressSupport = isAoiRetryableError || isConfigIncomplete

      /* Bygger kontextuell felhjälp beroende på feltyp */
      const ufm = error.userFriendlyMessage
      const supportEmail = getSupportEmail(configRef.current?.supportEmail)
      const supportHint = isGeometryInvalid
        ? translate("hintGeometryInvalid")
        : isAreaTooLarge
          ? translate("hintAreaTooLarge")
          : isConfigIncomplete
            ? translate("hintSetupWidget")
            : formatErrorForView(
                translate,
                baseMsgKey,
                error.code,
                supportEmail,
                typeof ufm === "string" ? ufm : undefined
              ).hint

      /* Bygger retry-action som rensar fel och återgår till ritläge */
      const actions: Array<{ label: string; onClick: () => void }> = []
      const retryHandler =
        onRetry ??
        (() => {
          /* Rensar fel och återgår till ritläge vid geometry-fel */
          dispatch(fmeActions.clearError("general", widgetId))
          if (isAoiRetryableError) {
            /* Markerar att ritning ska auto-starta när verktyg återinits */
            setShouldAutoStart(true)
            dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
            /* Om ritresurser rensades, återinitierar dem nu */
            try {
              if (!sketchViewModel && modules && jimuMapView) {
                handleMapViewReady(jimuMapView)
              }
            } catch {}
          }
        })
      actions.push({ label: translate("actionRetry"), onClick: retryHandler })

      /* Lägger till reload-knapp vid offline-fel */
      if (isNavigatorOffline()) {
        actions.push({
          label: translate("actionReload"),
          onClick: () => {
            try {
              ;(globalThis as any).location?.reload()
            } catch {}
          },
        })
      }

      const hintText = toTrimmedString(supportHint)
      const supportDetail = !hintText
        ? undefined
        : suppressSupport
          ? hintText
          : renderSupportHint(supportEmail, translate, styles, hintText)

      return (
        <StateView
          state={makeErrorView(resolvedMessage, {
            code: suppressSupport ? undefined : error.code,
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
  const [latchedModulesLoading, setLatchedModulesLoading] = React.useState(() =>
    Boolean(modulesLoading)
  )
  const debounceModulesLoading = useDebounce((next: boolean) => {
    setLatchedModulesLoading(next)
  }, MS_LOADING)

  hooks.useEffectWithPreviousValues(() => {
    if (modulesLoading) {
      debounceModulesLoading.cancel()
      if (!latchedModulesLoading) {
        setLatchedModulesLoading(true)
      }
      return
    }

    if (latchedModulesLoading) {
      debounceModulesLoading(false)
    }
  }, [modulesLoading, latchedModulesLoading, debounceModulesLoading])
  const mapResources = useMapResources()

  /* Synkar modulers laddningsstatus med Redux */
  hooks.useEffectWithPreviousValues(() => {
    dispatch(
      fmeActions.setLoadingFlag("modules", Boolean(modulesLoading), widgetId)
    )
  }, [modulesLoading, dispatch, widgetId])

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
      dispatch(fmeActions.clearError("general", widgetId))
    }
  }, [modulesLoading, modules, generalError?.code, dispatch, widgetId])

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
    if (viewMode !== ViewMode.EXPORT_FORM) {
      clearModeNotice()
      return
    }

    const latestConfig = configRef.current
    if (!latestConfig) {
      clearModeNotice()
      return
    }

    let forcedInfo: ServiceModeOverrideInfo | null = null
    determineServiceMode({ data: {} }, latestConfig, {
      workspaceItem,
      areaWarning,
      drawnArea,
      onModeOverride: (info) => {
        forcedInfo = info
      },
    })

    if (forcedInfo) {
      setForcedModeNotice(forcedInfo)
      return
    }

    clearModeNotice()
  }, [
    viewMode,
    workspaceItem,
    areaWarning,
    drawnArea,
    config?.syncMode,
    config?.allowScheduleMode,
    config?.largeArea,
    clearModeNotice,
    setForcedModeNotice,
  ])

  /* Aktivitetsstatus för widgeten från Redux */
  const isActive = hooks.useWidgetActived(widgetId)

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
      dispatch(fmeActions.setViewMode(nextViewMode, widgetId))
    }
  )

  // Startup validation step updater
  const setValidationStep = hooks.useEventCallback((step: string) => {
    setStartupStep(step)
  })

  const setValidationSuccess = hooks.useEventCallback(() => {
    setStartupStep(undefined)
    dispatch(fmeActions.clearError("general", widgetId))
    dispatch(fmeActions.completeStartup(widgetId))
    scheduleRepositoryWarmup()
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
    dispatch(fmeActions.setError("general", error, widgetId))
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
    dispatch(fmeActions.clearError("general", widgetId))
    setValidationStep(translate("validatingStartup"))

    try {
      /* Steg 1: validera kartkonfiguration */
      setValidationStep(translate("statusValidatingMap"))
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0

      /* Steg 2: validera widget-config och FME-anslutning */
      setValidationStep(translate("statusValidatingConnection"))
      const validationResult = await validateWidgetStartup({
        config,
        translate,
        signal: controller.signal,
        mapConfigured: hasMapConfigured,
      })

      if (!validationResult.isValid) {
        if (validationResult.error) {
          setValidationError(validationResult.error)
        } else if (validationResult.requiresSettings) {
          setValidationError(
            createStartupError(
              "configurationInvalid",
              "VALIDATION_FAILED",
              runStartupValidation
            )
          )
        } else {
          setStartupStep(undefined)
        }
        return
      }

      /* Steg 3: validera användarens e-post för async-läge */
      if (!config?.syncMode) {
        setValidationStep(translate("statusValidatingEmail"))
        try {
          const email = await getEmail(config)
          if (!isValidEmail(email)) {
            setValidationError(
              createStartupError(
                "userEmailMissingError",
                "UserEmailMissing",
                runStartupValidation
              )
            )
            return
          }
        } catch (emailErr) {
          setValidationError(
            createStartupError(
              "userEmailMissingError",
              "UserEmailMissing",
              runStartupValidation
            )
          )
          return
        }
      }

      /* All validering lyckades */
      setValidationSuccess()
    } catch (err: unknown) {
      const errorKey = mapErrorToKey(err) || "errorUnknown"
      const errorCode =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as any).code)
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
        if (serverChanged || tokenChanged) {
          /* Full omvalidering krävs vid byte av anslutning */
          resetForRevalidation(false)
          runStartupValidation()
        } else if (repoChanged) {
          /* Repository-byte: rensa workspace-state och omvalidera */
          resetForRevalidation(false)
          runStartupValidation()
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
      const geometry = evt.graphic?.geometry
      if (!geometry) {
        return
      }
      if (isCompletingRef.current) {
        return
      }

      isCompletingRef.current = true
      try {
        endSketchSession()
        updateAreaWarning(false)

        /* Validerar geometri och förenklar om nödvändigt */

        const validation = await validatePolygon(geometry, modules)

        if (!validation.valid) {
          try {
            graphicsLayer?.remove(evt.graphic as any)
          } catch {}
          teardownDrawingResources()
          dispatch(fmeActions.setGeometry(null, 0, widgetId))
          updateAreaWarning(false)
          exitDrawingMode(ViewMode.INITIAL, { clearLocalGeometry: true })
          if (validation.error) {
            dispatch(fmeActions.setError("general", validation.error, widgetId))
          }

          return
        }
        const geomForUse =
          (validation as { simplified?: __esri.Polygon | null }).simplified ??
          (geometry as __esri.Polygon)

        const calculatedArea = await calcArea(geomForUse, modules)

        if (!calculatedArea || calculatedArea <= 0) {
          updateAreaWarning(false)
          dispatchError(
            translate("geometryInvalidCode"),
            ErrorType.VALIDATION,
            "ZERO_AREA"
          )

          return
        }

        const normalizedArea = Math.abs(calculatedArea)

        const areaEvaluation = evaluateArea(normalizedArea, {
          maxArea: config?.maxArea,
          largeArea: config?.largeArea,
        })

        if (areaEvaluation.exceedsMaximum) {
          const maxCheck = checkMaxArea(normalizedArea, config?.maxArea)
          try {
            graphicsLayer?.remove(evt.graphic as any)
          } catch {}
          teardownDrawingResources()
          dispatch(fmeActions.setGeometry(null, 0, widgetId))
          updateAreaWarning(false)
          exitDrawingMode(ViewMode.INITIAL, { clearLocalGeometry: true })
          if (maxCheck.message) {
            const messageKey = maxCheck.message || "geometryAreaTooLargeCode"

            dispatchError(messageKey, ErrorType.VALIDATION, maxCheck.code)
          }

          return
        }

        updateAreaWarning(areaEvaluation.shouldWarn)

        if (evt.graphic) {
          evt.graphic.geometry = geomForUse
          const highlightSymbol = symbolsRef.current?.HIGHLIGHT_SYMBOL
          if (highlightSymbol) {
            evt.graphic.symbol = highlightSymbol as any
          }
        }

        dispatch(
          fmeActions.completeDrawing(
            geomForUse,
            normalizedArea,
            ViewMode.WORKSPACE_SELECTION,
            widgetId
          )
        )
        // Göm ritverktygen tills vidare
      } catch (error) {
        updateAreaWarning(false)
        dispatchError(
          translate("errorDrawingComplete"),
          ErrorType.VALIDATION,
          "DRAWING_COMPLETE_ERROR"
        )
        isCompletingRef.current = false
      }
    }
  )

  // Handle successful submission
  const finalizeOrder = hooks.useEventCallback((result: ExportResult) => {
    dispatch(fmeActions.setOrderResult(result, widgetId))
    navigateTo(ViewMode.ORDER_RESULT)
  })

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

    let nextResult: ExportResult = {
      ...baseResult,
      ...(serviceMode ? { serviceMode } : {}),
    }

    if (formData && config?.allowScheduleMode) {
      const startVal = toTrimmedString(formData.start)
      const name = toTrimmedString(formData.name)
      const category = toTrimmedString(formData.category)
      const description = toTrimmedString(formData.description)
      const trigger = toTrimmedString(formData.trigger)

      if (startVal && name && category) {
        const scheduleMetadata = {
          ...(nextResult.scheduleMetadata ?? {}),
          start: startVal,
          name,
          category,
          ...(description ? { description } : {}),
          ...(trigger ? { trigger } : {}),
        }
        nextResult = { ...nextResult, scheduleMetadata }
      }
    }

    finalizeOrder(nextResult)
  }

  /* Hanterar submission-fel och bygger användarmeddelande */
  const handleSubmissionError = (
    error: unknown,
    serviceMode?: ServiceMode | null
  ) => {
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
    if (isSubmitting || !canExport) {
      return
    }

    const maxCheck = checkMaxArea(drawnArea, config?.maxArea)
    if (!maxCheck.ok && maxCheck.message) {
      setSubmissionPhase("idle")
      dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code)
      return
    }

    dispatch(fmeActions.setLoadingFlag("submission", true, widgetId))
    setSubmissionPhase("preparing")

    let controller: AbortController | null = null
    let serviceMode: ServiceMode | null = null

    try {
      const latestConfig = configRef.current
      const rawDataEarly = ((formData as any)?.data || {}) as {
        [key: string]: unknown
      }
      clearModeNotice()
      /* Avgör serviceMode tidigt för e-post-krav */
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
        determinedMode === "sync" ||
        determinedMode === "async" ||
        determinedMode === "schedule"
          ? determinedMode
          : null
      const fmeClient = getOrCreateFmeClient()
      const requiresEmail =
        serviceMode === "async" || serviceMode === "schedule"
      const userEmail = requiresEmail ? await getEmail(latestConfig) : ""

      const workspace = selectedWorkspace
      if (!workspace) {
        setSubmissionPhase("idle")
        return
      }

      /* Skapar AbortController för denna request (upload + run) */
      controller = submissionAbort.abortAndCreate()

      /* Förbereder parametrar och hanterar remote URL / fil-upload */
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
        dispatch(fmeActions.setError("general", preparation.aoiError, widgetId))
        return
      }

      const finalParams = preparation.params
      if (!finalParams) {
        throw new Error("Submission parameter preparation failed")
      }
      setSubmissionPhase("submitting")
      /* Skickar till FME Flow */
      const fmeResponse = await makeCancelable(
        fmeClient.runWorkspace(
          workspace,
          finalParams,
          undefined,
          controller.signal
        )
      )
      handleSubmissionSuccess(
        fmeResponse,
        workspace,
        userEmail,
        rawDataEarly,
        serviceMode
      )
    } catch (error) {
      handleSubmissionError(error, serviceMode)
    } finally {
      setSubmissionPhase("idle")
      dispatch(fmeActions.setLoadingFlag("submission", false, widgetId))
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
    return () => {
      if (jimuMapView) {
        cleanupResources()
      }
    }
  }, [jimuMapView])

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
      dispatch(fmeActions.removeWidgetState(widgetId))
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

    /* Sätter verktyg och uppdaterar session-state */
    updateDrawingSession({ isActive: true, clickCount: 0 })

    dispatch(fmeActions.setDrawingTool(tool, widgetId))

    dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))

    updateAreaWarning(false)

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
      // fallback best-effort cancel
      safeCancelSketch(sketchViewModel)
    }

    /* Startar ritning omedelbart; tidigare cancel undviker överlappning */
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

  /* Clear isCompletingRef when workspace data is ready or loading starts */
  hooks.useUpdateEffect(() => {
    if (
      isCompletingRef.current &&
      viewMode === ViewMode.WORKSPACE_SELECTION
    ) {
      // Clear completing flag once workspace loading begins or data exists
      const hasWorkspaces = workspaceItems.length > 0
      const isLoading = loadingState.workspaces
      
      if (hasWorkspaces || isLoading) {
        isCompletingRef.current = false
      }
    }
  }, [viewMode, workspaceItems.length, loadingState.workspaces])

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
    /* Rensar grafik och mätningar men behåller kartresurser */
    resetGraphicsAndMeasurements()

    /* Avbryter pågående submission */
    submissionAbort.cancel()

    /* Avbryter pågående ritning */
    if (sketchViewModel) {
      safeCancelSketch(sketchViewModel)
    }

    const configValid = validateRequiredFields(configRef.current, translate, {
      mapConfigured:
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0,
    }).isValid

    if (!configValid) {
      dispatch(fmeActions.resetState(widgetId))
      updateAreaWarning(false)
      updateDrawingSession({ isActive: false, clickCount: 0 })
    } else {
      resetReduxToInitialDrawing()
    }

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
      if (viewModeRef.current === ViewMode.STARTUP_VALIDATION) {
        runStartupValidation()
      }
    }
  }, [
    runtimeState,
    prevRuntimeState,
    jimuMapView,
    closeOtherWidgets,
    enablePopupGuard,
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
      dispatch(
        fmeActions.applyWorkspaceData(
          { workspaceName, parameters, item: workspaceItem },
          widgetId
        )
      )
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
  if (latchedModulesLoading) {
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
    !latchedModulesLoading

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
          modules: latchedModulesLoading,
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
          dispatch(fmeActions.setDrawingTool(tool, widgetId))
          if (sketchViewModel) {
            safeCancelSketch(sketchViewModel)
            updateDrawingSession({ isActive: false, clickCount: 0 })
          }
        }}
        // Drawing props
        isDrawing={drawingSession.isActive}
        clickCount={drawingSession.clickCount}
        isCompleting={isCompletingRef.current}
        // Header props
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
        // Startup validation props
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
