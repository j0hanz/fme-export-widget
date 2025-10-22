import type { IMState, ImmutableObject } from "jimu-core"
import type React from "react"

import type FmeFlowApiClient from "../shared/api"
import type { SettingStyles } from "./style"
import type {
  DrawingTool,
  ErrorType,
  FormFieldType,
  HttpMethod,
  JobStatus,
  ParameterType,
  ViewMode,
} from "./enums"
import { ErrorSeverity } from "./enums"

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

export type ServiceMode = "sync" | "async"

export interface FormValues {
  [key: string]: FormValue
  start?: string
  name?: string
  category?: string
  description?: string
  trigger?: string
}

export interface PrimitiveParams {
  [key: string]: unknown
}

export type WebhookErrorCode =
  | "URL_TOO_LONG"
  | "WEBHOOK_AUTH_ERROR"
  | "WEBHOOK_BAD_RESPONSE"
  | "WEBHOOK_NON_JSON"
  | "WEBHOOK_TIMEOUT"

export type TmParamKey = "tm_ttc" | "tm_ttl" | "tm_tag"

export type NumericTmKey = "tm_ttc" | "tm_ttl"

export interface WebhookArtifacts {
  readonly baseUrl: string
  readonly params: URLSearchParams
  readonly fullUrl: string
}

export type TMDirectives = Partial<{
  ttc: number
  ttl: number
  tag: string
}>

export type NMDirectives = Partial<{
  directives: Array<{
    name: string
    [key: string]: any
  }>
}>

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
      readonly messages?: readonly React.ReactNode[]
    }
  | {
      readonly kind: "error"
      readonly message: string
      readonly code?: string
      readonly recoverable?: boolean
      readonly actions?: readonly ViewAction[]
      readonly detail?: React.ReactNode
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
  detail?: string,
  messages?: readonly React.ReactNode[]
): ViewState => ({
  kind: "loading",
  message,
  detail,
  messages,
})

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
    readonly detail?: React.ReactNode
  }
): ViewState => ({
  kind: "error",
  message,
  code: opts?.code,
  actions: opts?.actions,
  recoverable: opts?.recoverable,
  detail: opts?.detail,
})

export type LoadingSnapshot = {
  readonly message?: React.ReactNode
  readonly detail?: React.ReactNode
  readonly messages?: readonly React.ReactNode[]
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
  readonly errorId?: string
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
  readonly accept?: string
  readonly onFileChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  readonly onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
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
  readonly allowSearch?: boolean
  readonly allowCustomValues?: boolean
  readonly hierarchical?: boolean
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
  readonly onReset?: () => void
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

export interface ToggleFieldConfig {
  readonly checkedValue?: string | number | boolean
  readonly uncheckedValue?: string | number | boolean
  readonly checkedLabel?: string
  readonly uncheckedLabel?: string
}

export type VisibilityState =
  | "visibleEnabled"
  | "visibleDisabled"
  | "hiddenEnabled"
  | "hiddenDisabled"

export type ConditionOperator =
  | "$equals"
  | "$lessThan"
  | "$greaterThan"
  | "$matchesRegex"
  | "$isEnabled"
  | "$isRuntimeValue"
  | "$allOf"
  | "$anyOf"
  | "$not"

export interface ConditionExpression {
  readonly [operator: string]: unknown
}

export interface EqualsCondition {
  readonly $equals: {
    readonly parameter: string
    readonly value: string | number
  }
}

export interface ComparisonCondition {
  readonly $lessThan?: {
    readonly parameter: string
    readonly value: string | number
  }
  readonly $greaterThan?: {
    readonly parameter: string
    readonly value: string | number
  }
}

export interface RegexCondition {
  readonly $matchesRegex: {
    readonly parameter: string
    readonly regex: string
  }
}

export interface EnabledCondition {
  readonly $isEnabled: {
    readonly parameter: string
  }
}

export interface RuntimeCondition {
  readonly $isRuntimeValue: {
    readonly parameter: string
  }
}

export interface LogicalCondition {
  readonly $allOf?: readonly ConditionExpression[]
  readonly $anyOf?: readonly ConditionExpression[]
  readonly $not?: ConditionExpression
}

export interface DynamicPropertyClause<T> {
  readonly then: T
  readonly [operator: string]: unknown
}

export interface DynamicPropertyExpression<T> {
  readonly if: ReadonlyArray<DynamicPropertyClause<T>>
  readonly default?: {
    readonly value: T
    readonly override?: boolean
  }
}

export type VisibilityExpression = DynamicPropertyExpression<VisibilityState>

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
  readonly decimalPrecision?: number
  readonly minExclusive?: boolean
  readonly maxExclusive?: boolean
  readonly helper?: string
  readonly scripted?: ScriptedFieldConfig
  readonly tableConfig?: TableFieldConfig
  readonly dateTimeConfig?: DateTimeFieldConfig
  readonly selectConfig?: SelectFieldConfig
  readonly fileConfig?: FileFieldConfig
  readonly colorConfig?: ColorFieldConfig
  readonly toggleConfig?: ToggleFieldConfig
  readonly visibility?: VisibilityExpression
  readonly visibilityState?: VisibilityState
}

export interface DynamicFieldProps {
  readonly field: DynamicFieldConfig
  readonly value?: FormPrimitive
  readonly onChange: (
    value: FormPrimitive | File | readonly File[] | null
  ) => void
  readonly translate: TranslateFn
  readonly disabled?: boolean
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
  readonly showResult?: boolean
  readonly aoiParamName?: string
  readonly uploadTargetParamName?: string

  readonly allowRemoteDataset?: boolean
  readonly allowRemoteUrlDataset?: boolean
  readonly autoCloseOtherWidgets?: boolean
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
  readonly caller?: string
  readonly correlationId?: string
  readonly dedupeKey?: string
  readonly metadata?: { readonly [key: string]: unknown }
  readonly retryAttempt?: number
  readonly transportTag?: string
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

export interface FmeError {
  readonly message: string
  readonly severity: ErrorSeverity
  readonly httpStatus?: number
  readonly code?: string
  readonly retryable?: boolean
}

export class FmeFlowApiError extends Error implements FmeError {
  public readonly code: string
  public readonly httpStatus?: number
  public readonly status?: number
  public readonly severity: ErrorSeverity
  public readonly retryable: boolean
  public readonly isRetryable: boolean

  constructor(
    message: string,
    code: string,
    httpStatus?: number,
    isRetryable?: boolean,
    severity: ErrorSeverity = ErrorSeverity.ERROR
  ) {
    super(message)
    this.name = "FmeFlowApiError"
    this.code = code
    this.httpStatus = httpStatus
    this.status = httpStatus
    this.retryable = Boolean(isRetryable)
    this.isRetryable = this.retryable
    this.severity = severity
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

export interface WorkspaceDatasetProperty {
  readonly name?: string
  readonly value?: unknown
  readonly category?: string
  readonly attributes?: { readonly [key: string]: unknown }
  readonly [key: string]: unknown
}

export interface WorkspaceDataset {
  readonly name: string
  readonly format?: string
  readonly location?: string
  readonly source?: boolean
  readonly featuretypes?: readonly string[]
  readonly properties?: readonly WorkspaceDatasetProperty[]
  readonly [key: string]: unknown
}

export type WorkspaceDatasets = Readonly<{
  readonly source?: readonly WorkspaceDataset[]
  readonly destination?: readonly WorkspaceDataset[]
}>

export interface WorkspaceService {
  readonly name: string
  readonly displayName?: string
  readonly description?: string
  readonly [key: string]: unknown
}

export interface WorkspaceResource {
  readonly name?: string
  readonly path?: string
  readonly type?: string
  readonly size?: number
  readonly [key: string]: unknown
}

export interface WorkspaceProperty {
  readonly name?: string
  readonly value?: unknown
  readonly category?: string
  readonly attributes?: { readonly [key: string]: unknown }
  readonly [key: string]: unknown
}

export type WorkspacePropertyCollection =
  | readonly WorkspaceProperty[]
  | { readonly [key: string]: unknown }

export interface WorkspaceItem {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly type?: string
  readonly lastSaveDate?: string
  readonly lastSaveBuild?: string
  readonly category?: string
  readonly requirements?: readonly string[]
  readonly services?: ReadonlyArray<string | WorkspaceService>
  readonly datasets?: WorkspaceDatasets | readonly string[]
  readonly resources?: ReadonlyArray<string | WorkspaceResource>
  readonly properties?: WorkspacePropertyCollection
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

/**
 * Status of a workspace prefetch operation.
 * - idle: Not started or cancelled
 * - loading: Currently fetching workspace details
 * - success: All workspaces successfully prefetched
 * - error: One or more prefetch operations failed
 */
export type PrefetchStatus = "idle" | "loading" | "success" | "error"

/**
 * Progress information for an ongoing prefetch operation.
 */
export interface WorkspacePrefetchProgress {
  /** Number of workspaces successfully loaded */
  readonly loaded: number
  /** Total number of workspaces to prefetch */
  readonly total: number
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

export type CoordinateTuple = readonly number[]

export interface ExportResult {
  readonly success: boolean
  readonly cancelled?: boolean
  readonly message?: string
  readonly code?: string
  readonly jobId?: number
  readonly workspaceName?: string
  readonly email?: string
  readonly downloadUrl?: string
  readonly blob?: Blob
  readonly downloadFilename?: string
  readonly status?: string
  readonly statusMessage?: string
  readonly serviceMode?: ServiceMode
  readonly blobMetadata?: {
    readonly type?: string
    readonly size?: number
  }
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
  readonly workspaceName?: string | null
}

export interface SubmissionPreparationOptions {
  readonly rawFormData: { readonly [key: string]: unknown }
  readonly userEmail: string
  readonly geometryJson: unknown
  readonly geometry: __esri.Geometry | null | undefined
  readonly modules: EsriModules | null
  readonly config: FmeExportConfig | null | undefined
  readonly workspaceParameters?: readonly WorkspaceParameter[] | null
  readonly workspaceItem?: WorkspaceItemDetail | null
  readonly selectedWorkspaceName?: string | null
  readonly areaWarning?: boolean
  readonly drawnArea?: number
  readonly makeCancelable: MakeCancelableFn
  readonly fmeClient: FmeFlowApiClient
  readonly signal: AbortSignal
  readonly remoteDatasetSubfolder: string
  readonly onStatusChange?: (status: SubmissionPreparationStatus) => void
}

export interface SubmissionPreparationResult {
  readonly params: { readonly [key: string]: unknown } | null
  readonly aoiError?: ErrorState
}

export type SubmissionPreparationStatus =
  | "normalizing"
  | "resolvingDataset"
  | "applyingDefaults"
  | "complete"

export type SubmissionPhase =
  | "idle"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "submitting"

export type ValidationPhase = "idle" | "checking" | "fetchingRepos" | "complete"

export interface FmeWidgetState {
  readonly viewMode: ViewMode
  readonly drawingTool: DrawingTool
  readonly geometryJson: unknown
  readonly drawnArea: number
  readonly orderResult: ExportResult | null
  readonly workspaceItems: readonly WorkspaceItem[]
  readonly selectedWorkspace: string | null
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceItem: WorkspaceItemDetail | null
  readonly loading: LoadingState
  readonly errors: ErrorMap
}

export interface FmeGlobalState {
  readonly byId: { readonly [widgetId: string]: FmeWidgetState }
}

export type IMFmeGlobalState = ImmutableObject<FmeGlobalState>

export interface IMStateWithFmeExport extends IMState {
  readonly "fme-state": IMFmeGlobalState
}

// Types
type LogLevel = "silent" | "warn" | "debug"

export interface NetworkConfig {
  readonly enabled: boolean
  readonly logLevel: LogLevel
  readonly bodyPreviewLimit: number
  readonly warnSlowMs: number
}

export interface InstrumentedRequestOptions<T> {
  method: string
  url: string
  transport: string
  execute: () => Promise<T>
  body?: unknown
  query?: PrimitiveParams | URLSearchParams | string | null
  caller?: string
  correlationId?: string
  retryAttempt?: number
  responseInterpreter?: {
    status?: (response: T) => number | undefined
    ok?: (response: T) => boolean | undefined
    size?: (response: T) => number | undefined
  }
}

export interface WorkspacePrefetchOptions {
  readonly signal?: AbortSignal
  readonly chunkSize?: number
  readonly limit?: number
  readonly onProgress?: (progress: WorkspacePrefetchProgress) => void
}

export type PrefetchableWorkspace = WorkspaceItem & {
  readonly repository?: string
}

export interface RequestLog {
  readonly timestamp: number
  readonly method: string
  readonly url: string
  readonly path: string
  readonly status?: number
  readonly ok?: boolean
  readonly durationMs: number
  readonly correlationId: string
  readonly caller?: string
  readonly transport: string
  readonly retryAttempt?: number
  readonly responseSize?: number
  readonly isAbort?: boolean
}

export interface ServiceModeOverrideInfo {
  readonly forcedMode: ServiceMode
  readonly previousMode: ServiceMode
  readonly reason: "area"
  readonly value?: number
  readonly threshold?: number
}

export interface DetermineServiceModeOptions {
  readonly workspaceItem?: WorkspaceItem | WorkspaceItemDetail | null
  readonly areaWarning?: boolean
  readonly drawnArea?: number
  readonly onModeOverride?: (info: ServiceModeOverrideInfo) => void
}

export interface ForceAsyncResult {
  readonly reason: ServiceModeOverrideInfo["reason"]
  readonly value?: number
  readonly threshold?: number
}

export interface ConnectionTestSectionProps {
  readonly testState: TestState
  readonly checkSteps: CheckSteps
  readonly disabled: boolean
  readonly onTestConnection: () => void
  readonly translate: TranslateFn
  readonly styles: SettingStyles
  readonly validationPhase: ValidationPhase
}

export interface AbortListenerRecord {
  readonly signal: AbortSignal
  readonly handler: () => void
}

export interface WorkspacePrefetchState {
  readonly status: PrefetchStatus
  readonly progress: WorkspacePrefetchProgress | null
}

export interface PrefetchOptions {
  readonly enabled?: boolean
  readonly client?: FmeFlowApiClient | null
  readonly onProgress?: (progress: WorkspacePrefetchProgress) => void
}

export interface ValidateConnectionVariables {
  serverUrl: string
  token: string
  repository?: string
}

export interface UseDebounceOptions {
  onPendingChange?: (pending: boolean) => void
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
  readonly onTmTtcChange: (value: string) => void
  readonly onTmTtlChange: (value: string) => void
  readonly onTmTtcBlur: (value: string) => void
  readonly onTmTtlBlur: (value: string) => void
  readonly fieldErrors: FieldErrors
  readonly translate: TranslateFn
  readonly styles: SettingStyles
  readonly ID: {
    readonly tm_ttc: string
    readonly tm_ttl: string
  }
  readonly showTmTtc?: boolean
}

export type WorkspacePrefetchStatus = "idle" | "loading" | "success" | "error"

export interface WorkflowProps extends BaseProps {
  readonly widgetId?: string
  readonly config?: FmeExportConfig
  readonly geometryJson?: unknown
  readonly workspaceItems?: readonly WorkspaceItem[]
  readonly state: ViewMode
  readonly error?: AnyErrorState | null
  readonly instructionText?: string
  readonly loadingState?: LoadingState
  readonly isPrefetchingWorkspaces?: boolean
  readonly workspacePrefetchProgress?: WorkspacePrefetchProgress | null
  readonly workspacePrefetchStatus?: WorkspacePrefetchStatus
  readonly modules?: EsriModules | null
  readonly canStartDrawing?: boolean
  readonly submissionPhase?: SubmissionPhase
  readonly modeNotice?: ModeNotice | null
  readonly onFormBack?: () => void
  readonly onFormSubmit?: (formData: unknown) => void
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

export interface ModeNotice {
  readonly messageKey: string
  readonly severity?: "info" | "warning"
  readonly params?: { readonly [key: string]: unknown }
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
  readonly warnings?: readonly string[]
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

// ============================================
// Query System Types (Added: Oct 9, 2025)
// ============================================

/**
 * Query key for cache identification
 * Must be JSON-serializable for stable cache keys
 */
export type QueryKey = ReadonlyArray<
  string | number | boolean | null | { readonly [key: string]: any }
>

/**
 * Query status lifecycle states
 */
export type QueryStatus = "idle" | "loading" | "success" | "error"

/**
 * Configuration options for useFmeQuery hook
 */
export interface QueryOptions<T> {
  /** Unique identifier for this query (used for caching) */
  queryKey: QueryKey

  /** Function that performs the actual fetch */
  queryFn: (signal: AbortSignal) => Promise<T>

  /** Whether the query should execute automatically (default: true) */
  enabled?: boolean

  /** Time in ms before cached data is considered stale (default: 5min) */
  staleTime?: number

  /** Time in ms before unused cache entry is garbage collected (default: 10min) */
  cacheTime?: number

  /** Number of retry attempts or false to disable (default: 3) */
  retry?: number | false

  /** Delay between retries in ms, or function for exponential backoff */
  retryDelay?: number | ((attempt: number) => number)

  /** Callback invoked on successful fetch */
  onSuccess?: (data: T) => void

  /** Callback invoked on fetch error */
  onError?: (error: unknown) => void

  /** Whether to refetch when window regains focus (default: false) */
  refetchOnWindowFocus?: boolean

  /** Whether to refetch on network reconnect (default: false) */
  refetchOnReconnect?: boolean
}

/**
 * Return type of useFmeQuery hook
 */
export interface UseFmeQueryResult<T> {
  /** The fetched data (undefined until first successful fetch) */
  data: T | undefined

  /** Error from the last failed fetch attempt */
  error: unknown

  /** True if query is loading for the first time (no cached data) */
  isLoading: boolean

  /** True if query completed successfully at least once */
  isSuccess: boolean

  /** True if query encountered an error */
  isError: boolean

  /** True if query is currently fetching (may have cached data) */
  isFetching: boolean

  /** Manually trigger a refetch */
  refetch: () => Promise<void>

  /** Status of the query */
  status: QueryStatus
}

/**
 * Configuration options for useFmeMutation hook
 */
export interface MutationOptions<TData, TVariables> {
  /** Function that performs the mutation */
  mutationFn: (variables: TVariables, signal: AbortSignal) => Promise<TData>

  /** Callback invoked on successful mutation */
  onSuccess?: (data: TData, variables: TVariables) => void

  /** Callback invoked on mutation error */
  onError?: (error: unknown, variables: TVariables) => void

  /** Callback invoked after mutation completes (success or error) */
  onSettled?: (
    data: TData | undefined,
    error: unknown,
    variables: TVariables
  ) => void
}

/**
 * Return type of useFmeMutation hook
 */
export interface UseFmeMutationResult<TData, TVariables> {
  /** Trigger the mutation (fire and forget) */
  mutate: (variables: TVariables) => void

  /** Trigger the mutation and return a promise */
  mutateAsync: (variables: TVariables) => Promise<TData>

  /** Data returned from the last successful mutation */
  data: TData | undefined

  /** Error from the last failed mutation */
  error: unknown

  /** True if mutation is currently executing */
  isLoading: boolean

  /** True if mutation completed successfully */
  isSuccess: boolean

  /** True if mutation encountered an error */
  isError: boolean

  /** True if mutation has never been called */
  isIdle: boolean

  /** Reset mutation state to idle */
  reset: () => void

  /** Status of the mutation */
  status: QueryStatus
}

/**
 * Internal cache entry structure
 * @internal
 */
export interface CacheEntry<T> {
  data: T | undefined
  error: unknown
  status: QueryStatus
  timestamp: number
  subscribers: Set<() => void>
  retryCount: number
  abortController: AbortController | null
}
