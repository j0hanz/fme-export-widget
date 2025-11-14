import {
  DEFAULT_NETWORK_CONFIG,
  DETAIL_MESSAGE_KEYS,
  DETAIL_VALUE_LIMIT,
  ESRI_MOCK_FALLBACKS,
  FILE_UPLOAD,
  FME_ENDPOINT_PATTERN,
  HTTP_STATUS_CODES,
  isRetryableStatus,
  isSuccessStatus,
  NETWORK_CONFIG,
  REDACT_AUTH_REGEX,
  REDACT_TOKEN_REGEX,
  SENSITIVE_KEY_PATTERNS,
  TM_PARAM_KEYS,
  V4_PARAMETER_TYPE_MAP,
} from "../config/constants";
import type {
  AbortListenerRecord,
  ApiResponse,
  ErrorDetailInput,
  EsriInterceptorList,
  EsriInterceptorParams,
  EsriInterceptorRequestOptions,
  EsriMockAssignments,
  EsriMockKey,
  EsriMockSource,
  EsriRequestConfig,
  EsriRequestInterceptor,
  EsriRequestOptions,
  EsriRequestResponse,
  EsriResponseLike,
  FmeExportConfig,
  FmeFlowConfig,
  InstrumentedRequestOptions,
  JobResult,
  NetworkConfig,
  PrimitiveParams,
  PublishedParameterEntry,
  RequestConfig,
  RequestLog,
  ServiceMode,
  SubmitParametersPayload,
  TMDirectives,
  UnknownValueMap,
  WorkspaceParameter,
} from "../config/index";
import {
  ESRI_GLOBAL_MOCK_KEYS,
  FME_FLOW_API,
  FmeFlowApiError,
  HttpMethod,
} from "../config/index";
import {
  buildParams,
  buildUrl,
  createHostPattern,
  extractErrorMessage,
  extractHostFromUrl,
  extractRepositoryNames,
  interceptorExists,
  isJson,
  isNonNegativeNumber,
  loadArcgisModules,
  makeScopeId,
  normalizeToLowerCase,
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
import { parseNonNegativeInt } from "./utils/fme";
import {
  extractHttpStatus,
  isAuthError,
  isRetryableError,
  validateRequiredConfig,
} from "./validations";

// Configuration
/* Standardkonfiguration för nätverksinstrumentering */
const config: NetworkConfig = { 
  ...DEFAULT_NETWORK_CONFIG,
  enabled: true,
  logLevel: 'debug', // Always enable debug logging
};

// Network history buffer för debugging
const networkHistory: RequestLog[] = [];

// Log initialization
console.log('[FME] API logging initialized - level:', config.logLevel);

function addToNetworkHistory(log: RequestLog): void {
  networkHistory.push(log);
  while (networkHistory.length > NETWORK_CONFIG.MAX_HISTORY_SIZE) {
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
    const safeDuration = isNonNegativeNumber(durationMs) ? durationMs : 0;
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
    const safeDuration = isNonNegativeNumber(durationMs) ? durationMs : 0;
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

// Helper: Build base URL from parsed or raw URL
const buildBaseUrl = (parsed: URL | null, raw: string): string => {
  if (parsed) return `${parsed.origin}${parsed.pathname}`;
  return redactSensitiveText(raw.split("?")[0] || "");
};

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
  const base = buildBaseUrl(parsed, url);

  return search ? `${base}?${search}` : base;
}

// Parsar URL-sträng till URL-objekt med felhantering
function parseUrl(url: string): URL | null {
  if (!url) return null;
  try {
    return safeParseUrl(url) || new URL(url, "http://localhost");
  } catch {
    return null;
  }
}

// Extraherar sökväg från URL (utan query-string)
function extractPath(url: string): string {
  const parsed = parseUrl(url);
  return parsed?.pathname || url.split("?")[0] || url;
}

// Helper: Merge additional query params into URLSearchParams
const mergeQueryParams = (
  params: URLSearchParams,
  query: PrimitiveParams | URLSearchParams | string
): void => {
  if (typeof query === "string") {
    new URLSearchParams(query).forEach((value, key) => {
      params.set(key, value);
    });
    return;
  }

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => {
      params.set(key, value);
    });
    return;
  }

  // Handle PrimitiveParams object
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
};

// Bygger URLSearchParams från URL och ytterligare query-parameter
function buildSearchParams(
  parsed: URL | null,
  query?: PrimitiveParams | URLSearchParams | string | null
): URLSearchParams {
  const params = new URLSearchParams(parsed?.search || "");
  if (query) mergeQueryParams(params, query);
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
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));
}

// Maskerar känsliga värden i fritext (auth-headers, tokens i URL)
function redactSensitiveText(text: string): string {
  return text
    .replace(REDACT_AUTH_REGEX, 'authorization="[TOKEN]"')
    .replace(REDACT_TOKEN_REGEX, "$1=[TOKEN]");
}

/* Body-hantering för logging */

// Body Handling
// Beskriver request-body för logging (trunkerar och maskerar känsligt)
function describeBody(body: unknown): string {
  if (body == null) return "";

  if (typeof body === "string") {
    return truncate(redactSensitiveText(body), config.bodyPreviewLimit);
  }

  if (typeof body !== "object") {
    try {
      const serialized = JSON.stringify(body);
      return truncate(redactSensitiveText(serialized), config.bodyPreviewLimit);
    } catch {
      return "[Object]";
    }
  }

  // Object type checks
  if (typeof FormData !== "undefined" && body instanceof FormData)
    return "[FormData]";
  if (typeof Blob !== "undefined" && body instanceof Blob)
    return `[Blob:${body.size}]`;

  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    const size =
      body instanceof ArrayBuffer
        ? body.byteLength
        : body.buffer?.byteLength || 0;
    return `[Binary:${size}]`;
  }

  try {
    const serialized = JSON.stringify(body);
    return truncate(redactSensitiveText(serialized), config.bodyPreviewLimit);
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

      console.log(`[FME][net] ${icon}`, payload);
    } else if (config.logLevel === "warn") {
      const summary = `[FME][net] ${phase} ${log.method} ${log.path} ${log.status || "?"} ${log.durationMs}ms`;
      console.log(summary, {
        correlationId: log.correlationId,
        ...(log.caller && { caller: log.caller }),
      });
    }

    if (log.durationMs >= config.warnSlowMs) {
      console.warn("[FME][net] SLOW REQUEST", {
        method: log.method,
        path: log.path,
        durationMs: log.durationMs,
        correlationId: log.correlationId,
      });
    }
  } catch (logError) {
    console.error("[FME] Logging error:", logError);
  }
}

/* Hjälpfunktioner */

// Utilities
// Härleder ok-status från HTTP-statuskod
function inferOk(status?: number): boolean | undefined {
  if (typeof status !== "number") return undefined;
  return isSuccessStatus(status);
}

const isUnknownValueMap = (value: unknown): value is UnknownValueMap =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizePathSegment = (segment?: string | null): string => {
  if (!segment) return "";
  return segment.replace(/\\+/g, "/").replace(/^\/+|\/+$/g, "");
};

const buildResourcePathReference = (
  connection: string,
  namespace: string,
  fileName: string
): string => {
  const normalizedConnection =
    normalizePathSegment(connection) || FME_FLOW_API.TEMP_RESOURCE_CONNECTION;
  const normalizedNamespace = normalizePathSegment(namespace);
  const parts = [normalizedConnection];
  if (normalizedNamespace) parts.push(normalizedNamespace);
  parts.push(fileName);
  return parts.join("/");
};

const RESOURCE_PATH_KEYS = [
  "path",
  "fullPath",
  "relativePath",
  "resourcePath",
  "filePath",
  "savedPath",
  "targetPath",
];

const RESOURCE_URL_KEYS = ["href", "url", "downloadUrl"] as const;
const RESOURCE_COLLECTION_KEYS = ["file", "files", "items", "data"];

const extractUploadedResourcePath = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = toTrimmedString(value);
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = extractUploadedResourcePath(entry);
      if (candidate) return candidate;
    }
    return undefined;
  }

  if (!isUnknownValueMap(value)) return undefined;

  for (const key of RESOURCE_PATH_KEYS) {
    const candidate = toTrimmedString(value[key]);
    if (candidate) return candidate;
  }

  for (const key of RESOURCE_URL_KEYS) {
    const candidate = toTrimmedString(value[key]);
    if (candidate) return candidate;
  }

  for (const key of RESOURCE_COLLECTION_KEYS) {
    const nested = extractUploadedResourcePath(value[key]);
    if (nested) return nested;
  }

  return undefined;
};

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
  if (isUnknownValueMap(value)) {
    if (depth >= 3) return null;
    for (const key of DETAIL_MESSAGE_KEYS) {
      const nested = coerceDetailValue(value[key], depth + 1);
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
      if (isUnknownValueMap(entry)) {
        const objectEntry = entry;
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

  if (isUnknownValueMap(candidate)) {
    for (const key of Object.keys(candidate)) {
      const normalized = coerceDetailValue(candidate[key]);
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

const extractProperty = (source: unknown, path: string[]): unknown => {
  let current: unknown = source;
  for (const key of path) {
    if (!isUnknownValueMap(current)) return undefined;
    current = current[key];
  }
  return current;
};

const extractErrorDetails = (error: unknown): ErrorDetailInput | undefined => {
  if (!error || typeof error !== "object") return undefined;

  const paths: string[][] = [
    ["details"],
    ["response", "details"],
    ["response", "data", "details"],
    ["data", "details"],
    ["body", "details"],
    ["error", "details"],
  ];

  for (const path of paths) {
    const candidate = extractProperty(error, path);
    if (candidate !== undefined) {
      const normalized = normalizeDetailMap(candidate);
      if (normalized) return normalized;
    }
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

    for (const record of records) {
      try {
        record.signal.removeEventListener("abort", record.handler);
      } catch {}
    }
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

// Normalizes V4 parameter type to internal format
// V4 API returns lowercase types (e.g., "text", "integer") that we map to uppercase internal format
const normalizeParameterType = (rawType: unknown): string => {
  if (typeof rawType !== "string") return "TEXT";

  const normalized = normalizeToLowerCase(rawType);
  const mapped = V4_PARAMETER_TYPE_MAP[normalized];

  if (mapped) return mapped;

  // Fallback: uppercase the raw type
  return rawType.toUpperCase();
};

// Normaliserar V4 parameter-format till intern struktur
// V4 API changes: listOptions -> choiceSettings.choices, caption -> display, lowercase types
const normalizeV4Parameter = (raw: unknown): WorkspaceParameter => {
  if (!raw || typeof raw !== "object") return {} as WorkspaceParameter;

  // Type the raw parameter for property access
  const rawParam = raw as { [key: string]: unknown };
  const normalized: { [key: string]: unknown } = { ...rawParam };

  // Normalize parameter type (lowercase -> uppercase)
  if (rawParam.type) {
    normalized.type = normalizeParameterType(rawParam.type);
  }

  // Handle V4 number type with showSlider flag
  if (rawParam.type === "number" && rawParam.showSlider === true) {
    normalized.type = "RANGE_SLIDER";
  }

  // Handle V4 datetime with date-only format
  if (rawParam.type === "datetime" && rawParam.format === "date") {
    normalized.type = "DATE";
  }

  // Handle V4 file type variations (itemsToSelect)
  if (rawParam.type === "file" && rawParam.itemsToSelect) {
    const itemType =
      typeof rawParam.itemsToSelect === "string"
        ? rawParam.itemsToSelect.toLowerCase()
        : "";
    if (itemType === "folders" || itemType === "directories") {
      normalized.type = rawParam.validateExistence
        ? "DIRNAME_MUSTEXIST"
        : "DIRNAME";
    } else if (itemType === "files") {
      normalized.type = rawParam.validateExistence
        ? "FILENAME_MUSTEXIST"
        : "FILENAME";
    }
  }

  // Handle V4 text type with url editor
  if (rawParam.type === "text" && rawParam.editor === "url") {
    normalized.type = "URL";
  }

  // Convert V4 choiceSettings.choices to listOptions format
  const choiceSettings = rawParam.choiceSettings as
    | { choices?: unknown[] }
    | undefined;
  if (choiceSettings?.choices && !rawParam.listOptions) {
    const choices = Array.isArray(choiceSettings.choices)
      ? choiceSettings.choices
      : [];

    normalized.listOptions = choices.map((choice: unknown) => {
      const choiceObj = choice as { [key: string]: unknown };
      // V4 uses 'display' for label and 'value' for actual value
      const choiceValue = choiceObj.value ?? choiceObj.caption;
      const choiceCaption =
        choiceObj.display ?? choiceObj.caption ?? choiceValue;

      return {
        caption: choiceCaption,
        value: choiceValue,
        ...(choiceObj.description && { description: choiceObj.description }),
        ...(choiceObj.path && { path: choiceObj.path }),
        ...(choiceObj.disabled && { disabled: choiceObj.disabled }),
        ...(choiceObj.metadata && { metadata: choiceObj.metadata }),
      };
    });

    // If type is 'text' but has choiceSettings, it should be a CHOICE/dropdown
    if (rawParam.type === "text" && normalized.type !== "URL") {
      normalized.type = "CHOICE";
    }
  }

  // Handle V4 tree type with nodeDelimiter for path/breadcrumb separators
  if (rawParam.type === "tree" && rawParam.nodeDelimiter) {
    normalized.metadata = {
      ...((normalized.metadata as { [key: string]: unknown }) || {}),
      breadcrumbSeparator: rawParam.nodeDelimiter,
      pathSeparator: rawParam.nodeDelimiter,
    };
  }

  // Map V4 'prompt' to 'description' if description is missing
  if (rawParam.prompt && !rawParam.description) {
    normalized.description = rawParam.prompt;
  }

  // Map V4 'required' to 'optional' (inverted)
  // V4 defaults to required=true if not specified
  if ("required" in rawParam) {
    normalized.optional = !rawParam.required;
  } else if (!("optional" in rawParam)) {
    // If neither field exists, default to optional=false (required)
    normalized.optional = false;
  }

  // Handle V4 number constraints
  if (rawParam.type === "number" || normalized.type === "RANGE_SLIDER") {
    if (typeof rawParam.minimum === "number") {
      normalized.minimum = rawParam.minimum;
    }
    if (typeof rawParam.maximum === "number") {
      normalized.maximum = rawParam.maximum;
    }
    if (typeof rawParam.minimumExclusive === "boolean") {
      normalized.minimumExclusive = rawParam.minimumExclusive;
    }
    if (typeof rawParam.maximumExclusive === "boolean") {
      normalized.maximumExclusive = rawParam.maximumExclusive;
    }
    if (typeof rawParam.multipleOf === "number") {
      normalized.decimalPrecision = rawParam.multipleOf === 1 ? 0 : undefined;
    }
  }

  // Handle V4 color with colorSpace
  if (rawParam.type === "color" && rawParam.colorSpace) {
    normalized.metadata = {
      ...((normalized.metadata as { [key: string]: unknown }) || {}),
      colorSpace: rawParam.colorSpace,
    };
  }

  // Handle V4 visibility conditions
  if (rawParam.visibility) {
    normalized.visibility = rawParam.visibility;
  }

  // Handle V4 nested group parameters
  if (rawParam.type === "group" && Array.isArray(rawParam.parameters)) {
    normalized.parameters = rawParam.parameters.map(normalizeV4Parameter);
  }

  return normalized as unknown as WorkspaceParameter;
};

// Normaliserar array av V4 parametrar och plattar ut grupper
const normalizeV4Parameters = (raw: unknown): WorkspaceParameter[] => {
  // V4 API wraps parameters in { value: [...], Count: n } structure
  const paramsCandidate =
    isUnknownValueMap(raw) && Array.isArray(raw.value) ? raw.value : raw;

  if (!Array.isArray(paramsCandidate)) return [];

  const normalized: WorkspaceParameter[] =
    paramsCandidate.map(normalizeV4Parameter);

  // Flatten group parameters: extract nested parameters and add them to top level
  const flattened: WorkspaceParameter[] = [];
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
const getEsriResponseStatus = (
  response: EsriResponseLike
): number | undefined => {
  const httpStatus = response?.httpStatus;
  const status = response?.status;
  return typeof httpStatus === "number"
    ? httpStatus
    : typeof status === "number"
      ? status
      : undefined;
};

// Härleder ok-status från esriRequest-svar
const getEsriResponseOk = (response: EsriResponseLike): boolean | undefined => {
  const status = getEsriResponseStatus(response);
  if (typeof status !== "number") return undefined;
  return isSuccessStatus(status);
};

// Beräknar storlek av esriRequest-svar (bytes)
const getEsriResponseSize = (
  response: EsriResponseLike
): number | undefined => {
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
const unwrapModule = <T>(module: T): T => {
  if (module && typeof module === "object" && "default" in module) {
    const candidate = module as { default?: T };
    if (candidate.default !== undefined) {
      return candidate.default;
    }
  }
  return module;
};

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

// Cache the result to avoid repeated config lookups
let _cachedMaxUrlLength: number | null = null;
const getMaxUrlLength = (): number => {
  if (_cachedMaxUrlLength !== null) return _cachedMaxUrlLength;

  const cfg = asEsriConfig(_esriConfig);
  const n = cfg?.request?.maxUrlLength;
  _cachedMaxUrlLength =
    typeof n === "number" && n > 0 ? n : FME_FLOW_API.MAX_URL_LENGTH;
  return _cachedMaxUrlLength;
};

// Hämtar fallback-mock för given nyckel
const getEsriMockFallback = (key: EsriMockKey): unknown =>
  ESRI_MOCK_FALLBACKS[key];

// Applicerar globala Esri-mocks från test-miljö
const applyGlobalEsriMocks = (source: EsriMockSource): void => {
  if (!source) return;
  const assignments: EsriMockAssignments = {
    esriRequest: (value) => {
      _esriRequest = value;
    },
    esriConfig: (value) => {
      _esriConfig = value;
    },
    projection: (value) => {
      _projection = value;
    },
    webMercatorUtils: (value) => {
      _webMercatorUtils = value;
    },
    SpatialReference: (value) => {
      _SpatialReference = value;
    },
  };

  for (const key of ESRI_GLOBAL_MOCK_KEYS) {
    const candidate = key in source ? source[key] : undefined;
    const value = candidate ?? getEsriMockFallback(key);
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
const getGlobalMockSource = (): { [key: string]: unknown } | null => {
  try {
    const scope = globalThis as { [key: string]: unknown };
    return ESRI_GLOBAL_MOCK_KEYS.some((key) => key in scope) ? scope : null;
  } catch {
    return null;
  }
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
    const mockSource = getGlobalMockSource();
    if (mockSource) {
      applyGlobalEsriMocks(mockSource);
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

const isEsriRequestInterceptor = (
  candidate: unknown
): candidate is EsriRequestInterceptor => {
  if (!isUnknownValueMap(candidate)) return false;
  const record = candidate as { [key: string]: unknown };

  const { before, error: errorHandler } = record;
  if (before !== undefined && typeof before !== "function") return false;
  if (errorHandler !== undefined && typeof errorHandler !== "function")
    return false;

  const { urls } = record;
  if (urls === undefined) return true;
  if (typeof urls === "string" || urls instanceof RegExp) return true;
  if (Array.isArray(urls)) return true;
  return false;
};

function removeMatchingInterceptors(
  interceptors: EsriInterceptorList,
  pattern: RegExp
): void {
  if (!Array.isArray(interceptors) || !interceptors.length) return;

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const candidate = interceptors[i];
    if (!isEsriRequestInterceptor(candidate) || !candidate._fmeInterceptor)
      continue;

    const urls = candidate.urls;
    let matches = false;
    if (urls instanceof RegExp) {
      matches = urls.source === pattern.source && urls.flags === pattern.flags;
    } else if (Array.isArray(urls)) {
      matches = urls.some((url) => pattern.test(String(url ?? "")));
    } else if (typeof urls === "string") {
      matches = pattern.test(urls);
    }

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
):
  | ((url: string, options: { [key: string]: unknown }) => Promise<unknown>)
  | null =>
  typeof v === "function"
    ? (v as (
        url: string,
        options: { [key: string]: unknown }
      ) => Promise<unknown>)
    : null;

// Type guard för esriConfig-objekt
const asEsriConfig = (v: unknown): EsriRequestConfig | null => {
  if (!isObjectType(v)) return null;
  const candidate = v as {
    request?: {
      maxUrlLength?: number | string;
      interceptors?: unknown;
    };
  };
  if (!candidate.request) return null;
  if (!Array.isArray(candidate.request.interceptors)) return null;
  return candidate as unknown as EsriRequestConfig;
};

const asProjection = (
  v: unknown
): {
  project?: (geometry: unknown, spatialReference: unknown) => unknown;
  load?: () => Promise<void>;
  isLoaded?: () => boolean;
} | null => (isObjectType(v) ? (v as { [key: string]: unknown }) : null);

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
  before: (params: EsriInterceptorParams) => void;
  _fmeInterceptor: boolean;
} => ({
  urls: pattern,
  before(params: EsriInterceptorParams) {
    if (!isAllowedFmePath(params?.url)) {
      return;
    }

    if (!params?.requestOptions) {
      params.requestOptions = {};
    }
    const requestOptions: EsriInterceptorRequestOptions = params.requestOptions;
    const headers = (requestOptions.headers ?? {}) as { [key: string]: string };
    const query = requestOptions.query ?? {};
    requestOptions.headers = headers;
    requestOptions.query = query;

    // Injicerar cachelagrad FME-token i query och headers
    const currentToken = getCachedToken(hostKey);
    if (currentToken) {
      if (!query.fmetoken) {
        query.fmetoken = currentToken;
      }
      headers.Authorization = `fmetoken token=${currentToken}`;
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

const hasPublishedParameters = (
  value: PrimitiveParams | SubmitParametersPayload
): value is SubmitParametersPayload => {
  if (!isUnknownValueMap(value)) return false;
  return Array.isArray(value.publishedParameters);
};

const buildTMDirectives = (params: PrimitiveParams): TMDirectives => {
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
const buildSubmitBody = (
  publishedParameters: PublishedParameterEntry[],
  params: PrimitiveParams
): SubmitParametersPayload => {
  const tmDirectives = buildTMDirectives(params);
  const nmDirectives = buildNMDirectives();

  const body: SubmitParametersPayload = { publishedParameters };

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
    console.log('[FME] FmeFlowApiClient initialized', {
      serverUrl: config.serverUrl,
      repository: config.repository,
      hasToken: !!config.token,
      tokenLength: config.token?.length || 0,
    });
    this.config = Object.freeze({ ...config });
    this.setupPromise = Promise.resolve();
    this.queueSetup(config);
  }

  // Köar async setup av Esri-inställningar och token-interceptor
  private queueSetup(config: FmeFlowConfig): void {
    this.setupPromise = (this.setupPromise || Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        try {
          await setApiSettings();
          await addFmeInterceptor(config.serverUrl, config.token);
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
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
    console.log('[FME] uploadToTemp called', {
      fileSize: file.size,
      fileType: file.type,
      hasWorkspace: !!options?.workspace,
    });
    
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const repository = this.resolveRepository(options?.repository);
    const workspace = toNonEmptyTrimmedString(options?.workspace);
    if (!workspace) {
      throw makeFlowError("DATA_UPLOAD_ERROR");
    }

    const rawName =
      toNonEmptyTrimmedString(file instanceof File ? file.name : undefined) ||
      `upload_${Date.now()}`;
    const safeName =
      rawName
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .slice(0, FILE_UPLOAD.MAX_FILENAME_LENGTH) || `upload_${Date.now()}`;

    const rawNamespace = toNonEmptyTrimmedString(options?.subfolder);
    const sanitizedNamespace = rawNamespace
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .slice(0, FILE_UPLOAD.MAX_NAMESPACE_LENGTH);
    const namespace = sanitizedNamespace || createCorrelationId("upload");
    if (typeof FormData === "undefined") {
      throw makeFlowError("FORMDATA_UNSUPPORTED");
    }

    const connection = FME_FLOW_API.TEMP_RESOURCE_CONNECTION;
    const endpoint = buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "resources",
      "connections",
      connection,
      "upload"
    );

    const query: PrimitiveParams = {
      overwrite: "true",
    };
    if (namespace) {
      query.path = namespace;
    }

    const formData = new FormData();
    formData.append("file", file, safeName);

    const response = await this.request<unknown>(endpoint, {
      method: HttpMethod.POST,
      headers: { Accept: "application/json" },
      body: formData,
      query,
      signal: options?.signal,
      cacheHint: false,
      repositoryContext: repository,
    });

    const resolvedPath =
      extractUploadedResourcePath(response.data) ||
      buildResourcePathReference(connection, namespace, safeName);

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
  private formatJobParams(
    parameters: PrimitiveParams | SubmitParametersPayload = {}
  ): SubmitParametersPayload {
    // Om redan i rätt format, returnera direkt
    if (hasPublishedParameters(parameters)) return parameters;

    // TM-parametrar som ska filtreras bort
    const SERVICE_DIRECTIVE_KEYS = [
      "opt_servicemode",
      "opt_responseformat",
      "opt_showresult",
      "opt_requesteremail",
    ];

    // Bygger lista med publicerade parametrar
    const publishedParameters: PublishedParameterEntry[] = Object.entries(
      parameters
    )
      .filter(
        ([name]) =>
          !TM_PARAM_KEYS.some((key) => key === name) &&
          !SERVICE_DIRECTIVE_KEYS.includes(name)
      )
      .map(([name, value]) => ({ name, value }));

    return buildSubmitBody(publishedParameters, parameters);
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
    // V4 API expects workspace name with .fmw extension for all endpoints
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
        const raw = await this.request(listEndpoint, {
          signal,
          cacheHint: false, // Undvik cache över tokens
          query: { limit: NETWORK_CONFIG.API_QUERY_LIMIT, offset: 0 },
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
    const response = await this.request(endpoint, {
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
        const response = await this.request(endpoint, {
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
      items: unknown[];
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
  ): Promise<ApiResponse> {
    const repo = this.resolveRepository(repository);
    // V4 API: Use /workspaces/{repo}/{workspace}
    const endpoint = this.workspaceEndpoint(repo, workspace);
    return this.withApiError(
      () =>
        this.request(endpoint, {
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
    console.log('[FME] submitJob - async mode', { 
      workspace, 
      repository: repository || this.config.repository,
      hasEmail: !!parameters.opt_requesteremail,
    });
    
    const repo = this.resolveRepository(repository);
    // V4 API: Use workspace-specific endpoint for job submission
    const endpoint = this.workspaceEndpoint(repo, workspace, "submit");
    const jobRequest = this.formatJobParams(parameters);

    console.log('[FME] Job request body keys:', Object.keys(jobRequest));

    // Bygger service-mode query-parametrar
    const query: PrimitiveParams = {};
    if (parameters.opt_servicemode)
      query.opt_servicemode = parameters.opt_servicemode;
    if (parameters.opt_responseformat)
      query.opt_responseformat = parameters.opt_responseformat;
    if (parameters.opt_showresult)
      query.opt_showresult = parameters.opt_showresult;
    if (parameters.opt_requesteremail)
      query.opt_requesteremail = parameters.opt_requesteremail;

    return this.withApiError(
      () =>
        this.request<JobResult>(endpoint, {
          method: HttpMethod.POST,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jobRequest),
          query,
          signal,
          cacheHint: false,
        }),
      "JOB_SUBMISSION_ERROR",
      "JOB_SUBMISSION_ERROR"
    );
  }

  async runWorkspace(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository?: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    console.log('[FME] runWorkspace called', {
      workspace,
      repository: repository || this.config.repository,
      paramCount: Object.keys(parameters).length,
      hasSignal: !!signal,
    });
    
    const targetRepository = this.resolveRepository(repository);
    const serviceMode = this.resolveServiceMode(parameters);
    
    console.log('[FME] Service mode:', serviceMode, 'for workspace:', workspace);

    if (serviceMode === "async") {
      return await this.submitJob(
        workspace,
        parameters,
        targetRepository,
        signal
      );
    }

    return await this.runDataDownload(
      workspace,
      parameters,
      targetRepository,
      signal
    );
  }

  private async runDataDownload(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    console.log('[FME] runDataDownload - sync mode', { workspace, repository });
    return await this.runDownloadWebhook(
      workspace,
      parameters,
      repository,
      signal
    );
  }

  private async runDownloadWebhook(
    workspace: string,
    parameters: PrimitiveParams = {},
    repository: string,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    console.log('[FME] runDownloadWebhook starting', { workspace, repository });
    try {
      const webhookUrl = buildUrl(
        this.config.serverUrl,
        "fmedatadownload",
        repository,
        workspace
      );
      const params = buildParams(
        parameters,
        [...FME_FLOW_API.WEBHOOK_EXCLUDE_KEYS],
        true
      );

      // Append token if available
      if (this.config.token) {
        params.set("token", this.config.token);
      }

      const q = params.toString();
      const fullUrl = `${webhookUrl}?${q}`;
      console.log('[FME] Webhook URL length:', fullUrl.length, 'chars');
      
      try {
        const maxLen = getMaxUrlLength();
        if (
          typeof maxLen === "number" &&
          maxLen > 0 &&
          fullUrl.length > maxLen
        ) {
          console.error('[FME] URL too long!', { length: fullUrl.length, maxLen });
          // Emit a dedicated error code for URL length issues
          throw makeFlowError("URL_TOO_LONG", 0);
        }
      } catch (lenErr) {
        if (lenErr instanceof FmeFlowApiError) throw lenErr;
        // If any unexpected error occurs during length validation, proceed with webhook
      }

      // Best-effort safe logging without sensitive params
      safeLogParams(
        "WEBHOOK_CALL",
        webhookUrl,
        params,
        FME_FLOW_API.WEBHOOK_LOG_WHITELIST
      );

      console.log('[FME] Fetching webhook URL:', webhookUrl.substring(0, 100) + '...');
      const response = await fetch(fullUrl, {
        method: "GET",
        signal,
      });
      
      console.log('[FME] Webhook response:', { status: response.status, ok: response.ok });
      return this.parseWebhookResponse(response);
    } catch (err) {
      console.error('[FME] runDownloadWebhook error:', err);
      if (err instanceof FmeFlowApiError) throw err;
      const status = extractHttpStatus(err);
      // Surface a code-only message; services will localize
      throw makeFlowError("DATA_DOWNLOAD_ERROR", status || 0);
    }
  }

  private async parseWebhookResponse(response: Response): Promise<ApiResponse> {
    const contentType = response.headers.get("content-type");

    if (!isJson(contentType)) {
      throw makeFlowError("WEBHOOK_AUTH_ERROR", response.status);
    }

    let responseData: unknown;
    try {
      responseData = await response.json();
    } catch {
      console.warn("FME API - Failed to parse webhook JSON response");
      throw makeFlowError("WEBHOOK_AUTH_ERROR", response.status);
    }

    if (isAuthError(response.status)) {
      throw makeFlowError("WEBHOOK_AUTH_ERROR", response.status);
    }

    return {
      data: responseData,
      status: response.status,
      statusText: response.statusText,
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
    const query: PrimitiveParams = { ...(options.query || {}) };

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

    const requestOptions: EsriRequestOptions = {
      method: (options.method ?? HttpMethod.GET).toLowerCase(),
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
        // Bestäm endpoint-typ för token-injektion
        const isRestApiEndpoint =
          endpoint.includes("/jobs") || endpoint.includes("/fmeapiv4");
        const isWebhookEndpoint =
          endpoint.includes("/fmedatadownload") ||
          endpoint.includes("/fmedatastreaming");

        // Lägg till fmetoken i query om ej webhook-endpoint
        if (!query.fmetoken && (isWebhookEndpoint || !isRestApiEndpoint)) {
          query.fmetoken = this.config.token;
        }

        // Lägg till Authorization-header
        const authHeaders = {
          ...(requestOptions.headers ?? {}),
        } as { [key: string]: string };
        authHeaders.Authorization = `fmetoken token=${this.config.token}`;
        requestOptions.headers = authHeaders;
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
      const response = await instrumentedRequest<EsriRequestResponse<T>>({
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
        execute: () =>
          esriRequestFn(url, requestOptions) as Promise<EsriRequestResponse<T>>,
      });

      return {
        data: response.data,
        status: response.httpStatus ?? response.status ?? HTTP_STATUS_CODES.OK,
        statusText: response.statusText ?? "",
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

  async getJobStatus(
    jobId: number,
    signal?: AbortSignal
  ): Promise<ApiResponse<JobResult>> {
    if (!Number.isFinite(jobId) || jobId <= 0) {
      throw makeFlowError("JOB_STATUS_ERROR");
    }

    const endpoint = buildUrl(
      this.config.serverUrl,
      this.basePath.slice(1),
      "jobs",
      String(jobId)
    );

    return this.withApiError(
      () =>
        this.request<JobResult>(endpoint, {
          signal,
          cacheHint: false,
        }),
      "JOB_STATUS_ERROR",
      "JOB_STATUS_ERROR"
    );
  }

  private resolveServiceMode(parameters: PrimitiveParams = {}): ServiceMode {
    const raw = (parameters as { [key: string]: unknown })?.opt_servicemode;
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (normalized === "sync" || normalized === "async") {
        return normalized as ServiceMode;
      }
    }
    return "async";
  }
}

/* Config-normalisering och client factory */

// Normaliserar FmeExportConfig till intern FmeFlowConfig
const normalizeConfigParams = (config: FmeExportConfig): FmeFlowConfig => ({
  serverUrl:
    toNonEmptyTrimmedString(config.fmeServerUrl) ||
    toNonEmptyTrimmedString(Reflect.get(config, "fme_server_url") as unknown) ||
    "",
  token:
    toNonEmptyTrimmedString(config.fmeServerToken) ||
    toNonEmptyTrimmedString(
      Reflect.get(config, "fme_server_token") as unknown
    ) ||
    toNonEmptyTrimmedString(
      Reflect.get(config, "fmw_server_token") as unknown
    ) ||
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
