import { Immutable } from "jimu-core"
import type { extensionSpec, ImmutableObject } from "jimu-core"
import {
  ViewMode,
  DrawingTool,
  FmeActionType,
  type FmeWidgetState,
  type FmeActions,
  type ErrorState,
  type SerializableErrorState,
  type WorkspaceItem,
  type WorkspaceItemDetail,
  type WorkspaceParameter,
  type ExportResult,
  type FormValues,
} from "../shared/types"

// Error serialization for storing in Redux state
const toSerializable = (
  error: ErrorState | SerializableErrorState | null
): SerializableErrorState | null => {
  if (!error) return null
  const base: any = error as any
  // Preserve timestampMs if provided; else derive from timestamp Date; else default to 0
  const ts =
    typeof base.timestampMs === "number"
      ? base.timestampMs
      : base.timestamp instanceof Date
        ? base.timestamp.getTime()
        : 0
  const { retry, timestamp, ...rest } = base
  return { ...rest, timestampMs: ts } as SerializableErrorState
}

// Action creators
export const fmeActions = {
  setViewMode: (viewMode: ViewMode) => ({
    type: FmeActionType.SET_VIEW_MODE,
    viewMode,
  }),
  resetState: () => ({ type: FmeActionType.RESET_STATE }),
  setStartupValidationState: (
    isValidating: boolean,
    validationStep?: string,
    validationError?: ErrorState | SerializableErrorState | null
  ) => ({
    type: FmeActionType.SET_STARTUP_VALIDATION_STATE,
    isValidating,
    validationStep,
    validationError,
  }),
  setGeometry: (geometry: __esri.Geometry | null, drawnArea?: number) => ({
    type: FmeActionType.SET_GEOMETRY,
    geometryJson: geometry ? ((geometry as any).toJSON?.() ?? null) : null,
    drawnArea,
  }),
  setDrawingState: (
    isDrawing: boolean,
    clickCount?: number,
    drawingTool?: DrawingTool
  ) => ({
    type: FmeActionType.SET_DRAWING_STATE,
    isDrawing,
    clickCount,
    drawingTool,
  }),
  setDrawingTool: (drawingTool: DrawingTool) => ({
    type: FmeActionType.SET_DRAWING_TOOL,
    drawingTool,
  }),
  setClickCount: (clickCount: number) => ({
    type: FmeActionType.SET_CLICK_COUNT,
    clickCount,
  }),
  setFormValues: (formValues: FormValues) => ({
    type: FmeActionType.SET_FORM_VALUES,
    formValues,
  }),
  setOrderResult: (orderResult: ExportResult | null) => ({
    type: FmeActionType.SET_ORDER_RESULT,
    orderResult,
  }),
  setWorkspaceItems: (
    workspaceItems: readonly WorkspaceItem[],
    repository?: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEMS,
    workspaceItems,
    repository, // Add repository context to ensure workspace items are scoped correctly
  }),
  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string,
    repository?: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_PARAMETERS,
    workspaceParameters,
    workspaceName,
    repository, // Add repository context to track which repo these parameters belong to
  }),
  setSelectedWorkspace: (
    workspaceName: string | null,
    repository?: string
  ) => ({
    type: FmeActionType.SET_SELECTED_WORKSPACE,
    workspaceName,
    repository, // Track which repository the selected workspace belongs to
  }),
  setWorkspaceItem: (
    workspaceItem: WorkspaceItemDetail | null,
    repository?: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEM,
    workspaceItem,
    repository, // Track repository context for workspace item
  }),
  setLoadingFlags: (flags: { [key: string]: boolean }) => ({
    type: FmeActionType.SET_LOADING_FLAGS,
    ...flags,
  }),
  setError: (error: ErrorState | SerializableErrorState | null) => ({
    type: FmeActionType.SET_ERROR,
    error: toSerializable(error),
  }),
  setImportError: (error: ErrorState | SerializableErrorState | null) => ({
    type: FmeActionType.SET_IMPORT_ERROR,
    error: toSerializable(error),
  }),
  setExportError: (error: ErrorState | SerializableErrorState | null) => ({
    type: FmeActionType.SET_EXPORT_ERROR,
    error: toSerializable(error),
  }),
  // New action to clear workspace-related state when switching repositories
  clearWorkspaceState: (newRepository?: string) => ({
    type: FmeActionType.CLEAR_WORKSPACE_STATE,
    newRepository,
  }),
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
  currentRepository: null, // Track current repository for proper workspace isolation

  // Loading and errors
  isModulesLoading: false,
  isSubmittingOrder: false,
  error: null,
  importError: null,
  exportError: null,
}

// Reducer
const fmeReducer = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeActions
): ImmutableObject<FmeWidgetState> => {
  switch (action.type) {
    case FmeActionType.SET_VIEW_MODE:
      if (state.viewMode === action.viewMode) return state
      return state
        .set("previousViewMode", state.viewMode)
        .set("viewMode", action.viewMode)

    case FmeActionType.RESET_STATE:
      return Immutable(initialFmeState) as ImmutableObject<FmeWidgetState>

    case FmeActionType.SET_STARTUP_VALIDATION_STATE:
      return state
        .set("isStartupValidating", action.isValidating)
        .set("startupValidationStep", action.validationStep)
        .set(
          "startupValidationError",
          action.validationError ? toSerializable(action.validationError) : null
        )

    case FmeActionType.SET_GEOMETRY:
      return state
        .set("geometryJson", action.geometryJson)
        .set("drawnArea", action.drawnArea ?? 0)

    case FmeActionType.SET_DRAWING_STATE:
      return state
        .set("isDrawing", action.isDrawing)
        .set("clickCount", action.clickCount ?? state.clickCount)
        .set("drawingTool", action.drawingTool ?? state.drawingTool)

    case FmeActionType.SET_DRAWING_TOOL:
      return state.set("drawingTool", action.drawingTool)

    case FmeActionType.SET_CLICK_COUNT:
      return state.set("clickCount", action.clickCount)

    case FmeActionType.SET_FORM_VALUES:
      return state.set("formValues", action.formValues)

    case FmeActionType.SET_ORDER_RESULT:
      return state
        .set("orderResult", action.orderResult)
        .set("isSubmittingOrder", false)

    case FmeActionType.SET_WORKSPACE_ITEMS: {
      let newState = state.set("workspaceItems", action.workspaceItems)
      // Update current repository context if provided
      if (action.repository !== undefined) {
        newState = newState.set("currentRepository", action.repository)
      }
      return newState
    }

    case FmeActionType.SET_WORKSPACE_PARAMETERS:
      return state
        .set("workspaceParameters", action.workspaceParameters)
        .set("selectedWorkspace", action.workspaceName)
        .set("currentRepository", action.repository || state.currentRepository)

    case FmeActionType.SET_SELECTED_WORKSPACE:
      return state
        .set("selectedWorkspace", action.workspaceName)
        .set("currentRepository", action.repository || state.currentRepository)

    case FmeActionType.SET_WORKSPACE_ITEM:
      return state
        .set("workspaceItem", action.workspaceItem)
        .set("currentRepository", action.repository || state.currentRepository)

    case FmeActionType.SET_LOADING_FLAGS: {
      let newState = state
      if (action.isModulesLoading !== undefined) {
        newState = newState.set("isModulesLoading", action.isModulesLoading)
      }
      if (action.isSubmittingOrder !== undefined) {
        newState = newState.set("isSubmittingOrder", action.isSubmittingOrder)
      }
      return newState
    }

    case FmeActionType.CLEAR_WORKSPACE_STATE:
      return state
        .set("workspaceItems", [])
        .set("selectedWorkspace", null)
        .set("workspaceParameters", [])
        .set("workspaceItem", null)
        .set("formValues", {})
        .set("currentRepository", action.newRepository || null)
        .set("isLoadingWorkspaces", false)
        .set("isLoadingParameters", false)

    case FmeActionType.SET_ERROR:
      return state.set("error", action.error)

    case FmeActionType.SET_IMPORT_ERROR:
      return state.set("importError", action.error)

    case FmeActionType.SET_EXPORT_ERROR:
      return state.set("exportError", action.error)
  }
}

// Store extension
export default class FmeReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "fme-export_store"

  getActions(): string[] {
    // Return all action types as string array
    return Object.values(FmeActionType) as unknown as string[]
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
