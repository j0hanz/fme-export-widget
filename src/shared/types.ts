import type { IMState, ImmutableObject } from "jimu-core"

// Base Types & Utilities
export enum StateType {
  IDLE = "idle",
  LOADING = "loading",
  ERROR = "error",
  SUCCESS = "success",
  CONTENT = "content",
  EMPTY = "empty",
}

export interface StateActionButton {
  readonly label: string
  readonly onClick: () => void
  readonly variant?: "primary" | "secondary" | "danger"
  readonly disabled?: boolean
}

export interface StateData {
  readonly message?: string
  readonly detail?: string
  readonly error?: ErrorState
  readonly actions?: StateActionButton[]
  readonly children?: React.ReactNode
  readonly config?: LoadingConfig
}

// Loading indicator config
export interface LoadingConfig {
  readonly type?: "DONUT" | "PRIMARY" | "SECONDARY"
  readonly size?: number
}

// State controller return type
export interface StateControllerReturn {
  readonly currentState: StateType
  readonly data: StateData
  readonly isLoading: boolean
  readonly hasError: boolean
  readonly isEmpty: boolean
  readonly isSuccess: boolean
  readonly hasContent: boolean
  readonly setIdle: () => void
  readonly setLoading: (
    message?: string,
    detail?: string,
    config?: LoadingConfig
  ) => void
  readonly setError: (
    error: ErrorState | string,
    actions?: StateActionButton[]
  ) => void
  readonly setSuccess: (
    message?: string,
    detail?: string,
    actions?: StateActionButton[]
  ) => void
  readonly setContent: (children: React.ReactNode) => void
  readonly setEmpty: (message?: string) => void
  readonly reset: () => void
}

export interface StateRendererProps {
  readonly state: StateType
  readonly data?: StateData
  readonly children?: React.ReactNode
}

// UI Component Interfaces
export interface ButtonProps {
  readonly text?: React.ReactNode
  readonly icon?: string | boolean
  readonly iconPosition?: "left" | "right"
  readonly loading?: boolean
  readonly onClick?: () => void
  readonly tooltip?: string
  readonly tooltipDisabled?: boolean
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
  readonly tooltipEnterDelay?: number
  readonly tooltipEnterNextDelay?: number
  readonly tooltipLeaveDelay?: number
  readonly logging?: { enabled: boolean; prefix: string }
  readonly children?: React.ReactNode
  readonly block?: boolean
  readonly style?: React.CSSProperties
  readonly tabIndex?: number
  readonly title?: string
  readonly variant?: any
  readonly color?: any
  readonly size?: "sm" | "default" | "lg"
  readonly disabled?: boolean
  readonly className?: string
  readonly id?: string
  readonly type?: any
  // Allow any other jimu-ui Button props
  readonly [key: string]: any
}

export interface GroupButtonConfig {
  readonly text: React.ReactNode
  readonly onClick: () => void
  readonly variant?: any
  readonly color?: any
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly tooltip?: string
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
}

export interface ButtonGroupProps {
  readonly leftButton?: GroupButtonConfig
  readonly rightButton?: GroupButtonConfig
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly logging?: { enabled: boolean; prefix: string }
}

export interface SelectOption {
  readonly value: string | number
  readonly label: string
  readonly disabled?: boolean
  readonly icon?: string
  readonly hideLabel?: boolean
}

export interface SelectProps {
  readonly value?: string | number
  readonly defaultValue?: string | number
  readonly onChange?: (value: string | number) => void
  readonly options?: readonly SelectOption[]
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly ariaLabel?: string
  readonly ariaDescribedBy?: string
  readonly style?: React.CSSProperties
  readonly logging?: { enabled: boolean; prefix: string }
}

export interface InputProps {
  readonly value?: string
  readonly defaultValue?: string
  readonly onChange?: (value: string) => void
  readonly onFileChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  readonly required?: boolean
  readonly maxLength?: number
  readonly pattern?: RegExp
  readonly validationMessage?: string
  readonly type?: "text" | "password" | "email" | "tel" | "url" | "file"
  readonly logging?: { enabled: boolean; prefix: string }
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly id?: string
}

export interface TextAreaProps {
  readonly value?: string
  readonly defaultValue?: string
  readonly onChange?: (value: string) => void
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly rows?: number
  readonly logEvent?: boolean
  readonly logPrefix?: string
  readonly style?: React.CSSProperties
  readonly required?: boolean
  readonly id?: string
}

export interface DropdownItemConfig {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly hidden?: boolean
  readonly tooltip?: string
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
}

export interface DropdownProps {
  readonly items: readonly DropdownItemConfig[]
  readonly buttonIcon?: string
  readonly buttonText?: string
  readonly buttonTitle?: string
  readonly buttonVariant?: "primary" | "secondary" | "tertiary"
  readonly buttonSize?: "sm" | "default" | "lg"
  readonly openMode?: "click" | "hover"
  readonly "aria-label"?: string
  readonly "a11y-description"?: string
  readonly logging?: { enabled: boolean; prefix: string }
}

export interface CustomTooltipProps {
  readonly content?: React.ReactNode
  readonly children: React.ReactElement
  readonly showArrow?: boolean
  readonly placement?: "top" | "bottom" | "left" | "right"
  readonly enterDelay?: number
  readonly enterNextDelay?: number
  readonly enterTouchDelay?: number
  readonly leaveDelay?: number
  readonly disabled?: boolean
  readonly title?: React.ReactNode
  readonly id?: string
}

export interface FormProps {
  readonly variant?: "layout" | "field"
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly children?: React.ReactNode
  // Layout variant props
  readonly title?: string
  readonly subtitle?: string
  readonly onBack?: () => void
  readonly onSubmit?: () => void
  readonly isValid?: boolean
  readonly loading?: boolean
  // Field variant props
  readonly label?: string
  readonly helper?: string
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly error?: string
}

// UI Constants
export const UI_CONSTANTS = {
  DEFAULT_ICON_SIZE: 16,
  DEFAULT_LOADING_SIZE: 16,
  BUTTON_DEFAULTS: {
    BLOCK: true,
    ICON_POSITION: "left" as const,
    TOOLTIP_PLACEMENT: "top" as const,
  },
  SELECT_DEFAULTS: { PLACEHOLDER: "Välj ett alternativ" },
  DEFAULT_TOOLTIP_DELAYS: {
    ENTER: 1000,
    ENTER_NEXT: 500,
    LEAVE: 100,
    TOUCH: 500,
  },
} as const

export const TOOLTIP_DELAYS = {
  ENTER: 1000,
  NEXT: 500,
  LEAVE: 100,
  TOUCH: 500,
} as const

export const TOOLTIP_PLACEMENTS = {
  TOP: "top" as const,
  BOTTOM: "bottom" as const,
  LEFT: "left" as const,
  RIGHT: "right" as const,
} as const

export const TOOLTIP_STYLES = {
  showArrow: true,
  disabled: false,
} as const
export const enum DrawingTool {
  POLYGON = "polygon",
  RECTANGLE = "rectangle",
}

export const enum ViewMode {
  INITIAL = "initial",
  DRAWING = "drawing",
  WORKSPACE_SELECTION = "workspaceSelection",
  EXPORT_OPTIONS = "exportOptions",
  EXPORT_FORM = "exportForm",
  ORDER_RESULT = "orderResult",
}

export const enum ErrorSeverity {
  ERROR = "error",
  WARNING = "warning",
  INFO = "info",
}

export const enum ErrorType {
  VALIDATION = "ValidationError",
  NETWORK = "NetworkError",
  MODULE = "ModuleError",
  GEOMETRY = "GeometryError",
  API = "ApiError",
  CONFIG = "ConfigError",
}

export interface ErrorState {
  readonly message: string
  readonly code?: string
  readonly severity: ErrorSeverity
  readonly type: ErrorType
  readonly timestamp: Date
  readonly recoverable?: boolean
  readonly retry?: () => void
  readonly details?: { [key: string]: unknown }
}

// State Management
// Redux Action Types by domain: view, drawing, export, data, loading, error, UI
export enum FmeActionType {
  // View & Navigation Actions
  SET_VIEW_MODE = "FME_SET_VIEW_MODE",
  RESET_STATE = "FME_RESET_STATE",

  // Drawing & Geometry Actions
  SET_GEOMETRY = "FME_SET_GEOMETRY",
  SET_DRAWING_STATE = "FME_SET_DRAWING_STATE",
  SET_DRAWING_TOOL = "FME_SET_DRAWING_TOOL",
  SET_CLICK_COUNT = "FME_SET_CLICK_COUNT",
  SET_REAL_TIME_MEASUREMENTS = "FME_SET_REAL_TIME_MEASUREMENTS",

  // Export & Form Actions
  SET_FORM_VALUES = "FME_SET_FORM_VALUES",
  SET_ORDER_RESULT = "FME_SET_ORDER_RESULT",

  // Workspace & Parameter Actions
  SET_WORKSPACE_ITEMS = "FME_SET_WORKSPACE_ITEMS",
  SET_WORKSPACE_PARAMETERS = "FME_SET_WORKSPACE_PARAMETERS",
  SET_SELECTED_WORKSPACE = "FME_SET_SELECTED_WORKSPACE",
  SET_WORKSPACE_ITEM = "FME_SET_WORKSPACE_ITEM",

  // Loading & Error Actions
  SET_LOADING_FLAGS = "FME_SET_LOADING_FLAGS",
  SET_ERROR = "FME_SET_ERROR",
  SET_IMPORT_ERROR = "FME_SET_IMPORT_ERROR",
  SET_EXPORT_ERROR = "FME_SET_EXPORT_ERROR",

  // UI State Actions
  SET_UI_STATE = "FME_SET_UI_STATE",
  SET_UI_STATE_DATA = "FME_SET_UI_STATE_DATA",
}

// Base Redux action interface
interface BaseAction<T extends FmeActionType> {
  type: T
}

// View & Navigation Actions
export interface SetViewModeAction
  extends BaseAction<FmeActionType.SET_VIEW_MODE> {
  viewMode: ViewMode
}

export interface ResetStateAction
  extends BaseAction<FmeActionType.RESET_STATE> {}

// Drawing & Geometry Actions
export interface SetGeometryAction
  extends BaseAction<FmeActionType.SET_GEOMETRY> {
  // Use plain JSON for geometry.
  geometryJson: EsriGeometryJson | null
  drawnArea?: number
}

export interface SetDrawingStateAction
  extends BaseAction<FmeActionType.SET_DRAWING_STATE> {
  isDrawing: boolean
  clickCount?: number
  drawingTool?: DrawingTool
}

export interface SetDrawingToolAction
  extends BaseAction<FmeActionType.SET_DRAWING_TOOL> {
  drawingTool: DrawingTool
}

export interface SetClickCountAction
  extends BaseAction<FmeActionType.SET_CLICK_COUNT> {
  clickCount: number
}

export interface SetRealTimeMeasurementsAction
  extends BaseAction<FmeActionType.SET_REAL_TIME_MEASUREMENTS> {
  measurements: RealTimeMeasurements
}

// Export & Form Actions
export interface SetFormValuesAction
  extends BaseAction<FmeActionType.SET_FORM_VALUES> {
  formValues: { [key: string]: string | number | boolean | readonly string[] }
}

export interface SetOrderResultAction
  extends BaseAction<FmeActionType.SET_ORDER_RESULT> {
  orderResult: ExportResult | null
}

// Workspace & Parameter Actions
export interface SetWorkspaceItemsAction
  extends BaseAction<FmeActionType.SET_WORKSPACE_ITEMS> {
  workspaceItems: readonly WorkspaceItem[]
}

export interface SetWorkspaceParametersAction
  extends BaseAction<FmeActionType.SET_WORKSPACE_PARAMETERS> {
  workspaceParameters: readonly WorkspaceParameter[]
  workspaceName: string
}

export interface SetSelectedWorkspaceAction
  extends BaseAction<FmeActionType.SET_SELECTED_WORKSPACE> {
  workspaceName: string | null
}

export interface SetWorkspaceItemAction
  extends BaseAction<FmeActionType.SET_WORKSPACE_ITEM> {
  workspaceItem: any
}

// Data Source Actions
// Loading & Error Actions
export interface SetLoadingFlagsAction
  extends BaseAction<FmeActionType.SET_LOADING_FLAGS> {
  isModulesLoading?: boolean
  isSubmittingOrder?: boolean
}

export interface SetErrorAction extends BaseAction<FmeActionType.SET_ERROR> {
  error: ErrorState | null
}

export interface SetImportErrorAction
  extends BaseAction<FmeActionType.SET_IMPORT_ERROR> {
  error: ErrorState | null
}

export interface SetExportErrorAction
  extends BaseAction<FmeActionType.SET_EXPORT_ERROR> {
  error: ErrorState | null
}

// UI State Actions
export interface SetUiStateAction
  extends BaseAction<FmeActionType.SET_UI_STATE> {
  uiState: StateType
}

export interface SetUiStateDataAction
  extends BaseAction<FmeActionType.SET_UI_STATE_DATA> {
  data: StateData
}

// Grouped action union types
export type FmeViewActions = SetViewModeAction | ResetStateAction

export type FmeDrawingActions =
  | SetGeometryAction
  | SetDrawingStateAction
  | SetDrawingToolAction
  | SetClickCountAction
  | SetRealTimeMeasurementsAction

export type FmeExportActions = SetFormValuesAction | SetOrderResultAction

export type FmeWorkspaceActions =
  | SetWorkspaceItemsAction
  | SetWorkspaceParametersAction
  | SetSelectedWorkspaceAction
  | SetWorkspaceItemAction

export type FmeLoadingErrorActions =
  | SetLoadingFlagsAction
  | SetErrorAction
  | SetImportErrorAction
  | SetExportErrorAction

export type FmeUiActions = SetUiStateAction | SetUiStateDataAction

// Complete union of all FME actions
export type FmeActions =
  | FmeViewActions
  | FmeDrawingActions
  | FmeExportActions
  | FmeWorkspaceActions
  | FmeLoadingErrorActions
  | FmeUiActions

// Drawing and UI config constants
export const LAYER_CONFIG = {
  title: "Drawing Layer",
  listMode: "hide",
  elevationInfo: { mode: "on-the-ground" },
} as const

// API & Configuration
// FME Flow API config
export interface FmeFlowConfig {
  readonly serverUrl: string
  readonly token: string
  readonly repository: string
  readonly timeout?: number
}

export interface FmeExportConfig {
  readonly fmeServerUrl?: string
  readonly fmeServerToken?: string
  readonly repository?: string
  readonly api?: string
  readonly geometryServiceUrl?: string
  readonly maxArea?: number
  readonly requestTimeout?: number
  // Legacy support - deprecated
  readonly fme_server_url?: string
  readonly fmw_server_token?: string
  readonly geometryService?: string
}

export const enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
}

export interface RequestConfig {
  readonly method?: HttpMethod
  readonly headers?: { [key: string]: string }
  readonly body?: unknown
  readonly timeout?: number
  readonly signal?: AbortSignal
  readonly cacheHint?: boolean
  readonly responseType?: string
  readonly query?: { [key: string]: any }
}

// Standardized API response for FME Flow
export interface ApiResponse<T = unknown> {
  readonly data?: T
  readonly error?: FmeFlowError
  readonly status: number
  readonly statusText: string
}

// FME Flow error structure
export interface FmeFlowError {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly description?: string
  }
}

// Custom error class for FME Flow API
export class FmeFlowApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = "FmeFlowApiError"
  }
}

// FME Workspace & Job Management
// FME workspace metadata/config
export interface WorkspaceItem {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly type: "WORKSPACE" | "CUSTOM_FORMAT" | "CUSTOM_TRANSFORMER"
  readonly lastModified?: string
  readonly services?: readonly string[]
  readonly isRunnable?: boolean
  readonly category?: string
  readonly userName?: string
  // Additional fields from FME Flow API response
  readonly lastSaveDate?: string
  readonly lastPublishDate?: string
  readonly repositoryName?: string
  readonly fileCount?: number
  readonly totalFileSize?: number
  readonly totalRuns?: number
  readonly avgCpuTime?: number
  readonly avgCpuPct?: number
  readonly avgElapsedTime?: number
  readonly avgPeakMemUsage?: number
}

// Repository collection with pagination
export interface RepositoryItems {
  readonly items: readonly WorkspaceItem[]
  readonly totalCount: number
  readonly limit: number
  readonly offset: number
}

// FME workspace parameter types
export const enum ParameterType {
  TEXT = "TEXT",
  INTEGER = "INTEGER",
  FLOAT = "FLOAT",
  BOOLEAN = "BOOLEAN",
  CHOICE = "CHOICE",
  LISTBOX = "LISTBOX",
  FILENAME = "FILENAME",
  FILENAME_MUSTEXIST = "FILENAME_MUSTEXIST",
  FOLDER = "FOLDER",
  PASSWORD = "PASSWORD",
  COORDINATE_SYSTEM = "COORDINATE_SYSTEM",
  RANGE = "RANGE",
  LOOKUP_CHOICE = "LOOKUP_CHOICE",
  LOOKUP_LISTBOX = "LOOKUP_LISTBOX",
  STRING_OR_ATTR_LIST = "STRING_OR_ATTR_LIST",
  STRING_OR_CHOICE = "STRING_OR_CHOICE",
  ATTR_LIST = "ATTR_LIST",
  FEATURE_TYPE_LIST = "FEATURE_TYPE_LIST",
  GEOMETRY = "GEOMETRY",
  FILE_OR_URL = "FILE_OR_URL",
  TEXT_EDIT = "TEXT_EDIT",
}

// Parameter model types
export const enum ParameterModel {
  STRING = "string",
  LIST = "list",
  SCRIPTED = "scripted",
  LINKED = "linked",
  EMBEDDED = "embedded",
  PUBLISHED_PARAMETER = "published_parameter",
  PRIVATE_PARAMETER = "private_parameter",
}

// Choice option for list-based parameters
export interface ParameterChoice {
  readonly caption: string
  readonly value: string
  readonly displayName?: string
}

// FME workspace parameter definition
export interface WorkspaceParameter {
  readonly name: string
  readonly description: string
  readonly type: ParameterType
  readonly defaultValue?: string | number | boolean | readonly string[]
  readonly model: string // Changed from ParameterModel enum to string to match API response
  readonly optional?: boolean
  readonly listOptions?: readonly ParameterChoice[]
  readonly featuregrouping?: boolean
}

// Job submission request for FME Flow
export interface JobRequest {
  readonly publishedParameters?: ReadonlyArray<{
    name: string
    value: unknown
  }>
  readonly TMDirectives?: TMDirectives
  readonly NMDirectives?: NMDirectives
}

// Task Manager directives for job execution
export interface TMDirectives {
  readonly ttc?: number
  readonly ttl?: number
  readonly priority?: number
  readonly tag?: string
  readonly description?: string
}

// Notification Manager directives for job completion
export interface NMDirectives {
  readonly successTopics?: readonly string[]
  readonly failureTopics?: readonly string[]
}

export const enum JobStatus {
  ABORTED = "ABORTED",
  QUEUED = "QUEUED",
  PULLED = "PULLED",
  RUNNING = "RUNNING",
  SUCCESS = "SUCCESS",
  FME_FAILURE = "FME_FAILURE",
  JOB_FAILURE = "JOB_FAILURE",
}

export interface JobResponse {
  readonly id: number
  readonly status: JobStatus
  readonly result?: JobResult
  readonly timeRequested: string
  readonly timeStarted?: string
  readonly timeFinished?: string
  readonly priority: number
  readonly description?: string
  readonly userName: string
  readonly engine?: string
}

export interface JobResult {
  readonly id: number
  readonly status: JobStatus
  readonly statusMessage: string
  readonly timeRequested: string
  readonly timeStarted?: string
  readonly timeFinished?: string
  readonly numFeaturesOutput: number
  readonly priority: number
  readonly logFileUrl?: string
  readonly outputFileUrls?: readonly string[]
}

// Geometry & Spatial Data
export interface Polygon {
  readonly type: "Polygon"
  readonly coordinates: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
}

export interface UploadWorkspaceParams {
  readonly filename: string
  readonly files: ReadonlyArray<{ readonly path: string }>
  readonly service?: string
  readonly params?: string
}

// ArcGIS JS API module collection
export interface EsriModules {
  // Core geometry and drawing modules
  readonly SketchViewModel: typeof __esri.SketchViewModel
  readonly GraphicsLayer: typeof __esri.GraphicsLayer
  readonly Graphic: typeof __esri.Graphic
  readonly Polygon: typeof __esri.Polygon
  readonly Polyline: typeof __esri.Polyline
  readonly Point: typeof __esri.Point
  readonly Extent: typeof __esri.Extent
  readonly SpatialReference: typeof __esri.SpatialReference
  readonly TextSymbol: typeof __esri.TextSymbol
  readonly SimpleMarkerSymbol: typeof __esri.SimpleMarkerSymbol
  readonly SimpleLineSymbol: typeof __esri.SimpleLineSymbol
  readonly PictureMarkerSymbol: typeof __esri.PictureMarkerSymbol

  // Measurement widgets (ArcGIS 4.29 compatible - both since 4.10)
  readonly AreaMeasurement2D: typeof __esri.AreaMeasurement2D
  readonly DistanceMeasurement2D: typeof __esri.DistanceMeasurement2D

  // ArcGIS 4.29-compatible GeometryEngine (legacy methods available in 4.29)
  readonly geometryEngine: typeof __esri.geometryEngine
}

// Result from FME export job submission
export interface ExportResult {
  readonly success: boolean
  readonly jobId?: number
  readonly email?: string
  readonly workspaceName?: string
  readonly message?: string
  readonly jobStatus?: string
  readonly code?: string
  readonly downloadUrl?: string
}

// Real-time measurement data during drawing
export interface RealTimeMeasurements {
  readonly distance?: number
  readonly currentLineDistance?: number
  readonly area?: number
  readonly centroid?: { readonly x: number; readonly y: number }
  readonly drawingProgress?: {
    readonly pointsAdded: number
    readonly isClosingPolygon: boolean
    readonly canCompletePolygon: boolean
    readonly totalPerimeter?: number
  }
}

// Result from geometry validation operations
export interface GeometryValidationResult {
  readonly isValid: boolean
  readonly area: number
  readonly error?: ErrorState
  readonly centroid?: __esri.Point
  readonly spatialReference?: __esri.SpatialReference
  readonly extent?: __esri.Extent
}

// Minimal Esri JSON geometry structure (polygon focused, extend as needed)
export interface EsriGeometryJson {
  readonly type?: string
  readonly rings?: number[][][]
  readonly paths?: number[][][]
  readonly x?: number
  readonly y?: number
  readonly spatialReference?: {
    readonly wkid?: number
    readonly latestWkid?: number
  }
  // Allow additional properties without being overly permissive
  readonly [key: string]: any
}

// Widget State Management
// View and navigation state
export interface FmeViewState {
  readonly viewMode: ViewMode
  readonly previousViewMode: ViewMode | null
}

// Drawing and geometry state
export interface FmeDrawingState {
  readonly isDrawing: boolean
  readonly drawingTool: DrawingTool
  readonly clickCount: number
  // Plain JSON geometry representation; avoid storing ArcGIS API objects in Redux.
  readonly geometryJson: EsriGeometryJson | null
  readonly drawnArea: number
  readonly realTimeMeasurements: RealTimeMeasurements
}

// Export workflow and form data state
export interface FmeExportState {
  readonly formValues: {
    [key: string]: string | number | boolean | readonly string[]
  }
  readonly orderResult: ExportResult | null
}

// Workspace and parameter management state
export interface FmeWorkspaceState {
  readonly workspaceItems: readonly WorkspaceItem[]
  readonly selectedWorkspace: string | null
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceItem: any // Full workspace item from server
  readonly isLoadingWorkspaces: boolean
  readonly isLoadingParameters: boolean
}

// Loading states for async operations
export interface FmeLoadingState {
  readonly isModulesLoading: boolean
  readonly isSubmittingOrder: boolean
}

// Error state management
export interface FmeErrorState {
  readonly error: ErrorState | null
  readonly importError: ErrorState | null
  readonly exportError: ErrorState | null
}

// Generic UI state management
export interface FmeUiState {
  readonly uiState: StateType
  readonly uiStateData: StateData
}

// Complete widget state composed from focused sub-states
export interface FmeWidgetState
  extends FmeViewState,
    FmeDrawingState,
    FmeExportState,
    FmeWorkspaceState,
    FmeLoadingState,
    FmeErrorState,
    FmeUiState {}

export interface IMStateWithFmeExport extends IMState {
  fmeExport: ImmutableObject<FmeWidgetState>
}

// Content Components - broken down into focused interfaces
// Base content properties that all content views need
export interface ContentBaseProps {
  readonly widgetId?: string
  readonly state: ViewMode
  readonly instructionText: string
  readonly error?: ErrorState | null
  readonly onBack?: () => void
}

// Drawing-related content properties
export interface ContentDrawingProps {
  readonly canStartDrawing: boolean
  readonly onAngeUtbredning: () => void
  readonly drawnArea?: number | null
  readonly formatArea?: (area: number) => string
  readonly drawingMode?: DrawingTool
  readonly onDrawingModeChange?: (mode: DrawingTool) => void
  readonly realTimeMeasurements?: RealTimeMeasurements
  readonly formatRealTimeMeasurements?: (
    measurements: RealTimeMeasurements
  ) => React.ReactNode
}

// Export-related content properties
export interface ContentExportProps {
  readonly onFormBack?: () => void
  readonly onFormSubmit?: (data: unknown) => void
  readonly orderResult?: ExportResult | null
  readonly onReuseGeography?: () => void
  readonly isSubmittingOrder?: boolean
}

// Header-related content properties
export interface ContentHeaderProps {
  readonly showHeaderActions?: boolean
  readonly onReset?: () => void
  readonly canReset?: boolean
}

// Loading-related content properties
export interface ContentLoadingProps {
  readonly isModulesLoading: boolean
}

// Complete content props interface using composition
export interface ContentProps
  extends ContentBaseProps,
    Partial<ContentDrawingProps>,
    Partial<ContentExportProps>,
    Partial<ContentHeaderProps>,
    Partial<ContentWorkspaceProps>,
    ContentLoadingProps {}

// Workspace-related content properties
export interface ContentWorkspaceProps {
  readonly config: FmeExportConfig
  readonly onWorkspaceSelected?: (
    workspaceName: string,
    parameters: readonly WorkspaceParameter[],
    workspaceItem: any
  ) => void
  readonly onWorkspaceBack?: () => void
  readonly selectedWorkspace?: string | null
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceItem?: any // Full workspace item from server
}

// Widget-specific types
export interface NotificationState {
  readonly severity: "success" | "error" | "warning" | "info"
  readonly message: string
}

// Widget Constants & Symbols - Simplified
export const HIGHLIGHT_SYMBOL = {
  type: "simple-fill" as const,
  color: [255, 165, 0, 0.2] as [number, number, number, number],
  outline: {
    color: [255, 140, 0] as [number, number, number],
    width: 2,
    style: "solid" as const,
  },
}

// Navigation routing table for view transitions
export const VIEW_ROUTES: { [key in ViewMode]: ViewMode } = {
  [ViewMode.EXPORT_FORM]: ViewMode.WORKSPACE_SELECTION,
  [ViewMode.WORKSPACE_SELECTION]: ViewMode.INITIAL,
  [ViewMode.EXPORT_OPTIONS]: ViewMode.INITIAL,
  [ViewMode.ORDER_RESULT]: ViewMode.INITIAL,
  [ViewMode.DRAWING]: ViewMode.INITIAL,
  [ViewMode.INITIAL]: ViewMode.INITIAL,
}
