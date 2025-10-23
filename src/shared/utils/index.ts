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
) => {
  const bindWidgetAction =
    <Args extends any[]>(
      action: (...actionArgs: [...Args, string]) => unknown
    ) =>
    (...args: Args) => {
      dispatch(action(...args, widgetId))
    }

  return {
    setDrawingTool: bindWidgetAction<[DrawingTool]>(fmeActions.setDrawingTool),
    setViewMode: bindWidgetAction<[ViewMode]>(fmeActions.setViewMode),
    setError: bindWidgetAction<[ErrorScope, SerializableErrorState | null]>(
      fmeActions.setError
    ),
    clearError: bindWidgetAction<[ErrorScope | "all"]>(fmeActions.clearError),
    setGeometry: bindWidgetAction<[any, number]>(fmeActions.setGeometry),
    setWorkspaceItems: bindWidgetAction<[readonly WorkspaceItem[]]>(
      fmeActions.setWorkspaceItems
    ),
    applyWorkspaceData: bindWidgetAction<
      [
        {
          readonly workspaceName: string
          readonly parameters: readonly WorkspaceParameter[]
          readonly item: WorkspaceItemDetail
        },
      ]
    >(fmeActions.applyWorkspaceData),
    completeDrawing: bindWidgetAction<[any, number, ViewMode]>(
      fmeActions.completeDrawing
    ),
    clearWorkspaceState: bindWidgetAction<[]>(fmeActions.clearWorkspaceState),
    resetState: bindWidgetAction<[]>(fmeActions.resetState),
    resetToDrawing: bindWidgetAction<[]>(fmeActions.resetToDrawing),
    setLoadingFlag: bindWidgetAction<[LoadingFlagKey, boolean]>(
      fmeActions.setLoadingFlag
    ),
    setOrderResult: bindWidgetAction<[ExportResult]>(fmeActions.setOrderResult),
    completeStartup: bindWidgetAction<[]>(fmeActions.completeStartup),
    removeWidgetState: bindWidgetAction<[]>(fmeActions.removeWidgetState),
  }
}
