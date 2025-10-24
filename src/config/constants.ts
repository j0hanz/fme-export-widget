import type { ServiceMode, UnitConversion } from "./types"

import { FormFieldType, FmeActionType, ParameterType, ViewMode } from "./enums"

export const FME_ACTION_TYPES = Object.freeze([
  FmeActionType.SET_VIEW_MODE,
  FmeActionType.RESET_STATE,
  FmeActionType.SET_GEOMETRY,
  FmeActionType.SET_DRAWING_TOOL,
  FmeActionType.COMPLETE_DRAWING,
  FmeActionType.SET_ORDER_RESULT,
  FmeActionType.SET_WORKSPACE_ITEMS,
  FmeActionType.SET_WORKSPACE_PARAMETERS,
  FmeActionType.SET_SELECTED_WORKSPACE,
  FmeActionType.SET_WORKSPACE_ITEM,
  FmeActionType.SET_ERROR,
  FmeActionType.SET_ERRORS,
  FmeActionType.CLEAR_WORKSPACE_STATE,
  FmeActionType.CLEAR_ERROR,
  FmeActionType.RESET_TO_DRAWING,
  FmeActionType.COMPLETE_STARTUP,
  FmeActionType.REMOVE_WIDGET_STATE,
  FmeActionType.SET_LOADING_FLAG,
  FmeActionType.APPLY_WORKSPACE_DATA,
] as const)

export const LAYER_CONFIG = Object.freeze({
  title: "",
  listMode: "hide",
  elevationInfo: { mode: "on-the-ground" },
})

export const DEFAULT_DRAWING_HEX = "#0079C1"
export const DEFAULT_OUTLINE_WIDTH = 2
export const DEFAULT_FILL_OPACITY = 0.2

export const UPLOAD_PARAM_TYPES = Object.freeze([
  "FILENAME",
  "FILENAME_MUSTEXIST",
  "DIRNAME",
  "DIRNAME_MUSTEXIST",
  "DIRNAME_SRC",
  "LOOKUP_FILE",
  "REPROJECTION_FILE",
] as const)

export const FME_FLOW_API = Object.freeze({
  BASE_PATH: "/fmeapiv4",
  MAX_URL_LENGTH: 4000,
  WEBHOOK_EXCLUDE_KEYS: [] as const,
  WEBHOOK_LOG_WHITELIST: Object.freeze([
    "opt_responseformat",
    "opt_showresult",
    "opt_servicemode",
  ] as const),
})

export const LARGE_AREA_MESSAGE_CHAR_LIMIT = 160

export const SETTING_CONSTANTS = Object.freeze({
  VALIDATION: {
    DEFAULT_TTL_VALUE: "",
    DEFAULT_TTC_VALUE: "",
  },
  LIMITS: {
    MAX_M2_CAP: 10_000_000_000,
    MAX_REQUEST_TIMEOUT_MS: 600_000,
  },
  DIRECTIVES: {
    DESCRIPTION_MAX: 512,
    TAG_MAX: 128,
  },
  COLORS: {
    BACKGROUND_DARK: "#181818",
  },
  TEXT: {
    LARGE_AREA_MESSAGE_MAX: LARGE_AREA_MESSAGE_CHAR_LIMIT,
  },
})

export const FAST_TM_TAG = "fast"

export const VIEW_ROUTES: { readonly [key in ViewMode]: ViewMode } = {
  [ViewMode.STARTUP_VALIDATION]: ViewMode.STARTUP_VALIDATION,
  [ViewMode.EXPORT_FORM]: ViewMode.WORKSPACE_SELECTION,
  [ViewMode.WORKSPACE_SELECTION]: ViewMode.INITIAL,
  [ViewMode.EXPORT_OPTIONS]: ViewMode.INITIAL,
  [ViewMode.ORDER_RESULT]: ViewMode.INITIAL,
  [ViewMode.DRAWING]: ViewMode.INITIAL,
  [ViewMode.INITIAL]: ViewMode.INITIAL,
}

export const LOADING_TIMEOUT_MS = 30000
export const MS_LOADING = 500

export const ESRI_MODULES_TO_LOAD = Object.freeze([
  "esri/widgets/Sketch/SketchViewModel",
  "esri/layers/GraphicsLayer",
  "esri/geometry/geometryEngine",
  "esri/geometry/geometryEngineAsync",
  "esri/geometry/support/webMercatorUtils",
  "esri/geometry/projection",
  "esri/geometry/SpatialReference",
  "esri/geometry/support/normalizeUtils",
  "esri/geometry/Polyline",
  "esri/geometry/Polygon",
  "esri/Graphic",
] as const)

export const WORKSPACE_ITEM_TYPE = "workspace"

export const PREFETCH_CONFIG = Object.freeze({
  DEFAULT_CHUNK_SIZE: 10,
  MIN_CHUNK_SIZE: 1,
  MAX_CHUNK_SIZE: 25,
} as const)

export const ERROR_NAMES = Object.freeze({
  CANCELLED_PROMISE: "CancelledPromiseError",
  ABORT: "AbortError",
})

export const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/
export const NO_REPLY_REGEX = /no-?reply/i
export const EMAIL_PLACEHOLDER = /\{\s*email\s*\}/i

export const FORBIDDEN_HOSTNAME_SUFFIXES = Object.freeze([
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".home",
  ".lan",
  ".localdomain",
] as const)

export const PRIVATE_IPV4_RANGES = Object.freeze([
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255] },
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] },
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },
  { start: [0, 0, 0, 0], end: [0, 255, 255, 255] },
] as const)

export const ALLOWED_FILE_EXTENSIONS = /\.(zip|kmz|json|geojson|gml)(\?.*)?$/i
export const MAX_URL_LENGTH = 4000

export const ABORT_REGEX = /abort/i

export const TM_PARAM_KEYS = Object.freeze([
  "tm_ttc",
  "tm_ttl",
  "tm_tag",
] as const)

export const TM_NUMERIC_PARAM_KEYS = Object.freeze([
  "tm_ttc",
  "tm_ttl",
] as const)

export const OPTIONAL_OPT_KEYS = Object.freeze([
  "opt_servicemode",
  "opt_responseformat",
  "opt_showresult",
  "opt_requesteremail",
] as const)

export const WEBHOOK_EXCLUDE_PARAMS = Object.freeze([
  ...FME_FLOW_API.WEBHOOK_EXCLUDE_KEYS,
  ...TM_PARAM_KEYS,
] as const)

export const PUBLISHED_PARAM_EXCLUDE_SET: ReadonlySet<string> = new Set([
  ...TM_PARAM_KEYS,
  ...OPTIONAL_OPT_KEYS,
])

export const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = Object.freeze([
  "sync",
  "async",
] as const)

export const GEOMETRY_CONSTS = Object.freeze({
  M2_PER_KM2: 1_000_000,
  AREA_DECIMALS: 2,
  METERS_PER_KILOMETER: 1_000,
  SQUARE_FEET_PER_SQUARE_MILE: 27_878_400,
})

export const UNIT_CONVERSIONS: readonly UnitConversion[] = Object.freeze([
  {
    factor: 0.3048,
    label: "ft²",
    keywords: ["foot", "feet"],
    largeUnit: {
      threshold: GEOMETRY_CONSTS.SQUARE_FEET_PER_SQUARE_MILE,
      factor: GEOMETRY_CONSTS.SQUARE_FEET_PER_SQUARE_MILE,
      label: "mi²",
    },
  },
  { factor: 0.3048006096, label: "ft²", keywords: [] },
  { factor: 1609.344, label: "mi²", keywords: ["mile"] },
  {
    factor: GEOMETRY_CONSTS.METERS_PER_KILOMETER,
    label: "km²",
    keywords: ["kilometer"],
  },
  { factor: 0.9144, label: "yd²", keywords: ["yard"] },
  { factor: 0.0254, label: "in²", keywords: ["inch"] },
  { factor: 0.01, label: "cm²", keywords: ["centimeter"] },
  { factor: 0.001, label: "mm²", keywords: ["millimeter"] },
  { factor: 1852, label: "nm²", keywords: ["nautical"] },
  { factor: 1, label: "m²", keywords: ["meter"] },
] as const)

export const DEFAULT_ERROR_ICON = "error"

export const ICON_BY_EXACT_CODE = Object.freeze<{
  readonly [code: string]: string
}>({
  GEOMETRY_SERIALIZATION_FAILED: "polygon",
  MAP_MODULES_LOAD_FAILED: "map",
  FORM_INVALID: "warning",
})

export const TOKEN_ICON_PRIORITY = Object.freeze([
  { token: "GEOMETRY", icon: "polygon" },
  { token: "AREA", icon: "polygon" },
  { token: "MAP", icon: "map" },
  { token: "MODULE", icon: "map" },
  { token: "FORM", icon: "warning" },
  { token: "TOKEN", icon: "person-lock" },
  { token: "AUTH", icon: "person-lock" },
  { token: "REPOSITORY", icon: "folder" },
  { token: "REPO", icon: "folder" },
  { token: "DATA", icon: "data" },
  { token: "NETWORK", icon: "shared-no" },
  { token: "OFFLINE", icon: "shared-no" },
  { token: "CONNECTION", icon: "shared-no" },
  { token: "REQUEST", icon: "shared-no" },
  { token: "SERVER", icon: "feature-service" },
  { token: "GATEWAY", icon: "feature-service" },
  { token: "URL", icon: "link-tilted" },
  { token: "TIMEOUT", icon: "time" },
  { token: "CONFIG", icon: "setting" },
  { token: "EMAIL", icon: "email" },
] as const)

export const MIN_TOKEN_LENGTH = 10
export const FME_REST_PATH = "/fmerest"

export const WKID = Object.freeze({
  WGS84: 4326,
  WEB_MERCATOR: 3857,
})

export const GEODESIC_SEGMENT_LENGTH_METERS = 50
export const MIN_PLANAR_SEGMENT_DEGREES = 1e-6
export const DEGREES_PER_METER = 1 / 111319.49079327358

export const HTTP_STATUS_CODES = Object.freeze({
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  TIMEOUT: 408,
  GATEWAY_TIMEOUT: 504,
  TOO_MANY_REQUESTS: 429,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  NETWORK_ERROR: 0,
  SERVER_ERROR_MIN: 500,
  SERVER_ERROR_MAX: 599,
})

// HTTP Status Ranges
export const HTTP_STATUS_RANGES = Object.freeze({
  SUCCESS_MIN: 200,
  SUCCESS_MAX: 399,
  CLIENT_ERROR_MIN: 400,
  CLIENT_ERROR_MAX: 499,
  SERVER_ERROR_MIN: 500,
  SERVER_ERROR_MAX: 599,
  MIN_VALID: 100,
  MAX_VALID: 599,
})

// HTTP Status Classification Helpers
export const isSuccessStatus = (status?: number): boolean =>
  typeof status === "number" &&
  status >= HTTP_STATUS_RANGES.SUCCESS_MIN &&
  status <= HTTP_STATUS_RANGES.SUCCESS_MAX

export const isServerError = (status?: number): boolean =>
  typeof status === "number" && status >= HTTP_STATUS_RANGES.SERVER_ERROR_MIN

export const isClientError = (status?: number): boolean =>
  typeof status === "number" &&
  status >= HTTP_STATUS_RANGES.CLIENT_ERROR_MIN &&
  status <= HTTP_STATUS_RANGES.CLIENT_ERROR_MAX

export const isHttpStatus = (n: unknown): n is number =>
  typeof n === "number" &&
  n >= HTTP_STATUS_RANGES.MIN_VALID &&
  n <= HTTP_STATUS_RANGES.MAX_VALID

export const isRetryableStatus = (status?: number): boolean => {
  if (!status || status < HTTP_STATUS_RANGES.MIN_VALID) return true
  if (isServerError(status)) return true
  return (
    status === HTTP_STATUS_CODES.TIMEOUT ||
    status === HTTP_STATUS_CODES.TOO_MANY_REQUESTS
  )
}

// Time Constants (milliseconds)
export const TIME_CONSTANTS = Object.freeze({
  SECOND: 1000,
  MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  TEN_MINUTES: 10 * 60 * 1000,
  MAX_RESPONSE_TIME: 300000, // 5 minutes
  SLOW_REQUEST_THRESHOLD: 1000, // 1 second
})

export const ERROR_CODE_TO_KEY: { readonly [code: string]: string } = {
  INVALID_RESPONSE_FORMAT: "errorTokenIssue",
  WEBHOOK_AUTH_ERROR: "errorTokenIssue",
  WEBHOOK_TIMEOUT: "requestTimedOut",
  REPOSITORIES_ERROR: "errorRepositoryAccess",
  REPOSITORY_ITEMS_ERROR: "errorRepositoryAccess",
  JOB_SUBMISSION_ERROR: "errorJobSubmission",
  INVALID_CONFIG: "errorSetupRequired",
  CONFIG_INCOMPLETE: "errorSetupRequired",
  configMissing: "errorSetupRequired",
  GEOMETRY_MISSING: "geometryMissingCode",
  GEOMETRY_TYPE_INVALID: "geometryTypeInvalidCode",
  GEOMETRY_SERIALIZATION_FAILED: "geometrySerializationFailedCode",
  URL_TOO_LONG: "urlTooLongMessage",
}

export const STATUS_TO_KEY_MAP: { readonly [status: number]: string } = {
  401: "errorTokenIssue",
  408: "requestTimedOut",
  429: "rateLimitExceeded",
  431: "headersTooLargeMessage",
}

export const MESSAGE_PATTERNS = Object.freeze([
  { pattern: /timeout/i, key: "requestTimedOut" },
  { pattern: /cors/i, key: "corsBlocked" },
  { pattern: /url.*too/i, key: "urlTooLongMessage" },
  {
    pattern: /remote_dataset_workspace_required/i,
    key: "REMOTE_DATASET_WORKSPACE_REQUIRED",
  },
] as const)

export const SERVER_URL_REASON_TO_KEY: { readonly [reason: string]: string } = {
  require_https: "require_https",
  no_query_or_hash: "invalid_url",
  disallow_fmerest_for_webhook: "disallow_fmerest_for_webhook",
  invalid_url: "invalid_url",
}

export const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "fmeServerUrl",
  "fmeServerToken",
  "repository",
] as const)

export const STATUS_PROPERTIES = Object.freeze([
  "status",
  "statusCode",
  "httpStatus",
] as const)

export const DEFAULT_REPOSITORY = "_"

export const SKIPPED_PARAMETER_NAMES = Object.freeze(
  new Set([
    "MAXX",
    "MINX",
    "MAXY",
    "MINY",
    "AreaOfInterest",
    "AREA",
    "ExtentGeoJson",
    "tm_ttc",
    "tm_ttl",
    "tm_tag",
  ])
)

export const ALWAYS_SKIPPED_TYPES = Object.freeze(
  new Set<ParameterType>([ParameterType.NOVALUE, ParameterType.GROUP])
)

export const LIST_REQUIRED_TYPES = Object.freeze(
  new Set<ParameterType>([
    ParameterType.DB_CONNECTION,
    ParameterType.WEB_CONNECTION,
    ParameterType.ATTRIBUTE_NAME,
    ParameterType.ATTRIBUTE_LIST,
    ParameterType.COORDSYS,
    ParameterType.REPROJECTION_FILE,
  ])
)

export const MULTI_SELECT_TYPES = Object.freeze(
  new Set<ParameterType>([
    ParameterType.LISTBOX,
    ParameterType.LOOKUP_LISTBOX,
    ParameterType.ATTRIBUTE_LIST,
  ])
)

export const PARAMETER_FIELD_TYPE_MAP: Readonly<{
  [K in ParameterType]?: FormFieldType
}> = Object.freeze({
  [ParameterType.FLOAT]: FormFieldType.NUMERIC_INPUT,
  [ParameterType.INTEGER]: FormFieldType.NUMBER,
  [ParameterType.TEXT_EDIT]: FormFieldType.TEXTAREA,
  [ParameterType.PASSWORD]: FormFieldType.PASSWORD,
  [ParameterType.BOOLEAN]: FormFieldType.SWITCH,
  [ParameterType.CHECKBOX]: FormFieldType.SWITCH,
  [ParameterType.CHOICE]: FormFieldType.SELECT,
  [ParameterType.FILENAME]: FormFieldType.FILE,
  [ParameterType.FILENAME_MUSTEXIST]: FormFieldType.FILE,
  [ParameterType.DIRNAME]: FormFieldType.FILE,
  [ParameterType.DIRNAME_MUSTEXIST]: FormFieldType.FILE,
  [ParameterType.DIRNAME_SRC]: FormFieldType.FILE,
  [ParameterType.DATE_TIME]: FormFieldType.DATE_TIME,
  [ParameterType.DATETIME]: FormFieldType.DATE_TIME,
  [ParameterType.URL]: FormFieldType.URL,
  [ParameterType.LOOKUP_URL]: FormFieldType.URL,
  [ParameterType.LOOKUP_FILE]: FormFieldType.FILE,
  [ParameterType.DATE]: FormFieldType.DATE,
  [ParameterType.TIME]: FormFieldType.TIME,
  [ParameterType.MONTH]: FormFieldType.MONTH,
  [ParameterType.WEEK]: FormFieldType.WEEK,
  [ParameterType.COLOR]: FormFieldType.COLOR,
  [ParameterType.COLOR_PICK]: FormFieldType.COLOR,
  [ParameterType.RANGE_SLIDER]: FormFieldType.SLIDER,
  [ParameterType.MESSAGE]: FormFieldType.MESSAGE,
  [ParameterType.TEXT_OR_FILE]: FormFieldType.TEXT_OR_FILE,
  [ParameterType.REPROJECTION_FILE]: FormFieldType.REPROJECTION_FILE,
  [ParameterType.COORDSYS]: FormFieldType.COORDSYS,
  [ParameterType.ATTRIBUTE_NAME]: FormFieldType.ATTRIBUTE_NAME,
  [ParameterType.ATTRIBUTE_LIST]: FormFieldType.ATTRIBUTE_LIST,
  [ParameterType.DB_CONNECTION]: FormFieldType.DB_CONNECTION,
  [ParameterType.WEB_CONNECTION]: FormFieldType.WEB_CONNECTION,
  [ParameterType.SCRIPTED]: FormFieldType.SCRIPTED,
})

export const ESRI_GLOBAL_MOCK_KEYS = Object.freeze([
  "esriRequest",
  "esriConfig",
  "projection",
  "webMercatorUtils",
  "SpatialReference",
] as const)

export const FILE_UPLOAD = Object.freeze({
  DEFAULT_MAX_SIZE_MB: 150,
  ONE_MB_IN_BYTES: 1024 * 1024,
  GEOMETRY_PREVIEW_MAX_LENGTH: 1500,
  DEFAULT_ALLOWED_EXTENSIONS: Object.freeze([
    ".zip",
    ".kmz",
    ".json",
    ".geojson",
    ".gml",
  ] as const),
  DEFAULT_ALLOWED_MIME_TYPES: Object.freeze(
    new Set(
      [
        "application/zip",
        "application/x-zip-compressed",
        "application/vnd.google-earth.kmz",
        "application/json",
        "application/geo+json",
        "application/gml+xml",
        "text/plain",
        "",
      ].map((type) => type.toLowerCase())
    )
  ),
  FILE_DISPLAY_KEYS: Object.freeze([
    "text",
    "path",
    "location",
    "value",
    "dataset",
    "defaultValue",
    "fileName",
    "filename",
    "file_path",
    "file",
    "uri",
    "url",
    "name",
  ] as const),
})

export const NETWORK_INDICATORS = Object.freeze([
  "failed to fetch",
  "networkerror",
  "net::",
  "dns",
  "enotfound",
  "econnrefused",
  "timeout",
  "name or service not known",
  "err_name_not_resolved",
  "unable to load",
  "/sharing/proxy",
  "proxy",
] as const)

export const PROXY_INDICATORS = Object.freeze([
  "unable to load",
  "/sharing/proxy",
  "proxy",
] as const)
