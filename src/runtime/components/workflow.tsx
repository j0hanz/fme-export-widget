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
  styles,
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
  type RepositoryItems,
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
import listIcon from "jimu-icons/svg/outlined/application/folder.svg"
// error icon no longer used; render via StateView
import { createFmeFlowClient } from "../../shared/api"
import { fmeActions } from "../../extensions/store"
import {
  ParameterFormService,
  ErrorHandlingService,
} from "../../shared/services"

// All styles now centralized via styles from ui.tsx

// Debounce interval for workspace loading
const DEBOUNCE_MS = 300

// Abort helper to cancel in-flight workspace requests safely
const abortCurrentLoad = (
  ref: React.MutableRefObject<AbortController | null>
): void => {
  if (ref.current) {
    ref.current.abort()
    ref.current = null
  }
}

const WORKSPACE_ITEM_TYPE = "WORKSPACE"
const ERROR_NAMES = {
  CANCELLED_PROMISE: "CancelledPromiseError",
  ABORT: "AbortError",
} as const

const noOp = (): void => {
  /* noop */
}

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

// Module-level helpers

// Helper for workspace API error handling
const formatApiError = (
  err: unknown,
  isMountedRef: React.MutableRefObject<boolean>,
  translate: (key: string) => string,
  baseMessage: string
): string | null => {
  const errName = (err as { name?: string } | null)?.name
  if (
    errName === ERROR_NAMES.CANCELLED_PROMISE ||
    errName === ERROR_NAMES.ABORT ||
    !isMountedRef.current
  ) {
    return null
  }
  const errorMessage =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : translate("unknownErrorOccurred")
  return `${translate(baseMessage)}: ${errorMessage}`
}

// Workspace list helpers: filter by type and sort deterministically
const filterWorkspaces = (
  items: readonly WorkspaceItem[] | undefined
): readonly WorkspaceItem[] => {
  if (!items || items.length === 0) return []
  return items.filter((i) => i.type === WORKSPACE_ITEM_TYPE)
}

const sortWorkspaces = (
  items: readonly WorkspaceItem[]
): readonly WorkspaceItem[] =>
  items.slice().sort((a, b) =>
    (a.title || a.name).localeCompare(b.title || b.name, undefined, {
      sensitivity: "base",
    })
  )

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

// Form utilities

const normalizeValue = (
  value: FormPrimitive | undefined,
  isMultiSelect: boolean
): FormPrimitive => {
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  return value
}

const toSelectValue = (
  value: FormPrimitive,
  isMultiSelect: boolean
): SelectValue => {
  if (Array.isArray(value)) return value as ReadonlyArray<string | number>
  if (typeof value === "string" || typeof value === "number") return value
  return isMultiSelect ? [] : ""
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

// Remove leading label from validation error messages to avoid duplicate labels
const stripLabelFromError = (
  label: string,
  errorText?: string
): string | undefined => {
  if (!errorText) return undefined
  try {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const re = new RegExp(`^${escaped}\\s+`, "i")
    return errorText.replace(re, "")
  } catch {
    return errorText
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
      onChange(
        Number.isFinite(num)
          ? (num as unknown as FormPrimitive)
          : ("" as FormPrimitive)
      )
    } else {
      onChange(val)
    }
  }

  // Display value handling
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
      inputMode={type === "number" ? "numeric" : undefined}
    />
  )
}

const OrderResult = React.memo(function OrderResult({
  orderResult,
  translate,
  onReuseGeography,
  onBack,
}: OrderResultProps) {
  const isSuccess = !!orderResult.success
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
  addRow(translate("notificationEmail"), orderResult.email)
  if (orderResult.code && !isSuccess)
    addRow(translate("errorCode"), orderResult.code)

  const titleText = isSuccess
    ? translate("orderConfirmation")
    : translate("orderSentError")

  const buttonText = isSuccess
    ? translate("reuseGeography")
    : translate("retry")

  const buttonHandler = isSuccess ? onReuseGeography || noOp : onBack || noOp

  const showDownloadLink = isSuccess && orderResult.downloadUrl
  const showMessage = isSuccess || orderResult.message
  const messageText = isSuccess
    ? translate("emailNotificationSent")
    : orderResult.message || translate("unknownErrorOccurred")

  return (
    <>
      <div css={styles.typography.title}>{titleText}</div>
      {rows}
      {showDownloadLink && (
        <div css={styles.typography.caption}>
          {translate("downloadReady")}:{" "}
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
      {showMessage && <div css={styles.typography.caption}>{messageText}</div>}
      <Button
        text={buttonText}
        onClick={buttonHandler}
        logging={{ enabled: true, prefix: "FME-Export" }}
        tooltip={isSuccess ? translate("tooltipReuseGeography") : undefined}
        tooltipPlacement="bottom"
      />
    </>
  )
})

// Dynamic field component for rendering various form fields based on configuration
const DynamicField = React.memo(function DynamicField({
  field,
  value,
  onChange,
  translate,
}: DynamicFieldProps) {
  const isMulti = field.type === FormFieldType.MULTI_SELECT
  const fieldValue = normalizeValue(value, isMulti)
  const placeholders = makePlaceholders(translate, field.label)

  switch (field.type) {
    case FormFieldType.SELECT:
    case FormFieldType.MULTI_SELECT:
      return (
        <Select
          value={toSelectValue(fieldValue, isMulti)}
          options={field.options || []}
          placeholder={placeholders.select}
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
          placeholder={placeholders.enter}
          onChange={(val) => {
            onChange(val)
          }}
          disabled={field.readOnly}
        />
      )
    case FormFieldType.NUMBER:
      return renderInput(
        "number",
        fieldValue,
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
      return renderInput(
        "password",
        fieldValue,
        placeholders.enter,
        onChange,
        field.readOnly
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
      return renderInput(
        "text",
        fieldValue,
        placeholders.enter,
        onChange,
        field.readOnly
      )
  }
})

// ExportForm component - handles dynamic form generation and submission
const ExportForm = React.memo(function ExportForm({
  workspaceParameters,
  workspaceName,
  workspaceItem,
  onBack,
  onSubmit,
  isSubmitting,
  translate,
}: ExportFormProps) {
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

  // Safer getter for form configuration
  const getFormConfig = hooks.useEventCallback(() =>
    parameterService.convertParametersToFields(workspaceParameters)
  )

  // Initialize form values from parameter defaults - using useState lazy initialization
  const [values, setValues] = React.useState<FormValues>(() =>
    initValues(getFormConfig())
  )
  const [isValid, setIsValid] = React.useState(true)
  const [errors, setErrors] = React.useState<{ [key: string]: string }>({})

  // Initialize form values in Redux store only once
  hooks.useEffectOnce(() => {
    syncForm(values)
  })

  // Validate form on mount
  hooks.useEffectOnce(() => {
    const fc = getFormConfig()
    const validation = parameterService.validateFormValues(values, fc)
    setIsValid(validation.isValid)
    setErrors(validation.errors)
  })

  // Validate form whenever values change
  hooks.useUpdateEffect(() => {
    const fc = getFormConfig()
    const validation = parameterService.validateFormValues(values, fc)
    setIsValid(validation.isValid)
    setErrors(validation.errors)
  }, [values, parameterService, workspaceParameters, getFormConfig])

  // Reset values when workspace or fields change (e.g., switching workspaces)
  hooks.useUpdateEffect(() => {
    const fc = getFormConfig()
    const nextValues = initValues(fc)
    setValues(nextValues)
    setErrors({})
    setFileMap({})
    syncForm(nextValues)
  }, [workspaceName, workspaceParameters, getFormConfig])

  const setField = hooks.useEventCallback(
    (field: string, value: FormPrimitive) => {
      if (value instanceof File) {
        // Handle file input specifically
        setFileMap((prev) => ({ ...prev, [field]: value }))
        const newValues = { ...values, [field]: value.name }
        setValues(newValues)
        syncForm(newValues)
        return
      } else if (value === null && field in fileMap) {
        // Handle file removal
        setFileMap((prev) => ({ ...prev, [field]: null }))
        const newValues = { ...values, [field]: "" }
        setValues(newValues)
        syncForm(newValues)
        return
      }

      // Handle all other form values
      const newValues = { ...values, [field]: value }
      setValues(newValues)
      syncForm(newValues)
    }
  )

  const handleSubmit = hooks.useEventCallback(() => {
    const fc = getFormConfig()
    const validation = parameterService.validateFormValues(values, fc)
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
    const merged: FormValues = { ...values }
    Object.keys(fileMap).forEach((k) => {
      const f = fileMap[k]
      if (f) merged[k] = f
    })
    onSubmit({ type: workspaceName, data: merged })
  })

  // Helper function to strip HTML tags from text safely
  const stripHtml = hooks.useEventCallback((html: string): string => {
    if (!html) return ""
    try {
      // Use DOMParser to safely parse HTML without executing scripts
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, "text/html")
      return doc.body.textContent || doc.body.innerText || ""
    } catch {
      // Fallback: return original text if parsing fails
      return html
    }
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
      {getFormConfig().map((field: DynamicFieldConfig) => (
        <Field
          key={field.name}
          label={field.label}
          required={field.required}
          error={stripLabelFromError(errors[field.name])}
        >
          <DynamicField
            field={field}
            value={values[field.name]}
            onChange={(val) => setField(field.name, val)}
            translate={translate}
          />
        </Field>
      ))}
    </Form>
  )
})

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
      // Build actions based on provided callbacks
      const actions: Array<{ label: string; onClick: () => void }> = []
      if (onRetry) {
        actions.push({ label: translate("retry"), onClick: onRetry })
      } else if (onBack) {
        actions.push({ label: translate("back"), onClick: onBack })
      }

      // Extract email from support text or config
      const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
      const tokenRegex = /\{\s*email\s*\}/i
      const configuredEmail = String(config?.supportEmail || "").trim()
      const configuredIsEmail = emailRegex.test(configuredEmail)

      const emailMatch = supportText?.match(emailRegex)
      const email = emailMatch?.[0]
        ? emailMatch[0]
        : tokenRegex.test(supportText || "") && configuredIsEmail
          ? configuredEmail
          : undefined

      // Compose the final message
      let composedMessage = message
      // If support text is provided, append it
      if (supportText && !email) {
        const supportHint = tokenRegex.test(supportText)
          ? translateRuntime("contactSupport")
          : supportText
        composedMessage = `${message} ${supportHint}`
      }

      return (
        <StateView
          state={makeErrorView(composedMessage, { code, actions })}
          renderActions={(act, ariaLabel) => {
            // Render actions with email link if available
            const actionsCount = act?.length ?? 0
            return (
              <div
                role="group"
                aria-label={ariaLabel}
                data-actions-count={actionsCount}
              >
                {email &&
                  (() => {
                    // Render email link with translation
                    const template = translateRuntime("contactSupportWithEmail")
                    const parts = template.split(tokenRegex)
                    const before = parts[0] || ""
                    const after = parts[1] || ""
                    return (
                      <div>
                        {before}
                        <a
                          href={`mailto:${email}`}
                          css={styles.typography.link}
                          aria-label={translateRuntime(
                            "contactSupportWithEmail",
                            { email }
                          )}
                        >
                          {email}
                        </a>
                        {after}
                      </div>
                    )
                  })()}
              </div>
            )
          }}
          center={false}
        />
      )
    }
  )

  // FME client - compute on demand via stable getter
  const getFmeClient = hooks.useEventCallback(() => {
    try {
      return config ? createFmeFlowClient(config) : null
    } catch (e) {
      console.warn("FME Export - invalid FME config; deferring client init", e)
      return null
    }
  })

  // Workspace selection state
  const [workspaces, setWorkspaces] = React.useState<readonly WorkspaceItem[]>(
    []
  )
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = React.useState(false)
  const [workspaceError, setWorkspaceError] = React.useState<string | null>(
    null
  )

  // Abort controller for workspace loading
  const loadAbortRef = React.useRef<AbortController | null>(null)
  // Timeout ref for scheduled workspace loading
  const loadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  // Track mount
  const isMountedRef = React.useRef(true)
  hooks.useEffectOnce(() => {
    return () => {
      isMountedRef.current = false
      // Cancel any pending workspace requests
      abortCurrentLoad(loadAbortRef)
      // Clear any pending scheduled load timeout
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }
  })

  // Load workspaces with race condition protection
  const loadWsList = hooks.useEventCallback(async () => {
    const fmeClient = getFmeClient()
    if (!fmeClient || !config?.repository) return

    // Cancel any existing request
    abortCurrentLoad(loadAbortRef)
    loadAbortRef.current = new AbortController()

    setIsLoadingWorkspaces(true)
    setWorkspaceError(null)

    try {
      const response: ApiResponse<RepositoryItems> = await makeCancelable(
        fmeClient.getRepositoryItems(
          config.repository,
          WORKSPACE_ITEM_TYPE,
          undefined,
          undefined,
          loadAbortRef.current.signal
        )
      )

      // Check if request was aborted
      if (loadAbortRef.current?.signal.aborted) return

      if (response.status === 200 && response.data.items) {
        const items = filterWorkspaces(response.data.items as readonly any[])
        const sorted = sortWorkspaces(items)
        if (isMountedRef.current) setWorkspaces(sorted)
      } else {
        throw new Error(translate("failedToLoadWorkspaces"))
      }
    } catch (err: unknown) {
      const errorMsg = formatApiError(
        err,
        isMountedRef,
        translate,
        "failedToLoadWorkspaces"
      )
      if (errorMsg) setWorkspaceError(errorMsg)
    } finally {
      if (isMountedRef.current) {
        setIsLoadingWorkspaces(false)
      }
      // Clear the abort controller reference
      loadAbortRef.current = null
    }
  })

  // Select workspace
  const loadWorkspace = hooks.useEventCallback(
    async (workspaceName: string) => {
      const fmeClient = getFmeClient()
      if (!fmeClient || !config?.repository) return
      // Cancel any existing request
      abortCurrentLoad(loadAbortRef)
      loadAbortRef.current = new AbortController()
      setIsLoadingWorkspaces(true)
      setWorkspaceError(null)
      try {
        const response: ApiResponse<any> = await makeCancelable(
          fmeClient.getWorkspaceItem(
            workspaceName,
            config.repository,
            loadAbortRef.current.signal
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
      } catch (err: unknown) {
        const errorMsg = formatApiError(
          err,
          isMountedRef,
          translate,
          "failedToLoadWorkspaceDetails"
        )
        if (errorMsg) setWorkspaceError(errorMsg)
      } finally {
        if (isMountedRef.current) setIsLoadingWorkspaces(false)
        // Clear the abort controller reference
        loadAbortRef.current = null
      }
    }
  )

  // Render workspace buttons
  const renderWsButtons = () =>
    workspaces.map((workspace) => (
      <Button
        key={workspace.name}
        text={workspace.title || workspace.name}
        icon={listIcon}
        role="listitem"
        alignText="end"
        onClick={() => {
          loadWorkspace(workspace.name)
        }}
        logging={{
          enabled: true,
          prefix: "FME-Export-WorkspaceSelection",
        }}
      />
    ))

  // Schedule a workspace load (debounced) to prevent rapid successive calls
  const scheduleWsLoad = hooks.useEventCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
    }
    loadTimeoutRef.current = setTimeout(() => {
      loadWsList()
      loadTimeoutRef.current = null
    }, DEBOUNCE_MS)
  })

  // Lazy load
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
        text={translate("cancel")}
        size="sm"
        aria-label={translate("cancel")}
        logging={{ enabled: true, prefix: "FME-Export-Header" }}
        block={false}
      />
    )
  }

  const renderInitial = () => {
    // Early returns for loading and error states
    if (isModulesLoading) {
      return renderLoading(undefined, translate("preparingMapTools"))
    }

    // Main content
    return (
      <div css={styles.centered}>
        {/* Drawing mode */}
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
    <div css={styles.typography.instruction}>{instructionText}</div>
  )

  const renderSelection = () => {
    // Loading
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

    // Error
    if (workspaceError) {
      return renderError(workspaceError, onBack || noOp, loadWsList)
    }

    // Empty
    if (!workspaces.length) {
      const actions = [
        { label: translate("retry"), onClick: loadWsList },
        { label: translate("back"), onClick: onBack || noOp },
      ]
      return (
        <StateView
          state={makeEmptyView(translate("noWorkspacesFound"), actions)}
        />
      )
    }

    // Content
    return (
      <div css={styles.button.default} role="list">
        {renderWsButtons()}
      </div>
    )
  }

  const renderForm = () => {
    // Guard clause for missing handlers
    if (!onFormBack || !onFormSubmit) {
      return renderError(
        translate("missingExportConfiguration"),
        onBack || noOp
      )
    }

    // Guard clause for missing workspace data
    if (!workspaceParameters || !selectedWorkspace) {
      return renderLoading(translate("loadingWorkspaceDetails"))
    }

    // Main export form
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
    // Startup validation
    if (state === ViewMode.STARTUP_VALIDATION) {
      // Show validation error if exists
      if (startupValidationError) {
        // Pass raw email so the error renderer can detect it and build an accessible mailto link.
        // If no email is configured, provide a generic support phrase.
        const fallbackSupport = config?.supportEmail
          ? String(config.supportEmail)
          : translateRuntime("contactSupport")
        return renderError(
          startupValidationError.message,
          undefined,
          onRetryValidation ||
            (() => {
              window.location.reload()
            }),
          startupValidationError.code,
          startupValidationError.userFriendlyMessage || fallbackSupport
        )
      }

      // Show loading state during validation
      const loadingMessage =
        startupValidationStep || translate("validatingStartup")
      return <StateView state={makeLoadingView(loadingMessage)} />
    }

    // Order result
    if (state === ViewMode.ORDER_RESULT && orderResult) {
      // Guard clause for missing order result
      return (
        <OrderResult
          orderResult={orderResult}
          translate={translate}
          onReuseGeography={onReuseGeography}
          onBack={onBack}
        />
      )
    }

    // Submission loading
    if (isSubmittingOrder) {
      return renderLoading(translate("submittingOrder"))
    }

    // General error
    if (error) {
      if (error.severity !== "info") {
        return renderError(
          error.message,
          undefined,
          onBack || noOp,
          error.code,
          error.userFriendlyMessage
        )
      }
      return renderError(
        error.message,
        undefined,
        undefined,
        error.code,
        error.userFriendlyMessage
      )
    }

    switch (state) {
      case ViewMode.INITIAL:
        return renderInitial()
      case ViewMode.DRAWING:
        // If drawing is not allowed, show error
        if (isDrawing && (clickCount || 0) === 0) {
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
        // This case is handled above
        return renderError(translate("orderResultMissing"), onBack || noOp)
    }
    // Unexpected state
    try {
      // Log unexpected state to console for debugging
      console.warn("FME Export - Unexpected view state:", state)
    } catch {
      /* no-op */
    }
    return renderError(translate("unknownErrorOccurred"), onBack || noOp)
  }

  return (
    <div css={styles.parent}>
      <div css={styles.header}>{showHeaderActions ? renderHeader() : null}</div>
      <div css={styles.content}>{renderCurrent()}</div>
    </div>
  )
}

export default Workflow
