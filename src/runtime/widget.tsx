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
} from "jimu-core"
import { JimuMapViewComponent, type JimuMapView } from "jimu-arcgis"
import { Workflow } from "./components/workflow"
import { StateView, useStyles, renderSupportHint } from "./components/ui"
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
  FmeResponse,
  FmeServiceInfo,
  ErrorState,
} from "../shared/types"
import {
  makeErrorView,
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  LAYER_CONFIG,
  VIEW_ROUTES,
} from "../shared/types"
import { ErrorHandlingService } from "../shared/services"
import { fmeActions, initialFmeState } from "../extensions/store"
import {
  resolveMessageOrKey,
  getErrorMessage,
  isValidEmail,
  buildSupportHintText,
  getSupportEmail,
} from "../shared/utils"

// Dynamic ESRI module loader with test stub support
const loadEsriModules = async (modules: string[]): Promise<any[]> => {
  const testStub = (global as any).__ESRI_TEST_STUB__
  if (typeof testStub === "function" && process.env.NODE_ENV === "test") {
    return testStub(modules)
  }

  const { loadArcGISJSAPIModules } = await import("jimu-arcgis")
  const loaded = await loadArcGISJSAPIModules(modules)
  return loaded.map((m: any) => m?.default ?? m)
}

// Constants for styling and symbols
const DRAWING_COLOR = [0, 121, 193] as const

const HIGHLIGHT_SYMBOL = {
  type: "simple-fill" as const,
  color: [...DRAWING_COLOR, 0.2] as [number, number, number, number],
  outline: {
    color: DRAWING_COLOR,
    width: 2,
    style: "solid" as const,
  },
}

const DRAWING_SYMBOLS = {
  polygon: HIGHLIGHT_SYMBOL,
  polyline: {
    type: "simple-line",
    color: DRAWING_COLOR,
    width: 2,
    style: "solid",
  },
  point: {
    type: "simple-marker",
    style: "circle",
    size: 8,
    color: DRAWING_COLOR,
    outline: {
      color: [255, 255, 255],
      width: 1,
    },
  },
}

// ArcGIS JS API modules
const MODULES = [
  "esri/widgets/Sketch/SketchViewModel",
  "esri/layers/GraphicsLayer",
  "esri/geometry/geometryEngine",
  "esri/geometry/support/webMercatorUtils",
  "esri/core/reactiveUtils",
  "esri/geometry/Polyline",
  "esri/geometry/Polygon",
  "esri/Graphic",
] as const

// Area calculation and formatting constants
const GEOMETRY_CONSTS = {
  M2_PER_KM2: 1_000_000, // m² -> 1 km²
  AREA_DECIMALS: 2,
} as const

// Optimized module loading hook using jimu patterns
const useModules = (): {
  modules: EsriModules | null
  loading: boolean
} => {
  const [state, setState] = React.useState<{
    modules: EsriModules | null
    loading: boolean
  }>({ modules: null, loading: true })

  hooks.useEffectOnce(() => {
    let cancelled = false

    const loadModules = async () => {
      try {
        const loaded = await loadEsriModules(MODULES as any)
        if (cancelled) return

        const [
          SketchViewModel,
          GraphicsLayer,
          geometryEngine,
          webMercatorUtils,
          reactiveUtils,
          Polyline,
          Polygon,
          Graphic,
        ] = loaded

        setState({
          modules: {
            SketchViewModel,
            GraphicsLayer,
            geometryEngine,
            webMercatorUtils,
            reactiveUtils,
            Polyline,
            Polygon,
            Graphic,
          } as EsriModules,
          loading: false,
        })
      } catch (error) {
        if (!cancelled) {
          console.error(
            "FME Export Widget - Failed to load ArcGIS modules",
            error
          )
          setState({ modules: null, loading: false })
        }
      }
    }
    loadModules()
    return () => {
      cancelled = true
    }
  })

  return state
}

// Optimized map state management with better cleanup patterns
const useMapState = () => {
  const [mapResources, setMapResources] = React.useState<{
    jimuMapView: JimuMapView | null
    sketchViewModel: __esri.SketchViewModel | null
    graphicsLayer: __esri.GraphicsLayer | null
    currentGeometry: __esri.Geometry | null
  }>({
    jimuMapView: null,
    sketchViewModel: null,
    graphicsLayer: null,
    currentGeometry: null,
  })

  const updateMapResource = hooks.useEventCallback(
    <K extends keyof typeof mapResources>(
      key: K,
      value: (typeof mapResources)[K]
    ) => {
      setMapResources((prev) => ({ ...prev, [key]: value }))
    }
  )

  // Centralized cleanup with better error handling
  const cleanupResources = hooks.useEventCallback(() => {
    const { sketchViewModel, graphicsLayer, jimuMapView } = mapResources

    // Cancel sketch operations
    if (sketchViewModel?.activeTool) {
      try {
        sketchViewModel.cancel()
        sketchViewModel.destroy?.()
      } catch (error) {
        console.warn("Widget - Error cleaning up SketchViewModel:", error)
      }
    }

    // Remove and clear graphics layer
    if (graphicsLayer) {
      try {
        if (jimuMapView?.view?.map && graphicsLayer.parent) {
          jimuMapView.view.map.remove(graphicsLayer)
        }
        graphicsLayer.removeAll?.()
      } catch (error) {
        console.warn("Widget - Error cleaning up GraphicsLayer:", error)
      }
    }

    // Reset all resources
    setMapResources({
      jimuMapView: null,
      sketchViewModel: null,
      graphicsLayer: null,
      currentGeometry: null,
    })
  })

  return {
    ...mapResources,
    setJimuMapView: (view: JimuMapView | null) =>
      updateMapResource("jimuMapView", view),
    setSketchViewModel: (vm: __esri.SketchViewModel | null) =>
      updateMapResource("sketchViewModel", vm),
    setGraphicsLayer: (layer: __esri.GraphicsLayer | null) =>
      updateMapResource("graphicsLayer", layer),
    setCurrentGeometry: (geom: __esri.Geometry | null) =>
      updateMapResource("currentGeometry", geom),
    cleanupResources,
  }
}

// Shared error service instance
const errorService = new ErrorHandlingService()

// Optimized error dispatching utility
const useErrorDispatcher = (dispatch: (action: unknown) => void) =>
  hooks.useEventCallback((message: string, type: ErrorType, code?: string) => {
    dispatch(
      fmeActions.setError(
        errorService.createError(message, type, code ? { code } : undefined)
      )
    )
  })

// Optimized abort controller management
const useAbortController = () => {
  const ref = React.useRef<AbortController | null>(null)

  const cancel = hooks.useEventCallback(() => {
    if (ref.current && !ref.current.signal.aborted) {
      try {
        ref.current.abort()
      } catch (error) {
        console.warn("Widget - Error aborting controller:", error)
      }
    }
    ref.current = null
  })

  const create = hooks.useEventCallback(() => {
    cancel() // Cancel existing controller
    ref.current = new AbortController()
    return ref.current
  })

  return { ref, cancel, create }
}

// Simple geometry calculation utility
const calcArea = (
  geometry: __esri.Geometry | undefined,
  modules: EsriModules
): number => {
  if (!geometry || geometry.type !== "polygon" || !modules?.geometryEngine) {
    return 0
  }

  try {
    const polygon = modules.Polygon.fromJSON(geometry.toJSON())
    const engine = modules.geometryEngine
    const simplified = (engine.simplify(polygon) || polygon) as __esri.Polygon

    const sr = polygon.spatialReference
    const useGeodesic = sr?.isGeographic || sr?.isWebMercator
    const area = useGeodesic
      ? engine.geodesicArea(simplified, "square-meters")
      : engine.planarArea(simplified, "square-meters")

    return Number.isFinite(area) ? Math.abs(area) : 0
  } catch (error) {
    console.warn("Error calculating geometry area:", error)
    return 0
  }
}

// Simple polygon validation
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

  if (!modules?.geometryEngine) {
    return { valid: true }
  }

  try {
    const polygon = modules.Polygon.fromJSON(geometry.toJSON())
    if (!modules.geometryEngine.isSimple(polygon)) {
      return {
        valid: false,
        error: errorService.createError(
          "POLYGON_SELF_INTERSECTING",
          ErrorType.GEOMETRY,
          { code: "GEOM_SELF_INTERSECTING" }
        ),
      }
    }
  } catch (error) {
    console.warn("Error validating polygon:", error)
  }

  return { valid: true }
}

// Export utility functions
export { calcArea, validatePolygon }

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

// Build base FME parameters
const buildFmeParams = (
  formData: unknown,
  userEmail: string,
  serviceMode: "sync" | "async" = "async"
): { [key: string]: unknown } => {
  const data = (formData as { data?: { [key: string]: unknown } })?.data || {}
  return {
    ...data,
    opt_requesteremail: userEmail,
    opt_servicemode: serviceMode,
    opt_responseformat: "json",
    opt_showresult: "true",
  }
}

// Type guard for graphic JSON with geometry property
const isGraphicJsonWithPolygon = (
  value: unknown
): value is { geometry: { rings: unknown } } => {
  if (!value || typeof value !== "object") return false
  const v = value as { [key: string]: unknown }
  if (!("geometry" in v)) return false
  const geometry = v.geometry
  if (!geometry || typeof geometry !== "object") return false
  const g = geometry as { [key: string]: unknown }
  if (!("rings" in g)) return false
  const rings = g.rings
  return Array.isArray(rings) && rings.length > 0 && Array.isArray(rings[0])
}

// Type guard for polygon geometry JSON
const isPolygonJson = (value: unknown): value is { rings: unknown } => {
  if (!value || typeof value !== "object") return false
  const v = value as { [key: string]: unknown }
  if (!("rings" in v)) return false
  const rings = v.rings
  return Array.isArray(rings) && rings.length > 0 && Array.isArray(rings[0])
}

// Attach AOI to FME parameters
const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): { [key: string]: unknown } => {
  // Prefer graphic JSON with geometry property
  if (isGraphicJsonWithPolygon(geometryJson)) {
    return { ...base, AreaOfInterest: JSON.stringify(geometryJson.geometry) }
  }

  // Use direct geometry JSON
  if (isPolygonJson(geometryJson)) {
    return { ...base, AreaOfInterest: JSON.stringify(geometryJson) }
  }

  // Use current geometry as last resort
  const geometryToUse = currentGeometry?.toJSON()
  if (isPolygonJson(geometryToUse)) {
    return { ...base, AreaOfInterest: JSON.stringify(geometryToUse) }
  }

  return base
}

// Email utilities (uses Portal to fetch current user's email)
const getEmail = async (): Promise<string> => {
  const [Portal] = await loadEsriModules(["esri/portal/Portal"])
  const portal = new Portal()
  await portal.load()

  const email = portal.user?.email
  if (!email) {
    throw new Error("User email is required but not available")
  }

  // Validate email format
  if (!isValidEmail(email)) {
    throw new Error(`Invalid email format: ${email}`)
  }

  return email
}

// Prepare FME parameters for submission
const prepFmeParams = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  const mode: "sync" | "async" = config?.syncMode ? "sync" : "async"
  const base = buildFmeParams(formData, userEmail, mode)
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

// Create and configure SketchViewModel
const createSketchVM = ({
  jmv,
  modules,
  layer,
  onDrawComplete,
  dispatch,
}: {
  jmv: JimuMapView
  modules: EsriModules
  layer: __esri.GraphicsLayer
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void
  dispatch: (action: unknown) => void
}) => {
  const sketchViewModel = new modules.SketchViewModel({
    view: jmv.view,
    layer,
    polygonSymbol: DRAWING_SYMBOLS.polygon as any,
    polylineSymbol: DRAWING_SYMBOLS.polyline as any,
    pointSymbol: DRAWING_SYMBOLS.point as any,
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

  setupSketchEventHandlers(sketchViewModel, onDrawComplete, dispatch, modules)
  return sketchViewModel
}

// Setup SketchViewModel event handlers
const setupSketchEventHandlers = (
  sketchViewModel: __esri.SketchViewModel,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void,
  modules: EsriModules
) => {
  let clickCount = 0

  sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
    switch (evt.state) {
      case "start":
        clickCount = 0
        dispatch(
          fmeActions.setDrawingState(
            true,
            0,
            evt.tool === "rectangle"
              ? DrawingTool.RECTANGLE
              : DrawingTool.POLYGON
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
            dispatch(fmeActions.setClickCount(actualClicks))
            if (actualClicks === 1) {
              dispatch(fmeActions.setViewMode(ViewMode.DRAWING))
            }
          }
        } else if (evt.tool === "rectangle" && clickCount !== 1) {
          clickCount = 1
          dispatch(fmeActions.setClickCount(1))
        }
        break

      case "complete":
        clickCount = 0
        dispatch(fmeActions.setDrawingState(false, 0, undefined))
        onDrawComplete(evt)
        break

      case "cancel":
        clickCount = 0
        dispatch(fmeActions.setDrawingState(false, 0, undefined))
        break
    }
  })
}

// Process FME response
const processFmeResponse = (
  fmeResponse: unknown,
  workspace: string,
  userEmail: string,
  translateFn: (key: string) => string
): ExportResult => {
  const response = fmeResponse as FmeResponse
  const data = response?.data
  if (!data) {
    return {
      success: false,
      message: translateFn("unexpectedFmeResponse"),
      code: "INVALID_RESPONSE",
    }
  }

  const serviceInfo: FmeServiceInfo =
    (data as any).serviceResponse || (data as any)
  const status = serviceInfo?.statusInfo?.status || serviceInfo?.status
  const rawId = (serviceInfo?.jobID ?? serviceInfo?.id) as unknown
  const parsedId =
    typeof rawId === "number" ? rawId : rawId != null ? Number(rawId) : NaN
  const jobId: number | undefined =
    Number.isFinite(parsedId) && parsedId > 0 ? parsedId : undefined

  if (status === "success") {
    return {
      success: true,
      message: translateFn("exportOrderSubmitted"),
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
      translateFn("fmeJobSubmissionFailed"),
    code: "FME_JOB_FAILURE",
  }
}

// Simple area formatting
export function formatArea(area: number, modules: EsriModules): string {
  if (!area || Number.isNaN(area) || area <= 0) return "0 m²"

  const intlModule = (modules as any)?.intl
  const hasIntl = intlModule && typeof intlModule.formatNumber === "function"

  if (area >= GEOMETRY_CONSTS.M2_PER_KM2) {
    const areaInSqKm = area / GEOMETRY_CONSTS.M2_PER_KM2
    if (hasIntl) {
      const formatted = intlModule.formatNumber(areaInSqKm, {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: GEOMETRY_CONSTS.AREA_DECIMALS,
      })
      return `${formatted} km²`
    }
    return `${areaInSqKm.toFixed(GEOMETRY_CONSTS.AREA_DECIMALS)} km²`
  }

  const roundedArea = Math.round(area)
  if (hasIntl) {
    const formatted = intlModule.formatNumber(roundedArea, {
      style: "decimal",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
    return `${formatted} m²`
  }
  return `${roundedArea.toLocaleString()} m²`
}

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

  // Optimized error handling
  const dispatchError = useErrorDispatcher(dispatch)
  const submissionController = useAbortController()

  // Render error view with translation and support hints
  const renderWidgetError = hooks.useEventCallback(
    (
      error: ErrorState | null,
      onRetry?: () => void
    ): React.ReactElement | null => {
      if (!error) return null

      // Determine base error message with translation
      const baseMsgKey = error.message
      let baseMessage = ""
      if (typeof baseMsgKey === "string" && baseMsgKey) {
        try {
          baseMessage = resolveMessageOrKey(baseMsgKey, translate)
        } catch {
          baseMessage = String(baseMsgKey)
        }
      }
      if (!baseMessage) {
        baseMessage = translate("unknownErrorOccurred")
      }

      // Determine support hint
      const ufm = error.userFriendlyMessage
      const supportEmail = getSupportEmail(props.config?.supportEmail)
      const supportHint = buildSupportHintText(
        translate,
        supportEmail,
        typeof ufm === "string" ? ufm : undefined
      )

      // Create actions (retry clears error by default)
      const actions: Array<{ label: string; onClick: () => void }> = []
      const retryHandler =
        onRetry ??
        (() => {
          dispatch(fmeActions.setError(null))
        })
      actions.push({ label: translate("retry"), onClick: retryHandler })

      return (
        <StateView
          // Show the base error message only; render support hint separately below
          state={makeErrorView(baseMessage, {
            code: error.code,
            actions,
          })}
          renderActions={(act, ariaLabel) => {
            // Render support hint, linking email if present
            return (
              <div
                role="group"
                aria-label={ariaLabel}
                data-actions-count={act?.length ?? 0}
              >
                {/* Render support hint on its own row */}
                <div>
                  {renderSupportHint(
                    supportEmail,
                    translate,
                    styles,
                    supportHint
                  )}
                </div>
              </div>
            )
          }}
          center={false}
        />
      )
    }
  )

  const { modules, loading: modulesLoading } = useModules()
  const localMapState = useMapState()

  // Redux state selector and dispatcher
  const isActive = hooks.useWidgetActived(widgetId)

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
      if (!config) {
        return {
          isValid: false,
          error: createStartupError("invalidConfiguration", "ConfigMissing"),
        }
      }

      // Check required fields
      if (!config.fmeServerUrl || config.fmeServerUrl.trim() === "") {
        return {
          isValid: false,
          error: createStartupError("serverUrlMissing", "ServerUrlEmpty"),
        }
      }
      if (!config.fmeServerToken || config.fmeServerToken.trim() === "") {
        return {
          isValid: false,
          error: createStartupError("tokenMissing", "TokenEmpty"),
        }
      }
      if (!config.repository || config.repository.trim() === "") {
        return {
          isValid: false,
          error: createStartupError("repositoryMissing", "RepositoryEmpty"),
        }
      }

      // Workspace is optional, but warn if empty
      return { isValid: true }
    }
  )

  // Startup validation step updater
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

  // Run startup validation with improved error handling
  const runStartupValidation = hooks.useEventCallback(async () => {
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
        // Keep default suggestion for missing map
        setValidationError(mapConfigError)
        return
      }

      // Check if configuration exists and is valid
      const configValidation = validateConfiguration(config)
      if (!configValidation.isValid && configValidation.error) {
        setValidationError(configValidation.error)
        return
      }

      const client = createFmeFlowClient(config)
      setValidationStep(translate("validatingConnection"))
      await makeCancelable(
        Promise.all([
          client.testConnection(),
          client.validateRepository(config.repository),
        ])
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
  })

  // Reset/hide measurement UI and clear layers
  const resetGraphicsAndMeasurements = hooks.useEventCallback(() => {
    if (graphicsLayer) {
      graphicsLayer.removeAll()
    }
  })

  // Drawing complete with enhanced Graphic functionality
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

        // Geometry is valid polygon here
        const geomForUse = geometry as __esri.Polygon

        const calculatedArea = calcArea(geomForUse, modules)

        // Max area validation
        const maxCheck = checkMaxArea(calculatedArea, props.config?.maxArea)
        if (!maxCheck.ok) {
          if (maxCheck.message) {
            dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code)
          }
          return
        }

        // Set visual symbol
        if (evt.graphic) {
          evt.graphic.symbol = HIGHLIGHT_SYMBOL as any
        }

        // Store graphic JSON in Redux for persistence
        const graphicJson = evt.graphic?.toJSON()
        dispatch(fmeActions.setGeometry(graphicJson, Math.abs(calculatedArea)))
        dispatch(fmeActions.setDrawingState(false, 0, undefined))

        // Store current geometry in local state (not Redux - following golden rule)
        setCurrentGeometry(geomForUse)

        dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
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
    const hasGeometry = !!reduxState.geometryJson || !!currentGeometry
    if (!hasGeometry || !reduxState.selectedWorkspace) {
      return false
    }

    // Re-validate area constraints before submission
    const maxCheck = checkMaxArea(reduxState.drawnArea, props.config?.maxArea)
    if (!maxCheck.ok && maxCheck.message) {
      dispatchError(maxCheck.message, ErrorType.VALIDATION, maxCheck.code)
      return false
    }

    return true
  }

  // Handle successful submission
  const finalizeOrder = hooks.useEventCallback((result: ExportResult) => {
    dispatch(fmeActions.setOrderResult(result))
    dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT))
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
    const errorMessage =
      getErrorMessage(error) || translate("unknownErrorOccurred")
    // Build localized failure message and append contact support hint
    const configured = getSupportEmail(props.config?.supportEmail)
    const contactHint = buildSupportHintText(translate, configured)
    const baseFailMessage = translate("orderFailed")
    const resultMessage =
      `${baseFailMessage}. ${errorMessage}. ${contactHint}`.trim()
    const result: ExportResult = {
      success: false,
      message: resultMessage,
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

      // Prepare parameters differently for sync vs async
      const fmeParameters = prepFmeParams(
        formData,
        userEmail,
        reduxState.geometryJson,
        currentGeometry,
        props.config
      )

      // Use the optimized abort controller
      const controller = submissionController.create()

      // For test environments, record the parameters synchronously so tests can
      // assert that a submission was attempted without relying on fetch mocks.
      const finalParams = applyDirectiveDefaults(fmeParameters, props.config)
      try {
        ;(global as any).__LAST_FME_CALL__ = { workspace, params: finalParams }
      } catch (e) {
        // ignore any issues writing to global in constrained runtimes
      }

      // Submit to FME Flow
      const fmeResponse = await makeCancelable(
        fmeClient.runDataDownload(
          workspace,
          finalParams,
          undefined,
          controller.signal
        )
      )

      handleSubmissionSuccess(fmeResponse, workspace, userEmail)
    } catch (error) {
      handleSubmissionError(error)
    } finally {
      dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: false }))
      // Clear controller after completion
      submissionController.cancel()
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
      const layer = createLayers(jmv, modules, setGraphicsLayer)
      const svm = createSketchVM({
        jmv,
        modules,
        layer,
        onDrawComplete,
        dispatch,
      })
      setSketchViewModel(svm)
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

  // If widget loses activation, cancel any in-progress drawing to avoid dangling operations
  hooks.useUpdateEffect(() => {
    if (!isActive && sketchViewModel) {
      try {
        sketchViewModel.cancel()
      } catch (e) {
        // noop
      }
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
      submissionController.cancel()
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
    } catch (e) {
      // ignore cancellation errors
    }

    // Start drawing immediately; prior cancel avoids overlap
    const arg: "rectangle" | "polygon" =
      tool === DrawingTool.RECTANGLE ? "rectangle" : "polygon"
    if (sketchViewModel?.create) {
      sketchViewModel.create(arg)
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
    reduxState.clickCount === 0 &&
    sketchViewModel &&
    !reduxState.isSubmittingOrder

  hooks.useUpdateEffect(() => {
    // Only auto-start if not already started and widget is not closed
    if (canAutoStartDrawing && runtimeState !== WidgetState.Closed) {
      handleStartDrawing(reduxState.drawingTool)
    }
  }, [
    reduxState.viewMode,
    reduxState.clickCount,
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
    submissionController.cancel()

    // Cancel any in-progress drawing
    if (sketchViewModel) {
      try {
        sketchViewModel.cancel()
      } catch (e) {
        // ignore cancellation errors
      }
    }

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
  hooks.useUpdateEffect(() => {
    // Reset when widget is closed
    if (
      runtimeState === WidgetState.Closed &&
      prevRuntimeState !== WidgetState.Closed
    ) {
      handleReset()
    }
  }, [runtimeState, prevRuntimeState, handleReset])

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
      // Other errors
      return renderWidgetError(reduxState.error)
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
          reduxState.isDrawing,
          reduxState.clickCount
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
        formatArea={(area: number) => formatArea(area, modules)}
        drawingMode={reduxState.drawingTool}
        onDrawingModeChange={(tool) => {
          dispatch(fmeActions.setDrawingTool(tool))

          // If already in drawing mode, restart drawing with new tool
          if (
            reduxState.viewMode === ViewMode.DRAWING &&
            reduxState.clickCount === 0 &&
            sketchViewModel
          ) {
            try {
              sketchViewModel.cancel()
            } catch (e) {
              // ignore cancellation errors
            }
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
    </div>
  )
}

// Map extra state props for the widget
Reflect.set(
  Widget as any,
  "mapExtraStateProps",
  (state: IMStateWithFmeExport) => {
    const widgetState = state["fme-state"]
    return { state: (widgetState as any) || initialFmeState }
  }
)
