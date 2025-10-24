import type { Dispatch } from "react"
import type {
  DrawingTool,
  ViewMode,
  ExportResult,
  WorkspaceItem,
  WorkspaceItemDetail,
  WorkspaceParameter,
  ErrorScope,
  LoadingFlagKey,
  SerializableErrorState,
} from "../../config/index"
import { fmeActions } from "../../extensions/store"

export * from "./conversion"
export * from "./format"
export * from "./geometry"
export * from "./form"
export * from "./error"
export * from "./fme"
export * from "./arcgis"
export * from "./network"

export {
  isValidExternalUrlForOptGetUrl,
  computeSelectCoerce,
  parseTableRows,
  shouldApplyRemoteDatasetUrl,
  shouldUploadRemoteDataset,
  isValidEmail,
  validateEmailField,
  getSupportEmail,
} from "../validations"

export { useLatestAbortController } from "../hooks"

// Skapar Redux dispatcher med widgetId
export const createFmeDispatcher = (
  dispatch: Dispatch<any>,
  widgetId: string
) => ({
  setDrawingTool: (tool: DrawingTool) => {
    dispatch(fmeActions.setDrawingTool(tool, widgetId))
  },
  setViewMode: (mode: ViewMode) => {
    dispatch(fmeActions.setViewMode(mode, widgetId))
  },
  setError: (scope: ErrorScope, error: SerializableErrorState | null) => {
    dispatch(fmeActions.setError(scope, error, widgetId))
  },
  clearError: (scope: ErrorScope | "all") => {
    dispatch(fmeActions.clearError(scope, widgetId))
  },
  setGeometry: (geometryJson: any, area: number) => {
    dispatch(fmeActions.setGeometry(geometryJson, area, widgetId))
  },
  setWorkspaceItems: (items: readonly WorkspaceItem[]) => {
    dispatch(fmeActions.setWorkspaceItems(items as WorkspaceItem[], widgetId))
  },
  applyWorkspaceData: (payload: {
    readonly workspaceName: string
    readonly parameters: readonly WorkspaceParameter[]
    readonly item: WorkspaceItemDetail
  }) => {
    dispatch(fmeActions.applyWorkspaceData(payload, widgetId))
  },
  completeDrawing: (geometryJson: any, area: number, nextView: ViewMode) => {
    dispatch(fmeActions.completeDrawing(geometryJson, area, nextView, widgetId))
  },
  clearWorkspaceState: () => {
    dispatch(fmeActions.clearWorkspaceState(widgetId))
  },
  resetState: () => {
    dispatch(fmeActions.resetState(widgetId))
  },
  resetToDrawing: () => {
    dispatch(fmeActions.resetToDrawing(widgetId))
  },
  setLoadingFlag: (flag: LoadingFlagKey, loading: boolean) => {
    dispatch(fmeActions.setLoadingFlag(flag, loading, widgetId))
  },
  setOrderResult: (result: ExportResult) => {
    dispatch(fmeActions.setOrderResult(result, widgetId))
  },
  completeStartup: () => {
    dispatch(fmeActions.completeStartup(widgetId))
  },
  removeWidgetState: () => {
    dispatch(fmeActions.removeWidgetState(widgetId))
  },
})
