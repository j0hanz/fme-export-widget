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
  ErrorSeverity,
  type LoadingState,
  type LoadingFlagKey,
  type ErrorMap,
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
  setErrors: (
    errors: Partial<{
      [scope in ErrorScope]?:
        | ErrorState
        | SerializableErrorState
        | null
        | undefined
    }>,
    widgetId: string
  ) => {
    const serialized: Partial<{
      [scope in ErrorScope]?: SerializableErrorState | null
    }> = {}

    for (const [scopeKey, maybeError] of Object.entries(errors) as Array<
      [ErrorScope, ErrorState | SerializableErrorState | null | undefined]
    >) {
      if (typeof maybeError === "undefined") continue
      serialized[scopeKey] = maybeError ? toSerializable(maybeError) : null
    }

    return {
      type: FmeActionType.SET_ERRORS,
      errors: serialized,
      widgetId,
    }
  },
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
  setLoadingFlag: (flag: LoadingFlagKey, value: boolean, widgetId: string) => ({
    type: FmeActionType.SET_LOADING_FLAG,
    flag,
    value,
    widgetId,
  }),
  applyWorkspaceData: (
    payload: {
      readonly workspaceName: string
      readonly parameters: readonly WorkspaceParameter[]
      readonly item: WorkspaceItemDetail
    },
    widgetId: string
  ) => ({
    type: FmeActionType.APPLY_WORKSPACE_DATA,
    workspaceName: payload.workspaceName,
    workspaceParameters: payload.parameters,
    workspaceItem: payload.item,
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
  geometryRevision: 0,

  // Export
  orderResult: null,

  // Workspace
  workspaceItems: [],
  selectedWorkspace: null,
  workspaceParameters: [],
  workspaceItem: null,

  // Loading
  loading: createInitialLoadingState(),

  // Errors
  error: null,
  errors: createInitialErrorMap(),
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

function createInitialLoadingState(): LoadingState {
  return {
    workspaces: false,
    parameters: false,
    modules: false,
    submission: false,
  }
}

function createInitialErrorMap(): ErrorMap {
  return {}
}

function areLoadingStatesEqual(a: LoadingState, b: LoadingState): boolean {
  return (
    a.workspaces === b.workspaces &&
    a.parameters === b.parameters &&
    a.modules === b.modules &&
    a.submission === b.submission
  )
}

const ERROR_SEVERITY_RANK: {
  readonly [key in ErrorSeverity]: number
} = {
  [ErrorSeverity.ERROR]: 3,
  [ErrorSeverity.WARNING]: 2,
  [ErrorSeverity.INFO]: 1,
}

const ERROR_SCOPE_PRIORITY: { readonly [scope in ErrorScope]: number } = {
  general: 0,
  export: 1,
  import: 2,
}

const pickPrimaryError = (errors: ErrorMap): ErrorWithScope | null => {
  let best: ErrorWithScope | null = null
  let bestRank = -1
  let bestScopePriority = Number.POSITIVE_INFINITY

  for (const [scopeKey, details] of Object.entries(errors) as Array<
    [ErrorScope, SerializableErrorState | undefined]
  >) {
    if (!details) continue
    const rank = ERROR_SEVERITY_RANK[details.severity] ?? 0
    const scopePriority = ERROR_SCOPE_PRIORITY[scopeKey] ?? 99

    if (
      rank > bestRank ||
      (rank === bestRank && scopePriority < bestScopePriority)
    ) {
      best = { scope: scopeKey, details }
      bestRank = rank
      bestScopePriority = scopePriority
    }
  }

  return best
}

function applyErrorPatch(
  state: ImmutableObject<FmeWidgetState>,
  patch: Partial<{ [scope in ErrorScope]: SerializableErrorState | null }>
): ImmutableObject<FmeWidgetState> {
  if (!patch || Object.keys(patch).length === 0) {
    return state
  }

  const currentMap = (state.errors as ErrorMap) ?? createInitialErrorMap()
  let changed = false
  const nextMap: Partial<{ [scope in ErrorScope]: SerializableErrorState }> = {
    ...currentMap,
  }

  for (const [scopeKey, maybeError] of Object.entries(patch) as Array<
    [ErrorScope, SerializableErrorState | null]
  >) {
    if (!maybeError) {
      if (scopeKey in nextMap) {
        delete nextMap[scopeKey]
        changed = true
      }
      continue
    }

    const current = nextMap[scopeKey]
    if (current !== maybeError) {
      nextMap[scopeKey] = maybeError
      changed = true
    }
  }

  if (!changed) {
    return state
  }

  const readonlyMap = nextMap as ErrorMap
  const primary = pickPrimaryError(readonlyMap)

  return state.set("errors", readonlyMap).set("error", primary)
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
      const area = act.drawnArea ?? 0
      const geometryChanged =
        state.geometryJson !== act.geometryJson || state.drawnArea !== area
      if (!geometryChanged) {
        return state
      }
      return state
        .set("geometryJson", act.geometryJson)
        .set("drawnArea", area)
        .set("geometryRevision", state.geometryRevision + 1)
    }

    case FmeActionType.COMPLETE_DRAWING: {
      const act = action as ActionFrom<"completeDrawing">
      const area = act.drawnArea ?? 0
      const nextView = act.nextViewMode ?? state.viewMode
      const geometryChanged =
        state.geometryJson !== act.geometryJson || state.drawnArea !== area

      let nextState = state
      if (geometryChanged) {
        nextState = nextState
          .set("geometryJson", act.geometryJson)
          .set("drawnArea", area)
          .set("geometryRevision", state.geometryRevision + 1)
      }

      if (nextView !== state.viewMode) {
        nextState = nextState.set("viewMode", nextView)
      }

      return nextState
    }

    case FmeActionType.SET_DRAWING_TOOL: {
      const act = action as ActionFrom<"setDrawingTool">
      if (state.drawingTool === act.drawingTool) {
        return state
      }
      return state.set("drawingTool", act.drawingTool)
    }

    case FmeActionType.SET_ORDER_RESULT: {
      const act = action as ActionFrom<"setOrderResult">
      if (state.orderResult === act.orderResult) {
        return state
      }
      return state.set("orderResult", act.orderResult)
    }

    case FmeActionType.SET_WORKSPACE_ITEMS: {
      const act = action as ActionFrom<"setWorkspaceItems">
      if (state.workspaceItems === act.workspaceItems) {
        return state
      }
      return state.set("workspaceItems", act.workspaceItems)
    }

    case FmeActionType.SET_WORKSPACE_PARAMETERS: {
      const act = action as ActionFrom<"setWorkspaceParameters">
      const requested = normalizeWorkspaceName(act.workspaceName)
      const currentSelection = normalizeWorkspaceName(state.selectedWorkspace)

      if (!requested) {
        if (state.workspaceParameters === act.workspaceParameters) {
          return state
        }
        return state.set("workspaceParameters", act.workspaceParameters)
      }

      if (!currentSelection) {
        return state
          .set("selectedWorkspace", requested)
          .set("workspaceParameters", act.workspaceParameters)
          .set("orderResult", null)
      }

      if (requested !== currentSelection) {
        return state
      }

      if (state.workspaceParameters === act.workspaceParameters) {
        return state
      }

      let nextState = state.set("workspaceParameters", act.workspaceParameters)
      if (state.orderResult !== null) {
        nextState = nextState.set("orderResult", null)
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
      let nextState = state.set("selectedWorkspace", desired)

      if (state.workspaceParameters.length) {
        nextState = nextState.set("workspaceParameters", [])
      }

      if (state.workspaceItem !== null) {
        nextState = nextState.set("workspaceItem", null)
      }

      if (state.orderResult !== null) {
        nextState = nextState.set("orderResult", null)
      }

      nextState = applyErrorPatch(nextState, {
        import: null,
        export: null,
      })

      return nextState
    }

    case FmeActionType.SET_WORKSPACE_ITEM: {
      const act = action as ActionFrom<"setWorkspaceItem">
      const current = normalizeWorkspaceName(state.selectedWorkspace)
      const itemName = normalizeWorkspaceName(act.workspaceItem?.name)

      if (act.workspaceItem && current && itemName && itemName !== current) {
        return state
      }

      if (state.workspaceItem === act.workspaceItem) {
        return state
      }

      return state.set("workspaceItem", act.workspaceItem)
    }

    case FmeActionType.CLEAR_WORKSPACE_STATE: {
      const clearedLoading = createInitialLoadingState()
      let nextState = state

      if (state.workspaceItems.length) {
        nextState = nextState.set("workspaceItems", [])
      }

      if (state.selectedWorkspace !== null) {
        nextState = nextState.set("selectedWorkspace", null)
      }

      if (state.workspaceParameters.length) {
        nextState = nextState.set("workspaceParameters", [])
      }

      if (state.workspaceItem !== null) {
        nextState = nextState.set("workspaceItem", null)
      }

      if (state.orderResult !== null) {
        nextState = nextState.set("orderResult", null)
      }

      if (!areLoadingStatesEqual(state.loading, clearedLoading)) {
        nextState = nextState.set("loading", clearedLoading)
      }

      nextState = applyErrorPatch(nextState, {
        general: null,
        import: null,
        export: null,
      })

      return nextState
    }

    case FmeActionType.SET_ERROR: {
      const act = action as ActionFrom<"setError">
      return applyErrorPatch(state, { [act.scope]: act.error })
    }

    case FmeActionType.SET_ERRORS: {
      const act = action as ActionFrom<"setErrors">
      return applyErrorPatch(state, act.errors)
    }

    case FmeActionType.CLEAR_ERROR: {
      const act = action as ActionFrom<"clearError">
      if (act.scope === "all") {
        return applyErrorPatch(state, {
          general: null,
          import: null,
          export: null,
        })
      }
      return applyErrorPatch(state, { [act.scope]: null })
    }

    case FmeActionType.RESET_TO_DRAWING: {
      const clearedLoading = createInitialLoadingState()
      let nextState = state

      if (state.geometryJson !== null || state.drawnArea !== 0) {
        nextState = nextState
          .set("geometryJson", null)
          .set("drawnArea", 0)
          .set("geometryRevision", state.geometryRevision + 1)
      }

      if (state.selectedWorkspace !== null) {
        nextState = nextState.set("selectedWorkspace", null)
      }

      if (state.workspaceParameters.length) {
        nextState = nextState.set("workspaceParameters", [])
      }

      if (state.workspaceItem !== null) {
        nextState = nextState.set("workspaceItem", null)
      }

      if (state.orderResult !== null) {
        nextState = nextState.set("orderResult", null)
      }

      if (!areLoadingStatesEqual(state.loading, clearedLoading)) {
        nextState = nextState.set("loading", clearedLoading)
      }

      nextState = applyErrorPatch(nextState, {
        general: null,
        import: null,
        export: null,
      })

      if (nextState.viewMode !== ViewMode.DRAWING) {
        nextState = nextState.set("viewMode", ViewMode.DRAWING)
      }

      return nextState
    }

    case FmeActionType.SET_LOADING_FLAG: {
      const act = action as ActionFrom<"setLoadingFlag">
      const currentValue = state.loading[act.flag]
      const nextValue = Boolean(act.value)
      if (currentValue === nextValue) {
        return state
      }
      return state.set("loading", {
        ...state.loading,
        [act.flag]: nextValue,
      })
    }

    case FmeActionType.APPLY_WORKSPACE_DATA: {
      const act = action as ActionFrom<"applyWorkspaceData">
      const normalized = normalizeWorkspaceName(act.workspaceName)
      if (!normalized) {
        return state
      }

      let nextState = state

      if (state.selectedWorkspace !== normalized) {
        nextState = nextState.set("selectedWorkspace", normalized)
      }

      if (state.workspaceParameters !== act.workspaceParameters) {
        nextState = nextState.set(
          "workspaceParameters",
          act.workspaceParameters
        )
      }

      if (state.workspaceItem !== act.workspaceItem) {
        nextState = nextState.set("workspaceItem", act.workspaceItem)
      }

      if (state.orderResult !== null) {
        nextState = nextState.set("orderResult", null)
      }

      nextState = applyErrorPatch(nextState, {
        import: null,
        export: null,
      })

      return nextState
    }

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
  let hydrated = (current ??
    (createImmutableState() as unknown)) as ImmutableObject<FmeWidgetState>

  if (typeof (hydrated as any).geometryRevision !== "number") {
    hydrated = hydrated.set("geometryRevision", 0)
  }

  if (!(hydrated as any).loading) {
    hydrated = hydrated.set("loading", createInitialLoadingState())
  }

  if (!(hydrated as any).errors) {
    hydrated = hydrated.set("errors", createInitialErrorMap())
  }

  const errors = (hydrated as any).errors as ErrorMap
  const desiredPrimary = pickPrimaryError(errors)
  const currentPrimary = (hydrated as any).error as ErrorWithScope | null
  const primaryChanged =
    (!currentPrimary && desiredPrimary !== null) ||
    (currentPrimary &&
      (!desiredPrimary ||
        currentPrimary.scope !== desiredPrimary.scope ||
        currentPrimary.details !== desiredPrimary.details))

  if (primaryChanged) {
    hydrated = hydrated.set("error", desiredPrimary)
  }

  return hydrated
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
    selectDrawingTool: (state: IMStateWithFmeExport) =>
      getSlice(state)?.drawingTool ?? initialFmeState.drawingTool,
    selectGeometryJson: (state: IMStateWithFmeExport) =>
      getSlice(state)?.geometryJson ?? null,
    selectDrawnArea: (state: IMStateWithFmeExport) =>
      getSlice(state)?.drawnArea ?? initialFmeState.drawnArea,
    selectGeometryRevision: (state: IMStateWithFmeExport) =>
      getSlice(state)?.geometryRevision ?? initialFmeState.geometryRevision,
    selectWorkspaceItems: (state: IMStateWithFmeExport) =>
      getSlice(state)?.workspaceItems ?? initialFmeState.workspaceItems,
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
    selectErrors: (state: IMStateWithFmeExport) =>
      getSlice(state)?.errors ?? initialFmeState.errors,
    selectErrorByScope: (scope: ErrorScope) => (state: IMStateWithFmeExport) =>
      getSlice(state)?.errors?.[scope] ?? null,
    selectLoading: (state: IMStateWithFmeExport) =>
      getSlice(state)?.loading ?? initialFmeState.loading,
    selectLoadingFlag:
      (flag: LoadingFlagKey) => (state: IMStateWithFmeExport) =>
        getSlice(state)?.loading?.[flag] ?? initialFmeState.loading[flag],
    selectHasValidAoi: (state: IMStateWithFmeExport) => {
      const slice = getSlice(state)
      if (!slice) return false
      return Boolean(slice.geometryJson) && (slice.drawnArea ?? 0) > 0
    },
    selectCanExport: (state: IMStateWithFmeExport) => {
      const slice = getSlice(state)
      if (!slice) return false
      const hasGeometry = Boolean(slice.geometryJson) && slice.drawnArea > 0
      const hasWorkspace = Boolean(
        normalizeWorkspaceName(slice.selectedWorkspace)
      )
      const hasParameters = (slice.workspaceParameters?.length ?? 0) > 0
      const generalError = slice.errors?.general
      const blockingError = generalError
        ? (ERROR_SEVERITY_RANK[generalError.severity] ?? 0) >=
          ERROR_SEVERITY_RANK[ErrorSeverity.ERROR]
        : false
      return hasGeometry && hasWorkspace && hasParameters && !blockingError
    },
    selectIsBusy: (state: IMStateWithFmeExport) => {
      const loading = getSlice(state)?.loading ?? initialFmeState.loading
      return (
        loading.workspaces ||
        loading.parameters ||
        loading.modules ||
        loading.submission
      )
    },
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
