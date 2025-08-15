import type {
  ErrorState,
  WorkspaceParameter,
  DynamicFieldConfig,
} from "./types"
import { ErrorType, ErrorSeverity, ParameterType, FormFieldType } from "./types"

// Helper functions for parameter processing
const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === ""

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

    // Add options for list parameters
    const options = makeFieldOpts(param)
    if (options) {
      return { ...baseField, type: FormFieldType.SELECT, options }
    }

    // Add textarea rows for text edit fields
    if (param.type === ParameterType.TEXT_EDIT) {
      return { ...baseField, rows: 3 }
    }

    return baseField
  }

  private getFieldType(param: WorkspaceParameter): FormFieldType {
    // Handle list-based parameters first
    if (param.listOptions && param.listOptions.length > 0) {
      if (
        param.type === ParameterType.LISTBOX ||
        param.type === ParameterType.LOOKUP_LISTBOX
      ) {
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
    if (!param.listOptions || param.listOptions.length === 0) {
      return null
    }

    const validValues = param.listOptions.map((opt) => opt.value)

    if (
      param.type === ParameterType.LISTBOX ||
      param.type === ParameterType.LOOKUP_LISTBOX
    ) {
      const arr = Array.isArray(value) ? value : [value].filter(Boolean)
      const invalid = (arr as unknown[]).filter(
        (v) => !validValues.includes(v as any)
      )
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
