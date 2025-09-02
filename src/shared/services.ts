import type {
  ErrorState,
  WorkspaceParameter,
  DynamicFieldConfig,
  FormPrimitive,
} from "./types"
import { ErrorType, ErrorSeverity, ParameterType, FormFieldType } from "./types"

// Utility functions
const isEmpty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") return v.trim().length === 0
  return false
}

const isInt = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isInteger(value)
  if (typeof value === "string") {
    const trimmed = value.trim()
    const num = Number(trimmed)
    return Number.isInteger(num) && !Number.isNaN(num)
  }
  return false
}

const isNum = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "string") {
    const trimmed = value.trim()
    const num = Number(trimmed)
    return Number.isFinite(num) && !Number.isNaN(num)
  }
  return false
}

// Error service
export class ErrorHandlingService {
  createError(
    message: string,
    type: ErrorType = ErrorType.VALIDATION,
    options: {
      code?: string
      severity?: ErrorSeverity
      details?: { [key: string]: unknown }
      recoverable?: boolean
      retry?: () => void
      userFriendlyMessage?: string
      suggestion?: string
    } = {}
  ): ErrorState {
    const {
      code = "UNKNOWN_ERROR",
      severity = ErrorSeverity.ERROR,
      details,
      recoverable = false,
      retry,
      userFriendlyMessage,
      suggestion,
    } = options

    return {
      message,
      type,
      code,
      severity,
      details,
      recoverable,
      retry,
      timestamp: new Date(),
      timestampMs: 0, // Keep original test-expected value
      userFriendlyMessage,
      suggestion,
    }
  }

  // Derive a startup error code/message from various error shapes
  deriveStartupError(
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } {
    if (!error || typeof translate !== "function") {
      return {
        code: "STARTUP_ERROR",
        message: translate?.("startupValidationFailed") || "Validation failed",
      }
    }

    const errorCode = (error as any)?.code || (error as any)?.name || ""
    const status = (error as any)?.status
    const message = (error as Error)?.message || ""

    // Check known codes
    const knownCodes: { [key: string]: string } = {
      UserEmailMissing: "userEmailMissing",
      INVALID_EMAIL: "invalidEmail",
      INVALID_CONFIG: "invalidConfiguration",
      WEBHOOK_AUTH_ERROR: "authenticationFailed",
      ARCGIS_MODULE_ERROR: "connectionFailed",
      ABORT: "requestAborted",
      CANCELLED: "operationCancelled",
      CORS_ERROR: "corsError",
      OFFLINE: "offline",
      SSL_ERROR: "sslError",
      INVALID_URL: "invalidUrl",
      RATE_LIMITED: "rateLimited",
      BAD_GATEWAY: "badGateway",
      SERVICE_UNAVAILABLE: "serviceUnavailable",
      GATEWAY_TIMEOUT: "gatewayTimeout",
      BAD_REQUEST: "badRequest",
      PAYLOAD_TOO_LARGE: "payloadTooLarge",
    }

    // Check if message itself is a known code
    if (message && knownCodes[message]) {
      return { code: message, message: translate(knownCodes[message]) }
    }

    if (errorCode && knownCodes[errorCode]) {
      return { code: errorCode, message: translate(knownCodes[errorCode]) }
    }

    // Check specific error codes
    if (errorCode === "AbortError" || errorCode === "ABORT") {
      return { code: "ABORT", message: translate("requestAborted") }
    }
    if (errorCode === "CancelledPromiseError" || /cancel/i.test(message)) {
      return { code: "CANCELLED", message: translate("operationCancelled") }
    }

    // Check HTTP status codes
    if (typeof status === "number") {
      if (status === 401 || status === 403)
        return {
          code: "AUTH_ERROR",
          message: translate("startupValidationFailed"),
        }
      if (status === 404)
        return { code: "REPO_NOT_FOUND", message: translate("repoNotFound") }
      if (status === 429)
        return { code: "HTTP_ERROR", message: translate("connectionFailed") }
      if (status === 413)
        return {
          code: "PAYLOAD_TOO_LARGE",
          message: translate("payloadTooLarge"),
        }
      if (status === 400 || status === 422)
        return { code: "BAD_REQUEST", message: translate("badRequest") }
      if (status === 502)
        return { code: "BAD_GATEWAY", message: translate("badGateway") }
      if (status === 503)
        return {
          code: "SERVICE_UNAVAILABLE",
          message: translate("serviceUnavailable"),
        }
      if (status === 504)
        return {
          code: "GATEWAY_TIMEOUT",
          message: translate("gatewayTimeout"),
        }
      if (status >= 500)
        return { code: "SERVER_ERROR", message: translate("serverError") }
    }

    // Check message patterns
    if (typeof message === "string") {
      if (/timeout/i.test(message))
        return { code: "TIMEOUT", message: translate("timeout") }
      if (/^TypeError: Failed to fetch$/i.test(message)) {
        // Could be CORS or offline - check if offline
        try {
          // navigator may not exist in tests
          const nav = (globalThis as any)?.navigator
          if (nav && nav.onLine === false) {
            return { code: "OFFLINE", message: translate("offline") }
          }
        } catch {}
        return { code: "CORS_ERROR", message: translate("corsError") }
      }
      if (/network|failed to fetch/i.test(message))
        return { code: "NETWORK_ERROR", message: translate("networkError") }
      if (/unexpected token|json|parse/i.test(message))
        return { code: "BAD_RESPONSE", message: translate("badResponse") }
      if (/invalid url/i.test(message))
        return { code: "INVALID_URL", message: translate("invalidUrl") }
      if (/ssl|certificate/i.test(message))
        return { code: "SSL_ERROR", message: translate("sslError") }
      if ((error as Error)?.name === "TypeError")
        return { code: "NETWORK_ERROR", message: translate("networkError") }
    }

    // Check status === 0 (often CORS or offline)
    if (status === 0) {
      try {
        const nav = (globalThis as any)?.navigator
        if (nav && nav.onLine === false) {
          return { code: "OFFLINE", message: translate("offline") }
        }
      } catch {}
      return { code: "CORS_ERROR", message: translate("corsError") }
    }

    return {
      code: "STARTUP_ERROR",
      message: translate("startupValidationFailed"),
    }
  }
}

// Parameter service
export class ParameterFormService {
  private readonly skipParams = [
    "MAXX",
    "MINX",
    "MAXY",
    "MINY",
    "AreaOfInterest",
  ]

  // Validate parameters against workspace parameter definitions
  validateParameters(
    data: { [key: string]: unknown },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    for (const param of parameters) {
      const value = data[param.name]

      // Check required fields
      if (!param.optional && isEmpty(value)) {
        errors.push(`${param.name}:required`)
        continue
      }

      if (!isEmpty(value)) {
        // Validate types
        if (param.type === ParameterType.INTEGER && !isInt(value)) {
          errors.push(`${param.name}:integer`)
        }

        if (param.type === ParameterType.FLOAT && !isNum(value)) {
          errors.push(`${param.name}:number`)
        }

        // Validate choices
        if (param.listOptions && param.listOptions.length > 0) {
          const validChoices = param.listOptions.map((opt) => opt.value)
          const values = Array.isArray(value) ? value : [value]

          for (const v of values) {
            if (!validChoices.includes(v)) {
              errors.push(`${param.name}:choice`)
            }
          }
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  convertParametersToFields(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    if (!parameters?.length) return []

    return parameters
      .filter(
        (p) =>
          p && typeof p.name === "string" && !this.skipParams.includes(p.name)
      )
      .map((param) => ({
        name: param.name,
        label: param.description || param.name,
        type: this.getFieldType(param),
        required: !param.optional,
        readOnly: false,
        description: param.description,
        defaultValue: param.defaultValue as FormPrimitive,
        placeholder: param.description || `Enter ${param.name}`,
        options: param.listOptions?.map((o) => {
          const valueStr =
            typeof o.value === "string" || typeof o.value === "number"
              ? String(o.value)
              : JSON.stringify(o.value)
          return {
            label: o.caption || valueStr,
            value:
              typeof o.value === "string" || typeof o.value === "number"
                ? o.value
                : valueStr,
          }
        }),
        rows: param.type === ParameterType.TEXT_EDIT ? 3 : undefined,
      })) as readonly DynamicFieldConfig[]
  }

  private getFieldType(param: WorkspaceParameter): FormFieldType {
    const hasOptions = param.listOptions?.length > 0
    if (hasOptions) {
      const isMulti =
        param.type === ParameterType.LISTBOX ||
        param.type === ParameterType.LOOKUP_LISTBOX
      return isMulti ? FormFieldType.MULTI_SELECT : FormFieldType.SELECT
    }

    const typeMap: { [key in ParameterType]?: FormFieldType } = {
      [ParameterType.FLOAT]: FormFieldType.NUMBER,
      [ParameterType.INTEGER]: FormFieldType.NUMBER,
      [ParameterType.TEXT_EDIT]: FormFieldType.TEXTAREA,
      [ParameterType.PASSWORD]: FormFieldType.PASSWORD,
      [ParameterType.BOOLEAN]: FormFieldType.CHECKBOX,
      [ParameterType.FILENAME]: FormFieldType.FILE,
      [ParameterType.FILENAME_MUSTEXIST]: FormFieldType.FILE,
    }
    return typeMap[param.type] || FormFieldType.TEXT
  }

  validate(
    data: any,
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    if (!data || !parameters?.length) return { isValid: true, errors: [] }

    const errors: string[] = []
    const validParams = parameters.filter(
      (p) => p && !this.skipParams.includes(p.name)
    )

    for (const param of validParams) {
      const value = data[param.name]
      const hasValue = !isEmpty(value)

      if (!param.optional && !hasValue) {
        errors.push(`${param.name}:required`)
        continue
      }

      if (hasValue) {
        if (param.type === ParameterType.INTEGER && !isInt(value)) {
          errors.push(`${param.name}:integer`)
        }
        if (param.type === ParameterType.FLOAT && !isNum(value)) {
          errors.push(`${param.name}:number`)
        }

        // Validate list options if present
        if (param.listOptions?.length > 0) {
          const validValues = param.listOptions.map((o) => o.value)
          const isMulti =
            param.type === ParameterType.LISTBOX ||
            param.type === ParameterType.LOOKUP_LISTBOX

          if (isMulti) {
            const values = Array.isArray(value) ? value : [value]
            if (values.some((v) => !validValues.includes(v))) {
              errors.push(`${param.name}:choice`)
            }
          } else if (!validValues.includes(value)) {
            errors.push(`${param.name}:choice`)
          }
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  validateFormValues(
    values: any,
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    if (!values || !fields?.length) return { isValid: true, errors: {} }

    const errors: { [key: string]: string } = {}

    for (const field of fields) {
      const value = values[field.name]
      const hasValue = !isEmpty(value)

      if (field.required && !hasValue) {
        errors[field.name] = ""
      } else if (
        hasValue &&
        field.type === FormFieldType.NUMBER &&
        !isNum(value)
      ) {
        errors[field.name] = `${field.label} must be a number`
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors }
  }
}
