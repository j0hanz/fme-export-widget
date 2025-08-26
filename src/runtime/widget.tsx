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
import { StateView, Button, styles } from "./components/ui"
import { createFmeFlowClient } from "../shared/api"
import defaultMessages from "./translations/default"
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
  "esri/geometry/geometryEngine",
] as const

// Small utility helpers (behavior-preserving)
const hasMessage = (x: unknown): x is { message?: unknown } =>
  typeof x === "object" && x !== null && "message" in x

const getErrorMessage = (err: unknown): string =>
  hasMessage(err) &&
  (typeof err.message === "string" || typeof err.message === "number")
    ? String(err.message)
    : ""

const isThenable = (
  v: unknown
): v is { then: (...args: unknown[]) => unknown } =>
  !!v &&
  (typeof v === "object" || typeof v === "function") &&
  typeof (v as { then?: unknown }).then === "function"

// Note: Translations must come exclusively from default.ts files; no manual fallbacks

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
          geometryEngine,
        ] = loaded
        setModules({
          SketchViewModel,
          GraphicsLayer,
          Graphic,
          Polygon,
          Extent,
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

      if (graphicsLayer && jimuMapView?.view?.map) {
        jimuMapView.view.map.remove(graphicsLayer)
        setGraphicsLayer(null)
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

// Calculate area of a polygon geometry using multiple methods
export const calcArea = (
  geometry: __esri.Geometry,
  modules: EsriModules
): number => {
  if (geometry.type !== "polygon" || !modules.geometryEngine) return 0

  const polygon = geometry as __esri.Polygon
  const sr = polygon.spatialReference
  const geomEng = modules.geometryEngine as any
  const useGeodesic = Boolean(sr?.isGeographic || (sr as any)?.isWebMercator)

  try {
    if (useGeodesic && typeof geomEng?.geodesicArea === "function") {
      const a = geomEng.geodesicArea(polygon, AREA_UNIT)
      return Number.isFinite(a) && Math.abs(a) > MIN_VALID_AREA
        ? Math.abs(a)
        : 0
    }
    if (!useGeodesic && typeof geomEng?.planarArea === "function") {
      const a = geomEng.planarArea(polygon, AREA_UNIT)
      return Number.isFinite(a) && Math.abs(a) > MIN_VALID_AREA
        ? Math.abs(a)
        : 0
    }
  } catch {
    // Ignore area calculation errors
  }
  return 0
}

// Polygon validation helpers for focused error checking
const validateGeometryExists = (
  geometry: __esri.Geometry | undefined
): ErrorState | null => {
  if (!geometry) {
    return errorService.createError("GEOMETRY_MISSING", ErrorType.GEOMETRY, {
      code: "GEOM_MISSING",
    })
  }
  return null
}

const validateGeometryType = (geometry: __esri.Geometry): ErrorState | null => {
  if (geometry.type !== "polygon") {
    return errorService.createError(
      "GEOMETRY_TYPE_INVALID",
      ErrorType.GEOMETRY,
      {
        code: "GEOM_TYPE_INVALID",
      }
    )
  }
  return null
}

const validatePolygonRings = (polygon: __esri.Polygon): ErrorState | null => {
  if (!polygon.rings?.length) {
    return errorService.createError("POLYGON_NO_RINGS", ErrorType.GEOMETRY, {
      code: "GEOM_NO_RINGS",
    })
  }
  return null
}

const validateRingGeometry = (ring: unknown[]): ErrorState | null => {
  if (!Array.isArray(ring) || ring.length < 3) {
    return errorService.createError(
      "POLYGON_MIN_VERTICES",
      ErrorType.GEOMETRY,
      {
        code: "GEOM_MIN_VERTICES",
      }
    )
  }

  const uniquePoints = new Set(
    ring
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => `${p[0]}:${p[1]}`)
  )

  if (uniquePoints.size < 3) {
    return errorService.createError(
      "POLYGON_MIN_VERTICES",
      ErrorType.GEOMETRY,
      {
        code: "GEOM_MIN_VERTICES",
      }
    )
  }
  return null
}

const validateRingClosure = (ring: unknown[]): ErrorState | null => {
  try {
    const first = ring[0]
    const last = ring[ring.length - 1]
    const notClosed =
      !Array.isArray(first) ||
      !Array.isArray(last) ||
      Math.abs(first[0] - last[0]) >= COINCIDENT_EPSILON ||
      Math.abs(first[1] - last[1]) >= COINCIDENT_EPSILON

    if (notClosed) {
      return errorService.createError(
        "POLYGON_RING_NOT_CLOSED",
        ErrorType.GEOMETRY,
        {
          code: "GEOM_RING_NOT_CLOSED",
        }
      )
    }
  } catch {
    /* ignore ring closure check errors */
  }
  return null
}

const validatePolygonSimplicity = (
  polygon: __esri.Polygon,
  modules: EsriModules
): ErrorState | null => {
  try {
    const geometryEngine = modules.geometryEngine as any
    // Check for self-intersections if geometryEngine is available
    if (typeof geometryEngine?.isSimple === "function") {
      const simple = geometryEngine.isSimple(polygon)
      if (simple === false) {
        return errorService.createError(
          "POLYGON_SELF_INTERSECTING",
          ErrorType.GEOMETRY,
          { code: "GEOM_SELF_INTERSECTING" }
        )
      }
    }
  } catch {
    // Ignore simplicity check errors
  }
  return null
}

// Simplify polygon geometry if possible
const getSimplifiedPolygon = (
  poly: __esri.Polygon,
  modules: EsriModules
): __esri.Polygon => {
  try {
    const geometryEngine = modules.geometryEngine as any
    if (typeof geometryEngine?.simplify === "function") {
      const simplified = geometryEngine.simplify(poly)
      if (simplified && simplified.type === "polygon") return simplified
    }
  } catch {
    // Ignore simplification errors
  }
  return poly
}

// Validate polygon geometry with focused validation steps
export const validatePolygon = (
  geometry: __esri.Geometry | undefined,
  modules: EsriModules
): { valid: boolean; error?: ErrorState } => {
  // Check geometry existence
  const existenceError = validateGeometryExists(geometry)
  if (existenceError) return { valid: false, error: existenceError }

  // Check geometry type
  const typeError = validateGeometryType(geometry)
  if (typeError) return { valid: false, error: typeError }

  const polygon = geometry as __esri.Polygon

  // Check rings existence
  const ringsError = validatePolygonRings(polygon)
  if (ringsError) return { valid: false, error: ringsError }

  // Validate each ring
  for (const ring of polygon.rings) {
    const ringGeometryError = validateRingGeometry(ring)
    if (ringGeometryError) return { valid: false, error: ringGeometryError }

    const ringClosureError = validateRingClosure(ring)
    if (ringClosureError) return { valid: false, error: ringClosureError }
  }

  // Check for self-intersection
  const simplicityError = validatePolygonSimplicity(polygon, modules)
  if (simplicityError) return { valid: false, error: simplicityError }

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

// Polygon sanitization helpers for cleaner ring processing
const sanitizePoint = (pt: unknown): unknown => {
  if (!Array.isArray(pt) || pt.length < 2) return pt

  const x = typeof pt[0] === "number" ? pt[0] : Number(pt[0])
  const y = typeof pt[1] === "number" ? pt[1] : Number(pt[1])
  return [x, y]
}

const ensureRingClosure = (ring: unknown[]): unknown[] => {
  try {
    const first = ring[0]
    const last = ring[ring.length - 1]

    const needsClosure =
      Array.isArray(first) &&
      Array.isArray(last) &&
      (Math.abs((first[0] as number) - (last[0] as number)) >=
        COINCIDENT_EPSILON ||
        Math.abs((first[1] as number) - (last[1] as number)) >=
          COINCIDENT_EPSILON)

    if (needsClosure) {
      return [...ring, [first[0] as number, first[1] as number]]
    }
  } catch {
    /* ignore closure enforcement errors */
  }
  return ring
}

const sanitizeRing = (ring: unknown): unknown => {
  if (!Array.isArray(ring)) return ring

  const cleanedPoints = (ring as unknown[]).map(sanitizePoint)
  return ensureRingClosure(cleanedPoints)
}

const removeZMFlags = (result: { [key: string]: unknown }): void => {
  if (Object.prototype.hasOwnProperty.call(result, "hasZ")) {
    delete result.hasZ
  }
  if (Object.prototype.hasOwnProperty.call(result, "hasM")) {
    delete result.hasM
  }
}

const ensureSpatialReference = (
  result: { [key: string]: unknown },
  spatialRef?: unknown
): void => {
  if (spatialRef && !("spatialReference" in result)) {
    result.spatialReference = spatialRef
  }
}

// Sanitize polygon JSON to ensure valid structure
const sanitizePolygonJson = (value: unknown, spatialRef?: unknown): unknown => {
  if (!value || typeof value !== "object") return value

  const src = value as {
    rings?: unknown
    spatialReference?: unknown
    hasZ?: unknown
    hasM?: unknown
    [key: string]: unknown
  }

  if (!Array.isArray(src.rings)) return value

  const cleanedRings = (src.rings as unknown[]).map(sanitizeRing)
  const result = { ...src, rings: cleanedRings }

  removeZMFlags(result)
  ensureSpatialReference(result, spatialRef)

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

// Get user email from the portal
const getEmail = async (): Promise<string> => {
  const [Portal] = await loadArcGISJSAPIModules(["esri/portal/Portal"])
  const portal = new Portal()
  await portal.load()

  const email = portal.user?.email
  if (!email) {
    throw new Error("User email is required but not available")
  }

  return email
}

// Validate email format
const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (/no-?reply/i.test(email)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
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

// Apply admin defaults for FME Task Manager directives with proper precedence
const applyDirectiveDefaults = (
  params: { [key: string]: unknown },
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  if (!config) return params
  const out: { [key: string]: unknown } = { ...params }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(out, k)

  const toPosInt = (v: unknown): number | undefined => {
    const n = typeof v === "string" ? Number(v) : (v as number)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
  }

  if (!has("tm_ttc")) {
    const v = toPosInt(config.tm_ttc)
    if (v !== undefined) out.tm_ttc = v
  }
  if (!has("tm_ttl")) {
    const v = toPosInt(config.tm_ttl)
    if (v !== undefined) out.tm_ttl = v
  }
  if (!has("tm_tag")) {
    const v = typeof config.tm_tag === "string" ? config.tm_tag.trim() : ""
    if (v) out.tm_tag = v
  }

  return out
}

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
  setupSketchEventHandlers(sketchViewModel, onDrawComplete, dispatch)

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

// Create a state manager for drawing state
const createDrawingStateManager = (dispatch: (action: unknown) => void) => {
  let clickCount = 0

  return {
    resetState: () => {
      clickCount = 0
      dispatch(fmeActions.setDrawingState(false, 0, undefined))
    },

    updateClicks: (newCount: number) => {
      if (newCount > clickCount) {
        clickCount = newCount
        dispatch(fmeActions.setClickCount(clickCount))
        if (clickCount === 1) {
          dispatch(fmeActions.setViewMode(ViewMode.DRAWING))
        }
      }
    },

    getClickCount: () => clickCount,
  }
}

const calculateVertexCount = (geometry: __esri.Polygon): number => {
  const vertices = geometry.rings?.[0]
  if (!vertices || vertices.length < 2) return 0

  const firstPoint = vertices[0]
  const lastPoint = vertices[vertices.length - 1]

  // Check if polygon is auto-closed
  const isAutoClosed =
    Array.isArray(firstPoint) &&
    Array.isArray(lastPoint) &&
    Math.abs(firstPoint[0] - lastPoint[0]) < COINCIDENT_EPSILON &&
    Math.abs(firstPoint[1] - lastPoint[1]) < COINCIDENT_EPSILON

  return isAutoClosed ? vertices.length - 1 : vertices.length
}

const processSketchEvent = (
  evt: __esri.SketchCreateEvent,
  stateManager: ReturnType<typeof createDrawingStateManager>,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void
) => {
  const { resetState, updateClicks, getClickCount } = stateManager

  switch (evt.state) {
    case "start":
      resetState()
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
        const actualClicks = calculateVertexCount(geometry)
        updateClicks(actualClicks)
      } else if (evt.tool === "rectangle" && getClickCount() !== 1) {
        updateClicks(1)
      }
      break

    case "complete":
      resetState()
      onDrawComplete(evt)
      break

    case "cancel":
      resetState()
      break
  }
}

// Handle sketch create events and track drawing progress
// Create sketch event handlers with improved structure
const setupSketchEventHandlers = (
  sketchViewModel: __esri.SketchViewModel,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void
) => {
  const stateManager = createDrawingStateManager(dispatch)

  sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
    processSketchEvent(evt, stateManager, onDrawComplete, dispatch)
  })
}

// Measurement widgets removed as unused

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
  // Translation function
  const translate = hooks.useEventCallback((key: string): string => {
    return translateWidget(key)
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
        return {
          isValid: false,
          error: createStartupError("invalidConfiguration", "ConfigMissing"),
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

  // Small helper to build consistent startup validation errors
  const createStartupError = hooks.useEventCallback(
    (messageKey: string, code: string, retry?: () => void): ErrorState =>
      errorService.createError(translate(messageKey), ErrorType.CONFIG, {
        code,
        severity: ErrorSeverity.ERROR,
        userFriendlyMessage: props.config?.supportEmail
          ? String(props.config.supportEmail)
          : translate("contactSupport"),
        suggestion: translate("retryValidation"),
        retry,
      })
  )

  // Startup validation logic
  const runStartupValidation = hooks.useEventCallback(async () => {
    // Reset any existing validation state
    abortController(startupValidationAbortRef)
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
        const mapConfigError = createStartupError(
          "mapNotConfigured",
          "MapNotConfigured",
          () => runStartupValidation()
        )
        // Override for map-specific UI hints
        mapConfigError.userFriendlyMessage = translate("mapSelectionRequired")
        mapConfigError.suggestion = translate("openSettingsAndSelectMap")
        setValidationError(mapConfigError)
        return
      }

      // Check if configuration exists and is valid
      const configValidation = validateConfiguration(config)
      if (!configValidation.isValid && configValidation.error) {
        setValidationError(configValidation.error)
        return
      }

      // Helper to run a labeled step with abort checks
      const runStep = async (
        stepKey: string,
        action: () => Promise<unknown>
      ): Promise<void> => {
        setValidationStep(translate(stepKey))
        const result = await action()
        if (signal.aborted) throw new Error("AbortError")
        return result as void
      }

      const client = createFmeFlowClient(config)

      // 1) Connection check
      await runStep("validatingConnection", () => client.testConnection(signal))

      // 2) Authentication (repo access)
      await runStep("validatingAuthentication", () =>
        client.validateRepository(config.repository, signal)
      )

      // Update validation step
      setValidationStep(translate("validatingUserEmail"))

      // Validate that current user has an email address available
      try {
        const email = await getEmail()
        if (!isValidEmail(email)) {
          setValidationError(
            createStartupError("userEmailMissing", "UserEmailMissing", () =>
              runStartupValidation()
            )
          )
          return
        }
      } catch (emailErr) {
        // If email check itself fails, surface as missing email
        setValidationError(
          createStartupError("userEmailMissing", "UserEmailMissing", () =>
            runStartupValidation()
          )
        )
        return
      }

      // Validation successful - transition to normal operation
      setValidationSuccess()
    } catch (err: unknown) {
      // Swallow aborts
      if ((err as Error)?.name === "AbortError") return

      console.error("FME Export - Startup validation failed:", err)

      const { code, message } = errorService.deriveStartupError(err, translate)

      setValidationError(
        createStartupError(message, code, () => runStartupValidation())
      )
    }
  })

  // Run startup validation when widget first loads
  hooks.useEffectOnce(() => {
    runStartupValidation()

    return () => {
      // Cleanup validation on unmount
      abortController(startupValidationAbortRef)
    }
  })

  // Clear graphics
  const clearAllGraphics = hooks.useEventCallback(() => {
    graphicsLayer?.removeAll()
  })

  // Reset/hide measurement UI and clear layers
  const resetGraphicsAndMeasurements = hooks.useEventCallback(() => {
    clearAllGraphics()
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

        // Prefer a simplified polygon when available to ensure clean rings
        const geomForUse =
          geometry.type === "polygon"
            ? getSimplifiedPolygon(geometry, modules)
            : geometry

        // Set symbol
        if (evt.graphic && modules) {
          evt.graphic.symbol = CSS.symbols.highlight as any
        }

        const calculatedArea = calcArea(geomForUse, modules)

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

        dispatch(fmeActions.setGeometry(geomForUse, Math.abs(calculatedArea)))
        dispatch(fmeActions.setDrawingState(false, 0, undefined))

        // Store current geometry in local state (not Redux - following golden rule)
        setCurrentGeometry(geomForUse)

        dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
      } catch (error) {
        dispatchError(
          dispatch,
          translate("drawingCompleteFailed"),
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
    const errorMessage =
      getErrorMessage(error) || translate("unknownErrorOccurred")
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
        applyDirectiveDefaults(fmeParameters, props.config),
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
      const layer = createLayers(jmv, modules, setGraphicsLayer)
      const svm = createSketchVM(jmv, modules, layer, onDrawComplete, dispatch)
      setSketchViewModel(svm)
    } catch (error) {
      dispatchError(
        dispatch,
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
        if (isThenable(res)) {
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
    abortController(startupValidationAbortRef)

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
    const defaultRoute = VIEW_ROUTES[viewMode] || ViewMode.INITIAL
    const target =
      previousViewMode && previousViewMode !== viewMode
        ? previousViewMode
        : defaultRoute
    navigateTo(target)
  })

  // Loading state
  if (modulesLoading || !modules) {
    const loadingMessage = modules
      ? translate("preparingMapTools")
      : translate("loadingMapServices")
    return <StateView state={{ kind: "loading", message: loadingMessage }} />
  }

  // Error state - let Workflow handle all startup validation errors
  if (reduxState.error && reduxState.error.severity === "error") {
    // Only handle non-startup errors here; startup errors are handled by Workflow
    if (reduxState.startupValidationError) {
      // Let Workflow handle startup validation errors
    } else {
      const e = reduxState.error

      // Default error UI (header + support text + retry)
      const supportText = e.userFriendlyMessage || translate("contactSupport")
      const messageText = translate(e.message)
      const buttonText = translate("retry")
      const onAction = () => {
        // Retry callbacks are transient and not stored in Redux; simply clear error
        dispatch(fmeActions.setError(null))
      }

      return (
        <div css={[styles.col, styles.gapMedium, styles.paddingSmall]}>
          <div css={styles.headerRow}>
            <div css={styles.typography.title}>{translate("errorTitle")}</div>
            {e.code ? <div css={styles.typography.title}>{e.code}</div> : null}
          </div>
          <div css={styles.typography.caption}>
            {supportText || messageText}
          </div>
          <Button
            text={buttonText}
            onClick={onAction}
            logging={{ enabled: true, prefix: "FME-Export" }}
            tooltipPlacement="bottom"
          />
        </div>
      )
    }
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
