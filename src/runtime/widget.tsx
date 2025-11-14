/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  type AllWidgetProps,
  appActions,
  type DataRecordSet,
  DataRecordSetChangeMessage,
  getAppStore,
  hooks,
  type IMState,
  jsx,
  MessageManager,
  React,
  ReactDOM,
  ReactRedux,
  RecordSetChangeType,
  type WidgetState,
} from "jimu-core";
import { type JimuMapView, JimuMapViewComponent } from "jimu-arcgis";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { shallowEqual } from "react-redux";
import type {
  DrawingSessionState,
  DrawingSymbolSet,
  ErrorState,
  EsriModules,
  ExportResult,
  FmeExportConfig,
  IMStateWithFmeExport,
  ModeNotice,
  SerializableErrorState,
  ServiceModeOverrideInfo,
  SketchViewModelInternals,
  SubmissionPhase,
  SubmissionPreparationStatus,
  WorkspaceItemDetail,
  WorkspaceParameter,
} from "../config/index";
import {
  DEFAULT_DRAWING_HEX,
  DrawingTool,
  ErrorSeverity,
  ErrorType,
  makeErrorView,
  TIME_CONSTANTS,
  VIEW_ROUTES,
  ViewMode,
} from "../config/index";
import { createFmeSelectors, initialFmeState } from "../extensions/store";
import { createFmeFlowClient } from "../shared/api";
import {
  safeCancelSketch,
  safeClearLayer,
  useErrorDispatcher,
  useEsriModules,
  useMapResources,
  useMinLoadingTime,
  usePrefetchWorkspaces,
} from "../shared/hooks";
import { fmeQueryClient } from "../shared/query-client";
import {
  createLayers,
  createSketchVM,
  executeJobSubmission,
  processDrawingCompletion,
  runStartupValidationFlow,
  setupFmeDebugTools,
  updateFmeDebugTools,
} from "../shared/services";
import { setLoggingEnabled } from "../shared/services/logging";
import {
  buildSymbols,
  computeWidgetsToClose,
  createErrorActions,
  createStateTransitionDetector,
  determineServiceMode,
  formatArea,
  formatErrorPresentation,
  hexToRgbArray,
  isAbortError,
  isNavigatorOffline,
  logIfNotAbort,
  normalizeWidgetId,
  popupSuppressionManager,
  safeAbortController,
  shouldSuppressError,
  STATE_TRANSITIONS,
  toTrimmedString,
  useFmeDispatch,
  useLatestAbortController,
} from "../shared/utils";
import { mapErrorFromNetwork } from "../shared/utils/error";
import { checkMaxArea, evaluateArea } from "../shared/utils/geometry";
import { extractHttpStatus, getSupportEmail } from "../shared/validations";
import { renderSupportHint, StateView, useStyles } from "./components/ui";
import { Workflow } from "./components/workflow";
import defaultMessages from "./translations/default";

const isPromiseLike = (value: unknown): value is Promise<unknown> => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
};

const toFillSymbol = (
  symbol: DrawingSymbolSet["polygon"]
): __esri.SimpleFillSymbol => symbol as unknown as __esri.SimpleFillSymbol;

const toLineSymbol = (
  symbol: DrawingSymbolSet["polyline"]
): __esri.SimpleLineSymbol => symbol as unknown as __esri.SimpleLineSymbol;

const toPointSymbol = (
  symbol: DrawingSymbolSet["point"]
): __esri.SimpleMarkerSymbol => symbol as unknown as __esri.SimpleMarkerSymbol;

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
  } = props;

  /* Bestämmer unikt widget-ID för Redux state management */
  const widgetId = normalizeWidgetId({ id, widgetId: widgetIdProp });

  /* Skapar Redux-selektorer för detta widget */
  const selectorsRef = React.useRef<{
    widgetId: string;
    selectors: ReturnType<typeof createFmeSelectors>;
  } | null>(null);
  if (!selectorsRef.current || selectorsRef.current.widgetId !== widgetId) {
    selectorsRef.current = {
      widgetId,
      selectors: createFmeSelectors(widgetId),
    };
  }
  const selectors = selectorsRef.current.selectors;

  /* Hämtar individuella state-properties med optimerad memoization */
  const viewMode = ReactRedux.useSelector(selectors.selectViewMode);
  const drawingTool = ReactRedux.useSelector(selectors.selectDrawingTool);
  const geometryJson = ReactRedux.useSelector(selectors.selectGeometryJson);
  const drawnArea = ReactRedux.useSelector(selectors.selectDrawnArea);
  const workspaceItems = ReactRedux.useSelector(selectors.selectWorkspaceItems);
  const workspaceParameters = ReactRedux.useSelector(
    selectors.selectWorkspaceParameters
  );
  const workspaceItem = ReactRedux.useSelector(selectors.selectWorkspaceItem);
  const selectedWorkspace = ReactRedux.useSelector(
    selectors.selectSelectedWorkspace
  );
  const orderResult = ReactRedux.useSelector(selectors.selectOrderResult);
  const loadingState = ReactRedux.useSelector(
    selectors.selectLoading,
    shallowEqual
  );
  const isSubmitting = ReactRedux.useSelector(
    selectors.selectLoadingFlag("submission")
  );
  const isValidatingGeometry = ReactRedux.useSelector(
    selectors.selectLoadingFlag("geometryValidation")
  );
  const canExport = ReactRedux.useSelector(selectors.selectCanExport);
  const scopedError = ReactRedux.useSelector(selectors.selectPrimaryError);

  const previousViewMode = hooks.usePrevious(viewMode);

  /* Expanderar serializable error från Redux till komplett ErrorState */
  const expandSerializableError = hooks.useEventCallback(
    (error: SerializableErrorState | null | undefined): ErrorState | null => {
      if (!error) return null;
      const timestampMs =
        typeof error.timestampMs === "number" ? error.timestampMs : Date.now();
      return {
        ...error,
        timestamp: new Date(timestampMs),
        timestampMs,
        kind: "runtime",
      };
    }
  );

  const generalErrorDetails =
    scopedError?.scope === "general" ? scopedError.details : null;
  const generalError = expandSerializableError(generalErrorDetails);
  const hasCriticalGeneralError =
    generalErrorDetails?.severity === ErrorSeverity.ERROR;
  const workflowError = scopedError?.details ?? null;
  const configuredRepository = config?.repository ?? null;

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
  );

  const {
    isPrefetching: isPrefetchingWorkspaces,
    progress: prefetchProgressState,
    prefetchStatus: workspacePrefetchStatus,
  } = workspacePrefetchResult;

  const workspacePrefetchProgress = prefetchProgressState
    ? {
        loaded: prefetchProgressState.loaded,
        total: prefetchProgressState.total,
      }
    : null;

  const styles = useStyles();
  const translateWidget = hooks.useTranslation(defaultMessages);

  /* Wrapper för översättningsfunktion med stabila callbacks */
  const translate = hooks.useEventCallback((key: string): string => {
    return translateWidget(key);
  });

  const makeCancelable = hooks.useCancelablePromiseMaker();
  /* Refs som alltid håller senaste config/viewMode/drawingTool */
  const configRef = hooks.useLatest(config);
  const viewModeRef = hooks.useLatest(viewMode);
  const drawingToolRef = hooks.useLatest(drawingTool);
  /* Flagga för auto-start av ritning efter initialisering */
  const [shouldAutoStart, setShouldAutoStart] = React.useState(false);
  /* FME Flow API-klient med cache för att undvika onödiga recreates */
  const fmeClientRef = React.useRef<ReturnType<
    typeof createFmeFlowClient
  > | null>(null);
  const fmeClientKeyRef = React.useRef<string | null>(null);
  /* Race condition-guard: förhindrar multipla draw-complete-triggers */
  const isCompletingRef = React.useRef(false);
  const completionControllerRef = React.useRef<AbortController | null>(null);
  const popupClientIdRef = React.useRef<symbol>(
    Symbol(`fme-popup-${widgetId}`)
  );

  const previousWidgetId = hooks.usePrevious(widgetId);
  hooks.useUpdateEffect(() => {
    if (previousWidgetId && previousWidgetId !== widgetId) {
      const oldSymbol = popupClientIdRef.current;
      if (oldSymbol) {
        popupSuppressionManager.release(oldSymbol);
      }
      popupClientIdRef.current = Symbol(`fme-popup-${widgetId}`);
    }
  }, [widgetId, previousWidgetId]);

  /* Timer för fördröjd repository cache warmup */
  const warmupTimerRef = React.useRef<number | null>(null);

  /* Ger enkel åtkomst till Redux-dispatch med widgetId */
  const fmeDispatch = useFmeDispatch(widgetId);

  /* Spårar aktiv ritningssession och antal klick */
  const [drawingSession, setDrawingSession] =
    React.useState<DrawingSessionState>({
      isActive: false,
      clickCount: 0,
    });

  /* Spårar submission-fas för feedback under export */
  const [submissionPhase, setSubmissionPhase] =
    React.useState<SubmissionPhase>("idle");
  const [announcement, setAnnouncement] = React.useState("");

  const updateDrawingSession = hooks.useEventCallback(
    (updates: Partial<DrawingSessionState>) => {
      setDrawingSession((prev) => {
        return { ...prev, ...updates };
      });
    }
  );

  const handlePreparationStatus = hooks.useEventCallback(
    (status: SubmissionPreparationStatus) => {
      if (status === "normalizing") {
        setSubmissionPhase("preparing");
        return;
      }

      if (status === "resolvingDataset") {
        setSubmissionPhase("uploading");
        return;
      }

      if (status === "applyingDefaults" || status === "complete") {
        setSubmissionPhase("finalizing");
      }
    }
  );

  const handleSketchToolStart = hooks.useEventCallback((tool: DrawingTool) => {
    if (drawingToolRef.current === tool) {
      return;
    }

    fmeDispatch.setDrawingTool(tool);
  });

  const [areaWarning, setAreaWarning] = React.useState(false);
  const [modeNotice, setModeNotice] = React.useState<ModeNotice | null>(null);
  /* Textstatus under startup-validering */
  const [startupStep, setStartupStep] = React.useState<string | undefined>();

  /* Beräknar startup-validerings-tillstånd */
  const isStartupPhase = viewMode === ViewMode.STARTUP_VALIDATION;
  const startupValidationErrorDetails: SerializableErrorState | null =
    isStartupPhase && generalErrorDetails ? generalErrorDetails : null;
  const startupGeneralError = isStartupPhase ? generalError : null;
  const isStartupValidating = isStartupPhase && !startupValidationErrorDetails;
  const startupValidationStep = isStartupPhase ? startupStep : undefined;

  const updateAreaWarning = hooks.useEventCallback((next: boolean) => {
    setAreaWarning(Boolean(next));
  });

  const clearModeNotice = hooks.useEventCallback(() => {
    setModeNotice(null);
  });

  /* Hanterar övergång vid tvingad async-läge */
  const setForcedModeNotice = hooks.useEventCallback(
    (
      info: ServiceModeOverrideInfo | null,
      currentModules: EsriModules | null,
      currentView: JimuMapView | null
    ) => {
      if (!info) {
        setModeNotice(null);
        return;
      }

      const params: { [key: string]: unknown } = {};
      let messageKey = "forcedAsyncArea";

      if (info.reason === "url_length") {
        messageKey = "forcedAsyncUrlLength";
        if (typeof info.urlLength === "number") {
          params.urlLength = info.urlLength.toLocaleString();
        }
      } else {
        if (typeof info.value === "number") {
          params.area =
            currentModules && currentView?.view?.spatialReference
              ? formatArea(
                  info.value,
                  currentModules,
                  currentView.view.spatialReference
                )
              : Math.max(0, Math.round(info.value)).toLocaleString();
        }
        if (typeof info.threshold === "number") {
          params.threshold =
            currentModules && currentView?.view?.spatialReference
              ? formatArea(
                  info.threshold,
                  currentModules,
                  currentView.view.spatialReference
                )
              : Math.max(0, Math.round(info.threshold)).toLocaleString();
        }
      }

      setModeNotice({
        messageKey,
        severity: "warning",
        params,
      });
    }
  );

  const clearWarmupTimer = hooks.useEventCallback(() => {
    if (warmupTimerRef.current != null) {
      if (typeof window !== "undefined") {
        window.clearTimeout(warmupTimerRef.current);
      }
      warmupTimerRef.current = null;
    }
  });

  /* Removed scheduleRepositoryWarmup function */

  hooks.useUpdateEffect(() => {
    if (!isStartupPhase) {
      setStartupStep(undefined);
    }
  }, [isStartupPhase]);

  /* Aktiverar popup-blockering när widget är aktiv */
  const enablePopupGuard = hooks.useEventCallback(
    (view: JimuMapView | null | undefined) => {
      if (!view?.view) return;
      const mapView = view.view;
      const popup = mapView.popup;
      if (popup) {
        popupSuppressionManager.acquire(
          popupClientIdRef.current,
          popup,
          mapView
        );
        try {
          if (typeof mapView.closePopup === "function") {
            mapView.closePopup();
          }
        } catch (error) {
          logIfNotAbort("Failed to close map popup", error);
        }
      }
    }
  );

  const disablePopupGuard = hooks.useEventCallback(() => {
    popupSuppressionManager.release(popupClientIdRef.current);
  });

  const closeOtherWidgets = hooks.useEventCallback(() => {
    const autoCloseSetting = configRef.current?.autoCloseOtherWidgets;
    if (autoCloseSetting !== undefined && !autoCloseSetting) {
      return;
    }
    try {
      const store = typeof getAppStore === "function" ? getAppStore() : null;
      const state = store?.getState?.();
      const runtimeInfo = state?.widgetsRuntimeInfo as
        | {
            [id: string]:
              | { state?: WidgetState | string; isClassLoaded?: boolean }
              | undefined;
          }
        | undefined;
      const exceptions = configRef.current?.widgetCloseExceptions;
      const targets = computeWidgetsToClose(runtimeInfo, widgetId, exceptions);
      if (targets.length) {
        /* Filter to only widgets with loaded classes to prevent race conditions */
        const safeTargets = targets.filter((targetId) => {
          const targetInfo = runtimeInfo?.[targetId];
          return Boolean(targetInfo?.isClassLoaded);
        });
        if (safeTargets.length) {
          dispatch(appActions.closeWidgets(safeTargets));
        }
      }
    } catch (err) {
      logIfNotAbort("closeOtherWidgets error", err);
    }
  });

  /* Felhantering via Redux dispatch */
  const dispatchError = useErrorDispatcher(dispatch, widgetId);
  const submissionAbort = useLatestAbortController();

  const navigateTo = hooks.useEventCallback((nextView: ViewMode) => {
    fmeDispatch.clearError("export");
    fmeDispatch.clearError("import");
    fmeDispatch.setViewMode(nextView);
  });

  /* Bygger symboler från konfigurerad drawingColor (config är källa) */
  const currentHex = config?.drawingColor || DEFAULT_DRAWING_HEX;
  const drawingStyleOptions = {
    outlineWidth: config?.drawingOutlineWidth,
    fillOpacity: config?.drawingFillOpacity,
  };
  const symbolsRef = React.useRef<ReturnType<typeof buildSymbols>>(
    buildSymbols(hexToRgbArray(currentHex), drawingStyleOptions)
  );

  const currentStyleKey = `${currentHex}-${config?.drawingOutlineWidth}-${config?.drawingFillOpacity}`;
  const previousStyleKey = hooks.usePrevious(currentStyleKey);

  hooks.useUpdateEffect(() => {
    if (currentStyleKey !== previousStyleKey) {
      symbolsRef.current = buildSymbols(
        hexToRgbArray(currentHex),
        drawingStyleOptions
      );
    }
  }, [currentStyleKey, previousStyleKey, currentHex, drawingStyleOptions]);

  /* Rensar FME-klient och nollställer cache-nyckel */
  const disposeFmeClient = hooks.useEventCallback(() => {
    if (fmeClientRef.current?.dispose) {
      try {
        fmeClientRef.current.dispose();
      } catch (error) {
        logIfNotAbort("Failed to dispose FME client", error);
      }
    }
    fmeClientRef.current = null;
    fmeClientKeyRef.current = null;
  });

  /* Skapar eller återanvänder FME-klient baserat på cache-nyckel */
  const getOrCreateFmeClient = hooks.useEventCallback(() => {
    const latestConfig = configRef.current;
    if (!latestConfig) {
      throw new Error("FME client configuration unavailable");
    }

    const keyParts = [
      latestConfig.fmeServerUrl ??
        (latestConfig as unknown as { [key: string]: unknown })
          .fme_server_url ??
        "",
      latestConfig.fmeServerToken ??
        (latestConfig as unknown as { [key: string]: unknown })
          .fme_server_token ??
        (latestConfig as unknown as { [key: string]: unknown })
          .fmw_server_token ??
        "",
      latestConfig.repository ?? "",
      latestConfig.requestTimeout ?? "",
    ];

    const key = keyParts
      .map((part) => {
        if (part === null || part === undefined) return "";
        if (typeof part === "number") return String(part);
        if (typeof part === "string") return part;
        return "";
      })
      .join("|");

    if (!fmeClientRef.current || fmeClientKeyRef.current !== key) {
      disposeFmeClient();
      fmeClientRef.current = createFmeFlowClient(latestConfig);
      fmeClientKeyRef.current = key;
    }

    if (!fmeClientRef.current) {
      throw new Error("Failed to initialize FME client");
    }

    return fmeClientRef.current;
  });

  hooks.useUpdateEffect(() => {
    if (!config) {
      disposeFmeClient();
    }
  }, [config]);

  hooks.useUpdateEffect(() => {
    if (!config?.fmeServerUrl || !config?.fmeServerToken) {
      clearWarmupTimer();
    }
  }, [
    config?.fmeServerUrl,
    config?.fmeServerToken,
    config?.repository,
    clearWarmupTimer,
  ]);

  hooks.useUnmount(() => {
    submissionAbort.cancel();
    startupAbort.cancel();
    disposeFmeClient();
    disablePopupGuard();
    clearWarmupTimer();
    safeAbortController(completionControllerRef.current);
    completionControllerRef.current = null;
  });

  /* Centraliserade Redux-återställnings-hjälpfunktioner */
  const resetReduxForRevalidation = hooks.useEventCallback(() => {
    const activeTool = drawingToolRef.current;

    fmeDispatch.resetState();
    updateAreaWarning(false);

    fmeDispatch.clearWorkspaceState(config?.repository);

    if (activeTool) {
      fmeDispatch.setDrawingTool(activeTool);
    }
  });

  const [moduleRetryKey, setModuleRetryKey] = React.useState(0);

  const requestModuleReload = hooks.useEventCallback(() => {
    setModuleRetryKey((prev) => prev + 1);
  });

  /* Renderar felvy med översättning och support-ledtrådar */
  const renderWidgetError = hooks.useEventCallback(
    (
      error: ErrorState | null,
      onRetry?: () => void
    ): React.ReactElement | null => {
      if (shouldSuppressError(error)) return null;

      const supportEmail = getSupportEmail(configRef.current?.supportEmail);
      const context = formatErrorPresentation(error, translate, supportEmail);
      const resolvedMessage = context.message;

      /* Bygger retry-action som rensar fel och återgår till ritläge */
      const defaultRetryHandler = () => {
        fmeDispatch.clearError("general");
        const codeUpper = (error?.code || "").toUpperCase();
        const isAoiRetryable =
          codeUpper === "GEOMETRY_INVALID" ||
          codeUpper === "INVALID_GEOMETRY" ||
          codeUpper === "AREA_TOO_LARGE";

        if (isAoiRetryable) {
          setShouldAutoStart(true);
          fmeDispatch.setViewMode(ViewMode.DRAWING);
          try {
            if (!sketchViewModel && modules && jimuMapView) {
              handleMapViewReady(jimuMapView);
            }
          } catch {}
        }
      };

      const actions = createErrorActions(
        error,
        {
          onRetry: onRetry ?? defaultRetryHandler,
          onReload: isNavigatorOffline()
            ? () => {
                try {
                  const loc = (
                    globalThis as { location?: { reload?: () => void } }
                  ).location;
                  if (loc && typeof loc.reload === "function") {
                    loc.reload();
                  } else {
                    console.warn(
                      "Page reload not available in current environment"
                    );
                  }
                } catch {}
              }
            : undefined,
        },
        translate
      );
      const hintText = toTrimmedString(context.hint);
      const supportDetail = !hintText
        ? undefined
        : !context.code
          ? hintText
          : renderSupportHint(supportEmail, translate, styles, hintText);

      return (
        <StateView
          state={makeErrorView(resolvedMessage, {
            code: context.code,
            actions,
            detail: supportDetail,
          })}
        />
      );
    }
  );

  const {
    modules,
    loading: modulesLoading,
    errorKey: modulesErrorKey,
  } = useEsriModules(moduleRetryKey);

  const mapResources = useMapResources();

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
  } = mapResources;

  /* Synkar modulers laddningsstatus med Redux med minimum display time */
  const setLoadingFlag = useMinLoadingTime(dispatch, widgetId);

  hooks.useUpdateEffect(() => {
    setLoadingFlag("modules", Boolean(modulesLoading));
  }, [modulesLoading, setLoadingFlag]);

  hooks.useUpdateEffect(() => {
    if (!modulesErrorKey) {
      return;
    }
    dispatchError(modulesErrorKey, ErrorType.MODULE, "MAP_MODULES_LOAD_FAILED");
  }, [modulesErrorKey, dispatchError]);

  hooks.useUpdateEffect(() => {
    if (
      !modulesLoading &&
      modules &&
      generalError?.code === "MAP_MODULES_LOAD_FAILED"
    ) {
      fmeDispatch.clearError("general");
    }
  }, [modulesLoading, modules, generalError?.code]);

  /* Annonserar viktiga vyändringar för skärmläsare */
  hooks.useUpdateEffect(() => {
    if (viewMode === ViewMode.WORKSPACE_SELECTION) {
      setAnnouncement(translate("msgWorkspacesReady"));
      return;
    }

    if (viewMode === ViewMode.EXPORT_FORM) {
      setAnnouncement(translate("msgFormReady"));
      return;
    }

    if (viewMode === ViewMode.ORDER_RESULT) {
      const key = orderResult?.success ? "msgOrderSuccess" : "msgOrderFail";
      setAnnouncement(translate(key));
      return;
    }

    setAnnouncement("");
  }, [viewMode, orderResult?.success, translate]);

  const getActiveGeometry = hooks.useEventCallback(() => {
    if (!geometryJson || !modules?.Polygon) {
      return null;
    }
    const polygonCtor = modules.Polygon;
    try {
      if (typeof polygonCtor?.fromJSON === "function") {
        return polygonCtor.fromJSON(geometryJson);
      }
    } catch {
      return null;
    }
    return null;
  });

  hooks.useUpdateEffect(() => {
    if (viewMode !== ViewMode.EXPORT_FORM || !configRef.current) {
      clearModeNotice();
      return;
    }

    let forcedInfo: ServiceModeOverrideInfo | null = null;
    determineServiceMode({ data: {} }, configRef.current, {
      workspaceItem,
      areaWarning,
      drawnArea,
      onModeOverride: (info) => {
        forcedInfo = info;
      },
    });

    forcedInfo
      ? setForcedModeNotice(forcedInfo, modules, jimuMapView)
      : clearModeNotice();
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
  ]);

  /* Aktivitetsstatus för widgeten från Redux */
  const isActive = hooks.useWidgetActived(widgetId);

  /* Skapar state transition detector för denna widget */
  const stateDetectorRef = React.useRef(
    createStateTransitionDetector(widgetId)
  );
  hooks.useUpdateEffect(() => {
    stateDetectorRef.current = createStateTransitionDetector(widgetId);
  }, [widgetId]);
  const stateDetector = stateDetectorRef.current;

  const endSketchSession = hooks.useEventCallback(
    (options?: { clearLocalGeometry?: boolean }) => {
      setShouldAutoStart(false);
      if (options?.clearLocalGeometry) {
        updateDrawingSession({ clickCount: 0 });
      }
      if (sketchViewModel) {
        safeCancelSketch(sketchViewModel);
      }
      updateDrawingSession({ isActive: false });
    }
  );

  const exitDrawingMode = hooks.useEventCallback(
    (nextViewMode: ViewMode, options?: { clearLocalGeometry?: boolean }) => {
      endSketchSession(options);
      fmeDispatch.setViewMode(nextViewMode);
    }
  );

  // Uppdaterar uppstarts-valideringssteg
  const setValidationStep = hooks.useEventCallback((step: string) => {
    setStartupStep(step);
  });

  const setValidationSuccess = hooks.useEventCallback(() => {
    setStartupStep(undefined);
    fmeDispatch.clearError("general");
    fmeDispatch.completeStartup();
    /* Removed scheduleRepositoryWarmup call */
    const currentViewMode = viewModeRef.current;
    const isUnset =
      currentViewMode === null || typeof currentViewMode === "undefined";
    const isStartupPhase =
      currentViewMode === ViewMode.STARTUP_VALIDATION ||
      currentViewMode === ViewMode.INITIAL;
    if (isUnset || isStartupPhase) {
      navigateTo(ViewMode.DRAWING);
    }
  });

  const setValidationError = hooks.useEventCallback(
    (error: SerializableErrorState) => {
      setStartupStep(undefined);
      fmeDispatch.setError("general", error);
    }
  );

  /* Skapar konsekvent startup-valideringsfel utan retry-callback (Redux-kompatibelt) */
  const createStartupError = hooks.useEventCallback(
    (messageKey: string | undefined, code: string): SerializableErrorState => {
      const finalKey = messageKey || "errorStartupFailed";

      return {
        message: translate(finalKey),
        type: ErrorType.CONFIG,
        code,
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestampMs: Date.now(),
        userFriendlyMessage: config?.supportEmail
          ? String(config.supportEmail)
          : "",
        suggestion: translate("btnRetryValidation"),
        kind: "serializable",
      };
    }
  );

  /* AbortController för att kunna avbryta pågående startup-validering */
  const startupAbort = useLatestAbortController();

  /* Kör startup-validering: karta, config, FME-anslutning, e-post */
  const runStartupValidation = hooks.useEventCallback(async () => {
    const controller = startupAbort.abortAndCreate();
    fmeDispatch.clearError("general");

    try {
      const result = await runStartupValidationFlow({
        config,
        useMapWidgetIds: (useMapWidgetIds
          ? [...useMapWidgetIds]
          : []) as string[],
        translate,
        signal: controller.signal,
        onProgress: setValidationStep,
      });
      if (result?.success) {
        setValidationSuccess();
      }
    } catch (err: unknown) {
      if (isAbortError(err)) {
        return;
      }

      let parsedError: unknown = null;
      try {
        if (err instanceof Error && err.message) {
          parsedError = JSON.parse(err.message);
        }
      } catch {}

      const errorToUse = parsedError || err;
      const errorKey =
        (parsedError as { [key: string]: unknown })?.message ||
        mapErrorFromNetwork(errorToUse, extractHttpStatus(errorToUse));
      const errorCode =
        typeof errorToUse === "object" &&
        errorToUse !== null &&
        "code" in errorToUse &&
        typeof errorToUse.code === "string"
          ? errorToUse.code
          : "STARTUP_VALIDATION_FAILED";
      setValidationError(createStartupError(errorKey, errorCode));
    } finally {
      startupAbort.finalize(controller);
    }
  });

  const retryModulesAndValidation = hooks.useEventCallback(() => {
    requestModuleReload();
    runStartupValidation();
  });

  /* Kör startup-validering när widgeten först laddas */
  hooks.useEffectOnce(() => {
    runStartupValidation();
    return () => {
      startupAbort.cancel();
    };
  });

  /* Synkroniserar logging-state när config ändras */
  hooks.useUpdateEffect(() => {
    setLoggingEnabled(config?.enableLogging ?? false);
  }, [config?.enableLogging]);

  /* Återställer widget-state för ny validering */
  const resetForRevalidation = hooks.useEventCallback(
    (alsoCleanupMapResources = false) => {
      submissionAbort.cancel();
      startupAbort.cancel();

      setStartupStep(undefined);
      setShouldAutoStart(false);

      if (alsoCleanupMapResources) {
        cleanupResources();
      } else {
        teardownDrawingResources();
      }

      updateDrawingSession({ isActive: false, clickCount: 0 });
      resetReduxForRevalidation();
    }
  );

  /* Spårar tidigare anslutningsinställningar för att upptäcka ändringar */
  hooks.useEffectWithPreviousValues(
    (prevValues) => {
      let timerId: number | undefined;
      const cleanup = () => {
        if (timerId !== undefined) {
          window.clearTimeout(timerId);
        }
      };

      const prevConfig = prevValues[0] as FmeExportConfig | undefined;
      /* Hoppar över första renderingen för att bevara initial laddning */
      if (!prevConfig) {
        return cleanup;
      }
      const nextConfig = config;

      const hasConnectionChange =
        prevConfig?.fmeServerUrl !== nextConfig?.fmeServerUrl ||
        prevConfig?.fmeServerToken !== nextConfig?.fmeServerToken ||
        prevConfig?.repository !== nextConfig?.repository;

      try {
        if (hasConnectionChange) {
          /* Full omvalidering krävs vid byte av anslutning eller repository */
          resetForRevalidation(false);
          /* Fördröjer validering något för att låta ev. UI-övergångar slutföras */
          timerId = window.setTimeout(() => {
            runStartupValidation();
          }, TIME_CONSTANTS.POPUP_CLOSE_DELAY_MS);
        }
      } catch {}

      return cleanup;
    },
    [config]
  );

  /* Kör om startup-validering vid ändring av kartkonfiguration */
  hooks.useUpdateEffect(() => {
    try {
      /* Om ingen karta konfigurerad, rensa även kartresurser */
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0;
      resetForRevalidation(!hasMapConfigured);
    } catch {}

    /* Kör om validering med ny kartkonfiguration */
    runStartupValidation();
  }, [useMapWidgetIds]);

  /* Återställer grafik och mätningar utan att röra kartresurser */
  const resetGraphicsAndMeasurements = hooks.useEventCallback(() => {
    safeClearLayer(graphicsLayer);
  });

  /* Hanterar slutförd ritning med geometri-validering och area-beräkning */
  const onDrawComplete = hooks.useEventCallback(
    async (evt: __esri.SketchCreateEvent) => {
      if (!evt.graphic?.geometry) return;

      if (isCompletingRef.current) {
        return;
      }

      const previousController = completionControllerRef.current;
      safeAbortController(previousController);

      const controller = new AbortController();
      completionControllerRef.current = controller;
      isCompletingRef.current = true;

      try {
        endSketchSession();
        updateAreaWarning(false);
        setLoadingFlag("geometryValidation", true);

        const result = await processDrawingCompletion({
          geometry: evt.graphic.geometry,
          modules,
          graphicsLayer,
          config: {
            areaThreshold: config.maxArea,
            largeAreaThreshold: config.largeArea,
          },
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          setLoadingFlag("geometryValidation", false);
          return;
        }

        if (!result.success) {
          try {
            graphicsLayer?.remove(evt.graphic);
          } catch {}

          if (!controller.signal.aborted) {
            setLoadingFlag("geometryValidation", false);
            teardownDrawingResources();
            fmeDispatch.setGeometry(null, 0);
            updateAreaWarning(false);
            exitDrawingMode(ViewMode.INITIAL, { clearLocalGeometry: true });

            if (result.error) {
              if (result.error.code === "ZERO_AREA") {
                dispatchError(
                  translate("errGeomInvalid"),
                  ErrorType.VALIDATION,
                  "ZERO_AREA"
                );
              } else if (result.error.message) {
                dispatchError(
                  result.error.message,
                  ErrorType.VALIDATION,
                  result.error.code
                );
              } else {
                dispatchError(
                  "GEOMETRY_ERROR",
                  ErrorType.GEOMETRY,
                  result.error.code
                );
              }
            }
          }
          return;
        }

        updateAreaWarning(result.shouldWarn || false);

        if (evt.graphic && result.geometry) {
          evt.graphic.geometry = result.geometry;
          const highlightSymbol = symbolsRef.current?.HIGHLIGHT_SYMBOL;
          if (highlightSymbol) {
            evt.graphic.symbol = highlightSymbol;
          }
        }

        if (result.geometry && result.area !== undefined) {
          fmeDispatch.completeDrawing(
            result.geometry,
            result.area,
            ViewMode.WORKSPACE_SELECTION
          );
          setLoadingFlag("geometryValidation", false);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          updateAreaWarning(false);
          setLoadingFlag("geometryValidation", false);
          dispatchError(
            translate("errDrawComplete"),
            ErrorType.VALIDATION,
            "DRAWING_COMPLETE_ERROR"
          );
        }
      } finally {
        if (completionControllerRef.current === controller) {
          completionControllerRef.current = null;
        }
        isCompletingRef.current = false;
      }
    }
  );

  // Publicerar meddelande om jobbs slutförande
  const publishJobCompletionMessage = hooks.useEventCallback(
    (result: ExportResult) => {
      try {
        // Bygger jobbrekordet för meddelandet
        const jobRecord = {
          jobId: result.jobId || result.code || "unknown",
          workspace: selectedWorkspace || "unknown",
          status: result.success ? "completed" : "failed",
          downloadUrl: result.downloadUrl || "",
          message: result.message || "",
          timestamp: new Date().toISOString(),
          serviceMode: result.serviceMode || "unknown",
        };

        // Bygger och publicerar meddelandet
        const message = new DataRecordSetChangeMessage(
          widgetId,
          RecordSetChangeType.CreateUpdate,
          [jobRecord] as unknown as DataRecordSet[]
        );

        MessageManager.getInstance().publishMessage(message);
      } catch (error) {
        // Ignorera publiceringfel - huvudfunktionalitet påverkas ej
      }
    }
  );

  // Slutför orderprocessen genom att spara resultat i Redux och navigera
  const finalizeOrder = hooks.useEventCallback((result: ExportResult) => {
    if (stateDetector.isInactive(runtimeState)) {
      return;
    }

    fmeDispatch.setOrderResult(result);
    navigateTo(ViewMode.ORDER_RESULT);

    // Publicera meddelande om lyckad/misslyckad export
    publishJobCompletionMessage(result);
  });

  /* Hanterar formulär-submission: validerar, förbereder, kör workspace */
  const handleFormSubmit = hooks.useEventCallback(async (formData: unknown) => {
    if (isSubmitting || !canExport) return;

    /* Race condition guard: ensure widget is still open before starting */
    if (!stateDetector.isActive(runtimeState)) {
      if (config?.enableLogging) {
        console.log(
          `[FME Widget ${widgetId}] Submission aborted: widget not active`
        );
      }
      return;
    }

    const maxCheck = checkMaxArea(drawnArea, config?.maxArea);
    if (!maxCheck.ok && maxCheck.message) {
      setSubmissionPhase("idle");
      dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code);
      return;
    }

    ReactDOM.unstable_batchedUpdates(() => {
      fmeDispatch.setLoadingFlag("submission", true);
      setSubmissionPhase("preparing");
      clearModeNotice();
    });

    try {
      /* Check again before expensive operations */
      if (stateDetector.isInactive(runtimeState)) {
        if (config?.enableLogging) {
          console.log(
            `[FME Widget ${widgetId}] Submission aborted during prep: widget inactive`
          );
        }
        setSubmissionPhase("idle");
        fmeDispatch.setLoadingFlag("submission", false);
        return;
      }

      const fmeClient = getOrCreateFmeClient();
      const rawDataEarly = ((formData as { [key: string]: unknown })?.data ||
        {}) as {
        [key: string]: unknown;
      };

      /* Bestämmer och sätter service mode notice */
      determineServiceMode({ data: rawDataEarly }, configRef.current, {
        workspaceItem,
        areaWarning,
        drawnArea,
        onModeOverride: setForcedModeNotice,
      });

      const submissionResult = await executeJobSubmission({
        formData,
        config: configRef.current,
        geometryJson,
        geometry: getActiveGeometry() || undefined,
        modules,
        workspaceParameters,
        workspaceItem,
        selectedWorkspace,
        areaWarning,
        drawnArea,
        fmeClient,
        submissionAbort,
        widgetId,
        translate,
        makeCancelable,
        onStatusChange: handlePreparationStatus,
        getActiveGeometry,
      });

      /* Final check before finalizing order */
      if (stateDetector.isInactive(runtimeState)) {
        if (config?.enableLogging) {
          console.log(
            `[FME Widget ${widgetId}] Submission completed but widget inactive, skipping finalize`
          );
        }
        return;
      }

      if (!submissionResult.success && submissionResult.error) {
        /* Kolla om det är ett AOI-fel från prepareSubmissionParams */
        const errorObj = submissionResult.error as { [key: string]: unknown };
        if (errorObj && typeof errorObj === "object" && "kind" in errorObj) {
          setSubmissionPhase("idle");
          fmeDispatch.setError(
            "general",
            errorObj as unknown as SerializableErrorState
          );
          return;
        }
      }

      if (submissionResult.result) {
        finalizeOrder(submissionResult.result);
        if (submissionResult.result.success && selectedWorkspace) {
          try {
            fmeQueryClient.invalidateQueries({
              queryKey: ["fme", "workspace-item", selectedWorkspace],
            });
          } catch (queryErr) {
            // Ignorera fel vid cache-invalidering
          }
        }
      }
    } catch (error) {
      /* Oväntade fel som inte fångades av executeJobSubmission */
      if (!isAbortError(error)) {
        dispatchError(
          translate("errJobSubmit"),
          ErrorType.MODULE,
          "SUBMISSION_UNEXPECTED_ERROR"
        );
      }
    } finally {
      setSubmissionPhase("idle");
      fmeDispatch.setLoadingFlag("submission", false);
    }
  });

  /* Hanterar ny kartvy: skapar lager och SketchViewModel */
  const handleMapViewReady = hooks.useEventCallback((jmv: JimuMapView) => {
    /* Fångar alltid aktiv JimuMapView */
    setJimuMapView(jmv);
    if (!modules) {
      return;
    }
    try {
      /* Säkerställer att kart-popups undertrycks när widget är aktiv */
      enablePopupGuard(jmv);

      const layer = createLayers(jmv, modules, setGraphicsLayer);
      try {
        /* Lokaliserar ritnings-lagrets titel */
        layer.title = translate("lblDrawLayer");
      } catch {}
      const drawingSymbolParams = symbolsRef.current.DRAWING_SYMBOLS;
      const { sketchViewModel: svm, cleanup } = createSketchVM({
        jmv,
        modules,
        layer,
        onDrawComplete,
        dispatch,
        widgetId,
        symbols: {
          polygon: toFillSymbol(drawingSymbolParams.polygon),
          polyline: toLineSymbol(drawingSymbolParams.polyline),
          point: toPointSymbol(drawingSymbolParams.point),
        },
        onDrawingSessionChange: updateDrawingSession,
        onSketchToolStart: handleSketchToolStart,
      });
      setCleanupHandles(cleanup);
      setSketchViewModel(svm);
    } catch (error) {
      dispatchError(
        translate("errMapInit"),
        ErrorType.MODULE,
        "MAP_INIT_ERROR"
      );
    }
  });

  hooks.useUpdateEffect(() => {
    if (modules && jimuMapView && !sketchViewModel) {
      handleMapViewReady(jimuMapView);
    }
  }, [modules, jimuMapView, sketchViewModel, handleMapViewReady]);

  hooks.useUpdateEffect(() => {
    if (!shouldAutoStart || !sketchViewModel) {
      return;
    }

    setShouldAutoStart(false);

    const tool = drawingTool ?? DrawingTool.POLYGON;
    const arg: "rectangle" | "polygon" =
      tool === DrawingTool.RECTANGLE ? "rectangle" : "polygon";

    if (typeof sketchViewModel.create === "function") {
      try {
        const boundCreate: (mode: "rectangle" | "polygon") => unknown =
          sketchViewModel.create.bind(sketchViewModel);
        const createResult = boundCreate(arg);
        if (isPromiseLike(createResult)) {
          createResult.catch((err: unknown) => {
            if (!isAbortError(err)) {
              dispatchError(
                "errorStartDrawing",
                ErrorType.MODULE,
                "SKETCH_CREATE_FAILED"
              );
            }
            logIfNotAbort("Sketch create promise error", err);
          });
        }
      } catch (err: unknown) {
        logIfNotAbort("Sketch auto-start error", err);
      }
    }
  }, [shouldAutoStart, sketchViewModel, drawingTool]);

  /* Uppdaterar symboler när ritstil ändras */
  hooks.useUpdateEffect(() => {
    const drawingSymbols = symbolsRef.current.DRAWING_SYMBOLS;
    const polygonSymbol = toFillSymbol(drawingSymbols.polygon);
    const applyPolygonSymbol = (graphic: __esri.Graphic) => {
      if (graphic.geometry?.type === "polygon") {
        graphic.symbol = polygonSymbol;
      }
    };

    if (sketchViewModel) {
      try {
        const vmInternals = sketchViewModel as SketchViewModelInternals;
        const polylineSymbol = toLineSymbol(drawingSymbols.polyline);
        const pointSymbol = toPointSymbol(drawingSymbols.point);
        vmInternals.polygonSymbol = polygonSymbol;
        vmInternals.polylineSymbol = polylineSymbol;
        vmInternals.pointSymbol = pointSymbol;

        const internalVm = vmInternals.viewModel;
        const activeGraphic = internalVm?.graphic;
        if (activeGraphic) {
          applyPolygonSymbol(activeGraphic);
        }
        const previewGraphic = internalVm?.previewGraphic;
        if (previewGraphic) {
          applyPolygonSymbol(previewGraphic);
        }

        const sketchLayer = internalVm?.sketchGraphicsLayer;
        if (sketchLayer?.graphics) {
          sketchLayer.graphics.forEach((graphic: __esri.Graphic) => {
            applyPolygonSymbol(graphic);
          });
        }
      } catch {}
    }

    if (graphicsLayer?.graphics) {
      try {
        graphicsLayer.graphics.forEach((graphic: __esri.Graphic) => {
          applyPolygonSymbol(graphic);
        });
      } catch {}
    }
  }, [
    sketchViewModel,
    graphicsLayer,
    config?.drawingColor,
    config?.drawingOutlineWidth,
    config?.drawingFillOpacity,
  ]);

  /* Avbryter ritning om widget förlorar aktivering */
  hooks.useUpdateEffect(() => {
    if (!isActive && sketchViewModel) {
      safeCancelSketch(sketchViewModel);
    }
  }, [isActive, sketchViewModel]);

  /* Rensar resurser vid kartvy-byte */
  hooks.useUpdateEffect(() => {
    const currentView = jimuMapView;
    return () => {
      if (currentView) {
        cleanupResources();
      }
    };
  }, [jimuMapView, cleanupResources]);

  /* Rensar alla resurser vid unmount */
  hooks.useEffectOnce(() => {
    return () => {
      /* Avbryter väntande requests */
      submissionAbort.cancel();
      startupAbort.cancel();
      /* Rensar FME-klient och frigör resurser */
      disposeFmeClient();
      /* Rensar kart-/ritresurser */
      cleanupResources();
      /* Tar bort widget-state från Redux */
      fmeDispatch.removeWidgetState();
    };
  });

  /* Returnerar instruktionstext beroende på ritverktyg och fas */
  const getDrawingInstructions = hooks.useEventCallback(
    (tool: DrawingTool, clickCount: number) => {
      /* Visar allmän instruktion före första klicket */
      if (clickCount === 0) {
        return translate("hintClickMap");
      }

      /* Efter första klicket, visa verktygsspecifika instruktioner */
      if (tool === DrawingTool.RECTANGLE) {
        return translate("hintDrawRect");
      }

      if (tool === DrawingTool.POLYGON) {
        if (clickCount < 3) {
          return translate("hintDrawContinue");
        }
        return translate("hintDrawComplete");
      }

      return translate("hintSelectMode");
    }
  );

  /* Startar ritning med valt verktyg */
  const handleStartDrawing = hooks.useEventCallback((tool: DrawingTool) => {
    if (!sketchViewModel) {
      return;
    }

    ReactDOM.unstable_batchedUpdates(() => {
      /* Sätter verktyg och uppdaterar session-state */
      updateDrawingSession({ isActive: true, clickCount: 0 });

      fmeDispatch.setDrawingTool(tool);

      fmeDispatch.setViewMode(ViewMode.DRAWING);

      updateAreaWarning(false);
    });

    /* Rensar grafik och döljer mätningar */

    resetGraphicsAndMeasurements();

    /* Avbryter endast om SketchViewModel är aktivt ritande */
    try {
      const vmInternals = sketchViewModel as SketchViewModelInternals;
      const isActive = Boolean(
        vmInternals?.state === "active" || vmInternals?._creating
      );

      if (isActive) {
        safeCancelSketch(sketchViewModel);
      }
    } catch {
      // fallback för avbrytning om allt annat misslyckas
      safeCancelSketch(sketchViewModel);
    } /* Startar ritning omedelbart; tidigare cancel undviker överlappning */
    const arg: "rectangle" | "polygon" =
      tool === DrawingTool.RECTANGLE ? "rectangle" : "polygon";

    const hasCreateFunction =
      sketchViewModel && typeof sketchViewModel.create === "function";
    if (hasCreateFunction) {
      try {
        const boundCreate: (mode: "rectangle" | "polygon") => unknown =
          sketchViewModel.create.bind(sketchViewModel);
        const createResult = boundCreate(arg);
        if (isPromiseLike(createResult)) {
          createResult.catch((err: unknown) => {
            logIfNotAbort("Sketch create promise error", err);
          });
        }
      } catch (err: unknown) {
        /* Sväljer oskadliga AbortError från racing cancel/create */

        logIfNotAbort("Sketch create error", err);
      }
    }
  });

  /* Spårar runtime-state (Controller) för att koordinera auto-start */
  const runtimeState = ReactRedux.useSelector(
    (state: IMState) => state.widgetsRuntimeInfo?.[widgetId]?.state
  );

  /* Tidigare runtime-state och repository för jämförelse */
  const prevRuntimeState = hooks.usePrevious(runtimeState);
  const prevRepository = hooks.usePrevious(configuredRepository);
  const prevIsActive = hooks.usePrevious(isActive);

  /* Log state transitions when logging is enabled */
  hooks.useUpdateEffect(() => {
    if (config?.enableLogging && prevRuntimeState !== runtimeState) {
      stateDetector.log(prevRuntimeState, runtimeState, {
        viewMode,
        isActive,
        hasCriticalError: hasCriticalGeneralError,
      });
    }
  }, [
    runtimeState,
    prevRuntimeState,
    viewMode,
    isActive,
    hasCriticalGeneralError,
    config?.enableLogging,
    stateDetector,
  ]);

  /* Track widget activation changes separately from runtime state */
  hooks.useUpdateEffect(() => {
    if (isActive && !prevIsActive) {
      /* Widget just became active (user focused on it) */
      closeOtherWidgets();
      if (jimuMapView) {
        enablePopupGuard(jimuMapView);
      }
    } else if (!isActive && prevIsActive) {
      /* Widget just became inactive (user focused elsewhere) */
      endSketchSession({ clearLocalGeometry: false });
    }
  }, [
    isActive,
    prevIsActive,
    closeOtherWidgets,
    jimuMapView,
    enablePopupGuard,
    endSketchSession,
  ]);

  /* Auto-start ritning när i DRAWING-läge */
  const canAutoStartDrawing =
    viewMode === ViewMode.DRAWING &&
    drawingSession.clickCount === 0 &&
    !drawingSession.isActive &&
    !isCompletingRef.current &&
    sketchViewModel &&
    !isSubmitting &&
    !hasCriticalGeneralError;

  hooks.useUpdateEffect(() => {
    /* Auto-startar endast om inte redan startat och widget är aktivt */
    if (canAutoStartDrawing && stateDetector.isActive(runtimeState)) {
      handleStartDrawing(drawingTool);
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
    stateDetector,
  ]);

  /* Återställer widget vid stängning */
  const handleReset = hooks.useEventCallback(() => {
    submissionAbort.cancel();
    setSubmissionPhase("idle");
    fmeDispatch.setLoadingFlag("submission", false);
    fmeDispatch.setLoadingFlag("geometryValidation", false);
    /* Rensar grafik och mätningar men behåller kartresurser */
    resetGraphicsAndMeasurements();

    /* Rensar varningar och lokalt rittillstånd */
    updateAreaWarning(false);
    updateDrawingSession({ isActive: false, clickCount: 0 });

    /* Avbryter pågående ritning */
    if (sketchViewModel) {
      safeCancelSketch(sketchViewModel);
    }

    // Återställer Redux-state
    fmeDispatch.resetState();
    fmeDispatch.setViewMode(ViewMode.DRAWING);

    closeOtherWidgets();
    if (jimuMapView) {
      enablePopupGuard(jimuMapView);
    }
  });

  hooks.useUpdateEffect(() => {
    /* Återställer och förbereder för nästa öppning vid stängning av widget */
    if (
      stateDetector.isTransition(
        prevRuntimeState,
        runtimeState,
        STATE_TRANSITIONS.TO_CLOSED
      )
    ) {
      /* Vid stängning: sätt STARTUP_VALIDATION för nästa öppning */
      submissionAbort.cancel();
      setSubmissionPhase("idle");
      fmeDispatch.setLoadingFlag("submission", false);
      fmeDispatch.setLoadingFlag("geometryValidation", false);
      resetGraphicsAndMeasurements();
      updateAreaWarning(false);
      updateDrawingSession({ isActive: false, clickCount: 0 });
      if (sketchViewModel) {
        safeCancelSketch(sketchViewModel);
      }
      fmeDispatch.resetState();
      fmeDispatch.setViewMode(ViewMode.STARTUP_VALIDATION);
    }
  }, [runtimeState, prevRuntimeState, stateDetector]);

  /* Stänger popups när widget öppnas */
  hooks.useUpdateEffect(() => {
    if (
      stateDetector.isTransition(
        prevRuntimeState,
        runtimeState,
        STATE_TRANSITIONS.FROM_CLOSED
      )
    ) {
      closeOtherWidgets();
      if (jimuMapView) {
        enablePopupGuard(jimuMapView);
      }

      /* Återställ alltid till STARTUP_VALIDATION när widget öppnas igen */
      fmeDispatch.setViewMode(ViewMode.STARTUP_VALIDATION);

      /* Kör alltid validering när widget öppnas igen */
      runStartupValidation();
    }
  }, [
    runtimeState,
    prevRuntimeState,
    jimuMapView,
    closeOtherWidgets,
    enablePopupGuard,
    stateDetector,
    runStartupValidation,
    fmeDispatch,
  ]);

  /* Rensar ritresurser vid kritiska fel */
  hooks.useUpdateEffect(() => {
    if (hasCriticalGeneralError) {
      teardownDrawingResources();
    }
  }, [hasCriticalGeneralError, teardownDrawingResources]);

  /* Uppdaterar area-varning när geometri eller trösklar ändras */
  hooks.useUpdateEffect(() => {
    const hasGeometry = Boolean(geometryJson);
    if (!hasGeometry) {
      if (areaWarning) {
        updateAreaWarning(false);
      }
      return;
    }

    const evaluation = evaluateArea(drawnArea, {
      maxArea: config?.maxArea,
      largeArea: config?.largeArea,
    });
    const shouldWarn = evaluation.shouldWarn;
    if (shouldWarn !== areaWarning) {
      updateAreaWarning(shouldWarn);
    }
  }, [
    geometryJson,
    drawnArea,
    areaWarning,
    config?.largeArea,
    config?.maxArea,
    updateAreaWarning,
  ]);

  /* Rensar area-varning vid repository-byte */
  hooks.useUpdateEffect(() => {
    if (configuredRepository !== prevRepository && areaWarning) {
      updateAreaWarning(false);
    }
  }, [configuredRepository, prevRepository, areaWarning, updateAreaWarning]);

  /* Inaktiverar popup-guard när widget stängs eller minimeras */
  hooks.useUpdateEffect(() => {
    if (stateDetector.isInactive(runtimeState)) {
      disablePopupGuard();
    }
  }, [runtimeState, disablePopupGuard, stateDetector]);

  /* Inaktiverar popup-guard när kartvy tas bort */
  hooks.useUpdateEffect(() => {
    if (!jimuMapView) {
      disablePopupGuard();
    }
  }, [jimuMapView, disablePopupGuard]);

  /* Workspace-hanterare */
  const handleWorkspaceSelected = hooks.useEventCallback(
    (
      workspaceName: string,
      parameters: readonly WorkspaceParameter[],
      workspaceItem: WorkspaceItemDetail
    ) => {
      fmeDispatch.applyWorkspaceData({
        workspaceName,
        parameters,
        item: workspaceItem,
      });
      navigateTo(ViewMode.EXPORT_FORM);
    }
  );

  const handleWorkspaceBack = hooks.useEventCallback(() => {
    navigateTo(ViewMode.INITIAL);
  });

  const navigateBack = hooks.useEventCallback(() => {
    const currentViewMode = viewModeRef.current ?? viewMode;
    const defaultRoute = VIEW_ROUTES[currentViewMode] || ViewMode.INITIAL;
    const target =
      previousViewMode && previousViewMode !== currentViewMode
        ? previousViewMode
        : defaultRoute;
    navigateTo(target);
  });

  if (!widgetId || typeof widgetId !== "string" || !widgetId.trim()) {
    return (
      <div css={styles.parent}>
        <StateView
          state={makeErrorView(translate("errorWidgetIdMissing"), {
            code: "WIDGET_ID_MISSING",
          })}
        />
      </div>
    );
  }

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
    );
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
    );
  }

  /* Felläge - prioriterar startup-valideringsfel, sedan generella fel */
  if (startupGeneralError) {
    /* Hanterar alltid startup-valideringsfel först */
    return (
      <div css={styles.parent}>
        {renderWidgetError(startupGeneralError, runStartupValidation)}
      </div>
    );
  }

  if (!isStartupPhase && hasCriticalGeneralError && generalError) {
    /* Hanterar andra fel (ej startup-validering) */
    return <div css={styles.parent}>{renderWidgetError(generalError)}</div>;
  }

  /* Beräknar enkla view-booleans för läsbarhet */
  const showHeaderActions =
    (drawingSession.isActive || drawnArea > 0) &&
    !isSubmitting &&
    !modulesLoading;

  /* Förkompilerar UI-booleans */
  const hasSingleMapWidget = Boolean(
    useMapWidgetIds && useMapWidgetIds.length === 1
  );

  /* Säkerhetskopierar config utan känsliga fält */
  let workflowConfig = config;
  if (config) {
    const sanitizedConfig = {
      ...config,
      fmeServerToken: config.fmeServerToken,
    } as FmeExportConfig & {
      fme_server_token?: string;
      fmw_server_token?: string;
    };
    delete sanitizedConfig.fme_server_token;
    delete sanitizedConfig.fmw_server_token;
    workflowConfig = sanitizedConfig;
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
        jimuMapView={jimuMapView?.view ?? null}
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
          fmeDispatch.setDrawingTool(tool);
          if (sketchViewModel) {
            safeCancelSketch(sketchViewModel);
            updateDrawingSession({ isActive: false, clickCount: 0 });
          }
        }}
        // Ritnings-props
        isDrawing={drawingSession.isActive}
        clickCount={drawingSession.clickCount}
        isCompleting={isCompletingRef.current}
        isValidatingGeometry={isValidatingGeometry}
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
  );
}

/* Huvudexport med React Query provider */
export default function Widget(
  props: AllWidgetProps<FmeExportConfig>
): React.ReactElement {
  const resolveWidgetId = (): string =>
    normalizeWidgetId({
      id: (props as { id?: unknown }).id,
      widgetId: props.widgetId,
    });

  const showDevtools = process.env.NODE_ENV !== "production";

  hooks.useEffectOnce(() => {
    setupFmeDebugTools({
      widgetId: resolveWidgetId(),
      config: props.config,
    });
    return undefined;
  });

  hooks.useUpdateEffect(() => {
    updateFmeDebugTools({
      widgetId: resolveWidgetId(),
      config: props.config,
    });
  }, [props.id, props.config]);

  return (
    <QueryClientProvider client={fmeQueryClient}>
      <WidgetContent {...props} />
      {showDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}

Reflect.set(
  Widget as unknown as object,
  "mapExtraStateProps",
  (
    state: IMStateWithFmeExport,
    ownProps: Partial<AllWidgetProps<FmeExportConfig>>
  ) => {
    const globalState = state["fme-state"];
    const wid = normalizeWidgetId({
      id: (ownProps as { id?: unknown })?.id,
      widgetId: ownProps?.widgetId,
    });
    const sub = wid ? globalState?.byId?.[wid] : undefined;
    return { state: sub || initialFmeState };
  }
);
