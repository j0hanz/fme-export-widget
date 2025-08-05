import type { IconResult, IMState, ImmutableObject, hooks } from "jimu-core"
import type {
  ButtonProps as JimuButtonProps,
  DropdownProps as JimuDropdownProps,
  TextInputProps as JimuTextInputProps,
  TextAreaProps as JimuTextAreaProps,
} from "jimu-ui"

// Base Types & Utilities
// State types for UI state management and rendering
export enum StateType {
  IDLE = "idle",
  LOADING = "loading",
  ERROR = "error",
  SUCCESS = "success",
  CONTENT = "content",
  EMPTY = "empty",
}

// Loading indicator config (legacy compatible)
export interface LoadingConfig {
  readonly type?: "DONUT" | "PRIMARY" | "SECONDARY"
  readonly size?: number
}

// State renderer action button config
export interface StateActionButton {
  readonly label: string
  readonly onClick: () => void
  readonly variant?: "primary" | "secondary" | "danger"
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly icon?: IconResult | string
}

// State renderer data structure
export interface StateData {
  readonly message?: string
  readonly detail?: string
  readonly error?: ErrorState
  readonly actions?: StateActionButton[]
  readonly config?: LoadingConfig
}

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
  readonly data?: StateData & {
    readonly children?: React.ReactNode
  }
  readonly children?: React.ReactNode
}

// Base component interfaces - shared patterns used across components
// Base component props with optional logging
interface BaseComponentProps {
  readonly logging?: {
    readonly enabled?: boolean
    readonly prefix?: string
  }
}

// Tooltip config props (ArcGIS pattern)
interface TooltipProps {
  readonly tooltip?: React.ReactNode
  readonly tooltipDisabled?: boolean
  readonly tooltipPlacement?: "top" | "bottom" | "left" | "right"
  readonly tooltipEnterDelay?: number
  readonly tooltipEnterNextDelay?: number
  readonly tooltipLeaveDelay?: number
}

// Controlled component pattern for form inputs
interface ControlledProps<T = string> {
  readonly value?: T
  readonly defaultValue?: T
  readonly onChange?: (value: T) => void
}

// Core Domain Types
// Drawing tools for geometry creation
export const enum DrawingTool {
  POLYGON = "polygon",
  RECTANGLE = "rectangle",
  FREEHAND = "freehand",
}

// Widget view modes for UI states/workflows
export const enum ViewMode {
  INITIAL = "initial",
  DRAWING = "drawing",
  EXPORT_OPTIONS = "exportOptions",
  EXPORT_FORM = "exportForm",
  TEMPLATE_MANAGER = "templateManager",
  SAVE_TEMPLATE = "saveTemplate",
  ORDER_RESULT = "orderResult",
}

// FME export types for workspace operations
export const enum ExportType {
  AKTER = "akter",
  PLANDOKUMENT = "plandokument",
  EXPORTERA_RASTER = "exportera_raster",
  EXPORT_3D_MODEL = "export_3d_model",
  EXPORT_VECTOR_DATA = "export_vector_data",
  EXPORT_OTHER = "export_other",
}

// Supported coordinate systems for export
export const enum CoordinateSystem {
  SWEREF99_1330 = "sweref99_1330",
  SWEREF99_1500 = "sweref99_1500",
  SWEREF99_1800 = "sweref99_1800",
  WGS84 = "wgs84",
  UTAN_KOORDINATER = "utan_koordinater",
}

// Export formats for data output
export const enum ExportFormat {
  DWG = "dwg",
  DXF = "dxf",
  GEOPACKAGE = "geopackage",
  ESRI_SHAPE = "esri_shape_directory",
  GEOTIFF = "geotiff",
  JPEG = "jpeg",
  PNG = "png",
  SKETCHUP = "sketchup",
}

// Error severity levels
export const enum ErrorSeverity {
  ERROR = "error",
  WARNING = "warning",
  INFO = "info",
}

// Error type categories
export const enum ErrorType {
  VALIDATION = "ValidationError",
  NETWORK = "NetworkError",
  MODULE = "ModuleError",
  GEOMETRY = "GeometryError",
  TEMPLATE = "TemplateError",
  API = "ApiError",
  CONFIG = "ConfigError",
  AREA_TOO_LARGE = "AreaTooLarge",
}

// Standardized error state with recovery options
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

// Template validation result flags
export interface TemplateValidationResult {
  readonly nameEmpty: boolean
  readonly nameTooLong: boolean
  readonly nameExists: boolean
  readonly hasInvalidChars: boolean
  readonly hasMaxTemplates: boolean
  readonly name: string
}

// State Management
// Redux Action Types by domain: view, drawing, template, export, data, loading, error, UI
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

  // Template Management Actions
  SET_AREA_TEMPLATES = "FME_SET_AREA_TEMPLATES",
  SET_TEMPLATE_NAME = "FME_SET_TEMPLATE_NAME",
  SET_TEMPLATE_VALIDATION = "FME_SET_TEMPLATE_VALIDATION",
  START_TEMPLATE_IMPORT = "FME_START_TEMPLATE_IMPORT",
  START_TEMPLATE_EXPORT = "FME_START_TEMPLATE_EXPORT",
  FINISH_TEMPLATE_IMPORT = "FME_FINISH_TEMPLATE_IMPORT",
  FINISH_TEMPLATE_EXPORT = "FME_FINISH_TEMPLATE_EXPORT",

  // Export & Form Actions
  SET_ACTIVE_EXPORT_TYPE = "FME_SET_ACTIVE_EXPORT_TYPE",
  SET_FORM_VALUES = "FME_SET_FORM_VALUES",
  SET_ORDER_RESULT = "FME_SET_ORDER_RESULT",

  // Data Source Actions
  SET_SELECTED_RECORDS = "FME_SET_SELECTED_RECORDS",
  SET_DATA_SOURCE = "FME_SET_DATA_SOURCE",

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
  geometry: __esri.Geometry | null
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

// Template Management Actions
export interface SetAreaTemplatesAction
  extends BaseAction<FmeActionType.SET_AREA_TEMPLATES> {
  areaTemplates: readonly AreaTemplate[]
}

export interface SetTemplateNameAction
  extends BaseAction<FmeActionType.SET_TEMPLATE_NAME> {
  templateName: string
}

export interface SetTemplateValidationAction
  extends BaseAction<FmeActionType.SET_TEMPLATE_VALIDATION> {
  validation: TemplateValidationResult
}

export interface StartTemplateImportAction
  extends BaseAction<FmeActionType.START_TEMPLATE_IMPORT> {}

export interface StartTemplateExportAction
  extends BaseAction<FmeActionType.START_TEMPLATE_EXPORT> {}

export interface FinishTemplateImportAction
  extends BaseAction<FmeActionType.FINISH_TEMPLATE_IMPORT> {
  templates?: AreaTemplate[]
}

export interface FinishTemplateExportAction
  extends BaseAction<FmeActionType.FINISH_TEMPLATE_EXPORT> {}

// Export & Form Actions
export interface SetActiveExportTypeAction
  extends BaseAction<FmeActionType.SET_ACTIVE_EXPORT_TYPE> {
  exportType: ExportType | null
}

export interface SetFormValuesAction
  extends BaseAction<FmeActionType.SET_FORM_VALUES> {
  formValues: { [key: string]: string | number | boolean | readonly string[] }
}

export interface SetOrderResultAction
  extends BaseAction<FmeActionType.SET_ORDER_RESULT> {
  orderResult: ExportResult | null
}

// Data Source Actions
export interface SetSelectedRecordsAction
  extends BaseAction<FmeActionType.SET_SELECTED_RECORDS> {
  records: unknown[]
}

export interface SetDataSourceAction
  extends BaseAction<FmeActionType.SET_DATA_SOURCE> {
  dataSource: string | null
}

// Loading & Error Actions
export interface SetLoadingFlagsAction
  extends BaseAction<FmeActionType.SET_LOADING_FLAGS> {
  isModulesLoading?: boolean
  isTemplateLoading?: boolean
  isSubmittingOrder?: boolean
  isImportingTemplates?: boolean
  isExportingTemplates?: boolean
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

export type FmeTemplateActions =
  | SetAreaTemplatesAction
  | SetTemplateNameAction
  | SetTemplateValidationAction
  | StartTemplateImportAction
  | StartTemplateExportAction
  | FinishTemplateImportAction
  | FinishTemplateExportAction

export type FmeExportActions =
  | SetActiveExportTypeAction
  | SetFormValuesAction
  | SetOrderResultAction

export type FmeDataActions = SetSelectedRecordsAction | SetDataSourceAction

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
  | FmeTemplateActions
  | FmeExportActions
  | FmeDataActions
  | FmeLoadingErrorActions
  | FmeUiActions

// Configuration Constants
export const EXPORT_OPTIONS = [
  { id: "export3dModel", key: "export3dModel" },
  { id: "exportActs", key: "exportActs" },
  { id: "exportPlanDocuments", key: "exportPlanDocuments" },
  { id: "exportRaster", key: "exportRaster" },
  { id: "exportVectorData", key: "exportVectorData" },
  { id: "exportOther", key: "exportOther" },
] as const

// Export option IDs to workspace names
export const EXPORT_MAP = {
  exportActs: "akter",
  exportPlanDocuments: "plandokument",
  exportRaster: "exportera_raster",
  export3dModel: "export_3d_model",
  exportVectorData: "export_vector_data",
  exportOther: "export_other",
} as const

// Workspace names to translation keys
export const DISPLAY_MAP = {
  akter: "akterTitle",
  plandokument: "plandokumentTitle",
  exportera_raster: "exportRasterTitle",
  export_3d_model: "export3dModel",
  export_vector_data: "exportVectorData",
  export_other: "exportOther",
} as const

// Template validation rules
export const TEMPLATE_VALIDATION_RULES = {
  MAX_NAME_LENGTH: 20,
  MAX_TEMPLATES: 5,
  INVALID_CHARS_REGEX: /[<>:"\/\\|?*]/,
} as const

// Drawing and UI config constants
export const DRAWING_LAYER_TITLE = "Drawing Layer"

export const LAYER_CONFIG = {
  title: DRAWING_LAYER_TITLE,
  listMode: "hide",
  elevationInfo: { mode: "on-the-ground" },
} as const

export const SIMULATION_DELAYS = {
  ORDER_SUBMIT: 2000,
} as const

export const TEMPLATE_ID_CONFIG = {
  prefix: "template_",
  randomLength: 9,
} as const

// UI Configuration Constants
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

export const TOOLTIP_CONFIG = {
  DELAYS: {
    ENTER: 1000,
    LEAVE: 100,
    TOUCH: 500,
    NEXT: 500,
  },
  PLACEMENTS: {
    TOP: "top",
    BOTTOM: "bottom",
    LEFT: "left",
    RIGHT: "right",
  },
  STYLES: {
    showArrow: true,
    disabled: false,
  },
} as const

// Freeze config objects to prevent mutation
Object.freeze(EXPORT_OPTIONS)
Object.freeze(EXPORT_MAP)
Object.freeze(DISPLAY_MAP)
Object.freeze(TEMPLATE_VALIDATION_RULES)
Object.freeze(LAYER_CONFIG)
Object.freeze(SIMULATION_DELAYS)
Object.freeze(TEMPLATE_ID_CONFIG)
Object.freeze(UI_CONSTANTS)
Object.freeze(TOOLTIP_CONFIG)

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
  readonly lastModified: string
  readonly services: readonly string[]
  readonly isRunnable: boolean
  readonly category?: string
  readonly userName: string
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
  readonly model: ParameterModel
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

export interface AreaTemplate {
  readonly id: string
  readonly name: string
  readonly geometry: __esri.Geometry
  readonly area: number
  readonly createdDate: Date
}

// ArcGIS JS API module collection
export interface EsriModules {
  // Core geometry and drawing modules
  readonly Sketch: typeof __esri.Sketch
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

  // Measurement widgets - using modern unified widget
  readonly Measurement: typeof __esri.Measurement

  // Essential UI widgets for enhanced functionality
  readonly Search: typeof __esri.Search
  readonly LayerList: typeof __esri.LayerList
  readonly BasemapGallery: typeof __esri.BasemapGallery
  readonly Compass: typeof __esri.Compass
  readonly Home: typeof __esri.Home

  // ArcGIS 4.32+ Geometry Operators - using __esri namespace for consistency
  readonly areaOperator: typeof __esri.areaOperator
  readonly geodeticAreaOperator: typeof __esri.geodeticAreaOperator
  readonly lengthOperator: typeof __esri.lengthOperator
  readonly geodeticLengthOperator: typeof __esri.geodeticLengthOperator
  readonly centroidOperator: typeof __esri.centroidOperator
  readonly simplifyOperator: typeof __esri.simplifyOperator
  readonly bufferOperator: typeof __esri.bufferOperator
  readonly geodesicBufferOperator: typeof __esri.geodesicBufferOperator
  readonly convexHullOperator: typeof __esri.convexHullOperator
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
  readonly geometryJson: __esri.Geometry | null
  readonly drawnArea: number
  readonly realTimeMeasurements: RealTimeMeasurements
}

// Template management state
export interface FmeTemplateState {
  readonly areaTemplates: readonly AreaTemplate[]
  readonly templateName: string
  readonly selectedTemplateId: string | null
  readonly templateValidation: TemplateValidationResult | null
}

// Export workflow and form data state
export interface FmeExportState {
  readonly activeExportType: ExportType | null
  readonly formValues: {
    [key: string]: string | number | boolean | readonly string[]
  }
  readonly orderResult: ExportResult | null
}

// External data source integration state
export interface FmeDataSourceState {
  readonly selectedRecords: unknown[]
  readonly dataSourceId: string | null
}

// Loading states for async operations
export interface FmeLoadingState {
  readonly isModulesLoading: boolean
  readonly isTemplateLoading: boolean
  readonly isSubmittingOrder: boolean
  readonly isImportingTemplates: boolean
  readonly isExportingTemplates: boolean
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
    FmeTemplateState,
    FmeExportState,
    FmeDataSourceState,
    FmeLoadingState,
    FmeErrorState,
    FmeUiState {}

export interface IMStateWithFmeExport extends IMState {
  fmeExport: ImmutableObject<FmeWidgetState>
}

// UI Components
// Button Components
export interface GroupButtonConfig extends TooltipProps {
  readonly text: string
  readonly onClick: () => void
  readonly variant?: JimuButtonProps["variant"]
  readonly color?: JimuButtonProps["color"]
  readonly disabled?: boolean
  readonly loading?: boolean
}

export interface ButtonProps
  extends Omit<JimuButtonProps, "onClick" | "icon">,
    TooltipProps,
    BaseComponentProps {
  readonly text?: string
  readonly icon?: JimuButtonProps["icon"] | IconResult | string
  readonly iconPosition?: "left" | "right"
  readonly loading?: boolean
  readonly onClick?: () => void
}

export interface ButtonGroupProps extends BaseComponentProps {
  readonly leftButton?: GroupButtonConfig
  readonly rightButton?: GroupButtonConfig
  readonly className?: string
  readonly style?: React.CSSProperties
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
  readonly exportOptions?: ReadonlyArray<{
    readonly id: string
    readonly label: string
  }>
  readonly activeExportType: ExportType | null
  readonly onExportOption: (type: string) => void
  readonly onFormBack?: () => void
  readonly onFormSubmit?: (data: unknown) => void
  readonly orderResult?: ExportResult | null
  readonly onReuseGeography?: () => void
  readonly isSubmittingOrder?: boolean
}

// Template-related content properties
export interface ContentTemplateProps {
  readonly templates?: readonly AreaTemplate[]
  readonly templateName?: string
  readonly onLoadTemplate?: (templateId: string) => void
  readonly onSaveTemplate?: (name: string) => void
  readonly onDeleteTemplate?: (templateId: string) => void
  readonly onTemplateNameChange?: (name: string) => void
  readonly isTemplateLoading?: boolean
  readonly onExportTemplates?: () => void
  readonly onExportSingleTemplate?: (templateId: string) => void
  readonly onImportTemplates?: (file: File) => void
  readonly isImportingTemplates?: boolean
  readonly isExportingTemplates?: boolean
  readonly importError?: ErrorState | null
  readonly exportError?: ErrorState | null
}

// Header-related content properties
export interface ContentHeaderProps {
  readonly showHeaderActions?: boolean
  readonly onReset?: () => void
  readonly showSaveButton?: boolean
  readonly showFolderButton?: boolean
  readonly onSaveTemplateFromHeader?: () => void
  readonly onShowTemplateFolder?: () => void
  readonly canSaveTemplate?: boolean
  readonly canLoadTemplate?: boolean
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
    Partial<ContentTemplateProps>,
    Partial<ContentHeaderProps>,
    ContentLoadingProps {}

// Dropdown Components
export interface DropdownItemConfig extends TooltipProps {
  readonly id: string
  readonly label: string
  readonly icon?: IconResult | string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly hidden?: boolean
}

export interface DropdownProps
  extends Omit<JimuDropdownProps, "children">,
    BaseComponentProps {
  readonly items: readonly DropdownItemConfig[]
  readonly buttonIcon?: IconResult | string
  readonly buttonText?: string
  readonly buttonTitle?: string
  readonly buttonVariant?: "primary" | "secondary" | "tertiary"
  readonly buttonSize?: "sm" | "default" | "lg"
  readonly openMode?: "click" | "hover"
  readonly "aria-label"?: string
  readonly "a11y-description"?: string
}

// Export Form Components
export interface ExportFormProps {
  readonly variant: ExportType
  readonly onBack: () => void
  readonly onSubmit: (data: unknown) => void
  readonly isSubmitting?: boolean
}

export interface FieldConfig {
  readonly field: string
  readonly labelId: string
  readonly helperId?: string
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly defaultValue?: string
  readonly optionsKey?: string
}

export interface ExportConfig {
  readonly titleId: string
  readonly subtitleId: string
  readonly fields: readonly FieldConfig[]
  readonly requiredFields?: readonly string[]
  readonly instructions?: string
}

// Form Components
interface BaseFormProps {
  readonly children?: React.ReactNode
  readonly className?: string
  readonly style?: React.CSSProperties
}

interface LayoutFormProps extends BaseFormProps {
  readonly variant: "layout"
  readonly title: string
  readonly subtitle: string
  readonly onBack?: () => void
  readonly onSubmit?: () => void
  readonly isValid?: boolean
  readonly loading?: boolean
}

interface FieldFormProps extends BaseFormProps {
  readonly variant: "field"
  readonly label: string
  readonly helper?: string
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly error?: string
}

export type FormProps = LayoutFormProps | FieldFormProps

// Header Component
export interface HeaderProps {
  readonly showActions: boolean
  readonly onReset: () => void
  readonly resetIcon: IconResult | string
  readonly showSaveButton?: boolean
  readonly showFolderButton?: boolean
  readonly onSaveTemplate?: () => void
  readonly onShowTemplateFolder?: () => void
  readonly saveIcon?: IconResult | string
  readonly folderIcon?: IconResult | string
  readonly canSaveTemplate?: boolean
  readonly canLoadTemplate?: boolean
  readonly canReset?: boolean
}

// Input Components
export interface InputProps
  extends Omit<JimuTextInputProps, "pattern" | "value" | "defaultValue">,
    BaseComponentProps {
  readonly value?: string
  readonly defaultValue?: string
  readonly required?: boolean
  readonly maxLength?: number
  readonly pattern?: RegExp
  readonly validationMessage?: string
}

// Select Components
export interface SelectOption {
  readonly value: string | number
  readonly label: string
  readonly disabled?: boolean
  readonly icon?: IconResult | string
  readonly hideLabel?: boolean
}

export interface SelectProps
  extends ControlledProps<string | number>,
    BaseComponentProps {
  readonly options?: readonly SelectOption[]
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly ariaLabel?: string
  readonly ariaDescribedBy?: string
  readonly style?: React.CSSProperties
}

// TextArea Components
export interface TextAreaProps
  extends Omit<JimuTextAreaProps, "value" | "defaultValue">,
    BaseComponentProps {
  readonly value?: string
  readonly defaultValue?: string
  readonly logEvent?: boolean
  readonly logPrefix?: string
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

// Widget-specific component types and utilities
// Notification state for user feedback
export interface NotificationState {
  readonly severity: "success" | "error" | "warning" | "info"
  readonly message: string
}

// Measurement display component props
export interface MeasurementProps {
  readonly data?: RealTimeMeasurements
  readonly translate: ReturnType<typeof hooks.useTranslation>
}

// Loading state flags for async operations
export interface LoadingFlags {
  readonly isModulesLoading?: boolean
  readonly isTemplateLoading?: boolean
  readonly isSubmittingOrder?: boolean
  readonly isImportingTemplates?: boolean
  readonly isExportingTemplates?: boolean
}

// Widget Constants & Symbols
// Standard color definitions for ArcGIS symbols
export const COLOR_BLACK_TRANSPARENT = [0, 0, 0, 0.8] as [
  number,
  number,
  number,
  number,
]
export const COLOR_WHITE = [255, 255, 255, 1] as [
  number,
  number,
  number,
  number,
]
export const COLOR_ORANGE_FILL = [255, 165, 0, 0.2] as [
  number,
  number,
  number,
  number,
]
export const COLOR_ORANGE_OUTLINE = [255, 140, 0] as [number, number, number]

// Standard highlight symbol for drawn geometries
export const HIGHLIGHT_SYMBOL = {
  type: "simple-fill" as const,
  color: COLOR_ORANGE_FILL,
  outline: {
    color: COLOR_ORANGE_OUTLINE,
    width: 2,
    style: "solid" as const,
  },
}

// Navigation routing table for view transitions
export const VIEW_ROUTES: { [key in ViewMode]: ViewMode } = {
  [ViewMode.SAVE_TEMPLATE]: ViewMode.EXPORT_OPTIONS,
  [ViewMode.TEMPLATE_MANAGER]: ViewMode.EXPORT_OPTIONS,
  [ViewMode.EXPORT_FORM]: ViewMode.EXPORT_OPTIONS,
  [ViewMode.EXPORT_OPTIONS]: ViewMode.INITIAL,
  [ViewMode.ORDER_RESULT]: ViewMode.INITIAL,
  [ViewMode.DRAWING]: ViewMode.INITIAL,
  [ViewMode.INITIAL]: ViewMode.INITIAL,
}

// Freeze widget constants to prevent mutation
Object.freeze(HIGHLIGHT_SYMBOL)
Object.freeze(VIEW_ROUTES)
