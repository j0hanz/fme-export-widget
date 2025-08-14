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
  type WorkspaceItemDetail,
  type WorkspaceParameter,
  type ExportResult,
} from "../shared/types"

// Action creator helpers for type safety
const createActionWithPayload = <
  T extends FmeActionType,
  P extends { [key: string]: unknown },
>(
  type: T,
  payload: P
) => ({ type, ...payload }) as { type: T } & P

const createSimpleAction = <T extends FmeActionType>(type: T) => ({ type })

interface LoadingFlags {
  [key: string]: unknown
  isModulesLoading?: boolean
  isSubmittingOrder?: boolean
}

// View actions
const viewActions = {
  setViewMode: (viewMode: ViewMode) =>
    createActionWithPayload(FmeActionType.SET_VIEW_MODE, { viewMode }),
  resetState: () => createSimpleAction(FmeActionType.RESET_STATE),
}

// Drawing actions
const drawingActions = {
  setGeometry: (geometry: __esri.Geometry | null, drawnArea?: number) =>
    createActionWithPayload(FmeActionType.SET_GEOMETRY, {
      geometryJson: geometry ? ((geometry as any).toJSON?.() ?? null) : null,
      drawnArea,
    }),
  setDrawingState: (
    isDrawing: boolean,
    clickCount?: number,
    drawingTool?: DrawingTool
  ) =>
    createActionWithPayload(FmeActionType.SET_DRAWING_STATE, {
      isDrawing,
      clickCount,
      drawingTool,
    }),
  setDrawingTool: (drawingTool: DrawingTool) =>
    createActionWithPayload(FmeActionType.SET_DRAWING_TOOL, { drawingTool }),
  setClickCount: (clickCount: number) =>
    createActionWithPayload(FmeActionType.SET_CLICK_COUNT, { clickCount }),
}

// Export actions
const exportActions = {
  setFormValues: (formValues: { [key: string]: unknown }) =>
    createActionWithPayload(FmeActionType.SET_FORM_VALUES, { formValues }),
  setOrderResult: (orderResult: ExportResult | null) =>
    createActionWithPayload(FmeActionType.SET_ORDER_RESULT, { orderResult }),
}

// Workspace actions
const workspaceActions = {
  setWorkspaceItems: (workspaceItems: readonly WorkspaceItem[]) =>
    createActionWithPayload(FmeActionType.SET_WORKSPACE_ITEMS, {
      workspaceItems,
    }),
  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string
  ) =>
    createActionWithPayload(FmeActionType.SET_WORKSPACE_PARAMETERS, {
      workspaceParameters,
      workspaceName,
    }),
  setSelectedWorkspace: (workspaceName: string | null) =>
    createActionWithPayload(FmeActionType.SET_SELECTED_WORKSPACE, {
      workspaceName,
    }),
  setWorkspaceItem: (workspaceItem: WorkspaceItemDetail | null) =>
    createActionWithPayload(FmeActionType.SET_WORKSPACE_ITEM, {
      workspaceItem,
    }),
}

// Loading actions
const loadingActions = {
  setLoadingFlags: (flags: LoadingFlags) =>
    createActionWithPayload(FmeActionType.SET_LOADING_FLAGS, flags),
}

// Error actions - consolidated into a single parameterized function
const createErrorAction = (
  actionType: FmeActionType,
  error: ErrorState | null
) => createActionWithPayload(actionType, { error })

const errorActions = {
  setError: (error: ErrorState | null) =>
    createErrorAction(FmeActionType.SET_ERROR, error),
  setImportError: (error: ErrorState | null) =>
    createErrorAction(FmeActionType.SET_IMPORT_ERROR, error),
  setExportError: (error: ErrorState | null) =>
    createErrorAction(FmeActionType.SET_EXPORT_ERROR, error),
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
    if (state.viewMode === newViewMode) {
      // No change in view mode, return current state
      return state
    }
    return state
      .set("previousViewMode", state.viewMode)
      .set("viewMode", newViewMode)
  },

  handleLoadingFlags: (
    state: ImmutableObject<FmeWidgetState>,
    action: { isModulesLoading?: boolean; isSubmittingOrder?: boolean }
  ): ImmutableObject<FmeWidgetState> => {
    let newState = state

    if (action.isModulesLoading !== undefined) {
      newState = newState.set("isModulesLoading", action.isModulesLoading)
    }

    if (action.isSubmittingOrder !== undefined) {
      newState = newState.set("isSubmittingOrder", action.isSubmittingOrder)
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

  handleError: (
    state: ImmutableObject<FmeWidgetState>,
    action: { type: FmeActionType; error: ErrorState | null }
  ): ImmutableObject<FmeWidgetState> => {
    const errorField =
      action.type === FmeActionType.SET_ERROR
        ? "error"
        : action.type === FmeActionType.SET_IMPORT_ERROR
          ? "importError"
          : "exportError"

    return state.set(errorField, action.error)
  },
}

// Reducer with improved organization and early returns
const fmeReducer = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeActions,
  _appState: IMState
): ImmutableObject<FmeWidgetState> => {
  switch (action.type) {
    // View and navigation cases
    case FmeActionType.SET_VIEW_MODE:
      return reducerHelpers.handleViewModeChange(state, action.viewMode)

    case FmeActionType.RESET_STATE:
      return Immutable(initialFmeState) as ImmutableObject<FmeWidgetState>

    // Drawing and geometry cases
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

    // Export cases
    case FmeActionType.SET_FORM_VALUES:
      return state.set("formValues", action.formValues)

    case FmeActionType.SET_ORDER_RESULT:
      return state
        .set("orderResult", action.orderResult)
        .set("isSubmittingOrder", false)

    // Workspace cases
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

    // Loading cases
    case FmeActionType.SET_LOADING_FLAGS:
      return reducerHelpers.handleLoadingFlags(state, action)

    // Error cases
    case FmeActionType.SET_ERROR:
    case FmeActionType.SET_IMPORT_ERROR:
    case FmeActionType.SET_EXPORT_ERROR:
      return reducerHelpers.handleError(state, action)
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
