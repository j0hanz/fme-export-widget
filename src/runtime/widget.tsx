/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  type AllWidgetProps,
  hooks,
  jsx,
  css,
  ReactRedux,
  type IMState,
  WidgetState,
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
  EsriModules,
  ExportResult,
  IMStateWithFmeExport,
  FmeWidgetState,
  WorkspaceParameter,
  WorkspaceItemDetail,
  ErrorState,
  ApiResponse,
  DrawingSessionState,
  MutableParams,
  RemoteDatasetOptions,
  SubmissionPreparationOptions,
  SubmissionPreparationResult,
} from "../config"
import {
  makeErrorView,
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  LAYER_CONFIG,
  VIEW_ROUTES,
  DEFAULT_DRAWING_HEX,
} from "../config"
import { validateWidgetStartup } from "../shared/services"
import {
  mapErrorToKey,
  isValidExternalUrlForOptGetUrl,
  calcArea,
  validatePolygon,
  checkMaxArea,
  processFmeResponse,
} from "../shared/validations"
import { fmeActions, initialFmeState } from "../extensions/store"
import {
  resolveMessageOrKey,
  buildSupportHintText,
  getEmail,
  attachAoi,
  prepFmeParams,
  determineServiceMode,
  applyDirectiveDefaults,
  formatArea,
  isValidEmail,
  getSupportEmail,
  formatErrorForView,
  useLatestAbortController,
  toTrimmedString,
  coerceFormValueForSubmission,
  logIfNotAbort,
  loadArcgisModules,
} from "../shared/utils"

// Styling and symbols derived from config

const hexToRgbArray = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  const n = m ? parseInt(m[1], 16) : parseInt(DEFAULT_DRAWING_HEX.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

const buildSymbols = (rgb: readonly [number, number, number]) => {
  const base = [rgb[0], rgb[1], rgb[2]] as [number, number, number]
  const highlight = {
    type: "simple-fill" as const,
    color: [...base, 0.2] as [number, number, number, number],
    outline: {
      color: base,
      width: 2,
      style: "solid" as const,
    },
  }
  const symbols = {
    polygon: highlight,
    polyline: {
      type: "simple-line",
      color: base,
      width: 2,
      style: "solid",
    },
    point: {
      type: "simple-marker",
      style: "circle",
      size: 8,
      color: base,
      outline: {
        color: [255, 255, 255],
        width: 1,
      },
    },
  } as const
  return { HIGHLIGHT_SYMBOL: highlight, DRAWING_SYMBOLS: symbols }
}

const UPLOAD_PARAM_TYPES = [
  "FILENAME",
  "FILENAME_MUSTEXIST",
  "DIRNAME",
  "DIRNAME_MUSTEXIST",
  "DIRNAME_SRC",
  "LOOKUP_FILE",
  "REPROJECTION_FILE",
] as const

const resolveUploadTargetParam = (
  config: FmeExportConfig | null | undefined
): string | null => toTrimmedString(config?.uploadTargetParamName) ?? null

const parseSubmissionFormData = (rawData: {
  [key: string]: unknown
}): {
  sanitizedFormData: { [key: string]: unknown }
  uploadFile: File | null
  remoteUrl: string
} => {
  const {
    __upload_file__: uploadField,
    __remote_dataset_url__: remoteDatasetField,
    opt_geturl: optGetUrlField,
    ...restFormData
  } = rawData

  const sanitizedOptGetUrl = toTrimmedString(optGetUrlField)
  const sanitizedFormData = sanitizedOptGetUrl
    ? { ...restFormData, opt_geturl: sanitizedOptGetUrl }
    : { ...restFormData }

  const normalizedFormData: { [key: string]: unknown } = {}
  for (const [key, val] of Object.entries(sanitizedFormData)) {
    normalizedFormData[key] = coerceFormValueForSubmission(val)
  }

  const uploadFile = uploadField instanceof File ? uploadField : null
  const remoteUrl = toTrimmedString(remoteDatasetField) ?? ""

  return { sanitizedFormData: normalizedFormData, uploadFile, remoteUrl }
}

const applyUploadedDatasetParam = ({
  finalParams,
  uploadedPath,
  parameters,
  explicitTarget,
}: {
  finalParams: { [key: string]: unknown }
  uploadedPath?: string
  parameters?: readonly WorkspaceParameter[] | null
  explicitTarget: string | null
}): void => {
  if (!uploadedPath) return

  if (explicitTarget) {
    finalParams[explicitTarget] = uploadedPath
    return
  }

  const candidate = (parameters ?? []).find((param) => {
    const normalizedType = String(
      param?.type
    ) as (typeof UPLOAD_PARAM_TYPES)[number]
    return UPLOAD_PARAM_TYPES.includes(normalizedType)
  })

  if (candidate?.name) {
    finalParams[candidate.name] = uploadedPath
    return
  }

  if (
    typeof (finalParams as { SourceDataset?: unknown }).SourceDataset ===
    "undefined"
  ) {
    ;(finalParams as { SourceDataset?: unknown }).SourceDataset = uploadedPath
  }
}

const isNavigatorOffline = (): boolean => {
  try {
    const nav = (globalThis as any)?.navigator
    return Boolean(nav && nav.onLine === false)
  } catch {
    return false
  }
}

const sanitizeOptGetUrlParam = (
  params: MutableParams,
  config: FmeExportConfig | null | undefined
): void => {
  const value = params.opt_geturl

  if (typeof value !== "string") {
    delete params.opt_geturl
    return
  }

  const trimmed = value.trim()
  const urlIsAllowed = Boolean(config?.allowRemoteUrlDataset)
  const urlIsValid = isValidExternalUrlForOptGetUrl(trimmed)

  if (!trimmed || !urlIsAllowed || !urlIsValid) {
    delete params.opt_geturl
    return
  }

  params.opt_geturl = trimmed
}

const shouldApplyRemoteDatasetUrl = (
  remoteUrl: string,
  config: FmeExportConfig | null | undefined
): boolean =>
  Boolean(
    config?.allowRemoteUrlDataset &&
      remoteUrl &&
      isValidExternalUrlForOptGetUrl(remoteUrl)
  )

const shouldUploadRemoteDataset = (
  config: FmeExportConfig | null | undefined,
  uploadFile: File | null
): uploadFile is File => Boolean(config?.allowRemoteDataset && uploadFile)

const removeAoiErrorMarker = (params: MutableParams): void => {
  if (typeof params.__aoi_error__ !== "undefined") {
    delete params.__aoi_error__
  }
}

const resolveRemoteDataset = async ({
  params,
  remoteUrl,
  uploadFile,
  config,
  workspaceParameters,
  makeCancelable,
  fmeClient,
  signal,
  subfolder,
}: RemoteDatasetOptions): Promise<void> => {
  sanitizeOptGetUrlParam(params, config)

  if (shouldApplyRemoteDatasetUrl(remoteUrl, config)) {
    params.opt_geturl = remoteUrl
    return
  }

  if (!shouldUploadRemoteDataset(config, uploadFile)) {
    return
  }

  const uploadResponse = await makeCancelable<ApiResponse<{ path: string }>>(
    fmeClient.uploadToTemp(uploadFile, {
      subfolder,
      signal,
    })
  )

  const uploadedPath = uploadResponse.data?.path
  applyUploadedDatasetParam({
    finalParams: params,
    uploadedPath,
    parameters: workspaceParameters,
    explicitTarget: resolveUploadTargetParam(config),
  })
}

const prepareSubmissionParams = async ({
  rawFormData,
  userEmail,
  geometryJson,
  geometry,
  modules,
  config,
  workspaceParameters,
  makeCancelable,
  fmeClient,
  signal,
  remoteDatasetSubfolder,
}: SubmissionPreparationOptions): Promise<SubmissionPreparationResult> => {
  const { sanitizedFormData, uploadFile, remoteUrl } =
    parseSubmissionFormData(rawFormData)

  const baseParams = prepFmeParams(
    {
      data: sanitizedFormData,
    },
    userEmail,
    geometryJson,
    geometry || undefined,
    modules,
    {
      config,
      workspaceParameters,
    }
  )

  const aoiError = (baseParams as MutableParams).__aoi_error__
  if (aoiError) {
    return { params: null, aoiError }
  }

  const params: MutableParams = { ...baseParams }

  await resolveRemoteDataset({
    params,
    remoteUrl,
    uploadFile,
    config,
    workspaceParameters,
    makeCancelable,
    fmeClient,
    signal,
    subfolder: remoteDatasetSubfolder,
  })

  const paramsWithDefaults = applyDirectiveDefaults(params, config as any)
  removeAoiErrorMarker(paramsWithDefaults as MutableParams)

  return { params: paramsWithDefaults }
}

// ArcGIS JS API modules
const MODULES = [
  "esri/widgets/Sketch/SketchViewModel",
  "esri/layers/GraphicsLayer",
  "esri/geometry/geometryEngine",
  "esri/geometry/geometryEngineAsync",
  "esri/geometry/support/webMercatorUtils",
  "esri/geometry/projection",
  "esri/geometry/SpatialReference",
  "esri/geometry/support/normalizeUtils",
  "esri/geometry/Polyline",
  "esri/geometry/Polygon",
  "esri/Graphic",
] as const

// Safe operation helpers
const safely = <T,>(
  resource: T | null | undefined,
  _context = "ArcGIS safe operation failed",
  operation: (value: T) => void
): void => {
  if (!resource) return
  try {
    operation(resource)
  } catch {}
}

const safeCancelSketch = (
  vm?: __esri.SketchViewModel | null,
  context = "Failed to cancel SketchViewModel"
): void => {
  safely(vm, context, (model) => {
    model.cancel()
  })
}

const safeClearLayer = (
  layer?: __esri.GraphicsLayer | null,
  context = "Failed to clear GraphicsLayer"
): void => {
  safely(layer, context, (graphics) => {
    graphics.removeAll()
  })
}

const removeLayerFromMap = (
  jmv?: JimuMapView | null,
  layer?: __esri.GraphicsLayer | null,
  context = "Failed to remove GraphicsLayer from map"
): void => {
  if (!jmv?.view?.map) return
  safely(layer, context, (graphicsLayer) => {
    if (graphicsLayer.parent) {
      jmv.view.map.remove(graphicsLayer)
    }
  })
}

// Consolidated module and resource management
const useEsriModules = (
  reloadSignal: number
): {
  modules: EsriModules | null
  loading: boolean
} => {
  const [state, setState] = React.useState<{
    modules: EsriModules | null
    loading: boolean
  }>({ modules: null, loading: true })

  hooks.useEffectWithPreviousValues(() => {
    let cancelled = false

    setState((prev) => ({
      modules: reloadSignal === 0 ? prev.modules : null,
      loading: true,
    }))

    const loadModules = async () => {
      try {
        const loaded = await loadArcgisModules(MODULES)
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
          } as EsriModules,
          loading: false,
        })
      } catch (error) {
        if (!cancelled) {
          setState({ modules: null, loading: false })
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

// Consolidated map state and resource management
const useMapResources = () => {
  const [state, setState] = React.useState<{
    jimuMapView: JimuMapView | null
    sketchViewModel: __esri.SketchViewModel | null
    graphicsLayer: __esri.GraphicsLayer | null
  }>({
    jimuMapView: null,
    sketchViewModel: null,
    graphicsLayer: null,
  })

  const updateResource = hooks.useEventCallback(
    <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => {
      setState((prev) => ({ ...prev, [key]: value }))
    }
  )

  const releaseDrawingResources = hooks.useEventCallback(
    (logSuffix: string, resetMapView: boolean) => {
      const { sketchViewModel, graphicsLayer, jimuMapView } = state

      safeCancelSketch(
        sketchViewModel,
        `Error ${logSuffix} SketchViewModel (cancel)`
      )

      safely(
        sketchViewModel,
        `Error ${logSuffix} SketchViewModel (destroy)`,
        (model) => {
          if (typeof model.destroy === "function") {
            model.destroy()
          }
        }
      )

      removeLayerFromMap(
        jimuMapView,
        graphicsLayer,
        `Error ${logSuffix} GraphicsLayer (remove)`
      )
      safeClearLayer(graphicsLayer, `Error ${logSuffix} GraphicsLayer (clear)`)

      setState((prev) => ({
        ...prev,
        jimuMapView: resetMapView ? null : prev.jimuMapView,
        sketchViewModel: null,
        graphicsLayer: null,
      }))
    }
  )

  // Teardown drawing resources
  const teardownDrawingResources = hooks.useEventCallback(() => {
    releaseDrawingResources("tearing down", false)
  })

  const cleanupResources = hooks.useEventCallback(() => {
    releaseDrawingResources("cleaning up", true)
  })

  return {
    ...state,
    setJimuMapView: (view: JimuMapView | null) =>
      updateResource("jimuMapView", view),
    setSketchViewModel: (vm: __esri.SketchViewModel | null) =>
      updateResource("sketchViewModel", vm),
    setGraphicsLayer: (layer: __esri.GraphicsLayer | null) =>
      updateResource("graphicsLayer", layer),
    teardownDrawingResources,
    cleanupResources,
  }
}

// Error handling
const useErrorDispatcher = (
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
    dispatch(fmeActions.setError(error, widgetId))
  })

// Initialize graphics layers for drawing
const createLayers = (
  jmv: JimuMapView,
  modules: EsriModules,
  setGraphicsLayer: (layer: __esri.GraphicsLayer) => void
) => {
  // Main sketch layer
  const layer = new modules.GraphicsLayer(LAYER_CONFIG)
  jmv.view.map.add(layer)
  setGraphicsLayer(layer)

  return layer
}

// Create and configure SketchViewModel
const createSketchVM = ({
  jmv,
  modules,
  layer,
  onDrawComplete,
  dispatch,
  widgetId,
  symbols,
  onDrawingSessionChange,
}: {
  jmv: JimuMapView
  modules: EsriModules
  layer: __esri.GraphicsLayer
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void
  dispatch: (action: unknown) => void
  widgetId: string
  symbols: {
    polygon: any
    polyline: any
    point: any
  }
  onDrawingSessionChange: (updates: Partial<DrawingSessionState>) => void
}) => {
  const sketchViewModel = new modules.SketchViewModel({
    view: jmv.view,
    layer,
    polygonSymbol: symbols.polygon,
    polylineSymbol: symbols.polyline,
    pointSymbol: symbols.point,
    defaultCreateOptions: {
      hasZ: false,
      mode: "click",
    },
    defaultUpdateOptions: {
      tool: "reshape",
      toggleToolOnClick: false,
      enableRotation: true,
      enableScaling: true,
      preserveAspectRatio: false,
    },
    snappingOptions: {
      enabled: true,
      selfEnabled: true,
      featureEnabled: true,
    },
    tooltipOptions: {
      enabled: true,
      inputEnabled: true,
      visibleElements: {
        area: true,
        totalLength: true,
        distance: true,
        coordinates: false,
        elevation: false,
        rotation: false,
        scale: false,
        size: false,
        radius: true,
        direction: true,
        header: true,
        helpMessage: true,
      },
    },
    valueOptions: {
      directionMode: "relative",
      displayUnits: {
        length: "meters",
        verticalLength: "meters",
        area: "square-meters",
      },
      inputUnits: {
        length: "meters",
        verticalLength: "meters",
        area: "square-meters",
      },
    },
  })

  setupSketchEventHandlers(
    sketchViewModel,
    onDrawComplete,
    dispatch,
    modules,
    widgetId,
    onDrawingSessionChange
  )
  return sketchViewModel
}

// Setup SketchViewModel event handlers
const setupSketchEventHandlers = (
  sketchViewModel: __esri.SketchViewModel,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void,
  modules: EsriModules,
  widgetId: string,
  onDrawingSessionChange: (updates: Partial<DrawingSessionState>) => void
) => {
  let clickCount = 0

  sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
    switch (evt.state) {
      case "start":
        clickCount = 0
        onDrawingSessionChange({ isActive: true, clickCount: 0 })
        dispatch(
          fmeActions.setDrawingTool(
            evt.tool === "rectangle"
              ? DrawingTool.RECTANGLE
              : DrawingTool.POLYGON,
            widgetId
          )
        )
        break

      case "active":
        if (evt.tool === "polygon" && evt.graphic?.geometry) {
          const geometry = evt.graphic.geometry as __esri.Polygon
          const vertices = geometry.rings?.[0]
          const actualClicks = vertices ? Math.max(0, vertices.length - 1) : 0
          if (actualClicks > clickCount) {
            clickCount = actualClicks
            onDrawingSessionChange({ clickCount: actualClicks, isActive: true })
            if (actualClicks === 1) {
              dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
            }
          }
        } else if (evt.tool === "rectangle" && clickCount !== 1) {
          clickCount = 1
          onDrawingSessionChange({ clickCount: 1, isActive: true })
        }
        break

      case "complete":
        clickCount = 0
        onDrawingSessionChange({ isActive: false, clickCount: 0 })
        try {
          onDrawComplete(evt)
        } catch (err: any) {
          logIfNotAbort("onDrawComplete error", err)
        }
        break

      case "cancel":
        clickCount = 0
        onDrawingSessionChange({ isActive: false, clickCount: 0 })
        break
    }
  })

  // Re-run the same completion pipeline when a reshape finishes
  sketchViewModel.on("update", (evt: __esri.SketchUpdateEvent) => {
    if (
      evt.state === "complete" &&
      Array.isArray(evt.graphics) &&
      (evt.graphics[0] as any)?.geometry
    ) {
      try {
        onDrawComplete({
          graphic: evt.graphics[0] as any,
          state: "complete",
          tool: (evt as any).tool,
        } as any)
      } catch (err: any) {
        logIfNotAbort("onDrawComplete update error", err)
      }
    }
  })
}

// Area formatting is imported from shared/utils

export default function Widget(
  props: AllWidgetProps<FmeExportConfig> & { state: FmeWidgetState }
): React.ReactElement {
  const {
    id,
    widgetId: widgetIdProp,
    useMapWidgetIds,
    dispatch,
    state: reduxState,
    config,
  } = props

  // Determine widget ID for state management
  const widgetId =
    (id as unknown as string) ?? (widgetIdProp as unknown as string)

  const styles = useStyles()
  const translateWidget = hooks.useTranslation(defaultMessages)

  // Translation function
  const translate = hooks.useEventCallback((key: string): string => {
    return translateWidget(key)
  })

  const makeCancelable = hooks.useCancelablePromiseMaker()
  const configRef = hooks.useLatest(config)
  const viewModeRef = hooks.useLatest(reduxState.viewMode)
  const drawingToolRef = hooks.useLatest(reduxState.drawingTool)
  const fmeClientRef = React.useRef<ReturnType<
    typeof createFmeFlowClient
  > | null>(null)
  const fmeClientKeyRef = React.useRef<string | null>(null)
  // When true, after reinitializing SketchViewModel we will immediately start drawing
  const shouldAutoStartRef = React.useRef(false)

  const [drawingSession, setDrawingSession] =
    React.useState<DrawingSessionState>(() => ({
      isActive: false,
      clickCount: 0,
    }))

  const updateDrawingSession = hooks.useEventCallback(
    (updates: Partial<DrawingSessionState>) => {
      setDrawingSession((prev) => ({ ...prev, ...updates }))
    }
  )

  // Error handling
  const dispatchError = useErrorDispatcher(dispatch, widgetId)
  const submissionAbort = useLatestAbortController()

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

  hooks.useUpdateEffect(() => {
    if (!config) {
      disposeFmeClient()
    }
  }, [config, disposeFmeClient])

  hooks.useUnmount(() => disposeFmeClient())

  // Centralized Redux reset helpers to avoid duplicated dispatch sequences
  const resetReduxForRevalidation = hooks.useEventCallback(() => {
    const activeTool = drawingToolRef.current
    const latestConfig = configRef.current

    dispatch(fmeActions.resetState(widgetId))

    if (latestConfig?.repository) {
      dispatch(
        fmeActions.clearWorkspaceState(latestConfig.repository, widgetId)
      )
    }

    if (activeTool) {
      dispatch(fmeActions.setDrawingTool(activeTool, widgetId))
    }
  })

  const resetReduxToInitialDrawing = hooks.useEventCallback(() => {
    dispatch(fmeActions.setGeometry(null, 0, widgetId))
    updateDrawingSession({ isActive: false, clickCount: 0 })
    dispatch(fmeActions.setError(null, widgetId))
    dispatch(fmeActions.setImportError(null, widgetId))
    dispatch(fmeActions.setExportError(null, widgetId))
    dispatch(fmeActions.setOrderResult(null, widgetId))
    dispatch(
      fmeActions.setSelectedWorkspace(null, config?.repository, widgetId)
    )
    dispatch(fmeActions.setFormValues({}, widgetId))
    dispatch(
      fmeActions.setLoadingFlags(
        { isModulesLoading: false, isSubmittingOrder: false },
        widgetId
      )
    )
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
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
        resolveMessageOrKey(baseMsgKey, translate) ||
        translate("unknownErrorOccurred")

      // Decide how to guide the user depending on error type
      const codeUpper = (error.code || "").toUpperCase()
      const isGeometryInvalid =
        codeUpper === "GEOMETRY_INVALID" || codeUpper === "INVALID_GEOMETRY"
      const isConfigIncomplete = codeUpper === "CONFIG_INCOMPLETE"
      const suppressSupport = isGeometryInvalid || isConfigIncomplete

      // For geometry invalid errors: suppress code and support email; show an explanatory hint
      const ufm = error.userFriendlyMessage
      const supportEmail = getSupportEmail(configRef.current?.supportEmail)
      const supportHint = isGeometryInvalid
        ? translate("geometryInvalidHint")
        : isConfigIncomplete
          ? translate("startupConfigErrorHint")
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
          dispatch(fmeActions.setError(null, widgetId))
          if (isGeometryInvalid) {
            // Mark that we should auto-start once tools are re-initialized
            shouldAutoStartRef.current = true
            dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
            // If drawing resources were torn down, re-initialize them now
            try {
              if (!sketchViewModel && modules && jimuMapView) {
                handleMapViewReady(jimuMapView)
              }
            } catch {}
          }
        })
      actions.push({ label: translate("retry"), onClick: retryHandler })

      // If offline, offer a reload action for convenience
      if (isNavigatorOffline()) {
        actions.push({
          label: translate("reload"),
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
          renderActions={(act, ariaLabel) => (
            <div
              role="group"
              aria-label={ariaLabel}
              data-actions-count={act?.length ?? 0}
            >
              {/* Render hint row: for geometry errors show plain text without support email */}
              <div>
                {suppressSupport ? (
                  <div css={styles.typography.caption}>{supportHint}</div>
                ) : (
                  renderSupportHint(
                    supportEmail,
                    translate,
                    styles,
                    supportHint
                  )
                )}
              </div>
              {Array.isArray(act) && act.length > 0 && (
                <div css={css({ marginTop: 8 })}>
                  {act.map((a, i) => (
                    <Button key={i} text={a.label} onClick={a.onClick} />
                  ))}
                </div>
              )}
            </div>
          )}
          center={true}
        />
      )
    }
  )

  const { modules, loading: modulesLoading } = useEsriModules(moduleRetryKey)
  const mapResources = useMapResources()

  const getActiveGeometry = hooks.useEventCallback(() => {
    if (!reduxState.geometryJson || !modules?.Polygon) {
      return null
    }
    const polygonCtor: any = modules.Polygon
    try {
      if (typeof polygonCtor?.fromJSON === "function") {
        return polygonCtor.fromJSON(reduxState.geometryJson as any)
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
    teardownDrawingResources,
    cleanupResources,
  } = mapResources

  const endSketchSession = hooks.useEventCallback(
    (options?: { clearLocalGeometry?: boolean }) => {
      shouldAutoStartRef.current = false
      if (options?.clearLocalGeometry) {
        updateDrawingSession({ clickCount: 0 })
      }
      if (sketchViewModel) {
        safeCancelSketch(
          sketchViewModel,
          "Error cancelling SketchViewModel while exiting drawing mode"
        )
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
    dispatch(fmeActions.setStartupValidationState(true, step, null, widgetId))
  })

  const setValidationSuccess = hooks.useEventCallback(() => {
    dispatch(
      fmeActions.setStartupValidationState(false, undefined, null, widgetId)
    )
    const currentViewMode = viewModeRef.current
    const isUnset =
      currentViewMode === null || typeof currentViewMode === "undefined"
    const isStartupPhase =
      currentViewMode === ViewMode.STARTUP_VALIDATION ||
      currentViewMode === ViewMode.INITIAL
    if (isUnset || isStartupPhase) {
      dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
    }
  })

  const setValidationError = hooks.useEventCallback((error: ErrorState) => {
    dispatch(
      fmeActions.setStartupValidationState(false, undefined, error, widgetId)
    )
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
      suggestion: translate("retryValidation"),
      retry,
      kind: "runtime",
    })
  )

  // Keep track of ongoing startup validation to allow aborting
  const startupAbort = useLatestAbortController()

  // Startup validation
  const runStartupValidation = hooks.useEventCallback(async () => {
    const controller = startupAbort.abortAndCreate()
    setValidationStep(translate("validatingConfiguration"))

    try {
      // Step 1: validate map configuration
      setValidationStep(translate("validatingMapConfiguration"))
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0

      // Step 2: validate widget configuration and FME connection using shared service
      setValidationStep(translate("validatingConnection"))
      const validationResult = await validateWidgetStartup({
        config,
        translate,
        signal: controller.signal,
        mapConfigured: hasMapConfigured,
      })

      if (!validationResult.isValid) {
        if (validationResult.error) {
          setValidationError(validationResult.error)
        } else {
          // Fallback error
          setValidationError(
            createStartupError(
              "invalidConfiguration",
              "VALIDATION_FAILED",
              runStartupValidation
            )
          )
        }
        return
      }

      // Step 3: validate user email only when async mode is in use
      if (!config?.syncMode) {
        setValidationStep(translate("validatingUserEmail"))
        try {
          const email = await getEmail(config)
          if (!isValidEmail(email)) {
            setValidationError(
              createStartupError(
                "userEmailMissing",
                "UserEmailMissing",
                runStartupValidation
              )
            )
            return
          }
        } catch (emailErr) {
          setValidationError(
            createStartupError(
              "userEmailMissing",
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
      const errorKey = mapErrorToKey(err) || "unknownErrorOccurred"
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
    safeClearLayer(
      graphicsLayer,
      "Error clearing graphics during measurement reset"
    )
  })

  // Drawing complete with enhanced Graphic functionality
  const onDrawComplete = hooks.useEventCallback(
    async (evt: __esri.SketchCreateEvent) => {
      const geometry = evt.graphic?.geometry
      if (!geometry) return
      endSketchSession()
      dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION, widgetId))

      try {
        // Validate
        const validation = await validatePolygon(geometry, modules)
        if (!validation.valid) {
          // Remove erroneous graphic and reset drawing state
          try {
            graphicsLayer?.remove(evt.graphic as any)
          } catch {}
          // Tear down drawing resources to reset state
          teardownDrawingResources()
          dispatch(fmeActions.setGeometry(null, 0, widgetId))
          exitDrawingMode(ViewMode.INITIAL, { clearLocalGeometry: true })
          if (validation.error) {
            dispatch(fmeActions.setError(validation.error, widgetId))
          }
          return
        }
        const geomForUse =
          (validation as { simplified?: __esri.Polygon | null }).simplified ??
          (geometry as __esri.Polygon)

        const calculatedArea = await calcArea(geomForUse, modules)

        // Zero-area guard: reject invalid or degenerate geometries
        if (!calculatedArea || calculatedArea <= 0) {
          dispatchError(
            translate("invalidGeometry"),
            ErrorType.VALIDATION,
            "ZERO_AREA"
          )
          return
        }

        // Max area validation
        const maxCheck = checkMaxArea(calculatedArea, config?.maxArea)
        if (!maxCheck.ok) {
          if (maxCheck.message) {
            dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code)
          }
          return
        }

        // Set visual symbol and replace geometry with simplified
        if (evt.graphic) {
          evt.graphic.geometry = geomForUse
          const highlightSymbol = symbolsRef.current?.HIGHLIGHT_SYMBOL
          if (highlightSymbol) {
            evt.graphic.symbol = highlightSymbol as any
          }
        }

        // Persist geometry and area to Redux
        dispatch(
          fmeActions.setGeometry(geomForUse, Math.abs(calculatedArea), widgetId)
        )
        dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION, widgetId))
      } catch (error) {
        dispatchError(
          translate("drawingCompleteFailed"),
          ErrorType.VALIDATION,
          "DRAWING_COMPLETE_ERROR"
        )
      }
    }
  )

  // Form submission guard clauses
  const canSubmit = (): boolean => {
    const hasGeometry = Boolean(reduxState.geometryJson)
    if (!hasGeometry || !reduxState.selectedWorkspace) {
      return false
    }

    // Re-validate area constraints before submission
    const maxCheck = checkMaxArea(reduxState.drawnArea, config?.maxArea)
    if (!maxCheck.ok && maxCheck.message) {
      dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code)
      return false
    }

    return true
  }

  // Handle successful submission
  const finalizeOrder = hooks.useEventCallback((result: ExportResult) => {
    dispatch(fmeActions.setOrderResult(result, widgetId))
    dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT, widgetId))
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
    const rawKey = mapErrorToKey(error) || "unknownErrorOccurred"
    let localizedErr = ""
    try {
      localizedErr = resolveMessageOrKey(rawKey, translate)
    } catch {
      localizedErr = translate("unknownErrorOccurred")
    }
    // Build localized failure message and append contact support hint
    const configured = getSupportEmail(configRef.current?.supportEmail)
    const contactHint = buildSupportHintText(translate, configured)
    const baseFailMessage = translate("orderFailed")
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
    if (reduxState.isSubmittingOrder || !canSubmit()) {
      return
    }

    dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: true }, widgetId))

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

      const workspace = reduxState.selectedWorkspace
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
        geometryJson: reduxState.geometryJson,
        geometry: getActiveGeometry() || undefined,
        modules,
        config: latestConfig,
        workspaceParameters: reduxState.workspaceParameters,
        makeCancelable,
        fmeClient,
        signal: controller.signal,
        remoteDatasetSubfolder: subfolder,
      })

      if (preparation.aoiError) {
        dispatch(fmeActions.setError(preparation.aoiError, widgetId))
        return
      }

      const finalParams = preparation.params
      if (!finalParams) {
        throw new Error("Submission parameter preparation failed")
      }
      try {
        if (typeof globalThis !== "undefined") {
          ;(globalThis as any).__LAST_FME_CALL__ = {
            workspace,
            params: finalParams,
          }
        }
      } catch {
        // Ignore global write errors in constrained environments
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
      dispatch(
        fmeActions.setLoadingFlags({ isSubmittingOrder: false }, widgetId)
      )
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
      // Best-effort: close any open popups as soon as the widget takes focus on the map
      try {
        ;(jmv as any)?.view?.closePopup?.()
      } catch {}

      const layer = createLayers(jmv, modules, setGraphicsLayer)
      try {
        // Localize drawing layer title
        ;(layer as unknown as { [key: string]: any }).title =
          translate("drawingLayerTitle")
      } catch {}
      const svm = createSketchVM({
        jmv,
        modules,
        layer,
        onDrawComplete,
        dispatch,
        widgetId,
        symbols: (symbolsRef.current as any)?.DRAWING_SYMBOLS,
        onDrawingSessionChange: updateDrawingSession,
      })
      setSketchViewModel(svm)
      try {
        // If we're returning from a geometry error, immediately start drawing using the current tool
        if (shouldAutoStartRef.current) {
          shouldAutoStartRef.current = false
          const tool = props.state?.drawingTool || reduxState.drawingTool
          const arg: "rectangle" | "polygon" =
            tool === DrawingTool.RECTANGLE ? "rectangle" : "polygon"
          ;(svm as any).create?.(arg)
        }
      } catch {}
    } catch (error) {
      dispatchError(
        translate("mapInitFailed"),
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

  // Update symbols on color change
  hooks.useUpdateEffect(() => {
    const syms = (symbolsRef.current as any)?.DRAWING_SYMBOLS
    if (syms) {
      safely(
        sketchViewModel,
        "Error applying drawing symbols to SketchViewModel",
        (model) => {
          ;(model as any).polygonSymbol = syms.polygon
          ;(model as any).polylineSymbol = syms.polyline
          ;(model as any).pointSymbol = syms.point
        }
      )
      safely(
        graphicsLayer,
        "Error updating drawing symbols on GraphicsLayer",
        (layer) => {
          layer.graphics.forEach((g: any) => {
            if (g?.geometry?.type === "polygon") {
              g.symbol = syms.polygon
            }
          })
        }
      )
    }
  }, [sketchViewModel, graphicsLayer, (config as any)?.drawingColor])

  // If widget loses activation, cancel any in-progress drawing to avoid dangling operations
  hooks.useUpdateEffect(() => {
    if (!isActive && sketchViewModel) {
      safeCancelSketch(
        sketchViewModel,
        "Error cancelling drawing when widget deactivates"
      )
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

  // Cleanup
  hooks.useEffectOnce(() => {
    return () => {
      // Cleanup resources on unmount
      submissionAbort.cancel()
      startupAbort.cancel()
      cleanupResources()
    }
  })

  // Instruction text
  const getDrawingInstructions = hooks.useEventCallback(
    (tool: DrawingTool, isDrawing: boolean, clickCount: number) => {
      if (tool === DrawingTool.RECTANGLE) {
        return translate("rectangleDrawingInstructions")
      }

      if (tool === DrawingTool.POLYGON) {
        if (!isDrawing || clickCount === 0) {
          return translate("polygonDrawingStart")
        }
        if (clickCount < 3) {
          return translate("polygonDrawingContinue")
        }
        return translate("polygonDrawingComplete")
      }

      return translate("drawInstruction")
    }
  )

  // Start drawing
  const handleStartDrawing = hooks.useEventCallback((tool: DrawingTool) => {
    if (!sketchViewModel) return

    // Set tool
    updateDrawingSession({ isActive: true, clickCount: 0 })
    dispatch(fmeActions.setDrawingTool(tool, widgetId))
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))

    // Clear and hide
    resetGraphicsAndMeasurements()

    // Cancel only if SketchViewModel is actively drawing to reduce AbortError races
    try {
      const anyVm = sketchViewModel as any
      const isActive = Boolean(anyVm?.state === "active" || anyVm?._creating)
      if (isActive) {
        safeCancelSketch(
          sketchViewModel,
          "Error cancelling active SketchViewModel before starting new drawing"
        )
      }
    } catch {
      // fallback best-effort cancel
      safeCancelSketch(
        sketchViewModel,
        "Error cancelling SketchViewModel after exception in handleStartDrawing"
      )
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

  // Auto-start drawing when in DRAWING mode
  const canAutoStartDrawing =
    reduxState.viewMode === ViewMode.DRAWING &&
    drawingSession.clickCount === 0 &&
    sketchViewModel &&
    !reduxState.isSubmittingOrder &&
    !(reduxState.error && reduxState.error.severity === ErrorSeverity.ERROR)

  hooks.useUpdateEffect(() => {
    // Only auto-start if not already started and widget is not closed
    if (canAutoStartDrawing && runtimeState !== WidgetState.Closed) {
      handleStartDrawing(reduxState.drawingTool)
    }
  }, [
    reduxState.viewMode,
    drawingSession.clickCount,
    reduxState.drawingTool,
    sketchViewModel,
    reduxState.isSubmittingOrder,
    handleStartDrawing,
    runtimeState,
  ])

  // Reset handler
  const handleReset = hooks.useEventCallback(() => {
    // Clear graphics and measurements but keep map resources alive
    resetGraphicsAndMeasurements()

    // Abort any ongoing submission
    submissionAbort.cancel()

    // Cancel any in-progress drawing
    if (sketchViewModel) {
      safeCancelSketch(
        sketchViewModel,
        "Error cancelling drawing during handleReset"
      )
    }

    // Reset Redux state
    resetReduxToInitialDrawing()
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
    if (
      jimuMapView &&
      prevRuntimeState === WidgetState.Closed &&
      runtimeState !== WidgetState.Closed
    ) {
      try {
        ;(jimuMapView as any)?.view?.closePopup?.()
      } catch (_) {
        // Best-effort: ignore popup close errors
      }
    }
  }, [runtimeState, prevRuntimeState, jimuMapView])

  // Teardown drawing resources on critical errors
  hooks.useUpdateEffect(() => {
    if (reduxState.error && reduxState.error.severity === ErrorSeverity.ERROR) {
      teardownDrawingResources()
    }
  }, [reduxState.error, teardownDrawingResources])

  // Workspace handlers
  const handleWorkspaceSelected = hooks.useEventCallback(
    (
      workspaceName: string,
      parameters: readonly WorkspaceParameter[],
      workspaceItem: WorkspaceItemDetail
    ) => {
      dispatch(
        fmeActions.setSelectedWorkspace(
          workspaceName,
          configRef.current?.repository,
          widgetId
        )
      )
      dispatch(
        fmeActions.setWorkspaceParameters(
          parameters,
          workspaceName,
          configRef.current?.repository,
          widgetId
        )
      )
      dispatch(
        fmeActions.setWorkspaceItem(
          workspaceItem,
          configRef.current?.repository,
          widgetId
        )
      )
      dispatch(fmeActions.setViewMode(ViewMode.EXPORT_FORM, widgetId))
    }
  )

  const handleWorkspaceBack = hooks.useEventCallback(() => {
    dispatch(fmeActions.setViewMode(ViewMode.INITIAL, widgetId))
  })

  // Navigation helpers
  const navigateTo = hooks.useEventCallback((viewMode: ViewMode) => {
    dispatch(fmeActions.setViewMode(viewMode, widgetId))
  })

  const navigateBack = hooks.useEventCallback(() => {
    const { viewMode, previousViewMode } = reduxState
    const defaultRoute = VIEW_ROUTES[viewMode] || ViewMode.INITIAL
    const target =
      previousViewMode && previousViewMode !== viewMode
        ? previousViewMode
        : defaultRoute
    navigateTo(target)
  })

  // Render loading state if modules are still loading
  if (modulesLoading) {
    return (
      <div css={styles.parent}>
        <StateView
          state={{ kind: "loading", message: translate("preparingMapTools") }}
        />
      </div>
    )
  }
  if (!modules) {
    return (
      <div css={styles.parent}>
        {renderWidgetError(
          {
            message: "mapInitFailed",
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
  if (reduxState.startupValidationError) {
    // Always handle startup validation errors first
    return (
      <div css={styles.parent}>
        {renderWidgetError(
          reduxState.startupValidationError,
          runStartupValidation
        )}
      </div>
    )
  }

  if (reduxState.error && reduxState.error.severity === ErrorSeverity.ERROR) {
    // Handle other errors (non-startup validation)
    return <div css={styles.parent}>{renderWidgetError(reduxState.error)}</div>
  }

  // derive simple view booleans for readability
  const showHeaderActions =
    (drawingSession.isActive || reduxState.drawnArea > 0) &&
    !reduxState.isSubmittingOrder &&
    !modulesLoading

  // precompute UI booleans
  const hasSingleMapWidget = Boolean(
    useMapWidgetIds && useMapWidgetIds.length === 1
  )

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
        config={props.config}
        state={reduxState.viewMode}
        error={reduxState.error}
        instructionText={getDrawingInstructions(
          reduxState.drawingTool,
          drawingSession.isActive,
          drawingSession.clickCount
        )}
        isModulesLoading={modulesLoading}
        modules={modules}
        canStartDrawing={!!sketchViewModel}
        onFormBack={() => navigateTo(ViewMode.WORKSPACE_SELECTION)}
        onFormSubmit={handleFormSubmit}
        orderResult={reduxState.orderResult}
        onReuseGeography={() => navigateTo(ViewMode.WORKSPACE_SELECTION)}
        isSubmittingOrder={reduxState.isSubmittingOrder}
        onBack={navigateBack}
        drawnArea={reduxState.drawnArea}
        formatArea={(area: number) =>
          formatArea(area, modules, jimuMapView?.view?.spatialReference)
        }
        drawingMode={reduxState.drawingTool}
        onDrawingModeChange={(tool) => {
          dispatch(fmeActions.setDrawingTool(tool, widgetId))
          // Rely on the auto-start effect to begin drawing; avoids duplicate create() calls
        }}
        // Drawing props
        isDrawing={drawingSession.isActive}
        clickCount={drawingSession.clickCount}
        // Header props
        showHeaderActions={
          reduxState.viewMode !== ViewMode.STARTUP_VALIDATION &&
          showHeaderActions
        }
        onReset={handleReset}
        canReset={true}
        onWorkspaceSelected={handleWorkspaceSelected}
        onWorkspaceBack={handleWorkspaceBack}
        selectedWorkspace={reduxState.selectedWorkspace}
        workspaceParameters={reduxState.workspaceParameters}
        workspaceItem={reduxState.workspaceItem}
        // Startup validation props
        isStartupValidating={reduxState.isStartupValidating}
        startupValidationStep={reduxState.startupValidationStep}
        startupValidationError={reduxState.startupValidationError}
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

// Consolidated exports (internal helpers exposed strictly for unit tests)
export {
  hexToRgbArray,
  buildSymbols,
  resolveUploadTargetParam,
  parseSubmissionFormData,
  applyUploadedDatasetParam,
  sanitizeOptGetUrlParam,
  shouldApplyRemoteDatasetUrl,
  shouldUploadRemoteDataset,
  removeAoiErrorMarker,
  resolveRemoteDataset,
  prepareSubmissionParams,
  getEmail,
  attachAoi,
  isValidExternalUrlForOptGetUrl,
  prepFmeParams,
  formatArea,
  calcArea,
  validatePolygon,
  processFmeResponse,
  useEsriModules,
  useMapResources,
  useErrorDispatcher,
  createLayers,
  createSketchVM,
  setupSketchEventHandlers,
}
