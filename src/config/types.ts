import type { IMState, ImmutableObject } from "jimu-core"
import type React from "react"

import type FmeFlowApiClient from "../shared/api"
import type { SettingStyles } from "./style"
import type {
  DrawingTool,
  ErrorSeverity,
  ErrorType,
  FormFieldType,
  HttpMethod,
  JobStatus,
  ParameterType,
  ViewMode,
} from "./enums"

export interface AreaDisplay {
  readonly value: number
  readonly label: string
  readonly decimals: number
}

export interface UnitConversion {
  readonly factor: number
  readonly label: string
  readonly keywords: readonly string[]
  readonly largeUnit?: {
    readonly threshold: number
    readonly factor: number
    readonly label: string
  }
}

export interface PopupSuppressionRecord {
  readonly popup: __esri.Popup
  readonly view: __esri.MapView | __esri.SceneView | null
  readonly handle: __esri.WatchHandle | null
  readonly prevAutoOpen?: boolean
}

export interface TextOrFileValue {
  readonly mode: "text" | "file"
  readonly text?: string
  readonly file?: unknown
  readonly fileName?: string
}

export type TextOrFileMode = "text" | "file"

export type NormalizedTextOrFile = Readonly<TextOrFileValue>

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
    readonly code?: string
    readonly actions?: readonly ViewAction[]
    readonly recoverable?: boolean
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
  readonly isActive: boolean
  readonly clickCount: number
}

export interface MutableParams extends Record<string, unknown> {
  opt_geturl?: unknown
  __aoi_error__?: ErrorState | null
}

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

export type ErrorScope = "general" | "import" | "export"

export interface ErrorWithScope {
  readonly scope: ErrorScope
  readonly details: SerializableErrorState
}

export type ErrorMap = Readonly<{
  readonly [scope in ErrorScope]?: SerializableErrorState
}>

export interface LoadingState {
  readonly workspaces: boolean
  readonly parameters: boolean
  readonly modules: boolean
  readonly submission: boolean
}

export type LoadingFlagKey = keyof LoadingState

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
  readonly rows?: number
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
  readonly logging?: { readonly enabled: boolean; readonly prefix: string }
}

export interface OptionItem {
  readonly label: string
  readonly value: string | number
  readonly disabled?: boolean
  readonly hideLabel?: boolean
  readonly description?: string
  readonly path?: string
  readonly children?: readonly OptionItem[]
  readonly metadata?: { readonly [key: string]: unknown }
  readonly isLeaf?: boolean
}

export interface ScriptedOptionNode {
  readonly id: string
  readonly label: string
  readonly value?: string | number
  readonly path: readonly string[]
  readonly children?: readonly ScriptedOptionNode[]
  readonly disabled?: boolean
  readonly metadata?: { readonly [key: string]: unknown }
  readonly isLeaf?: boolean
}

export interface ScriptedFieldConfig {
  readonly allowMultiple?: boolean
  readonly allowSearch?: boolean
  readonly hierarchical?: boolean
  readonly allowManualEntry?: boolean
  readonly searchPlaceholder?: string
  readonly instructions?: string
  readonly breadcrumbSeparator?: string
  readonly pageSize?: number
  readonly maxResultsHint?: string
  readonly autoSelectSingleLeaf?: boolean
  readonly nodes?: readonly ScriptedOptionNode[]
}

export type TableColumnType =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "date"
  | "time"
  | "datetime"

export interface TableColumnConfig {
  readonly key: string
  readonly label: string
  readonly type?: TableColumnType
  readonly required?: boolean
  readonly placeholder?: string
  readonly options?: readonly OptionItem[]
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly width?: number | string
  readonly readOnly?: boolean
  readonly defaultValue?: unknown
  readonly pattern?: string
  readonly description?: string
}

export interface TableFieldConfig {
  readonly columns?: readonly TableColumnConfig[]
  readonly minRows?: number
  readonly maxRows?: number
  readonly addRowLabel?: string
  readonly removeRowLabel?: string
  readonly helperText?: string
  readonly allowReorder?: boolean
  readonly showHeader?: boolean
}

export interface DateTimeFieldConfig {
  readonly includeSeconds?: boolean
  readonly includeMilliseconds?: boolean
  readonly timezoneMode?: "fixed" | "select" | "offset"
  readonly timezoneOffset?: string
  readonly timezoneOptions?: readonly OptionItem[]
  readonly defaultTimezone?: string
  readonly showTimezoneBadge?: boolean
  readonly helperText?: string
}

export interface SelectFieldConfig {
  readonly allowSearch?: boolean
  readonly allowCustomValues?: boolean
  readonly hierarchical?: boolean
  readonly pageSize?: number
  readonly instructions?: string
}

export interface FileFieldConfig {
  readonly accept?: readonly string[]
  readonly multiple?: boolean
  readonly maxSizeMb?: number
  readonly helperText?: string
  readonly capture?: string
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
  readonly maxLength?: number
}

export interface BtnContentProps {
  readonly icon?: string | React.ReactNode
  readonly text?: string | React.ReactNode
  readonly loading?: boolean
  readonly children?: React.ReactNode
  readonly alignText?: string
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
    readonly type: string
    readonly data: { readonly [key: string]: unknown }
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

export type ColorSpace = "rgb" | "cmyk"

export interface ColorFieldConfig {
  readonly space?: ColorSpace
  readonly alpha?: boolean
}

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
  readonly helper?: string
  readonly scripted?: ScriptedFieldConfig
  readonly tableConfig?: TableFieldConfig
  readonly dateTimeConfig?: DateTimeFieldConfig
  readonly selectConfig?: SelectFieldConfig
  readonly fileConfig?: FileFieldConfig
  readonly colorConfig?: ColorFieldConfig
}

export interface DynamicFieldProps {
  readonly field: DynamicFieldConfig
  readonly value?: FormPrimitive
  readonly onChange: (value: FormPrimitive | File | null) => void
  readonly translate: TranslateFn
}

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
  readonly largeArea?: number
  readonly largeAreaWarningMessage?: string
  readonly customInfoMessage?: string
  readonly maxArea?: number
  readonly requestTimeout?: number
  readonly syncMode?: boolean
  readonly maskEmailOnSuccess?: boolean
  readonly supportEmail?: string
  readonly requireHttps?: boolean
  readonly defaultRequesterEmail?: string
  readonly disallowRestForWebhook?: boolean
  readonly tm_ttc?: number | string
  readonly tm_ttl?: number | string
  readonly tm_tag?: string
  readonly tm_description?: string
  readonly aoiParamName?: string
  readonly uploadTargetParamName?: string
  readonly allowScheduleMode?: boolean
  readonly allowRemoteDataset?: boolean
  readonly allowRemoteUrlDataset?: boolean
  readonly autoCloseOtherWidgets?: boolean
  readonly service?: "download" | "stream"
  readonly aoiGeoJsonParamName?: string
  readonly aoiWktParamName?: string
  readonly drawingColor?: string
}

export interface RequestConfig {
  readonly method?: HttpMethod
  readonly headers?: { readonly [key: string]: string }
  readonly body?: unknown
  readonly query?: PrimitiveParams
  readonly signal?: AbortSignal
  readonly timeout?: number
  readonly cacheHint?: boolean
  readonly repositoryContext?: string
}

export interface EsriRequestConfig {
  request: {
    maxUrlLength: number
    interceptors: unknown[]
  }
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
  readonly data?: { readonly serviceResponse?: FmeServiceInfo } | FmeServiceInfo
}

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
  readonly description?: string
  readonly path?: string
  readonly disabled?: boolean
  readonly metadata?: { readonly [key: string]: unknown }
}

export interface WorkspaceParameter {
  readonly name: string
  readonly type: ParameterType
  readonly description?: string
  readonly defaultValue?: unknown
  readonly optional: boolean
  readonly listOptions?: readonly ParameterChoice[]
  readonly minimum?: number
  readonly maximum?: number
  readonly minimumExclusive?: boolean
  readonly maximumExclusive?: boolean
  readonly decimalPrecision?: number
  readonly attributes?: { readonly [key: string]: unknown }
  readonly control?: { readonly [key: string]: unknown }
  readonly definition?: { readonly [key: string]: unknown }
  readonly metadata?: { readonly [key: string]: unknown }
  readonly schema?: { readonly [key: string]: unknown }
  readonly ui?: { readonly [key: string]: unknown }
  readonly extra?: { readonly [key: string]: unknown }
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

export type EsriAreaOperatorFn = (
  geometry: __esri.Geometry,
  unit?: string
) => number | Promise<number>

export interface EsriGeometryOperators {
  readonly geodesic?: EsriAreaOperatorFn
  readonly geodesicArea?: EsriAreaOperatorFn
  readonly planar?: EsriAreaOperatorFn
  readonly planarArea?: EsriAreaOperatorFn
  readonly area?: {
    readonly geodesic?: EsriAreaOperatorFn
    readonly geodesicArea?: EsriAreaOperatorFn
    readonly planar?: EsriAreaOperatorFn
    readonly planarArea?: EsriAreaOperatorFn
  }
}

export interface EsriModules {
  readonly SketchViewModel: new (
    ...args: readonly unknown[]
  ) => __esri.SketchViewModel
  readonly GraphicsLayer: new (
    ...args: readonly unknown[]
  ) => __esri.GraphicsLayer
  readonly geometryEngine: {
    readonly isSimple?: (g: __esri.Geometry) => boolean
    readonly simplify?: (g: __esri.Geometry) => __esri.Geometry | null
    readonly planarArea?: (g: __esri.Geometry, unit: string) => number
    readonly geodesicArea?: (g: __esri.Geometry, unit: string) => number
    readonly geodesicDensify?: (
      geometry: __esri.Geometry,
      maxSegmentLength: number,
      unit?: string
    ) => __esri.Geometry | null
    readonly densify?: (
      geometry: __esri.Geometry,
      maxSegmentLength: number
    ) => __esri.Geometry | null
  }
  readonly geometryEngineAsync: {
    readonly simplify?: (g: __esri.Geometry) => Promise<__esri.Geometry | null>
    readonly isSimple?: (g: __esri.Geometry) => Promise<boolean>
    readonly planarArea?: (g: __esri.Geometry, unit: string) => Promise<number>
    readonly geodesicArea?: (
      g: __esri.Geometry,
      unit: string
    ) => Promise<number>
    readonly geodesicDensify?: (
      geometry: __esri.Geometry,
      maxSegmentLength: number,
      unit?: string
    ) => Promise<__esri.Geometry | null>
    readonly densify?: (
      geometry: __esri.Geometry,
      maxSegmentLength: number
    ) => Promise<__esri.Geometry | null>
  }
  readonly projection: {
    readonly project?: (
      geometry: __esri.Geometry | readonly __esri.Geometry[],
      spatialReference: __esri.SpatialReference
    ) => __esri.Geometry | readonly __esri.Geometry[] | null | undefined
    readonly load?: () => Promise<void>
    readonly isLoaded?: () => boolean
  }
  readonly SpatialReference: {
    readonly WGS84?: __esri.SpatialReference
    new (...args: readonly unknown[]): __esri.SpatialReference
    readonly fromJSON?: (json: unknown) => __esri.SpatialReference
  }
  readonly webMercatorUtils: {
    readonly webMercatorToGeographic: (g: __esri.Geometry) => __esri.Geometry
  }
  readonly Polyline: { readonly fromJSON: (j: unknown) => __esri.Polyline }
  readonly Polygon: { readonly fromJSON: (j: unknown) => __esri.Polygon }
  readonly Graphic: new (...args: readonly unknown[]) => __esri.Graphic
  readonly intl?: {
    readonly formatNumber?: (
      value: number,
      options?: Intl.NumberFormatOptions
    ) => string | number
  }
  readonly normalizeUtils?: {
    readonly normalizeCentralMeridian?: (
      geometries: ReadonlyArray<__esri.Geometry | null | undefined>,
      url?: string | null,
      requestOptions?: unknown
    ) => Promise<
      ReadonlyArray<__esri.Geometry | __esri.Mesh | null | undefined>
    >
  }
  readonly geometryOperators?: EsriGeometryOperators | null
}

export interface DerivedParamNames {
  readonly geoJsonName?: string
  readonly wktName?: string
}

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
  readonly params: MutableParams
  readonly remoteUrl: string
  readonly uploadFile: File | null
  readonly config: FmeExportConfig | null | undefined
  readonly workspaceParameters?: readonly WorkspaceParameter[] | null
  readonly makeCancelable: MakeCancelableFn
  readonly fmeClient: FmeFlowApiClient
  readonly signal: AbortSignal
  readonly subfolder: string
}

export interface SubmissionPreparationOptions {
  readonly rawFormData: { readonly [key: string]: unknown }
  readonly userEmail: string
  readonly geometryJson: unknown
  readonly geometry: __esri.Geometry | null | undefined
  readonly modules: EsriModules | null
  readonly config: FmeExportConfig | null | undefined
  readonly workspaceParameters?: readonly WorkspaceParameter[] | null
  readonly makeCancelable: MakeCancelableFn
  readonly fmeClient: FmeFlowApiClient
  readonly signal: AbortSignal
  readonly remoteDatasetSubfolder: string
}

export interface SubmissionPreparationResult {
  readonly params: { readonly [key: string]: unknown } | null
  readonly aoiError?: ErrorState
}

export interface FmeWidgetState {
  readonly viewMode: ViewMode
  readonly drawingTool: DrawingTool
  readonly geometryJson: unknown
  readonly drawnArea: number
  readonly geometryRevision: number
  readonly orderResult: ExportResult | null
  readonly workspaceItems: readonly WorkspaceItem[]
  readonly selectedWorkspace: string | null
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceItem: WorkspaceItemDetail | null
  readonly loading: LoadingState
  readonly error: ErrorWithScope | null
  readonly errors: ErrorMap
}

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
  readonly availableRepos: readonly string[] | null
  readonly label: React.ReactNode
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
  readonly isBusy?: boolean
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
  readonly geometryJson?: unknown
  readonly workspaceItems?: readonly WorkspaceItem[]
  readonly state: ViewMode
  readonly error?: AnyErrorState | null
  readonly instructionText?: string
  readonly loadingState?: LoadingState
  readonly modules?: EsriModules | null
  readonly canStartDrawing?: boolean
  readonly onFormBack?: () => void
  readonly onFormSubmit?: (formData: unknown) => void
  readonly getFmeClient?: () => FmeFlowApiClient | null
  readonly orderResult?: ExportResult | null
  readonly onReuseGeography?: () => void
  readonly onBack?: () => void
  readonly drawnArea?: number
  readonly areaWarning?: boolean
  readonly formatArea?: (area: number) => string
  readonly drawingMode?: DrawingTool
  readonly onDrawingModeChange?: (tool: DrawingTool) => void
  readonly isDrawing?: boolean
  readonly clickCount?: number
  readonly isCompleting?: boolean
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

export type IMWidgetConfig = ImmutableObject<FmeExportConfig>

export interface ValidationResult {
  readonly isValid?: boolean
  readonly errors?: { readonly [key: string]: string }
  readonly messages?: { readonly [key: string]: string }
  readonly hasErrors?: boolean
}

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

export type AreasAndLengthsParametersCtor = new (
  options: __esri.AreasAndLengthsParametersProperties
) => __esri.AreasAndLengthsParameters

export type PolygonMaybe =
  | __esri.Geometry
  | null
  | undefined
  | PromiseLike<__esri.Geometry | null | undefined>

export type AreaStrategy = () => Promise<number>

export interface MutableNode {
  id: string
  label: string
  path: string[]
  value?: string | number
  disabled?: boolean
  metadata?: { [key: string]: unknown }
  children: MutableNode[]
}

export interface FileValidationResult {
  readonly valid: boolean
  readonly error?: "fileTooLarge" | "fileTypeNotAllowed" | "fileInvalid"
  readonly maxSizeMB?: number
}

export interface GeometryEngineLike {
  readonly geodesicArea?: (
    geometry: __esri.Geometry,
    unit: string
  ) => number | Promise<number>
  readonly planarArea?: (
    geometry: __esri.Geometry,
    unit: string
  ) => number | Promise<number>
  readonly geodesicDensify?: (
    geometry: __esri.Geometry,
    maxSegmentLength: number,
    unit?: string
  ) => __esri.Geometry | Promise<__esri.Geometry>
  readonly densify?: (
    geometry: __esri.Geometry,
    maxSegmentLength: number,
    unit?: string
  ) => __esri.Geometry | Promise<__esri.Geometry>
  readonly simplify?: (
    geometry: __esri.Geometry
  ) => __esri.Geometry | Promise<__esri.Geometry>
  readonly isSimple?: (geometry: __esri.Geometry) => boolean | Promise<boolean>
  readonly contains?: (
    outer: __esri.Geometry,
    inner: __esri.Geometry
  ) => boolean | Promise<boolean>
}

export interface NormalizeUtilsModule {
  readonly normalizeCentralMeridian?: (
    geometries: readonly __esri.Geometry[]
  ) => PromiseLike<readonly __esri.Geometry[]> | readonly __esri.Geometry[]
}

export interface EsriConfigLike {
  readonly geometryServiceUrl?: string
  readonly request?: { readonly geometryServiceUrl?: string }
  readonly portalSelf?: {
    readonly helperServices?: { readonly geometry?: { readonly url?: string } }
  }
  readonly portalInfo?: {
    readonly helperServices?: { readonly geometry?: { readonly url?: string } }
  }
  readonly helperServices?: { readonly geometry?: { readonly url?: string } }
}

export interface AreasAndLengthsResponse {
  readonly areas?: readonly number[]
}

export interface GeometryServiceModule {
  readonly areasAndLengths?: (
    url: string,
    params: __esri.AreasAndLengthsParameters
  ) => PromiseLike<AreasAndLengthsResponse> | AreasAndLengthsResponse
}

export interface PolygonCtor {
  readonly fromJSON?: (json: unknown) => __esri.Polygon
}

export interface ArcgisGeometryModules {
  readonly geometryEngine?: GeometryEngineLike
  readonly geometryEngineAsync?: GeometryEngineLike
  readonly normalizeUtils?: NormalizeUtilsModule
  readonly esriConfig?: EsriConfigLike
  readonly Polygon?: PolygonCtor
  readonly geometryOperators?: unknown
}

export type UrlValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

export interface AreaEvaluation {
  readonly area: number
  readonly warningThreshold?: number
  readonly maxThreshold?: number
  readonly exceedsMaximum: boolean
  readonly shouldWarn: boolean
}
