/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
import { QueryClientProvider } from "@tanstack/react-query"
import { fmeQueryClient } from "../shared/query-client"
import {
  setError,
  clearErrors,
  parseNonNegativeInt,
  toTrimmedString,
  isAbortError,
  sanitizeParamKey,
  createFmeDispatcher,
} from "../shared/utils"
import {
  useBuilderSelector,
  useStringConfigValue,
  useBooleanConfigValue,
  useNumberConfigValue,
  useUpdateConfig,
  useLatestAbortController,
  useDebounce,
  useRepositories,
  useValidateConnection,
} from "../shared/hooks"
import { useDispatch } from "react-redux"
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  MapWidgetSelector,
  SettingSection,
  SettingRow,
} from "jimu-ui/advanced/setting-components"
import { Switch, defaultMessages as jimuDefaultMessages } from "jimu-ui"
import {
  Alert,
  NumericInput,
  Select,
  Tooltip,
  config as uiConfig,
  useStyles,
  ColorPickerWrapper,
} from "../runtime/components/ui"
import defaultMessages from "./translations/default"
import {
  normalizeBaseUrl,
  validateServerUrl,
  validateToken,
  extractHttpStatus,
  mapServerUrlReasonToKey,
  validateConnectionInputs,
  isValidEmail,
  validateEmailField,
} from "../shared/validations"
import { mapErrorFromNetwork } from "../shared/utils/error"
import { translateOptional } from "../shared/utils/format"
import { createFmeSelectors } from "../extensions/store"
import type {
  FmeExportConfig,
  IMWidgetConfig,
  FmeFlowConfig,
  TestState,
  FieldErrors,
  CheckSteps,
  ValidationResult,
  TranslateFn,
  ValidationPhase,
} from "../config/index"
import {
  DEFAULT_DRAWING_HEX,
  SETTING_CONSTANTS,
  useSettingStyles,
} from "../config/index"
import {
  ConnectionTestSection,
  RepositorySelector,
  FieldRow,
  JobDirectivesSection,
  toNumericValue,
} from "./components/controls"

/* Hämtar settings-konstanter */
const CONSTANTS = SETTING_CONSTANTS

/* Returnerar initialt test-state för connection validation */
const getInitialTestState = (): TestState => ({
  status: "idle",
  isTesting: false,
  message: undefined,
  type: "info",
})

/* Returnerar initiala check-steg för connection validation */
const getInitialCheckSteps = (): CheckSteps => ({
  serverUrl: "idle",
  token: "idle",
  repository: "idle",
  version: "",
})

/* Centraliserad hanterare för valideringsfel - uppdaterar steg och fel */
const handleValidationFailure = (
  errorType: "server" | "network" | "token" | "repository",
  opts: {
    setCheckSteps: React.Dispatch<React.SetStateAction<CheckSteps>>
    setFieldErrors: React.Dispatch<React.SetStateAction<FieldErrors>>
    translate: TranslateFn
    version?: string
    errorMessage?: string
  }
) => {
  const { setCheckSteps, setFieldErrors, translate, version, errorMessage } =
    opts
  if (errorType === "server" || errorType === "network") {
    setCheckSteps((prev) => ({
      ...prev,
      serverUrl: "fail",
      token: "idle",
      repository: "idle",
      version: "",
    }))
    const errorKey = errorMessage || "errorInvalidServerUrl"
    setError(
      setFieldErrors,
      "serverUrl",
      translateOptional(translate, errorKey)
    )
    clearErrors(setFieldErrors, ["token", "repository"])
    return
  }
  if (errorType === "token") {
    setCheckSteps((prev) => ({
      ...prev,
      serverUrl: "ok",
      token: "fail",
      repository: "idle",
      version: "",
    }))
    const errorKey = errorMessage || "errorTokenIsInvalid"
    setError(setFieldErrors, "token", translateOptional(translate, errorKey))
    clearErrors(setFieldErrors, ["serverUrl", "repository"])
    return
  }
  /* Repository-fel */
  setCheckSteps((prev) => ({
    ...prev,
    serverUrl: "ok",
    token: "ok",
    repository: "fail",
    version: version || "",
  }))
  const errorKey = errorMessage || "errorRepositoryNotFound"
  setError(setFieldErrors, "repository", translateOptional(translate, errorKey))
  clearErrors(setFieldErrors, ["serverUrl", "token"])
  /* Repository-lista hanteras av useRepositories query hook */
}

/*
 * Inre komponenten som använder React Query hooks.
 * Måste renderas inuti QueryClientProvider.
 */
function SettingContent(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(
    defaultMessages as any,
    jimuDefaultMessages
  )
  const styles = useStyles()
  const settingStyles = useSettingStyles()
  const dispatch = useDispatch()
  const fmeDispatchRef = React.useRef(createFmeDispatcher(dispatch, id))
  hooks.useUpdateEffect(() => {
    fmeDispatchRef.current = createFmeDispatcher(dispatch, id)
  }, [dispatch, id])

  /* Builder-medvetna Redux-selektorer med caching per widget-ID */
  const fmeSelectorsRef = React.useRef<{
    widgetId: string
    selectors: ReturnType<typeof createFmeSelectors>
  } | null>(null)
  if (
    fmeSelectorsRef.current === null ||
    fmeSelectorsRef.current.widgetId !== id
  ) {
    fmeSelectorsRef.current = {
      widgetId: id,
      selectors: createFmeSelectors(id),
    }
  }
  const fmeSelectors = fmeSelectorsRef.current.selectors
  const isBusy = useBuilderSelector(fmeSelectors.selectIsBusy)

  const getStringConfig = useStringConfigValue(config)
  const getBooleanConfig = useBooleanConfigValue(config)
  const getNumberConfig = useNumberConfigValue(config)
  const updateConfig = useUpdateConfig(id, config, onSettingChange)

  /* Stabila ID-referenser för formulär-fält */
  const ID = {
    supportEmail: "setting-support-email",
    serverUrl: "setting-server-url",
    token: "setting-token",
    repository: "setting-repository",
    syncMode: "setting-sync-mode",
    maskEmailOnSuccess: "setting-mask-email-on-success",
    showResult: "setting-show-result",
    requestTimeout: "setting-request-timeout",
    largeArea: "setting-large-area",
    maxArea: "setting-max-area",
    tm_ttc: "setting-tm-ttc",
    tm_ttl: "setting-tm-ttl",
    aoiParamName: "setting-aoi-param-name",
    uploadTargetParamName: "setting-upload-target-param-name",
    requireHttps: "setting-require-https",
    allowRemoteDataset: "setting-allow-remote-dataset",
    allowRemoteUrlDataset: "setting-allow-remote-url-dataset",
    autoCloseOtherWidgets: "setting-auto-close-other-widgets",
    drawingColor: "setting-drawing-color",
  } as const

  /* Konsoliderat test-state för connection validation */
  const [testState, setTestState] = React.useState<TestState>(() =>
    getInitialTestState()
  )
  /* Finmaskig steg-status för connection test-UI */
  const [checkSteps, setCheckSteps] = React.useState<CheckSteps>(() =>
    getInitialCheckSteps()
  )
  const [validationPhase, setValidationPhase] =
    React.useState<ValidationPhase>("idle")
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  /* Lokala state-kopior för redigerbart fält-innehåll */
  const [localServerUrl, setLocalServerUrl] = React.useState<string>(
    () => getStringConfig("fmeServerUrl") || ""
  )
  const [localToken, setLocalToken] = React.useState<string>(
    () => getStringConfig("fmeServerToken") || ""
  )
  const [localRequireHttps, setLocalRequireHttps] = React.useState<boolean>(
    () => getBooleanConfig("requireHttps")
  )
  const selectedRepository = getStringConfig("repository") || ""
  const configServerUrl = getStringConfig("fmeServerUrl") || ""
  const configToken = getStringConfig("fmeServerToken") || ""
  const previousConfigServerUrl = hooks.usePrevious(configServerUrl)
  const previousConfigToken = hooks.usePrevious(configToken)
  const trimmedLocalServerUrl = toTrimmedString(localServerUrl)
  const trimmedLocalToken = toTrimmedString(localToken)
  const serverValidation = validateServerUrl(localServerUrl, {
    requireHttps: localRequireHttps,
  })
  const tokenValidation = validateToken(localToken)
  const normalizedLocalServerUrl =
    serverValidation.ok && trimmedLocalServerUrl
      ? normalizeBaseUrl(trimmedLocalServerUrl) || undefined
      : undefined
  const [localSupportEmail, setLocalSupportEmail] = React.useState<string>(() =>
    getStringConfig("supportEmail")
  )
  const [localSyncMode, setLocalSyncMode] = React.useState<boolean>(() =>
    getBooleanConfig("syncMode")
  )
  const [localMaskEmailOnSuccess, setLocalMaskEmailOnSuccess] =
    React.useState<boolean>(() => getBooleanConfig("maskEmailOnSuccess"))
  const [localShowResult, setLocalShowResult] = React.useState<boolean>(() =>
    getBooleanConfig("showResult", true)
  )
  const [localAutoCloseOtherWidgets, setLocalAutoCloseOtherWidgets] =
    React.useState<boolean>(() =>
      getBooleanConfig("autoCloseOtherWidgets", true)
    )
  /* Request timeout (ms) */
  const [localRequestTimeout, setLocalRequestTimeout] = React.useState<string>(
    () => {
      const v = getNumberConfig("requestTimeout")
      return v !== undefined ? String(v) : ""
    }
  )
  /* Max AOI area (m²) – lagras och visas i m² */
  const [localMaxAreaM2, setLocalMaxAreaM2] = React.useState<string>(() => {
    const v = getNumberConfig("maxArea")
    return v !== undefined && v > 0 ? String(v) : ""
  })
  /* Large-area varningströskel (m²) */
  const [localLargeAreaM2, setLocalLargeAreaM2] = React.useState<string>(() => {
    const v = getNumberConfig("largeArea")
    return v !== undefined && v > 0 ? String(v) : ""
  })
  /* Admin job directives (standardvärden 0/tom) */
  const [localTmTtc, setLocalTmTtc] = React.useState<string>(() => {
    const v = getNumberConfig("tm_ttc")
    return v !== undefined ? String(v) : CONSTANTS.VALIDATION.DEFAULT_TTC_VALUE
  })
  const [localTmTtl, setLocalTmTtl] = React.useState<string>(() => {
    const v = getNumberConfig("tm_ttl")
    return v !== undefined ? String(v) : CONSTANTS.VALIDATION.DEFAULT_TTL_VALUE
  })
  const [localAoiParamName, setLocalAoiParamName] = React.useState<string>(
    () => getStringConfig("aoiParamName") || "AreaOfInterest"
  )
  const [localUploadTargetParamName, setLocalUploadTargetParamName] =
    React.useState<string>(() => getStringConfig("uploadTargetParamName") || "")
  const [localAllowRemoteDataset, setLocalAllowRemoteDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteDataset"))
  const [localAllowRemoteUrlDataset, setLocalAllowRemoteUrlDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteUrlDataset"))
  const shouldShowMaskEmailSetting = !localSyncMode
  const shouldShowTmTtc = localSyncMode
  const hasMapSelection =
    Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
  const hasServerInputs = Boolean(trimmedLocalServerUrl && trimmedLocalToken)
  const shouldShowRepositorySelector = hasMapSelection && hasServerInputs
  const hasRepositorySelection = !!toTrimmedString(selectedRepository)
  const shouldShowRemainingSettings =
    hasMapSelection && hasServerInputs && hasRepositorySelection
  const shouldShowRemoteDatasetSettings = localAllowRemoteDataset

  const handleLargeAreaChange = hooks.useEventCallback(
    (val: number | undefined) => {
      setFieldErrors((prev) => ({ ...prev, largeArea: undefined }))
      if (val === undefined) {
        setLocalLargeAreaM2("")
        return
      }
      setLocalLargeAreaM2(String(val))
    }
  )

  const handleLargeAreaBlur = hooks.useEventCallback((val: string) => {
    const trimmed = (val ?? "").trim()
    const parsed = parseNonNegativeInt(trimmed)

    if (parsed === undefined || parsed === 0) {
      updateConfig("largeArea", undefined as any)
      setLocalLargeAreaM2("")
      setFieldErrors((prev) => ({ ...prev, largeArea: undefined }))
      return
    }

    if (parsed > CONSTANTS.LIMITS.MAX_M2_CAP) {
      setFieldErrors((prev) => ({
        ...prev,
        largeArea: translate("errorMaxAreaTooLarge", {
          maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
        }),
      }))
      return
    }

    updateConfig("largeArea", parsed as any)
    setLocalLargeAreaM2(String(parsed))
    setFieldErrors((prev) => ({ ...prev, largeArea: undefined }))
  })

  const handleMaxAreaBlur = hooks.useEventCallback((val: string) => {
    const trimmed = (val ?? "").trim()
    const parsed = parseNonNegativeInt(trimmed)

    if (parsed === undefined || parsed === 0) {
      updateConfig("maxArea", undefined as any)
      setLocalMaxAreaM2("")
      setFieldErrors((prev) => ({ ...prev, maxArea: undefined }))
      return
    }

    if (parsed > CONSTANTS.LIMITS.MAX_M2_CAP) {
      setFieldErrors((prev) => ({
        ...prev,
        maxArea: translate("errorMaxAreaTooLarge", {
          maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
        }),
      }))
      return
    }

    updateConfig("maxArea", parsed as any)
    setLocalMaxAreaM2(String(parsed))
    setFieldErrors((prev) => ({ ...prev, maxArea: undefined }))
  })

  /* Konsoliderad effekt: återställ beroende alternativ när dolda */
  hooks.useEffectWithPreviousValues(() => {
    /* Mask email: rensa om inte längre synlig */
    if (!shouldShowMaskEmailSetting && localMaskEmailOnSuccess) {
      setLocalMaskEmailOnSuccess(false)
      updateConfig("maskEmailOnSuccess", false as any)
    }

    /* Remote dataset: rensa beroende inställningar när avstängt */
    if (!localAllowRemoteDataset) {
      /* Stäng av URL-dataset om remote dataset är avstängt */
      if (localAllowRemoteUrlDataset) {
        setLocalAllowRemoteUrlDataset(false)
        updateConfig("allowRemoteUrlDataset", false as any)
      }
      /* Rensa upload target-param när dataset-stöd är avstängt */
      if (localUploadTargetParamName) {
        setLocalUploadTargetParamName("")
        updateConfig("uploadTargetParamName", undefined as any)
        setFieldErrors((prev) => ({
          ...prev,
          uploadTargetParamName: undefined,
        }))
      }
    }
  }, [
    shouldShowMaskEmailSetting,
    localMaskEmailOnSuccess,
    localAllowRemoteDataset,
    localAllowRemoteUrlDataset,
    localUploadTargetParamName,
    updateConfig,
  ])

  hooks.useEffectWithPreviousValues(() => {
    if (!shouldShowTmTtc && toTrimmedString(localTmTtc)) {
      setLocalTmTtc("")
      updateConfig("tm_ttc", undefined as any)
      setFieldErrors((prev) => ({ ...prev, tm_ttc: undefined }))
    }
  }, [shouldShowTmTtc, localTmTtc, updateConfig, setFieldErrors])

  /* Drawing color (hex) med ArcGIS brand blue som standard */
  const [localDrawingColor, setLocalDrawingColor] = React.useState<string>(
    () => getStringConfig("drawingColor") || DEFAULT_DRAWING_HEX
  )

  /* Avgör om repositories ska hämtas */
  const canFetchRepos = Boolean(normalizedLocalServerUrl && tokenValidation.ok)

  /* Query hook för repositories (ersätter manuell loadRepositories) */
  const repositoriesQuery = useRepositories(
    normalizedLocalServerUrl,
    trimmedLocalToken,
    { enabled: canFetchRepos }
  )

  /* Mutation hook för connection validation (ersätter manuell validate) */
  const validateConnectionMutation = useValidateConnection()

  /* Icke-blockerande ledtråd för repository-listfetchfel */
  const [reposHint, setReposHint] = React.useState<string | null>(null)

  /* Spårar inflight cancellation scopes (endast testAbort behövs nu) */
  const testAbort = useLatestAbortController()

  /* Håller senaste värden för asynkrona läsare */
  const translateRef = hooks.useLatest(translate)
  const [isServerValidationPending, setServerValidationPending] =
    React.useState(false)
  const [isTokenValidationPending, setTokenValidationPending] =
    React.useState(false)

  const runServerValidation = hooks.useEventCallback((value: string) => {
    const trimmed = toTrimmedString(value)
    if (!trimmed) {
      setError(setFieldErrors, "serverUrl", undefined)
      return
    }

    const validation = validateServerUrl(trimmed, {
      requireHttps: localRequireHttps,
    })
    let message: string | undefined
    if (!validation.ok) {
      let messageKey: string | undefined
      if ("reason" in validation) {
        messageKey = mapServerUrlReasonToKey(validation.reason)
      } else if ("key" in validation && typeof validation.key === "string") {
        messageKey = validation.key
      }
      message = messageKey ? translateRef.current(messageKey) : undefined
    } else {
      message = undefined
    }
    setError(setFieldErrors, "serverUrl", message)
  })

  const runTokenValidation = hooks.useEventCallback((value: string) => {
    const trimmed = toTrimmedString(value)
    if (!trimmed) {
      setError(setFieldErrors, "token", undefined)
      return
    }

    const validation = validateToken(trimmed)
    const message =
      !validation.ok && validation.key
        ? translateRef.current(validation.key)
        : undefined
    setError(setFieldErrors, "token", message)
  })

  /* Debounced validering för att undvika validering vid varje tangenttryck */
  const debouncedServerValidation = useDebounce(runServerValidation, 800, {
    onPendingChange: (pending) => {
      setServerValidationPending(pending)
    },
  })
  const debouncedTokenValidation = useDebounce(runTokenValidation, 800, {
    onPendingChange: (pending) => {
      setTokenValidationPending(pending)
    },
  })

  /* Extraherar repository-namn från query data */
  const availableReposRef = React.useRef<string[] | null>(null)
  const prevQueryData = hooks.usePrevious(repositoriesQuery.data)

  if (repositoriesQuery.data !== prevQueryData) {
    availableReposRef.current = repositoriesQuery.data
      ? repositoriesQuery.data.map((repo) => repo.name)
      : null
  }

  const availableRepos = availableReposRef.current

  /* Hanterar repository query-fel */
  hooks.useEffectWithPreviousValues(() => {
    if (repositoriesQuery.isError && !isAbortError(repositoriesQuery.error)) {
      setReposHint(translate("errLoadRepositories"))
    } else if (repositoriesQuery.isSuccess) {
      setReposHint(null)
    }
  }, [
    repositoriesQuery.isError,
    repositoriesQuery.isSuccess,
    repositoriesQuery.error,
    translate,
  ])

  /* Rensar repository-relaterad state när URL eller token ändras */
  const clearRepositoryEphemeralState = hooks.useEventCallback(() => {
    /* Query hook hanterar abort automatiskt */
    setFieldErrors((prev) => ({ ...prev, repository: undefined }))
    setValidationPhase("idle")
    setReposHint(null)
  })

  const resetConnectionProgress = hooks.useEventCallback(() => {
    testAbort.cancel()
    setValidationPhase("idle")
    setTestState((prev) => {
      if (
        prev.status === "idle" &&
        !prev.isTesting &&
        prev.message === undefined &&
        prev.type === "info"
      ) {
        return prev
      }
      return getInitialTestState()
    })
    setCheckSteps((prev) => {
      if (
        prev.serverUrl === "idle" &&
        prev.token === "idle" &&
        prev.repository === "idle" &&
        (prev.version || "") === ""
      ) {
        return prev
      }
      return getInitialCheckSteps()
    })
  })

  /* Städar upp vid unmount */
  hooks.useUnmount(() => {
    testAbort.cancel()
    debouncedServerValidation.cancel()
    debouncedTokenValidation.cancel()
    /* Query hook hanterar cleanup automatiskt */
  })

  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    onSettingChange({
      id,
      useMapWidgetIds,
    })
  }

  /* Renderar obligatorisk etikett med tooltip */
  const RequiredLabel: React.FC<{ text: string }> = ({ text }) => (
    <>
      {text}
      <Tooltip content={translate("valRequiredField")} placement="top">
        <span
          css={styles.typo.required}
          aria-label={translate("ariaRequired")}
          role="img"
          aria-hidden={false}
        >
          {uiConfig.required}
        </span>
      </Tooltip>
    </>
  )

  /* Unified input-validering */
  const validateAllInputs = hooks.useEventCallback(
    (skipRepoCheck = false): ValidationResult => {
      const composite = validateConnectionInputs({
        url: localServerUrl,
        token: localToken,
        repository: selectedRepository,
        availableRepos: skipRepoCheck ? null : availableRepos,
      })

      const messages: Partial<FieldErrors> = {}
      if (!composite.ok) {
        if (composite.errors.serverUrl)
          messages.serverUrl = translateOptional(
            translate,
            composite.errors.serverUrl
          )
        if (composite.errors.token)
          messages.token = translateOptional(translate, composite.errors.token)
        if (!skipRepoCheck && composite.errors.repository)
          messages.repository = translateOptional(
            translate,
            composite.errors.repository
          )
      }

      /* Support-email är valfri men måste vara giltig om angiven */
      const emailValidation = validateEmailField(localSupportEmail)
      if (!emailValidation.ok && emailValidation.errorKey) {
        messages.supportEmail = translateOptional(
          translate,
          emailValidation.errorKey
        )
      }

      if (localAllowRemoteDataset) {
        const sanitizedTarget = sanitizeParamKey(localUploadTargetParamName, "")
        if (!sanitizedTarget) {
          messages.uploadTargetParamName = translate(
            "uploadTargetParamNameRequired"
          )
        }
      }

      setFieldErrors((prev) => ({
        ...prev,
        serverUrl: messages.serverUrl,
        token: messages.token,
        repository: messages.repository,
        supportEmail: messages.supportEmail,
        uploadTargetParamName: messages.uploadTargetParamName,
      }))

      return {
        messages,
        hasErrors: !!(
          messages.serverUrl ||
          messages.token ||
          (!skipRepoCheck && messages.repository) ||
          (!skipRepoCheck && messages.supportEmail) ||
          messages.uploadTargetParamName
        ),
      }
    }
  )

  /* Validerar connection settings */
  const validateConnectionSettings = hooks.useEventCallback(
    (): FmeFlowConfig | null => {
      const rawServerUrl = localServerUrl
      const token = localToken
      const repository = selectedRepository

      const cleaned = normalizeBaseUrl(rawServerUrl || "")
      const changed = cleaned !== rawServerUrl
      /* Om sanering ändrade, uppdatera config */
      if (changed) {
        updateConfig("fmeServerUrl", cleaned)
      }

      const serverUrl = cleaned

      return serverUrl && token ? { serverUrl, token, repository } : null
    }
  )
  const canRunConnectionTest = serverValidation.ok && tokenValidation.ok

  /* Hanterar "Test Connection"-knapp - inaktiverad när widget är busy */
  const isTestDisabled =
    !!testState.isTesting || !canRunConnectionTest || isBusy

  /* Connection test-sub-funktioner för bättre organisation */
  const handleTestSuccess = hooks.useEventCallback(
    (validationResult: any, settings: FmeFlowConfig, silent: boolean) => {
      setValidationPhase("complete")
      setCheckSteps({
        serverUrl: validationResult.steps.serverUrl,
        token: validationResult.steps.token,
        repository: validationResult.steps.repository,
        version: validationResult.version || "",
      })

      /* Obs: repositories hämtas nu av useRepositories query hook */

      updateConfig("fmeServerUrl", settings.serverUrl)
      updateConfig("fmeServerToken", settings.token)
      clearErrors(setFieldErrors, ["serverUrl", "token", "repository"])

      const warnings: readonly string[] = Array.isArray(
        validationResult.warnings
      )
        ? validationResult.warnings
        : []
      const hasRepositoryWarning = warnings.includes("repositoryNotAccessible")

      if (!silent) {
        setTestState({
          status: "success",
          isTesting: false,
          message: hasRepositoryWarning
            ? translate("msgConnectionWarning")
            : translate("msgConnectionOk"),
          type: hasRepositoryWarning ? "warning" : "success",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
    }
  )

  const handleTestFailure = hooks.useEventCallback(
    (validationResult: any, silent: boolean) => {
      setValidationPhase("complete")
      const error = validationResult.error
      const failureType = (error?.type || "server") as
        | "server"
        | "network"
        | "token"
        | "repository"

      handleValidationFailure(failureType, {
        setCheckSteps,
        setFieldErrors,
        translate,
        version: validationResult.version,
        errorMessage: error?.message,
      })

      if (!silent) {
        setTestState({
          status: "error",
          isTesting: false,
          message: translateOptional(translate, error?.message),
          type: "error",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
    }
  )

  const handleTestError = hooks.useEventCallback(
    (err: unknown, silent: boolean) => {
      if ((err as Error)?.name === "AbortError") return

      setValidationPhase("complete")
      const errorStatus = extractHttpStatus(err)
      const failureType =
        !errorStatus || errorStatus === 0 ? "network" : "server"
      const errorKey = mapErrorFromNetwork(err, errorStatus)

      handleValidationFailure(failureType, {
        setCheckSteps,
        setFieldErrors,
        translate,
        version: "",
        errorMessage: errorKey,
      })

      if (!silent) {
        setTestState({
          status: "error",
          isTesting: false,
          message: translateOptional(translate, errorKey),
          type: "error",
        })
      }
    }
  )

  const testConnection = hooks.useEventCallback(async (silent = false) => {
    // Cancel any in-flight test first
    testAbort.cancel()

    const { hasErrors } = validateAllInputs(true)
    const settings = validateConnectionSettings()
    if (hasErrors || !settings) {
      setValidationPhase("idle")
      if (!silent) {
        setTestState({
          status: "error",
          isTesting: false,
          message: translate("msgFixErrors"),
          type: "error",
        })
      }
      return
    }

    setValidationPhase("checking")
    const controller = testAbort.abortAndCreate()

    // Reset state for new test
    setTestState({
      status: "running",
      isTesting: true,
      message: silent ? null : translate("statusTestConnection"),
      type: "info",
    })
    setCheckSteps({
      serverUrl: "pending",
      token: "pending",
      repository: settings.repository ? "pending" : "skip",
      version: "",
    })

    try {
      if (!silent) {
        setTestState((prev) => ({
          ...prev,
          message: translate("statusTestConnection"),
        }))
      }

      // Use mutation hook for connection validation
      const validationResult = await validateConnectionMutation.mutateAsync({
        serverUrl: settings.serverUrl,
        token: settings.token,
        repository: settings.repository,
      })

      if (validationResult.success) {
        handleTestSuccess(validationResult, settings, silent)
      } else {
        handleTestFailure(validationResult, silent)
      }
    } catch (err) {
      handleTestError(err, silent)
    } finally {
      if (controller.signal.aborted) {
        setValidationPhase("idle")
      }
      testAbort.finalize(controller)
    }
  })

  /* Förbättrad repository-refresh för bättre UX - använder query refetch */
  const refreshRepositories = hooks.useEventCallback(async () => {
    if (!canFetchRepos || !repositoriesQuery.refetch) {
      return
    }
    try {
      await repositoriesQuery.refetch()
    } catch (err) {
      /* React Query hanterar error state automatiskt */
      if (!isAbortError(err)) {
        console.log("Repository refresh failed:", err)
      }
    }
  })

  /* Rensar transient repo-lista när server URL eller token i config ändras */
  hooks.useUpdateEffect(() => {
    if (
      previousConfigServerUrl === undefined &&
      previousConfigToken === undefined
    ) {
      return
    }

    if (
      previousConfigServerUrl !== configServerUrl ||
      previousConfigToken !== configToken
    ) {
      clearRepositoryEphemeralState()
    }
  }, [
    configServerUrl,
    configToken,
    previousConfigServerUrl,
    previousConfigToken,
    clearRepositoryEphemeralState,
  ])

  /* Obs: Auto-load repositories hanteras nu av useRepositories query hook */

  /* Hanterar server URL-ändringar med fördröjd validering */
  const handleServerUrlChange = hooks.useEventCallback((val: string) => {
    setLocalServerUrl(val)
    resetConnectionProgress()
    clearRepositoryEphemeralState()

    /* Rensar tidigare fel omedelbart för bättre UX */
    clearErrors(setFieldErrors, ["serverUrl"])
    const trimmed = toTrimmedString(val)
    if (!trimmed) {
      debouncedServerValidation.cancel()
      return
    }
    debouncedServerValidation(val)
  })

  /* Hanterar token-ändringar med fördröjd validering */
  const handleTokenChange = hooks.useEventCallback((val: string) => {
    setLocalToken(val)
    resetConnectionProgress()
    clearRepositoryEphemeralState()

    /* Rensar tidigare fel omedelbart för bättre UX */
    clearErrors(setFieldErrors, ["token"])
    const trimmed = toTrimmedString(val)
    if (!trimmed) {
      debouncedTokenValidation.cancel()
      return
    }
    debouncedTokenValidation(val)
  })

  /* Hanterar server URL blur - sparar till config och rensar repo-state */
  const handleServerUrlBlur = hooks.useEventCallback((url: string) => {
    /* Validerar vid blur */
    debouncedServerValidation.cancel()
    const cleaned = normalizeBaseUrl(url)
    const hasChanged = cleaned !== configServerUrl
    if (cleaned !== localServerUrl) {
      setLocalServerUrl(cleaned)
    }
    if (hasChanged) {
      updateConfig("fmeServerUrl", cleaned)
    }
    runServerValidation(cleaned)

    if (hasChanged) {
      // Clear repository data when server changes
      clearRepositoryEphemeralState()
    }
  })

  /* Hanterar token blur - sparar till config och rensar repo-state */
  const handleTokenBlur = hooks.useEventCallback((token: string) => {
    /* Validerar vid blur */
    debouncedTokenValidation.cancel()
    runTokenValidation(token)

    /* Sparar till config */
    if (token !== configToken) {
      updateConfig("fmeServerToken", token)
      // Clear repository data when token changes
      clearRepositoryEphemeralState()
    }
  })

  /* Håller repository-felfältet synkat när lista eller val ändras */
  hooks.useUpdateEffect(() => {
    if (!selectedRepository) return
    /* Validerar repository om vi har tillgänglig lista och val */
    if (
      Array.isArray(availableRepos) &&
      availableRepos.length &&
      selectedRepository
    ) {
      const hasRepo = availableRepos.includes(selectedRepository)
      const errorMessage = hasRepo
        ? undefined
        : translate("errRepositoryMissing")
      setError(setFieldErrors, "repository", errorMessage)
    } else if (
      Array.isArray(availableRepos) &&
      availableRepos.length === 0 &&
      selectedRepository
    ) {
      // Tillåter manuell inmatning när listan är tom
      clearErrors(setFieldErrors, ["repository"])
    }
  }, [availableRepos, selectedRepository, translate])

  /* Hanterar repository-ändringar med workspace state-rensning */
  const handleRepositoryChange = hooks.useEventCallback(
    (newRepository: string) => {
      const previousRepository = selectedRepository
      updateConfig("repository", newRepository)

      /* Rensar workspace-relaterad state vid repository-byte för isolering */
      if (previousRepository !== newRepository) {
        fmeDispatchRef.current.clearWorkspaceState()
      }

      /* Rensar repository-felfält */
      clearErrors(setFieldErrors, ["repository"])
    }
  )

  /* Återanvändbar blur-hanterare för valfria numeriska fält */
  const createNumericBlurHandler = hooks.useEventCallback(
    (
      configKey: keyof FmeExportConfig,
      setter: (val: string) => void,
      maxValue?: number
    ) => {
      return (val: string | number | undefined) => {
        /* Normalisera till sträng för konsekvent hantering */
        const stringVal = typeof val === "number" ? String(val) : (val ?? "")
        const trimmed = stringVal.trim()
        const coerced = parseNonNegativeInt(trimmed)

        if (coerced === undefined || coerced === 0) {
          updateConfig(configKey, undefined as any)
          setter("")
        } else {
          const final = maxValue ? Math.min(coerced, maxValue) : coerced
          updateConfig(configKey, final as any)
          setter(String(final))
        }
      }
    }
  )

  const handleRequestTimeoutBlur = createNumericBlurHandler(
    "requestTimeout",
    setLocalRequestTimeout,
    CONSTANTS.LIMITS.MAX_REQUEST_TIMEOUT_MS
  )

  return (
    <SettingSection>
      {/* Kartval-sektion */}
      <SettingRow
        flow="wrap"
        level={2}
        label={<RequiredLabel text={translate("titleMapConfig")} />}
      >
        <MapWidgetSelector
          useMapWidgetIds={useMapWidgetIds}
          onSelect={onMapWidgetSelected}
        />
      </SettingRow>
      {hasMapSelection && (
        <>
          {/* FME Server connection-fält */}
          <FieldRow
            id={ID.serverUrl}
            label={<RequiredLabel text={translate("lblServerUrl")} />}
            value={localServerUrl}
            onChange={handleServerUrlChange}
            onBlur={handleServerUrlBlur}
            placeholder={translate("phServerUrl")}
            required
            errorText={fieldErrors.serverUrl}
            isPending={isServerValidationPending}
            styles={settingStyles}
          />
          <FieldRow
            id={ID.token}
            label={<RequiredLabel text={translate("lblApiToken")} />}
            value={localToken}
            onChange={handleTokenChange}
            onBlur={handleTokenBlur}
            placeholder={translate("phApiToken")}
            type="password"
            required
            errorText={fieldErrors.token}
            isPending={isTokenValidationPending}
            styles={settingStyles}
          />
          <ConnectionTestSection
            testState={testState}
            checkSteps={checkSteps}
            disabled={isTestDisabled}
            onTestConnection={() => testConnection(false)}
            translate={translate}
            styles={settingStyles}
            validationPhase={validationPhase}
          />
          {shouldShowRepositorySelector && (
            <RepositorySelector
              localServerUrl={localServerUrl}
              localToken={localToken}
              localRepository={selectedRepository}
              availableRepos={availableRepos}
              label={<RequiredLabel text={translate("lblRepositories")} />}
              fieldErrors={fieldErrors}
              validateServerUrl={validateServerUrl}
              validateToken={validateToken}
              onRepositoryChange={handleRepositoryChange}
              onRefreshRepositories={refreshRepositories}
              translate={translate}
              styles={settingStyles}
              ID={ID}
              repoHint={reposHint}
              isBusy={isBusy}
            />
          )}
        </>
      )}
      {shouldShowRemainingSettings && (
        <>
          <SettingRow
            flow="wrap"
            label={
              <Tooltip content={translate("hintServiceMode")} placement="top">
                <span>{translate("lblServiceMode")}</span>
              </Tooltip>
            }
            level={2}
          >
            <Select
              value={localSyncMode ? "sync" : "async"}
              onChange={(value) => {
                const nextMode = value === "sync"
                setLocalSyncMode(nextMode)
                updateConfig("syncMode", nextMode)
              }}
              options={[
                { label: translate("optAsync"), value: "async" },
                { label: translate("optSync"), value: "sync" },
              ]}
              aria-label={translate("lblServiceMode")}
            />
          </SettingRow>
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip content={translate("hintAllowUpload")} placement="top">
                <span>{translate("lblAllowUpload")}</span>
              </Tooltip>
            }
            level={2}
          >
            <Switch
              id={ID.allowRemoteDataset}
              checked={localAllowRemoteDataset}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localAllowRemoteDataset
                setLocalAllowRemoteDataset(checked)
                updateConfig("allowRemoteDataset", checked)
              }}
              aria-label={translate("lblAllowUpload")}
            />
          </SettingRow>
          {shouldShowRemoteDatasetSettings && (
            <FieldRow
              id={ID.uploadTargetParamName}
              label={
                <Tooltip content={translate("hintUploadParam")} placement="top">
                  <span>{translate("lblUploadParam")}</span>
                </Tooltip>
              }
              value={localUploadTargetParamName}
              onChange={(val: string) => {
                setLocalUploadTargetParamName(val)
              }}
              onBlur={(val: string) => {
                const sanitized = sanitizeParamKey(val, "")
                setLocalUploadTargetParamName(sanitized)
                updateConfig("uploadTargetParamName", sanitized)
                setFieldErrors((prev) => ({
                  ...prev,
                  uploadTargetParamName: undefined,
                }))
              }}
              placeholder={translate("phUploadParam")}
              errorText={fieldErrors.uploadTargetParamName}
              styles={settingStyles}
            />
          )}
          {shouldShowRemoteDatasetSettings && (
            <SettingRow
              flow="no-wrap"
              label={
                <Tooltip content={translate("hintAllowUrl")} placement="top">
                  <span>{translate("lblAllowUrl")}</span>
                </Tooltip>
              }
              level={2}
            >
              <Switch
                id={ID.allowRemoteUrlDataset}
                checked={localAllowRemoteUrlDataset}
                onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                  const checked =
                    evt?.target?.checked ?? !localAllowRemoteUrlDataset
                  setLocalAllowRemoteUrlDataset(checked)
                  updateConfig("allowRemoteUrlDataset", checked)
                }}
                aria-label={translate("lblAllowUrl")}
              />
            </SettingRow>
          )}
          <SettingRow
            flow="wrap"
            label={
              <Tooltip
                content={translate("hintMaxArea", {
                  maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
                })}
                placement="top"
              >
                <span>{translate("lblMaxArea")}</span>
              </Tooltip>
            }
            level={2}
            tag="label"
          >
            <NumericInput
              id={ID.maxArea}
              value={toNumericValue(localMaxAreaM2)}
              min={0}
              step={10000}
              precision={0}
              placeholder={translate("phMaxArea")}
              aria-invalid={fieldErrors.maxArea ? true : undefined}
              aria-describedby={
                fieldErrors.maxArea ? `${ID.maxArea}-error` : undefined
              }
              onChange={(value) => {
                setLocalMaxAreaM2(value === undefined ? "" : String(value))
                setFieldErrors((prev) => ({ ...prev, maxArea: undefined }))
              }}
              onBlur={(evt) => {
                const raw =
                  (evt?.target as HTMLInputElement | null)?.value ?? ""
                handleMaxAreaBlur(raw)
              }}
            />
            {fieldErrors.maxArea && (
              <SettingRow flow="wrap" level={2} css={css(settingStyles.row)}>
                <Alert
                  id={`${ID.maxArea}-error`}
                  fullWidth
                  css={css(settingStyles.alertInline)}
                  text={fieldErrors.maxArea}
                  type="error"
                  closable={false}
                />
              </SettingRow>
            )}
          </SettingRow>
          <JobDirectivesSection
            localTmTtc={localTmTtc}
            localTmTtl={localTmTtl}
            onTmTtcChange={(val: string) => {
              setLocalTmTtc(val)
            }}
            onTmTtlChange={(val: string) => {
              setLocalTmTtl(val)
            }}
            onTmTtcBlur={(val: string) => {
              const trimmed = (val ?? "").trim()
              if (trimmed === "") {
                updateConfig("tm_ttc", undefined as any)
                setLocalTmTtc("")
                return
              }
              const coerced = parseNonNegativeInt(trimmed)
              if (coerced === undefined) {
                updateConfig("tm_ttc", undefined as any)
                setLocalTmTtc("")
                return
              }
              updateConfig("tm_ttc", coerced as any)
              setLocalTmTtc(String(coerced))
            }}
            onTmTtlBlur={(val: string) => {
              const trimmed = (val ?? "").trim()
              if (trimmed === "") {
                updateConfig("tm_ttl", undefined as any)
                setLocalTmTtl("")
                return
              }
              const coerced = parseNonNegativeInt(trimmed)
              if (coerced === undefined) {
                updateConfig("tm_ttl", undefined as any)
                setLocalTmTtl("")
                return
              }
              updateConfig("tm_ttl", coerced as any)
              setLocalTmTtl(String(coerced))
            }}
            fieldErrors={fieldErrors}
            translate={translate}
            styles={settingStyles}
            ID={ID}
            showTmTtc={shouldShowTmTtc}
          />
          <SettingRow
            flow="wrap"
            label={
              <Tooltip
                content={translate("hintRequestTimeout")}
                placement="top"
              >
                <span>{translate("lblRequestTimeout")}</span>
              </Tooltip>
            }
            level={2}
            tag="label"
          >
            <NumericInput
              id={ID.requestTimeout}
              value={toNumericValue(localRequestTimeout)}
              min={0}
              step={10000}
              precision={0}
              placeholder={translate("phRequestTimeout")}
              aria-label={translate("lblRequestTimeout")}
              onChange={(value) => {
                setLocalRequestTimeout(value === undefined ? "" : String(value))
              }}
              onBlur={(evt) => {
                const raw =
                  (evt?.target as HTMLInputElement | null)?.value ?? ""
                handleRequestTimeoutBlur(raw)
              }}
            />
          </SettingRow>
          <FieldRow
            id={ID.aoiParamName}
            label={
              <Tooltip content={translate("hintAoiParam")} placement="top">
                <span>{translate("lblAoiParam")}</span>
              </Tooltip>
            }
            value={localAoiParamName}
            onChange={(val: string) => {
              setLocalAoiParamName(val)
            }}
            onBlur={(val: string) => {
              const trimmed = val.trim()
              const finalValue = trimmed || "AreaOfInterest"
              updateConfig("aoiParamName", finalValue)
              setLocalAoiParamName(finalValue)
            }}
            placeholder={translate("phAoiParam")}
            styles={settingStyles}
          />
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip content={translate("hintRequireHttps")} placement="top">
                <span>{translate("lblRequireHttps")}</span>
              </Tooltip>
            }
            level={2}
          >
            <Switch
              id={ID.requireHttps}
              checked={localRequireHttps}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localRequireHttps
                setLocalRequireHttps(checked)
                updateConfig("requireHttps", checked)
              }}
              aria-label={translate("lblRequireHttps")}
            />
          </SettingRow>
          {shouldShowMaskEmailSetting && (
            <SettingRow
              flow="no-wrap"
              label={
                <Tooltip content={translate("hintMaskEmail")} placement="top">
                  <span>{translate("lblMaskEmail")}</span>
                </Tooltip>
              }
              level={2}
            >
              <Switch
                id={ID.maskEmailOnSuccess}
                checked={localMaskEmailOnSuccess}
                onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                  const checked =
                    evt?.target?.checked ?? !localMaskEmailOnSuccess
                  setLocalMaskEmailOnSuccess(checked)
                  updateConfig("maskEmailOnSuccess", checked)
                }}
                aria-label={translate("lblMaskEmail")}
              />
            </SettingRow>
          )}
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip content={translate("hintShowResult")} placement="top">
                <span>{translate("lblShowResult")}</span>
              </Tooltip>
            }
            level={2}
          >
            <Switch
              id={ID.showResult}
              checked={localShowResult}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localShowResult
                setLocalShowResult(checked)
                updateConfig("showResult", checked)
              }}
              aria-label={translate("lblShowResult")}
            />
          </SettingRow>
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip content={translate("hintAutoClose")} placement="top">
                <span>{translate("lblAutoClose")}</span>
              </Tooltip>
            }
            level={2}
          >
            <Switch
              id={ID.autoCloseOtherWidgets}
              checked={localAutoCloseOtherWidgets}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked =
                  evt?.target?.checked ?? !localAutoCloseOtherWidgets
                setLocalAutoCloseOtherWidgets(checked)
                updateConfig("autoCloseOtherWidgets", checked)
              }}
              aria-label={translate("lblAutoClose")}
            />
          </SettingRow>
          <FieldRow
            id={ID.supportEmail}
            label={
              <Tooltip content={translate("hintSupportEmail")} placement="top">
                <span>{translate("lblSupportEmail")}</span>
              </Tooltip>
            }
            type="email"
            value={localSupportEmail}
            onChange={(val: string) => {
              setLocalSupportEmail(val)
              setFieldErrors((prev) => ({ ...prev, supportEmail: undefined }))
            }}
            onBlur={(val: string) => {
              const trimmed = (val ?? "").trim()
              if (!trimmed) {
                setFieldErrors((prev) => ({
                  ...prev,
                  supportEmail: undefined,
                }))
                updateConfig("supportEmail", undefined as any)
                setLocalSupportEmail("")
                return
              }
              const isValid = isValidEmail(trimmed)
              const err = !isValid ? translate("errInvalidEmail") : undefined
              setFieldErrors((prev) => ({ ...prev, supportEmail: err }))
              if (!err) {
                updateConfig("supportEmail", trimmed)
                setLocalSupportEmail(trimmed)
              }
            }}
            placeholder={translate("phEmail")}
            errorText={fieldErrors.supportEmail}
            styles={settingStyles}
          />
          <SettingRow
            flow="wrap"
            label={
              <Tooltip
                content={translate("hintLargeArea", {
                  maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
                })}
                placement="top"
              >
                <span>{translate("lblLargeArea")}</span>
              </Tooltip>
            }
            level={2}
            tag="label"
          >
            <NumericInput
              id={ID.largeArea}
              value={toNumericValue(localLargeAreaM2)}
              min={0}
              step={10000}
              precision={0}
              placeholder={translate("phLargeArea")}
              aria-invalid={fieldErrors.largeArea ? true : undefined}
              aria-describedby={
                fieldErrors.largeArea ? `${ID.largeArea}-error` : undefined
              }
              onChange={handleLargeAreaChange}
              onBlur={(evt) => {
                const raw =
                  (evt?.target as HTMLInputElement | null)?.value ?? ""
                handleLargeAreaBlur(raw)
              }}
            />
            {fieldErrors.largeArea && (
              <SettingRow flow="wrap" level={2} css={css(settingStyles.row)}>
                <Alert
                  id={`${ID.largeArea}-error`}
                  fullWidth
                  css={css(settingStyles.alertInline)}
                  text={fieldErrors.largeArea}
                  type="error"
                  closable={false}
                />
              </SettingRow>
            )}
          </SettingRow>
          <SettingRow
            flow="wrap"
            label={translate("lblDrawColor")}
            level={2}
            tag="label"
          >
            <ColorPickerWrapper
              value={localDrawingColor}
              onChange={(hex: string) => {
                const val = (hex || "").trim()
                const cleaned = /^#?[0-9a-f]{6}$/i.test(val)
                  ? val.startsWith("#")
                    ? val
                    : `#${val}`
                  : DEFAULT_DRAWING_HEX
                setLocalDrawingColor(cleaned)
                updateConfig("drawingColor", cleaned as any)
              }}
              aria-label={translate("lblDrawColor")}
            />
          </SettingRow>
        </>
      )}
    </SettingSection>
  )
}

// Query Client Provider wrapper för setting-komponenten
export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  return (
    <QueryClientProvider client={fmeQueryClient}>
      <SettingContent {...props} />
    </QueryClientProvider>
  )
}
