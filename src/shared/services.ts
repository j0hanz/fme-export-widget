import type {
  WorkspaceParameter,
  DynamicFieldConfig,
  FormPrimitive,
  CheckSteps,
  ConnectionValidationOptions,
  ConnectionValidationResult,
  StartupValidationResult,
  StartupValidationOptions,
  FmeFlowConfig,
  TextOrFileValue,
} from "../config"
import { ParameterType, FormFieldType, ErrorType } from "../config"
import {
  isEmpty,
  extractErrorMessage,
  isAbortError,
  extractRepositoryNames,
  isFileObject,
} from "./utils"
import {
  isInt,
  isNum,
  extractHttpStatus,
  validateServerUrl,
  validateRequiredFields,
  createError,
  mapErrorToKey,
} from "./validations"
import FmeFlowApiClient from "./api"

// Shared constants to keep parameter handling consistent
const DEFAULT_REPOSITORY = "_"

const SKIPPED_PARAMETER_NAMES = new Set([
  "MAXX",
  "MINX",
  "MAXY",
  "MINY",
  "AreaOfInterest",
  "tm_ttc",
  "tm_ttl",
  "tm_tag",
])

const ALWAYS_SKIPPED_TYPES = new Set<ParameterType>([ParameterType.NOVALUE])

const LIST_REQUIRED_TYPES = new Set<ParameterType>([
  ParameterType.DB_CONNECTION,
  ParameterType.WEB_CONNECTION,
  ParameterType.ATTRIBUTE_NAME,
  ParameterType.ATTRIBUTE_LIST,
  ParameterType.COORDSYS,
  ParameterType.REPROJECTION_FILE,
])

const MULTI_SELECT_TYPES = new Set<ParameterType>([
  ParameterType.LISTBOX,
  ParameterType.LOOKUP_LISTBOX,
  ParameterType.ATTRIBUTE_LIST,
])

const PARAMETER_FIELD_TYPE_MAP: Readonly<{
  [K in ParameterType]?: FormFieldType
}> = Object.freeze({
  [ParameterType.FLOAT]: FormFieldType.NUMERIC_INPUT,
  [ParameterType.INTEGER]: FormFieldType.NUMBER,
  [ParameterType.TEXT_EDIT]: FormFieldType.TEXTAREA,
  [ParameterType.PASSWORD]: FormFieldType.PASSWORD,
  [ParameterType.BOOLEAN]: FormFieldType.SWITCH,
  [ParameterType.CHECKBOX]: FormFieldType.SWITCH,
  [ParameterType.CHOICE]: FormFieldType.RADIO,
  [ParameterType.FILENAME]: FormFieldType.FILE,
  [ParameterType.FILENAME_MUSTEXIST]: FormFieldType.FILE,
  [ParameterType.DIRNAME]: FormFieldType.FILE,
  [ParameterType.DIRNAME_MUSTEXIST]: FormFieldType.FILE,
  [ParameterType.DIRNAME_SRC]: FormFieldType.FILE,
  [ParameterType.DATE_TIME]: FormFieldType.DATE_TIME,
  [ParameterType.DATETIME]: FormFieldType.DATE_TIME,
  [ParameterType.URL]: FormFieldType.URL,
  [ParameterType.LOOKUP_URL]: FormFieldType.URL,
  [ParameterType.LOOKUP_FILE]: FormFieldType.FILE,
  [ParameterType.DATE]: FormFieldType.DATE,
  [ParameterType.TIME]: FormFieldType.TIME,
  [ParameterType.COLOR]: FormFieldType.COLOR,
  [ParameterType.COLOR_PICK]: FormFieldType.COLOR,
  [ParameterType.RANGE_SLIDER]: FormFieldType.SLIDER,
  [ParameterType.TEXT_OR_FILE]: FormFieldType.TEXT_OR_FILE,
  [ParameterType.REPROJECTION_FILE]: FormFieldType.REPROJECTION_FILE,
  [ParameterType.COORDSYS]: FormFieldType.COORDSYS,
  [ParameterType.ATTRIBUTE_NAME]: FormFieldType.ATTRIBUTE_NAME,
  [ParameterType.ATTRIBUTE_LIST]: FormFieldType.ATTRIBUTE_LIST,
  [ParameterType.DB_CONNECTION]: FormFieldType.DB_CONNECTION,
  [ParameterType.WEB_CONNECTION]: FormFieldType.WEB_CONNECTION,
  [ParameterType.SCRIPTED]: FormFieldType.SCRIPTED,
  [ParameterType.GEOMETRY]: FormFieldType.GEOMETRY,
  [ParameterType.MESSAGE]: FormFieldType.MESSAGE,
})

const normalizeParameterValue = (value: unknown): string | number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "true" : "false"
  return JSON.stringify(value ?? null)
}

const buildChoiceSet = (
  list: WorkspaceParameter["listOptions"]
): Set<string | number> | null => {
  if (!list?.length) return null
  return new Set(list.map((opt) => normalizeParameterValue(opt.value)))
}

const createAbortError = (message = "Operation was aborted"): DOMException => {
  const abortErr = new DOMException(message, "AbortError")
  ;(abortErr as any).name = "AbortError"
  return abortErr
}

const createFmeClient = (
  serverUrl: string,
  token: string,
  overrides: Partial<Pick<FmeFlowConfig, "repository" | "timeout">> = {}
): FmeFlowApiClient => {
  const config: FmeFlowConfig = {
    serverUrl,
    token,
    repository: overrides.repository ?? DEFAULT_REPOSITORY,
    ...(overrides.timeout !== undefined ? { timeout: overrides.timeout } : {}),
  }

  return new FmeFlowApiClient(config)
}

// In-flight request deduplication caches
const inFlight = {
  healthCheck: new Map<
    string,
    Promise<{
      reachable: boolean
      version?: string
      responseTime?: number
      error?: string
      status?: number
    }>
  >(),
  validateConnection: new Map<string, Promise<ConnectionValidationResult>>(),
  testBasicConnection: new Map<
    string,
    Promise<{
      success: boolean
      version?: string
      error?: string
      originalError?: unknown
    }>
  >(),
  getRepositories: new Map<
    string,
    Promise<{ success: boolean; repositories?: string[]; error?: string }>
  >(),
}

// Common network error indicators in messages
const NETWORK_INDICATORS = Object.freeze([
  "Failed to fetch",
  "NetworkError",
  "net::",
  "DNS",
  "ENOTFOUND",
  "ECONNREFUSED",
  "timeout",
  "Name or service not known",
  "ERR_NAME_NOT_RESOLVED",
  "Unable to load",
  "/sharing/proxy",
  "proxy",
])

// Proxy-related error hints
const PROXY_HINTS = Object.freeze(["Unable to load", "/sharing/proxy", "proxy"])

// Generic helper to dedupe concurrent calls with same key
function withInflight<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const existing = cache.get(key)
  if (existing) return existing
  const p = (async () => factory())()
  cache.set(key, p)
  return p.finally(() => {
    cache.delete(key)
  })
}

// Parameter service
export class ParameterFormService {
  // Determine if a parameter should be rendered as a form field
  private isRenderableParam(
    p: WorkspaceParameter | null | undefined
  ): p is WorkspaceParameter {
    if (!p || typeof p.name !== "string") return false
    if (SKIPPED_PARAMETER_NAMES.has(p.name)) return false
    if (ALWAYS_SKIPPED_TYPES.has(p.type)) return false
    if (LIST_REQUIRED_TYPES.has(p.type)) {
      return Array.isArray(p.listOptions) && p.listOptions.length > 0
    }

    return true
  }

  private getRenderableParameters(
    parameters: readonly WorkspaceParameter[]
  ): WorkspaceParameter[] {
    return parameters.filter((parameter) => this.isRenderableParam(parameter))
  }

  // Map list options to {label,value} pairs for select/multiselect fields
  private mapListOptions(
    list: WorkspaceParameter["listOptions"]
  ): ReadonlyArray<{ label: string; value: string | number }> | undefined {
    if (!list || !list.length) return undefined
    return list.map((o) => {
      const normalizedValue = normalizeParameterValue(o.value)
      const fallbackLabel =
        typeof normalizedValue === "number"
          ? String(normalizedValue)
          : normalizedValue
      const label =
        typeof o.caption === "string" && o.caption.trim().length
          ? o.caption
          : fallbackLabel
      return {
        label,
        value: normalizedValue,
      }
    })
  }

  /** Extract slider metadata from RANGE_SLIDER params. */
  private getSliderMeta(param: WorkspaceParameter): {
    min?: number
    max?: number
    step?: number
  } {
    const isRange = param.type === ParameterType.RANGE_SLIDER
    if (!isRange) return {}
    const precision =
      typeof param.decimalPrecision === "number" ? param.decimalPrecision : 0
    const min = typeof param.minimum === "number" ? param.minimum : 0
    const max = typeof param.maximum === "number" ? param.maximum : 100
    const step = precision > 0 ? Number(`0.${"0".repeat(precision - 1)}1`) : 1
    return { min, max, step }
  }

  /** Validate values object against parameter definitions (required/type/choices). */
  validateParameters(
    data: { [key: string]: unknown },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = []
    const validParams = this.getRenderableParameters(parameters)

    for (const param of validParams) {
      if (param.type === ParameterType.GEOMETRY) {
        continue
      }
      const value = data[param.name]
      const isMissingRequired = !param.optional && isEmpty(value)
      if (isMissingRequired) {
        errors.push(`${param.name}:required`)
        continue
      }

      if (!isEmpty(value)) {
        const typeError = this.validateParameterType(param, value)
        if (typeError) {
          errors.push(typeError)
          continue
        }

        const choiceError = this.validateParameterChoices(param, value)
        if (choiceError) {
          errors.push(choiceError)
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  /** Validate primitive type constraints per parameter type. */
  private validateParameterType(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    switch (param.type) {
      case ParameterType.INTEGER:
        return isInt(value) ? null : `${param.name}:integer`
      case ParameterType.FLOAT:
        return isNum(value) ? null : `${param.name}:number`
      default:
        return null
    }
  }

  /** Validate enum/choice membership for select and multi-select parameters. */
  private validateParameterChoices(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    const validChoices = buildChoiceSet(param.listOptions)
    if (!validChoices) return null

    if (MULTI_SELECT_TYPES.has(param.type)) {
      const values = Array.isArray(value) ? value : [value]
      if (values.some((v) => !validChoices.has(normalizeParameterValue(v)))) {
        return `${param.name}:choice`
      }
    } else if (!validChoices.has(normalizeParameterValue(value))) {
      return `${param.name}:choice`
    }

    return null
  }

  convertParametersToFields(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    if (!parameters?.length) return []

    return this.getRenderableParameters(parameters).map((param) => {
      const type = this.getFieldType(param)
      const options = this.mapListOptions(param.listOptions)
      const { min, max, step } = this.getSliderMeta(param)
      const field: DynamicFieldConfig = {
        name: param.name,
        label: param.description || param.name,
        type,
        required: !param.optional,
        readOnly:
          type === FormFieldType.MESSAGE ||
          type === FormFieldType.SCRIPTED ||
          type === FormFieldType.GEOMETRY,
        description: param.description,
        defaultValue:
          param.type === ParameterType.GEOMETRY
            ? ("" as FormPrimitive)
            : (param.defaultValue as FormPrimitive),
        placeholder: param.description || "",
        // Only include options if non-empty
        ...(options?.length ? { options: [...options] } : {}),
        ...(param.type === ParameterType.TEXT_EDIT ? { rows: 3 } : {}),
        ...(min !== undefined || max !== undefined || step !== undefined
          ? { min, max, step }
          : {}),
      }
      return field
    }) as readonly DynamicFieldConfig[]
  }

  /** Map parameter type to a UI field type. */
  private getFieldType(param: WorkspaceParameter): FormFieldType {
    const override = PARAMETER_FIELD_TYPE_MAP[param.type]
    if (override) return override

    const hasOptions = param.listOptions?.length > 0
    if (hasOptions) {
      return MULTI_SELECT_TYPES.has(param.type)
        ? FormFieldType.MULTI_SELECT
        : FormFieldType.SELECT
    }

    return FormFieldType.TEXT
  }

  validateFormValues(
    values: { [key: string]: unknown },
    fields: readonly DynamicFieldConfig[]
  ): { isValid: boolean; errors: { [key: string]: string } } {
    if (!values || !fields?.length) return { isValid: true, errors: {} }

    const errors: { [key: string]: string } = {}

    for (const field of fields) {
      const value = values[field.name]
      const hasValue = !isEmpty(value)

      if (field.type === FormFieldType.GEOMETRY) {
        continue
      }

      if (field.type === FormFieldType.TEXT_OR_FILE) {
        const tf = value as TextOrFileValue | undefined
        const hasText =
          typeof tf?.text === "string" && tf.text.trim().length > 0
        const hasFile = isFileObject(tf?.file)
        if (field.required && !hasText && !hasFile) {
          errors[field.name] = ""
        }
        continue
      }

      if (field.required && !hasValue) {
        errors[field.name] = ""
      } else if (
        hasValue &&
        field.type === FormFieldType.NUMBER &&
        !isNum(value)
      ) {
        errors[field.name] = ""
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors }
  }
}

/**
 * Parse repository names from API response
 */
function parseRepositoryNames(data: unknown): string[] {
  return extractRepositoryNames(data)
}

function deriveFmeVersionString(info: unknown): string {
  const d: any = (info as any) ?? {}
  const data = d?.data ?? d
  const pickString = (v: unknown): string | undefined => {
    if (typeof v === "string") {
      const t = v.trim()
      return t || undefined
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      return String(v)
    }
    return undefined
  }

  const candidates = [
    pickString(data?.version),
    pickString(data?.fmeVersion),
    pickString(data?.fmeflowVersion),
    pickString(data?.app?.version),
    pickString(data?.about?.version),
    pickString(data?.server?.version),
    pickString(data?.edition),
    pickString(data?.build),
    pickString(data?.productName),
    pickString(data?.product),
    pickString(data?.name),
  ].filter((v): v is string => !!v)

  const extractNumeric = (s: string): string | undefined => {
    const m = s.match(/(\b\d+\.\d+(?:\.\d+)?\b|\b20\d{2}(?:\.\d+)?\b)/)
    return m ? m[1] : undefined
  }

  for (const c of candidates) {
    const n = extractNumeric(c)
    if (n) return n
  }
  try {
    for (const val of Object.values(data || {})) {
      if (typeof val === "string") {
        const n = extractNumeric(val)
        if (n) return n
      }
    }
  } catch {
    // ignore
  }

  // As a last resort, try to stringify and extract from that
  try {
    const blob = JSON.stringify(data)
    if (blob && typeof blob === "string") {
      const m = blob.match(/(\b\d+\.\d+(?:\.\d+)?\b|\b20\d{2}(?:\.\d+)?\b)/)
      if (m) return m[1]
    }
  } catch {
    // ignore
  }

  return ""
}

/**
 * Quick health check for FME Flow server
 * Provides basic connectivity and version information
 */
/**
 * Quick health check for FME Flow server.
 * - Validates URL format locally first.
 * - Calls /info and classifies results into reachable/network/auth/server.
 * - Deduplicates concurrent calls per (serverUrl|token).
 */
export async function healthCheck(
  serverUrl: string,
  token: string,
  signal?: AbortSignal
): Promise<{
  reachable: boolean
  version?: string
  responseTime?: number
  error?: string
  status?: number
}> {
  const key = `${serverUrl}|${token}`
  // Basic URL validation - if URL is malformed, don't even try
  const urlValidation = validateServerUrl(serverUrl)
  if (!urlValidation.ok) {
    return {
      reachable: false,
      responseTime: 0,
      error: "invalidUrl",
      status: 0,
    }
  }

  return withInflight(inFlight.healthCheck, key, async () => {
    const startTime = Date.now()
    try {
      // Instantiate API client directly so Jest class mocks are honored in tests
      const client = createFmeClient(serverUrl, token)

      const response = await client.testConnection(signal)
      const responseTime = Date.now() - startTime

      return {
        reachable: true,
        version: deriveFmeVersionString(response),
        responseTime,
      }
    } catch (error) {
      const responseTime = Date.now() - startTime
      const status = extractHttpStatus(error)
      const errorMessage = extractErrorMessage(error)

      if (status === 401 || status === 403) {
        if (
          NETWORK_INDICATORS.some((indicator) =>
            errorMessage.toLowerCase().includes(indicator.toLowerCase())
          )
        ) {
          return {
            reachable: false,
            responseTime,
            error: errorMessage,
            status,
          }
        }

        // Additional server URL verification using centralized validator and hostname heuristic
        const strictValidation = validateServerUrl(serverUrl, { strict: true })
        if (!strictValidation.ok) {
          return {
            reachable: false,
            responseTime,
            error: "invalidUrl",
            status,
          }
        }
        return { reachable: true, responseTime, status }
      }

      // All other HTTP errors or network errors = unreachable
      return {
        reachable: false,
        responseTime,
        error: errorMessage,
        status,
      }
    }
  })
}

// Helper to get user-friendly error message based on status
/**
 * Validates server URL, token, and optionally a repository.
 * Provides step-by-step status and friendly error classification.
 * Deduplicates concurrent calls per (serverUrl|token|repository).
 */
export async function validateConnection(
  options: ConnectionValidationOptions
): Promise<ConnectionValidationResult> {
  const { serverUrl, token, repository, signal } = options

  const key = `${serverUrl}|${token}|${repository || "_"}`

  const steps: CheckSteps = {
    serverUrl: "pending",
    token: "pending",
    repository: repository ? "pending" : "skip",
    version: "",
  }

  return withInflight(
    inFlight.validateConnection,
    key,
    async (): Promise<ConnectionValidationResult> => {
      try {
        const client = createFmeClient(
          serverUrl,
          token,
          repository ? { repository } : {}
        )

        // Step 1: Test connection and get server info
        let serverInfo: any
        try {
          serverInfo = await client.testConnection(signal)
          steps.serverUrl = "ok"
          steps.token = "ok"
          steps.version = deriveFmeVersionString(serverInfo)
        } catch (error) {
          if (isAbortError(error)) {
            return {
              success: false,
              steps,
              error: {
                message: (error as Error).message || "aborted",
                type: "generic",
                status: 0,
              },
            }
          }
          const status = extractHttpStatus(error)

          if (status === 401) {
            // Clear token failure without extra network checks
            steps.serverUrl = "ok"
            steps.token = "fail"
            return {
              success: false,
              steps,
              error: {
                message: mapErrorToKey(error, status),
                type: "token",
                status,
              },
            }
          } else if (status === 403) {
            const rawMessage = extractErrorMessage(error)
            if (
              PROXY_HINTS.some((h) =>
                rawMessage.toLowerCase().includes(h.toLowerCase())
              )
            ) {
              // Proxy forbids or cannot reach upstream → treat as server/connectivity
              steps.serverUrl = "fail"
              steps.token = "skip"
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorToKey(error, status),
                  type: "server",
                  status,
                },
              }
            }
            // Could be auth error OR server URL error - verify reachability once
            try {
              const healthResult = await healthCheck(serverUrl, token, signal)

              if (healthResult.reachable) {
                // Server is reachable but token invalid/forbidden
                steps.serverUrl = "ok"
                steps.token = "fail"
                return {
                  success: false,
                  steps,
                  error: {
                    message: mapErrorToKey(error, status),
                    type: "token",
                    status,
                  },
                }
              } else {
                steps.serverUrl = "fail"
                steps.token = "skip"
                return {
                  success: false,
                  steps,
                  error: {
                    message: mapErrorToKey(error, status),
                    type: "server",
                    status,
                  },
                }
              }
            } catch (healthError) {
              steps.serverUrl = "fail"
              steps.token = "skip"
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorToKey(error, status),
                  type: "server",
                  status,
                },
              }
            }
          } else {
            // Server not reachable
            steps.serverUrl = "fail"
            steps.token = "skip"
            return {
              success: false,
              steps,
              error: {
                message: mapErrorToKey(error, status),
                type: status === 0 ? "network" : "server",
                status,
              },
            }
          }
        }
        let repositories: string[] = []
        try {
          const reposResp = await client.getRepositories(signal)
          repositories = parseRepositoryNames(reposResp?.data)
        } catch (error) {
          repositories = []
        }

        // Step 3: Validate specific repository if provided
        if (repository) {
          try {
            await client.validateRepository(repository, signal)
            steps.repository = "ok"
          } catch (error) {
            steps.repository = "fail"
            return {
              success: false,
              repositories,
              steps,
              error: {
                message: "repositoryNotAccessible",
                type: "repository",
              },
            }
          }
        }

        return {
          success: true,
          version: typeof steps.version === "string" ? steps.version : "",
          repositories,
          steps,
        }
      } catch (error) {
        if (isAbortError(error)) {
          return {
            success: false,
            steps,
            error: {
              message: (error as Error).message || "aborted",
              type: "generic",
              status: 0,
            },
          }
        }

        const status = extractHttpStatus(error)
        return {
          success: false,
          steps,
          error: {
            message: mapErrorToKey(error, status),
            type: "generic",
            status,
          },
        }
      }
    }
  )
}

// Test connection and get version info
/** Basic connectivity check that returns version string when available. */
export async function testBasicConnection(
  serverUrl: string,
  token: string,
  signal?: AbortSignal
): Promise<{
  success: boolean
  version?: string
  error?: string
  originalError?: unknown
}> {
  const key = `${serverUrl}|${token}`
  return withInflight(inFlight.testBasicConnection, key, async () => {
    try {
      const client = createFmeClient(serverUrl, token)

      const info = await client.testConnection(signal)
      return {
        success: true,
        version: deriveFmeVersionString(info),
      }
    } catch (error) {
      return {
        success: false,
        error: mapErrorToKey(error, extractHttpStatus(error)),
        originalError: error, // Keep original error for better categorization
      }
    }
  })
}

// Get repositories list from server
/** Fetch repositories and normalize to a list of strings; dedupes concurrent calls per (serverUrl|token). */
export async function getRepositories(
  serverUrl: string,
  token: string,
  signal?: AbortSignal
): Promise<{ success: boolean; repositories?: string[]; error?: string }> {
  // If already aborted, throw to allow callers to ignore gracefully
  if (signal?.aborted) {
    throw createAbortError()
  }

  // When a signal is provided (typical for settings UI), bypass dedup
  // to avoid race conditions where a newly-triggered request reuses an aborted promise.
  const execute = async () => {
    try {
      const client = createFmeClient(serverUrl, token)

      const resp = await client.getRepositories(signal)
      // If the underlying API returned a synthetic aborted response, surface it as an AbortError
      if (
        (resp as any)?.status === 0 ||
        (resp as any)?.statusText === "requestAborted"
      ) {
        throw createAbortError()
      }
      const repositories = parseRepositoryNames(resp?.data)

      return {
        success: true,
        repositories,
      }
    } catch (error) {
      if (isAbortError(error)) {
        // Re-throw as a proper Error-derived object to satisfy lint rules
        throw createAbortError((error as Error).message || undefined)
      }
      return {
        success: false,
        error: mapErrorToKey(error, extractHttpStatus(error)),
      }
    }
  }

  if (signal) {
    return await execute()
  }

  const key = `${serverUrl}|${token}`
  return withInflight(inFlight.getRepositories, key, execute)
}

// Widget startup validation
/**
 * End-to-end startup validation:
 * - Required config fields
 * - Connection & repository reachability
 * Returns a structured result for the UI to proceed or show guidance.
 */
export async function validateWidgetStartup(
  options: StartupValidationOptions
): Promise<StartupValidationResult> {
  const { config, translate, signal, mapConfigured } = options

  // Step 1: Check if config exists
  if (!config) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "startupConfigError",
        ErrorType.CONFIG,
        "configMissing",
        translate,
        {
          suggestion: translate("openSettingsPanel"),
          userFriendlyMessage: translate("startupConfigErrorHint"),
        }
      ),
    }
  }

  // Step 2: Validate required config fields
  const requiredFieldsResult = validateRequiredFields(config, translate, {
    mapConfigured: mapConfigured ?? true,
  })
  if (!requiredFieldsResult.isValid) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "startupConfigError",
        ErrorType.CONFIG,
        "CONFIG_INCOMPLETE",
        translate
      ),
    }
  }

  // Step 3: Test FME Flow connection
  try {
    const connectionResult = await validateConnection({
      serverUrl: config.fmeServerUrl,
      token: config.fmeServerToken,
      repository: config.repository,
      signal,
    })

    if (!connectionResult.success) {
      return {
        isValid: false,
        canProceed: false,
        requiresSettings: true,
        error: createError(
          connectionResult.error?.message || "startupConnectionError",
          ErrorType.NETWORK,
          connectionResult.error?.type?.toUpperCase() || "CONNECTION_ERROR",
          translate,
          {
            suggestion:
              connectionResult.error?.type === "token"
                ? translate("checkTokenSettings")
                : connectionResult.error?.type === "server"
                  ? translate("checkServerUrlSettings")
                  : connectionResult.error?.type === "repository"
                    ? translate("checkRepositorySettings")
                    : translate("checkConnectionSettings"),
          }
        ),
      }
    }

    // All validation passed
    return {
      isValid: true,
      canProceed: true,
      requiresSettings: false,
    }
  } catch (error) {
    if (isAbortError(error)) {
      // Don't treat abort as an error - just return neutral state
      return {
        isValid: false,
        canProceed: false,
        requiresSettings: false,
      }
    }

    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "startupNetworkError",
        ErrorType.NETWORK,
        "STARTUP_NETWORK_ERROR",
        translate,
        {
          suggestion: translate("checkNetworkConnection"),
        }
      ),
    }
  }
}
