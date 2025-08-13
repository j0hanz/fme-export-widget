import {
  React,
  type AllWidgetProps,
  hooks,
  type ImmutableObject,
} from "jimu-core"
import { Message } from "jimu-ui"
import {
  JimuMapViewComponent,
  type JimuMapView,
  loadArcGISJSAPIModules,
} from "jimu-arcgis"
import { Content } from "./components/content"
import { StateView } from "./components/ui"
import { createFmeFlowClient } from "../shared/api"
import defaultMessages from "./translations/default"
import componentMessages from "./components/translations/default"
import { STYLES } from "../shared/css"
import type {
  FmeExportConfig,
  EsriModules,
  ExportResult,
  IMStateWithFmeExport,
  FmeWidgetState,
  NotificationState,
  ErrorState,
  WorkspaceParameter,
  WorkspaceItemDetail,
} from "../shared/types"
import {
  DrawingTool,
  ViewMode,
  ErrorType,
  LAYER_CONFIG,
  VIEW_ROUTES,
} from "../shared/types"
import { ErrorHandlingService } from "../shared/services"
import { fmeActions, initialFmeState } from "../extensions/store"

const MODULE_NAMES: readonly string[] = [
  "esri/widgets/Sketch/SketchViewModel",
  "esri/layers/GraphicsLayer",
  "esri/Graphic",
  "esri/geometry/Polygon",
  "esri/geometry/Extent",
  "esri/widgets/AreaMeasurement2D",
  "esri/widgets/DistanceMeasurement2D",
  "esri/geometry/geometryEngine",
] as const

const FALLBACK_EMAIL = "no-reply@example.com"

// Area formatting thresholds
const AREA_THRESHOLD_SQKM = 1_000_000 // m² -> 1 km²
const AREA_CONVERSION_FACTOR = 1_000_000
const AREA_DECIMAL_PLACES = 2
const COINCIDENT_EPSILON = 0.001

// Load ArcGIS modules once and memoize result
const useArcGISModules = (): {
  modules: EsriModules | null
  loading: boolean
} => {
  const [modules, setModules] = React.useState<EsriModules | null>(null)
  const [loading, setLoading] = React.useState(true)

  hooks.useEffectOnce(() => {
    loadArcGISJSAPIModules(MODULE_NAMES as any)
      .then((loaded) => {
        const [
          SketchViewModel,
          GraphicsLayer,
          Graphic,
          Polygon,
          Extent,
          AreaMeasurement2D,
          DistanceMeasurement2D,
          geometryEngine,
        ] = loaded
        setModules({
          SketchViewModel,
          GraphicsLayer,
          Graphic,
          Polygon,
          Extent,
          AreaMeasurement2D,
          DistanceMeasurement2D,
          geometryEngine,
        } as unknown as EsriModules)
      })
      .catch((error) => {
        console.error(
          "FME Export Widget - Failed to load ArcGIS modules",
          error
        )
      })
      .finally(() => {
        setLoading(false)
      })
  })
  return { modules, loading }
}

// Custom hook to manage local map state
const useLocalMapState = () => {
  const [jimuMapView, setJimuMapView] = React.useState<JimuMapView | null>(null)
  const [sketchViewModel, setSketchViewModel] =
    React.useState<__esri.SketchViewModel | null>(null)
  const [graphicsLayer, setGraphicsLayer] =
    React.useState<__esri.GraphicsLayer | null>(null)
  const [measurementGraphicsLayer, setMeasurementGraphicsLayer] =
    React.useState<__esri.GraphicsLayer | null>(null)
  const [areaMeasurement2D, setAreaMeasurement2D] =
    React.useState<__esri.AreaMeasurement2D | null>(null)
  const [distanceMeasurement2D, setDistanceMeasurement2D] =
    React.useState<__esri.DistanceMeasurement2D | null>(null)
  const [currentGeometry, setCurrentGeometry] =
    React.useState<__esri.Geometry | null>(null)

  return {
    jimuMapView,
    setJimuMapView,
    sketchViewModel,
    setSketchViewModel,
    graphicsLayer,
    setGraphicsLayer,
    measurementGraphicsLayer,
    setMeasurementGraphicsLayer,
    areaMeasurement2D,
    setAreaMeasurement2D,
    distanceMeasurement2D,
    setDistanceMeasurement2D,
    currentGeometry,
    setCurrentGeometry,
  }
}

// Error service
const errorService = new ErrorHandlingService()

// Dispatch error action with message and type
const dispatchError = (
  dispatchFn: (action: unknown) => void,
  message: string,
  type: ErrorType,
  code?: string
) => {
  dispatchFn(
    fmeActions.setError(
      errorService.createError(message, type, code ? { code } : undefined)
    )
  )
}

// Abort any existing submission
const abortIfPresent = (
  ref: React.MutableRefObject<AbortController | null>
) => {
  if (ref.current) {
    try {
      ref.current.abort()
    } catch {
      // noop
    }
  }
}

// Calculate polygon area with fallback strategies
const calculatePolygonArea = (
  geometry: __esri.Geometry,
  modules: EsriModules
): number => {
  if (geometry.type !== "polygon" || !modules.geometryEngine) return 0

  const geometryEngine = modules.geometryEngine as any
  const polygon = geometry as __esri.Polygon

  const tryCalculation = (method: string): number | undefined => {
    try {
      const value = geometryEngine?.[method]?.(polygon, "square-meters")
      return isFinite(value) && value > 0 ? Math.abs(value) : undefined
    } catch {
      return undefined
    }
  }

  return tryCalculation("geodesicArea") ?? tryCalculation("planarArea") ?? 0
}

// Validate polygon geometry with early returns
const validatePolygonGeometry = (
  geometry: __esri.Geometry | undefined,
  modules: EsriModules
): { valid: boolean; error?: ErrorState } => {
  if (!geometry) {
    return {
      valid: false,
      error: errorService.createError("geometryMissing", ErrorType.GEOMETRY, {
        code: "GEOM_MISSING",
      }),
    }
  }

  if (geometry.type !== "polygon") {
    return {
      valid: false,
      error: errorService.createError(
        "geometryTypeInvalid",
        ErrorType.GEOMETRY,
        { code: "GEOM_TYPE_INVALID" }
      ),
    }
  }

  const polygon = geometry as __esri.Polygon
  if (!polygon.rings?.length) {
    return {
      valid: false,
      error: errorService.createError("polygonNoRings", ErrorType.GEOMETRY, {
        code: "GEOM_NO_RINGS",
      }),
    }
  }

  const ring = polygon.rings[0]
  const uniquePoints = new Set(ring.map((p) => `${p[0]}:${p[1]}`))
  if (uniquePoints.size < 3) {
    return {
      valid: false,
      error: errorService.createError(
        "polygonMinVertices",
        ErrorType.GEOMETRY,
        { code: "GEOM_MIN_VERTICES" }
      ),
    }
  }

  // Check for self-intersection if possible
  try {
    const geometryEngine = modules.geometryEngine as any
    if (geometryEngine?.simplify) {
      const simplified = geometryEngine.simplify(polygon)
      if (!simplified) {
        return {
          valid: false,
          error: errorService.createError(
            "polygonSelfIntersect",
            ErrorType.GEOMETRY,
            { code: "GEOM_SELF_INTERSECT" }
          ),
        }
      }
    }
  } catch {
    // Silently continue if simplify fails
  }

  return { valid: true }
}

// Validate area constraints
const enforceMaxArea = (
  area: number,
  maxArea?: number
): { ok: boolean; message?: string; code?: string } => {
  if (!maxArea || area <= maxArea) {
    return { ok: true }
  }

  return {
    ok: false,
    message: "areaTooLarge",
    code: "AREA_TOO_LARGE",
  }
}

// Build the base submission parameters object
const buildBaseFmeParams = (
  formData: unknown,
  userEmail: string
): { [key: string]: unknown } => {
  const data = (formData as { data?: { [key: string]: unknown } })?.data || {}
  return {
    ...data,
    opt_requesteremail: userEmail,
    opt_servicemode: "async",
    opt_responseformat: "json",
    opt_showresult: "true",
  }
}

// Attach polygon AOI if present
const attachAreaOfInterest = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): { [key: string]: unknown } => {
  const geometryToUse = geometryJson || currentGeometry?.toJSON()
  if (geometryToUse && (geometryToUse as { rings?: unknown }).rings) {
    return { ...base, AreaOfInterest: JSON.stringify(geometryToUse) }
  }
  return base
}

// Get user email with fallback
const getUserEmail = async (): Promise<string> => {
  try {
    const [Portal] = await loadArcGISJSAPIModules(["esri/portal/Portal"])
    const portal = new Portal()
    await portal.load()
    return portal.user?.email || FALLBACK_EMAIL
  } catch (error) {
    console.warn("FME Export Widget - Failed to get user email", error)
    return FALLBACK_EMAIL
  }
}

// Prepare FME parameters for submission
const prepareFmeParameters = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): { [key: string]: unknown } => {
  const base = buildBaseFmeParams(formData, userEmail)
  return attachAreaOfInterest(base, geometryJson, currentGeometry)
}

// Initialize graphics layers for drawing and measurements
const createGraphicsLayers = (
  jmv: JimuMapView,
  modules: EsriModules,
  setGraphicsLayer: (layer: __esri.GraphicsLayer) => void,
  setMeasurementGraphicsLayer: (layer: __esri.GraphicsLayer) => void
) => {
  // Main sketch layer
  const layer = new modules.GraphicsLayer(LAYER_CONFIG)
  jmv.view.map.add(layer)
  setGraphicsLayer(layer)

  // Measurement layer
  const measurementLayer = new modules.GraphicsLayer({
    id: "measurement-labels-layer",
    title: "Measurement Labels",
  })
  jmv.view.map.add(measurementLayer)
  setMeasurementGraphicsLayer(measurementLayer)

  return layer
}

// Initialize measurement widgets for 2D views
const createMeasurementWidgets = (
  jmv: JimuMapView,
  modules: EsriModules,
  setAreaMeasurement2D: (widget: __esri.AreaMeasurement2D) => void,
  setDistanceMeasurement2D: (widget: __esri.DistanceMeasurement2D) => void
) => {
  if (jmv.view.type !== "2d") return

  if (modules.AreaMeasurement2D) {
    const areaMeasurement2D = new modules.AreaMeasurement2D({
      view: jmv.view,
      unit: "metric",
      visible: false,
    })
    setAreaMeasurement2D(areaMeasurement2D)
  }

  if (modules.DistanceMeasurement2D) {
    const distanceMeasurement2D = new modules.DistanceMeasurement2D({
      view: jmv.view,
      unit: "metric",
      visible: false,
    })
    setDistanceMeasurement2D(distanceMeasurement2D)
  }
}

// Create sketch VM
const createSketchViewModel = (
  jmv: JimuMapView,
  modules: EsriModules,
  layer: __esri.GraphicsLayer,
  handleDrawingComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void
) => {
  const sketchViewModel = new modules.SketchViewModel({
    view: jmv.view,
    layer,
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
  })

  configureSketchSymbols(sketchViewModel)
  setupSketchEventHandlers(sketchViewModel, handleDrawingComplete, dispatch)

  return sketchViewModel
}

// Configure sketch view model symbols
const configureSketchSymbols = (sketchViewModel: __esri.SketchViewModel) => {
  sketchViewModel.polygonSymbol = STYLES.symbols.highlight as any

  sketchViewModel.polylineSymbol = {
    type: "simple-line",
    color: STYLES.colors.orangeOutline,
    width: 2,
    style: "solid",
  }

  sketchViewModel.pointSymbol = {
    type: "simple-marker",
    style: "circle",
    size: 8,
    color: STYLES.colors.orangeOutline,
    outline: {
      color: STYLES.colors.white,
      width: 1,
    },
  }
}

// Handle sketch create events and track drawing progress
const setupSketchEventHandlers = (
  sketchViewModel: __esri.SketchViewModel,
  handleDrawingComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void
) => {
  let clickCount = 0

  const resetClickTracking = () => {
    clickCount = 0
    dispatch(fmeActions.setDrawingState(false, 0, undefined))
  }

  const updateClickCount = (newCount: number) => {
    if (newCount > clickCount) {
      clickCount = newCount
      dispatch(fmeActions.setClickCount(clickCount))
    }
  }

  const calculatePolygonClicks = (geometry: __esri.Polygon): number => {
    const vertices = geometry.rings?.[0]
    if (!vertices || vertices.length < 2) return 0

    const vertexCount = vertices.length
    const firstPoint = vertices[0]
    const lastPoint = vertices[vertexCount - 1]

    // Check if polygon is auto-closed
    const isAutoClosed =
      Array.isArray(firstPoint) &&
      Array.isArray(lastPoint) &&
      Math.abs(firstPoint[0] - lastPoint[0]) < COINCIDENT_EPSILON &&
      Math.abs(firstPoint[1] - lastPoint[1]) < COINCIDENT_EPSILON

    return isAutoClosed ? vertexCount - 1 : vertexCount
  }

  sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
    switch (evt.state) {
      case "start":
        clickCount = 0
        dispatch(fmeActions.setDrawingState(true, 0, undefined))
        break

      case "active":
        if (evt.tool === "polygon" && evt.graphic?.geometry) {
          const geometry = evt.graphic.geometry as __esri.Polygon
          const actualClicks = calculatePolygonClicks(geometry)
          updateClickCount(actualClicks)
        } else if (evt.tool === "rectangle" && clickCount !== 1) {
          updateClickCount(1)
        }
        break

      case "complete":
        resetClickTracking()
        handleDrawingComplete(evt)
        break

      case "cancel":
        resetClickTracking()
        break
    }
  })
}

// Hide measurement widgets
const hideMeasurementWidgets = (
  areaMeasurement2D: __esri.AreaMeasurement2D | null,
  distanceMeasurement2D: __esri.DistanceMeasurement2D | null
) => {
  if (areaMeasurement2D) {
    try {
      areaMeasurement2D.visible = false
      areaMeasurement2D.viewModel.clear()
    } catch (error) {
      console.warn("Failed to hide area measurement widget:", error)
    }
  }

  if (distanceMeasurement2D) {
    try {
      distanceMeasurement2D.visible = false
      distanceMeasurement2D.viewModel.clear()
    } catch (error) {
      console.warn("Failed to hide distance measurement widget:", error)
    }
  }
}

// Process FME response
const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string
): ExportResult => {
  const response = fmeResponse as {
    data?: { serviceResponse?: any; status?: string }
  }
  const data = response?.data
  if (!data) {
    return {
      success: false,
      message: "Unexpected response from FME server",
      code: "INVALID_RESPONSE",
    }
  }
  const serviceInfo = data.serviceResponse || data
  const status = serviceInfo?.statusInfo?.status || serviceInfo?.status
  const jobId = serviceInfo?.jobID || serviceInfo?.id || Date.now()
  if (status === "success") {
    return {
      success: true,
      message: "Export order submitted successfully",
      jobId,
      workspaceName: workspace,
      email: userEmail,
      downloadUrl: serviceInfo?.url,
    }
  }
  return {
    success: false,
    message:
      serviceInfo?.statusInfo?.message ||
      serviceInfo?.message ||
      "FME job submission failed",
    code: "FME_JOB_FAILURE",
  }
}

// Number formatting for Swedish locale
const NF_SV_NO_DECIMALS = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
const NF_SV_AREA_KM = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: AREA_DECIMAL_PLACES,
})

// Format area (metric; returns localized string)
export function formatArea(area: number): string {
  if (!area || isNaN(area) || area <= 0) return "0 m²"
  if (area >= AREA_THRESHOLD_SQKM) {
    const areaInSqKm = area / AREA_CONVERSION_FACTOR
    const formattedKm = NF_SV_AREA_KM.format(areaInSqKm)
    return `${formattedKm} km²`
  }
  const formatted = NF_SV_NO_DECIMALS.format(Math.round(area))
  return `${formatted} m²`
}

export default function Widget(
  props: AllWidgetProps<FmeExportConfig> & { state: FmeWidgetState }
): React.ReactElement {
  const { id: widgetId, useMapWidgetIds, dispatch, state: reduxState } = props
  const translateWidget = hooks.useTranslation(defaultMessages)
  const translateComponent = hooks.useTranslation(componentMessages)
  // Translation function
  const translate = hooks.useEventCallback((key: string): string => {
    const w = translateWidget(key)
    if (w && w !== key) return w
    const c = translateComponent(key)
    return c !== key ? c : key
  })

  // Notification state
  const [notification, setNotification] =
    React.useState<NotificationState | null>(null)

  const { modules, loading: modulesLoading } = useArcGISModules()
  const localMapState = useLocalMapState()
  // Abort controller
  const submissionAbortRef = React.useRef<AbortController | null>(null)

  // Destructure local map state
  const {
    jimuMapView,
    setJimuMapView,
    sketchViewModel,
    setSketchViewModel,
    graphicsLayer,
    setGraphicsLayer,
    measurementGraphicsLayer,
    setMeasurementGraphicsLayer,
    areaMeasurement2D,
    setAreaMeasurement2D,
    distanceMeasurement2D,
    setDistanceMeasurement2D,
    currentGeometry,
    setCurrentGeometry,
  } = localMapState

  // Clear graphics
  const clearAllGraphics = hooks.useEventCallback(() => {
    graphicsLayer?.removeAll()
    measurementGraphicsLayer?.removeAll()
  })

  // Reset/hide measurement UI and clear layers
  const resetGraphicsAndMeasurements = hooks.useEventCallback(() => {
    clearAllGraphics()
    hideMeasurementWidgets(areaMeasurement2D, distanceMeasurement2D)
  })

  // Drawing complete
  const handleDrawingComplete = hooks.useEventCallback(
    (evt: __esri.SketchCreateEvent) => {
      const geometry = evt.graphic?.geometry
      if (!geometry) return

      try {
        // Validate
        const validation = validatePolygonGeometry(geometry, modules)
        if (!validation.valid) {
          if (validation.error) {
            dispatch(fmeActions.setError(validation.error))
          }
          return
        }

        // Set symbol
        if (evt.graphic && modules) {
          evt.graphic.symbol = STYLES.symbols.highlight as any
        }

        const calculatedArea = calculatePolygonArea(geometry, modules)

        // Max area
        const maxCheck = enforceMaxArea(calculatedArea, props.config?.maxArea)
        if (!maxCheck.ok) {
          if (maxCheck.message) {
            dispatchError(
              dispatch,
              maxCheck.message,
              ErrorType.VALIDATION,
              maxCheck.code
            )
          }
          return
        }

        dispatch(fmeActions.setGeometry(geometry, Math.abs(calculatedArea)))
        dispatch(fmeActions.setDrawingState(false, 0, undefined))

        // Store current geometry in local state (not Redux - following golden rule)
        setCurrentGeometry(geometry)

        dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
      } catch (error) {
        dispatchError(
          dispatch,
          "Failed to complete drawing",
          ErrorType.VALIDATION,
          "DRAWING_COMPLETE_ERROR"
        )
      }
    }
  )

  // Form submission guard clauses
  const validateSubmissionRequirements = (): boolean => {
    const hasGeometry = !!reduxState.geometryJson || !!currentGeometry
    if (!hasGeometry || !reduxState.selectedWorkspace) {
      return false
    }

    // Re-validate area constraints before submission
    const maxCheck = enforceMaxArea(reduxState.drawnArea, props.config?.maxArea)
    if (!maxCheck.ok && maxCheck.message) {
      setNotification({ severity: "error", message: maxCheck.message })
      dispatchError(
        dispatch,
        maxCheck.message,
        ErrorType.VALIDATION,
        maxCheck.code
      )
      return false
    }

    return true
  }

  // Handle successful submission
  const finalizeOrder = hooks.useEventCallback((result: ExportResult) => {
    setNotification({
      severity: result.success ? "success" : "error",
      message: result.success
        ? translate("orderSubmitted") ||
          `Export order submitted successfully. Job ID: ${result.jobId}`
        : translate("orderFailed") || `Export failed: ${result.message}`,
    })
    dispatch(fmeActions.setOrderResult(result))
    dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT))
  })

  const handleSubmissionSuccess = (
    fmeResponse: unknown,
    workspace: string,
    userEmail: string
  ) => {
    const result = processFmeResponse(fmeResponse, workspace, userEmail)
    finalizeOrder(result)
  }

  // Handle submission error
  const handleSubmissionError = (error: unknown) => {
    const errorMessage = (error as Error).message || "Unknown error occurred"
    const result: ExportResult = {
      success: false,
      message: `Failed to submit export order: ${errorMessage}`,
      code: (error as { code?: string }).code || "SUBMISSION_ERROR",
    }
    finalizeOrder(result)
  }

  // Form submission handler with FME export
  const handleFormSubmit = hooks.useEventCallback(async (formData: unknown) => {
    if (!validateSubmissionRequirements()) {
      return
    }

    dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: true }))

    try {
      const userEmail = await getUserEmail()
      const fmeClient = createFmeFlowClient(props.config)
      const workspace = reduxState.selectedWorkspace
      const fmeParameters = prepareFmeParameters(
        formData,
        userEmail,
        reduxState.geometryJson,
        currentGeometry
      )

      // Abort any existing submission
      abortIfPresent(submissionAbortRef)
      submissionAbortRef.current = new AbortController()

      const fmeResponse = await fmeClient.runDataDownload(
        workspace,
        fmeParameters,
        undefined,
        submissionAbortRef.current.signal
      )

      handleSubmissionSuccess(fmeResponse, workspace, userEmail)
    } catch (error) {
      handleSubmissionError(error)
    } finally {
      dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: false }))
    }
  })

  // Map view ready handler
  const handleMapViewReady = hooks.useEventCallback((jmv: JimuMapView) => {
    if (!modules) {
      setJimuMapView(jmv)
      return
    }
    try {
      setJimuMapView(jmv)
      const layer = createGraphicsLayers(
        jmv,
        modules,
        setGraphicsLayer,
        setMeasurementGraphicsLayer
      )
      createMeasurementWidgets(
        jmv,
        modules,
        setAreaMeasurement2D,
        setDistanceMeasurement2D
      )
      const svm = createSketchViewModel(
        jmv,
        modules,
        layer,
        handleDrawingComplete,
        dispatch
      )
      setSketchViewModel(svm)
    } catch (error) {
      dispatchError(
        dispatch,
        "Failed to initialize map",
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

  // Cleanup
  hooks.useEffectOnce(() => {
    return () => {
      // Widget cleanup handled by Experience Builder
      abortIfPresent(submissionAbortRef)
    }
  })

  // Instruction text
  const getDynamicInstructionText = hooks.useEventCallback(
    (tool: DrawingTool, isDrawing: boolean, clickCount: number) => {
      if (tool === DrawingTool.RECTANGLE)
        return translate("rectangleDrawingInstructions")

      // Polygon dynamic
      if (tool === DrawingTool.POLYGON) {
        if (!isDrawing || clickCount === 0)
          return translate("polygonDrawingStart")
        if (clickCount < 3) return translate("polygonDrawingContinue")
        return translate("polygonDrawingComplete")
      }

      return translate("drawInstruction")
    }
  )

  // Start drawing
  const handleStartDrawing = hooks.useEventCallback((tool: DrawingTool) => {
    if (!sketchViewModel) return

    // Set tool
    dispatch(fmeActions.setDrawingState(true, 0, tool))
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING))

    // Clear and hide
    resetGraphicsAndMeasurements()

    // Begin create
    if (tool === DrawingTool.RECTANGLE) {
      sketchViewModel.create("rectangle")
    } else {
      sketchViewModel.create("polygon")
    }
  })

  // Reset
  const handleReset = hooks.useEventCallback(() => {
    resetGraphicsAndMeasurements()

    if (sketchViewModel) sketchViewModel.cancel()

    dispatch(fmeActions.resetState())
  })

  // Workspace handlers
  const handleWorkspaceSelected = hooks.useEventCallback(
    (
      workspaceName: string,
      parameters: readonly WorkspaceParameter[],
      workspaceItem: WorkspaceItemDetail
    ) => {
      dispatch(fmeActions.setSelectedWorkspace(workspaceName))
      dispatch(fmeActions.setWorkspaceParameters(parameters, workspaceName))
      dispatch(fmeActions.setWorkspaceItem(workspaceItem))
      dispatch(fmeActions.setViewMode(ViewMode.EXPORT_FORM))
    }
  )

  const handleWorkspaceBack = hooks.useEventCallback(() => {
    dispatch(fmeActions.setViewMode(ViewMode.INITIAL))
  })

  const handleGoBack = hooks.useEventCallback(() => {
    const { viewMode, previousViewMode } = reduxState
    const fallback = VIEW_ROUTES[viewMode] || ViewMode.INITIAL
    const target =
      previousViewMode && previousViewMode !== viewMode
        ? previousViewMode
        : fallback
    dispatch(fmeActions.setViewMode(target))
  })

  // Loading state
  if (modulesLoading || !modules) {
    const loadingMessage = modules
      ? translate("preparingMapTools")
      : translate("loadingMapServices")
    return <StateView state={{ kind: "loading", message: loadingMessage }} />
  }

  // Error state
  if (reduxState.error && reduxState.error.severity === "error") {
    return (
      <StateView
        state={{
          kind: "error",
          message:
            translate(reduxState.error.message) || reduxState.error.message,
          code: reduxState.error.code,
          actions: [
            {
              label: translate("retry"),
              onClick: () => {
                if (reduxState.error?.retry) {
                  reduxState.error.retry()
                } else {
                  dispatch(fmeActions.setError(null))
                }
              },
              variant: "primary",
            },
          ],
        }}
      />
    )
  }

  return (
    <>
      {useMapWidgetIds && useMapWidgetIds.length === 1 && (
        <JimuMapViewComponent
          useMapWidgetId={useMapWidgetIds[0]}
          onActiveViewChange={handleMapViewReady}
        />
      )}

      <Content
        widgetId={widgetId}
        config={props.config}
        state={reduxState.viewMode}
        error={reduxState.error}
        instructionText={getDynamicInstructionText(
          reduxState.drawingTool,
          reduxState.isDrawing,
          reduxState.clickCount
        )}
        onAngeUtbredning={() => handleStartDrawing(reduxState.drawingTool)}
        isModulesLoading={modulesLoading}
        canStartDrawing={!!sketchViewModel}
        onFormBack={() =>
          dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
        }
        onFormSubmit={handleFormSubmit}
        orderResult={reduxState.orderResult}
        onReuseGeography={() =>
          dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
        }
        isSubmittingOrder={reduxState.isSubmittingOrder}
        onBack={handleGoBack}
        drawnArea={reduxState.drawnArea}
        formatArea={formatArea}
        drawingMode={reduxState.drawingTool}
        onDrawingModeChange={(tool) =>
          dispatch(fmeActions.setDrawingTool(tool))
        }
        // Header props
        showHeaderActions={
          (reduxState.isDrawing || reduxState.drawnArea > 0) &&
          !reduxState.isSubmittingOrder &&
          !modulesLoading
        }
        onReset={handleReset}
        canReset={true}
        onWorkspaceSelected={handleWorkspaceSelected}
        onWorkspaceBack={handleWorkspaceBack}
        selectedWorkspace={reduxState.selectedWorkspace}
        workspaceParameters={reduxState.workspaceParameters}
        workspaceItem={reduxState.workspaceItem}
      />
      {notification && (
        <Message
          severity={notification.severity}
          open={true}
          message={notification.message}
          autoHideDuration={4000}
          onClose={() => {
            setNotification(null)
          }}
          withIcon
          role={notification.severity === "error" ? "alert" : "status"}
          aria-live={notification.severity === "error" ? "assertive" : "polite"}
        />
      )}
    </>
  )
}

// Map extra state props for the widget
;(Widget as unknown as { mapExtraStateProps: unknown }).mapExtraStateProps = (
  state: IMStateWithFmeExport
) => {
  const widgetState = state["fme-state"] as ImmutableObject<FmeWidgetState>
  return { state: widgetState || initialFmeState }
}
