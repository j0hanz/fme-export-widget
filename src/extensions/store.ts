import { Immutable } from "jimu-core"
import type { extensionSpec, ImmutableObject } from "jimu-core"
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
  type LoadingFlags,
} from "../shared/types"

// Action creator helpers for type safety
const makePayload = <
  T extends FmeActionType,
  P extends { [key: string]: unknown },
>(
  type: T,
  payload: P
) => ({ type, ...payload }) as { type: T } & P

const makeSimple = <T extends FmeActionType>(type: T) => ({ type })

// View actions
const view = {
  setViewMode: (viewMode: ViewMode) =>
    makePayload(FmeActionType.SET_VIEW_MODE, { viewMode }),
  resetState: () => makeSimple(FmeActionType.RESET_STATE),
  setStartupValidationState: (
    isValidating: boolean,
    validationStep?: string,
    validationError?: ErrorState | null
  ) =>
    makePayload(FmeActionType.SET_STARTUP_VALIDATION_STATE, {
      isValidating,
      validationStep,
      validationError,
    }),
}

// Drawing actions
const draw = {
  setGeometry: (geometry: __esri.Geometry | null, drawnArea?: number) =>
    makePayload(FmeActionType.SET_GEOMETRY, {
      geometryJson: geometry ? ((geometry as any).toJSON?.() ?? null) : null,
      drawnArea,
    }),
  setDrawingState: (
    isDrawing: boolean,
    clickCount?: number,
    drawingTool?: DrawingTool
  ) =>
    makePayload(FmeActionType.SET_DRAWING_STATE, {
      isDrawing,
      clickCount,
      drawingTool,
    }),
  setDrawingTool: (drawingTool: DrawingTool) =>
    makePayload(FmeActionType.SET_DRAWING_TOOL, { drawingTool }),
  setClickCount: (clickCount: number) =>
    makePayload(FmeActionType.SET_CLICK_COUNT, { clickCount }),
}

// Export actions
const exp = {
  setFormValues: (formValues: { [key: string]: unknown }) =>
    makePayload(FmeActionType.SET_FORM_VALUES, { formValues }),
  setOrderResult: (orderResult: ExportResult | null) =>
    makePayload(FmeActionType.SET_ORDER_RESULT, { orderResult }),
}

// Workspace actions
const ws = {
  setWorkspaceItems: (workspaceItems: readonly WorkspaceItem[]) =>
    makePayload(FmeActionType.SET_WORKSPACE_ITEMS, {
      workspaceItems,
    }),
  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string
  ) =>
    makePayload(FmeActionType.SET_WORKSPACE_PARAMETERS, {
      workspaceParameters,
      workspaceName,
    }),
  setSelectedWorkspace: (workspaceName: string | null) =>
    makePayload(FmeActionType.SET_SELECTED_WORKSPACE, {
      workspaceName,
    }),
  setWorkspaceItem: (workspaceItem: WorkspaceItemDetail | null) =>
    makePayload(FmeActionType.SET_WORKSPACE_ITEM, {
      workspaceItem,
    }),
}

// Loading actions
const load = {
  setLoadingFlags: (flags: LoadingFlags) =>
    makePayload(
      FmeActionType.SET_LOADING_FLAGS,
      flags as { [key: string]: unknown }
    ),
}

const err = {
  setError: (error: ErrorState | null) =>
    makePayload(FmeActionType.SET_ERROR, { error }),
  setImportError: (error: ErrorState | null) =>
    makePayload(FmeActionType.SET_IMPORT_ERROR, { error }),
  setExportError: (error: ErrorState | null) =>
    makePayload(FmeActionType.SET_EXPORT_ERROR, { error }),
}

// All actions
export const fmeActions = {
  // Flat list
  ...view,
  ...draw,
  ...exp,
  ...ws,
  ...load,
  ...err,
}

export const initialFmeState: FmeWidgetState = {
  // View
  viewMode: ViewMode.STARTUP_VALIDATION,
  previousViewMode: null,
  isStartupValidating: true,
  startupValidationStep: undefined,
  startupValidationError: null,

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
const helpers = {
  getErrorField: (
    type: FmeActionType
  ): "error" | "importError" | "exportError" =>
    type === FmeActionType.SET_ERROR
      ? "error"
      : type === FmeActionType.SET_IMPORT_ERROR
        ? "importError"
        : "exportError",

  setView: (
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

  setLoading: (
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

  setDrawing: (
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

  setWsParams: (
    state: ImmutableObject<FmeWidgetState>,
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string
  ): ImmutableObject<FmeWidgetState> => {
    return state
      .set("workspaceParameters", workspaceParameters)
      .set("selectedWorkspace", workspaceName)
  },

  setError: (
    state: ImmutableObject<FmeWidgetState>,
    action: { type: FmeActionType; error: ErrorState | null }
  ): ImmutableObject<FmeWidgetState> => {
    const errorField = helpers.getErrorField(action.type)
    return state.set(errorField, action.error)
  },
}

// Reducer with improved organization and early returns
const fmeReducer = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeActions
): ImmutableObject<FmeWidgetState> => {
  switch (action.type) {
    // View and navigation cases
    case FmeActionType.SET_VIEW_MODE:
      return helpers.setView(state, action.viewMode)

    case FmeActionType.RESET_STATE:
      return Immutable(initialFmeState) as ImmutableObject<FmeWidgetState>

    case FmeActionType.SET_STARTUP_VALIDATION_STATE:
      return state
        .set("isStartupValidating", action.isValidating)
        .set("startupValidationStep", action.validationStep)
        .set("startupValidationError", action.validationError)

    // Drawing and geometry cases
    case FmeActionType.SET_GEOMETRY:
      return state
        .set("geometryJson", action.geometryJson)
        .set("drawnArea", action.drawnArea ?? 0)

    case FmeActionType.SET_DRAWING_STATE:
      return helpers.setDrawing(state, action)

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
      return helpers.setWsParams(
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
      return helpers.setLoading(state, action)

    // Error cases
    case FmeActionType.SET_ERROR:
    case FmeActionType.SET_IMPORT_ERROR:
    case FmeActionType.SET_EXPORT_ERROR:
      return helpers.setError(state, action)
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
