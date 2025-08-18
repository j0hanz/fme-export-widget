import { React, hooks, getAppStore } from "jimu-core"
import {
  Button,
  UI_CSS,
  StateView,
  Select,
  TextArea,
  Form,
  Field,
  Input,
  Checkbox,
  ButtonTabs,
} from "./ui"
import defaultMessages from "./translations/default"
import {
  FormFieldType,
  type WorkflowProps,
  type WorkspaceItem,
  type ViewAction,
  type FormPrimitive,
  type FormValues,
  type SelectValue,
  type OrderResultProps,
  type ExportFormProps,
  type DynamicFieldProps,
  type DynamicFieldConfig,
} from "../../shared/types"
import {
  ViewMode,
  DrawingTool,
  makeLoadingView,
  makeErrorView,
  makeEmptyView,
  ErrorType,
} from "../../shared/types"
import polygonIcon from "jimu-icons/svg/outlined/gis/polygon.svg"
import rectangleIcon from "jimu-icons/svg/outlined/gis/rectangle.svg"
import resetIcon from "jimu-icons/svg/outlined/gis/clear-selection.svg"
import listIcon from "jimu-icons/svg/outlined/application/folder.svg"
import plusIcon from "jimu-icons/svg/outlined/editor/plus.svg"
import { createFmeFlowClient } from "../../shared/api"
import { fmeActions } from "../../extensions/store"
import {
  ParameterFormService,
  ErrorHandlingService,
} from "../../shared/services"

// Workflow-specific styles
const CSS = {
  parent: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    height: "100%",
    position: "relative" as const,
  } as React.CSSProperties,
  header: {
    display: "flex",
    justifyContent: "end",
    flexShrink: 0,
  } as React.CSSProperties,
  content: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flex: "1 1 auto",
    padding: "0.5rem",
  } as React.CSSProperties,
  state: {
    centered: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      height: "100%",
      gap: "0.5rem",
    } as React.CSSProperties,
  },
  typography: {
    caption: {
      fontSize: "0.8125rem",
      margin: "0.5rem 0",
    } as React.CSSProperties,
    title: {
      fontSize: "1rem",
      fontWeight: 500,
    } as React.CSSProperties,
    instructionText: {
      fontSize: "0.8125rem",
      margin: "1rem 0",
      textAlign: "center",
    } as React.CSSProperties,
  },
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

// Helper for workspace API error handling
const formatError = (
  err: unknown,
  isMountedRef: React.MutableRefObject<boolean>,
  translate: (key: string) => string,
  baseMessage: string
): string | null => {
  if (
    (err as { name?: string } | null)?.name === ERROR_NAMES.CANCELLED_PROMISE ||
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

// Helper to determine reset button enabled state
const isResetEnabled = (
  onReset: (() => void) | undefined,
  canReset: boolean,
  state: ViewMode,
  drawnArea: number
): boolean => {
  if (!onReset || !canReset) return false
  const hasArea = drawnArea > 0
  return state === ViewMode.DRAWING || (hasArea && state !== ViewMode.INITIAL)
}

// Determine whether workspace list should display a loading state
const showWsLoading = (
  isLoadingWorkspaces: boolean,
  workspaces: readonly WorkspaceItem[],
  state: ViewMode
): boolean => {
  const shouldLoadInThisState =
    state === ViewMode.WORKSPACE_SELECTION || state === ViewMode.EXPORT_OPTIONS
  return isLoadingWorkspaces || (!workspaces.length && shouldLoadInThisState)
}

// Form helper functions
const normalizeFieldValue = (
  value: FormPrimitive | undefined,
  isMultiSelect: boolean
): FormPrimitive => {
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  return value
}

// Coerce any FormPrimitive to a value acceptable by <Select/>
const toSelectValue = (
  value: FormPrimitive,
  isMultiSelect: boolean
): SelectValue => {
  if (Array.isArray(value)) return value as ReadonlyArray<string | number>
  if (typeof value === "string" || typeof value === "number") return value
  return isMultiSelect ? [] : ""
}

const getPlaceholders = (
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
      <div style={CSS.typography.caption} key={label || display}>
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
      <div style={CSS.typography.title}>{titleText}</div>
      {rows}
      {showDownloadLink && (
        <div style={CSS.typography.caption}>
          <a
            href={orderResult.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {translate("downloadResult")}
          </a>
        </div>
      )}
      {showMessage && <div style={CSS.typography.caption}>{messageText}</div>}
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
  const fieldValue = normalizeFieldValue(value, isMulti)
  const placeholders = getPlaceholders(translate, field.label)

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

  // Generate form configuration from parameters
  const formConfig = React.useMemo(
    () => parameterService.convertParametersToFields(workspaceParameters),
    [parameterService, workspaceParameters]
  )

  // Initialize form values from parameter defaults - using useState lazy initialization
  const [values, setValues] = React.useState<FormValues>(() =>
    initValues(formConfig)
  )
  const [isValid, setIsValid] = React.useState(true)

  // Initialize form values in Redux store only once
  hooks.useEffectOnce(() => {
    syncForm(values)
  })

  // Validate form whenever values change
  hooks.useUpdateEffect(() => {
    const validation = parameterService.validateFormValues(values, formConfig)
    setIsValid(validation.isValid)
  }, [values, parameterService, formConfig])

  // Reset values when workspace or fields change (e.g., switching workspaces)
  hooks.useUpdateEffect(() => {
    const nextValues = initValues(formConfig)
    setValues(nextValues)
    setFileMap({})
    syncForm(nextValues)
  }, [workspaceName, formConfig])

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
    const validation = parameterService.validateFormValues(values, formConfig)
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
      {formConfig.map((field) => (
        <Field key={field.name} label={field.label} required={field.required}>
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

// Main Workflow component - consolidates content and export functionality
export const Workflow: React.FC<WorkflowProps> = ({
  state,
  instructionText,
  onAngeUtbredning,
  isModulesLoading,
  canStartDrawing,
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
  // Reset
  onReset,
  canReset = true,
  // Workspace props
  config,
  onWorkspaceSelected,
  selectedWorkspace,
  workspaceParameters,
  workspaceItem,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const makeCancelable = hooks.useCancelablePromiseMaker()

  // Internal alias for readability (keep original prop name for API stability)
  const handleSpecifyExtent = onAngeUtbredning

  // Memoized drawing mode items to avoid re-creating arrays on each render
  const drawingModeItems = React.useMemo(
    () =>
      DRAWING_MODE_TABS.map((tab) => ({
        ...tab,
        label: translate(tab.label),
        tooltip: translate(tab.tooltip),
      })),
    [translate]
  )

  // Local helper to build action arrays for StateView
  const getActions = hooks.useEventCallback(
    (onBack?: () => void, onRetry?: () => void): ViewAction[] => {
      return [
        ...(onRetry ? [{ label: translate("retry"), onClick: onRetry }] : []),
        ...(onBack ? [{ label: translate("back"), onClick: onBack }] : []),
      ]
    }
  )

  // Small helpers to render common StateViews consistently
  const renderLoading = hooks.useEventCallback(
    (message?: string, subMessage?: string) => (
      <StateView state={makeLoadingView(message, subMessage)} />
    )
  )

  const renderError = hooks.useEventCallback(
    (message: string, onBack?: () => void, onRetry?: () => void) => {
      const actions =
        onBack || onRetry ? getActions(onBack, onRetry) : undefined
      return <StateView state={makeErrorView(message, { actions })} />
    }
  )

  // FME client
  const fmeClient = React.useMemo(() => {
    try {
      return config ? createFmeFlowClient(config) : null
    } catch (e) {
      console.warn("FME Export - invalid FME config; deferring client init", e)
      return null
    }
  }, [config])

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
      if (loadAbortRef.current) {
        loadAbortRef.current.abort()
        loadAbortRef.current = null
      }
      // Clear any pending scheduled load timeout
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }
  })

  // Load workspaces with race condition protection
  const fetchWorkspaces = hooks.useEventCallback(async () => {
    if (!fmeClient || !config?.repository) return

    // Cancel any existing request
    if (loadAbortRef.current) {
      loadAbortRef.current.abort()
    }
    loadAbortRef.current = new AbortController()

    setIsLoadingWorkspaces(true)
    setWorkspaceError(null)

    try {
      const response = await makeCancelable(
        fmeClient.getRepositoryItems(config.repository, WORKSPACE_ITEM_TYPE)
      )

      // Check if request was aborted
      if (loadAbortRef.current?.signal.aborted) return

      if (response.status === 200 && response.data.items) {
        const items = response.data.items.filter(
          (i) => i.type === WORKSPACE_ITEM_TYPE
        )
        // Sort deterministically by title or name (case-insensitive)
        const sorted = items.slice().sort((a, b) =>
          (a.title || a.name).localeCompare(b.title || b.name, undefined, {
            sensitivity: "base",
          })
        )
        if (isMountedRef.current) setWorkspaces(sorted)
      } else {
        throw new Error(translate("failedToLoadWorkspaces"))
      }
    } catch (err: unknown) {
      // Don't show error if request was aborted
      if ((err as { name?: string })?.name === ERROR_NAMES.ABORT) return

      const errorMsg = formatError(
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
      if (!fmeClient || !config?.repository) return
      setIsLoadingWorkspaces(true)
      setWorkspaceError(null)
      try {
        const response = await makeCancelable(
          fmeClient.getWorkspaceItem(workspaceName, config.repository)
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
        const errorMsg = formatError(
          err,
          isMountedRef,
          translate,
          "failedToLoadWorkspaceDetails"
        )
        if (errorMsg) setWorkspaceError(errorMsg)
      } finally {
        if (isMountedRef.current) setIsLoadingWorkspaces(false)
      }
    }
  )

  // Memoized workspace buttons
  const workspaceButtons = React.useMemo(
    () =>
      workspaces.map((workspace) => (
        <Button
          key={workspace.name}
          text={workspace.title || workspace.name}
          icon={listIcon}
          role="listitem"
          onClick={() => {
            loadWorkspace(workspace.name)
          }}
          logging={{
            enabled: true,
            prefix: "FME-Export-WorkspaceSelection",
          }}
        />
      )),
    [workspaces, loadWorkspace]
  )

  // Schedule a workspace load (debounced 300ms) to prevent rapid successive calls
  const workspaceLoad = React.useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
    }
    loadTimeoutRef.current = setTimeout(() => {
      fetchWorkspaces()
      loadTimeoutRef.current = null
    }, 300) // 300ms debounce delay
  }, [fetchWorkspaces])

  // Lazy load
  hooks.useUpdateEffect(() => {
    if (
      state === ViewMode.WORKSPACE_SELECTION ||
      state === ViewMode.EXPORT_OPTIONS
    ) {
      if (!workspaces.length && !isLoadingWorkspaces && !workspaceError) {
        workspaceLoad()
      }
    }
  }, [
    state,
    workspaces.length,
    isLoadingWorkspaces,
    workspaceError,
    workspaceLoad,
  ])

  // Header
  const renderHeader = () => {
    const resetEnabled = isResetEnabled(
      onReset,
      canReset,
      state,
      drawnArea ?? 0
    )

    return (
      <Button
        icon={resetIcon}
        tooltip={translate("tooltipCancel")}
        tooltipPlacement="bottom"
        onClick={resetEnabled ? onReset : noOp}
        variant="text"
        disabled={!resetEnabled}
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
      <div style={CSS.state.centered}>
        {/* Drawing mode */}
        <ButtonTabs
          items={drawingModeItems}
          value={drawingMode}
          onChange={(val) => {
            onDrawingModeChange?.(val as DrawingTool)
          }}
          ariaLabel={translate("drawingModeTooltip")}
        />
        <Button
          text={translate("specifyExtent")}
          alignText="center"
          icon={plusIcon}
          onClick={handleSpecifyExtent}
          disabled={!canStartDrawing}
          tooltip={translate("tooltipSpecifyExtent")}
          tooltipPlacement="bottom"
          logging={{ enabled: true, prefix: "FME-Export" }}
        />
      </div>
    )
  }

  const renderDrawing = () => (
    <div style={CSS.typography.instructionText}>{instructionText}</div>
  )

  const renderSelection = () => {
    // Loading
    const shouldShowLoading = showWsLoading(
      isLoadingWorkspaces,
      workspaces,
      state
    )
    if (shouldShowLoading) {
      const message = workspaces.length
        ? translate("loadingWorkspaceDetails")
        : translate("loadingWorkspaces")
      return renderLoading(message)
    }

    // Error
    if (workspaceError) {
      return renderError(workspaceError, onBack || noOp, fetchWorkspaces)
    }

    // Empty
    if (!workspaces.length) {
      return (
        <StateView
          state={makeEmptyView(
            translate("noWorkspacesFound"),
            getActions(onBack || noOp, fetchWorkspaces)
          )}
        />
      )
    }

    // Content
    return (
      <div style={UI_CSS.BTN.DEFAULT} role="list">
        {workspaceButtons}
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
    // Order result
    if (state === ViewMode.ORDER_RESULT && orderResult) {
      // Happy path: show OrderResult if present; fallback handled in switch below.
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
        return renderError(error.message, undefined, onBack || noOp)
      }
      return renderError(error.message)
    }

    switch (state) {
      case ViewMode.INITIAL:
        return renderInitial()
      case ViewMode.DRAWING:
        return renderDrawing()
      case ViewMode.EXPORT_OPTIONS:
      case ViewMode.WORKSPACE_SELECTION:
        return renderSelection()
      case ViewMode.EXPORT_FORM:
        return renderForm()
      case ViewMode.ORDER_RESULT:
        // Fallback: ORDER_RESULT view but no result object was provided.
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
    <div style={CSS.parent}>
      <div style={CSS.header}>{showHeaderActions ? renderHeader() : null}</div>
      <div style={CSS.content}>{renderCurrent()}</div>
    </div>
  )
}

export default Workflow
