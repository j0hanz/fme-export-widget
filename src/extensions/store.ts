import type { extensionSpec, ImmutableObject, IMState } from "jimu-core"
import {
  ViewMode,
  DrawingTool,
  StateType,
  FmeActionType,
  type RealTimeMeasurements,
  type FmeWidgetState,
  type FmeActions,
  type ErrorState,
  type StateData,
  type WorkspaceItem,
  type WorkspaceParameter,
  type SetViewModeAction,
  type SetFormValuesAction,
  type SetDrawingStateAction,
  type SetLoadingFlagsAction,
  type SetErrorAction,
  type SetUiStateAction,
  type SetUiStateDataAction,
} from "../shared/types"

/**
 * FME Action Creators - Redux action creators for state management
 */
export const fmeActions = {
  setViewMode: (viewMode: ViewMode): SetViewModeAction => ({
    type: FmeActionType.SET_VIEW_MODE,
    viewMode,
  }),

  setFormValues: (formValues: { [key: string]: any }): SetFormValuesAction => ({
    type: FmeActionType.SET_FORM_VALUES,
    formValues,
  }),

  setDrawingState: (
    isDrawing: boolean,
    clickCount?: number,
    drawingTool?: DrawingTool
  ): SetDrawingStateAction => ({
    type: FmeActionType.SET_DRAWING_STATE,
    isDrawing,
    clickCount,
    drawingTool,
  }),

  setClickCount: (clickCount: number) => ({
    type: FmeActionType.SET_CLICK_COUNT,
    clickCount,
  }),

  setLoadingFlags: (flags: {
    isModulesLoading?: boolean
    isSubmittingOrder?: boolean
  }): SetLoadingFlagsAction => ({
    type: FmeActionType.SET_LOADING_FLAGS,
    ...flags,
  }),

  setError: (error: ErrorState | null): SetErrorAction => ({
    type: FmeActionType.SET_ERROR,
    error,
  }),

  setImportError: (error: ErrorState | null) => ({
    type: FmeActionType.SET_IMPORT_ERROR,
    error,
  }),

  setExportError: (error: ErrorState | null) => ({
    type: FmeActionType.SET_EXPORT_ERROR,
    error,
  }),

  setWorkspaceItems: (workspaceItems: readonly WorkspaceItem[]) => ({
    type: FmeActionType.SET_WORKSPACE_ITEMS,
    workspaceItems,
  }),

  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_PARAMETERS,
    workspaceParameters,
    workspaceName,
  }),

  setSelectedWorkspace: (workspaceName: string | null) => ({
    type: FmeActionType.SET_SELECTED_WORKSPACE,
    workspaceName,
  }),

  setWorkspaceItem: (workspaceItem: any) => ({
    type: FmeActionType.SET_WORKSPACE_ITEM,
    workspaceItem,
  }),

  setUiState: (uiState: StateType): SetUiStateAction => ({
    type: FmeActionType.SET_UI_STATE,
    uiState,
  }),

  setUiStateData: (data: StateData): SetUiStateDataAction => ({
    type: FmeActionType.SET_UI_STATE_DATA,
    data,
  }),
}

// Initial state for the FME widget
export const initialFmeState: FmeWidgetState = {
  // View state
  viewMode: ViewMode.INITIAL,
  previousViewMode: null, // Initialize with no previous view
  isDrawing: false,
  drawingTool: DrawingTool.POLYGON,
  clickCount: 0,

  // Serialized geometry data
  geometryJson: null,
  drawnArea: 0,
  realTimeMeasurements: {} as RealTimeMeasurements,

  // Export state
  formValues: {},
  orderResult: null,

  // Workspace state
  workspaceItems: [],
  selectedWorkspace: null,
  workspaceParameters: [],
  workspaceItem: null, // Full workspace item from server
  isLoadingWorkspaces: false,
  isLoadingParameters: false,

  // Loading states
  isModulesLoading: false,
  isSubmittingOrder: false,

  // Error handling
  error: null,
  importError: null,
  exportError: null,

  // UI state management (moved from local state.tsx)
  uiState: StateType.IDLE,
  uiStateData: {} as any, // Will be properly typed as StateData
}

// Reducer function to handle FME widget state updates
const fmeReducer = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeActions,
  _appState: IMState
): ImmutableObject<FmeWidgetState> => {
  switch (action.type) {
    case FmeActionType.SET_VIEW_MODE:
      return state
        .set("previousViewMode", state.viewMode) // Track current as previous
        .set("viewMode", action.viewMode)

    case FmeActionType.SET_GEOMETRY:
      return state
        .set("geometryJson", action.geometry)
        .set("drawnArea", action.drawnArea ?? 0)

    case FmeActionType.SET_REAL_TIME_MEASUREMENTS:
      return state.set("realTimeMeasurements", action.measurements)

    case FmeActionType.SET_LOADING_FLAGS:
      return state
        .set(
          "isModulesLoading",
          action.isModulesLoading ?? state.isModulesLoading
        )
        .set(
          "isSubmittingOrder",
          action.isSubmittingOrder ?? state.isSubmittingOrder
        )

    case FmeActionType.SET_ORDER_RESULT:
      return state
        .set("orderResult", action.orderResult)
        .set("isSubmittingOrder", false)

    case FmeActionType.SET_ERROR:
      return state.set("error", action.error)

    case FmeActionType.SET_DRAWING_STATE:
      return state
        .set("isDrawing", action.isDrawing)
        .set("clickCount", action.clickCount ?? state.clickCount)
        .set("drawingTool", action.drawingTool ?? state.drawingTool)

    case FmeActionType.SET_CLICK_COUNT:
      return state.set("clickCount", action.clickCount)

    case FmeActionType.SET_DRAWING_TOOL:
      return state.set("drawingTool", action.drawingTool)

    case FmeActionType.SET_FORM_VALUES:
      return state.set("formValues", action.formValues)

    case FmeActionType.SET_UI_STATE:
      return state.set("uiState", action.uiState)

    case FmeActionType.SET_UI_STATE_DATA:
      return state.set("uiStateData", action.data)

    case FmeActionType.SET_IMPORT_ERROR:
      return state.set("importError", action.error)

    case FmeActionType.SET_EXPORT_ERROR:
      return state.set("exportError", action.error)

    case FmeActionType.SET_WORKSPACE_ITEMS:
      return state.set("workspaceItems", action.workspaceItems)

    case FmeActionType.SET_WORKSPACE_PARAMETERS:
      return state
        .set("workspaceParameters", action.workspaceParameters)
        .set("selectedWorkspace", action.workspaceName)

    case FmeActionType.SET_SELECTED_WORKSPACE:
      return state.set("selectedWorkspace", action.workspaceName)

    case FmeActionType.SET_WORKSPACE_ITEM:
      return state.set("workspaceItem", action.workspaceItem)

    case FmeActionType.RESET_STATE:
      return (state as any).merge(
        initialFmeState
      ) as ImmutableObject<FmeWidgetState>
  }
}

// This extension provides the Redux store for the FME Export widget.
export default class FmeReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "fme-export_store" // widgetId + extensionName pattern

  getActions() {
    return Object.values(FmeActionType)
  }

  getInitLocalState(): FmeWidgetState {
    return initialFmeState
  }

  getReducer() {
    return fmeReducer
  }

  // This is the key used to access the FME state in the Redux store
  getStoreKey() {
    return "fme-state" // Store key where state lives in Redux store
  }
}
