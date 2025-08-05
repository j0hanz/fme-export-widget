import { React, hooks, getAppStore } from "jimu-core"
import { Select, TextArea, Form, Input } from "./ui"
import { Checkbox } from "jimu-ui"
import { STYLES } from "../../shared/css"
import defaultMessages from "../../translations/default"
import type { WorkspaceParameter } from "../../shared/types"
import { fmeActions } from "../../extensions/store"
import {
  ParameterFormService,
  type DynamicFieldConfig,
  FormFieldType,
} from "../../shared/services"

// Dynamic export component interface
interface ExportProps {
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceName?: string
  readonly workspaceItem?: any // Full workspace item from server with title, description, etc.
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
  readonly workspaceItem?: any
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
    const config = parameterService.generateFormConfig(
      workspaceParameters,
      workspaceName
    )
    return config
  }, [parameterService, workspaceParameters, workspaceName])

  // Initialize form values from parameter defaults - using useState lazy initialization
  const [values, setValues] = React.useState(() => {
    const initialValues: { [key: string]: any } = {}
    formConfig.fields.forEach((field) => {
      if (field.defaultValue !== undefined) {
        initialValues[field.field] = field.defaultValue
      }
    })
    return initialValues
  })
  const [isValid, setIsValid] = React.useState(true)

  // Initialize form values in Redux store only once
  hooks.useEffectOnce(() => {
    getAppStore().dispatch(fmeActions.setFormValues(values) as any)
  })

  // Validate form whenever values change
  hooks.useUpdateEffect(() => {
    const validation = parameterService.validateFormValues(
      values,
      workspaceParameters
    )
    setIsValid(validation.isValid)
  }, [values, parameterService, workspaceParameters])

  const onChange = hooks.useEventCallback((field: string, value: any) => {
    const newValues = { ...values, [field]: value }
    setValues(newValues)
    getAppStore().dispatch(fmeActions.setFormValues(newValues) as any)
  })

  const handleSubmit = hooks.useEventCallback(() => {
    // Validate form before submission
    const validation = parameterService.validateFormValues(
      values,
      workspaceParameters
    )

    if (!validation.isValid) {
      const errorMessages = Object.values(validation.errors).join(", ")
      getAppStore().dispatch(
        fmeActions.setError({
          message: `Form validation failed: ${errorMessages}`,
          severity: "error" as any,
          type: "VALIDATION" as any,
          timestamp: new Date(),
        }) as any
      )
      return
    }

    onSubmit({ type: workspaceName, data: values })
  })

  // Render field based on parameter type
  const renderField = (field: DynamicFieldConfig) => {
    const fieldValue = values[field.field] || ""

    switch (field.type) {
      case FormFieldType.SELECT:
        return (
          <Select
            value={fieldValue}
            options={field.options || []}
            placeholder={`Välj ${field.labelId}...`}
            onChange={(value) => onChange(field.field, value)}
            ariaLabel={field.labelId}
            disabled={field.readOnly}
          />
        )

      case FormFieldType.MULTI_SELECT:
        return (
          <Select
            value={fieldValue}
            options={field.options || []}
            placeholder={`Välj ${field.labelId}...`}
            onChange={(value) => onChange(field.field, value)}
            ariaLabel={field.labelId}
            disabled={field.readOnly}
            // TODO: Add multi-select support to Select component
          />
        )

      case FormFieldType.TEXTAREA:
        return (
          <TextArea
            value={fieldValue}
            placeholder={`Ange ${field.labelId}...`}
            onChange={(e) => onChange(field.field, e.target.value)}
            disabled={field.readOnly}
          />
        )

      case FormFieldType.NUMBER:
        return (
          <Input
            value={String(fieldValue)}
            placeholder={`Ange ${field.labelId}...`}
            onChange={(e) => {
              const numValue =
                e.target.value === "" ? "" : Number(e.target.value)
              onChange(field.field, numValue)
            }}
            disabled={field.readOnly}
          />
        )

      case FormFieldType.CHECKBOX:
        return (
          <Checkbox
            checked={Boolean(fieldValue)}
            onChange={(evt) => onChange(field.field, evt.target.checked)}
            disabled={field.readOnly}
            aria-label={field.labelId}
          />
        )

      case FormFieldType.PASSWORD:
        return (
          <Input
            type="password"
            value={String(fieldValue)}
            placeholder={`Ange ${field.labelId}...`}
            onChange={(e) => onChange(field.field, e.target.value)}
            disabled={field.readOnly}
          />
        )

      case FormFieldType.FILE:
        return (
          <Input
            type="file"
            onChange={(evt) => {
              const files = evt.target.files
              onChange(field.field, files ? files[0] : null)
            }}
            disabled={field.readOnly}
            aria-label={field.labelId}
          />
        )

      case FormFieldType.TEXT:
        return (
          <Input
            value={String(fieldValue)}
            placeholder={`Ange ${field.labelId}...`}
            onChange={(e) => onChange(field.field, e.target.value)}
            disabled={field.readOnly}
          />
        )
    }
  }

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
      {formConfig.fields.map((field) => (
        <Form
          key={field.field}
          variant="field"
          label={field.labelId} // Use parameter description directly
          required={field.required}
          helper={field.helperId || undefined} // Only set helper if helperId exists
        >
          {renderField(field)}
        </Form>
      ))}
    </Form>
  )
}

export default Export
