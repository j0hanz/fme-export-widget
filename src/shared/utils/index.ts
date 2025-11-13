import type { Dispatch } from "react";
import type {
  DrawingTool,
  ErrorScope,
  ExportResult,
  LoadingFlagKey,
  SerializableErrorState,
  ViewMode,
  WorkspaceItem,
  WorkspaceItemDetail,
  WorkspaceParameter,
} from "../../config/index";
import { fmeActions } from "../../extensions/store";

export * from "./conversion";
export * from "./format";
export * from "./geometry";
export * from "./form";
export {
  safeAbortController,
  linkAbortSignal,
  logIfNotAbort,
  shouldSuppressError,
  createErrorActions,
  getErrorIconSrc,
  createGeometryError,
  mapErrorFromNetwork,
  mapErrorFromValidation,
  buildValidationErrors,
  formatErrorPresentation,
} from "./error";
export * from "./fme";
export * from "./arcgis";
export * from "./network";
export { isAbortError } from "./error";

export {
  isValidExternalUrlForOptGetUrl,
  computeSelectCoerce,
  parseTableRows,
  shouldApplyRemoteDatasetUrl,
  shouldUploadRemoteDataset,
  isValidEmail,
  validateEmailField,
  getSupportEmail,
} from "../validations";

export { useLatestAbortController } from "../hooks";

// Skapar Redux dispatcher med widgetId
export const createFmeDispatcher = (
  dispatch: Dispatch<unknown>,
  widgetId: string
) => ({
  setDrawingTool: (tool: DrawingTool) => {
    dispatch(fmeActions.setDrawingTool(tool, widgetId));
  },
  setViewMode: (mode: ViewMode) => {
    dispatch(fmeActions.setViewMode(mode, widgetId));
  },
  setError: (scope: ErrorScope, error: SerializableErrorState | null) => {
    dispatch(fmeActions.setError(scope, error, widgetId));
  },
  clearError: (scope: ErrorScope | "all") => {
    dispatch(fmeActions.clearError(scope, widgetId));
  },
  setGeometry: (geometry: __esri.Geometry | null, area: number | undefined) => {
    dispatch(fmeActions.setGeometry(geometry, area, widgetId));
  },
  setWorkspaceItems: (items: readonly WorkspaceItem[]) => {
    dispatch(fmeActions.setWorkspaceItems(items, widgetId));
  },
  applyWorkspaceData: (payload: {
    readonly workspaceName: string;
    readonly parameters: readonly WorkspaceParameter[];
    readonly item: WorkspaceItemDetail;
  }) => {
    dispatch(fmeActions.applyWorkspaceData(payload, widgetId));
  },
  completeDrawing: (
    geometry: __esri.Geometry,
    area: number,
    nextView: ViewMode
  ) => {
    dispatch(fmeActions.completeDrawing(geometry, area, nextView, widgetId));
  },
  clearWorkspaceState: () => {
    dispatch(fmeActions.clearWorkspaceState(widgetId));
  },
  resetState: () => {
    dispatch(fmeActions.resetState(widgetId));
  },
  resetToDrawing: () => {
    dispatch(fmeActions.resetToDrawing(widgetId));
  },
  setLoadingFlag: (flag: LoadingFlagKey, loading: boolean) => {
    dispatch(fmeActions.setLoadingFlag(flag, loading, widgetId));
  },
  setOrderResult: (result: ExportResult | null) => {
    dispatch(fmeActions.setOrderResult(result, widgetId));
  },
  completeStartup: () => {
    dispatch(fmeActions.completeStartup(widgetId));
  },
  removeWidgetState: () => {
    dispatch(fmeActions.removeWidgetState(widgetId));
  },
});
