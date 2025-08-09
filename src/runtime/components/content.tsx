import {
  React,
  hooks,
  AnimationComponent,
  AnimationType,
  AnimationTriggerType,
  AnimationEffectType,
} from "jimu-core"
import { Button, Select, Dropdown, UI_CSS } from "./ui"
import { StateRenderer } from "./state"
import defaultMessages from "./translations/default"
import type {
  ContentProps,
  DropdownItemConfig,
  WorkspaceItem,
} from "../../shared/types"
import { ViewMode, DrawingTool, StateType } from "../../shared/types"
import polygonIcon from "../../assets/icons/polygon.svg"
import rectangleIcon from "../../assets/icons/rectangle.svg"
import resetIcon from "../../assets/icons/clear-selection-general.svg"
import listIcon from "../../assets/icons/menu.svg"
import plusIcon from "../../assets/icons/plus.svg"
import { STYLES } from "../../shared/css"
import { Export } from "./exports"
import { createFmeFlowClient } from "../../shared/api"

const noOp = (): void => {
  // No operation - intentionally empty
}

// Helper function to get translation with fallback
const getTranslation = (
  translate: (key: string) => string,
  key: string,
  fallback: string
): string => {
  return translate(key) || fallback
}

// Helper function to create error state for workspace operations
const createWorkspaceErrorState = (
  message: string,
  loadWorkspaces: () => void,
  onBack?: () => void
) => ({
  state: StateType.ERROR,
  data: {
    message,
    actions: [
      { label: "Retry", onClick: loadWorkspaces },
      ...(onBack ? [{ label: "Back", onClick: onBack }] : []),
    ],
  },
})

// Helper function to render order success details
const renderOrderSuccess = (
  orderResult: any,
  translate: (key: string) => string,
  onReuseGeography?: () => void
) => (
  <>
    <div style={STYLES.typography.title}>{translate("orderConfirmation")}</div>
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
      tooltip={translate("tooltipReuseGeography")}
      tooltipPlacement="bottom"
    />
  </>
)

// Helper function to render order failure details
const renderOrderFailure = (
  orderResult: any,
  translate: (key: string) => string,
  onBack?: () => void
) => (
  <>
    <div style={STYLES.typography.title}>{translate("orderSentError")}</div>
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
  // Drawing mode props
  drawingMode = DrawingTool.POLYGON,
  onDrawingModeChange,
  // Real-time measurement props
  realTimeMeasurements,
  formatRealTimeMeasurements,
  // Reset props
  onReset,
  canReset = true,
  // Workspace-related props
  config,
  onWorkspaceSelected,
  selectedWorkspace,
  workspaceParameters,
  workspaceItem,
}) => {
  const translate = hooks.useTranslation(defaultMessages)
  const makeCancelable = hooks.useCancelablePromiseMaker()

  // Memoized FME client to avoid recreation on every render
  const fmeClient = React.useMemo(() => {
    return config ? createFmeFlowClient(config) : null
  }, [config])

  // Workspace selection state - moved to top level to avoid hook usage in render functions
  const [workspaces, setWorkspaces] = React.useState<readonly WorkspaceItem[]>(
    []
  )
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = React.useState(false)
  const [workspaceError, setWorkspaceError] = React.useState<string | null>(
    null
  )

  // Guard against setState on unmounted component during async flows
  const isMountedRef = React.useRef(true)
  hooks.useEffectOnce(() => {
    return () => {
      isMountedRef.current = false
    }
  })

  // Generate stable animation ID based on current state
  const playId = `${state}-${!!error}-none`.length

  // Load workspaces function - simplified with helper
  const loadWorkspaces = hooks.useEventCallback(async () => {
    if (!fmeClient || !config) return

    setIsLoadingWorkspaces(true)
    setWorkspaceError(null)

    try {
      const response = await makeCancelable(
        fmeClient.getRepositoryItems(config.repository, "WORKSPACE")
      )

      if (response.status === 200 && response.data.items) {
        const workspaceItems = response.data.items.filter(
          (item) => item.type === "WORKSPACE"
        )
        if (isMountedRef.current) setWorkspaces(workspaceItems)
      } else {
        throw new Error(translate("failedToLoadWorkspaces"))
      }
    } catch (err) {
      if (err.name !== "CancelledPromiseError" && isMountedRef.current) {
        const errorMessage =
          err instanceof Error ? err.message : translate("unknownErrorOccurred")
        setWorkspaceError(
          `${translate("failedToLoadWorkspaces")}: ${errorMessage}`
        )
      }
    } finally {
      if (isMountedRef.current) setIsLoadingWorkspaces(false)
    }
  })

  // Handle workspace selection - simplified
  const handleWorkspaceSelect = hooks.useEventCallback(
    async (workspaceName: string) => {
      if (!fmeClient || !config) return

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
      } catch (err) {
        if (err.name !== "CancelledPromiseError" && isMountedRef.current) {
          const errorMessage =
            err instanceof Error
              ? err.message
              : translate("unknownErrorOccurred")
          setWorkspaceError(
            `${translate("failedToLoadWorkspaceDetails")}: ${errorMessage}`
          )
        }
      } finally {
        if (isMountedRef.current) setIsLoadingWorkspaces(false)
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
        {/* Drawing Mode Selector */}
        <div style={UI_CSS.BTN.ROW}>
          <Select
            value={drawingMode}
            onChange={(value) => {
              onDrawingModeChange?.(value as DrawingTool)
            }}
            style={UI_CSS.BTN.SELECT}
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
      const loadingMessage =
        workspaces.length > 0
          ? getTranslation(
              translate,
              "loadingWorkspaceDetails",
              "Loading workspace details..."
            )
          : getTranslation(
              translate,
              "loadingWorkspaces",
              "Loading workspaces..."
            )

      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{ message: loadingMessage }}
        />
      )
    }

    // Show error state if failed to load workspaces
    if (workspaceError) {
      return (
        <StateRenderer
          {...createWorkspaceErrorState(workspaceError, loadWorkspaces, onBack)}
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
              { label: translate("retry"), onClick: loadWorkspaces },
              { label: translate("back"), onClick: onBack || noOp },
            ],
          }}
        />
      )
    }

    // Render workspace options
    return (
      <div style={UI_CSS.BTN.DEFAULT}>
        {workspaces.map((workspace) => (
          <Button
            key={workspace.name}
            text={workspace.title || workspace.name}
            icon={listIcon}
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
            actions: [{ label: translate("back"), onClick: onBack || noOp }],
          }}
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
    // Handle order result state
    if (state === ViewMode.ORDER_RESULT && orderResult) {
      console.log("FME Export - Displaying order result:", orderResult)

      if (orderResult.success) {
        return renderOrderSuccess(orderResult, translate, onReuseGeography)
      } else {
        console.error("FME Export - Order failed:", orderResult)
        return renderOrderFailure(orderResult, translate, onBack)
      }
    }

    // Handle submission loading with StateRenderer
    if (isSubmittingOrder) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{ message: translate("submittingOrder") }}
        />
      )
    }

    // Handle general error states with consistent StateRenderer pattern
    if (error) {
      return (
        <StateRenderer
          state={StateType.ERROR}
          data={{
            message: error.message,
            actions:
              error.severity !== "info"
                ? [{ label: translate("retry"), onClick: onBack || noOp }]
                : undefined,
          }}
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
