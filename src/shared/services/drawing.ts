import type { JimuMapView } from "jimu-arcgis";
import type {
  DrawingCompletionResult,
  DrawingSessionState,
  EsriModules,
} from "../../config/index";
import { DrawingTool, LAYER_CONFIG, ViewMode } from "../../config/index";
import { fmeActions } from "../../extensions/store";
import { safeCancelSketch } from "../hooks";
import { logIfNotAbort, normalizeSketchCreateTool } from "../utils";
import {
  calcArea,
  checkMaxArea,
  evaluateArea,
  validatePolygon,
} from "../utils/geometry";

// Skapar GraphicsLayers för ritning och preview
export function createLayers(
  jmv: JimuMapView,
  modules: EsriModules,
  setGraphicsLayer: (layer: __esri.GraphicsLayer) => void
): __esri.GraphicsLayer {
  const layer = new modules.GraphicsLayer(LAYER_CONFIG);
  jmv.view.map.add(layer);
  setGraphicsLayer(layer);

  return layer;
}

// Konfigurerar event-handlers för SketchViewModel (create/update/undo/redo)
export function setupSketchEventHandlers({
  sketchViewModel,
  onDrawComplete,
  dispatch,
  widgetId,
  onDrawingSessionChange,
  onSketchToolStart,
}: {
  sketchViewModel: __esri.SketchViewModel;
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void;
  dispatch: (action: unknown) => void;
  widgetId: string;
  onDrawingSessionChange: (updates: Partial<DrawingSessionState>) => void;
  onSketchToolStart: (tool: DrawingTool) => void;
}): () => void {
  let clickCount = 0;

  const createHandle = sketchViewModel.on(
    "create",
    (evt: __esri.SketchCreateEvent) => {
      switch (evt.state) {
        case "start": {
          clickCount = 0;
          const normalizedTool = normalizeSketchCreateTool(evt.tool);
          if (!normalizedTool) {
            safeCancelSketch(sketchViewModel);
            onDrawingSessionChange({ isActive: false, clickCount: 0 });
            return;
          }
          onDrawingSessionChange({ isActive: true, clickCount: 0 });
          onSketchToolStart(
            normalizedTool === "rectangle"
              ? DrawingTool.RECTANGLE
              : DrawingTool.POLYGON
          );
          break;
        }

        case "active": {
          const normalizedTool = normalizeSketchCreateTool(evt.tool);
          if (normalizedTool === "polygon" && evt.graphic?.geometry) {
            const geometry = evt.graphic.geometry as __esri.Polygon;
            const vertices = geometry.rings?.[0];
            const actualClicks = vertices
              ? Math.max(0, vertices.length - 1)
              : 0;
            if (actualClicks > clickCount) {
              clickCount = actualClicks;
              onDrawingSessionChange({
                clickCount: actualClicks,
                isActive: true,
              });
              if (actualClicks === 1) {
                dispatch(fmeActions.setViewMode(ViewMode.DRAWING, widgetId));
              }
            }
          } else if (normalizedTool === "rectangle" && clickCount !== 1) {
            clickCount = 1;
            onDrawingSessionChange({ clickCount: 1, isActive: true });
          }
          break;
        }

        case "complete":
          clickCount = 0;
          onDrawingSessionChange({ isActive: false, clickCount: 0 });
          try {
            onDrawComplete(evt);
          } catch (err: unknown) {
            logIfNotAbort("onDrawComplete error", err);
          }
          break;

        case "cancel":
          clickCount = 0;
          onDrawingSessionChange({ isActive: false, clickCount: 0 });
          break;
      }
    }
  );

  const updateHandle = sketchViewModel.on(
    "update",
    (evt: __esri.SketchUpdateEvent) => {
      if (
        evt.state === "complete" &&
        Array.isArray(evt.graphics) &&
        evt.graphics.length > 0 &&
        (evt.graphics[0] as any)?.geometry
      ) {
        const normalizedTool = normalizeSketchCreateTool((evt as any)?.tool);
        try {
          onDrawComplete({
            graphic: evt.graphics[0] as any,
            state: "complete",
            tool: normalizedTool ?? (evt as any).tool,
          } as any);
        } catch (err: unknown) {
          logIfNotAbort("onDrawComplete update error", err);
        }
      }
    }
  );

  return () => {
    try {
      createHandle?.remove();
    } catch {}
    try {
      updateHandle?.remove();
    } catch {}
    try {
      (sketchViewModel as any).__fmeCleanup__ = undefined;
    } catch {}
  };
}

// Processes drawing completion with validation and area calculation

export async function processDrawingCompletion(params: {
  geometry: __esri.Geometry | undefined;
  modules: any;
  graphicsLayer: __esri.GraphicsLayer | undefined;
  config: any;
  signal: AbortSignal;
}): Promise<DrawingCompletionResult> {
  const { geometry, modules, config, signal } = params;

  if (!geometry) {
    return { success: false, error: { code: "NO_GEOMETRY" } };
  }

  if (signal.aborted) {
    return { success: false, error: { code: "ABORTED" } };
  }

  const validation = await validatePolygon(geometry, modules);

  if (signal.aborted) {
    return { success: false, error: { code: "ABORTED" } };
  }

  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const geomForUse = validation.simplified ?? (geometry as __esri.Polygon);
  const calculatedArea = await calcArea(geomForUse, modules);

  if (signal.aborted) {
    return { success: false, error: { code: "ABORTED" } };
  }

  if (!calculatedArea || calculatedArea <= 0) {
    return {
      success: false,
      error: { code: "ZERO_AREA", message: "geometryInvalidCode" },
    };
  }

  const normalizedArea = Math.abs(calculatedArea);
  const areaEvaluation = evaluateArea(normalizedArea, {
    maxArea: config?.maxArea,
    largeArea: config?.largeArea,
  });

  if (signal.aborted) {
    return { success: false, error: { code: "ABORTED" } };
  }

  if (areaEvaluation.exceedsMaximum) {
    const maxCheck = checkMaxArea(normalizedArea, config?.maxArea);
    return {
      success: false,
      error: {
        code: maxCheck.code,
        message: maxCheck.message || "geometryAreaTooLargeCode",
      },
    };
  }

  return {
    success: true,
    geometry: geomForUse,
    area: normalizedArea,
    shouldWarn: areaEvaluation.shouldWarn,
  };
}

// Skapar SketchViewModel med event-handlers och cleanup-funktioner
export function createSketchVM({
  jmv,
  modules,
  layer,
  onDrawComplete,
  dispatch,
  widgetId,
  symbols,
  onDrawingSessionChange,
  onSketchToolStart,
}: {
  jmv: JimuMapView;
  modules: EsriModules;
  layer: __esri.GraphicsLayer;
  onDrawComplete: (evt: __esri.SketchCreateEvent) => void;
  dispatch: (action: unknown) => void;
  widgetId: string;
  symbols: {
    polygon: any;
    polyline: any;
    point: any;
  };
  onDrawingSessionChange: (updates: Partial<DrawingSessionState>) => void;
  onSketchToolStart: (tool: DrawingTool) => void;
}): {
  sketchViewModel: __esri.SketchViewModel;
  cleanup: () => void;
} {
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
  });

  const cleanup = setupSketchEventHandlers({
    sketchViewModel,
    onDrawComplete,
    dispatch,
    widgetId,
    onDrawingSessionChange,
    onSketchToolStart,
  });
  (sketchViewModel as any).__fmeCleanup__ = cleanup;
  return { sketchViewModel, cleanup };
}
