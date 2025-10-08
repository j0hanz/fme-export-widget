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
} from "../../shared/utils"
import { useFormStateManager, useWorkspaceLoader } from "../../shared/hooks"

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

// Helper: Check if value is non-empty string
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== ""

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
  const isSyncMode = Boolean(config?.syncMode)
  const rows: React.ReactNode[] = []

  // Manage download URL lifecycle
  const [downloadUrl, setDownloadUrl] = React.useState<string | null>(null)
  const objectUrlRef = React.useRef<string | null>(null)

  hooks.useEffectWithPreviousValues(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    if (orderResult.downloadUrl) {
      setDownloadUrl(orderResult.downloadUrl)
      return
    }

    if (orderResult.blob instanceof Blob) {
      const url = URL.createObjectURL(orderResult.blob)
      objectUrlRef.current = url
      setDownloadUrl(url)
      return
    }

    setDownloadUrl(null)
  }, [orderResult.downloadUrl, orderResult.blob])

  hooks.useUnmount(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  })

  const addRow = (label?: string, value?: unknown) => {
    if (value === undefined || value === null || value === "") return

    const display =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : JSON.stringify(value)
    const key = label
      ? `order-row-${label}-${rows.length}`
      : `order-row-${rows.length}`

    rows.push(
      <div css={styles.typo.caption} key={key}>
        {label ? `${label}: ${display}` : display}
      </div>
    )
  }

  addRow(translate("jobId"), orderResult.jobId)
  const workspaceDisplayName = toTrimmedString(config?.workspaceName)
  addRow(
    translate("workspace"),
    workspaceDisplayName || orderResult.workspaceName
  )

  if (!isSyncMode) {
    const emailVal = orderResult.email
    const masked =
      config?.maskEmailOnSuccess && isSuccess
        ? maskEmailForDisplay(emailVal)
        : emailVal
    addRow(translate("notificationEmail"), masked)
  }

  if (orderResult.code && !isSuccess) {
    addRow(translate("errorCode"), orderResult.code)
  }

  // Display schedule metadata if present
  const scheduleMetadata = orderResult.scheduleMetadata
  const hasScheduleInfo =
    scheduleMetadata &&
    scheduleMetadata.start &&
    scheduleMetadata.name &&
    scheduleMetadata.category

  const titleText = isSuccess
    ? isSyncMode
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

  const showDownloadLink = isSuccess && downloadUrl

  // Conditional message based on sync mode
  const messageText = isSuccess
    ? !isSyncMode
      ? translate("emailNotificationSent")
      : null
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
        return msg || translate("errorUnknown")
      })()

  return (
    <div css={styles.form.layout}>
      <div css={styles.form.content}>
        <div css={styles.form.body}>
          <div css={styles.typo.title}>{titleText}</div>
          {rows}

          {/* Schedule Summary Section */}
          {hasScheduleInfo && isSuccess && (
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
              {scheduleMetadata.description && (
                <div css={styles.typo.caption}>
                  {translate("scheduleJobDescription")}:{" "}
                  {scheduleMetadata.description}
                </div>
              )}
              {(() => {
                const validation = validateScheduleDateTime(
                  scheduleMetadata.start || ""
                )
                if (validation.isPast) {
                  return (
                    <Alert
                      type="warning"
                      text={translate("schedulePastTimeWarning")}
                      variant="default"
                      withIcon={true}
                    />
                  )
                }
                return null
              })()}
            </>
          )}

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
  getFmeClient: getFmeClientProp,
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
  geometryJson,
  // Workspace collection now arrives from the parent widget via props
  // Startup validation props
  isStartupValidating: _isStartupValidating,
  startupValidationStep,
  startupValidationError,
  onRetryValidation,
  submissionPhase = "idle",
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useUiStyles()
  const workspaceNameOverride = toTrimmedString(config?.workspaceName)
  const reduxDispatch = ReactRedux.useDispatch()
  const makeCancelable = hooks.useCancelablePromiseMaker()
  // Ensure a non-empty widgetId for internal Redux interactions
  const effectiveWidgetId = widgetId && widgetId.trim() ? widgetId : "__local__"

  const loadingState = loadingStateProp ?? {
    modules: false,
    submission: false,
    workspaces: false,
    parameters: false,
  }
  const isModulesLoading = Boolean(loadingState.modules)
  const isSubmittingOrder = Boolean(loadingState.submission)
  const isWorkspaceLoading = Boolean(loadingState.workspaces)
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

  // FME client - always create fresh instance
  const getFmeClient = hooks.useEventCallback(() => {
    if (typeof getFmeClientProp !== "function") {
      return null
    }
    try {
      return getFmeClientProp()
    } catch {
      return null
    }
  })

  const configuredRepository = toTrimmedString(config?.repository)
  const previousConfiguredRepository = hooks.usePrevious(configuredRepository)

  const {
    isLoading: workspaceLoaderIsLoading,
    error: workspaceError,
    loadAll: loadWsList,
    loadItem: loadWorkspace,
    scheduleLoad: scheduleWsLoad,
  } = useWorkspaceLoader({
    config,
    getFmeClient,
    translate,
    makeCancelable,
    widgetId: effectiveWidgetId,
    onWorkspaceSelected,
    dispatch: reduxDispatch,
  })

  const workspaceItems = Array.isArray(workspaceItemsProp)
    ? workspaceItemsProp
    : EMPTY_WORKSPACES
  const currentRepository = configuredRepository || null

  // Helper: are we in a workspace selection context?
  const isWorkspaceSelectionContext =
    state === ViewMode.WORKSPACE_SELECTION || state === ViewMode.EXPORT_OPTIONS

  // Render workspace buttons
  const renderWorkspaceButtons = hooks.useEventCallback(() =>
    workspaceItems.map((workspace) => {
      const displayLabel =
        workspaceNameOverride || workspace.title || workspace.name
      const handleOpen = () => {
        const repoToUse =
          toTrimmedString((workspace as { repository?: string })?.repository) ??
          currentRepository ??
          undefined
        loadWorkspace(workspace.name, repoToUse)
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
            size="lg"
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

  // Lazy load workspaces when entering workspace selection modes
  hooks.useUpdateEffect(() => {
    if (
      !isWorkspaceSelectionContext ||
      workspaceItems.length ||
      workspaceLoaderIsLoading ||
      workspaceError
    ) {
      return
    }
    return scheduleWsLoad()
  }, [
    isWorkspaceSelectionContext,
    workspaceItems.length,
    workspaceLoaderIsLoading,
    workspaceError,
    scheduleWsLoad,
  ])

  // Clear workspace state when repository changes
  hooks.useUpdateEffect(() => {
    if (previousConfiguredRepository === configuredRepository) {
      return
    }

    reduxDispatch(fmeActions.clearWorkspaceState(effectiveWidgetId))

    if (configuredRepository && isWorkspaceSelectionContext) {
      scheduleWsLoad()
    }
  }, [
    configuredRepository,
    previousConfiguredRepository,
    reduxDispatch,
    effectiveWidgetId,
    isWorkspaceSelectionContext,
    scheduleWsLoad,
  ])

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
      return renderLoading(waitMessage, waitDetail)
    }
    if (!canDraw) {
      return renderLoading(waitMessage, waitDetail)
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
      const message = workspaceItems.length
        ? translate("loadingWorkspaceDetails")
        : translate("loadingWorkspaces")
      const detail = workspaceItems.length
        ? translate("loadingWorkspaceDetailsDetail")
        : translate("loadingWorkspacesDetail")
      return renderLoading(message, detail)
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
        {workspaceNameOverride ? (
          <div css={styles.selection.warning}>
            <Alert type="info" text={workspaceNameOverride} variant="default" />
          </div>
        ) : null}
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
        translate("loadingWorkspaceDetailsDetail")
      )
    }

    return (
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
