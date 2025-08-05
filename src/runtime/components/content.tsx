import {
  React,
  hooks,
  AnimationComponent,
  AnimationType,
  AnimationTriggerType,
  AnimationEffectType,
} from "jimu-core"
import { Label } from "jimu-ui"
import { Button, ButtonGroup, Input, Select, Tooltip, Dropdown } from "./ui"
import { StateRenderer } from "./state"
import defaultMessages from "../../translations/default"
import type { ContentProps, DropdownItemConfig } from "../../shared/types"
import {
  ViewMode,
  DrawingTool,
  StateType,
  TEMPLATE_VALIDATION_RULES,
} from "../../shared/types"
import { validateSingleTemplateName } from "../../shared/utils"
import polygonIcon from "../../assets/icons/polygon.svg"
import saveIcon from "../../assets/icons/save.svg"
import trashIcon from "../../assets/icons/trash.svg"
import plusIcon from "../../assets/icons/plus.svg"
import folderIcon from "../../assets/icons/folder.svg"
import backIcon from "../../assets/icons/arrow-left.svg"
import listIcon from "../../assets/icons/menu.svg"
import rectangleIcon from "../../assets/icons/rectangle.svg"
import freehandIcon from "../../assets/icons/edit.svg"
import resetIcon from "../../assets/icons/clear-selection-general.svg"
import exportIcon from "../../assets/icons/export.svg"
import importIcon from "../../assets/icons/import.svg"
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
  // Template-related props
  templates = [],
  templateName = "",
  onLoadTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  onTemplateNameChange,
  onBack,
  drawnArea,
  formatArea,
  isTemplateLoading = false,
  // Drawing mode props
  drawingMode = DrawingTool.POLYGON,
  onDrawingModeChange,
  // Real-time measurement props
  realTimeMeasurements,
  formatRealTimeMeasurements,
  // Header props
  showHeaderActions = false,
  onReset,
  showSaveButton = false,
  showFolderButton = false,
  onSaveTemplateFromHeader,
  onShowTemplateFolder,
  canSaveTemplate = true,
  canLoadTemplate = true,
  canReset = true,
  // Template import/export props
  onExportTemplates,
  onExportSingleTemplate,
  onImportTemplates,
  isImportingTemplates = false,
  isExportingTemplates = false,
  importError,
  exportError,
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

  // Template validation logic using utility function
  const name = (templateName || "").trim()
  const validationResult = validateSingleTemplateName(name, [...templates])
  const validation = {
    ...validationResult.errors,
    hasMaxTemplates:
      templates.length >= TEMPLATE_VALIDATION_RULES.MAX_TEMPLATES,
    name,
  }

  const isValid = validationResult.isValid && !validation.hasMaxTemplates

  const onChange = hooks.useEventCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onTemplateNameChange?.(event.target.value)
    }
  )

  const onLoad = hooks.useEventCallback((templateId: string) => {
    onLoadTemplate?.(templateId)
  })

  const onDelete = hooks.useEventCallback((templateId: string) => {
    if (onDeleteTemplate) {
      onDeleteTemplate(templateId)
    }
  })

  const onClick = hooks.useEventCallback(() => {
    onBack?.()
  })

  const onCancel = hooks.useEventCallback(() => {
    onBack?.()
  })

  const onSave = hooks.useEventCallback(() => {
    if (!isValid) {
      return
    }

    if (drawnArea === null || drawnArea === undefined) {
      return
    }

    onSaveTemplate?.(validation.name)
  })

  // Handle export templates
  const handleExportTemplates = hooks.useEventCallback(() => {
    if (onExportTemplates) {
      onExportTemplates()
    }
  })

  // Handle import templates via file input
  const handleImportTemplates = hooks.useEventCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file && onImportTemplates) {
        onImportTemplates(file)
        // Clear the file input so the same file can be selected again
        event.target.value = ""
      }
    }
  )

  // Create a hidden file input ref for import functionality
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const triggerFileImport = hooks.useEventCallback(() => {
    fileInputRef.current?.click()
  })

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
    // Check if template functionality is available
    const canUseTemplates = templates.length > 0 || canSaveTemplate

    const dropdownItems: DropdownItemConfig[] = [
      {
        id: "load-template",
        label: translate("loadTemplate"),
        icon: folderIcon,
        onClick: onShowTemplateFolder || noOp,
        disabled:
          !canLoadTemplate ||
          !onShowTemplateFolder ||
          !showFolderButton ||
          !canUseTemplates,
        tooltip: canUseTemplates
          ? translate("tooltipLoadTemplate")
          : translate("templateStorageUnavailable"),
      },
      {
        id: "save-template",
        label: translate("saveTemplateName"),
        icon: saveIcon,
        onClick: onSaveTemplateFromHeader || noOp,
        disabled:
          !canSaveTemplate || !onSaveTemplateFromHeader || !showSaveButton,
        tooltip: canSaveTemplate
          ? translate("tooltipSaveTemplate")
          : translate("templateStorageUnavailable"),
      },
      {
        id: "export-templates",
        label: translate("exportTemplates"),
        icon: exportIcon,
        onClick: handleExportTemplates,
        disabled: templates.length === 0,
        tooltip:
          templates.length === 0
            ? translate("noTemplatesFound")
            : translate("downloadTemplates"),
      },
      {
        id: "import-templates",
        label: translate("importTemplates"),
        icon: importIcon,
        onClick: triggerFileImport,
        disabled: validation.hasMaxTemplates,
        tooltip: validation.hasMaxTemplates
          ? translate("templateLimitReached")
          : translate("selectTemplateFile"),
      },
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
              {
                value: DrawingTool.FREEHAND,
                label: translate("drawingModeFreehand"),
                icon: freehandIcon,
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

  const renderTemplateManager = () => {
    // Show loading state with StateRenderer for template operations
    if (isTemplateLoading) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: translate("loadingTemplates"),
          }}
        />
      )
    }

    // Show empty state with StateRenderer when no templates exist
    if (templates.length === 0) {
      return (
        <StateRenderer
          state={StateType.EMPTY}
          data={{
            message: translate("noTemplatesFound"),
            detail: translate("createYourFirstTemplate"),
            actions: [
              {
                label: translate("back"),
                onClick: onClick,
                variant: "secondary" as const,
              },
            ],
          }}
        />
      )
    }

    return (
      <>
        <div style={STYLES.typography.title}>{translate("loadTemplate")}</div>
        <Label style={STYLES.typography.label} className="d-block">
          {translate("availableTemplates")}: {templates.length}/
          {TEMPLATE_VALIDATION_RULES.MAX_TEMPLATES}
        </Label>
        <div style={STYLES.button.column}>
          {templates.map((template) => (
            <div key={template.id} style={STYLES.button.row}>
              <Button
                text={template.name}
                icon={folderIcon}
                onClick={() => onLoad(template.id)}
                logging={{
                  enabled: true,
                  prefix: "FME-Export-Template",
                }}
                style={STYLES.button.text}
                tooltip={`${translate("loadTemplate")}: ${template.name}`}
                tooltipPlacement="bottom"
              />
              <Dropdown
                items={[
                  {
                    id: "export",
                    label: translate("exportTemplate"),
                    icon: exportIcon,
                    onClick: () => {
                      onExportSingleTemplate?.(template.id)
                    },
                    disabled: !onExportSingleTemplate,
                    tooltip: translate("downloadTemplate"),
                  },
                  {
                    id: "delete",
                    label: translate("deleteTemplate"),
                    icon: trashIcon,
                    onClick: () => {
                      onDelete(template.id)
                    },
                    tooltip: translate("deleteTemplate"),
                  },
                ]}
                buttonIcon={listIcon}
                logging={{
                  enabled: true,
                  prefix: "FME-Export-Template",
                }}
                style={STYLES.button.select}
              />
            </div>
          ))}
        </div>

        <Button
          text={translate("back")}
          icon={backIcon}
          onClick={onClick}
          className="mt-5"
          logging={{ enabled: true, prefix: "FME-Export-Template" }}
        />
      </>
    )
  }

  const renderSaveTemplate = () => {
    if (isTemplateLoading) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: translate("savingTemplate"),
          }}
        />
      )
    }

    return (
      <>
        <div style={STYLES.typography.title}>
          {translate("saveTemplateName")}
        </div>
        <>
          <Label
            style={STYLES.typography.label}
            className="d-block"
            for="template-name-input"
          >
            {translate("templateName")}
            <Tooltip content={translate("requiredField")} placement="bottom">
              <span
                style={STYLES.typography.required}
                aria-label={translate("required")}
                role="img"
                aria-hidden="false"
              >
                *
              </span>
            </Tooltip>
          </Label>
          <Input
            id="template-name-input"
            placeholder={translate("templateNamePlaceholder")}
            value={templateName || ""}
            onChange={onChange}
            required={true}
            maxLength={TEMPLATE_VALIDATION_RULES.MAX_NAME_LENGTH}
            logging={{ enabled: true, prefix: "FME-Export-Template" }}
            style={
              !validation.nameEmpty && !isValid
                ? STYLES.form.inputInvalid
                : STYLES.form.input
            }
            aria-describedby="template-name-help template-name-error"
            aria-invalid={!isValid}
            // Add visual feedback for validation state
            className={!validation.nameEmpty && !isValid ? "is-invalid" : ""}
          />
          <div id="template-name-help" style={STYLES.typography.caption}>
            {(templateName || "").length}/
            {TEMPLATE_VALIDATION_RULES.MAX_NAME_LENGTH}{" "}
            {translate("characters")}
          </div>
          {/* Validation error messages */}
          <div id="template-name-error" role="alert" aria-live="polite">
            {validation.nameEmpty && (templateName || "").length > 0 && (
              <div style={STYLES.typography.caption}>
                {translate("templateNameRequired")}
              </div>
            )}
            {validation.nameTooLong && (
              <div style={STYLES.typography.caption}>
                {translate("templateNameTooLong")}
              </div>
            )}
            {validation.nameExists &&
              !validation.nameEmpty &&
              !validation.nameTooLong && (
                <div style={STYLES.typography.caption}>
                  {translate("templateNameExists")}
                </div>
              )}
            {validation.hasInvalidChars &&
              !validation.nameEmpty &&
              !validation.nameTooLong && (
                <div style={STYLES.typography.caption}>
                  {translate("templateNameInvalidChars")}
                </div>
              )}
            {validation.hasMaxTemplates && (
              <div style={STYLES.typography.caption}>
                {translate("maxTemplatesError")}
              </div>
            )}
          </div>
        </>

        <ButtonGroup
          className="mt-5"
          leftButton={{
            text: translate("back"),
            onClick: onCancel,
          }}
          rightButton={{
            text: translate("saveTemplateName"),
            onClick: onSave,
            disabled: validation.hasMaxTemplates || !isValid,
          }}
          logging={{ enabled: true, prefix: "FME-Export-Template" }}
        />
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
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: translate("loadingWorkspaces") || "Loading workspaces...",
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

    // Handle template loading state
    if (isTemplateLoading) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: translate("loadingTemplate"),
          }}
        />
      )
    }

    // Handle template export state
    if (isExportingTemplates) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: translate("exportingTemplates"),
          }}
        />
      )
    }

    // Handle template import state
    if (isImportingTemplates) {
      return (
        <StateRenderer
          state={StateType.LOADING}
          data={{
            message: translate("importingTemplates"),
          }}
        />
      )
    }

    // Handle export error state
    if (exportError) {
      return (
        <StateRenderer
          state={StateType.ERROR}
          data={{
            error: exportError,
            actions: [
              {
                label: translate("retry"),
                onClick: handleExportTemplates,
                variant: "primary" as const,
              },
            ],
          }}
        />
      )
    }

    // Handle import error state
    if (importError) {
      return (
        <StateRenderer
          state={StateType.ERROR}
          data={{
            error: importError,
            actions: [
              {
                label: translate("retry"),
                onClick: triggerFileImport,
                variant: "primary" as const,
              },
            ],
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
      case ViewMode.TEMPLATE_MANAGER:
        return renderTemplateManager()
      case ViewMode.SAVE_TEMPLATE:
        return renderSaveTemplate()
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
      {/* Hidden file input for template import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportTemplates}
        style={{ display: "none" }}
        aria-label={
          translate("selectTemplateFile") || "Select template file for import"
        }
        tabIndex={-1}
      />
    </div>
  )
}
