import { React, hooks } from "jimu-core"
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  MapWidgetSelector,
  SettingSection,
  SettingRow,
} from "jimu-ui/advanced/setting-components"
import { TextInput } from "jimu-ui"
import defaultMessages from "./translations/default"

export default function Setting(props: AllWidgetSettingProps<any>) {
  const { onSettingChange, useMapWidgetIds, id, config } = props
  const translate = hooks.useTranslation(defaultMessages)

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

  // Helper to get config value with fallback to legacy property names
  const getConfigValue = (
    modernProp: string,
    legacyProp?: string,
    defaultValue: string | number = ""
  ) => {
    return (
      config?.[modernProp] ||
      (legacyProp ? config?.[legacyProp] : undefined) ||
      defaultValue
    )
  }

  return (
    <div className="widget-setting-fme-export">
      <SettingSection title="Map Configuration">
        <SettingRow>
          <MapWidgetSelector
            useMapWidgetIds={useMapWidgetIds}
            onSelect={onMapWidgetSelected}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={translate("fmeServerConfig")}>
        <SettingRow label={translate("fmeServerUrl")}>
          <TextInput
            value={getConfigValue("fmeServerUrl", "fme_server_url")}
            onChange={(e) => {
              handlePropertyChange("fmeServerUrl", e.target.value)
            }}
            placeholder="https://fme.server.com"
          />
        </SettingRow>
        <SettingRow label={translate("fmeServerToken")}>
          <TextInput
            type="password"
            value={getConfigValue("fmeServerToken", "fmw_server_token")}
            onChange={(e) => {
              handlePropertyChange("fmeServerToken", e.target.value)
            }}
            placeholder="Enter FME Server token"
          />
        </SettingRow>
        <SettingRow label={translate("repository")}>
          <TextInput
            value={getConfigValue("repository")}
            onChange={(e) => {
              handlePropertyChange("repository", e.target.value)
            }}
            placeholder="MyRepository"
          />
        </SettingRow>
      </SettingSection>
    </div>
  )
}
