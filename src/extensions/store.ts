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
} from "../config/index"
import { toSerializable } from "../shared/utils"

/* Action creators för FME-widget state management */
export const fmeActions = {
  // Sätter aktuellt vyläge (drawing, selection, form, result)
  setViewMode: (viewMode: ViewMode, widgetId: string) => ({
    type: FmeActionType.SET_VIEW_MODE,
    viewMode,
    widgetId,
  }),
  // Återställer widget till initialtillstånd
  resetState: (widgetId: string) => ({
    type: FmeActionType.RESET_STATE,
    widgetId,
  }),
  // Lagrar geometri och beräknad yta från ritverktyg
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
  // Ändrar aktivt ritverktyg (polygon, rectangle, circle)
  setDrawingTool: (drawingTool: DrawingTool, widgetId: string) => ({
    type: FmeActionType.SET_DRAWING_TOOL,
    drawingTool,
    widgetId,
  }),
  // Slutför ritning och byter vyläge
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
  // Lagrar FME-jobbresultat (URL, jobId, etc.)
  setOrderResult: (orderResult: ExportResult | null, widgetId: string) => ({
    type: FmeActionType.SET_ORDER_RESULT,
    orderResult,
    widgetId,
  }),
  // Uppdaterar listan över tillgängliga workspaces
  setWorkspaceItems: (
    workspaceItems: readonly WorkspaceItem[],
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEMS,
    workspaceItems,
    widgetId,
  }),
  // Lagrar parametrar för valt workspace
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
  // Väljer aktivt workspace efter namn
  setSelectedWorkspace: (workspaceName: string | null, widgetId: string) => ({
    type: FmeActionType.SET_SELECTED_WORKSPACE,
    workspaceName,
    widgetId,
  }),
  // Lagrar detaljerad workspace-metadata
  setWorkspaceItem: (
    workspaceItem: WorkspaceItemDetail | null,
    widgetId: string
  ) => ({
    type: FmeActionType.SET_WORKSPACE_ITEM,
    workspaceItem,
    widgetId,
  }),
  // Sätter enskilt fel för specifik scope (general/import/export)
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
  // Sätter flera fel samtidigt (batch-uppdatering)
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
    // Serialiserar alla fel till Redux-kompatibelt format
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
  // Rensar fel för specifik scope eller alla
  clearError: (scope: ErrorScope | "all", widgetId: string) => ({
    type: FmeActionType.CLEAR_ERROR,
    scope,
    widgetId,
  }),
  // Rensar workspace-relaterad state (items, parameters, etc.)
  clearWorkspaceState: (widgetId: string) => ({
    type: FmeActionType.CLEAR_WORKSPACE_STATE,
    widgetId,
  }),
  // Återgår till ritläge, rensar geometri och workspace-data
  resetToDrawing: (widgetId: string) => ({
    type: FmeActionType.RESET_TO_DRAWING,
    widgetId,
  }),
  // Markerar uppstart som slutförd
  completeStartup: (widgetId: string) => ({
    type: FmeActionType.COMPLETE_STARTUP,
    widgetId,
  }),
  // Sätter laddningsflagga (workspaces, parameters, modules, submission)
  setLoadingFlag: (flag: LoadingFlagKey, value: boolean, widgetId: string) => ({
    type: FmeActionType.SET_LOADING_FLAG,
    flag,
    value,
    widgetId,
  }),
  // Applicerar komplett workspace-data (namn, parametrar, item) atomärt
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
  // Intern action för att ta bort widget-state vid unmount
  // Internal action to remove entire widget state (e.g. on unmount)
  removeWidgetState: (widgetId: string) => ({
    type: FmeActionType.REMOVE_WIDGET_STATE,
    widgetId,
  }),
}

/* Type helpers och initial state */

export type FmeAction = ReturnType<(typeof fmeActions)[keyof typeof fmeActions]>

type ActionFrom<K extends keyof typeof fmeActions> = ReturnType<
  (typeof fmeActions)[K]
>

// Initial state för en widget-instans
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

  // Loading
  loading: createInitialLoadingState(),

  // Errors
  errors: createInitialErrorMap(),
}

// Seamless-immutable typing är trasig, tvingar typning här
// Seamless-immutable typing is broken, so we need to force it here
const Immutable = ((SeamlessImmutable as any).default ?? SeamlessImmutable) as (
  input: any
) => any

/* Hjälpfunktioner för state-hantering */

const createImmutableState = (): ImmutableObject<FmeWidgetState> =>
  Immutable(initialFmeState) as ImmutableObject<FmeWidgetState>

// Normaliserar workspace-namn (trim och null-hantering)
const normalizeWorkspaceName = (
  name: string | null | undefined
): string | null => {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  return trimmed || null
}

// Serialiserar ArcGIS-geometri till JSON för Redux-lagring
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

// Skapar initial laddningstillstånd med alla flaggor false
function createInitialLoadingState(): LoadingState {
  return {
    workspaces: false,
    parameters: false,
    modules: false,
    submission: false,
  }
}

// Skapar tom error-map
function createInitialErrorMap(): ErrorMap {
  return {}
}

// Jämför om två laddningstillstånd är identiska
function areLoadingStatesEqual(a: LoadingState, b: LoadingState): boolean {
  return (
    a.workspaces === b.workspaces &&
    a.parameters === b.parameters &&
    a.modules === b.modules &&
    a.submission === b.submission
  )
}

/* Error-hantering och prioritering */

// Prioritetsrangordning för felallvarlighet (högre = allvarligare)
const ERROR_SEVERITY_RANK: {
  readonly [key in ErrorSeverity]: number
} = {
  [ErrorSeverity.ERROR]: 3,
  [ErrorSeverity.WARNING]: 2,
  [ErrorSeverity.INFO]: 1,
}

// Prioritet för error-scopes (lägre = högre prioritet)
const ERROR_SCOPE_PRIORITY: { readonly [scope in ErrorScope]: number } = {
  general: 0,
  export: 1,
  import: 2,
}

// Väljer primärt fel baserat på severity och scope-prioritet
const pickPrimaryError = (errors: ErrorMap): ErrorWithScope | null => {
  let best: ErrorWithScope | null = null
  let bestRank = -1
  let bestScopePriority = Number.POSITIVE_INFINITY

  for (const [scopeKey, details] of Object.entries(errors) as Array<
    [ErrorScope, SerializableErrorState | undefined]
  >) {
    if (!details) continue

    // Validerar att severity är giltig enum-medlem
    if (!(details.severity in ERROR_SEVERITY_RANK)) continue
    // Validerar att scope är giltig enum-medlem
    if (!(scopeKey in ERROR_SCOPE_PRIORITY)) continue

    const rank = ERROR_SEVERITY_RANK[details.severity]
    const scopePriority = ERROR_SCOPE_PRIORITY[scopeKey]

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

// Applicerar partiell error-uppdatering
function applyErrorPatch(
  state: ImmutableObject<FmeWidgetState>,
  patch: Partial<{ [scope in ErrorScope]: SerializableErrorState | null }>
): ImmutableObject<FmeWidgetState> {
  if (!patch || Object.keys(patch).length === 0) {
    return state
  }

  const currentMap = (state.errors as ErrorMap) ?? createInitialErrorMap()
  const changes: Partial<{ [scope in ErrorScope]: SerializableErrorState | null }> = {}

  for (const [scopeKey, maybeError] of Object.entries(patch) as Array<
    [ErrorScope, SerializableErrorState | null]
  >) {
    // Validerar att scope är giltig enum-medlem
    if (!(scopeKey in ERROR_SCOPE_PRIORITY)) continue

    const current = currentMap[scopeKey]
    if (current !== maybeError) {
      changes[scopeKey] = maybeError
    }
  }

  if (Object.keys(changes).length === 0) {
    return state
  }

  const nextMap = Object.entries({ ...currentMap, ...changes }).reduce<
    Partial<{ [scope in ErrorScope]: SerializableErrorState }>
  >((acc, [key, val]) => {
    if (val !== null) acc[key as ErrorScope] = val
    return acc
  }, {})

  const readonlyMap = nextMap as ErrorMap
  return state.set("errors", readonlyMap)
}

/* Reducer för enskild widget-instans */

// Reducer for a single widget instance
const reduceOne = (
  state: ImmutableObject<FmeWidgetState>,
  action: FmeAction
): ImmutableObject<FmeWidgetState> => {
  let nextState = state

  switch (action.type) {
    case FmeActionType.SET_VIEW_MODE: {
      const act = action as ActionFrom<"setViewMode">
      // Ingen ändring om samma vyläge redan aktivt
      if (state.viewMode === act.viewMode) {
        return state
      }
      nextState = state.set("viewMode", act.viewMode)
      break
    }

    case FmeActionType.RESET_STATE:
      // Återställer till initial immutable state
      nextState = createImmutableState()
      break

    case FmeActionType.SET_GEOMETRY: {
      const act = action as ActionFrom<"setGeometry">
      const area = act.drawnArea ?? 0
      // Kontrollerar om geometri eller yta faktiskt ändrats
      const geometryChanged =
        state.geometryJson !== act.geometryJson || state.drawnArea !== area
      if (!geometryChanged) {
        return state
      }
      // Uppdaterar geometri
      nextState = state
        .set("geometryJson", act.geometryJson)
        .set("drawnArea", area)
      break
    }

    case FmeActionType.COMPLETE_DRAWING: {
      const act = action as ActionFrom<"completeDrawing">
      const area = act.drawnArea ?? 0
      const nextView = act.nextViewMode ?? state.viewMode
      // Kontrollerar om geometri ändrats
      const geometryChanged =
        state.geometryJson !== act.geometryJson || state.drawnArea !== area

      nextState = state
      if (geometryChanged) {
        nextState = nextState
          .set("geometryJson", act.geometryJson)
          .set("drawnArea", area)
      }

      if (nextView !== state.viewMode) {
        nextState = nextState.set("viewMode", nextView)
      }
      break
    }

    case FmeActionType.SET_DRAWING_TOOL: {
      const act = action as ActionFrom<"setDrawingTool">
      if (state.drawingTool === act.drawingTool) {
        return state
      }
      nextState = state.set("drawingTool", act.drawingTool)
      break
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

      // Inget workspace specificerat: uppdatera bara parametrar
      if (!requested) {
        if (state.workspaceParameters === act.workspaceParameters) {
          return state
        }
        return state.set("workspaceParameters", act.workspaceParameters)
      }

      // Inget valt workspace: sätt både workspace och parametrar
      if (!currentSelection) {
        return state
          .set("selectedWorkspace", requested)
          .set("workspaceParameters", act.workspaceParameters)
          .set("orderResult", null)
      }

      // Parametrar för annat workspace: ignorera
      if (requested !== currentSelection) {
        return state
      }

      // Parametrar för aktuellt workspace: uppdatera och rensa result
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
      // Ingen ändring om samma workspace redan valt
      if (current === desired) {
        return state
      }
      // Rensar parametrar, item och resultat vid workspace-byte
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

      // Ignorerar item om namnet inte matchar valt workspace
      if (act.workspaceItem && current && itemName && itemName !== current) {
        return state
      }

      if (state.workspaceItem === act.workspaceItem) {
        return state
      }

      return state.set("workspaceItem", act.workspaceItem)
    }

    case FmeActionType.CLEAR_WORKSPACE_STATE: {
      // Rensar all workspace-relaterad data och laddningsflaggor
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
      // Återgår till ritläge och rensar all data utom drawing tool
      const clearedLoading = createInitialLoadingState()
      let nextState = state

      if (state.geometryJson !== null || state.drawnArea !== 0) {
        nextState = nextState.set("geometryJson", null).set("drawnArea", 0)
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
      // Ingen ändring om flaggan redan har rätt värde
      if (currentValue === nextValue) {
        return state
      }
      return state.set("loading", {
        ...state.loading,
        [act.flag]: nextValue,
      })
    }

    case FmeActionType.APPLY_WORKSPACE_DATA: {
      // Applicerar workspace-data atomärt (namn, parametrar, item)
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
      // Byter från STARTUP_VALIDATION till INITIAL
      nextState = state.set("viewMode", ViewMode.INITIAL)
      break

    case FmeActionType.REMOVE_WIDGET_STATE:
      return state
  }

  return nextState
}

/* State-access och hydration helpers */

// Säkerställer att sub-state finns och är korrekt hydrerad
const ensureSubState = (
  global: IMFmeGlobalState,
  widgetId: string
): ImmutableObject<FmeWidgetState> => {
  const current = (global as any).byId?.[widgetId] as
    | ImmutableObject<FmeWidgetState>
    | undefined
  let hydrated = (current ??
    (createImmutableState() as unknown)) as ImmutableObject<FmeWidgetState>

  // Bakåtkompatibilitet: lägg till saknade fält
  if (!(hydrated as any).loading) {
    hydrated = hydrated.set("loading", createInitialLoadingState())
  }

  if (!(hydrated as any).errors) {
    hydrated = hydrated.set("errors", createInitialErrorMap())
  }

  return hydrated
}

// Uppdaterar sub-state för specifik widget i global state
const setSubState = (
  global: IMFmeGlobalState,
  widgetId: string,
  next: ImmutableObject<FmeWidgetState>
): IMFmeGlobalState => {
  const byId = { ...((global as any).byId || {}) }
  byId[widgetId] = next
  return Immutable({ byId }) as unknown as IMFmeGlobalState
}

/* Selectors för att hämta state från Redux store */

// Hämtar FME-slice för specifik widget från global state
export const selectFmeSlice = (
  state: IMStateWithFmeExport,
  widgetId: string
): ImmutableObject<FmeWidgetState> | null => {
  const slice = (state as any)?.["fme-state"]?.byId?.[widgetId] as
    | ImmutableObject<FmeWidgetState>
    | undefined
  return slice ?? null
}

// Skapar memoized selectors för specifik widget-instans
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
    selectErrors: (state: IMStateWithFmeExport) =>
      getSlice(state)?.errors ?? initialFmeState.errors,
    selectPrimaryError: (state: IMStateWithFmeExport) => {
      const errors = getSlice(state)?.errors ?? initialFmeState.errors
      return pickPrimaryError(errors)
    },
    selectErrorByScope: (scope: ErrorScope) => (state: IMStateWithFmeExport) =>
      getSlice(state)?.errors?.[scope] ?? null,
    selectLoading: (state: IMStateWithFmeExport) =>
      getSlice(state)?.loading ?? initialFmeState.loading,
    selectLoadingFlag:
      (flag: LoadingFlagKey) => (state: IMStateWithFmeExport) =>
        getSlice(state)?.loading?.[flag] ?? initialFmeState.loading[flag],
    // Beräknad selector: kontrollerar om giltig AOI finns
    selectHasValidAoi: (state: IMStateWithFmeExport) => {
      const slice = getSlice(state)
      if (!slice) return false
      return Boolean(slice.geometryJson) && (slice.drawnArea ?? 0) > 0
    },
    // Beräknad selector: kan export utföras?
    selectCanExport: (state: IMStateWithFmeExport) => {
      const slice = getSlice(state)
      if (!slice) return false
      const hasGeometry =
        Boolean(slice.geometryJson) &&
        Number.isFinite(slice.drawnArea) &&
        slice.drawnArea > 0
      const hasWorkspace = Boolean(
        normalizeWorkspaceName(slice.selectedWorkspace)
      )
      const hasWorkspaceDetails =
        (slice.workspaceParameters?.length ?? 0) > 0 ||
        slice.workspaceItem !== null
      const generalError = slice.errors?.general
      const blockingError = generalError
        ? (ERROR_SEVERITY_RANK[generalError.severity] ?? 0) >=
          ERROR_SEVERITY_RANK[ErrorSeverity.ERROR]
        : false
      return (
        hasGeometry && hasWorkspace && hasWorkspaceDetails && !blockingError
      )
    },
    // Beräknad selector: pågår någon laddning?
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

/* Root reducer och action guards */

// Root reducer that delegates to per-widget reducer
const initialGlobalState = Immutable({
  byId: {},
}) as unknown as IMFmeGlobalState

// Type guard: kontrollerar om action är en giltig FME-action
const isFmeAction = (candidate: unknown): candidate is FmeAction => {
  if (!candidate || typeof candidate !== "object") return false
  const action = candidate as { type?: unknown; widgetId?: unknown }
  if (typeof action.type !== "string") return false
  if (!FME_ACTION_TYPES.includes(action.type as FmeActionType)) return false
  return typeof action.widgetId === "string"
}

// Root reducer som delegerar till per-widget reducer
const fmeReducer = (
  state: IMFmeGlobalState = initialGlobalState,
  action: unknown
): IMFmeGlobalState => {
  if (!isFmeAction(action)) {
    return state
  }
  // Specialfall: ta bort hela widget-state vid unmount
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
    // Inget widgetId: returnera oförändrad state för säkerhet
    // No widgetId provided — return state unchanged for safety
    return state
  }

  const prevSub = ensureSubState(state, widgetId)
  const nextSub = reduceOne(prevSub, action)
  if (nextSub === prevSub) return state
  return setSubState(state, widgetId, nextSub)
}

/* Redux store extension för jimu-core */

// Store extension
export default class FmeReduxStoreExtension
  implements extensionSpec.ReduxStoreExtension
{
  readonly id = "fme-export_store"

  // Returnerar alla action-typer som string-array
  getActions(): string[] {
    // Return all action types as string array
    return [...FME_ACTION_TYPES]
  }

  // Returnerar initial lokal state-struktur
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
