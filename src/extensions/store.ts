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
  type FormValues,
  type IMFmeGlobalState,
  type IMStateWithFmeExport,
  type LoadingState,
} from "../config"
import { sanitizeFormValues } from "../shared/validations"
import { toSerializable } from "../shared/utils"

// Action creators
const PRESERVE_REPOSITORY = Symbol("PRESERVE_REPOSITORY")

const normalizeRepository = (
  repository: unknown
): string | null | typeof PRESERVE_REPOSITORY => {
  if (repository === undefined) return PRESERVE_REPOSITORY
  if (typeof repository !== "string") return null
  const trimmed = repository.trim()
  return trimmed || null
}

type ErrorScope = "general" | "import" | "export"

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
    repository: string | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEMS,
    workspaceItems,
    repository: normalizeRepository(repository),
    widgetId,
  }),
  setWorkspaceParameters: (
    workspaceParameters: readonly WorkspaceParameter[],
    workspaceName: string,
    repository: string | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_PARAMETERS,
    workspaceParameters,
    workspaceName,
    repository: normalizeRepository(repository),
    widgetId,
  }),
  setSelectedWorkspace: (
    workspaceName: string | null,
    repository: string | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_SELECTED_WORKSPACE,
    workspaceName,
    repository: normalizeRepository(repository),
    widgetId,
  }),
  setWorkspaceItem: (
    workspaceItem: WorkspaceItemDetail | null,
    repository: string | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEM,
    workspaceItem,
    repository: normalizeRepository(repository),
    widgetId,
  }),
  setLoadingState: (flags: Partial<LoadingState>, widgetId: string) => ({
    type: FmeActionType.SET_LOADING_STATE,
    flags,
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
  clearError: (scope: ErrorScope, widgetId: string) => ({
    type: FmeActionType.CLEAR_ERROR,
    scope,
    widgetId,
  }),
  clearAllErrors: (widgetId: string) => ({
    type: FmeActionType.CLEAR_ALL_ERRORS,
    widgetId,
  }),
  clearWorkspaceState: (
    newRepository: string | null | undefined,
    widgetId: string
  ) => ({
    type: FmeActionType.CLEAR_WORKSPACE_STATE,
    newRepository: normalizeRepository(newRepository),
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
  previousViewMode: null,
  isStartupValidating: true,
  startupValidationStep: undefined,
  startupValidationError: null,

  // Drawing
  drawingTool: DrawingTool.POLYGON,
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
  currentRepository: null,

  // Loading and errors
  loading: {
    workspaces: false,
    parameters: false,
    modules: false,
    submission: false,
  },
  error: null,
  importError: null,
  exportError: null,
}

// Seamless-immutable typing is broken, so we need to force it here
const Immutable = ((SeamlessImmutable as any).default ?? SeamlessImmutable) as (
  input: any
) => any

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
const withRepositoryContext = (
  state: ImmutableObject<FmeWidgetState>,
  repository: unknown
): ImmutableObject<FmeWidgetState> => {
  const nextRepository = normalizeRepository(repository)
  return nextRepository === state.currentRepository
    ? state
    : state.set("currentRepository", nextRepository)
}

const reduceOne = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeAction
): ImmutableObject<FmeWidgetState> => {
  switch (action.type) {
    case FmeActionType.SET_VIEW_MODE: {
      const act = action as ActionFrom<"setViewMode">
      if (state.viewMode === act.viewMode) return state
      return state
        .set("previousViewMode", state.viewMode)
        .set("viewMode", act.viewMode)
    }

    case FmeActionType.RESET_STATE:
      return Immutable(initialFmeState) as ImmutableObject<FmeWidgetState>

    case FmeActionType.SET_STARTUP_VALIDATION_STATE: {
      const act = action as ActionFrom<"setStartupValidationState">
      return state
        .set("isStartupValidating", act.isValidating)
        .set("startupValidationStep", act.validationStep)
        .set(
          "startupValidationError",
          act.validationError ? toSerializable(act.validationError) : null
        )
    }

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
        .set("previousViewMode", state.viewMode)
        .set("viewMode", nextView)
    }

    case FmeActionType.SET_DRAWING_TOOL: {
      const act = action as ActionFrom<"setDrawingTool">
      return state.set("drawingTool", act.drawingTool)
    }

    case FmeActionType.SET_FORM_VALUES: {
      const act = action as ActionFrom<"setFormValues">
      const fileCtor =
        typeof File === "undefined" ? undefined : (File as unknown as any)
      if (fileCtor) {
        const values = Object.values(act.formValues || {})
        const hasFile = values.some((value) => value instanceof fileCtor)
        if (hasFile) {
          throw new Error(
            "Form values must not include File instances. Handle uploads outside Redux state."
          )
        }
      }
      return state.set(
        "formValues",
        sanitizeFormValues(act.formValues, state.workspaceParameters as any)
      )
    }

    case FmeActionType.SET_ORDER_RESULT: {
      const act = action as ActionFrom<"setOrderResult">
      return state
        .set("orderResult", act.orderResult)
        .setIn(["loading", "submission"], false)
    }

    case FmeActionType.SET_WORKSPACE_ITEMS: {
      const act = action as ActionFrom<"setWorkspaceItems">
      return withRepositoryContext(
        state.set("workspaceItems", act.workspaceItems),
        act.repository
      )
    }

    case FmeActionType.SET_WORKSPACE_PARAMETERS: {
      const act = action as ActionFrom<"setWorkspaceParameters">
      return withRepositoryContext(
        state
          .set("workspaceParameters", act.workspaceParameters)
          .set("selectedWorkspace", act.workspaceName),
        act.repository
      )
    }

    case FmeActionType.SET_SELECTED_WORKSPACE: {
      const act = action as ActionFrom<"setSelectedWorkspace">
      const newState = state.set("selectedWorkspace", act.workspaceName)
      // PRESERVE_REPOSITORY means keep current repository unchanged
      return act.repository === PRESERVE_REPOSITORY
        ? newState
        : withRepositoryContext(newState, act.repository)
    }

    case FmeActionType.SET_WORKSPACE_ITEM: {
      const act = action as ActionFrom<"setWorkspaceItem">
      const newState = state.set("workspaceItem", act.workspaceItem)
      // PRESERVE_REPOSITORY means keep current repository unchanged
      return act.repository === PRESERVE_REPOSITORY
        ? newState
        : withRepositoryContext(newState, act.repository)
    }

    case FmeActionType.SET_LOADING_STATE: {
      const act = action as ActionFrom<"setLoadingState">
      if (!act.flags) return state
      let next = state
      let changed = false
      const current = state.loading
      for (const [key, value] of Object.entries(act.flags)) {
        if (typeof value !== "boolean") continue
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue
        const typedKey = key as keyof typeof current
        if (current[typedKey] === value) continue
        next = next.setIn(
          ["loading", typedKey],
          value
        ) as ImmutableObject<FmeWidgetState>
        changed = true
      }
      return changed ? next : state
    }

    case FmeActionType.CLEAR_WORKSPACE_STATE: {
      const act = action as ActionFrom<"clearWorkspaceState">
      const nextRepo = normalizeRepository(act.newRepository)
      const repositoryChanged = nextRepo !== state.currentRepository
      const preserveFormValues =
        !repositoryChanged && state.orderResult === null
      const nextFormValues = preserveFormValues ? state.formValues : {}
      const nextOrderResult = preserveFormValues ? state.orderResult : null
      return withRepositoryContext(
        state
          .set("workspaceItems", [])
          .set("selectedWorkspace", null)
          .set("workspaceParameters", [])
          .set("workspaceItem", null)
          .setIn(["loading", "workspaces"], false)
          .setIn(["loading", "parameters"], false)
          .set("formValues", nextFormValues)
          .setIn(["loading", "submission"], false)
          .set("orderResult", nextOrderResult),
        nextRepo
      )
    }

    case FmeActionType.SET_ERROR: {
      const act = action as ActionFrom<"setError">
      return state.set("error", act.error)
    }

    case FmeActionType.SET_IMPORT_ERROR: {
      const act = action as ActionFrom<"setImportError">
      return state.set("importError", act.error)
    }

    case FmeActionType.SET_EXPORT_ERROR: {
      const act = action as ActionFrom<"setExportError">
      return state.set("exportError", act.error)
    }

    case FmeActionType.CLEAR_ERROR: {
      const act = action as ActionFrom<"clearError">
      if (act.scope === "general") {
        return state.error === null ? state : state.set("error", null)
      }
      if (act.scope === "import") {
        return state.importError === null
          ? state
          : state.set("importError", null)
      }
      return state.exportError === null ? state : state.set("exportError", null)
    }

    case FmeActionType.CLEAR_ALL_ERRORS:
      return state
        .set("error", null)
        .set("importError", null)
        .set("exportError", null)

    case FmeActionType.REMOVE_WIDGET_STATE:
      return state
  }
}

const ensureSubState = (
  global: IMFmeGlobalState,
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
    selectWorkspaceParameters: (state: IMStateWithFmeExport) =>
      getSlice(state)?.workspaceParameters ??
      initialFmeState.workspaceParameters,
    selectWorkspaceItem: (state: IMStateWithFmeExport) =>
      getSlice(state)?.workspaceItem ?? initialFmeState.workspaceItem,
    selectCurrentRepository: (state: IMStateWithFmeExport) =>
      getSlice(state)?.currentRepository ?? initialFmeState.currentRepository,
    selectOrderResult: (state: IMStateWithFmeExport) =>
      getSlice(state)?.orderResult ?? initialFmeState.orderResult,
    selectLoading: (state: IMStateWithFmeExport) =>
      getSlice(state)?.loading ?? initialFmeState.loading,
    selectIsLoadingWorkspaces: (state: IMStateWithFmeExport) =>
      getSlice(state)?.loading?.workspaces ??
      initialFmeState.loading.workspaces,
    selectIsLoadingParameters: (state: IMStateWithFmeExport) =>
      getSlice(state)?.loading?.parameters ??
      initialFmeState.loading.parameters,
    selectIsModulesLoading: (state: IMStateWithFmeExport) =>
      getSlice(state)?.loading?.modules ?? initialFmeState.loading.modules,
    selectIsSubmittingOrder: (state: IMStateWithFmeExport) =>
      getSlice(state)?.loading?.submission ??
      initialFmeState.loading.submission,
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
