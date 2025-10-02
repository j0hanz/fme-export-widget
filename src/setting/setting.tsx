/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
import {
  setError,
  clearErrors,
  safeAbort,
  parseNonNegativeInt,
  isValidEmail,
  toTrimmedString,
  collectTrimmedStrings,
  uniqueStrings,
} from "../shared/utils"
import { useTheme } from "jimu-theme"
import { useSelector, useDispatch } from "react-redux"
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  MapWidgetSelector,
  SettingSection,
  SettingRow,
} from "jimu-ui/advanced/setting-components"
import { Alert, Loading, LoadingType, Switch } from "jimu-ui"
import {
  Button,
  Icon,
  Input,
  TextArea,
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
  validateConnectionInputs,
} from "../shared/validations"
import {
  validateConnection,
  getRepositories as fetchRepositoriesService,
} from "../shared/services"
import { fmeActions } from "../extensions/store"
import type {
  WidgetConfig,
  IMWidgetConfig,
  ConnectionSettings,
  TestState,
  FieldErrors,
  StepStatus,
  CheckSteps,
  ValidationResult,
  IMStateWithFmeExport,
  TranslateFn,
  SettingStyles,
  ConnectionTestSectionProps,
  RepositorySelectorProps,
  JobDirectivesSectionProps,
  TmTagPreset,
} from "../config"
import { DEFAULT_DRAWING_HEX } from "../config"
import resetIcon from "../assets/icons/refresh.svg"

// Constants
const CONSTANTS = {
  VALIDATION: {
    DEFAULT_TTL_VALUE: "",
    DEFAULT_TTC_VALUE: "",
  },
  LIMITS: {
    MAX_M2_CAP: 10_000_000_000,
    MAX_REQUEST_TIMEOUT_MS: 600_000,
  },
  DEFAULTS: {
    MAX_M2: 100_000_000,
  },
  DIRECTIVES: {
    DESCRIPTION_MAX: 512,
    TAG_MAX: 128,
  },
  COLORS: {
    BACKGROUND_DARK: "#181818",
  },
} as const

const FAST_TM_TAG = "fast"

const ConnectionTestSection: React.FC<ConnectionTestSectionProps> = ({
  testState,
  checkSteps,
  disabled,
  onTestConnection,
  translate,
  styles,
}) => {
  const isStepStatus = (v: unknown): v is StepStatus =>
    typeof v === "object" &&
    v !== null &&
    Object.prototype.hasOwnProperty.call(v, "completed")
  // Hoisted helpers for readability and stability
  const getStatusStyle = hooks.useEventCallback(
    (s: StepStatus | string): any => {
      switch (s) {
        case "ok":
          return styles.STATUS.COLOR.OK
        case "fail":
          return styles.STATUS.COLOR.FAIL
        case "skip":
          return styles.STATUS.COLOR.SKIP
        case "pending":
        case "idle":
          return styles.STATUS.COLOR.PENDING
        default:
          if (isStepStatus(s)) {
            return s.completed
              ? styles.STATUS.COLOR.OK
              : styles.STATUS.COLOR.FAIL
          }
          return styles.STATUS.COLOR.PENDING
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
        <div css={css(styles.STATUS.ROW)}>
          <div css={css(styles.STATUS.LABEL_GROUP)}>
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
        css={css(styles.STATUS.CONTAINER)}
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

        <div css={css(styles.STATUS.LIST)}>
          {rows.map((r) => (
            <StatusRow key={r.label} label={r.label} status={r.status} />
          ))}
          {hasVersion && (
            <div css={css(styles.STATUS.ROW)}>
              <div css={css(styles.STATUS.LABEL_GROUP)}>
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
  fieldErrors,
  validateServerUrl,
  validateToken,
  onRepositoryChange,
  onRefreshRepositories,
  translate,
  styles,
  ID,
  repoHint,
}) => {
  // Allow manual refresh whenever URL and token are present and pass basic validation
  const serverCheck = validateServerUrl(localServerUrl, { requireHttps: true })
  const tokenCheck = validateToken(localToken)
  const hasValidServer = !!localServerUrl && serverCheck.ok
  const hasValidToken = tokenCheck.ok
  const canRefresh = hasValidServer && hasValidToken

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
    !hasValidServer || !hasValidToken || availableRepos === null
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
        <div css={styles.LABEL_WITH_BUTTON}>
          {translate("availableRepositories")}
          {canRefresh && (
            <Button
              size="sm"
              block={false}
              onClick={onRefreshRepositories}
              variant="outlined"
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
            css={css(styles.ALERT_INLINE)}
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
            css={css(styles.ALERT_INLINE)}
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
      aria-invalid={errorText ? true : undefined}
      aria-describedby={errorText ? `${id}-error` : undefined}
    />
    {errorText && (
      <SettingRow flow="wrap" level={3} css={css(styles.ROW)}>
        <Alert
          id={`${id}-error`}
          fullWidth
          css={css(styles.ALERT_INLINE)}
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
  tmTagEnabled,
  tmTagPreset,
  localTmDescription,
  onTmTtcChange,
  onTmTtlChange,
  onTmTagEnabledChange,
  onTmTagPresetChange,
  onTmDescriptionChange,
  onTmTtcBlur,
  onTmTtlBlur,
  onTmDescriptionBlur,
  fieldErrors,
  translate,
  styles,
  ID,
}) => {
  const handleTagPresetChange = hooks.useEventCallback((value: unknown) => {
    if (value === "fast") {
      onTmTagPresetChange("fast")
      return
    }
    onTmTagPresetChange("normal")
  })

  const tagOptions = [
    { label: translate("tm_tagOptionNormal"), value: "normal" },
    { label: translate("tm_tagOptionFast"), value: "fast" },
  ]
  const toggleId = `${ID.tm_tag}-toggle`

  return (
    <SettingSection>
      {/* Job directives (admin defaults) */}
      <FieldRow
        id={ID.tm_ttc}
        label={
          <Tooltip content={translate("tm_ttcHelper")} placement="top">
            {translate("tm_ttcLabel")}
          </Tooltip>
        }
        value={localTmTtc}
        onChange={onTmTtcChange}
        onBlur={onTmTtcBlur}
        placeholder={translate("tm_ttcPlaceholder")}
        errorText={fieldErrors.tm_ttc}
        styles={styles}
      />
      <FieldRow
        id={ID.tm_ttl}
        label={
          <Tooltip content={translate("tm_ttlHelper")} placement="top">
            {translate("tm_ttlLabel")}
          </Tooltip>
        }
        value={localTmTtl}
        onChange={onTmTtlChange}
        onBlur={onTmTtlBlur}
        placeholder={translate("tm_ttlPlaceholder")}
        errorText={fieldErrors.tm_ttl}
        styles={styles}
      />
      <SettingRow
        flow="no-wrap"
        label={
          <Tooltip content={translate("tm_tagHelper")} placement="top">
            {translate("tm_tagLabel")}
          </Tooltip>
        }
        level={1}
      >
        <Switch
          id={toggleId}
          checked={tmTagEnabled}
          onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
            const checked = evt?.target?.checked ?? !tmTagEnabled
            onTmTagEnabledChange(checked)
          }}
          aria-label={translate("tm_tagLabel")}
        />
      </SettingRow>
      {tmTagEnabled && (
        <SettingRow
          flow="wrap"
          label={
            <Tooltip content={translate("tm_tagHelper")} placement="top">
              {translate("tm_tagLabel")}
            </Tooltip>
          }
          level={2}
          tag="label"
        >
          <Select
            value={tmTagPreset}
            options={tagOptions}
            onChange={handleTagPresetChange}
            aria-label={translate("tm_tagLabel")}
          />
        </SettingRow>
      )}
      <SettingRow
        flow="wrap"
        label={
          <Tooltip content={translate("tm_descriptionHelper")} placement="top">
            {translate("tm_descriptionLabel")}
          </Tooltip>
        }
        level={1}
        tag="label"
      >
        <TextArea
          id={ID.tm_description}
          value={localTmDescription}
          rows={3}
          onChange={onTmDescriptionChange}
          onBlur={onTmDescriptionBlur}
          placeholder={translate("tm_descriptionPlaceholder")}
          errorText={fieldErrors.tm_description}
        />
      </SettingRow>
      {fieldErrors.tm_description && (
        <SettingRow flow="wrap" level={3} css={css(styles.ROW)}>
          <Alert
            id={`${ID.tm_description}-error`}
            fullWidth
            css={css(styles.ALERT_INLINE)}
            text={fieldErrors.tm_description}
            type="error"
            closable={false}
          />
        </SettingRow>
      )}
      {/** Helper moved to label tooltips */}
    </SettingSection>
  )
}

// Centralized handler for validation failure -> updates steps and field errors
const handleValidationFailure = (
  errorType: "server" | "network" | "token" | "repository",
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
  if (repositories) setAvailableRepos(repositories)
}

// String-only config getter to avoid repetitive type assertions
function useStringConfigValue(config: IMWidgetConfig) {
  return hooks.useEventCallback(
    (prop: keyof WidgetConfig, defaultValue = ""): string => {
      const v = config?.[prop]
      return typeof v === "string" ? v : defaultValue
    }
  )
}

// Boolean config getter
function useBooleanConfigValue(config: IMWidgetConfig) {
  return hooks.useEventCallback(
    (prop: keyof WidgetConfig, defaultValue = false): boolean => {
      const v = config?.[prop]
      return typeof v === "boolean" ? v : defaultValue
    }
  )
}

// Number config getter
function useNumberConfigValue(config: IMWidgetConfig) {
  return hooks.useEventCallback(
    (prop: keyof WidgetConfig, defaultValue?: number): number | undefined => {
      const v = config?.[prop]
      if (typeof v === "number" && Number.isFinite(v)) return v
      return defaultValue
    }
  )
}

// Create theme-aware styles for the setting UI
const createSettingStyles = (theme: any) => {
  return {
    ROW: css({ width: "100%" }),
    ALERT_INLINE: css({ opacity: 0.8 }),
    LABEL_WITH_BUTTON: css({
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      gap: theme?.sys?.spacing?.(1) || 8,
    }),
    STATUS: {
      CONTAINER: css({
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }),
      LIST: css({
        display: "grid",
        rowGap: 2,
        opacity: 0.8,
        backgroundColor: CONSTANTS.COLORS.BACKGROUND_DARK,
        padding: 6,
        borderRadius: theme?.sys?.shape?.shape1 || 2,
      }),
      ROW: css({
        display: "flex",
        justifyContent: "space-between",
        lineHeight: 2,
      }),
      LABEL_GROUP: css({
        display: "flex",
        alignItems: "center",
      }),
      COLOR: {
        OK: css({ color: theme?.sys?.color?.success?.main || "#2e7d32" }),
        FAIL: css({ color: theme?.sys?.color?.error?.main || "#d32f2f" }),
        SKIP: css({ color: theme?.sys?.color?.warning?.main || "#ed6c02" }),
        PENDING: css({ color: theme?.sys?.color?.info?.main || "#0288d1" }),
      },
    },
  } as const
}

// Small helper to centralize config updates
function useUpdateConfig(
  id: string,
  config: IMWidgetConfig,
  onSettingChange: AllWidgetSettingProps<IMWidgetConfig>["onSettingChange"]
) {
  return hooks.useEventCallback(
    <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
      onSettingChange({
        id,
        // Update only the specific key in the config
        config: config.set(key, value),
      })
    }
  )
}

const useSettingStyles = () => {
  const theme = useTheme()
  return createSettingStyles(theme)
}

export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useStyles()
  const settingStyles = useSettingStyles()
  const dispatch = useDispatch()

  // Get current repository from global state to detect external changes
  const currentRepository = useSelector((state: IMStateWithFmeExport) => {
    const global = state?.["fme-state"] as any
    return (global?.byId && id && global.byId[id]?.currentRepository) || null
  })

  const getStringConfig = useStringConfigValue(config)
  const getBooleanConfig = useBooleanConfigValue(config)
  const getNumberConfig = useNumberConfigValue(config)
  const updateConfig = useUpdateConfig(id, config, onSettingChange)

  // Stable ID references for form fields
  const ID = {
    supportEmail: "setting-support-email",
    serverUrl: "setting-server-url",
    token: "setting-token",
    repository: "setting-repository",
    syncMode: "setting-sync-mode",
    maskEmailOnSuccess: "setting-mask-email-on-success",
    requestTimeout: "setting-request-timeout",
    maxArea: "setting-max-area",
    tm_ttc: "setting-tm-ttc",
    tm_ttl: "setting-tm-ttl",
    tm_tag: "setting-tm-tag",
    tm_description: "setting-tm-description",
    aoiParamName: "setting-aoi-param-name",
    uploadTargetParamName: "setting-upload-target-param-name",
    allowScheduleMode: "setting-allow-schedule-mode",
    allowRemoteDataset: "setting-allow-remote-dataset",
    allowRemoteUrlDataset: "setting-allow-remote-url-dataset",
    service: "setting-service",
    aoiGeoJsonParamName: "setting-aoi-geojson-param-name",
    aoiWktParamName: "setting-aoi-wkt-param-name",
    drawingColor: "setting-drawing-color",
  } as const

  // Consolidated test state
  const [testState, setTestState] = React.useState<TestState>({
    status: "idle",
    isTesting: false,
    message: undefined,
    type: "info",
  })
  // Fine-grained step status for the connection test UI
  const [checkSteps, setCheckSteps] = React.useState<CheckSteps>({
    serverUrl: "idle",
    token: "idle",
    repository: "idle",
    version: "",
  })
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [localServerUrl, setLocalServerUrl] = React.useState<string>(
    () => getStringConfig("fmeServerUrl") || ""
  )
  const [localToken, setLocalToken] = React.useState<string>(
    () => getStringConfig("fmeServerToken") || ""
  )
  const selectedRepository = getStringConfig("repository") || ""
  const [localSupportEmail, setLocalSupportEmail] = React.useState<string>(
    () => getStringConfig("supportEmail")
  )
  const [localSyncMode, setLocalSyncMode] = React.useState<boolean>(() =>
    getBooleanConfig("syncMode")
  )
  const [localMaskEmailOnSuccess, setLocalMaskEmailOnSuccess] =
    React.useState<boolean>(() => getBooleanConfig("maskEmailOnSuccess"))
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
  // Admin job directives (defaults 0/empty)
  const [localTmTtc, setLocalTmTtc] = React.useState<string>(() => {
    const v = getNumberConfig("tm_ttc")
    return v !== undefined ? String(v) : CONSTANTS.VALIDATION.DEFAULT_TTC_VALUE
  })
  const [localTmTtl, setLocalTmTtl] = React.useState<string>(() => {
    const v = getNumberConfig("tm_ttl")
    return v !== undefined ? String(v) : CONSTANTS.VALIDATION.DEFAULT_TTL_VALUE
  })
  const initialTmTagRaw = toTrimmedString((config as any)?.tm_tag) || ""
  const initialTmTag = initialTmTagRaw
    ? initialTmTagRaw.slice(0, CONSTANTS.DIRECTIVES.TAG_MAX)
    : ""
  const hasFastTag = initialTmTag === FAST_TM_TAG
  const initialTmTagPreset: TmTagPreset = hasFastTag ? "fast" : "normal"
  const [localTmTagEnabled, setLocalTmTagEnabled] = React.useState<boolean>(
    () => hasFastTag
  )
  const [localTmTagPreset, setLocalTmTagPreset] = React.useState<TmTagPreset>(
    () => initialTmTagPreset
  )
  const [localTmDescription, setLocalTmDescription] = React.useState<string>(
    () => getStringConfig("tm_description")
  )
  const [localAoiParamName, setLocalAoiParamName] = React.useState<string>(
    () => getStringConfig("aoiParamName") || "AreaOfInterest"
  )
  const [localAoiGeoJsonParamName, setLocalAoiGeoJsonParamName] =
    React.useState<string>(() => getStringConfig("aoiGeoJsonParamName"))
  const [localAoiWktParamName, setLocalAoiWktParamName] =
    React.useState<string>(() => getStringConfig("aoiWktParamName"))
  const [localUploadTargetParamName, setLocalUploadTargetParamName] =
    React.useState<string>(() => getStringConfig("uploadTargetParamName"))
  const [localAllowScheduleMode, setLocalAllowScheduleMode] =
    React.useState<boolean>(() => getBooleanConfig("allowScheduleMode"))
  const [localAllowRemoteDataset, setLocalAllowRemoteDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteDataset"))
  const [localAllowRemoteUrlDataset, setLocalAllowRemoteUrlDataset] =
    React.useState<boolean>(() => getBooleanConfig("allowRemoteUrlDataset"))
  const [localService, setLocalService] = React.useState<string>(() => {
    const v = getStringConfig("service")
    return v === "stream" ? "stream" : "download"
  })
  const isStreamingService = localService === "stream"
  const isDownloadService = !isStreamingService
  const shouldShowMaskEmailSetting = isDownloadService && !localSyncMode
  const shouldShowScheduleToggle = isDownloadService && !localSyncMode
  const showUploadTargetField = isDownloadService && localAllowRemoteDataset

  // Consolidated effect: manage service-type dependent state
  hooks.useEffectWithPreviousValues(() => {
    // Streaming service: disable incompatible features
    if (isStreamingService) {
      if (localAllowRemoteDataset) {
        setLocalAllowRemoteDataset(false)
        updateConfig("allowRemoteDataset", false as any)
      }
      if (localAllowRemoteUrlDataset) {
        setLocalAllowRemoteUrlDataset(false)
        updateConfig("allowRemoteUrlDataset", false as any)
      }
      if (localMaskEmailOnSuccess) {
        setLocalMaskEmailOnSuccess(false)
        updateConfig("maskEmailOnSuccess", false as any)
      }
    }

    // Schedule mode: clear if no longer shown
    if (!shouldShowScheduleToggle && localAllowScheduleMode) {
      setLocalAllowScheduleMode(false)
      updateConfig("allowScheduleMode", false as any)
    }

    // Mask email: clear if no longer shown
    if (!shouldShowMaskEmailSetting && localMaskEmailOnSuccess) {
      setLocalMaskEmailOnSuccess(false)
      updateConfig("maskEmailOnSuccess", false as any)
    }

    // Upload target param: clear if no longer shown
    if (!showUploadTargetField && localUploadTargetParamName) {
      updateConfig("uploadTargetParamName", undefined as any)
      setLocalUploadTargetParamName("")
    }
  }, [
    isStreamingService,
    shouldShowScheduleToggle,
    shouldShowMaskEmailSetting,
    showUploadTargetField,
    localAllowRemoteDataset,
    localAllowRemoteUrlDataset,
    localMaskEmailOnSuccess,
    localAllowScheduleMode,
    localUploadTargetParamName,
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
  // Track in-flight test for cancellation to avoid stale state updates
  const abortRef = React.useRef<AbortController | null>(null)
  // Track in-flight repository listing request for cancellation
  const reposAbortRef = React.useRef<AbortController | null>(null)
  // Auto-cancel promises on unmount and avoid setState-after-unmount
  const makeCancelable = hooks.useCancelablePromiseMaker()
  // Keep latest values handy for async readers
  const translateRef = hooks.useLatest(translate)

  // Abort any in-flight repository request
  const abortReposRequest = hooks.useEventCallback(() => {
    if (reposAbortRef.current) {
      safeAbort(reposAbortRef.current)
      reposAbortRef.current = null
    }
  })

  // Unified repository loader used by both auto-load and manual refresh
  const loadRepositories = hooks.useEventCallback(
    async (
      serverUrl: string,
      token: string,
      { indicateLoading }: { indicateLoading: boolean }
    ) => {
      // Cancel previous
      abortReposRequest()
      const ctrl = new AbortController()
      reposAbortRef.current = ctrl
      const signal = ctrl.signal

      if (indicateLoading) {
        setAvailableRepos((prev) => (Array.isArray(prev) ? prev : null))
        setReposHint(null)
      }

      try {
        const result = await makeCancelable(
          fetchRepositoriesService(serverUrl, token, signal)
        )
        if (signal.aborted) return
        const next = result.repositories || []
        setAvailableRepos(next)
        clearErrors(setFieldErrors, ["repository"])
        setReposHint(null)
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setAvailableRepos((prev) => (Array.isArray(prev) ? prev : []))
          setReposHint(translateRef.current("errorRepositories"))
        }
      } finally {
        if (reposAbortRef.current === ctrl) reposAbortRef.current = null
      }
    }
  )

  // Clear repository-related state when URL or token change
  const clearRepositoryEphemeralState = hooks.useEventCallback(() => {
    setAvailableRepos(null)
    setFieldErrors((prev) => ({ ...prev, repository: undefined }))
  })

  const handleTmTagPresetChange = hooks.useEventCallback(
    (preset: TmTagPreset) => {
      setLocalTmTagPreset(preset)
      setFieldErrors((prev) => ({ ...prev, tm_tag: undefined }))
      if (!localTmTagEnabled) {
        return
      }
      if (preset === "fast") {
        updateConfig("tm_tag", FAST_TM_TAG as any)
        return
      }
      updateConfig("tm_tag", undefined as any)
    }
  )

  const handleTmTagEnabledChange = hooks.useEventCallback(
    (enabled: boolean) => {
      setLocalTmTagEnabled(enabled)
      setFieldErrors((prev) => ({ ...prev, tm_tag: undefined }))
      if (!enabled) {
        updateConfig("tm_tag", undefined as any)
        return
      }
      if (localTmTagPreset === "fast") {
        updateConfig("tm_tag", FAST_TM_TAG as any)
        return
      }
      updateConfig("tm_tag", undefined as any)
    }
  )

  // Cleanup on unmount
  hooks.useUnmount(() => {
    safeAbort(abortRef.current)
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
          css={styles.typography.required}
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
    (): ConnectionSettings | null => {
      const rawServerUrl = localServerUrl
      const token = localToken
      const repository = selectedRepository

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

  // Handle "Test Connection" button click
  const isTestDisabled = !!testState.isTesting || !canRunConnectionTest

  // Connection test sub-functions for better organization
  const handleTestSuccess = hooks.useEventCallback(
    (validationResult: any, settings: ConnectionSettings, silent: boolean) => {
      setCheckSteps({
        serverUrl: validationResult.steps.serverUrl,
        token: validationResult.steps.token,
        repository: validationResult.steps.repository,
        version: validationResult.version || "",
      })

      if (Array.isArray(validationResult.repositories)) {
        setAvailableRepos([...(validationResult.repositories || [])])
      }

      updateConfig("fmeServerUrl", settings.serverUrl)
      updateConfig("fmeServerToken", settings.token)
      clearErrors(setFieldErrors, ["serverUrl", "token", "repository"])

      if (!silent) {
        setTestState({
          status: "success",
          isTesting: false,
          message: translate("connectionOk"),
          type: "success",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
    }
  )

  const handleTestFailure = hooks.useEventCallback(
    (validationResult: any, silent: boolean) => {
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

  const handleTestError = hooks.useEventCallback((err: unknown, silent: boolean) => {
    if ((err as Error)?.name === "AbortError") return

    const errorStatus = extractHttpStatus(err)
    const failureType =
      !errorStatus || errorStatus === 0 ? "network" : "server"
    handleValidationFailure(failureType, {
      setCheckSteps,
      setFieldErrors,
      translate,
      setAvailableRepos,
      version: "",
      repositories: null,
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
  })

  const testConnection = hooks.useEventCallback(async (silent = false) => {
    // Cancel any in-flight test first
    if (abortRef.current) {
      abortRef.current.abort()
    }

    const { hasErrors } = validateAllInputs(true)
    const settings = validateConnectionSettings()
    if (hasErrors || !settings) {
      abortRef.current = null
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

    const controller = new AbortController()
    abortRef.current = controller
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
    }
  })

  // Enhanced repository refresh for better UX - uses client API directly
  const refreshRepositories = hooks.useEventCallback(async () => {
    const cfgServer = getStringConfig("fmeServerUrl") || ""
    const cfgToken = getStringConfig("fmeServerToken") || ""
    if (!cfgServer || !cfgToken) return
    const cleaned = normalizeBaseUrl(cfgServer)
    await loadRepositories(cleaned, cfgToken, { indicateLoading: true })
  })

  // Clear transient repo list when server URL or token in config changes
  const prevConnRef = React.useRef({
    server: getStringConfig("fmeServerUrl") || "",
    token: getStringConfig("fmeServerToken") || "",
  })
  hooks.useUpdateEffect(() => {
    const curr = {
      server: getStringConfig("fmeServerUrl") || "",
      token: getStringConfig("fmeServerToken") || "",
    }
    if (
      curr.server !== prevConnRef.current.server ||
      curr.token !== prevConnRef.current.token
    ) {
      clearRepositoryEphemeralState()
      prevConnRef.current = curr
    }
  }, [config])

  // Auto-load repositories when both server URL and token in config are valid
  hooks.useUpdateEffect(() => {
    const cfgServer = getStringConfig("fmeServerUrl") || ""
    const cfgToken = getStringConfig("fmeServerToken") || ""
    const hasValidServer =
      !!cfgServer && validateServerUrl(cfgServer, { requireHttps: true }).ok
    const hasValidToken = !!cfgToken && validateToken(cfgToken).ok
    if (!hasValidServer || !hasValidToken) return

    const cleaned = normalizeBaseUrl(cfgServer)
    loadRepositories(cleaned, cfgToken, { indicateLoading: true })
    return () => abortReposRequest()
  }, [config])

  // Handle server URL changes with delayed validation
  const handleServerUrlChange = hooks.useEventCallback((val: string) => {
    setLocalServerUrl(val)

    // Clear previous error immediately for better UX, but don't validate on every keystroke
    clearErrors(setFieldErrors, ["serverUrl"])
  })

  // Handle token changes with delayed validation
  const handleTokenChange = hooks.useEventCallback((val: string) => {
    setLocalToken(val)

    // Clear previous error immediately for better UX, but don't validate on every keystroke
    clearErrors(setFieldErrors, ["token"])
  })

  // Handle server URL blur - save to config and clear repository state
  const handleServerUrlBlur = hooks.useEventCallback((url: string) => {
    // Validate on blur
    const validation = validateServerUrl(url, { requireHttps: true })
    setError(
      setFieldErrors,
      "serverUrl",
      !validation.ok
        ? translate(validation.key || "invalidServerUrl")
        : undefined
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
      setError(
        setFieldErrors,
        "serverUrl",
        !cleanedValidation.ok
          ? translate(cleanedValidation.key || "invalidServerUrl")
          : undefined
      )
    }

    // Clear repository data when server changes
    clearRepositoryEphemeralState()
  })

  // Handle token blur - save to config and clear repository state
  const handleTokenBlur = hooks.useEventCallback((token: string) => {
    // Validate on blur
    const validation = validateToken(token)
    setError(
      setFieldErrors,
      "token",
      !validation.ok ? translate(validation.key || "invalidToken") : undefined
    )

    // Save to config
    updateConfig("fmeServerToken", token)

    // Clear repository data when token changes
    clearRepositoryEphemeralState()
  })

  // Keep repository field error in sync when either the list or selection changes
  hooks.useUpdateEffect(() => {
    if (!selectedRepository) return
    // Validate repository if we have an available list and a selection
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

  // Handle repository changes with workspace state clearing
  const handleRepositoryChange = hooks.useEventCallback(
    (newRepository: string) => {
      const previousRepository = currentRepository
      updateConfig("repository", newRepository)

      // Clear workspace-related state when switching repositories for isolation
      if (previousRepository !== newRepository) {
        dispatch(fmeActions.clearWorkspaceState(newRepository, id))
      }

      // Clear repository field error but don't bump config revision for minor changes
      clearErrors(setFieldErrors, ["repository"])
    }
  )

  // Helper for rendering input fields with error alerts
  // Reuse FieldRow for consistent input rendering

  // Reusable blur handler for optional string fields
  const createStringBlurHandler = hooks.useEventCallback(
    (
      configKey: keyof WidgetConfig,
      setter: (val: string) => void,
      defaultValue?: string
    ) => {
      return (val: string) => {
        const trimmed = (val ?? "").trim()
        if (!trimmed) {
          updateConfig(configKey, defaultValue ? (defaultValue as any) : (undefined as any))
          setter(defaultValue || "")
        } else {
          updateConfig(configKey, trimmed as any)
          setter(trimmed)
        }
      }
    }
  )

  // Reusable blur handler for optional numeric fields
  const createNumericBlurHandler = hooks.useEventCallback(
    (
      configKey: keyof WidgetConfig,
      setter: (val: string) => void,
      maxValue?: number
    ) => {
      return (val: string) => {
        const trimmed = (val ?? "").trim()
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

  return (
    <>
      <SettingSection>
        <SettingRow flow="wrap" level={1} label={translate("mapConfiguration")}>
          <MapWidgetSelector
            useMapWidgetIds={useMapWidgetIds}
            onSelect={onMapWidgetSelected}
          />
        </SettingRow>
        {/* FME Server URL */}
        <FieldRow
          id={ID.serverUrl}
          label={<RequiredLabel text={translate("fmeServerUrl")} />}
          value={localServerUrl}
          onChange={handleServerUrlChange}
          onBlur={handleServerUrlBlur}
          placeholder={translate("serverUrlPlaceholder")}
          required
          errorText={fieldErrors.serverUrl}
          styles={settingStyles}
        />
        {/* FME Server Token */}
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
          styles={settingStyles}
        />
        {/* Test connection section */}
        <ConnectionTestSection
          testState={testState}
          checkSteps={checkSteps}
          disabled={isTestDisabled}
          onTestConnection={() => testConnection(false)}
          translate={translate}
          styles={settingStyles}
        />

        {/* Repository selector */}
        <RepositorySelector
          localServerUrl={getStringConfig("fmeServerUrl")}
          localToken={getStringConfig("fmeServerToken")}
          localRepository={selectedRepository}
          availableRepos={availableRepos}
          fieldErrors={fieldErrors}
          validateServerUrl={validateServerUrl}
          validateToken={validateToken}
          onRepositoryChange={handleRepositoryChange}
          onRefreshRepositories={refreshRepositories}
          translate={translate}
          styles={settingStyles}
          ID={ID}
          repoHint={reposHint}
        />
        {/* Service Type */}
        <SettingRow
          flow="wrap"
          label={
            <Tooltip content={translate("serviceTypeHelper")} placement="top">
              {translate("serviceTypeLabel")}
            </Tooltip>
          }
          level={1}
          tag="label"
        >
          <Select
            options={[
              { label: translate("serviceTypeDownload"), value: "download" },
              { label: translate("serviceTypeStream"), value: "stream" },
            ]}
            value={localService}
            onChange={(val) => {
              const serviceType = val === "stream" ? "stream" : "download"
              setLocalService(serviceType)
              updateConfig("service", serviceType as any)
            }}
          />
        </SettingRow>
        {/* Service mode (sync) toggle */}
        {localService === "download" && (
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("serviceModeSyncHelper")}
                placement="top"
              >
                {translate("serviceModeSync")}
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
              // helper via label tooltip
            />
          </SettingRow>
        )}

        {/* Allow Schedule Mode */}
        {shouldShowScheduleToggle && (
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("allowScheduleModeHelper")}
                placement="top"
              >
                {translate("allowScheduleModeLabel")}
              </Tooltip>
            }
            level={1}
          >
            <Switch
              id={ID.allowScheduleMode}
              checked={localAllowScheduleMode}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localAllowScheduleMode
                setLocalAllowScheduleMode(checked)
                updateConfig("allowScheduleMode", checked)
              }}
              aria-label={translate("allowScheduleModeLabel")}
            />
          </SettingRow>
        )}

        {/* Allow Remote Dataset */}
        {!isStreamingService && (
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("allowRemoteDatasetHelper")}
                placement="top"
              >
                {translate("allowRemoteDatasetLabel")}
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
        )}

        {/* Allow Remote Dataset URL (opt_geturl) */}
        {!isStreamingService && (
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("allowRemoteUrlDatasetHelper")}
                placement="top"
              >
                {translate("allowRemoteUrlDatasetLabel")}
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
        )}
        {/* Mask email on success toggle */}
        {shouldShowMaskEmailSetting && (
          <SettingRow
            flow="no-wrap"
            label={
              <Tooltip
                content={translate("maskEmailOnSuccessHelper")}
                placement="top"
              >
                {translate("maskEmailOnSuccess")}
              </Tooltip>
            }
            level={1}
          >
            <Switch
              id={ID.maskEmailOnSuccess}
              checked={localMaskEmailOnSuccess}
              onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
                const checked = evt?.target?.checked ?? !localMaskEmailOnSuccess
                setLocalMaskEmailOnSuccess(checked)
                updateConfig("maskEmailOnSuccess", checked)
              }}
              aria-label={translate("maskEmailOnSuccess")}
            />
          </SettingRow>
        )}
        {/* Request timeout (ms) */}
        <SettingRow
          flow="wrap"
          label={
            <Tooltip
              content={translate("requestTimeoutHelper")}
              placement="top"
            >
              {translate("requestTimeoutLabel")}
            </Tooltip>
          }
          level={1}
          tag="label"
        >
          <Input
            id={ID.requestTimeout}
            value={localRequestTimeout}
            onChange={setLocalRequestTimeout}
            onBlur={createNumericBlurHandler(
              "requestTimeout",
              setLocalRequestTimeout,
              CONSTANTS.LIMITS.MAX_REQUEST_TIMEOUT_MS
            )}
            placeholder={translate("requestTimeoutPlaceholder")}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection>
        {/* Drawing color */}
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
      </SettingSection>
      <SettingSection>
        {/* AOI Parameter Name */}
        <FieldRow
          id={ID.aoiParamName}
          label={
            <Tooltip content={translate("aoiParamNameHelper")} placement="top">
              {translate("aoiParamNameLabel")}
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

        {/* AOI GeoJSON parameter name (optional) */}
        <FieldRow
          id={ID.aoiGeoJsonParamName}
          label={
            <Tooltip
              content={translate("aoiGeoJsonParamNameHelper")}
              placement="top"
            >
              {translate("aoiGeoJsonParamNameLabel")}
            </Tooltip>
          }
          value={localAoiGeoJsonParamName}
          onChange={setLocalAoiGeoJsonParamName}
          onBlur={createStringBlurHandler(
            "aoiGeoJsonParamName",
            setLocalAoiGeoJsonParamName
          )}
          placeholder={translate("aoiGeoJsonParamNamePlaceholder")}
          styles={settingStyles}
        />

        {/* AOI WKT parameter name (optional) */}
        <FieldRow
          id={ID.aoiWktParamName}
          label={
            <Tooltip
              content={translate("aoiWktParamNameHelper")}
              placement="top"
            >
              {translate("aoiWktParamNameLabel")}
            </Tooltip>
          }
          value={localAoiWktParamName}
          onChange={setLocalAoiWktParamName}
          onBlur={createStringBlurHandler(
            "aoiWktParamName",
            setLocalAoiWktParamName
          )}
          placeholder={translate("aoiWktParamNamePlaceholder")}
          styles={settingStyles}
        />

        {/* Upload Target Parameter Name (optional) */}
        {showUploadTargetField && (
          <FieldRow
            id={ID.uploadTargetParamName}
            label={
              <Tooltip
                content={translate("uploadTargetParamNameHelper")}
                placement="top"
              >
                {translate("uploadTargetParamNameLabel")}
              </Tooltip>
            }
            value={localUploadTargetParamName}
            onChange={setLocalUploadTargetParamName}
            onBlur={createStringBlurHandler(
              "uploadTargetParamName",
              setLocalUploadTargetParamName
            )}
            placeholder={translate("uploadTargetParamNamePlaceholder")}
            styles={settingStyles}
          />
        )}

        {/* Max AOI area (m²) */}
        <FieldRow
          id={ID.maxArea}
          label={
            <Tooltip
              content={translate("maxAreaHelper", {
                defaultM2: CONSTANTS.DEFAULTS.MAX_M2,
                maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
              })}
              placement="top"
            >
              {translate("maxAreaLabel")}
            </Tooltip>
          }
          value={localMaxAreaM2}
          onChange={(val: string) => {
            setLocalMaxAreaM2(val)
            setFieldErrors((prev) => ({ ...prev, maxArea: undefined }))
          }}
          onBlur={(val: string) => {
            const trimmed = (val ?? "").trim()
            const coerced = parseNonNegativeInt(trimmed)
            // Blank, zero, or invalid -> unset
            if (coerced === undefined || coerced === 0) {
              updateConfig("maxArea", undefined as any)
              setLocalMaxAreaM2("")
              return
            }
            // Enforce upper cap in m²
            if (coerced > CONSTANTS.LIMITS.MAX_M2_CAP) {
              // Do not save; show inline error
              setFieldErrors((prev) => ({
                ...prev,
                maxArea: translate("errorMaxAreaTooLarge", {
                  maxM2: CONSTANTS.LIMITS.MAX_M2_CAP,
                }),
              }))
              return
            }
            const m2 = coerced
            updateConfig("maxArea", m2 as any)
            setLocalMaxAreaM2(String(m2))
            // Clear any lingering error on valid save
            setFieldErrors((prev) => ({ ...prev, maxArea: undefined }))
          }}
          placeholder={translate("maxAreaPlaceholder")}
          errorText={fieldErrors.maxArea}
          styles={settingStyles}
        />
        {/* Support email (optional) */}
        <FieldRow
          id={ID.supportEmail}
          label={
            <Tooltip content={translate("supportEmailHelper")} placement="top">
              {translate("supportEmail")}
            </Tooltip>
          }
          type="email"
          value={localSupportEmail}
          onChange={(val: string) => {
            setLocalSupportEmail(val)
            // Clear previous error immediately, validate on blur
            setFieldErrors((prev) => ({ ...prev, supportEmail: undefined }))
          }}
          onBlur={(val: string) => {
            const trimmed = (val ?? "").trim()
            // Empty: clear error and unset config
            if (!trimmed) {
              setFieldErrors((prev) => ({ ...prev, supportEmail: undefined }))
              updateConfig("supportEmail", undefined as any)
              setLocalSupportEmail("")
              return
            }

            // Non-empty: validate format
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
        {/** Helper moved to label tooltip */}
      </SettingSection>

      {/* Job directives section */}
      <JobDirectivesSection
        localTmTtc={localTmTtc}
        localTmTtl={localTmTtl}
        tmTagEnabled={localTmTagEnabled}
        tmTagPreset={localTmTagPreset}
        localTmDescription={localTmDescription}
        onTmTtcChange={(val: string) => {
          setLocalTmTtc(val)
          // Don't update config on every keystroke
        }}
        onTmTtlChange={(val: string) => {
          setLocalTmTtl(val)
          // Don't update config on every keystroke
        }}
        onTmTagEnabledChange={handleTmTagEnabledChange}
        onTmTagPresetChange={handleTmTagPresetChange}
        onTmDescriptionChange={(val: string) => {
          setLocalTmDescription(val)
          setFieldErrors((prev) => ({ ...prev, tm_description: undefined }))
        }}
        onTmTtcBlur={(val: string) => {
          const trimmed = (val ?? "").trim()
          if (trimmed === "") {
            // Blank -> unset to use default
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
        onTmDescriptionBlur={(val: string) => {
          const trimmed = (val ?? "").trim()
          if (!trimmed) {
            updateConfig("tm_description", undefined as any)
            setLocalTmDescription("")
            setFieldErrors((prev) => ({
              ...prev,
              tm_description: undefined,
            }))
            return
          }
          const limited = trimmed.slice(0, CONSTANTS.DIRECTIVES.DESCRIPTION_MAX)
          updateConfig("tm_description", limited as any)
          setLocalTmDescription(limited)
          setFieldErrors((prev) => ({
            ...prev,
            tm_description: undefined,
          }))
        }}
        fieldErrors={fieldErrors}
        translate={translate}
        styles={settingStyles}
        ID={ID}
      />
    </>
  )
}
