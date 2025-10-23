import { WidgetState } from "jimu-core"
import type { PopupSuppressionRecord } from "../../config/index"

export const buildSymbols = (
  rgb: readonly [number, number, number],
  options?: {
    outlineWidth?: number
    fillOpacity?: number
  }
) => {
  const base = [rgb[0], rgb[1], rgb[2]] as [number, number, number]
  const rawOutlineWidth =
    typeof options?.outlineWidth === "number" ? options.outlineWidth : 2
  const outlineWidth = Math.min(5, Math.max(0.1, rawOutlineWidth))
  const rawFillOpacity =
    typeof options?.fillOpacity === "number" ? options.fillOpacity : 0.2
  const fillOpacity = Math.min(1, Math.max(0, rawFillOpacity))

  const highlight = {
    type: "simple-fill" as const,
    color: [...base, fillOpacity] as [number, number, number, number],
    outline: {
      color: base,
      width: outlineWidth,
    },
  }
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
  } as const
  return { HIGHLIGHT_SYMBOL: highlight, DRAWING_SYMBOLS: symbols }
}

export const normalizeSketchCreateTool = (
  tool: string | null | undefined
): "polygon" | "rectangle" | null => {
  if (!tool) return null
  const normalized = tool.toLowerCase()
  if (normalized === "extent" || normalized === "rectangle") {
    return "rectangle"
  }
  if (normalized === "polygon") {
    return "polygon"
  }
  return null
}

const unwrapDynamicModule = (module: unknown) =>
  (module as any)?.default ?? module

export async function loadArcgisModules(
  modules: readonly string[]
): Promise<unknown[]> {
  if (!Array.isArray(modules) || !modules.length) {
    return []
  }

  const stub = (globalThis as any)?.__ESRI_TEST_STUB__
  if (typeof stub === "function") {
    return stub(modules)
  }

  try {
    const mod = await import("jimu-arcgis")
    const loader = (mod as any)?.loadArcGISJSAPIModules
    if (typeof loader !== "function") {
      throw new Error("ARCGIS_MODULE_ERROR")
    }
    const loaded = await loader(modules as string[])
    return (loaded || []).map(unwrapDynamicModule)
  } catch (error) {
    console.log("Critical: Failed to load jimu-arcgis module", error)
    throw new Error("ARCGIS_MODULE_ERROR")
  }
}

const restorePopupAutoOpen = (record: PopupSuppressionRecord): void => {
  const popupAny = record.popup as unknown as { autoOpenEnabled?: boolean }
  try {
    const restore =
      typeof record.prevAutoOpen === "boolean" ? record.prevAutoOpen : true
    popupAny.autoOpenEnabled = restore
  } catch {}
}

const closePopupSafely = (
  view: __esri.MapView | __esri.SceneView | null | undefined,
  popup: __esri.Popup | null | undefined
): void => {
  try {
    if (view && typeof view.closePopup === "function") {
      view.closePopup()
    }
  } catch {}
}

export const createPopupSuppressionRecord = (
  popup: __esri.Popup | null | undefined,
  view: __esri.MapView | __esri.SceneView | null | undefined
): PopupSuppressionRecord | null => {
  if (!popup) return null

  const popupAny = popup as unknown as { autoOpenEnabled?: boolean }
  const previousAutoOpen =
    typeof popupAny.autoOpenEnabled === "boolean"
      ? popupAny.autoOpenEnabled
      : undefined

  closePopupSafely(view, popup)

  try {
    popupAny.autoOpenEnabled = false
  } catch {}

  let handle: __esri.WatchHandle | null = null
  if (typeof popup.watch === "function") {
    try {
      handle = popup.watch("visible", (value: boolean) => {
        if (value) {
          closePopupSafely(view, popup)
        }
      })
    } catch {}
  }

  return {
    popup,
    view: view || null,
    handle,
    prevAutoOpen: previousAutoOpen,
  }
}

export const releasePopupSuppressionRecord = (
  record: PopupSuppressionRecord | null | undefined
): void => {
  if (!record) return

  try {
    record.handle?.remove?.()
  } catch {}

  restorePopupAutoOpen(record)
}

export const clearPopupSuppression = (
  ref: { current: PopupSuppressionRecord | null } | null | undefined
): void => {
  const record = ref?.current
  if (!record) return
  releasePopupSuppressionRecord(record)
  ref.current = null
}

export const applyPopupSuppression = (
  ref: { current: PopupSuppressionRecord | null } | null | undefined,
  popup: __esri.Popup | null | undefined,
  view: __esri.MapView | __esri.SceneView | null | undefined
): void => {
  if (!ref) return

  if (!popup) {
    clearPopupSuppression(ref)
    return
  }

  if (ref.current?.popup === popup) {
    try {
      if (view && typeof view.closePopup === "function") {
        view.closePopup()
      }
    } catch {}
    return
  }

  clearPopupSuppression(ref)

  const record = createPopupSuppressionRecord(popup, view)
  ref.current = record
}

class PopupSuppressionManager {
  private record: PopupSuppressionRecord | null = null

  private readonly owners = new Set<symbol>()

  acquire(
    ownerId: symbol,
    popup: __esri.Popup | null | undefined,
    view: __esri.MapView | __esri.SceneView | null | undefined
  ): void {
    if (!popup) {
      this.release(ownerId)
      return
    }

    const activePopup = this.record?.popup
    if (!activePopup || activePopup !== popup) {
      this.teardown()
      this.owners.clear()
      const record = createPopupSuppressionRecord(popup, view)
      if (!record) return
      this.record = record
    }

    this.owners.add(ownerId)
  }

  release(ownerId: symbol): void {
    if (!this.owners.delete(ownerId)) return
    if (this.owners.size === 0) {
      this.teardown()
    }
  }

  releaseAll(): void {
    if (this.owners.size === 0 && !this.record) return
    this.owners.clear()
    this.teardown()
  }

  private teardown(): void {
    if (!this.record) return
    releasePopupSuppressionRecord(this.record)
    this.record = null
  }
}

export const popupSuppressionManager = new PopupSuppressionManager()

export const computeWidgetsToClose = (
  runtimeInfo:
    | { [id: string]: { state?: WidgetState | string } | undefined }
    | null
    | undefined,
  widgetId: string
): string[] => {
  if (!runtimeInfo) return []

  const ids: string[] = []

  for (const [id, info] of Object.entries(runtimeInfo)) {
    if (id === widgetId || !info) continue
    const stateRaw = info.state
    if (!stateRaw) continue
    const normalized = String(stateRaw).toUpperCase()

    if (
      normalized === WidgetState.Closed ||
      normalized === WidgetState.Hidden
    ) {
      continue
    }

    ids.push(id)
  }

  return ids
}
