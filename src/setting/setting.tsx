/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
import { QueryClientProvider } from "@tanstack/react-query"
import { fmeQueryClient } from "../shared/query-client"
import {
  setError,
  clearErrors,
  parseNonNegativeInt,
  isValidEmail,
  toTrimmedString,
  collectTrimmedStrings,
  uniqueStrings,
  isAbortError,
  sanitizeParamKey,
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
import { Loading, LoadingType, Switch } from "jimu-ui"
import {
  Alert,
  Button,
  Icon,
  Input,
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
  mapErrorToKey,
  mapServerUrlReasonToKey,
  validateConnectionInputs,
} from "../shared/validations"
import { fmeActions, createFmeSelectors } from "../extensions/store"
import type {
  FmeExportConfig,
  IMWidgetConfig,
  FmeFlowConfig,
  TestState,
  FieldErrors,
  StepStatus,
  CheckSteps,
  ValidationResult,
  TranslateFn,
  SettingStyles,
  ConnectionTestSectionProps,
  RepositorySelectorProps,
  JobDirectivesSectionProps,
  ValidationPhase,
} from "../config/index"
import {
  DEFAULT_DRAWING_HEX,
  SETTING_CONSTANTS,
  useSettingStyles,
} from "../config/index"
import resetIcon from "../assets/icons/refresh.svg"

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

/* UI-sektion för anslutningstest med steg-för-steg-status */
const ConnectionTestSection: React.FC<ConnectionTestSectionProps> = ({
  testState,
  checkSteps,
  disabled,
  onTestConnection,
  translate,
  styles,
  validationPhase,
}) => {
  /* Type guard för att identifiera StepStatus-objekt */
  const isStepStatus = (v: unknown): v is StepStatus =>
    typeof v === "object" &&
    v !== null &&
    Object.prototype.hasOwnProperty.call(v, "completed")
  /* Stabila hjälpfunktioner för färg och text baserat på status */
  const getStatusStyle = hooks.useEventCallback(
    (s: StepStatus | string): any => {
      switch (s) {
        case "ok":
          return styles.status.color.ok
        case "fail":
          return styles.status.color.fail
        case "skip":
          return styles.status.color.skip
        case "pending":
        case "idle":
          return styles.status.color.pending
        default:
          if (isStepStatus(s)) {
            return s.completed
              ? styles.status.color.ok
              : styles.status.color.fail
          }
          return styles.status.color.pending
      }
    }
  )

  /* Returnerar översatt statustext för varje validerings-steg */
  const getStatusText = hooks.useEventCallback(
    (status: StepStatus | string): string => {
      if (typeof status === "string") {
        if (status === "ok") return translate("ok")
        if (status === "fail") return translate("failed")
        if (status === "skip") return translate("skipped")
        return translate("checking")
      }
      if (isStepStatus(status) && status.completed) return translate("ok")
      if (isStepStatus(status) && status.error) return translate("failed")
      return translate("checking")
    }
  )

  /* Renderar anslutningsstatus med alla validerings-steg */
  const renderConnectionStatus = (): React.ReactNode => {
    const rowsAll: Array<{ label: string; status: StepStatus | string }> = [
      { label: translate("fmeServerUrl"), status: checkSteps.serverUrl },
      { label: translate("fmeServerToken"), status: checkSteps.token },
      { label: translate("fmeRepository"), status: checkSteps.repository },
    ]
    const rows = rowsAll.filter((r) => r.status !== "idle")

    const StatusRow = ({
      label,
      status,
    }: {
      label: string
      status: StepStatus | string
    }) => {
      const color = getStatusStyle(status)
      return (
        <div css={css(styles.status.row)}>
          <div css={css(styles.status.labelGroup)}>
            <>
              {label}
              <span aria-hidden="true">{translate("colon")}</span>
            </>
          </div>
          <div css={css(color)}>{getStatusText(status)}</div>
        </div>
      )
    }
    /* Extraherar versions-sträng om tillgänglig */
    const versionText =
      typeof checkSteps.version === "string" ? checkSteps.version : ""
    const hasVersion: boolean = versionText.length > 0

    const phaseKey = (() => {
      if (validationPhase === "checking") return "testingConnection"
      if (validationPhase === "fetchingRepos") return "loadingRepositories"
      return null
    })()

    return (
      <div
        css={css(styles.status.container)}
        role="status"
        aria-live="polite"
        aria-atomic={true}
        aria-busy={
          testState.isTesting || validationPhase === "fetchingRepos"
            ? true
            : undefined
        }
      >
        {(testState.isTesting || validationPhase === "fetchingRepos") && (
          <Loading
            type={LoadingType.Bar}
            text={translate(
              validationPhase === "fetchingRepos"
                ? "loadingRepositories"
                : "testingConnection"
            )}
          />
        )}

        <div css={css(styles.status.list)}>
          {phaseKey && (
            <div css={css(styles.status.row)}>
              <div>{translate(phaseKey)}</div>
            </div>
          )}
          {rows.map((r) => (
            <StatusRow key={r.label} label={r.label} status={r.status} />
          ))}
          {hasVersion && (
            <div css={css(styles.status.row)}>
              <div css={css(styles.status.labelGroup)}>
                {translate("fmeVersion")}
                <span aria-hidden="true">{translate("colon")}</span>
              </div>
              <div>{versionText}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Anslutningstest-knapp */}
      <SettingRow flow="wrap" level={2}>
        <Button
          disabled={disabled}
          alignText="center"
          type="primary"
          text={
            testState.isTesting
              ? translate("testing")
              : translate("testConnection")
          }
          onClick={onTestConnection}
        />
      </SettingRow>
      {(testState.isTesting || testState.message) && (
        <SettingRow flow="wrap" level={3}>
          {renderConnectionStatus()}
        </SettingRow>
      )}
    </>
  )
}

/* Repository-väljare med auto-refresh och fallback till manuell input */
const RepositorySelector: React.FC<RepositorySelectorProps> = ({
  localServerUrl,
  localToken,
  localRepository,
  availableRepos,
  label,
  fieldErrors,
  validateServerUrl,
  validateToken,
  onRepositoryChange,
  onRefreshRepositories,
  translate,
  styles,
  ID,
  repoHint,
  isBusy,
}) => {
  /* Validerar server och token för att avgöra om refresh är tillåten */
  const serverCheck = validateServerUrl(localServerUrl, { requireHttps: true })
  const tokenCheck = validateToken(localToken)
  const hasValidServer = !!localServerUrl && serverCheck.ok
  const hasValidToken = tokenCheck.ok
  const canRefresh = hasValidServer && hasValidToken && !isBusy

  /* Bygger options-lista från tillgängliga repos och lokalt val */
  const buildRepoOptions = hooks.useEventCallback(
    (): Array<{ label: string; value: string }> => {
      if (!hasValidServer || !hasValidToken) return []
      if (availableRepos === null) return []

      const available = Array.isArray(availableRepos)
        ? collectTrimmedStrings(availableRepos)
        : []

      const local = toTrimmedString(localRepository)
      const names = uniqueStrings([...(local ? [local] : []), ...available])

      return names.map((name) => ({ label: name, value: name }))
    }
  )

  const isSelectDisabled =
    !hasValidServer || !hasValidToken || availableRepos === null || isBusy
  /* Bestämmer placeholder-text baserat på validerings-status */
  const repositoryPlaceholder = (() => {
    if (!hasValidServer || !hasValidToken) {
      return translate("testConnectionFirst")
    }

    if (availableRepos === null) {
      return translate("loadingRepositories")
    }

    if (Array.isArray(availableRepos) && availableRepos.length === 0) {
      return translate("noRepositoriesFound")
    }

    return translate("repoPlaceholder")
  })()

  return (
    <SettingRow
      flow="wrap"
      label={
        <div css={styles.labelWithButton}>
          <span css={styles.labelText}>{label}</span>
          {canRefresh && (
            <Button
              size="sm"
              block={false}
              onClick={onRefreshRepositories}
              type="tertiary"
              title={translate("refreshRepositories")}
              icon={<Icon src={resetIcon} size={14} />}
            />
          )}
        </div>
      }
      level={1}
      tag="label"
    >
      {/* Om ingen repo hittades, tillåt manuell input */}
      {Array.isArray(availableRepos) && availableRepos.length === 0 ? (
        // No repositories found - show text input to allow manual entry
        <Input
          id={ID.repository}
          value={localRepository}
          onChange={(val: string) => {
            onRepositoryChange(val)
          }}
          placeholder={translate("repoPlaceholder")}
          aria-describedby={
            fieldErrors.repository ? `${ID.repository}-error` : undefined
          }
          aria-invalid={fieldErrors.repository ? true : undefined}
        />
      ) : (
        <Select
          options={buildRepoOptions()}
          value={localRepository || undefined}
          onChange={(val) => {
            const next =
              typeof val === "string" || typeof val === "number"
                ? String(val)
                : ""
            onRepositoryChange(next)
          }}
          disabled={isSelectDisabled}
          aria-describedby={
            fieldErrors.repository ? `${ID.repository}-error` : undefined
          }
          aria-invalid={fieldErrors.repository ? true : undefined}
          placeholder={repositoryPlaceholder}
        />
      )}
      {fieldErrors.repository && (
        <SettingRow flow="wrap" level={3}>
          <Alert
            id={`${ID.repository}-error`}
            fullWidth
            css={css(styles.alertInline)}
            text={fieldErrors.repository}
            type="error"
            closable={false}
          />
        </SettingRow>
      )}
      {repoHint && (
        <SettingRow flow="wrap" level={3}>
          <Alert
            fullWidth
            css={css(styles.alertInline)}
            text={repoHint}
            type="warning"
            closable={false}
          />
        </SettingRow>
      )}
    </SettingRow>
  )
}

/* Återanvändbar fält-rad för konsekvent markup och felrendering */
const FieldRow: React.FC<{
  id: string
  label: React.ReactNode
  value: string
  onChange: (val: string) => void
  onBlur?: (val: string) => void
  placeholder?: string
  type?: "text" | "email" | "password"
  required?: boolean
  errorText?: string
  maxLength?: number
  disabled?: boolean
  isPending?: boolean
  styles: SettingStyles
}> = ({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  required = false,
  errorText,
  maxLength,
  disabled,
  isPending = false,
  styles,
}) => (
  <SettingRow flow="wrap" label={label} level={1} tag="label">
    <Input
      id={id}
      type={type}
      required={required}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      errorText={errorText}
      maxLength={maxLength}
      disabled={disabled}
      aria-invalid={errorText ? true : undefined}
      aria-describedby={errorText ? `${id}-error` : undefined}
      aria-busy={isPending ? true : undefined}
    />
    {isPending && (
      <SettingRow
        flow="wrap"
        level={3}
        css={css(styles.row)}
        role="status"
        aria-live="polite"
        aria-atomic={true}
      >
        <div css={css(styles.fieldStatus)}>
          <Loading
            type={LoadingType.Secondary}
            width={16}
            height={16}
            aria-hidden={true}
          />
        </div>
      </SettingRow>
    )}
    {errorText && (
      <SettingRow flow="wrap" level={3} css={css(styles.row)}>
        <Alert
          id={`${id}-error`}
          fullWidth
          css={css(styles.alertInline)}
          text={errorText}
          type="error"
          closable={false}
        />
      </SettingRow>
    )}
  </SettingRow>
)

/* Konverterar sträng till numeriskt värde eller undefined */
const toNumericValue = (value: string): number | undefined => {
  const trimmed = (value ?? "").trim()
  if (trimmed === "") return undefined
  return parseNonNegativeInt(trimmed)
}

/* Sektion för FME job directives (tm_ttc, tm_ttl) */
const JobDirectivesSection: React.FC<JobDirectivesSectionProps> = ({
  localTmTtc,
  localTmTtl,
  onTmTtcChange,
  onTmTtlChange,
  onTmTtcBlur,
  onTmTtlBlur,
  fieldErrors,
  translate,
  styles,
  ID,
}) => {
  return (
    <SettingRow flow="wrap" level={2}>
      {/* Job directives (admin-standardvärden) */}
      <SettingRow
        flow="wrap"
        label={
          <Tooltip content={translate("tm_ttcHelper")} placement="top">
            <span>{translate("tm_ttcLabel")}</span>
          </Tooltip>
        }
        level={1}
        tag="label"
      >
        <NumericInput
          id={ID.tm_ttc}
          value={toNumericValue(localTmTtc)}
          min={0}
          step={1}
          precision={0}
          placeholder={translate("tm_ttcPlaceholder")}
          aria-invalid={fieldErrors.tm_ttc ? true : undefined}
          aria-describedby={
            fieldErrors.tm_ttc ? `${ID.tm_ttc}-error` : undefined
          }
          onChange={(value) => {
            onTmTtcChange(value === undefined ? "" : String(value))
          }}
          onBlur={(evt) => {
            const raw = (evt?.target as HTMLInputElement | null)?.value ?? ""
            onTmTtcBlur(raw)
          }}
        />
        {fieldErrors.tm_ttc && (
          <SettingRow flow="wrap" level={3} css={css(styles.row)}>
            <Alert
              id={`${ID.tm_ttc}-error`}
              fullWidth
              css={css(styles.alertInline)}
              text={fieldErrors.tm_ttc}
              type="error"
              closable={false}
            />
          </SettingRow>
        )}
      </SettingRow>
      <SettingRow
        flow="wrap"
        label={
          <Tooltip content={translate("tm_ttlHelper")} placement="top">
            <span>{translate("tm_ttlLabel")}</span>
          </Tooltip>
        }
        level={1}
        tag="label"
      >
        <NumericInput
          id={ID.tm_ttl}
          value={toNumericValue(localTmTtl)}
          min={0}
          step={1}
          precision={0}
          placeholder={translate("tm_ttlPlaceholder")}
          aria-invalid={fieldErrors.tm_ttl ? true : undefined}
          aria-describedby={
            fieldErrors.tm_ttl ? `${ID.tm_ttl}-error` : undefined
          }
          onChange={(value) => {
            onTmTtlChange(value === undefined ? "" : String(value))
          }}
          onBlur={(evt) => {
            const raw = (evt?.target as HTMLInputElement | null)?.value ?? ""
            onTmTtlBlur(raw)
          }}
        />
        {fieldErrors.tm_ttl && (
          <SettingRow flow="wrap" level={3} css={css(styles.row)}>
            <Alert
              id={`${ID.tm_ttl}-error`}
              fullWidth
              css={css(styles.alertInline)}
              text={fieldErrors.tm_ttl}
              type="error"
              closable={false}
            />
          </SettingRow>
        )}
      </SettingRow>
    </SettingRow>
  )
}

/* Centraliserad hanterare för valideringsfel - uppdaterar steg och fel */
const handleValidationFailure = (
  errorType: "server" | "network" | "token" | "repository",
  opts: {
    setCheckSteps: React.Dispatch<React.SetStateAction<CheckSteps>>
    setFieldErrors: React.Dispatch<React.SetStateAction<FieldErrors>>
    translate: TranslateFn
    version?: string
  }
) => {
  const { setCheckSteps, setFieldErrors, translate, version } = opts
  if (errorType === "server" || errorType === "network") {
    setCheckSteps((prev) => ({
      ...prev,
      serverUrl: "fail",
      token: "idle",
      repository: "idle",
      version: "",
    }))
    setError(setFieldErrors, "serverUrl", translate("errorInvalidServerUrl"))
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
    setError(setFieldErrors, "token", translate("errorTokenIsInvalid"))
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
  setError(setFieldErrors, "repository", translate("errorRepositoryNotFound"))
  clearErrors(setFieldErrors, ["serverUrl", "token"])
  /* Repository-lista hanteras av useRepositories query hook */
}

/*
 * Inre komponenten som använder React Query hooks.
 * Måste renderas inuti QueryClientProvider.
 */
function SettingContent(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages as any)
  const styles = useStyles()
  const settingStyles = useSettingStyles()
  const dispatch = useDispatch()

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
    allowScheduleMode: "setting-allow-schedule-mode",
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
  const [localAllowScheduleMode, setLocalAllowScheduleMode] =
    React.useState<boolean>(() => getBooleanConfig("allowScheduleMode"))
  const [localAllowRemoteDataset, setLocalAllowRemoteDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteDataset"))
  const [localAllowRemoteUrlDataset, setLocalAllowRemoteUrlDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteUrlDataset"))
  React.useEffect(() => {
    if (!localAllowRemoteDataset && localAllowRemoteUrlDataset) {
      setLocalAllowRemoteUrlDataset(false)
      updateConfig("allowRemoteUrlDataset", false)
    }
  }, [localAllowRemoteDataset, localAllowRemoteUrlDataset, updateConfig])
  const shouldShowMaskEmailSetting = !localSyncMode
  const shouldShowScheduleToggle = !localSyncMode
  const hasMapSelection =
    Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
  const hasServerInputs = Boolean(trimmedLocalServerUrl && trimmedLocalToken)
  const shouldShowRepositorySelector = hasMapSelection && hasServerInputs
  const hasRepositorySelection = !!toTrimmedString(selectedRepository)
  const shouldShowRemainingSettings =
    hasMapSelection && hasServerInputs && hasRepositorySelection

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
    /* Schedule mode: rensa om inte längre synlig */
    if (!shouldShowScheduleToggle && localAllowScheduleMode) {
      setLocalAllowScheduleMode(false)
      updateConfig("allowScheduleMode", false as any)
    }

    /* Mask email: rensa om inte längre synlig */
    if (!shouldShowMaskEmailSetting && localMaskEmailOnSuccess) {
      setLocalMaskEmailOnSuccess(false)
      updateConfig("maskEmailOnSuccess", false as any)
    }
  }, [
    shouldShowScheduleToggle,
    shouldShowMaskEmailSetting,
    localMaskEmailOnSuccess,
    localAllowScheduleMode,
    updateConfig,
  ])

  /* Drawing color (hex) med ArcGIS brand blue som standard */
  const [localDrawingColor, setLocalDrawingColor] = React.useState<string>(
    () => getStringConfig("drawingColor") || DEFAULT_DRAWING_HEX
  )

  /* ============================================
   * Query Hooks för datafetchning
   * ============================================ */

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
  const availableRepos: string[] | null = (() => {
    if (!repositoriesQuery.data) return null
    return repositoriesQuery.data.map((repo) => repo.name)
  })()

  /* Hanterar repository query-fel */
  hooks.useEffectWithPreviousValues(() => {
    if (repositoriesQuery.isError && !isAbortError(repositoriesQuery.error)) {
      setReposHint(translate("errorRepositories"))
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
      <Tooltip content={translate("requiredField")} placement="top">
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
          messages.serverUrl = translate(composite.errors.serverUrl)
        if (composite.errors.token)
          messages.token = translate(composite.errors.token)
        if (!skipRepoCheck && composite.errors.repository)
          messages.repository = translate(composite.errors.repository)
      }

      /* Support-email är valfri men måste vara giltig om angiven */
      const trimmedEmail = (localSupportEmail ?? "").trim()
      if (trimmedEmail) {
        const emailValid = isValidEmail(trimmedEmail)
        if (!emailValid) messages.supportEmail = translate("invalidEmail")
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
            ? translate("connectionOkRepositoryWarning")
            : translate("connectionOk"),
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
      })

      if (!silent) {
        setTestState({
          status: "error",
          isTesting: false,
          message: error?.message || translate("connectionFailed"),
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
      handleValidationFailure(failureType, {
        setCheckSteps,
        setFieldErrors,
        translate,
        version: "",
      })

      if (!silent) {
        const status = err instanceof Error ? 0 : extractHttpStatus(err)
        const errorKey = mapErrorToKey(err, status)
        setTestState({
          status: "error",
          isTesting: false,
          message:
            failureType === "network"
              ? translate("errorInvalidServerUrl")
              : translate(errorKey),
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
          message: translate("fixErrorsAbove"),
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
      message: silent ? null : translate("testingConnection"),
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
          message: translate("testingConnection"),
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
    await repositoriesQuery.refetch()
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
        : translate("errorRepositoryNotFound")
      setError(setFieldErrors, "repository", errorMessage)
    } else if (
      Array.isArray(availableRepos) &&
      availableRepos.length === 0 &&
      selectedRepository
    ) {
      // Allow manual entry when list is empty
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
        dispatch(fmeActions.clearWorkspaceState(id))
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
        level={1}
        label={<RequiredLabel text={translate("mapConfiguration")} />}
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
            label={<RequiredLabel text={translate("fmeServerUrl")} />}
            value={localServerUrl}
            onChange={handleServerUrlChange}
            onBlur={handleServerUrlBlur}
            placeholder={translate("serverUrlPlaceholder")}
            required
            errorText={fieldErrors.serverUrl}
            isPending={isServerValidationPending}
            styles={settingStyles}
          />
          <FieldRow
            id={ID.token}
            label={<RequiredLabel text={translate("fmeServerToken")} />}
            value={localToken}
            onChange={handleTokenChange}
            onBlur={handleTokenBlur}
            placeholder={translate("tokenPlaceholder")}
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
              label={
                <RequiredLabel text={translate("availableRepositories")} />
              }
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
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("serviceModeSyncHelper")}
                placement="top"
              >
                <span>{translate("serviceModeSync")}</span>
              </Tooltip>
            }
            level={1}
          >
            <Switch
              id={ID.syncMode}
              checked={localSyncMode}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localSyncMode
                setLocalSyncMode(checked)
                updateConfig("syncMode", checked)
              }}
              aria-label={translate("serviceModeSync")}
            />
          </SettingRow>
          {shouldShowScheduleToggle && (
            <SettingRow
              flow="no-wrap"
              label={
                <Tooltip
                  content={translate("allowScheduleModeHelper")}
                  placement="top"
                >
                  <span>{translate("allowScheduleModeLabel")}</span>
                </Tooltip>
              }
              level={1}
            >
              <Switch
                id={ID.allowScheduleMode}
                checked={localAllowScheduleMode}
                onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                  const checked =
                    evt?.target?.checked ?? !localAllowScheduleMode
                  setLocalAllowScheduleMode(checked)
                  updateConfig("allowScheduleMode", checked)
                }}
                aria-label={translate("allowScheduleModeLabel")}
              />
            </SettingRow>
          )}
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("allowRemoteDatasetHelper")}
                placement="top"
              >
                <span>{translate("allowRemoteDatasetLabel")}</span>
              </Tooltip>
            }
            level={1}
          >
            <Switch
              id={ID.allowRemoteDataset}
              checked={localAllowRemoteDataset}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localAllowRemoteDataset
                setLocalAllowRemoteDataset(checked)
                updateConfig("allowRemoteDataset", checked)
                if (!checked && localAllowRemoteUrlDataset) {
                  setLocalAllowRemoteUrlDataset(false)
                  updateConfig("allowRemoteUrlDataset", false)
                }
                if (!checked) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    uploadTargetParamName: undefined,
                  }))
                }
              }}
              aria-label={translate("allowRemoteDatasetLabel")}
            />
          </SettingRow>
          {localAllowRemoteDataset && (
            <FieldRow
              id={ID.uploadTargetParamName}
              label={
                <Tooltip
                  content={translate("uploadTargetParamNameHelper")}
                  placement="top"
                >
                  <span>{translate("uploadTargetParamNameLabel")}</span>
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
              placeholder={translate("uploadTargetParamNamePlaceholder")}
              errorText={fieldErrors.uploadTargetParamName}
              styles={settingStyles}
            />
          )}
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("allowRemoteUrlDatasetHelper")}
                placement="top"
              >
                <span>{translate("allowRemoteUrlDatasetLabel")}</span>
              </Tooltip>
            }
            level={1}
          >
            <Switch
              id={ID.allowRemoteUrlDataset}
              checked={localAllowRemoteUrlDataset}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                if (!localAllowRemoteDataset) {
                  return
                }
                const checked =
                  evt?.target?.checked ?? !localAllowRemoteUrlDataset
                setLocalAllowRemoteUrlDataset(checked)
                updateConfig("allowRemoteUrlDataset", checked)
              }}
              disabled={!localAllowRemoteDataset}
              aria-label={translate("allowRemoteUrlDatasetLabel")}
            />
          </SettingRow>
          <SettingRow
            flow="wrap"
            label={
              <Tooltip
                content={translate("maxAreaHelper", {
                  maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
                })}
                placement="top"
              >
                <span>{translate("maxAreaLabel")}</span>
              </Tooltip>
            }
            level={1}
            tag="label"
          >
            <NumericInput
              id={ID.maxArea}
              value={toNumericValue(localMaxAreaM2)}
              min={0}
              step={10000}
              precision={0}
              placeholder={translate("maxAreaPlaceholder")}
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
              <SettingRow flow="wrap" level={3} css={css(settingStyles.row)}>
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
          />
          <SettingRow
            flow="wrap"
            label={
              <Tooltip
                content={translate("requestTimeoutHelper")}
                placement="top"
              >
                <span>{translate("requestTimeoutLabel")}</span>
              </Tooltip>
            }
            level={1}
            tag="label"
          >
            <NumericInput
              id={ID.requestTimeout}
              value={toNumericValue(localRequestTimeout)}
              min={0}
              step={10000}
              precision={0}
              placeholder={translate("requestTimeoutPlaceholder")}
              aria-label={translate("requestTimeoutLabel")}
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
              <Tooltip
                content={translate("aoiParamNameHelper")}
                placement="top"
              >
                <span>{translate("aoiParamNameLabel")}</span>
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
            placeholder={translate("aoiParamNamePlaceholder")}
            styles={settingStyles}
          />
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("requireHttpsHelper")}
                placement="top"
              >
                <span>{translate("requireHttpsLabel")}</span>
              </Tooltip>
            }
            level={1}
          >
            <Switch
              id={ID.requireHttps}
              checked={localRequireHttps}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localRequireHttps
                setLocalRequireHttps(checked)
                updateConfig("requireHttps", checked)
              }}
              aria-label={translate("requireHttpsLabel")}
            />
          </SettingRow>
          {shouldShowMaskEmailSetting && (
            <SettingRow
              flow="no-wrap"
              label={
                <Tooltip
                  content={translate("maskEmailOnSuccessHelper")}
                  placement="top"
                >
                  <span>{translate("maskEmailOnSuccess")}</span>
                </Tooltip>
              }
              level={1}
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
                aria-label={translate("maskEmailOnSuccess")}
              />
            </SettingRow>
          )}
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip content={translate("showResultHelper")} placement="top">
                <span>{translate("showResultLabel")}</span>
              </Tooltip>
            }
            level={1}
          >
            <Switch
              id={ID.showResult}
              checked={localShowResult}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localShowResult
                setLocalShowResult(checked)
                updateConfig("showResult", checked)
              }}
              aria-label={translate("showResultLabel")}
            />
          </SettingRow>
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("autoCloseOtherWidgetsHelper")}
                placement="top"
              >
                <span>{translate("autoCloseOtherWidgetsLabel")}</span>
              </Tooltip>
            }
            level={1}
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
              aria-label={translate("autoCloseOtherWidgetsLabel")}
            />
          </SettingRow>
          <FieldRow
            id={ID.supportEmail}
            label={
              <Tooltip
                content={translate("supportEmailHelper")}
                placement="top"
              >
                <span>{translate("supportEmail")}</span>
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
              const err = !isValid ? translate("invalidEmail") : undefined
              setFieldErrors((prev) => ({ ...prev, supportEmail: err }))
              if (!err) {
                updateConfig("supportEmail", trimmed)
                setLocalSupportEmail(trimmed)
              }
            }}
            placeholder={translate("supportEmailPlaceholder")}
            errorText={fieldErrors.supportEmail}
            styles={settingStyles}
          />
          <SettingRow
            flow="wrap"
            label={
              <Tooltip
                content={translate("largeAreaHelper", {
                  maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
                })}
                placement="top"
              >
                <span>{translate("largeAreaLabel")}</span>
              </Tooltip>
            }
            level={1}
            tag="label"
          >
            <NumericInput
              id={ID.largeArea}
              value={toNumericValue(localLargeAreaM2)}
              min={0}
              step={10000}
              precision={0}
              placeholder={translate("largeAreaPlaceholder")}
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
              <SettingRow flow="wrap" level={3} css={css(settingStyles.row)}>
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
            label={translate("drawingColorLabel")}
            level={1}
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
              aria-label={translate("drawingColorLabel")}
            />
          </SettingRow>
        </>
      )}
    </SettingSection>
  )
}

/*
 * Wrapper-komponent som tillhandahåller QueryClient-kontext till SettingContent.
 * Detta är nödvändigt eftersom React Query hooks (useRepositories,
 * useValidateConnection) kräver QueryClientProvider i komponentträdet.
 *
 * Använder delad fmeQueryClient singleton för cache-delning med runtime.
 */
export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  return (
    <QueryClientProvider client={fmeQueryClient}>
      <SettingContent {...props} />
    </QueryClientProvider>
  )
}
