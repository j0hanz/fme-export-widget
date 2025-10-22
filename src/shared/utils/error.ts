import type {
  ErrorState,
  ErrorType,
  ErrorSeverity,
  TranslateFn,
} from "../../config/index"
import {
  HTTP_STATUS_CODES,
  ERROR_CODE_TO_KEY,
  STATUS_TO_KEY_MAP,
  MESSAGE_PATTERNS,
  STATUS_PROPERTIES,
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
      if (process.env.NODE_ENV !== "production") {
        console.warn("safeAbort: Unexpected error during abort", err)
      }
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

export interface ErrorContext {
  message: string
  code?: string
  hint?: string
  suppressSupport: boolean
}

export const buildErrorContext = (
  error: { code?: string; message?: string; userFriendlyMessage?: string },
  supportEmail: string | undefined,
  translate: (key: string) => string,
  formatErrorForView: (
    translate: any,
    msgKey: string,
    code: any,
    supportEmail: any,
    ufm?: string
  ) => { hint?: string; message: string }
): ErrorContext => {
  const codeUpper = (error.code || "").toUpperCase()
  const isGeometryInvalid =
    codeUpper === "GEOMETRY_INVALID" || codeUpper === "INVALID_GEOMETRY"
  const isAreaTooLarge = codeUpper === "AREA_TOO_LARGE"
  const isAoiRetryableError = isGeometryInvalid || isAreaTooLarge
  const isConfigIncomplete = codeUpper === "CONFIG_INCOMPLETE"
  const suppressSupport = isAoiRetryableError || isConfigIncomplete

  const baseMsgKey = error.message || "errorUnknown"
  const ufm = error.userFriendlyMessage

  let hint: string
  if (isGeometryInvalid) {
    hint = translate("hintGeometryInvalid")
  } else if (isAreaTooLarge) {
    hint = translate("hintAreaTooLarge")
  } else if (isConfigIncomplete) {
    hint = translate("hintSetupWidget")
  } else {
    const result = formatErrorForView(
      translate,
      baseMsgKey,
      error.code,
      supportEmail,
      typeof ufm === "string" ? ufm : undefined
    )
    hint = result.hint || ""
  }

  return {
    message: baseMsgKey,
    code: suppressSupport ? undefined : error.code,
    hint,
    suppressSupport,
  }
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

// Error mapping and creation functions (consolidated from validations.ts)
const statusToKey = (s?: number): string | undefined => {
  if (typeof s !== "number") return undefined
  if (STATUS_TO_KEY_MAP[s]) return STATUS_TO_KEY_MAP[s]
  if (s >= 500) return "errorServerIssue"
  return undefined
}

const matchMessagePattern = (message: string): string | undefined => {
  const lowerMessage = message.toLowerCase()
  for (const { pattern, key } of MESSAGE_PATTERNS) {
    if (pattern.test(lowerMessage)) return key
  }
  return undefined
}

const classifyError = (err: unknown, status?: number) => {
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

export const mapErrorToKey = (err: unknown, status?: number): string => {
  const classification = classifyError(err, status)

  if (classification.isRequestFailed) {
    return statusToKey(classification.status) || "errorServerIssue"
  }

  if (classification.code && ERROR_CODE_TO_KEY[classification.code]) {
    return ERROR_CODE_TO_KEY[classification.code]
  }

  const statusKey = statusToKey(classification.status)
  if (statusKey) return statusKey

  if (classification.message) {
    const messageKey = matchMessagePattern(classification.message)
    if (messageKey) return messageKey
  }

  return "errorUnknown"
}

export const createRuntimeError = (
  message: string,
  options: {
    type?: ErrorType
    code?: string
    severity?: ErrorSeverity
    recoverable?: boolean
    userFriendlyMessage?: string
    suggestion?: string
    retry?: () => void
  } = {}
): ErrorState => ({
  message,
  type: options.type ?? ErrorTypeEnum.NETWORK,
  code: options.code ?? "UNKNOWN",
  severity: options.severity ?? ErrorSeverityEnum.ERROR,
  recoverable: options.recoverable ?? true,
  timestamp: new Date(),
  timestampMs: Date.now(),
  userFriendlyMessage: options.userFriendlyMessage ?? "",
  suggestion: options.suggestion ?? "",
  retry: options.retry,
  kind: "runtime",
})

export const createError = (
  messageKey: string,
  type: ErrorType,
  code: string,
  translate: TranslateFn,
  options?: {
    suggestion?: string
    userFriendlyMessage?: string
    retry?: () => void
  }
): ErrorState =>
  createRuntimeError(translate(messageKey) || messageKey, {
    type,
    code,
    ...options,
    suggestion:
      options?.suggestion || translate("connectionSettingsHint") || "",
  })

export function formatErrorForView(
  translate: TranslateFn,
  baseKeyOrMessage: string,
  code?: string,
  supportEmail?: string,
  userFriendly?: string
): { message: string; code?: string; hint?: string } {
  const message =
    resolveMessageOrKey(baseKeyOrMessage, translate) || baseKeyOrMessage
  const hint = buildSupportHintText(translate, supportEmail, userFriendly)
  return { message, code, hint }
}
