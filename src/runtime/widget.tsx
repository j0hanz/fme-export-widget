/** @jsx jsx */
/** @jsxFrag React.Fragment */
import {
  React,
  type AllWidgetProps,
  hooks,
  jsx,
  type ImmutableObject,
} from "jimu-core"
import {
  JimuMapViewComponent,
  type JimuMapView,
  loadArcGISJSAPIModules,
} from "jimu-arcgis"
import { Workflow } from "./components/workflow"
import { StateView, Button, UI_CLS } from "./components/ui"
import { createFmeFlowClient } from "../shared/api"
import defaultMessages from "./translations/default"
import componentMessages from "./components/translations/default"
import type {
  FmeExportConfig,
  EsriModules,
  ExportResult,
  IMStateWithFmeExport,
  FmeWidgetState,
  ErrorState,
  WorkspaceParameter,
  WorkspaceItemDetail,
  FmeResponse,
  FmeServiceInfo,
} from "../shared/types"
import {
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  LAYER_CONFIG,
  VIEW_ROUTES,
} from "../shared/types"
import { ErrorHandlingService } from "../shared/services"
import { fmeActions, initialFmeState } from "../extensions/store"

// Widget-specific styles
const CSS = {
  colors: {
    white: [255, 255, 255, 1] as [number, number, number, number],
    orangeOutline: [255, 140, 0] as [number, number, number],
  },
  symbols: {
    highlight: {
      type: "simple-fill" as const,
      color: [255, 165, 0, 0.2] as [number, number, number, number],
      outline: {
        color: [255, 140, 0] as [number, number, number],
        width: 2,
        style: "solid" as const,
      },
    },
  },
}

const MODULES: readonly string[] = [
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
const M2_PER_KM2 = 1_000_000 // m² -> 1 km²
const AREA_DECIMALS = 2
const COINCIDENT_EPSILON = 0.001

// Area calculation constants
const AREA_UNIT = "square-meters"
const MIN_VALID_AREA = 0.001 // m²

// Load ArcGIS modules once and memoize result
const useModules = (): {
  modules: EsriModules | null
  loading: boolean
} => {
  const [modules, setModules] = React.useState<EsriModules | null>(null)
  const [loading, setLoading] = React.useState(true)

  hooks.useEffectOnce(() => {
    loadArcGISJSAPIModules(MODULES as any)
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
const useMapState = () => {
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

  // Cleanup function to remove all resources
  const cleanupResources = hooks.useEventCallback(() => {
    try {
      if (sketchViewModel) {
        sketchViewModel.cancel()
        sketchViewModel.destroy()
        setSketchViewModel(null)
      }

      if (areaMeasurement2D) {
        areaMeasurement2D.destroy()
        setAreaMeasurement2D(null)
      }

      if (distanceMeasurement2D) {
        distanceMeasurement2D.destroy()
        setDistanceMeasurement2D(null)
      }

      if (graphicsLayer && jimuMapView?.view?.map) {
        jimuMapView.view.map.remove(graphicsLayer)
        setGraphicsLayer(null)
      }

      if (measurementGraphicsLayer && jimuMapView?.view?.map) {
        jimuMapView.view.map.remove(measurementGraphicsLayer)
        setMeasurementGraphicsLayer(null)
      }

      setCurrentGeometry(null)
    } catch (error) {
      console.warn("FME Export Widget - Error during resource cleanup:", error)
    }
  })

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
    cleanupResources,
  }
}

const errorService = new ErrorHandlingService()

const dispatchError = (
  dispatch: (action: unknown) => void,
  message: string,
  type: ErrorType,
  code?: string
) => {
  dispatch(
    fmeActions.setError(
      errorService.createError(message, type, code ? { code } : undefined)
    )
  )
}

const abortController = (
  ref: React.MutableRefObject<AbortController | null>
) => {
  if (ref.current) {
    try {
      ref.current.abort()
    } catch {
      // Ignore abort errors
    }
    ref.current = null
  }
}

// Calculate polygon area using planar area calculation
const calcArea = (geometry: __esri.Geometry, modules: EsriModules): number => {
  if (geometry.type !== "polygon" || !modules.geometryEngine) return 0

  const geometryEngine = modules.geometryEngine as any
  const polygon = geometry as __esri.Polygon

  try {
    const planarValue = geometryEngine?.planarArea?.(polygon, AREA_UNIT)
    if (Number.isFinite(planarValue) && planarValue > MIN_VALID_AREA) {
      return Math.abs(planarValue)
    }
    // Fallback to extent-based area if planar area is unavailable/invalid
    const extent = polygon.extent
    if (extent) {
      const fallbackArea = Math.abs(extent.width * extent.height)
      return fallbackArea > MIN_VALID_AREA ? fallbackArea : 0
    }
  } catch (error) {
    console.warn(`FME Export Widget - planarArea calculation failed:`, error)
    // Fallback to extent-based area on error
    try {
      const extent = polygon.extent
      if (extent) {
        const fallbackArea = Math.abs(extent.width * extent.height)
        return fallbackArea > MIN_VALID_AREA ? fallbackArea : 0
      }
    } catch {
      /* ignore */
    }
  }

  return 0
}

// Validate polygon geometry with early returns
const validatePolygon = (
  geometry: __esri.Geometry | undefined,
  modules: EsriModules
): { valid: boolean; error?: ErrorState } => {
  if (!geometry) {
    return {
      valid: false,
      error: errorService.createError("GEOMETRY_MISSING", ErrorType.GEOMETRY, {
        code: "GEOM_MISSING",
      }),
    }
  }

  if (geometry.type !== "polygon") {
    return {
      valid: false,
      error: errorService.createError(
        "GEOMETRY_TYPE_INVALID",
        ErrorType.GEOMETRY,
        { code: "GEOM_TYPE_INVALID" }
      ),
    }
  }

  const polygon = geometry as __esri.Polygon
  if (!polygon.rings?.length) {
    return {
      valid: false,
      error: errorService.createError("POLYGON_NO_RINGS", ErrorType.GEOMETRY, {
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
        "POLYGON_MIN_VERTICES",
        ErrorType.GEOMETRY,
        { code: "GEOM_MIN_VERTICES" }
      ),
    }
  }

  // Ensure ring is explicitly closed (first == last) within epsilon
  try {
    const first = ring[0]
    const last = ring[ring.length - 1]
    const notClosed =
      !Array.isArray(first) ||
      !Array.isArray(last) ||
      Math.abs(first[0] - last[0]) >= COINCIDENT_EPSILON ||
      Math.abs(first[1] - last[1]) >= COINCIDENT_EPSILON
    if (notClosed) {
      return {
        valid: false,
        error: errorService.createError(
          "POLYGON_RING_NOT_CLOSED",
          ErrorType.GEOMETRY,
          { code: "GEOM_RING_NOT_CLOSED" }
        ),
      }
    }
  } catch {
    /* ignore ring closure check errors */
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
            "POLYGON_SELF_INTERSECTING",
            ErrorType.GEOMETRY,
            { code: "GEOM_SELF_INTERSECTING" }
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
const checkMaxArea = (
  area: number,
  maxArea?: number
): { ok: boolean; message?: string; code?: string } => {
  if (!maxArea || area <= maxArea) {
    return { ok: true }
  }

  return {
    ok: false,
    message: "AREA_TOO_LARGE",
    code: "AREA_TOO_LARGE",
  }
}

// Build the base submission parameters object
const buildFmeParams = (
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

// Type guard for polygon-like JSON (Esri)
const isPolygonJson = (value: unknown): value is { rings: unknown } => {
  return !!value && typeof value === "object" && "rings" in (value as any)
}

// Strip Z/M and ensure spatialReference is present; returns a new value
const sanitizePolygonJson = (value: unknown, spatialRef?: unknown): unknown => {
  if (!value || typeof value !== "object") return value
  const src = value as {
    rings?: unknown
    spatialReference?: unknown
    hasZ?: unknown
    hasM?: unknown
    [key: string]: unknown
  }
  const rings = src.rings
  if (!Array.isArray(rings)) return value

  const cleanedRings = (rings as unknown[]).map((ring) => {
    if (!Array.isArray(ring)) return ring
    return (ring as unknown[]).map((pt) => {
      if (Array.isArray(pt) && pt.length >= 2) {
        const x = typeof pt[0] === "number" ? pt[0] : Number(pt[0])
        const y = typeof pt[1] === "number" ? pt[1] : Number(pt[1])
        return [x, y]
      }
      return pt
    })
  })

  const result: {
    rings: unknown
    spatialReference?: unknown
    hasZ?: unknown
    hasM?: unknown
    [key: string]: unknown
  } = { ...src, rings: cleanedRings }
  // Drop Z/M flags if present
  if (Object.prototype.hasOwnProperty.call(result, "hasZ")) {
    delete result.hasZ
  }
  if (Object.prototype.hasOwnProperty.call(result, "hasM")) {
    delete result.hasM
  }
  // Ensure SR is present if provided
  if (spatialRef && !("spatialReference" in result)) {
    result.spatialReference = spatialRef
  }
  return result
}

// Attach polygon AOI if present
const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): { [key: string]: unknown } => {
  const geometryToUse = geometryJson || currentGeometry?.toJSON()
  if (isPolygonJson(geometryToUse)) {
    let sr: unknown
    try {
      sr = currentGeometry?.toJSON()?.spatialReference
    } catch {
      /* ignore SR derivation errors */
    }
    const polygonJson = sanitizePolygonJson(geometryToUse, sr)
    return { ...base, AreaOfInterest: JSON.stringify(polygonJson) }
  }
  return base
}

// Get user email with fallback
const getEmail = async (): Promise<string> => {
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
const prepFmeParams = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): { [key: string]: unknown } => {
  const base = buildFmeParams(formData, userEmail)
  return attachAoi(base, geometryJson, currentGeometry)
}

// Initialize graphics layers for drawing and measurements
const createLayers = (
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
const createMeasureWidgets = (
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
const createSketchVM = (
  jmv: JimuMapView,
  modules: EsriModules,
  layer: __esri.GraphicsLayer,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
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

  setSketchSymbols(sketchViewModel)
  setSketchEvents(sketchViewModel, onDrawComplete, dispatch)

  return sketchViewModel
}

// Configure sketch view model symbols
const setSketchSymbols = (sketchViewModel: __esri.SketchViewModel) => {
  sketchViewModel.polygonSymbol = CSS.symbols.highlight as any

  sketchViewModel.polylineSymbol = {
    type: "simple-line",
    color: CSS.colors.orangeOutline,
    width: 2,
    style: "solid",
  }

  sketchViewModel.pointSymbol = {
    type: "simple-marker",
    style: "circle",
    size: 8,
    color: CSS.colors.orangeOutline,
    outline: {
      color: CSS.colors.white,
      width: 1,
    },
  }
}

// Create a click tracker to manage drawing state and click counts
const createClickTracker = (dispatch: (action: unknown) => void) => {
  let clickCount = 0

  const resetClickTracking = () => {
    clickCount = 0
    dispatch(fmeActions.setDrawingState(false, 0, undefined))
  }

  const updateClickCount = (newCount: number) => {
    if (newCount > clickCount) {
      clickCount = newCount
      dispatch(fmeActions.setClickCount(clickCount))
      // If this is the first click, switch to drawing mode
      if (clickCount === 1) {
        dispatch(fmeActions.setViewMode(ViewMode.DRAWING))
      }
    }
  }

  return {
    resetClickTracking,
    updateClickCount,
    getClickCount: () => clickCount,
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

const handleSketchCreateEvent = (
  evt: __esri.SketchCreateEvent,
  clickTracker: ReturnType<typeof createClickTracker>,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void
) => {
  const { resetClickTracking, updateClickCount, getClickCount } = clickTracker

  switch (evt.state) {
    case "start":
      resetClickTracking()
      dispatch(
        fmeActions.setDrawingState(
          true,
          0,
          evt.tool === "rectangle" ? DrawingTool.RECTANGLE : DrawingTool.POLYGON
        )
      )
      break

    case "active":
      if (evt.tool === "polygon" && evt.graphic?.geometry) {
        const geometry = evt.graphic.geometry as __esri.Polygon
        const actualClicks = calculatePolygonClicks(geometry)
        updateClickCount(actualClicks)
      } else if (evt.tool === "rectangle" && getClickCount() !== 1) {
        updateClickCount(1)
      }
      break

    case "complete":
      resetClickTracking()
      onDrawComplete(evt)
      break

    case "cancel":
      resetClickTracking()
      break
  }
}

// Handle sketch create events and track drawing progress
const setSketchEvents = (
  sketchViewModel: __esri.SketchViewModel,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void
) => {
  const clickTracker = createClickTracker(dispatch)

  sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
    handleSketchCreateEvent(evt, clickTracker, onDrawComplete, dispatch)
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
  const response = fmeResponse as FmeResponse
  const data = response?.data
  if (!data) {
    return {
      success: false,
      message: "Unexpected response from FME server",
      code: "INVALID_RESPONSE",
    }
  }

  const serviceInfo: FmeServiceInfo =
    (data as any).serviceResponse || (data as any)
  const status = serviceInfo?.statusInfo?.status || serviceInfo?.status
  const rawId = (serviceInfo?.jobID ?? serviceInfo?.id) as unknown
  const parsedId =
    typeof rawId === "number" ? rawId : rawId != null ? Number(rawId) : NaN
  const jobId: number =
    Number.isFinite(parsedId) && parsedId > 0 ? parsedId : Date.now()

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
  maximumFractionDigits: AREA_DECIMALS,
})

// Format area (metric; returns localized string)
export function formatArea(area: number): string {
  if (!area || Number.isNaN(area) || area <= 0) return "0 m²"
  if (area >= M2_PER_KM2) {
    const areaInSqKm = area / M2_PER_KM2
    const formattedKm = NF_SV_AREA_KM.format(areaInSqKm)
    return `${formattedKm} km²`
  }
  const formatted = NF_SV_NO_DECIMALS.format(Math.round(area))
  return `${formatted} m²`
}

export default function Widget(
  props: AllWidgetProps<FmeExportConfig> & { state: FmeWidgetState }
): React.ReactElement {
  const {
    id: widgetId,
    useMapWidgetIds,
    dispatch,
    state: reduxState,
    config,
  } = props
  const translateWidget = hooks.useTranslation(defaultMessages)
  const translateComponent = hooks.useTranslation(componentMessages)
  // Translation function
  const translate = hooks.useEventCallback((key: string): string => {
    const widgetTranslation = translateWidget(key)
    if (widgetTranslation !== key) return widgetTranslation
    return translateComponent(key) || key
  })

  // Message component removed; use StateView + error state only

  const { modules, loading: modulesLoading } = useModules()
  const localMapState = useMapState()
  // Debounce pending sketch create starts
  const drawStartTimerRef = React.useRef<number | null>(null)
  // Abort controller
  const submissionAbortRef = React.useRef<AbortController | null>(null)
  // Startup validation controller
  const startupValidationAbortRef = React.useRef<AbortController | null>(null)

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
    cleanupResources,
  } = localMapState

  // Configuration validation helper
  const validateConfiguration = hooks.useEventCallback(
    (
      config: FmeExportConfig | undefined
    ): { isValid: boolean; error?: ErrorState } => {
      if (
        !config?.fmeServerUrl ||
        !config?.fmeServerToken ||
        !config?.repository
      ) {
        const errorMsg = translate("invalidConfiguration")
        return {
          isValid: false,
          error: errorService.createError(errorMsg, ErrorType.CONFIG, {
            code: "ConfigMissing",
            severity: ErrorSeverity.ERROR,
            userFriendlyMessage: config?.supportEmail
              ? translate("contactSupportWithEmail").replace(
                  "{email}",
                  config.supportEmail
                )
              : translate("contactSupport"),
            suggestion: translate("retryValidation"),
          }),
        }
      }
      return { isValid: true }
    }
  )

  // Validation state management helpers
  const setValidationStep = hooks.useEventCallback((step: string) => {
    dispatch(fmeActions.setStartupValidationState(true, step))
  })

  const setValidationSuccess = hooks.useEventCallback(() => {
    dispatch(fmeActions.setStartupValidationState(false))
    // Reset any existing error state
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING))
  })

  const setValidationError = hooks.useEventCallback((error: ErrorState) => {
    dispatch(fmeActions.setStartupValidationState(false, undefined, error))
  })

  // Startup validation logic
  const runStartupValidation = hooks.useEventCallback(async () => {
    // Reset any existing validation state
    if (startupValidationAbortRef.current) {
      startupValidationAbortRef.current.abort()
    }
    startupValidationAbortRef.current = new AbortController()
    const signal = startupValidationAbortRef.current.signal

    setValidationStep(translate("validatingConfiguration"))

    try {
      // Step 1: validate map configuration
      setValidationStep(translate("validatingMapConfiguration"))
      const hasMapConfigured = Array.isArray(useMapWidgetIds)
        ? useMapWidgetIds.length > 0
        : false
      if (!hasMapConfigured) {
        const msg = translate("mapNotConfigured")
        const mapConfigError = errorService.createError(msg, ErrorType.CONFIG, {
          code: "MapNotConfigured",
          severity: ErrorSeverity.ERROR,
          userFriendlyMessage: translate("mapSelectionRequired") || msg,
          suggestion:
            translate("openSettingsAndSelectMap") ||
            translate("retryValidation"),
          retry: () => runStartupValidation(),
        })
        dispatch(fmeActions.setError(mapConfigError))
        setValidationError(mapConfigError)
        return
      }

      // Check if configuration exists and is valid
      const configValidation = validateConfiguration(config)
      if (!configValidation.isValid && configValidation.error) {
        dispatchError(
          dispatch,
          configValidation.error.message,
          ErrorType.CONFIG,
          configValidation.error.code
        )
        setValidationError(configValidation.error)
        return
      }

      // Update validation step
      setValidationStep(translate("validatingConnection"))

      // Test FME server connection
      const client = createFmeFlowClient(config)
      await client.testConnection(signal)

      if (signal.aborted) return

      // Update validation step
      setValidationStep(translate("validatingAuthentication"))

      // Test repository access (validates token)
      await client.validateRepository(config.repository, signal)

      if (signal.aborted) return

      // Validation successful - transition to normal operation
      setValidationSuccess()
    } catch (err: unknown) {
      // Swallow aborts
      if ((err as Error)?.name === "AbortError") return

      console.error("FME Export - Startup validation failed:", err)

      const { code, message } = errorService.deriveStartupError(err, translate)

      const validationError = errorService.createError(
        message,
        ErrorType.CONFIG,
        {
          code,
          severity: ErrorSeverity.ERROR,
          userFriendlyMessage: props.config?.supportEmail
            ? translate("contactSupportWithEmail").replace(
                "{email}",
                props.config.supportEmail
              )
            : translate("contactSupport"),
          suggestion: translate("retryValidation"),
          retry: () => runStartupValidation(),
        }
      )

      setValidationError(validationError)
    }
  })

  // Run startup validation when widget first loads
  hooks.useEffectOnce(() => {
    runStartupValidation()

    return () => {
      // Cleanup validation on unmount
      if (startupValidationAbortRef.current) {
        startupValidationAbortRef.current.abort()
        startupValidationAbortRef.current = null
      }
    }
  })

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
  const onDrawComplete = hooks.useEventCallback(
    (evt: __esri.SketchCreateEvent) => {
      const geometry = evt.graphic?.geometry
      if (!geometry) return

      try {
        // Validate
        const validation = validatePolygon(geometry, modules)
        if (!validation.valid) {
          if (validation.error) {
            dispatch(fmeActions.setError(validation.error))
          }
          return
        }

        // Set symbol
        if (evt.graphic && modules) {
          evt.graphic.symbol = CSS.symbols.highlight as any
        }

        const calculatedArea = calcArea(geometry, modules)

        // Max area
        const maxCheck = checkMaxArea(calculatedArea, props.config?.maxArea)
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
  const canSubmit = (): boolean => {
    const hasGeometry = !!reduxState.geometryJson || !!currentGeometry
    if (!hasGeometry || !reduxState.selectedWorkspace) {
      return false
    }

    // Re-validate area constraints before submission
    const maxCheck = checkMaxArea(reduxState.drawnArea, props.config?.maxArea)
    if (!maxCheck.ok && maxCheck.message) {
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
    if (reduxState.isSubmittingOrder) {
      return
    }
    if (!canSubmit()) {
      return
    }

    dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: true }))

    try {
      const userEmail = await getEmail()
      const fmeClient = createFmeFlowClient(props.config)
      const workspace = reduxState.selectedWorkspace
      const fmeParameters = prepFmeParams(
        formData,
        userEmail,
        reduxState.geometryJson,
        currentGeometry
      )

      // Abort any existing submission
      abortController(submissionAbortRef)
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
      // clear any existing abort controller after completion
      submissionAbortRef.current = null
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
      const layer = createLayers(
        jmv,
        modules,
        setGraphicsLayer,
        setMeasurementGraphicsLayer
      )
      createMeasureWidgets(
        jmv,
        modules,
        setAreaMeasurement2D,
        setDistanceMeasurement2D
      )
      const svm = createSketchVM(jmv, modules, layer, onDrawComplete, dispatch)
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
      abortController(submissionAbortRef)
      if (drawStartTimerRef.current != null) {
        try {
          clearTimeout(drawStartTimerRef.current)
        } catch {
          /* noop */
        }
        drawStartTimerRef.current = null
      }
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
    dispatch(fmeActions.setDrawingState(true, 0, tool))
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING))

    // Clear and hide
    resetGraphicsAndMeasurements()

    // Ensure any in-progress draw is canceled before starting a new one
    try {
      sketchViewModel.cancel()
    } catch {
      /* noop */
    }

    // Begin create on next tick to avoid overlapping internal async operations
    const startCreate = () => {
      try {
        const svm = sketchViewModel as unknown as {
          create: (t: "rectangle" | "polygon") => unknown
        }
        const arg: "rectangle" | "polygon" =
          tool === DrawingTool.RECTANGLE ? "rectangle" : "polygon"
        const res = svm.create(arg)
        // Inline promise check since it's only used here
        if (
          res &&
          (typeof res === "object" || typeof res === "function") &&
          typeof (res as any).then === "function"
        ) {
          ;(res as Promise<unknown>).catch(() => {
            /* ignore expected cancellation errors */
          })
        }
      } catch {
        /* noop */
      }
    }
    if (drawStartTimerRef.current != null) {
      try {
        clearTimeout(drawStartTimerRef.current)
      } catch {
        /* noop */
      }
      drawStartTimerRef.current = null
    }
    drawStartTimerRef.current = window.setTimeout(
      startCreate,
      0
    ) as unknown as number
  })

  // Auto-start drawing when in DRAWING mode
  const canAutoStartDrawing =
    reduxState.viewMode === ViewMode.DRAWING &&
    reduxState.clickCount === 0 &&
    sketchViewModel &&
    !reduxState.isSubmittingOrder

  hooks.useUpdateEffect(() => {
    if (canAutoStartDrawing) {
      handleStartDrawing(reduxState.drawingTool)
    }
  }, [
    reduxState.viewMode,
    reduxState.clickCount,
    reduxState.drawingTool,
    sketchViewModel,
    reduxState.isSubmittingOrder,
    handleStartDrawing,
  ])

  // Reset handler
  const handleReset = hooks.useEventCallback(() => {
    // Clear graphics and measurements but keep map resources alive
    resetGraphicsAndMeasurements()

    // Abort any ongoing submission
    abortController(submissionAbortRef)
    if (startupValidationAbortRef.current) {
      try {
        startupValidationAbortRef.current.abort()
      } catch {
        /* noop */
      }
      startupValidationAbortRef.current = null
    }

    // Cancel any in-progress drawing
    if (sketchViewModel) sketchViewModel.cancel()

    // Reset Redux state
    dispatch(fmeActions.setGeometry(null, 0))
    dispatch(fmeActions.setDrawingState(false, 0, reduxState.drawingTool))
    dispatch(fmeActions.setClickCount(0))
    dispatch(fmeActions.setError(null))
    dispatch(fmeActions.setImportError(null))
    dispatch(fmeActions.setExportError(null))
    dispatch(fmeActions.setOrderResult(null))
    dispatch(fmeActions.setSelectedWorkspace(null))
    // Reset workspace parameters and item
    dispatch(fmeActions.setFormValues({}))
    // Reset workspace parameters
    dispatch(
      fmeActions.setLoadingFlags({
        isModulesLoading: false,
        isSubmittingOrder: false,
      } as any)
    )
    // Reset view mode to initial
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING))
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

  // Navigation helpers
  const navigateTo = hooks.useEventCallback((viewMode: ViewMode) => {
    dispatch(fmeActions.setViewMode(viewMode))
  })

  const navigateBack = hooks.useEventCallback(() => {
    const { viewMode, previousViewMode } = reduxState
    const fallback = VIEW_ROUTES[viewMode] || ViewMode.INITIAL
    const target =
      previousViewMode && previousViewMode !== viewMode
        ? previousViewMode
        : fallback
    navigateTo(target)
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
    const e = reduxState.error

    // Special minimal UI for missing map configuration: one centered message, no buttons
    if (e.code === "MapNotConfigured") {
      // Prefer a friendly message; fallback to translation key, and finally a plain string
      const translatedHint = translate("mapSelectionRequired")
      const friendly =
        e.userFriendlyMessage &&
        e.userFriendlyMessage !== "mapSelectionRequired"
          ? e.userFriendlyMessage
          : translatedHint !== "mapSelectionRequired"
            ? translatedHint
            : "Select a map in the widget settings."

      return (
        <div
          css={[UI_CLS.CSS.COL]}
          style={{
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            css={UI_CLS.TYPOGRAPHY.CAPTION}
            style={{ textAlign: "center", maxWidth: 420 }}
          >
            {friendly}
          </div>
        </div>
      )
    }

    // Default error UI (header + support text + retry)
    const titleCls = UI_CLS.TYPOGRAPHY.TITLE
    const captionCls = UI_CLS.TYPOGRAPHY.CAPTION
    const headerRowCls = UI_CLS.CSS.HEADER_ROW_MIN
    const supportText = e.userFriendlyMessage || translate("contactSupport")
    const messageText = translate(e.message) || e.message
    const buttonText = translate("retry")
    const onAction = () => {
      if (e.retry) e.retry()
      else dispatch(fmeActions.setError(null))
    }

    return (
      <div css={[UI_CLS.CSS.COL, UI_CLS.CSS.GAP_SM, UI_CLS.CSS.PAD_SM]}>
        <div css={headerRowCls}>
          <div css={titleCls}>{translate("errorTitle")}</div>
          {e.code ? <div css={titleCls}>{e.code}</div> : null}
        </div>
        <div css={captionCls}>{supportText || messageText}</div>
        <Button
          text={buttonText}
          onClick={onAction}
          logging={{ enabled: true, prefix: "FME-Export" }}
          tooltipPlacement="bottom"
        />
      </div>
    )
  }

  // derive simple view booleans for readability
  const showHeaderActions =
    (reduxState.isDrawing || reduxState.drawnArea > 0) &&
    !reduxState.isSubmittingOrder &&
    !modulesLoading

  // precompute UI booleans
  const hasSingleMapWidget = Boolean(
    useMapWidgetIds && useMapWidgetIds.length === 1
  )

  return (
    <>
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
          reduxState.isDrawing,
          reduxState.clickCount
        )}
        isModulesLoading={modulesLoading}
        canStartDrawing={!!sketchViewModel}
        onFormBack={() => navigateTo(ViewMode.WORKSPACE_SELECTION)}
        onFormSubmit={handleFormSubmit}
        orderResult={reduxState.orderResult}
        onReuseGeography={() => navigateTo(ViewMode.WORKSPACE_SELECTION)}
        isSubmittingOrder={reduxState.isSubmittingOrder}
        onBack={navigateBack}
        drawnArea={reduxState.drawnArea}
        formatArea={formatArea}
        drawingMode={reduxState.drawingTool}
        onDrawingModeChange={(tool) => {
          dispatch(fmeActions.setDrawingTool(tool))
          // If currently in DRAWING mode and no clicks, switch to the selected tool
          if (
            reduxState.viewMode === ViewMode.DRAWING &&
            reduxState.clickCount === 0 &&
            sketchViewModel
          ) {
            // Cancel any ongoing drawing
            try {
              sketchViewModel.cancel()
            } catch {
              /* noop */
            }
            // Start new drawing with the selected tool
            handleStartDrawing(tool)
          }
        }}
        // Drawing props
        isDrawing={reduxState.isDrawing}
        clickCount={reduxState.clickCount}
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
      {/* Message component removed */}
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
