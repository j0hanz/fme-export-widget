import {
  React,
  type AllWidgetProps,
  hooks,
  type ImmutableObject,
  MutableStoreManager,
  FormattedMessage,
} from "jimu-core"
import { SVG, Message } from "jimu-ui"
import {
  JimuMapViewComponent,
  type JimuMapView,
  loadArcGISJSAPIModules,
} from "jimu-arcgis"
import { Content } from "./components/content"
import { StateRenderer } from "./components/state"
import { createFmeFlowClient } from "../shared/api"
import distanceIcon from "../assets/icons/trace-path.svg"
import areaIcon from "../assets/icons/polygon.svg"
import centroidIcon from "../assets/icons/pin-esri.svg"
import defaultMessages from "../translations/default"
import {
  formatArea,
  createGeometryFromTemplate,
  downloadJSON,
  createLoadingWrapper,
  createMeasurementGraphics,
  configureMeasurementWidget,
} from "../shared/utils"
import { STYLES } from "../shared/css"
import type {
  FmeExportConfig,
  EsriModules,
  AreaTemplate,
  ExportResult,
  RealTimeMeasurements,
  IMStateWithFmeExport,
  FmeWidgetState,
  NotificationState,
  MeasurementProps,
} from "../shared/types"
import {
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  StateType,
  FmeActionType,
  LAYER_CONFIG,
  TEMPLATE_ID_CONFIG,
} from "../shared/types"
import { fmeActions } from "../extensions/store"
import {
  GeometryOperatorsService,
  TemplatePersistenceService,
  ErrorHandlingService,
  AppStateService,
} from "../shared/services"

// Measurement display component for UI consistency
const MeasurementOverlay: React.FC<MeasurementProps> = ({
  data,
  translate,
}) => {
  if (!data) return null

  const items: React.ReactNode[] = []

  // Distance display
  if (data.distance !== undefined) {
    const distance = data.distance
    let distanceText: string

    if (distance === 0) {
      distanceText = "0 m"
    } else if (distance >= 1000) {
      distanceText = `${(distance / 1000).toFixed(2)} km`
    } else {
      distanceText = `${distance.toFixed(1)} m`
    }

    items.push(
      <div key="distance" style={STYLES.measureItem}>
        <SVG
          src={distanceIcon}
          size={18}
          currentColor={true}
          aria-label={translate?.("distanceMeasurement") || "Distance"}
        />
        <div style={STYLES.measureGroup}>
          <div style={STYLES.measureValue}>{distanceText}</div>
        </div>
      </div>
    )
  }

  // Area display using the formatArea utility
  if (data.area !== undefined) {
    items.push(
      <div key="area" style={STYLES.measureItem}>
        <SVG src={areaIcon} size={18} currentColor={true} aria-label="Area" />
        <div style={STYLES.measureGroup}>
          <div style={STYLES.measureValue}>{formatArea(data.area)}</div>
        </div>
      </div>
    )
  }

  // Centroid display
  if (data.centroid) {
    const { x, y } = data.centroid
    items.push(
      <div key="centroid" style={STYLES.measureItem}>
        <SVG
          src={centroidIcon}
          size={18}
          currentColor={true}
          aria-label="Centroid"
        />
        <div style={STYLES.measureGroup}>
          <div style={STYLES.measureValue}>
            {x.toFixed(1)}, {y.toFixed(1)}
          </div>
        </div>
      </div>
    )
  }

  // Drawing progress status
  if (data.drawingProgress) {
    const { pointsAdded } = data.drawingProgress
    const statusText =
      pointsAdded === 1 ? (
        <FormattedMessage
          id="secondPointInstruction"
          defaultMessage="Click to add second point"
        />
      ) : (
        <FormattedMessage
          id="finishDrawingInstruction"
          defaultMessage="Double-click to finish drawing"
        />
      )

    items.push(
      <div key="progress" style={STYLES.measureItem}>
        <div style={STYLES.measureGroup}>
          <div style={STYLES.typography.caption}>{statusText}</div>
        </div>
      </div>
    )
  }

  return items.length > 0 ? (
    <div style={STYLES.measureGroup}>{items}</div>
  ) : null
}

// Custom hook for loading ArcGIS modules - simplified and optimized
const useArcGISModules = (widgetId?: string, dispatch?: any) => {
  const [modules, setModules] = React.useState<EsriModules | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<any>(null)

  const makeCancelable = hooks.useCancelablePromiseMaker()

  const loadModules = hooks.useEventCallback(async () => {
    if (widgetId && dispatch) {
      dispatch(fmeActions.setLoadingFlags({ isModulesLoading: true }))
    }
    setLoading(true)
    setError(null)

    try {
      const [
        Sketch,
        GraphicsLayer,
        Graphic,
        Polygon,
        Polyline,
        Point,
        Extent,
        SpatialReference,
        TextSymbol,
        SimpleMarkerSymbol,
        SimpleLineSymbol,
        PictureMarkerSymbol,
        Measurement,
        Search,
        LayerList,
        BasemapGallery,
        Compass,
        Home,
        areaOperator,
        geodeticAreaOperator,
        lengthOperator,
        geodeticLengthOperator,
        centroidOperator,
        simplifyOperator,
        bufferOperator,
        geodesicBufferOperator,
        convexHullOperator,
      ] = await makeCancelable(
        loadArcGISJSAPIModules([
          "esri/widgets/Sketch",
          "esri/layers/GraphicsLayer",
          "esri/Graphic",
          "esri/geometry/Polygon",
          "esri/geometry/Polyline",
          "esri/geometry/Point",
          "esri/geometry/Extent",
          "esri/geometry/SpatialReference",
          "esri/symbols/TextSymbol",
          "esri/symbols/SimpleMarkerSymbol",
          "esri/symbols/SimpleLineSymbol",
          "esri/symbols/PictureMarkerSymbol",
          "esri/widgets/Measurement",
          "esri/widgets/Search",
          "esri/widgets/LayerList",
          "esri/widgets/BasemapGallery",
          "esri/widgets/Compass",
          "esri/widgets/Home",
          "esri/geometry/operators/areaOperator",
          "esri/geometry/operators/geodeticAreaOperator",
          "esri/geometry/operators/lengthOperator",
          "esri/geometry/operators/geodeticLengthOperator",
          "esri/geometry/operators/centroidOperator",
          "esri/geometry/operators/simplifyOperator",
          "esri/geometry/operators/bufferOperator",
          "esri/geometry/operators/geodesicBufferOperator",
          "esri/geometry/operators/convexHullOperator",
        ])
      )

      const loadedModules: EsriModules = {
        Sketch,
        GraphicsLayer,
        Graphic,
        Polygon,
        Polyline,
        Point,
        Extent,
        SpatialReference,
        TextSymbol,
        SimpleMarkerSymbol,
        SimpleLineSymbol,
        PictureMarkerSymbol,
        Measurement,
        Search,
        LayerList,
        BasemapGallery,
        Compass,
        Home,
        areaOperator,
        geodeticAreaOperator,
        lengthOperator,
        geodeticLengthOperator,
        centroidOperator,
        simplifyOperator,
        bufferOperator,
        geodesicBufferOperator,
        convexHullOperator,
      }

      setModules(loadedModules)
      setLoading(false)

      // Store modules in MutableStoreManager
      if (widgetId) {
        MutableStoreManager.getInstance().updateStateValue(
          widgetId,
          "loadedModules",
          loadedModules
        )
        dispatch(fmeActions.setLoadingFlags({ isModulesLoading: false }))
      }
    } catch (err) {
      setError(err)
      setLoading(false)

      if (widgetId && dispatch) {
        const errorService = new ErrorHandlingService()
        dispatch(
          fmeActions.setError(
            errorService.createError(
              "Failed to load mapping modules",
              ErrorType.MODULE,
              {
                code: "MODULE_LOAD_ERROR",
                severity: ErrorSeverity.ERROR,
                recoverable: true,
                retry: loadModules,
              }
            )
          )
        )
        dispatch(fmeActions.setLoadingFlags({ isModulesLoading: false }))
      }
    }
  })

  hooks.useEffectOnce(() => {
    loadModules()
  })

  return { modules, loading, error }
}

// Centralized mutable state access hook - optimized with lazy evaluation
const useMutableState = (widgetId: string) => {
  const store = MutableStoreManager.getInstance()

  const getMutableValue = hooks.useEventCallback((key: string) => {
    return store.getStateValue([widgetId])?.[key]
  })

  const setMutableValue = hooks.useEventCallback((key: string, value: any) => {
    store.updateStateValue(widgetId, key, value)
  })

  // Use lazy getters to avoid calling getMutableValue on every render
  return React.useMemo(
    () => ({
      get jimuMapView() {
        return getMutableValue("jimuMapView") as JimuMapView
      },
      get sketchWidget() {
        return getMutableValue("sketchWidget") as __esri.Sketch
      },
      get graphicsLayer() {
        return getMutableValue("graphicsLayer") as __esri.GraphicsLayer
      },
      get measurementGraphicsLayer() {
        return getMutableValue(
          "measurementGraphicsLayer"
        ) as __esri.GraphicsLayer
      },
      get measurementWidget() {
        return getMutableValue("measurementWidget") as __esri.Measurement
      },
      get currentGeometry() {
        return getMutableValue("currentGeometry") as __esri.Geometry
      },
      get loadedModules() {
        return getMutableValue("loadedModules") as EsriModules
      },
      setMutableValue,
    }),
    [getMutableValue, setMutableValue]
  )
}

export default function Widget(
  props: AllWidgetProps<FmeExportConfig> & { state: FmeWidgetState }
): React.ReactElement {
  const { id: widgetId, useMapWidgetIds, dispatch, state: reduxState } = props

  const translate = hooks.useTranslation(defaultMessages)

  // Centralized cancelable promise maker for better async operation handling
  const makeCancelable = hooks.useCancelablePromiseMaker()

  // Centralized state management
  const [notification, setNotification] =
    React.useState<NotificationState | null>(null)
  const [isRestoreReady, setIsRestoreReady] = React.useState(false)
  const [isTemplateServiceInitialized, setIsTemplateServiceInitialized] =
    React.useState(false)
  const [geometryOperatorsService, setGeometryOperatorsService] =
    React.useState<GeometryOperatorsService | null>(null)

  // Service initialization - using useState with lazy initialization for stable references
  const [appStateService] = React.useState(() => new AppStateService(widgetId))
  const [templatePersistence] = React.useState(
    () => new TemplatePersistenceService(widgetId)
  )
  const [errorService] = React.useState(() => new ErrorHandlingService())
  const [withLoadingFlags] = React.useState(() =>
    createLoadingWrapper(dispatch)
  )

  // Load ArcGIS modules and get centralized state access
  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
  } = useArcGISModules(widgetId, dispatch)
  const mutableState = useMutableState(widgetId)

  // Access mutable state values
  const {
    jimuMapView,
    sketchWidget,
    graphicsLayer,
    measurementGraphicsLayer,
    setMutableValue,
  } = mutableState

  // Utility function to clear all graphics layers consistently
  const clearAllGraphics = hooks.useEventCallback(() => {
    if (graphicsLayer) {
      graphicsLayer.removeAll()
    }
    if (measurementGraphicsLayer) {
      measurementGraphicsLayer.removeAll()
    }
  })

  // Initialize template service
  hooks.useEffectOnce(() => {
    console.log(
      "FME Export Widget - Initializing template service for widget:",
      widgetId
    )
    console.log("FME Export Widget - Configuration:", {
      serverUrl: props.config.fmeServerUrl,
      repository: props.config.repository,
      hasToken: !!props.config.fmeServerToken,
    })

    templatePersistence
      .initialize()
      .then(() => {
        console.log(
          "FME Export Widget - Template service initialized successfully"
        )
        setIsTemplateServiceInitialized(true)
      })
      .catch((error) => {
        console.error(
          "FME Export Widget - Template service initialization failed:",
          error
        )
        setIsTemplateServiceInitialized(true) // Still set to true to not block the widget
      })
  })

  // Centralized error dispatch helper
  const raiseError = hooks.useEventCallback((error: any) => {
    dispatch(fmeActions.setError(error))
  })

  // Enhanced notification helper using FormattedMessage for i18n consistency
  const showNotification = hooks.useEventCallback(
    (
      severity: "success" | "warning" | "error" | "info",
      messageId: string,
      defaultMessage: string,
      values?: { [key: string]: any }
    ) => {
      const formattedMessage = React.createElement(FormattedMessage, {
        id: messageId,
        defaultMessage,
        values,
      })

      setNotification({
        severity,
        message: translate(messageId, values) || defaultMessage, // Fallback for components that need string
        formattedMessage, // Store FormattedMessage component for UI
      })
    }
  )

  // Enhanced export helper with support for multiple formats
  const exportData = hooks.useEventCallback(
    (
      data: any,
      filename: string,
      format: "json" | "geojson" | "csv" = "json"
    ): void => {
      try {
        let exportContent: string

        if (format === "json") {
          exportContent =
            typeof data === "string" ? data : JSON.stringify(data, null, 2)
        } else if (format === "geojson" && data.geometry) {
          // Convert Esri geometry to GeoJSON format
          const geoJsonFeature = {
            type: "Feature",
            geometry: data.geometry,
            properties: data.properties || {},
          }
          exportContent = JSON.stringify(geoJsonFeature, null, 2)
        } else if (format === "csv" && Array.isArray(data)) {
          // Convert structured data to CSV
          const headers = Object.keys(data[0] || {})
          const csvContent = [
            headers.join(","),
            ...data.map((row) =>
              headers.map((h) => `"${row[h] || ""}"`).join(",")
            ),
          ].join("\n")
          exportContent = csvContent
        } else {
          // Fallback to JSON
          exportContent = JSON.stringify(data, null, 2)
        }

        // Use the built-in downloadJSON utility for consistency
        downloadJSON(exportContent, filename)

        // Show success notification with FormattedMessage
        showNotification(
          "success",
          "exportSuccess",
          "Data exported successfully",
          { filename, format }
        )
      } catch (error) {
        console.error("Export failed:", error)
        showNotification("error", "exportError", "Export failed", {
          error: error instanceof Error ? error.message : String(error),
        })
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
  )

  // Initialize AppStateService and setup state restoration
  hooks.useEffectOnce(() => {
    try {
      appStateService.initialize(dispatch, setNotification, translate)
      setIsRestoreReady(true)
    } catch (error) {
      console.warn("Failed to initialize AppStateService:", error)
      setIsRestoreReady(true) // Allow widget to continue even if restore fails
    }
  })

  // Initialize geometry operators service when modules are loaded - using useUpdateEffect for better performance
  hooks.useUpdateEffect(() => {
    if (modules && !geometryOperatorsService) {
      const service = new GeometryOperatorsService({
        areaOperator: modules.areaOperator,
        geodeticAreaOperator: modules.geodeticAreaOperator,
        lengthOperator: modules.lengthOperator,
        geodeticLengthOperator: modules.geodeticLengthOperator,
        centroidOperator: modules.centroidOperator,
        simplifyOperator: modules.simplifyOperator,
        bufferOperator: modules.bufferOperator,
        geodesicBufferOperator: modules.geodesicBufferOperator,
        convexHullOperator: modules.convexHullOperator,
      })
      service
        .initialize()
        .then(() => {
          setGeometryOperatorsService(service)
        })
        .catch((error) => {
          console.error(
            "Failed to initialize geometry operators service:",
            error
          )
        })
    }
  }, [modules, geometryOperatorsService])

  // Template management with centralized persistence and enhanced cancellation
  const loadTemplates = hooks.useEventCallback(() => {
    if (!isTemplateServiceInitialized) return Promise.resolve()

    return withLoadingFlags("isTemplateLoading", async () => {
      try {
        const templates = await makeCancelable(
          templatePersistence.loadTemplates()
        )
        dispatch(fmeActions.setAreaTemplates(templates))
      } catch (error) {
        dispatch(fmeActions.setAreaTemplates([]))
        raiseError(
          errorService.createTemplateError("Failed to load templates", "LOAD")
        )
      }
    })
  })

  const saveTemplate = hooks.useEventCallback(async (name: string) => {
    if (!templatePersistence.available) {
      raiseError(
        errorService.createError(
          "Template storage not available",
          ErrorType.TEMPLATE
        )
      )
      return
    }

    const hasGeometry = reduxState.geometryJson || mutableState.currentGeometry
    if (!hasGeometry || !reduxState.drawnArea) return

    return withLoadingFlags("isTemplateLoading", async () => {
      try {
        const template: AreaTemplate = {
          id: `${TEMPLATE_ID_CONFIG.prefix}${Date.now()}`,
          name,
          geometry: reduxState.geometryJson,
          area: reduxState.drawnArea,
          createdDate: new Date(),
        }

        await makeCancelable(templatePersistence.saveTemplate(template))

        const newTemplates = [...reduxState.areaTemplates, template]
        dispatch(fmeActions.setAreaTemplates(newTemplates))

        // Show success notification with enhanced i18n
        showNotification(
          "success",
          "templateSaved",
          `Template "${name}" saved successfully`,
          { templateName: name }
        )

        dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
      } catch (error) {
        raiseError(
          errorService.createTemplateError("Failed to save template", "SAVE")
        )
      }
    })
  })

  const deleteTemplate = hooks.useEventCallback(async (templateId: string) => {
    if (!templatePersistence.available) {
      raiseError(
        errorService.createError(
          "Template storage not available",
          ErrorType.TEMPLATE
        )
      )
      return
    }

    return withLoadingFlags("isTemplateLoading", async () => {
      try {
        await makeCancelable(templatePersistence.deleteTemplate(templateId))

        const newTemplates = reduxState.areaTemplates.filter(
          (t: AreaTemplate) => t.id !== templateId
        )
        dispatch(fmeActions.setAreaTemplates(newTemplates))

        // Show success notification with enhanced i18n
        showNotification(
          "success",
          "templateDeleted",
          "Template deleted successfully"
        )
      } catch (error) {
        raiseError(
          errorService.createTemplateError(
            "Failed to delete template",
            "DELETE",
            templateId
          )
        )
      }
    })
  })

  // Template import/export handlers
  const handleExportTemplates = hooks.useEventCallback(async () => {
    // Skip export if persistence is unavailable
    if (!templatePersistence.available) return

    return withLoadingFlags("isExportingTemplates", async () => {
      try {
        const jsonString = await makeCancelable(
          templatePersistence.exportTemplates()
        )
        // Use enhanced export helper
        exportData(
          jsonString,
          `fme-templates-${new Date().toISOString().split("T")[0]}.json`
        )
      } catch (error) {
        dispatch(
          fmeActions.setExportError(
            errorService.createError(
              translate("exportError"),
              ErrorType.TEMPLATE,
              {
                code: "TEMPLATE_EXPORT_ERROR",
              }
            )
          )
        )
      }
    })
  })

  const handleExportSingleTemplate = hooks.useEventCallback(
    async (templateId: string) => {
      // Skip export if persistence is unavailable
      if (!templatePersistence.available) return

      return withLoadingFlags("isExportingTemplates", async () => {
        try {
          const jsonString =
            await templatePersistence.exportSingleTemplate(templateId)
          const template = reduxState.areaTemplates.find(
            (t: AreaTemplate) => t.id === templateId
          )
          const templateName = template?.name || "template"

          // Use enhanced export helper
          exportData(
            jsonString,
            `${templateName}-${new Date().toISOString().split("T")[0]}.json`
          )
        } catch (error) {
          dispatch(
            fmeActions.setExportError(
              errorService.createError(
                translate("exportError"),
                ErrorType.TEMPLATE,
                {
                  code: "TEMPLATE_EXPORT_ERROR",
                }
              )
            )
          )
        }
      })
    }
  )

  const handleImportTemplates = hooks.useEventCallback(async (file: File) => {
    if (!templatePersistence.available) return

    return withLoadingFlags("isImportingTemplates", async () => {
      try {
        const text = await file.text()
        const importedTemplates =
          await templatePersistence.importTemplates(text)

        if (importedTemplates.length === 0) {
          dispatch(
            fmeActions.setImportError(
              errorService.createError(
                translate("noValidTemplates"),
                ErrorType.TEMPLATE,
                {
                  code: "NO_VALID_TEMPLATES",
                }
              )
            )
          )
        } else {
          // Merge with existing templates
          const allTemplates = [
            ...reduxState.areaTemplates,
            ...importedTemplates,
          ]
          dispatch(fmeActions.finishTemplateImport(allTemplates))

          // Show success notification
          setNotification({
            severity: "success",
            message:
              translate("templatesImported") ||
              `${importedTemplates.length} template(s) imported successfully`,
          })
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)

        // Check if it's a validation error with detailed feedback
        if (errorMessage.includes("Import validation failed:")) {
          dispatch(
            fmeActions.setImportError(
              errorService.createError(errorMessage, ErrorType.VALIDATION, {
                code: "TEMPLATE_VALIDATION_ERROR",
                severity: ErrorSeverity.ERROR,
              })
            )
          )
        } else if (errorMessage.includes("Maximum limit")) {
          dispatch(
            fmeActions.setImportError(
              errorService.createError(errorMessage, ErrorType.VALIDATION, {
                code: "TEMPLATE_LIMIT_EXCEEDED",
                severity: ErrorSeverity.WARNING,
              })
            )
          )
        } else if (errorMessage.includes("Invalid JSON format")) {
          dispatch(
            fmeActions.setImportError(
              errorService.createError(
                translate("invalidTemplateFile"),
                ErrorType.VALIDATION,
                { code: "INVALID_JSON_FORMAT" }
              )
            )
          )
        } else {
          dispatch(
            fmeActions.setImportError(
              errorService.createError(
                translate("importError"),
                ErrorType.TEMPLATE,
                {
                  code: "TEMPLATE_IMPORT_ERROR",
                }
              )
            )
          )
        }
      }
    })
  })

  const loadTemplate = hooks.useEventCallback(async (templateId: string) => {
    const template = reduxState.areaTemplates.find(
      (t: AreaTemplate) => t.id === templateId
    )
    if (!template || !modules) return

    return withLoadingFlags("isTemplateLoading", async () => {
      try {
        const geometry = await createGeometryFromTemplate(template)
        if (!geometry) return

        const geometryJson = geometry.toJSON()

        dispatch({
          type: FmeActionType.SET_GEOMETRY,
          geometry: geometryJson,
          drawnArea: template.area,
        })

        MutableStoreManager.getInstance().updateStateValue(
          widgetId,
          "currentGeometry",
          geometry
        )

        if (graphicsLayer && jimuMapView) {
          // Clear all existing graphics before loading template
          clearAllGraphics()

          const { Graphic } = modules
          const graphic = new (Graphic as any)({
            geometry,
            symbol: {
              type: "simple-fill",
              color: STYLES.colors.orangeFill,
              outline: {
                color: STYLES.colors.orangeOutline,
                width: 2,
                style: "solid",
              },
            },
          })
          graphicsLayer.add(graphic)

          if (jimuMapView.view && !jimuMapView.view.destroyed) {
            // Navigation state - this is where StateRenderer will show loading
            try {
              await jimuMapView.view.goTo(geometry)
            } catch (error) {
              // Ignore navigation errors - they're usually not critical
              console.debug("Navigation to geometry failed:", error)
            }
          }

          // Add measurement label if applicable
          if (
            graphic &&
            geometryOperatorsService &&
            jimuMapView?.view &&
            measurementGraphicsLayer &&
            modules
          ) {
            try {
              const measurements =
                geometryOperatorsService.calculateMeasurements(
                  geometry,
                  jimuMapView.view.spatialReference
                )
              if (measurements.area) {
                createMeasurementGraphics(
                  geometry,
                  measurements,
                  measurementGraphicsLayer,
                  modules,
                  false // _isUpdate = false for final display (keeping for clarity)
                )

                // Use measurement widget if available for the loaded template
                const { measurementWidget } = mutableState
                if (jimuMapView?.view.type === "2d") {
                  configureMeasurementWidget(
                    jimuMapView.view,
                    geometry,
                    measurementWidget
                  )
                }
              }
            } catch (error) {
              console.warn(
                "Failed to add measurement label for template:",
                error
              )
            }
          }
        }

        // Transition to workspace selection view
        dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
      } catch (error) {
        raiseError(
          errorService.createError(
            "Failed to load template",
            ErrorType.TEMPLATE,
            {
              code: "TEMPLATE_LOAD_ERROR",
            }
          )
        )
      }
    })
  })

  // Drawing complete handler for Sketch widget
  const handleDrawingComplete = hooks.useEventCallback((evt: any) => {
    const geometry = evt.graphic?.geometry
    if (!geometry) return

    try {
      if (geometry.type === "polygon" && !geometry.rings?.length) return

      // Process geometry for measurements and simplification
      let processedGeometry = geometry
      if (geometryOperatorsService) {
        const simplified = geometryOperatorsService.simplifyGeometry(geometry)
        if (simplified) {
          processedGeometry = simplified
        }
      }

      // Calculate final measurements using processed geometry
      let finalMeasurements: RealTimeMeasurements = { area: 0 }
      if (geometryOperatorsService && jimuMapView?.view) {
        try {
          finalMeasurements = geometryOperatorsService.calculateMeasurements(
            processedGeometry,
            jimuMapView.view.spatialReference
          )
        } catch (error) {
          console.warn("Measurement calculation failed:", error)
        }
      }
      const calculatedArea = finalMeasurements.area || 0

      // Update the graphics layer with the drawn polygon
      if (evt.graphic && modules) {
        evt.graphic.symbol = {
          type: "simple-fill",
          color: STYLES.colors.orangeFill,
          outline: {
            color: STYLES.colors.orangeOutline,
            width: 2,
            style: "solid",
          },
        }
      }

      // Add measurement label inside the polygon if we have a valid graphic
      if (
        evt.graphic &&
        finalMeasurements.area &&
        measurementGraphicsLayer &&
        modules
      ) {
        // Use the modern measurement graphics function instead of legacy addMeasurementLabel
        createMeasurementGraphics(
          processedGeometry,
          finalMeasurements,
          measurementGraphicsLayer,
          modules,
          false // _isUpdate = false for final display (keeping for clarity)
        )

        // Use measurement widget if available
        const { measurementWidget } = mutableState
        if (jimuMapView?.view.type === "2d") {
          configureMeasurementWidget(
            jimuMapView.view,
            processedGeometry,
            measurementWidget
          )
        }
      }

      const geometryJson = processedGeometry.toJSON()

      dispatch({
        type: FmeActionType.SET_GEOMETRY,
        geometry: geometryJson,
        drawnArea: calculatedArea,
      })
      dispatch({
        type: FmeActionType.SET_DRAWING_STATE,
        isDrawing: false,
        clickCount: 0,
      })

      dispatch({
        type: FmeActionType.SET_REAL_TIME_MEASUREMENTS,
        measurements: finalMeasurements,
      })
      dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))

      setMutableValue("currentGeometry", processedGeometry)
    } catch (error) {
      raiseError(
        errorService.createError(
          "Failed to process drawn area",
          ErrorType.GEOMETRY,
          {
            code: "GEOMETRY_PROCESS_ERROR",
          }
        )
      )
    }
  })

  // Direct measurement graphics creation without debouncing or memoization
  const createMeasurementGraphicsDirectly = (
    geometry: __esri.Geometry,
    measurements: RealTimeMeasurements,
    measurementLayer: __esri.GraphicsLayer,
    modules: EsriModules
  ) => {
    createMeasurementGraphics(
      geometry,
      measurements,
      measurementLayer,
      modules,
      true
    )
  }

  const handleDrawingUpdate = hooks.useEventCallback((evt: any) => {
    let geometry =
      evt?.geometry || evt?.graphic?.geometry || evt?.graphics?.[0]?.geometry

    if (!geometry && evt?.target?.geometry) {
      geometry = evt.target.geometry
    }

    if (!geometry && evt?.coordinates && graphicsLayer?.graphics?.length > 0) {
      const activeGraphic = graphicsLayer.graphics.getItemAt(0)
      geometry = activeGraphic?.geometry
    }

    if (!geometry || !modules || !jimuMapView || !geometryOperatorsService)
      return

    try {
      // Calculate measurements using modern geometry operators
      const measurements = geometryOperatorsService.calculateMeasurements(
        geometry,
        jimuMapView.view.spatialReference
      )

      // Always dispatch measurements for UI display (including 0 values)
      dispatch({
        type: FmeActionType.SET_REAL_TIME_MEASUREMENTS,
        measurements,
      })

      // Only show map graphics if we have a meaningful area and it's a polygon
      if (
        geometry.type === "polygon" &&
        measurements.area &&
        measurements.area > 0 &&
        measurementGraphicsLayer
      ) {
        // Use our modernized graphics creation function directly without debouncing
        createMeasurementGraphicsDirectly(
          geometry,
          measurements,
          measurementGraphicsLayer,
          modules
        )

        // Use measurement widget if available for real-time feedback
        const { measurementWidget } = mutableState
        if (jimuMapView.view.type === "2d") {
          configureMeasurementWidget(
            jimuMapView.view,
            geometry,
            measurementWidget
          )
        }
      }
    } catch (error) {
      // Fallback to basic measurements on error
      console.warn("Error in handleDrawingUpdate:", error)
      dispatch({
        type: FmeActionType.SET_REAL_TIME_MEASUREMENTS,
        measurements: { area: 0 },
      })
    }
  })

  // Form submission handler with FME export
  const handleFormSubmit = hooks.useEventCallback(async (formData: any) => {
    console.log("FME Export - handleFormSubmit started:", formData)

    const hasGeometry =
      !!reduxState.geometryJson || !!mutableState.currentGeometry
    if (!hasGeometry || !reduxState.selectedWorkspace) {
      console.log("FME Export - Missing geometry or selected workspace:", {
        hasGeometry,
        selectedWorkspace: reduxState.selectedWorkspace,
      })
      return
    }

    console.log("FME Export - Starting job submission with configuration:", {
      serverUrl: props.config.fmeServerUrl,
      repository: props.config.repository,
      selectedWorkspace: reduxState.selectedWorkspace,
      hasToken: !!props.config.fmeServerToken,
    })

    dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: true }))

    try {
      // Get user email for FME notification with cancellable promises
      let userEmail = "no-reply@example.com"
      try {
        const [Portal] = await makeCancelable(
          loadArcGISJSAPIModules(["esri/portal/Portal"])
        )
        const portal = new Portal()
        await makeCancelable(portal.load())
        userEmail =
          portal.user?.email ||
          ((await makeCancelable(portal.getSelf())) as any)?.email ||
          userEmail
        console.log("FME Export - User email retrieved:", userEmail)
      } catch (emailError) {
        console.log(
          "FME Export - Failed to get user email, using default:",
          emailError
        )
      }

      // Create FME Flow client and get workspace name
      const fmeClient = createFmeFlowClient(props.config)

      // Use the selected workspace directly from Redux state (already includes .fmw extension)
      const workspace = reduxState.selectedWorkspace

      console.log("FME Export - Using selected workspace:", {
        selectedWorkspace: reduxState.selectedWorkspace,
        workspace: workspace,
      })

      // Prepare FME parameters
      const fmeParameters: { [key: string]: any } = {
        ...formData.data, // Form field values (PARAMETER, COORD_SYS, OUTPUT_FORMAT, etc.)
        opt_requesteremail: userEmail,
        opt_servicemode: "async", // Async mode with email notification
        opt_responseformat: "json",
        opt_showresult: "true",
      }

      // Add geometry if available - FME Flow expects Esri JSON format (not GeoJSON)
      if (reduxState.geometryJson) {
        console.log("FME Export - Adding geometry from Redux state")
        // Use Esri JSON format directly as expected by FME Flow workspace parameters
        try {
          const polygonGeometry = reduxState.geometryJson as any
          if (polygonGeometry.rings) {
            // Pass the Esri JSON geometry directly as a string (not converted to GeoJSON)
            fmeParameters.AreaOfInterest = JSON.stringify(polygonGeometry)
            console.log(
              "FME Export - Geometry added as AreaOfInterest parameter (Esri JSON format)"
            )
          }
        } catch (error) {
          console.warn(
            "FME Export - Failed to serialize Esri JSON geometry:",
            error
          )
        }
      } else if (mutableState.currentGeometry) {
        console.log("FME Export - Adding geometry from mutable state")
        try {
          const geometryJson = mutableState.currentGeometry.toJSON()
          if (geometryJson.rings) {
            // Use Esri JSON format directly as expected by FME Flow workspace parameters
            fmeParameters.AreaOfInterest = JSON.stringify(geometryJson)
            console.log(
              "FME Export - Geometry added as AreaOfInterest parameter (Esri JSON format)"
            )
          }
        } catch (error) {
          console.warn(
            "FME Export - Failed to serialize Esri JSON geometry:",
            error
          )
        }
      } else {
        console.warn("FME Export - No geometry available for export")
      }

      console.log("FME Export - Submitting job with parameters:", {
        workspace,
        parameters: Object.keys(fmeParameters),
        parameterValues: fmeParameters,
      })

      // Submit the actual FME job with cancellable promise for better error handling
      const fmeResponse = await makeCancelable(
        fmeClient.runDataDownload(workspace, fmeParameters)
      )

      // Process FME response based on the documented response format
      let result: ExportResult

      console.log("FME Export - FME API response received:", fmeResponse)

      if (fmeResponse && fmeResponse.data) {
        const responseData = fmeResponse.data as any

        // Handle FME Flow Data Download response format with serviceResponse wrapper
        const serviceResp = responseData.serviceResponse || responseData
        const status = serviceResp.statusInfo?.status || serviceResp.status
        const jobId = serviceResp.jobID || serviceResp.id
        const url = serviceResp.url
        const mode = serviceResp.statusInfo?.mode || serviceResp.mode

        console.log("FME Export - Processing response data:", {
          status: status,
          jobID: jobId,
          mode: mode,
          statusInfo: serviceResp.statusInfo,
          hasServiceResponse: !!responseData.serviceResponse,
        })

        // Check for success based on FME Flow Data Download response format
        if (status === "success") {
          // Ensure we have a proper job ID from either response format
          const finalJobId = jobId || Date.now()

          result = {
            success: true,
            message: "Export order submitted successfully",
            jobId: finalJobId,
            workspaceName: workspace,
            email: userEmail,
            downloadUrl: url || undefined,
          }

          console.log("FME Export - Job submitted successfully:", {
            jobId: result.jobId,
            downloadUrl: result.downloadUrl,
          })

          // Show success notification
          setNotification({
            severity: "success",
            message:
              translate("orderSubmitted") ||
              `Export order submitted successfully. Job ID: ${result.jobId}`,
          })
        } else {
          // FME reported failure - check both response formats
          const errorMessage =
            serviceResp.statusInfo?.message ||
            serviceResp.message ||
            responseData.statusInfo?.message ||
            responseData.message ||
            "FME job submission failed"
          console.error("FME Export - FME job failed:", errorMessage)

          result = {
            success: false,
            message: errorMessage,
            code: "FME_JOB_FAILURE",
          }

          setNotification({
            severity: "error",
            message:
              translate("orderFailed") || `Export failed: ${errorMessage}`,
          })
        }
      } else if (
        fmeResponse &&
        fmeResponse.status >= 200 &&
        fmeResponse.status < 300
      ) {
        // Handle cases where response doesn't have structured data but HTTP status is OK
        console.log(
          "FME Export - HTTP success but no structured data, treating as success"
        )

        result = {
          success: true,
          message: "Export order submitted successfully",
          jobId: Date.now(),
          workspaceName: workspace,
          email: userEmail,
        }

        setNotification({
          severity: "success",
          message:
            translate("orderSubmitted") ||
            "Export order submitted successfully",
        })
      } else {
        // HTTP error or unexpected response format
        console.error(
          "FME Export - Unexpected response format or HTTP error:",
          fmeResponse
        )

        const errorMessage =
          fmeResponse?.error?.error?.message ||
          fmeResponse?.statusText ||
          "Unexpected response from FME server"

        result = {
          success: false,
          message: errorMessage,
          code: "INVALID_RESPONSE",
        }

        setNotification({
          severity: "error",
          message: translate("orderFailed") || `Export failed: ${errorMessage}`,
        })
      }

      dispatch({ type: FmeActionType.SET_ORDER_RESULT, orderResult: result })
      dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT))
    } catch (error) {
      console.error("FME Export - Job submission error:", error)

      const errorMessage = error.message || "Unknown error occurred"
      const result: ExportResult = {
        success: false,
        message: `Failed to submit export order: ${errorMessage}`,
        code: error.code || "SUBMISSION_ERROR",
      }

      setNotification({
        severity: "error",
        message: translate("orderFailed") || `Export failed: ${errorMessage}`,
      })

      dispatch({ type: FmeActionType.SET_ORDER_RESULT, orderResult: result })
      dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT))
    } finally {
      dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: false }))
    }
  })

  // Load templates on initial render or when persistence is ready
  hooks.useUpdateEffect(() => {
    if (
      isTemplateServiceInitialized &&
      templatePersistence.available &&
      reduxState.areaTemplates.length === 0
    ) {
      loadTemplates()
    }
  }, [
    isTemplateServiceInitialized,
    templatePersistence.available,
    reduxState.areaTemplates.length,
  ])

  hooks.useUpdateEffect(() => {
    if (modules && jimuMapView && !sketchWidget) {
      handleMapViewReady(jimuMapView)
    }
  }, [modules, jimuMapView, sketchWidget])

  // Automatic state persistence - save state when critical changes occur
  hooks.useUpdateEffect(() => {
    // Only save state if restore is ready and we have meaningful state to persist
    if (!isRestoreReady || !reduxState) return

    // Add a small delay to batch state changes and ensure map is ready
    const timeoutId = setTimeout(() => {
      appStateService.saveState(reduxState)
    }, 1000) // 1 second delay to ensure map readiness

    return () => {
      clearTimeout(timeoutId)
    }
  }, [
    isRestoreReady,
    reduxState.viewMode,
    reduxState.geometryJson,
    reduxState.drawnArea,
    reduxState.templateName,
    reduxState.selectedWorkspace,
    reduxState.formValues,
    reduxState.drawingTool,
    widgetId,
  ])

  // Cleanup on unmount
  hooks.useEffectOnce(() => {
    return () => {
      // Widget cleanup handled by Experience Builder
    }
  })

  // JimuMapView ready handler with sketch setup
  const handleMapViewReady = hooks.useEventCallback((jmv: JimuMapView) => {
    console.log("FME Export - MapView ready, initializing sketch widget")

    if (!modules) {
      console.log(
        "FME Export - ArcGIS modules not yet loaded, storing map view"
      )
      setMutableValue("jimuMapView", jmv)
      return
    }

    try {
      console.log("FME Export - Setting up graphics layers and sketch widget")
      setMutableValue("jimuMapView", jmv)

      // Create main graphics layer for sketch operations
      const layer = new modules.GraphicsLayer(LAYER_CONFIG)
      jmv.view.map.add(layer)
      setMutableValue("graphicsLayer", layer)

      // Create measurement graphics layer for labels
      const measurementLayer = new modules.GraphicsLayer({
        id: "measurement-labels-layer",
        title: "Measurement Labels",
      })
      jmv.view.map.add(measurementLayer)
      setMutableValue("measurementGraphicsLayer", measurementLayer)

      const { Sketch } = modules
      if (!Sketch) throw new Error("Sketch widget not loaded in modules")

      // Initialize measurement widgets if we have a MapView (not SceneView)
      if (jmv.view.type === "2d") {
        // Create unified measurement widget (modern approach)
        let measurementWidget
        if (modules.Measurement) {
          measurementWidget = new modules.Measurement({
            view: jmv.view,
            activeTool: "area", // Default to area measurement for polygons
            areaUnit: "metric",
            linearUnit: "metric",
          })
          setMutableValue("measurementWidget", measurementWidget)
        }
      }

      // Search widget for finding locations and features
      let searchWidget
      if (modules.Search) {
        searchWidget = new modules.Search({
          view: jmv.view,
          includeDefaultSources: true,
          locationEnabled: true,
          searchAllEnabled: true,
          suggestionsEnabled: true,
        } as any) // Use 'as any' to bypass TypeScript issues
        setMutableValue("searchWidget", searchWidget)
      }

      // LayerList widget for managing map layers
      let layerListWidget
      if (modules.LayerList) {
        layerListWidget = new modules.LayerList({
          view: jmv.view,
          selectionMode: "single",
          visibleElements: {
            statusIndicators: true,
            filter: true,
            collapseButton: true,
          },
        })
        setMutableValue("layerListWidget", layerListWidget)
      }

      // BasemapGallery widget for changing basemaps during export planning
      let basemapGalleryWidget
      if (modules.BasemapGallery) {
        basemapGalleryWidget = new modules.BasemapGallery({
          view: jmv.view,
        })
        setMutableValue("basemapGalleryWidget", basemapGalleryWidget)
      }

      // Navigation widgets for map interaction
      let compassWidget, homeWidget
      if (modules.Compass) {
        compassWidget = new modules.Compass({
          view: jmv.view,
        })
        setMutableValue("compassWidget", compassWidget)
      }

      if (modules.Home) {
        homeWidget = new modules.Home({
          view: jmv.view,
        })
        setMutableValue("homeWidget", homeWidget)
      }

      const sketchWidget = new Sketch({
        view: jmv.view,
        layer,
        creationMode: "single",
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
        visibleElements: {
          createTools: {
            point: false,
            polyline: false,
            polygon: true,
            rectangle: true,
            circle: false,
          },
          selectionTools: {
            "lasso-selection": false,
            "rectangle-selection": false,
          },
          settingsMenu: false,
        },
      })

      // Store the sketch widget in mutable state
      if (sketchWidget.viewModel) {
        sketchWidget.viewModel.polygonSymbol = {
          type: "simple-fill",
          color: STYLES.colors.orangeFill,
          outline: {
            color: STYLES.colors.orangeOutline,
            width: 2,
            style: "solid",
          },
        }

        sketchWidget.viewModel.polylineSymbol = {
          type: "simple-line",
          color: STYLES.colors.orangeOutline,
          width: 2,
          style: "solid",
        }

        sketchWidget.viewModel.pointSymbol = {
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

      sketchWidget.on("create", (evt: __esri.SketchCreateEvent) => {
        // Only log significant events to reduce console noise
        if (evt.state === "start" || evt.state === "complete") {
          console.log(
            "FME Export - Sketch create event:",
            evt.state,
            "Tool:",
            evt.tool
          )
        }
        if (evt.state === "active" || evt.state === "start") {
          handleDrawingUpdate(evt)
        } else if (evt.state === "complete") {
          console.log(
            "FME Export - Drawing completed, geometry:",
            evt.graphic?.geometry
          )
          handleDrawingComplete(evt)
        }
      })
      sketchWidget.on("update", (evt: __esri.SketchUpdateEvent) => {
        console.log("FME Export - Sketch update event:", evt.state)
        handleDrawingUpdate(evt)
      })

      setMutableValue("sketchWidget", sketchWidget)
    } catch (error) {
      raiseError(
        errorService.createError("Failed to initialize map", ErrorType.MODULE, {
          code: "MAP_INIT_ERROR",
        })
      )
    }
  })

  // Helper function to get instruction text based on drawing tool
  const getInstructionText = hooks.useEventCallback((tool: DrawingTool) => {
    switch (tool) {
      case DrawingTool.RECTANGLE:
        return translate("rectangleDrawingInstructions")
      case DrawingTool.FREEHAND:
        return translate("freehandDrawingInstructions")
      case DrawingTool.POLYGON:
        return translate("drawInstruction")
    }
  })

  // Drawing start handler - now using Sketch widget
  const handleStartDrawing = hooks.useEventCallback((tool: DrawingTool) => {
    console.log("FME Export - Starting drawing with tool:", tool)

    if (!sketchWidget) {
      console.warn("FME Export - Sketch widget not available")
      return
    }

    dispatch({
      type: FmeActionType.SET_DRAWING_TOOL,
      drawingTool: tool,
    })
    dispatch({
      type: FmeActionType.SET_DRAWING_STATE,
      isDrawing: true,
      clickCount: 0,
    })
    dispatch(fmeActions.setViewMode(ViewMode.DRAWING))

    // Clear existing graphics
    clearAllGraphics()
    console.log("FME Export - Cleared all graphics before drawing")

    // Use the modern Sketch widget's programmatic creation
    if (tool === DrawingTool.RECTANGLE) {
      console.log("FME Export - Creating rectangle")
      sketchWidget.create("rectangle")
    } else if (tool === DrawingTool.FREEHAND) {
      console.log("FME Export - Creating freehand polygon")
      sketchWidget.create("polygon", { mode: "freehand" })
    } else {
      console.log("FME Export - Creating polygon")
      sketchWidget.create("polygon")
    }
  })

  // Reset handler - updated for Sketch widget
  const handleReset = hooks.useEventCallback(() => {
    // Clear all graphics layers
    clearAllGraphics()

    if (sketchWidget) sketchWidget.cancel()

    // Reset measurement widget if it exists
    const { measurementWidget } = mutableState
    if (measurementWidget) {
      measurementWidget.visible = false
    }

    dispatch({ type: FmeActionType.RESET_STATE })
  })

  // Workspace selection handlers
  const handleWorkspaceSelected = hooks.useEventCallback(
    (workspaceName: string, parameters: readonly any[], workspaceItem: any) => {
      // Store the selected workspace parameters in Redux
      dispatch(fmeActions.setSelectedWorkspace(workspaceName))
      dispatch(fmeActions.setWorkspaceParameters(parameters, workspaceName))
      dispatch(fmeActions.setWorkspaceItem(workspaceItem))

      // Transition to dynamic export form
      dispatch(fmeActions.setViewMode(ViewMode.EXPORT_FORM))
    }
  )

  const handleWorkspaceBack = hooks.useEventCallback(() => {
    dispatch(fmeActions.setViewMode(ViewMode.INITIAL))
  })

  const handleGoBack = hooks.useEventCallback(() => {
    const currentView = reduxState.viewMode
    const previousView = reduxState.previousViewMode

    // Use previous view if available and different from current
    const targetView =
      previousView && previousView !== currentView
        ? previousView
        : (() => {
            // Special case for template/save views with drawn area
            if (
              (currentView === ViewMode.SAVE_TEMPLATE ||
                currentView === ViewMode.TEMPLATE_MANAGER) &&
              reduxState.drawnArea > 0
            ) {
              return ViewMode.WORKSPACE_SELECTION
            }
            // Default routing logic - go back to appropriate previous view
            switch (currentView) {
              case ViewMode.EXPORT_FORM:
                return ViewMode.WORKSPACE_SELECTION
              case ViewMode.WORKSPACE_SELECTION:
                return ViewMode.INITIAL
              case ViewMode.ORDER_RESULT:
                return ViewMode.INITIAL
              case ViewMode.DRAWING:
                return ViewMode.INITIAL
              default:
                return ViewMode.INITIAL
            }
          })()

    dispatch({
      type: FmeActionType.SET_VIEW_MODE,
      viewMode: targetView,
    })
  })

  // Render loading state with StateRenderer
  if (modulesLoading || !modules) {
    return (
      <StateRenderer
        state={StateType.LOADING}
        data={{
          message: translate("loadingWidget"),
        }}
      />
    )
  }

  // Render error state with StateRenderer
  if (
    modulesError ||
    (reduxState.error && reduxState.error.severity === "error")
  ) {
    return (
      <StateRenderer
        state={StateType.ERROR}
        data={{
          error: reduxState.error || modulesError,
          actions: [
            {
              label: translate("retry"),
              onClick: () => {
                if (reduxState.error?.retry) {
                  reduxState.error.retry()
                } else {
                  dispatch({ type: FmeActionType.SET_ERROR, error: null })
                }
              },
              variant: "primary" as const,
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
        instructionText={getInstructionText(reduxState.drawingTool)}
        onAngeUtbredning={() => handleStartDrawing(reduxState.drawingTool)}
        isModulesLoading={modulesLoading}
        canStartDrawing={!!sketchWidget}
        onFormBack={() => {
          dispatch({
            type: FmeActionType.SET_VIEW_MODE,
            viewMode: ViewMode.WORKSPACE_SELECTION, // Go back to workspace selection
          })
        }}
        onFormSubmit={handleFormSubmit}
        orderResult={reduxState.orderResult}
        onReuseGeography={() => {
          dispatch({
            type: FmeActionType.SET_VIEW_MODE,
            viewMode: ViewMode.WORKSPACE_SELECTION, // Go back to workspace selection
          })
        }}
        isSubmittingOrder={reduxState.isSubmittingOrder}
        templates={[...reduxState.areaTemplates]}
        templateName={reduxState.templateName}
        onLoadTemplate={loadTemplate}
        onSaveTemplate={saveTemplate}
        onDeleteTemplate={deleteTemplate}
        onTemplateNameChange={(name) =>
          dispatch({
            type: FmeActionType.SET_TEMPLATE_NAME,
            templateName: name,
          })
        }
        onBack={handleGoBack}
        drawnArea={reduxState.drawnArea}
        formatArea={formatArea}
        isTemplateLoading={reduxState.isTemplateLoading}
        drawingMode={reduxState.drawingTool}
        onDrawingModeChange={(tool) =>
          dispatch({ type: FmeActionType.SET_DRAWING_TOOL, drawingTool: tool })
        }
        realTimeMeasurements={reduxState.realTimeMeasurements}
        formatRealTimeMeasurements={(measurements) => (
          <MeasurementOverlay data={measurements} translate={translate} />
        )}
        // Header props
        showHeaderActions={
          (reduxState.isDrawing || reduxState.drawnArea > 0) &&
          !reduxState.isSubmittingOrder &&
          !modulesLoading &&
          !reduxState.isTemplateLoading
        }
        onReset={handleReset}
        showSaveButton={
          reduxState.drawnArea > 0 &&
          !reduxState.isSubmittingOrder &&
          !reduxState.isModulesLoading &&
          !reduxState.isTemplateLoading
        }
        showFolderButton={
          reduxState.areaTemplates.length > 0 &&
          !reduxState.orderResult &&
          !reduxState.isSubmittingOrder &&
          !reduxState.isModulesLoading &&
          !reduxState.isTemplateLoading
        }
        onSaveTemplateFromHeader={() => {
          dispatch({
            type: FmeActionType.SET_VIEW_MODE,
            viewMode: ViewMode.SAVE_TEMPLATE,
          })
        }}
        onShowTemplateFolder={() => {
          const newMode =
            reduxState.viewMode === ViewMode.TEMPLATE_MANAGER
              ? ViewMode.INITIAL
              : ViewMode.TEMPLATE_MANAGER
          dispatch({
            type: FmeActionType.SET_VIEW_MODE,
            viewMode: newMode,
          })
        }}
        canSaveTemplate={reduxState.drawnArea > 0}
        canLoadTemplate={reduxState.areaTemplates.length > 0}
        canReset={true}
        onExportTemplates={handleExportTemplates}
        onExportSingleTemplate={handleExportSingleTemplate}
        onImportTemplates={handleImportTemplates}
        isImportingTemplates={reduxState.isImportingTemplates}
        isExportingTemplates={reduxState.isExportingTemplates}
        importError={reduxState.importError}
        exportError={reduxState.exportError}
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
;(Widget as any).mapExtraStateProps = (
  state: IMStateWithFmeExport,
  ownProps: AllWidgetProps<any>
) => {
  const widgetId = ownProps.id
  const storeKey = "fme-state"

  const widgetState = state[storeKey] as ImmutableObject<FmeWidgetState>

  // Get mutable state objects from MutableStoreManager
  const jimuMapView = MutableStoreManager.getInstance().getStateValue([
    widgetId,
  ])?.jimuMapView
  const sketchWidget = MutableStoreManager.getInstance().getStateValue([
    widgetId,
  ])?.sketchWidget
  const graphicsLayer = MutableStoreManager.getInstance().getStateValue([
    widgetId,
  ])?.graphicsLayer
  const currentGeometry = MutableStoreManager.getInstance().getStateValue([
    widgetId,
  ])?.currentGeometry

  return {
    state: widgetState || {
      viewMode: ViewMode.INITIAL,
      previousViewMode: null,
      isDrawing: false,
      drawingTool: DrawingTool.POLYGON,
      clickCount: 0,
      geometryJson: null,
      drawnArea: 0,
      realTimeMeasurements: {},
      areaTemplates: [],
      templateName: "",
      selectedTemplateId: null,
      selectedWorkspace: null,
      workspaceParameters: [],
      workspaceItem: null,
      formValues: {},
      orderResult: null,
      isModulesLoading: false,
      isTemplateLoading: false,
      isSubmittingOrder: false,
      isImportingTemplates: false,
      isExportingTemplates: false,
      error: null,
      importError: null,
      exportError: null,
      uiState: StateType.IDLE,
      uiStateData: {},
      templateValidation: null,
    },
    mutableStateProps: {
      jimuMapView,
      sketchWidget,
      graphicsLayer,
      currentGeometry,
    },
  }
}
