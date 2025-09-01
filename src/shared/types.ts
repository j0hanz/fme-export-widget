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
  COORDSYS = "COORDSYS",
  STRING = "STRING",
  URL = "URL",
  LOOKUP_URL = "LOOKUP_URL",
  LOOKUP_FILE = "LOOKUP_FILE",
  DATE_TIME = "DATE_TIME",
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
}

export const LAYER_CONFIG = {
  title: "Drawing Layer",
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
export interface BaseInteractiveProps {
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly tooltip?: string
  readonly tooltipDisabled?: boolean
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
}

export interface BaseInputProps {
  readonly value?: unknown
  readonly onChange?: (value: unknown) => void
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly required?: boolean
}

export interface ButtonProps extends BaseInteractiveProps {
  readonly text?: React.ReactNode
  readonly icon?: string | React.ReactNode
  readonly iconPosition?: "left" | "right"
  readonly alignText?: "start" | "center" | "end"
  readonly variant?: "contained" | "outlined" | "text"
  readonly size?: "sm" | "lg" | "default"
  readonly block?: boolean
  readonly role?: string
  readonly logging?: { enabled: boolean; prefix: string }
  readonly [key: string]: any
}

export interface ButtonGroupProps {
  readonly items?: readonly ButtonProps[]
  readonly orientation?: "horizontal" | "vertical"
  readonly gap?: number
  readonly leftButton?: ButtonProps
  readonly rightButton?: ButtonProps
  readonly className?: string
  readonly style?: React.CSSProperties
}

export interface GroupButtonConfig {
  readonly leftButton?: ButtonProps
  readonly rightButton?: ButtonProps
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly variant?: "contained" | "outlined" | "text"
  readonly color?: "primary" | "default" | "secondary"
}

export interface OptionItem {
  readonly label: string
  readonly value: string | number
  readonly disabled?: boolean
  readonly hideLabel?: boolean
}

export interface SelectProps extends BaseInputProps {
  readonly options?: readonly OptionItem[]
  readonly coerce?: "number" | "string"
  readonly "aria-label"?: string
  readonly defaultValue?: SelectValue
  readonly style?: React.CSSProperties
}

export interface TabItem {
  readonly value: unknown
  readonly label: string
  readonly icon?: string
  readonly tooltip?: string
  readonly hideLabel?: boolean
  readonly disabled?: boolean
}

export interface ButtonTabsProps {
  readonly items: readonly TabItem[]
  readonly value?: unknown
  readonly onChange?: (value: unknown) => void
  readonly ariaLabel?: string
  readonly defaultValue?: unknown
  readonly onTabChange?: (value: unknown) => void
}

export interface InputProps extends BaseInputProps {
  readonly type?: "text" | "password" | "number" | "file" | "email"
  readonly maxLength?: number
  readonly onFileChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  readonly "aria-label"?: string
  readonly defaultValue?: FormPrimitive
  readonly errorText?: string
  readonly id?: string
  readonly style?: React.CSSProperties
}

export interface TextAreaProps extends BaseInputProps {
  readonly rows?: number
  readonly defaultValue?: FormPrimitive
  readonly errorText?: string
  readonly id?: string
  readonly style?: React.CSSProperties
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

export interface FormProps {
  readonly title?: string
  readonly subtitle?: string
  readonly onSubmit?: () => void
  readonly onBack?: () => void
  readonly isValid?: boolean
  readonly loading?: boolean
  readonly variant?: "layout" | "inline" | "field"
  readonly children?: React.ReactNode
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly label?: string
  readonly helper?: string
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly error?: string
}

export interface FieldProps {
  readonly label?: string
  readonly required?: boolean
  readonly error?: string
  readonly children?: React.ReactNode
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly helper?: string
  readonly readOnly?: boolean
}

export interface BtnContentProps {
  readonly loading?: boolean
  readonly children?: React.ReactNode
  readonly text?: React.ReactNode
  readonly icon?: string | React.ReactNode
  readonly iconPosition?: "left" | "right"
  readonly alignText?: "start" | "center" | "end"
}

export interface IconProps {
  readonly src: string
  readonly size?: number
  readonly className?: string
  readonly ariaLabel?: string
  readonly style?: React.CSSProperties
}

export interface StateViewProps {
  readonly state: ViewState
  readonly center?: boolean
  readonly renderActions?: (
    actions?: readonly ViewAction[],
    ariaLabel?: string
  ) => React.ReactNode
  readonly className?: string
  readonly style?: React.CSSProperties
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
}

export interface DynamicFieldProps {
  readonly field: DynamicFieldConfig
  readonly value?: FormPrimitive
  readonly onChange: (value: FormPrimitive) => void
  readonly translate: (key: string, params?: any) => string
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
  readonly supportEmail?: string
  readonly tm_ttc?: number | string
  readonly tm_ttl?: number | string
  readonly tm_tag?: string
}

export interface RequestConfig {
  readonly method?: HttpMethod
  readonly headers?: { [key: string]: string }
  readonly body?: unknown
  readonly query?: PrimitiveParams
  readonly signal?: AbortSignal
  readonly timeout?: number
  readonly cacheHint?: boolean
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
}

export interface JobRequest {
  readonly publishedParameters?: ReadonlyArray<{ name: string; value: unknown }>
  readonly TMDirectives?: {
    readonly ttc?: number
    readonly ttl?: number
    readonly tag?: string
  }
  readonly NMDirectives?: {
    readonly successTopics?: readonly string[]
    readonly failureTopics?: readonly string[]
  }
}

export interface TMDirectives {
  readonly ttc?: number
  readonly ttl?: number
  readonly tag?: string
}

export interface NMDirectives {
  readonly successTopics?: readonly string[]
  readonly failureTopics?: readonly string[]
}

export interface JobResponse {
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

export interface EsriModules {
  readonly SketchViewModel: any
  readonly GraphicsLayer: any
  readonly geometryEngine: any
  readonly webMercatorUtils: any
  readonly reactiveUtils: any
  readonly Polyline: any
  readonly Polygon: any
  readonly Graphic: any
}

export interface ExportResult {
  readonly success: boolean
  readonly message: string
  readonly code?: string
  readonly jobId?: number
  readonly workspaceName?: string
  readonly email?: string
  readonly downloadUrl?: string
}

export interface EsriGeometryJson {
  readonly rings?: readonly any[][]
  readonly spatialReference?: {
    readonly wkid?: number
    readonly latestWkid?: number
  }
  readonly [key: string]: any
}

// Redux state management
export interface FmeAction<T extends FmeActionType = FmeActionType> {
  readonly type: T
  readonly [key: string]: any
}

export type SetViewModeAction = FmeAction<FmeActionType.SET_VIEW_MODE> & {
  readonly viewMode: ViewMode
}
export type ResetStateAction = FmeAction<FmeActionType.RESET_STATE>
export type SetStartupValidationStateAction =
  FmeAction<FmeActionType.SET_STARTUP_VALIDATION_STATE> & {
    readonly isValidating: boolean
    readonly validationStep?: string
    readonly validationError?: ErrorState | SerializableErrorState | null
  }
export type SetGeometryAction = FmeAction<FmeActionType.SET_GEOMETRY> & {
  readonly geometryJson: unknown
  readonly drawnArea?: number
}
export type SetDrawingStateAction =
  FmeAction<FmeActionType.SET_DRAWING_STATE> & {
    readonly isDrawing: boolean
    readonly clickCount?: number
    readonly drawingTool?: DrawingTool
  }
export type SetDrawingToolAction = FmeAction<FmeActionType.SET_DRAWING_TOOL> & {
  readonly drawingTool: DrawingTool
}
export type SetClickCountAction = FmeAction<FmeActionType.SET_CLICK_COUNT> & {
  readonly clickCount: number
}
export type SetFormValuesAction = FmeAction<FmeActionType.SET_FORM_VALUES> & {
  readonly formValues: FormValues
}
export type SetOrderResultAction = FmeAction<FmeActionType.SET_ORDER_RESULT> & {
  readonly orderResult: ExportResult | null
}
export type SetWorkspaceItemsAction =
  FmeAction<FmeActionType.SET_WORKSPACE_ITEMS> & {
    readonly workspaceItems: readonly WorkspaceItem[]
  }
export type SetWorkspaceParametersAction =
  FmeAction<FmeActionType.SET_WORKSPACE_PARAMETERS> & {
    readonly workspaceParameters: readonly WorkspaceParameter[]
    readonly workspaceName: string
  }
export type SetSelectedWorkspaceAction =
  FmeAction<FmeActionType.SET_SELECTED_WORKSPACE> & {
    readonly workspaceName: string | null
  }
export type SetWorkspaceItemAction =
  FmeAction<FmeActionType.SET_WORKSPACE_ITEM> & {
    readonly workspaceItem: WorkspaceItemDetail | null
  }
export type SetLoadingFlagsAction =
  FmeAction<FmeActionType.SET_LOADING_FLAGS> & {
    readonly isModulesLoading?: boolean
    readonly isSubmittingOrder?: boolean
  }
export type SetErrorAction = FmeAction<FmeActionType.SET_ERROR> & {
  readonly error: SerializableErrorState | null
}
export type SetImportErrorAction = FmeAction<FmeActionType.SET_IMPORT_ERROR> & {
  readonly error: SerializableErrorState | null
}
export type SetExportErrorAction = FmeAction<FmeActionType.SET_EXPORT_ERROR> & {
  readonly error: SerializableErrorState | null
}

export type FmeViewActions =
  | SetViewModeAction
  | ResetStateAction
  | SetStartupValidationStateAction
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

export type FmeActions =
  | FmeViewActions
  | FmeDrawingActions
  | FmeExportActions
  | FmeWorkspaceActions
  | FmeLoadingErrorActions

// Widget state interfaces
export interface FmeViewState {
  readonly viewMode: ViewMode
  readonly previousViewMode: ViewMode | null
  readonly isStartupValidating: boolean
  readonly startupValidationStep?: string
  readonly startupValidationError: SerializableErrorState | null
}

export interface FmeDrawingState {
  readonly isDrawing: boolean
  readonly drawingTool: DrawingTool
  readonly clickCount: number
  readonly geometryJson: unknown
  readonly drawnArea: number
}

export interface FmeExportState {
  readonly formValues: FormValues
  readonly orderResult: ExportResult | null
}

export interface FmeWorkspaceState {
  readonly workspaceItems: readonly WorkspaceItem[]
  readonly selectedWorkspace: string | null
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceItem: WorkspaceItemDetail | null
  readonly isLoadingWorkspaces: boolean
  readonly isLoadingParameters: boolean
}

export interface FmeLoadingState {
  readonly isModulesLoading: boolean
  readonly isSubmittingOrder: boolean
}

export interface FmeErrorState {
  readonly error: SerializableErrorState | null
  readonly importError: SerializableErrorState | null
  readonly exportError: SerializableErrorState | null
}

export interface FmeWidgetState
  extends FmeViewState,
    FmeDrawingState,
    FmeExportState,
    FmeWorkspaceState,
    FmeLoadingState,
    FmeErrorState {}

export interface IMStateWithFmeExport extends IMState {
  readonly "fme-state": ImmutableObject<FmeWidgetState>
}
// Component props interfaces
export interface OrderResultProps {
  readonly orderResult: ExportResult
  readonly translate: (key: string) => string
  readonly onReuseGeography?: () => void
  readonly onBack?: () => void
  readonly config?: FmeExportConfig
}

export interface ExportFormProps {
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceName: string
  readonly workspaceItem?: WorkspaceItemDetail
  readonly onBack?: () => void
  readonly onSubmit?: (data: unknown) => void
  readonly isSubmitting?: boolean
  readonly translate: (key: string) => string
}

export interface WorkflowProps {
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
  readonly supportEmail?: string
  readonly tm_ttc?: number | string
  readonly tm_ttl?: number | string
  readonly tm_tag?: string
}

export type IMWidgetConfig = ImmutableObject<WidgetConfig>
export interface ConnectionSettings {
  readonly serverUrl: string
  readonly token: string
  readonly repository: string
}

export interface TestState {
  readonly isTestingConnection?: boolean
  readonly connectionResult?: string | null
  readonly isTesting?: boolean
  readonly message?: string
  readonly type?: "success" | "error" | "warning" | "info"
}

export interface FieldErrors {
  serverUrl?: string
  token?: string
  repository?: string
  workspace?: string
  maxArea?: string
  requestTimeout?: string
  supportEmail?: string
  tm_ttc?: string
  tm_ttl?: string
  tm_tag?: string
}

export type StepStatus = "idle" | "pending" | "ok" | "fail" | "skip"
export interface CheckSteps {
  readonly connection?: StepStatus
  readonly authentication?: StepStatus
  readonly repository?: StepStatus
  readonly serverUrl?: StepStatus
  readonly token?: StepStatus
  readonly version?: string
}

export interface ValidationResult {
  readonly isValid?: boolean
  readonly errors?: FieldErrors
  readonly messages?: Partial<FieldErrors>
  readonly hasErrors?: boolean
}

export interface SanitizationResult {
  readonly isValid?: boolean
  readonly config?: WidgetConfig
  readonly cleaned?: string
  readonly changed?: boolean
}
