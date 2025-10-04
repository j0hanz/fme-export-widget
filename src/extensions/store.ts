import * as SeamlessImmutable from "seamless-immutable"
import type { extensionSpec, ImmutableObject } from "jimu-core"
import {
  ViewMode,
  DrawingTool,
  FmeActionType,
  FME_ACTION_TYPES,
  type FmeWidgetState,
  type ErrorState,
  type SerializableErrorState,
  type WorkspaceItem,
  type WorkspaceItemDetail,
  type WorkspaceParameter,
  type ExportResult,
  type IMFmeGlobalState,
  type IMStateWithFmeExport,
  type ErrorWithScope,
  type ErrorScope,
} from "../config"
import { toSerializable } from "../shared/utils"

export const fmeActions = {
  setViewMode: (viewMode: ViewMode, widgetId: string) => ({
    type: FmeActionType.SET_VIEW_MODE,
    viewMode,
    widgetId,
  }),
  resetState: (widgetId: string) => ({
    type: FmeActionType.RESET_STATE,
    widgetId,
  }),
  setGeometry: (
    geometry: __esri.Geometry | null,
    drawnArea: number | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_GEOMETRY,
    geometryJson: serializeGeometry(geometry),
    drawnArea,
    widgetId,
  }),
  setDrawingTool: (drawingTool: DrawingTool, widgetId: string) => ({
    type: FmeActionType.SET_DRAWING_TOOL,
    drawingTool,
    widgetId,
  }),
  completeDrawing: (
    geometry: __esri.Geometry,
    drawnArea: number,
    nextViewMode: ViewMode,
    widgetId: string
  ) => ({
    type: FmeActionType.COMPLETE_DRAWING,
    geometryJson: serializeGeometry(geometry),
    drawnArea,
    nextViewMode,
    widgetId,
  }),
  setOrderResult: (orderResult: ExportResult | null, widgetId: string) => ({
    type: FmeActionType.SET_ORDER_RESULT,
    orderResult,
    widgetId,
  }),
  setWorkspaceItems: (
    workspaceItems: readonly WorkspaceItem[],
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEMS,
    workspaceItems,
    widgetId,
  }),
  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_PARAMETERS,
    workspaceParameters,
    workspaceName,
    widgetId,
  }),
  setSelectedWorkspace: (workspaceName: string | null, widgetId: string) => ({
    type: FmeActionType.SET_SELECTED_WORKSPACE,
    workspaceName,
    widgetId,
  }),
  setWorkspaceItem: (
    workspaceItem: WorkspaceItemDetail | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEM,
    workspaceItem,
    widgetId,
  }),
  setError: (
    scope: ErrorScope,
    error: ErrorState | SerializableErrorState | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_ERROR,
    scope,
    error: error ? toSerializable(error) : null,
    widgetId,
  }),
  clearError: (scope: ErrorScope | "all", widgetId: string) => ({
    type: FmeActionType.CLEAR_ERROR,
    scope,
    widgetId,
  }),
  clearWorkspaceState: (widgetId: string) => ({
    type: FmeActionType.CLEAR_WORKSPACE_STATE,
    widgetId,
  }),
  resetToDrawing: (widgetId: string) => ({
    type: FmeActionType.RESET_TO_DRAWING,
    widgetId,
  }),
  completeStartup: (widgetId: string) => ({
    type: FmeActionType.COMPLETE_STARTUP,
    widgetId,
  }),
  // Internal action to remove entire widget state (e.g. on unmount)
  removeWidgetState: (widgetId: string) => ({
    type: FmeActionType.REMOVE_WIDGET_STATE,
    widgetId,
  }),
}

export type FmeAction = ReturnType<(typeof fmeActions)[keyof typeof fmeActions]>

type ActionFrom<K extends keyof typeof fmeActions> = ReturnType<
  (typeof fmeActions)[K]
>

export const initialFmeState: FmeWidgetState = {
  // View
  viewMode: ViewMode.STARTUP_VALIDATION,

  // Drawing
  drawingTool: DrawingTool.POLYGON,
  geometryJson: null,
  drawnArea: 0,

  // Export
  orderResult: null,

  // Workspace
  workspaceItems: [],
  selectedWorkspace: null,
  workspaceParameters: [],
  workspaceItem: null,

  // Errors
  error: null,
}

// Seamless-immutable typing is broken, so we need to force it here
const Immutable = ((SeamlessImmutable as any).default ?? SeamlessImmutable) as (
  input: any
) => any

const createImmutableState = (): ImmutableObject<FmeWidgetState> =>
  Immutable(initialFmeState) as ImmutableObject<FmeWidgetState>

const normalizeWorkspaceName = (
  name: string | null | undefined
): string | null => {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  return trimmed || null
}

const serializeGeometry = (
  geometry: __esri.Geometry | null | undefined
): unknown => {
  if (!geometry) return null
  const serializer = (geometry as any)?.toJSON
  if (typeof serializer !== "function") return null
  try {
    return serializer.call(geometry)
  } catch {
    return null
  }
}

// Reducer for a single widget instance
const reduceOne = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeAction
): ImmutableObject<FmeWidgetState> => {
  switch (action.type) {
    case FmeActionType.SET_VIEW_MODE: {
      const act = action as ActionFrom<"setViewMode">
      if (state.viewMode === act.viewMode) return state
      return state.set("viewMode", act.viewMode)
    }

    case FmeActionType.RESET_STATE:
      return createImmutableState()

    case FmeActionType.SET_GEOMETRY: {
      const act = action as ActionFrom<"setGeometry">
      return state
        .set("geometryJson", act.geometryJson)
        .set("drawnArea", act.drawnArea ?? 0)
    }

    case FmeActionType.COMPLETE_DRAWING: {
      const act = action as ActionFrom<"completeDrawing">
      const nextView = act.nextViewMode ?? state.viewMode
      return state
        .set("geometryJson", act.geometryJson)
        .set("drawnArea", act.drawnArea ?? 0)
        .set("viewMode", nextView)
    }

    case FmeActionType.SET_DRAWING_TOOL: {
      const act = action as ActionFrom<"setDrawingTool">
      return state.set("drawingTool", act.drawingTool)
    }

    case FmeActionType.SET_ORDER_RESULT: {
      const act = action as ActionFrom<"setOrderResult">
      return state.set("orderResult", act.orderResult)
    }

    case FmeActionType.SET_WORKSPACE_ITEMS: {
      const act = action as ActionFrom<"setWorkspaceItems">
      return state.set("workspaceItems", act.workspaceItems)
    }

    case FmeActionType.SET_WORKSPACE_PARAMETERS: {
      const act = action as ActionFrom<"setWorkspaceParameters">
      const requested = normalizeWorkspaceName(act.workspaceName)
      const currentSelection = normalizeWorkspaceName(state.selectedWorkspace)

      if (requested && currentSelection && requested !== currentSelection) {
        return state
      }

      let nextState = state.set("workspaceParameters", act.workspaceParameters)

      if (requested !== currentSelection) {
        nextState = nextState
          .set("selectedWorkspace", requested)
          .set("orderResult", null)
      }

      return nextState
    }

    case FmeActionType.SET_SELECTED_WORKSPACE: {
      const act = action as ActionFrom<"setSelectedWorkspace">
      const desired = normalizeWorkspaceName(act.workspaceName)
      const current = normalizeWorkspaceName(state.selectedWorkspace)
      if (current === desired) {
        return state
      }
      return state
        .set("selectedWorkspace", desired)
        .set("workspaceParameters", [])
        .set("workspaceItem", null)
        .set("orderResult", null)
    }

    case FmeActionType.SET_WORKSPACE_ITEM: {
      const act = action as ActionFrom<"setWorkspaceItem">
      const current = normalizeWorkspaceName(state.selectedWorkspace)
      const itemName = normalizeWorkspaceName(act.workspaceItem?.name)

      if (act.workspaceItem && current && itemName && itemName !== current) {
        return state
      }

      return state.set("workspaceItem", act.workspaceItem)
    }

    case FmeActionType.CLEAR_WORKSPACE_STATE: {
      return state
        .set("workspaceItems", [])
        .set("selectedWorkspace", null)
        .set("workspaceParameters", [])
        .set("workspaceItem", null)
        .set("orderResult", null)
    }

    case FmeActionType.SET_ERROR: {
      const act = action as ActionFrom<"setError">
      const current = state.error
      if (!act.error) {
        if (current?.scope === act.scope) {
          return state.set("error", null)
        }
        return state
      }
      const errorWithScope: ErrorWithScope = {
        scope: act.scope,
        details: act.error,
      }
      return state.set("error", errorWithScope)
    }

    case FmeActionType.CLEAR_ERROR: {
      const act = action as ActionFrom<"clearError">
      if (act.scope === "all") {
        return state.error ? state.set("error", null) : state
      }
      const current = state.error
      if (current?.scope === act.scope) {
        return state.set("error", null)
      }
      return state
    }

    case FmeActionType.RESET_TO_DRAWING:
      return state
        .set("geometryJson", null)
        .set("drawnArea", 0)
        .set("error", null)
        .set("selectedWorkspace", null)
        .set("workspaceParameters", [])
        .set("workspaceItem", null)
        .set("orderResult", null)
        .set("viewMode", ViewMode.DRAWING)

    case FmeActionType.COMPLETE_STARTUP:
      return state.set("viewMode", ViewMode.INITIAL)

    case FmeActionType.REMOVE_WIDGET_STATE:
      return state
  }

  return state
}

const ensureSubState = (
  global: IMFmeGlobalState,
  widgetId: string
): ImmutableObject<FmeWidgetState> => {
  const current = (global as any).byId?.[widgetId] as
    | ImmutableObject<FmeWidgetState>
    | undefined
  return (current ??
    (createImmutableState() as unknown)) as ImmutableObject<FmeWidgetState>
}

const setSubState = (
  global: IMFmeGlobalState,
  widgetId: string,
  next: ImmutableObject<FmeWidgetState>
): IMFmeGlobalState => {
  const byId = { ...((global as any).byId || {}) }
  byId[widgetId] = next
  return Immutable({ byId }) as unknown as IMFmeGlobalState
}

export const selectFmeSlice = (
  state: IMStateWithFmeExport,
  widgetId: string
): ImmutableObject<FmeWidgetState> | null => {
  const slice = (state as any)?.["fme-state"]?.byId?.[widgetId] as
    | ImmutableObject<FmeWidgetState>
    | undefined
  return slice ?? null
}

export const createFmeSelectors = (widgetId: string) => {
  const getSlice = (state: IMStateWithFmeExport) =>
    selectFmeSlice(state, widgetId)

  return {
    selectSlice: getSlice,
    selectViewMode: (state: IMStateWithFmeExport) =>
      getSlice(state)?.viewMode ?? initialFmeState.viewMode,
    selectGeometryJson: (state: IMStateWithFmeExport) =>
      getSlice(state)?.geometryJson ?? null,
    selectDrawnArea: (state: IMStateWithFmeExport) =>
      getSlice(state)?.drawnArea ?? initialFmeState.drawnArea,
    selectWorkspaceParameters: (state: IMStateWithFmeExport) =>
      getSlice(state)?.workspaceParameters ??
      initialFmeState.workspaceParameters,
    selectWorkspaceItem: (state: IMStateWithFmeExport) =>
      getSlice(state)?.workspaceItem ?? initialFmeState.workspaceItem,
    selectSelectedWorkspace: (state: IMStateWithFmeExport) =>
      getSlice(state)?.selectedWorkspace ?? initialFmeState.selectedWorkspace,
    selectOrderResult: (state: IMStateWithFmeExport) =>
      getSlice(state)?.orderResult ?? initialFmeState.orderResult,
    selectError: (state: IMStateWithFmeExport) =>
      getSlice(state)?.error ?? initialFmeState.error,
  }
}

// Root reducer that delegates to per-widget reducer
const initialGlobalState = Immutable({
  byId: {},
}) as unknown as IMFmeGlobalState

const isFmeAction = (candidate: unknown): candidate is FmeAction => {
  if (!candidate || typeof candidate !== "object") return false
  const action = candidate as { type?: unknown; widgetId?: unknown }
  if (typeof action.type !== "string") return false
  if (!FME_ACTION_TYPES.includes(action.type as FmeActionType)) return false
  return typeof action.widgetId === "string"
}

const fmeReducer = (
  state: IMFmeGlobalState = initialGlobalState,
  action: unknown
): IMFmeGlobalState => {
  if (!isFmeAction(action)) {
    return state
  }
  // Special: remove entire widget state
  if (action?.type === FmeActionType.REMOVE_WIDGET_STATE && action?.widgetId) {
    const byId = { ...((state as any)?.byId || {}) }
    if (!(action.widgetId in byId)) {
      return state
    }
    delete byId[action.widgetId]
    return Immutable({ byId }) as unknown as IMFmeGlobalState
  }

  const widgetId: string | undefined = action?.widgetId
  if (!widgetId) {
    // No widgetId provided — return state unchanged for safety
    return state
  }

  const prevSub = ensureSubState(state, widgetId)
  const nextSub = reduceOne(prevSub, action)
  if (nextSub === prevSub) return state
  return setSubState(state, widgetId, nextSub)
}

// Store extension
export default class FmeReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "fme-export_store"

  getActions(): string[] {
    // Return all action types as string array
    return [...FME_ACTION_TYPES]
  }

  getInitLocalState(): { byId: { [id: string]: FmeWidgetState } } {
    return { byId: {} }
  }

  getReducer() {
    return fmeReducer
  }

  getStoreKey() {
    return "fme-state"
  }
}
