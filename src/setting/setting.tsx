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
  ApiResponse,
  WidgetConfig,
  ConnectionSettings,
  TestState,
} from "../shared/types"
import { FmeFlowApiError } from "../shared/types"

// Type guard to recognize FME Flow API errors
function isFmeFlowApiError(err: unknown): err is FmeFlowApiError {
  return err instanceof FmeFlowApiError
}

// Central helper to extract HTTP status from various error shapes
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

  // Try to extract status from message string
  const msg: string = String((e?.message as string) || "")
  const statusMatch =
    msg.match(/status:\s*(\d{3})/i) ||
    msg.match(
      /\b(\d{3})\s*\((?:Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error|Service Unavailable|Gateway)/i
    ) ||
    msg.match(/\b(\d{3})\b/)

  const code = statusMatch ? parseInt(statusMatch[1], 10) : undefined
  return Number.isFinite(code) ? code : undefined
}

// String-only config getter to avoid repetitive type assertions
function useStringConfigValue(config: WidgetConfig) {
  return React.useCallback(
    (prop: keyof WidgetConfig, defaultValue = ""): string => {
      const v = config?.[prop]
      return typeof v === "string" ? v : defaultValue
    },
    [config]
  )
}

// Small helper to centralize config updates
function useUpdateConfig(
  id: string,
  config: WidgetConfig,
  onSettingChange: AllWidgetSettingProps<WidgetConfig>["onSettingChange"]
) {
  return React.useCallback(
    <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
      onSettingChange({
        id,
        // EXB config is Immutable; keep usage pattern but centralize here
        config: (config as any).set(key, value),
      })
    },
    [id, config, onSettingChange]
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

export default function Setting(props: AllWidgetSettingProps<WidgetConfig>) {
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
    const withStatus = (key: string, status?: number) =>
      status ? formatMessage(key, { status }) : translate(key)

    const code: string = isFmeFlowApiError(err)
      ? err.code || ""
      : ((): string => {
          const c = (err as { [key: string]: unknown })?.code
          return typeof c === "string" ? c : ""
        })()
    const status = isFmeFlowApiError(err) ? err.status : getHttpStatus(err)
    const rawMsg = (err as { [key: string]: unknown })?.message
    const raw = typeof rawMsg === "string" ? rawMsg : ""

    // FME-specific codes
    if (code === "INVALID_RESPONSE_FORMAT") {
      return (
        translate("errorInvalidResponse") +
        " " +
        translate("errorInvalidResponseHelper")
      )
    }
    if (code === "REPOSITORIES_ERROR") {
      return (
        translate("errorRepositories") +
        " " +
        translate("errorRepositoriesHelper")
      )
    }

    // Status-based mapping
    if (status === 401 || status === 403) {
      return (
        withStatus("errorUnauthorized", status) +
        " " +
        translate("errorUnauthorizedHelper")
      )
    }
    if (status === 404) {
      return (
        withStatus("errorNotFound", status) +
        " " +
        translate("errorNotFoundHelper")
      )
    }
    if (status === 400) {
      return withStatus("errorBadRequest", status)
    }
    if (status === 408 || status === 504) {
      return withStatus("errorTimeout", status)
    }
    if (status === 429) {
      return withStatus("errorTooManyRequests", status)
    }
    if (status === 502) {
      return withStatus("errorGateway", status)
    }
    if (status === 503) {
      return withStatus("errorServiceUnavailable", status)
    }
    if (typeof status === "number" && status >= 500 && status < 600) {
      return withStatus("errorServer", status)
    }
    if (status === 0 || raw.toLowerCase().includes("failed to fetch")) {
      return translate("errorNetworkShort")
    }
    if (typeof status === "number") {
      return withStatus("errorHttpStatus", status)
    }

    return translate("errorGeneric")
  })

  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    onSettingChange({
      id,
      useMapWidgetIds,
    })
  }

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

    // Server URL validation
    if (!serverUrl) {
      messages.serverUrl = translate("errorMissingServerUrl")
    } else {
      try {
        const u = new URL(serverUrl)
        if (!/^https?:$/i.test(u.protocol)) {
          messages.serverUrl = translate("errorInvalidServerUrl")
        } else if (/\/fmeserver\b|\/fmerest\b/i.test(u.pathname)) {
          messages.serverUrl = translate("errorBadBaseUrl")
        }
      } catch {
        messages.serverUrl = translate("errorInvalidServerUrl")
      }
    }

    // Token validation
    if (!token) {
      messages.token = translate("errorMissingToken")
    } else if (/\s/.test(token) || token.length < 12) {
      messages.token = translate("errorTokenIsInvalid")
    }

    // Repository validation
    if (availableRepos && availableRepos.length > 0 && !repository) {
      messages.repository = translate("errorRepoRequired")
    }

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
      const reposResp: ApiResponse<Array<{ name: string }>> =
        await client.getRepositories(signal)
      return extractRepoNames(reposResp.data)
    }
  )

  // Centralized Test Connection action (reused by button and auto-run)
  const runTestConnection = hooks.useEventCallback(async (silent = false) => {
    // Cancel any in-flight test first
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    setAvailableRepos(null)

    // Pre-validate fields
    const validation = validateAllInputs()
    const settings = validateConnectionSettings()

    if (!settings || validation.hasErrors) {
      if (!silent) {
        // Show specific token validation message if that's the primary issue
        const token = getStringConfig("fmeServerToken").trim()
        const message =
          token && token.length < 12
            ? translate("errorTokenIsInvalid")
            : translate("fixErrorsAbove")

        setTestState({
          isTesting: false,
          message: message,
          type: "error",
        })
      }
      return
    }

    setTestState({
      isTesting: true,
      message: silent ? null : translate("testingConnection"),
      type: "info",
    })

    try {
      // When showing the testingConnection status to the user, wait 1 second
      if (!silent) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        // If the action was aborted during the delay, exit early.
        if (signal?.aborted) return
      }

      const client = new FmeFlowApiClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
        repository: settings.repository || "_",
      })

      const info = await testServerConnection(client, signal)
      try {
        const repos = await fetchRepositories(client, signal)
        setAvailableRepos(repos)
        // Clear repo error if selection now valid
        setFieldErrors((prev) => ({ ...prev, repository: undefined }))
        // Successful connection: clear any lingering warnings
      } catch (repoErr) {
        // Keep the connection result but surface a clear warning about repos
        setAvailableRepos(null)
        const alertMessage = processError(repoErr)
        if (!silent) {
          setTestState({
            isTesting: false,
            message: alertMessage,
            type: "warning",
          })
        } else {
          setTestState((prev) => ({ ...prev, isTesting: false }))
        }
        // Highlight repository select as problematic
        setFieldErrors((prev) => ({
          ...prev,
          repository: translate("errorRepositories"),
        }))
        // Repository hint removed since no inline alerts
        return
      }

      if (!silent) {
        // Success: keep helper text separate from title by storing only details (e.g., version)
        const successHelper = info?.data?.version
          ? formatMessage("serverVersion", { version: info.data.version })
          : translate("connectionOk")

        // Clear any field-level errors on success
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: undefined,
          token: undefined,
        }))

        setTestState({
          isTesting: false,
          message: successHelper,
          type: "success",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        // Swallow aborts quietly
        return
      }

      const alertMessage = processError(err)

      // If auth-related, mark token as invalid to highlight field
      const status = getHttpStatus(err)
      if (status === 401 || status === 403) {
        setFieldErrors((prev) => ({
          ...prev,
          token: translate("errorTokenIsInvalid"),
        }))
      } else if (status === 404) {
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: translate("errorNotFound"),
        }))
      } else if (status === 0) {
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: translate("errorNetworkShort"),
        }))
      } else if (status === 408 || status === 504) {
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: translate("errorTimeout"),
        }))
      } else if (typeof status === "number" && status >= 500 && status < 600) {
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: translate("errorServer", { status }),
        }))
      } else if (typeof status === "number") {
        setFieldErrors((prev) => ({
          ...prev,
          serverUrl: translate("errorHttpStatus", { status }),
        }))
      }

      if (!silent) {
        setTestState({
          isTesting: false,
          message: alertMessage,
          type: "error",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
      // Field-specific error feedback removed since no inline alerts
    }
  })

  // Check if auto-test should run
  const shouldAutoTest = hooks.useEventCallback((): boolean => {
    if (testState.isTesting || availableRepos !== null) return false

    const settings = validateConnectionSettings()
    return !!(settings?.serverUrl && settings?.token)
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

  // Render helper for the connection status area to keep JSX tidy
  const renderConnectionStatus = (): React.ReactNode => {
    if (!testState.message) return null

    const testingText = translate("testingConnection")
    const isTestingInfo =
      testState.type === "info" && testState.message === testingText

    if (isTestingInfo) {
      return (
        <div style={{ width: "100%" }}>
          <Loading
            className="w-100"
            type={LoadingType.Bar}
            text={testState.message || undefined}
          />
        </div>
      )
    }

    let title: string | undefined
    const text: string | undefined = testState.message || undefined
    switch (testState.type) {
      case "success":
        title = translate("connectionOk")
        break
      case "error":
        title = translate("connectionFailed")
        break
      case "warning":
        title = translate("warningTitle")
        break
      default:
        title = undefined
    }

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
          label={
            <>
              {translate("fmeServerUrl")}
              <Tooltip content={translate("requiredField")} placement="top">
                <span
                  style={UI_CSS.TYPOGRAPHY.REQUIRED}
                  aria-label={translate("ariaRequired")}
                  role="img"
                  aria-hidden="false"
                >
                  {UI_CSS.A11Y.REQUIRED}
                </span>
              </Tooltip>
            </>
          }
          level={3}
          tag="label"
        >
          <Input
            required
            value={getStringConfig("fmeServerUrl")}
            onChange={(val) => {
              updateConfig("fmeServerUrl", val)
              // Live-validate removed since no inline alerts
              setFieldErrors((prev) => ({ ...prev, serverUrl: undefined }))
            }}
            placeholder={translate("serverUrlPlaceholder")}
            errorText={fieldErrors.serverUrl}
          />
          {fieldErrors.serverUrl && (
            <SettingRow>
              <Alert
                banner
                fullWidth
                style={{ backgroundColor: "transparent", padding: "0.25rem" }}
                text={translate("errorInvalidServerUrl")}
                type="error"
                withIcon
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>

        {/* FME Server Token */}
        <SettingRow
          flow="wrap"
          label={
            <>
              {translate("fmeServerToken")}
              <Tooltip content={translate("requiredField")} placement="top">
                <span
                  style={UI_CSS.TYPOGRAPHY.REQUIRED}
                  aria-label={translate("ariaRequired")}
                  role="img"
                  aria-hidden="false"
                >
                  {UI_CSS.A11Y.REQUIRED}
                </span>
              </Tooltip>
            </>
          }
          level={3}
          tag="label"
        >
          <Input
            type="password"
            required
            value={getStringConfig("fmeServerToken")}
            onChange={(val) => {
              updateConfig("fmeServerToken", val)
              // Live-validate token removed since no inline alerts
              setFieldErrors((prev) => ({ ...prev, token: undefined }))
            }}
            placeholder={translate("tokenPlaceholder")}
            errorText={fieldErrors.token}
          />
          {fieldErrors.token && (
            <SettingRow>
              <Alert
                banner
                fullWidth
                style={{ backgroundColor: "transparent", padding: "0.25rem" }}
                text={translate("errorTokenIsInvalid")}
                type="error"
                withIcon
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>

        {/* Test connection */}
        <SettingRow>
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

        {/* Available repositories (always visible; disabled when empty) */}
        <SettingRow
          flow="wrap"
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
        {!testState.isTesting &&
          availableRepos !== null &&
          availableRepos.length === 0 &&
          testState.type !== "error" && (
            <SettingRow>
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
          <SettingRow>{renderConnectionStatus()}</SettingRow>
        )}
      </SettingSection>
    </>
  )
}
