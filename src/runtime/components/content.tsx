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

// Unified order result renderer (replaces separate success/failure functions)
const renderOrderResult = (
  orderResult: any,
  translate: (k: string) => string,
  opts: { onReuseGeography?: () => void; onBack?: () => void }
) => {
  const isSuccess = !!orderResult.success
  const rows: React.ReactNode[] = []
  const addRow = (label?: string, value?: any) => {
    if (value === undefined || value === null || value === "") return
    rows.push(
      <div style={STYLES.typography.caption} key={`${label}-${value}`}>
        {label ? `${label}: ${value}` : value}
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
      {!isSuccess && (
        <div style={STYLES.typography.caption}>{orderResult.message}</div>
      )}
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
      {isSuccess && (
        <div style={STYLES.typography.caption}>
          {translate("emailNotificationSent")}
        </div>
      )}
      <Button
        text={isSuccess ? translate("reuseGeography") : translate("retry")}
        onClick={isSuccess ? opts.onReuseGeography : opts.onBack || noOp}
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
  // Drawing mode props
  drawingMode = DrawingTool.POLYGON,
  onDrawingModeChange,
  // Real-time measurement props
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

  // Create FME client when config changes - this is a legitimate use of useMemo
  // since creating the client involves API configuration setup
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

  const renderDrawing = () => (
    <div style={STYLES.typography.instructionText}>{instructionText}</div>
  )

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

      return renderOrderResult(orderResult, translate, {
        onReuseGeography,
        onBack,
      })
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
