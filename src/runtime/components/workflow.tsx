/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, getAppStore, jsx } from "jimu-core"
import {
  Button,
  StateView,
  Select,
  TextArea,
  Form,
  Field,
  Input,
  Checkbox,
  ButtonTabs,
  useStyles,
  renderSupportHint,
} from "./ui"
import defaultMessages from "./translations/default"
import runtimeMessages from "../translations/default"
import {
  FormFieldType,
  type WorkflowProps,
  type WorkspaceItem,
  type FormPrimitive,
  type FormValues,
  type SelectValue,
  type OrderResultProps,
  type ExportFormProps,
  type DynamicFieldProps,
  type DynamicFieldConfig,
  type ApiResponse,
  ViewMode,
  DrawingTool,
  makeLoadingView,
  makeEmptyView,
  ErrorType,
  makeErrorView,
} from "../../shared/types"
import polygonIcon from "jimu-icons/svg/outlined/gis/polygon.svg"
import rectangleIcon from "jimu-icons/svg/outlined/gis/rectangle.svg"
import resetIcon from "jimu-icons/svg/outlined/editor/close-circle.svg"
import exportIcon from "jimu-icons/svg/outlined/editor/export.svg"
import { createFmeFlowClient } from "../../shared/api"
import { fmeActions } from "../../extensions/store"
import {
  ParameterFormService,
  ErrorHandlingService,
} from "../../shared/services"
import {
  resolveMessageOrKey,
  buildSupportHintText,
  getSupportEmail,
} from "../../shared/utils"

// Loading delay to avoid flicker on fast operations
const MS_LOADING = 500

// Workspace item type constant
const WORKSPACE_ITEM_TYPE = "WORKSPACE"

// Error names used to detect cancellations from the FME API
const ERROR_NAMES = {
  CANCELLED_PROMISE: "CancelledPromiseError",
  ABORT: "AbortError",
} as const

// Constants for drawing mode configuration
const DRAWING_MODE_TABS = [
  {
    value: DrawingTool.POLYGON,
    label: "drawingModePolygon",
    icon: polygonIcon,
    tooltip: "drawingModePolygonTooltip",
    hideLabel: true,
  },
  {
    value: DrawingTool.RECTANGLE,
    label: "drawingModeRectangle",
    icon: rectangleIcon,
    tooltip: "drawingModeRectangleTooltip",
    hideLabel: true,
  },
] as const

// Check if reset button should be enabled
const canReset = (
  onReset: (() => void) | undefined,
  canResetFlag: boolean,
  state: ViewMode,
  drawnArea: number,
  isDrawing?: boolean,
  clickCount?: number
): boolean => {
  if (!onReset || !canResetFlag) return false
  if (state === ViewMode.ORDER_RESULT) return false

  const hasArea = drawnArea > 0
  if (state === ViewMode.DRAWING) {
    const firstClickPending = Boolean(isDrawing) && (clickCount ?? 0) === 0
    return !firstClickPending
  }
  return hasArea && state !== ViewMode.INITIAL
}

// Check if workspace list should show loading
const shouldShowWsLoading = (
  isLoading: boolean,
  workspaces: readonly WorkspaceItem[],
  state: ViewMode,
  hasError?: boolean
): boolean => {
  if (hasError) return false
  const needsLoading =
    state === ViewMode.WORKSPACE_SELECTION || state === ViewMode.EXPORT_OPTIONS
  return isLoading || (!workspaces.length && needsLoading)
}

// Form validation helpers for better separation of concerns
const createFormValidator = (
  parameterService: ParameterFormService,
  workspaceParameters: readonly any[]
) => {
  const getFormConfig = () =>
    parameterService.convertParametersToFields(workspaceParameters)

  const validateValues = (values: FormValues) =>
    parameterService.validateFormValues(values, getFormConfig())

  const initializeValues = () => initValues(getFormConfig())

  return { getFormConfig, validateValues, initializeValues }
}

const useFormStateManager = (
  validator: ReturnType<typeof createFormValidator>,
  onValuesChange: (values: FormValues) => void
) => {
  const [values, setValues] = React.useState<FormValues>(() =>
    validator.initializeValues()
  )
  const [isValid, setIsValid] = React.useState(true)
  const [errors, setErrors] = React.useState<{ [key: string]: string }>({})

  const updateField = hooks.useEventCallback(
    (field: string, value: FormPrimitive) => {
      const newValues = { ...values, [field]: value }
      setValues(newValues)
      onValuesChange(newValues)
    }
  )

  const validateForm = hooks.useEventCallback(() => {
    const validation = validator.validateValues(values)
    setIsValid(validation.isValid)
    setErrors(validation.errors)
    return validation
  })

  const resetForm = hooks.useEventCallback(() => {
    const nextValues = validator.initializeValues()
    setValues(nextValues)
    setErrors({})
    onValuesChange(nextValues)
  })

  return {
    values,
    isValid,
    errors,
    updateField,
    validateForm,
    resetForm,
    setValues,
    setIsValid,
    setErrors,
  }
}

const normalizeFormValue = (
  value: FormPrimitive | undefined,
  isMultiSelect: boolean
): FormPrimitive | SelectValue => {
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  if (isMultiSelect) {
    return Array.isArray(value) ? (value as ReadonlyArray<string | number>) : []
  }
  return typeof value === "string" || typeof value === "number" ? value : ""
}

const makePlaceholders = (
  translate: (k: string, p?: any) => string,
  fieldLabel: string
) =>
  ({
    enter: translate("placeholderEnter", { field: fieldLabel }),
    select: translate("placeholderSelect", { field: fieldLabel }),
  }) as const

const initValues = (formConfig: readonly DynamicFieldConfig[]): FormValues => {
  const result: FormValues = {}
  for (const field of formConfig) {
    if (field.defaultValue !== undefined) {
      result[field.name] = field.defaultValue as FormPrimitive
    }
  }
  return result
}

const syncForm = (values: FormValues): void => {
  // Dispatch form values to the Redux store
  const dispatch = getAppStore().dispatch as (
    action: ReturnType<typeof fmeActions.setFormValues>
  ) => void
  dispatch(fmeActions.setFormValues(values))
}

// Strip label from error messages for cleaner display
const stripLabelFromError = (errorText?: string): string | undefined => {
  const t = (errorText ?? "").replace(/<[^>]*>/g, "").trim()
  if (!t) return undefined
  // "<Label>: <reason>" → "<reason>"
  const colonIdx = t.indexOf(":")
  if (colonIdx > -1) return t.slice(colonIdx + 1).trim()
  // "<Label> is <reason>" → "<reason>"
  const isIdx = t.toLowerCase().indexOf(" is ")
  if (isIdx > -1) return t.slice(isIdx + 1).trim()
  return t
}

const useWorkspaceLoader = (
  config: any,
  getFmeClient: () => ReturnType<typeof createFmeFlowClient> | null,
  translate: (k: string) => string,
  translateRuntime: (k: string) => string,
  makeCancelable: ReturnType<typeof hooks.useCancelablePromiseMaker>,
  onWorkspaceSelected?: (
    workspaceName: string,
    params: readonly any[],
    item: any
  ) => void
) => {
  // Local state for workspaces, loading flag and error message
  const [workspaces, setWorkspaces] = React.useState<readonly WorkspaceItem[]>(
    []
  )
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Abort controller and timeout refs
  const loadAbortRef = React.useRef<AbortController | null>(null)
  const loadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  // Track mount to avoid state updates after unmount
  const isMountedRef = React.useRef(true)
  hooks.useEffectOnce(() => {
    return () => {
      isMountedRef.current = false
      // Cancel any in‑flight request
      if (loadAbortRef.current) {
        loadAbortRef.current.abort()
        loadAbortRef.current = null
      }
      // Clear any scheduled timeout
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }
  })

  // Helper to format API errors into localized strings
  const formatError = hooks.useEventCallback(
    (err: unknown, baseKey: string): string | null => {
      const errName = (err as { name?: string } | null)?.name
      if (
        errName === ERROR_NAMES.CANCELLED_PROMISE ||
        errName === ERROR_NAMES.ABORT ||
        !isMountedRef.current
      ) {
        return null
      }
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : translateRuntime("unknownErrorOccurred")
      const safe = raw.replace(/<[^>]*>/g, "")
      const msg = safe.length > 300 ? `${safe.slice(0, 300)}…` : safe
      return `${translate(baseKey)}: ${msg}`
    }
  )

  // Cancel any ongoing load
  const cancelCurrent = () => {
    if (loadAbortRef.current) {
      loadAbortRef.current.abort()
      loadAbortRef.current = null
    }
  }

  // Load all workspaces in the configured repository
  const loadAll = hooks.useEventCallback(async () => {
    const fmeClient = getFmeClient()
    if (!fmeClient || !config?.repository) return

    cancelCurrent()
    const controller = new AbortController()
    loadAbortRef.current = controller
    setIsLoading(true)
    setError(null)

    try {
      const response = await makeCancelable(
        fmeClient.getRepositoryItems(
          config.repository,
          WORKSPACE_ITEM_TYPE,
          undefined,
          undefined,
          controller.signal
        )
      )
      if (controller.signal.aborted) return
      if (response.status === 200 && response.data.items) {
        // Filter and sort by title or name
        const items = (response.data.items as readonly any[]).filter(
          (i: any) => i.type === WORKSPACE_ITEM_TYPE
        ) as readonly WorkspaceItem[]
        const sorted = items.slice().sort((a, b) =>
          (a.title || a.name).localeCompare(b.title || b.name, undefined, {
            sensitivity: "base",
          })
        )
        if (isMountedRef.current) setWorkspaces(sorted)
      } else {
        throw new Error(translate("failedToLoadWorkspaces"))
      }
    } catch (err) {
      const msg = formatError(err, "failedToLoadWorkspaces")
      if (msg) setError(msg)
    } finally {
      if (isMountedRef.current) setIsLoading(false)
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
      }
    }
  })

  // Load a single workspace and forward its parameters
  const loadItem = hooks.useEventCallback(async (workspaceName: string) => {
    const fmeClient = getFmeClient()
    if (!fmeClient || !config?.repository) return

    cancelCurrent()
    const controller = new AbortController()
    loadAbortRef.current = controller
    setIsLoading(true)
    setError(null)

    try {
      const response: ApiResponse<any> = await makeCancelable(
        fmeClient.getWorkspaceItem(
          workspaceName,
          config.repository,
          controller.signal
        )
      )
      if (response.status === 200 && response.data?.parameters) {
        onWorkspaceSelected?.(
          workspaceName,
          response.data.parameters,
          response.data
        )
      } else {
        throw new Error(translate("failedToLoadWorkspaceDetails"))
      }
    } catch (err) {
      const msg = formatError(err, "failedToLoadWorkspaceDetails")
      if (msg) setError(msg)
    } finally {
      if (isMountedRef.current) setIsLoading(false)
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
      }
    }
  })

  // Debounced loader
  const scheduleLoad = hooks.useEventCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
    }
    loadTimeoutRef.current = setTimeout(() => {
      loadAll()
      loadTimeoutRef.current = null
    }, MS_LOADING)
  })

  return {
    workspaces,
    isLoading,
    error,
    loadAll,
    loadItem,
    scheduleLoad,
  }
}

const renderInput = (
  type: "text" | "password" | "number",
  fieldValue: FormPrimitive,
  placeholder: string,
  onChange: (value: FormPrimitive) => void,
  readOnly?: boolean
): JSX.Element => {
  const handleChange = (val: string) => {
    if (type === "number") {
      if (val === "") {
        onChange("")
        return
      }
      const num = Number(val)
      onChange(Number.isFinite(num) ? (num as FormPrimitive) : "")
    } else {
      onChange(val)
    }
  }

  const displayValue =
    typeof fieldValue === "string" || typeof fieldValue === "number"
      ? String(fieldValue)
      : ""

  return (
    <Input
      type={type === "number" ? "text" : type}
      value={displayValue}
      placeholder={placeholder}
      onChange={handleChange}
      disabled={readOnly}
    />
  )
}

const OrderResult: React.FC<OrderResultProps> = ({
  orderResult,
  translate,
  onReuseGeography,
  onBack,
  config,
}) => {
  const styles = useStyles()
  const isSuccess = !!orderResult.success
  const isSyncMode = Boolean(config?.syncMode)
  const rows: React.ReactNode[] = []

  const addRow = (label?: string, value?: unknown) => {
    if (value === undefined || value === null || value === "") return
    const display =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : JSON.stringify(value)
    rows.push(
      <div css={styles.typography.caption} key={label || display}>
        {label ? `${label}: ${display}` : display}
      </div>
    )
  }

  addRow(translate("jobId"), orderResult.jobId)
  addRow(translate("workspace"), orderResult.workspaceName)
  // Only show notification email when sync mode is OFF (async mode)
  if (!isSyncMode) {
    addRow(translate("notificationEmail"), orderResult.email)
  }
  if (orderResult.code && !isSuccess)
    addRow(translate("errorCode"), orderResult.code)

  const titleText = isSuccess
    ? translate("orderConfirmation")
    : translate("orderSentError")

  const buttonText = isSuccess
    ? translate("reuseGeography")
    : translate("retry")

  const buttonHandler = isSuccess ? onReuseGeography : onBack

  const showDownloadLink = isSuccess && orderResult.downloadUrl
  const showMessage = isSuccess || orderResult.message

  // Conditional message based on sync mode
  const messageText = isSuccess
    ? isSyncMode && orderResult.downloadUrl
      ? null
      : translate("emailNotificationSent")
    : (() => {
        // Localize known failure messages/codes
        const code = (orderResult.code || "").toString().toUpperCase()
        const msg = String(orderResult.message || "")
        if (
          code === "FME_JOB_FAILURE" ||
          /FME\s*Flow\s*transformation\s*failed/i.test(msg)
        ) {
          return translate("fmeFlowTransformationFailed")
        }
        return msg || translate("unknownErrorOccurred")
      })()

  return (
    <>
      <div css={styles.typography.title}>{titleText}</div>
      {rows}
      {showDownloadLink && (
        <div css={styles.typography.caption}>
          {translate("downloadReady")}{" "}
          <a
            href={orderResult.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            css={styles.typography.link}
          >
            {translate("clickToDownload")}
          </a>
        </div>
      )}
      {showMessage && messageText && (
        <div css={styles.typography.caption}>{messageText}</div>
      )}
      <Button
        text={buttonText}
        onClick={buttonHandler}
        css={styles.marginTop(12)}
        logging={{ enabled: true, prefix: "FME-Export" }}
        tooltip={isSuccess ? translate("tooltipReuseGeography") : undefined}
        tooltipPlacement="bottom"
      />
    </>
  )
}

// Dynamic field component for rendering various form fields based on configuration
const DynamicField: React.FC<DynamicFieldProps> = ({
  field,
  value,
  onChange,
  translate,
}) => {
  const isMulti = field.type === FormFieldType.MULTI_SELECT
  const fieldValue = normalizeFormValue(value, isMulti)
  const placeholders = makePlaceholders(translate, field.label)

  // Determine if the field is a select type
  const isSelectType =
    field.type === FormFieldType.SELECT ||
    field.type === FormFieldType.MULTI_SELECT
  const selectOptions = (field.options || []) as ReadonlyArray<{
    readonly value?: unknown
  }>
  const isSingleOption = isSelectType && !isMulti && selectOptions.length === 1
  const onlyVal = isSingleOption ? selectOptions[0]?.value : undefined

  // Compute if select values can be coerced to numbers
  const computeSelectCoerce = (): "number" | "string" | undefined => {
    if (!isSelectType || !selectOptions.length) return undefined
    const vals = selectOptions.map((o) => o.value)
    const allNumeric = vals.every((v) => {
      if (typeof v === "number") return Number.isFinite(v)
      if (typeof v === "string") {
        if (v.trim() === "") return false
        const n = Number(v)
        return Number.isFinite(n) && String(n) === v
      }
      return false
    })
    return allNumeric ? "number" : undefined
  }
  const selectCoerce = computeSelectCoerce()

  hooks.useEffectOnce(() => {
    if (!isSingleOption) return
    const current = fieldValue as SelectValue
    const isUnset =
      current === undefined || (typeof current === "string" && current === "")
    if (onlyVal !== undefined && (isUnset || current !== onlyVal)) {
      onChange(onlyVal as FormPrimitive)
    }
  })
  // Render field based on its type
  const renderByType = (): JSX.Element => {
    switch (field.type) {
      case FormFieldType.SELECT:
      case FormFieldType.MULTI_SELECT: {
        const options = field.options || []

        return (
          <Select
            value={
              isSingleOption
                ? (options[0]?.value as SelectValue)
                : (fieldValue as SelectValue)
            }
            options={options}
            placeholder={placeholders.select}
            onChange={(val) => {
              onChange(val as FormPrimitive)
            }}
            aria-label={field.label}
            disabled={field.readOnly || isSingleOption}
            coerce={selectCoerce}
          />
        )
      }
      case FormFieldType.TEXTAREA:
        return (
          <TextArea
            value={fieldValue as string}
            placeholder={placeholders.enter}
            onChange={(val) => {
              onChange(val)
            }}
            disabled={field.readOnly}
            rows={field.rows}
          />
        )
      case FormFieldType.NUMBER:
        return renderInput(
          "number",
          fieldValue as FormPrimitive,
          placeholders.enter,
          onChange,
          field.readOnly
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
            value={(fieldValue as string) || ""}
            placeholder={field.placeholder || placeholders.enter}
            onChange={(val) => {
              onChange(val)
            }}
            disabled={field.readOnly}
            maxLength={field.maxLength}
          />
        )
      case FormFieldType.FILE:
        return (
          <Input
            type="file"
            onFileChange={(evt) => {
              const files = evt.target.files
              onChange(
                files
                  ? (files[0] as unknown as FormPrimitive)
                  : (null as FormPrimitive)
              )
            }}
            disabled={field.readOnly}
            aria-label={field.label}
          />
        )
      case FormFieldType.TEXT:
        return (
          <Input
            type="text"
            value={(fieldValue as string) || ""}
            placeholder={field.placeholder || placeholders.enter}
            onChange={(val) => {
              onChange(val)
            }}
            disabled={field.readOnly}
            maxLength={field.maxLength}
          />
        )
    }
  }

  return renderByType()
}

// ExportForm component - handles dynamic form generation and submission
const ExportForm: React.FC<ExportFormProps> = ({
  workspaceParameters,
  workspaceName,
  workspaceItem,
  onBack,
  onSubmit,
  isSubmitting,
  translate,
}) => {
  const [parameterService] = React.useState(() => new ParameterFormService())
  const [errorService] = React.useState(() => new ErrorHandlingService())
  const [fileMap, setFileMap] = React.useState<{
    [key: string]: File | null
  }>({})

  // Local validation message builder using current translate
  const errorMsg = hooks.useEventCallback((count: number): string =>
    count === 1
      ? translate("formValidationSingleError")
      : translate("formValidationMultipleErrors")
  )

  // Create validator with current parameters
  const validator = createFormValidator(parameterService, workspaceParameters)

  // Use form state manager hook
  const formState = useFormStateManager(validator, syncForm)

  // Initialize form values in Redux store only once
  hooks.useEffectOnce(() => {
    syncForm(formState.values)
  })

  // Validate form on mount and when dependencies change
  hooks.useEffectOnce(() => {
    formState.validateForm()
  })

  // Validate form whenever values change
  hooks.useUpdateEffect(() => {
    formState.validateForm()
  }, [formState.values, formState.validateForm])

  // Reset values when workspace or fields change (e.g., switching workspaces)
  hooks.useUpdateEffect(() => {
    formState.resetForm()
    setFileMap({})
  }, [workspaceName, workspaceParameters, formState.resetForm])

  const setField = hooks.useEventCallback(
    (field: string, value: FormPrimitive) => {
      if (value instanceof File) {
        // Handle file input specifically
        setFileMap((prev) => ({ ...prev, [field]: value }))
        formState.updateField(field, value.name)
        return
      } else if (value === null && field in fileMap) {
        // Handle file removal
        setFileMap((prev) => ({ ...prev, [field]: null }))
        formState.updateField(field, "")
        return
      }

      // Handle all other form values
      formState.updateField(field, value)
    }
  )

  const handleSubmit = hooks.useEventCallback(() => {
    const validation = formState.validateForm()
    if (!validation.isValid) {
      const count = Object.keys(validation.errors).length
      const errorMessage = errorMsg(count)
      const error = errorService.createError(
        errorMessage,
        ErrorType.VALIDATION,
        { code: "FORM_INVALID" }
      )
      // Dispatch error to the store
      const dispatch = getAppStore().dispatch as (
        action: ReturnType<typeof fmeActions.setError>
      ) => void
      dispatch(fmeActions.setError(error))
      return
    }
    // Merge file inputs with other values
    const merged: FormValues = { ...formState.values }
    Object.keys(fileMap).forEach((k) => {
      const f = fileMap[k]
      if (f) merged[k] = f
    })
    onSubmit({ type: workspaceName, data: merged })
  })

  // Helper function to strip HTML tags from text safely
  const stripHtml = hooks.useEventCallback((html: string): string => {
    if (!html) return ""
    return html.replace(/<[^>]*>/g, "")
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
      isValid={formState.isValid}
      loading={isSubmitting}
    >
      {validator.getFormConfig().map((field: DynamicFieldConfig) => (
        <Field
          key={field.name}
          label={field.label}
          required={field.required}
          error={stripLabelFromError(formState.errors[field.name])}
        >
          <DynamicField
            field={field}
            value={formState.values[field.name]}
            onChange={(val) => setField(field.name, val)}
            translate={translate}
          />
        </Field>
      ))}
    </Form>
  )
}

// Main Workflow component
export const Workflow: React.FC<WorkflowProps> = ({
  state,
  instructionText,
  isModulesLoading,
  canStartDrawing: _canStartDrawing,
  error,
  onFormBack,
  onFormSubmit,
  orderResult,
  onReuseGeography,
  isSubmittingOrder = false,
  onBack,
  drawnArea,
  // Header actions
  showHeaderActions,
  // Drawing mode
  drawingMode = DrawingTool.POLYGON,
  onDrawingModeChange,
  // Drawing progress
  isDrawing,
  clickCount,
  // Reset
  onReset,
  canReset: canResetProp = true,
  // Workspace props
  config,
  onWorkspaceSelected,
  selectedWorkspace,
  workspaceParameters,
  workspaceItem,
  // Startup validation props
  isStartupValidating: _isStartupValidating,
  startupValidationStep,
  startupValidationError,
  onRetryValidation,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const translateRuntime = hooks.useTranslation(runtimeMessages)
  const styles = useStyles()
  const makeCancelable = hooks.useCancelablePromiseMaker()

  // Stable getter for drawing mode items using event callback
  const getDrawingModeItems = hooks.useEventCallback(() =>
    DRAWING_MODE_TABS.map((tab) => ({
      ...tab,
      label: translate(tab.label),
      tooltip: translate(tab.tooltip),
    }))
  )

  // Small helpers to render common StateViews consistently
  const renderLoading = hooks.useEventCallback(
    (message?: string, subMessage?: string) => (
      <StateView state={makeLoadingView(message, subMessage)} />
    )
  )

  const renderError = hooks.useEventCallback(
    (
      message: string,
      onBack?: () => void,
      onRetry?: () => void,
      code?: string,
      supportText?: string
    ) => {
      const actions: Array<{ label: string; onClick: () => void }> = []
      if (onRetry) {
        actions.push({ label: translate("retry"), onClick: onRetry })
      } else if (onBack) {
        actions.push({ label: translate("back"), onClick: onBack })
      }
      // Build consistent support hint and link if email configured
      const rawEmail = getSupportEmail(config?.supportEmail)
      const hintText = buildSupportHintText(
        translateRuntime,
        rawEmail,
        supportText
      )

      let localizedMessage = message
      try {
        localizedMessage = resolveMessageOrKey(String(message), translate)
      } catch {
        /* swallow translation errors and keep raw message */
      }

      return (
        <StateView
          state={makeErrorView(localizedMessage, { code, actions })}
          renderActions={(_act, ariaLabel) => (
            <div role="group" aria-label={ariaLabel}>
              {renderSupportHint(rawEmail, translateRuntime, styles, hintText)}
            </div>
          )}
          center={false}
        />
      )
    }
  )

  // FME client - compute on demand via stable getter
  const clientRef = React.useRef<ReturnType<typeof createFmeFlowClient> | null>(
    null
  )
  const getFmeClient = hooks.useEventCallback(() => {
    try {
      if (!config) return null
      if (!clientRef.current) clientRef.current = createFmeFlowClient(config)
      return clientRef.current
    } catch (e) {
      console.warn("FME Export - invalid FME config; deferring client init", e)
      return null
    }
  })
  hooks.useUpdateEffect(() => {
    clientRef.current = null
  }, [config])

  // Load workspaces using custom hook
  const {
    workspaces,
    isLoading: isLoadingWorkspaces,
    error: workspaceError,
    loadAll: loadWsList,
    loadItem: loadWorkspace,
    scheduleLoad: scheduleWsLoad,
  } = useWorkspaceLoader(
    config,
    getFmeClient,
    translate,
    translateRuntime,
    makeCancelable,
    onWorkspaceSelected
  )

  // Render workspace buttons
  const renderWsButtons = () =>
    workspaces.map((workspace) => (
      <Button
        key={workspace.name}
        text={workspace.title || workspace.name}
        icon={exportIcon}
        size="lg"
        role="listitem"
        onClick={() => {
          loadWorkspace(workspace.name)
        }}
        logging={{
          enabled: true,
          prefix: "FME-Export-WorkspaceSelection",
        }}
      />
    ))

  // Lazy load workspaces when entering workspace selection modes
  hooks.useUpdateEffect(() => {
    if (
      state === ViewMode.WORKSPACE_SELECTION ||
      state === ViewMode.EXPORT_OPTIONS
    ) {
      if (!workspaces.length && !isLoadingWorkspaces && !workspaceError) {
        scheduleWsLoad()
      }
    }
  }, [
    state,
    workspaces.length,
    isLoadingWorkspaces,
    workspaceError,
    scheduleWsLoad,
  ])

  // Header
  const renderHeader = () => {
    const resetEnabled = canReset(
      onReset,
      canResetProp,
      state,
      drawnArea ?? 0,
      isDrawing,
      clickCount
    )

    if (!resetEnabled) return null

    return (
      <Button
        icon={resetIcon}
        tooltip={translate("tooltipCancel")}
        tooltipPlacement="bottom"
        onClick={onReset}
        variant="text"
        alignText="start"
        text={translate("cancel")}
        size="sm"
        aria-label={translate("cancel")}
        logging={{ enabled: true, prefix: "FME-Export-Header" }}
        block={false}
      />
    )
  }

  const renderInitial = () => {
    if (isModulesLoading) {
      return renderLoading(undefined, translate("preparingMapTools"))
    }

    return (
      <div css={styles.centered}>
        <ButtonTabs
          items={getDrawingModeItems()}
          value={drawingMode}
          onChange={(val) => {
            onDrawingModeChange?.(val as DrawingTool)
          }}
          ariaLabel={translate("drawingModeTooltip")}
        />
      </div>
    )
  }

  const renderDrawing = () => (
    <div
      css={styles.typography.instruction}
      role="status"
      aria-live="polite"
      aria-atomic={true}
    >
      {instructionText}
    </div>
  )

  const renderSelection = () => {
    const shouldShowLoading = shouldShowWsLoading(
      isLoadingWorkspaces,
      workspaces,
      state,
      Boolean(workspaceError)
    )
    if (shouldShowLoading) {
      const message = workspaces.length
        ? translate("loadingWorkspaceDetails")
        : translate("loadingWorkspaces")
      return renderLoading(message)
    }

    if (workspaceError) {
      return renderError(workspaceError, onBack, loadWsList)
    }

    if (!workspaces.length) {
      const actions = [
        { label: translate("retry"), onClick: loadWsList },
        { label: translate("back"), onClick: onBack },
      ]
      return (
        <StateView
          state={makeEmptyView(translate("noWorkspacesFound"), actions)}
        />
      )
    }

    return (
      <div css={styles.button.default} role="list">
        {renderWsButtons()}
      </div>
    )
  }

  const renderForm = () => {
    if (!onFormBack || !onFormSubmit) {
      return renderError(translate("missingExportConfiguration"), onBack)
    }

    if (!workspaceParameters || !selectedWorkspace) {
      return renderLoading(translate("loadingWorkspaceDetails"))
    }

    return (
      <ExportForm
        workspaceParameters={workspaceParameters}
        workspaceName={selectedWorkspace}
        workspaceItem={workspaceItem}
        onBack={onFormBack}
        onSubmit={onFormSubmit}
        isSubmitting={isSubmittingOrder}
        translate={translate}
      />
    )
  }

  const renderCurrent = () => {
    if (state === ViewMode.STARTUP_VALIDATION) {
      if (startupValidationError) {
        const supportHint =
          config?.supportEmail || translateRuntime("contactSupport")
        return renderError(
          startupValidationError.message,
          undefined,
          onRetryValidation ||
            (() => {
              window.location.reload()
            }),
          startupValidationError.code,
          startupValidationError.userFriendlyMessage || supportHint
        )
      }

      const loadingMessage =
        startupValidationStep || translate("validatingStartup")
      return <StateView state={makeLoadingView(loadingMessage)} />
    }

    if (state === ViewMode.ORDER_RESULT && orderResult) {
      return (
        <OrderResult
          orderResult={orderResult}
          translate={translate}
          onReuseGeography={onReuseGeography}
          onBack={onBack}
          config={config}
        />
      )
    }

    if (isSubmittingOrder) {
      const isSyncMode = Boolean(config?.syncMode)
      const loadingMessageKey = isSyncMode
        ? "submittingOrderSync"
        : "submittingOrder"
      return renderLoading(translate(loadingMessageKey))
    }

    if (error) {
      return renderError(
        error.message,
        undefined,
        error.severity !== "info" ? onBack : undefined,
        error.code,
        error.userFriendlyMessage
      )
    }

    switch (state) {
      case ViewMode.INITIAL:
        return renderInitial()
      case ViewMode.DRAWING:
        if ((clickCount || 0) === 0) {
          return (
            <div css={styles.centered}>
              <ButtonTabs
                items={getDrawingModeItems()}
                value={drawingMode}
                onChange={(val) => {
                  onDrawingModeChange?.(val as DrawingTool)
                }}
                ariaLabel={translate("drawingModeTooltip")}
              />
            </div>
          )
        }
        return renderDrawing()
      case ViewMode.EXPORT_OPTIONS:
      case ViewMode.WORKSPACE_SELECTION:
        return renderSelection()
      case ViewMode.EXPORT_FORM:
        return renderForm()
      case ViewMode.ORDER_RESULT:
        return renderError(translate("orderResultMissing"), onBack)
    }
  }

  return (
    <div css={styles.parent}>
      <div css={styles.header}>{showHeaderActions ? renderHeader() : null}</div>
      <div css={styles.content}>{renderCurrent()}</div>
    </div>
  )
}

export default Workflow
