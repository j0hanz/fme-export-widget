import { React, hooks } from "jimu-core"
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
  /* intentionally blank */
}

// Render order result
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
      {/* Unified final status/message row for both success & failure */}
      {(isSuccess || orderResult.message) && (
        <div style={STYLES.typography.caption}>
          {isSuccess ? translate("emailNotificationSent") : orderResult.message}
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
    if (!fmeClient || !config || isLoadingWorkspaces) return
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
      if (err?.name === "CancelledPromiseError" || !isMountedRef.current) return
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
      } catch (err: any) {
        if (err?.name === "CancelledPromiseError" || !isMountedRef.current)
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
  }, [state])

  // Header
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
    // Loading state
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

    // Error state
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
        {/* Drawing mode */}
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
    if (isLoadingWorkspaces) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: workspaces.length
              ? translate("loadingWorkspaceDetails")
              : translate("loadingWorkspaces"),
          }}
        />
      )
    }
    if (workspaceError) {
      return (
        <StateRenderer
          state={StateType.ERROR}
          data={{
            message: workspaceError,
            actions: [
              { label: translate("retry"), onClick: loadWorkspaces },
              { label: translate("back"), onClick: onBack || noOp },
            ],
          }}
        />
      )
    }
    if (!workspaces.length) {
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
    return (
      <div style={UI_CSS.BTN.DEFAULT}>
        {workspaces.map((w) => (
          <Button
            key={w.name}
            text={w.title || w.name}
            icon={listIcon}
            onClick={() => handleWorkspaceSelect(w.name)}
            tooltip={w.description}
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
    // Order result
    if (state === ViewMode.ORDER_RESULT && orderResult) {
      console.log("FME Export - Displaying order result:", orderResult)

      return renderOrderResult(orderResult, translate, {
        onReuseGeography,
        onBack,
      })
    }

    // Submission loading
    if (isSubmittingOrder) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{ message: translate("submittingOrder") }}
        />
      )
    }

    // General error
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
      <div style={STYLES.content}> {renderContent()}</div>
    </div>
  )
}
