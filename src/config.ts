import type { IMState, ImmutableObject } from "jimu-core"

export const enum ViewMode {
  STARTUP_VALIDATION = "startup-validation",
  INITIAL = "initial",
  DRAWING = "drawing",
  WORKSPACE_SELECTION = "workspace-selection",
  EXPORT_FORM = "export-form",
  EXPORT_OPTIONS = "export-options",
  ORDER_RESULT = "order-result",
}

export const enum DrawingTool {
  POLYGON = "polygon",
  RECTANGLE = "rectangle",
}

export const enum FormFieldType {
  TEXT = "text",
  NUMBER = "number",
  TEXTAREA = "textarea",
  SELECT = "select",
  MULTI_SELECT = "multi-select",
  CHECKBOX = "checkbox",
  PASSWORD = "password",
  FILE = "file",
  DATE_TIME = "date-time",
  URL = "url",
  SWITCH = "switch",
  RADIO = "radio",
  SLIDER = "slider",
  NUMERIC_INPUT = "numeric-input",
  TAG_INPUT = "tag-input",
  COLOR = "color",
  DATE = "date",
  TIME = "time",
  EMAIL = "email",
  PHONE = "phone",
  SEARCH = "search",
  MESSAGE = "message",
  TABLE = "table",
  MONTH = "month",
  WEEK = "week",
  HIDDEN = "hidden",
}

export const enum ErrorSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
}

export const enum ErrorType {
  VALIDATION = "validation",
  CONFIG = "config",
  NETWORK = "network",
  MODULE = "module",
  GEOMETRY = "geometry",
}

export const enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
}

export const enum ParameterType {
  TEXT = "TEXT",
  INTEGER = "INTEGER",
  FLOAT = "FLOAT",
  BOOLEAN = "BOOLEAN",
  CHECKBOX = "CHECKBOX",
  CHOICE = "CHOICE",
  LISTBOX = "LISTBOX",
  LOOKUP_LISTBOX = "LOOKUP_LISTBOX",
  LOOKUP_CHOICE = "LOOKUP_CHOICE",
  TEXT_OR_FILE = "TEXT_OR_FILE",
  TEXT_EDIT = "TEXT_EDIT",
  PASSWORD = "PASSWORD",
  FILENAME = "FILENAME",
  FILENAME_MUSTEXIST = "FILENAME_MUSTEXIST",
  DIRNAME = "DIRNAME",
  DIRNAME_MUSTEXIST = "DIRNAME_MUSTEXIST",
  DIRNAME_SRC = "DIRNAME_SRC",
  COORDSYS = "COORDSYS",
  STRING = "STRING",
  URL = "URL",
  LOOKUP_URL = "LOOKUP_URL",
  LOOKUP_FILE = "LOOKUP_FILE",
  DATE_TIME = "DATE_TIME",
  DATETIME = "DATETIME",
  DATE = "DATE",
  TIME = "TIME",
  COLOR = "COLOR",
  COLOR_PICK = "COLOR_PICK",
  RANGE_SLIDER = "RANGE_SLIDER",
  GEOMETRY = "GEOMETRY",
  MESSAGE = "MESSAGE",
  ATTRIBUTE_NAME = "ATTRIBUTE_NAME",
  ATTRIBUTE_LIST = "ATTRIBUTE_LIST",
  DB_CONNECTION = "DB_CONNECTION",
  WEB_CONNECTION = "WEB_CONNECTION",
  REPROJECTION_FILE = "REPROJECTION_FILE",
  SCRIPTED = "SCRIPTED",
  NOVALUE = "NOVALUE",
}

export const enum JobStatus {
  QUEUED = "QUEUED",
  PULLED = "PULLED",
  RUNNING = "RUNNING",
  SUCCESS = "SUCCESS",
  FME_FAILURE = "FME_FAILURE",
  JOB_FAILURE = "JOB_FAILURE",
  ABORTED = "ABORTED",
}

export enum FmeActionType {
  SET_VIEW_MODE = "fme/SET_VIEW_MODE",
  RESET_STATE = "fme/RESET_STATE",
  SET_STARTUP_VALIDATION_STATE = "fme/SET_STARTUP_VALIDATION_STATE",
  SET_GEOMETRY = "fme/SET_GEOMETRY",
  SET_DRAWING_STATE = "fme/SET_DRAWING_STATE",
  SET_DRAWING_TOOL = "fme/SET_DRAWING_TOOL",
  SET_CLICK_COUNT = "fme/SET_CLICK_COUNT",
  SET_FORM_VALUES = "fme/SET_FORM_VALUES",
  SET_ORDER_RESULT = "fme/SET_ORDER_RESULT",
  SET_WORKSPACE_ITEMS = "fme/SET_WORKSPACE_ITEMS",
  SET_WORKSPACE_PARAMETERS = "fme/SET_WORKSPACE_PARAMETERS",
  SET_SELECTED_WORKSPACE = "fme/SET_SELECTED_WORKSPACE",
  SET_WORKSPACE_ITEM = "fme/SET_WORKSPACE_ITEM",
  SET_LOADING_FLAGS = "fme/SET_LOADING_FLAGS",
  SET_ERROR = "fme/SET_ERROR",
  SET_IMPORT_ERROR = "fme/SET_IMPORT_ERROR",
  SET_EXPORT_ERROR = "fme/SET_EXPORT_ERROR",
  CLEAR_WORKSPACE_STATE = "fme/CLEAR_WORKSPACE_STATE",
}

export const LAYER_CONFIG = {
  title: "",
  listMode: "hide",
  elevationInfo: { mode: "on-the-ground" },
} as const

export const VIEW_ROUTES: { [key in ViewMode]: ViewMode } = {
  [ViewMode.STARTUP_VALIDATION]: ViewMode.STARTUP_VALIDATION,
  [ViewMode.EXPORT_FORM]: ViewMode.WORKSPACE_SELECTION,
  [ViewMode.WORKSPACE_SELECTION]: ViewMode.INITIAL,
  [ViewMode.EXPORT_OPTIONS]: ViewMode.INITIAL,
  [ViewMode.ORDER_RESULT]: ViewMode.INITIAL,
  [ViewMode.DRAWING]: ViewMode.INITIAL,
  [ViewMode.INITIAL]: ViewMode.INITIAL,
}

// Base types and interfaces
export type FormValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number>
  | readonly string[]
  | File
  | null
  | undefined
export type FormPrimitive = Exclude<FormValue, undefined>
export type SelectValue = string | number | ReadonlyArray<string | number>

export interface FormValues {
  [key: string]: FormValue
}

export interface PrimitiveParams {
  [key: string]: unknown
}
export interface ViewAction {
  readonly label: string
  readonly onClick: () => void
  readonly variant?: "contained" | "outlined" | "text"
  readonly disabled?: boolean
}

export type ViewState =
  | {
      readonly kind: "loading"
      readonly message?: string
      readonly detail?: string
    }
  | {
      readonly kind: "error"
      readonly message: string
      readonly code?: string
      readonly recoverable?: boolean
      readonly actions?: readonly ViewAction[]
    }
  | {
      readonly kind: "empty"
      readonly message: string
      readonly actions?: readonly ViewAction[]
    }
  | {
      readonly kind: "success"
      readonly title?: string
      readonly message?: string
      readonly actions?: readonly ViewAction[]
    }
  | { readonly kind: "content"; readonly node: React.ReactNode }

export const makeLoadingView = (
  message?: string,
  detail?: string
): ViewState => ({ kind: "loading", message, detail })

export const makeEmptyView = (
  message: string,
  actions?: readonly ViewAction[]
): ViewState => ({ kind: "empty", message, actions })

export const makeErrorView = (
  message: string,
  opts?: {
    code?: string
    actions?: readonly ViewAction[]
    recoverable?: boolean
  }
): ViewState => ({
  kind: "error",
  message,
  code: opts?.code,
  actions: opts?.actions,
  recoverable: opts?.recoverable,
})

// Error handling
export interface ErrorState {
  readonly message: string
  readonly type: ErrorType
  readonly code: string
  readonly severity: ErrorSeverity
  readonly details?: { [key: string]: unknown }
  readonly recoverable: boolean
  readonly retry?: () => void
  readonly timestamp: Date
  readonly timestampMs: number
  readonly userFriendlyMessage?: string
  readonly suggestion?: string
}

export type SerializableErrorState = Omit<ErrorState, "timestamp" | "retry"> & {
  readonly timestampMs: number
}

// UI component interfaces
export interface BaseProps {
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly onClick?: () => void
}

export interface InputProps extends BaseProps {
  readonly value?: unknown
  readonly onChange?: (value: unknown) => void
  readonly onBlur?: (value: unknown) => void
  readonly placeholder?: string
  readonly readOnly?: boolean
  readonly required?: boolean
  readonly step?: number | string
  readonly type?:
    | "text"
    | "password"
    | "number"
    | "file"
    | "email"
    | "date"
    | "datetime-local"
    | "month"
    | "week"
    | "time"
    | "search"
    | "tel"
  readonly maxLength?: number
  readonly borderless?: boolean
  readonly onFileChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  readonly "aria-label"?: string
  readonly defaultValue?: FormPrimitive
  readonly errorText?: string
  readonly id?: string
  readonly rows?: number // for textarea
}

export interface ButtonProps extends BaseProps {
  readonly text?: React.ReactNode
  readonly icon?: string | React.ReactNode
  readonly iconPosition?: "left" | "right"
  readonly variant?: "contained" | "outlined" | "text"
  readonly size?: "sm" | "lg" | "default"
  readonly tooltip?: string
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
  readonly alignText?: string
  readonly tooltipDisabled?: boolean
  readonly children?: React.ReactNode
  readonly block?: boolean
  readonly color?: string
  readonly htmlType?: "submit" | "button" | "reset"
  readonly title?: string
  readonly tabIndex?: number
  readonly active?: boolean
  readonly role?: string
  readonly logging?: { enabled: boolean; prefix: string }
}

export interface OptionItem {
  readonly label: string
  readonly value: string | number
  readonly disabled?: boolean
  readonly hideLabel?: boolean
}

export interface SelectProps extends BaseProps {
  readonly value?: unknown
  readonly onChange?: (value: unknown) => void
  readonly placeholder?: string
  readonly readOnly?: boolean
  readonly required?: boolean
  readonly options?: readonly OptionItem[]
  readonly coerce?: "number" | "string"
  readonly "aria-label"?: string
  readonly defaultValue?: SelectValue
}

export interface TabItem {
  readonly value: unknown
  readonly label: string
  readonly icon?: string
  readonly tooltip?: string
  readonly hideLabel?: boolean
  readonly disabled?: boolean
}

export interface ButtonTabsProps extends BaseProps {
  readonly items: readonly TabItem[]
  readonly value?: unknown
  readonly onChange?: (value: unknown) => void
  readonly ariaLabel?: string
  readonly defaultValue?: unknown
  readonly onTabChange?: (value: unknown) => void
}

export interface TooltipProps {
  readonly content?: React.ReactNode
  readonly title?: React.ReactNode
  readonly children: React.ReactNode
  readonly placement?: "top" | "bottom" | "left" | "right"
  readonly disabled?: boolean
  readonly showArrow?: boolean
  readonly id?: string
}

// Additional UI component types needed by components
export type GroupButtonConfig = Omit<ButtonProps, "block">

export interface ButtonGroupProps extends BaseProps {
  readonly buttons?: readonly GroupButtonConfig[]
  readonly activeIndex?: number
  readonly onChange?: (index: number) => void
  readonly leftButton?: GroupButtonConfig
  readonly rightButton?: GroupButtonConfig
}

export interface TextAreaProps extends BaseProps {
  readonly value?: string
  readonly onChange?: (value: string) => void
  readonly placeholder?: string
  readonly rows?: number
  readonly defaultValue?: string
  readonly errorText?: string
  readonly required?: boolean
  readonly id?: string
}

export interface BtnContentProps {
  readonly icon?: string | React.ReactNode
  readonly text?: string | React.ReactNode
  readonly loading?: boolean
  readonly children?: React.ReactNode
  readonly iconPosition?: "left" | "right"
  readonly alignText?: string
}

export interface IconProps extends BaseProps {
  readonly icon?: string
  readonly src?: string
  readonly size?: number
  readonly ariaLabel?: string
}

// Setting panel types
export interface ConnectionSettings {
  readonly serverUrl: string
  readonly token: string
  readonly repository: string
  readonly timeout?: number
}

export interface TestState {
  readonly status: "idle" | "running" | "success" | "error"
  readonly message?: string
  readonly isTesting?: boolean
  readonly type?: "error" | "success" | "info" | "warning"
}

export interface FieldErrors {
  [key: string]: string | undefined
}

export interface StepStatus {
  readonly completed: boolean
  readonly error?: string
}

export interface CheckSteps {
  [key: string]: StepStatus | string
}

export interface SanitizationResult {
  readonly isValid: boolean
  readonly cleaned: string
  readonly errors: string[]
  readonly changed?: boolean
}

// Workflow component types
export interface OrderResultProps {
  readonly result?: ExportResult
  readonly onDownload?: () => void
  readonly onClose?: () => void
  readonly orderResult?: ExportResult
  readonly translate?: TranslateFn
  readonly onReuseGeography?: () => void
  readonly onBack?: () => void
  readonly config?: FmeExportConfig
}

export interface ExportFormProps {
  readonly parameters?: WorkspaceParameter[]
  readonly values?: FormValues
  readonly onChange?: (values: FormValues) => void
  readonly onSubmit?: (payload: { type: string; data: FormValues }) => void
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceName?: string
  readonly workspaceItem?: WorkspaceItemDetail
  readonly onBack?: () => void
  readonly isSubmitting?: boolean
  readonly translate?: TranslateFn
  readonly config?: FmeExportConfig
}

export interface FormProps extends BaseProps {
  readonly title?: string
  readonly subtitle?: string
  readonly onSubmit?: () => void
  readonly onBack?: () => void
  readonly isValid?: boolean
  readonly variant?: "layout" | "inline" | "field"
  readonly children?: React.ReactNode
  readonly label?: string
  readonly helper?: string
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly error?: string
}

export interface FieldProps extends BaseProps {
  readonly label?: string
  readonly required?: boolean
  readonly error?: string
  readonly children?: React.ReactNode
  readonly helper?: string
  readonly readOnly?: boolean
}

export interface StateViewProps extends BaseProps {
  readonly state: ViewState
  readonly center?: boolean
  readonly renderActions?: (
    actions?: readonly ViewAction[],
    ariaLabel?: string
  ) => React.ReactNode
  readonly testId?: string
}

// Form and validation
export interface DynamicFieldConfig {
  readonly name: string
  readonly label: string
  readonly type: FormFieldType
  readonly required: boolean
  readonly readOnly: boolean
  readonly description?: string
  readonly defaultValue?: FormPrimitive
  readonly placeholder?: string
  readonly options?: readonly OptionItem[]
  readonly rows?: number
  readonly maxLength?: number
  readonly min?: number
  readonly max?: number
  readonly step?: number
}

export interface DynamicFieldProps {
  readonly field: DynamicFieldConfig
  readonly value?: FormPrimitive
  readonly onChange: (value: FormPrimitive) => void
  readonly translate: TranslateFn
}

export interface LoadingFlags {
  readonly [key: string]: boolean
}
// API and configuration
export interface FmeFlowConfig {
  readonly serverUrl: string
  readonly token: string
  readonly repository: string
  readonly timeout?: number
}

export interface FmeExportConfig {
  readonly fmeServerUrl: string
  readonly fmeServerToken: string
  readonly repository: string
  readonly workspace?: string
  readonly maxArea?: number
  readonly requestTimeout?: number
  readonly syncMode?: boolean
  readonly maskEmailOnSuccess?: boolean
  readonly supportEmail?: string
  readonly tm_ttc?: number | string
  readonly tm_ttl?: number | string
  readonly tm_tag?: string
  readonly aoiParamName?: string
  readonly uploadTargetParamName?: string
  readonly allowScheduleMode?: boolean
  readonly allowRemoteDataset?: boolean
  readonly allowRemoteUrlDataset?: boolean
  readonly service?: "download" | "stream"
  // Optional additional AOI output formats
  readonly aoiGeoJsonParamName?: string
  readonly aoiWktParamName?: string
}

export interface RequestConfig {
  readonly method?: HttpMethod
  readonly headers?: { [key: string]: string }
  readonly body?: unknown
  readonly query?: PrimitiveParams
  readonly signal?: AbortSignal
  readonly timeout?: number
  readonly cacheHint?: boolean
  readonly repositoryContext?: string // Added to scope caches properly by repository
}

export interface ApiResponse<T = unknown> {
  readonly data: T
  readonly status: number
  readonly statusText: string
}

export interface FmeFlowError {
  readonly message: string
  readonly details?: { [key: string]: unknown }
  readonly code?: string
}

export class FmeFlowApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = "FmeFlowApiError"
  }
}

// FME workspace and job management
export interface FmeStatusInfo {
  readonly status: string
  readonly message?: string
}

export interface FmeServiceInfo {
  readonly statusInfo?: FmeStatusInfo
  readonly status?: string
  readonly message?: string
  readonly jobID?: number
  readonly id?: number
  readonly url?: string
}

export interface FmeResponse {
  readonly data?: { serviceResponse?: FmeServiceInfo } | FmeServiceInfo
}

export interface WorkspaceItem {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly type?: string
  readonly lastSaveDate?: string
  readonly lastSaveBuild?: string
  readonly category?: string
  readonly requirements?: readonly string[]
  readonly services?: readonly string[]
  readonly datasets?: readonly string[]
  readonly resources?: readonly string[]
  readonly properties?: { readonly [key: string]: unknown }
  readonly fileSize?: number
  readonly buildNum?: number
  readonly transformerCount?: number
}

export interface WorkspaceItemDetail extends WorkspaceItem {
  readonly parameters?: readonly WorkspaceParameter[]
}

export interface RepositoryItems {
  readonly items: readonly WorkspaceItem[]
  readonly totalCount?: number
  readonly limit?: number
  readonly offset?: number
}

export interface ParameterChoice {
  readonly caption?: string
  readonly value: unknown
}

export interface WorkspaceParameter {
  readonly name: string
  readonly type: ParameterType
  readonly description?: string
  readonly defaultValue?: unknown
  readonly optional: boolean
  readonly listOptions?: readonly ParameterChoice[]
  // Optional numeric constraints (present for RANGE_SLIDER and numeric params)
  readonly minimum?: number
  readonly maximum?: number
  readonly minimumExclusive?: boolean
  readonly maximumExclusive?: boolean
  readonly decimalPrecision?: number
}

export interface JobDirectives {
  readonly ttc?: number
  readonly ttl?: number
  readonly tag?: string
  readonly successTopics?: readonly string[]
  readonly failureTopics?: readonly string[]
}

export interface JobRequest {
  readonly publishedParameters?: ReadonlyArray<{ name: string; value: unknown }>
  readonly TMDirectives?: JobDirectives
  readonly NMDirectives?: JobDirectives
}

export interface JobResult {
  readonly id: number
  readonly status: JobStatus
  readonly statusMessage?: string
  readonly timeSubmitted?: string
  readonly timeStarted?: string
  readonly timeFinished?: string
  readonly result?: {
    readonly numFeaturesOutput?: number
    readonly statusMessage?: string
    readonly logMessages?: readonly string[]
  }
}

// JobResponse is same as JobResult for simplicity
export type JobResponse = JobResult

export interface EsriModules {
  readonly SketchViewModel: new (...args: any[]) => __esri.SketchViewModel
  readonly GraphicsLayer: new (...args: any[]) => __esri.GraphicsLayer
  readonly geometryEngine: {
    readonly isSimple: (geometry: __esri.Geometry) => boolean
    readonly planarArea: (geometry: __esri.Geometry, unit: string) => number
  }
  readonly webMercatorUtils: {
    readonly webMercatorToGeographic: (
      geometry: __esri.Geometry
    ) => __esri.Geometry
  }
  readonly reactiveUtils: unknown
  readonly Polyline: {
    readonly fromJSON: (json: unknown) => __esri.Polyline
  }
  readonly Polygon: {
    readonly fromJSON: (json: unknown) => __esri.Polygon
  }
  readonly Graphic: new (...args: any[]) => __esri.Graphic
}

export interface ExportResult {
  readonly success: boolean
  readonly message: string
  readonly code?: string
  readonly jobId?: number
  readonly workspaceName?: string
  readonly email?: string
  readonly downloadUrl?: string
  readonly blob?: Blob
  readonly downloadFilename?: string
}

export interface EsriGeometryJson {
  readonly rings?: ReadonlyArray<
    ReadonlyArray<
      | Readonly<[number, number]>
      | Readonly<[number, number, number]>
      | Readonly<[number, number, number, number]>
    >
  >
  readonly spatialReference?: {
    readonly wkid?: number
    readonly latestWkid?: number
  }
  readonly [key: string]: unknown
}

// Redux state
export interface FmeAction {
  readonly type: FmeActionType
  readonly [key: string]: unknown
}

export type FmeActions = FmeAction

// Widget state
export interface FmeWidgetState {
  // View state
  readonly viewMode: ViewMode
  readonly previousViewMode: ViewMode | null
  readonly isStartupValidating: boolean
  readonly startupValidationStep?: string
  readonly startupValidationError: SerializableErrorState | null

  // Drawing state
  readonly isDrawing: boolean
  readonly drawingTool: DrawingTool
  readonly clickCount: number
  readonly geometryJson: unknown
  readonly drawnArea: number

  // Export state
  readonly formValues: FormValues
  readonly orderResult: ExportResult | null

  // Workspace state
  readonly workspaceItems: readonly WorkspaceItem[]
  readonly selectedWorkspace: string | null
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceItem: WorkspaceItemDetail | null
  readonly isLoadingWorkspaces: boolean
  readonly isLoadingParameters: boolean
  readonly currentRepository: string | null // Track current repository for workspace isolation

  // Loading and error state
  readonly isModulesLoading: boolean
  readonly isSubmittingOrder: boolean
  readonly error: SerializableErrorState | null
  readonly importError: SerializableErrorState | null
  readonly exportError: SerializableErrorState | null
}

// Global state for multiple widget instances
export interface FmeGlobalState {
  readonly byId: { readonly [widgetId: string]: FmeWidgetState }
}

export type IMFmeGlobalState = ImmutableObject<FmeGlobalState>

export interface IMStateWithFmeExport extends IMState {
  readonly "fme-state": IMFmeGlobalState
}

// Component props interfaces
export interface ComponentProps extends BaseProps {
  readonly orderResult?: ExportResult
  readonly translate: (key: string) => string
  readonly onReuseGeography?: () => void
  readonly onBack?: () => void
  readonly config?: FmeExportConfig
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceName?: string
  readonly workspaceItem?: WorkspaceItemDetail
  readonly onSubmit?: (data: unknown) => void
  readonly isSubmitting?: boolean
}

// Workflow props
export interface WorkflowProps extends BaseProps {
  readonly widgetId?: string
  readonly config?: FmeExportConfig
  readonly state: ViewMode
  readonly error?: ErrorState | SerializableErrorState | null
  readonly instructionText?: string
  readonly isModulesLoading?: boolean
  readonly modules?: EsriModules | null
  readonly canStartDrawing?: boolean
  readonly onFormBack?: () => void
  readonly onFormSubmit?: (formData: unknown) => void
  readonly orderResult?: ExportResult | null
  readonly onReuseGeography?: () => void
  readonly isSubmittingOrder?: boolean
  readonly onBack?: () => void
  readonly drawnArea?: number
  readonly formatArea?: (area: number) => string
  readonly drawingMode?: DrawingTool
  readonly onDrawingModeChange?: (tool: DrawingTool) => void
  readonly isDrawing?: boolean
  readonly clickCount?: number
  readonly showHeaderActions?: boolean
  readonly onReset?: () => void
  readonly canReset?: boolean
  readonly onWorkspaceSelected?: (
    workspaceName: string,
    params: readonly WorkspaceParameter[],
    item: WorkspaceItemDetail
  ) => void
  readonly onWorkspaceBack?: () => void
  readonly selectedWorkspace?: string | null
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceItem?: WorkspaceItemDetail | null
  readonly isStartupValidating?: boolean
  readonly startupValidationStep?: string
  readonly startupValidationError?: SerializableErrorState | null
  readonly onRetryValidation?: () => void
}

// Widget configuration
export interface WidgetConfig {
  readonly fmeServerUrl: string
  readonly fmeServerToken: string
  readonly repository: string
  readonly workspace?: string
  readonly maxArea?: number
  readonly requestTimeout?: number
  readonly syncMode?: boolean
  readonly maskEmailOnSuccess?: boolean
  readonly supportEmail?: string
  readonly tm_ttc?: number | string
  readonly tm_ttl?: number | string
  readonly tm_tag?: string
  readonly aoiParamName?: string
  readonly uploadTargetParamName?: string
  readonly allowScheduleMode?: boolean
  readonly allowRemoteDataset?: boolean
  readonly allowRemoteUrlDataset?: boolean
  readonly service?: "download" | "stream"
  // Optional additional AOI output formats
  readonly aoiGeoJsonParamName?: string
  readonly aoiWktParamName?: string
}

export type IMWidgetConfig = ImmutableObject<WidgetConfig>

export interface ValidationResult {
  readonly isValid?: boolean
  readonly errors?: { [key: string]: string }
  readonly messages?: { [key: string]: string }
  readonly hasErrors?: boolean
}

// Shared translation function type
export type TranslateFn = (
  key: string,
  params?: { readonly [key: string]: unknown }
) => string

export interface ConnectionValidationOptions {
  readonly serverUrl: string
  readonly token: string
  readonly repository?: string
  readonly signal?: AbortSignal
}

export interface ConnectionValidationResult {
  readonly success: boolean
  readonly version?: string
  readonly repositories?: readonly string[]
  readonly error?: {
    readonly message: string
    readonly type: "server" | "token" | "repository" | "network" | "generic"
    readonly status?: number
  }
  readonly steps: CheckSteps
}

export interface StartupValidationResult {
  readonly isValid: boolean
  readonly error?: ErrorState
  readonly canProceed: boolean
  readonly requiresSettings: boolean
}

export interface StartupValidationOptions {
  readonly config: FmeExportConfig | undefined
  readonly translate: TranslateFn
  readonly signal?: AbortSignal
}

// Store-local global state (immutable) used by reducer implementation
export type FmeStoreGlobalState = ImmutableObject<{
  readonly byId: { readonly [id: string]: ImmutableObject<FmeWidgetState> }
}>
