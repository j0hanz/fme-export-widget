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
import { validateDateTimeFormat } from "../../shared/validations"
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
  toIsoLocal,
  fromIsoLocal,
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
  addRow(translate("workspace"), orderResult.workspaceName)

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
  const showMessage = isSuccess || orderResult.message

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
          {showMessage && messageText && (
            <div css={styles.typo.caption}>{messageText}</div>
          )}
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

  // ISO (widget control) -> space-delimited (FME) local datetime string
  const isoToSpaceLocal = hooks.useEventCallback(fromIsoLocal)

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
              const spaceVal = isoToSpaceLocal(iso)
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
  canStartDrawing: _canStartDrawing,
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
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useUiStyles()
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
  let areaInfoMessage: string | null = null
  if (areaWarningActive) {
    const currentAreaText = formatAreaValue(drawnArea)
    const thresholdAreaText =
      typeof config?.largeArea === "number" && config.largeArea > 0
        ? formatAreaValue(config.largeArea)
        : undefined

    areaWarningMessage = buildLargeAreaWarningMessage({
      currentAreaText,
      thresholdAreaText,
      template: config?.largeAreaWarningMessage,
      translate,
    })
  }
  const infoTemplate = toTrimmedString(config?.customInfoMessage)
  if (infoTemplate) {
    if (areaWarningActive) {
      const currentAreaText = formatAreaValue(drawnArea)
      const thresholdAreaText =
        typeof config?.largeArea === "number" && config.largeArea > 0
          ? formatAreaValue(config.largeArea)
          : undefined
      const resolvedInfo = buildLargeAreaWarningMessage({
        currentAreaText,
        thresholdAreaText,
        template: infoTemplate,
        translate,
      })
      const trimmedInfo = toTrimmedString(resolvedInfo)
      if (trimmedInfo) {
        areaInfoMessage = trimmedInfo
      }
    } else {
      areaInfoMessage = infoTemplate
    }
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

      return (
        <StateView
          state={makeErrorView(localizedMessage, { code, actions })}
          renderActions={(viewActions, ariaLabel) => {
            const supportHint = renderSupportHint(
              rawEmail,
              translate,
              styles,
              hintText
            )
            const hasActions = Boolean(viewActions?.length)
            if (!hasActions && !supportHint) return null

            return (
              <div role="group" aria-label={ariaLabel}>
                {hasActions && (
                  <div css={styles.btn.group}>
                    {(viewActions || []).map((action, index) => (
                      <Button
                        key={`${action.label}-${index}`}
                        onClick={action.onClick}
                        disabled={action.disabled}
                        variant={action.variant}
                        text={action.label}
                        block
                      />
                    ))}
                  </div>
                )}
                {supportHint}
              </div>
            )
          }}
          center={false}
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

  const previousConfiguredRepositoryRef = React.useRef<string | undefined>(
    configuredRepository
  )

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
          aria-label={workspace.title || workspace.name}
          onClick={handleOpen}
        >
          <Button
            text={workspace.title || workspace.name}
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
    const previousRepository = previousConfiguredRepositoryRef.current
    if (previousRepository === configuredRepository) {
      return
    }

    previousConfiguredRepositoryRef.current = configuredRepository

    reduxDispatch(fmeActions.clearWorkspaceState(effectiveWidgetId))

    if (configuredRepository && isWorkspaceSelectionContext) {
      scheduleWsLoad()
    }
  }, [
    configuredRepository,
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
    if (isModulesLoading) {
      return renderLoading(undefined, translate("statusPreparingMapTools"))
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
      return renderLoading(message)
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
        {areaInfoMessage && (
          <div css={styles.selection.warning}>
            <Alert type="info" text={areaInfoMessage} variant="default" />
          </div>
        )}
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
        // If completing drawing, show loading state instead of tabs to prevent flicker
        if (isCompleting) {
          return (
            <StateView
              state={makeLoadingView(
                translate("loadingGeometryValidation"),
                translate("pleaseWait")
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
