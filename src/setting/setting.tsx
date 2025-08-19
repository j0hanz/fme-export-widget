import { React, hooks } from "jimu-core"
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

// Validate server URL format and ensure it does not contain /fmeserver or /fmerest
function validateServerUrl(url: string): string | null {
  if (!url) return "errorMissingServerUrl"

  try {
    const u = new URL(url)
    if (!/^https?:$/i.test(u.protocol)) {
      return "errorInvalidServerUrl"
    }
    if (/\/fmeserver\b|\/fmerest\b/i.test(u.pathname)) {
      return "errorBadBaseUrl"
    }
    return null
  } catch {
    return "errorInvalidServerUrl"
  }
}

function validateToken(token: string): string | null {
  if (!token) return "errorMissingToken"
  if (/\s/.test(token) || token.length < 12) {
    return "errorTokenIsInvalid"
  }
  return null
}

function validateRepository(
  repository: string,
  availableRepos: string[] | null
): string | null {
  if (availableRepos && availableRepos.length > 0 && !repository) {
    return "errorRepoRequired"
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
  // Track in-flight test for cancellation to avoid stale state updates
  const abortRef = React.useRef<AbortController | null>(null)

  // Format message utility
  const formatMessage = hooks.useEventCallback(
    (key: string, params?: { [key: string]: string | number }) => {
      let message = translate(key) || key
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          message = message.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
        })
      }
      return message
    }
  )

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
  const renderRequiredLabel = hooks.useEventCallback(
    (labelText: string): React.ReactNode => (
      <>
        {labelText}
        <Tooltip content={translate("requiredField")} placement="top">
          <span
            style={UI_CSS.TYPOGRAPHY.REQUIRED}
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
    const serverUrl = getStringConfig("fmeServerUrl").trim()
    const token = getStringConfig("fmeServerToken").trim()
    const repository = getStringConfig("repository").trim()

    const messages: Partial<{
      serverUrl: string
      token: string
      repository: string
    }> = {}

    // Use validation helpers
    const serverUrlError = validateServerUrl(serverUrl)
    const tokenError = validateToken(token)
    const repositoryError = validateRepository(repository, availableRepos)

    if (serverUrlError) messages.serverUrl = translate(serverUrlError)
    if (tokenError) messages.token = translate(tokenError)
    if (repositoryError) messages.repository = translate(repositoryError)

    // Update local field errors for UI highlighting
    setFieldErrors({
      serverUrl: messages.serverUrl,
      token: messages.token,
      repository: messages.repository,
    })
    return { messages, hasErrors: !!(messages.serverUrl || messages.token) }
  })

  // Validate connection settings
  const validateConnectionSettings = hooks.useEventCallback(
    (): ConnectionSettings | null => {
      const rawServerUrl = getStringConfig("fmeServerUrl").trim()
      const token = getStringConfig("fmeServerToken").trim()
      const repository = getStringConfig("repository").trim()

      const { cleaned, changed } = sanitizeBaseUrl(rawServerUrl || "")
      // If sanitization changed, update config
      if (changed) {
        updateConfig("fmeServerUrl", cleaned)
      }

      const serverUrl = cleaned

      return serverUrl && token ? { serverUrl, token, repository } : null
    }
  )

  // Test server connection
  const testServerConnection = hooks.useEventCallback(
    async (client: FmeFlowApiClient, signal?: AbortSignal) => {
      const info = await client.testConnection(signal)
      return info
    }
  )

  // Fetch available repositories
  const fetchRepositories = hooks.useEventCallback(
    async (
      client: FmeFlowApiClient,
      signal?: AbortSignal
    ): Promise<string[]> => {
      const reposResp = await client.getRepositories(signal)
      return extractRepoNames(reposResp.data)
    }
  )

  // Determine if auto-test should run
  const shouldAutoTest = hooks.useEventCallback((): boolean => {
    if (testState.isTesting || availableRepos !== null) return false

    const settings = validateConnectionSettings()
    return !!(settings?.serverUrl && settings?.token)
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
        const token = getStringConfig("fmeServerToken").trim()
        const message =
          token && token.length < 12
            ? translate("errorTokenIsInvalid")
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
      // Wait a bit to avoid flickering on rapid changes
      if (!silent) {
        await new Promise((resolve) => setTimeout(resolve, 600))
        if (signal.aborted) return
      }

      const client = new FmeFlowApiClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
        repository: settings.repository || "_",
      })

      // 1) Test server connection
      const info = await testServerConnection(client, signal)

      // 2) Fetch repositories
      try {
        const repos = await fetchRepositories(client, signal)
        setAvailableRepos(repos)
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: undefined,
          token: undefined,
          repository: undefined,
        }))

        if (!silent) {
          const successHelper = info?.data?.version
            ? formatMessage("serverVersion", { version: info.data.version })
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

  const getAlertTitle = hooks.useEventCallback(
    (type: string): string | undefined => {
      const titleMap: { [key: string]: string } = {
        success: translate("connectionOk"),
        error: translate("connectionFailed"),
        warning: translate("warningTitle"),
      }
      return titleMap[type]
    }
  )

  const renderConnectionStatus = (): React.ReactNode => {
    if (testState.isTesting) {
      return (
        <div style={{ width: "100%" }}>
          <Loading
            className="w-100"
            type={LoadingType.Bar}
            text={translate("testingConnection") || undefined}
          />
        </div>
      )
    }

    if (!testState.message) return null

    const title = getAlertTitle(testState.type)
    const text: string | undefined = testState.message || undefined

    return (
      <Alert
        banner
        fullWidth
        style={{ backgroundColor: "transparent" }}
        title={title}
        text={text}
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
            value={getStringConfig("fmeServerUrl")}
            onChange={(val) => {
              updateConfig("fmeServerUrl", val)
              setFieldErrors((prev) => ({ ...prev, serverUrl: undefined }))
            }}
            placeholder={translate("serverUrlPlaceholder")}
            errorText={fieldErrors.serverUrl}
          />
          {fieldErrors.serverUrl && (
            <SettingRow flow="wrap" className="w-100">
              <Alert
                fullWidth
                style={{ padding: "0 0.4rem", opacity: 0.8 }}
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
            value={getStringConfig("fmeServerToken")}
            onChange={(val) => {
              updateConfig("fmeServerToken", val)
              setFieldErrors((prev) => ({ ...prev, token: undefined }))
            }}
            placeholder={translate("tokenPlaceholder")}
            errorText={fieldErrors.token}
          />
          {fieldErrors.token && (
            <SettingRow flow="wrap" className="w-100">
              <Alert
                fullWidth
                style={{ padding: "0 0.4rem", opacity: 0.8 }}
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
              // Field message clearing removed since no inline alerts
              setFieldErrors((prev) => ({ ...prev, repository: undefined }))
            }}
            disabled={!availableRepos || availableRepos.length === 0}
            placeholder={"---"}
          />
        </SettingRow>

        {/* Test connection */}
        <SettingRow flow="wrap" className="w-100">
          <Button
            disabled={testState.isTesting}
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
                style={{
                  backgroundColor: "transparent",
                }}
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
