import type { IMState, ImmutableObject } from "jimu-core"
import type FmeFlowApiClient from "./shared/api"

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
  COORDSYS = "coord-sys",
  ATTRIBUTE_NAME = "attribute-name",
  ATTRIBUTE_LIST = "attribute-list",
  DB_CONNECTION = "db-connection",
  WEB_CONNECTION = "web-connection",
  TEXT_OR_FILE = "text-or-file",
  REPROJECTION_FILE = "reprojection-file",
  SCRIPTED = "scripted",
  GEOMETRY = "geometry",
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
  SET_DRAWING_TOOL = "fme/SET_DRAWING_TOOL",
  COMPLETE_DRAWING = "fme/COMPLETE_DRAWING",
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

// Default drawing color (ESRI brand blue) used when no user selection exists
export const DEFAULT_DRAWING_HEX = "#0079C1"

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
export interface TextOrFileValue {
  readonly mode: "text" | "file"
  readonly text?: string
  readonly file?: unknown
  readonly fileName?: string
}

export type TextOrFileMode = "text" | "file"

export interface NormalizedTextOrFile extends TextOrFileValue {
  readonly file?: unknown
}

export type FormValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number>
  | readonly string[]
  | Readonly<TextOrFileValue>
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

export type MakeCancelableFn = <T>(promise: Promise<T>) => Promise<T>
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

export type LoadingSnapshot = {
  readonly message?: React.ReactNode
  readonly detail?: React.ReactNode
} | null

export interface DrawingSessionState {
  isActive: boolean
  clickCount: number
}

export interface MutableParams {
  [key: string]: unknown
  opt_geturl?: unknown
  __aoi_error__?: unknown
}

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
  readonly kind?: "runtime"
}

// Serializable error shape for Redux (with optional discriminant)
export interface SerializableErrorState {
  readonly message: string
  readonly type: ErrorType
  readonly code: string
  readonly severity: ErrorSeverity
  readonly details?: { [key: string]: unknown }
  readonly recoverable: boolean
  readonly timestampMs: number
  readonly userFriendlyMessage?: string
  readonly suggestion?: string
  readonly kind?: "serializable"
}

export type AnyErrorState = ErrorState | SerializableErrorState

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
  readonly variant?: "contained" | "outlined" | "text"
  readonly size?: "sm" | "lg" | "default"
  readonly tooltip?: string
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
  readonly alignText?: string
  readonly tooltipDisabled?: boolean
  readonly children?: React.ReactNode
  readonly type?: "default" | "primary" | "secondary" | "tertiary" | "danger"
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
  readonly children: React.ReactNode
  readonly placement?: "top" | "bottom" | "left" | "right"
  readonly disabled?: boolean
  readonly showArrow?: boolean
  readonly id?: string
}

export interface SettingStyles {
  readonly ROW: any
  readonly ALERT_INLINE: any
  readonly LABEL_WITH_BUTTON: any
  readonly STATUS: {
    readonly CONTAINER: any
    readonly LIST: any
    readonly ROW: any
    readonly LABEL_GROUP: any
    readonly COLOR: {
      readonly OK: any
      readonly FAIL: any
      readonly SKIP: any
      readonly PENDING: any
    }
  }
}

// Additional UI component types needed by components
export type GroupButtonConfig = Omit<ButtonProps, "block">

export interface ButtonGroupProps extends BaseProps {
  readonly buttons?: readonly GroupButtonConfig[]
  readonly activeIndex?: number
  readonly onChange?: (index: number) => void
  readonly secondaryButton?: GroupButtonConfig
  readonly primaryButton?: GroupButtonConfig
}

export interface TextAreaProps extends BaseProps {
  readonly value?: string
  readonly onChange?: (value: string) => void
  readonly onBlur?: (value: string) => void
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
  readonly alignText?: string
}

// Setting panel types
export type ConnectionSettings = FmeFlowConfig

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
  readonly onSubmit?: (payload: {
    type: string
    data: { [key: string]: unknown }
  }) => void
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
  readonly check?: boolean
}

export interface StateViewProps extends BaseProps {
  readonly state: ViewState
  readonly center?: boolean
  readonly renderActions?: (
    actions?: readonly ViewAction[],
    ariaLabel?: string
  ) => React.ReactNode
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
  // Accept transient File locally; never stored in Redux
  readonly onChange: (value: FormPrimitive | File | null) => void
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
  readonly maxArea?: number
  readonly requestTimeout?: number
  readonly syncMode?: boolean
  readonly maskEmailOnSuccess?: boolean
  readonly supportEmail?: string
  readonly tm_ttc?: number | string
  readonly tm_ttl?: number | string
  readonly tm_tag?: string
  readonly tm_description?: string
  readonly aoiParamName?: string
  readonly uploadTargetParamName?: string
  readonly allowScheduleMode?: boolean
  readonly allowRemoteDataset?: boolean
  readonly allowRemoteUrlDataset?: boolean
  readonly service?: "download" | "stream"
  readonly aoiGeoJsonParamName?: string
  readonly aoiWktParamName?: string
  readonly drawingColor?: string
}

export interface RequestConfig {
  readonly method?: HttpMethod
  readonly headers?: { [key: string]: string }
  readonly body?: unknown
  readonly query?: PrimitiveParams
  readonly signal?: AbortSignal
  readonly timeout?: number
  readonly cacheHint?: boolean
  readonly repositoryContext?: string
}

export interface EsriRequestConfig {
  readonly request: { maxUrlLength: number; interceptors: any[] }
}

export type EsriMockKey =
  | "esriRequest"
  | "esriConfig"
  | "projection"
  | "webMercatorUtils"
  | "SpatialReference"

export interface ApiResponse<T = unknown> {
  readonly data: T
  readonly status: number
  readonly statusText: string
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

// Normalized projection of FME service info regardless of response nesting
export interface NormalizedServiceInfo {
  readonly status?: string
  readonly message?: string
  readonly jobId?: number
  readonly url?: string
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
  SketchViewModel: new (...a: any[]) => __esri.SketchViewModel
  GraphicsLayer: new (...a: any[]) => __esri.GraphicsLayer
  geometryEngine: {
    isSimple?: (g: __esri.Geometry) => boolean
    simplify?: (g: __esri.Geometry) => __esri.Geometry | null
    planarArea?: (g: __esri.Geometry, unit: string) => number
    geodesicArea?: (g: __esri.Geometry, unit: string) => number
  }
  geometryEngineAsync: {
    simplify?: (g: __esri.Geometry) => Promise<__esri.Geometry | null>
    isSimple?: (g: __esri.Geometry) => Promise<boolean>
    planarArea?: (g: __esri.Geometry, unit: string) => Promise<number>
    geodesicArea?: (g: __esri.Geometry, unit: string) => Promise<number>
  }
  projection: {
    project?: (
      geometry: __esri.Geometry | readonly __esri.Geometry[],
      spatialReference: __esri.SpatialReference
    ) => __esri.Geometry | readonly __esri.Geometry[] | null | undefined
    load?: () => Promise<void>
    isLoaded?: () => boolean
  }
  SpatialReference: {
    WGS84?: __esri.SpatialReference
    new (...args: any[]): __esri.SpatialReference
    fromJSON?: (json: any) => __esri.SpatialReference
  }
  webMercatorUtils: {
    webMercatorToGeographic: (g: __esri.Geometry) => __esri.Geometry
  }
  Polyline: { fromJSON: (j: unknown) => __esri.Polyline }
  Polygon: { fromJSON: (j: unknown) => __esri.Polygon }
  Graphic: new (...a: any[]) => __esri.Graphic
  intl?: {
    formatNumber?: (
      value: number,
      options?: Intl.NumberFormatOptions
    ) => string | number
  }
}

export interface DerivedParamNames {
  readonly geoJsonName?: string
  readonly wktName?: string
}

export type ServiceMode = "sync" | "async" | "schedule"

export type CoordinateTuple = readonly number[]

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

export interface RemoteDatasetOptions {
  params: MutableParams
  remoteUrl: string
  uploadFile: File | null
  config: FmeExportConfig | null | undefined
  workspaceParameters?: readonly WorkspaceParameter[] | null
  makeCancelable: MakeCancelableFn
  fmeClient: FmeFlowApiClient
  signal: AbortSignal
  subfolder: string
}

export interface SubmissionPreparationOptions {
  rawFormData: { [key: string]: unknown }
  userEmail: string
  geometryJson: unknown
  geometry: __esri.Geometry | null | undefined
  modules: EsriModules | null
  config: FmeExportConfig | null | undefined
  workspaceParameters?: readonly WorkspaceParameter[] | null
  makeCancelable: MakeCancelableFn
  fmeClient: FmeFlowApiClient
  signal: AbortSignal
  remoteDatasetSubfolder: string
}

export interface SubmissionPreparationResult {
  params: { [key: string]: unknown } | null
  aoiError?: ErrorState
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
  readonly drawingTool: DrawingTool
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

export interface ConnectionTestSectionProps {
  readonly testState: TestState
  readonly checkSteps: CheckSteps
  readonly disabled: boolean
  readonly onTestConnection: () => void
  readonly translate: TranslateFn
  readonly styles: SettingStyles
}

export interface RepositorySelectorProps {
  readonly localServerUrl: string
  readonly localToken: string
  readonly localRepository: string
  readonly availableRepos: string[] | null
  readonly fieldErrors: FieldErrors
  readonly validateServerUrl: (
    url: string,
    opts?: { readonly strict?: boolean; readonly requireHttps?: boolean }
  ) => { readonly ok: boolean; readonly key?: string }
  readonly validateToken: (token: string) => {
    readonly ok: boolean
    readonly key?: string
  }
  readonly onRepositoryChange: (repository: string) => void
  readonly onRefreshRepositories: () => void
  readonly translate: TranslateFn
  readonly styles: SettingStyles
  readonly ID: { readonly repository: string }
  readonly repoHint?: string | null
}

export interface JobDirectivesSectionProps {
  readonly localTmTtc: string
  readonly localTmTtl: string
  readonly tmTagEnabled: boolean
  readonly tmTagPreset: TmTagPreset
  readonly localTmDescription: string
  readonly onTmTtcChange: (value: string) => void
  readonly onTmTtlChange: (value: string) => void
  readonly onTmTagEnabledChange: (value: boolean) => void
  readonly onTmTagPresetChange: (value: TmTagPreset) => void
  readonly onTmDescriptionChange: (value: string) => void
  readonly onTmTtcBlur: (value: string) => void
  readonly onTmTtlBlur: (value: string) => void
  readonly onTmDescriptionBlur: (value: string) => void
  readonly fieldErrors: FieldErrors
  readonly translate: TranslateFn
  readonly styles: SettingStyles
  readonly ID: {
    readonly tm_ttc: string
    readonly tm_ttl: string
    readonly tm_tag: string
    readonly tm_description: string
  }
}

export type TmTagPreset = "normal" | "fast"

// Workflow props
export interface WorkspaceLoaderOptions {
  readonly config?: FmeExportConfig
  readonly getFmeClient: () => FmeFlowApiClient | null
  readonly translate: (key: string) => string
  readonly makeCancelable: MakeCancelableFn
  readonly widgetId: string
  readonly onWorkspaceSelected?: (
    workspaceName: string,
    params: readonly WorkspaceParameter[],
    item: WorkspaceItemDetail
  ) => void
  readonly dispatch: (action: unknown) => void
}

export interface WorkflowProps extends BaseProps {
  readonly widgetId?: string
  readonly config?: FmeExportConfig
  readonly state: ViewMode
  readonly error?: AnyErrorState | null
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
export type WidgetConfig = FmeExportConfig

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
  readonly mapConfigured?: boolean
}
