import type {
  ErrorState,
  WorkspaceParameter,
  DynamicFieldConfig,
  FmeFlowApiError,
} from "./types"
import { ErrorType, ErrorSeverity, ParameterType, FormFieldType } from "./types"

// Utility functions for parameter handling
const isEmpty = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0)

const filterUiParams = (
  parameters: readonly WorkspaceParameter[],
  skip: readonly string[]
): readonly WorkspaceParameter[] =>
  parameters.filter((p) => !skip.includes(p.name))

const makeFieldOpts = (
  param: WorkspaceParameter
): ReadonlyArray<{ label: string; value: string | number }> | undefined =>
  param.listOptions?.map((o) => ({
    label: o.caption || o.value,
    value: o.value,
  }))

const isInt = (value: unknown): boolean => Number.isInteger(Number(value))

const isNum = (value: unknown): boolean => !isNaN(Number(value))

const makeValError = (fieldName: string, errorType: string): string =>
  `${fieldName}:${errorType}`

// Small helpers to reduce duplication
const hasListOptions = (param: WorkspaceParameter): boolean =>
  Array.isArray(param.listOptions) && param.listOptions.length > 0

const isMultiListParam = (param: WorkspaceParameter): boolean =>
  param.type === ParameterType.LISTBOX ||
  param.type === ParameterType.LOOKUP_LISTBOX

const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value].filter(Boolean)

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
      userFriendlyMessage,
      suggestion,
    }
  }

  // Derives startup validation error information from various error types
  deriveStartupError(
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } {
    const fmeErr = error as FmeFlowApiError
    const status = (fmeErr && fmeErr.status) || (error as any)?.status
    const msg = (error as Error)?.message || ""

    // Network/timeout heuristics
    const isTimeout =
      /timeout/i.test(msg) || (error as any)?.code === "ETIMEDOUT"
    const isNetwork = /network/i.test(msg) || /Failed to fetch/i.test(msg)
    const isNonJson = /Unexpected token|JSON|parse/i.test(msg)

    if (typeof status === "number") {
      if (status === 401 || status === 403) {
        return {
          code: `TokenInvalid (${status})`,
          message: translate("authenticationFailed"),
        }
      }
      if (status === 404) {
        return {
          code: "RepoNotFound (404)",
          message: translate("connectionFailed"),
        }
      }
      if (status >= 500) {
        return {
          code: `ServerError (${status})`,
          message: translate("connectionFailed"),
        }
      }
      return {
        code: `FmeServerError (${status})`,
        message: translate("startupValidationFailed"),
      }
    }

    if (isTimeout)
      return { code: "Timeout", message: translate("connectionFailed") }
    if (isNetwork)
      return { code: "NetworkError", message: translate("connectionFailed") }
    if ((error as Error)?.name === "TypeError") {
      return { code: "NetworkError", message: translate("connectionFailed") }
    }
    if (isNonJson)
      return {
        code: "BadResponse",
        message: translate("startupValidationFailed"),
      }

    return {
      code: "StartupError",
      message: translate("startupValidationFailed"),
    }
  }
}

// Service for handling workspace parameter forms
export class ParameterFormService {
  // Parameters that should be hidden from UI (handled programmatically)
  private readonly skipParams: readonly string[] = [
    "MAXX",
    "MINX",
    "MAXY",
    "MINY",
    "AreaOfInterest", // Geometry parameter - handled by drawing workflow
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

    // Handle list-based parameters
    const options = makeFieldOpts(param)
    if (options) {
      return { ...baseField, options }
    }

    // Add textarea rows for text edit fields
    if (param.type === ParameterType.TEXT_EDIT) {
      return { ...baseField, rows: 3 }
    }

    return baseField
  }

  private getFieldType(param: WorkspaceParameter): FormFieldType {
    // Handle list-based parameters first
    if (hasListOptions(param)) {
      if (isMultiListParam(param)) {
        return FormFieldType.MULTI_SELECT
      }
      return FormFieldType.SELECT
    }

    // Handle specific parameter types
    switch (param.type) {
      case ParameterType.FLOAT:
      case ParameterType.INTEGER:
        return FormFieldType.NUMBER
      case ParameterType.TEXT_EDIT:
        return FormFieldType.TEXTAREA
      case ParameterType.PASSWORD:
        return FormFieldType.PASSWORD
      case ParameterType.BOOLEAN:
        return FormFieldType.CHECKBOX
      case ParameterType.FILENAME:
      case ParameterType.FILENAME_MUSTEXIST:
        return FormFieldType.FILE
      default:
        return FormFieldType.TEXT
    }
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

      if (!param.optional && isEmpty(value)) {
        errors.push(makeValError(param.name, "required"))
        continue
      }

      if (param.optional && isEmpty(value)) {
        continue
      }

      const typeError = this.validateParamType(param, value)
      if (typeError) {
        errors.push(typeError)
      }

      const listError = this.validateParamList(param, value)
      if (listError) {
        errors.push(listError)
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
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
    if (!hasListOptions(param)) {
      return null
    }

    const validValues = param.listOptions.map((opt) => opt.value)

    if (isMultiListParam(param)) {
      const arr = toArray(value)
      const invalid = arr.filter((v) => !validValues.includes(v as any))
      if (invalid.length) {
        return makeValError(param.name, "choice")
      }
    } else if (!validValues.includes(value as any)) {
      return makeValError(param.name, "choice")
    }

    return null
  }

  // Validates form values against dynamic field configurations
  validateFormValues(
    values: { [key: string]: unknown },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    const errors: { [key: string]: string } = {}
    for (const field of fields) {
      const value = values[field.name]
      if (field.required && isEmpty(value)) {
        errors[field.name] = `${field.label} is required`
        continue
      }
      if (!field.required && isEmpty(value)) continue
      const typeError = this.validateFieldType(field, value)
      if (typeError) errors[field.name] = typeError
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
