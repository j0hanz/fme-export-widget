/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
import { useTheme } from "jimu-theme"
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
import type {
  WidgetConfig,
  IMWidgetConfig,
  ConnectionSettings,
  TestState,
} from "../shared/types"
import { FmeFlowApiError } from "../shared/types"

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

// Module-level status checkers
const isNotFoundError = (status: number): boolean => status === 404
const isServerError = (status: number): boolean => status >= 500 && status < 600

// Helper functions for URL validation
const isValidIPv4 = (host: string): boolean => {
  const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/
  if (!ipv4Pattern.test(host)) return false

  return host.split(".").every((octet) => {
    const num = Number(octet)
    return Number.isFinite(num) && num >= 0 && num <= 255
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
  return lowerPath.includes("/fmerest") || lowerPath.includes("/fmeserver")
}

// Validation functions for server URL, token, and repository
function validateServerUrl(url: string): string | null {
  const trimmedUrl = url?.trim()

  // Check for empty or missing URL
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

function validateToken(token: string): string | null {
  if (!token) return "errorMissingToken"
  if (/\s/.test(token) || token.length < 10) return "errorTokenIsInvalid"
  return null
}

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

// Centralized email validation (returns i18n key or null)
function validateEmail(email: string): string | null {
  if (!email) return null // Optional field
  return isValidEmail(email) ? null : "errorInvalidEmail"
}

const STATUS_ERROR_MAP: { readonly [status: number]: string } = {
  401: "errorUnauthorized",
  403: "errorUnauthorized",
  404: "errorNotFound",
  400: "errorBadRequest",
  408: "errorTimeout",
  504: "errorTimeout",
  429: "errorTooManyRequests",
  502: "errorGateway",
  503: "errorServiceUnavailable",
  0: "errorNetworkShort",
}

function getStatusErrorMessage(
  status: number,
  translate: (key: string, params?: { [key: string]: unknown }) => string
): string {
  const errorKey = STATUS_ERROR_MAP[status]

  if (errorKey) {
    if (status === 0) {
      return translate(errorKey)
    }
    if (isAuthError(status)) {
      return `${translate(errorKey, { status })} ${translate("errorUnauthorizedHelper")}`
    }
    if (isNotFoundError(status)) {
      return `${translate(errorKey, { status })} ${translate("errorNotFoundHelper")}`
    }
    return translate(errorKey, { status })
  }

  if (isServerError(status)) {
    return translate("errorServer", { status })
  }

  return translate("errorHttpStatus", { status })
}

function mapStatusToFieldErrors(
  status: number | undefined,
  translate: (key: string, params?: { [key: string]: unknown }) => string
): Partial<{ serverUrl: string; token: string }> {
  if (!status) return {}

  if (isAuthError(status)) {
    return { token: translate("errorTokenIsInvalid") }
  }
  if (status === 404 || status === 0) {
    const key = status === 404 ? "errorNotFound" : "errorNetworkShort"
    return { serverUrl: translate(key) }
  }
  if (status === 408 || status === 504) {
    return { serverUrl: translate("errorTimeout", { status }) }
  }
  if (isServerError(status)) {
    return { serverUrl: translate("errorServer", { status }) }
  }

  return { serverUrl: translate("errorHttpStatus", { status }) }
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
        backgroundColor: "#181818",
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
      } as { [k: string]: any },
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
    isTesting: false,
    message: null,
    type: "info",
  })
  // Fine-grained step status for the connection test UI
  type StepStatus = "idle" | "pending" | "ok" | "fail" | "skip"
  const [checkSteps, setCheckSteps] = React.useState<{
    serverUrl: StepStatus
    token: StepStatus
    repository: StepStatus
    version?: string
  }>({ serverUrl: "idle", token: "idle", repository: "idle", version: "" })
  const [fieldErrors, setFieldErrors] = React.useState<{
    serverUrl?: string
    token?: string
    repository?: string
    supportEmail?: string
    tm_ttc?: string
    tm_ttl?: string
    tm_tag?: string
  }>({})
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
    return typeof v === "number" ? String(v) : "0"
  })
  const [localTmTtl, setLocalTmTtl] = React.useState<string>(() => {
    const v = (config as any)?.tm_ttl
    return typeof v === "number" ? String(v) : "0"
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

  // Utilities: URL validation and sanitization (strip /fmeserver or /fmerest)
  const sanitizeUrl = hooks.useEventCallback(
    (rawUrl: string): { cleaned: string; changed: boolean } => {
      try {
        const trimmed = (rawUrl || "").trim()
        const u = new URL(trimmed)
        let path = u.pathname || "/"
        const lower = path.toLowerCase()
        const idxServer = lower.indexOf("/fmeserver")
        const idxRest = lower.indexOf("/fmerest")
        if (idxServer >= 0) path = path.substring(0, idxServer) || "/"
        else if (idxRest >= 0) path = path.substring(0, idxRest) || "/"
        const cleaned = new URL(u.origin + path).toString().replace(/\/$/, "")
        const changed =
          cleaned !== trimmed.replace(/\/$/, "") &&
          (idxServer >= 0 || idxRest >= 0)
        return { cleaned, changed }
      } catch {
        return { cleaned: rawUrl, changed: false }
      }
    }
  )

  // Unified input validation
  const validateAllInputs = hooks.useEventCallback((skipRepoCheck = false) => {
    const messages: Partial<{
      serverUrl: string
      token: string
      repository: string
      supportEmail: string
      tm_ttc: string
      tm_ttl: string
    }> = {}

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
  })

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
        setTestState({ isTesting: false, message, type: "error" })
      }
      return
    }

    // Populate field errors for the UI (non-blocking) and sanitize URL
    validateAllInputs(true)
    const settings = validateConnectionSettings()
    if (!settings) {
      if (!silent) {
        setTestState({
          isTesting: false,
          message: translate("fixErrorsAbove"),
          type: "error",
        })
      }
      return
    }

    // Reset state for new test (do not clear existing list to keep Select usable)
    setTestState({
      isTesting: true,
      message: silent ? null : translate("testingConnection"),
      type: "info",
    })
    setCheckSteps({
      serverUrl: "pending",
      token: "pending",
      repository: (settings.repository ? "pending" : "skip") as StepStatus,
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
        if (status === 401 || status === 403) {
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
            isTesting: false,
            message: processError(infoErr),
            type: "error",
          })
        } else {
          setTestState((prev) => ({ ...prev, isTesting: false }))
        }
        return
      }

      // 2) Fetch repository list
      try {
        const reposResp = await client.getRepositories(signal)
        const names = Array.isArray(reposResp?.data)
          ? (reposResp.data as Array<{ name: string }>)
              .map((r) => r?.name)
              .filter((n): n is string => typeof n === "string" && n.length > 0)
          : []
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
            isTesting: false,
            message: successHelper,
            type: "success",
          })
        } else {
          setTestState((prev) => ({ ...prev, isTesting: false }))
        }
      } catch (repoErr) {
        // Do not modify availableRepos to avoid showing a list after test

        if (!silent) {
          setTestState({
            isTesting: false,
            message: processError(repoErr),
            type: "warning",
          })
        } else {
          setTestState((prev) => ({ ...prev, isTesting: false }))
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
          isTesting: false,
          message: processError(err),
          type: "error",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
    }
  })

  // Cleanup: abort any in-flight requests on unmount
  React.useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      if (reposAbortRef.current) {
        reposAbortRef.current.abort()
        reposAbortRef.current = null
      }
    }
  }, [])

  // Keep server URL, token, repository, and support email in sync with config
  React.useEffect(() => {
    const updates: Array<[() => boolean, () => void]> = [
      [
        () => getStringConfig("repository") !== localRepository,
        () => {
          setLocalRepository(getStringConfig("repository") || "")
        },
      ],
      [
        () => getStringConfig("supportEmail") !== localSupportEmail,
        () => {
          setLocalSupportEmail(getStringConfig("supportEmail") || "")
        },
      ],
      [
        () => Boolean((config as any)?.syncMode) !== localSyncMode,
        () => {
          setLocalSyncMode(Boolean((config as any)?.syncMode))
        },
      ],
      [
        () => getStringConfig("fmeServerUrl") !== localServerUrl,
        () => {
          setLocalServerUrl(getStringConfig("fmeServerUrl") || "")
        },
      ],
      [
        () => getStringConfig("fmeServerToken") !== localToken,
        () => {
          setLocalToken(getStringConfig("fmeServerToken") || "")
        },
      ],
    ]

    updates.forEach(([needsUpdate, update]) => {
      if (needsUpdate()) update()
    })

    // Handle job directives separately due to type conversion
    const ttcValue =
      typeof config?.tm_ttc === "number" ? String(config.tm_ttc) : "0"
    const ttlValue =
      typeof config?.tm_ttl === "number" ? String(config.tm_ttl) : "0"
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

  // Fetch repository list when server URL or token changes
  React.useEffect(() => {
    setAvailableRepos(null)
    if (reposAbortRef.current) {
      reposAbortRef.current.abort()
      reposAbortRef.current = null
    }

    const serverUrlError = validateServerUrl(localServerUrl)
    const tokenError = validateToken(localToken)
    if (!localServerUrl || !localToken || serverUrlError || tokenError) return

    const controller = new AbortController()
    reposAbortRef.current = controller

    const client = new FmeFlowApiClient({
      serverUrl: localServerUrl,
      token: localToken,
      repository: localRepository || "_",
    })

    client
      .getRepositories(controller.signal)
      .then((resp) => {
        if (controller.signal.aborted) return
        const names = Array.isArray(resp?.data)
          ? (resp.data as Array<{ name: string }>)
              .map((r) => r?.name)
              .filter((n): n is string => typeof n === "string" && n.length > 0)
          : []
        setAvailableRepos(names)

        if (
          localRepository &&
          names.length &&
          !names.includes(localRepository)
        ) {
          setFieldErrors((prev) => ({
            ...prev,
            repository: translate("errorRepositoryNotFound"),
          }))
        } else {
          setFieldErrors((prev) => ({ ...prev, repository: undefined }))
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setAvailableRepos([])
        const status = getHttpStatus(err)
        const fieldErrs = mapStatusToFieldErrors(status, translate)
        if (Object.keys(fieldErrs).length > 0) {
          setFieldErrors((prev) => ({ ...prev, ...fieldErrs }))
        }
      })

    return () => {
      if (reposAbortRef.current) {
        reposAbortRef.current.abort()
        reposAbortRef.current = null
      }
    }
  }, [localServerUrl, localToken, localRepository, translate])

  // Keep repository field error in sync when either the list or selection changes
  React.useEffect(() => {
    if (!availableRepos?.length || !localRepository) return

    const hasRepo = availableRepos.includes(localRepository)
    setFieldErrors((prev) => ({
      ...prev,
      repository: hasRepo ? undefined : translate("errorRepositoryNotFound"),
    }))
  }, [availableRepos, localRepository, translate])

  // Helper for rendering input fields with error alerts
  const renderInputField = hooks.useEventCallback(
    ({
      id,
      label,
      value,
      onChange,
      placeholder,
      type = "text",
      required = false,
      inputMode,
    }: {
      id: string
      label: React.ReactNode
      value: string
      onChange: (val: string) => void
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

  const renderConnectionStatus = (): React.ReactNode => {
    const rows: Array<{ label: string; status: StepStatus }> = [
      { label: translate("fmeServerUrl"), status: checkSteps.serverUrl },
      { label: translate("fmeServerToken"), status: checkSteps.token },
      { label: translate("fmeRepository"), status: checkSteps.repository },
    ]

    // Map step -> icon and color style
    const getStatusIcon = (s: StepStatus): { color: unknown } => {
      switch (s) {
        case "ok":
          return { color: sstyles.STATUS.COLOR.OK }
        case "fail":
          return { color: sstyles.STATUS.COLOR.FAIL }
        case "skip":
          return { color: sstyles.STATUS.COLOR.SKIP }
        case "pending":
        case "idle":
          return { color: sstyles.STATUS.COLOR.PENDING }
      }
    }

    const StatusRow = ({
      label,
      status,
    }: {
      label: string
      status: StepStatus
    }) => {
      const { color } = getStatusIcon(status)
      return (
        <div css={css(sstyles.STATUS.ROW as any)}>
          <div css={css(sstyles.STATUS.LABEL_GROUP as any)}>
            <>
              {label}
              {translate("colon")}
            </>
          </div>
          <div css={css(color as any)}>
            {status === "ok"
              ? translate("ok")
              : status === "fail"
                ? translate("failed")
                : status === "skip"
                  ? translate("skipped")
                  : translate("checking")}
          </div>
        </div>
      )
    }

    return (
      <div
        css={css(sstyles.STATUS.CONTAINER as any)}
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

        <div css={css(sstyles.STATUS.LIST as any)}>
          {rows.map((r) => (
            <StatusRow key={r.label} label={r.label} status={r.status} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <SettingSection>
        <SettingRow flow="wrap" level={1} label={translate("mapConfiguration")}>
          <MapWidgetSelector
            useMapWidgetIds={useMapWidgetIds}
            onSelect={onMapWidgetSelected}
          />
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
            onChange={(val) => {
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
      <SettingSection>
        {/* FME Server URL */}
        {renderInputField({
          id: ID.serverUrl,
          label: renderRequiredLabel(translate("fmeServerUrl")),
          value: localServerUrl,
          onChange: (val: string) => {
            setLocalServerUrl(val)
            // Sanitize immediately on change to keep config clean (strip /fmeserver or /fmerest)
            const { cleaned, changed } = sanitizeUrl(val)
            updateConfig("fmeServerUrl", changed ? cleaned : val)
            // Validate immediately to surface inline error under the field
            const errKey = validateServerUrl(val)
            setFieldErrors((prev) => ({
              ...prev,
              serverUrl: errKey ? translate(errKey) : undefined,
            }))
          },
          placeholder: translate("serverUrlPlaceholder"),
          required: true,
        })}
        {/* FME Server Token */}
        {renderInputField({
          id: ID.token,
          label: renderRequiredLabel(translate("fmeServerToken")),
          value: localToken,
          onChange: (val: string) => {
            setLocalToken(val)
            updateConfig("fmeServerToken", val)
            // Validate immediately to surface inline error under the field
            const errKey = validateToken(val)
            setFieldErrors((prev) => ({
              ...prev,
              token: errKey ? translate(errKey) : undefined,
            }))
          },
          placeholder: translate("tokenPlaceholder"),
          type: "password",
          required: true,
        })}
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
            onClick={() => testConnection(false)}
          />
        </SettingRow>
        {(testState.isTesting || testState.message) && (
          <SettingRow flow="wrap" level={3}>
            {renderConnectionStatus()}
          </SettingRow>
        )}
        {/* Available repositories */}
        <SettingRow
          flow="wrap"
          label={translate("availableRepositories")}
          level={1}
          tag="label"
        >
          <Select
            options={(() => {
              // Use availableRepos if populated; otherwise, if not yet loaded, use current value if any
              const src =
                availableRepos && availableRepos.length > 0
                  ? availableRepos
                  : localRepository
                    ? [localRepository]
                    : []
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
            value={localRepository || undefined}
            onChange={(val) => {
              const next = String(val ?? "")
              setLocalRepository(next)
              updateConfig("repository", next)
              const error = validateRepository(val as string, availableRepos)
              setFieldErrors((prev) => ({
                ...prev,
                repository: error ? translate(error) : undefined,
              }))
            }}
            disabled={testState.isTesting || availableRepos === null}
            aria-describedby={
              fieldErrors.repository ? `${ID.repository}-error` : undefined
            }
            aria-invalid={fieldErrors.repository ? true : undefined}
            placeholder={"---"}
          />
          {fieldErrors.repository && (
            <SettingRow flow="wrap" level={3}>
              <Alert
                id={`${ID.repository}-error`}
                fullWidth
                css={css(sstyles.ALERT_INLINE as any)}
                text={fieldErrors.repository}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
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
      </SettingSection>
      <SettingSection>
        {/* Job directives (admin defaults) */}
        {renderInputField({
          id: ID.tm_ttc,
          label: translate("tm_ttcLabel"),
          value: localTmTtc,
          onChange: (val: string) => {
            setLocalTmTtc(val)
            const n = Number(val)
            updateConfig(
              "tm_ttc",
              Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
            )
          },
          placeholder: "0",
          inputMode: "numeric",
        })}
        {renderInputField({
          id: ID.tm_ttl,
          label: translate("tm_ttlLabel"),
          value: localTmTtl,
          onChange: (val: string) => {
            setLocalTmTtl(val)
            const n = Number(val)
            updateConfig(
              "tm_ttl",
              Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
            )
          },
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
            onChange={(val) => {
              setLocalTmTag(val)
              updateConfig("tm_tag", val)
            }}
            placeholder={translate("tm_tagPlaceholder")}
            errorText={fieldErrors.tm_tag}
          />
          {fieldErrors.tm_tag && (
            <SettingRow flow="wrap" level={3}>
              <Alert
                id={`${ID.tm_tag}-error`}
                fullWidth
                css={css(sstyles.ALERT_INLINE as any)}
                text={fieldErrors.tm_tag}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
        <SettingRow
          flow="wrap"
          css={css(sstyles.ALERT_INLINE as any)}
          level={3}
        >
          {translate("jobDirectivesHelper")}
        </SettingRow>
      </SettingSection>
    </>
  )
}
