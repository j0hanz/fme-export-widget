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

// Simplified ArcGIS modules loading
const useArcGISModules = () => {
  const [modules, setModules] = React.useState<EsriModules | null>(null)
  const [loading, setLoading] = React.useState(true)

  hooks.useEffectOnce(() => {
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
      .then(
        ([
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
        ]) => {
          setModules({
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
          })
          setLoading(false)
        }
      )
      .catch((error) => {
        console.error("Failed to load ArcGIS modules:", error)
        setLoading(false)
      })
  })

  return { modules, loading }
}

// Simplified mutable state access
const useMutableState = (widgetId: string) => {
  const store = MutableStoreManager.getInstance()

  return {
    jimuMapView: store.getStateValue([widgetId])?.jimuMapView as JimuMapView,
    sketchViewModel: store.getStateValue([widgetId])
      ?.sketchViewModel as __esri.SketchViewModel,
    graphicsLayer: store.getStateValue([widgetId])
      ?.graphicsLayer as __esri.GraphicsLayer,
    measurementGraphicsLayer: store.getStateValue([widgetId])
      ?.measurementGraphicsLayer as __esri.GraphicsLayer,
    areaMeasurement2D: store.getStateValue([widgetId])
      ?.areaMeasurement2D as __esri.AreaMeasurement2D,
    distanceMeasurement2D: store.getStateValue([widgetId])
      ?.distanceMeasurement2D as __esri.DistanceMeasurement2D,
    currentGeometry: store.getStateValue([widgetId])
      ?.currentGeometry as __esri.Geometry,
    setMutableValue: (key: string, value: any) => {
      store.updateStateValue(widgetId, key, value)
    },
  }
}

// Helper functions for error handling and state management
const createError = (message: string, type: ErrorType, code?: string) => ({
  message,
  type,
  code,
  severity: ErrorSeverity.ERROR,
  timestamp: new Date(),
})

const updateLoadingState = (dispatch: any, message: string) => {
  dispatch(fmeActions.setUiStateData({ message }))
}

// Helper function to calculate polygon area
const calculatePolygonArea = (
  geometry: __esri.Geometry,
  modules: EsriModules
): number => {
  if (!modules.geometryEngine || geometry.type !== "polygon") return 0

  try {
    const area = modules.geometryEngine.planarArea(
      geometry as __esri.Polygon,
      "square-meters"
    )
    console.log("FME Export - Calculated area:", area, "square meters")
    return area
  } catch (error) {
    console.warn("FME Export - Failed to calculate area:", error)
    return 0
  }
}

// Helper functions for form submission
const getUserEmail = async (): Promise<string> => {
  try {
    const [Portal] = await loadArcGISJSAPIModules(["esri/portal/Portal"])
    const portal = new Portal()
    await portal.load()
    return portal.user?.email || "no-reply@example.com"
  } catch (error) {
    console.log("Failed to get user email, using default:", error)
    return "no-reply@example.com"
  }
}

const prepareFmeParameters = (
  formData: any,
  userEmail: string,
  geometryJson: any,
  currentGeometry: __esri.Geometry
) => {
  const fmeParameters: { [key: string]: any } = {
    ...formData.data,
    opt_requesteremail: userEmail,
    opt_servicemode: "async",
    opt_responseformat: "json",
    opt_showresult: "true",
  }

  // Add geometry if available
  if (geometryJson?.rings) {
    fmeParameters.AreaOfInterest = JSON.stringify(geometryJson)
  } else if (currentGeometry) {
    const geometryData = currentGeometry.toJSON()
    if (geometryData.rings) {
      fmeParameters.AreaOfInterest = JSON.stringify(geometryData)
    }
  }

  return fmeParameters
}

// Helper functions for map initialization
const createGraphicsLayers = (
  jmv: JimuMapView,
  modules: EsriModules,
  setMutableValue: (key: string, value: any) => void
) => {
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

  return layer // Return the main layer for sketch setup
}

const createMeasurementWidgets = (
  jmv: JimuMapView,
  modules: EsriModules,
  setMutableValue: (key: string, value: any) => void
) => {
  if (jmv.view.type !== "2d") return

  if (modules.AreaMeasurement2D) {
    const areaMeasurement2D = new modules.AreaMeasurement2D({
      view: jmv.view,
      unit: "metric",
      visible: false,
    })
    setMutableValue("areaMeasurement2D", areaMeasurement2D)
    console.log(
      "FME Export - AreaMeasurement2D widget created (not added to UI)"
    )
  }

  if (modules.DistanceMeasurement2D) {
    const distanceMeasurement2D = new modules.DistanceMeasurement2D({
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

const createSketchViewModel = (
  jmv: JimuMapView,
  modules: EsriModules,
  layer: __esri.GraphicsLayer,
  handleDrawingComplete: (evt: any) => void
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

  // Configure symbols
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

  // Add event handler
  sketchViewModel.on("create", (evt: __esri.SketchCreateEvent) => {
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

  return sketchViewModel
}

// Helper function to hide measurement widgets
const hideMeasurementWidgets = (mutableState: any) => {
  const { areaMeasurement2D, distanceMeasurement2D } = mutableState

  if (areaMeasurement2D) {
    try {
      areaMeasurement2D.visible = false
      areaMeasurement2D.viewModel.clear()
      console.log("FME Export - Ensured area measurement widget is hidden")
    } catch (error) {
      console.warn("FME Export - Failed to hide area measurement:", error)
    }
  }

  if (distanceMeasurement2D) {
    try {
      distanceMeasurement2D.visible = false
      distanceMeasurement2D.viewModel.clear()
      console.log("FME Export - Ensured distance measurement widget is hidden")
    } catch (error) {
      console.warn("FME Export - Failed to hide distance measurement:", error)
    }
  }
}

const processFmeResponse = (
  fmeResponse: any,
  workspace: string,
  userEmail: string
): ExportResult => {
  if (!fmeResponse?.data) {
    return {
      success: false,
      message: "Unexpected response from FME server",
      code: "INVALID_RESPONSE",
    }
  }

  const responseData = fmeResponse.data
  const serviceResp = responseData.serviceResponse || responseData
  const status = serviceResp.statusInfo?.status || serviceResp.status
  const jobId = serviceResp.jobID || serviceResp.id || Date.now()

  if (status === "success") {
    return {
      success: true,
      message: "Export order submitted successfully",
      jobId,
      workspaceName: workspace,
      email: userEmail,
      downloadUrl: serviceResp.url,
    }
  } else {
    const errorMessage =
      serviceResp.statusInfo?.message ||
      serviceResp.message ||
      "FME job submission failed"
    return {
      success: false,
      message: errorMessage,
      code: "FME_JOB_FAILURE",
    }
  }
}

// Format area utility function
export function formatArea(area: number): string {
  if (!area || isNaN(area) || area <= 0) return "0 m²"

  const AREA_THRESHOLD_SQKM = 1000000
  const AREA_CONVERSION_FACTOR = 1000000
  const AREA_DECIMAL_PLACES = 2

  if (area >= AREA_THRESHOLD_SQKM) {
    const areaInSqKm = area / AREA_CONVERSION_FACTOR
    const formattedKmNumber = new Intl.NumberFormat("sv-SE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: AREA_DECIMAL_PLACES,
    }).format(areaInSqKm)
    return `${formattedKmNumber} km²`
  }

  const formattedNumber = new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(area))
  return `${formattedNumber} m²`
}

export default function Widget(
  props: AllWidgetProps<FmeExportConfig> & { state: FmeWidgetState }
): React.ReactElement {
  const { id: widgetId, useMapWidgetIds, dispatch, state: reduxState } = props
  const translate = hooks.useTranslation(defaultMessages)

  // Simple notification state
  const [notification, setNotification] =
    React.useState<NotificationState | null>(null)

  // Load ArcGIS modules and get state access
  const { modules, loading: modulesLoading } = useArcGISModules()
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
      const calculatedArea = calculatePolygonArea(geometry, modules)

      dispatch({
        type: FmeActionType.SET_GEOMETRY,
        geometry: geometryJson,
        drawnArea: Math.abs(calculatedArea),
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

      console.log(
        "FME Export - Drawing completed with area:",
        Math.abs(calculatedArea),
        "square meters"
      )

      dispatch(fmeActions.setViewMode(ViewMode.WORKSPACE_SELECTION))
    } catch (error) {
      dispatch(
        fmeActions.setError(
          createError(
            "Failed to complete drawing",
            ErrorType.VALIDATION,
            "DRAWING_COMPLETE_ERROR"
          )
        )
      )
    }
  })

  // Form submission handler with FME export
  const handleFormSubmit = hooks.useEventCallback(async (formData: any) => {
    const hasGeometry =
      !!reduxState.geometryJson || !!mutableState.currentGeometry
    if (!hasGeometry || !reduxState.selectedWorkspace) {
      return
    }

    dispatch(fmeActions.setUiState(StateType.LOADING))
    updateLoadingState(dispatch, translate("preparingExportRequest"))
    dispatch(fmeActions.setLoadingFlags({ isSubmittingOrder: true }))

    try {
      updateLoadingState(dispatch, translate("connectingToFmeServer"))

      const userEmail = await getUserEmail()
      const fmeClient = createFmeFlowClient(props.config)
      const workspace = reduxState.selectedWorkspace
      const fmeParameters = prepareFmeParameters(
        formData,
        userEmail,
        reduxState.geometryJson,
        mutableState.currentGeometry
      )

      updateLoadingState(dispatch, translate("submittingOrder"))
      const fmeResponse = await fmeClient.runDataDownload(
        workspace,
        fmeParameters
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

      dispatch({ type: FmeActionType.SET_ORDER_RESULT, orderResult: result })
      dispatch(fmeActions.setViewMode(ViewMode.ORDER_RESULT))
    } catch (error) {
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

      const layer = createGraphicsLayers(jmv, modules, setMutableValue)
      createMeasurementWidgets(jmv, modules, setMutableValue)

      const sketchViewModel = createSketchViewModel(
        jmv,
        modules,
        layer,
        handleDrawingComplete
      )
      setMutableValue("sketchViewModel", sketchViewModel)
    } catch (error) {
      dispatch(
        fmeActions.setError(
          createError(
            "Failed to initialize map",
            ErrorType.MODULE,
            "MAP_INIT_ERROR"
          )
        )
      )
    }
  })

  // Helper function to get instruction text based on drawing tool
  const getInstructionText = hooks.useEventCallback((tool: DrawingTool) => {
    switch (tool) {
      case DrawingTool.RECTANGLE:
        return translate("rectangleDrawingInstructions")
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
    hideMeasurementWidgets(mutableState)

    // Start the sketch drawing based on the selected tool
    if (tool === DrawingTool.RECTANGLE) {
      console.log("FME Export - Creating rectangle")
      sketchViewModel.create("rectangle")
    } else {
      console.log("FME Export - Creating polygon")
      sketchViewModel.create("polygon")
    }
  })

  // Reset handler - clears all graphics and resets drawing state
  const handleReset = hooks.useEventCallback(() => {
    clearAllGraphics()

    if (sketchViewModel) sketchViewModel.cancel()

    // Reset measurement widgets
    hideMeasurementWidgets(mutableState)

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
    // Show more specific loading message based on what's being loaded
    const loadingMessage = modules
      ? translate("preparingMapTools")
      : translate("loadingMapServices")

    return (
      <StateRenderer
        state={StateType.LOADING}
        data={{
          message: loadingMessage,
        }}
      />
    )
  }

  // Render error state with StateRenderer
  if (reduxState.error && reduxState.error.severity === "error") {
    return (
      <StateRenderer
        state={StateType.ERROR}
        data={{
          error: reduxState.error,
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
