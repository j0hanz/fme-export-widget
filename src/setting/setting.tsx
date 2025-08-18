import { React, hooks } from "jimu-core"
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  MapWidgetSelector,
  SettingSection,
  SettingRow,
} from "jimu-ui/advanced/setting-components"
import { Alert } from "jimu-ui"
import { Button, Input, Select } from "../runtime/components/ui"
import defaultMessages from "./translations/default"
import FmeFlowApiClient from "../shared/api"
import type {
  ApiResponse,
  WidgetConfig,
  ConnectionSettings,
  TestState,
} from "../shared/types"
import { FmeFlowApiError } from "../shared/types"

// Utility hook to extract configuration values with a default fallback
function useConfigValue(config: WidgetConfig) {
  return React.useCallback(
    (prop: keyof WidgetConfig, defaultValue: string | number = "") => {
      return (config?.[prop] as string | number | undefined) ?? defaultValue
    },
    [config]
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
  const getConfigValue = useConfigValue(config)

  // Consolidated test state
  const [testState, setTestState] = React.useState<TestState>({
    isTesting: false,
    message: null,
    type: "info",
  })
  const [availableRepos, setAvailableRepos] = React.useState<string[] | null>(
    null
  )

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

  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    onSettingChange({
      id,
      useMapWidgetIds,
    })
  }

  // Validate connection settings
  const validateConnectionSettings = hooks.useEventCallback(
    (): ConnectionSettings | null => {
      const serverUrl = (getConfigValue("fmeServerUrl") as string)?.trim()
      const token = (getConfigValue("fmeServerToken") as string)?.trim()
      const repository = (getConfigValue("repository") as string)?.trim()

      return serverUrl && token ? { serverUrl, token, repository } : null
    }
  )

  // Test server connection
  const testServerConnection = hooks.useEventCallback(
    async (client: FmeFlowApiClient) => {
      const info = await client.testConnection()
      return info
    }
  )

  // Fetch available repositories
  const fetchRepositories = hooks.useEventCallback(
    async (client: FmeFlowApiClient): Promise<string[]> => {
      const reposResp: ApiResponse<Array<{ name: string }>> =
        await client.getRepositories()
      return extractRepoNames(reposResp.data)
    }
  )

  // Validate selected repository
  const validateSelectedRepository = hooks.useEventCallback(
    async (client: FmeFlowApiClient, repository: string): Promise<string> => {
      if (!repository) return ""

      try {
        await client.validateRepository(repository)
        return formatMessage("repositoryValid", { repository })
      } catch (e) {
        return formatMessage("repositoryInvalid", { repository })
      }
    }
  )

  // Centralized Test Connection action (reused by button and auto-run)
  const runTestConnection = hooks.useEventCallback(async (silent = false) => {
    setAvailableRepos(null)
    const settings = validateConnectionSettings()

    if (!settings) {
      if (!silent) {
        setTestState({
          isTesting: false,
          message: translate("enterServerAndToken"),
          type: "warning",
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
      const client = new FmeFlowApiClient({
        serverUrl: settings.serverUrl,
        token: settings.token,
        repository: settings.repository || "_",
      })

      const info = await testServerConnection(client)
      const repos = await fetchRepositories(client)
      setAvailableRepos(repos)

      const repoMsg = await validateSelectedRepository(
        client,
        settings.repository
      )

      if (!silent) {
        const successMessage =
          `${translate("connectionOk")} ` +
          (info?.data?.version
            ? formatMessage("serverVersion", { version: info.data.version })
            : "") +
          (repoMsg ? ` ${repoMsg}` : "")

        setTestState({
          isTesting: false,
          message: successMessage,
          type: "success",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
    } catch (err) {
      const message =
        err instanceof FmeFlowApiError
          ? err.message
          : (err as Error)?.message || String(err)

      if (!silent) {
        setTestState({
          isTesting: false,
          message: `${translate("connectionFailed")} ${message}`,
          type: "error",
        })
      } else {
        setTestState((prev) => ({ ...prev, isTesting: false }))
      }
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
  }, [shouldAutoTest, runTestConnection])

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
          label={translate("fmeServerUrl")}
          level={3}
          tag="label"
        >
          <Input
            value={getConfigValue("fmeServerUrl") as string}
            onChange={(val) => {
              onSettingChange({
                id,
                config: (config as any).set("fmeServerUrl", val),
              })
            }}
            placeholder={translate("serverUrlPlaceholder")}
          />
        </SettingRow>

        {/* FME Server Token */}
        <SettingRow
          flow="wrap"
          label={translate("fmeServerToken")}
          level={3}
          tag="label"
        >
          <Input
            type="password"
            value={getConfigValue("fmeServerToken") as string}
            onChange={(val) => {
              onSettingChange({
                id,
                config: (config as any).set("fmeServerToken", val),
              })
            }}
            placeholder={translate("tokenPlaceholder")}
          />
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
            value={(getConfigValue("repository") as string) || undefined}
            onChange={(val) => {
              onSettingChange({
                id,
                config: (config as any).set("repository", val as string),
              })
            }}
            disabled={!availableRepos || availableRepos.length === 0}
            placeholder={
              !availableRepos || availableRepos.length === 0
                ? translate("noRepositoriesFound") ||
                  "No repositories found — run Test connection"
                : translate("repositoryPlaceholder")
            }
          />
        </SettingRow>
        {/* Connection status */}
        {testState.message && (
          <SettingRow>
            <Alert
              text={testState.message}
              type={testState.type}
              withIcon
              closable={false}
            />
          </SettingRow>
        )}
      </SettingSection>
    </>
  )
}
