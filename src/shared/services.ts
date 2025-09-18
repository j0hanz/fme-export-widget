import type {
  WorkspaceParameter,
  DynamicFieldConfig,
  FormPrimitive,
  CheckSteps,
} from "../config"
import { ParameterType, FormFieldType, ErrorType } from "../config"
import { isEmpty } from "./utils"
import {
  isInt,
  isNum,
  extractErrorMessage,
  extractHttpStatus,
  validateServerUrl,
  validateRequiredFields,
  createError,
  mapErrorToKey,
  type StartupValidationResult,
  type StartupValidationOptions,
} from "./validations"
import FmeFlowApiClient from "./api"

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

// ErrorHandlingService now lives in ./validations and is re-exported above

// Parameter service
export class ParameterFormService {
  private readonly skipParams = [
    "MAXX",
    "MINX",
    "MAXY",
    "MINY",
    "AreaOfInterest",
    "tm_ttc",
    "tm_ttl",
    "tm_tag",
  ]

  private isRenderableParam(
    p: WorkspaceParameter | null | undefined
  ): p is WorkspaceParameter {
    if (!p || typeof p.name !== "string") return false
    if (this.skipParams.includes(p.name)) return false
    if (
      p.type === ParameterType.NOVALUE ||
      p.type === ParameterType.GEOMETRY ||
      p.type === ParameterType.SCRIPTED
    ) {
      return false
    }
    if (
      p.type === ParameterType.DB_CONNECTION ||
      p.type === ParameterType.WEB_CONNECTION ||
      p.type === ParameterType.ATTRIBUTE_NAME ||
      p.type === ParameterType.ATTRIBUTE_LIST
    ) {
      return Array.isArray(p.listOptions) && p.listOptions.length > 0
    }

    return true
  }

  private mapListOptions(
    list: WorkspaceParameter["listOptions"]
  ): ReadonlyArray<{ label: string; value: string | number }> | undefined {
    if (!list || !list.length) return undefined
    return list.map((o) => {
      const valueStr =
        typeof o.value === "string" || typeof o.value === "number"
          ? String(o.value)
          : JSON.stringify(o.value)
      return {
        label: o.caption || valueStr,
        value:
          typeof o.value === "string" || typeof o.value === "number"
            ? o.value
            : valueStr,
      }
    })
  }

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

  // Validate parameters against definitions
  validateParameters(
    data: { [key: string]: unknown },
    parameters: readonly WorkspaceParameter[]
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = []
    const validParams = parameters.filter((p) => this.isRenderableParam(p))

    for (const param of validParams) {
      const value = data[param.name]

      // Check required fields
      if (!param.optional && isEmpty(value)) {
        errors.push(`${param.name}:required`)
        continue
      }

      if (!isEmpty(value)) {
        // Validate types
        const typeError = this.validateParameterType(param, value)
        if (typeError) {
          errors.push(typeError)
          continue
        }

        // Validate choices
        const choiceError = this.validateParameterChoices(param, value)
        if (choiceError) {
          errors.push(choiceError)
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  // Validate parameter type constraints
  private validateParameterType(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    if (param.type === ParameterType.INTEGER && !isInt(value)) {
      return `${param.name}:integer`
    }

    if (param.type === ParameterType.FLOAT && !isNum(value)) {
      return `${param.name}:number`
    }

    return null
  }

  // Validate parameter choice constraints
  private validateParameterChoices(
    param: WorkspaceParameter,
    value: unknown
  ): string | null {
    if (!param.listOptions?.length) return null

    const validChoices = param.listOptions.map((opt) => opt.value)
    const isMulti =
      param.type === ParameterType.LISTBOX ||
      param.type === ParameterType.LOOKUP_LISTBOX

    if (isMulti) {
      const values = Array.isArray(value) ? value : [value]
      if (values.some((v) => !validChoices.includes(v))) {
        return `${param.name}:choice`
      }
    } else if (!validChoices.includes(value)) {
      return `${param.name}:choice`
    }

    return null
  }

  convertParametersToFields(
    parameters: readonly WorkspaceParameter[]
  ): readonly DynamicFieldConfig[] {
    if (!parameters?.length) return []

    return parameters
      .filter((p) => this.isRenderableParam(p))
      .map((param) => {
        const type = this.getFieldType(param)
        const options = this.mapListOptions(param.listOptions)
        const { min, max, step } = this.getSliderMeta(param)
        const field: DynamicFieldConfig = {
          name: param.name,
          label: param.description || param.name,
          type,
          required: !param.optional,
          readOnly: type === FormFieldType.MESSAGE,
          description: param.description,
          defaultValue: param.defaultValue as FormPrimitive,
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

  private getFieldType(param: WorkspaceParameter): FormFieldType {
    const hasOptions = param.listOptions?.length > 0
    if (hasOptions) {
      const isMulti =
        param.type === ParameterType.LISTBOX ||
        param.type === ParameterType.LOOKUP_LISTBOX ||
        param.type === ParameterType.ATTRIBUTE_LIST
      return isMulti ? FormFieldType.MULTI_SELECT : FormFieldType.SELECT
    }

    const typeMap: { [key in ParameterType]?: FormFieldType } = {
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
      [ParameterType.REPROJECTION_FILE]: FormFieldType.FILE,
      [ParameterType.ATTRIBUTE_NAME]: FormFieldType.SELECT,
      [ParameterType.DB_CONNECTION]: FormFieldType.SELECT,
      [ParameterType.WEB_CONNECTION]: FormFieldType.SELECT,
      [ParameterType.MESSAGE]: FormFieldType.MESSAGE,
    }
    return typeMap[param.type] || FormFieldType.TEXT
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

// Connection Validation Service
export interface ConnectionValidationOptions {
  serverUrl: string
  token: string
  repository?: string
  signal?: AbortSignal
}

export interface ConnectionValidationResult {
  success: boolean
  version?: string
  repositories?: string[]
  error?: {
    message: string
    type: "server" | "token" | "repository" | "network" | "generic"
    status?: number
  }
  steps: CheckSteps
}

/**
 * Parse repository names from API response
 */
function parseRepositoryNames(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  return (data as Array<{ name?: unknown }>)
    .map((r) => r?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0)
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
  const existing = inFlight.healthCheck.get(key)
  if (existing) return existing

  const startTime = Date.now()

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

  const promise = (async () => {
    try {
      // Instantiate API client directly so Jest class mocks are honored in tests
      const client = new FmeFlowApiClient({
        serverUrl,
        token,
        repository: "_",
      })

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
        const networkIndicators = [
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
        ]

        if (
          networkIndicators.some((indicator) =>
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
  })()

  inFlight.healthCheck.set(key, promise)
  try {
    const res = await promise
    return res
  } finally {
    inFlight.healthCheck.delete(key)
  }
}

// Helper to get user-friendly error message based on status
export async function validateConnection(
  options: ConnectionValidationOptions
): Promise<ConnectionValidationResult> {
  const { serverUrl, token, repository, signal } = options

  const key = `${serverUrl}|${token}|${repository || "_"}`
  const existing = inFlight.validateConnection.get(key)
  if (existing) return existing

  const steps: CheckSteps = {
    serverUrl: "pending",
    token: "pending",
    repository: repository ? "pending" : "skip",
    version: "",
  }

  const promise = (async (): Promise<ConnectionValidationResult> => {
    try {
      const client = new FmeFlowApiClient({
        serverUrl,
        token,
        repository: repository || "_",
      })

      // Step 1: Test connection and get server info
      let serverInfo: any
      try {
        serverInfo = await client.testConnection(signal)
        steps.serverUrl = "ok"
        steps.token = "ok"
        steps.version = deriveFmeVersionString(serverInfo)
      } catch (error) {
        if ((error as Error)?.name === "AbortError") {
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
              message: "startupTokenError",
              type: "token",
              status,
            },
          }
        } else if (status === 403) {
          const rawMessage = extractErrorMessage(error)
          const proxyHints = ["Unable to load", "/sharing/proxy", "proxy"]
          if (
            proxyHints.some((h) =>
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
                message: "startupServerError",
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
                  message: "startupTokenError",
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
      if ((error as Error)?.name === "AbortError") {
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
  })()

  inFlight.validateConnection.set(key, promise)
  try {
    const res = await promise
    return res
  } finally {
    inFlight.validateConnection.delete(key)
  }
}

// Test connection and get version info
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
  const existing = inFlight.testBasicConnection.get(key)
  if (existing) return existing

  const promise = (async () => {
    try {
      const client = new FmeFlowApiClient({
        serverUrl,
        token,
        repository: "_",
      })

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
  })()

  inFlight.testBasicConnection.set(key, promise)
  try {
    const res = await promise
    return res
  } finally {
    inFlight.testBasicConnection.delete(key)
  }
}

// Get repositories list from server
export async function getRepositories(
  serverUrl: string,
  token: string,
  signal?: AbortSignal
): Promise<{ success: boolean; repositories?: string[]; error?: string }> {
  const key = `${serverUrl}|${token}`
  const existing = inFlight.getRepositories.get(key)
  if (existing) return existing

  const promise = (async () => {
    try {
      const client = new FmeFlowApiClient({
        serverUrl,
        token,
        repository: "_",
      })

      const resp = await client.getRepositories(signal)
      const repositories = parseRepositoryNames(resp?.data)

      return {
        success: true,
        repositories,
      }
    } catch (error) {
      return {
        success: false,
        error: mapErrorToKey(error, extractHttpStatus(error)),
      }
    }
  })()

  inFlight.getRepositories.set(key, promise)
  try {
    const res = await promise
    return res
  } finally {
    inFlight.getRepositories.delete(key)
  }
}

// Widget startup validation
export async function validateWidgetStartup(
  options: StartupValidationOptions
): Promise<StartupValidationResult> {
  const { config, translate, signal } = options

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
  const requiredFieldsResult = validateRequiredFields(config, translate)
  if (!requiredFieldsResult.isValid) {
    return requiredFieldsResult
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
    if ((error as Error)?.name === "AbortError") {
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
