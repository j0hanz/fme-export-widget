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
  UrlInput,
} from "./ui"
import { DynamicField } from "./fields"
import defaultMessages from "./translations/default"
import { defaultMessages as jimuDefaultMessages } from "jimu-ui"
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
  type VisibilityState,
  ViewMode,
  DrawingTool,
  FormFieldType,
  ParameterType,
  makeLoadingView,
  makeEmptyView,
  ErrorType,
  type SerializableErrorState,
  ErrorSeverity,
  makeErrorView,
  MS_LOADING,
  WORKSPACE_ITEM_TYPE,
  useUiStyles,
} from "../../config/index"
import polygonIcon from "../../assets/icons/polygon.svg"
import rectangleIcon from "../../assets/icons/rectangle.svg"
import itemIcon from "../../assets/icons/item.svg"
import { ParameterFormService } from "../../shared/services"
import {
  validateDateTimeFormat,
  getSupportEmail,
} from "../../shared/validations"
import {
  resolveMessageOrKey,
  buildSupportHintText,
  maskEmailForDisplay,
  stripHtmlToText,
  stripErrorLabel,
  initFormValues,
  canResetButton,
  shouldShowWorkspaceLoading,
  toTrimmedString,
  toTrimmedStringOrEmpty,
  formatByteSize,
  isAbortError,
  isNonEmptyTrimmedString,
  createFmeDispatcher,
} from "../../shared/utils"
import {
  useFormStateManager,
  useDebounce,
  useWorkspaces,
  useWorkspaceItem,
} from "../../shared/hooks"
import { VisibilityEvaluator } from "../../shared/visibility"

// Tillgängliga ritverktyg för AOI-ritning (polygon och rektangel)
const DRAWING_MODE_TABS = [
  {
    value: DrawingTool.POLYGON,
    label: "optPolygon",
    icon: polygonIcon,
    tooltip: "tipDrawPolygon",
    hideLabel: true,
  },
  {
    value: DrawingTool.RECTANGLE,
    label: "optRectangle",
    icon: rectangleIcon,
    tooltip: "tipDrawRectangle",
    hideLabel: true,
  },
] as const

// Tom konstant för workspace-listor
const EMPTY_WORKSPACES: readonly WorkspaceItem[] = Object.freeze([])

// Standardvärden för laddningsstatus
const DEFAULT_LOADING_STATE: LoadingState = Object.freeze({
  modules: false,
  submission: false,
  workspaces: false,
  parameters: false,
})

// Jämför två laddningsstatus-objekt för likhet
const loadingStatesEqual = (a: LoadingState, b: LoadingState): boolean =>
  a.modules === b.modules &&
  a.submission === b.submission &&
  a.workspaces === b.workspaces &&
  a.parameters === b.parameters

// Kontrollerar om någon laddningsflagg är aktiv
const isLoadingActive = (state: LoadingState): boolean =>
  Boolean(
    state.modules || state.submission || state.workspaces || state.parameters
  )

// Formaterar ordervärden för visning (stöder olika typer)
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
    if (!Number.isFinite(time)) return null
    try {
      return value.toISOString()
    } catch {
      return null
    }
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

/*
 * Hanterar nedladdnings-URL för remote URL eller Blob-objekt.
 * Skapar och städar upp object URLs automatiskt vid komponentlivscykel.
 */
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

    const trimmedUrl = toTrimmedStringOrEmpty(remoteUrl)
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

// Serialiserar geometri-objekt till JSON-sträng säkert
const safeStringifyGeometry = (geometry: unknown): string => {
  if (!geometry) return ""
  try {
    return JSON.stringify(geometry)
  } catch {
    return ""
  }
}

// Extraherar unika geometrifältnamn från workspace-parametrar
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

/*
 * Skapar formvalidering för workspace-parametrar och schemafält.
 * Returnerar validator-objekt med metoder för konfiguration och validering.
 */
const createFormValidator = (
  parameterService: ParameterFormService,
  workspaceParameters: readonly WorkspaceParameter[],
  getEvaluatedFields?: () => readonly DynamicFieldConfig[] | undefined
) => {
  const getFormConfig = () =>
    parameterService.convertParametersToFields(workspaceParameters)

  const getFieldsForValidation = () => {
    const evaluated = getEvaluatedFields?.()
    if (evaluated && evaluated.length > 0) {
      return evaluated
    }
    return getFormConfig()
  }

  const validateValues = (values: FormValues) => {
    const baseValidation = parameterService.validateFormValues(
      values,
      getFieldsForValidation()
    )
    const errors = { ...baseValidation.errors }

    // Validerar schema-startfältets format när det anges
    const startRaw = values.start
    if (isNonEmptyTrimmedString(startRaw)) {
      try {
        if (!validateDateTimeFormat(startRaw.trim())) {
          errors.start = "invalidDateTimeFormat"
        }
      } catch {
        errors.start = "invalidDateTimeFormat"
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    }
  }

  const initializeValues = () => initFormValues(getFormConfig())
  return { getFormConfig, validateValues, initializeValues }
}

/*
 * OrderResult: Visar jobbresultat efter FME Flow-inlämning.
 * Hanterar visning av nedladdningslänkar, metadata och felmeddelanden.
 */
const OrderResult: React.FC<OrderResultProps> = ({
  orderResult,
  translate,
  onReuseGeography,
  onBack,
  onReset,
  config,
}) => {
  const styles = useUiStyles()
  const isCancelled = Boolean(orderResult.cancelled)
  const isSuccess = !isCancelled && !!orderResult.success
  const isFailure = !isCancelled && !isSuccess
  const fallbackMode: ServiceMode = config?.syncMode ? "sync" : "async"
  const serviceMode: ServiceMode =
    orderResult.serviceMode === "sync" || orderResult.serviceMode === "async"
      ? orderResult.serviceMode
      : fallbackMode
  const downloadUrl = useDownloadResource(
    orderResult.downloadUrl,
    orderResult.blob
  )

  // Bygger informationsrader för orderresultat-vy
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

  addInfoRow(translate("lblJobId"), orderResult.jobId)
  addInfoRow(translate("lblWorkspace"), orderResult.workspaceName)

  const deliveryModeKey =
    serviceMode === "async" ? "optAsyncMode" : "optSyncMode"
  addInfoRow(translate("lblDelivery"), translate(deliveryModeKey))

  if (orderResult.downloadFilename) {
    addInfoRow(translate("lblFilename"), orderResult.downloadFilename)
  }

  const statusValue = toTrimmedString(orderResult.status)
  if (statusValue) {
    addInfoRow(translate("lblFmeStatus"), statusValue)
  }

  const statusMessage = toTrimmedString(orderResult.statusMessage)
  if (statusMessage && statusMessage !== toTrimmedString(orderResult.message)) {
    addInfoRow(translate("lblFmeMessage"), statusMessage)
  }

  const blobType = toTrimmedString(orderResult.blobMetadata?.type)
  if (blobType) {
    addInfoRow(translate("lblBlobType"), blobType)
  }

  const blobSizeFormatted = formatByteSize(orderResult.blobMetadata?.size)
  if (blobSizeFormatted) {
    addInfoRow(translate("lblBlobSize"), blobSizeFormatted)
  }

  if (serviceMode !== "sync") {
    const emailVal = orderResult.email
    const masked =
      config?.maskEmailOnSuccess && isSuccess
        ? maskEmailForDisplay(emailVal)
        : emailVal
    addInfoRow(translate("lblEmail"), masked)
  }

  // Visar felkod endast vid misslyckad order
  if (orderResult.code && isFailure) {
    addInfoRow(translate("lblErrorCode"), orderResult.code)
  }

  const titleText = isCancelled
    ? translate("titleOrderCancelled")
    : isSuccess
      ? serviceMode === "sync"
        ? translate("titleOrderComplete")
        : translate("titleOrderConfirmed")
      : translate("titleOrderFailed")

  const buttonText = isCancelled
    ? translate("btnNewOrder")
    : isSuccess
      ? translate("btnReuseArea")
      : translate("btnRetry")

  const primaryTooltip = isCancelled
    ? translate("tipNewOrder")
    : isSuccess
      ? translate("tipReuseArea")
      : undefined

  const handlePrimary = hooks.useEventCallback(() => {
    if (isCancelled || isSuccess) {
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

  // Bygger meddelande baserat på orderstatus och typ
  let messageText: string | null = null
  if (isCancelled) {
    const failureCode = (orderResult.code || "").toString().toUpperCase()
    const isTimeout = failureCode.includes("TIMEOUT")
    messageText = isTimeout
      ? translate("msgOrderTimeout")
      : translate("msgOrderCancelled")
  } else if (isSuccess) {
    if (serviceMode === "async") {
      messageText = translate("msgEmailSent")
    }
  } else {
    const failureCode = (orderResult.code || "").toString().toUpperCase()
    const rawMessage =
      toTrimmedString(orderResult.message) ||
      toTrimmedString(orderResult.statusMessage) ||
      ""

    if (failureCode === "FME_JOB_CANCELLED_TIMEOUT") {
      messageText = translate("msgJobTimeout")
    } else if (failureCode === "FME_JOB_CANCELLED") {
      messageText = translate("msgJobCancelled")
    } else if (
      failureCode === "FME_JOB_FAILURE" ||
      /FME\s*Flow\s*transformation\s*failed/i.test(rawMessage)
    ) {
      messageText = translate("errTransformFailed")
    } else if (rawMessage) {
      messageText = rawMessage
    } else {
      messageText = translate("msgJobFailed")
    }
  }

  return (
    <div css={styles.form.layout}>
      <div css={styles.form.content}>
        <div css={styles.form.body}>
          <div css={styles.typo.title}>{titleText}</div>
          {infoRows}

          {showDownloadLink && (
            <div css={styles.typo.caption}>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                css={styles.typo.link}
                download={orderResult.downloadFilename}
              >
                {translate("btnDownload")}
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
              text: translate("btnEnd"),
              onClick: handleEnd,
              tooltip: translate("tipCancel"),
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

/*
 * ExportForm: Dynamisk formulärgenerering för workspace-parametrar.
 * Hanterar inmatning, validering och inlämning av FME-jobb.
 */
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
  jimuMapView,
}) => {
  const reduxDispatch = ReactRedux.useDispatch()
  const fmeDispatchRef = React.useRef(
    createFmeDispatcher(reduxDispatch, widgetId)
  )
  hooks.useUpdateEffect(() => {
    fmeDispatchRef.current = createFmeDispatcher(reduxDispatch, widgetId)
  }, [reduxDispatch, widgetId])
  const fmeDispatch = fmeDispatchRef.current
  const [parameterService] = React.useState(() => new ParameterFormService())
  const [evaluatedFields, setEvaluatedFields] = React.useState<
    readonly DynamicFieldConfig[]
  >([])
  const evaluatedFieldsRef = React.useRef<readonly DynamicFieldConfig[]>([])
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

  // Extraherar och uppdaterar geometrifältnamn
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

  // Bygger lokalt valideringsmeddelande med aktuell översättning
  const errorMsg = hooks.useEventCallback((count: number): string =>
    count === 1 ? translate("valSingleError") : translate("valMultipleErrors")
  )

  // Skapar validator med aktuella parametrar - use ref to maintain stable reference
  const validatorRef = React.useRef<ReturnType<
    typeof createFormValidator
  > | null>(null)
  const prevParamsSignatureRef = React.useRef<string>("")
  const paramsSignature = workspaceParameters.map((p) => p.name).join(",")

  if (
    !validatorRef.current ||
    prevParamsSignatureRef.current !== paramsSignature
  ) {
    validatorRef.current = createFormValidator(
      parameterService,
      workspaceParameters,
      () => evaluatedFieldsRef.current
    )
    prevParamsSignatureRef.current = paramsSignature
  }

  const validator = validatorRef.current

  // Använder formulär-state-hanterare
  const formState = useFormStateManager(validator)

  // Validerar formulär vid montering och när beroenden ändras
  hooks.useEffectOnce(() => {
    formState.validateForm()
  })

  // Validerar formulär när värden ändras
  hooks.useUpdateEffect(() => {
    formState.validateForm()
  }, [formState.values, formState.validateForm])

  // Återställer värden när workspace eller fält ändras
  hooks.useUpdateEffect(() => {
    formState.resetForm()
    setFileMap({})
    evaluatedFieldsRef.current = []
    setEvaluatedFields([])
  }, [workspaceName, workspaceParameters, formState.resetForm])

  // Hanterar uppdatering av fält (inklusive filinmatning)
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
  const formValuesRef = hooks.useLatest(formValues)
  const recomputeVisibility = hooks.useEventCallback(() => {
    if (!validator) return

    const baseFields = validator.getFormConfig()
    const previousStates = new Map<string, VisibilityState | undefined>()
    for (const field of evaluatedFieldsRef.current) {
      previousStates.set(field.name, field.visibilityState)
    }

    const evaluator = new VisibilityEvaluator(
      formValuesRef.current || {},
      baseFields,
      previousStates
    )

    const nextFields = baseFields.map((field) => {
      const nextState = evaluator.evaluate(field.visibility, field.name)
      return {
        ...field,
        visibilityState: nextState,
      }
    })

    evaluatedFieldsRef.current = nextFields
    setEvaluatedFields(nextFields)

    const hiddenDisabledNames: string[] = []
    const nonVisibleNames: string[] = []

    for (const field of nextFields) {
      if (field.visibilityState === "hiddenDisabled") {
        hiddenDisabledNames.push(field.name)
      }
      if (
        field.visibilityState !== undefined &&
        field.visibilityState !== "visibleEnabled"
      ) {
        nonVisibleNames.push(field.name)
      }
    }

    let valuesCleared = false

    if (hiddenDisabledNames.length) {
      const currentValues = formValuesRef.current || {}
      let nextValues: FormValues | undefined

      hiddenDisabledNames.forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(currentValues, name)) {
          if (!nextValues) {
            nextValues = { ...currentValues }
          }
          delete (nextValues as { [key: string]: unknown })[name]
        }
      })

      if (nextValues) {
        valuesCleared = true
        setFormValues(nextValues)
      }

      setFileMap((prev) => {
        let next: typeof prev | null = null
        hiddenDisabledNames.forEach((name) => {
          if (
            Object.prototype.hasOwnProperty.call(prev, name) &&
            prev[name] !== null
          ) {
            if (!next) {
              next = { ...prev }
            }
            next[name] = null
          }
        })
        return next ?? prev
      })
    }

    if (nonVisibleNames.length) {
      const currentErrors = formState.errors
      let nextErrors: { [key: string]: string } | null = null

      nonVisibleNames.forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(currentErrors, name)) {
          if (!nextErrors) {
            nextErrors = { ...currentErrors }
          }
          delete nextErrors[name]
        }
      })

      if (nextErrors) {
        formState.setErrors(nextErrors)
        formState.setIsValid(Object.keys(nextErrors).length === 0)
      }
    }

    if (!valuesCleared) {
      formState.validateForm()
    }
  })

  hooks.useEffectOnce(() => {
    recomputeVisibility()
  })

  hooks.useUpdateEffect(() => {
    recomputeVisibility()
  }, [formValues, recomputeVisibility])

  hooks.useUpdateEffect(() => {
    recomputeVisibility()
  }, [validator, recomputeVisibility])

  // Synkroniserar geometrivärden med geometrifält i formuläret
  hooks.useEffectWithPreviousValues(() => {
    if (!geometryFieldNames.length) return
    const nextValue = geometryString || ""
    const currentValues = formValuesRef.current
    if (!currentValues) return

    const shouldUpdate = geometryFieldNames.some((name) => {
      const current = currentValues?.[name]
      const currentStr = typeof current === "string" ? current : ""
      return currentStr !== nextValue
    })

    if (!shouldUpdate) return

    const updated = { ...currentValues }
    geometryFieldNames.forEach((name) => {
      updated[name] = nextValue
    })
    setFormValues(updated)
  }, [geometryFieldNames, geometryString, formValuesRef, setFormValues])

  // Hanterar formulärinlämning med validering
  const handleSubmit = hooks.useEventCallback(() => {
    const validation = formState.validateForm()
    if (!validation.isValid) {
      const count = Object.keys(validation.errors).length
      const errorMessage = errorMsg(count)
      const error: SerializableErrorState = {
        message: errorMessage,
        type: ErrorType.VALIDATION,
        code: "FORM_INVALID",
        severity: ErrorSeverity.ERROR,
        recoverable: true,
        timestampMs: Date.now(),
        kind: "serializable",
        userFriendlyMessage: "",
        suggestion: "",
      }
      // Dispatch error to the store
      fmeDispatch.setError("general", error)
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

  // Tar bort HTML-taggar från text säkert
  const stripHtml = hooks.useEventCallback((html: string): string =>
    stripHtmlToText(html)
  )

  // Löser upp felmeddelanden (med översättning)
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
          : translate("titleConfigParams")
      }
      onBack={onBack}
      onSubmit={handleSubmit}
      isValid={formState.isValid}
      loading={isSubmitting}
    >
      {/* Removed Schedule fields component */}

      {/* Direct upload field - replaces remote dataset URL */}
      {config?.allowRemoteDataset && (
        <Field
          label={translate("lblUploadFile")}
          helper={translate("hintUploadFile")}
        >
          <DynamicField
            field={{
              name: "__upload_file__",
              label: translate("lblUploadFile"),
              type: FormFieldType.FILE,
              required: false,
              readOnly: false,
            }}
            value={formState.values.__upload_file__}
            onChange={(val) => setField("__upload_file__", val)}
            translate={translate}
            jimuMapView={jimuMapView}
          />
        </Field>
      )}

      {/* Remote dataset URL (opt_geturl) */}
      {config?.allowRemoteDataset && config?.allowRemoteUrlDataset && (
        <Field
          label={translate("lblRemoteUrl")}
          helper={translate("hintRemoteUrl")}
        >
          <UrlInput
            value={(formState.values.__remote_dataset_url__ as string) || ""}
            onChange={(val) => setField("__remote_dataset_url__", val)}
          />
        </Field>
      )}

      {/* Workspace parameters */}
      {evaluatedFields
        .filter((field) => {
          const state = field.visibilityState ?? "visibleEnabled"
          return state === "visibleEnabled" || state === "visibleDisabled"
        })
        .map((field) => {
          if (!field || !field.name || !field.type) {
            return null
          }

          const isInlineField =
            field.type === FormFieldType.SWITCH ||
            field.type === FormFieldType.CHECKBOX
          const disabled = field.visibilityState === "visibleDisabled"

          if (field.type === FormFieldType.MESSAGE) {
            return (
              <DynamicField
                key={field.name}
                field={field}
                value={formState.values[field.name]}
                onChange={(val) => setField(field.name, val)}
                translate={translate}
                disabled={disabled}
                jimuMapView={jimuMapView}
              />
            )
          }

          return (
            <Field
              key={field.name}
              label={field.label}
              required={field.required}
              error={resolveError(formState.errors[field.name])}
              helper={field.helper}
              check={isInlineField}
            >
              <DynamicField
                field={field}
                value={formState.values[field.name]}
                onChange={(val) => setField(field.name, val)}
                translate={translate}
                disabled={disabled}
                jimuMapView={jimuMapView}
              />
            </Field>
          )
        })
        .filter(Boolean)}
    </Form>
  )
}

/*
 * Workflow: Huvudkomponent som orkestera widget-vyer och användarflöden.
 * Hanterar ritning, workspace-val, formulär och jobbinlämning.
 */
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
  jimuMapView,
  // Workspace collection now arrives from the parent widget via props
  // Startup validation props
  isStartupValidating: _isStartupValidating,
  startupValidationStep,
  startupValidationError,
  onRetryValidation,
  submissionPhase = "idle",
  modeNotice,
}) => {
  const translate = hooks.useTranslation(defaultMessages, jimuDefaultMessages)
  const styles = useUiStyles()
  const reduxDispatch = ReactRedux.useDispatch()
  // Säkerställer icke-tomt widgetId för Redux-interaktioner
  const effectiveWidgetIdRef = React.useRef<string>()
  if (!effectiveWidgetIdRef.current) {
    effectiveWidgetIdRef.current =
      widgetId && widgetId.trim()
        ? widgetId
        : `__local_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }
  const effectiveWidgetId = effectiveWidgetIdRef.current
  const fmeDispatchRef = React.useRef(
    createFmeDispatcher(reduxDispatch, effectiveWidgetId)
  )
  hooks.useUpdateEffect(() => {
    fmeDispatchRef.current = createFmeDispatcher(
      reduxDispatch,
      effectiveWidgetId
    )
  }, [reduxDispatch, effectiveWidgetId])

  const incomingLoadingState = loadingStateProp ?? DEFAULT_LOADING_STATE
  // Latchar laddningsstatus med fördröjning för smidigare UI
  const [latchedLoadingState, setLatchedLoadingState] =
    React.useState<LoadingState>(incomingLoadingState)
  const latchedLoadingRef = hooks.useLatest(latchedLoadingState)
  const releaseLoadingState = useDebounce((next: LoadingState) => {
    setLatchedLoadingState(next)
  }, MS_LOADING)

  hooks.useEffectWithPreviousValues(() => {
    const current = latchedLoadingRef.current
    const incoming = incomingLoadingState

    if (isLoadingActive(incoming)) {
      releaseLoadingState.cancel()
      if (!loadingStatesEqual(current, incoming)) {
        setLatchedLoadingState(incoming)
      }
      return
    }

    if (isLoadingActive(current)) {
      releaseLoadingState(incoming)
      return
    }

    if (!loadingStatesEqual(current, incoming)) {
      setLatchedLoadingState(incoming)
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
  // Endast workspace-lista-laddning, inte individuella parametrar
  const isWorkspaceLoading = Boolean(loadingState.workspaces)
  const canDraw = canStartDrawing ?? true

  // Hämtar ritverk tygsläges-items med översättning - use ref for stable reference
  const drawingModeItemsRef = React.useRef<any[]>([])

  const getDrawingModeItems = hooks.useEventCallback(() => {
    return DRAWING_MODE_TABS.map((tab) => ({
      ...tab,
      label: translate(tab.label),
      tooltip: translate(tab.tooltip),
    }))
  })

  // Update ref on translate changes
  hooks.useUpdateEffect(() => {
    drawingModeItemsRef.current = getDrawingModeItems()
  }, [getDrawingModeItems])

  // Initialize on mount
  if (drawingModeItemsRef.current.length === 0) {
    drawingModeItemsRef.current = getDrawingModeItems()
  }

  const drawingModeItems = drawingModeItemsRef.current

  // Renderar ritverktygsläges-flikar
  const renderDrawingModeTabs = hooks.useEventCallback(() => {
    const helperText = isNonEmptyTrimmedString(instructionText)
      ? instructionText
      : translate("tipDrawMode")

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
              items={drawingModeItems}
              value={drawingMode}
              onChange={(val) => {
                onDrawingModeChange?.(val as DrawingTool)
              }}
              aria-label={translate("tipDrawMode")}
            />
          </div>
        </div>
      </div>
    )
  })

  // Renderar lägesmeddelande (info eller varning)
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
      />
    )
  }

  // Renderar StateView-komponenter konsekvent
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

      const waitText = translate("msgPleaseWait")
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

  // Renderar felmeddelanden med återförsöks-/bakåt-knappar
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
        actions.push({ label: translate("btnRetry"), onClick: onRetry })
      } else if (onBack) {
        actions.push({ label: translate("btnBack"), onClick: onBack })
      }
      // Bygger supporthjälp och länk om e-post konfigurerad
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

  // Hämtar konfigurerade servervärden
  const configuredRepository = toTrimmedString(config?.repository) ?? ""
  const previousConfiguredRepository =
    hooks.usePrevious(configuredRepository) ?? ""
  const serverUrl = toTrimmedString(
    (config as { fmeServerUrl?: string })?.fmeServerUrl
  )
  const serverToken = toTrimmedString(
    (config as { fmeServerToken?: string })?.fmeServerToken
  )
  const canFetchWorkspaces = Boolean(
    serverUrl && serverToken && configuredRepository
  )

  // Håller pending workspace-val medan metadata hämtas
  const [pendingWorkspace, setPendingWorkspace] = React.useState<{
    name: string
    repository?: string
  } | null>(null)

  // React Query för workspace-listor
  const workspacesQuery = useWorkspaces(
    {
      repository: configuredRepository || undefined,
      fmeServerUrl: serverUrl || undefined,
      fmeServerToken: serverToken || undefined,
    },
    { enabled: canFetchWorkspaces }
  )

  // React Query för specifik workspace-metadata
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

  // Filtrerar och sorterar workspace-listor från API
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

  // Jämför workspace-listor för uppdateringsdetektering
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

  // Synkroniserar workspace-listor till Redux
  hooks.useEffectWithPreviousValues(() => {
    if (!canFetchWorkspaces) {
      return
    }

    const nextItems = sanitizedWorkspaces
    if (nextItems === EMPTY_WORKSPACES && workspaceItems.length === 0) {
      return
    }

    // Early return if lists are referentially equal
    if (nextItems === workspaceItems) {
      return
    }

    if (workspaceListsEqual(nextItems, workspaceItems)) {
      return
    }

    fmeDispatchRef.current.setWorkspaceItems(nextItems)
  }, [sanitizedWorkspaces, workspaceItems, canFetchWorkspaces])

  // Rensar workspace-state när hämtning ej längre möjlig
  hooks.useUpdateEffect(() => {
    if (canFetchWorkspaces) {
      return
    }
    if (!workspaceItems.length) {
      return
    }
    fmeDispatchRef.current.clearWorkspaceState()
  }, [canFetchWorkspaces, workspaceItems.length])

  // Hämtar om workspaces vid repository-byte
  hooks.useUpdateEffect(() => {
    if (previousConfiguredRepository === configuredRepository) {
      return
    }

    setPendingWorkspace(null)
    fmeDispatchRef.current.clearWorkspaceState()

    if (!configuredRepository || !canFetchWorkspaces) {
      return
    }

    const refetch = workspacesRefetchRef.current
    if (typeof refetch === "function") {
      void refetch()
    }
  }, [configuredRepository, previousConfiguredRepository, canFetchWorkspaces])

  // Rensar pending workspace om hämtning ej längre möjlig
  hooks.useUpdateEffect(() => {
    if (canFetchWorkspaces) {
      return
    }
    if (!pendingWorkspace) {
      return
    }
    setPendingWorkspace(null)
  }, [canFetchWorkspaces, pendingWorkspace])

  // Processar workspace-val när metadata hämtats
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
      fmeDispatchRef.current.applyWorkspaceData({
        workspaceName,
        parameters: payload.parameters,
        item: payload.item,
      })
    }

    setPendingWorkspace(null)
  }, [pendingWorkspace, workspaceItemQuery.data, onWorkspaceSelected])

  // Synkroniserar workspace-hämtningsstatus till Redux
  const hasWorkspaceItems = workspaceItems.length > 0
  // Detekterar om det finns cachade workspaces i Redux
  const hasCachedWorkspaces = sanitizedWorkspaces.length > 0
  const workspaceLoadingActive = canFetchWorkspaces
    ? Boolean(
        workspacesQuery.isLoading ||
          (!hasWorkspaceItems &&
            !hasCachedWorkspaces &&
            workspacesQuery.isFetching)
      )
    : false
  const previousWorkspaceLoadingActive = hooks.usePrevious(
    workspaceLoadingActive
  )
  React.useEffect(() => {
    if (previousWorkspaceLoadingActive === workspaceLoadingActive) {
      return
    }
    fmeDispatchRef.current.setLoadingFlag("workspaces", workspaceLoadingActive)
  }, [workspaceLoadingActive, previousWorkspaceLoadingActive])

  // Synkroniserar parameterhämtningsstatus till Redux
  const parametersFetching = Boolean(workspaceItemQuery.isFetching)
  const previousParametersFetching = hooks.usePrevious(parametersFetching)
  React.useEffect(() => {
    if (previousParametersFetching === parametersFetching) {
      return
    }
    fmeDispatchRef.current.setLoadingFlag("parameters", parametersFetching)
  }, [parametersFetching, previousParametersFetching])

  // Översätter workspace-fel (ignorerar abort-fel)
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

  // Laddar workspace-listan på nytt
  const loadWsList = hooks.useEventCallback(() => {
    setPendingWorkspace(null)

    if (!canFetchWorkspaces) {
      fmeDispatchRef.current.clearWorkspaceState()
      return
    }

    const refetch = workspacesRefetchRef.current
    if (typeof refetch === "function") {
      void refetch()
    }
  })

  // Renderar workspace-knappar från lista
  const renderWorkspaceButtons = hooks.useEventCallback(() =>
    workspaceItems.map((workspace: WorkspaceItem, index: number) => {
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

      // Använder index som fallback för nyckel om namn saknas
      const key =
        workspace.name && workspace.name.trim()
          ? workspace.name
          : `workspace-${index}`

      return (
        <div key={key} role="listitem" aria-label={displayLabel}>
          <Button
            text={displayLabel}
            icon={itemIcon}
            type="tertiary"
            onClick={handleOpen}
            logging={{
              enabled: true,
              prefix: "FME-Export-WorkspaceSelection",
            }}
          />
        </div>
      )
    })
  )

  // Renderar huvud med återställningsknapp
  const renderHeader = () => {
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
            tooltip={translate("tipCancel")}
            tooltipPlacement="bottom"
            onClick={onReset}
            color="inherit"
            type="default"
            variant="contained"
            text={translate("btnCancel")}
            size="sm"
            aria-label={translate("tipCancel")}
            logging={{ enabled: true, prefix: "FME-Export-Header" }}
            block={false}
          />
        )
      }
    }

    if (!resetButton) return null

    return resetButton
  }

  // Renderar initialt tillstånd (väntar på moduler eller ritverktygsval)
  const renderInitial = () => {
    const waitMessage = translate("statusInitMap")
    const waitDetail = translate("msgLoadingDraw")
    if (isModulesLoading) {
      return renderLoading(waitMessage, waitDetail, [translate("tipDrawMode")])
    }
    if (!canDraw) {
      return renderLoading(waitMessage, waitDetail, [translate("tipDrawMode")])
    }
    return renderDrawingModeTabs()
  }

  // Renderar rittillstånd med instruktionstext
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

  // Route guard: Kontrollera om startup-validering ska visas
  const shouldShowStartupValidation = () =>
    state === ViewMode.STARTUP_VALIDATION

  // Route guard: Kontrollera om orderresultat ska visas
  const shouldShowOrderResult = () =>
    state === ViewMode.ORDER_RESULT && orderResult

  // Route guard: Kontrollera om submission progress ska visas
  const shouldShowSubmissionProgress = () => isSubmittingOrder

  // Route guard: Kontrollera om fel ska visas
  const shouldShowError = () => Boolean(error)

  // Route guard: Kontrollera om geometry-validering pågår
  const shouldShowGeometryValidation = () =>
    isCompleting &&
    (state === ViewMode.DRAWING ||
      state === ViewMode.EXPORT_OPTIONS ||
      state === ViewMode.WORKSPACE_SELECTION)

  // Renderar startup-validering (fel eller laddning)
  const renderStartupValidation = () => {
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
      startupValidationStep || translate("statusValidating")
    return renderLoading(loadingMessage)
  }

  // Renderar orderresultat
  const renderOrderResult = () => (
    <OrderResult
      orderResult={orderResult}
      translate={translate}
      onReuseGeography={onReuseGeography}
      onBack={onBack}
      onReset={onReset}
      config={config}
    />
  )

  // Renderar submission progress med fasmeddelanden
  const renderSubmissionProgress = () => {
    const isSyncMode = Boolean(config?.syncMode)
    const baseKey = isSyncMode ? "submittingOrderSync" : "submittingOrder"
    const baseMessage = translate(baseKey)

    let phaseKey: string | null = null

    switch (submissionPhase) {
      case "preparing":
        phaseKey = "statusPreparing"
        break
      case "uploading":
        phaseKey = "statusUploading"
        break
      default:
        phaseKey = null
    }

    if (phaseKey) {
      return renderLoading(baseMessage, translate(phaseKey))
    }

    if (isSyncMode) {
      return renderLoading(baseMessage, translate("msgProcessingWait"))
    }

    return renderLoading(baseMessage, translate("msgPleaseWait"))
  }

  // Renderar fel med användarmeddelande
  const renderErrorView = () =>
    renderError(
      error.message,
      undefined,
      error.severity !== "info" ? onBack : undefined,
      error.code,
      error.userFriendlyMessage
    )

  // Renderar geometry-validering laddning
  const renderGeometryValidation = () => (
    <StateView
      state={makeLoadingView(
        translate("statusValidateGeom"),
        translate("msgCheckGeom")
      )}
    />
  )

  // Renderar vy baserat på state (för normala vyer)
  const renderViewByState = () => {
    switch (state) {
      case ViewMode.INITIAL:
        return renderInitial()
      case ViewMode.DRAWING:
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
        return renderError(translate("msgNoResult"), onBack)
      default:
        return renderInitial()
    }
  }

  // Renderar workspace-val med laddning och fel
  const renderSelection = () => {
    const isPrefetchLoading = Boolean(
      isPrefetchingWorkspaces &&
        workspaceItems.length &&
        state === ViewMode.WORKSPACE_SELECTION
    )

    const shouldShowLoading = shouldShowWorkspaceLoading(
      isWorkspaceLoading || isPrefetchLoading,
      workspaceItems,
      state,
      Boolean(workspaceError)
    )

    if (shouldShowLoading) {
      const message = isPrefetchLoading
        ? translate("statusLoadWorkspaces")
        : workspaceItems.length
          ? translate("statusLoadParams")
          : translate("statusLoadWorkspaces")

      const detail = isPrefetchLoading
        ? ""
        : workspaceItems.length
          ? translate("msgLoadParams")
          : translate("msgLoadRepos")

      return renderLoading(message, detail, [translate("tipBackOptions")])
    }

    if (workspaceError) {
      return renderError(workspaceError, onBack, loadWsList)
    }

    if (!workspaceItems.length) {
      const actions = [
        { label: translate("btnRetry"), onClick: loadWsList },
        { label: translate("btnBack"), onClick: onBack },
      ]
      return (
        <StateView
          state={makeEmptyView(translate("msgNoWorkspaces"), actions)}
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

  // Renderar exportformulär med parametrar
  const renderForm = () => {
    if (!onFormBack || !onFormSubmit) {
      return renderError(translate("errNoConfig"), onBack)
    }

    if (!workspaceParameters || !selectedWorkspace) {
      return renderLoading(
        translate("statusLoadParams"),
        translate("msgLoadParams"),
        [translate("titleConfigParams")]
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
          jimuMapView={jimuMapView}
        />
      </>
    )
  }

  // Renderar aktuell vy baserat på state (förenklad med route guards)
  const renderCurrent = () => {
    if (shouldShowStartupValidation()) return renderStartupValidation()
    if (shouldShowOrderResult()) return renderOrderResult()
    if (shouldShowSubmissionProgress()) return renderSubmissionProgress()
    if (shouldShowError()) return renderErrorView()
    if (shouldShowGeometryValidation()) return renderGeometryValidation()
    return renderViewByState()
  }

  return (
    <div css={styles.parent}>
      <div css={styles.header}>{showHeaderActions ? renderHeader() : null}</div>
      <div css={styles.content}>{renderCurrent()}</div>
    </div>
  )
}

export default Workflow
