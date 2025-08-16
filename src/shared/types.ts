import type { IMState, ImmutableObject } from "jimu-core"

// UI View State Types
export interface ViewAction {
  readonly label: string
  readonly onClick: () => void
  readonly variant?: "primary" | "default" | "danger"
  readonly disabled?: boolean
}
export interface LoadingView {
  readonly kind: "loading"
  readonly message?: string
  readonly detail?: string
}
export interface ErrorView {
  readonly kind: "error"
  readonly message: string
  readonly code?: string
  readonly recoverable?: boolean
  readonly actions?: readonly ViewAction[]
}
export interface EmptyView {
  readonly kind: "empty"
  readonly message: string
  readonly actions?: readonly ViewAction[]
}
export interface SuccessView {
  readonly kind: "success"
  readonly title?: string
  readonly message?: string
  readonly actions?: readonly ViewAction[]
}
export interface ContentView {
  readonly kind: "content"
  readonly node: React.ReactNode
}
export type ViewState =
  | LoadingView
  | ErrorView
  | EmptyView
  | SuccessView
  | ContentView
// Utility functions to create UI states
export const makeLoadingView = (
  message?: string,
  detail?: string
): LoadingView => ({ kind: "loading", message, detail })
export const makeErrorView = (
  message: string,
  opts: Omit<ErrorView, "kind" | "message"> = {}
): ErrorView => ({ kind: "error", message, ...opts })
export const makeEmptyView = (
  message: string,
  actions?: readonly ViewAction[]
): EmptyView => ({ kind: "empty", message, actions })

// UI Component Interfaces
export interface ButtonProps {
  readonly text?: React.ReactNode
  readonly icon?: string | React.ReactNode
  readonly iconPosition?: "left" | "right"
  readonly alignText?: "start" | "center" | "end"
  readonly loading?: boolean
  readonly onClick?: () => void
  readonly tooltip?: string
  readonly tooltipDisabled?: boolean
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
  readonly tooltipEnterDelay?: number
  readonly tooltipEnterNextDelay?: number
  readonly tooltipLeaveDelay?: number
  readonly logging?: { enabled: boolean; prefix: string }
  readonly preset?: "primary" | "secondary" | "danger" | "link"
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

export interface OptionItem {
  readonly value: string | number
  readonly label: string
  readonly disabled?: boolean
  readonly icon?: string
  readonly hideLabel?: boolean
}

export interface SelectProps {
  readonly value?: string | number | ReadonlyArray<string | number>
  readonly defaultValue?: string | number | ReadonlyArray<string | number>
  readonly onChange?: (
    value: string | number | ReadonlyArray<string | number>
  ) => void
  readonly options?: readonly OptionItem[]
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly ariaLabel?: string
  readonly ariaDescribedBy?: string
  readonly style?: React.CSSProperties
  readonly coerce?: "number" | "string"
}

// Tabs
export interface TabItem {
  readonly value: string | number
  readonly label: string
  readonly icon?: string
  readonly disabled?: boolean
  readonly tooltip?: string
  readonly hideLabel?: boolean
}

// ButtonTabs component props
export interface ButtonTabsProps {
  readonly items: readonly TabItem[]
  readonly value?: string | number
  readonly defaultValue?: string | number
  readonly onChange?: (value: string | number) => void
  readonly onTabChange?: (
    value: string | number,
    previous: string | number | undefined
  ) => void
  readonly ariaLabel?: string
  readonly style?: React.CSSProperties
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
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly id?: string
  readonly errorText?: string
  readonly inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
}

export interface TextAreaProps {
  readonly value?: string
  readonly defaultValue?: string
  readonly onChange?: (value: string) => void
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly rows?: number
  readonly style?: React.CSSProperties
  readonly required?: boolean
  readonly id?: string
  readonly errorText?: string
}

// Dropdown types removed (single header action now directly rendered)

export interface TooltipProps {
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

export interface FieldProps {
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly label?: string
  readonly helper?: string
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly error?: string
  readonly children?: React.ReactNode
}

export interface BtnContentProps {
  readonly loading: boolean
  readonly children?: React.ReactNode
  readonly text?: React.ReactNode
  readonly icon?: string | React.ReactNode
  readonly iconPosition: "left" | "right"
  readonly alignText: "start" | "center" | "end"
}

// UI Icon component props
export interface IconProps {
  readonly src: string
  readonly size?: number | "s" | "m" | "l"
  readonly className?: string
  readonly ariaLabel?: string
  readonly style?: React.CSSProperties
}

// App message props for Message component
export interface MessageProps {
  readonly message: string
  readonly severity?: "info" | "warning" | "error" | "success"
  readonly autoHideDuration?: number | null
  readonly withIcon?: boolean
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly onClose?: () => void
  readonly open?: boolean
  readonly role?: "alert" | "status"
  readonly ariaLive?: "assertive" | "polite" | "off"
}

// Parameter primitives and values used by dynamic forms
export type ParameterPrimitive =
  | string
  | number
  | boolean
  | readonly string[]
  | null
  | File

export type ParameterValue =
  | ParameterPrimitive
  | ParameterPrimitive[]
  | undefined

// Primitive value used by dynamic forms (supports file upload)
export type FormPrimitive =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number>
  | File
  | null

// Generic key-value map for form values
export interface FormValues {
  [key: string]: FormPrimitive
}

// Primitive parameters used in job requests
export interface PrimitiveParams {
  [key: string]: unknown
}

// Loading flags for async operations
export interface LoadingFlags {
  isModulesLoading?: boolean
  isSubmittingOrder?: boolean
}

// Select component aggregate value
export type SelectValue = string | number | ReadonlyArray<string | number>

// Form field types (for dynamic form rendering)
export enum FormFieldType {
  TEXT = "text",
  NUMBER = "number",
  SELECT = "select",
  MULTI_SELECT = "multiselect",
  CHECKBOX = "checkbox",
  TEXTAREA = "textarea",
  PASSWORD = "password",
  FILE = "file",
}

// Dynamic field configuration used to render workspace parameters
export interface DynamicFieldConfig {
  readonly name: string
  readonly label: string
  readonly type: FormFieldType
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly placeholder?: string
  readonly helpText?: string
  readonly options?: ReadonlyArray<{ label: string; value: string | number }>
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly rows?: number
  readonly maxLength?: number
  readonly description?: string
  readonly defaultValue?: ParameterValue
}

// Props for DynamicField component (type-only dependency on services.ts)
export interface DynamicFieldProps {
  readonly field: DynamicFieldConfig
  readonly value: FormPrimitive | undefined
  readonly onChange: (value: FormPrimitive) => void
  readonly translate: (k: string, p?: any) => string
}

// Props for OrderResult component
export interface OrderResultProps {
  readonly orderResult: ExportResult
  readonly translate: (k: string) => string
  readonly onReuseGeography?: () => void
  readonly onBack?: () => void
}

// Props for ExportForm component
export interface ExportFormProps {
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceName: string
  readonly workspaceItem?: WorkspaceItemDetail
  readonly onBack: () => void
  readonly onSubmit: (data: { type: string; data: FormValues }) => void
  readonly isSubmitting: boolean
  readonly translate: (k: string, p?: any) => string
}

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
  readonly userFriendlyMessage?: string
  readonly suggestion?: string
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
  workspaceItem: WorkspaceItemDetail | null
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

// Grouped action union types
export type FmeViewActions = SetViewModeAction | ResetStateAction

export type FmeDrawingActions =
  | SetGeometryAction
  | SetDrawingStateAction
  | SetDrawingToolAction
  | SetClickCountAction

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

// Complete union of all FME actions (ui state removed for simplicity)
export type FmeActions =
  | FmeViewActions
  | FmeDrawingActions
  | FmeExportActions
  | FmeWorkspaceActions
  | FmeLoadingErrorActions

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

// FME Flow service response structure
export interface FmeStatusInfo {
  readonly status?: string
  readonly message?: string
}
export interface FmeServiceInfo {
  readonly statusInfo?: FmeStatusInfo
  readonly status?: string
  readonly jobID?: string | number
  readonly id?: string | number
  readonly url?: string
  readonly message?: string
}
export interface FmeResponse {
  readonly data?:
    | ({ readonly serviceResponse?: FmeServiceInfo } & FmeServiceInfo)
    | undefined
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
// Detailed workspace item (single workspace fetch) including parameters & optional metadata
export interface WorkspaceItemDetail extends WorkspaceItem {
  readonly parameters?: readonly WorkspaceParameter[]
  readonly tags?: readonly string[]
  readonly size?: number
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


// ArcGIS JS API module collection
export interface EsriModules {
  readonly SketchViewModel: typeof __esri.SketchViewModel
  readonly GraphicsLayer: typeof __esri.GraphicsLayer
  readonly Graphic: typeof __esri.Graphic
  readonly Polygon: typeof __esri.Polygon
  readonly Extent: typeof __esri.Extent
  readonly AreaMeasurement2D: typeof __esri.AreaMeasurement2D
  readonly DistanceMeasurement2D: typeof __esri.DistanceMeasurement2D
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
  readonly workspaceItem: WorkspaceItemDetail | null // Full workspace item from server
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

// Complete widget state composed from focused sub-states
export interface FmeWidgetState
  extends FmeViewState,
    FmeDrawingState,
    FmeExportState,
    FmeWorkspaceState,
    FmeLoadingState,
    FmeErrorState {}

export interface IMStateWithFmeExport extends IMState {
  fmeExport: ImmutableObject<FmeWidgetState>
}

// Optimized workflow props interfaces with better composition
interface WorkflowCoreProps {
  readonly widgetId?: string
  readonly state: ViewMode
  readonly instructionText: string
  readonly error?: ErrorState | null
  readonly onBack?: () => void
  readonly isModulesLoading: boolean
}

interface WorkflowDrawingFeatures {
  readonly canStartDrawing: boolean
  readonly onAngeUtbredning: () => void
  readonly drawnArea?: number | null
  readonly formatArea?: (area: number) => string
  readonly drawingMode?: DrawingTool
  readonly onDrawingModeChange?: (mode: DrawingTool) => void
}

interface WorkflowExportFeatures {
  readonly onFormBack?: () => void
  readonly onFormSubmit?: (data: unknown) => void
  readonly orderResult?: ExportResult | null
  readonly onReuseGeography?: () => void
  readonly isSubmittingOrder?: boolean
}

interface WorkflowHeaderFeatures {
  readonly showHeaderActions?: boolean
  readonly onReset?: () => void
  readonly canReset?: boolean
}

interface WorkflowWorkspaceFeatures {
  readonly config: FmeExportConfig
  readonly onWorkspaceSelected?: (
    workspaceName: string,
    parameters: readonly WorkspaceParameter[],
    workspaceItem: WorkspaceItemDetail
  ) => void
  readonly onWorkspaceBack?: () => void
  readonly selectedWorkspace?: string | null
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceItem?: WorkspaceItemDetail | null
}

// Main workflow props interface with selective feature composition
export interface WorkflowProps
  extends WorkflowCoreProps,
    Partial<WorkflowDrawingFeatures>,
    Partial<WorkflowExportFeatures>,
    Partial<WorkflowHeaderFeatures>,
    Partial<WorkflowWorkspaceFeatures> {}

// Widget-specific types
export interface NotificationState {
  readonly severity: "success" | "error" | "warning" | "info"
  readonly message: string
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
