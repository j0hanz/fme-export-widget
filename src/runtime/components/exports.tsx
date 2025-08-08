import { React, hooks, getAppStore } from "jimu-core"
import { Select, TextArea, Form, Input } from "./ui"
import { Checkbox } from "jimu-ui"
import { STYLES } from "../../shared/css"
import defaultMessages from "../../translations/default"
import type { WorkspaceParameter, WorkspaceItem } from "../../shared/types"
import { fmeActions } from "../../extensions/store"
import {
  ParameterFormService,
  type DynamicFieldConfig,
  FormFieldType,
  ErrorHandlingService,
} from "../../shared/services"
import { ErrorType } from "../../shared/types"

// Dynamic export component interface
interface ExportProps {
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceName?: string
  readonly workspaceItem?: WorkspaceItem // Full workspace item from server with title, description, etc.
  readonly onBack: () => void
  readonly onSubmit: (data: unknown) => void
  readonly isSubmitting?: boolean
}

// Main Export component that handles both static and dynamic forms
export const Export: React.FC<ExportProps> = ({
  workspaceParameters,
  workspaceName,
  workspaceItem,
  onBack,
  onSubmit,
  isSubmitting = false,
}) => {
  const translate = hooks.useTranslation(defaultMessages)

  // If workspace parameters are provided, use dynamic form
  if (workspaceParameters && workspaceName) {
    return (
      <ExportWithWorkspaceParameters
        workspaceParameters={workspaceParameters}
        workspaceName={workspaceName}
        workspaceItem={workspaceItem}
        onBack={onBack}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
      />
    )
  }

  // Error state - neither workspace parameters nor variant provided
  return (
    <Form
      variant="layout"
      title={translate("configurationError") || "Configuration Error"}
      subtitle={
        translate("missingExportConfiguration") ||
        "Missing export configuration"
      }
      onBack={onBack}
      onSubmit={onBack}
      isValid={false}
      loading={false}
    >
      <div style={STYLES.typography.caption}>
        {translate("exportFormRequiresConfiguration") ||
          "Export form requires either workspace parameters or export variant."}
      </div>
    </Form>
  )
}

// Dynamic export component for workspace-based forms
const ExportWithWorkspaceParameters: React.FC<{
  readonly workspaceParameters: readonly WorkspaceParameter[]
  readonly workspaceName: string
  readonly workspaceItem?: WorkspaceItem
  readonly onBack: () => void
  readonly onSubmit: (data: unknown) => void
  readonly isSubmitting: boolean
}> = ({
  workspaceParameters,
  workspaceName,
  workspaceItem,
  onBack,
  onSubmit,
  isSubmitting,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const [parameterService] = React.useState(() => new ParameterFormService())

  // Generate form configuration from parameters
  const formConfig = React.useMemo(() => {
    return parameterService.generateFormConfig(workspaceParameters)
  }, [parameterService, workspaceParameters])

  // Helper to build initial values from field defaults
  const buildInitialValues = React.useCallback(() => {
    const initialValues: { [key: string]: any } = {}
    formConfig.forEach((field) => {
      if (field.defaultValue !== undefined) {
        initialValues[field.name] = field.defaultValue
      }
    })
    return initialValues
  }, [formConfig])

  // Initialize form values from parameter defaults - using useState lazy initialization
  const [values, setValues] = React.useState(buildInitialValues)
  const [isValid, setIsValid] = React.useState(true)

  // Initialize form values in Redux store only once
  hooks.useEffectOnce(() => {
    getAppStore().dispatch(fmeActions.setFormValues(values) as any)
  })

  // Validate form whenever values change
  hooks.useUpdateEffect(() => {
    const validation = parameterService.validateFormValues(values, formConfig)
    setIsValid(validation.isValid)
  }, [values, parameterService, formConfig])

  // Reset values when workspace or fields change (e.g., switching workspaces)
  hooks.useUpdateEffect(() => {
    const nextValues = buildInitialValues()
    setValues(nextValues)
    getAppStore().dispatch(fmeActions.setFormValues(nextValues) as any)
  }, [workspaceName, buildInitialValues])

  const onChange = hooks.useEventCallback((field: string, value: any) => {
    const newValues = { ...values, [field]: value }
    setValues(newValues)
    getAppStore().dispatch(fmeActions.setFormValues(newValues) as any)
  })

  const handleSubmit = hooks.useEventCallback(() => {
    // Validate form before submission
    const validation = parameterService.validateFormValues(values, formConfig)

    if (!validation.isValid) {
      // Create a generic error message without including field labels
      const errorCount = Object.keys(validation.errors).length
      const errorMessage =
        errorCount === 1
          ? translate("formValidationSingleError") ||
            "Please fill in the required field."
          : translate("formValidationMultipleErrors") ||
            `Please fill in all ${errorCount} required fields.`

      const error = new ErrorHandlingService().createError(
        errorMessage,
        ErrorType.VALIDATION,
        { code: "FORM_INVALID" }
      )
      getAppStore().dispatch(fmeActions.setError(error) as any)
      return
    }

    onSubmit({ type: workspaceName, data: values })
  })

  // Render field based on parameter type
  const renderField = React.useCallback(
    (field: DynamicFieldConfig) => {
      const fieldValue = values[field.name] || ""

      switch (field.type) {
        case FormFieldType.SELECT:
          return (
            <Select
              value={fieldValue}
              options={field.options || []}
              placeholder={`Välj ${field.label}...`}
              onChange={(value) => onChange(field.name, value)}
              ariaLabel={field.label}
              disabled={field.readOnly}
            />
          )

        case FormFieldType.MULTI_SELECT:
          return (
            <Select
              value={fieldValue}
              options={field.options || []}
              placeholder={`Välj ${field.label}...`}
              onChange={(value) => onChange(field.name, value)}
              ariaLabel={field.label}
              disabled={field.readOnly}
              // TODO: Add multi-select support to Select component
            />
          )

        case FormFieldType.TEXTAREA:
          return (
            <TextArea
              value={fieldValue}
              placeholder={`Ange ${field.label}...`}
              onChange={(value) => onChange(field.name, value)}
              disabled={field.readOnly}
            />
          )

        case FormFieldType.NUMBER:
          return (
            <Input
              value={String(fieldValue)}
              placeholder={`Ange ${field.label}...`}
              onChange={(value) => {
                const numValue = value === "" ? "" : Number(value)
                onChange(field.name, numValue)
              }}
              disabled={field.readOnly}
            />
          )

        case FormFieldType.CHECKBOX:
          return (
            <Checkbox
              checked={Boolean(fieldValue)}
              onChange={(evt) => onChange(field.name, evt.target.checked)}
              disabled={field.readOnly}
              aria-label={field.label}
            />
          )

        case FormFieldType.PASSWORD:
          return (
            <Input
              type="password"
              value={String(fieldValue)}
              placeholder={`Ange ${field.label}...`}
              onChange={(value) => onChange(field.name, value)}
              disabled={field.readOnly}
            />
          )

        case FormFieldType.FILE:
          return (
            <Input
              type="file"
              onFileChange={(evt) => {
                const files = evt.target.files
                onChange(field.name, files ? files[0] : null)
              }}
              disabled={field.readOnly}
              aria-label={field.label}
            />
          )

        case FormFieldType.TEXT:
          return (
            <Input
              value={String(fieldValue)}
              placeholder={`Ange ${field.label}...`}
              onChange={(value) => onChange(field.name, value)}
              disabled={field.readOnly}
            />
          )
      }
    },
    [values, onChange]
  )

  // Helper function to strip HTML tags from text
  const stripHtml = (html: string): string => {
    if (!html) return ""
    // Create a temporary div element to parse HTML
    const temp = document.createElement("div")
    temp.innerHTML = html
    return temp.textContent || temp.innerText || ""
  }

  return (
    <Form
      variant="layout"
      title={workspaceItem?.title || workspaceName}
      subtitle={
        workspaceItem?.description
          ? stripHtml(workspaceItem.description)
          : translate("configureWorkspaceParameters", { workspaceName })
      }
      onBack={onBack}
      onSubmit={handleSubmit}
      isValid={isValid}
      loading={isSubmitting}
    >
      {formConfig.map((field) => (
        <Form
          key={field.name}
          variant="field"
          label={field.label}
          required={field.required}
        >
          {renderField(field)}
        </Form>
      ))}
    </Form>
  )
}

export default Export
