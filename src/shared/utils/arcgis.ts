import { WidgetState } from "jimu-core";
import type {
  AttributeCollectionResult,
  LayerAttributeInfo,
  PopupInternal,
  PopupSuppressionRecord,
} from "../../config/index";

const isPopupInternal = (popup: unknown): popup is PopupInternal => {
  return popup != null && typeof popup === "object";
};

const modulePromiseCache = new Map<string, Promise<unknown[]>>();

export const buildSymbols = (
  rgb: readonly [number, number, number],
  options?: {
    outlineWidth?: number;
    fillOpacity?: number;
  }
) => {
  const base = [rgb[0], rgb[1], rgb[2]] as [number, number, number];
  const rawOutlineWidth =
    typeof options?.outlineWidth === "number" ? options.outlineWidth : 2;
  const outlineWidth = Math.min(5, Math.max(0.1, rawOutlineWidth));
  const rawFillOpacity =
    typeof options?.fillOpacity === "number" ? options.fillOpacity : 0.2;
  const fillOpacity = Math.min(1, Math.max(0, rawFillOpacity));

  const highlight = {
    type: "simple-fill" as const,
    color: [...base, fillOpacity] as [number, number, number, number],
    outline: {
      color: base,
      width: outlineWidth,
    },
  };
  const symbols = {
    polygon: highlight,
    polyline: {
      type: "simple-line",
      color: base,
      width: outlineWidth,
    },
    point: {
      type: "simple-marker",
      style: "circle",
      size: 8,
      color: base,
      outline: {
        color: [255, 255, 255],
        width: 1,
      },
    },
  } as const;
  return { HIGHLIGHT_SYMBOL: highlight, DRAWING_SYMBOLS: symbols };
};

export const normalizeSketchCreateTool = (
  tool: string | null | undefined
): "polygon" | "rectangle" | null => {
  if (!tool) return null;
  const normalized = tool.toLowerCase();
  if (normalized === "extent" || normalized === "rectangle") {
    return "rectangle";
  }
  if (normalized === "polygon") {
    return "polygon";
  }
  return null;
};

const unwrapDynamicModule = (module: unknown) =>
  (module as { default?: unknown })?.default ?? module;

export async function loadArcgisModules(
  modules: readonly string[]
): Promise<unknown[]> {
  if (!Array.isArray(modules) || !modules.length) {
    return [];
  }

  const stub = (globalThis as { __ESRI_TEST_STUB__?: unknown })
    ?.__ESRI_TEST_STUB__;
  if (typeof stub === "function") {
    return stub(modules);
  }

  const normalizedModules = modules.filter(
    (module): module is string =>
      typeof module === "string" && module.length > 0
  );
  if (!normalizedModules.length) {
    return [];
  }

  const cacheKey = JSON.stringify(normalizedModules);
  const cached = modulePromiseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const loaderPromise = (async () => {
    try {
      const mod = await import("jimu-arcgis");
      const loader = (mod as { loadArcGISJSAPIModules?: unknown })
        ?.loadArcGISJSAPIModules;
      if (typeof loader !== "function") {
        throw new Error("ARCGIS_MODULE_ERROR");
      }
      const loaded = await loader(normalizedModules);
      return (loaded || []).map(unwrapDynamicModule);
    } catch (error) {
      modulePromiseCache.delete(cacheKey);
      console.log("Critical: Failed to load jimu-arcgis module", error);
      throw new Error("ARCGIS_MODULE_ERROR");
    }
  })();

  modulePromiseCache.set(cacheKey, loaderPromise);
  return loaderPromise;
}

export const clearCachedArcgisModules = (): void => {
  modulePromiseCache.clear();
};

const restorePopupAutoOpen = (record: PopupSuppressionRecord): void => {
  const popup = record.popup;
  if (!isPopupInternal(popup)) return;

  const popupInternal = popup as PopupInternal;
  try {
    const restore =
      typeof record.prevAutoOpen === "boolean" ? record.prevAutoOpen : true;
    popupInternal.autoOpenEnabled = restore;
  } catch {}
};

const closePopupSafely = (
  view: __esri.MapView | __esri.SceneView | null | undefined,
  popup: __esri.Popup | null | undefined
): void => {
  try {
    if (popup && isPopupInternal(popup) && typeof popup.close === "function") {
      popup.close();
      return;
    }
    if (view && typeof view.closePopup === "function") {
      view.closePopup();
    }
  } catch {}
};

export const createPopupSuppressionRecord = (
  popup: __esri.Popup | null | undefined,
  view: __esri.MapView | __esri.SceneView | null | undefined
): PopupSuppressionRecord | null => {
  if (!popup || !isPopupInternal(popup)) return null;

  const popupInternal = popup as PopupInternal;
  const previousAutoOpen =
    typeof popupInternal.autoOpenEnabled === "boolean"
      ? popupInternal.autoOpenEnabled
      : undefined;

  closePopupSafely(view, popup);

  try {
    popupInternal.autoOpenEnabled = false;
  } catch {}

  let handle: __esri.WatchHandle | null = null;
  if (typeof popupInternal.watch === "function") {
    try {
      handle = popupInternal.watch("visible", (value: boolean) => {
        if (value) {
          closePopupSafely(view, popup);
        }
      });
    } catch {}
  }

  return {
    popup,
    view: view || null,
    handle,
    prevAutoOpen: previousAutoOpen,
  };
};

export const releasePopupSuppressionRecord = (
  record: PopupSuppressionRecord | null | undefined
): void => {
  if (!record) return;

  try {
    record.handle?.remove?.();
  } catch {}

  restorePopupAutoOpen(record);
};

export const clearPopupSuppression = (
  ref: { current: PopupSuppressionRecord | null } | null | undefined
): void => {
  const record = ref?.current;
  if (!record) return;
  releasePopupSuppressionRecord(record);
  ref.current = null;
};

export const applyPopupSuppression = (
  ref: { current: PopupSuppressionRecord | null } | null | undefined,
  popup: __esri.Popup | null | undefined,
  view: __esri.MapView | __esri.SceneView | null | undefined
): void => {
  if (!ref) return;

  if (!popup) {
    clearPopupSuppression(ref);
    return;
  }

  if (ref.current?.popup === popup) {
    try {
      if (view && typeof view.closePopup === "function") {
        view.closePopup();
      }
    } catch {}
    return;
  }

  clearPopupSuppression(ref);

  const record = createPopupSuppressionRecord(popup, view);
  ref.current = record;
};

class PopupSuppressionManager {
  private record: PopupSuppressionRecord | null = null;

  private readonly owners = new Set<symbol>();

  acquire(
    ownerId: symbol,
    popup: __esri.Popup | null | undefined,
    view: __esri.MapView | __esri.SceneView | null | undefined
  ): void {
    if (!popup) {
      this.release(ownerId);
      return;
    }

    const activePopup = this.record?.popup;
    if (!activePopup || activePopup !== popup) {
      this.teardown();
      this.owners.clear();
      const record = createPopupSuppressionRecord(popup, view);
      if (!record) return;
      this.record = record;
    }

    this.owners.add(ownerId);
  }

  release(ownerId: symbol): void {
    if (!this.owners.delete(ownerId)) return;
    if (this.owners.size === 0) {
      this.teardown();
    }
  }

  releaseAll(): void {
    if (this.owners.size === 0 && !this.record) return;
    this.owners.clear();
    this.teardown();
  }

  private teardown(): void {
    if (!this.record) return;
    releasePopupSuppressionRecord(this.record);
    this.record = null;
  }
}

export const popupSuppressionManager = new PopupSuppressionManager();

export const computeWidgetsToClose = (
  runtimeInfo:
    | { [id: string]: { state?: WidgetState | string } | undefined }
    | null
    | undefined,
  widgetId: string,
  exceptions?: readonly string[]
): string[] => {
  if (!runtimeInfo) return [];

  const ids: string[] = [];
  const exceptionSet = new Set(exceptions || []);

  for (const [id, info] of Object.entries(runtimeInfo)) {
    if (id === widgetId || !info) continue;
    if (exceptionSet.has(id)) continue;
    const stateRaw = info.state;
    if (!stateRaw) continue;
    const normalized = String(stateRaw).toUpperCase();

    if (
      normalized === WidgetState.Closed ||
      normalized === WidgetState.Hidden
    ) {
      continue;
    }

    ids.push(id);
  }

  return ids;
};

// ============================================
// Attribute Discovery (Added: Oct 24, 2025)
// ============================================

export function collectLayerAttributes(
  jimuMapView: __esri.MapView | __esri.SceneView | null | undefined
): AttributeCollectionResult {
  const attributes: LayerAttributeInfo[] = [];
  let layerCount = 0;
  let hasGeometry = false;

  if (!jimuMapView) {
    return { attributes, layerCount, totalAttributeCount: 0, hasGeometry };
  }

  const map = jimuMapView.map;
  if (!map || !map.layers) {
    return { attributes, layerCount, totalAttributeCount: 0, hasGeometry };
  }

  try {
    const allLayers = map.allLayers || map.layers;
    if (!allLayers) {
      return { attributes, layerCount, totalAttributeCount: 0, hasGeometry };
    }

    allLayers.forEach((layer: unknown) => {
      if (!layer || typeof layer !== "object") return;

      const typedLayer = layer as {
        type?: string;
        fields?: __esri.Field[] | null;
        title?: string;
        name?: string;
        id?: string;
        geometryType?: string;
      };

      if (!typedLayer.type) return;

      // Include feature layers, graphics layers with schema
      const isFeatureLayer = typedLayer.type === "feature";
      const isGraphicsLayer = typedLayer.type === "graphics";

      if (!isFeatureLayer && !isGraphicsLayer) return;

      const fields = typedLayer.fields;
      if (!fields || !Array.isArray(fields) || fields.length === 0) return;

      layerCount++;

      const layerName =
        typedLayer.title || typedLayer.name || typedLayer.id || "Unknown Layer";
      const layerId = typedLayer.id;
      const geometryType = typedLayer.geometryType;

      if (geometryType) {
        hasGeometry = true;
      }

      fields.forEach((field: __esri.Field) => {
        if (!field || !field.name) return;

        let domainInfo:
          | {
              readonly type: string;
              readonly codedValues?: ReadonlyArray<{
                readonly name: string;
                readonly code: unknown;
              }>;
            }
          | undefined;

        if (field.domain) {
          if (field.domain.type === "coded-value") {
            const codedDomain = field.domain as {
              type: string;
              codedValues?: Array<{ name: string; code: unknown }>;
            };
            domainInfo = {
              type: codedDomain.type || "unknown",
              codedValues: codedDomain.codedValues?.map((cv) => ({
                name: cv.name,
                code: cv.code,
              })),
            };
          } else {
            domainInfo = {
              type: field.domain.type || "unknown",
            };
          }
        }

        const attrInfo: LayerAttributeInfo = {
          name: field.name,
          alias: field.alias || field.name,
          type: field.type || "string",
          nullable: field.nullable ?? true,
          editable: field.editable ?? true,
          layerName,
          layerId,
          geometryType,
          domain: domainInfo,
        };

        attributes.push(attrInfo);
      });
    });
  } catch (error) {
    console.log("Error collecting layer attributes", error);
  }

  return {
    attributes,
    layerCount,
    totalAttributeCount: attributes.length,
    hasGeometry,
  };
}

export function attributesToOptions(
  result: AttributeCollectionResult
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  if (!result || !result.attributes || result.attributes.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const options: Array<{ value: string; label: string }> = [];

  result.attributes.forEach((attr) => {
    if (!attr || !attr.name) return;
    if (seen.has(attr.name)) return;

    seen.add(attr.name);

    const label =
      attr.layerName && attr.layerName !== "Unknown Layer"
        ? `${attr.name} (${attr.layerName})`
        : attr.alias || attr.name;

    options.push({
      value: attr.name,
      label,
    });
  });

  // Sort alphabetically by label
  options.sort((a, b) => a.label.localeCompare(b.label));

  return options;
}
