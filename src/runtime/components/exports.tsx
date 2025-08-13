import { React, hooks, getAppStore } from "jimu-core"
import { Select, TextArea, Form, Input } from "./ui"
import { Checkbox } from "jimu-ui"
import { STYLES } from "../../shared/css"
import defaultMessages from "./translations/default"
import type { WorkspaceParameter, WorkspaceItem } from "../../shared/types"
import { fmeActions } from "../../extensions/store"
import {
  ParameterFormService,
  type DynamicFieldConfig,
  FormFieldType,
  ErrorHandlingService,
} from "../../shared/services"
import { ErrorType } from "../../shared/types"

type FormPrimitive = string | number | boolean | readonly string[] | File | null
interface FormValues {
  [key: string]: FormPrimitive
}

const buildValidationError = (
  count: number,
  translate: (k: string, p?: any) => string
): string =>
  count === 1
    ? translate("formValidationSingleError") || "formValidationSingleError"
    : translate("formValidationMultipleErrors") ||
      "formValidationMultipleErrors"

// Dynamic export component interface
interface ExportProps {
  readonly workspaceParameters?: readonly WorkspaceParameter[]
  readonly workspaceName?: string
  readonly workspaceItem?: WorkspaceItem
  readonly onBack: () => void
  readonly onSubmit: (data: { type: string; data: FormValues }) => void
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
  if (workspaceParameters && workspaceName)
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
  readonly onSubmit: (data: { type: string; data: FormValues }) => void
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
  const formConfig = React.useMemo(
    () => parameterService.generateFormConfig(workspaceParameters),
    [parameterService, workspaceParameters]
  )

  // Helper to build initial values from field defaults
  const buildInitialValues = React.useCallback(
    () =>
      formConfig.reduce<FormValues>(
        (acc, f) =>
          f.defaultValue !== undefined
            ? { ...acc, [f.name]: f.defaultValue as FormPrimitive }
            : acc,
        {}
      ),
    [formConfig]
  )

  // Initialize form values from parameter defaults - using useState lazy initialization
  const [values, setValues] = React.useState<FormValues>(buildInitialValues)
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

  const onChange = hooks.useEventCallback(
    (field: string, value: FormPrimitive) => {
      const newValues = { ...values, [field]: value }
      setValues(newValues)
      getAppStore().dispatch(fmeActions.setFormValues(newValues) as any)
    }
  )

  const handleSubmit = hooks.useEventCallback(() => {
    const validation = parameterService.validateFormValues(values, formConfig)
    if (!validation.isValid) {
      const count = Object.keys(validation.errors).length
      const errorMessage = buildValidationError(count, translate)
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
      const rawValue = values[field.name]
      const fieldValue: any =
        rawValue === undefined || rawValue === null ? "" : rawValue
      const enterPlaceholder = translate("placeholderEnter", {
        field: field.label,
      })
      const selectPlaceholder = translate("placeholderSelect", {
        field: field.label,
      })

      switch (field.type) {
        case FormFieldType.SELECT:
        case FormFieldType.MULTI_SELECT:
          return (
            <Select
              value={fieldValue}
              options={field.options || []}
              placeholder={selectPlaceholder}
              onChange={(value) => onChange(field.name, value as FormPrimitive)}
              ariaLabel={field.label}
              disabled={field.readOnly}
            />
          )
        case FormFieldType.TEXTAREA:
          return (
            <TextArea
              value={fieldValue as string}
              placeholder={enterPlaceholder}
              onChange={(value) => onChange(field.name, value)}
              disabled={field.readOnly}
            />
          )
        case FormFieldType.NUMBER:
          return (
            <Input
              value={String(fieldValue)}
              placeholder={enterPlaceholder}
              onChange={(value) => {
                const numValue = value === "" ? "" : Number(value)
                onChange(field.name, numValue as FormPrimitive)
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
              placeholder={enterPlaceholder}
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
              value={
                typeof fieldValue === "string" || typeof fieldValue === "number"
                  ? String(fieldValue)
                  : ""
              }
              placeholder={enterPlaceholder}
              onChange={(value) => onChange(field.name, value)}
              disabled={field.readOnly}
            />
          )
      }
    },
    [values, onChange, translate]
  )

  // Helper function to strip HTML tags from text
  const stripHtml = React.useCallback((html: string): string => {
    if (!html) return ""
    const temp = document.createElement("div")
    temp.innerHTML = html
    return temp.textContent || temp.innerText || ""
  }, [])

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
