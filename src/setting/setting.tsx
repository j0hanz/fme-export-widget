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
  Input,
  Select,
  Tooltip,
  config as uiConfig,
  useStyles,
} from "../runtime/components/ui"
import defaultMessages from "./translations/default"
import FmeFlowApiClient from "../shared/api"
import { isAuthError, getErrorMessage, isValidEmail } from "../shared/utils"
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

// Constants
const CONSTANTS = {
  VALIDATION: {
    MIN_TOKEN_LENGTH: 10,
    DEFAULT_TTL_VALUE: "0",
    DEFAULT_TTC_VALUE: "0",
    IPV4_MIN_OCTET: 0,
    IPV4_MAX_OCTET: 255,
    MIN_CONTROL_CHAR: 32,
    DEL_CHAR_CODE: 127,
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
  PATHS: {
    FME_REST: "/fmerest",
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
  translate,
  styles,
  ID,
  testState,
}) => {
  return (
    <SettingRow
      flow="wrap"
      label={translate("availableRepositories")}
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
            availableRepos && availableRepos.length > 0 ? availableRepos : []

          // Deduplicate options while preserving order
          const seen = new Set<string>()
          const opts: Array<{ label: string; value: string }> = []
          for (const name of src) {
            if (!seen.has(name)) {
              seen.add(name)
              opts.push({ label: name, value: name })
            }
          }
          return opts
        })()}
        value={(() => {
          // Only show current selection if test was successful
          if (testState.status !== "success") return undefined

          const hasValidServer = !validateServerUrl(localServerUrl)
          const hasValidToken = !validateToken(localToken)
          if (!hasValidServer || !hasValidToken) return undefined

          return localRepository || undefined
        })()}
        onChange={(val) => {
          const next =
            typeof val === "string" || typeof val === "number"
              ? String(val)
              : ""
          onRepositoryChange(next)
        }}
        // Disable when connection hasn't been tested successfully
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
        placeholder={
          testState.status === "success"
            ? translate("repoPlaceholder")
            : translate("testConnectionFirst")
        }
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
  fieldErrors,
  translate,
  styles,
  ID,
}) => {
  const renderInputField = (
    id: string,
    label: React.ReactNode,
    value: string,
    onChange: (val: string) => void,
    placeholder?: string,
    inputMode?: "numeric"
  ) => {
    const error = fieldErrors[id as keyof typeof fieldErrors]
    return (
      <SettingRow flow="wrap" label={label} level={1} tag="label">
        <Input
          id={id}
          value={value}
          onChange={onChange}
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
      {renderInputField(
        ID.tm_ttc,
        translate("tm_ttcLabel"),
        localTmTtc,
        onTmTtcChange,
        "0",
        "numeric"
      )}
      {renderInputField(
        ID.tm_ttl,
        translate("tm_ttlLabel"),
        localTmTtl,
        onTmTtlChange,
        "0",
        "numeric"
      )}
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

function getHttpStatus(err: unknown): number | undefined {
  const e = err as { [key: string]: unknown }
  const response = e?.response as { status?: unknown } | undefined
  const candidates = [e?.status, response?.status, e?.httpCode, e?.httpStatus]
  const status = candidates.find((v) => typeof v === "number")

  if (typeof status === "number") return status
  return undefined
}

// HTTP status helpers
const isNotFoundError = (status: number): boolean =>
  status === CONSTANTS.HTTP_STATUS.NOT_FOUND
const isServerError = (status: number): boolean =>
  status >= CONSTANTS.HTTP_STATUS.SERVER_ERROR_MIN &&
  status <= CONSTANTS.HTTP_STATUS.SERVER_ERROR_MAX

// URL validation helpers
const isValidIPv4 = (host: string): boolean => {
  const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/
  if (!ipv4Pattern.test(host)) return false

  return host.split(".").every((octet) => {
    const num = Number(octet)
    return (
      Number.isFinite(num) &&
      num >= CONSTANTS.VALIDATION.IPV4_MIN_OCTET &&
      num <= CONSTANTS.VALIDATION.IPV4_MAX_OCTET
    )
  })
}

const isValidHostname = (host: string): boolean => {
  // Allow localhost, IPv4 addresses, domain names with dots, or FME Flow branded hostnames
  const isLocalhost = host.toLowerCase() === "localhost"
  const isIPv4Address = isValidIPv4(host)
  const hasDomainDot = host.includes(".")
  const isFmeFlowBranded = /fmeflow/i.test(host)

  return isLocalhost || isIPv4Address || hasDomainDot || isFmeFlowBranded
}

const hasForbiddenPaths = (pathname: string): boolean => {
  const lowerPath = pathname.toLowerCase()
  return lowerPath.includes(CONSTANTS.PATHS.FME_REST)
}

// Server URL validation
function validateServerUrl(url: string): string | null {
  const trimmedUrl = url?.trim()

  if (!trimmedUrl) return "errorMissingServerUrl"

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmedUrl)
  } catch {
    return "errorInvalidServerUrl"
  }

  // Validate protocol (only HTTP/HTTPS allowed)
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return "errorInvalidServerUrl"
  }

  // Disallow URLs with embedded credentials
  if (parsedUrl.username || parsedUrl.password) {
    return "errorInvalidServerUrl"
  }

  // Check for forbidden FME-specific paths that should be stripped
  if (hasForbiddenPaths(parsedUrl.pathname)) {
    return "errorBadBaseUrl"
  }

  // Validate hostname/host
  if (!isValidHostname(parsedUrl.hostname)) {
    return "errorInvalidServerUrl"
  }

  return null
}

// Token validation helpers
const hasControlCharacters = (token: string): boolean => {
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)
    if (
      code < CONSTANTS.VALIDATION.MIN_CONTROL_CHAR ||
      code === CONSTANTS.VALIDATION.DEL_CHAR_CODE
    ) {
      return true
    }
  }
  return false
}

const hasProblematicCharacters = (token: string): boolean =>
  /[<>"'`]/.test(token)

const hasWhitespace = (token: string): boolean => /\s/.test(token)

const isTooShort = (token: string): boolean =>
  token.length < CONSTANTS.VALIDATION.MIN_TOKEN_LENGTH

// Token validation
function validateToken(token: string): string | null {
  if (!token) return "errorMissingToken"

  if (hasWhitespace(token) || isTooShort(token)) {
    return "errorTokenIsInvalid"
  }

  if (hasControlCharacters(token)) {
    return "errorTokenIsInvalid"
  }

  if (hasProblematicCharacters(token)) {
    return "errorTokenIsInvalid"
  }

  return null
}

// Repository validation
function validateRepository(
  repository: string,
  availableRepos: string[] | null
): string | null {
  if (availableRepos === null) return null
  if (availableRepos.length > 0 && !repository) return "errorRepoRequired"
  if (
    availableRepos.length > 0 &&
    repository &&
    !availableRepos.includes(repository)
  ) {
    return "errorRepositoryNotFound"
  }
  return null
}

// Email validation
function validateEmail(email: string): string | null {
  if (!email) return null // Optional field
  return isValidEmail(email) ? null : "errorInvalidEmail"
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
  if (isNotFoundError(status)) {
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

  if (isServerError(status)) {
    return translate("errorServer", { status })
  }

  return translate("errorHttpStatus", { status })
}

// Field error mapping types
type FieldErrorResult = Partial<{ serverUrl: string; token: string }>

// Error categorization helpers
const getUrlErrorForStatus = (
  status: number,
  translate: (key: string, params?: { [key: string]: unknown }) => string
): FieldErrorResult => {
  if (status === CONSTANTS.HTTP_STATUS.NOT_FOUND) {
    return { serverUrl: translate("errorNotFound") }
  }
  if (status === CONSTANTS.HTTP_STATUS.NETWORK_ERROR) {
    return { serverUrl: translate("errorNetworkShort") }
  }
  if (
    status === CONSTANTS.HTTP_STATUS.TIMEOUT ||
    status === CONSTANTS.HTTP_STATUS.GATEWAY_TIMEOUT
  ) {
    return { serverUrl: translate("errorTimeout", { status }) }
  }
  if (isServerError(status)) {
    return { serverUrl: translate("errorServer", { status }) }
  }
  return { serverUrl: translate("errorHttpStatus", { status }) }
}

function mapStatusToFieldErrors(
  status: number | undefined,
  translate: (key: string, params?: { [key: string]: unknown }) => string
): FieldErrorResult {
  if (!status) return {}

  if (isAuthError(status)) {
    return { token: translate("errorTokenIsInvalid") }
  }

  return getUrlErrorForStatus(status, translate)
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
  // Stable ref to avoid unnecessary bumps
  const lastBumpedRef = React.useRef<number>(0)
  const bumpConfigRevision = hooks.useEventCallback(() => {
    const now = Date.now()
    const next = now <= lastBumpedRef.current ? lastBumpedRef.current + 1 : now
    lastBumpedRef.current = next
    try {
      updateConfig(
        "configRevision",
        next as unknown as WidgetConfig["configRevision"]
      )
    } catch {}
  })
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
    setFieldErrors((prev) => ({ ...prev, repository: undefined }))
    abortReposRequest()
  })

  // Helper: normalize repositories response to a list of names
  const parseRepositoryNames = (data: unknown): string[] => {
    if (!Array.isArray(data)) return []
    return (data as Array<{ name?: unknown }>)
      .map((r) => r?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
  }

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
    const status = isFmeFlowApiError(err) ? err.status : getHttpStatus(err)
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

  // Utilities: URL validation and sanitization (strip /fmerest)
  const sanitizeUrl = hooks.useEventCallback(
    (rawUrl: string): SanitizationResult => {
      try {
        const trimmed = (rawUrl || "").trim()
        const u = new URL(trimmed)
        let path = u.pathname || "/"
        const lower = path.toLowerCase()
        const idxRest = lower.indexOf(CONSTANTS.PATHS.FME_REST)
        if (idxRest >= 0) path = path.substring(0, idxRest) || "/"
        const cleaned = new URL(u.origin + path).toString().replace(/\/$/, "")
        const changed = cleaned !== trimmed.replace(/\/$/, "") && idxRest >= 0
        return { isValid: true, cleaned, changed, errors: [] }
      } catch {
        return {
          isValid: false,
          cleaned: rawUrl,
          changed: false,
          errors: ["Invalid URL"],
        }
      }
    }
  )

  // Unified input validation
  const validateAllInputs = hooks.useEventCallback(
    (skipRepoCheck = false): ValidationResult => {
      const messages: Partial<FieldErrors> = {}

      const serverUrlError = validateServerUrl(localServerUrl)
      const tokenError = validateToken(localToken)
      const repositoryError = skipRepoCheck
        ? null
        : validateRepository(localRepository, availableRepos)
      const emailError = validateEmail(localSupportEmail)

      if (serverUrlError) messages.serverUrl = translate(serverUrlError)
      if (tokenError) messages.token = translate(tokenError)
      if (repositoryError) messages.repository = translate(repositoryError)
      if (emailError) messages.supportEmail = translate(emailError)

      setFieldErrors({
        serverUrl: messages.serverUrl,
        token: messages.token,
        repository: messages.repository,
        supportEmail: messages.supportEmail,
        tm_ttc: undefined,
        tm_ttl: undefined,
        tm_tag: undefined,
      })

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

  // Centralized Test Connection action (reused by button and auto-run)
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
        // Trigger runtime reload to reflect error UI in widget
        bumpConfigRevision()
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
        // Trigger runtime reload to reflect error UI in widget
        bumpConfigRevision()
      }
      return
    }

    // Reset state for new test (do not clear existing list to keep Select usable)
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
      const client = new FmeFlowApiClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
        repository: settings.repository || "_",
      })

      // 1) Test connection and fetch version info
      let info: any = null
      try {
        info = await client.testConnection(signal)
        setCheckSteps((prev) => ({
          ...prev,
          serverUrl: "ok",
          token: "ok",
          version: String(info?.data?.version || ""),
        }))
      } catch (infoErr) {
        const status = getHttpStatus(infoErr)
        if (
          status === CONSTANTS.HTTP_STATUS.UNAUTHORIZED ||
          status === CONSTANTS.HTTP_STATUS.FORBIDDEN
        ) {
          // Server reachable, but token invalid
          setCheckSteps((prev) => ({ ...prev, serverUrl: "ok", token: "fail" }))
        } else {
          // Server not reachable or other error before token could be validated
          setCheckSteps((prev) => ({
            ...prev,
            serverUrl: "fail",
            token: "skip",
          }))
        }
        // Map field errors and finalize error state
        const fieldErrs = mapStatusToFieldErrors(status, translate)
        if (Object.keys(fieldErrs).length > 0)
          setFieldErrors((prev) => ({ ...prev, ...fieldErrs }))
        if (!silent) {
          setTestState({
            status: "error",
            isTesting: false,
            message: processError(infoErr),
            type: "error",
          })
          // Trigger runtime reload to reflect error UI in widget
          bumpConfigRevision()
        } else {
          setTestState((prev) => ({
            ...prev,
            status: "error",
            isTesting: false,
          }))
        }
        return
      }

      // 2) Fetch repository list
      try {
        const reposResp = await client.getRepositories(signal)
        const names = parseRepositoryNames(reposResp?.data)
        setAvailableRepos(names)
        // Clear repository field error if current selection is valid now
        if (!settings.repository || names.includes(settings.repository)) {
          setFieldErrors((prev) => ({ ...prev, repository: undefined }))
        } else {
          setFieldErrors((prev) => ({
            ...prev,
            repository: translate("errorRepositoryNotFound"),
          }))
          setCheckSteps((prev) => ({ ...prev, repository: "fail" }))
        }
      } catch (repoListErr) {
        // Keep working even if listing fails; surface a warning state below
        setAvailableRepos([])
        // If we cannot list repositories, we still allow testing
        if (settings.repository) {
          setCheckSteps((prev) => ({ ...prev, repository: "fail" }))
        }
      }

      // 3) Validate repository if provided
      try {
        if (settings.repository) {
          await client.validateRepository(settings.repository, signal)
          setCheckSteps((prev) => ({ ...prev, repository: "ok" }))
        } else {
          setCheckSteps((prev) => ({ ...prev, repository: "skip" }))
        }
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: undefined,
          token: undefined,
          repository: undefined,
        }))

        if (!silent) {
          const successHelper = translate("connectionOk")

          setTestState({
            status: "success",
            isTesting: false,
            message: successHelper,
            type: "success",
          })
          // Trigger config update to mark it as changed (for save button)
          try {
            updateConfig(
              "configRevision",
              Date.now() as unknown as WidgetConfig["configRevision"]
            )
          } catch {}
        } else {
          setTestState((prev) => ({ ...prev, isTesting: false }))
        }
      } catch (repoErr) {
        // Do not modify availableRepos to avoid showing a list after test

        if (!silent) {
          setTestState({
            status: "error",
            isTesting: false,
            message: processError(repoErr),
            type: "warning",
          })
          // Trigger runtime reload to reflect error UI in widget
          bumpConfigRevision()
        } else {
          setTestState((prev) => ({
            ...prev,
            status: "error",
            isTesting: false,
          }))
        }

        setFieldErrors((prev) => ({
          ...prev,
          repository: translate("errorRepositories"),
        }))
        setCheckSteps((prev) => ({ ...prev, repository: "fail" }))
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return

      const status = getHttpStatus(err)
      const fieldErrs = mapStatusToFieldErrors(status, translate)
      if (Object.keys(fieldErrs).length > 0)
        setFieldErrors((prev) => ({ ...prev, ...fieldErrs }))

      if (!silent) {
        setTestState({
          status: "error",
          isTesting: false,
          message: processError(err),
          type: "error",
        })
        // Trigger runtime reload to reflect error UI in widget
        bumpConfigRevision()
      } else {
        setTestState((prev) => ({ ...prev, status: "error", isTesting: false }))
      }
    }
  })

  // Save handlers for immediate config updates
  React.useEffect(() => {
    const configUpdates = [
      {
        condition: getStringConfig("repository") !== localRepository,
        update: () => {
          setLocalRepository(getStringConfig("repository") || "")
        },
      },
      {
        condition: getStringConfig("supportEmail") !== localSupportEmail,
        update: () => {
          setLocalSupportEmail(getStringConfig("supportEmail") || "")
        },
      },
      {
        condition: Boolean((config as any)?.syncMode) !== localSyncMode,
        update: () => {
          setLocalSyncMode(Boolean((config as any)?.syncMode))
        },
      },
      {
        condition: getStringConfig("fmeServerUrl") !== localServerUrl,
        update: () => {
          setLocalServerUrl(getStringConfig("fmeServerUrl") || "")
        },
      },
      {
        condition: getStringConfig("fmeServerToken") !== localToken,
        update: () => {
          setLocalToken(getStringConfig("fmeServerToken") || "")
        },
      },
    ]

    configUpdates.forEach(({ condition, update }) => {
      if (condition) update()
    })

    // Handle job directives separately due to type conversion
    const ttcValue =
      typeof config?.tm_ttc === "number"
        ? String(config.tm_ttc)
        : CONSTANTS.VALIDATION.DEFAULT_TTC_VALUE
    const ttlValue =
      typeof config?.tm_ttl === "number"
        ? String(config.tm_ttl)
        : CONSTANTS.VALIDATION.DEFAULT_TTL_VALUE
    const tagValue = typeof config?.tm_tag === "string" ? config.tm_tag : ""

    if (ttcValue !== localTmTtc) setLocalTmTtc(ttcValue)
    if (ttlValue !== localTmTtl) setLocalTmTtl(ttlValue)
    if (tagValue !== localTmTag) setLocalTmTag(tagValue)
  }, [
    config,
    getStringConfig,
    localRepository,
    localSupportEmail,
    localSyncMode,
    localServerUrl,
    localToken,
    localTmTtc,
    localTmTtl,
    localTmTag,
  ])

  // Auto-run connection test when server URL or token changes and are non-empty
  React.useEffect(() => {
    // Clear any previous results and cancel in-flight fetches
    clearRepositoryEphemeralState()

    return () => {
      abortReposRequest()
    }
  }, [
    localServerUrl,
    localToken,
    clearRepositoryEphemeralState,
    abortReposRequest,
  ])

  // Handle server URL changes with immediate validation
  const handleServerUrlChange = hooks.useEventCallback((val: string) => {
    setLocalServerUrl(val)

    // Validate immediately for UI feedback
    const errKey = validateServerUrl(val)
    setFieldErrors((prev) => ({
      ...prev,
      serverUrl: errKey ? translate(errKey) : undefined,
    }))
  })

  // Handle token changes with immediate validation
  const handleTokenChange = hooks.useEventCallback((val: string) => {
    setLocalToken(val)

    // Validate immediately for UI feedback
    const errKey = validateToken(val)
    setFieldErrors((prev) => ({
      ...prev,
      token: errKey ? translate(errKey) : undefined,
    }))
  })

  // Handle server URL blur - save to config and clear repository state
  const handleServerUrlBlur = hooks.useEventCallback((url: string) => {
    // Sanitize and save to config
    const { cleaned, changed } = sanitizeUrl(url)
    updateConfig("fmeServerUrl", changed ? cleaned : url)

    // Update local state if sanitized
    if (changed) {
      setLocalServerUrl(cleaned)
      // Re-validate with the cleaned URL
      const errKey = validateServerUrl(cleaned)
      setFieldErrors((prev) => ({
        ...prev,
        serverUrl: errKey ? translate(errKey) : undefined,
      }))
    }

    // Clear repository data when server changes
    clearRepositoryEphemeralState()
  })

  // Handle token blur - save to config and clear repository state
  const handleTokenBlur = hooks.useEventCallback((token: string) => {
    // Save to config
    updateConfig("fmeServerToken", token)

    // Clear repository data when token changes
    clearRepositoryEphemeralState()
  })

  // Keep repository field error in sync when either the list or selection changes
  React.useEffect(() => {
    if (!availableRepos?.length || !localRepository) return

    const hasRepo = availableRepos.includes(localRepository)
    setFieldErrors((prev) => ({
      ...prev,
      repository: hasRepo ? undefined : translate("errorRepositoryNotFound"),
    }))
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
        dispatch(fmeActions.clearWorkspaceState(newRepository))
      }

      // Clear repository field error and trigger config revision
      setFieldErrors((prev) => ({ ...prev, repository: undefined }))
      bumpConfigRevision()
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
          validateServerUrl={validateServerUrl}
          validateToken={validateToken}
          onRepositoryChange={handleRepositoryChange}
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
              // Trigger runtime reload when sync mode changes
              bumpConfigRevision()
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
              updateConfig("supportEmail", val)
              const errKey = validateEmail(val)
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
          const n = Number(val)
          updateConfig(
            "tm_ttc",
            Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
          )
        }}
        onTmTtlChange={(val: string) => {
          setLocalTmTtl(val)
          const n = Number(val)
          updateConfig(
            "tm_ttl",
            Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
          )
        }}
        onTmTagChange={(val: string) => {
          setLocalTmTag(val)
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
