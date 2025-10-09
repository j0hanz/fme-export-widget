/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
import {
  setError,
  clearErrors,
  parseNonNegativeInt,
  parseOptionalNonNegativeInt,
  isValidEmail,
  toTrimmedString,
  uniqueStrings,
  buildConnectionCacheKey,
  sanitizeRepositoryList,
  isAbortError,
} from "../shared/utils"
import {
  useBuilderSelector,
  useStringConfigValue,
  useBooleanConfigValue,
  useNumberConfigValue,
  useUpdateConfig,
  useLatestAbortController,
  useDebounce,
  clearWorkspaceMetadataCache,
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
import {
  validateConnection,
  getRepositories as fetchRepositoriesService,
  clearConnectionValidationCaches,
  clearRepositoryCache,
} from "../shared/services"
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
  MapConfigurationSectionProps,
  ConnectionSettingsPanelProps,
} from "../config/index"
import {
  DEFAULT_DRAWING_HEX,
  SETTING_CONSTANTS,
  ValidationFailureType,
  useSettingStyles,
} from "../config/index"
import resetIcon from "../assets/icons/refresh.svg"

// Local constants for this settings panel
const REPOSITORY_CACHE_TTL_MS = 30000 // 30 seconds
const SERVER_URL_DEBOUNCE_MS = 500
const TOKEN_DEBOUNCE_MS = 500
const REPOSITORY_DEBOUNCE_MS = 300

const CONSTANTS = SETTING_CONSTANTS

const getInitialTestState = (): TestState => ({
  status: "idle",
  isTesting: false,
  message: undefined,
  type: "info",
})

const getInitialCheckSteps = (): CheckSteps => ({
  serverUrl: "idle",
  token: "idle",
  repository: "idle",
  version: "",
})

const ConnectionTestSection: React.FC<ConnectionTestSectionProps> = ({
  testState,
  checkSteps,
  disabled,
  onTestConnection,
  translate,
  styles,
}) => {
  const isStepStatus = (v: unknown): v is StepStatus =>
    typeof v === "object" && v !== null && "completed" in v
  // Hoisted helpers for readability and stability
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
    // Determine if version string is present on checkSteps
    const versionText =
      typeof checkSteps.version === "string" ? checkSteps.version : ""
    const hasVersion: boolean = versionText.length > 0

    return (
      <div
        css={css(styles.status.container)}
        role="status"
        aria-live="polite"
        aria-atomic={true}
        aria-busy={testState.isTesting ? true : undefined}
      >
        {testState.isTesting && (
          <Loading
            type={LoadingType.Bar}
            text={translate("testingConnection")}
          />
        )}

        <div css={css(styles.status.list)}>
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
      {/* Test connection */}
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
  // Allow manual refresh whenever URL and token are present and pass basic validation
  const serverCheck = validateServerUrl(localServerUrl, { requireHttps: true })
  const tokenCheck = validateToken(localToken)
  const hasValidServer = !!localServerUrl && serverCheck.ok
  const hasValidToken = tokenCheck.ok
  const canRefresh = hasValidServer && hasValidToken && !isBusy

  const buildRepoOptions = hooks.useEventCallback(
    (): Array<{ label: string; value: string }> => {
      if (!hasValidServer || !hasValidToken) return []
      if (availableRepos === null) return []

      const available = Array.isArray(availableRepos)
        ? sanitizeRepositoryList(availableRepos)
        : []

      const local = toTrimmedString(localRepository)
      const names = uniqueStrings([...(local ? [local] : []), ...available])

      return names.map((name) => ({ label: name, value: name }))
    }
  )

  const isSelectDisabled =
    !hasValidServer || !hasValidToken || availableRepos === null || isBusy
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

// Reusable field row to ensure consistent markup and error rendering
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
    />
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
      {/* Job directives (admin defaults) */}
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
          value={parseOptionalNonNegativeInt(localTmTtc)}
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
          value={parseOptionalNonNegativeInt(localTmTtl)}
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

const MapConfigurationSection: React.FC<MapConfigurationSectionProps> = ({
  useMapWidgetIds,
  onSelect,
  translate,
  RequiredLabel,
}) => (
  <SettingRow
    flow="wrap"
    level={1}
    label={<RequiredLabel text={translate("mapConfiguration")} />}
  >
    <MapWidgetSelector useMapWidgetIds={useMapWidgetIds} onSelect={onSelect} />
  </SettingRow>
)

const ConnectionSettingsPanel: React.FC<ConnectionSettingsPanelProps> = ({
  idMap,
  localServerUrl,
  localToken,
  fieldErrors,
  onServerUrlChange,
  onServerUrlBlur,
  onTokenChange,
  onTokenBlur,
  testState,
  checkSteps,
  isTestDisabled,
  onTestConnection,
  shouldShowRepositorySelector,
  repositoryProps,
  translate,
  settingStyles,
  styles,
  RequiredLabel,
}) => (
  <>
    <FieldRow
      id={idMap.serverUrl}
      label={<RequiredLabel text={translate("fmeServerUrl")} />}
      value={localServerUrl}
      onChange={onServerUrlChange}
      onBlur={onServerUrlBlur}
      placeholder={translate("serverUrlPlaceholder")}
      required
      errorText={fieldErrors.serverUrl}
      styles={settingStyles}
    />
    <FieldRow
      id={idMap.token}
      label={<RequiredLabel text={translate("fmeServerToken")} />}
      value={localToken}
      onChange={onTokenChange}
      onBlur={onTokenBlur}
      placeholder={translate("tokenPlaceholder")}
      type="password"
      required
      errorText={fieldErrors.token}
      styles={settingStyles}
    />
    <ConnectionTestSection
      testState={testState}
      checkSteps={checkSteps}
      disabled={isTestDisabled}
      onTestConnection={onTestConnection}
      translate={translate}
      styles={settingStyles}
    />
    {shouldShowRepositorySelector && (
      <RepositorySelector
        localServerUrl={repositoryProps.localServerUrl}
        localToken={repositoryProps.localToken}
        localRepository={repositoryProps.localRepository}
        availableRepos={repositoryProps.availableRepos}
        label={<RequiredLabel text={translate("availableRepositories")} />}
        fieldErrors={fieldErrors}
        validateServerUrl={repositoryProps.validateServerUrl}
        validateToken={repositoryProps.validateToken}
        onRepositoryChange={repositoryProps.onRepositoryChange}
        onRefreshRepositories={repositoryProps.onRefreshRepositories}
        translate={translate}
        styles={styles}
        ID={idMap}
        repoHint={repositoryProps.repoHint}
        isBusy={repositoryProps.isBusy}
      />
    )}
  </>
)

const toValidationFailureType = (raw: unknown): ValidationFailureType => {
  switch (raw) {
    case ValidationFailureType.NETWORK:
      return ValidationFailureType.NETWORK
    case ValidationFailureType.TOKEN:
      return ValidationFailureType.TOKEN
    case ValidationFailureType.REPOSITORY:
      return ValidationFailureType.REPOSITORY
    default:
      return ValidationFailureType.SERVER
  }
}

// Centralized handler for validation failure -> updates steps and field errors
const handleValidationFailure = (
  errorType: ValidationFailureType,
  opts: {
    setCheckSteps: React.Dispatch<React.SetStateAction<CheckSteps>>
    setFieldErrors: React.Dispatch<React.SetStateAction<FieldErrors>>
    translate: TranslateFn
    version?: string
    repositories?: string[] | null
    setAvailableRepos: React.Dispatch<React.SetStateAction<string[] | null>>
  }
) => {
  const {
    setCheckSteps,
    setFieldErrors,
    translate,
    version,
    repositories,
    setAvailableRepos,
  } = opts
  if (
    errorType === ValidationFailureType.SERVER ||
    errorType === ValidationFailureType.NETWORK
  ) {
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
  if (errorType === ValidationFailureType.TOKEN) {
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
  // repository
  setCheckSteps((prev) => ({
    ...prev,
    serverUrl: "ok",
    token: "ok",
    repository: "fail",
    version: version || "",
  }))
  setError(setFieldErrors, "repository", translate("errorRepositoryNotFound"))
  clearErrors(setFieldErrors, ["serverUrl", "token"])
  if (repositories) {
    setAvailableRepos(sanitizeRepositoryList(repositories))
  }
}

export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages as any)
  const styles = useStyles()
  const settingStyles = useSettingStyles()
  const dispatch = useDispatch()

  // Builder-aware Redux selectors
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
  const rawUpdateConfig = useUpdateConfig(id, config, onSettingChange)
  const updateConfig = hooks.useEventCallback(
    <K extends keyof FmeExportConfig>(
      key: K,
      value: FmeExportConfig[K] | undefined
    ) => {
      rawUpdateConfig(key, value)
    }
  )

  // Stable ID references for form fields
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
    allowScheduleMode: "setting-allow-schedule-mode",
    allowRemoteDataset: "setting-allow-remote-dataset",
    allowRemoteUrlDataset: "setting-allow-remote-url-dataset",
    autoCloseOtherWidgets: "setting-auto-close-other-widgets",
    drawingColor: "setting-drawing-color",
  } as const

  // Consolidated test state
  const [testState, setTestState] = React.useState<TestState>(() =>
    getInitialTestState()
  )
  // Fine-grained step status for the connection test UI
  const [checkSteps, setCheckSteps] = React.useState<CheckSteps>(() =>
    getInitialCheckSteps()
  )
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [localServerUrl, setLocalServerUrl] = React.useState<string>(
    () => getStringConfig("fmeServerUrl") || ""
  )
  const [localToken, setLocalToken] = React.useState<string>(
    () => getStringConfig("fmeServerToken") || ""
  )
  const configRepository = getStringConfig("repository") || ""
  const [localRepository, setLocalRepository] = React.useState<string>(
    () => configRepository
  )
  const [serverUrlPending, setServerUrlPending] = React.useState(false)
  const [tokenPending, setTokenPending] = React.useState(false)
  const [repositoryPending, setRepositoryPending] = React.useState(false)
  const repositoryFetchState = React.useRef<{
    key: string | null
    timestamp: number
  }>({ key: null, timestamp: 0 })
  const repositoryChangeSeqRef = React.useRef(0)

  hooks.useUpdateEffect(() => {
    setLocalRepository(configRepository)
  }, [configRepository])

  const shouldLoadRepositories = hooks.useEventCallback(
    (serverUrl: string, token: string, force = false): boolean => {
      if (force) return true
      const connectionKey = buildConnectionCacheKey(serverUrl, token)
      if (!connectionKey) return true
      const { key, timestamp } = repositoryFetchState.current
      if (key !== connectionKey) return true
      return Date.now() - timestamp > REPOSITORY_CACHE_TTL_MS
    }
  )

  const markRepositoriesFetched = hooks.useEventCallback(
    (serverUrl: string, token: string) => {
      const connectionKey = buildConnectionCacheKey(serverUrl, token)
      repositoryFetchState.current = {
        key: connectionKey,
        timestamp: connectionKey ? Date.now() : 0,
      }
    }
  )

  const invalidateRepositoryFetchCache = hooks.useEventCallback(() => {
    repositoryFetchState.current = { key: null, timestamp: 0 }
    clearRepositoryCache()
  })
  const configServerUrl = getStringConfig("fmeServerUrl") || ""
  const configToken = getStringConfig("fmeServerToken") || ""
  const previousConfigServerUrl = hooks.usePrevious(configServerUrl)
  const previousConfigToken = hooks.usePrevious(configToken)
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
  // Request timeout (ms)
  const [localRequestTimeout, setLocalRequestTimeout] = React.useState<string>(
    () => {
      const v = getNumberConfig("requestTimeout")
      return v !== undefined ? String(v) : ""
    }
  )
  // Max AOI area (m²) – stored and displayed in m²
  const [localMaxAreaM2, setLocalMaxAreaM2] = React.useState<string>(() => {
    const v = getNumberConfig("maxArea")
    return v !== undefined && v > 0 ? String(v) : ""
  })
  // Large-area warning threshold (m²)
  const [localLargeAreaM2, setLocalLargeAreaM2] = React.useState<string>(() => {
    const v = getNumberConfig("largeArea")
    return v !== undefined && v > 0 ? String(v) : ""
  })
  // Admin job directives (defaults 0/empty)
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
  const [localAllowScheduleMode, setLocalAllowScheduleMode] =
    React.useState<boolean>(() => getBooleanConfig("allowScheduleMode"))
  const [localAllowRemoteDataset, setLocalAllowRemoteDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteDataset"))
  const [localAllowRemoteUrlDataset, setLocalAllowRemoteUrlDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteUrlDataset"))
  const shouldShowMaskEmailSetting = !localSyncMode
  const shouldShowScheduleToggle = !localSyncMode
  const hasMapSelection =
    Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0
  const hasServerInputs =
    !!toTrimmedString(localServerUrl) && !!toTrimmedString(localToken)
  const shouldShowRepositorySelector = hasMapSelection && hasServerInputs
  const hasRepositorySelection = !!toTrimmedString(configRepository)
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

  const createNumericBlur = hooks.useEventCallback(
    (
      configKey: keyof FmeExportConfig,
      setter: (val: string) => void,
      errorKey: keyof FieldErrors,
      options: {
        maxValue?: number
        allowZero?: boolean
        onExceedsMax?: (maxValue: number) => string
        clampToMax?: boolean
      } = {}
    ) => {
      return (rawValue: string | undefined) => {
        const stringValue = rawValue ?? ""
        const trimmed = stringValue.trim()
        const parsed = parseNonNegativeInt(trimmed)
        const {
          maxValue,
          allowZero = false,
          onExceedsMax,
          clampToMax,
        } = options

        if (parsed === undefined || (!allowZero && parsed === 0)) {
          updateConfig(configKey, undefined)
          setter("")
          setFieldErrors((prev) => ({ ...prev, [errorKey]: undefined }))
          return
        }

        if (maxValue && parsed > maxValue) {
          if (clampToMax) {
            updateConfig(configKey, maxValue)
            setter(String(maxValue))
            setFieldErrors((prev) => ({ ...prev, [errorKey]: undefined }))
            return
          }
          setFieldErrors((prev) => ({
            ...prev,
            [errorKey]: onExceedsMax
              ? onExceedsMax(maxValue)
              : translate("errorMaxAreaTooLarge", { maxM2: maxValue }),
          }))
          return
        }

        updateConfig(configKey, parsed)
        setter(String(parsed))
        setFieldErrors((prev) => ({ ...prev, [errorKey]: undefined }))
      }
    }
  )

  const handleLargeAreaBlur = createNumericBlur(
    "largeArea",
    setLocalLargeAreaM2,
    "largeArea",
    {
      maxValue: CONSTANTS.LIMITS.MAX_M2_CAP,
    }
  )

  const handleMaxAreaBlur = createNumericBlur(
    "maxArea",
    setLocalMaxAreaM2,
    "maxArea",
    {
      maxValue: CONSTANTS.LIMITS.MAX_M2_CAP,
    }
  )

  const handleTmTtcBlur = createNumericBlur("tm_ttc", setLocalTmTtc, "tm_ttc", {
    allowZero: true,
  })

  const handleTmTtlBlur = createNumericBlur("tm_ttl", setLocalTmTtl, "tm_ttl", {
    allowZero: true,
  })

  // Consolidated effect: reset dependent options when hidden
  hooks.useEffectWithPreviousValues(() => {
    // Schedule mode: clear if no longer shown
    if (!shouldShowScheduleToggle && localAllowScheduleMode) {
      setLocalAllowScheduleMode(false)
      updateConfig("allowScheduleMode", false)
    }

    // Mask email: clear if no longer shown
    if (!shouldShowMaskEmailSetting && localMaskEmailOnSuccess) {
      setLocalMaskEmailOnSuccess(false)
      updateConfig("maskEmailOnSuccess", false)
    }
  }, [
    shouldShowScheduleToggle,
    shouldShowMaskEmailSetting,
    localMaskEmailOnSuccess,
    localAllowScheduleMode,
    updateConfig,
  ])

  // Drawing color (hex) with default ArcGIS brand blue
  const [localDrawingColor, setLocalDrawingColor] = React.useState<string>(
    () => getStringConfig("drawingColor") || DEFAULT_DRAWING_HEX
  )
  // Server-provided repository list (null = not loaded yet)
  const [availableRepos, setAvailableRepos] = React.useState<string[] | null>(
    null
  )
  // Non-blocking hint for repository list fetch issues
  const [reposHint, setReposHint] = React.useState<string | null>(null)
  // Track in-flight cancellation scopes
  const testAbort = useLatestAbortController()
  const reposAbort = useLatestAbortController()
  // Auto-cancel promises on unmount and avoid setState-after-unmount
  const makeCancelable = hooks.useCancelablePromiseMaker()
  // Keep latest values handy for async readers
  const translateRef = hooks.useLatest(translate)

  // Abort any in-flight repository request
  const abortReposRequest = hooks.useEventCallback(() => {
    reposAbort.cancel()
  })

  // Unified repository loader used by both auto-load and manual refresh
  const loadRepositories = hooks.useEventCallback(
    async (
      serverUrl: string,
      token: string,
      {
        indicateLoading,
        force = false,
      }: { indicateLoading: boolean; force?: boolean }
    ) => {
      // Cancel previous
      abortReposRequest()

      const trimmedServerUrl = toTrimmedString(serverUrl)
      const trimmedToken = toTrimmedString(token)

      if (!trimmedServerUrl || !trimmedToken) {
        setAvailableRepos(null)
        setReposHint(null)
        return
      }

      const normalizedServerUrl = normalizeBaseUrl(trimmedServerUrl)
      if (!shouldLoadRepositories(normalizedServerUrl, trimmedToken, force)) {
        return
      }
      const ctrl = reposAbort.abortAndCreate()
      const signal = ctrl.signal

      if (indicateLoading) {
        setAvailableRepos((prev) => (Array.isArray(prev) ? prev : null))
        setReposHint(null)
      }

      try {
        const result = await makeCancelable(
          fetchRepositoriesService(normalizedServerUrl, trimmedToken, signal, {
            force,
          })
        )
        if (signal.aborted) return
        const next = sanitizeRepositoryList(result.repositories)
        setAvailableRepos(next)
        clearErrors(setFieldErrors, ["repository"])
        setReposHint(null)
        markRepositoriesFetched(normalizedServerUrl, trimmedToken)
      } catch (err) {
        if (!isAbortError(err) && !signal.aborted) {
          setAvailableRepos((prev) => (Array.isArray(prev) ? prev : []))
          setReposHint(translateRef.current("errorRepositories"))
        }
      } finally {
        reposAbort.finalize(ctrl)
      }
    }
  )

  // Clear repository-related state when URL or token change
  const clearRepositoryEphemeralState = hooks.useEventCallback(() => {
    abortReposRequest()
    setAvailableRepos(null)
    setFieldErrors((prev) => ({ ...prev, repository: undefined }))
    invalidateRepositoryFetchCache()
    clearWorkspaceMetadataCache()
    repositoryChangeSeqRef.current += 1
    setRepositoryPending(false)
    const currentRepository = toTrimmedString(getStringConfig("repository"))
    if (currentRepository) {
      updateConfig("repository", undefined)
      dispatch(fmeActions.clearWorkspaceState(id))
    }
    setLocalRepository("")
  })

  const resetConnectionProgress = hooks.useEventCallback(() => {
    testAbort.cancel()
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

  // Cleanup on unmount
  hooks.useUnmount(() => {
    testAbort.cancel()
    abortReposRequest()
  })

  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    onSettingChange({
      id,
      useMapWidgetIds,
    })
  }

  // Render required label with tooltip
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

  // Unified input validation
  const validateAllInputs = hooks.useEventCallback(
    (skipRepoCheck = false): ValidationResult => {
      const composite = validateConnectionInputs({
        url: localServerUrl,
        token: localToken,
        repository: localRepository,
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

      // Support email is optional but must be valid if provided
      const trimmedEmail = (localSupportEmail ?? "").trim()
      if (trimmedEmail) {
        const emailValid = isValidEmail(trimmedEmail)
        if (!emailValid) messages.supportEmail = translate("invalidEmail")
      }

      setFieldErrors((prev) => ({
        ...prev,
        serverUrl: messages.serverUrl,
        token: messages.token,
        repository: messages.repository,
        supportEmail: messages.supportEmail,
      }))

      return {
        messages,
        hasErrors: !!(
          messages.serverUrl ||
          messages.token ||
          (!skipRepoCheck && messages.repository) ||
          messages.supportEmail
        ),
      }
    }
  )

  // Validate connection settings
  const validateConnectionSettings = hooks.useEventCallback(
    (): FmeFlowConfig | null => {
      const rawServerUrl = localServerUrl
      const token = localToken
      const repository = localRepository

      const cleaned = normalizeBaseUrl(rawServerUrl || "")
      const changed = cleaned !== rawServerUrl
      // If sanitization changed, update config
      if (changed) {
        updateConfig("fmeServerUrl", cleaned)
      }

      const serverUrl = cleaned

      return serverUrl && token ? { serverUrl, token, repository } : null
    }
  )

  const serverValidation = validateServerUrl(localServerUrl, {
    requireHttps: true,
  })
  const tokenValidation = validateToken(localToken)
  const canRunConnectionTest = serverValidation.ok && tokenValidation.ok

  // Handle "Test Connection" button click - disable when widget is busy
  const isTestDisabled =
    !!testState.isTesting ||
    !canRunConnectionTest ||
    isBusy ||
    serverUrlPending ||
    tokenPending ||
    repositoryPending

  // Connection test sub-functions for better organization
  const handleTestSuccess = hooks.useEventCallback(
    (validationResult: any, settings: FmeFlowConfig, silent: boolean) => {
      setCheckSteps({
        serverUrl: validationResult.steps.serverUrl,
        token: validationResult.steps.token,
        repository: validationResult.steps.repository,
        version: validationResult.version || "",
      })

      if (Array.isArray(validationResult.repositories)) {
        setAvailableRepos(sanitizeRepositoryList(validationResult.repositories))
      }

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
      const error = validationResult.error
      const failureType = toValidationFailureType(error?.type)

      handleValidationFailure(failureType, {
        setCheckSteps,
        setFieldErrors,
        translate,
        version: validationResult.version,
        repositories: Array.isArray(validationResult.repositories)
          ? [...validationResult.repositories]
          : undefined,
        setAvailableRepos,
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
      if (isAbortError(err)) return

      const errorStatus = extractHttpStatus(err)
      const failureType =
        !errorStatus || errorStatus === 0
          ? ValidationFailureType.NETWORK
          : ValidationFailureType.SERVER
      handleValidationFailure(failureType, {
        setCheckSteps,
        setFieldErrors,
        translate,
        setAvailableRepos,
        version: "",
        repositories: null,
      })

      if (!silent) {
        const errorKey = mapErrorToKey(err, errorStatus)
        setTestState({
          status: "error",
          isTesting: false,
          message:
            failureType === ValidationFailureType.NETWORK
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

    const controller = testAbort.abortAndCreate()
    const signal = controller.signal

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

      const validationResult = await validateConnection({
        serverUrl: settings.serverUrl,
        token: settings.token,
        repository: settings.repository,
        signal,
      })

      if (validationResult.success) {
        handleTestSuccess(validationResult, settings, silent)
      } else {
        handleTestFailure(validationResult, silent)
      }
    } catch (err) {
      handleTestError(err, silent)
    } finally {
      testAbort.finalize(controller)
    }
  })

  // Enhanced repository refresh for better UX - uses client API directly
  const refreshRepositories = hooks.useEventCallback(async () => {
    const cfgServer = getStringConfig("fmeServerUrl") || ""
    const cfgToken = getStringConfig("fmeServerToken") || ""
    const trimmedServer = toTrimmedString(cfgServer)
    const trimmedToken = toTrimmedString(cfgToken)
    if (!trimmedServer || !trimmedToken) return
    const cleaned = normalizeBaseUrl(trimmedServer)
    await loadRepositories(cleaned, trimmedToken, {
      indicateLoading: true,
      force: true,
    })
  })

  // Clear transient repo list when server URL or token in config changes
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

  // Auto-load repositories when both server URL and token in config are valid
  hooks.useEffectOnce(() => {
    const trimmedServer = toTrimmedString(configServerUrl)
    const trimmedToken = toTrimmedString(configToken)
    if (!trimmedServer || !trimmedToken) return
    const hasValidServer = validateServerUrl(trimmedServer, {
      requireHttps: true,
    }).ok
    const hasValidToken = validateToken(trimmedToken).ok
    if (!hasValidServer || !hasValidToken) return

    const cleaned = normalizeBaseUrl(trimmedServer)
    loadRepositories(cleaned, trimmedToken, { indicateLoading: true })
    return () => abortReposRequest()
  })

  // Handle server URL changes with delayed validation
  const applyServerUrlSideEffects = hooks.useEventCallback(() => {
    resetConnectionProgress()
    clearConnectionValidationCaches()
    clearRepositoryEphemeralState()
    setServerUrlPending(false)
  })
  const debouncedServerUrlSideEffects = useDebounce(
    applyServerUrlSideEffects,
    SERVER_URL_DEBOUNCE_MS
  )

  const handleServerUrlChange = hooks.useEventCallback((val: string) => {
    setLocalServerUrl(val)
    clearErrors(setFieldErrors, ["serverUrl"])
    setServerUrlPending(true)
    debouncedServerUrlSideEffects()
  })

  // Handle token changes with delayed validation
  const applyTokenSideEffects = hooks.useEventCallback(() => {
    resetConnectionProgress()
    clearConnectionValidationCaches()
    clearRepositoryEphemeralState()
    setTokenPending(false)
  })
  const debouncedTokenSideEffects = useDebounce(
    applyTokenSideEffects,
    TOKEN_DEBOUNCE_MS
  )

  const handleTokenChange = hooks.useEventCallback((val: string) => {
    setLocalToken(val)
    clearErrors(setFieldErrors, ["token"])
    setTokenPending(true)
    debouncedTokenSideEffects()
  })

  // Handle server URL blur - save to config and clear repository state
  const handleServerUrlBlur = hooks.useEventCallback((url: string) => {
    // Validate on blur
    const validation = validateServerUrl(url, { requireHttps: true })
    const reasonKey =
      !validation.ok && "reason" in validation
        ? mapServerUrlReasonToKey(validation.reason)
        : undefined
    setError(
      setFieldErrors,
      "serverUrl",
      reasonKey ? translate(reasonKey) : undefined
    )

    // Sanitize and save to config
    const cleaned = normalizeBaseUrl(url)
    const changed = cleaned !== url
    const finalUrl = changed ? cleaned : url
    updateConfig("fmeServerUrl", finalUrl)

    // Update local state if sanitized/blurred
    if (changed) {
      setLocalServerUrl(cleaned)
      const cleanedValidation = validateServerUrl(cleaned, {
        requireHttps: true,
      })
      const cleanedReasonKey =
        !cleanedValidation.ok && "reason" in cleanedValidation
          ? mapServerUrlReasonToKey(cleanedValidation.reason)
          : undefined
      setError(
        setFieldErrors,
        "serverUrl",
        cleanedReasonKey ? translate(cleanedReasonKey) : undefined
      )
    }

    // Clear repository data when server changes
    clearRepositoryEphemeralState()
  })

  // Handle token blur - save to config and clear repository state
  const handleTokenBlur = hooks.useEventCallback((token: string) => {
    // Validate on blur
    const validation = validateToken(token)
    const tokenError =
      !validation.ok && validation.key ? translate(validation.key) : undefined
    setError(setFieldErrors, "token", tokenError)

    // Save to config
    updateConfig("fmeServerToken", token)

    // Clear repository data when token changes
    clearRepositoryEphemeralState()
  })

  // Keep repository field error in sync when either the list or selection changes
  hooks.useUpdateEffect(() => {
    if (!localRepository) return
    // Validate repository if we have an available list and a selection
    if (
      Array.isArray(availableRepos) &&
      availableRepos.length &&
      localRepository
    ) {
      const hasRepo = availableRepos.includes(localRepository)
      const errorMessage = hasRepo
        ? undefined
        : translate("errorRepositoryNotFound")
      setError(setFieldErrors, "repository", errorMessage)
    } else if (
      Array.isArray(availableRepos) &&
      availableRepos.length === 0 &&
      localRepository
    ) {
      // Allow manual entry when list is empty
      clearErrors(setFieldErrors, ["repository"])
    }
  }, [availableRepos, localRepository, translate])

  const applyRepositorySideEffects = hooks.useEventCallback(
    ({
      repository: nextRepository,
      seq,
    }: {
      repository: string
      seq: number
    }) => {
      if (repositoryChangeSeqRef.current !== seq) return

      const currentConfigRepository = getStringConfig("repository") || ""
      updateConfig("repository", nextRepository)

      if (currentConfigRepository !== nextRepository) {
        dispatch(fmeActions.clearWorkspaceState(id))
        clearWorkspaceMetadataCache()
      }

      setRepositoryPending(false)
    }
  )
  const debouncedRepositorySideEffects = useDebounce(
    applyRepositorySideEffects,
    REPOSITORY_DEBOUNCE_MS
  )

  // Handle repository changes with workspace state clearing
  const handleRepositoryChange = hooks.useEventCallback(
    (newRepository: string) => {
      const nextSeq = repositoryChangeSeqRef.current + 1
      repositoryChangeSeqRef.current = nextSeq
      setLocalRepository(newRepository)
      setRepositoryPending(true)
      clearErrors(setFieldErrors, ["repository"])
      debouncedRepositorySideEffects({
        repository: newRepository,
        seq: nextSeq,
      })
    }
  )

  // Helper for rendering input fields with error alerts
  // Reuse FieldRow for consistent input rendering

  const handleRequestTimeoutBlur = createNumericBlur(
    "requestTimeout",
    setLocalRequestTimeout,
    "requestTimeout",
    {
      maxValue: CONSTANTS.LIMITS.MAX_REQUEST_TIMEOUT_MS,
      clampToMax: true,
      allowZero: true,
    }
  )

  return (
    <SettingSection>
      <MapConfigurationSection
        useMapWidgetIds={useMapWidgetIds}
        onSelect={onMapWidgetSelected}
        translate={translate}
        RequiredLabel={RequiredLabel}
      />
      {hasMapSelection && (
        <ConnectionSettingsPanel
          idMap={ID}
          localServerUrl={localServerUrl}
          localToken={localToken}
          fieldErrors={fieldErrors}
          onServerUrlChange={handleServerUrlChange}
          onServerUrlBlur={handleServerUrlBlur}
          onTokenChange={handleTokenChange}
          onTokenBlur={handleTokenBlur}
          testState={testState}
          checkSteps={checkSteps}
          isTestDisabled={isTestDisabled}
          onTestConnection={() => testConnection(false)}
          shouldShowRepositorySelector={shouldShowRepositorySelector}
          repositoryProps={{
            localServerUrl: getStringConfig("fmeServerUrl") || "",
            localToken: getStringConfig("fmeServerToken") || "",
            localRepository,
            availableRepos,
            onRepositoryChange: handleRepositoryChange,
            onRefreshRepositories: refreshRepositories,
            repoHint: reposHint,
            isBusy: isBusy || repositoryPending,
            validateServerUrl,
            validateToken,
          }}
          translate={translate}
          settingStyles={settingStyles}
          styles={settingStyles}
          RequiredLabel={RequiredLabel}
        />
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
              }}
              aria-label={translate("allowRemoteDatasetLabel")}
            />
          </SettingRow>
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
                const checked =
                  evt?.target?.checked ?? !localAllowRemoteUrlDataset
                setLocalAllowRemoteUrlDataset(checked)
                updateConfig("allowRemoteUrlDataset", checked)
              }}
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
              value={parseOptionalNonNegativeInt(localMaxAreaM2)}
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
            onTmTtcChange={setLocalTmTtc}
            onTmTtlChange={setLocalTmTtl}
            onTmTtcBlur={handleTmTtcBlur}
            onTmTtlBlur={handleTmTtlBlur}
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
              value={parseOptionalNonNegativeInt(localRequestTimeout)}
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
                updateConfig("supportEmail", undefined)
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
              value={parseOptionalNonNegativeInt(localLargeAreaM2)}
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
                updateConfig("drawingColor", cleaned)
              }}
              aria-label={translate("drawingColorLabel")}
            />
          </SettingRow>
        </>
      )}
    </SettingSection>
  )
}
