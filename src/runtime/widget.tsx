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

// Load ArcGIS modules once and memoize result
const useArcGISModules = () => {
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

// Calculate polygon area
const calculatePolygonArea = (
  geometry: __esri.Geometry,
  modules: EsriModules
): number => {
  if (geometry.type !== "polygon" || !modules.geometryEngine) return 0
  const ge = modules.geometryEngine as any
  const poly = geometry as __esri.Polygon
  const tryCalc = (fn: string) => {
    try {
      const v = ge?.[fn]?.(poly, "square-meters")
      if (isFinite(v) && v > 0) return Math.abs(v)
    } catch {
      /* ignore */
    }
    return undefined
  }
  return tryCalc("geodesicArea") ?? tryCalc("planarArea") ?? 0
}

// Validate polygon
const validatePolygonGeometry = (
  geometry: __esri.Geometry | undefined,
  modules: EsriModules
): { valid: boolean; error?: ErrorState } => {
  if (!geometry)
    return {
      valid: false,
      error: errorService.createError("geometryMissing", ErrorType.GEOMETRY, {
        code: "GEOM_MISSING",
      }),
    }
  if (geometry.type !== "polygon")
    return {
      valid: false,
      error: errorService.createError(
        "geometryTypeInvalid",
        ErrorType.GEOMETRY,
        { code: "GEOM_TYPE_INVALID" }
      ),
    }
  const poly = geometry as __esri.Polygon
  if (!poly.rings?.length)
    return {
      valid: false,
      error: errorService.createError("polygonNoRings", ErrorType.GEOMETRY, {
        code: "GEOM_NO_RINGS",
      }),
    }
  const ring = poly.rings[0]
  const uniquePoints = new Set(ring.map((p) => `${p[0]}:${p[1]}`))
  if (uniquePoints.size < 3)
    return {
      valid: false,
      error: errorService.createError(
        "polygonMinVertices",
        ErrorType.GEOMETRY,
        { code: "GEOM_MIN_VERTICES" }
      ),
    }
  try {
    if ((modules.geometryEngine as any)?.simplify) {
      const simplified = (modules.geometryEngine as any).simplify(poly)
      if (!simplified)
        return {
          valid: false,
          error: errorService.createError(
            "polygonSelfIntersect",
            ErrorType.GEOMETRY,
            { code: "GEOM_SELF_INTERSECT" }
          ),
        }
    }
  } catch (_) {}
  return { valid: true }
}

const enforceMaxArea = (
  area: number,
  maxArea?: number,
  formatFn?: (a: number) => string
): { ok: boolean; message?: string; code?: string } => {
  if (!maxArea || area <= maxArea) return { ok: true }
  return {
    ok: false,
    // Use provided format function if available
    message: "areaTooLarge",
    code: "AREA_TOO_LARGE",
  }
}

// Get user email
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

// Build FME params
const prepareFmeParameters = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): { [key: string]: unknown } => {
  const data = (formData as { data?: { [key: string]: unknown } })?.data || {}

  const baseParams: { [key: string]: unknown } = {
    ...data,
    opt_requesteremail: userEmail,
    opt_servicemode: "async",
    opt_responseformat: "json",
    opt_showresult: "true",
  }

  // Add geometry if present
  const geometryToUse = geometryJson || currentGeometry?.toJSON()
  if (geometryToUse && (geometryToUse as { rings?: unknown }).rings) {
    baseParams.AreaOfInterest = JSON.stringify(geometryToUse)
  }

  return baseParams
}

// Create graphics layers
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

  return layer // Main layer
}

// Create measurement widgets
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

  // Symbols
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

  // Track clicks
  let clickCount = 0

  sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
    if (evt.state === "start") {
      clickCount = 0
      dispatch(fmeActions.setDrawingState(true, 0, undefined))
    } else if (
      evt.state === "active" &&
      evt.tool === "polygon" &&
      evt.graphic?.geometry
    ) {
      const geometry = evt.graphic.geometry as __esri.Polygon
      if (geometry?.rings?.[0]?.length >= 2) {
        const vertices = geometry.rings[0]
        const vertexCount = vertices.length

        // Auto-close check
        const firstPoint = vertices[0]
        const lastPoint = vertices[vertexCount - 1]
        const isAutoClosed =
          Array.isArray(firstPoint) &&
          Array.isArray(lastPoint) &&
          Math.abs(firstPoint[0] - lastPoint[0]) < 0.001 &&
          Math.abs(firstPoint[1] - lastPoint[1]) < 0.001

        // Actual click count
        const actualClicks = isAutoClosed ? vertexCount - 1 : vertexCount

        // Update if increased
        if (actualClicks > clickCount) {
          clickCount = actualClicks
          dispatch(fmeActions.setClickCount(clickCount))
        }
      }
    } else if (evt.tool === "rectangle" && clickCount !== 1) {
      clickCount = 1
      dispatch(fmeActions.setClickCount(1))
    } else if (evt.state === "complete") {
      clickCount = 0
      dispatch(fmeActions.setDrawingState(false, 0, undefined))
      handleDrawingComplete(evt)
    } else if (evt.state === "cancel") {
      clickCount = 0
      dispatch(fmeActions.setDrawingState(false, 0, undefined))
    }
  })

  return sketchViewModel
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

// Format area (metric; returns localized string)
export function formatArea(area: number): string {
  if (!area || isNaN(area) || area <= 0) return "0 m²"
  if (area >= AREA_THRESHOLD_SQKM) {
    const areaInSqKm = area / AREA_CONVERSION_FACTOR
    const formattedKm = new Intl.NumberFormat("sv-SE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: AREA_DECIMAL_PLACES,
    }).format(areaInSqKm)
    return `${formattedKm} km²`
  }
  const formatted = new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(area))
  return `${formatted} m²`
}

export default function Widget(
  props: AllWidgetProps<FmeExportConfig> & { state: FmeWidgetState }
): React.ReactElement {
  const { id: widgetId, useMapWidgetIds, dispatch, state: reduxState } = props
  const translateWidget = hooks.useTranslation(defaultMessages)
  const translateComponent = hooks.useTranslation(componentMessages)
  // Translation function
  const translate = React.useCallback(
    (key: string): string => {
      const w = translateWidget(key)
      if (w && w !== key) return w
      const c = translateComponent(key)
      return c !== key ? c : key
    },
    [translateWidget, translateComponent]
  )

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
        const maxCheck = enforceMaxArea(
          calculatedArea,
          props.config?.maxArea,
          formatArea
        )
        if (!maxCheck.ok) {
          if (maxCheck.message) {
            dispatch(
              fmeActions.setError(
                errorService.createError(
                  maxCheck.message,
                  ErrorType.VALIDATION,
                  { code: maxCheck.code }
                )
              )
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
        dispatch(
          fmeActions.setError(
            errorService.createError(
              "Failed to complete drawing",
              ErrorType.VALIDATION,
              { code: "DRAWING_COMPLETE_ERROR" }
            )
          )
        )
      }
    }
  )

  // Form submission handler with FME export
  const handleFormSubmit = hooks.useEventCallback(async (formData: unknown) => {
    const hasGeometry = !!reduxState.geometryJson || !!currentGeometry
    if (!hasGeometry || !reduxState.selectedWorkspace) {
      return
    }

    // Re-validate area against maxArea before submission (guard against config changes or stale state)
    const maxCheck = enforceMaxArea(
      reduxState.drawnArea,
      props.config?.maxArea,
      formatArea
    )
    if (!maxCheck.ok) {
      if (maxCheck.message) {
        setNotification({ severity: "error", message: maxCheck.message })
        dispatch(
          fmeActions.setError(
            errorService.createError(maxCheck.message, ErrorType.VALIDATION, {
              code: maxCheck.code,
            })
          )
        )
      }
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

      // Abort inflight
      if (submissionAbortRef.current) {
        submissionAbortRef.current.abort()
      }
      submissionAbortRef.current = new AbortController()

      const fmeResponse = await fmeClient.runDataDownload(
        workspace,
        fmeParameters,
        undefined,
        submissionAbortRef.current.signal
      )
      const result = processFmeResponse(fmeResponse, workspace, userEmail)

      // Set notification based on result
      setNotification({
        severity: result.success ? "success" : "error",
        message: result.success
          ? translate("orderSubmitted") ||
            `Export order submitted successfully. Job ID: ${result.jobId}`
          : translate("orderFailed") || `Export failed: ${result.message}`,
      })

      dispatch(fmeActions.setOrderResult(result))
      dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT))
    } catch (error) {
      const errorMessage = (error as Error).message || "Unknown error occurred"
      const result: ExportResult = {
        success: false,
        message: `Failed to submit export order: ${errorMessage}`,
        code: (error as { code?: string }).code || "SUBMISSION_ERROR",
      }

      setNotification({
        severity: "error",
        message: translate("orderFailed") || `Export failed: ${errorMessage}`,
      })
      dispatch(fmeActions.setOrderResult(result))
      dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT))
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
      dispatch(
        fmeActions.setError(
          errorService.createError(
            "Failed to initialize map",
            ErrorType.MODULE,
            {
              code: "MAP_INIT_ERROR",
            }
          )
        )
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
      if (submissionAbortRef.current) {
        submissionAbortRef.current.abort()
      }
    }
  })

  // Instruction text
  const getDynamicInstructionText = hooks.useEventCallback(
    (tool: DrawingTool, isDrawing: boolean, clickCount: number) => {
      // Rectangle static
      if (tool === DrawingTool.RECTANGLE) {
        return translate("rectangleDrawingInstructions")
      }

      // Polygon dynamic
      if (tool === DrawingTool.POLYGON) {
        if (!isDrawing || clickCount === 0) {
          // Start
          return translate("polygonDrawingStart")
        } else if (clickCount === 1) {
          // First vertex
          return translate("polygonDrawingContinue")
        } else if (clickCount === 2) {
          // Second vertex
          return translate("polygonDrawingContinue")
        } else if (clickCount >= 3) {
          // Third or more
          return translate("polygonDrawingComplete")
        }
      }

      // Fallback
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
    clearAllGraphics()
    hideMeasurementWidgets(areaMeasurement2D, distanceMeasurement2D)

    // Begin create
    if (tool === DrawingTool.RECTANGLE) {
      sketchViewModel.create("rectangle")
    } else {
      sketchViewModel.create("polygon")
    }
  })

  // Reset
  const handleReset = hooks.useEventCallback(() => {
    clearAllGraphics()

    if (sketchViewModel) sketchViewModel.cancel()

    // Hide widgets
    hideMeasurementWidgets(areaMeasurement2D, distanceMeasurement2D)

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
