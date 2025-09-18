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
  SessionManager,
} from "jimu-core"
import { JimuMapViewComponent, type JimuMapView } from "jimu-arcgis"
import { Workflow } from "./components/workflow"
import {
  StateView,
  useStyles,
  renderSupportHint,
  Button,
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
} from "../config"
import {
  makeErrorView,
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  LAYER_CONFIG,
  VIEW_ROUTES,
} from "../config"
import { validateWidgetStartup } from "../shared/services"
import {
  mapErrorToKey,
  isValidEmail,
  getSupportEmail,
  isValidExternalUrlForOptGetUrl,
  calcArea,
  validatePolygon,
  checkMaxArea,
  isPolygonGeometry,
  processFmeResponse,
} from "../shared/validations"
import { fmeActions, initialFmeState } from "../extensions/store"
import { resolveMessageOrKey, buildSupportHintText } from "../shared/utils"

// Dynamic ESRI module loader with test environment support
const loadEsriModules = async (
  modules: readonly string[]
): Promise<unknown[]> => {
  // Check for test environment first for better performance
  if (process.env.NODE_ENV === "test") {
    const testStub = (global as any).__ESRI_TEST_STUB__
    if (typeof testStub === "function") {
      try {
        const stubbed = testStub(modules)
        if (Array.isArray(stubbed)) return stubbed
      } catch (_) {
        // fall through to real loader
      }
    }
  }

  // Use jimu-arcgis loader in production - EXB best practice
  const { loadArcGISJSAPIModules } = await import("jimu-arcgis")
  const loaded = await loadArcGISJSAPIModules(modules as string[])
  return loaded.map((m: any) => m?.default ?? m)
}

// Styling and symbols
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

// Area calculation and formatting
const GEOMETRY_CONSTS = {
  M2_PER_KM2: 1_000_000, // m² -> 1 km²
  AREA_DECIMALS: 2,
} as const

// Module loading hook
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
        const loaded = await loadEsriModules(MODULES)
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

    void loadModules()
    return () => {
      cancelled = true
    }
  })

  return state
}

// Map state management
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

  // Centralized cleanup with improved error handling and safety checks
  const cleanupResources = hooks.useEventCallback(() => {
    const { sketchViewModel, graphicsLayer, jimuMapView } = mapResources

    // Safely cancel sketch operations
    if (sketchViewModel?.activeTool) {
      try {
        sketchViewModel.cancel()
        if (typeof sketchViewModel.destroy === "function") {
          sketchViewModel.destroy()
        }
      } catch (error) {
        console.warn("Widget - Error cleaning up SketchViewModel:", error)
      }
    }

    // Safely remove and clear graphics layer
    if (graphicsLayer) {
      try {
        if (jimuMapView?.view?.map && graphicsLayer.parent) {
          jimuMapView.view.map.remove(graphicsLayer)
        }
        if (typeof graphicsLayer.removeAll === "function") {
          graphicsLayer.removeAll()
        }
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
    }
    dispatch(fmeActions.setError(error, widgetId))
  })

// Abort controller
const useAbortController = () => {
  const ref = React.useRef<AbortController | null>(null)

  const cancel = hooks.useEventCallback(() => {
    ref.current?.abort()
    ref.current = null
  })

  const create = hooks.useEventCallback(() => {
    cancel()
    ref.current = new AbortController()
    return ref.current
  })

  return { ref, cancel, create }
}

// Determine service mode based on form values and config
const determineServiceMode = (
  formData: unknown,
  config?: FmeExportConfig
): "sync" | "async" | "schedule" => {
  const data = (formData as any)?.data || {}
  const startValRaw = data.start as unknown
  const hasStart = typeof startValRaw === "string" && startValRaw.trim().length > 0
  if (config?.allowScheduleMode && hasStart) return "schedule"
  const override = data._serviceMode as string
  if (override === "sync" || override === "async" || override === "schedule") {
    return override as any
  }
  return config?.syncMode ? "sync" : "async"
}

// Build base FME parameters
const buildFmeParams = (
  formData: unknown,
  userEmail: string,
  serviceMode: "sync" | "async" | "schedule" = "async"
): { [key: string]: unknown } => {
  const data = (formData as { data?: { [key: string]: unknown } })?.data || {}
  // allowlist service mode
  const allowedModes = ["sync", "async", "schedule"] as const
  const mode = (allowedModes as readonly string[]).includes(serviceMode)
    ? serviceMode
    : "async"
  const base = {
    ...data,
    opt_servicemode: mode,
    opt_responseformat: "json",
    opt_showresult: "true",
  } as { [key: string]: unknown }
  // Only include requester email for async mode
  if (mode === "async" && typeof userEmail === "string" && userEmail.trim()) {
    base.opt_requesteremail = userEmail
  }
  return base
}

// Helper: build GeoJSON Polygon from Esri polygon JSON
const polygonJsonToGeoJson = (poly: any): any => {
  const rings = Array.isArray(poly?.rings) ? poly.rings : []
  const coords = rings.map((ring: any[]) =>
    (Array.isArray(ring) ? ring : []).map((pt: any) => [pt[0], pt[1]])
  )
  return { type: "Polygon", coordinates: coords }
}

// Helper: build WKT POLYGON or MULTIPOLYGON from Esri polygon JSON
const polygonJsonToWkt = (poly: any): string => {
  const rings = Array.isArray(poly?.rings) ? poly.rings : []
  if (!rings.length) return "POLYGON EMPTY"

  // FME/WKT expects outer ring(s) CCW and holes CW, but we'll emit rings as-is
  // using polygon with inner rings.
  const ringToText = (ring: any[]): string => {
    const arr = Array.isArray(ring) ? ring.slice() : []
    // Ensure ring is closed (first == last)
    if (arr.length > 0) {
      const first = arr[0]
      const last = arr[arr.length - 1]
      const same =
        Array.isArray(first) &&
        Array.isArray(last) &&
        first.length >= 2 &&
        last.length >= 2 &&
        first[0] === last[0] &&
        first[1] === last[1]
      if (!same) arr.push(first)
    }
    const coords = arr.map((pt: any) => `${pt[0]} ${pt[1]}`).join(", ")
    return `(${coords})`
  }

  // Group first ring as shell and remaining as holes for a single polygon
  const wktRings = rings.map(ringToText).join(", ")
  return `POLYGON(${wktRings})`
}

// Convert polygon JSON to WGS84 if needed, using provided Esri modules.
const toWgs84PolygonJson = (
  polyJson: any,
  modules: EsriModules | null | undefined
): any => {
  try {
    const Polygon = modules?.Polygon
    const wmUtils = modules?.webMercatorUtils
    if (!Polygon) return polyJson

    const poly = Polygon.fromJSON(polyJson)
    const wkid = poly?.spatialReference?.wkid

    // Already WGS84
    if (wkid === 4326) return poly.toJSON()

    // WebMercator -> WGS84
    if (wkid === 3857 && wmUtils?.webMercatorToGeographic) {
      const g = wmUtils.webMercatorToGeographic(poly) as __esri.Polygon
      return g?.toJSON?.() ?? poly.toJSON()
    }
    return poly.toJSON()
  } catch {
    // On any failure, return original input unmodified
    return polyJson
  }
}

// Attach AOI to FME parameters
const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  // Sanitize parameter name to safe characters
  const rawName = (config?.aoiParamName || "AreaOfInterest").toString()
  const safeName = rawName.replace(/[^A-Za-z0-9_\-]/g, "").trim()
  const paramName = safeName || "AreaOfInterest"
  let aoiJson: unknown = null

  // Use the provided geometry JSON if it's a valid polygon
  if (isPolygonGeometry(geometryJson)) {
    aoiJson = "geometry" in geometryJson ? geometryJson.geometry : geometryJson
  } else {
    // As a fallback, use the current geometry from the map state
    const geometryToUse = currentGeometry?.toJSON()
    if (isPolygonGeometry(geometryToUse)) {
      aoiJson = geometryToUse
    }
  }

  if (aoiJson) {
    try {
      const serialized = JSON.stringify(aoiJson)
      const out: { [key: string]: unknown } = {
        ...base,
        [paramName]: serialized,
      }

      // Optionally add GeoJSON AOI if configured
      const gjName = (config?.aoiGeoJsonParamName || "").toString().trim()
      if (gjName) {
        try {
          const wgs84Poly = toWgs84PolygonJson(aoiJson, modules)
          const geojson = polygonJsonToGeoJson(wgs84Poly)
          out[gjName] = JSON.stringify(geojson)
        } catch (e) {
          // ignore geojson conversion failure, keep Esri JSON
        }
      }

      // Optionally add WKT AOI if configured
      const wktName = (config?.aoiWktParamName || "").toString().trim()
      if (wktName) {
        try {
          const wgs84Poly = toWgs84PolygonJson(aoiJson, modules)
          const wkt = polygonJsonToWkt(wgs84Poly)
          out[wktName] = wkt
        } catch (e) {
          // ignore wkt conversion failure, keep Esri JSON
        }
      }

      return out
    } catch (_) {
      // If we have geometry but cannot serialize, signal a user-facing error via a marker key.
      // The caller path will convert this into a localized error message.
      const err: ErrorState = {
        message: "GEOMETRY_SERIALIZATION_FAILED",
        type: ErrorType.GEOMETRY,
        code: "GEOMETRY_SERIALIZATION_FAILED",
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestamp: new Date(),
        timestampMs: Date.now(),
      }
      // Store an error marker to be handled by submission path
      return { ...base, __aoi_error__: err }
    }
  }

  return base
}

// Get and validate user email
const getEmail = async (_config?: FmeExportConfig): Promise<string> => {
  const user = await SessionManager.getInstance().getUserInfo()
  const email = user?.email
  if (!email) {
    const err = new Error("MISSING_REQUESTER_EMAIL")
    err.name = "MISSING_REQUESTER_EMAIL"
    throw err
  }
  if (!isValidEmail(email)) {
    const err = new Error("INVALID_EMAIL")
    err.name = "INVALID_EMAIL"
    throw err
  }
  return email
}

// Prepare FME parameters for submission
const prepFmeParams = (
  formData: unknown,
  userEmail: string,
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  modules: EsriModules | null | undefined,
  config?: FmeExportConfig
): { [key: string]: unknown } => {
  const data = (formData as any)?.data || {}
  // Determine service mode consistently
  const chosen = determineServiceMode({ data }, config)

  // Ensure schedule directives when chosen
  if (chosen === "schedule") {
    if (!data.trigger) data.trigger = "runonce"
    // 'start' expected in 'YYYY-MM-DD HH:mm:ss' from the form
  }

  const base = buildFmeParams({ data }, userEmail, chosen)
  const withAoi = attachAoi(
    base,
    geometryJson,
    currentGeometry,
    modules,
    config
  )
  return applyDirectiveDefaults(withAoi, config)
}

// Apply admin defaults for FME Task Manager directives
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
    if (v) out.tm_tag = v.substring(0, 128)
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
  widgetId,
}: {
  jmv: JimuMapView
  modules: EsriModules
  layer: __esri.GraphicsLayer
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void
  dispatch: (action: unknown) => void
  widgetId: string
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

  setupSketchEventHandlers(
    sketchViewModel,
    onDrawComplete,
    dispatch,
    modules,
    widgetId
  )
  return sketchViewModel
}

// Setup SketchViewModel event handlers
const setupSketchEventHandlers = (
  sketchViewModel: __esri.SketchViewModel,
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void,
  dispatch: (action: unknown) => void,
  modules: EsriModules,
  widgetId: string
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
            dispatch(fmeActions.setClickCount(actualClicks, widgetId))
            if (actualClicks === 1) {
              dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
            }
          }
        } else if (evt.tool === "rectangle" && clickCount !== 1) {
          clickCount = 1
          dispatch(fmeActions.setClickCount(1, widgetId))
        }
        break

      case "complete":
        clickCount = 0
        dispatch(fmeActions.setDrawingState(false, 0, undefined, widgetId))
        onDrawComplete(evt)
        break

      case "cancel":
        clickCount = 0
        dispatch(fmeActions.setDrawingState(false, 0, undefined, widgetId))
        break
    }
  })
}

// Area formatting with i18n support
export function formatArea(area: number, modules: EsriModules): string {
  if (!area || Number.isNaN(area) || area <= 0) return "0 m²"

  // Use consistent formatting approach
  const formatNumber = (value: number, decimals: number): string => {
    const intlModule = (modules as any)?.intl
    if (intlModule && typeof intlModule.formatNumber === "function") {
      return intlModule.formatNumber(value, {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      })
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })
  }

  if (area >= GEOMETRY_CONSTS.M2_PER_KM2) {
    const areaInSqKm = area / GEOMETRY_CONSTS.M2_PER_KM2
    const formatted = formatNumber(areaInSqKm, GEOMETRY_CONSTS.AREA_DECIMALS)
    return `${formatted} km²`
  }

  const roundedArea = Math.round(area)
  const formatted = formatNumber(roundedArea, 0)
  return `${formatted} m²`
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

  // Error handling
  const dispatchError = useErrorDispatcher(dispatch, widgetId)
  const submissionController = useAbortController()

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
      let baseMessage = ""
      if (typeof baseMsgKey === "string" && baseMsgKey) {
        try {
          baseMessage = resolveMessageOrKey(baseMsgKey, translate)
        } catch {
          baseMessage = String(baseMsgKey)
        }
      }
      if (!baseMessage) {
        // Try error.suggestion or error.message as fallback
        if (error.code) {
          try {
            baseMessage = resolveMessageOrKey(error.code, translate)
          } catch {}
        }
        if (!baseMessage) baseMessage = translate("unknownErrorOccurred")
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
          dispatch(fmeActions.setError(null, widgetId))
        })
      actions.push({ label: translate("retry"), onClick: retryHandler })

      // If offline, offer a reload action for convenience
      try {
        const nav = (globalThis as any)?.navigator
        if (nav && nav.onLine === false) {
          actions.push({
            label: translate("reload"),
            onClick: () => {
              try {
                ;(globalThis as any).location?.reload()
              } catch {}
            },
          })
        }
      } catch {}

      return (
        <StateView
          // Show the base error message only; render support hint separately below
          state={makeErrorView(baseMessage, {
            code: error.code,
            actions,
          })}
          renderActions={(act, ariaLabel) => (
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

  // Startup validation step updater
  const setValidationStep = hooks.useEventCallback((step: string) => {
    dispatch(fmeActions.setStartupValidationState(true, step, null, widgetId))
  })

  const setValidationSuccess = hooks.useEventCallback(() => {
    dispatch(
      fmeActions.setStartupValidationState(false, undefined, null, widgetId)
    )
    // Reset any existing error state
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
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
      userFriendlyMessage: props.config?.supportEmail
        ? String(props.config.supportEmail)
        : "",
      suggestion: translate("retryValidation"),
      retry,
    })
  )

  // Keep track of ongoing startup validation to allow aborting
  const startupAbortRef = React.useRef<AbortController | null>(null)

  // Startup validation
  const runStartupValidation = hooks.useEventCallback(async () => {
    // Skip if widget is not active
    if (startupAbortRef.current) {
      try {
        startupAbortRef.current.abort()
      } catch (_) {}
      startupAbortRef.current = null
    }
    const controller = new AbortController()
    startupAbortRef.current = controller
    setValidationStep(translate("validatingConfiguration"))

    try {
      // Step 1: validate map configuration
      setValidationStep(translate("validatingMapConfiguration"))
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
      if (!hasMapConfigured) {
        const mapConfigError = createStartupError(
          "mapNotConfigured",
          "MapNotConfigured",
          runStartupValidation
        )
        setValidationError(mapConfigError)
        return
      }

      // Step 2: validate widget configuration and FME connection using shared service
      setValidationStep(translate("validatingConnection"))
      const validationResult = await validateWidgetStartup({
        config,
        translate,
        signal: controller.signal,
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
      if (!props.config?.syncMode) {
        setValidationStep(translate("validatingUserEmail"))
        try {
          const email = await getEmail(props.config)
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
      console.error("FME Export - Startup validation failed:", err)
      const errorKey = mapErrorToKey(err) || "unknownErrorOccurred"
      const errorCode =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as any).code)
          : "STARTUP_VALIDATION_FAILED"
      setValidationError(
        createStartupError(errorKey, errorCode, runStartupValidation)
      )
    }
    // Clear abort ref if it is still the current controller
    if (startupAbortRef.current === controller) {
      startupAbortRef.current = null
    }
  })

  // Track if this is the initial load
  const isInitialLoadRef = React.useRef(true)

  // Run startup validation when widget first loads
  hooks.useEffectOnce(() => {
    isInitialLoadRef.current = false
    runStartupValidation()
  })

  // Reset widget state for re-validation
  const resetForRevalidation = hooks.useEventCallback(
    (alsoCleanupMapResources = false) => {
      // Cancel any ongoing submission
      submissionController.cancel()
      if (sketchViewModel) {
        try {
          sketchViewModel.cancel()
        } catch (_) {}
      }
      if (graphicsLayer) {
        try {
          graphicsLayer.removeAll()
        } catch (_) {}
      }
      // Reset local state
      setCurrentGeometry(null)
      if (alsoCleanupMapResources) {
        try {
          cleanupResources()
        } catch (_) {}
      }
      // Reset redux state
      dispatch(fmeActions.setViewMode(ViewMode.STARTUP_VALIDATION, widgetId))
      dispatch(fmeActions.setGeometry(null, 0, widgetId))
      dispatch(fmeActions.setDrawingState(false, 0, undefined, widgetId))
      dispatch(fmeActions.setError(null, widgetId))
      dispatch(
        fmeActions.setSelectedWorkspace(
          null,
          props.config?.repository,
          widgetId
        )
      )
      dispatch(
        fmeActions.setWorkspaceParameters(
          [],
          "",
          props.config?.repository,
          widgetId
        )
      )
      dispatch(
        fmeActions.setWorkspaceItem(null, props.config?.repository, widgetId)
      )
      dispatch(fmeActions.setFormValues({}, widgetId))
      dispatch(fmeActions.setOrderResult(null, widgetId))
    }
  )

  // Track previous key connection settings to detect what changed
  const prevConnRef = React.useRef<{
    url?: string
    token?: string
    repo?: string
  }>({
    url: props.config?.fmeServerUrl,
    token: props.config?.fmeServerToken,
    repo: props.config?.repository,
  })

  // React to config changes with scoped behavior
  React.useEffect(() => {
    if (isInitialLoadRef.current) return

    const prev = prevConnRef.current
    const next = {
      url: props.config?.fmeServerUrl,
      token: props.config?.fmeServerToken,
      repo: props.config?.repository,
    }

    const serverChanged = prev.url !== next.url
    const tokenChanged = prev.token !== next.token
    const repoChanged = prev.repo !== next.repo

    // Update prev snapshot early to avoid races
    prevConnRef.current = next

    try {
      if (serverChanged || tokenChanged) {
        // Full revalidation required when connection credentials change
        resetForRevalidation(false)
        runStartupValidation()
      } else if (repoChanged) {
        // Repository change only requires resetting selection and revalidation
        if (startupAbortRef.current) {
          try {
            startupAbortRef.current.abort()
          } catch (_) {}
          startupAbortRef.current = null
        }
      }
    } catch (error) {
      console.warn("Error handling config change:", error)
    }
  }, [props.config, resetForRevalidation, runStartupValidation])

  // React to map selection changes by re-running startup validation
  React.useEffect(() => {
    if (isInitialLoadRef.current) return
    try {
      // If no map is configured, also cleanup map resources
      const hasMapConfigured =
        Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
      resetForRevalidation(!hasMapConfigured)
    } catch (error) {
      console.warn(
        "Error resetting widget state on map selection change:",
        error
      )
    }

    // Re-run validation with new map selection
    runStartupValidation()
  }, [useMapWidgetIds, resetForRevalidation, runStartupValidation])

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
            dispatch(fmeActions.setError(validation.error, widgetId))
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

        // Update Redux state
        dispatch(
          fmeActions.setGeometry(
            geomForUse as any,
            Math.abs(calculatedArea),
            widgetId
          )
        )
        dispatch(fmeActions.setDrawingState(false, 0, undefined, widgetId))

        // Store current geometry in local state (not Redux - following golden rule)
        setCurrentGeometry(geomForUse)

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
    const configured = getSupportEmail(props.config?.supportEmail)
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

    try {
      // Determine mode early from form data for email requirement
      const rawDataEarly = (formData as any)?.data || {}
      const earlyMode = determineServiceMode({ data: rawDataEarly }, props.config)
      // Fetch email only for async mode
      const [userEmail, fmeClient] = await Promise.all([
        earlyMode === "async" ? getEmail(props.config) : Promise.resolve(""),
        Promise.resolve(createFmeFlowClient(props.config)),
      ])

      const workspace = reduxState.selectedWorkspace

      // Create abort controller for this request (used for optional upload and run)
      const controller = submissionController.create()

      // Prepare parameters and handle remote URL / direct upload if present
      const rawData = (formData as any)?.data || {}

      // Identify a file uploaded via our explicit upload field
      const uploadFile: File | null = rawData.__upload_file__ || null

      // Build baseline params first (without opt_geturl)
      const baseParams = prepFmeParams(
        {
          data: {
            ...rawData,
            opt_geturl: undefined,
            __upload_file__: undefined,
            __remote_dataset_url__: undefined,
          },
        },
        userEmail,
        reduxState.geometryJson,
        currentGeometry,
        modules,
        props.config
      )

      // Detect AOI serialization failure injected by attachAoi
      if ((baseParams as any).__aoi_error__) {
        const aoiErr = (baseParams as any).__aoi_error__ as ErrorState
        // Surface user-friendly error and stop
        dispatch(fmeActions.setError(aoiErr, widgetId))
        return
      }

      // Prefer opt_geturl when a valid URL is provided; otherwise fall back to upload when available
      let finalParams: { [key: string]: unknown } = { ...baseParams }
      const remoteUrlRaw = rawData.__remote_dataset_url__ as string | undefined
      const remoteUrl =
        typeof remoteUrlRaw === "string" ? remoteUrlRaw.trim() : ""
      const urlFeatureOn = Boolean(props.config?.allowRemoteUrlDataset)

      // First pass: set opt_geturl only if URL is valid
      if (
        urlFeatureOn &&
        remoteUrl &&
        isValidExternalUrlForOptGetUrl(remoteUrl)
      ) {
        finalParams.opt_geturl = remoteUrl
      }

      // Second pass: if no opt_geturl set, consider upload fallback
      const wantsUpload =
        props.config?.allowRemoteDataset && uploadFile instanceof File
      if (typeof finalParams.opt_geturl === "undefined" && wantsUpload) {
        const fmeClientForUpload = createFmeFlowClient(props.config)
        const subfolder = `widget_${(props as any)?.id || "fme"}`
        const uploadResp = await makeCancelable(
          fmeClientForUpload.uploadToTemp(uploadFile, {
            subfolder,
            signal: controller.signal,
          })
        )
        const uploadedPath = (uploadResp?.data as any)?.path

        // Find a suitable workspace parameter to assign the uploaded path
        const params = reduxState.workspaceParameters || []
        const explicitNameRaw = (props.config as any)?.uploadTargetParamName
        const explicitName =
          typeof explicitNameRaw === "string" && explicitNameRaw.trim()
            ? explicitNameRaw.trim()
            : null
        if (uploadedPath && explicitName) {
          finalParams[explicitName] = uploadedPath
        } else {
          const candidate = params.find((p: any) =>
            [
              "FILENAME",
              "FILENAME_MUSTEXIST",
              "DIRNAME",
              "DIRNAME_MUSTEXIST",
              "DIRNAME_SRC",
              "LOOKUP_FILE",
              "REPROJECTION_FILE",
            ].includes(String(p?.type))
          )

          if (uploadedPath && candidate?.name) {
            finalParams[candidate.name] = uploadedPath
          } else if (uploadedPath) {
            // Fallback to a common parameter name if present
            if (typeof (finalParams as any).SourceDataset === "undefined") {
              ;(finalParams as any).SourceDataset = uploadedPath
            }
          }
        }
      }

      // Apply admin defaults and record for testing
      finalParams = applyDirectiveDefaults(finalParams, props.config)
      // Ensure hidden error marker isn't leaked
      try {
        delete (finalParams as any).__aoi_error__
      } catch {}
      try {
        ;(global as any).__LAST_FME_CALL__ = { workspace, params: finalParams }
      } catch {
        // Ignore global write errors in constrained environments
      }

      // Submit to FME Flow
      const serviceType = props.config?.service || "download"
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
      // Abort any in-flight startup validation
      if (startupAbortRef.current) {
        try {
          startupAbortRef.current.abort()
        } catch (_) {}
        startupAbortRef.current = null
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
    dispatch(fmeActions.setDrawingState(true, 0, tool, widgetId))
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))

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
    dispatch(fmeActions.setGeometry(null, 0, widgetId))
    dispatch(
      fmeActions.setDrawingState(false, 0, reduxState.drawingTool, widgetId)
    )
    dispatch(fmeActions.setClickCount(0, widgetId))
    dispatch(fmeActions.setError(null, widgetId))
    dispatch(fmeActions.setImportError(null, widgetId))
    dispatch(fmeActions.setExportError(null, widgetId))
    dispatch(fmeActions.setOrderResult(null, widgetId))
    dispatch(
      fmeActions.setSelectedWorkspace(null, props.config?.repository, widgetId)
    )
    // Reset workspace parameters and item
    dispatch(fmeActions.setFormValues({}, widgetId))
    // Reset workspace parameters
    dispatch(
      fmeActions.setLoadingFlags(
        {
          isModulesLoading: false,
          isSubmittingOrder: false,
        } as any,
        widgetId
      )
    )
    // Reset view mode to initial
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId))
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
      dispatch(
        fmeActions.setSelectedWorkspace(
          workspaceName,
          props.config?.repository,
          widgetId
        )
      )
      dispatch(
        fmeActions.setWorkspaceParameters(
          parameters,
          workspaceName,
          props.config?.repository,
          widgetId
        )
      )
      dispatch(
        fmeActions.setWorkspaceItem(
          workspaceItem,
          props.config?.repository,
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
          runStartupValidation
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

  if (reduxState.error && reduxState.error.severity === "error") {
    // Handle other errors (non-startup validation)
    return <div css={styles.parent}>{renderWidgetError(reduxState.error)}</div>
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
          dispatch(fmeActions.setDrawingTool(tool, widgetId))

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
  getEmail,
  attachAoi,
  isValidExternalUrlForOptGetUrl,
  prepFmeParams,
  calcArea,
  validatePolygon,
  processFmeResponse,
}
