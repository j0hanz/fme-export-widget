import { WidgetState } from "jimu-core";
import {
  DrawingTool,
  FmeActionType,
  FormFieldType,
  ParameterType,
  ViewMode,
} from "./enums";
import type {
  ErrorMappingRules,
  EsriMockKey,
  ServiceMode,
  StateTransitionConfig,
  TextInputTypeName,
  UnitConversion,
} from "./types";

// =============================================================================
// REDUX ACTIONS
// =============================================================================

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

// =============================================================================
// VIEW & ROUTING
// =============================================================================

export const VIEW_ROUTES: { readonly [key in ViewMode]: ViewMode } = {
  [ViewMode.STARTUP_VALIDATION]: ViewMode.STARTUP_VALIDATION,
  [ViewMode.EXPORT_FORM]: ViewMode.WORKSPACE_SELECTION,
  [ViewMode.WORKSPACE_SELECTION]: ViewMode.INITIAL,
  [ViewMode.EXPORT_OPTIONS]: ViewMode.INITIAL,
  [ViewMode.ORDER_RESULT]: ViewMode.INITIAL,
  [ViewMode.DRAWING]: ViewMode.INITIAL,
  [ViewMode.INITIAL]: ViewMode.INITIAL,
};

export const DEFAULT_LOADING_STATE = Object.freeze({
  modules: false,
  submission: false,
  workspaces: false,
  parameters: false,
  geometryValidation: false,
} as const);

// =============================================================================
// ARCGIS & ESRI
// =============================================================================

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

export const ESRI_GLOBAL_MOCK_KEYS = Object.freeze([
  "esriRequest",
  "esriConfig",
  "projection",
  "webMercatorUtils",
  "SpatialReference",
] as const);

export const ESRI_MOCK_FALLBACKS: Readonly<{ [K in EsriMockKey]: unknown }> =
  Object.freeze({
    esriRequest: () => Promise.resolve({ data: null }),
    esriConfig: { request: { maxUrlLength: 4000, interceptors: [] } },
    projection: {},
    webMercatorUtils: {},
    SpatialReference: () => ({}),
  });

export const LAYER_CONFIG = Object.freeze({
  title: "",
  listMode: "hide",
  elevationInfo: { mode: "on-the-ground" },
});

// =============================================================================
// DRAWING & GEOMETRY
// =============================================================================

export const DEFAULT_DRAWING_HEX = "#0079C1";
export const DEFAULT_OUTLINE_WIDTH = 2;
export const DEFAULT_FILL_OPACITY = 0.25;

export const DRAWING_MODE_TABS = Object.freeze([
  {
    value: DrawingTool.POLYGON,
    label: "optPolygon",
    icon: "polygon",
    tooltip: "tipDrawPolygon",
    hideLabel: true,
  },
  {
    value: DrawingTool.RECTANGLE,
    label: "optRectangle",
    icon: "rectangle",
    tooltip: "tipDrawRectangle",
    hideLabel: true,
  },
] as const);

export const WKID = Object.freeze({
  WGS84: 4326,
  WEB_MERCATOR: 3857,
});

export const GEODESIC_SEGMENT_LENGTH_METERS = 50;
export const MIN_PLANAR_SEGMENT_DEGREES = 1e-6;
export const DEGREES_PER_METER = 1 / 111319.49079327358;

export const GEOMETRY_CONSTS = Object.freeze({
  M2_PER_KM2: 1_000_000,
  AREA_DECIMALS: 2,
  METERS_PER_KILOMETER: 1_000,
  SQUARE_FEET_PER_SQUARE_MILE: 27_878_400,
  VERTICES_PER_MS_ESTIMATE: 100,
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

// =============================================================================
// FME FLOW API
// =============================================================================

export const FME_FLOW_API = Object.freeze({
  BASE_PATH: "/fmeapiv4",
  MAX_URL_LENGTH: 4000,
  WEBHOOK_EXCLUDE_KEYS: [] as const,
  WEBHOOK_LOG_WHITELIST: Object.freeze([
    "opt_responseformat",
    "opt_showresult",
    "opt_servicemode",
    "tm_ttc",
    "tm_ttl",
    "tm_tag",
  ] as const),
  JOB_RESULT_POLL_INTERVAL_MS: 2000,
  JOB_RESULT_MAX_WAIT_MS: 300000,
  JOB_RESULT_LONG_POLL_INTERVAL_SEC: 10,
  TEMP_RESOURCE_CONNECTION: "Temp",
});

export const FME_ENDPOINT_PATTERN =
  /\/(?:fmedatadownload|fmedataupload|fmeapiv4)\b/i;

export const ALLOWED_SERVICE_MODES: readonly ServiceMode[] = Object.freeze([
  "sync",
  "async",
] as const);

export const FAST_TM_TAG = "fast";

export const TM_PARAM_KEYS = Object.freeze([
  "tm_ttc",
  "tm_ttl",
  "tm_tag",
] as const);

export const TM_NUMERIC_PARAM_KEYS = Object.freeze([
  "tm_ttc",
  "tm_ttl",
] as const);

export const V4_PARAMETER_TYPE_MAP: Readonly<{
  readonly [key: string]: string;
}> = Object.freeze({
  text: "TEXT",
  string: "STRING",
  text_edit: "TEXT_EDIT",
  textedit: "TEXT_EDIT",
  textarea: "TEXT_EDIT",
  password: "PASSWORD",
  url: "URL",
  integer: "INTEGER",
  int: "INTEGER",
  float: "FLOAT",
  number: "FLOAT",
  decimal: "FLOAT",
  boolean: "BOOLEAN",
  bool: "BOOLEAN",
  checkbox: "CHECKBOX",
  choice: "CHOICE",
  dropdown: "CHOICE",
  select: "CHOICE",
  listbox: "LISTBOX",
  lookup_choice: "LOOKUP_CHOICE",
  lookup_listbox: "LOOKUP_LISTBOX",
  tree: "SCRIPTED",
  range: "RANGE_SLIDER",
  filename: "FILENAME",
  file: "FILENAME",
  filename_mustexist: "FILENAME_MUSTEXIST",
  dirname: "DIRNAME",
  directory: "DIRNAME",
  dirname_mustexist: "DIRNAME_MUSTEXIST",
  dirname_src: "DIRNAME_SRC",
  lookup_file: "LOOKUP_FILE",
  date: "DATE",
  time: "TIME",
  datetime: "DATETIME",
  date_time: "DATE_TIME",
  month: "MONTH",
  week: "WEEK",
  color: "COLOR",
  colour: "COLOR",
  color_pick: "COLOR_PICK",
  colorpick: "COLOR_PICK",
  coordsys: "COORDSYS",
  coordinate_system: "COORDSYS",
  geometry: "GEOMETRY",
  message: "MESSAGE",
  range_slider: "RANGE_SLIDER",
  slider: "RANGE_SLIDER",
  text_or_file: "TEXT_OR_FILE",
  attribute_name: "ATTRIBUTE_NAME",
  attribute_list: "ATTRIBUTE_LIST",
  db_connection: "DB_CONNECTION",
  web_connection: "WEB_CONNECTION",
  reprojection_file: "REPROJECTION_FILE",
  scripted: "SCRIPTED",
  group: "GROUP",
});

export const OPTIONAL_OPT_KEYS = Object.freeze([
  "opt_servicemode",
  "opt_responseformat",
  "opt_showresult",
  "opt_requesteremail",
] as const);

export const WEBHOOK_EXCLUDE_PARAMS = Object.freeze([
  ...FME_FLOW_API.WEBHOOK_EXCLUDE_KEYS,
] as const);

export const PUBLISHED_PARAM_EXCLUDE_SET: ReadonlySet<string> = new Set([
  ...TM_PARAM_KEYS,
  ...OPTIONAL_OPT_KEYS,
]);

// =============================================================================
// WORKSPACE & PARAMETERS
// =============================================================================

export const WORKSPACE_ITEM_TYPE = "workspace";
export const DEFAULT_REPOSITORY = "_";
export const EMPTY_WORKSPACES = Object.freeze([]);

export const PREFETCH_CONFIG = Object.freeze({
  DEFAULT_CHUNK_SIZE: 5,
  MIN_CHUNK_SIZE: 1,
  MAX_CHUNK_SIZE: 15,
} as const);

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
    ParameterType.listbox,
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

export const V4_TYPE_MAP = Object.freeze({
  FLOAT: "number",
  INTEGER: "number",
  BOOLEAN: "boolean",
  STRING: "text",
  TEXT: "text",
} as const);

export const MAX_SEPARATOR_LENGTH = 64;
export const DEFAULT_SEPARATOR_REGEX = /\|/;
export const NO_SLIDER_KEYWORDS = Object.freeze([
  "no slider",
  "noslider",
  "without slider",
] as const);

// =============================================================================
// FILE UPLOAD & HANDLING
// =============================================================================

export const UPLOAD_PARAM_TYPES = Object.freeze([
  "FILENAME",
  "FILENAME_MUSTEXIST",
  "DIRNAME",
  "DIRNAME_MUSTEXIST",
  "DIRNAME_SRC",
  "LOOKUP_FILE",
  "REPROJECTION_FILE",
] as const);

export const FILE_UPLOAD = Object.freeze({
  DEFAULT_MAX_SIZE_MB: 150,
  ONE_MB_IN_BYTES: 1024 * 1024,
  GEOMETRY_PREVIEW_MAX_LENGTH: 1500,
  MAX_FILENAME_LENGTH: 128,
  MAX_NAMESPACE_LENGTH: 64,
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

export const ALLOWED_FILE_EXTENSIONS = /\.(zip|kmz|json|geojson|gml)(\?.*)?$/i;

// =============================================================================
// FORM FIELDS & UI COMPONENTS
// =============================================================================

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

export const TEXT_INPUT_TYPES: readonly TextInputTypeName[] = Object.freeze([
  "text",
  "email",
  "tel",
  "search",
  "password",
  "number",
] as const);

export const PLACEHOLDER_KIND_MAP = Object.freeze({
  email: "phEmail",
  phone: "phPhone",
  search: "phSearch",
} as const);

// =============================================================================
// VALIDATION & LIMITS
// =============================================================================

export const VALIDATION_LIMITS = Object.freeze({
  MAX_TEXT_LENGTH: 5000,
  IPV4_OCTET_MAX: 255,
  IPV4_OCTET_MIN: 0,
  MAX_GEOMETRY_VERTICES: 5000,
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
    LARGE_AREA_MESSAGE_MAX: 200,
  },
});

export const LARGE_AREA_MESSAGE_CHAR_LIMIT = 200;

export const REQUIRED_CONFIG_FIELDS = Object.freeze([
  "fmeServerUrl",
  "fmeServerToken",
  "repository",
] as const);

export const MAX_VISIBILITY_REGEX_LENGTH = 512;
export const DEFAULT_MAX_PATTERN_LENGTH = 512;

// =============================================================================
// EMAIL & REGEX PATTERNS
// =============================================================================

export const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;
export const NO_REPLY_REGEX = /^no[-_]?reply@/i;
export const EMAIL_PLACEHOLDER = /\{\s*email\s*\}/i;

export const ISO_LOCAL_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
export const ISO_LOCAL_TIME = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/;
export const OFFSET_SUFFIX_RE = /(Z|[+-]\d{2}(?::?\d{2})?)$/i;
export const FRACTION_SUFFIX_RE = /\.(\d{1,9})$/;

export const ABORT_REGEX = /\baborted?\b/i;
export const ABORT_ERROR_NAMES = Object.freeze(
  new Set(["AbortError", "ABORT_ERR", "ERR_ABORTED"])
);

export const ERROR_LABEL_PATTERN =
  /^(?:error|fel|warning|varning|info)\s*[:\-–—]?\s*/i;

// =============================================================================
// NETWORK & HTTP
// =============================================================================

export const HTTP_STATUS_CODES = Object.freeze({
  OK: 200,
  ACCEPTED: 202,
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

export const NETWORK_CONFIG = Object.freeze({
  MAX_HISTORY_SIZE: 100,
  API_QUERY_LIMIT: 500,
  RANDOM_ID_LENGTH: 8,
  MAX_RETRY_ATTEMPTS: 3,
  MAX_CONCURRENT_PREFETCH: 6,
});

export const DEFAULT_NETWORK_CONFIG = Object.freeze({
  enabled: true,
  logLevel: "debug" as const,
  bodyPreviewLimit: 1024,
  warnSlowMs: 1000,
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

export const MAX_URL_LENGTH = 4000;

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

export const LOOPBACK_IPV6 = "0:0:0:0:0:0:0:1";

// =============================================================================
// SECURITY & PRIVACY
// =============================================================================

export const SENSITIVE_KEY_PATTERNS = Object.freeze([
  "token",
  "auth",
  "secret",
  "key",
  "password",
] as const);

export const REDACT_AUTH_REGEX = /authorization="?[^"]+"?/gi;
export const REDACT_TOKEN_REGEX = /(token|fmetoken)=([^&\s]+)/gi;

export const MIN_TOKEN_LENGTH = 10;

// =============================================================================
// TIME CONSTANTS
// =============================================================================

export const TIME_CONSTANTS = Object.freeze({
  SECOND: 1000,
  MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  TEN_MINUTES: 10 * 60 * 1000,
  MAX_RESPONSE_TIME: 300000,
  SLOW_REQUEST_THRESHOLD: 1000,
  DEBOUNCE_VALIDATION_MS: 300,
  AUTO_DOWNLOAD_DELAY_MS: 150,
  POPUP_CLOSE_DELAY_MS: 100,
  BLOB_URL_CLEANUP_DELAY_MS: 120000,
  STARTUP_TIMEOUT_MS: 15000,
  MIN_LOADING_DELAY_MS: 1000,
});

// =============================================================================
// UI CONFIGURATION
// =============================================================================

export const UI_CONFIG = Object.freeze({
  OPACITY_SCALE_FACTOR: 100,
  OUTLINE_WIDTH_SLIDER_MIN: 0,
  OUTLINE_WIDTH_SLIDER_MAX: 10,
  OUTLINE_WIDTH_MIN: 0.1,
  OUTLINE_WIDTH_MAX: 5,
  OUTLINE_WIDTH_INCREMENT: 0.5,
  OUTLINE_WIDTH_PRECISION: 10,
  AREA_INPUT_STEP: 1000,
  PERCENT_SLIDER_MAX: 100,
  ICON_SIZE_SMALL: 16,
  ICON_SIZE_MEDIUM: 18,
  ICON_SIZE_LARGE: 24,
  LOADING_SPINNER_SIZE: 32,
});

export const TOOLTIP_CONFIG = Object.freeze({
  DELAY_ENTER_MS: 500,
  DELAY_NEXT_MS: 300,
  DELAY_LEAVE_MS: 300,
  DELAY_TOUCH_MS: 700,
});

export const LOADING_UI_CONFIG = Object.freeze({
  DELAY_MS: 1000,
  DETAIL_DELAY_MS: 2000,
  CYCLE_INTERVAL_MS: 4000,
});

// =============================================================================
// WIDGET STATE TRANSITIONS
// =============================================================================

export const STATE_TRANSITIONS: Readonly<{
  readonly [key: string]: StateTransitionConfig;
}> = Object.freeze({
  TO_ACTIVE: {
    fromStates: [WidgetState.Closed, WidgetState.Hidden],
    toStates: [WidgetState.Opened, WidgetState.Active],
  },
  TO_INACTIVE: {
    fromStates: [WidgetState.Opened, WidgetState.Active],
    toStates: [WidgetState.Closed, WidgetState.Hidden],
  },
  TO_CLOSED: {
    fromStates: [WidgetState.Opened, WidgetState.Active],
    toStates: [WidgetState.Closed],
  },
  FROM_CLOSED: {
    fromStates: [WidgetState.Closed],
    toStates: [WidgetState.Opened, WidgetState.Active],
  },
});

// =============================================================================
// ICONS & VISUAL ELEMENTS
// =============================================================================

export const LOCAL_ICON_SOURCES = Object.freeze({
  error: "error.svg",
  map: "map.svg",
  polygon: "polygon.svg",
  rectangle: "rectangle.svg",
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

// =============================================================================
// ERROR HANDLING & MAPPING
// =============================================================================

export const ERROR_NAMES = Object.freeze({
  CANCELLED_PROMISE: "CancelledPromiseError",
  ABORT: "AbortError",
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

export const ERROR_MAPPING_RULES: ErrorMappingRules = Object.freeze({
  codeToKey: ERROR_CODE_TO_KEY,
  statusToKey: STATUS_TO_KEY_MAP,
  messagePatterns: MESSAGE_PATTERNS,
});

export const SERVER_URL_REASON_TO_KEY: { readonly [reason: string]: string } = {
  require_https: "require_https",
  no_query_or_hash: "invalid_url",
  invalid_url: "invalid_url",
};

export const STATUS_PROPERTIES = Object.freeze([
  "status",
  "statusCode",
  "httpStatus",
] as const);

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

// =============================================================================
// HTML & TEXT FORMATTING
// =============================================================================

export const HTML_ENTITY_MAP = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
} as const);

export const HTML_ENTITY_REGEX = /&(?:amp|lt|gt|quot|#39);/g;
export const MAX_HTML_CODE_POINT = 0x10ffff;

export const DETAIL_VALUE_LIMIT = 320;
export const DETAIL_MESSAGE_KEYS = Object.freeze([
  "message",
  "error",
  "detail",
  "description",
  "reason",
  "text",
] as const);

// =============================================================================
// DEBUGGING & LOGGING
// =============================================================================

export const DEBUG_STYLES = Object.freeze({
  success: "color: #28a745; font-weight: bold",
  info: "color: #007bff; font-weight: bold",
  warn: "color: #ffc107; font-weight: bold",
  error: "color: #dc3545; font-weight: bold",
  action: "color: #0078d4; font-weight: bold",
} as const);

// =============================================================================
// ALGORITHM & UTILITY CONSTANTS
// =============================================================================

export const VERSION_DETECTION_CONFIG = Object.freeze({
  MIN_YEAR: 2020,
  MAX_YEAR: 2100,
  MAX_MINOR_VERSION: 100,
});

export const HASH_CONFIG = Object.freeze({
  DJB2_INITIAL: 5381,
});

export const SAFETY_LIMITS = Object.freeze({
  MAX_WINDOW_HIERARCHY_ITERATIONS: 100,
});
