import type {
  ErrorState,
  WorkspaceParameter,
  DynamicFieldConfig,
  FormPrimitive,
} from "./types"
import { ErrorType, ErrorSeverity, ParameterType, FormFieldType } from "./types"

// Utility functions for parameter handling with enhanced validation
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
    if (trimmed === "") return false
    const num = Number(trimmed)
    return Number.isInteger(num) && !isNaN(num)
  }
  return false
}

const isNum = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return false
    const num = Number(trimmed)
    return Number.isFinite(num) && !isNaN(num)
  }
  return false
}

const filterUiParams = (
  parameters: readonly WorkspaceParameter[],
  skip: readonly string[]
): readonly WorkspaceParameter[] => {
  if (!parameters || !Array.isArray(parameters)) return []
  if (!skip || !Array.isArray(skip)) return parameters

  const skipSet = new Set(
    skip.filter((s) => typeof s === "string" && s.length > 0)
  )
  return parameters.filter(
    (p) => p && typeof p.name === "string" && !skipSet.has(p.name)
  )
}

const makeFieldOpts = (param: WorkspaceParameter) => {
  if (!param?.listOptions || !Array.isArray(param.listOptions)) return undefined

  return param.listOptions
    .filter(
      (o) =>
        o && typeof o === "object" && o.value !== undefined && o.value !== null
    )
    .map((o) => ({
      label: o.caption || o.value,
      value: o.value,
    }))
}

const makeValError = (fieldName: string, errorType: string) =>
  `${fieldName}:${errorType}`

// Small helpers to reduce duplication
const hasListOptions = (param: WorkspaceParameter): boolean =>
  Array.isArray(param.listOptions) && param.listOptions.length > 0

const isMultiListParam = (param: WorkspaceParameter): boolean =>
  param.type === ParameterType.LISTBOX ||
  param.type === ParameterType.LOOKUP_LISTBOX

const toArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

// Error helper
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
      details: details as { [key: string]: unknown } | undefined,
      recoverable,
      retry,
      timestamp: new Date(),
      timestampMs: Date.now(),
      userFriendlyMessage,
      suggestion,
    }
  }

  // Helper to check for known error codes
  private readonly checkKnownErrorCodes = (
    code: string,
    translate: (key: string) => string
  ): { code: string; message: string } | null => {
    const knownErrors: { [key: string]: string } = {
      UserEmailMissing: "userEmailMissing",
      INVALID_CONFIG: "invalidConfiguration",
      WEBHOOK_AUTH_ERROR: "authenticationFailed",
      ARCGIS_MODULE_ERROR: "connectionFailed",
    }

    for (const [errorCode, messageKey] of Object.entries(knownErrors)) {
      if (new RegExp(`^${errorCode}$`, "i").test(code)) {
        return { code: errorCode, message: translate(messageKey) }
      }
    }

    return null
  }

  // Helper to derive error from HTTP status codes
  private readonly deriveHttpStatusError = (
    status: number,
    translate: (key: string) => string
  ): { code: string; message: string } => {
    if (status === 401 || status === 403) {
      return {
        code: "AUTH_ERROR",
        message: translate("startupValidationFailed"),
      }
    }
    if (status === 404) {
      return {
        code: "REPO_NOT_FOUND",
        message: translate("repoNotFound"),
      }
    }
    if (status >= 500) {
      return {
        code: "SERVER_ERROR",
        message: translate("serverError"),
      }
    }
    return {
      code: "HTTP_ERROR",
      message: translate("connectionFailed"),
    }
  }

  // Helper to derive error from message patterns
  private readonly deriveMessagePatternError = (
    message: string,
    translate: (key: string) => string
  ): { code: string; message: string } | null => {
    if (/timeout/i.test(message)) {
      return { code: "TIMEOUT", message: translate("timeout") }
    }
    if (/network|failed to fetch/i.test(message)) {
      return { code: "NETWORK_ERROR", message: translate("networkError") }
    }
    if (/unexpected token|json|parse/i.test(message)) {
      return { code: "BAD_RESPONSE", message: translate("badResponse") }
    }
    return null
  }

  // Derives startup validation error information from various error types
  deriveStartupError(
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } {
    // Validate inputs
    if (!error) {
      return {
        code: "STARTUP_ERROR",
        message: translate("startupValidationFailed"),
      }
    }

    if (typeof translate !== "function") {
      console.warn("Invalid translate function provided to deriveStartupError")
      const fallbackTranslate = (key: string) => key
      return this.deriveStartupError(error, fallbackTranslate)
    }

    // Try explicit error code first
    const explicitCode =
      (error as any)?.code || (error as any)?.name || (error as any)?.message
    if (typeof explicitCode === "string") {
      const code = explicitCode.trim()
      const knownError = this.checkKnownErrorCodes(code, translate)
      if (knownError) return knownError
    }

    // Check HTTP status codes
    const status = (error as any)?.status
    if (typeof status === "number") {
      return this.deriveHttpStatusError(status, translate)
    }

    // Check message patterns
    const message = (error as Error)?.message || ""
    if (typeof message === "string") {
      // Check for specific error codes in message
      if ((error as any)?.code === "ETIMEDOUT") {
        return { code: "TIMEOUT", message: translate("timeout") }
      }

      // Check for TypeError (common network error)
      if ((error as Error)?.name === "TypeError") {
        return { code: "NETWORK_ERROR", message: translate("networkError") }
      }

      const patternError = this.deriveMessagePatternError(message, translate)
      if (patternError) return patternError
    }

    // Default fallback
    return {
      code: "STARTUP_ERROR",
      message: translate("startupValidationFailed"),
    }
  }
}

// Service for converting and validating parameters
export class ParameterFormService {
  // Parameters to skip from UI generation and validation
  private readonly skipParams: readonly string[] = [
    "MAXX",
    "MINX",
    "MAXY",
    "MINY",
    "AreaOfInterest",
  ]

  // Converts workspace parameters to dynamic field configurations
  convertParametersToFields(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    if (!parameters || !Array.isArray(parameters)) {
      console.warn("Invalid parameters provided to convertParametersToFields")
      return []
    }

    const filteredParams = filterUiParams(parameters, this.skipParams)
    return filteredParams.map((param) => this.makeField(param))
  }

  // Creates a dynamic field configuration from a workspace parameter
  private makeField(param: WorkspaceParameter): DynamicFieldConfig {
    if (!param || typeof param.name !== "string") {
      throw new Error("Invalid workspace parameter: missing name")
    }

    const baseField: DynamicFieldConfig = {
      name: param.name,
      label: param.description || param.name,
      type: this.getFieldType(param),
      required: !param.optional,
      readOnly: false,
      description: param.description,
      defaultValue: param.defaultValue as FormPrimitive,
      placeholder: param.description || `Enter ${param.name}`,
    }

    const options = makeFieldOpts(param)
    const isTextEdit = param.type === ParameterType.TEXT_EDIT

    return {
      ...baseField,
      ...(options && { options }),
      ...(isTextEdit && { rows: 3 }),
    }
  }

  private getFieldType(param: WorkspaceParameter): FormFieldType {
    if (hasListOptions(param)) {
      return isMultiListParam(param)
        ? FormFieldType.MULTI_SELECT
        : FormFieldType.SELECT
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
    return typeMap[param.type] ?? FormFieldType.TEXT
  }

  // Validates data against workspace parameters
  validateParameters(
    data: { [key: string]: unknown },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    if (!data || typeof data !== "object") {
      return { isValid: false, errors: ["Invalid data object provided"] }
    }

    if (!parameters || !Array.isArray(parameters)) {
      return { isValid: true, errors: [] }
    }

    const errors: string[] = []
    const filteredParams = filterUiParams(parameters, this.skipParams)

    for (const param of filteredParams) {
      if (!param || typeof param.name !== "string") continue

      const value = data[param.name]
      const isRequired = !param.optional
      const hasValue = !isEmpty(value)

      if (isRequired && !hasValue) {
        errors.push(makeValError(param.name, "required"))
        continue
      }

      if (hasValue) {
        const typeError = this.validateParamType(param, value)
        const listError = this.validateParamList(param, value)
        if (typeError) errors.push(typeError)
        if (listError) errors.push(listError)
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  // Validates individual parameter type constraints
  private validateParamType(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    if (param.type === ParameterType.INTEGER && !isInt(value)) {
      return makeValError(param.name, "integer")
    }

    if (param.type === ParameterType.FLOAT && !isNum(value)) {
      return makeValError(param.name, "number")
    }

    return null
  }

  // Validates parameter list options
  private validateParamList(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    if (!hasListOptions(param) || !param.listOptions) return null

    // Extract valid values from list options
    const rawValidValues = param.listOptions
      .filter((opt) => opt && opt.value !== undefined && opt.value !== null)
      .map((opt) => opt.value)

    if (rawValidValues.length === 0) return null

    const isMulti = isMultiListParam(param)

    // Check if all valid values are numeric (number or numeric string)
    const allNumeric = rawValidValues.every((vv) => {
      if (typeof vv === "number") return Number.isFinite(vv)
      if (typeof vv === "string") {
        const t = vv.trim()
        if (!t) return false
        const n = Number(t)
        return Number.isFinite(n) && String(n) === t
      }
      return false
    })

    // Normalizers
    const norm = (x: unknown): unknown => {
      if (allNumeric) {
        if (typeof x === "number") return x
        if (typeof x === "string") {
          const t = x.trim()
          const n = Number(t)
          return Number.isFinite(n) ? n : t
        }
      }
      return typeof x === "string" || typeof x === "number" ? String(x) : x
    }

    const validValues = rawValidValues.map(norm)

    if (isMulti) {
      const arr = toArray(value).map(norm)
      const invalid = arr.filter(
        (v) => !validValues.some((valid) => valid === v)
      )
      return invalid.length ? makeValError(param.name, "choice") : null
    }

    return validValues.some((valid) => valid === norm(value))
      ? null
      : makeValError(param.name, "choice")
  }

  // Validates form values against dynamic field configurations
  validateFormValues(
    values: { [key: string]: unknown },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    if (!values || typeof values !== "object") {
      return {
        isValid: false,
        errors: { _form: "Invalid form values provided" },
      }
    }

    if (!fields || !Array.isArray(fields)) {
      return { isValid: true, errors: {} }
    }

    const errors: { [key: string]: string } = {}

    for (const field of fields) {
      if (!field || typeof field.name !== "string") continue

      const value = values[field.name]
      const hasValue = !isEmpty(value)

      if (field.required && !hasValue) {
        // Keep field invalid without inline text; UI shows * and form summary; empty string avoids duplicate messages.
        errors[field.name] = ""
      } else if (hasValue) {
        const typeError = this.validateFieldType(field, value)
        if (typeError) errors[field.name] = typeError
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors }
  }

  // Validates individual field type constraints
  private validateFieldType(
    field: DynamicFieldConfig,
    value: unknown
  ): string | null {
    if (field.type === FormFieldType.NUMBER && value !== "" && !isNum(value)) {
      return `${field.label} must be a number`
    }
    return null
  }
}
