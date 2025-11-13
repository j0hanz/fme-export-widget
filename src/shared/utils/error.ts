import type {
  ClassifiedError,
  ErrorFactoryOptions,
  ErrorSeverity,
  ErrorState,
  SerializableErrorState,
  TranslateFn,
} from "../../config/index";
import {
  ABORT_ERROR_NAMES,
  ABORT_REGEX,
  DEFAULT_ERROR_ICON,
  ERROR_MAPPING_RULES,
  ErrorSeverity as ErrorSeverityEnum,
  ErrorType as ErrorTypeEnum,
  ICON_BY_EXACT_CODE,
  TOKEN_ICON_PRIORITY,
} from "../../config/index";
import { extractHttpStatus } from "../validations";
import { toStr } from "./conversion";
import { buildSupportHintText, resolveMessageOrKey } from "./format";

const normalizeCodeForMatching = (raw: string): string =>
  raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

const findIconByToken = (normalizedCode: string): string | undefined => {
  for (const { token, icon } of TOKEN_ICON_PRIORITY) {
    if (normalizedCode.includes(token)) {
      return icon;
    }
  }
  return undefined;
};

export const getErrorIconSrc = (code?: string): string => {
  if (typeof code !== "string" || !code.trim()) return DEFAULT_ERROR_ICON;

  const normalized = normalizeCodeForMatching(code.trim());

  const exact =
    ICON_BY_EXACT_CODE[normalized as keyof typeof ICON_BY_EXACT_CODE];
  if (exact) return exact;

  const tokenMatch = findIconByToken(normalized);
  if (tokenMatch) return tokenMatch;

  return DEFAULT_ERROR_ICON;
};

// Kollar om fel är abort/cancel-fel
export const isAbortError = (error: unknown): boolean => {
  if (!error) return false;

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
    };

    const name = toStr(candidate.name ?? candidate.code);
    if (ABORT_ERROR_NAMES.has(name)) return true;

    if (!name || name === "Error") {
      const message = toStr(candidate.message);
      return ABORT_REGEX.test(message) || message.includes("signal is aborted");
    }
    return false;
  }

  if (typeof error === "string") {
    return ABORT_REGEX.test(error);
  }

  return false;
};

// Säker avbrytning av AbortController med anledning
export const safeAbortController = (
  controller: AbortController | null | undefined,
  reason?: unknown
): void => {
  if (!controller) return;

  try {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  } catch {
    try {
      controller.abort();
    } catch {}
  }
};

// Koppla en extern AbortSignal till en AbortController
export const linkAbortSignal = (
  externalSignal: AbortSignal | null | undefined,
  controller: AbortController,
  onAbort?: (reason?: unknown) => void
): (() => void) => {
  if (!externalSignal) return () => undefined;

  if (externalSignal.aborted) {
    const reason = (externalSignal as { reason?: unknown }).reason;
    safeAbortController(controller, reason);
    if (onAbort) onAbort(reason);
    return () => undefined;
  }

  const handler = () => {
    const reason = (externalSignal as { reason?: unknown }).reason;
    safeAbortController(controller, reason);
    if (onAbort) onAbort(reason);
  };

  externalSignal.addEventListener("abort", handler);

  return () => {
    try {
      externalSignal.removeEventListener("abort", handler);
    } catch {}
  };
};

export const logIfNotAbort = (_context: string, _error: unknown): void => {
  void (_context, _error);
};

export const shouldSuppressError = (
  error: { code?: string; message?: string } | null
): boolean => {
  if (!error) return true;
  const code = error.code || "";
  const message = error.message || "";
  return code === "CANCELLED" || code === "ABORT" || /cancel/i.test(message);
};

export const createErrorActions = (
  error: { code?: string },
  handlers: {
    onRetry?: () => void;
    onReload?: () => void;
  },
  translate: (key: string) => string
): Array<{ label: string; onClick: () => void }> => {
  void error;
  const actions: Array<{ label: string; onClick: () => void }> = [];

  if (handlers.onRetry) {
    actions.push({
      label: translate("actionRetry"),
      onClick: handlers.onRetry,
    });
  }

  if (handlers.onReload) {
    actions.push({
      label: translate("actionReload"),
      onClick: handlers.onReload,
    });
  }

  return actions;
};

// Validation helper functions (refactoring #2)
export const buildValidationErrors = <
  T extends { [key: string]: string | undefined },
>(
  validations: Array<{
    field: keyof T;
    validator: () => { ok: boolean; key?: string; reason?: string };
  }>
): { ok: boolean; errors: Partial<T> } => {
  const errors: Partial<T> = {};

  for (const { field, validator } of validations) {
    const result = validator();
    if (!result.ok) {
      const errorKey = result.key || result.reason;
      if (errorKey) {
        errors[field] = errorKey as T[keyof T];
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
};

/* ErrorMapper - Centralized error mapping to translation keys */

/** Extracts error properties into ClassifiedError structure. */
const classifyError = (err: unknown, status?: number): ClassifiedError => {
  const resolvedStatus = status ?? extractHttpStatus(err);
  const errorObj =
    err && typeof err === "object"
      ? (err as { code?: unknown; message?: unknown })
      : null;

  const errorCode =
    typeof errorObj?.code === "string" ? errorObj.code : undefined;
  const message =
    typeof errorObj?.message === "string" ? errorObj.message : undefined;

  return {
    status: resolvedStatus,
    code: errorCode,
    message,
    isRequestFailed: errorCode === "REQUEST_FAILED",
  };
};

const statusToKeyInternal = (status?: number): string | undefined => {
  if (typeof status !== "number") return undefined;
  if (ERROR_MAPPING_RULES.statusToKey[status]) {
    return ERROR_MAPPING_RULES.statusToKey[status];
  }
  return undefined;
};

const matchMessagePatternInternal = (message: string): string | undefined => {
  const lowerMessage = message.toLowerCase();
  for (const { pattern, key } of ERROR_MAPPING_RULES.messagePatterns) {
    if (pattern.test(lowerMessage)) return key;
  }
  return undefined;
};

const mapErrorInternal = (
  err: unknown,
  status?: number,
  context: "network" | "validation" | "geometry" = "network"
): string | undefined => {
  const classification = classifyError(err, status);

  if (context === "network" && classification.isRequestFailed) {
    return statusToKeyInternal(classification.status);
  }

  if (
    classification.code &&
    ERROR_MAPPING_RULES.codeToKey[classification.code]
  ) {
    return ERROR_MAPPING_RULES.codeToKey[classification.code];
  }

  if (context !== "geometry") {
    const statusKey = statusToKeyInternal(classification.status);
    if (statusKey) return statusKey;
  }

  if (classification.message) {
    const messageKey = matchMessagePatternInternal(classification.message);
    if (messageKey) return messageKey;
  }

  return context === "geometry" ? "geometrySerializationFailedCode" : undefined;
};

export const mapErrorFromNetwork = (
  err: unknown,
  status?: number
): string | undefined => mapErrorInternal(err, status, "network");

export const mapErrorFromValidation = (err: unknown): string | undefined =>
  mapErrorInternal(err, undefined, "validation");

export const mapErrorFromGeometry = (err: unknown): string =>
  mapErrorInternal(err, undefined, "geometry") ??
  "geometrySerializationFailedCode";

/* createError - Helper for creating ErrorState (runtime errors for validation) */

export const createError = (
  message: string,
  options: {
    type?: ErrorTypeEnum;
    code?: string;
    severity?: ErrorSeverity;
    recoverable?: boolean;
    userFriendlyMessage?: string;
    suggestion?: string;
    retry?: () => void;
  } = {}
): ErrorState => {
  const timestampMs = Date.now();
  return {
    message,
    type: options.type ?? ErrorTypeEnum.NETWORK,
    code: options.code ?? "UNKNOWN",
    severity: options.severity ?? ErrorSeverityEnum.ERROR,
    recoverable: options.recoverable ?? true,
    timestamp: new Date(),
    timestampMs,
    userFriendlyMessage: options.userFriendlyMessage ?? "",
    suggestion: options.suggestion ?? "",
    retry: options.retry,
    kind: "runtime",
  };
};

/* ErrorFactory - Centralized error creation producing SerializableErrorState */

const createTypedError = (
  type: ErrorTypeEnum,
  messageKey: string,
  options: ErrorFactoryOptions = {}
): SerializableErrorState => {
  const timestampMs = Date.now();
  const code = options.code ?? `${type.toUpperCase()}_ERROR`;
  const scope = options.scope ?? "general";
  const recoverable = options.recoverable ?? type !== ErrorTypeEnum.MODULE;

  return {
    message: messageKey,
    type,
    code,
    severity: options.severity ?? ErrorSeverityEnum.ERROR,
    recoverable,
    timestampMs,
    userFriendlyMessage: options.userFriendlyMessage ?? "",
    suggestion: options.suggestion ?? "",
    details: options.details,
    kind: "serializable",
    errorId: `${scope}_${code}`,
  };
};

// Specialized error creators using createTypedError
const ERROR_CREATORS: {
  [K in ErrorTypeEnum]: (
    messageKey: string,
    options?: ErrorFactoryOptions
  ) => SerializableErrorState;
} = {
  [ErrorTypeEnum.NETWORK]: (messageKey, options = {}) =>
    createTypedError(ErrorTypeEnum.NETWORK, messageKey, options),
  [ErrorTypeEnum.VALIDATION]: (messageKey, options = {}) =>
    createTypedError(ErrorTypeEnum.VALIDATION, messageKey, options),
  [ErrorTypeEnum.CONFIG]: (messageKey, options = {}) =>
    createTypedError(ErrorTypeEnum.CONFIG, messageKey, options),
  [ErrorTypeEnum.GEOMETRY]: (messageKey, options = {}) =>
    createTypedError(ErrorTypeEnum.GEOMETRY, messageKey, options),
  [ErrorTypeEnum.MODULE]: (messageKey, options = {}) =>
    createTypedError(ErrorTypeEnum.MODULE, messageKey, options),
};

export const createNetworkError = ERROR_CREATORS[ErrorTypeEnum.NETWORK];
export const createValidationError = ERROR_CREATORS[ErrorTypeEnum.VALIDATION];
export const createConfigError = ERROR_CREATORS[ErrorTypeEnum.CONFIG];
export const createGeometryError = ERROR_CREATORS[ErrorTypeEnum.GEOMETRY];
export const createModuleError = ERROR_CREATORS[ErrorTypeEnum.MODULE];

export const formatErrorPresentation = (
  error: SerializableErrorState | ErrorState,
  translate: TranslateFn,
  supportEmail?: string
): { message: string; code?: string; hint?: string } => {
  const codeUpper = error.code.toUpperCase();
  const isGeometryInvalid =
    codeUpper === "GEOMETRY_INVALID" || codeUpper === "INVALID_GEOMETRY";
  const isAreaTooLarge = codeUpper === "AREA_TOO_LARGE";
  const isConfigIncomplete = codeUpper === "CONFIG_INCOMPLETE";
  const suppressSupport =
    isGeometryInvalid || isAreaTooLarge || isConfigIncomplete;

  const message =
    resolveMessageOrKey(error.message, translate) || error.message;
  const userFriendly = error.userFriendlyMessage || undefined;

  let hint: string;
  if (isGeometryInvalid) {
    hint = translate("hintGeometryInvalid");
  } else if (isAreaTooLarge) {
    hint = translate("hintAreaTooLarge");
  } else if (isConfigIncomplete) {
    hint = translate("hintSetupWidget");
  } else {
    hint = buildSupportHintText(translate, supportEmail, userFriendly);
  }

  return {
    message,
    code: suppressSupport ? undefined : error.code,
    hint,
  };
};
