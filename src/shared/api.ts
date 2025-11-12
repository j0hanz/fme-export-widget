import { isRetryableStatus, isSuccessStatus } from "../config/constants";
import type {
  AbortListenerRecord,
  ApiResponse,
  ErrorDetailInput,
  EsriMockKey,
  EsriRequestConfig,
  FmeExportConfig,
  FmeFlowConfig,
  InstrumentedRequestOptions,
  JobResult,
  NetworkConfig,
  NMDirectives,
  PrimitiveParams,
  RequestConfig,
  RequestLog,
  TMDirectives,
  WebhookErrorCode,
  WorkspaceParameter,
} from "../config/index";
import {
  ESRI_GLOBAL_MOCK_KEYS,
  FME_FLOW_API,
  FmeFlowApiError,
  HttpMethod,
  PUBLISHED_PARAM_EXCLUDE_SET,
} from "../config/index";
import { conditionalLog } from "./services/logging";
import {
  buildUrl,
  createHostPattern,
  extractErrorMessage,
  extractHostFromUrl,
  extractRepositoryNames,
  interceptorExists,
  isJson,
  loadArcgisModules,
  makeScopeId,
  parseNonNegativeInt,
  safeLogParams,
  safeParseUrl,
  toNonEmptyTrimmedString,
  toTrimmedString,
} from "./utils";
import {
  isAbortError,
  mapErrorFromNetwork,
  safeAbortController,
} from "./utils/error";
import { createWebhookArtifacts } from "./utils/fme";
import {
  extractHttpStatus,
  isRetryableError,
  validateRequiredConfig,
} from "./validations";

// Configuration
/* Standardkonfiguration för nätverksinstrumentering */
const DEFAULT_CONFIG: NetworkConfig = {
  enabled: true,
  logLevel: "debug",
  bodyPreviewLimit: 1024,
  warnSlowMs: 1000,
};

const config: NetworkConfig = { ...DEFAULT_CONFIG };

// Network history buffer för debugging
const networkHistory: RequestLog[] = [];
const MAX_NETWORK_HISTORY = 50;

function addToNetworkHistory(log: RequestLog): void {
  networkHistory.push(log);
  while (networkHistory.length > MAX_NETWORK_HISTORY) {
    networkHistory.shift();
  }
}

export function getNetworkHistory(): readonly RequestLog[] {
  return [...networkHistory];
}

export function clearNetworkHistory(): void {
  networkHistory.length = 0;
}

// Instrumenterar HTTP-förfrågan med logging och timing
export async function instrumentedRequest<T>(
  options: InstrumentedRequestOptions<T>
): Promise<T> {
  if (!config.enabled) return options.execute();

  const method = options.method.toUpperCase();
  const correlationId = options.correlationId || createCorrelationId();
  const startMs = Date.now();

  try {
    const response = await options.execute();

    const durationMs = Date.now() - startMs;
    const safeDuration =
      Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    // Extraherar status och ok-flagga från svar via interpreter
    const status = options.responseInterpreter?.status?.(response);
    const ok = options.responseInterpreter?.ok?.(response) ?? inferOk(status);
    const responseSize = options.responseInterpreter?.size?.(response);

    const log: RequestLog = {
      timestamp: startMs,
      method,
      url: sanitizeUrl(options.url, options.query),
      path: extractPath(options.url),
      status,
      ok,
      durationMs: safeDuration,
      correlationId,
      caller: options.caller,
      transport: options.transport,
      retryAttempt: options.retryAttempt,
      responseSize,
      isAbort: false,
    };

    logRequest("success", log, options.body);
    addToNetworkHistory(log);
    return response;
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const safeDuration =
      Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    const status = extractHttpStatus(error);
    // Kontrollerar om förfrågan avbröts av användare
    const isAbort = isAbortError(error);

    const log: RequestLog = {
      timestamp: startMs,
      method,
      url: sanitizeUrl(options.url, options.query),
      path: extractPath(options.url),
      status,
      ok: false,
      durationMs: safeDuration,
      correlationId,
      caller: options.caller,
      transport: options.transport,
      retryAttempt: options.retryAttempt,
      isAbort,
    };

    logRequest("error", log, options.body, error);
    addToNetworkHistory(log);
    throw error instanceof Error
      ? error
      : new Error(extractErrorMessage(error));
  }
}

// Skapar unikt korrelations-ID för request-spårning
export function createCorrelationId(prefix = "net"): string {
  const timestamp = Date.now().toString(36);
  let random = Math.random().toString(36).slice(2, 10);
  // Säkerställer minst 8 tecken för unikhet
  while (random.length < 8) {
    random += Math.random().toString(36).slice(2);
  }
  return `${prefix}_${timestamp}_${random.slice(0, 8)}`;
}

/* URL-sanitering och parametervald */

// URL & Parameter Sanitization
// Sanerar URL och query-parametrar, maskerar känsliga värden
function sanitizeUrl(
  url: string,
  query?: PrimitiveParams | URLSearchParams | string | null
): string {
  const parsed = parseUrl(url);
  const params = buildSearchParams(parsed, query);
  const sanitized = sanitizeParams(params);
  const search = serializeParams(sanitized);

  if (!parsed) {
    const base = redactSensitiveText(url.split("?")[0] || "");
    return search ? `${base}?${search}` : base;
  }

  const base = `${parsed.origin}${parsed.pathname}`;
  return search ? `${base}?${search}` : base;
}

// Parsar URL-sträng till URL-objekt med felhantering
function parseUrl(url: string): URL | null {
  if (!url) return null;
  try {
    const parsed = safeParseUrl(url);
    if (parsed) return parsed;
    return new URL(url, "http://localhost");
  } catch {
    return null;
  }
}

// Extraherar sökväg från URL (utan query-string)
function extractPath(url: string): string {
  const parsed = parseUrl(url);
  return parsed?.pathname || url.split("?")[0] || url;
}

// Bygger URLSearchParams från URL och ytterligare query-parameter
function buildSearchParams(
  parsed: URL | null,
  query?: PrimitiveParams | URLSearchParams | string | null
): URLSearchParams {
  const params = new URLSearchParams(parsed?.search || "");
  if (!query) return params;

  if (typeof query === "string") {
    const extra = new URLSearchParams(query);
    extra.forEach((value, key) => {
      params.set(key, value);
    });
    return params;
  }

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => {
      params.set(key, value);
    });
    return params;
  }

  Object.entries(query).forEach(([key, value]) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      params.delete(key);
      value.forEach((v) => {
        params.append(key, String(v));
      });
    } else {
      const stringValue =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      params.set(key, stringValue);
    }
  });

  return params;
}

// Sanerar URLSearchParams, maskerar känsliga nycklar (token, auth, etc.)
function sanitizeParams(params: URLSearchParams): URLSearchParams {
  const sanitized = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (isSensitiveKey(key.toLowerCase())) {
      sanitized.set(key, "[TOKEN]");
    } else {
      sanitized.set(key, redactSensitiveText(value));
    }
  }
  return sanitized;
}

// Serialiserar URLSearchParams till query-sträng, sorterad alfabetiskt
function serializeParams(params: URLSearchParams): string {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    entries.push([key, value]);
  }
  entries.sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0));
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// Kontrollerar om parameter-nyckel är känslig (innehåller token/auth/etc.)
function isSensitiveKey(key: string): boolean {
  return (
    key.includes("token") ||
    key.includes("auth") ||
    key.includes("secret") ||
    key.includes("key") ||
    key.includes("password")
  );
}

// Maskerar känsliga värden i fritext (auth-headers, tokens i URL)
function redactSensitiveText(text: string): string {
  let result = text;
  result = result.replace(
    /authorization="?[^"]+"?/gi,
    'authorization="[TOKEN]"'
  );
  result = result.replace(/(token|fmetoken)=([^&\s]+)/gi, "$1=[TOKEN]");
  return result;
}

/* Body-hantering för logging */

// Body Handling
// Beskriver request-body för logging (trunkerar och maskerar känsligt)
function describeBody(body: unknown): string {
  if (body == null) return "";

  if (typeof body === "string") {
    const sanitized = redactSensitiveText(body);
    return truncate(sanitized, config.bodyPreviewLimit);
  }

  if (typeof body === "object") {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      return "[FormData]";
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return `[Blob:${body.size}]`;
    }
    if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
      const size =
        body instanceof ArrayBuffer
          ? body.byteLength
          : body.buffer?.byteLength || 0;
      return `[Binary:${size}]`;
    }
  }

  try {
    const serialized = JSON.stringify(body);
    const sanitized = redactSensitiveText(serialized);
    return truncate(sanitized, config.bodyPreviewLimit);
  } catch {
    return "[Object]";
  }
}

// Trunkerar text till maxlängd, lägger till ellips
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

/* Logging */

// Logging
// Loggar HTTP-förfrågan med saniterad info
function logRequest(
  phase: "success" | "error",
  log: RequestLog,
  body?: unknown,
  error?: unknown
): void {
  if (config.logLevel === "silent") return;

  const bodyPreview = body ? describeBody(body) : undefined;
  const errorMessage = error ? extractErrorMessage(error) : undefined;

  try {
    if (config.logLevel === "debug") {
      const icon = phase === "success" ? "✓" : "✗";
      const payload: { [key: string]: unknown } = {
        phase,
        method: log.method,
        url: log.url,
        status: log.status,
        durationMs: log.durationMs,
        correlationId: log.correlationId,
        caller: log.caller,
        transport: log.transport,
      };
      if (log.responseSize !== undefined)
        payload.responseSize = log.responseSize;
      if (log.retryAttempt !== undefined) payload.retry = log.retryAttempt;
      if (log.isAbort) payload.aborted = true;
      if (bodyPreview) payload.body = bodyPreview;
      if (errorMessage) payload.error = errorMessage;

      conditionalLog(`[FME][net] ${icon}`, payload);
    } else if (config.logLevel === "warn") {
      const summary = `[FME][net] ${phase} ${log.method} ${log.path} ${log.status || "?"} ${log.durationMs}ms`;
      conditionalLog(summary, {
        correlationId: log.correlationId,
        ...(log.caller && { caller: log.caller }),
      });
    }

    if (log.durationMs >= config.warnSlowMs) {
      conditionalLog("[FME][net] slow", {
        method: log.method,
        path: log.path,
        durationMs: log.durationMs,
        correlationId: log.correlationId,
      });
    }
  } catch {
    // Suppress logging errors
  }
}

/* Hjälpfunktioner */

// Utilities
// Härleder ok-status från HTTP-statuskod
function inferOk(status?: number): boolean | undefined {
  if (typeof status !== "number") return undefined;
  return isSuccessStatus(status);
}

const DETAIL_VALUE_LIMIT = 320;
const DETAIL_MESSAGE_KEYS = [
  "message",
  "error",
  "detail",
  "description",
  "reason",
  "text",
];

interface UnknownValueMap {
  [key: string]: unknown;
}

const coerceDetailValue = (value: unknown, depth = 0): string | null => {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return null;
    const parts = value
      .map((entry) => coerceDetailValue(entry, depth + 1))
      .filter((part): part is string => Boolean(part));
    if (!parts.length) return null;
    const joined = parts.join(", ");
    return truncate(joined, DETAIL_VALUE_LIMIT);
  }
  if (typeof value === "object") {
    if (depth >= 3) return null;
    for (const key of DETAIL_MESSAGE_KEYS) {
      const nested = coerceDetailValue((value as any)?.[key], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
};

const normalizeDetailMap = (
  candidate: unknown
): ErrorDetailInput | undefined => {
  if (!candidate) return undefined;

  const result: ErrorDetailInput = {};

  if (Array.isArray(candidate)) {
    candidate.forEach((entry, index) => {
      if (entry == null) return;
      if (typeof entry === "object" && !Array.isArray(entry)) {
        const objectEntry = entry as UnknownValueMap;
        const nameValue =
          typeof objectEntry.name === "string" ? objectEntry.name : undefined;
        const fieldValue =
          typeof objectEntry.field === "string" ? objectEntry.field : undefined;
        const parameterValue =
          typeof objectEntry.parameter === "string"
            ? objectEntry.parameter
            : undefined;
        const key =
          toNonEmptyTrimmedString(nameValue) ||
          toNonEmptyTrimmedString(fieldValue) ||
          toNonEmptyTrimmedString(parameterValue) ||
          String(index);
        const message =
          coerceDetailValue(entry, 1) ||
          coerceDetailValue(objectEntry.value, 1);
        if (message) result[key] = truncate(message, DETAIL_VALUE_LIMIT);
      } else {
        const message = coerceDetailValue(entry, 1);
        if (message)
          result[String(index)] = truncate(message, DETAIL_VALUE_LIMIT);
      }
    });
    return Object.keys(result).length ? result : undefined;
  }

  if (typeof candidate === "object" && !Array.isArray(candidate)) {
    const objectCandidate = candidate as UnknownValueMap;
    for (const key of Object.keys(objectCandidate)) {
      const normalized = coerceDetailValue(objectCandidate[key]);
      if (normalized) result[key] = truncate(normalized, DETAIL_VALUE_LIMIT);
    }
    return Object.keys(result).length ? result : undefined;
  }

  const normalized = coerceDetailValue(candidate);
  if (normalized) {
    result.general = truncate(normalized, DETAIL_VALUE_LIMIT);
    return result;
  }

  return undefined;
};

const extractErrorDetails = (error: unknown): ErrorDetailInput | undefined => {
  if (!error || typeof error !== "object") return undefined;

  const candidateSources: unknown[] = [
    (error as any)?.details,
    (error as any)?.response?.details,
    (error as any)?.response?.data?.details,
    (error as any)?.data?.details,
    (error as any)?.body?.details,
    (error as any)?.error?.details,
  ];

  for (const candidate of candidateSources) {
    const normalized = normalizeDetailMap(candidate);
    if (normalized) return normalized;
  }

  return undefined;
};

// Skapar abort-reason för AbortController
const createAbortReason = (cause?: unknown): unknown => {
  if (cause !== undefined) return cause;
  if (typeof DOMException === "function") {
    return new DOMException("Aborted", "AbortError");
  }
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
};

const noop = () => undefined;

/* AbortController-hantering för centraliserad avbrytning */

export class AbortControllerManager {
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Map<string, Set<AbortListenerRecord>>();
  private readonly pendingReasons = new Map<string, unknown>();

  // Registrerar AbortController för specifik nyckel
  register(key: string, controller: AbortController): void {
    if (!key) return;

    this.controllers.set(key, controller);

    // Applicerar pending abort om det fanns en i kö
    const pendingReason = this.pendingReasons.get(key);
    if (pendingReason !== undefined) {
      safeAbortController(controller, pendingReason);
      this.pendingReasons.delete(key);
    }
  }

  // Frigör AbortController och rensar lyssnare
  release(key: string, controller?: AbortController | null): void {
    if (!key) return;

    const tracked = this.controllers.get(key);
    // Kontrollerar att rätt controller frigörs
    if (controller && tracked && tracked !== controller) {
      return;
    }

    this.controllers.delete(key);
    this.pendingReasons.delete(key);

    const records = this.listeners.get(key);
    if (!records?.size) return;

    records.forEach((record) => {
      try {
        record.signal.removeEventListener("abort", record.handler);
      } catch {}
    });
    this.listeners.delete(key);
  }

  // Avbryter controller för given nyckel
  abort(key: string, reason?: unknown): void {
    if (!key) return;

    const controller = this.controllers.get(key);
    // Sparar reason om controller inte är registrerad ännu
    if (!controller) {
      this.pendingReasons.set(key, reason ?? createAbortReason());
      return;
    }

    const abortReason = reason ?? createAbortReason();
    safeAbortController(controller, abortReason);
    this.release(key, controller);
  }

  // Länkar extern AbortSignal till intern controller
  linkExternal(key: string, signal?: AbortSignal | null): () => void {
    if (!key || !signal) {
      return noop;
    }

    // Avbryter direkt om signal redan abortad
    if (signal.aborted) {
      this.abort(key, (signal as { reason?: unknown }).reason);
      return noop;
    }

    const record: AbortListenerRecord = {
      signal,
      handler: () => {
        const reason = (signal as { reason?: unknown }).reason;
        this.abort(key, reason);
      },
    };

    signal.addEventListener("abort", record.handler);

    let records = this.listeners.get(key);
    if (!records) {
      records = new Set();
      this.listeners.set(key, records);
    }

    records.add(record);

    return () => {
      try {
        signal.removeEventListener("abort", record.handler);
      } catch {}

      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(record);
      if (current.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  // Avbryter alla registrerade controllers
  abortAll(reason?: unknown): void {
    const entries = Array.from(this.controllers.entries());
    for (const [key, controller] of entries) {
      this.abort(key, reason);
      this.release(key, controller);
    }
  }
}

// Global singleton för abort-hantering
export const abortManager = new AbortControllerManager();

/* FME Flow API error-hantering */

// Kontrollerar om HTTP-status är retry-bar
const isStatusRetryable = (status?: number): boolean => {
  return isRetryableStatus(status);
};

// Skapar typat FME Flow API-fel med enhetlig struktur
// Construct a typed FME Flow API error with identical message and code.
const makeFlowError = (code: string, status?: number) =>
  new FmeFlowApiError(code, code, status, isStatusRetryable(status));

const V4_TYPE_MAP: { [key: string]: string } = {
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
};

// Normalizes V4 parameter type to internal format
// V4 API returns lowercase types (e.g., "text", "integer") that we map to uppercase internal format
const normalizeParameterType = (rawType: unknown): string => {
  if (typeof rawType !== "string") return "TEXT";

  const normalized = rawType.trim().toLowerCase();
  const mapped = V4_TYPE_MAP[normalized];

  if (mapped) return mapped;

  // Fallback: uppercase the raw type
  return rawType.toUpperCase();
};

// Normaliserar V4 parameter-format till intern struktur
// V4 API changes: listOptions -> choiceSettings.choices, caption -> display, lowercase types
const normalizeV4Parameter = (raw: any): any => {
  if (!raw || typeof raw !== "object") return raw;

  const normalized: any = { ...raw };

  // Normalize parameter type (lowercase -> uppercase)
  if (raw.type) {
    normalized.type = normalizeParameterType(raw.type);
  }

  // Handle V4 number type with showSlider flag
  if (raw.type === "number" && raw.showSlider === true) {
    normalized.type = "RANGE_SLIDER";
  }

  // Handle V4 datetime with date-only format
  if (raw.type === "datetime" && raw.format === "date") {
    normalized.type = "DATE";
  }

  // Handle V4 file type variations (itemsToSelect)
  if (raw.type === "file" && raw.itemsToSelect) {
    const itemType = raw.itemsToSelect.toLowerCase();
    if (itemType === "folders" || itemType === "directories") {
      normalized.type = raw.validateExistence ? "DIRNAME_MUSTEXIST" : "DIRNAME";
    } else if (itemType === "files") {
      normalized.type = raw.validateExistence
        ? "FILENAME_MUSTEXIST"
        : "FILENAME";
    }
  }

  // Handle V4 text type with url editor
  if (raw.type === "text" && raw.editor === "url") {
    normalized.type = "URL";
  }

  // Convert V4 choiceSettings.choices to listOptions format
  if (raw.choiceSettings?.choices && !raw.listOptions) {
    const choices = Array.isArray(raw.choiceSettings.choices)
      ? raw.choiceSettings.choices
      : [];

    normalized.listOptions = choices.map((choice: any) => {
      // V4 uses 'display' for label and 'value' for actual value
      const choiceValue = choice.value ?? choice.caption;
      const choiceCaption = choice.display ?? choice.caption ?? choiceValue;

      return {
        caption: choiceCaption,
        value: choiceValue,
        ...(choice.description && { description: choice.description }),
        ...(choice.path && { path: choice.path }),
        ...(choice.disabled && { disabled: choice.disabled }),
        ...(choice.metadata && { metadata: choice.metadata }),
      };
    });

    // If type is 'text' but has choiceSettings, it should be a CHOICE/dropdown
    if (raw.type === "text" && normalized.type !== "URL") {
      normalized.type = "CHOICE";
    }
  }

  // Handle V4 tree type with nodeDelimiter for path/breadcrumb separators
  if (raw.type === "tree" && raw.nodeDelimiter) {
    normalized.metadata = {
      ...(normalized.metadata || {}),
      breadcrumbSeparator: raw.nodeDelimiter,
      pathSeparator: raw.nodeDelimiter,
    };
  }

  // Map V4 'prompt' to 'description' if description is missing
  if (raw.prompt && !raw.description) {
    normalized.description = raw.prompt;
  }

  // Map V4 'required' to 'optional' (inverted)
  // V4 defaults to required=true if not specified
  if ("required" in raw) {
    normalized.optional = !raw.required;
  } else if (!("optional" in raw)) {
    // If neither field exists, default to optional=false (required)
    normalized.optional = false;
  }

  // Handle V4 number constraints
  if (raw.type === "number" || normalized.type === "RANGE_SLIDER") {
    if (typeof raw.minimum === "number") {
      normalized.minimum = raw.minimum;
    }
    if (typeof raw.maximum === "number") {
      normalized.maximum = raw.maximum;
    }
    if (typeof raw.minimumExclusive === "boolean") {
      normalized.minimumExclusive = raw.minimumExclusive;
    }
    if (typeof raw.maximumExclusive === "boolean") {
      normalized.maximumExclusive = raw.maximumExclusive;
    }
    if (typeof raw.multipleOf === "number") {
      normalized.decimalPrecision = raw.multipleOf === 1 ? 0 : undefined;
    }
  }

  // Handle V4 color with colorSpace
  if (raw.type === "color" && raw.colorSpace) {
    normalized.metadata = {
      ...(normalized.metadata || {}),
      colorSpace: raw.colorSpace,
    };
  }

  // Handle V4 visibility conditions
  if (raw.visibility) {
    normalized.visibility = raw.visibility;
  }

  // Handle V4 nested group parameters
  if (raw.type === "group" && Array.isArray(raw.parameters)) {
    normalized.parameters = raw.parameters.map(normalizeV4Parameter);
  }

  return normalized;
};

// Normaliserar array av V4 parametrar och plattar ut grupper
const normalizeV4Parameters = (raw: any): any => {
  // V4 API wraps parameters in { value: [...], Count: n } structure
  const params = raw?.value || raw;

  if (!Array.isArray(params)) return raw;

  const normalized = params.map(normalizeV4Parameter);

  // Flatten group parameters: extract nested parameters and add them to top level
  const flattened: any[] = [];
  for (const param of normalized) {
    // Always add the parameter itself (groups will be filtered later by ALWAYS_SKIPPED_TYPES)
    flattened.push(param);

    // If it's a group with nested parameters, add those too
    if (param.type === "GROUP" && Array.isArray(param.parameters)) {
      flattened.push(...param.parameters);
    }
  }

  return flattened;
};

/* Response interpreters för esriRequest */

// Response interpreters for esriRequest responses
// Extraherar HTTP-status från esriRequest-svar
const getEsriResponseStatus = (response: any): number | undefined => {
  const httpStatus = response?.httpStatus;
  const status = response?.status;
  return typeof httpStatus === "number"
    ? httpStatus
    : typeof status === "number"
      ? status
      : undefined;
};

// Härleder ok-status från esriRequest-svar
const getEsriResponseOk = (response: any): boolean | undefined => {
  const status = getEsriResponseStatus(response);
  if (typeof status !== "number") return undefined;
  return isSuccessStatus(status);
};

// Beräknar storlek av esriRequest-svar (bytes)
const getEsriResponseSize = (response: any): number | undefined => {
  try {
    const data = response?.data;
    if (!data) return undefined;
    if (typeof data === "string") return data.length;
    const serialized = JSON.stringify(data);
    return serialized.length;
  } catch {
    return undefined;
  }
};

// Packar upp modul-export (hanterar default-export)
const unwrapModule = (module: unknown): any =>
  (module as any)?.default ?? module;

/* ArcGIS-modulreferenser och cachning */
// Globala referenser till laddade ArcGIS-moduler
let _esriRequest: unknown;
let _esriConfig: unknown;
let _projection: unknown;
let _webMercatorUtils: unknown;
let _SpatialReference: unknown;
let _loadPromise: Promise<void> | null = null;
// Cachelagrade FME-tokens per host för interceptor
// Keep latest FME tokens per-host so the interceptor always uses fresh values
const _fmeTokensByHost: { [host: string]: string } = Object.create(null);

// Fallback-mocks för ArcGIS-moduler i testmiljö
const ESRI_MOCK_FALLBACKS: { [K in EsriMockKey]: unknown } = {
  esriRequest: () => Promise.resolve({ data: null }),
  esriConfig: {
    request: { maxUrlLength: 4000, interceptors: [] },
  },
  projection: {},
  webMercatorUtils: {},
  SpatialReference: function spatialReferenceMock() {
    return {};
  },
};

// Hämtar fallback-mock för given nyckel
const getEsriMockFallback = (key: EsriMockKey): unknown =>
  ESRI_MOCK_FALLBACKS[key];

// Applicerar globala Esri-mocks från test-miljö
const applyGlobalEsriMocks = (source: any): void => {
  const assignments: { [K in EsriMockKey]: (value: any) => void } = {
    esriRequest: (v) => (_esriRequest = v),
    esriConfig: (v) => (_esriConfig = v),
    projection: (v) => (_projection = v),
    webMercatorUtils: (v) => (_webMercatorUtils = v),
    SpatialReference: (v) => (_SpatialReference = v),
  };

  for (const key of ESRI_GLOBAL_MOCK_KEYS) {
    const value = source?.[key] ?? getEsriMockFallback(key);
    assignments[key](value);
  }
};

/**
 * Återställer cache för laddade ArcGIS-moduler (används i tester).
 * Reset loaded ArcGIS modules cache and computed limits (used in tests).
 */
export function resetEsriCache(): void {
  _esriRequest = undefined;
  _esriConfig = undefined;
  _projection = undefined;
  _webMercatorUtils = undefined;
  _SpatialReference = undefined;
  _loadPromise = null;
  _cachedMaxUrlLength = null;
}

// Kontrollerar om alla ArcGIS-moduler är laddade
const areEsriModulesLoaded = (): boolean =>
  Boolean(
    _esriRequest &&
      _esriConfig &&
      _projection &&
      _webMercatorUtils &&
      _SpatialReference
  );

// Kontrollerar om globala Esri-mocks finns (testläge)
const hasGlobalEsriMocks = (): boolean => {
  const globalAny = globalThis as any;
  return Boolean(
    globalAny && ESRI_GLOBAL_MOCK_KEYS.some((key) => Boolean(globalAny?.[key]))
  );
};

// Laddar ArcGIS-moduler via jimu-arcgis loader
const loadEsriModules = async (): Promise<void> => {
  const [requestMod, configMod, projectionMod, webMercatorMod, spatialRefMod] =
    await loadArcgisModules([
      "esri/request",
      "esri/config",
      "esri/geometry/projection",
      "esri/geometry/support/webMercatorUtils",
      "esri/geometry/SpatialReference",
    ]);

  _esriRequest = unwrapModule(requestMod);
  _esriConfig = unwrapModule(configMod);
  _projection = unwrapModule(projectionMod);
  _webMercatorUtils = unwrapModule(webMercatorMod);
  _SpatialReference = unwrapModule(spatialRefMod);

  // Laddar projection-modul om nödvändigt
  const projection = asProjection(_projection);
  if (projection?.load) {
    await projection.load();
  }
};

/**
 * Säkerställer att ArcGIS-moduler laddas en gång med cachning och testmocks.
 * Ensure ArcGIS modules are loaded once with caching and test-mode injection.
 */
async function ensureEsri(): Promise<void> {
  if (areEsriModulesLoaded()) return;
  if (_loadPromise) return _loadPromise;

  const loadPromise = (async () => {
    if (hasGlobalEsriMocks()) {
      const globalAny = globalThis as any;
      applyGlobalEsriMocks(globalAny);
      return;
    }

    try {
      await loadEsriModules();
    } catch {
      throw new Error("ARCGIS_MODULE_ERROR");
    }
  })();

  _loadPromise = loadPromise;

  try {
    await loadPromise;
  } catch (error) {
    resetEsriCache();
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function getEsriConfig(): Promise<EsriRequestConfig | null> {
  await ensureEsri();
  return asEsriConfig(_esriConfig);
}

// Tar bort matchande interceptors baserat på regex-pattern
function removeMatchingInterceptors(
  interceptors: any[] | undefined,
  pattern: RegExp
): void {
  if (!interceptors?.length) return;

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const candidate = interceptors[i];
    if (!candidate?._fmeInterceptor) continue;

    const urls = candidate.urls;
    const matches =
      urls instanceof RegExp
        ? urls.source === pattern.source && urls.flags === pattern.flags
        : pattern.test(typeof urls === "string" ? urls : String(urls ?? ""));

    if (matches) {
      interceptors.splice(i, 1);
    }
  }
}

/* Type guards och helpers för Esri-objekt */
const isObjectType = (v: unknown): v is object =>
  Boolean(v && typeof v === "object");

// Type guard för esriRequest-funktion
const asEsriRequest = (
  v: unknown
): ((url: string, options: any) => Promise<any>) | null =>
  typeof v === "function" ? (v as any) : null;

// Type guard för esriConfig-objekt
const asEsriConfig = (
  v: unknown
): { request: { maxUrlLength: number; interceptors: any[] } } | null => {
  if (!isObjectType(v)) return null;
  return (v as any).request ? (v as any) : null;
};

const asProjection = (
  v: unknown
): {
  project?: (geometry: any, spatialReference: any) => any;
  load?: () => Promise<void>;
  isLoaded?: () => boolean;
} | null => (isObjectType(v) ? (v as any) : null);

/* Helper-funktioner för FME-token-interceptors */

// Skapar typat fel med kod, status och orsak
const makeError = (
  code: WebhookErrorCode,
  status?: number,
  cause?: unknown
): Error & { code: WebhookErrorCode; status?: number; cause?: unknown } => {
  const error = new Error(code) as Error & {
    code: WebhookErrorCode;
    status?: number;
    cause?: unknown;
  };
  error.code = code;
  if (status != null) error.status = status;
  if (cause !== undefined) error.cause = cause;
  return error;
};

// Kontrollerar om FME-token är cachelagrad för host
const hasCachedToken = (hostKey: string): boolean =>
  Object.prototype.hasOwnProperty.call(_fmeTokensByHost, hostKey);

// Tar bort cachelagrad FME-token för host
const removeCachedToken = (hostKey: string): void => {
  delete _fmeTokensByHost[hostKey];
};

// Sparar FME-token i cache för host
const setCachedToken = (hostKey: string, token: string): void => {
  _fmeTokensByHost[hostKey] = token;
};

// Hämtar cachelagrad FME-token för host
const getCachedToken = (hostKey: string): string | undefined =>
  _fmeTokensByHost[hostKey];

// Tar bort token-interceptor från esriConfig
const removeTokenInterceptor = async (pattern: RegExp): Promise<void> => {
  let esriConfig: EsriRequestConfig | null;
  try {
    esriConfig = await getEsriConfig();
  } catch {
    return;
  }
  removeMatchingInterceptors(esriConfig?.request?.interceptors, pattern);
};

// Skapar interceptor som injicerar FME-token i requests
// Matches v4 data streaming endpoints
const FME_ENDPOINT_PATTERN = /\/(?:fmedatadownload|fmedataupload|fmeapiv4)\b/i;

const isAllowedFmePath = (rawUrl: unknown): boolean => {
  if (typeof rawUrl === "string") {
    return FME_ENDPOINT_PATTERN.test(rawUrl);
  }

  if (rawUrl instanceof URL) {
    return FME_ENDPOINT_PATTERN.test(rawUrl.pathname);
  }

  if (rawUrl && typeof rawUrl === "object") {
    const candidate =
      typeof (rawUrl as { href?: unknown }).href === "string"
        ? (rawUrl as { href?: string }).href
        : typeof (rawUrl as { url?: unknown }).url === "string"
          ? (rawUrl as { url?: string }).url
          : null;
    return candidate ? FME_ENDPOINT_PATTERN.test(candidate) : false;
  }

  return false;
};

const createTokenInterceptor = (
  hostKey: string,
  pattern: RegExp
): {
  urls: RegExp;
  before: (params: any) => void;
  _fmeInterceptor: boolean;
} => ({
  urls: pattern,
  before(params: any) {
    if (!isAllowedFmePath(params?.url)) {
      return;
    }

    if (!params?.requestOptions) {
      params.requestOptions = {};
    }
    const ro: any = params.requestOptions;
    ro.headers = ro.headers || {};
    ro.query = ro.query || {};

    // Injicerar cachelagrad FME-token i query och headers
    const currentToken = getCachedToken(hostKey);
    if (currentToken) {
      if (!ro.query.fmetoken) {
        ro.query.fmetoken = currentToken;
      }
      ro.headers.Authorization = `fmetoken token=${currentToken}`;
    }
  },
  _fmeInterceptor: true,
});

// Lägger till FME-token-interceptor för given server-URL
async function addFmeInterceptor(
  serverUrl: string,
  token: string
): Promise<void> {
  if (!serverUrl) return;

  const host = extractHostFromUrl(serverUrl);
  if (!host) return;

  const hostKey = host.toLowerCase();
  const pattern = createHostPattern(host);

  // Om tom token: rensa cache och ta bort interceptor
  if (!token) {
    const hadToken = hasCachedToken(hostKey);
    removeCachedToken(hostKey);
    if (hadToken) {
      await removeTokenInterceptor(pattern);
    }
    return;
  }

  setCachedToken(hostKey, token);

  let esriConfig: EsriRequestConfig | null;
  try {
    esriConfig = await getEsriConfig();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  // Lägg till interceptor om den inte redan finns
  if (!esriConfig?.request?.interceptors) return;
  if (interceptorExists(esriConfig.request.interceptors, pattern)) return;

  esriConfig.request.interceptors.push(
    createTokenInterceptor(hostKey, pattern)
  );
}

/* URL-längd-validering via Esri-konfiguration */

let _cachedMaxUrlLength: number | null = null;

// Hämtar maximal URL-längd från Esri config eller default (1900)
const getMaxUrlLength = (): number => {
  // Försök hämta från window.esriConfig först
  const windowLength = (() => {
    if (typeof window === "undefined") return undefined;
    const raw = (window as any)?.esriConfig?.request?.maxUrlLength;
    const numeric = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
  })();

  if (windowLength !== undefined) return windowLength;

  // Använd cachelagrad längd om tillgänglig
  if (_cachedMaxUrlLength !== null) return _cachedMaxUrlLength;

  // Hämta från laddad Esri-modul och cachea
  const cfg = asEsriConfig(_esriConfig);
  const raw = cfg?.request?.maxUrlLength;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  _cachedMaxUrlLength =
    Number.isFinite(numeric) && numeric > 0 ? numeric : 1900;
  return _cachedMaxUrlLength;
};

/* Esri-konfiguration för FME Flow API */

// Säkerställer att Esri config har tillräcklig maxUrlLength
async function setApiSettings(): Promise<void> {
  const esriConfig = await getEsriConfig();
  if (!esriConfig) return;

  // Bevara befintligt värde, höj till säkert minimum om lägre
  esriConfig.request.maxUrlLength = Math.max(
    Number(esriConfig.request.maxUrlLength) || 0,
    FME_FLOW_API.MAX_URL_LENGTH
  );
}

/* TM/NM directives builders för FME-jobb */

// Bygger Transaction Manager (TM) directives från parametrar
const buildTMDirectives = (params: any): TMDirectives => {
  const ttc = parseNonNegativeInt(params?.tm_ttc);
  const ttl = parseNonNegativeInt(params?.tm_ttl);
  const tag = toTrimmedString(params?.tm_tag);

  const out: TMDirectives = {};
  if (ttc !== undefined) out.ttc = ttc;
  if (ttl !== undefined) out.ttl = ttl;
  if (tag) out.tag = tag;
  return out;
};

// Bygger Notification Manager (NM) directives - removed schedule support
const buildNMDirectives = (): null => {
  return null;
};

// Skapar request-body för FME-jobb-submit (TM/NM + parameters)
const makeSubmitBody = (
  publishedParameters: any,
  params: any
): {
  publishedParameters: any;
  TMDirectives?: TMDirectives;
  NMDirectives?: NMDirectives;
} => {
  const tmDirectives = buildTMDirectives(params);
  const nmDirectives = buildNMDirectives();

  const body: {
    publishedParameters: any;
    TMDirectives?: TMDirectives;
    NMDirectives?: NMDirectives;
  } = { publishedParameters };

  // Lägg till TM-directives om ej tomma
  if (Object.keys(tmDirectives).length > 0) {
    body.TMDirectives = tmDirectives;
  }

  // Lägg till NM-directives om schemaläggning aktiv
  if (nmDirectives) {
    body.NMDirectives = nmDirectives;
  }

  return body;
};

/* Felhantering för aborterade requests */

// Returnerar standardsvar för aborterad request
const handleAbortError = <T>(): ApiResponse<T> => ({
  data: undefined as unknown as T,
  status: 0,
  statusText: "requestAborted",
});

/* FmeFlowApiClient – huvudklass för FME Flow API-anrop */

export class FmeFlowApiClient {
  private readonly config: Readonly<FmeFlowConfig>;
  private readonly basePath = FME_FLOW_API.BASE_PATH;
  private setupPromise: Promise<void>;
  private disposed = false;

  constructor(config: FmeFlowConfig) {
    this.config = Object.freeze({ ...config });
    this.setupPromise = Promise.resolve();
    this.queueSetup(config);
  }

  // Köar async setup av Esri-inställningar och token-interceptor
  private queueSetup(config: FmeFlowConfig): void {
    this.setupPromise = (this.setupPromise || Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await setApiSettings();
        await addFmeInterceptor(config.serverUrl, config.token);
      })
      .catch((error) => {
        throw error instanceof Error ? error : new Error(String(error));
      });
  }

  // Köar asynkron teardown (tar bort token-interceptor)
  private queueTeardown(serverUrl: string): void {
    this.setupPromise = (this.setupPromise || Promise.resolve())
      .catch(() => undefined)
      .then(() => addFmeInterceptor(serverUrl, ""))
      .catch(() => undefined);
  }

  // Frigör klient-resurser och tar bort interceptor
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queueTeardown(this.config.serverUrl);
  }

  // Laddar upp fil/blob till FME temp shared resource
  async uploadToTemp(
    file: File | Blob,
    options?: {
      subfolder?: string;
      signal?: AbortSignal;
      repository?: string;
      workspace?: string;
    }
  ): Promise<ApiResponse<{ path: string }>> {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const repository = this.resolveRepository(options?.repository);
    const workspace = toNonEmptyTrimmedString(options?.workspace);
    if (!workspace) {
      throw makeFlowError("DATA_UPLOAD_ERROR");
    }

    const rawName =
      toNonEmptyTrimmedString((file as any)?.name) || `upload_${Date.now()}`;
    const safeName =
      rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) ||
      `upload_${Date.now()}`;

    const rawNamespace = toNonEmptyTrimmedString(options?.subfolder);
    const sanitizedNamespace = rawNamespace
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .slice(0, 64);
    const namespace = sanitizedNamespace || createCorrelationId("upload");

    const endpoint = buildUrl(
      this.config.serverUrl,
      "fmedataupload",
      repository,
      workspace,
      safeName
    );

    const query: PrimitiveParams = {
      opt_fullpath: "true",
      opt_responseformat: "json",
      opt_namespace: namespace,
    };

    const headers: { [key: string]: string } = {
      Accept: "application/json",
      "Content-Type":
        file instanceof File && file.type
          ? file.type
          : "application/octet-stream",
    };

    const response = await this.request<{
      file?: { path?: string; name?: string; size?: number };
      session?: string;
    }>(endpoint, {
      method: HttpMethod.PUT,
      headers,
      body: file,
      query,
      signal: options?.signal,
      cacheHint: false,
      repositoryContext: repository,
    });

    const fileInfo = response.data?.file;
    const resolvedPath = toTrimmedString(fileInfo?.path) ?? null;

    if (!resolvedPath) {
      throw makeFlowError("DATA_UPLOAD_ERROR", response.status);
    }

    return {
      data: { path: resolvedPath },
      status: response.status,
      statusText: response.statusText,
    };
  }

  // Hämtar repository från config eller parameter
  private resolveRepository(repository?: string): string {
    return repository || this.config.repository;
  }

  // Formaterar jobb-parametrar till FME publishedParameters-struktur
  private formatJobParams(parameters: PrimitiveParams = {}): any {
    // Om redan i rätt format, returnera direkt
    if ((parameters as any).publishedParameters) return parameters;

    // Filtrera bort exkluderade parametrar (opt_, tm_, etc.)
    const publishedParameters = Object.entries(parameters)
      .filter(([name]) => !PUBLISHED_PARAM_EXCLUDE_SET.has(name))
      .map(([name, value]) => ({ name, value }));

    return makeSubmitBody(publishedParameters, parameters);
  }

  // Bygger repository-endpoint med basepath och segment
  private repoEndpoint(repository: string, ...segments: string[]): string {
    return buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "repositories",
      repository,
      ...segments
    );
  }

  private jobsEndpoint(): string {
    return buildUrl(this.config.serverUrl, this.basePath.slice(1), "jobs");
  }
  private workspaceEndpoint(
    repository: string,
    workspace: string,
    ...segments: string[]
  ): string {
    return buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "workspaces",
      repository,
      workspace,
      ...segments
    );
  }

  private async withApiError<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    errorCode: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      const status = extractHttpStatus(err);
      const retryable = isRetryableError(err);
      const existing = err instanceof FmeFlowApiError ? err : null;
      const details = existing?.details ?? extractErrorDetails(err);
      const severity = existing?.severity;
      const httpStatus =
        typeof status === "number"
          ? status
          : typeof existing?.httpStatus === "number"
            ? existing.httpStatus
            : 0;
      throw new FmeFlowApiError(
        errorMessage,
        errorCode,
        httpStatus,
        retryable,
        severity,
        details
      );
    }
  }

  async testConnection(signal?: AbortSignal): Promise<
    ApiResponse<{
      status: string;
      message?: string;
      build?: string;
      version?: string;
    }>
  > {
    return this.request<{
      status: string;
      message?: string;
      build?: string;
      version?: string;
    }>("/healthcheck/liveness", { signal });
  }

  // Validerar att repository existerar
  async validateRepository(
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<{ name: string }>> {
    const repo = this.resolveRepository(repository);
    const endpoint = this.repoEndpoint(repo);
    return this.request<{ name: string }>(endpoint, { signal });
  }

  // Hämtar lista med repositories från FME Flow
  async getRepositories(
    signal?: AbortSignal
  ): Promise<ApiResponse<Array<{ name: string }>>> {
    return this.withApiError(
      async () => {
        const listEndpoint = buildUrl(
          this.config.serverUrl,
          this.basePath.slice(1),
          "repositories"
        );
        const raw = await this.request<any>(listEndpoint, {
          signal,
          cacheHint: false, // Undvik cache över tokens
          query: { limit: 1000, offset: 0 },
        });

        const data = raw?.data;
        const items = extractRepositoryNames(data).map((name) => ({ name }));

        return {
          data: items,
          status: raw.status,
          statusText: raw.statusText,
        };
      },
      "REPOSITORIES_ERROR",
      "REPOSITORIES_ERROR"
    );
  }

  // Hämtar enskild workspace-parameter från FME Flow
  async getWorkspaceParameter(
    workspace: string,
    parameter: string,
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<WorkspaceParameter>> {
    const repo = this.resolveRepository(repository);
    // V4 API: Use /workspaces/{repo}/{workspace}/parameters/{parameter}
    const endpoint = this.workspaceEndpoint(
      repo,
      workspace,
      "parameters",
      parameter
    );
    const response = await this.request<any>(endpoint, {
      signal,
      cacheHint: false, // Avaktivera cache
      repositoryContext: repo, // Lägg till repo-kontext för cache-scoping
    });

    // Normalize V4 parameter format to internal structure
    return {
      ...response,
      data: normalizeV4Parameter(response.data),
    };
  }

  // Hämtar alla workspace-parametrar från FME Flow
  async getWorkspaceParameters(
    workspace: string,
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<WorkspaceParameter[]>> {
    const repo = this.resolveRepository(repository);
    // V4 API: Use /workspaces/{repo}/{workspace}/parameters
    const endpoint = this.workspaceEndpoint(repo, workspace, "parameters");
    return this.withApiError(
      async () => {
        const response = await this.request<any[]>(endpoint, {
          signal,
          cacheHint: false, // Avaktivera cache
          repositoryContext: repo, // Lägg till repo-kontext för cache-scoping
        });

        // Normalize V4 parameters format to internal structure
        return {
          ...response,
          data: normalizeV4Parameters(response.data),
        };
      },
      "WORKSPACE_PARAMETERS_ERROR",
      "WORKSPACE_PARAMETERS_ERROR"
    );
  }

  /* Generisk request-metod för HTTP-anrop */

  // Hämtar repository-items (workspaces) med optional filter/limit
  async getRepositoryItems(
    repository: string,
    type?: string,
    limit?: number,
    offset?: number,
    signal?: AbortSignal
  ): Promise<
    ApiResponse<{
      items: any[];
      totalCount?: number;
      limit?: number;
      offset?: number;
    }>
  > {
    const repo = this.resolveRepository(repository);
    const endpoint = this.repoEndpoint(repo, "items");
    const query: PrimitiveParams = {};
    if (type) query.type = type;
    if (typeof limit === "number") query.limit = limit;
    if (typeof offset === "number") query.offset = offset;
    return this.withApiError(
      () =>
        this.request(endpoint, {
          signal,
          cacheHint: false, // Undvik cross-repo/token-kontaminering
          repositoryContext: repo, // Lägg till repo-kontext för cache-scoping
          query,
        }),
      "REPOSITORY_ITEMS_ERROR",
      "REPOSITORY_ITEMS_ERROR"
    );
  }

  // Hämtar specifik workspace-item från repository
  async getWorkspaceItem(
    workspace: string,
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<any>> {
    const repo = this.resolveRepository(repository);
    // V4 API: Use /workspaces/{repo}/{workspace}
    const endpoint = this.workspaceEndpoint(repo, workspace);
    return this.withApiError(
      () =>
        this.request<any>(endpoint, {
          signal,
          cacheHint: false, // Undvik cross-repo/token-kontaminering
          repositoryContext: repo, // Lägg till repo-kontext för cache-scoping
        }),
      "WORKSPACE_ITEM_ERROR",
      "WORKSPACE_ITEM_ERROR"
    );
  }

  // Skickar asynkront FME-jobb (submit) med parametrar
  async submitJob(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResult>> {
    const repo = this.resolveRepository(repository);
    const endpoint = this.jobsEndpoint();
    const jobRequest = this.formatJobParams(parameters);
    const bodyWithWorkspace = {
      repository: repo,
      workspace: workspace,
      ...jobRequest,
    };

    return this.withApiError(
      () =>
        this.request<JobResult>(endpoint, {
          method: HttpMethod.POST,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyWithWorkspace),
          signal,
          cacheHint: false,
        }),
      "JOB_SUBMISSION_ERROR",
      "JOB_SUBMISSION_ERROR"
    );
  }

  // Kör workspace via data-download (stream) med webhook
  async runDataDownload(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    const targetRepository = this.resolveRepository(repository);
    return await this.runDownloadWebhook(
      workspace,
      parameters,
      targetRepository,
      signal
    );
  }

  // Kör workspace synkront med direktsvar
  async runWorkspace(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    return await this.runDataDownload(
      workspace,
      parameters,
      repository,
      signal
    );
  }

  // Kör workspace via webhook för data-download/stream
  private async runDownloadWebhook(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    try {
      const webhookOptions = {
        requireHttps: this.config.requireHttps,
      };

      const {
        baseUrl: webhookUrl,
        params,
        fullUrl,
      } = createWebhookArtifacts(
        this.config.serverUrl,
        repository,
        workspace,
        parameters,
        this.config.token,
        webhookOptions
      );

      // Kontrollera URL-längd mot maxlängd
      const maxLen = getMaxUrlLength();
      if (Number.isFinite(maxLen) && maxLen > 0 && fullUrl.length > maxLen) {
        throw makeError("URL_TOO_LONG", 0);
      }

      // Logga parametrar (whitelistad) för felsökning
      safeLogParams(
        "WEBHOOK_CALL",
        webhookUrl,
        params,
        FME_FLOW_API.WEBHOOK_LOG_WHITELIST
      );

      await ensureEsri();
      const esriRequestFn = asEsriRequest(_esriRequest);
      if (!esriRequestFn) {
        throw makeFlowError("ARCGIS_MODULE_ERROR");
      }

      const requestHeaders = {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      };

      // Komponera timeout-aware AbortSignal för esriRequest
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let didTimeout = false;
      const onAbort = () => {
        controller.abort();
      };
      try {
        // Länka extern signal om tillgänglig
        if (signal) {
          if (signal.aborted) controller.abort();
          else signal.addEventListener("abort", onAbort);
        }

        // Sätt timeout om konfigurerad
        const timeoutMs =
          typeof this.config.timeout === "number" && this.config.timeout > 0
            ? this.config.timeout
            : undefined;
        if (timeoutMs) {
          timeoutId = setTimeout(() => {
            didTimeout = true;
            try {
              controller.abort();
            } catch {}
          }, timeoutMs);
        }

        // Instrumenterad GET-request via webhook
        const response = await instrumentedRequest({
          method: "GET",
          url: fullUrl,
          transport: "fme-webhook",
          query: params,
          correlationId: createCorrelationId("webhook"),
          responseInterpreter: {
            status: getEsriResponseStatus,
            ok: getEsriResponseOk,
            size: getEsriResponseSize,
          },
          execute: () => {
            const requestOptions: any = {
              method: "get",
              responseType: "json",
              headers: requestHeaders,
              signal: controller.signal,
            };
            // Only set timeout if explicitly configured and valid
            if (typeof timeoutMs === "number" && timeoutMs > 0) {
              requestOptions.timeout = timeoutMs;
            }
            return esriRequestFn(fullUrl, requestOptions);
          },
        });

        return this.parseWebhookResponse(response);
      } catch (e: any) {
        // Hantera abort-fel, särskilt timeout
        if (isAbortError(e)) {
          if (didTimeout) {
            throw makeError("WEBHOOK_TIMEOUT", 408, e);
          }
        }
        throw e instanceof Error ? e : new Error(String(e));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        try {
          if (signal) signal.removeEventListener("abort", onAbort);
        } catch {}
      }
    } catch (err) {
      if (err instanceof FmeFlowApiError) throw err;
      if ((err as { code?: string } | null)?.code) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      const status = extractHttpStatus(err);
      throw makeFlowError("DATA_DOWNLOAD_ERROR", status || 0);
    }
  }

  // Parsar webhook-respons och hanterar fel
  private async parseWebhookResponse(
    response:
      | Response
      | {
          data?: any;
          headers?: { get: (name: string) => string | null };
          status?: number;
          statusText?: string;
          httpStatus?: number;
        }
  ): Promise<ApiResponse> {
    // Extrahera HTTP-status från respons
    const rawStatus =
      typeof (response as any)?.status === "number"
        ? (response as any).status
        : typeof (response as any)?.httpStatus === "number"
          ? (response as any).httpStatus
          : undefined;
    const status = typeof rawStatus === "number" ? rawStatus : 0;

    // Autentiseringsfel
    if (status === 401 || status === 403) {
      throw makeError("WEBHOOK_AUTH_ERROR", status);
    }

    const headers =
      typeof (response as any)?.headers?.get === "function"
        ? ((response as any).headers as {
            get: (name: string) => string | null;
          })
        : undefined;
    const contentType = headers?.get("content-type") || undefined;

    let data: any;

    // Försök parsa JSON från respons
    if (typeof (response as any)?.json === "function") {
      try {
        data = await (response as any).json();
      } catch (error) {
        throw makeError("WEBHOOK_NON_JSON", status, error);
      }
    } else if ((response as any)?.data !== undefined) {
      data = (response as any).data;
    } else if ((response as any)?.json !== undefined) {
      data = (response as any).json;
    } else if (typeof (response as any)?.text === "string") {
      try {
        data = JSON.parse((response as any).text);
      } catch (error) {
        throw makeError("WEBHOOK_NON_JSON", status, error);
      }
    }

    // Validera att data är objekt
    if (!data || typeof data !== "object") {
      throw makeError("WEBHOOK_NON_JSON", status, response);
    }

    // Kontrollera content-type är JSON
    if (contentType && !isJson(contentType)) {
      throw makeError("WEBHOOK_NON_JSON", status, { contentType });
    }

    return {
      data,
      status,
      statusText: (response as any)?.statusText,
    };
  }

  // Generisk privat HTTP-request-metod för alla FME Flow API-anrop
  private async request<T>(
    endpoint: string,
    options: Partial<RequestConfig> = {}
  ): Promise<ApiResponse<T>> {
    // Säkerställ att klienten inte är disposed
    if (this.disposed) {
      throw makeFlowError("CLIENT_DISPOSED");
    }

    // Vänta på setup (Esri-config och interceptor)
    try {
      await this.setupPromise;
    } catch (error) {
      // Retry setup om det fallerade första gången
      this.queueSetup(this.config);
      try {
        await this.setupPromise;
      } catch {
        throw makeFlowError("ARCGIS_MODULE_ERROR");
      }
    }
    await ensureEsri();

    const stripLeadingSlash = (value: string): string =>
      value.startsWith("/") ? value.slice(1) : value;

    const normalizedBase = stripLeadingSlash(this.basePath || "");
    const baseSegments = normalizedBase ? [normalizedBase] : [];
    const normalizedEndpoint = stripLeadingSlash(endpoint);
    const url = endpoint.startsWith("http")
      ? endpoint
      : endpoint.startsWith("/fme")
        ? buildUrl(this.config.serverUrl, normalizedEndpoint)
        : normalizedEndpoint
          ? buildUrl(this.config.serverUrl, ...baseSegments, normalizedEndpoint)
          : buildUrl(this.config.serverUrl, ...baseSegments);
    const headers: { [key: string]: string } = {
      ...(options.headers || {}),
    };
    const query: any = { ...(options.query || {}) };

    // Lägg till stabilt scope-id för GET-request cache-variation
    const isGet = !options.method || options.method === HttpMethod.GET;
    if (isGet) {
      const scope = makeScopeId(
        this.config.serverUrl,
        this.config.token,
        options.repositoryContext
      );
      if (query.__scope === undefined) query.__scope = scope;
    }

    const requestOptions: any = {
      method: (options.method?.toLowerCase() as any) || "get",
      query,
      responseType: "json",
      headers,
      signal: options.signal,
    };

    try {
      // Injicera FME-autentisering direkt (bypass interceptor)
      const serverHostKey = extractHostFromUrl(
        this.config.serverUrl
      )?.toLowerCase();
      const parsedRequestUrl = safeParseUrl(url);
      if (!parsedRequestUrl) {
        throw makeFlowError("INVALID_REQUEST_URL");
      }

      if (
        this.config.requireHttps &&
        parsedRequestUrl.protocol &&
        parsedRequestUrl.protocol.toLowerCase() !== "https:"
      ) {
        throw makeFlowError("HTTPS_REQUIRED");
      }

      const requestHostKey = (parsedRequestUrl.hostname || "").toLowerCase();
      if (
        serverHostKey &&
        requestHostKey === serverHostKey &&
        this.config.token
      ) {
        if (!query.fmetoken) {
          query.fmetoken = this.config.token;
        }
        // Lägg till Authorization-header med FME Flow-format
        requestOptions.headers = requestOptions.headers || {};
        requestOptions.headers.Authorization = `fmetoken token=${this.config.token}`;
      }

      // Använd explicit timeout eller fallback till config
      const timeoutMs =
        typeof options.timeout === "number"
          ? options.timeout
          : typeof this.config.timeout === "number"
            ? this.config.timeout
            : undefined;
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        requestOptions.timeout = timeoutMs;
      }
      if (options.cacheHint !== undefined)
        requestOptions.cacheHint = options.cacheHint;
      if (options.body !== undefined) requestOptions.body = options.body;

      const esriRequestFn = asEsriRequest(_esriRequest);
      if (!esriRequestFn) {
        throw makeFlowError("ARCGIS_MODULE_ERROR");
      }

      // Instrumenterad request med logging och timing
      const correlationId = createCorrelationId("fme");
      const response = await instrumentedRequest({
        method:
          typeof requestOptions.method === "string"
            ? requestOptions.method.toUpperCase()
            : "GET",
        url,
        transport: "fme-flow-api",
        body: requestOptions.body,
        query,
        correlationId,
        responseInterpreter: {
          status: getEsriResponseStatus,
          ok: getEsriResponseOk,
          size: getEsriResponseSize,
        },
        execute: () => esriRequestFn(url, requestOptions),
      });

      return {
        data: response.data,
        status: response.httpStatus || response.status || 200,
        statusText: response.statusText,
      };
    } catch (err) {
      // Hantera abort-fel tyst (returnera tomt svar)
      if (
        (err as { name?: string } | null | undefined)?.name === "AbortError"
      ) {
        return handleAbortError<T>();
      }
      // Bevara specifika API-fel som kastats avsiktligt
      if (err instanceof FmeFlowApiError) {
        throw err;
      }

      const httpStatus = extractHttpStatus(err) || 0;
      const retryable = isRetryableError(err);
      const message = extractErrorMessage(err);

      // Bestäm error-kod för programmatisk identifiering
      let errorCode = "REQUEST_FAILED";
      if (message.includes("Unexpected token")) {
        errorCode = "INVALID_RESPONSE_FORMAT";
      }

      // Hämta användarvänlig translations-nyckel via centraliserad mapping
      const translationKey = mapErrorFromNetwork(err, httpStatus);
      const details = extractErrorDetails(err);
      const messageKey = translationKey || errorCode;

      throw new FmeFlowApiError(
        messageKey,
        errorCode,
        httpStatus,
        retryable,
        undefined,
        details
      );
    }
  }
}

/* Config-normalisering och client factory */

// Normaliserar FmeExportConfig till intern FmeFlowConfig
const normalizeConfigParams = (config: FmeExportConfig): FmeFlowConfig => ({
  serverUrl: config.fmeServerUrl || (config as any).fme_server_url || "",
  token:
    config.fmeServerToken ||
    (config as any).fme_server_token ||
    (config as any).fmw_server_token ||
    "",
  repository: config.repository || "",
  timeout: config.requestTimeout,
  requireHttps: config.requireHttps,
});

// Factory-funktion för att skapa FME Flow API-klient
export function createFmeFlowClient(config: FmeExportConfig): FmeFlowApiClient {
  const normalizedConfig = normalizeConfigParams(config);
  try {
    validateRequiredConfig(normalizedConfig);
  } catch {
    throw makeFlowError("INVALID_CONFIG");
  }

  // Returnerar klient med sanerad serverUrl (utan trailing slash)
  return new FmeFlowApiClient({
    ...normalizedConfig,
    serverUrl: normalizedConfig.serverUrl.replace(/\/$/, ""),
  });
}

export { FmeFlowApiClient as default };
