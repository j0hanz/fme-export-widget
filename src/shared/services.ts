import type { ErrorState, WorkspaceParameter } from "./types"
import { ErrorType, ErrorSeverity, ParameterType } from "./types"

// Blank if undefined, null, or empty string
const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || v === ""

// Filter out skipped parameters
const filterUIParameters = (
  parameters: readonly WorkspaceParameter[],
  skip: readonly string[]
) => parameters.filter((p) => !skip.includes(p.name))

// Build select options
const createFieldOptions = (param: WorkspaceParameter) =>
  param.listOptions?.map((o) => ({
    label: o.caption || o.value,
    value: o.value,
  }))

// Error helper
export class ErrorHandlingService {
  createError(
    message: string,
    type: ErrorType = ErrorType.VALIDATION,
    options: {
      code?: string
      severity?: ErrorSeverity
      details?: any
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
      details,
      recoverable,
      retry,
      timestamp: new Date(),
    }
  }
}

// Form field types
export enum FormFieldType {
  TEXT = "text",
  NUMBER = "number",
  SELECT = "select",
  MULTI_SELECT = "multiselect",
  CHECKBOX = "checkbox",
  TEXTAREA = "textarea",
  PASSWORD = "password",
  FILE = "file",
}

// Dynamic field config
export interface DynamicFieldConfig {
  readonly name: string // Field name
  readonly label: string // Field label
  readonly type: FormFieldType
  readonly required?: boolean
  readonly readOnly?: boolean
  readonly placeholder?: string
  readonly helpText?: string // Help text
  readonly options?: ReadonlyArray<{ label: string; value: string | number }>
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly rows?: number
  readonly maxLength?: number
  readonly description?: string
  readonly defaultValue?: any
}

// Service for handling workspace parameter forms
export class ParameterFormService {
  // Parameters that should be hidden from UI (handled programmatically)
  private readonly skipParameters = [
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
    const filteredParams = filterUIParameters(parameters, this.skipParameters)

    return filteredParams.map((param) => this.createFieldFromParameter(param))
  }

  // Creates a dynamic field configuration from a workspace parameter
  private createFieldFromParameter(
    param: WorkspaceParameter
  ): DynamicFieldConfig {
    const baseField: DynamicFieldConfig = {
      name: param.name,
      label: param.description || param.name,
      type: this.getFieldTypeFromParameter(param),
      required: !param.optional,
      readOnly: false,
      description: param.description,
      defaultValue: param.defaultValue,
      placeholder: param.description || `Enter ${param.name}`,
    }

    // Add options for list parameters
    const options = createFieldOptions(param)
    if (options) {
      return { ...baseField, type: FormFieldType.SELECT, options }
    }

    // Add textarea rows for text edit fields
    if (param.type === ParameterType.TEXT_EDIT) {
      return { ...baseField, rows: 3 }
    }

    return baseField
  }

  private getFieldTypeFromParameter(param: WorkspaceParameter): FormFieldType {
    if (param.listOptions && param.listOptions.length > 0) {
      // Handle list and lookup listbox types
      if (
        param.type === ParameterType.LISTBOX ||
        param.type === ParameterType.LOOKUP_LISTBOX
      ) {
        return FormFieldType.MULTI_SELECT
      }
      return FormFieldType.SELECT
    }

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
    data: { [key: string]: any },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = []
    const filteredParams = filterUIParameters(parameters, this.skipParameters)
    filteredParams.forEach((param) => {
      const value = data[param.name]
      if (!param.optional && isBlank(value)) {
        errors.push(`${param.name}:required`)
        return
      }
      if (param.optional && isBlank(value)) return
      const typeError = this.validateParameterType(param, value)
      if (typeError) errors.push(typeError)
      const listError = this.validateParameterList(param, value)
      if (listError) errors.push(listError)
    })

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  // Validates individual parameter type constraints
  private validateParameterType(
    param: WorkspaceParameter,
    value: any
  ): string | null {
    if (
      param.type === ParameterType.INTEGER &&
      !Number.isInteger(Number(value))
    ) {
      return `${param.name}:integer`
    }

    if (param.type === ParameterType.FLOAT && isNaN(Number(value))) {
      return `${param.name}:number`
    }

    return null
  }

  // Validates parameter list options
  private validateParameterList(
    param: WorkspaceParameter,
    value: any
  ): string | null {
    if (param.listOptions && param.listOptions.length > 0) {
      const validValues = param.listOptions.map((opt) => opt.value)
      if (
        param.type === ParameterType.LISTBOX ||
        param.type === ParameterType.LOOKUP_LISTBOX
      ) {
        const arr = Array.isArray(value) ? value : [value].filter(Boolean)
        const invalid = arr.filter((v) => !validValues.includes(v))
        if (invalid.length) return `${param.name}:choice`
      } else if (!validValues.includes(value)) return `${param.name}:choice`
    }
    return null
  }

  // Generates form configuration from workspace parameters
  generateFormConfig(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    return this.convertParametersToFields(parameters)
  }

  // Validates form values against dynamic field configurations
  validateFormValues(
    values: { [key: string]: any },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    const errors: { [key: string]: string } = {}

    fields.forEach((field) => {
      const value = values[field.name]
      if (field.required && isBlank(value)) {
        errors[field.name] = `${field.label} is required`
        return
      }
      if (!field.required && isBlank(value)) return
      const typeError = this.validateFieldType(field, value)
      if (typeError) errors[field.name] = typeError
    })

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    }
  }

  // Validates individual field type constraints
  private validateFieldType(
    field: DynamicFieldConfig,
    value: any
  ): string | null {
    if (
      field.type === FormFieldType.NUMBER &&
      value !== "" &&
      isNaN(Number(value))
    ) {
      return `${field.label} must be a number`
    }
    return null
  }
}
