import * as SeamlessImmutable from "seamless-immutable"
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
} from "../config"
import { sanitizeFormValues } from "../shared/validations"
import { toSerializable } from "../shared/utils"

// Action creators
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
  setStartupValidationState: (
    isValidating: boolean,
    validationStep: string | undefined,
    validationError: ErrorState | SerializableErrorState | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_STARTUP_VALIDATION_STATE,
    isValidating,
    validationStep,
    validationError,
    widgetId,
  }),
  setGeometry: (
    geometry: __esri.Geometry | null,
    drawnArea: number | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_GEOMETRY,
    geometryJson: geometry ? ((geometry as any).toJSON?.() ?? null) : null,
    drawnArea,
    widgetId,
  }),
  setDrawingState: (
    isDrawing: boolean,
    clickCount: number | undefined,
    drawingTool: DrawingTool | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_DRAWING_STATE,
    isDrawing,
    clickCount,
    drawingTool,
    widgetId,
  }),
  setDrawingTool: (drawingTool: DrawingTool, widgetId: string) => ({
    type: FmeActionType.SET_DRAWING_TOOL,
    drawingTool,
    widgetId,
  }),
  setClickCount: (clickCount: number, widgetId: string) => ({
    type: FmeActionType.SET_CLICK_COUNT,
    clickCount,
    widgetId,
  }),
  setFormValues: (formValues: FormValues, widgetId: string) => ({
    type: FmeActionType.SET_FORM_VALUES,
    formValues,
    widgetId,
  }),
  setOrderResult: (orderResult: ExportResult | null, widgetId: string) => ({
    type: FmeActionType.SET_ORDER_RESULT,
    orderResult,
    widgetId,
  }),
  setWorkspaceItems: (
    workspaceItems: readonly WorkspaceItem[],
    repository: string | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEMS,
    workspaceItems,
    repository, // Add repository context to ensure workspace items are scoped correctly
    widgetId,
  }),
  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string,
    repository: string | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_PARAMETERS,
    workspaceParameters,
    workspaceName,
    repository, // Add repository context to track which repo these parameters belong to
    widgetId,
  }),
  setSelectedWorkspace: (
    workspaceName: string | null,
    repository: string | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_SELECTED_WORKSPACE,
    workspaceName,
    repository, // Track which repository the selected workspace belongs to
    widgetId,
  }),
  setWorkspaceItem: (
    workspaceItem: WorkspaceItemDetail | null,
    repository: string | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEM,
    workspaceItem,
    repository, // Track repository context for workspace item
    widgetId,
  }),
  setLoadingFlags: (flags: { [key: string]: boolean }, widgetId: string) => ({
    type: FmeActionType.SET_LOADING_FLAGS,
    ...flags,
    widgetId,
  }),
  setError: (
    error: ErrorState | SerializableErrorState | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_ERROR,
    error: toSerializable(error),
    widgetId,
  }),
  setImportError: (
    error: ErrorState | SerializableErrorState | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_IMPORT_ERROR,
    error: toSerializable(error),
    widgetId,
  }),
  setExportError: (
    error: ErrorState | SerializableErrorState | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_EXPORT_ERROR,
    error: toSerializable(error),
    widgetId,
  }),
  // New action to clear workspace-related state when switching repositories
  clearWorkspaceState: (
    newRepository: string | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.CLEAR_WORKSPACE_STATE,
    newRepository,
    widgetId,
  }),
  // Internal action to remove entire widget state (e.g. on unmount)
  removeWidgetState: (widgetId: string) => ({
    type: "fme/REMOVE_WIDGET_STATE",
    widgetId,
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
  currentRepository: null,

  // Loading and errors
  isModulesLoading: false,
  isSubmittingOrder: false,
  error: null,
  importError: null,
  exportError: null,
}

// Seamless-immutable typing is broken, so we need to force it here
const Immutable = ((SeamlessImmutable as any).default ?? SeamlessImmutable) as (
  input: any
) => any

// Reducer for a single widget instance
const reduceOne = (
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
      return state.set(
        "formValues",
        sanitizeFormValues(action.formValues, state.workspaceParameters as any)
      )

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
      if (action.isLoadingWorkspaces !== undefined) {
        newState = newState.set(
          "isLoadingWorkspaces",
          action.isLoadingWorkspaces
        )
      }
      if (action.isLoadingParameters !== undefined) {
        newState = newState.set(
          "isLoadingParameters",
          action.isLoadingParameters
        )
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

// Global reducer managing per-widget sub-states
type GlobalState = ImmutableObject<{
  byId: { [id: string]: ImmutableObject<FmeWidgetState> }
}>

const ensureSubState = (
  global: GlobalState,
  widgetId: string
): ImmutableObject<FmeWidgetState> => {
  const current = (global as any).byId?.[widgetId] as
    | ImmutableObject<FmeWidgetState>
    | undefined
  return (
    current ??
    (Immutable(initialFmeState) as unknown as ImmutableObject<FmeWidgetState>)
  )
}

const setSubState = (
  global: GlobalState,
  widgetId: string,
  next: ImmutableObject<FmeWidgetState>
): GlobalState => {
  const byId = { ...((global as any).byId || {}) }
  byId[widgetId] = next
  return Immutable({ byId }) as unknown as GlobalState
}

// Root reducer that delegates to per-widget reducer
const fmeReducer = (state: GlobalState, action: any): GlobalState => {
  // Special: remove entire widget state
  if (action?.type === "fme/REMOVE_WIDGET_STATE" && action?.widgetId) {
    const byId = { ...((state as any)?.byId || {}) }
    delete byId[action.widgetId]
    return Immutable({ byId }) as unknown as GlobalState
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
    return Object.values(FmeActionType) as unknown as string[]
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
