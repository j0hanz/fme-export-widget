/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
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
  Select,
  Tooltip,
  config as uiConfig,
  useStyles,
} from "../runtime/components/ui"
import defaultMessages from "./translations/default"
import {
  isAuthError,
  sanitizeFmeBaseUrl,
  validateServerUrlKey,
  validateTokenKey,
  validateRepositoryKey,
  getEmailValidationError,
  extractHttpStatus,
} from "../shared/utils"
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
  SanitizationResult,
  IMStateWithFmeExport,
} from "../config"
import { FmeFlowApiError } from "../config"
import resetIcon from "jimu-icons/svg/outlined/editor/refresh.svg"

// Constants
const CONSTANTS = {
  VALIDATION: {
    DEFAULT_TTL_VALUE: "",
    DEFAULT_TTC_VALUE: "",
  },
  LIMITS: {
    MAX_M2_CAP: 10_000_000_000,
  },
  DEFAULTS: {
    MAX_M2: 100_000_000,
  },
  HTTP_STATUS: {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    BAD_REQUEST: 400,
    TIMEOUT: 408,
    GATEWAY_TIMEOUT: 504,
    TOO_MANY_REQUESTS: 429,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    NETWORK_ERROR: 0,
    SERVER_ERROR_MIN: 500,
    SERVER_ERROR_MAX: 599,
  },
  COLORS: {
    BACKGROUND_DARK: "#181818",
  },
} as const

type TranslateFn = (key: string, params?: any) => string

interface ConnectionTestSectionProps {
  testState: TestState
  checkSteps: CheckSteps
  cannotTest: () => boolean
  onTestConnection: () => void
  translate: TranslateFn
  styles: ReturnType<typeof useSettingStyles>
}

const ConnectionTestSection: React.FC<ConnectionTestSectionProps> = ({
  testState,
  checkSteps,
  cannotTest,
  onTestConnection,
  translate,
  styles,
}) => {
  const renderConnectionStatus = (): React.ReactNode => {
    const rows: Array<{ label: string; status: StepStatus | string }> = [
      { label: translate("fmeServerUrl"), status: checkSteps.serverUrl },
      { label: translate("fmeServerToken"), status: checkSteps.token },
      { label: translate("fmeRepository"), status: checkSteps.repository },
    ]

    // Helper to get style for each status
    const getStatusStyle = (s: StepStatus | string): unknown => {
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
          // Handle StepStatus objects
          if (typeof s === "object" && s !== null) {
            return s.completed
              ? styles.STATUS.COLOR.OK
              : styles.STATUS.COLOR.FAIL
          }
          return styles.STATUS.COLOR.PENDING
      }
    }

    // Normalize status-to-text mapping for readability and consistency
    const getStatusText = (status: StepStatus | string): string => {
      if (typeof status === "string") {
        if (status === "ok") return translate("ok")
        if (status === "fail") return translate("failed")
        if (status === "skip") return translate("skipped")
        return translate("checking")
      }
      if (status?.completed) return translate("ok")
      if (status?.error) return translate("failed")
      return translate("checking")
    }

    const StatusRow = ({
      label,
      status,
    }: {
      label: string
      status: StepStatus | string
    }) => {
      const color = getStatusStyle(status)
      return (
        <div css={css(styles.STATUS.ROW as any)}>
          <div css={css(styles.STATUS.LABEL_GROUP as any)}>
            <>
              {label}
              {translate("colon")}
            </>
          </div>
          <div css={css(color as any)}>{getStatusText(status)}</div>
        </div>
      )
    }
    // Determine if version string is present on checkSteps
    const hasVersion: boolean =
      typeof (checkSteps as any)?.version === "string" &&
      ((checkSteps as any).version as string).length > 0

    return (
      <div
        css={css(styles.STATUS.CONTAINER as any)}
        role="status"
        aria-live="polite"
        aria-atomic={true}
      >
        {testState.isTesting && (
          <Loading
            type={LoadingType.Bar}
            text={translate("testingConnection")}
          />
        )}

        <div css={css(styles.STATUS.LIST as any)}>
          {rows.map((r) => (
            <StatusRow key={r.label} label={r.label} status={r.status} />
          ))}
          {hasVersion && (
            <div css={css(styles.STATUS.ROW as any)}>
              <div css={css(styles.STATUS.LABEL_GROUP as any)}>
                {translate("fmeVersion")}
                {translate("colon")}
              </div>
              <div>{(checkSteps as any).version}</div>
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
          disabled={cannotTest()}
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

interface RepositorySelectorProps {
  localServerUrl: string
  localToken: string
  localRepository: string
  availableRepos: string[] | null
  fieldErrors: FieldErrors
  validateServerUrl: (url: string) => string | null
  validateToken: (token: string) => string | null
  onRepositoryChange: (repository: string) => void
  onRefreshRepositories: () => void
  translate: TranslateFn
  styles: ReturnType<typeof useSettingStyles>
  ID: { repository: string }
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
}) => {
  // Allow manual refresh whenever URL and token are present and pass basic validation
  const canRefresh =
    !validateServerUrl(localServerUrl) &&
    !validateToken(localToken) &&
    availableRepos !== null

  return (
    <SettingRow
      flow="wrap"
      label={
        <div css={styles.LABEL_WITH_BUTTON}>
          <span>{translate("availableRepositories")}</span>
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
      <Select
        options={(() => {
          // If server URL or token are invalid, show no options
          const hasValidServer =
            !!localServerUrl && !validateServerUrl(localServerUrl)
          const hasValidToken = !!localToken && !validateToken(localToken)
          if (!hasValidServer || !hasValidToken) {
            return []
          }

          // Use availableRepos if populated; otherwise empty list
          const src =
            Array.isArray(availableRepos) && availableRepos.length > 0
              ? availableRepos
              : []

          // Deduplicate options while preserving order and ensure current selection is present
          const seen = new Set<string>()
          const opts: Array<{ label: string; value: string }> = []
          if (
            localRepository &&
            typeof localRepository === "string" &&
            localRepository.trim()
          ) {
            seen.add(localRepository)
            opts.push({ label: localRepository, value: localRepository })
          }
          for (const name of src) {
            if (!seen.has(name) && typeof name === "string" && name.trim()) {
              seen.add(name)
              opts.push({ label: name, value: name })
            }
          }
          return opts
        })()}
        value={localRepository || undefined}
        onChange={(val) => {
          const next =
            typeof val === "string" || typeof val === "number"
              ? String(val)
              : ""
          onRepositoryChange(next)
        }}
        disabled={
          !localServerUrl ||
          !localToken ||
          !!validateServerUrl(localServerUrl) ||
          !!validateToken(localToken) ||
          availableRepos === null
        }
        aria-describedby={
          fieldErrors.repository ? `${ID.repository}-error` : undefined
        }
        aria-invalid={fieldErrors.repository ? true : undefined}
        placeholder={(() => {
          const hasValidServer = !validateServerUrl(localServerUrl)
          const hasValidToken = !validateToken(localToken)
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
        })()}
      />
      {fieldErrors.repository && (
        <SettingRow flow="wrap" level={3}>
          <Alert
            id={`${ID.repository}-error`}
            fullWidth
            css={css(styles.ALERT_INLINE as any)}
            text={fieldErrors.repository}
            type="error"
            closable={false}
          />
        </SettingRow>
      )}
    </SettingRow>
  )
}

interface JobDirectivesSectionProps {
  localTmTtc: string
  localTmTtl: string
  localTmTag: string
  onTmTtcChange: (value: string) => void
  onTmTtlChange: (value: string) => void
  onTmTagChange: (value: string) => void
  onTmTtcBlur: (value: string) => void
  onTmTtlBlur: (value: string) => void
  onTmTagBlur: (value: string) => void
  fieldErrors: FieldErrors
  translate: TranslateFn
  styles: ReturnType<typeof useSettingStyles>
  ID: { tm_ttc: string; tm_ttl: string; tm_tag: string }
}

const JobDirectivesSection: React.FC<JobDirectivesSectionProps> = ({
  localTmTtc,
  localTmTtl,
  localTmTag,
  onTmTtcChange,
  onTmTtlChange,
  onTmTagChange,
  onTmTtcBlur,
  onTmTtlBlur,
  onTmTagBlur,
  fieldErrors,
  translate,
  styles,
  ID,
}) => {
  const renderInputField = ({
    id,
    label,
    value,
    onChange,
    onBlur,
    placeholder,
  }: {
    id: string
    label: React.ReactNode
    value: string
    onChange: (val: string) => void
    onBlur: (val: string) => void
    placeholder?: string
  }) => {
    const error = fieldErrors[id as keyof typeof fieldErrors]
    const describedBy: string[] = []
    if (error) describedBy.push(`${id}-error`)
    return (
      <SettingRow flow="wrap" label={label} level={1} tag="label">
        <Input
          id={id}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          errorText={error}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            describedBy.length ? describedBy.join(" ") : undefined
          }
        />
        {error && (
          <SettingRow flow="wrap" level={3} css={css(styles.ROW as any)}>
            <Alert
              id={`${id}-error`}
              fullWidth
              css={css(styles.ALERT_INLINE as any)}
              text={error}
              type="error"
              closable={false}
            />
          </SettingRow>
        )}
      </SettingRow>
    )
  }

  return (
    <SettingSection>
      {/* Job directives (admin defaults) */}
      {renderInputField({
        id: ID.tm_ttc,
        label: (
          <Tooltip content={translate("jobDirectivesHelper2")} placement="top">
            <span>{translate("tm_ttcLabel")}</span>
          </Tooltip>
        ),
        value: localTmTtc,
        onChange: onTmTtcChange,
        onBlur: onTmTtcBlur,
        placeholder: translate("tm_ttcPlaceholder"),
      })}
      {renderInputField({
        id: ID.tm_ttl,
        label: (
          <Tooltip content={translate("jobDirectivesHelper2")} placement="top">
            <span>{translate("tm_ttlLabel")}</span>
          </Tooltip>
        ),
        value: localTmTtl,
        onChange: onTmTtlChange,
        onBlur: onTmTtlBlur,
        placeholder: translate("tm_ttlPlaceholder"),
      })}
      <SettingRow
        flow="wrap"
        label={
          <Tooltip content={translate("jobDirectivesHelper2")} placement="top">
            <span>{translate("tm_tagLabel")}</span>
          </Tooltip>
        }
        level={1}
        tag="label"
      >
        <Input
          id={ID.tm_tag}
          value={localTmTag}
          onChange={onTmTagChange}
          onBlur={onTmTagBlur}
          placeholder={translate("tm_tagPlaceholder")}
          errorText={fieldErrors.tm_tag}
        />
        {fieldErrors.tm_tag && (
          <SettingRow flow="wrap" level={3}>
            <Alert
              id={`${ID.tm_tag}-error`}
              fullWidth
              css={css(styles.ALERT_INLINE as any)}
              text={fieldErrors.tm_tag}
              type="error"
              closable={false}
            />
          </SettingRow>
        )}
      </SettingRow>
      {/** Helper moved to label tooltips */}
    </SettingSection>
  )
}

const STATUS_ERROR_MAP: { readonly [status: number]: string } = {
  [CONSTANTS.HTTP_STATUS.UNAUTHORIZED]: "errorUnauthorized",
  [CONSTANTS.HTTP_STATUS.FORBIDDEN]: "errorUnauthorized",
  [CONSTANTS.HTTP_STATUS.NOT_FOUND]: "errorNotFound",
  [CONSTANTS.HTTP_STATUS.BAD_REQUEST]: "errorBadRequest",
  [CONSTANTS.HTTP_STATUS.TIMEOUT]: "errorTimeout",
  [CONSTANTS.HTTP_STATUS.GATEWAY_TIMEOUT]: "errorTimeout",
  [CONSTANTS.HTTP_STATUS.TOO_MANY_REQUESTS]: "errorTooManyRequests",
  [CONSTANTS.HTTP_STATUS.BAD_GATEWAY]: "errorGateway",
  [CONSTANTS.HTTP_STATUS.SERVICE_UNAVAILABLE]: "errorServiceUnavailable",
  [CONSTANTS.HTTP_STATUS.NETWORK_ERROR]: "errorNetworkShort",
}

// Small utilities
const setError = (
  set: React.Dispatch<React.SetStateAction<FieldErrors>>,
  key: keyof FieldErrors,
  value?: string
) => {
  set((prev) => ({ ...prev, [key]: value }))
}

const clearErrors = (
  set: React.Dispatch<React.SetStateAction<FieldErrors>>,
  keys: Array<keyof FieldErrors>
) => {
  set((prev) => {
    const next = { ...prev }
    for (const k of keys) (next as any)[k] = undefined
    return next
  })
}

const safeAbort = (ctrl: AbortController | null) => {
  if (ctrl) {
    try {
      ctrl.abort()
    } catch {}
  }
}

// Parse a non-negative integer from string; returns undefined when invalid
const parseNonNegativeInt = (val: string): number | undefined => {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
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

// Error message generation helpers
const getErrorMessageWithHelper = (
  translate: TranslateFn,
  errorKey: string,
  status: number,
  helperKey?: string
): string => {
  const baseMessage = translate(errorKey, { status })
  if (helperKey) {
    const helperMessage = translate(helperKey)
    return `${baseMessage} ${helperMessage}`
  }
  return baseMessage
}

const getSpecialStatusErrorMessage = (
  status: number,
  translate: TranslateFn,
  errorKey: string
): string => {
  if (status === CONSTANTS.HTTP_STATUS.NETWORK_ERROR) {
    return getErrorMessageWithHelper(
      translate,
      errorKey,
      status,
      "helperNetwork"
    )
  }
  if (isAuthError(status)) {
    return getErrorMessageWithHelper(translate, errorKey, status, "helperAuth")
  }
  if (status === CONSTANTS.HTTP_STATUS.NOT_FOUND) {
    return getErrorMessageWithHelper(
      translate,
      errorKey,
      status,
      "helperNotFound"
    )
  }
  return translate(errorKey, { status })
}

function getStatusErrorMessage(status: number, translate: TranslateFn): string {
  const errorKey = STATUS_ERROR_MAP[status]

  if (errorKey) {
    return getSpecialStatusErrorMessage(status, translate, errorKey)
  }

  if (
    status >= CONSTANTS.HTTP_STATUS.SERVER_ERROR_MIN &&
    status <= CONSTANTS.HTTP_STATUS.SERVER_ERROR_MAX
  ) {
    return translate("errorServer", { status })
  }

  return translate("errorHttpStatus", { status })
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
  return React.useMemo(() => createSettingStyles(theme), [theme])
}

export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useStyles()
  const sstyles = useSettingStyles()
  const dispatch = useDispatch()

  // Get current repository from global state to detect external changes
  const currentRepository = useSelector((state: IMStateWithFmeExport) => {
    const global = state?.["fme-state"] as any
    return (global?.byId && id && global.byId[id]?.currentRepository) || null
  })

  const getStringConfig = useStringConfigValue(config)
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
    aoiParamName: "setting-aoi-param-name",
    allowScheduleMode: "setting-allow-schedule-mode",
    allowRemoteDataset: "setting-allow-remote-dataset",
    service: "setting-service",
  } as const

  // Consolidated test state
  const [testState, setTestState] = React.useState<TestState>({
    status: "idle",
    isTesting: false,
    message: null,
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
  // Values committed on blur (used for side-effects and loading)
  const [committedServerUrl, setCommittedServerUrl] = React.useState<string>(
    () => getStringConfig("fmeServerUrl") || ""
  )
  const [committedToken, setCommittedToken] = React.useState<string>(
    () => getStringConfig("fmeServerToken") || ""
  )
  const [localRepository, setLocalRepository] = React.useState<string>(
    () => getStringConfig("repository") || ""
  )
  const [localSupportEmail, setLocalSupportEmail] = React.useState<string>(
    () => getStringConfig("supportEmail") || ""
  )
  const [localSyncMode, setLocalSyncMode] = React.useState<boolean>(() =>
    Boolean((config as any)?.syncMode)
  )
  const [localMaskEmailOnSuccess, setLocalMaskEmailOnSuccess] =
    React.useState<boolean>(() => Boolean((config as any)?.maskEmailOnSuccess))
  // Request timeout (ms)
  const [localRequestTimeout, setLocalRequestTimeout] = React.useState<string>(
    () => {
      const v = (config as any)?.requestTimeout
      return typeof v === "number" && Number.isFinite(v) ? String(v) : ""
    }
  )
  // Max AOI area (m²) – stored and displayed in m²
  const [localMaxAreaM2, setLocalMaxAreaM2] = React.useState<string>(() => {
    const v = (config as any)?.maxArea
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return String(v)
    }
    return ""
  })
  // Admin job directives (defaults 0/empty)
  const [localTmTtc, setLocalTmTtc] = React.useState<string>(() => {
    const v = (config as any)?.tm_ttc
    return typeof v === "number"
      ? String(v)
      : CONSTANTS.VALIDATION.DEFAULT_TTC_VALUE
  })
  const [localTmTtl, setLocalTmTtl] = React.useState<string>(() => {
    const v = (config as any)?.tm_ttl
    return typeof v === "number"
      ? String(v)
      : CONSTANTS.VALIDATION.DEFAULT_TTL_VALUE
  })
  const [localTmTag, setLocalTmTag] = React.useState<string>(() => {
    const v = (config as any)?.tm_tag
    return typeof v === "string" ? v : ""
  })
  const [localAoiParamName, setLocalAoiParamName] = React.useState<string>(
    () => {
      const v = (config as any)?.aoiParamName
      return typeof v === "string" ? v : "AreaOfInterest"
    }
  )
  const [localAllowScheduleMode, setLocalAllowScheduleMode] =
    React.useState<boolean>(() => Boolean((config as any)?.allowScheduleMode))
  const [localAllowRemoteDataset, setLocalAllowRemoteDataset] =
    React.useState<boolean>(() => Boolean((config as any)?.allowRemoteDataset))
  const [localService, setLocalService] = React.useState<string>(() => {
    const v = (config as any)?.service
    return v === "stream" ? "stream" : "download"
  })
  // Server-provided repository list (null = not loaded yet)
  const [availableRepos, setAvailableRepos] = React.useState<string[] | null>(
    null
  )
  // Track in-flight test for cancellation to avoid stale state updates
  const abortRef = React.useRef<AbortController | null>(null)
  // Track in-flight repository listing request for cancellation
  const reposAbortRef = React.useRef<AbortController | null>(null)

  // Helper: abort in-flight repository request safely
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
      }

      try {
        const result = await fetchRepositoriesService(serverUrl, token, signal)
        if (signal.aborted) return
        const next = result.repositories || []
        setAvailableRepos(next)
        clearErrors(setFieldErrors, ["repository"])
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          // Log minimal diagnostic without exposing sensitive details
          const status = extractHttpStatus(err)
          console.warn("Repositories load error", { status })
          setAvailableRepos((prev) => (Array.isArray(prev) ? prev : []))
        }
      } finally {
        if (reposAbortRef.current === ctrl) reposAbortRef.current = null
      }
    }
  )

  // Helper: clear repo-related ephemeral state (list, error) and abort any in-flight request
  const clearRepositoryEphemeralState = hooks.useEventCallback(() => {
    setAvailableRepos(null)
    // Only clear repository error if we're actually changing connection parameters
    // Don't clear errors that might be from user input validation
    setFieldErrors((prev) => ({ ...prev, repository: undefined }))
    abortReposRequest()
  })

  // Cleanup on unmount
  hooks.useUnmount(() => {
    safeAbort(abortRef.current)
    abortReposRequest()
  })

  // Comprehensive error processor - returns alert message for bottom display
  const processError = hooks.useEventCallback((err: unknown): string => {
    const status = err instanceof FmeFlowApiError ? err.status : 0
    return getStatusErrorMessage(status, translate)
  })

  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    onSettingChange({
      id,
      useMapWidgetIds,
    })
  }

  // Render required label with tooltip
  const renderRequiredLabel = hooks.useEventCallback(
    (labelText: string): React.ReactNode => (
      <>
        {labelText}
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
  )

  // Sanitize URL input
  const sanitizeUrl = hooks.useEventCallback(
    (rawUrl: string): SanitizationResult => {
      return sanitizeFmeBaseUrl(rawUrl)
    }
  )

  // Unified input validation
  const validateAllInputs = hooks.useEventCallback(
    (skipRepoCheck = false): ValidationResult => {
      const messages: Partial<FieldErrors> = {}

      const serverUrlError = validateServerUrlKey(localServerUrl)
      const tokenError = validateTokenKey(localToken)
      const repositoryError = skipRepoCheck
        ? null
        : validateRepositoryKey(localRepository, availableRepos)
      const emailError = getEmailValidationError(localSupportEmail)

      if (serverUrlError) messages.serverUrl = translate(serverUrlError)
      if (tokenError) messages.token = translate(tokenError)
      if (repositoryError) messages.repository = translate(repositoryError)
      if (emailError) messages.supportEmail = translate(emailError)

      // Preserve existing field errors for fields not being validated here
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
      const repository = localRepository

      const { cleaned, changed } = sanitizeUrl(rawServerUrl || "")
      // If sanitization changed, update config
      if (changed) {
        updateConfig("fmeServerUrl", cleaned)
      }

      const serverUrl = cleaned

      return serverUrl && token ? { serverUrl, token, repository } : null
    }
  )

  // Handle "Test Connection" button click
  const isTestDisabled = !!testState.isTesting || !localServerUrl || !localToken

  // OPTIMIZED connection testing - single efficient flow with minimal API calls
  const testConnection = hooks.useEventCallback(async (silent = false) => {
    // Cancel any in-flight test first
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    // Run lightweight check: require URL and token presence only
    if (!localServerUrl || !localToken) {
      if (!silent)
        setTestState({
          status: "error",
          isTesting: false,
          message: translate("fixErrorsAbove"),
          type: "error",
        })
      return
    }

    // Populate field errors for the UI (non-blocking) and sanitize URL
    validateAllInputs(true)
    const settings = validateConnectionSettings()
    if (!settings) {
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
      // Use the existing validateConnection service to avoid code duplication
      // This ensures consistency with widget startup validation
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
        // Update UI state based on validation results
        setCheckSteps({
          serverUrl: validationResult.steps.serverUrl,
          token: validationResult.steps.token,
          repository: validationResult.steps.repository,
          version: validationResult.version || "",
        })

        // Set available repositories from validation result
        if (validationResult.repositories) {
          setAvailableRepos(validationResult.repositories)
        }

        // Clear any existing field errors
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
      } else {
        // Handle validation failure
        const error = validationResult.error

        // Update step states based on error type via helper
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
          repositories: validationResult.repositories,
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
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return

      // Handle unexpected errors (network issues, etc.)
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
        setTestState({
          status: "error",
          isTesting: false,
          message:
            failureType === "network"
              ? translate("errorInvalidServerUrl")
              : processError(err),
          type: "error",
        })
      }
    }
  })

  // Enhanced repository refresh for better UX - uses client API directly
  const refreshRepositories = hooks.useEventCallback(async () => {
    if (!committedServerUrl || !committedToken) return
    const { cleaned } = sanitizeUrl(committedServerUrl)
    await loadRepositories(cleaned, committedToken, { indicateLoading: true })
  })

  React.useEffect(() => {
    if (!committedServerUrl && !committedToken) return
    clearRepositoryEphemeralState()
  }, [
    committedServerUrl,
    committedToken,
    clearRepositoryEphemeralState,
    abortReposRequest,
  ])

  // Auto-load repositories when both committed URL and token are valid
  React.useEffect(() => {
    const hasValidServer =
      !!committedServerUrl && !validateServerUrlKey(committedServerUrl)
    const hasValidToken = !!committedToken && !validateTokenKey(committedToken)
    if (!hasValidServer || !hasValidToken) return

    const { cleaned } = sanitizeUrl(committedServerUrl)
    loadRepositories(cleaned, committedToken, { indicateLoading: true })
    return () => abortReposRequest()
  }, [
    committedServerUrl,
    committedToken,
    sanitizeUrl,
    abortReposRequest,
    loadRepositories,
  ])

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
    const errKey = validateServerUrlKey(url)
    setError(
      setFieldErrors,
      "serverUrl",
      errKey ? translate(errKey) : undefined
    )

    // Sanitize and save to config
    const { cleaned, changed } = sanitizeUrl(url)
    const finalUrl = changed ? cleaned : url
    updateConfig("fmeServerUrl", finalUrl)

    // Update local and committed state if sanitized/blurred
    if (changed) {
      setLocalServerUrl(cleaned)
      const cleanedErrKey = validateServerUrlKey(cleaned)
      setError(
        setFieldErrors,
        "serverUrl",
        cleanedErrKey ? translate(cleanedErrKey) : undefined
      )
      setCommittedServerUrl(cleaned)
    } else {
      setCommittedServerUrl(finalUrl)
    }

    // Clear repository data when server changes
    clearRepositoryEphemeralState()
  })

  // Handle token blur - save to config and clear repository state
  const handleTokenBlur = hooks.useEventCallback((token: string) => {
    // Validate on blur
    const errKey = validateTokenKey(token)
    setError(setFieldErrors, "token", errKey ? translate(errKey) : undefined)

    // Save to config and commit
    updateConfig("fmeServerToken", token)
    setCommittedToken(token)

    // Clear repository data when token changes
    clearRepositoryEphemeralState()
  })

  // Keep repository field error in sync when either the list or selection changes
  React.useEffect(() => {
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

  // Handle repository changes with workspace state clearing
  const handleRepositoryChange = hooks.useEventCallback(
    (newRepository: string) => {
      const previousRepository = currentRepository

      // Update local state
      setLocalRepository(newRepository)
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
  const renderInputField = hooks.useEventCallback(
    ({
      id,
      label,
      value,
      onChange,
      onBlur,
      placeholder,
      type = "text",
      required = false,
      inputMode,
    }: {
      id: string
      label: React.ReactNode
      value: string
      onChange: (val: string) => void
      onBlur?: (val: string) => void
      placeholder?: string
      type?: "text" | "email" | "password"
      required?: boolean
      inputMode?: "numeric"
    }) => {
      // Map control IDs to fieldErrors keys so the correct inline Alert renders
      let key: keyof typeof fieldErrors | undefined
      switch (id) {
        case ID.serverUrl:
          key = "serverUrl"
          break
        case ID.token:
          key = "token"
          break
        case ID.repository:
          key = "repository"
          break
        case ID.tm_ttc:
          key = "tm_ttc"
          break
        case ID.tm_ttl:
          key = "tm_ttl"
          break
        case ID.tm_tag:
          key = "tm_tag"
          break
        case ID.supportEmail:
          key = "supportEmail"
          break
        default:
          key = undefined
      }
      const error = key ? fieldErrors[key] : undefined
      return (
        <SettingRow flow="wrap" label={label} level={1} tag="label">
          <Input
            id={id}
            type={type}
            required={required}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
            errorText={error}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && (
            <SettingRow flow="wrap" level={3} css={css(sstyles.ROW as any)}>
              <Alert
                id={`${id}-error`}
                fullWidth
                css={css(sstyles.ALERT_INLINE as any)}
                text={error}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
      )
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
        {renderInputField({
          id: ID.serverUrl,
          label: renderRequiredLabel(translate("fmeServerUrl")),
          value: localServerUrl,
          onChange: handleServerUrlChange,
          onBlur: handleServerUrlBlur,
          placeholder: translate("serverUrlPlaceholder"),
          required: true,
        })}
        {/* FME Server Token */}
        {renderInputField({
          id: ID.token,
          label: renderRequiredLabel(translate("fmeServerToken")),
          value: localToken,
          onChange: handleTokenChange,
          onBlur: handleTokenBlur,
          placeholder: translate("tokenPlaceholder"),
          type: "password",
          required: true,
        })}
        {/* Test connection section */}
        <ConnectionTestSection
          testState={testState}
          checkSteps={checkSteps}
          cannotTest={() => isTestDisabled}
          onTestConnection={() => testConnection(false)}
          translate={translate}
          styles={sstyles}
        />

        {/* Repository selector */}
        <RepositorySelector
          localServerUrl={committedServerUrl}
          localToken={committedToken}
          localRepository={localRepository}
          availableRepos={availableRepos}
          fieldErrors={fieldErrors}
          validateServerUrl={validateServerUrlKey}
          validateToken={validateTokenKey}
          onRepositoryChange={handleRepositoryChange}
          onRefreshRepositories={refreshRepositories}
          translate={translate}
          styles={sstyles}
          ID={ID}
        />
        {/* Service Type */}
        <SettingRow
          flow="wrap"
          label={
            <Tooltip content={translate("serviceTypeHelper")} placement="top">
              <span>{translate("serviceTypeLabel")}</span>
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
            // helper via label tooltip
          />
        </SettingRow>

        {/* Allow Schedule Mode */}
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
              const checked = evt?.target?.checked ?? !localAllowScheduleMode
              setLocalAllowScheduleMode(checked)
              updateConfig("allowScheduleMode", checked)
            }}
            aria-label={translate("allowScheduleModeLabel")}
            // helper via label tooltip
          />
        </SettingRow>

        {/* Allow Remote Dataset */}
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
            // helper via label tooltip
          />
        </SettingRow>
        {/* Mask email on success toggle */}
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
              const checked = evt?.target?.checked ?? !localMaskEmailOnSuccess
              setLocalMaskEmailOnSuccess(checked)
              updateConfig("maskEmailOnSuccess", checked)
            }}
            aria-label={translate("maskEmailOnSuccess")}
          />
        </SettingRow>
        {/* Request timeout (ms) */}
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
          <Input
            id={ID.requestTimeout}
            value={localRequestTimeout}
            onChange={(val: string) => {
              setLocalRequestTimeout(val)
            }}
            onBlur={(val: string) => {
              const sanitized = parseNonNegativeInt((val ?? "").trim())
              if (sanitized === undefined) {
                // Clear config when input invalid/empty
                updateConfig("requestTimeout", undefined as any)
                setLocalRequestTimeout("")
              } else {
                updateConfig("requestTimeout", sanitized as any)
                setLocalRequestTimeout(String(sanitized))
              }
            }}
            placeholder={translate("requestTimeoutPlaceholder")}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection>
        {/* AOI Parameter Name */}
        <SettingRow
          flow="wrap"
          label={
            <Tooltip content={translate("aoiParamNameHelper")} placement="top">
              <span>{translate("aoiParamNameLabel")}</span>
            </Tooltip>
          }
          level={1}
          tag="label"
        >
          <Input
            id={ID.aoiParamName}
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
          />
        </SettingRow>

        {/* Max AOI area (m²) */}
        <SettingRow
          flow="wrap"
          label={
            <Tooltip
              content={translate("maxAreaHelper", {
                defaultM2: CONSTANTS.DEFAULTS.MAX_M2,
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
          <Input
            id={ID.maxArea}
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
          />
          {fieldErrors.maxArea && (
            <SettingRow flow="wrap" level={3} css={css(sstyles.ROW as any)}>
              <Alert
                id={`${ID.maxArea}-error`}
                fullWidth
                css={css(sstyles.ALERT_INLINE as any)}
                text={fieldErrors.maxArea}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
        {/* Support email (optional) */}
        <SettingRow
          flow="wrap"
          label={
            <Tooltip
              content={translate("maskEmailOnSuccessHelper")}
              placement="top"
            >
              <span>{translate("supportEmail")}</span>
            </Tooltip>
          }
          level={1}
          tag="label"
        >
          <Input
            id={ID.supportEmail}
            type="email"
            value={localSupportEmail}
            onChange={(val: string) => {
              setLocalSupportEmail(val)
              // Clear previous error immediately, validate on blur
              setFieldErrors((prev) => ({ ...prev, supportEmail: undefined }))
            }}
            onBlur={(val: string) => {
              // Save to config on blur, not on every keystroke
              updateConfig("supportEmail", val)
              // Validate on blur
              const errKey = getEmailValidationError(val)
              const err = errKey ? translate(errKey) : undefined
              setFieldErrors((prev) => ({ ...prev, supportEmail: err }))
            }}
            placeholder={translate("supportEmailPlaceholder")}
            errorText={fieldErrors.supportEmail}
          />
          {fieldErrors.supportEmail && (
            <SettingRow flow="wrap" level={3} css={css(sstyles.ROW as any)}>
              <Alert
                id={`${ID.supportEmail}-error`}
                fullWidth
                css={css(sstyles.ALERT_INLINE as any)}
                text={fieldErrors.supportEmail}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
        {/** Helper moved to label tooltip */}
      </SettingSection>

      {/* Job directives section */}
      <JobDirectivesSection
        localTmTtc={localTmTtc}
        localTmTtl={localTmTtl}
        localTmTag={localTmTag}
        onTmTtcChange={(val: string) => {
          setLocalTmTtc(val)
          // Don't update config on every keystroke
        }}
        onTmTtlChange={(val: string) => {
          setLocalTmTtl(val)
          // Don't update config on every keystroke
        }}
        onTmTagChange={(val: string) => {
          setLocalTmTag(val)
          // Don't update config on every keystroke
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
        onTmTagBlur={(val: string) => {
          updateConfig("tm_tag", val)
        }}
        fieldErrors={fieldErrors}
        translate={translate}
        styles={sstyles}
        ID={ID}
      />
    </>
  )
}
