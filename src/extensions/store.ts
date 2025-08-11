import { Immutable } from "jimu-core"
import type { extensionSpec, ImmutableObject, IMState } from "jimu-core"
import {
  ViewMode,
  DrawingTool,
  FmeActionType,
  type FmeWidgetState,
  type FmeActions,
  type ErrorState,
  type WorkspaceItem,
  type WorkspaceParameter,
  type ExportResult,
} from "../shared/types"

// View actions
const viewActions = {
  setViewMode: (viewMode: ViewMode) => ({
    type: FmeActionType.SET_VIEW_MODE as const,
    viewMode,
  }),
  resetState: () => ({ type: FmeActionType.RESET_STATE as const }),
}

// Drawing actions
const drawingActions = {
  setGeometry: (geometry: __esri.Geometry | null, drawnArea?: number) => ({
    type: FmeActionType.SET_GEOMETRY as const,
    geometryJson: geometry ? ((geometry as any).toJSON?.() ?? null) : null,
    drawnArea,
  }),
  setDrawingState: (
    isDrawing: boolean,
    clickCount?: number,
    drawingTool?: DrawingTool
  ) => ({
    type: FmeActionType.SET_DRAWING_STATE as const,
    isDrawing,
    clickCount,
    drawingTool,
  }),
  setDrawingTool: (drawingTool: DrawingTool) => ({
    type: FmeActionType.SET_DRAWING_TOOL as const,
    drawingTool,
  }),
  setClickCount: (clickCount: number) => ({
    type: FmeActionType.SET_CLICK_COUNT as const,
    clickCount,
  }),
}

// Export actions
const exportActions = {
  setFormValues: (formValues: { [key: string]: unknown }) => ({
    type: FmeActionType.SET_FORM_VALUES as const,
    formValues,
  }),
  setOrderResult: (orderResult: ExportResult | null) => ({
    type: FmeActionType.SET_ORDER_RESULT as const,
    orderResult,
  }),
}

// Workspace actions
const workspaceActions = {
  setWorkspaceItems: (workspaceItems: readonly WorkspaceItem[]) => ({
    type: FmeActionType.SET_WORKSPACE_ITEMS as const,
    workspaceItems,
  }),
  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_PARAMETERS as const,
    workspaceParameters,
    workspaceName,
  }),
  setSelectedWorkspace: (workspaceName: string | null) => ({
    type: FmeActionType.SET_SELECTED_WORKSPACE as const,
    workspaceName,
  }),
  setWorkspaceItem: (workspaceItem: WorkspaceItem) => ({
    type: FmeActionType.SET_WORKSPACE_ITEM as const,
    workspaceItem,
  }),
}

// Loading actions
const loadingActions = {
  setLoadingFlags: (flags: {
    isModulesLoading?: boolean
    isSubmittingOrder?: boolean
  }) => ({ type: FmeActionType.SET_LOADING_FLAGS as const, ...flags }),
}

// Error actions
const errorActions = {
  setError: (error: ErrorState | null) => ({
    type: FmeActionType.SET_ERROR as const,
    error,
  }),
  setImportError: (error: ErrorState | null) => ({
    type: FmeActionType.SET_IMPORT_ERROR as const,
    error,
  }),
  setExportError: (error: ErrorState | null) => ({
    type: FmeActionType.SET_EXPORT_ERROR as const,
    error,
  }),
}

// All actions
export const fmeActions = {
  // Flat list
  ...viewActions,
  ...drawingActions,
  ...exportActions,
  ...workspaceActions,
  ...loadingActions,
  ...errorActions,
}

export const initialFmeState: FmeWidgetState = {
  // View
  viewMode: ViewMode.INITIAL,
  previousViewMode: null,

  // Drawing
  isDrawing: false,
  drawingTool: DrawingTool.POLYGON,
  clickCount: 0,
  geometryJson: null,
  drawnArea: 0,

  // Export
  formValues: {},
  orderResult: null,

  // Workspace
  workspaceItems: [],
  selectedWorkspace: null,
  workspaceParameters: [],
  workspaceItem: null,
  isLoadingWorkspaces: false,
  isLoadingParameters: false,

  // Loading
  isModulesLoading: false,
  isSubmittingOrder: false,

  // Errors
  error: null,
  importError: null,
  exportError: null,
}

// Reducer helpers
const reducerHelpers = {
  handleViewModeChange: (
    state: ImmutableObject<FmeWidgetState>,
    newViewMode: ViewMode
  ): ImmutableObject<FmeWidgetState> => {
    return state
      .set("previousViewMode", state.viewMode)
      .set("viewMode", newViewMode)
  },

  handleLoadingFlags: (
    state: ImmutableObject<FmeWidgetState>,
    flags: { isModulesLoading?: boolean; isSubmittingOrder?: boolean }
  ): ImmutableObject<FmeWidgetState> => {
    let newState = state

    if (flags.isModulesLoading !== undefined) {
      newState = newState.set("isModulesLoading", flags.isModulesLoading)
    }

    if (flags.isSubmittingOrder !== undefined) {
      newState = newState.set("isSubmittingOrder", flags.isSubmittingOrder)
    }

    return newState
  },

  handleDrawingState: (
    state: ImmutableObject<FmeWidgetState>,
    action: {
      isDrawing: boolean
      clickCount?: number
      drawingTool?: DrawingTool
    }
  ): ImmutableObject<FmeWidgetState> => {
    return state
      .set("isDrawing", action.isDrawing)
      .set("clickCount", action.clickCount ?? state.clickCount)
      .set("drawingTool", action.drawingTool ?? state.drawingTool)
  },

  handleWorkspaceParameters: (
    state: ImmutableObject<FmeWidgetState>,
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string
  ): ImmutableObject<FmeWidgetState> => {
    return state
      .set("workspaceParameters", workspaceParameters)
      .set("selectedWorkspace", workspaceName)
  },
}

// Reducer
const fmeReducer = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeActions,
  _appState: IMState
): ImmutableObject<FmeWidgetState> => {
  switch (action.type) {
    // View and navigation
    case FmeActionType.SET_VIEW_MODE:
      return reducerHelpers.handleViewModeChange(state, action.viewMode)

    case FmeActionType.RESET_STATE:
      // Fresh state
      return Immutable(initialFmeState) as ImmutableObject<FmeWidgetState>

    // Drawing and geometry
    case FmeActionType.SET_GEOMETRY:
      return state
        .set("geometryJson", action.geometryJson)
        .set("drawnArea", action.drawnArea ?? 0)

    case FmeActionType.SET_DRAWING_STATE:
      return reducerHelpers.handleDrawingState(state, action)

    case FmeActionType.SET_DRAWING_TOOL:
      return state.set("drawingTool", action.drawingTool)

    case FmeActionType.SET_CLICK_COUNT:
      return state.set("clickCount", action.clickCount)

    // Export
    case FmeActionType.SET_FORM_VALUES:
      return state.set("formValues", action.formValues)

    case FmeActionType.SET_ORDER_RESULT:
      return state
        .set("orderResult", action.orderResult)
        .set("isSubmittingOrder", false)

    // Workspace
    case FmeActionType.SET_WORKSPACE_ITEMS:
      return state.set("workspaceItems", action.workspaceItems)

    case FmeActionType.SET_WORKSPACE_PARAMETERS:
      return reducerHelpers.handleWorkspaceParameters(
        state,
        action.workspaceParameters,
        action.workspaceName
      )

    case FmeActionType.SET_SELECTED_WORKSPACE:
      return state.set("selectedWorkspace", action.workspaceName)

    case FmeActionType.SET_WORKSPACE_ITEM:
      return state.set("workspaceItem", action.workspaceItem)

    // Loading
    case FmeActionType.SET_LOADING_FLAGS:
      return reducerHelpers.handleLoadingFlags(state, action)

    // Errors
    case FmeActionType.SET_ERROR:
      return state.set("error", action.error)

    case FmeActionType.SET_IMPORT_ERROR:
      return state.set("importError", action.error)

    case FmeActionType.SET_EXPORT_ERROR:
      return state.set("exportError", action.error)

    // (ui state removed)
  }
}

// Store extension
export default class FmeReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "fme-export_store"

  getActions() {
    return Object.values(FmeActionType)
  }

  getInitLocalState(): FmeWidgetState {
    return initialFmeState
  }

  getReducer() {
    return fmeReducer
  }

  getStoreKey() {
    return "fme-state"
  }
}
