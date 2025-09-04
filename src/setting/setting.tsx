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
import { getErrorMessage, validateConnection } from "../shared/services"
import { createFmeFlowClient } from "../shared/api"
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
} from "../shared/types"
import { FmeFlowApiError } from "../shared/types"
import resetIcon from "jimu-icons/svg/outlined/editor/refresh.svg"

// Constants
const CONSTANTS = {
  VALIDATION: {
    DEFAULT_TTL_VALUE: "0",
    DEFAULT_TTC_VALUE: "0",
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

// Components for better organization and reusability

interface ConnectionTestSectionProps {
  testState: TestState
  checkSteps: CheckSteps
  cannotTest: () => boolean
  onTestConnection: () => void
  translate: (key: string, params?: any) => string
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

    // Map step -> icon and color style
    const getStatusIcon = (s: StepStatus | string): { color: unknown } => {
      switch (s) {
        case "ok":
          return { color: styles.STATUS.COLOR.OK }
        case "fail":
          return { color: styles.STATUS.COLOR.FAIL }
        case "skip":
          return { color: styles.STATUS.COLOR.SKIP }
        case "pending":
        case "idle":
          return { color: styles.STATUS.COLOR.PENDING }
        default:
          // Handle StepStatus objects
          if (typeof s === "object" && s !== null) {
            return s.completed
              ? { color: styles.STATUS.COLOR.OK }
              : { color: styles.STATUS.COLOR.FAIL }
          }
          return { color: styles.STATUS.COLOR.PENDING }
      }
    }

    const StatusRow = ({
      label,
      status,
    }: {
      label: string
      status: StepStatus | string
    }) => {
      const { color } = getStatusIcon(status)
      return (
        <div css={css(styles.STATUS.ROW as any)}>
          <div css={css(styles.STATUS.LABEL_GROUP as any)}>
            <>
              {label}
              {translate("colon")}
            </>
          </div>
          <div css={css(color as any)}>
            {(typeof status === "string" && status === "ok") ||
            (typeof status === "object" && status?.completed)
              ? translate("ok")
              : (typeof status === "string" && status === "fail") ||
                  (typeof status === "object" && status?.error)
                ? translate("failed")
                : typeof status === "string" && status === "skip"
                  ? translate("skipped")
                  : translate("checking")}
          </div>
        </div>
      )
    }

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
  translate: (key: string, params?: any) => string
  styles: ReturnType<typeof useSettingStyles>
  ID: { repository: string }
  testState: TestState
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
  testState,
}) => {
  const canRefresh =
    testState.status === "success" &&
    !validateServerUrl(localServerUrl) &&
    !validateToken(localToken)

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
              title={translate("refreshRepositories") || "Refresh repositories"}
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
          // Only show repositories after successful connection test
          if (testState.status !== "success") {
            return []
          }

          // If server URL or token are invalid, show no options
          const hasValidServer = !validateServerUrl(localServerUrl)
          const hasValidToken = !validateToken(localToken)
          if (!hasValidServer || !hasValidToken) {
            return []
          }

          // Use availableRepos if populated; otherwise empty list
          const src =
            Array.isArray(availableRepos) && availableRepos.length > 0
              ? availableRepos
              : []

          // Deduplicate options while preserving order
          const seen = new Set<string>()
          const opts: Array<{ label: string; value: string }> = []
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
        // Disable when connection hasn't been tested successfully or when inputs are invalid
        disabled={
          testState.status !== "success" ||
          !localServerUrl ||
          !localToken ||
          !!validateServerUrl(localServerUrl) ||
          !!validateToken(localToken)
        }
        aria-describedby={
          fieldErrors.repository ? `${ID.repository}-error` : undefined
        }
        aria-invalid={fieldErrors.repository ? true : undefined}
        placeholder={(() => {
          if (testState.status !== "success") {
            return translate("testConnectionFirst")
          }

          // If connection is successful but no repos available
          const hasValidServer = !validateServerUrl(localServerUrl)
          const hasValidToken = !validateToken(localToken)
          if (!hasValidServer || !hasValidToken) {
            return translate("testConnectionFirst")
          }

          if (availableRepos === null) {
            return translate("loadingRepositories") || "Loading repositories..."
          }

          if (Array.isArray(availableRepos) && availableRepos.length === 0) {
            return translate("noRepositoriesFound") || "No repositories found"
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
  translate: (key: string, params?: any) => string
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
    inputMode,
  }: {
    id: string
    label: React.ReactNode
    value: string
    onChange: (val: string) => void
    onBlur: (val: string) => void
    placeholder?: string
    inputMode?: "numeric"
  }) => {
    const error = fieldErrors[id as keyof typeof fieldErrors]
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
          aria-describedby={error ? `${id}-error` : undefined}
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
        label: translate("tm_ttcLabel"),
        value: localTmTtc,
        onChange: onTmTtcChange,
        onBlur: onTmTtcBlur,
        placeholder: "0",
        inputMode: "numeric",
      })}
      {renderInputField({
        id: ID.tm_ttl,
        label: translate("tm_ttlLabel"),
        value: localTmTtl,
        onChange: onTmTtlChange,
        onBlur: onTmTtlBlur,
        placeholder: "0",
        inputMode: "numeric",
      })}
      <SettingRow
        flow="wrap"
        label={translate("tm_tagLabel")}
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
      <SettingRow flow="wrap" css={css(styles.ALERT_INLINE as any)} level={3}>
        {translate("jobDirectivesHelper")}
      </SettingRow>
    </SettingSection>
  )
}

function isFmeFlowApiError(err: unknown): err is FmeFlowApiError {
  return err instanceof FmeFlowApiError
}

function extractErrorCode(err: unknown): string {
  if (isFmeFlowApiError(err)) return err.code || ""
  const code = (err as { [key: string]: unknown })?.code
  return typeof code === "string" ? code : ""
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

// Error message generation helpers
const getErrorMessageWithHelper = (
  translate: (key: string, params?: { [key: string]: unknown }) => string,
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
  translate: (key: string, params?: { [key: string]: unknown }) => string,
  errorKey: string
): string => {
  if (status === CONSTANTS.HTTP_STATUS.NETWORK_ERROR) {
    return translate(errorKey)
  }
  if (isAuthError(status)) {
    return getErrorMessageWithHelper(
      translate,
      errorKey,
      status,
      "errorUnauthorizedHelper"
    )
  }
  if (status === CONSTANTS.HTTP_STATUS.NOT_FOUND) {
    return getErrorMessageWithHelper(
      translate,
      errorKey,
      status,
      "errorNotFoundHelper"
    )
  }
  return translate(errorKey, { status })
}

function getStatusErrorMessage(
  status: number,
  translate: (key: string, params?: { [key: string]: unknown }) => string
): string {
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
  const stylesRef = React.useRef<ReturnType<typeof createSettingStyles>>(
    createSettingStyles(theme)
  )
  const themeRef = React.useRef<any>(theme)
  if (themeRef.current !== theme) {
    stylesRef.current = createSettingStyles(theme)
    themeRef.current = theme
  }
  return stylesRef.current
}

export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages)
  const styles = useStyles()
  const sstyles = useSettingStyles()
  const dispatch = useDispatch()

  // Connect to Redux store for repository isolation
  const currentRepository = useSelector((state: IMStateWithFmeExport) => {
    return state?.["fme-state"]?.currentRepository || null
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
    tm_ttc: "setting-tm-ttc",
    tm_ttl: "setting-tm-ttl",
    tm_tag: "setting-tm-tag",
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
  const [localRepository, setLocalRepository] = React.useState<string>(
    () => getStringConfig("repository") || ""
  )
  const [localSupportEmail, setLocalSupportEmail] = React.useState<string>(
    () => getStringConfig("supportEmail") || ""
  )
  const [localSyncMode, setLocalSyncMode] = React.useState<boolean>(() =>
    Boolean((config as any)?.syncMode)
  )
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
      try {
        reposAbortRef.current.abort()
      } catch {}
      reposAbortRef.current = null
    }
  })

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
    if (abortRef.current) {
      try {
        abortRef.current.abort()
      } catch {}
      abortRef.current = null
    }
    abortReposRequest()
  })

  // Comprehensive error processor - returns alert message for bottom display
  const processError = hooks.useEventCallback((err: unknown): string => {
    const code = extractErrorCode(err)
    const status = isFmeFlowApiError(err) ? err.status : extractHttpStatus(err)
    const raw = getErrorMessage(err)

    if (code === "INVALID_RESPONSE_FORMAT") {
      return `${translate("errorInvalidResponse")} ${translate("errorInvalidResponseHelper")}`
    }
    if (code === "REPOSITORIES_ERROR") {
      return `${translate("errorRepositories")} ${translate("errorRepositoriesHelper")}`
    }

    if (typeof status === "number")
      return getStatusErrorMessage(status, translate)
    if (raw.toLowerCase().includes("failed to fetch"))
      return translate("errorNetworkShort")
    return translate("errorGeneric")
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

  // Check if test connection button should be disabled
  const cannotTest = hooks.useEventCallback((): boolean => {
    if (testState.isTesting) return true
    // Only require presence; format issues will be surfaced but not block testing
    return !localServerUrl || !localToken
  })

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
      if (!silent) {
        const message = translate("fixErrorsAbove")
        setTestState({
          status: "error",
          isTesting: false,
          message,
          type: "error",
        })
      }
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
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: undefined,
          token: undefined,
          repository: undefined,
        }))

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

        // Update step states based on error type
        if (error?.type === "server" || error?.type === "network") {
          setCheckSteps((prev) => ({
            ...prev,
            serverUrl: "fail",
            token: "idle",
            repository: "idle",
            version: "",
          }))
          setFieldErrors((prev) => ({
            ...prev,
            serverUrl: translate("errorInvalidServerUrl"),
            token: undefined,
            repository: undefined,
          }))
        } else if (error?.type === "token") {
          setCheckSteps((prev) => ({
            ...prev,
            serverUrl: "ok",
            token: "fail",
            repository: "idle",
            version: "",
          }))
          setFieldErrors((prev) => ({
            ...prev,
            token: translate("errorTokenIsInvalid"),
            serverUrl: undefined,
            repository: undefined,
          }))
        } else if (error?.type === "repository") {
          setCheckSteps((prev) => ({
            ...prev,
            serverUrl: "ok",
            token: "ok",
            repository: "fail",
            version: validationResult.version || "",
          }))
          setFieldErrors((prev) => ({
            ...prev,
            repository: translate("errorRepositoryNotFound"),
            serverUrl: undefined,
            token: undefined,
          }))
          // Still set repositories if available for dropdown
          if (validationResult.repositories) {
            setAvailableRepos(validationResult.repositories)
          }
        }

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

      if (!errorStatus || errorStatus === 0) {
        // Network/connectivity issue
        setCheckSteps((prev) => ({
          ...prev,
          serverUrl: "fail",
          token: "idle",
          repository: "idle",
          version: "",
        }))
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: translate("errorInvalidServerUrl"),
          token: undefined,
          repository: undefined,
        }))
        if (!silent) {
          setTestState({
            status: "error",
            isTesting: false,
            message: translate("errorInvalidServerUrl"),
            type: "error",
          })
        }
      } else {
        // Other server error
        setCheckSteps((prev) => ({
          ...prev,
          serverUrl: "fail",
          token: "idle",
          repository: "idle",
          version: "",
        }))
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: translate("errorInvalidServerUrl"),
          token: undefined,
          repository: undefined,
        }))
        if (!silent) {
          setTestState({
            status: "error",
            isTesting: false,
            message: processError(err),
            type: "error",
          })
        }
      }
    }
  })

  // Enhanced repository refresh for better UX - uses client API directly
  const refreshRepositories = hooks.useEventCallback(async () => {
    if (!localServerUrl || !localToken) {
      return // Cannot refresh without credentials
    }

    // Abort any existing repository request
    abortReposRequest()
    reposAbortRef.current = new AbortController()
    const signal = reposAbortRef.current.signal

    // Sanitize URL
    const settings = validateConnectionSettings()
    if (!settings) {
      return // Invalid settings
    }

    try {
      const client = createFmeFlowClient({
        fmeServerUrl: settings.serverUrl,
        fmeServerToken: settings.token,
        repository: settings.repository || "_",
      })

      const result = await client.getRepositories(signal)
      const repositories =
        result?.data?.map((r) => r.name).filter(Boolean) || []

      if (repositories.length > 0) {
        setAvailableRepos(repositories)
        // Clear any existing repository errors
        setFieldErrors((prev) => ({ ...prev, repository: undefined }))
      } else {
        console.warn("Repository refresh returned empty list")
        // Don't clear existing repos on refresh failure to avoid UX disruption
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return
      console.warn("Repository refresh error:", err)
      // Don't clear existing repos on error to avoid UX disruption
    } finally {
      reposAbortRef.current = null
    }
  })

  // Track initial load to avoid sync loops
  const initialLoadRef = React.useRef(true)

  // Initialize local state only once from config - avoid sync loops
  React.useEffect(() => {
    // Only update if this is the initial config load
    if (initialLoadRef.current) {
      initialLoadRef.current = false

      const configServerUrl = getStringConfig("fmeServerUrl") || ""
      const configToken = getStringConfig("fmeServerToken") || ""
      const configRepository = getStringConfig("repository") || ""
      const configEmail = getStringConfig("supportEmail") || ""
      const configSyncMode = Boolean((config as any)?.syncMode)

      const ttcValue =
        typeof config?.tm_ttc === "number"
          ? String(config.tm_ttc)
          : CONSTANTS.VALIDATION.DEFAULT_TTC_VALUE
      const ttlValue =
        typeof config?.tm_ttl === "number"
          ? String(config.tm_ttl)
          : CONSTANTS.VALIDATION.DEFAULT_TTL_VALUE
      const tagValue = typeof config?.tm_tag === "string" ? config.tm_tag : ""

      // Only update if different from current local state
      if (configServerUrl !== localServerUrl) setLocalServerUrl(configServerUrl)
      if (configToken !== localToken) setLocalToken(configToken)
      if (configRepository !== localRepository)
        setLocalRepository(configRepository)
      if (configEmail !== localSupportEmail) setLocalSupportEmail(configEmail)
      if (configSyncMode !== localSyncMode) setLocalSyncMode(configSyncMode)
      if (ttcValue !== localTmTtc) setLocalTmTtc(ttcValue)
      if (ttlValue !== localTmTtl) setLocalTmTtl(ttlValue)
      if (tagValue !== localTmTag) setLocalTmTag(tagValue)

      // Run initial validation on loaded config values to show errors immediately (no config writes)
      setTimeout(() => {
        const serverUrlError = validateServerUrlKey(configServerUrl)
        const tokenError = validateTokenKey(configToken)
        const emailError = getEmailValidationError(configEmail)

        if (serverUrlError || tokenError || emailError) {
          setFieldErrors((prev) => ({
            ...prev,
            serverUrl: serverUrlError ? translate(serverUrlError) : undefined,
            token: tokenError ? translate(tokenError) : undefined,
            supportEmail: emailError ? translate(emailError) : undefined,
          }))
          // no config write here
        }
      }, 0)
    }
  }, [
    config,
    getStringConfig,
    translate,
    localRepository,
    localServerUrl,
    localSupportEmail,
    localSyncMode,
    localTmTag,
    localTmTtc,
    localTmTtl,
    localToken,
  ])

  // Clear repository state when server URL or token changes significantly
  React.useEffect(() => {
    // Only clear if we have both URL and token, to avoid clearing on initial load
    if (localServerUrl && localToken) {
      // Clear any previous results and cancel in-flight fetches
      clearRepositoryEphemeralState()
    }

    return () => {
      abortReposRequest()
    }
  }, [
    localServerUrl,
    localToken,
    clearRepositoryEphemeralState,
    abortReposRequest,
  ])

  // Handle server URL changes with delayed validation
  const handleServerUrlChange = hooks.useEventCallback((val: string) => {
    setLocalServerUrl(val)

    // Clear previous error immediately for better UX, but don't validate on every keystroke
    setFieldErrors((prev) => ({
      ...prev,
      serverUrl: undefined,
    }))
  })

  // Handle token changes with delayed validation
  const handleTokenChange = hooks.useEventCallback((val: string) => {
    setLocalToken(val)

    // Clear previous error immediately for better UX, but don't validate on every keystroke
    setFieldErrors((prev) => ({
      ...prev,
      token: undefined,
    }))
  })

  // Handle server URL blur - save to config and clear repository state
  const handleServerUrlBlur = hooks.useEventCallback((url: string) => {
    // Validate on blur
    const errKey = validateServerUrlKey(url)
    setFieldErrors((prev) => ({
      ...prev,
      serverUrl: errKey ? translate(errKey) : undefined,
    }))

    // Sanitize and save to config
    const { cleaned, changed } = sanitizeUrl(url)
    updateConfig("fmeServerUrl", changed ? cleaned : url)

    // Update local state if sanitized
    if (changed) {
      setLocalServerUrl(cleaned)
      // Re-validate with the cleaned URL
      const cleanedErrKey = validateServerUrlKey(cleaned)
      setFieldErrors((prev) => ({
        ...prev,
        serverUrl: cleanedErrKey ? translate(cleanedErrKey) : undefined,
      }))
    }

    // Clear repository data when server changes
    clearRepositoryEphemeralState()
  })

  // Handle token blur - save to config and clear repository state
  const handleTokenBlur = hooks.useEventCallback((token: string) => {
    // Validate on blur
    const errKey = validateTokenKey(token)
    setFieldErrors((prev) => ({
      ...prev,
      token: errKey ? translate(errKey) : undefined,
    }))

    // Save to config
    updateConfig("fmeServerToken", token)

    // Clear repository data when token changes
    clearRepositoryEphemeralState()
  })

  // Keep repository field error in sync when either the list or selection changes
  React.useEffect(() => {
    // Only validate repository if we have a connection success and available repos
    if (
      testState.status === "success" &&
      availableRepos?.length &&
      localRepository
    ) {
      const hasRepo = availableRepos.includes(localRepository)
      const errorMessage = hasRepo
        ? undefined
        : translate("errorRepositoryNotFound")
      setFieldErrors((prev) => ({
        ...prev,
        repository: errorMessage,
      }))
      // UI update is enough; avoid config writes here
    } else if (
      testState.status === "success" &&
      availableRepos?.length === 0 &&
      localRepository
    ) {
      // If we have an empty repo list but a selected repository, it might be manually entered
      setFieldErrors((prev) => ({
        ...prev,
        repository: undefined, // Allow manual entry when list is empty
      }))
    }
  }, [availableRepos, localRepository, testState.status, translate])

  // Handle repository changes with workspace state clearing
  const handleRepositoryChange = hooks.useEventCallback(
    (newRepository: string) => {
      const previousRepository = currentRepository

      // Update local state
      setLocalRepository(newRepository)
      updateConfig("repository", newRepository)

      // Clear workspace-related state when switching repositories for isolation
      if (previousRepository !== newRepository) {
        dispatch(fmeActions.clearWorkspaceState(newRepository))
      }

      // Clear repository field error but don't bump config revision for minor changes
      setFieldErrors((prev) => ({ ...prev, repository: undefined }))
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
          cannotTest={cannotTest}
          onTestConnection={() => testConnection(false)}
          translate={translate}
          styles={sstyles}
        />

        {/* Repository selector */}
        <RepositorySelector
          localServerUrl={localServerUrl}
          localToken={localToken}
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
          testState={testState}
        />
        {/* Service mode (sync) toggle */}
        <SettingRow
          flow="no-wrap"
          label={translate("serviceModeSync")}
          level={1}
        >
          <Switch
            id={ID.syncMode}
            checked={localSyncMode}
            onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
              const checked = evt?.target?.checked ?? !localSyncMode
              setLocalSyncMode(checked)
              updateConfig("syncMode", checked)
              // Config change will be detected automatically by the widget
            }}
            aria-label={translate("serviceModeSync")}
          />
        </SettingRow>
        <SettingRow
          flow="wrap"
          css={css(sstyles.ALERT_INLINE as any)}
          level={3}
        >
          {translate("serviceModeSyncHelper")}
        </SettingRow>
        {/* Support email (optional) */}
        <SettingRow
          flow="wrap"
          label={translate("supportEmail")}
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
            <SettingRow flow="wrap" level={3}>
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
          const n = Number(val)
          updateConfig(
            "tm_ttc",
            Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
          )
        }}
        onTmTtlBlur={(val: string) => {
          const n = Number(val)
          updateConfig(
            "tm_ttl",
            Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
          )
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
