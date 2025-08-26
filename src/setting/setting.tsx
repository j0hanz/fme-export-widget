/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
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
  required,
  config as uiConfig,
} from "../runtime/components/ui"
import defaultMessages from "./translations/default"
import FmeFlowApiClient from "../shared/api"
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

// Narrowing helpers to avoid any and centralize safe access
function hasMessage(x: unknown): x is { message?: unknown } {
  return typeof x === "object" && x !== null && "message" in x
}

function getErrorMessage(err: unknown): string {
  if (
    hasMessage(err) &&
    (typeof err.message === "string" || typeof err.message === "number")
  ) {
    return String(err.message)
  }
  return ""
}

function extractErrorCode(err: unknown): string {
  if (isFmeFlowApiError(err)) return err.code || ""
  const code = (err as { [key: string]: unknown })?.code
  return typeof code === "string" ? code : ""
}

function getHttpStatus(err: unknown): number | undefined {
  const e = err as { [key: string]: unknown }
  const response = e?.response as { status?: unknown } | undefined
  const candidates: unknown[] = [
    e?.status,
    response?.status,
    e?.httpCode,
    e?.httpStatus,
  ]
  const rawStatus = candidates.find((v) => typeof v === "number")
  if (typeof rawStatus === "number") return rawStatus

  // Fallback: attempt to parse from message text
  const msg = getErrorMessage(err)
  const statusMatch =
    msg.match(/status:\s*(\d{3})/i) ||
    msg.match(
      /\b(\d{3})\s*\((?:Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error|Service Unavailable|Gateway)/i
    ) ||
    msg.match(/\b(\d{3})\b/)
  const code = statusMatch ? parseInt(statusMatch[1], 10) : undefined
  return Number.isFinite(code) ? code : undefined
}

// Module-level status checkers
const isAuthError = (status: number): boolean =>
  status === 401 || status === 403
const isNotFoundError = (status: number): boolean => status === 404
const isServerError = (status: number): boolean => status >= 500 && status < 600

// Validation functions for server URL, token, and repository
function validateServerUrl(url: string): string | null {
  if (!url?.trim()) return "errorMissingServerUrl"

  try {
    const u = new URL(url.trim())
    if (!/^https?:$/i.test(u.protocol)) return "errorInvalidServerUrl"
    if (/\/fmerest\b/i.test(u.pathname) || /\/fmeserver\b/i.test(u.pathname))
      return "errorBadBaseUrl"
    return null
  } catch {
    return "errorInvalidServerUrl"
  }
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
  if (!email) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "errorInvalidEmail"
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
  if (status === undefined) return {}

  const errorHandlers: {
    [key: number]: () => Partial<{ serverUrl: string; token: string }>
  } = {
    401: () => ({ token: translate("errorTokenIsInvalid") }),
    403: () => ({ token: translate("errorTokenIsInvalid") }),
    404: () => ({ serverUrl: translate("errorNotFound") }),
    0: () => ({ serverUrl: translate("errorNetworkShort") }),
    408: () => ({ serverUrl: translate("errorTimeout", { status }) }),
    504: () => ({ serverUrl: translate("errorTimeout", { status }) }),
  }

  const handler = errorHandlers[status]
  if (handler) return handler()

  if (isServerError(status)) {
    return { serverUrl: translate("errorServer", { status }) }
  }

  return typeof status === "number"
    ? { serverUrl: translate("errorHttpStatus", { status }) }
    : {}
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

// Local CSS styles for the setting UI
const CSS = {
  ALERT_INLINE: {
    opacity: 0.8,
  } as React.CSSProperties,
  STATUS: {
    CONTAINER: {
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    } as React.CSSProperties,
    LIST: {
      display: "grid",
      rowGap: 6,
      opacity: 0.8,
      backgroundColor: "#181818",
      padding: 6,
      borderRadius: 2,
    } as React.CSSProperties,
    ROW: {
      display: "flex",
      justifyContent: "space-between",
      lineHeight: 2,
    } as React.CSSProperties,
    LABEL_GROUP: {
      display: "flex",
      alignItems: "center",
    } as React.CSSProperties,
    COLOR: {
      OK: { color: "#09cf74" },
      FAIL: { color: "#e1001b" },
      SKIP: { color: "#ffea1d" },
      PENDING: { color: "#089bdc" },
    } as { [k: string]: React.CSSProperties },
  },
} as const

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

export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages)
  const getStringConfig = useStringConfigValue(config)
  const updateConfig = useUpdateConfig(id, config, onSettingChange)
  // Stable element IDs for a11y wiring (avoid useMemo per repo guidance)
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
            css={required}
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
    const serverUrl = localServerUrl
    const token = localToken
    const repository = localRepository
    const supportEmail = localSupportEmail
    const tmTtc = localTmTtc
    const tmTtl = localTmTtl

    const messages: Partial<{
      serverUrl: string
      token: string
      repository: string
      supportEmail: string
      tm_ttc: string
      tm_ttl: string
      tm_tag: string
    }> = {}

    // Validate and sanitize inputs
    const serverUrlError = validateServerUrl(serverUrl)
    const tokenError = validateToken(token)
    const repositoryError = skipRepoCheck
      ? null
      : validateRepository(repository, availableRepos)
    const emailError = validateEmail(supportEmail)
    // Simple integer >= 0 validation; empty allowed (treated as 0)
    const toInt = (s: string) => {
      const n = Number(s)
      return Number.isFinite(n) ? Math.floor(n) : NaN
    }
    const intErr = (v: string) =>
      v.trim() === ""
        ? null
        : toInt(v) < 0 || !Number.isFinite(toInt(v))
          ? "requiredField"
          : null
    const ttcErrKey = intErr(tmTtc)
    const ttlErrKey = intErr(tmTtl)
    const tagErrKey = null // allow any non-empty string

    if (serverUrlError) messages.serverUrl = translate(serverUrlError)
    if (tokenError) messages.token = translate(tokenError)
    if (repositoryError) messages.repository = translate(repositoryError)
    if (emailError) messages.supportEmail = translate(emailError)
    if (ttcErrKey) (messages as any).tm_ttc = translate(ttcErrKey)
    if (ttlErrKey) (messages as any).tm_ttl = translate(ttlErrKey)
    if (tagErrKey) (messages as any).tm_tag = translate(tagErrKey)

    // Update local field errors for UI highlighting
    setFieldErrors({
      serverUrl: messages.serverUrl,
      token: messages.token,
      repository: messages.repository,
      supportEmail: messages.supportEmail,
      tm_ttc: (messages as any).tm_ttc,
      tm_ttl: (messages as any).tm_ttl,
      tm_tag: (messages as any).tm_tag,
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
    const repo = getStringConfig("repository") || ""
    if (repo !== localRepository) setLocalRepository(repo)
    const se = getStringConfig("supportEmail") || ""
    if (se !== localSupportEmail) setLocalSupportEmail(se)
    const sm = Boolean((config as any)?.syncMode)
    if (sm !== localSyncMode) setLocalSyncMode(sm)
    // Keep server URL and token in sync
    const su = getStringConfig("fmeServerUrl") || ""
    if (su !== localServerUrl) setLocalServerUrl(su)
    const tk = getStringConfig("fmeServerToken") || ""
    if (tk !== localToken) setLocalToken(tk)
    // sync directives (coerce to string; defaults shown as 0/empty)
    const cfgTtc = config?.tm_ttc
    const cfgTtl = config?.tm_ttl
    const cfgTag = config?.tm_tag
    const nextTtc = typeof cfgTtc === "number" ? String(cfgTtc) : "0"
    const nextTtl = typeof cfgTtl === "number" ? String(cfgTtl) : "0"
    const nextTag = typeof cfgTag === "string" ? cfgTag : ""
    if (nextTtc !== localTmTtc) setLocalTmTtc(nextTtc)
    if (nextTtl !== localTmTtl) setLocalTmTtl(nextTtl)
    if (nextTag !== localTmTag) setLocalTmTag(nextTag)
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
    // Clear any previous values
    setAvailableRepos(null)
    // Cancel previous fetch if any
    if (reposAbortRef.current) {
      reposAbortRef.current.abort()
      reposAbortRef.current = null
    }

    const serverUrl = localServerUrl
    const token = localToken
    const serverUrlError = validateServerUrl(serverUrl)
    const tokenError = validateToken(token)
    // Do not fetch repositories if server URL or token are invalid
    if (!serverUrl || !token || serverUrlError || tokenError) return

    const controller = new AbortController()
    reposAbortRef.current = controller
    const signal = controller.signal

    const client = new FmeFlowApiClient({
      serverUrl,
      token,
      repository: localRepository || "_",
    })

    client
      .getRepositories(signal)
      .then((resp) => {
        if (signal.aborted) return
        const names = Array.isArray(resp?.data)
          ? (resp.data as Array<{ name: string }>)
              .map((r) => r?.name)
              .filter((n): n is string => typeof n === "string" && n.length > 0)
          : []
        setAvailableRepos(names)
        const currentRepo = localRepository
        if (currentRepo && names.length && !names.includes(currentRepo)) {
          setFieldErrors((prev) => ({
            ...prev,
            repository: translate("errorRepositoryNotFound"),
          }))
        } else {
          setFieldErrors((prev) => ({ ...prev, repository: undefined }))
        }
      })
      .catch((err) => {
        if (signal.aborted) return
        // If we cannot list repositories, clear the list
        setAvailableRepos([])
        const status = getHttpStatus(err)
        const fieldErrs = mapStatusToFieldErrors(status, translate)
        if (Object.keys(fieldErrs).length > 0)
          setFieldErrors((prev) => ({ ...prev, ...fieldErrs }))
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
    if (!availableRepos || availableRepos.length === 0) return
    const currentRepo = localRepository
    if (currentRepo && !availableRepos.includes(currentRepo)) {
      setFieldErrors((prev) => ({
        ...prev,
        repository: translate("errorRepositoryNotFound"),
      }))
    } else {
      setFieldErrors((prev) => ({ ...prev, repository: undefined }))
    }
  }, [availableRepos, localRepository, translate])

  const renderConnectionStatus = (): React.ReactNode => {
    const rows: Array<{ label: string; status: StepStatus }> = [
      { label: translate("fmeServerUrl"), status: checkSteps.serverUrl },
      { label: translate("fmeServerToken"), status: checkSteps.token },
      { label: translate("fmeRepository"), status: checkSteps.repository },
    ]

    // Map step -> icon and color style
    const getStatusIcon = (s: StepStatus): { color: React.CSSProperties } => {
      switch (s) {
        case "ok":
          return { color: CSS.STATUS.COLOR.OK }
        case "fail":
          return { color: CSS.STATUS.COLOR.FAIL }
        case "skip":
          return { color: CSS.STATUS.COLOR.SKIP }
        case "pending":
        case "idle":
          return { color: CSS.STATUS.COLOR.PENDING }
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
        <div css={css(CSS.STATUS.ROW as any)}>
          <div css={css(CSS.STATUS.LABEL_GROUP as any)}>
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
      <div css={css(CSS.STATUS.CONTAINER as any)}>
        {testState.isTesting && (
          <Loading
            type={LoadingType.Bar}
            text={translate("testingConnection")}
          />
        )}

        <div css={css(CSS.STATUS.LIST as any)}>
          {rows.map((r) => (
            <StatusRow key={r.label} label={r.label} status={r.status} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <SettingSection title={translate("mapConfiguration")}>
        <SettingRow level={1}>
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
                css={css(CSS.ALERT_INLINE as any)}
                text={translate("errorInvalidEmail")}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
      </SettingSection>
      <SettingSection title={translate("fmeServerConfig")}>
        {/* FME Server URL */}
        <SettingRow
          flow="wrap"
          label={renderRequiredLabel(translate("fmeServerUrl"))}
          level={1}
          tag="label"
        >
          <Input
            id={ID.serverUrl}
            required
            value={localServerUrl}
            onChange={(val) => {
              setLocalServerUrl(val)
              updateConfig("fmeServerUrl", val)
            }}
            placeholder={translate("serverUrlPlaceholder")}
            errorText={fieldErrors.serverUrl}
          />
          {fieldErrors.serverUrl && (
            <SettingRow flow="wrap" level={3}>
              <Alert
                id={`${ID.serverUrl}-error`}
                fullWidth
                css={css(CSS.ALERT_INLINE as any)}
                text={fieldErrors.serverUrl}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
        {/* FME Server Token */}
        <SettingRow
          flow="wrap"
          label={renderRequiredLabel(translate("fmeServerToken"))}
          level={1}
          tag="label"
        >
          <Input
            id={ID.token}
            type="password"
            required
            value={localToken}
            onChange={(val) => {
              setLocalToken(val)
              updateConfig("fmeServerToken", val)
            }}
            placeholder={translate("tokenPlaceholder")}
            errorText={fieldErrors.token}
          />
          {fieldErrors.token && (
            <SettingRow flow="wrap" level={3}>
              <Alert
                id={`${ID.token}-error`}
                fullWidth
                css={css(CSS.ALERT_INLINE as any)}
                text={fieldErrors.token}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
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
        {testState.message && (
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
            ariaDescribedBy={ID.repository}
            placeholder={"---"}
          />
          {fieldErrors.repository && (
            <SettingRow flow="wrap" level={3}>
              <Alert
                id={`${ID.repository}-error`}
                fullWidth
                css={css(CSS.ALERT_INLINE as any)}
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
        <SettingRow flow="wrap" css={css(CSS.ALERT_INLINE as any)} level={3}>
          {translate("serviceModeSyncHelper")}
        </SettingRow>
      </SettingSection>
      <SettingSection title={translate("jobDirectives")}>
        {/* Job directives (admin defaults) */}
        <SettingRow
          flow="wrap"
          label={translate("tm_ttcLabel")}
          level={1}
          tag="label"
        >
          <Input
            id={ID.tm_ttc}
            value={localTmTtc}
            onChange={(val) => {
              setLocalTmTtc(val)
              const n = Number(val)
              updateConfig(
                "tm_ttc",
                Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
              )
            }}
            placeholder={"0"}
            errorText={fieldErrors.tm_ttc}
            inputMode="numeric"
          />
          {fieldErrors.tm_ttc && (
            <SettingRow flow="wrap" level={3}>
              <Alert
                id={`${ID.tm_ttc}-error`}
                fullWidth
                css={css(CSS.ALERT_INLINE as any)}
                text={fieldErrors.tm_ttc}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
        <SettingRow
          flow="wrap"
          label={translate("tm_ttlLabel")}
          level={1}
          tag="label"
        >
          <Input
            id={ID.tm_ttl}
            value={localTmTtl}
            onChange={(val) => {
              setLocalTmTtl(val)
              const n = Number(val)
              updateConfig(
                "tm_ttl",
                Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
              )
            }}
            placeholder={"0"}
            errorText={fieldErrors.tm_ttl}
            inputMode="numeric"
          />
          {fieldErrors.tm_ttl && (
            <SettingRow flow="wrap" level={3}>
              <Alert
                id={`${ID.tm_ttl}-error`}
                fullWidth
                css={css(CSS.ALERT_INLINE as any)}
                text={fieldErrors.tm_ttl}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
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
                css={css(CSS.ALERT_INLINE as any)}
                text={fieldErrors.tm_tag}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
        <SettingRow flow="wrap" css={css(CSS.ALERT_INLINE as any)} level={3}>
          {translate("jobDirectivesHelper")}
        </SettingRow>
      </SettingSection>
    </>
  )
}
