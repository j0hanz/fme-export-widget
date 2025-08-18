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
import type { ApiResponse } from "../shared/types"
import { FmeFlowApiError } from "../shared/types"

export default function Setting(props: AllWidgetSettingProps<any>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages)

  // Simple interpolation helper for translations: replaces {key} with values
  const t = React.useCallback(
    (key: string, params?: { [key: string]: string | number }) => {
      let s = translate(key) || key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
        }
      }
      return s
    },
    [translate]
  )

  const [isTesting, setIsTesting] = React.useState(false)
  const [testMessage, setTestMessage] = React.useState<string | null>(null)
  const [testType, setTestType] = React.useState<
    "success" | "warning" | "error" | "info"
  >("info")
  const [availableRepos, setAvailableRepos] = React.useState<string[] | null>(
    null
  )

  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    onSettingChange({
      id,
      useMapWidgetIds,
    })
  }

  const handlePropertyChange = (prop: string, value: string | number) => {
    onSettingChange({
      id,
      config: config.set(prop, value),
    })
  }

  // Helper to get config value with fallback to legacy property names (memoized)
  const getConfigValue = React.useCallback(
    (
      modernProp: string,
      legacyProp?: string,
      defaultValue: string | number = ""
    ) => {
      return (
        (config?.[modernProp] as unknown) ||
        (legacyProp ? (config?.[legacyProp] as unknown) : undefined) ||
        defaultValue
      )
    },
    [config]
  )

  // Centralized Test Connection action (reused by button and auto-run)
  const runTestConnection = React.useCallback(
    async (silent = false) => {
      setAvailableRepos(null)
      const serverUrl = (
        getConfigValue("fmeServerUrl", "fme_server_url") as string
      )?.trim()
      const token = (
        (getConfigValue("fmeServerToken", "fme_server_token") as string) ||
        (getConfigValue("fmeServerToken", "fmw_server_token") as string)
      )?.trim()
      const repository = (getConfigValue("repository") as string)?.trim()

      if (!serverUrl || !token) {
        if (!silent) {
          setTestType("warning")
          setTestMessage(translate("enterServerAndToken"))
        }
        return
      }

      setIsTesting(true)
      if (!silent) {
        setTestMessage(translate("testingConnection"))
        setTestType("info")
      }

      try {
        const client = new FmeFlowApiClient({
          serverUrl,
          token,
          // Placeholder repository to satisfy constructor; not used by testConnection/getRepositories
          repository: repository || "_",
        })

        // 1) Test server connection (and token)
        const info = await client.testConnection()

        // 2) Get repositories list
        const reposResp: ApiResponse<Array<{ name: string }>> =
          await client.getRepositories()
        const repos = extractRepoNames(reposResp.data)
        setAvailableRepos(repos)

        // 3) If repository is provided, validate it
        let repoMsg = ""
        if (repository) {
          try {
            await client.validateRepository(repository)
            repoMsg = t("repositoryValid", { repository })
          } catch (e) {
            repoMsg = t("repositoryInvalid", { repository })
          }
        }

        if (!silent) {
          setTestType("success")
          setTestMessage(
            `${translate("connectionOk")} ` +
              (info?.data?.version
                ? t("serverVersion", { version: info.data.version })
                : "") +
              (repoMsg ? ` ${repoMsg}` : "")
          )
        }
      } catch (err) {
        const message =
          err instanceof FmeFlowApiError
            ? err.message
            : (err as Error)?.message || String(err)
        if (!silent) {
          setTestType("error")
          setTestMessage(`${translate("connectionFailed")} ${message}`)
        }
      } finally {
        setIsTesting(false)
      }
    },
    [getConfigValue, t, translate]
  )

  // Auto-run connection test when settings open and URL/token are present
  React.useEffect(() => {
    // Avoid spamming requests: only auto-run when repos not yet loaded and not currently testing
    if (isTesting || availableRepos !== null) return

    const serverUrl = (
      getConfigValue("fmeServerUrl", "fme_server_url") as string
    )?.trim()
    const token = (
      (getConfigValue("fmeServerToken", "fme_server_token") as string) ||
      (getConfigValue("fmeServerToken", "fmw_server_token") as string)
    )?.trim()

    if (serverUrl && token) {
      // run silently to populate repos without extra toast unless errors are desired to show
      runTestConnection(true)
    }
  }, [isTesting, availableRepos, getConfigValue, runTestConnection])

  // Safely extract repository names from various possible response shapes
  const extractRepoNames = (data: unknown): string[] => {
    if (!data) return []
    // Case 1: array of { name } or strings
    if (Array.isArray(data)) {
      return data
        .map((item: any) => (typeof item === "string" ? item : item?.name))
        .filter(Boolean)
    }
    // Case 2: object with a known array property
    if (typeof data === "object") {
      const obj = data as any
      const candidates =
        obj.items ||
        obj.repositories ||
        obj.data ||
        // Fallback: pick the first array-looking property
        Object.values(obj).find((v: any) => Array.isArray(v))
      if (Array.isArray(candidates)) {
        return candidates
          .map((item: any) => (typeof item === "string" ? item : item?.name))
          .filter(Boolean)
      }
    }
    return []
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
          label={translate("fmeServerUrl")}
          level={3}
          tag="div"
        >
          <Input
            value={getConfigValue("fmeServerUrl", "fme_server_url") as string}
            onChange={(val) => {
              handlePropertyChange("fmeServerUrl", val)
            }}
            placeholder={translate("serverUrlPlaceholder")}
          />
        </SettingRow>

        {/* FME Server Token */}
        <SettingRow
          flow="wrap"
          label={translate("fmeServerToken")}
          level={3}
          tag="div"
        >
          <Input
            type="password"
            value={
              (getConfigValue(
                "fmeServerToken",
                "fme_server_token"
              ) as string) ||
              (getConfigValue("fmeServerToken", "fmw_server_token") as string)
            }
            onChange={(val) => {
              handlePropertyChange("fmeServerToken", val)
            }}
            placeholder={translate("tokenPlaceholder")}
          />
        </SettingRow>

        {/* Test connection */}
        <SettingRow>
          <Button
            disabled={isTesting}
            alignText="center"
            text={
              isTesting ? translate("testing") : translate("testConnection")
            }
            onClick={() => runTestConnection(false)}
          />
        </SettingRow>

        {/* Available repositories (always visible; disabled when empty) */}
        <SettingRow
          flow="wrap"
          label={translate("availableRepositories")}
          level={3}
          tag="div"
        >
          <Select
            options={(availableRepos || []).map((r) => ({
              label: r,
              value: r,
            }))}
            value={(getConfigValue("repository") as string) || undefined}
            onChange={(val) => {
              handlePropertyChange("repository", val as string)
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
        {testMessage && (
          <SettingRow>
            <Alert
              text={testMessage}
              type={testType}
              withIcon
              closable={false}
            />
          </SettingRow>
        )}
      </SettingSection>
    </>
  )
}
