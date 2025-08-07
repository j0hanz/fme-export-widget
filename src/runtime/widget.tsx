import {
  React,
  type AllWidgetProps,
  hooks,
  type ImmutableObject,
  MutableStoreManager,
} from "jimu-core"
import { Message } from "jimu-ui"
import {
  JimuMapViewComponent,
  type JimuMapView,
  loadArcGISJSAPIModules,
} from "jimu-arcgis"
import { Content } from "./components/content"
import { StateRenderer } from "./components/state"
import { createFmeFlowClient } from "../shared/api"
import defaultMessages from "../translations/default"
import { formatArea } from "../shared/utils"
import { STYLES } from "../shared/css"
import type {
  FmeExportConfig,
  EsriModules,
  ExportResult,
  IMStateWithFmeExport,
  FmeWidgetState,
  NotificationState,
} from "../shared/types"
import {
  DrawingTool,
  ViewMode,
  ErrorType,
  ErrorSeverity,
  StateType,
  FmeActionType,
  LAYER_CONFIG,
} from "../shared/types"
import { fmeActions } from "../extensions/store"
import { ErrorHandlingService, AppStateService } from "../shared/services"

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
        SketchViewModel,
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
        AreaMeasurement2D,
        DistanceMeasurement2D,
        geometryEngine,
      ] = await makeCancelable(
        loadArcGISJSAPIModules([
          "esri/widgets/Sketch/SketchViewModel",
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
          "esri/widgets/AreaMeasurement2D",
          "esri/widgets/DistanceMeasurement2D",
          "esri/geometry/geometryEngine",
        ])
      )

      const loadedModules: EsriModules = {
        SketchViewModel,
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
        AreaMeasurement2D,
        DistanceMeasurement2D,
        geometryEngine,
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
      get sketchViewModel() {
        return getMutableValue("sketchViewModel") as __esri.SketchViewModel
      },
      get graphicsLayer() {
        return getMutableValue("graphicsLayer") as __esri.GraphicsLayer
      },
      get measurementGraphicsLayer() {
        return getMutableValue(
          "measurementGraphicsLayer"
        ) as __esri.GraphicsLayer
      },
      get areaMeasurement2D() {
        return getMutableValue("areaMeasurement2D") as __esri.AreaMeasurement2D
      },
      get distanceMeasurement2D() {
        return getMutableValue(
          "distanceMeasurement2D"
        ) as __esri.DistanceMeasurement2D
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

  // Service initialization - using useState with lazy initialization for stable references
  const [appStateService] = React.useState(() => new AppStateService(widgetId))
  const [errorService] = React.useState(() => new ErrorHandlingService())

  // Load ArcGIS modules and get centralized state access
  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
  } = useArcGISModules(widgetId, dispatch)
  const mutableState = useMutableState(widgetId)

  // Access mutable state values with default values
  const {
    jimuMapView,
    sketchViewModel = null,
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

  // Centralized error dispatch helper
  const raiseError = hooks.useEventCallback((error: any) => {
    dispatch(fmeActions.setError(error))
  })

  // Handle modules loading state
  hooks.useUpdateEffect(() => {}, [modules])

  // Drawing complete handler for Sketch widget
  const handleDrawingComplete = hooks.useEventCallback((evt: any) => {
    const geometry = evt.graphic?.geometry
    if (!geometry) return

    try {
      if (geometry.type === "polygon" && !geometry.rings?.length) return

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

      const geometryJson = geometry.toJSON()

      // Calculate area using GeometryEngine for display
      let calculatedArea = 0
      if (modules.geometryEngine && geometry.type === "polygon") {
        try {
          // Calculate area in square meters
          calculatedArea = modules.geometryEngine.planarArea(
            geometry,
            "square-meters"
          )
          console.log(
            "FME Export - Calculated area:",
            calculatedArea,
            "square meters"
          )
        } catch (error) {
          console.warn("FME Export - Failed to calculate area:", error)
        }
      }

      dispatch({
        type: FmeActionType.SET_GEOMETRY,
        geometry: geometryJson,
        drawnArea: Math.abs(calculatedArea), // Ensure positive value
      })
      dispatch({
        type: FmeActionType.SET_DRAWING_STATE,
        isDrawing: false,
        clickCount: 0,
      })

      MutableStoreManager.getInstance().updateStateValue(
        widgetId,
        "currentGeometry",
        geometry
      )

      // Show measurement information after drawing is complete
      console.log(
        "FME Export - Drawing completed with area:",
        Math.abs(calculatedArea),
        "square meters"
      )

      // Transition to workspace selection view after drawing
      dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
    } catch (error) {
      raiseError(
        errorService.createError(
          "Failed to complete drawing",
          ErrorType.VALIDATION,
          {
            code: "DRAWING_COMPLETE_ERROR",
            details: { error: error.message },
          }
        )
      )
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

  hooks.useUpdateEffect(() => {
    if (modules && jimuMapView && !sketchViewModel) {
      handleMapViewReady(jimuMapView)
    }
  }, [modules, jimuMapView, sketchViewModel])

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

      // Create a new graphic for the measurement labels
      if (jmv.view.type === "2d") {
        // Create dedicated AreaMeasurement2D widget (ArcGIS 4.29 compatible) - but don't add to UI
        let areaMeasurement2D
        if (modules.AreaMeasurement2D) {
          areaMeasurement2D = new modules.AreaMeasurement2D({
            view: jmv.view,
            unit: "metric",
            visible: false,
          })
          setMutableValue("areaMeasurement2D", areaMeasurement2D)
          console.log(
            "FME Export - AreaMeasurement2D widget created (not added to UI)"
          )
        }

        // Create dedicated DistanceMeasurement2D widget (ArcGIS 4.29 compatible) - but don't add to UI
        let distanceMeasurement2D
        if (modules.DistanceMeasurement2D) {
          distanceMeasurement2D = new modules.DistanceMeasurement2D({
            view: jmv.view,
            unit: "metric",
            visible: false,
          })
          setMutableValue("distanceMeasurement2D", distanceMeasurement2D)
          console.log(
            "FME Export - DistanceMeasurement2D widget created (not added to UI)"
          )
        }
      }

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

      // Configure the sketch view model symbols
      if (sketchViewModel) {
        sketchViewModel.polygonSymbol = {
          type: "simple-fill",
          color: STYLES.colors.orangeFill,
          outline: {
            color: STYLES.colors.orangeOutline,
            width: 2,
            style: "solid",
          },
        }

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

      sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
        // Only log significant events to reduce console noise
        if (evt.state === "start" || evt.state === "complete") {
          console.log(
            "FME Export - Sketch create event:",
            evt.state,
            "Tool:",
            evt.tool
          )
        }
        if (evt.state === "complete") {
          console.log(
            "FME Export - Drawing completed, geometry:",
            evt.graphic?.geometry
          )
          handleDrawingComplete(evt)
        }
      })
      setMutableValue("sketchViewModel", sketchViewModel)
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

  // Start drawing handler - initializes sketch view model and starts drawing
  const handleStartDrawing = hooks.useEventCallback((tool: DrawingTool) => {
    console.log("FME Export - Starting drawing with tool:", tool)

    if (!sketchViewModel) {
      console.warn("FME Export - Sketch view model not available")
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

    // Ensure measurement widgets are hidden during drawing
    const { areaMeasurement2D, distanceMeasurement2D } = mutableState
    if (areaMeasurement2D) {
      try {
        areaMeasurement2D.visible = false
        areaMeasurement2D.viewModel.clear()
        console.log(
          "FME Export - Ensured area measurement widget is hidden during drawing"
        )
      } catch (error) {
        console.warn("FME Export - Failed to hide area measurement:", error)
      }
    }

    if (distanceMeasurement2D) {
      try {
        distanceMeasurement2D.visible = false
        distanceMeasurement2D.viewModel.clear()
        console.log(
          "FME Export - Ensured distance measurement widget is hidden during drawing"
        )
      } catch (error) {
        console.warn("FME Export - Failed to hide distance measurement:", error)
      }
    }

    // Start the sketch drawing based on the selected tool
    if (tool === DrawingTool.RECTANGLE) {
      console.log("FME Export - Creating rectangle")
      sketchViewModel.create("rectangle")
    } else if (tool === DrawingTool.FREEHAND) {
      console.log("FME Export - Creating freehand polygon")
      sketchViewModel.create("polygon", { mode: "freehand" })
    } else {
      console.log("FME Export - Creating polygon")
      sketchViewModel.create("polygon")
    }
  })

  // Reset handler - clears all graphics and resets drawing state
  const handleReset = hooks.useEventCallback(() => {
    // Reset the widget state
    clearAllGraphics()

    if (sketchViewModel) sketchViewModel.cancel()

    // Reset drawing state
    const { areaMeasurement2D, distanceMeasurement2D } = mutableState
    if (areaMeasurement2D) {
      try {
        areaMeasurement2D.viewModel.clear()
        areaMeasurement2D.visible = false
        console.log("FME Export - Cleared area measurement widget")
      } catch (error) {
        console.warn("FME Export - Failed to clear area measurement:", error)
      }
    }
    if (distanceMeasurement2D) {
      try {
        distanceMeasurement2D.viewModel.clear()
        distanceMeasurement2D.visible = false
        console.log("FME Export - Cleared distance measurement widget")
      } catch (error) {
        console.warn(
          "FME Export - Failed to clear distance measurement:",
          error
        )
      }
    }

    dispatch({ type: FmeActionType.RESET_STATE })
  })

  // Workspace selection handlers
  const handleWorkspaceSelected = hooks.useEventCallback(
    (workspaceName: string, parameters: readonly any[], workspaceItem: any) => {
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
    const currentView = reduxState.viewMode
    const previousView = reduxState.previousViewMode

    // Use previous view if available and different from current
    const targetView =
      previousView && previousView !== currentView
        ? previousView
        : (() => {
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
        canStartDrawing={!!sketchViewModel}
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
        onBack={handleGoBack}
        drawnArea={reduxState.drawnArea}
        formatArea={formatArea}
        drawingMode={reduxState.drawingTool}
        onDrawingModeChange={(tool) =>
          dispatch({ type: FmeActionType.SET_DRAWING_TOOL, drawingTool: tool })
        }
        realTimeMeasurements={reduxState.realTimeMeasurements}
        formatRealTimeMeasurements={() => null} // Measurement widgets handle their own display
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
  const sketchViewModel = MutableStoreManager.getInstance().getStateValue([
    widgetId,
  ])?.sketchViewModel
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
      selectedWorkspace: null,
      workspaceParameters: [],
      workspaceItem: null,
      formValues: {},
      orderResult: null,
      isModulesLoading: false,
      isSubmittingOrder: false,
      error: null,
      uiState: StateType.IDLE,
      uiStateData: {},
    },
    mutableStateProps: {
      jimuMapView,
      sketchViewModel,
      graphicsLayer,
      currentGeometry,
    },
  }
}
