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

type FormPrimitive =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number>
  | File
  | null
interface FormValues {
  [key: string]: FormPrimitive
}

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
const DynamicField: React.FC<{
  field: DynamicFieldConfig
  value: FormPrimitive | undefined
  onChange: (value: FormPrimitive) => void
  translate: (k: string, p?: any) => string
}> = ({ field, value, onChange, translate }) => {
  const rawValue = value
  const isMulti = field.type === FormFieldType.MULTI_SELECT
  const fieldValue: any =
    rawValue === undefined || rawValue === null ? (isMulti ? [] : "") : rawValue

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
          onChange={(val) => {
            onChange(val as FormPrimitive)
          }}
          ariaLabel={field.label}
          disabled={field.readOnly}
        />
      )
    case FormFieldType.TEXTAREA:
      return (
        <TextArea
          value={fieldValue as string}
          placeholder={enterPlaceholder}
          onChange={(val) => {
            onChange(val)
          }}
          disabled={field.readOnly}
        />
      )
    case FormFieldType.NUMBER:
      return (
        <Input
          value={String(fieldValue)}
          placeholder={enterPlaceholder}
          onChange={(val) => {
            const numValue = val === "" ? "" : Number(val)
            onChange(numValue as FormPrimitive)
          }}
          disabled={field.readOnly}
        />
      )
    case FormFieldType.CHECKBOX:
      return (
        <Checkbox
          checked={Boolean(fieldValue)}
          onChange={(evt) => {
            onChange(evt.target.checked)
          }}
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
          onChange={(val) => {
            onChange(val)
          }}
          disabled={field.readOnly}
        />
      )
    case FormFieldType.FILE:
      return (
        <Input
          type="file"
          onFileChange={(evt) => {
            const files = evt.target.files
            onChange(files ? files[0] : null)
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
          onChange={(val) => {
            onChange(val)
          }}
          disabled={field.readOnly}
        />
      )
  }
}

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

  // Local validation message builder using current translate
  const buildValidationError = hooks.useEventCallback(
    (count: number): string =>
      count === 1
        ? translate("formValidationSingleError") || "formValidationSingleError"
        : translate("formValidationMultipleErrors") ||
          "formValidationMultipleErrors"
  )

  // Generate form configuration from parameters
  const formConfig = React.useMemo(
    () => parameterService.generateFormConfig(workspaceParameters),
    [parameterService, workspaceParameters]
  )

  // Initialize form values from parameter defaults - using useState lazy initialization
  const [values, setValues] = React.useState<FormValues>(() =>
    formConfig.reduce<FormValues>(
      (acc, f) =>
        f.defaultValue !== undefined
          ? { ...acc, [f.name]: f.defaultValue as FormPrimitive }
          : acc,
      {}
    )
  )
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
    const nextValues = formConfig.reduce<FormValues>(
      (acc, f) =>
        f.defaultValue !== undefined
          ? { ...acc, [f.name]: f.defaultValue as FormPrimitive }
          : acc,
      {}
    )
    setValues(nextValues)
    getAppStore().dispatch(fmeActions.setFormValues(nextValues) as any)
  }, [workspaceName, formConfig])

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
      const errorMessage = buildValidationError(count)
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

  // Helper function to strip HTML tags from text
  const stripHtml = hooks.useEventCallback((html: string): string => {
    if (!html) return ""
    const temp = document.createElement("div")
    temp.innerHTML = html
    return temp.textContent || temp.innerText || ""
  })

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
          <DynamicField
            field={field}
            value={values[field.name]}
            onChange={(val) => onChange(field.name, val)}
            translate={translate}
          />
        </Form>
      ))}
    </Form>
  )
}

export default Export
