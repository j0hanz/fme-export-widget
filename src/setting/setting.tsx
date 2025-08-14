import { React, hooks } from "jimu-core"
import type { AllWidgetSettingProps } from "jimu-for-builder"
import {
  MapWidgetSelector,
  SettingSection,
  SettingRow,
} from "jimu-ui/advanced/setting-components"
import { Input } from "../runtime/components/ui"
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
          <Input
            value={getConfigValue("fmeServerUrl", "fme_server_url") as string}
            onChange={(val) => {
              handlePropertyChange("fmeServerUrl", val)
            }}
            placeholder="https://fme.server.com"
          />
        </SettingRow>
        <SettingRow label={translate("fmeServerToken")}>
          <Input
            type="password"
            value={
              getConfigValue("fmeServerToken", "fmw_server_token") as string
            }
            onChange={(val) => {
              handlePropertyChange("fmeServerToken", val)
            }}
            placeholder="Enter FME Server token"
          />
        </SettingRow>
        <SettingRow label={translate("repository")}>
          <Input
            value={getConfigValue("repository") as string}
            onChange={(val) => {
              handlePropertyChange("repository", val)
            }}
            placeholder="MyRepository"
          />
        </SettingRow>
      </SettingSection>
    </div>
  )
}
