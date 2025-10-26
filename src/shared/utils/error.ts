import type {
  ErrorState,
  SerializableErrorState,
  ErrorSeverity,
  TranslateFn,
  ErrorFactoryOptions,
  ErrorMappingRules,
  ClassifiedError,
} from "../../config/index"
import {
  ERROR_CODE_TO_KEY,
  STATUS_TO_KEY_MAP,
  MESSAGE_PATTERNS,
  ErrorType as ErrorTypeEnum,
  ErrorSeverity as ErrorSeverityEnum,
} from "../../config/index"
import { extractHttpStatus } from "../validations"
import { resolveMessageOrKey, buildSupportHintText } from "./format"

const DEFAULT_ERROR_ICON = "error"

const ICON_BY_EXACT_CODE = Object.freeze<{ [code: string]: string }>({
  GEOMETRY_SERIALIZATION_FAILED: "polygon",
  MAP_MODULES_LOAD_FAILED: "map",
  FORM_INVALID: "warning",
})

const TOKEN_ICON_PRIORITY: ReadonlyArray<{ token: string; icon: string }> =
  Object.freeze([
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
  ])

const normalizeCodeForMatching = (raw: string): string =>
  raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()

export const getErrorIconSrc = (code?: string): string => {
  if (typeof code !== "string") return DEFAULT_ERROR_ICON

  const trimmed = code.trim()
  if (!trimmed) return DEFAULT_ERROR_ICON

  const normalized = normalizeCodeForMatching(trimmed)

  const exact = ICON_BY_EXACT_CODE[normalized]
  if (exact) return exact

  const tokens = normalized.split(/[^A-Z0-9]+/).filter(Boolean)
  const tokenSet = new Set(tokens)

  for (const { token, icon } of TOKEN_ICON_PRIORITY) {
    if (tokenSet.has(token) || normalized.includes(token)) {
      return icon
    }
  }

  return DEFAULT_ERROR_ICON
}

export const safeAbort = (ctrl: AbortController | null) => {
  if (ctrl) {
    try {
      ctrl.abort()
    } catch (err) {
      console.warn("safeAbort: Unexpected error during abort", err)
    }
  }
}

export const logIfNotAbort = (_context: string, _error: unknown): void => {
  void (_context, _error)
}

export const shouldSuppressError = (
  error: { code?: string; message?: string } | null
): boolean => {
  if (!error) return true
  const code = error.code || ""
  const message = error.message || ""
  return code === "CANCELLED" || code === "ABORT" || /cancel/i.test(message)
}

export const createErrorActions = (
  error: { code?: string },
  handlers: {
    onRetry?: () => void
    onReload?: () => void
  },
  translate: (key: string) => string
): Array<{ label: string; onClick: () => void }> => {
  const actions: Array<{ label: string; onClick: () => void }> = []

  if (handlers.onRetry) {
    actions.push({
      label: translate("actionRetry"),
      onClick: handlers.onRetry,
    })
  }

  if (handlers.onReload) {
    actions.push({
      label: translate("actionReload"),
      onClick: handlers.onReload,
    })
  }

  return actions
}

// Validation helper functions (refactoring #2)
export const buildValidationErrors = <T extends { [key: string]: any }>(
  validations: Array<{
    field: keyof T
    validator: () => { ok: boolean; key?: string; reason?: string }
  }>
): { ok: boolean; errors: Partial<T> } => {
  const errors: Partial<T> = {}

  for (const { field, validator } of validations) {
    const result = validator()
    if (!result.ok) {
      const errorKey = result.key || result.reason
      if (errorKey) {
        errors[field] = errorKey as any
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

/* ErrorMapper - Centralized error mapping to translation keys */

const ERROR_MAPPING_RULES: ErrorMappingRules = {
  codeToKey: ERROR_CODE_TO_KEY,
  statusToKey: STATUS_TO_KEY_MAP,
  messagePatterns: MESSAGE_PATTERNS,
}

const classifyError = (err: unknown, status?: number): ClassifiedError => {
  const resolvedStatus = status ?? extractHttpStatus(err)

  let errorCode: string | undefined
  let message: string | undefined

  if (err && typeof err === "object") {
    errorCode = (err as any).code
    message = (err as Error)?.message
  }

  return {
    status: resolvedStatus,
    code: typeof errorCode === "string" ? errorCode : undefined,
    message: typeof message === "string" ? message : undefined,
    isRequestFailed: errorCode === "REQUEST_FAILED",
  }
}

const statusToKeyInternal = (status?: number): string | undefined => {
  if (typeof status !== "number") return undefined
  if (ERROR_MAPPING_RULES.statusToKey[status]) {
    return ERROR_MAPPING_RULES.statusToKey[status]
  }
  return undefined
}

const matchMessagePatternInternal = (message: string): string | undefined => {
  const lowerMessage = message.toLowerCase()
  for (const { pattern, key } of ERROR_MAPPING_RULES.messagePatterns) {
    if (pattern.test(lowerMessage)) return key
  }
  return undefined
}

const mapErrorInternal = (
  err: unknown,
  status?: number,
  context: "network" | "validation" | "geometry" = "network"
): string | undefined => {
  const classification = classifyError(err, status)

  if (context === "network" && classification.isRequestFailed) {
    return statusToKeyInternal(classification.status)
  }

  if (
    classification.code &&
    ERROR_MAPPING_RULES.codeToKey[classification.code]
  ) {
    return ERROR_MAPPING_RULES.codeToKey[classification.code]
  }

  if (context !== "geometry") {
    const statusKey = statusToKeyInternal(classification.status)
    if (statusKey) return statusKey
  }

  if (classification.message) {
    const messageKey = matchMessagePatternInternal(classification.message)
    if (messageKey) return messageKey
  }

  return context === "geometry" ? "geometrySerializationFailedCode" : undefined
}

export const mapErrorFromNetwork = (
  err: unknown,
  status?: number
): string | undefined => mapErrorInternal(err, status, "network")

export const mapErrorFromValidation = (err: unknown): string | undefined =>
  mapErrorInternal(err, undefined, "validation")

export const mapErrorFromGeometry = (err: unknown): string =>
  mapErrorInternal(err, undefined, "geometry") ??
  "geometrySerializationFailedCode"

/* createError - Helper for creating ErrorState (runtime errors for validation) */

export const createError = (
  message: string,
  options: {
    type?: ErrorTypeEnum
    code?: string
    severity?: ErrorSeverity
    recoverable?: boolean
    userFriendlyMessage?: string
    suggestion?: string
    retry?: () => void
  } = {}
): ErrorState => {
  const timestampMs = Date.now()
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
  }
}

/* ErrorFactory - Centralized error creation producing SerializableErrorState */

const createTypedError = (
  type: ErrorTypeEnum,
  messageKey: string,
  options: ErrorFactoryOptions = {}
): SerializableErrorState => {
  const timestampMs = Date.now()
  const code = options.code ?? `${type.toUpperCase()}_ERROR`
  const scope = options.scope ?? "general"
  const recoverable = options.recoverable ?? type !== ErrorTypeEnum.MODULE

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
  }
}

export const createNetworkError = (
  messageKey: string,
  options: ErrorFactoryOptions = {}
): SerializableErrorState =>
  createTypedError(ErrorTypeEnum.NETWORK, messageKey, options)

export const createValidationError = (
  messageKey: string,
  options: ErrorFactoryOptions = {}
): SerializableErrorState =>
  createTypedError(ErrorTypeEnum.VALIDATION, messageKey, options)

export const createConfigError = (
  messageKey: string,
  options: ErrorFactoryOptions = {}
): SerializableErrorState =>
  createTypedError(ErrorTypeEnum.CONFIG, messageKey, options)

export const createGeometryError = (
  messageKey: string,
  options: ErrorFactoryOptions = {}
): SerializableErrorState =>
  createTypedError(ErrorTypeEnum.GEOMETRY, messageKey, options)

export const createModuleError = (
  messageKey: string,
  options: ErrorFactoryOptions = {}
): SerializableErrorState =>
  createTypedError(ErrorTypeEnum.MODULE, messageKey, options)

export const formatErrorPresentation = (
  error: SerializableErrorState | ErrorState,
  translate: TranslateFn,
  supportEmail?: string
): { message: string; code?: string; hint?: string } => {
  const codeUpper = error.code.toUpperCase()
  const isGeometryInvalid =
    codeUpper === "GEOMETRY_INVALID" || codeUpper === "INVALID_GEOMETRY"
  const isAreaTooLarge = codeUpper === "AREA_TOO_LARGE"
  const isConfigIncomplete = codeUpper === "CONFIG_INCOMPLETE"
  const suppressSupport =
    isGeometryInvalid || isAreaTooLarge || isConfigIncomplete

  const message = resolveMessageOrKey(error.message, translate) || error.message
  const userFriendly = error.userFriendlyMessage || undefined

  let hint: string
  if (isGeometryInvalid) {
    hint = translate("hintGeometryInvalid")
  } else if (isAreaTooLarge) {
    hint = translate("hintAreaTooLarge")
  } else if (isConfigIncomplete) {
    hint = translate("hintSetupWidget")
  } else {
    hint = buildSupportHintText(translate, supportEmail, userFriendly)
  }

  return {
    message,
    code: suppressSupport ? undefined : error.code,
    hint,
  }
}
