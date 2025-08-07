import {
  React,
  hooks,
  AnimationComponent,
  AnimationType,
  AnimationTriggerType,
  AnimationEffectType,
} from "jimu-core"
import { Button, Select, Dropdown } from "./ui"
import { StateRenderer } from "./state"
import defaultMessages from "../../translations/default"
import type { ContentProps, DropdownItemConfig } from "../../shared/types"
import { ViewMode, DrawingTool, StateType } from "../../shared/types"
import polygonIcon from "../../assets/icons/polygon.svg"
import rectangleIcon from "../../assets/icons/rectangle.svg"
import resetIcon from "../../assets/icons/clear-selection-general.svg"
import listIcon from "../../assets/icons/menu.svg"
import plusIcon from "../../assets/icons/plus.svg"
import { STYLES } from "../../shared/css"
import { Export } from "./exports"

const noOp = (): void => {
  // No operation - intentionally empty
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
  formatArea,
  // Drawing mode props
  drawingMode = DrawingTool.POLYGON,
  onDrawingModeChange,
  // Real-time measurement props
  realTimeMeasurements,
  formatRealTimeMeasurements,
  // Header props
  showHeaderActions = false,
  onReset,
  canReset = true,
  // Workspace-related props
  widgetId,
  config,
  onWorkspaceSelected,
  onWorkspaceBack,
  selectedWorkspace,
  workspaceParameters,
  workspaceItem,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const makeCancelable = hooks.useCancelablePromiseMaker()

  // Workspace selection state - moved to top level to avoid hook usage in render functions
  const [workspaces, setWorkspaces] = React.useState<readonly any[]>([])
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = React.useState(false)
  const [workspaceError, setWorkspaceError] = React.useState<string | null>(
    null
  )

  // Generate stable animation ID based on current state
  const playId = `${state}-${!!error}-none`.length

  // Load workspaces function - moved to top level
  const loadWorkspaces = hooks.useEventCallback(async () => {
    if (!config) return

    setIsLoadingWorkspaces(true)
    setWorkspaceError(null)

    try {
      const { createFmeFlowClient } = await import("../../shared/api")
      const client = createFmeFlowClient(config)

      const response = await makeCancelable(
        client.getRepositoryItems(config.repository, "WORKSPACE")
      )

      if (response.status === 200 && response.data.items) {
        const workspaceItems = response.data.items.filter(
          (item) => item.type === "WORKSPACE"
        )

        setWorkspaces(workspaceItems)
      } else {
        throw new Error(translate("failedToLoadWorkspaces"))
      }
    } catch (err) {
      // Handle both API errors and cancellation
      if (err.name !== "CancelledPromiseError") {
        const errorMessage =
          err instanceof Error ? err.message : translate("unknownErrorOccurred")
        setWorkspaceError(
          `${translate("failedToLoadWorkspaces")}: ${errorMessage}`
        )
      }
    } finally {
      setIsLoadingWorkspaces(false)
    }
  })

  // Handle workspace selection - moved to top level
  const handleWorkspaceSelect = hooks.useEventCallback(
    async (workspaceName: string) => {
      if (!config) return

      // Set specific loading state for workspace details
      setIsLoadingWorkspaces(true)
      setWorkspaceError(null)

      try {
        // Get workspace item details (includes parameters)
        const { createFmeFlowClient } = await import("../../shared/api")
        const client = createFmeFlowClient(config)

        const response = await makeCancelable(
          client.getWorkspaceItem(workspaceName, config.repository)
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
        // Handle both API errors and cancellation
        if (err.name !== "CancelledPromiseError") {
          const errorMessage =
            err instanceof Error
              ? err.message
              : translate("unknownErrorOccurred")
          setWorkspaceError(
            `${translate("failedToLoadWorkspaceDetails")}: ${errorMessage}`
          )
        }
      } finally {
        setIsLoadingWorkspaces(false)
      }
    }
  )

  // Load workspaces when needed - only when transitioning to export options
  hooks.useUpdateEffect(() => {
    if (
      state === ViewMode.EXPORT_OPTIONS ||
      state === ViewMode.WORKSPACE_SELECTION
    ) {
      if (workspaces.length === 0 && !isLoadingWorkspaces && !workspaceError) {
        loadWorkspaces()
      }
    }
  }, [state])

  // Header component for widget actions
  const renderHeader = () => {
    const dropdownItems: DropdownItemConfig[] = [
      {
        id: "reset",
        label: translate("cancel"),
        icon: resetIcon,
        onClick: onReset || noOp,
        disabled: !canReset || !onReset,
        tooltip: translate("tooltipCancel"),
      },
    ]

    return (
      <Dropdown
        items={dropdownItems}
        buttonTitle={translate("widgetActions")}
        logging={{ enabled: true, prefix: "FME-Export-Header" }}
      />
    )
  }

  const renderInitial = () => {
    // Show loading state with StateRenderer if modules are still loading
    if (isModulesLoading) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            detail: translate("preparingMapTools"),
          }}
        />
      )
    }

    // Show error state with StateRenderer if there's an error
    if (error) {
      return (
        <StateRenderer
          state={StateType.ERROR}
          data={{
            error: error,
            actions: error.recoverable
              ? [
                  {
                    label: translate("retry"),
                    onClick: error.retry || noOp,
                    variant: "primary",
                  },
                ]
              : undefined,
          }}
        />
      )
    }

    return (
      <>
        <div style={STYLES.typography.caption}>{instructionText}</div>
        {/* Drawing Mode Selector */}
        <div style={STYLES.button.row}>
          <Select
            value={drawingMode}
            onChange={(value) => {
              onDrawingModeChange?.(value as DrawingTool)
            }}
            style={STYLES.button.select}
            placeholder={translate("drawingModeTooltip")}
            options={[
              {
                value: DrawingTool.POLYGON,
                label: translate("drawingModePolygon"),
                icon: polygonIcon,
                hideLabel: true,
              },
              {
                value: DrawingTool.RECTANGLE,
                label: translate("drawingModeRectangle"),
                icon: rectangleIcon,
                hideLabel: true,
              },
            ]}
            logging={{ enabled: true, prefix: "FME-Export-DrawingMode" }}
          />
          <Button
            text={translate("specifyExtent")}
            icon={plusIcon}
            onClick={onAngeUtbredning}
            disabled={!canStartDrawing}
            tooltip={translate("tooltipSpecifyExtent")}
            tooltipPlacement="bottom"
            logging={{ enabled: true, prefix: "FME-Export" }}
          />
        </div>
      </>
    )
  }

  const renderDrawing = () => {
    const hasStartedDrawing =
      realTimeMeasurements && Object.keys(realTimeMeasurements).length > 0

    return (
      <>
        {!hasStartedDrawing && (
          <div style={STYLES.typography.instructionText}>{instructionText}</div>
        )}
        {hasStartedDrawing && formatRealTimeMeasurements && (
          <div style={STYLES.measureField}>
            {formatRealTimeMeasurements(realTimeMeasurements)}
          </div>
        )}
      </>
    )
  }

  const renderWorkspaceSelection = () => {
    // Show loading state while loading workspaces
    if (isLoadingWorkspaces) {
      // Different loading messages based on whether we're loading the list or details
      const loadingMessage =
        workspaces.length > 0
          ? translate("loadingWorkspaceDetails") ||
            "Loading workspace details..."
          : translate("loadingWorkspaces") || "Loading workspaces..."

      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: loadingMessage,
          }}
        />
      )
    }

    // Show error state if failed to load workspaces
    if (workspaceError) {
      return (
        <StateRenderer
          state={StateType.ERROR}
          data={{
            message: workspaceError,
            actions: [
              {
                label: translate("retry") || "Retry",
                onClick: loadWorkspaces,
              },
              {
                label: translate("back") || "Back",
                onClick: onBack || noOp,
              },
            ],
          }}
        />
      )
    }

    // Show empty state if no workspaces found
    if (workspaces.length === 0) {
      return (
        <StateRenderer
          state={StateType.EMPTY}
          data={{
            message: translate("noWorkspacesFound"),
            actions: [
              {
                label: translate("retry"),
                onClick: loadWorkspaces,
              },
              {
                label: translate("back"),
                onClick: onBack || noOp,
              },
            ],
          }}
        />
      )
    }

    // Render workspace options (replacing the old hardcoded export options)
    return (
      <div style={STYLES.button.column}>
        {workspaces.map((workspace) => (
          <Button
            key={workspace.name}
            text={workspace.title || workspace.name}
            icon={listIcon}
            style={STYLES.button.text}
            onClick={() => handleWorkspaceSelect(workspace.name)}
            tooltip={workspace.description}
            tooltipDisabled={true}
            logging={{ enabled: true, prefix: "FME-Export-WorkspaceSelection" }}
          />
        ))}
      </div>
    )
  }

  const renderExportForm = () => {
    if (!onFormBack || !onFormSubmit) {
      return (
        <StateRenderer
          state={StateType.ERROR}
          data={{
            message: "Export form configuration missing",
            actions: [
              {
                label: translate("back") || "Back",
                onClick: onBack || noOp,
              },
            ],
          }}
        />
      )
    }

    // Use the integrated Export component that handles both static and dynamic forms
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
    // Handle order result state
    if (state === ViewMode.ORDER_RESULT && orderResult) {
      console.log("FME Export - Displaying order result:", orderResult)

      if (orderResult.success) {
        return (
          <>
            <div style={STYLES.typography.title}>
              {translate("orderConfirmation")}
            </div>
            <div style={STYLES.typography.caption}>
              {translate("jobId")}: {orderResult.jobId}
            </div>
            {orderResult.workspaceName && (
              <div style={STYLES.typography.caption}>
                {translate("workspace")}: {orderResult.workspaceName}
              </div>
            )}
            {orderResult.email && (
              <div style={STYLES.typography.caption}>
                {translate("notificationEmail")}: {orderResult.email}
              </div>
            )}
            {orderResult.downloadUrl && (
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
            <div style={STYLES.typography.caption}>
              {translate("emailNotificationSent")}
            </div>
            <Button
              text={translate("reuseGeography")}
              onClick={onReuseGeography}
              logging={{ enabled: true, prefix: "FME-Export" }}
            />
          </>
        )
      } else {
        console.error("FME Export - Order failed:", orderResult)

        return (
          <>
            <div style={STYLES.typography.title}>
              {translate("orderSentError")}
            </div>
            <div style={STYLES.typography.caption}>{orderResult.message}</div>
            {orderResult.code && (
              <div style={STYLES.typography.caption}>
                {translate("errorCode")}: {orderResult.code}
              </div>
            )}
            {orderResult.workspaceName && (
              <div style={STYLES.typography.caption}>
                {translate("workspace")}: {orderResult.workspaceName}
              </div>
            )}
            <Button
              text={translate("retry")}
              onClick={onBack || noOp}
              logging={{ enabled: true, prefix: "FME-Export" }}
            />
          </>
        )
      }
    }

    // Handle submission loading with StateRenderer
    if (isSubmittingOrder) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: translate("submittingOrder"),
          }}
        />
      )
    }

    // Handle general error states
    if (error) {
      if (error.severity === "info") {
        return (
          <>
            <div style={STYLES.typography.caption}>{error.message}</div>
          </>
        )
      } else {
        return (
          <>
            <div style={STYLES.typography.caption}>{error.message}</div>
            <Button
              text={translate("retry")}
              onClick={() => {
                onBack?.()
              }}
              logging={{ enabled: true, prefix: "FME-Export" }}
            />
          </>
        )
      }
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
      <AnimationComponent
        key="fme-content-stable"
        parentId="fme-export-content"
        type={AnimationType.FadeIn}
        style={STYLES.content}
        configType={AnimationEffectType.Slow}
        trigger={AnimationTriggerType.Manual}
        playId={playId}
      >
        {renderContent()}
      </AnimationComponent>
    </div>
  )
}
