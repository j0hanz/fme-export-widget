/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { React, hooks, jsx, css } from "jimu-core"
import { SettingRow } from "jimu-ui/advanced/setting-components"
import { Loading, LoadingType, Switch } from "jimu-ui"
import {
  Alert,
  Button,
  Icon,
  Input,
  NumericInput,
  Select,
  Tooltip,
} from "../../runtime/components/ui"
import resetIcon from "../../assets/icons/refresh.svg"
import {
  parseNonNegativeInt,
  toTrimmedString,
  collectTrimmedStrings,
  uniqueStrings,
} from "../../shared/utils"
import type {
  ConnectionTestSectionProps,
  RepositorySelectorProps,
  JobDirectivesSectionProps,
  StepStatus,
  SettingStyles,
  TranslateFn,
} from "../../config/index"

/* Helper: Konverterar sträng till numeriskt värde eller undefined */
export const toNumericValue = (value: string): number | undefined => {
  const trimmed = (value ?? "").trim()
  if (trimmed === "") return undefined
  return parseNonNegativeInt(trimmed)
}

/* Återanvändbar obligatorisk etikett med tooltip */
export const RequiredLabel: React.FC<{
  text: string
  translate: TranslateFn
  requiredStyle: any
  requiredSymbol: string
}> = ({ text, translate, requiredStyle, requiredSymbol }) => (
  <>
    {text}
    <Tooltip content={translate("requiredField")} placement="top">
      <span
        css={requiredStyle}
        aria-label={translate("ariaRequired")}
        role="img"
        aria-hidden={false}
      >
        {requiredSymbol}
      </span>
    </Tooltip>
  </>
)

/* Återanvändbar Switch-rad för konsekvent markup */
export const SwitchRow: React.FC<{
  id: string
  label: React.ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  level?: 1 | 2
}> = ({ id, label, checked, onChange, ariaLabel, level = 2 }) => (
  <SettingRow flow="no-wrap" label={label} level={level}>
    <Switch
      id={id}
      checked={checked}
      onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
        const newChecked = evt?.target?.checked ?? !checked
        onChange(newChecked)
      }}
      aria-label={ariaLabel}
    />
  </SettingRow>
)

/* Återanvändbar NumericInput-rad med validering och felhantering */
export const NumericInputRow: React.FC<{
  id: string
  label: React.ReactNode
  value: string
  onChange: (val: number | undefined) => void
  onBlur: (val: string) => void
  placeholder?: string
  errorText?: string
  min?: number
  step?: number
  precision?: number
  ariaLabel?: string
  styles: SettingStyles
}> = ({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  errorText,
  min = 0,
  step = 1,
  precision = 0,
  ariaLabel,
  styles,
}) => (
  <SettingRow flow="wrap" label={label} level={2} tag="label">
    <NumericInput
      id={id}
      value={toNumericValue(value)}
      min={min}
      step={step}
      precision={precision}
      placeholder={placeholder}
      aria-invalid={errorText ? true : undefined}
      aria-describedby={errorText ? `${id}-error` : undefined}
      aria-label={ariaLabel}
      onChange={onChange}
      onBlur={(evt) => {
        const raw = (evt?.target as HTMLInputElement | null)?.value ?? ""
        onBlur(raw)
      }}
    />
    {errorText && (
      <SettingRow flow="wrap" level={2} css={css(styles.row)}>
        <Alert
          id={`${id}-error`}
          fullWidth
          css={css(styles.alertInline)}
          text={errorText}
          type="error"
          closable={false}
        />
      </SettingRow>
    )}
  </SettingRow>
)

/* UI-sektion för anslutningstest med steg-för-steg-status */
export const ConnectionTestSection: React.FC<ConnectionTestSectionProps> = ({
  testState,
  checkSteps,
  disabled,
  onTestConnection,
  translate,
  styles,
  validationPhase,
}) => {
  /* Type guard för att identifiera StepStatus-objekt */
  const isStepStatus = (v: unknown): v is StepStatus =>
    typeof v === "object" &&
    v !== null &&
    Object.prototype.hasOwnProperty.call(v, "completed")
  /* Stabila hjälpfunktioner för färg och text baserat på status */
  const getStatusStyle = hooks.useEventCallback(
    (s: StepStatus | string): any => {
      switch (s) {
        case "ok":
          return styles.status.color.ok
        case "fail":
          return styles.status.color.fail
        case "skip":
          return styles.status.color.skip
        case "pending":
        case "idle":
          return styles.status.color.pending
        default:
          if (isStepStatus(s)) {
            return s.completed
              ? styles.status.color.ok
              : styles.status.color.fail
          }
          return styles.status.color.pending
      }
    }
  )

  /* Returnerar översatt statustext för varje validerings-steg */
  const getStatusText = hooks.useEventCallback(
    (status: StepStatus | string): string => {
      if (typeof status === "string") {
        if (status === "ok") return translate("ok")
        if (status === "fail") return translate("failed")
        if (status === "skip") return translate("skipped")
        return translate("checking")
      }
      if (isStepStatus(status) && status.completed) return translate("ok")
      if (isStepStatus(status) && status.error) return translate("failed")
      return translate("checking")
    }
  )

  /* Renderar anslutningsstatus med alla validerings-steg */
  const renderConnectionStatus = (): React.ReactNode => {
    const rowsAll: Array<{ label: string; status: StepStatus | string }> = [
      { label: translate("fmeServerUrl"), status: checkSteps.serverUrl },
      { label: translate("fmeServerToken"), status: checkSteps.token },
      { label: translate("fmeRepository"), status: checkSteps.repository },
    ]
    const rows = rowsAll.filter((r) => r.status !== "idle")

    const StatusRow = ({
      label,
      status,
    }: {
      label: string
      status: StepStatus | string
    }) => {
      const color = getStatusStyle(status)
      return (
        <div css={css(styles.status.row)}>
          <div css={css(styles.status.labelGroup)}>
            <>
              {label}
              <span aria-hidden="true">{translate("colon")}</span>
            </>
          </div>
          <div css={css(color)}>{getStatusText(status)}</div>
        </div>
      )
    }
    /* Extraherar versions-sträng om tillgänglig */
    const versionText =
      typeof checkSteps.version === "string" ? checkSteps.version : ""
    const hasVersion: boolean = versionText.length > 0

    const phaseKey = (() => {
      if (validationPhase === "checking") return "testingConnection"
      if (validationPhase === "fetchingRepos") return "loadingRepositories"
      return null
    })()

    return (
      <div
        css={css(styles.status.container)}
        role="status"
        aria-live="polite"
        aria-atomic={true}
        aria-busy={
          testState.isTesting || validationPhase === "fetchingRepos"
            ? true
            : undefined
        }
      >
        {(testState.isTesting || validationPhase === "fetchingRepos") && (
          <Loading
            type={LoadingType.Bar}
            text={translate(
              validationPhase === "fetchingRepos"
                ? "loadingRepositories"
                : "testingConnection"
            )}
          />
        )}

        <div css={css(styles.status.list)}>
          {phaseKey && (
            <div css={css(styles.status.row)}>
              <div>{translate(phaseKey)}</div>
            </div>
          )}
          {rows.map((r) => (
            <StatusRow key={r.label} label={r.label} status={r.status} />
          ))}
          {hasVersion && (
            <div css={css(styles.status.row)}>
              <div css={css(styles.status.labelGroup)}>
                {translate("fmeVersion")}
                <span aria-hidden="true">{translate("colon")}</span>
              </div>
              <div>{versionText}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Anslutningstest-knapp */}
      <SettingRow flow="wrap" level={2}>
        <Button
          disabled={disabled}
          alignText="center"
          type="primary"
          text={
            testState.isTesting
              ? translate("testing")
              : translate("testConnection")
          }
          onClick={onTestConnection}
        />
      </SettingRow>
      {(testState.isTesting || testState.message) && (
        <SettingRow flow="wrap" level={2}>
          {renderConnectionStatus()}
        </SettingRow>
      )}
    </>
  )
}

/* Repository-väljare med auto-refresh och fallback till manuell input */
export const RepositorySelector: React.FC<RepositorySelectorProps> = ({
  localServerUrl,
  localToken,
  localRepository,
  availableRepos,
  label,
  fieldErrors,
  validateServerUrl,
  validateToken,
  onRepositoryChange,
  onRefreshRepositories,
  translate,
  styles,
  ID,
  repoHint,
  isBusy,
}) => {
  /* Validerar server och token för att avgöra om refresh är tillåten */
  const serverCheck = validateServerUrl(localServerUrl, { requireHttps: true })
  const tokenCheck = validateToken(localToken)
  const hasValidServer = !!localServerUrl && serverCheck.ok
  const hasValidToken = tokenCheck.ok
  const canRefresh = hasValidServer && hasValidToken && !isBusy

  /* Bygger options-lista från tillgängliga repos och lokalt val */
  const buildRepoOptions = hooks.useEventCallback(
    (): Array<{ label: string; value: string }> => {
      if (!hasValidServer || !hasValidToken) return []
      if (availableRepos === null) return []

      const available = Array.isArray(availableRepos)
        ? collectTrimmedStrings(availableRepos)
        : []

      const local = toTrimmedString(localRepository)
      const names = uniqueStrings([...(local ? [local] : []), ...available])

      return names.map((name) => ({ label: name, value: name }))
    }
  )

  const isSelectDisabled =
    !hasValidServer || !hasValidToken || availableRepos === null || isBusy
  /* Bestämmer placeholder-text baserat på validerings-status */
  const repositoryPlaceholder = (() => {
    if (!hasValidServer || !hasValidToken) {
      return translate("testConnectionFirst")
    }

    if (availableRepos === null) {
      return translate("loadingRepositories")
    }

    if (Array.isArray(availableRepos) && availableRepos.length === 0) {
      return translate("noRepositoriesFound")
    }

    return translate("repoPlaceholder")
  })()

  return (
    <SettingRow
      flow="wrap"
      label={
        <div css={styles.labelWithButton}>
          <span css={styles.labelText}>{label}</span>
          {canRefresh && (
            <Button
              size="sm"
              block={false}
              onClick={onRefreshRepositories}
              type="tertiary"
              title={translate("refreshRepositories")}
              icon={<Icon src={resetIcon} size={14} />}
            />
          )}
        </div>
      }
      level={2}
      tag="label"
    >
      {/* Om ingen repo hittades, tillåt manuell input */}
      {Array.isArray(availableRepos) && availableRepos.length === 0 ? (
        // No repositories found - show text input to allow manual entry
        <Input
          id={ID.repository}
          value={localRepository}
          onChange={(val: string) => {
            onRepositoryChange(val)
          }}
          placeholder={translate("repoPlaceholder")}
          aria-describedby={
            fieldErrors.repository ? `${ID.repository}-error` : undefined
          }
          aria-invalid={fieldErrors.repository ? true : undefined}
        />
      ) : (
        <Select
          options={buildRepoOptions()}
          value={localRepository || undefined}
          onChange={(val) => {
            const next =
              typeof val === "string" || typeof val === "number"
                ? String(val)
                : ""
            onRepositoryChange(next)
          }}
          disabled={isSelectDisabled}
          aria-describedby={
            fieldErrors.repository ? `${ID.repository}-error` : undefined
          }
          aria-invalid={fieldErrors.repository ? true : undefined}
          placeholder={repositoryPlaceholder}
        />
      )}
      {fieldErrors.repository && (
        <SettingRow flow="wrap" level={2}>
          <Alert
            id={`${ID.repository}-error`}
            fullWidth
            css={css(styles.alertInline)}
            text={fieldErrors.repository}
            type="error"
            closable={false}
          />
        </SettingRow>
      )}
      {repoHint && (
        <SettingRow flow="wrap" level={2}>
          <Alert
            fullWidth
            css={css(styles.alertInline)}
            text={repoHint}
            type="warning"
            closable={false}
          />
        </SettingRow>
      )}
    </SettingRow>
  )
}

/* Återanvändbar fält-rad för konsekvent markup och felrendering */
export const FieldRow: React.FC<{
  id: string
  label: React.ReactNode
  value: string
  onChange: (val: string) => void
  onBlur?: (val: string) => void
  placeholder?: string
  type?: "text" | "email" | "password"
  required?: boolean
  errorText?: string
  maxLength?: number
  disabled?: boolean
  isPending?: boolean
  styles: SettingStyles
}> = ({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  required = false,
  errorText,
  maxLength,
  disabled,
  isPending = false,
  styles,
}) => (
  <SettingRow flow="wrap" label={label} level={2} tag="label">
    <Input
      id={id}
      type={type}
      required={required}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      errorText={errorText}
      maxLength={maxLength}
      disabled={disabled}
      aria-invalid={errorText ? true : undefined}
      aria-describedby={errorText ? `${id}-error` : undefined}
      aria-busy={isPending ? true : undefined}
    />
    {isPending && (
      <SettingRow
        flow="wrap"
        level={2}
        css={css(styles.row)}
        role="status"
        aria-live="polite"
        aria-atomic={true}
      >
        <div css={css(styles.fieldStatus)}>
          <Loading
            type={LoadingType.Secondary}
            width={16}
            height={16}
            aria-hidden={true}
          />
        </div>
      </SettingRow>
    )}
    {errorText && (
      <SettingRow flow="wrap" level={2} css={css(styles.row)}>
        <Alert
          id={`${id}-error`}
          fullWidth
          css={css(styles.alertInline)}
          text={errorText}
          type="error"
          closable={false}
        />
      </SettingRow>
    )}
  </SettingRow>
)

/* Sektion för FME job directives (tm_ttc, tm_ttl) */
export const JobDirectivesSection: React.FC<JobDirectivesSectionProps> = ({
  localTmTtc,
  localTmTtl,
  onTmTtcChange,
  onTmTtlChange,
  onTmTtcBlur,
  onTmTtlBlur,
  fieldErrors,
  translate,
  styles,
  ID,
  showTmTtc = true,
}) => {
  return (
    <>
      {/* Job directives (admin-standardvärden) */}
      {showTmTtc && (
        <SettingRow
          flow="wrap"
          label={
            <Tooltip content={translate("tm_ttcHelper")} placement="top">
              <span>{translate("tm_ttcLabel")}</span>
            </Tooltip>
          }
          level={2}
          tag="label"
        >
          <NumericInput
            id={ID.tm_ttc}
            value={toNumericValue(localTmTtc)}
            min={0}
            step={1}
            precision={0}
            placeholder={translate("tm_ttcPlaceholder")}
            aria-invalid={fieldErrors.tm_ttc ? true : undefined}
            aria-describedby={
              fieldErrors.tm_ttc ? `${ID.tm_ttc}-error` : undefined
            }
            onChange={(value) => {
              onTmTtcChange(value === undefined ? "" : String(value))
            }}
            onBlur={(evt) => {
              const raw = (evt?.target as HTMLInputElement | null)?.value ?? ""
              onTmTtcBlur(raw)
            }}
          />
          {fieldErrors.tm_ttc && (
            <SettingRow flow="wrap" level={2} css={css(styles.row)}>
              <Alert
                id={`${ID.tm_ttc}-error`}
                fullWidth
                css={css(styles.alertInline)}
                text={fieldErrors.tm_ttc}
                type="error"
                closable={false}
              />
            </SettingRow>
          )}
        </SettingRow>
      )}
      <SettingRow
        flow="wrap"
        label={
          <Tooltip content={translate("tm_ttlHelper")} placement="top">
            <span>{translate("tm_ttlLabel")}</span>
          </Tooltip>
        }
        level={2}
        tag="label"
      >
        <NumericInput
          id={ID.tm_ttl}
          value={toNumericValue(localTmTtl)}
          min={0}
          step={1}
          precision={0}
          placeholder={translate("tm_ttlPlaceholder")}
          aria-invalid={fieldErrors.tm_ttl ? true : undefined}
          aria-describedby={
            fieldErrors.tm_ttl ? `${ID.tm_ttl}-error` : undefined
          }
          onChange={(value) => {
            onTmTtlChange(value === undefined ? "" : String(value))
          }}
          onBlur={(evt) => {
            const raw = (evt?.target as HTMLInputElement | null)?.value ?? ""
            onTmTtlBlur(raw)
          }}
        />
        {fieldErrors.tm_ttl && (
          <SettingRow flow="wrap" level={2} css={css(styles.row)}>
            <Alert
              id={`${ID.tm_ttl}-error`}
              fullWidth
              css={css(styles.alertInline)}
              text={fieldErrors.tm_ttl}
              type="error"
              closable={false}
            />
          </SettingRow>
        )}
      </SettingRow>
    </>
  )
}
