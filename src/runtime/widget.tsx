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
import { JimuMapViewComponent, type JimuMapView } from "jimu-arcgis"
import { Workflow } from "./components/workflow"
import {
  Button,
  StateView,
  renderSupportHint,
  useStyles,
} from "./components/ui"
import { createFmeFlowClient } from "../shared/api"
import defaultMessages from "./translations/default"
import type {
  FmeExportConfig,
  ExportResult,
  IMStateWithFmeExport,
  FmeWidgetState,
  WorkspaceParameter,
  WorkspaceItemDetail,
  ErrorState,
  SerializableErrorState,
  DrawingSessionState,
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
  logIfNotAbort,
  popupSuppressionManager,
  maskToken,
  hexToRgbArray,
  buildSymbols,
  isNavigatorOffline,
  computeWidgetsToClose,
} from "../shared/utils"
import {
  useEsriModules,
  useMapResources,
  useErrorDispatcher,
  safeCancelSketch,
  safeClearLayer,
} from "../shared/hooks"

export default function Widget(
  props: AllWidgetProps<FmeExportConfig>
): React.ReactElement {
  const {
    id,
    widgetId: widgetIdProp,
    useMapWidgetIds,
    dispatch,
    config,
  } = props

  // Determine widget ID for state management
  const widgetId =
    (id as unknown as string) ?? (widgetIdProp as unknown as string)

  const selectors = createFmeSelectors(widgetId)
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

  const styles = useStyles()
  const translateWidget = hooks.useTranslation(defaultMessages)

  // Translation function
  const translate = hooks.useEventCallback((key: string): string => {
    return translateWidget(key)
  })

  const makeCancelable = hooks.useCancelablePromiseMaker()
  const configRef = hooks.useLatest(config)
  const viewModeRef = hooks.useLatest(viewMode)
  const drawingToolRef = hooks.useLatest(drawingTool)
  const [shouldAutoStart, setShouldAutoStart] = React.useState(false)
  const fmeClientRef = React.useRef<ReturnType<
    typeof createFmeFlowClient
  > | null>(null)
  const fmeClientKeyRef = React.useRef<string | null>(null)
  const isCompletingRef = React.useRef(false)
  const popupClientIdRef = React.useRef<symbol>(
    Symbol(widgetId ? `fme-popup-${widgetId}` : "fme-popup")
  )

  const [drawingSession, setDrawingSession] =
    React.useState<DrawingSessionState>(() => ({
      isActive: false,
      clickCount: 0,
    }))

  const updateDrawingSession = hooks.useEventCallback(
    (updates: Partial<DrawingSessionState>) => {
      setDrawingSession((prev) => {
        return { ...prev, ...updates }
      })
    }
  )

  const handleSketchToolStart = hooks.useEventCallback((tool: DrawingTool) => {
    if (drawingToolRef.current === tool) {
      return
    }

    dispatch(fmeActions.setDrawingTool(tool, widgetId))
  })

  const [areaWarning, setAreaWarning] = React.useState(false)
  const [startupStep, setStartupStep] = React.useState<string | undefined>()

  const isStartupPhase = viewMode === ViewMode.STARTUP_VALIDATION
  const startupValidationErrorDetails: SerializableErrorState | null =
    isStartupPhase && generalErrorDetails ? generalErrorDetails : null
  const startupGeneralError = isStartupPhase ? generalError : null
  const isStartupValidating = isStartupPhase && !startupValidationErrorDetails
  const startupValidationStep = isStartupPhase ? startupStep : undefined

  const updateAreaWarning = hooks.useEventCallback((next: boolean) => {
    setAreaWarning(Boolean(next))
  })

  hooks.useUpdateEffect(() => {
    if (!isStartupPhase) {
      setStartupStep(undefined)
    }
  }, [isStartupPhase])

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
      } catch {}
    }
  )

  const disablePopupGuard = hooks.useEventCallback(() => {
    popupSuppressionManager.release(popupClientIdRef.current)
  })

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

  // Error handling
  const dispatchError = useErrorDispatcher(dispatch, widgetId)
  const submissionAbort = useLatestAbortController()

  const navigateTo = hooks.useEventCallback((nextView: ViewMode) => {
    dispatch(fmeActions.clearError("export", widgetId))
    dispatch(fmeActions.clearError("import", widgetId))
    dispatch(fmeActions.setViewMode(nextView, widgetId))
  })

  // Compute symbols from configured color (single source of truth = config)
  const currentHex = (config as any)?.drawingColor || DEFAULT_DRAWING_HEX
  const symbolsRef = React.useRef(buildSymbols(hexToRgbArray(currentHex)))

  hooks.useUpdateEffect(() => {
    symbolsRef.current = buildSymbols(hexToRgbArray(currentHex))
  }, [currentHex])

  const disposeFmeClient = hooks.useEventCallback(() => {
    if (fmeClientRef.current?.dispose) {
      try {
        fmeClientRef.current.dispose()
      } catch {}
    }
    fmeClientRef.current = null
    fmeClientKeyRef.current = null
  })

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

  hooks.useUnmount(() => {
    submissionAbort.cancel()
    startupAbort.cancel()
    disposeFmeClient()
    disablePopupGuard()
  })

  // Centralized Redux reset helpers to avoid duplicated dispatch sequences
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

  // Render error view with translation and support hints
  const renderWidgetError = hooks.useEventCallback(
    (
      error: ErrorState | null,
      onRetry?: () => void
    ): React.ReactElement | null => {
      if (!error) return null

      // Suppress cancelled/aborted errors
      if (
        error.code === "CANCELLED" ||
        error.code === "ABORT" ||
        /cancel/i.test(error.message)
      ) {
        return null
      }

      // Determine base error message with translation
      const baseMsgKey = error.message
      const resolvedMessage =
        resolveMessageOrKey(baseMsgKey, translate) || translate("errorUnknown")

      // Decide how to guide the user depending on error type
      const codeUpper = (error.code || "").toUpperCase()
      const isGeometryInvalid =
        codeUpper === "GEOMETRY_INVALID" || codeUpper === "INVALID_GEOMETRY"
      const isAreaTooLarge = codeUpper === "AREA_TOO_LARGE"
      const isAoiRetryableError = isGeometryInvalid || isAreaTooLarge
      const isConfigIncomplete = codeUpper === "CONFIG_INCOMPLETE"
      const suppressSupport = isAoiRetryableError || isConfigIncomplete

      // For geometry invalid errors: suppress code and support email; show an explanatory hint
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

      // Create actions (retry clears error by default)
      const actions: Array<{ label: string; onClick: () => void }> = []
      const retryHandler =
        onRetry ??
        (() => {
          // Clear error and return to drawing mode if applicable
          dispatch(fmeActions.clearError("general", widgetId))
          if (isAoiRetryableError) {
            // Mark that we should auto-start once tools are re-initialized
            setShouldAutoStart(true)
            dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
            // If drawing resources were torn down, re-initialize them now
            try {
              if (!sketchViewModel && modules && jimuMapView) {
                handleMapViewReady(jimuMapView)
              }
            } catch {}
          }
        })
      actions.push({ label: translate("actionRetry"), onClick: retryHandler })

      // If offline, offer a reload action for convenience
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

      return (
        <StateView
          // Show the base error message only; render support hint separately below
          state={makeErrorView(resolvedMessage, {
            code: suppressSupport ? undefined : error.code,
            actions,
          })}
          renderActions={(act, ariaLabel) => {
            const actionsArray = Array.isArray(act) ? act : []
            const actionsCount = actionsArray.length

            return (
              <div
                role="group"
                aria-label={ariaLabel}
                data-actions-count={actionsCount}
                css={styles.actions.container}
              >
                {/* Render hint row: for geometry errors show plain text without support email */}
                <div css={styles.actions.support}>
                  {suppressSupport ? (
                    <div css={styles.typo.caption}>{supportHint}</div>
                  ) : (
                    renderSupportHint(
                      supportEmail,
                      translate,
                      styles,
                      supportHint
                    )
                  )}
                </div>
                {actionsCount > 0 && (
                  <div css={styles.actions.list}>
                    {actionsArray.map((a, i) => (
                      <Button key={i} text={a.label} onClick={a.onClick} />
                    ))}
                  </div>
                )}
              </div>
            )
          }}
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

  React.useEffect(() => {
    dispatch(
      fmeActions.setLoadingFlag("modules", Boolean(modulesLoading), widgetId)
    )
  }, [dispatch, modulesLoading, widgetId])

  React.useEffect(() => {
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

  // Redux state selector and dispatcher
  const isActive = hooks.useWidgetActived(widgetId)

  // Destructure map resources
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

  // Small helper to build consistent startup validation errors
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

  // Keep track of ongoing startup validation to allow aborting
  const startupAbort = useLatestAbortController()

  // Startup validation
  const runStartupValidation = hooks.useEventCallback(async () => {
    const controller = startupAbort.abortAndCreate()
    dispatch(fmeActions.clearError("general", widgetId))
    setValidationStep(translate("validatingStartup"))

    try {
      // Step 1: validate map configuration
      setValidationStep(translate("statusValidatingMap"))
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0

      // Step 2: validate widget configuration and FME connection using shared service
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

      // Step 3: validate user email only when async mode is in use
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

      // All validation passed
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

  // Run startup validation when widget first loads
  hooks.useEffectOnce(() => {
    runStartupValidation()
    return () => {
      startupAbort.cancel()
    }
  })

  // Reset widget state for re-validation
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

  // Track previous key connection settings to detect what changed
  hooks.useEffectWithPreviousValues(
    (prevValues) => {
      const prevConfig = prevValues[0] as FmeExportConfig | undefined
      // Skip on first render to preserve initial load behavior
      if (!prevConfig) return
      const nextConfig = config

      const serverChanged =
        prevConfig?.fmeServerUrl !== nextConfig?.fmeServerUrl
      const tokenChanged =
        prevConfig?.fmeServerToken !== nextConfig?.fmeServerToken
      const repoChanged = prevConfig?.repository !== nextConfig?.repository

      try {
        if (serverChanged || tokenChanged) {
          // Full revalidation required when connection credentials change
          resetForRevalidation(false)
          runStartupValidation()
        } else if (repoChanged) {
          // Repository change: clear workspace-related state and revalidate
          // Lightweight reset (keep map resources) then re-run validation
          resetForRevalidation(false)
          runStartupValidation()
        }
      } catch {}
    },
    [config]
  )

  // React to map selection changes by re-running startup validation
  hooks.useUpdateEffect(() => {
    try {
      // If no map is configured, also cleanup map resources
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
      resetForRevalidation(!hasMapConfigured)
    } catch {}

    // Re-run validation with new map selection
    runStartupValidation()
  }, [useMapWidgetIds])

  // Reset/hide measurement UI and clear layers
  const resetGraphicsAndMeasurements = hooks.useEventCallback(() => {
    safeClearLayer(graphicsLayer)
  })

  // Drawing complete with enhanced Graphic functionality
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

        // Validate

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
      } catch (error) {
        updateAreaWarning(false)
        dispatchError(
          translate("errorDrawingComplete"),
          ErrorType.VALIDATION,
          "DRAWING_COMPLETE_ERROR"
        )
      } finally {
        isCompletingRef.current = false
      }
    }
  )

  // Handle successful submission
  const finalizeOrder = hooks.useEventCallback((result: ExportResult) => {
    dispatch(fmeActions.setOrderResult(result, widgetId))
    navigateTo(ViewMode.ORDER_RESULT)
  })

  // Handle successful submission
  const handleSubmissionSuccess = (
    fmeResponse: unknown,
    workspace: string,
    userEmail: string
  ) => {
    const result = processFmeResponse(
      fmeResponse,
      workspace,
      userEmail,
      translate
    )
    finalizeOrder(result)
  }

  // Handle submission error
  const handleSubmissionError = (error: unknown) => {
    // Prefer localized message key resolution
    const rawKey = mapErrorToKey(error) || "errorUnknown"
    let localizedErr = ""
    try {
      localizedErr = resolveMessageOrKey(rawKey, translate)
    } catch {
      localizedErr = translate("errorUnknown")
    }
    // Build localized failure message and append contact support hint
    const configured = getSupportEmail(configRef.current?.supportEmail)
    const contactHint = buildSupportHintText(translate, configured)
    const baseFailMessage = translate("errorOrderFailed")
    const resultMessage =
      `${baseFailMessage}. ${localizedErr}. ${contactHint}`.trim()
    const result: ExportResult = {
      success: false,
      message: resultMessage,
      code: (error as { code?: string }).code || "SUBMISSION_ERROR",
    }
    finalizeOrder(result)
  }

  // Form submission handler
  const handleFormSubmit = hooks.useEventCallback(async (formData: unknown) => {
    if (isSubmitting || !canExport) {
      return
    }

    const maxCheck = checkMaxArea(drawnArea, config?.maxArea)
    if (!maxCheck.ok && maxCheck.message) {
      dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code)
      return
    }

    dispatch(fmeActions.setLoadingFlag("submission", true, widgetId))

    let controller: AbortController | null = null

    try {
      const latestConfig = configRef.current
      const rawDataEarly = ((formData as any)?.data || {}) as {
        [key: string]: unknown
      }
      // Determine mode early from form data for email requirement
      const earlyMode = determineServiceMode(
        { data: rawDataEarly },
        latestConfig
      )
      const fmeClient = getOrCreateFmeClient()
      const requiresEmail = earlyMode === "async" || earlyMode === "schedule"
      const userEmail = requiresEmail ? await getEmail(latestConfig) : ""

      const workspace = selectedWorkspace
      if (!workspace) {
        return
      }

      // Create abort controller for this request (used for optional upload and run)
      controller = submissionAbort.abortAndCreate()

      // Prepare parameters and handle remote URL / direct upload if present
      const subfolder = `widget_${(props as any)?.id || "fme"}`
      const preparation = await prepareSubmissionParams({
        rawFormData: rawDataEarly,
        userEmail,
        geometryJson,
        geometry: getActiveGeometry() || undefined,
        modules,
        config: latestConfig,
        workspaceParameters,
        makeCancelable,
        fmeClient,
        signal: controller.signal,
        remoteDatasetSubfolder: subfolder,
      })

      if (preparation.aoiError) {
        dispatch(fmeActions.setError("general", preparation.aoiError, widgetId))
        return
      }

      const finalParams = preparation.params
      if (!finalParams) {
        throw new Error("Submission parameter preparation failed")
      }
      // Submit to FME Flow
      const serviceType = latestConfig?.service || "download"
      const fmeResponse = await makeCancelable(
        fmeClient.runWorkspace(
          workspace,
          finalParams,
          undefined,
          serviceType,
          controller.signal
        )
      )
      handleSubmissionSuccess(fmeResponse, workspace, userEmail)
    } catch (error) {
      handleSubmissionError(error)
    } finally {
      dispatch(fmeActions.setLoadingFlag("submission", false, widgetId))
      submissionAbort.finalize(controller)
    }
  })

  // Map view ready handler
  const handleMapViewReady = hooks.useEventCallback((jmv: JimuMapView) => {
    // Always capture active JimuMapView
    setJimuMapView(jmv)
    if (!modules) {
      return
    }
    try {
      // Ensure map popups are suppressed while the widget is active
      enablePopupGuard(jmv)

      const layer = createLayers(jmv, modules, setGraphicsLayer)
      try {
        // Localize drawing layer title
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

  // Update symbols on color change
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

  // If widget loses activation, cancel any in-progress drawing to avoid dangling operations
  hooks.useUpdateEffect(() => {
    if (!isActive && sketchViewModel) {
      safeCancelSketch(sketchViewModel)
    }
  }, [isActive, sketchViewModel])

  // Cleanup on map view change
  hooks.useUpdateEffect(() => {
    return () => {
      if (jimuMapView) {
        cleanupResources()
      }
    }
  }, [jimuMapView])

  // Cleanup on unmount
  hooks.useEffectOnce(() => {
    return () => {
      // Abort any pending requests
      submissionAbort.cancel()
      startupAbort.cancel()
      // Dispose FME client and release resources
      disposeFmeClient()
      // Clean up map/drawing resources
      cleanupResources()
      // Remove widget state from Redux
      dispatch(fmeActions.removeWidgetState(widgetId))
    }
  })

  // Instruction text
  const getDrawingInstructions = hooks.useEventCallback(
    (tool: DrawingTool, isDrawing: boolean, clickCount: number) => {
      // Show general instruction before first click
      if (clickCount === 0) {
        return translate("hintStartDrawing")
      }

      // After first click, show tool-specific instructions
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

  // Start drawing
  const handleStartDrawing = hooks.useEventCallback((tool: DrawingTool) => {
    if (!sketchViewModel) {
      return
    }

    // Set tool

    updateDrawingSession({ isActive: true, clickCount: 0 })

    dispatch(fmeActions.setDrawingTool(tool, widgetId))

    dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))

    updateAreaWarning(false)

    // Clear and hide

    resetGraphicsAndMeasurements()

    // Cancel only if SketchViewModel is actively drawing to reduce AbortError races
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

    // Start drawing immediately; prior cancel avoids overlap
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
        // Swallow benign AbortError triggered by racing cancel/create; keep UI responsive

        logIfNotAbort("Sketch create error", err)
      }
    }
  })

  // Track runtime (Controller) state to coordinate auto-start only when visible
  const runtimeState = ReactRedux.useSelector(
    (state: IMState) => state.widgetsRuntimeInfo?.[widgetId]?.state
  )

  // Previous runtime state for comparison
  const prevRuntimeState = hooks.usePrevious(runtimeState)
  const prevRepository = hooks.usePrevious(configuredRepository)

  // Auto-start drawing when in DRAWING mode
  const canAutoStartDrawing =
    viewMode === ViewMode.DRAWING &&
    drawingSession.clickCount === 0 &&
    !drawingSession.isActive &&
    !isCompletingRef.current &&
    sketchViewModel &&
    !isSubmitting &&
    !hasCriticalGeneralError

  hooks.useUpdateEffect(() => {
    // Only auto-start if not already started and widget is not closed
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

  // Reset handler
  const handleReset = hooks.useEventCallback(() => {
    // Clear graphics and measurements but keep map resources alive
    resetGraphicsAndMeasurements()

    // Abort any ongoing submission
    submissionAbort.cancel()

    // Cancel any in-progress drawing
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
    // Reset when widget is closed
    if (
      runtimeState === WidgetState.Closed &&
      prevRuntimeState !== WidgetState.Closed
    ) {
      handleReset()
    }
  }, [runtimeState, prevRuntimeState, handleReset])

  // Close any open popups when widget is opened
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

  // Teardown drawing resources on critical errors
  hooks.useUpdateEffect(() => {
    if (hasCriticalGeneralError) {
      teardownDrawingResources()
    }
  }, [hasCriticalGeneralError, teardownDrawingResources])

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

  hooks.useUpdateEffect(() => {
    if (configuredRepository !== prevRepository && areaWarning) {
      updateAreaWarning(false)
    }
  }, [configuredRepository, prevRepository, areaWarning, updateAreaWarning])

  // Disable popup guard when widget is closed or hidden
  hooks.useUpdateEffect(() => {
    if (
      runtimeState === WidgetState.Closed ||
      runtimeState === WidgetState.Hidden
    ) {
      disablePopupGuard()
    }
  }, [runtimeState, disablePopupGuard])

  // Disable popup guard when map view is removed
  hooks.useUpdateEffect(() => {
    if (!jimuMapView) {
      disablePopupGuard()
    }
  }, [jimuMapView, disablePopupGuard])

  // Workspace handlers
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

  // Render loading state if modules are still loading
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

  // Error state - prioritize startup validation errors, then general errors
  if (startupGeneralError) {
    // Always handle startup validation errors first
    return (
      <div css={styles.parent}>
        {renderWidgetError(startupGeneralError, runStartupValidation)}
      </div>
    )
  }

  if (!isStartupPhase && hasCriticalGeneralError && generalError) {
    // Handle other errors (non-startup validation)
    return <div css={styles.parent}>{renderWidgetError(generalError)}</div>
  }

  // derive simple view booleans for readability
  const showHeaderActions =
    (drawingSession.isActive || drawnArea > 0) &&
    !isSubmitting &&
    !modulesLoading

  // precompute UI booleans
  const hasSingleMapWidget = Boolean(
    useMapWidgetIds && useMapWidgetIds.length === 1
  )

  let workflowConfig = config
  if (config) {
    const rest = { ...(config as any) }
    delete rest.fme_server_token
    delete rest.fmw_server_token
    workflowConfig = {
      ...rest,
      fmeServerToken: maskToken(config.fmeServerToken || ""),
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
          modules: modulesLoading,
          submission: isSubmitting,
        }}
        modules={modules}
        canStartDrawing={!!sketchViewModel}
        onFormBack={() => navigateTo(ViewMode.WORKSPACE_SELECTION)}
        onFormSubmit={handleFormSubmit}
        getFmeClient={getOrCreateFmeClient}
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

// Map extra state props for the widget
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
