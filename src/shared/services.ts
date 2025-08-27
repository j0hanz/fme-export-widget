import type {
  ErrorState,
  WorkspaceParameter,
  DynamicFieldConfig,
} from "./types"
import { ErrorType, ErrorSeverity, ParameterType, FormFieldType } from "./types"

// Utility functions for parameter handling
const isEmpty = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0)

const isInt = (value: unknown): boolean => Number.isInteger(Number(value))
const isNum = (value: unknown): boolean => !isNaN(Number(value))

const filterUiParams = (
  parameters: readonly WorkspaceParameter[],
  skip: readonly string[]
): readonly WorkspaceParameter[] => {
  if (!parameters?.length) return []
  const skipSet = new Set(skip)
  return parameters.filter((p) => !skipSet.has(p.name))
}

const makeFieldOpts = (param: WorkspaceParameter) =>
  param.listOptions?.map((o) => ({
    label: o.caption || o.value,
    value: o.value,
  }))

const makeValError = (fieldName: string, errorType: string) =>
  `${fieldName}:${errorType}`

// Small helpers to reduce duplication
const hasListOptions = (param: WorkspaceParameter): boolean =>
  Array.isArray(param.listOptions) && param.listOptions.length > 0

const isMultiListParam = (param: WorkspaceParameter): boolean =>
  param.type === ParameterType.LISTBOX ||
  param.type === ParameterType.LOOKUP_LISTBOX

const toArray = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : [value].filter((v) => v !== undefined && v !== null)

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

  // Derives startup validation error information from various error types
  deriveStartupError(
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } {
    const explicitCode =
      (error as any)?.code || (error as any)?.name || (error as any)?.message

    if (typeof explicitCode === "string") {
      const code = explicitCode.trim()
      const knownErrors: { [key: string]: string } = {
        // Config / auth
        UserEmailMissing: "userEmailMissing",
        INVALID_CONFIG: "invalidConfiguration",
        WEBHOOK_AUTH_ERROR: "authenticationFailed",
        // ArcGIS runtime not available
        ARCGIS_MODULE_ERROR: "connectionFailed",
      }

      for (const [errorCode, messageKey] of Object.entries(knownErrors)) {
        if (new RegExp(`^${errorCode}$`, "i").test(code)) {
          return { code: errorCode, message: translate(messageKey) }
        }
      }
    }

    const status = (error as any)?.status
    const msg = (error as Error)?.message || ""

    if (typeof status === "number") {
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

    // Network/timeout heuristics
    if (/timeout/i.test(msg) || (error as any)?.code === "ETIMEDOUT") {
      return { code: "TIMEOUT", message: translate("timeout") }
    }
    if (
      /network|failed to fetch/i.test(msg) ||
      (error as Error)?.name === "TypeError"
    ) {
      return { code: "NETWORK_ERROR", message: translate("networkError") }
    }
    if (/unexpected token|json|parse/i.test(msg)) {
      return {
        code: "BAD_RESPONSE",
        message: translate("badResponse"),
      }
    }

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
    const filteredParams = filterUiParams(parameters, this.skipParams)
    return filteredParams.map((param) => this.makeField(param))
  }

  // Creates a dynamic field configuration from a workspace parameter
  private makeField(param: WorkspaceParameter): DynamicFieldConfig {
    const baseField: DynamicFieldConfig = {
      name: param.name,
      label: param.description || param.name,
      type: this.getFieldType(param),
      required: !param.optional,
      readOnly: false,
      description: param.description,
      defaultValue: param.defaultValue,
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
    const errors: string[] = []
    const filteredParams = filterUiParams(parameters, this.skipParams)

    for (const param of filteredParams) {
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
    if (!hasListOptions(param)) return null

    const validValues = param.listOptions.map((opt) => opt.value)
    const isMulti = isMultiListParam(param)

    if (isMulti) {
      const arr = toArray(value)
      const invalid = arr.filter((v) => !validValues.includes(v as any))
      return invalid.length ? makeValError(param.name, "choice") : null
    }

    return validValues.includes(value as any)
      ? null
      : makeValError(param.name, "choice")
  }

  // Validates form values against dynamic field configurations
  validateFormValues(
    values: { [key: string]: unknown },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    const errors: { [key: string]: string } = {}

    for (const field of fields) {
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
