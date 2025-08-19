/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  MapWidgetSelector,
  SettingSection,
  SettingRow,
} from "jimu-ui/advanced/setting-components"
import { Alert, Loading, LoadingType } from "jimu-ui"
import {
  Button,
  Input,
  Select,
  Tooltip,
  UI_CSS,
  UI_CLS,
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

function extractErrorCode(err: unknown): string {
  if (isFmeFlowApiError(err)) return err.code || ""
  const code = (err as { [key: string]: unknown })?.code
  return typeof code === "string" ? code : ""
}

function extractHttpStatusFromError(err: unknown): number | undefined {
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
  const msg = String((e?.message as string) || "")
  const statusMatch =
    msg.match(/status:\s*(\d{3})/i) ||
    msg.match(
      /\b(\d{3})\s*\((?:Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error|Service Unavailable|Gateway)/i
    ) ||
    msg.match(/\b(\d{3})\b/)
  const code = statusMatch ? parseInt(statusMatch[1], 10) : undefined
  return Number.isFinite(code) ? code : undefined
}

// Enhanced FME Flow validation rules based on specifications
function validateFmeServerUrl(url: string): string | null {
  if (!url) return "errorMissingServerUrl"
  const cleanUrl = url.trim()
  if (!cleanUrl) return "errorMissingServerUrl"
  try {
    const u = new URL(cleanUrl)
    if (!/^https?:$/i.test(u.protocol)) {
      return "errorInvalidServerUrl"
    }
    if (/\/fmerest\b/i.test(u.pathname)) {
      return "errorBadBaseUrl"
    }
    return null
  } catch {
    return "errorInvalidServerUrl"
  }
}

function validateFmeToken(token: string): string | null {
  if (!token) return "errorMissingToken"
  if (/\s/.test(token)) {
    return "errorTokenIsInvalid"
  }
  if (token.length < 10) {
    return "errorTokenIsInvalid"
  }

  return null
}

function validateFmeRepository(
  repository: string,
  availableRepos: string[] | null
): string | null {
  if (availableRepos === null) return null
  if (availableRepos.length > 0 && !repository) {
    return "errorRepoRequired"
  }
  if (repository && !availableRepos.includes(repository)) {
    return "errorRepositoryNotFound"
  }

  return null
}

const STATUS_ERROR_MAP: { [status: number]: string } = {
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

function isAuthError(status: number): boolean {
  return status === 401 || status === 403
}

function isNotFoundError(status: number): boolean {
  return status === 404
}

function isServerError(status: number): boolean {
  return status >= 500 && status < 600
}

function getStatusErrorMessage(
  status: number,
  translate: (key: string, params?: any) => string
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

function createFieldErrorsFromStatus(
  status: number | undefined,
  translate: (key: string, params?: any) => string
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
        // Use a new object to avoid mutating the original config
        config: config.set(key, value),
      })
    }
  )
}

// Utility function to extract repository names from API response data
function extractRepoNames(data: unknown): string[] {
  if (!data) return []

  if (Array.isArray(data)) {
    return data
      .map((item: any) => (typeof item === "string" ? item : item?.name))
      .filter(Boolean)
  }

  if (typeof data === "object") {
    const obj = data as any
    const candidates =
      obj.items ||
      obj.repositories ||
      obj.data ||
      Object.values(obj).find((v: any) => Array.isArray(v))

    if (Array.isArray(candidates)) {
      return candidates
        .map((item: any) => (typeof item === "string" ? item : item?.name))
        .filter(Boolean)
    }
  }

  return []
}

export default function Setting(props: AllWidgetSettingProps<IMWidgetConfig>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages)
  const getStringConfig = useStringConfigValue(config)
  const updateConfig = useUpdateConfig(id, config, onSettingChange)

  // Consolidated test state
  const [testState, setTestState] = React.useState<TestState>({
    isTesting: false,
    message: null,
    type: "info",
  })
  const [availableRepos, setAvailableRepos] = React.useState<string[] | null>(
    null
  )
  // Field-level errors (lightweight, local UI state)
  const [fieldErrors, setFieldErrors] = React.useState<{
    serverUrl?: string
    token?: string
    repository?: string
  }>({})
  const [localServerUrl, setLocalServerUrl] = React.useState<string>(
    () => getStringConfig("fmeServerUrl") || ""
  )
  const [localToken, setLocalToken] = React.useState<string>(
    () => getStringConfig("fmeServerToken") || ""
  )
  // Track in-flight test for cancellation to avoid stale state updates
  const abortRef = React.useRef<AbortController | null>(null)

  // Comprehensive error processor - returns alert message for bottom display
  const processError = hooks.useEventCallback((err: unknown): string => {
    const code = extractErrorCode(err)
    const status = isFmeFlowApiError(err)
      ? err.status
      : extractHttpStatusFromError(err)
    const raw = String((err as any)?.message || "")

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
  const REQUIRED_CLS = css(UI_CSS.TYPOGRAPHY.REQUIRED as any)
  const renderRequiredLabel = hooks.useEventCallback(
    (labelText: string): React.ReactNode => (
      <>
        {labelText}
        <Tooltip content={translate("requiredField")} placement="top">
          <span
            css={REQUIRED_CLS}
            aria-label={translate("ariaRequired")}
            role="img"
            aria-hidden={false}
          >
            {UI_CSS.A11Y.REQUIRED}
          </span>
        </Tooltip>
      </>
    )
  )

  // Utilities: URL validation and sanitization (strip /fmeserver or /fmerest)
  const sanitizeBaseUrl = hooks.useEventCallback(
    (rawUrl: string): { cleaned: string; changed: boolean } => {
      try {
        const u = new URL(rawUrl)
        let path = u.pathname || "/"
        const lower = path.toLowerCase()
        const idxServer = lower.indexOf("/fmeserver")
        const idxRest = lower.indexOf("/fmerest")
        if (idxServer >= 0) path = path.substring(0, idxServer) || "/"
        else if (idxRest >= 0) path = path.substring(0, idxRest) || "/"
        const cleaned = new URL(u.origin + path).toString().replace(/\/$/, "")
        const changed =
          cleaned !== rawUrl.replace(/\/$/, "") &&
          (idxServer >= 0 || idxRest >= 0)
        return { cleaned, changed }
      } catch {
        return { cleaned: rawUrl, changed: false }
      }
    }
  )

  // Unified input validation
  const validateAllInputs = hooks.useEventCallback(() => {
    const serverUrl = getStringConfig("fmeServerUrl")
    const token = getStringConfig("fmeServerToken")
    const repository = getStringConfig("repository")

    const messages: Partial<{
      serverUrl: string
      token: string
      repository: string
    }> = {}

    // Validate and sanitize inputs
    const serverUrlError = validateFmeServerUrl(serverUrl)
    const tokenError = validateFmeToken(token)
    const repositoryError = validateFmeRepository(repository, availableRepos)

    if (serverUrlError) messages.serverUrl = translate(serverUrlError)
    if (tokenError) messages.token = translate(tokenError)
    if (repositoryError) messages.repository = translate(repositoryError)

    // Update local field errors for UI highlighting
    setFieldErrors({
      serverUrl: messages.serverUrl,
      token: messages.token,
      repository: messages.repository,
    })
    return {
      messages,
      hasErrors: !!(
        messages.serverUrl ||
        messages.token ||
        messages.repository
      ),
    }
  })

  // Validate connection settings
  const validateConnectionSettings = hooks.useEventCallback(
    (): ConnectionSettings | null => {
      const rawServerUrl = getStringConfig("fmeServerUrl")
      const token = getStringConfig("fmeServerToken")
      const repository = getStringConfig("repository")

      const { cleaned, changed } = sanitizeBaseUrl(rawServerUrl || "")
      // If sanitization changed, update config
      if (changed) {
        updateConfig("fmeServerUrl", cleaned)
      }

      const serverUrl = cleaned

      return serverUrl && token ? { serverUrl, token, repository } : null
    }
  )

  // Check if test connection button should be disabled
  const isTestConnectionDisabled = (): boolean => {
    if (testState.isTesting) return true

    const serverUrl = getStringConfig("fmeServerUrl")
    const token = getStringConfig("fmeServerToken")

    // If no server URL or token, allow test to run
    if (!serverUrl || !token) return true

    // Validate server URL format
    const serverUrlError = validateFmeServerUrl(serverUrl)
    if (serverUrlError) return true

    // Validate token format
    const tokenError = validateFmeToken(token)
    if (tokenError) return true

    return false
  }

  // Determine if auto-test should run
  const shouldAutoTest = hooks.useEventCallback((): boolean => {
    if (testState.isTesting || availableRepos !== null) return false

    const settings = validateConnectionSettings()
    return (
      !!(settings?.serverUrl && settings?.token) && !isTestConnectionDisabled()
    )
  })

  // Centralized Test Connection action (reused by button and auto-run)
  const runTestConnection = hooks.useEventCallback(async (silent = false) => {
    // Cancel any in-flight test first
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    // Validate inputs and sanitize URL
    const { hasErrors } = validateAllInputs()
    const settings = validateConnectionSettings()

    if (!settings || hasErrors) {
      if (!silent) {
        const token = getStringConfig("fmeServerToken")
        const tokenError = validateFmeToken(token)
        const message = tokenError
          ? translate(tokenError)
          : translate("fixErrorsAbove")
        setTestState({ isTesting: false, message, type: "error" })
      }
      return
    }

    // Reset state for new test
    setAvailableRepos(null)
    setTestState({
      isTesting: true,
      message: silent ? null : translate("testingConnection"),
      type: "info",
    })

    try {
      const client = new FmeFlowApiClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
        repository: settings.repository || "_",
      })

      // 1) Test server connection
      const info = await client.testConnection(signal)

      // 2) Fetch repositories
      try {
        const reposResp = await client.getRepositories(signal)
        const repos = extractRepoNames(reposResp.data)
        setAvailableRepos(repos)
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: undefined,
          token: undefined,
          repository: undefined,
        }))

        if (!silent) {
          const successHelper = info?.data?.version
            ? translate("serverVersion", { version: info.data.version })
            : translate("connectionOk")

          setTestState({
            isTesting: false,
            message: successHelper,
            type: "success",
          })
        } else {
          setTestState((prev) => ({ ...prev, isTesting: false }))
        }
      } catch (repoErr) {
        setAvailableRepos([])

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
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return

      const status = extractHttpStatusFromError(err)
      const fieldErrs = createFieldErrorsFromStatus(status, translate)
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

  // Auto-run connection test when settings open and URL/token are present
  React.useEffect(() => {
    if (shouldAutoTest()) {
      runTestConnection(true)
    }
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [shouldAutoTest, runTestConnection])

  const renderConnectionStatus = (): React.ReactNode => {
    if (testState.isTesting) {
      return (
        <div css={UI_CLS.CSS.W_FULL}>
          <Loading
            className="w-100"
            type={LoadingType.Bar}
            text={translate("testingConnection") || undefined}
          />
        </div>
      )
    }

    if (!testState.message) return null

    const titleMap: { [key: string]: string } = {
      success: translate("connectionOk"),
      error: translate("connectionFailed"),
      warning: translate("warningTitle"),
    }
    const title = titleMap[testState.type]

    return (
      <Alert
        banner
        fullWidth
        css={UI_CLS.CSS.BG_TRANSPARENT}
        title={title}
        text={testState.message}
        type={testState.type}
        withIcon
        closable={false}
      />
    )
  }

  return (
    <>
      <SettingSection title={translate("mapConfiguration")}>
        <SettingRow>
          <MapWidgetSelector
            useMapWidgetIds={useMapWidgetIds}
            onSelect={onMapWidgetSelected}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate("fmeServerConfig")}>
        {/* FME Server URL */}
        <SettingRow
          flow="wrap"
          className="w-100"
          label={renderRequiredLabel(translate("fmeServerUrl"))}
          level={3}
          tag="label"
        >
          <Input
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
            <SettingRow flow="wrap" className="w-100">
              <Alert
                fullWidth
                css={UI_CLS.CSS.ALERT_INLINE}
                text={translate("errorInvalidServerUrl")}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>

        {/* FME Server Token */}
        <SettingRow
          flow="wrap"
          className="w-100"
          label={renderRequiredLabel(translate("fmeServerToken"))}
          level={3}
          tag="label"
        >
          <Input
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
            <SettingRow flow="wrap" className="w-100">
              <Alert
                fullWidth
                css={UI_CLS.CSS.ALERT_INLINE}
                text={translate("errorTokenIsInvalid")}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>

        {/* Available repositories (always visible; disabled when empty) */}
        <SettingRow
          flow="wrap"
          className="w-100"
          label={translate("availableRepositories")}
          level={3}
          tag="label"
        >
          <Select
            options={(availableRepos || []).map((r) => ({
              label: r,
              value: r,
            }))}
            value={getStringConfig("repository") || undefined}
            onChange={(val) => {
              updateConfig("repository", val as string)
              const error = validateFmeRepository(val as string, availableRepos)
              setFieldErrors((prev) => ({
                ...prev,
                repository: error ? translate(error) : undefined,
              }))
            }}
            disabled={!availableRepos || availableRepos.length === 0}
            placeholder={"---"}
          />
        </SettingRow>

        {/* Test connection */}
        <SettingRow flow="wrap" className="w-100">
          <Button
            disabled={isTestConnectionDisabled()}
            alignText="center"
            text={
              testState.isTesting
                ? translate("testing")
                : translate("testConnection")
            }
            onClick={() => runTestConnection(false)}
          />
        </SettingRow>
        {!testState.isTesting &&
          availableRepos !== null &&
          availableRepos.length === 0 &&
          testState.type !== "error" && (
            <SettingRow flow="wrap" className="w-100">
              <Alert
                banner
                fullWidth
                css={UI_CLS.CSS.BG_TRANSPARENT}
                title={translate("noRepositoriesFound")}
                text={translate("noRepositoriesFoundHelper")}
                type="warning"
                withIcon
                closable={false}
              />
            </SettingRow>
          )}
        {/* Connection status */}
        {testState.message && (
          <SettingRow flow="wrap" className="w-100">
            {renderConnectionStatus()}
          </SettingRow>
        )}
      </SettingSection>
    </>
  )
}
