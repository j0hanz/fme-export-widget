import { FmeActionType, FormFieldType, ParameterType, ViewMode } from "./enums";
import type { ServiceMode, UnitConversion } from "./types";

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
] as const);

export const LAYER_CONFIG = Object.freeze({
  title: "",
  listMode: "hide",
  elevationInfo: { mode: "on-the-ground" },
});

export const DEFAULT_DRAWING_HEX = "#0079C1";
export const DEFAULT_OUTLINE_WIDTH = 2;
export const DEFAULT_FILL_OPACITY = 0.2;

export const UPLOAD_PARAM_TYPES = Object.freeze([
  "FILENAME",
  "FILENAME_MUSTEXIST",
  "DIRNAME",
  "DIRNAME_MUSTEXIST",
  "DIRNAME_SRC",
  "LOOKUP_FILE",
  "REPROJECTION_FILE",
] as const);

export const FME_FLOW_API = Object.freeze({
  BASE_PATH: "/fmeapiv4",
  MAX_URL_LENGTH: 4000,
  WEBHOOK_EXCLUDE_KEYS: [] as const,
  WEBHOOK_LOG_WHITELIST: Object.freeze([
    "opt_responseformat",
    "opt_showresult",
    "opt_servicemode",
  ] as const),
});

export const LARGE_AREA_MESSAGE_CHAR_LIMIT = 160;

export const VALIDATION_LIMITS = Object.freeze({
  MAX_TEXT_LENGTH: 10000,
  IPV4_OCTET_MAX: 255,
  IPV4_OCTET_MIN: 0,
  MAX_GEOMETRY_VERTICES: 10000,
  SLIDER_DEFAULT_MAX: 100,
  RGB_MAX: 255,
  RGB_MIN: 0,
} as const);

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
});

export const FAST_TM_TAG = "fast";

export const VIEW_ROUTES: { readonly [key in ViewMode]: ViewMode } = {
  [ViewMode.STARTUP_VALIDATION]: ViewMode.STARTUP_VALIDATION,
  [ViewMode.EXPORT_FORM]: ViewMode.WORKSPACE_SELECTION,
  [ViewMode.WORKSPACE_SELECTION]: ViewMode.INITIAL,
  [ViewMode.EXPORT_OPTIONS]: ViewMode.INITIAL,
  [ViewMode.ORDER_RESULT]: ViewMode.INITIAL,
  [ViewMode.DRAWING]: ViewMode.INITIAL,
  [ViewMode.INITIAL]: ViewMode.INITIAL,
};

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
] as const);

export const WORKSPACE_ITEM_TYPE = "workspace";

export const PREFETCH_CONFIG = Object.freeze({
  DEFAULT_CHUNK_SIZE: 10,
  MIN_CHUNK_SIZE: 1,
  MAX_CHUNK_SIZE: 25,
} as const);

export const ERROR_NAMES = Object.freeze({
  CANCELLED_PROMISE: "CancelledPromiseError",
  ABORT: "AbortError",
});

export const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;
export const NO_REPLY_REGEX = /no-?reply/i;
export const EMAIL_PLACEHOLDER = /\{\s*email\s*\}/i;

export const FORBIDDEN_HOSTNAME_SUFFIXES = Object.freeze([
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".home",
  ".lan",
  ".localdomain",
] as const);

export const PRIVATE_IPV4_RANGES = Object.freeze([
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255] },
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] },
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },
  { start: [0, 0, 0, 0], end: [0, 255, 255, 255] },
] as const);

export const ALLOWED_FILE_EXTENSIONS = /\.(zip|kmz|json|geojson|gml)(\?.*)?$/i;
export const MAX_URL_LENGTH = 4000;

export const ABORT_REGEX = /abort/i;

export const TM_PARAM_KEYS = Object.freeze([
  "tm_ttc",
  "tm_ttl",
  "tm_tag",
] as const);

export const TM_NUMERIC_PARAM_KEYS = Object.freeze([
  "tm_ttc",
  "tm_ttl",
] as const);

export const OPTIONAL_OPT_KEYS = Object.freeze([
  "opt_servicemode",
  "opt_responseformat",
  "opt_showresult",
  "opt_requesteremail",
] as const);

export const WEBHOOK_EXCLUDE_PARAMS = Object.freeze([
  ...FME_FLOW_API.WEBHOOK_EXCLUDE_KEYS,
  ...TM_PARAM_KEYS,
] as const);

export const PUBLISHED_PARAM_EXCLUDE_SET: ReadonlySet<string> = new Set([
  ...TM_PARAM_KEYS,
  ...OPTIONAL_OPT_KEYS,
]);

export const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = Object.freeze([
  "sync",
  "async",
] as const);

export const GEOMETRY_CONSTS = Object.freeze({
  M2_PER_KM2: 1_000_000,
  AREA_DECIMALS: 2,
  METERS_PER_KILOMETER: 1_000,
  SQUARE_FEET_PER_SQUARE_MILE: 27_878_400,
});

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
] as const);

export const DEFAULT_ERROR_ICON = "error";

export const ICON_BY_EXACT_CODE = Object.freeze<{
  readonly [code: string]: string;
}>({
  GEOMETRY_SERIALIZATION_FAILED: "polygon",
  MAP_MODULES_LOAD_FAILED: "map",
  FORM_INVALID: "warning",
});

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
] as const);

export const MIN_TOKEN_LENGTH = 10;

export const WKID = Object.freeze({
  WGS84: 4326,
  WEB_MERCATOR: 3857,
});

export const GEODESIC_SEGMENT_LENGTH_METERS = 50;
export const MIN_PLANAR_SEGMENT_DEGREES = 1e-6;
export const DEGREES_PER_METER = 1 / 111319.49079327358;

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
});

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
});

// HTTP Status Classification Helpers
export const isSuccessStatus = (status?: number): boolean =>
  typeof status === "number" &&
  status >= HTTP_STATUS_RANGES.SUCCESS_MIN &&
  status <= HTTP_STATUS_RANGES.SUCCESS_MAX;

export const isServerError = (status?: number): boolean =>
  typeof status === "number" && status >= HTTP_STATUS_RANGES.SERVER_ERROR_MIN;

export const isClientError = (status?: number): boolean =>
  typeof status === "number" &&
  status >= HTTP_STATUS_RANGES.CLIENT_ERROR_MIN &&
  status <= HTTP_STATUS_RANGES.CLIENT_ERROR_MAX;

export const isHttpStatus = (n: unknown): n is number =>
  typeof n === "number" &&
  n >= HTTP_STATUS_RANGES.MIN_VALID &&
  n <= HTTP_STATUS_RANGES.MAX_VALID;

export const isRetryableStatus = (status?: number): boolean => {
  if (!status || status < HTTP_STATUS_RANGES.MIN_VALID) return true;
  if (isServerError(status)) return true;
  return (
    status === HTTP_STATUS_CODES.TIMEOUT ||
    status === HTTP_STATUS_CODES.TOO_MANY_REQUESTS
  );
};

// =============================================================================
// TIME CONSTANTS
// =============================================================================
// Time Constants (milliseconds)
export const TIME_CONSTANTS = Object.freeze({
  SECOND: 1000,
  MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  TEN_MINUTES: 10 * 60 * 1000,
  MAX_RESPONSE_TIME: 300000, // 5 minutes
  SLOW_REQUEST_THRESHOLD: 1000, // 1 second
  DEBOUNCE_VALIDATION_MS: 800, // Validation debounce delay
  AUTO_DOWNLOAD_DELAY_MS: 100, // Delay before auto-download
  POPUP_CLOSE_DELAY_MS: 50, // Delay before closing popups
  BLOB_URL_CLEANUP_DELAY_MS: 60000, // 1 minute delay before revoking blob URLs
  STARTUP_TIMEOUT_MS: 30000, // 30 seconds for startup validation
  MIN_LOADING_DELAY_MS: 500, // Minimum delay to show loading state (prevents flashing)
});

// Network Configuration
export const NETWORK_CONFIG = Object.freeze({
  MAX_HISTORY_SIZE: 50, // Maximum network request logs to keep
  API_QUERY_LIMIT: 1000, // Default limit for API queries
  RANDOM_ID_LENGTH: 8, // Length of random ID strings (slice produces 8 chars from position 2)
});

// UI Configuration
export const UI_CONFIG = Object.freeze({
  OPACITY_SCALE_FACTOR: 100, // Convert 0-1 opacity to 0-100%
  OUTLINE_WIDTH_SLIDER_MIN: 0, // Minimum outline width slider value
  OUTLINE_WIDTH_SLIDER_MAX: 10, // Maximum outline width slider value
  OUTLINE_WIDTH_MIN: 0.1, // Minimum actual outline width in pixels
  OUTLINE_WIDTH_MAX: 5, // Maximum actual outline width in pixels
  OUTLINE_WIDTH_INCREMENT: 0.5, // Outline width step increment
  OUTLINE_WIDTH_PRECISION: 10, // Decimal precision for outline width (tenths)
  AREA_INPUT_STEP: 10000, // Step size for area input fields
  PERCENT_SLIDER_MAX: 100, // Maximum value for percentage sliders
});

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
  HTTPS_REQUIRED: "require_https",
  INVALID_REQUEST_URL: "invalid_url",
  GEOMETRY_MISSING: "geometryMissingCode",
  GEOMETRY_TYPE_INVALID: "geometryTypeInvalidCode",
  GEOMETRY_SERIALIZATION_FAILED: "geometrySerializationFailedCode",
  URL_TOO_LONG: "urlTooLongMessage",
  WEBHOOK_URL_TOO_LONG: "urlTooLongMessage",
  PARAMETER_VALIDATION_ERROR: "errorParameterValidation",
  WORKSPACE_PARAMETERS_ERROR: "errorWorkspaceParameters",
};

export const STATUS_TO_KEY_MAP: { readonly [status: number]: string } = {
  401: "errorTokenIssue",
  408: "requestTimedOut",
  429: "rateLimitExceeded",
  431: "headersTooLargeMessage",
};

export const MESSAGE_PATTERNS = Object.freeze([
  { pattern: /timeout/i, key: "requestTimedOut" },
  { pattern: /cors/i, key: "corsBlocked" },
  { pattern: /url.*too/i, key: "urlTooLongMessage" },
  {
    pattern: /remote_dataset_workspace_required/i,
    key: "REMOTE_DATASET_WORKSPACE_REQUIRED",
  },
] as const);

export const SERVER_URL_REASON_TO_KEY: { readonly [reason: string]: string } = {
  require_https: "require_https",
  no_query_or_hash: "invalid_url",
  invalid_url: "invalid_url",
};

export const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "fmeServerUrl",
  "fmeServerToken",
  "repository",
] as const);

export const STATUS_PROPERTIES = Object.freeze([
  "status",
  "statusCode",
  "httpStatus",
] as const);

export const DEFAULT_REPOSITORY = "_";

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
);

export const ALWAYS_SKIPPED_TYPES = Object.freeze(
  new Set<ParameterType>([
    ParameterType.NOVALUE,
    ParameterType.GROUP,
    ParameterType.group,
  ])
);

export const LIST_REQUIRED_TYPES = Object.freeze(
  new Set<ParameterType>([
    ParameterType.DB_CONNECTION,
    ParameterType.WEB_CONNECTION,
    ParameterType.ATTRIBUTE_NAME,
    ParameterType.ATTRIBUTE_LIST,
    ParameterType.COORDSYS,
    ParameterType.REPROJECTION_FILE,
  ])
);

export const MULTI_SELECT_TYPES = Object.freeze(
  new Set<ParameterType>([
    ParameterType.LISTBOX,
    ParameterType.LOOKUP_LISTBOX,
    ParameterType.ATTRIBUTE_LIST,
    ParameterType.listbox, // FME V4
  ])
);

export const PARAMETER_FIELD_TYPE_MAP: Readonly<{
  [K in ParameterType]?: FormFieldType;
}> = Object.freeze({
  [ParameterType.text]: FormFieldType.TEXT,
  [ParameterType.number]: FormFieldType.NUMBER,
  [ParameterType.checkbox]: FormFieldType.CHECKBOX,
  [ParameterType.dropdown]: FormFieldType.RADIO,
  [ParameterType.listbox]: FormFieldType.MULTI_SELECT,
  [ParameterType.tree]: FormFieldType.SELECT,
  [ParameterType.password]: FormFieldType.PASSWORD,
  [ParameterType.datetime]: FormFieldType.DATE_TIME,
  [ParameterType.message]: FormFieldType.MESSAGE,
  [ParameterType.group]: FormFieldType.HIDDEN,
  [ParameterType.file]: FormFieldType.FILE,
  [ParameterType.color]: FormFieldType.COLOR,
  [ParameterType.range]: FormFieldType.SLIDER,
  [ParameterType.FLOAT]: FormFieldType.NUMERIC_INPUT,
  [ParameterType.INTEGER]: FormFieldType.NUMBER,
  [ParameterType.TEXT_EDIT]: FormFieldType.TEXTAREA,
  [ParameterType.PASSWORD]: FormFieldType.PASSWORD,
  [ParameterType.BOOLEAN]: FormFieldType.SWITCH,
  [ParameterType.CHECKBOX]: FormFieldType.SWITCH,
  [ParameterType.CHOICE]: FormFieldType.RADIO,
  [ParameterType.LOOKUP_CHOICE]: FormFieldType.RADIO,
  [ParameterType.LISTBOX]: FormFieldType.MULTI_SELECT,
  [ParameterType.LOOKUP_LISTBOX]: FormFieldType.MULTI_SELECT,
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
});

export const ESRI_GLOBAL_MOCK_KEYS = Object.freeze([
  "esriRequest",
  "esriConfig",
  "projection",
  "webMercatorUtils",
  "SpatialReference",
] as const);

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
});

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
] as const);

export const PROXY_INDICATORS = Object.freeze([
  "unable to load",
  "/sharing/proxy",
  "proxy",
] as const);

// =============================================================================
// SCATTERED CONSTANTS CONSOLIDATED FROM CODEBASE
// =============================================================================

// From: shared/api.ts
export const DEFAULT_NETWORK_CONFIG = Object.freeze({
  enabled: true,
  logLevel: "debug" as const,
  bodyPreviewLimit: 1024,
  warnSlowMs: TIME_CONSTANTS.SLOW_REQUEST_THRESHOLD,
});

export const SENSITIVE_KEY_PATTERNS = Object.freeze([
  "token",
  "auth",
  "secret",
  "key",
  "password",
] as const);

export const REDACT_AUTH_REGEX = /authorization="?[^"]+"?/gi;
export const REDACT_TOKEN_REGEX = /(token|fmetoken)=([^&\s]+)/gi;

export const DETAIL_VALUE_LIMIT = 256;
export const DETAIL_MESSAGE_KEYS = Object.freeze([
  "message",
  "detail",
  "statusText",
] as const);

export const V4_TYPE_MAP = Object.freeze({
  FLOAT: "number",
  INTEGER: "number",
  BOOLEAN: "boolean",
  STRING: "text",
  TEXT: "text",
} as const);

export const ESRI_MOCK_FALLBACKS = Object.freeze({
  esriRequest: null,
  esriConfig: {},
  projection: null,
  webMercatorUtils: null,
  SpatialReference: null,
} as const);

export const FME_ENDPOINT_PATTERN =
  /\/fmeapiv[34]\/repositories\/[^/]+\/items\/[^/]+\/run/i;

// From: shared/utils/conversion.ts
export const PLACEHOLDER_KIND_MAP = Object.freeze({
  email: "phEmail",
  phone: "phPhone",
  search: "phSearch",
} as const);

// From: shared/utils/error.ts (duplicates removed - already in main constants)
// DEFAULT_ERROR_ICON, ICON_BY_EXACT_CODE, TOKEN_ICON_PRIORITY, ABORT_REGEX are already in constants.ts

export const ABORT_ERROR_NAMES = Object.freeze(
  new Set(["AbortError", "ABORT_ERR", "ERR_ABORTED"])
);

// From: runtime/components/fields.tsx
export const SELECT_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  "SELECT" as FormFieldType,
  "COORDSYS" as FormFieldType,
  "ATTRIBUTE_NAME" as FormFieldType,
  "DB_CONNECTION" as FormFieldType,
  "WEB_CONNECTION" as FormFieldType,
  "REPROJECTION_FILE" as FormFieldType,
]);

export const MULTI_VALUE_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  "MULTI_SELECT" as FormFieldType,
  "ATTRIBUTE_LIST" as FormFieldType,
]);

export const TEXT_OR_FILE_MODES = Object.freeze({
  TEXT: "text" as const,
  FILE: "file" as const,
});

// From: shared/utils/fme.ts
// ALLOWED_SERVICE_MODES already defined in main constants, moved to avoid duplication

export const LOOPBACK_IPV6 = "::1";

// From: shared/utils/format.ts
export const HTML_ENTITY_MAP = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
} as const);

export const HTML_ENTITY_REGEX = /&(?:amp|lt|gt|quot|#39);/g;
export const MAX_HTML_CODE_POINT = 0x10ffff;

export const ERROR_LABEL_PATTERN =
  /^(?:error|fel|warning|varning|info)\s*[:\-–—]?\s*/i;

export const ISO_LOCAL_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
export const ISO_LOCAL_TIME = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/;

export const OFFSET_SUFFIX_RE = /[+-]\d{2}:\d{2}$/;
export const FRACTION_SUFFIX_RE = /\.\d{1,3}$/;

// GEOMETRY_CONSTS and UNIT_CONVERSIONS already defined in main constants

// From: shared/services/logging.ts
export const DEBUG_STYLES = Object.freeze({
  section: "font-weight: bold; color: #0066cc; font-size: 1.2em",
  subsection: "font-weight: bold; color: #0088cc",
  success: "color: #00cc00",
  warning: "color: #ff9900",
  error: "color: #cc0000",
  info: "color: #666666",
  dim: "color: #999999",
} as const);

// From: shared/services/parameters.ts
export const MAX_SEPARATOR_LENGTH = 64;
export const DEFAULT_SEPARATOR_REGEX = /\|/;
export const NO_SLIDER_KEYWORDS = Object.freeze([
  "no slider",
  "noslider",
  "without slider",
] as const);

// From: shared/utils/regex.ts
export const DEFAULT_MAX_PATTERN_LENGTH = 512;

// From: extensions/store.ts
export const ERROR_SEVERITY_RANK = Object.freeze({
  ERROR: 3,
  WARNING: 2,
  INFO: 1,
} as const);

export const ERROR_SCOPE_PRIORITY = Object.freeze({
  general: 0,
  export: 1,
  import: 2,
} as const);

// From: runtime/components/ui.tsx
export const LOCAL_ICON_SOURCES = Object.freeze({
  error: "error.svg",
  map: "map.svg",
  polygon: "polygon.svg",
  warning: "warning.svg",
  "person-lock": "person-lock.svg",
  folder: "folder.svg",
  data: "data.svg",
  "shared-no": "shared-no.svg",
  "feature-service": "feature-service.svg",
  "link-tilted": "link-tilted.svg",
  time: "time.svg",
  setting: "setting.svg",
  email: "email.svg",
  info: "info.svg",
  success: "success.svg",
} as const);

export const ALERT_ICON_MAP = Object.freeze({
  warning: "warning",
  error: "error",
  info: "info",
  success: "success",
} as const);

export const TEXT_INPUT_TYPES = Object.freeze([
  "text",
  "email",
  "tel",
  "search",
  "password",
  "number",
] as const);

// From: shared/validations.ts (NO_REPLY_REGEX moved here for centralization)
// Already present as NO_REPLY_REGEX in main constants

// From: shared/visibility.ts
export const MAX_VISIBILITY_REGEX_LENGTH = 512;

// From: runtime/components/workflow.tsx
export const DRAWING_MODE_TABS = Object.freeze([
  {
    value: "POLYGON" as const,
    label: "optPolygon",
    icon: "polygon.svg",
    tooltip: "tipDrawPolygon",
    hideLabel: true,
  },
  {
    value: "RECTANGLE" as const,
    label: "optRectangle",
    icon: "rectangle.svg",
    tooltip: "tipDrawRectangle",
    hideLabel: true,
  },
] as const);

export const EMPTY_WORKSPACES = Object.freeze([]);

export const DEFAULT_LOADING_STATE = Object.freeze({
  modules: false,
  submission: false,
  workspaces: false,
  parameters: false,
  geometryValidation: false,
} as const);
