import { React, hooks } from "jimu-core"
import { Button, Tabs, UI_CSS, StateView } from "./ui"
import defaultMessages from "./translations/default"
import type {
  ContentProps,
  WorkspaceItem,
  UiAction,
  ExportResult,
} from "../../shared/types"
import {
  ViewMode,
  DrawingTool,
  createLoadingState,
  createErrorState,
  createEmptyState,
} from "../../shared/types"
import polygonIcon from "../../assets/icons/polygon.svg"
import rectangleIcon from "../../assets/icons/rectangle.svg"
import resetIcon from "../../assets/icons/clear-selection-general.svg"
import listIcon from "../../assets/icons/menu.svg"
import plusIcon from "../../assets/icons/plus.svg"
import { STYLES } from "../../shared/css"
import { Export } from "./exports"
import { createFmeFlowClient } from "../../shared/api"

const CANCELLED_PROMISE_ERROR_NAME = "CancelledPromiseError"
const noOp = (): void => {
  /* noop */
}

// Create workspace loading state based on current conditions
const createWorkspaceLoadingState = (
  isLoadingWorkspaces: boolean,
  workspaces: readonly WorkspaceItem[],
  state: ViewMode
): boolean => {
  const isRelevantState =
    state === ViewMode.WORKSPACE_SELECTION || state === ViewMode.EXPORT_OPTIONS

  return isLoadingWorkspaces || (!workspaces.length && !isRelevantState)
}

// OrderResult component to display the result of an export order
const OrderResult: React.FC<{
  orderResult: ExportResult
  translate: (k: string) => string
  onReuseGeography?: () => void
  onBack?: () => void
}> = ({ orderResult, translate, onReuseGeography, onBack }) => {
  const isSuccess = !!orderResult.success
  const rows: React.ReactNode[] = []

  const addRow = (label?: string, value?: unknown) => {
    if (value === undefined || value === null || value === "") return
    const display =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : JSON.stringify(value)
    rows.push(
      <div style={STYLES.typography.caption} key={`${label}-${display}`}>
        {label ? `${label}: ${display}` : display}
      </div>
    )
  }

  addRow(translate("jobId"), orderResult.jobId)
  addRow(translate("workspace"), orderResult.workspaceName)
  addRow(translate("notificationEmail"), orderResult.email)
  if (orderResult.code && !isSuccess)
    addRow(translate("errorCode"), orderResult.code)

  return (
    <>
      <div style={STYLES.typography.title}>
        {isSuccess
          ? translate("orderConfirmation")
          : translate("orderSentError")}
      </div>
      {rows}
      {isSuccess && orderResult.downloadUrl && (
        <div style={STYLES.typography.caption}>
          <a
            href={orderResult.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {translate("downloadResult")}
          </a>
        </div>
      )}
      {(isSuccess || orderResult.message) && (
        <div style={STYLES.typography.caption}>
          {isSuccess ? translate("emailNotificationSent") : orderResult.message}
        </div>
      )}
      <Button
        text={isSuccess ? translate("reuseGeography") : translate("retry")}
        onClick={isSuccess ? onReuseGeography || noOp : onBack || noOp}
        logging={{ enabled: true, prefix: "FME-Export" }}
        tooltip={isSuccess ? translate("tooltipReuseGeography") : undefined}
        tooltipPlacement="bottom"
      />
    </>
  )
}

export const Content: React.FC<ContentProps> = ({
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

  // Local helper to build action arrays for StateView
  const createActions = hooks.useEventCallback(
    (onBack?: () => void, onRetry?: () => void): UiAction[] => {
      const actions: UiAction[] = []
      if (onRetry) actions.push({ label: translate("retry"), onClick: onRetry })
      if (onBack) actions.push({ label: translate("back"), onClick: onBack })
      return actions
    }
  )

  // FME client
  const fmeClient = React.useMemo(() => {
    return config ? createFmeFlowClient(config) : null
  }, [config])

  // Workspace selection state
  const [workspaces, setWorkspaces] = React.useState<readonly WorkspaceItem[]>(
    []
  )
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = React.useState(false)
  const [workspaceError, setWorkspaceError] = React.useState<string | null>(
    null
  )

  // Track mount
  const isMountedRef = React.useRef(true)
  hooks.useEffectOnce(() => {
    return () => {
      isMountedRef.current = false
    }
  })

  // Load workspaces
  const loadWorkspaces = hooks.useEventCallback(async () => {
    if (!fmeClient || !config?.repository || isLoadingWorkspaces) return
    setIsLoadingWorkspaces(true)
    setWorkspaceError(null)
    try {
      const response = await makeCancelable(
        fmeClient.getRepositoryItems(config.repository, "WORKSPACE")
      )
      if (response.status === 200 && response.data.items) {
        const items = response.data.items.filter((i) => i.type === "WORKSPACE")
        if (isMountedRef.current) setWorkspaces(items)
      } else {
        throw new Error(translate("failedToLoadWorkspaces"))
      }
    } catch (err: any) {
      if (err?.name === CANCELLED_PROMISE_ERROR_NAME || !isMountedRef.current)
        return
      const msg =
        err instanceof Error ? err.message : translate("unknownErrorOccurred")
      setWorkspaceError(`${translate("failedToLoadWorkspaces")}: ${msg}`)
    } finally {
      if (isMountedRef.current) setIsLoadingWorkspaces(false)
    }
  })

  // Select workspace
  const handleWorkspaceSelect = hooks.useEventCallback(
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
      } catch (err: any) {
        if (err?.name === CANCELLED_PROMISE_ERROR_NAME || !isMountedRef.current)
          return
        const msg =
          err instanceof Error ? err.message : translate("unknownErrorOccurred")
        setWorkspaceError(
          `${translate("failedToLoadWorkspaceDetails")}: ${msg}`
        )
      } finally {
        if (isMountedRef.current) setIsLoadingWorkspaces(false)
      }
    }
  )

  // Lazy load
  hooks.useUpdateEffect(() => {
    if (
      state === ViewMode.WORKSPACE_SELECTION ||
      state === ViewMode.EXPORT_OPTIONS
    ) {
      if (!workspaces.length && !isLoadingWorkspaces && !workspaceError)
        loadWorkspaces()
    }
  }, [
    state,
    workspaces.length,
    isLoadingWorkspaces,
    workspaceError,
    loadWorkspaces,
  ])

  // Header
  const renderHeader = () => {
    // Enable reset only when user is drawing OR a polygon has been drawn (area > 0)
    const hasArea = (drawnArea ?? 0) > 0
    const resetEnabled =
      !!onReset &&
      canReset &&
      (state === ViewMode.DRAWING || (hasArea && state !== ViewMode.INITIAL))

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
    // Loading state
    if (isModulesLoading) {
      return (
        <StateView
          state={createLoadingState(undefined, translate("preparingMapTools"))}
        />
      )
    }

    // Error state
    if (error) {
      return (
        <StateView
          state={createErrorState(
            translate(error.message) || error.message,
            error.recoverable
              ? {
                  actions: [
                    {
                      label: translate("retry"),
                      onClick: error.retry || noOp,
                      variant: "primary",
                    },
                  ],
                }
              : undefined
          )}
        />
      )
    }

    return (
      <div style={STYLES.state.centered}>
        {/* Drawing mode */}
        <Tabs
          items={[
            {
              value: DrawingTool.POLYGON,
              label: translate("drawingModePolygon"),
              icon: polygonIcon,
              tooltip: translate("drawingModePolygonTooltip"),
              hideLabel: true,
            },
            {
              value: DrawingTool.RECTANGLE,
              label: translate("drawingModeRectangle"),
              icon: rectangleIcon,
              tooltip: translate("drawingModeRectangleTooltip"),
              hideLabel: true,
            },
          ]}
          value={drawingMode}
          onChange={(val) => {
            onDrawingModeChange?.(val as DrawingTool)
          }}
          ariaLabel={translate("drawingModeTooltip")}
          logging={{ enabled: true, prefix: "FME-Export-DrawingMode" }}
        />
        <Button
          text={translate("specifyExtent")}
          alignText="center"
          icon={plusIcon}
          onClick={onAngeUtbredning}
          disabled={!canStartDrawing}
          tooltip={translate("tooltipSpecifyExtent")}
          tooltipPlacement="bottom"
          logging={{ enabled: true, prefix: "FME-Export" }}
        />
      </div>
    )
  }

  const renderDrawing = () => (
    <div style={STYLES.typography.instructionText}>{instructionText}</div>
  )

  const renderWorkspaceSelection = () => {
    // Loading
    const shouldShowLoading = createWorkspaceLoadingState(
      isLoadingWorkspaces,
      workspaces,
      state
    )
    if (shouldShowLoading) {
      const message = workspaces.length
        ? translate("loadingWorkspaceDetails")
        : translate("loadingWorkspaces")
      return <StateView state={createLoadingState(message)} />
    }

    // Error
    if (workspaceError) {
      return (
        <StateView
          state={createErrorState(workspaceError, {
            actions: createActions(onBack || noOp, loadWorkspaces),
          })}
        />
      )
    }

    // Empty
    if (!workspaces.length) {
      return (
        <StateView
          state={createEmptyState(
            translate("noWorkspacesFound"),
            createActions(onBack || noOp, loadWorkspaces)
          )}
        />
      )
    }

    // Content
    const workspaceButtons = workspaces.map((workspace) => (
      <Button
        key={workspace.name}
        text={workspace.title || workspace.name}
        icon={listIcon}
        onClick={() => {
          handleWorkspaceSelect(workspace.name)
        }}
        tooltip={workspace.description}
        tooltipDisabled={true}
        logging={{
          enabled: true,
          prefix: "FME-Export-WorkspaceSelection",
        }}
      />
    ))

    return <div style={UI_CSS.BTN.DEFAULT}>{workspaceButtons}</div>
  }

  const renderExportForm = () => {
    if (!onFormBack || !onFormSubmit) {
      return (
        <StateView
          state={createErrorState("Export form configuration missing", {
            actions: createActions(onBack || noOp),
          })}
        />
      )
    }

    // Check if we have workspace parameters and selected workspace
    if (!workspaceParameters || !selectedWorkspace) {
      return (
        <StateView
          state={createLoadingState(translate("loadingWorkspaceDetails"))}
        />
      )
    }

    return (
      <Export
        workspaceParameters={workspaceParameters}
        workspaceName={selectedWorkspace}
        workspaceItem={workspaceItem}
        onBack={onFormBack}
        onSubmit={onFormSubmit}
        isSubmitting={isSubmittingOrder}
      />
    )
  }

  const renderContent = () => {
    // Order result
    if (state === ViewMode.ORDER_RESULT && orderResult) {
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
      return (
        <StateView state={createLoadingState(translate("submittingOrder"))} />
      )
    }

    // General error
    if (error) {
      return (
        <StateView
          state={createErrorState(error.message, {
            actions:
              error.severity !== "info"
                ? [{ label: translate("retry"), onClick: onBack || noOp }]
                : undefined,
          })}
        />
      )
    }

    switch (state) {
      case ViewMode.INITIAL:
        return renderInitial()
      case ViewMode.DRAWING:
        return renderDrawing()
      case ViewMode.EXPORT_OPTIONS:
      case ViewMode.WORKSPACE_SELECTION:
        return renderWorkspaceSelection()
      case ViewMode.EXPORT_FORM:
        return renderExportForm()
      case ViewMode.ORDER_RESULT:
        return null
    }
  }

  return (
    <div style={STYLES.parent}>
      <div style={STYLES.header}>{renderHeader()}</div>
      <div style={STYLES.content}>{renderContent()}</div>
    </div>
  )
}
