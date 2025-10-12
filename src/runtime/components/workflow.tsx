/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, ReactRedux, jsx } from "jimu-core"
import {
  Button,
  ButtonGroup,
  StateView,
  Form,
  Field,
  ButtonTabs,
  Alert,
  renderSupportHint,
  ScheduleFields,
  UrlInput,
} from "./ui"
import { DynamicField } from "./fields"
import defaultMessages from "./translations/default"
import {
  type WorkflowProps,
  type WorkspaceItem,
  type WorkspaceParameter,
  type FormPrimitive,
  type FormValues,
  type OrderResultProps,
  type ExportFormProps,
  type DynamicFieldConfig,
  type LoadingState,
  type ServiceMode,
  ViewMode,
  DrawingTool,
  FormFieldType,
  ParameterType,
  makeLoadingView,
  makeEmptyView,
  ErrorType,
  type ErrorState,
  ErrorSeverity,
  makeErrorView,
  MS_LOADING,
  WORKSPACE_ITEM_TYPE,
  useUiStyles,
} from "../../config/index"
import polygonIcon from "../../assets/icons/polygon.svg"
import rectangleIcon from "../../assets/icons/rectangle.svg"
import itemIcon from "../../assets/icons/item.svg"
import { fmeActions } from "../../extensions/store"
import { ParameterFormService } from "../../shared/services"
import {
  validateDateTimeFormat,
  validateScheduleDateTime,
} from "../../shared/validations"
import {
  resolveMessageOrKey,
  buildSupportHintText,
  maskEmailForDisplay,
  stripHtmlToText,
  getSupportEmail,
  stripErrorLabel,
  initFormValues,
  canResetButton,
  shouldShowWorkspaceLoading,
  toTrimmedString,
  buildLargeAreaWarningMessage,
  formatByteSize,
  isAbortError,
} from "../../shared/utils"
import {
  useFormStateManager,
  useDebounce,
  useWorkspaces,
  useWorkspaceItem,
} from "../../shared/hooks"

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

const EMPTY_WORKSPACES: readonly WorkspaceItem[] = Object.freeze([])

const DEFAULT_LOADING_STATE: LoadingState = Object.freeze({
  modules: false,
  submission: false,
  workspaces: false,
  parameters: false,
})

const cloneLoadingState = (state: LoadingState): LoadingState => ({
  modules: Boolean(state.modules),
  submission: Boolean(state.submission),
  workspaces: Boolean(state.workspaces),
  parameters: Boolean(state.parameters),
})

const loadingStatesEqual = (a: LoadingState, b: LoadingState): boolean =>
  a.modules === b.modules &&
  a.submission === b.submission &&
  a.workspaces === b.workspaces &&
  a.parameters === b.parameters

const isLoadingActive = (state: LoadingState): boolean =>
  Boolean(
    state.modules || state.submission || state.workspaces || state.parameters
  )

// Helper: Check if value is non-empty string
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== ""

// Helper: Format order-related values for captions
const formatOrderValue = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : null
  }
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? value.toISOString() : null
  }
  if (value instanceof Blob) {
    return value.type ? value.type : "blob"
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

// Helper: Manage download URL, supporting either remote URL or Blob object
const useDownloadResource = (
  remoteUrl?: string | null,
  blob?: Blob | null
): string | null => {
  const [resourceUrl, setResourceUrl] = React.useState<string | null>(null)
  const objectUrlRef = React.useRef<string | null>(null)

  hooks.useEffectWithPreviousValues(() => {
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current)
      } catch {
        /* ignore revoke errors */
      }
      objectUrlRef.current = null
    }

    const trimmedUrl = typeof remoteUrl === "string" ? remoteUrl.trim() : ""
    if (trimmedUrl) {
      setResourceUrl(trimmedUrl)
      return
    }

    if (blob instanceof Blob) {
      try {
        const objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl
        setResourceUrl(objectUrl)
        return
      } catch {
        setResourceUrl(null)
        return
      }
    }

    setResourceUrl(null)
  }, [remoteUrl, blob])

  hooks.useUnmount(() => {
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current)
      } catch {
        /* ignore revoke errors */
      }
      objectUrlRef.current = null
    }
  })

  return resourceUrl
}

// Helper: Safely stringify geometry object
const safeStringifyGeometry = (geometry: unknown): string => {
  if (!geometry) return ""
  try {
    return JSON.stringify(geometry)
  } catch {
    return ""
  }
}

// Helper: Extract unique geometry field names from workspace parameters
const extractGeometryFieldNames = (
  workspaceParameters?: readonly WorkspaceParameter[]
): string[] => {
  if (!workspaceParameters?.length) return []

  const names: string[] = []
  const seen = new Set<string>()

  for (const param of workspaceParameters) {
    if (!param || param.type !== ParameterType.GEOMETRY) continue
    if (typeof param.name !== "string") continue

    const trimmed = param.name.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      names.push(trimmed)
    }
  }

  return names
}

// Form validation: validate workspace parameters and schedule fields
const createFormValidator = (
  parameterService: ParameterFormService,
  workspaceParameters: readonly WorkspaceParameter[]
) => {
  const getFormConfig = () =>
    parameterService.convertParametersToFields(workspaceParameters)

  const validateValues = (values: FormValues) => {
    const baseValidation = parameterService.validateFormValues(
      values,
      getFormConfig()
    )
    const errors = { ...baseValidation.errors }

    // Validate schedule start field format when provided
    const startRaw = values.start
    if (
      isNonEmptyString(startRaw) &&
      !validateDateTimeFormat(startRaw.trim())
    ) {
      errors.start = "invalidDateTimeFormat"
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    }
  }

  const initializeValues = () => initFormValues(getFormConfig())
  return { getFormConfig, validateValues, initializeValues }
}

// OrderResult component: displays job submission results
const OrderResult: React.FC<OrderResultProps> = ({
  orderResult,
  translate,
  onReuseGeography,
  onBack,
  onReset,
  config,
}) => {
  const styles = useUiStyles()
  const isSuccess = !!orderResult.success
  const fallbackMode: ServiceMode = config?.syncMode ? "sync" : "async"
  const serviceMode: ServiceMode =
    orderResult.serviceMode === "sync" ||
    orderResult.serviceMode === "async" ||
    orderResult.serviceMode === "schedule"
      ? orderResult.serviceMode
      : fallbackMode
  const downloadUrl = useDownloadResource(
    orderResult.downloadUrl,
    orderResult.blob
  )

  const infoRows: React.ReactNode[] = []
  const addInfoRow = (label?: string, value?: unknown) => {
    const display = formatOrderValue(value)
    if (!display) return

    const key = label
      ? `order-row-${label}-${infoRows.length}`
      : `order-row-${infoRows.length}`
    const text = label ? `${label}: ${display}` : display

    infoRows.push(
      <div css={styles.typo.caption} key={key}>
        {text}
      </div>
    )
  }

  addInfoRow(translate("jobId"), orderResult.jobId)
  addInfoRow(translate("workspace"), orderResult.workspaceName)

  const deliveryModeKey =
    serviceMode === "schedule"
      ? "deliveryModeSchedule"
      : serviceMode === "async"
        ? "deliveryModeAsync"
        : "deliveryModeSync"
  addInfoRow(translate("deliveryMode"), translate(deliveryModeKey))

  if (orderResult.downloadFilename) {
    addInfoRow(translate("downloadFilename"), orderResult.downloadFilename)
  }

  const statusValue = toTrimmedString(orderResult.status)
  if (statusValue) {
    addInfoRow(translate("flowStatus"), statusValue)
  }

  const statusMessage = toTrimmedString(orderResult.statusMessage)
  if (statusMessage && statusMessage !== toTrimmedString(orderResult.message)) {
    addInfoRow(translate("flowMessage"), statusMessage)
  }

  const blobType = toTrimmedString(orderResult.blobMetadata?.type)
  if (blobType) {
    addInfoRow(translate("blobType"), blobType)
  }

  const blobSizeFormatted = formatByteSize(orderResult.blobMetadata?.size)
  if (blobSizeFormatted) {
    addInfoRow(translate("blobSize"), blobSizeFormatted)
  }

  if (serviceMode !== "sync") {
    const emailVal = orderResult.email
    const masked =
      config?.maskEmailOnSuccess && isSuccess
        ? maskEmailForDisplay(emailVal)
        : emailVal
    addInfoRow(translate("notificationEmail"), masked)
  }

  if (orderResult.code && !isSuccess) {
    addInfoRow(translate("errorCode"), orderResult.code)
  }

  // Display schedule metadata if present
  const scheduleMetadata = orderResult.scheduleMetadata
  const hasScheduleInfo =
    scheduleMetadata &&
    scheduleMetadata.start &&
    scheduleMetadata.name &&
    scheduleMetadata.category

  const titleText = isSuccess
    ? serviceMode === "sync"
      ? translate("orderComplete")
      : translate("orderConfirmation")
    : translate("orderSentError")

  const buttonText = isSuccess
    ? translate("reuseGeography")
    : translate("actionRetry")

  const primaryTooltip = isSuccess
    ? translate("tooltipReuseGeography")
    : undefined

  const handlePrimary = hooks.useEventCallback(() => {
    if (isSuccess) {
      onReuseGeography?.()
      return
    }
    onBack?.()
  })

  const handleEnd = hooks.useEventCallback(() => {
    if (onReset) {
      onReset()
      return
    }
    onBack?.()
  })

  const showDownloadLink = isSuccess && Boolean(downloadUrl)

  let messageText: string | null = null
  if (isSuccess) {
    if (serviceMode === "async") {
      messageText = translate("emailNotificationSent")
    }
  } else {
    const failureCode = (orderResult.code || "").toString().toUpperCase()
    const rawMessage =
      toTrimmedString(orderResult.message) ||
      toTrimmedString(orderResult.statusMessage) ||
      ""

    if (
      failureCode === "FME_JOB_FAILURE" ||
      /FME\s*Flow\s*transformation\s*failed/i.test(rawMessage)
    ) {
      messageText = translate("fmeFlowTransformationFailed")
    } else if (rawMessage) {
      messageText = rawMessage
    } else {
      messageText = translate("errorUnknown")
    }
  }

  let scheduleSection: React.ReactNode = null
  if (hasScheduleInfo && isSuccess && scheduleMetadata) {
    const validation = validateScheduleDateTime(scheduleMetadata.start || "")
    const scheduleWarning = validation.isPast ? (
      <Alert
        type="warning"
        text={translate("schedulePastTimeWarning")}
        variant="default"
        withIcon={true}
      />
    ) : null

    scheduleSection = (
      <>
        <div css={styles.typo.caption}>
          {translate("scheduleJobName")}: {scheduleMetadata.name}
        </div>
        <div css={styles.typo.caption}>
          {translate("scheduleJobCategory")}: {scheduleMetadata.category}
        </div>
        <div css={styles.typo.caption}>
          {translate("scheduleStartTime")}: {scheduleMetadata.start}
        </div>
        {scheduleMetadata.trigger ? (
          <div css={styles.typo.caption}>
            {translate("scheduleTrigger")}: {scheduleMetadata.trigger}
          </div>
        ) : null}
        {scheduleMetadata.description ? (
          <div css={styles.typo.caption}>
            {translate("scheduleJobDescription")}:{" "}
            {scheduleMetadata.description}
          </div>
        ) : null}
        {scheduleWarning}
      </>
    )
  }

  return (
    <div css={styles.form.layout}>
      <div css={styles.form.content}>
        <div css={styles.form.body}>
          <div css={styles.typo.title}>{titleText}</div>
          {infoRows}
          {scheduleSection}

          {showDownloadLink && (
            <div css={styles.typo.caption}>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                css={styles.typo.link}
                download={orderResult.downloadFilename}
              >
                {translate("clickToDownload")}
              </a>
            </div>
          )}
          {messageText ? (
            <div css={styles.typo.caption}>{messageText}</div>
          ) : null}
        </div>
        <div css={styles.form.footer}>
          <ButtonGroup
            secondaryButton={{
              text: translate("actionEnd"),
              onClick: handleEnd,
              tooltip: translate("tooltipCancel"),
              tooltipPlacement: "bottom",
              logging: { enabled: true, prefix: "FME-Export" },
            }}
            primaryButton={{
              text: buttonText,
              onClick: handlePrimary,
              type: "primary",
              tooltip: primaryTooltip,
              tooltipPlacement: "bottom",
              logging: { enabled: true, prefix: "FME-Export" },
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ExportForm component: dynamic form generation and submission
const ExportForm: React.FC<
  ExportFormProps & { widgetId: string; geometryJson?: unknown }
> = ({
  workspaceParameters,
  workspaceName,
  workspaceItem,
  onBack,
  onSubmit,
  isSubmitting,
  translate,
  widgetId,
  config,
  geometryJson,
}) => {
  const reduxDispatch = ReactRedux.useDispatch()
  const [parameterService] = React.useState(() => new ParameterFormService())
  const [fileMap, setFileMap] = React.useState<{
    [key: string]: File | null
  }>({})

  const geometryJsonFromStore = geometryJson ?? null

  const [geometryString, setGeometryString] = React.useState<string>(() =>
    safeStringifyGeometry(geometryJsonFromStore)
  )

  hooks.useEffectWithPreviousValues(() => {
    const next = safeStringifyGeometry(geometryJson ?? null)
    setGeometryString((prev) => (prev === next ? prev : next))
  }, [geometryJson])

  const [geometryFieldNames, setGeometryFieldNames] = React.useState<string[]>(
    () => extractGeometryFieldNames(workspaceParameters)
  )

  hooks.useEffectWithPreviousValues(() => {
    const next = extractGeometryFieldNames(workspaceParameters)
    setGeometryFieldNames((prev) => {
      if (
        prev.length === next.length &&
        prev.every((value, index) => value === next[index])
      ) {
        return prev
      }
      return next
    })
  }, [workspaceParameters])

  // Local validation message builder using current translate
  const errorMsg = hooks.useEventCallback((count: number): string =>
    count === 1
      ? translate("formValidationSingleError")
      : translate("formValidationMultipleErrors")
  )

  // Create validator with current parameters
  const validator = createFormValidator(parameterService, workspaceParameters)

  // Use form state manager hook
  const formState = useFormStateManager(validator)

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
    (field: string, value: FormPrimitive | File | null) => {
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

  const formValues = formState.values
  const setFormValues = formState.setValues

  hooks.useEffectWithPreviousValues(() => {
    if (!geometryFieldNames.length) return
    const nextValue = geometryString || ""
    const shouldUpdate = geometryFieldNames.some((name) => {
      const current = formValues?.[name]
      const currentStr = typeof current === "string" ? current : ""
      return currentStr !== nextValue
    })
    if (!shouldUpdate) return

    const updated = { ...formValues }
    geometryFieldNames.forEach((name) => {
      updated[name] = nextValue
    })
    setFormValues(updated)
  }, [geometryFieldNames, geometryString, formValues, setFormValues])

  const handleSubmit = hooks.useEventCallback(() => {
    const validation = formState.validateForm()
    if (!validation.isValid) {
      const count = Object.keys(validation.errors).length
      const errorMessage = errorMsg(count)
      const error: ErrorState = {
        message: errorMessage,
        type: ErrorType.VALIDATION,
        code: "FORM_INVALID",
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestamp: new Date(),
        timestampMs: Date.now(),
        kind: "runtime",
      }
      // Dispatch error to the store
      reduxDispatch(fmeActions.setError("general", error, widgetId))
      return
    }
    // Merge file inputs with other values
    const merged: { [key: string]: unknown } = { ...formState.values }
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
      {/* Schedule fields component */}
      {config?.allowScheduleMode && (
        <ScheduleFields
          values={formState.values}
          onChange={setField}
          translate={translate}
          disabled={isSubmitting}
        />
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
          const isInlineField =
            field.type === FormFieldType.SWITCH ||
            field.type === FormFieldType.CHECKBOX
          return (
            <Field
              key={field.name}
              label={field.label}
              required={field.required}
              error={resolveError(formState.errors[field.name])}
              check={isInlineField}
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
  loadingState: loadingStateProp,
  canStartDrawing,
  error,
  onFormBack,
  onFormSubmit,
  orderResult,
  onReuseGeography,
  onBack,
  drawnArea,
  areaWarning,
  formatArea,
  // Header actions
  showHeaderActions,
  // Drawing mode
  drawingMode = DrawingTool.POLYGON,
  onDrawingModeChange,
  // Drawing progress
  isDrawing,
  clickCount,
  isCompleting,
  // Reset
  onReset,
  canReset: canResetProp = true,
  // Workspace props
  config,
  onWorkspaceSelected,
  selectedWorkspace,
  workspaceItems: workspaceItemsProp,
  workspaceParameters,
  workspaceItem,
  isPrefetchingWorkspaces = false,
  workspacePrefetchProgress,
  workspacePrefetchStatus,
  geometryJson,
  // Workspace collection now arrives from the parent widget via props
  // Startup validation props
  isStartupValidating: _isStartupValidating,
  startupValidationStep,
  startupValidationError,
  onRetryValidation,
  submissionPhase = "idle",
  modeNotice,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useUiStyles()
  const reduxDispatch = ReactRedux.useDispatch()
  // Ensure a non-empty widgetId for internal Redux interactions
  const effectiveWidgetId = widgetId && widgetId.trim() ? widgetId : "__local__"

  const incomingLoadingState = loadingStateProp ?? DEFAULT_LOADING_STATE
  const [latchedLoadingState, setLatchedLoadingState] =
    React.useState<LoadingState>(() => cloneLoadingState(incomingLoadingState))
  const latchedLoadingRef = hooks.useLatest(latchedLoadingState)
  const releaseLoadingState = useDebounce((next: LoadingState) => {
    setLatchedLoadingState(cloneLoadingState(next))
  }, MS_LOADING)

  hooks.useEffectWithPreviousValues(() => {
    const current = latchedLoadingRef.current
    const incoming = incomingLoadingState

    if (isLoadingActive(incoming)) {
      releaseLoadingState.cancel()
      if (!loadingStatesEqual(current, incoming)) {
        setLatchedLoadingState(cloneLoadingState(incoming))
      }
      return
    }

    if (isLoadingActive(current)) {
      releaseLoadingState(incoming)
      return
    }

    if (!loadingStatesEqual(current, incoming)) {
      setLatchedLoadingState(cloneLoadingState(incoming))
    }
  }, [
    incomingLoadingState.modules,
    incomingLoadingState.parameters,
    incomingLoadingState.workspaces,
    incomingLoadingState.submission,
    releaseLoadingState,
  ])

  const loadingState = latchedLoadingState
  const isModulesLoading = Boolean(loadingState.modules)
  const isSubmittingOrder = Boolean(loadingState.submission)
  const isWorkspaceLoading = Boolean(
    loadingState.workspaces || isPrefetchingWorkspaces
  )
  const canDraw = canStartDrawing ?? true

  // Stable getter for drawing mode items using event callback
  const getDrawingModeItems = hooks.useEventCallback(() =>
    DRAWING_MODE_TABS.map((tab) => ({
      ...tab,
      label: translate(tab.label),
      tooltip: translate(tab.tooltip),
    }))
  )

  // Render drawing mode tabs
  const renderDrawingModeTabs = hooks.useEventCallback(() => {
    const helperText = isNonEmptyString(instructionText)
      ? instructionText
      : translate("drawingModeTooltip")

    return (
      <div css={styles.form.layout}>
        <div css={styles.form.content}>
          <div css={[styles.form.body, styles.centered]}>
            <div
              css={styles.typo.instruction}
              role="status"
              aria-live="polite"
              aria-atomic={true}
            >
              {helperText}
            </div>
            <ButtonTabs
              items={getDrawingModeItems()}
              value={drawingMode}
              onChange={(val) => {
                onDrawingModeChange?.(val as DrawingTool)
              }}
              aria-label={translate("drawingModeTooltip")}
            />
          </div>
        </div>
      </div>
    )
  })

  const renderModeNotice = (): React.ReactNode => {
    if (!modeNotice) return null

    const { messageKey, params, severity } = modeNotice
    if (!messageKey) return null

    let message = ""
    try {
      message = translate(messageKey, params || {})
    } catch {
      message = translate(messageKey)
    }

    if (!message) return null

    const alertType: "info" | "warning" =
      severity === "info" ? "info" : "warning"

    return (
      <Alert
        type={alertType}
        text={message}
        variant="default"
        withIcon={true}
        style={{ marginBlockEnd: 12 }}
      />
    )
  }

  const formatAreaValue = (value?: number): string | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return undefined
    }
    const target = Math.abs(value)
    if (typeof formatArea === "function") {
      try {
        return formatArea(target)
      } catch {
        /* ignore formatting errors and fall back to default */
      }
    }
    try {
      return `${Math.round(target).toLocaleString()} m²`
    } catch {
      return `${Math.round(target)} m²`
    }
  }

  const areaWarningActive =
    Boolean(areaWarning) &&
    (state === ViewMode.WORKSPACE_SELECTION ||
      state === ViewMode.EXPORT_OPTIONS ||
      state === ViewMode.EXPORT_FORM)

  let areaWarningMessage: string | null = null
  if (areaWarningActive) {
    const currentAreaText = formatAreaValue(drawnArea)
    const thresholdAreaText =
      typeof config?.largeArea === "number" && config.largeArea > 0
        ? formatAreaValue(config.largeArea)
        : undefined

    areaWarningMessage = buildLargeAreaWarningMessage({
      currentAreaText,
      thresholdAreaText,
      translate,
    })
  }

  // Small helpers to render common StateViews consistently
  const renderLoading = hooks.useEventCallback(
    (
      message?: string,
      subMessage?: string,
      extras?: readonly React.ReactNode[]
    ) => {
      const additionalMessages: React.ReactNode[] = []

      if (Array.isArray(extras)) {
        for (const entry of extras) {
          if (entry !== null && entry !== undefined) {
            additionalMessages.push(entry)
          }
        }
      }

      const waitText = translate("pleaseWait")
      const hasWaitAlready = additionalMessages.some(
        (entry) => typeof entry === "string" && entry === waitText
      )

      if (
        waitText &&
        waitText !== message &&
        waitText !== subMessage &&
        !hasWaitAlready
      ) {
        additionalMessages.push(waitText)
      }

      return (
        <StateView
          state={makeLoadingView(
            message,
            subMessage,
            additionalMessages.length ? additionalMessages : undefined
          )}
        />
      )
    }
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
        actions.push({ label: translate("actionRetry"), onClick: onRetry })
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

      const supportDetail = !hintText
        ? undefined
        : renderSupportHint(rawEmail, translate, styles, hintText)

      return (
        <StateView
          state={makeErrorView(localizedMessage, {
            code,
            actions,
            detail: supportDetail,
          })}
        />
      )
    }
  )

  const configuredRepository = toTrimmedString(config?.repository)
  const previousConfiguredRepository = hooks.usePrevious(configuredRepository)
  const serverUrl = toTrimmedString(
    (config as { fmeServerUrl?: string })?.fmeServerUrl
  )
  const serverToken = toTrimmedString(
    (config as { fmeServerToken?: string })?.fmeServerToken
  )
  const canFetchWorkspaces = Boolean(
    serverUrl && serverToken && configuredRepository
  )

  const [pendingWorkspace, setPendingWorkspace] = React.useState<{
    name: string
    repository?: string
  } | null>(null)

  const workspacesQuery = useWorkspaces(
    {
      repository: configuredRepository || undefined,
      fmeServerUrl: serverUrl || undefined,
      fmeServerToken: serverToken || undefined,
    },
    { enabled: canFetchWorkspaces }
  )

  const workspaceItemQuery = useWorkspaceItem(
    pendingWorkspace?.name,
    {
      repository:
        pendingWorkspace?.repository ?? configuredRepository ?? undefined,
      fmeServerUrl: serverUrl || undefined,
      fmeServerToken: serverToken || undefined,
    },
    { enabled: Boolean(pendingWorkspace && canFetchWorkspaces) }
  )

  const workspacesRefetchRef = hooks.useLatest(workspacesQuery.refetch)

  const workspaceItems = Array.isArray(workspaceItemsProp)
    ? workspaceItemsProp
    : EMPTY_WORKSPACES
  const currentRepository = configuredRepository || null

  const rawWorkspaceItems = Array.isArray(workspacesQuery.data)
    ? (workspacesQuery.data as readonly WorkspaceItem[])
    : EMPTY_WORKSPACES

  const filteredWorkspaces = rawWorkspaceItems.filter(
    (item) => item?.type === WORKSPACE_ITEM_TYPE
  )

  const scopedWorkspaces = filteredWorkspaces.filter((item) => {
    const repoName = toTrimmedString(
      (item as { repository?: string })?.repository
    )
    if (!repoName || !configuredRepository) {
      return true
    }
    return repoName === configuredRepository
  })

  const sanitizedWorkspaces =
    scopedWorkspaces.length === 0
      ? EMPTY_WORKSPACES
      : scopedWorkspaces.slice().sort((a, b) =>
          (a.title || a.name).localeCompare(b.title || b.name, undefined, {
            sensitivity: "base",
          })
        )

  const workspaceListsEqual = (
    nextItems: readonly WorkspaceItem[],
    currentItems: readonly WorkspaceItem[]
  ): boolean => {
    if (nextItems.length !== currentItems.length) {
      return false
    }
    for (let index = 0; index < nextItems.length; index += 1) {
      const next = nextItems[index]
      const current = currentItems[index]
      if (!next || !current) {
        return false
      }
      if (next.name !== current.name) {
        return false
      }
      if ((next.title || "") !== (current.title || "")) {
        return false
      }
      const nextRepo = toTrimmedString(
        (next as { repository?: string })?.repository
      )
      const currentRepo = toTrimmedString(
        (current as { repository?: string })?.repository
      )
      if (nextRepo !== currentRepo) {
        return false
      }
    }
    return true
  }

  hooks.useUpdateEffect(() => {
    if (!canFetchWorkspaces) {
      return
    }

    const nextItems = sanitizedWorkspaces
    if (nextItems === EMPTY_WORKSPACES && workspaceItems.length === 0) {
      return
    }

    if (workspaceListsEqual(nextItems, workspaceItems)) {
      return
    }

    reduxDispatch(fmeActions.setWorkspaceItems(nextItems, effectiveWidgetId))
  }, [
    sanitizedWorkspaces,
    workspaceItems,
    canFetchWorkspaces,
    reduxDispatch,
    effectiveWidgetId,
  ])

  hooks.useUpdateEffect(() => {
    if (canFetchWorkspaces) {
      return
    }
    if (!workspaceItems.length) {
      return
    }
    reduxDispatch(fmeActions.clearWorkspaceState(effectiveWidgetId))
  }, [
    canFetchWorkspaces,
    workspaceItems.length,
    reduxDispatch,
    effectiveWidgetId,
  ])

  hooks.useUpdateEffect(() => {
    if (previousConfiguredRepository === configuredRepository) {
      return
    }

    setPendingWorkspace(null)
    reduxDispatch(fmeActions.clearWorkspaceState(effectiveWidgetId))

    if (!configuredRepository || !canFetchWorkspaces) {
      return
    }

    const refetch = workspacesRefetchRef.current
    if (typeof refetch === "function") {
      void refetch()
    }
  }, [
    configuredRepository,
    previousConfiguredRepository,
    canFetchWorkspaces,
    reduxDispatch,
    effectiveWidgetId,
    workspacesRefetchRef,
  ])

  hooks.useUpdateEffect(() => {
    if (canFetchWorkspaces) {
      return
    }
    if (!pendingWorkspace) {
      return
    }
    setPendingWorkspace(null)
  }, [canFetchWorkspaces, pendingWorkspace])

  hooks.useUpdateEffect(() => {
    if (!pendingWorkspace) {
      return
    }

    const payload = workspaceItemQuery.data
    if (!payload) {
      return
    }

    const workspaceName = pendingWorkspace.name
    if (!workspaceName) {
      return
    }

    if (onWorkspaceSelected) {
      onWorkspaceSelected(workspaceName, payload.parameters, payload.item)
    } else {
      reduxDispatch(
        fmeActions.applyWorkspaceData(
          {
            workspaceName,
            parameters: payload.parameters,
            item: payload.item,
          },
          effectiveWidgetId
        )
      )
    }

    setPendingWorkspace(null)
  }, [
    pendingWorkspace,
    workspaceItemQuery.data,
    onWorkspaceSelected,
    reduxDispatch,
    effectiveWidgetId,
  ])

  const workspacesFetching = Boolean(workspacesQuery.isFetching)
  const previousWorkspacesFetching = hooks.usePrevious(workspacesFetching)
  React.useEffect(() => {
    if (previousWorkspacesFetching === workspacesFetching) {
      return
    }
    reduxDispatch(
      fmeActions.setLoadingFlag(
        "workspaces",
        workspacesFetching,
        effectiveWidgetId
      )
    )
  }, [
    workspacesFetching,
    previousWorkspacesFetching,
    reduxDispatch,
    effectiveWidgetId,
  ])

  const parametersFetching = Boolean(workspaceItemQuery.isFetching)
  const previousParametersFetching = hooks.usePrevious(parametersFetching)
  React.useEffect(() => {
    if (previousParametersFetching === parametersFetching) {
      return
    }
    reduxDispatch(
      fmeActions.setLoadingFlag(
        "parameters",
        parametersFetching,
        effectiveWidgetId
      )
    )
  }, [
    parametersFetching,
    previousParametersFetching,
    reduxDispatch,
    effectiveWidgetId,
  ])

  const translateWorkspaceError = hooks.useEventCallback(
    (errorValue: unknown, messageKey: string): string | null => {
      if (!errorValue) {
        return null
      }
      if (isAbortError(errorValue)) {
        return null
      }
      try {
        return resolveMessageOrKey(messageKey, translate)
      } catch {
        return translate(messageKey)
      }
    }
  )

  const workspaceListError =
    workspacesQuery.isError && canFetchWorkspaces
      ? translateWorkspaceError(workspacesQuery.error, "failedToLoadWorkspaces")
      : null

  const workspaceDetailError = workspaceItemQuery.isError
    ? translateWorkspaceError(
        workspaceItemQuery.error,
        "failedToLoadWorkspaceDetails"
      )
    : null

  const workspaceError = workspaceDetailError || workspaceListError

  const loadWsList = hooks.useEventCallback(() => {
    setPendingWorkspace(null)

    if (!canFetchWorkspaces) {
      reduxDispatch(fmeActions.clearWorkspaceState(effectiveWidgetId))
      return
    }

    const refetch = workspacesRefetchRef.current
    if (typeof refetch === "function") {
      void refetch()
    }
  })

  const renderWorkspaceButtons = hooks.useEventCallback(() =>
    workspaceItems.map((workspace) => {
      const displayLabel = workspace.title || workspace.name
      const handleOpen = () => {
        const repoToUse =
          toTrimmedString((workspace as { repository?: string })?.repository) ??
          currentRepository ??
          undefined
        setPendingWorkspace({
          name: workspace.name,
          repository: repoToUse,
        })
      }

      return (
        <div
          key={workspace.name}
          role="listitem"
          aria-label={displayLabel}
          onClick={handleOpen}
        >
          <Button
            text={displayLabel}
            icon={itemIcon}
            type="tertiary"
            logging={{
              enabled: true,
              prefix: "FME-Export-WorkspaceSelection",
            }}
          />
        </div>
      )
    })
  )

  // Header
  const renderHeader = () => {
    const showAlertIcon = Boolean(areaWarningActive && areaWarningMessage)

    let resetButton: React.ReactNode = null
    const canShowReset =
      state !== ViewMode.INITIAL &&
      !(state === ViewMode.DRAWING && (clickCount || 0) === 0)

    if (canShowReset) {
      const resetEnabled = canResetButton(
        onReset,
        canResetProp,
        state,
        drawnArea ?? 0,
        isDrawing,
        clickCount
      )

      if (resetEnabled) {
        resetButton = (
          <Button
            tooltip={translate("tooltipCancel")}
            tooltipPlacement="bottom"
            onClick={onReset}
            color="inherit"
            type="default"
            variant="contained"
            text={translate("cancel")}
            size="sm"
            aria-label={translate("tooltipCancel")}
            logging={{ enabled: true, prefix: "FME-Export-Header" }}
            block={false}
          />
        )
      }
    }

    if (!showAlertIcon && !resetButton) return null

    return (
      <>
        {showAlertIcon ? (
          <div css={styles.headerAlert}>
            <Alert
              variant="icon"
              type="warning"
              text={areaWarningMessage ?? undefined}
              role="alert"
              tooltipPlacement="bottom"
            />
          </div>
        ) : null}
        {resetButton}
      </>
    )
  }

  const renderInitial = () => {
    const waitMessage = translate("statusPreparingMapTools")
    const waitDetail = translate("statusPreparingMapToolsDetail")
    if (isModulesLoading) {
      return renderLoading(waitMessage, waitDetail, [
        translate("drawingModeTooltip"),
      ])
    }
    if (!canDraw) {
      return renderLoading(waitMessage, waitDetail, [
        translate("drawingModeTooltip"),
      ])
    }
    return renderDrawingModeTabs()
  }

  const renderDrawing = () => (
    <div css={styles.centered}>
      <div
        css={styles.typo.instruction}
        role="status"
        aria-live="polite"
        aria-atomic={true}
      >
        {instructionText}
      </div>
    </div>
  )

  const renderSelection = () => {
    const shouldShowLoading = shouldShowWorkspaceLoading(
      isWorkspaceLoading,
      workspaceItems,
      state,
      Boolean(workspaceError)
    )
    if (shouldShowLoading) {
      const isPrefetchLoading = Boolean(
        isPrefetchingWorkspaces &&
          workspaceItems.length &&
          state === ViewMode.WORKSPACE_SELECTION
      )

      const message = isPrefetchLoading
        ? translate("prefetchingWorkspaces")
        : workspaceItems.length
          ? translate("loadingWorkspaceDetails")
          : translate("loadingWorkspaces")

      const detail = isPrefetchLoading
        ? ""
        : workspaceItems.length
          ? translate("loadingWorkspaceDetailsDetail")
          : translate("loadingWorkspacesDetail")

      return renderLoading(message, detail, [translate("tooltipBackToOptions")])
    }

    if (workspaceError) {
      return renderError(workspaceError, onBack, loadWsList)
    }

    if (!workspaceItems.length) {
      const actions = [
        { label: translate("actionRetry"), onClick: loadWsList },
        { label: translate("back"), onClick: onBack },
      ]
      return (
        <StateView
          state={makeEmptyView(translate("noWorkspacesFound"), actions)}
        />
      )
    }

    return (
      <div css={styles.selection.container}>
        <div css={styles.btn.group} role="list">
          {renderWorkspaceButtons()}
        </div>
      </div>
    )
  }

  const renderForm = () => {
    if (!onFormBack || !onFormSubmit) {
      return renderError(translate("missingExportConfiguration"), onBack)
    }

    if (!workspaceParameters || !selectedWorkspace) {
      return renderLoading(
        translate("loadingWorkspaceDetails"),
        translate("loadingWorkspaceDetailsDetail"),
        [translate("configureWorkspaceParameters")]
      )
    }

    return (
      <>
        {renderModeNotice()}
        <ExportForm
          widgetId={effectiveWidgetId}
          workspaceParameters={workspaceParameters}
          workspaceName={selectedWorkspace}
          workspaceItem={workspaceItem}
          onBack={onFormBack}
          onSubmit={onFormSubmit}
          isSubmitting={isSubmittingOrder}
          translate={translate}
          config={config}
          geometryJson={geometryJson}
        />
      </>
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
      return renderLoading(loadingMessage)
    }

    if (state === ViewMode.ORDER_RESULT && orderResult) {
      return (
        <OrderResult
          orderResult={orderResult}
          translate={translate}
          onReuseGeography={onReuseGeography}
          onBack={onBack}
          onReset={onReset}
          config={config}
        />
      )
    }

    if (isSubmittingOrder) {
      const isSyncMode = Boolean(config?.syncMode)
      const baseKey = isSyncMode ? "submittingOrderSync" : "submittingOrder"
      const baseMessage = translate(baseKey)

      let phaseKey: string | null = null
      let detailKey: string | null = null

      switch (submissionPhase) {
        case "preparing":
          phaseKey = "submissionPhasePreparing"
          detailKey = "submissionPhasePreparingDetail"
          break
        case "uploading":
          phaseKey = "submissionPhaseUploading"
          detailKey = "submissionPhaseUploadingDetail"
          break
        case "finalizing":
          phaseKey = "submissionPhaseFinalizing"
          detailKey = "submissionPhaseFinalizingDetail"
          break
        case "submitting":
          phaseKey = "submissionPhaseSubmitting"
          detailKey = "submissionPhaseSubmittingDetail"
          break
        default:
          phaseKey = null
          detailKey = null
      }

      if (phaseKey && detailKey) {
        return renderLoading(translate(phaseKey), translate(detailKey))
      }

      // Fallback for sync mode with enhanced detail
      if (isSyncMode) {
        return renderLoading(
          baseMessage,
          translate("submittingOrderSyncDetail")
        )
      }

      return renderLoading(baseMessage, translate("pleaseWait"))
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
        // If completing drawing, show loading state instead of tabs to prevent flicker
        if (isCompleting) {
          return (
            <StateView
              state={makeLoadingView(
                translate("loadingGeometryValidation"),
                translate("loadingGeometryValidationDetail")
              )}
            />
          )
        }
        if ((clickCount || 0) === 0) {
          return renderDrawingModeTabs()
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
