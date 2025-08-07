import type { ErrorState, WorkspaceParameter } from "./types"
import { ErrorType, ErrorSeverity, ParameterType } from "./types"

// Error handling service - non-template functionality only
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

// Form field type definitions for workspace parameters
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

// Dynamic field configuration for form generation
export interface DynamicFieldConfig {
  readonly id: string
  readonly field: string // Field identifier for form data
  readonly label: string
  readonly labelId: string // Label identifier for UI display
  readonly type: FormFieldType
  readonly required?: boolean
  readonly readOnly?: boolean // Optional readonly property
  readonly placeholder?: string
  readonly helperId?: string // Optional helper text identifier
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

  /**
   * Converts FME workspace parameters to dynamic field configurations
   */
  convertParametersToFields(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    // Filter out parameters that should not be displayed in UI
    const filteredParams = parameters.filter(
      (param) => !this.skipParameters.includes(param.name)
    )

    return filteredParams.map((param) => {
      const baseField: DynamicFieldConfig = {
        id: param.name,
        field: param.name, // Field identifier for form data
        label: param.description || param.name,
        labelId: param.description || param.name, // Label identifier for UI display
        type: this.getFieldTypeFromParameter(param),
        required: !param.optional,
        readOnly: false, // Default to editable
        description: param.description,
        defaultValue: param.defaultValue,
      }

      // Add field-specific configurations
      if (param.listOptions && param.listOptions.length > 0) {
        return {
          ...baseField,
          type: FormFieldType.SELECT,
          options: param.listOptions.map((option) => ({
            label: option.caption || option.value,
            value: option.value,
          })),
        }
      }

      if (
        param.type === ParameterType.FLOAT ||
        param.type === ParameterType.INTEGER
      ) {
        return {
          ...baseField,
          type: FormFieldType.NUMBER,
        }
      }

      if (param.type === ParameterType.TEXT_EDIT) {
        return {
          ...baseField,
          type: FormFieldType.TEXTAREA,
          rows: 3,
        }
      }

      if (param.type === "PASSWORD") {
        return {
          ...baseField,
          type: FormFieldType.PASSWORD,
        }
      }

      if (param.type === "BOOLEAN") {
        return {
          ...baseField,
          type: FormFieldType.CHECKBOX,
        }
      }

      // Default to text input
      return {
        ...baseField,
        type: FormFieldType.TEXT,
        placeholder: param.description || `Enter ${param.name}`,
      }
    })
  }

  private getFieldTypeFromParameter(param: WorkspaceParameter): FormFieldType {
    if (param.listOptions && param.listOptions.length > 0) {
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

  /**
   * Validates form data against parameter requirements
   */
  validateFormData(
    data: { [key: string]: any },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    // Filter out parameters that should not be validated in UI
    const filteredParams = parameters.filter(
      (param) => !this.skipParameters.includes(param.name)
    )

    for (const param of filteredParams) {
      const value = data[param.name]

      // Check required fields
      if (
        !param.optional &&
        (value === undefined || value === null || value === "")
      ) {
        errors.push(`${param.name} is required`)
        continue
      }

      // Skip validation for empty optional fields
      if (
        param.optional &&
        (value === undefined || value === null || value === "")
      ) {
        continue
      }

      // Type-specific validation
      if (
        param.type === ParameterType.INTEGER &&
        !Number.isInteger(Number(value))
      ) {
        errors.push(`${param.name} must be an integer`)
      }

      if (param.type === ParameterType.FLOAT && isNaN(Number(value))) {
        errors.push(`${param.name} must be a number`)
      }

      // List validation
      if (param.listOptions && param.listOptions.length > 0) {
        const validValues = param.listOptions.map((opt) => opt.value)
        if (!validValues.includes(value)) {
          errors.push(`${param.name} must be one of: ${validValues.join(", ")}`)
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Generates form configuration from workspace parameters
   */
  generateFormConfig(parameters: readonly WorkspaceParameter[]): {
    fields: readonly DynamicFieldConfig[]
    validation: any
  } {
    // Use filtered parameters for form generation
    const fields = this.convertParametersToFields(parameters)
    return {
      fields,
      validation: null, // Basic validation handled by validateFormValues
    }
  }

  /**
   * Validates form values against field configuration
   */
  validateFormValues(
    values: { [key: string]: any },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    const errors: { [key: string]: string } = {}

    for (const field of fields) {
      const value = values[field.field]

      // Check required fields
      if (
        field.required &&
        (value === undefined || value === null || value === "")
      ) {
        errors[field.field] = `${field.label} is required`
        continue
      }

      // Skip validation for empty optional fields
      if (
        !field.required &&
        (value === undefined || value === null || value === "")
      ) {
        continue
      }

      // Type-specific validation
      if (
        field.type === FormFieldType.NUMBER &&
        value !== "" &&
        isNaN(Number(value))
      ) {
        errors[field.field] = `${field.label} must be a number`
      }

      // Add more validation as needed for specific field types
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    }
  }
}
