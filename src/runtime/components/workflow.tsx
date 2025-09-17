/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, getAppStore, jsx } from "jimu-core"
import {
  Button,
  StateView,
  Form,
  Field,
  ButtonTabs,
  useStyles,
  renderSupportHint,
  DateTimePickerWrapper,
  Input,
  TextArea,
  UrlInput,
} from "./ui"
import { DynamicField } from "./fields"
import defaultMessages from "./translations/default"
import {
  type WorkflowProps,
  type WorkspaceItem,
  type FormPrimitive,
  type FormValues,
  type OrderResultProps,
  type ExportFormProps,
  type DynamicFieldConfig,
  type ApiResponse,
  ViewMode,
  DrawingTool,
  FormFieldType,
  makeLoadingView,
  makeEmptyView,
  ErrorType,
  makeErrorView,
} from "../../config"
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
  maskEmailForDisplay,
  stripHtmlToText,
} from "../../shared/utils"

// Constants
const MS_LOADING = 500
const WORKSPACE_ITEM_TYPE = "WORKSPACE"

const ERROR_NAMES = {
  CANCELLED_PROMISE: "CancelledPromiseError",
  ABORT: "AbortError",
} as const

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

// Utility functions
const canResetButton = (
  onReset: (() => void) | undefined,
  canResetFlag: boolean,
  state: ViewMode,
  drawnArea: number,
  isDrawing?: boolean,
  clickCount?: number
): boolean => {
  if (!onReset || !canResetFlag || state === ViewMode.ORDER_RESULT) {
    return false
  }

  if (state === ViewMode.DRAWING) {
    // During drawing, enable if at least one click has been made
    return !(isDrawing && (clickCount ?? 0) === 0)
  }
  // In other states, enable if there is a drawn area and not in initial state
  return drawnArea > 0 && state !== ViewMode.INITIAL
}

const shouldShowWorkspaceLoading = (
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

const initFormValues = (
  formConfig: readonly DynamicFieldConfig[]
): FormValues => {
  const result: FormValues = {}
  for (const field of formConfig) {
    if (field.defaultValue !== undefined) {
      result[field.name] = field.defaultValue
    } else if (field.type === FormFieldType.MULTI_SELECT) {
      result[field.name] = []
    }
  }
  return result
}

const stripErrorLabel = (errorText?: string): string | undefined => {
  const t = (errorText ?? "").replace(/<[^>]*>/g, "").trim()
  if (!t) return undefined

  const colonIdx = t.indexOf(":")
  if (colonIdx > -1) return t.slice(colonIdx + 1).trim()

  const isIdx = t.toLowerCase().indexOf(" is ")
  if (isIdx > -1) return t.slice(isIdx + 4).trim()
  return t
}

// Form validation helpers
const createFormValidator = (
  parameterService: ParameterFormService,
  workspaceParameters: readonly any[]
) => {
  const getFormConfig = () =>
    parameterService.convertParametersToFields(workspaceParameters)

  const validateValues = (values: FormValues) => {
    // First validate the workspace parameters
    const baseValidation = parameterService.validateFormValues(
      values,
      getFormConfig()
    )

    // Add custom validation for schedule fields
    const errors = { ...baseValidation.errors }

    // Optional schedule start field: validate format only when provided
    const startRaw = values.start as unknown
    if (typeof startRaw === "string" && startRaw.trim() !== "") {
      const startTrimmed = startRaw.trim()
      const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      if (!dateTimeRegex.test(startTrimmed)) {
        // Use a translation key so UI can localize
        errors.start = "invalidDateTimeFormat"
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    }
  }

  const initializeValues = () => initFormValues(getFormConfig())
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

// Workspace loader hook
const useWorkspaceLoader = (opts: {
  config: any
  getFmeClient: () => ReturnType<typeof createFmeFlowClient> | null
  translate: (k: string) => string
  makeCancelable: ReturnType<typeof hooks.useCancelablePromiseMaker>
  widgetId: string
  onWorkspaceSelected?: (
    workspaceName: string,
    params: readonly any[],
    item: any
  ) => void
}) => {
  const {
    config,
    getFmeClient,
    translate,
    makeCancelable,
    widgetId,
    onWorkspaceSelected,
  } = opts
  const [workspaces, setWorkspaces] = React.useState<readonly WorkspaceItem[]>(
    []
  )
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadAbortRef = React.useRef<AbortController | null>(null)
  const loadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const isMountedRef = React.useRef(true)

  // Cleanup on unmount
  hooks.useEffectOnce(() => {
    return () => {
      isMountedRef.current = false
      if (loadAbortRef.current) {
        loadAbortRef.current.abort()
        loadAbortRef.current = null
      }
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }
  })

  // Error formatting
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

      // Do not surface raw error messages to end users; return a localized base message only
      // Use resolveMessageOrKey if baseKey is already a message key
      try {
        const localized = resolveMessageOrKey(baseKey, translate)
        return localized
      } catch {
        return translate(baseKey)
      }
    }
  )

  const cancelCurrent = React.useCallback(() => {
    if (loadAbortRef.current) {
      loadAbortRef.current.abort()
      loadAbortRef.current = null
    }
  }, [])

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
        const items = (response.data.items as readonly any[]).filter(
          (i: any) => i.type === WORKSPACE_ITEM_TYPE
        ) as readonly WorkspaceItem[]

        // Scope to repository if specified in config
        const repoName = String(config.repository)
        const scoped = items.filter((i: any) => {
          const r = i?.repository
          return r === undefined || r === repoName
        })

        const sorted = scoped.slice().sort((a, b) =>
          (a.title || a.name).localeCompare(b.title || b.name, undefined, {
            sensitivity: "base",
          })
        )

        if (isMountedRef.current) {
          setWorkspaces(sorted)
          // Dispatch workspace items with repository context to store
          const dispatch = getAppStore().dispatch as any
          dispatch(fmeActions.setWorkspaceItems(sorted, repoName, widgetId))
        }
      } else {
        throw new Error(translate("failedToLoadWorkspaces"))
      }
    } catch (err) {
      const msg = formatError(err, "failedToLoadWorkspaces")
      if (msg && isMountedRef.current) setError(msg)
    } finally {
      if (isMountedRef.current) setIsLoading(false)
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
      }
    }
  })

  const loadItem = hooks.useEventCallback(
    async (workspaceName: string, repositoryName?: string) => {
      const fmeClient = getFmeClient()
      if (!fmeClient || !(repositoryName || config?.repository)) return

      cancelCurrent()
      const controller = new AbortController()
      loadAbortRef.current = controller
      setIsLoading(true)
      setError(null)

      try {
        const repoToUse = String(repositoryName || config?.repository || "")
        const response: ApiResponse<any> = await makeCancelable(
          fmeClient.getWorkspaceItem(
            workspaceName,
            repoToUse,
            controller.signal
          )
        )

        if (response.status === 200 && response.data?.parameters) {
          onWorkspaceSelected?.(
            workspaceName,
            response.data.parameters,
            response.data
          )
          // Dispatch workspace item and parameters with repository context
          const dispatch = getAppStore().dispatch as any
          const repoName = String(repoToUse)
          dispatch(
            fmeActions.setWorkspaceItem(response.data, repoName, widgetId)
          )
          dispatch(
            fmeActions.setWorkspaceParameters(
              response.data.parameters,
              workspaceName,
              repoName,
              widgetId
            )
          )
        } else {
          throw new Error(translate("failedToLoadWorkspaceDetails"))
        }
      } catch (err) {
        const msg = formatError(err, "failedToLoadWorkspaceDetails")
        if (msg && isMountedRef.current) setError(msg)
      } finally {
        if (isMountedRef.current) setIsLoading(false)
        if (loadAbortRef.current === controller) {
          loadAbortRef.current = null
        }
      }
    }
  )

  // Clear local workspaces immediately when repository changes to prevent stale selections
  hooks.useUpdateEffect(() => {
    if (!isMountedRef.current) return
    cancelCurrent()
    setWorkspaces([])
    setError(null)
  }, [config?.repository])

  const scheduleLoad = hooks.useEventCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
    }
    loadTimeoutRef.current = setTimeout(() => {
      void loadAll()
      loadTimeoutRef.current = null
    }, MS_LOADING)
  })

  return { workspaces, isLoading, error, loadAll, loadItem, scheduleLoad }
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
    const emailVal = orderResult.email
    const masked =
      config?.maskEmailOnSuccess && isSuccess
        ? maskEmailForDisplay(emailVal)
        : emailVal
    addRow(translate("notificationEmail"), masked)
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

// ExportForm component: dynamic form generation and submission
const ExportForm: React.FC<ExportFormProps & { widgetId: string }> = ({
  workspaceParameters,
  workspaceName,
  workspaceItem,
  onBack,
  onSubmit,
  isSubmitting,
  translate,
  widgetId,
  config,
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
  const syncFormToStore = hooks.useEventCallback((values: FormValues) => {
    const dispatch = getAppStore().dispatch as any
    dispatch(fmeActions.setFormValues(values, widgetId))
  })
  const formState = useFormStateManager(validator, syncFormToStore)

  // Initialize form values in Redux store only once
  hooks.useEffectOnce(() => {
    syncFormToStore(formState.values)
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
      const dispatch = getAppStore().dispatch as any
      dispatch(fmeActions.setError(error, widgetId))
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

  // Helper function to strip HTML tags from text safely (reuse shared util)
  const stripHtml = hooks.useEventCallback((html: string): string =>
    stripHtmlToText(html)
  )

  const resolveError = hooks.useEventCallback((err?: string) => {
    const keyOrMsg = stripErrorLabel(err)
    return keyOrMsg ? resolveMessageOrKey(keyOrMsg, translate) : undefined
  })

  // Helpers to convert between UI ISO local (YYYY-MM-DDTHH:mm[:ss]) and stored schedule string (YYYY-MM-DD HH:mm:ss)
  const toIsoLocal = hooks.useEventCallback(
    (spaceDateTime: string | undefined): string => {
      const s = (spaceDateTime || "").trim()
      if (!s) return ""
      // Ensure seconds exist; incoming format expected "YYYY-MM-DD HH:mm[:ss]"
      const parts = s.split(" ")
      if (parts.length !== 2) return ""
      const [d, t] = parts
      const tParts = t.split(":")
      const hh = tParts[0] || "00"
      const mm = tParts[1] || "00"
      const ss = tParts[2] || "00"
      return `${d}T${hh}:${mm}:${ss}`
    }
  )

  const toSpaceDateTime = hooks.useEventCallback(
    (isoLocal: string | undefined): string => {
      const s = (isoLocal || "").trim()
      if (!s) return ""
      const parts = s.split("T")
      if (parts.length !== 2) return ""
      const [d, t] = parts
      const tParts = t.split(":")
      const hh = tParts[0] || "00"
      const mm = tParts[1] || "00"
      const ss = tParts[2] || "00"
      return `${d} ${hh}:${mm}:${ss}`
    }
  )

  return (
    <Form
      variant="layout"
      title={workspaceItem?.title || workspaceName}
      subtitle={
        workspaceItem?.description
          ? stripHtml(workspaceItem.description)
          : translate("configureWorkspaceParameters")
      }
      onBack={onBack}
      onSubmit={handleSubmit}
      isValid={formState.isValid}
      loading={isSubmitting}
    >
      {/* Optional schedule start field */}
      {config?.allowScheduleMode && (
        <Field
          label={translate("scheduleStartLabel")}
          required={false}
          error={resolveError(formState.errors.start)}
          helper={translate("emailNotificationSent")}
        >
          <DateTimePickerWrapper
            value={toIsoLocal(formState.values.start as string | undefined)}
            onChange={(iso) => {
              const spaceVal = toSpaceDateTime(iso)
              setField("start", spaceVal)
            }}
          />
        </Field>
      )}

      {/* Optional schedule metadata fields when schedule mode is allowed */}
      {config?.allowScheduleMode && (
        <>
          <Field label={translate("scheduleNameLabel")} required={false}>
            <Input
              value={(formState.values.name as string) || ""}
              onChange={(val: string) =>
                setField(
                  "name",
                  (typeof val === "string" ? val : "").slice(0, 200)
                )
              }
              placeholder={translate("scheduleNamePlaceholder")}
            />
          </Field>
          <Field label={translate("scheduleCategoryLabel")} required={false}>
            <Input
              value={(formState.values.category as string) || ""}
              onChange={(val: string) =>
                setField(
                  "category",
                  (typeof val === "string" ? val : "").slice(0, 200)
                )
              }
              placeholder={translate("scheduleCategoryPlaceholder")}
            />
          </Field>
          <Field label={translate("scheduleDescriptionLabel")} required={false}>
            <TextArea
              value={(formState.values.description as string) || ""}
              onChange={(val) =>
                setField("description", (val || "").slice(0, 1000))
              }
            />
          </Field>
        </>
      )}

      {/* Direct upload field - replaces remote dataset URL */}
      {config?.allowRemoteDataset && (
        <Field
          label={translate("remoteDatasetUploadLabel")}
          helper={translate("remoteDatasetUploadHelper")}
        >
          <DynamicField
            field={{
              name: "__upload_file__",
              label: translate("remoteDatasetUploadLabel"),
              type: FormFieldType.FILE,
              required: false,
              readOnly: false,
            }}
            value={formState.values.__upload_file__}
            onChange={(val) => setField("__upload_file__", val)}
            translate={translate}
          />
        </Field>
      )}

      {/* Remote dataset URL (opt_geturl) */}
      {config?.allowRemoteUrlDataset && (
        <Field
          label={translate("remoteDatasetUrlLabel")}
          helper={translate("remoteDatasetUrlHelper")}
        >
          <UrlInput
            value={(formState.values.__remote_dataset_url__ as string) || ""}
            onChange={(val) => setField("__remote_dataset_url__", val)}
          />
        </Field>
      )}

      {/* Workspace parameters */}
      {validator
        .getFormConfig()
        .map((field: DynamicFieldConfig) => {
          // Add defensive check to ensure field is valid
          if (!field || !field.name || !field.type) {
            return null
          }
          return (
            <Field
              key={field.name}
              label={field.label}
              required={field.required}
              error={resolveError(formState.errors[field.name])}
            >
              <DynamicField
                field={field}
                value={formState.values[field.name]}
                onChange={(val) => setField(field.name, val)}
                translate={translate}
              />
            </Field>
          )
        })
        .filter(Boolean)}
    </Form>
  )
}

// Main Workflow component
export const Workflow: React.FC<WorkflowProps> = ({
  widgetId,
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
      const hintText = buildSupportHintText(translate, rawEmail, supportText)

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
              {renderSupportHint(rawEmail, translate, styles, hintText)}
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
  } = useWorkspaceLoader({
    config,
    getFmeClient,
    translate,
    makeCancelable,
    widgetId: widgetId || "",
    onWorkspaceSelected,
  })

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
          const repoForItem =
            (workspace as any)?.repository || config?.repository
          loadWorkspace(workspace.name, repoForItem)
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

  // Clear workspace state when repository changes
  hooks.useUpdateEffect(() => {
    if (config?.repository) {
      const dispatch = getAppStore().dispatch as any
      dispatch(
        fmeActions.clearWorkspaceState(config.repository, widgetId || "")
      )
      // Force reload of workspaces for new repository
      if (
        state === ViewMode.WORKSPACE_SELECTION ||
        state === ViewMode.EXPORT_OPTIONS
      ) {
        scheduleWsLoad()
      }
    }
  }, [config?.repository])

  // Header
  const renderHeader = () => {
    const resetEnabled = canResetButton(
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
        aria-label={translate("tooltipCancel")}
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
          aria-label={translate("drawingModeTooltip")}
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
    const shouldShowLoading = shouldShowWorkspaceLoading(
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
        widgetId={widgetId || ""}
        workspaceParameters={workspaceParameters}
        workspaceName={selectedWorkspace}
        workspaceItem={workspaceItem}
        onBack={onFormBack}
        onSubmit={onFormSubmit}
        isSubmitting={isSubmittingOrder}
        translate={translate}
        config={config}
      />
    )
  }

  const renderCurrent = () => {
    if (state === ViewMode.STARTUP_VALIDATION) {
      if (startupValidationError) {
        const supportHint = config?.supportEmail || ""
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
                aria-label={translate("drawingModeTooltip")}
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
