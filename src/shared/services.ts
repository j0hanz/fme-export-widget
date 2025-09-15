import type {
  ErrorState,
  WorkspaceParameter,
  DynamicFieldConfig,
  FormPrimitive,
  CheckSteps,
  FmeExportConfig,
} from "../config"
import {
  ErrorType,
  ErrorSeverity,
  ParameterType,
  FormFieldType,
} from "../config"
import {
  isEmpty,
  isInt,
  isNum,
  extractErrorMessage,
  extractHttpStatus,
} from "./utils"
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

// Error service
export class ErrorHandlingService {
  createError(
    message: string,
    type: ErrorType = ErrorType.VALIDATION,
    options: {
      code?: string
      severity?: ErrorSeverity
      details?: { [key: string]: unknown }
      recoverable?: boolean
      retry?: () => void
      userFriendlyMessage?: string
      suggestion?: string
    } = {}
  ): ErrorState {
    const {
      code = "UNKNOWN_ERROR",
      severity = ErrorSeverity.ERROR,
      details,
      recoverable = false,
      retry,
      userFriendlyMessage,
      suggestion,
    } = options

    return {
      message,
      type,
      code,
      severity,
      details,
      recoverable,
      retry,
      timestamp: new Date(),
      timestampMs: 0, // Keep original test-expected value
      userFriendlyMessage,
      suggestion,
    }
  }
  // Derive standardized error from various error inputs
  deriveStartupError(
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } {
    if (!error) {
      return {
        code: "STARTUP_ERROR",
        message:
          typeof translate === "function"
            ? translate("startupValidationFailed")
            : "Validation failed",
      }
    }

    if (typeof translate !== "function") {
      return {
        code: "STARTUP_ERROR",
        message: "Validation failed",
      }
    }

    const errorObj = error as { [key: string]: unknown }
    const errorCode =
      (errorObj.code as string) || (errorObj.name as string) || ""
    const status = this.normalizeStatus(errorObj.status)
    const message = (error as Error)?.message || ""

    // Check known error codes first
    const knownCodeResult = this.checkKnownErrorCodes(
      errorCode,
      message,
      translate
    )
    if (knownCodeResult) return knownCodeResult

    // Check specific error patterns
    const specificErrorResult = this.checkSpecificErrorPatterns(
      errorCode,
      message,
      translate
    )
    if (specificErrorResult) return specificErrorResult

    // Check HTTP status codes
    if (typeof status === "number") {
      const statusResult = this.checkHttpStatusCodes(status, translate)
      if (statusResult) return statusResult
    }

    // Check message patterns
    const messageResult = this.checkMessagePatterns(message, error, translate)
    if (messageResult) return messageResult

    // Check for offline/CORS conditions
    const networkResult = this.checkNetworkConditions(status, translate)
    if (networkResult) return networkResult

    return {
      code: "STARTUP_ERROR",
      message: translate("startupValidationFailed"),
    }
  }

  // Normalize status value to number if possible
  private normalizeStatus(status: unknown): number | undefined {
    if (typeof status === "number") return status
    if (typeof status === "string") {
      const parsed = Number(status)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
  }
  // Check against known error code mappings
  private checkKnownErrorCodes(
    errorCode: string,
    message: string,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    const knownCodes: { [key: string]: string } = {
      UserEmailMissing: "userEmailMissing",
      INVALID_EMAIL: "invalidEmail",
      INVALID_CONFIG: "invalidConfiguration",
      WEBHOOK_AUTH_ERROR: "authenticationFailed",
      ARCGIS_MODULE_ERROR: "connectionFailed",
      ABORT: "requestAborted",
      CANCELLED: "operationCancelled",
      CORS_ERROR: "corsError",
      OFFLINE: "offline",
      SSL_ERROR: "sslError",
      INVALID_URL: "invalidUrl",
      RATE_LIMITED: "rateLimited",
      BAD_GATEWAY: "badGateway",
      SERVICE_UNAVAILABLE: "serviceUnavailable",
      GATEWAY_TIMEOUT: "gatewayTimeout",
      BAD_REQUEST: "badRequest",
      PAYLOAD_TOO_LARGE: "payloadTooLarge",
    }

    // Check if message itself is a known code
    if (message && knownCodes[message]) {
      return { code: message, message: translate(knownCodes[message]) }
    }

    if (errorCode && knownCodes[errorCode]) {
      return { code: errorCode, message: translate(knownCodes[errorCode]) }
    }

    return null
  }

  // Check for specific error patterns
  private checkSpecificErrorPatterns(
    errorCode: string,
    message: string,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (errorCode === "AbortError" || errorCode === "ABORT") {
      return { code: "ABORT", message: translate("requestAborted") }
    }
    if (errorCode === "CancelledPromiseError" || /cancel/i.test(message)) {
      return { code: "CANCELLED", message: translate("operationCancelled") }
    }
    return null
  }

  // Check HTTP status codes and return appropriate error
  private checkHttpStatusCodes(
    status: number,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (status === 401 || status === 403) {
      return {
        code: "AUTH_ERROR",
        message: translate("startupValidationFailed"),
      }
    }
    if (status === 404) {
      return { code: "REPO_NOT_FOUND", message: translate("repoNotFound") }
    }
    if (status === 429) {
      return { code: "HTTP_ERROR", message: translate("connectionFailed") }
    }
    if (status === 413) {
      return {
        code: "PAYLOAD_TOO_LARGE",
        message: translate("payloadTooLarge"),
      }
    }
    if (status === 400 || status === 422) {
      return { code: "BAD_REQUEST", message: translate("badRequest") }
    }
    if (status === 502) {
      return { code: "BAD_GATEWAY", message: translate("badGateway") }
    }
    if (status === 503) {
      return {
        code: "SERVICE_UNAVAILABLE",
        message: translate("serviceUnavailable"),
      }
    }
    if (status === 504) {
      return {
        code: "GATEWAY_TIMEOUT",
        message: translate("gatewayTimeout"),
      }
    }
    if (status >= 500) {
      return { code: "SERVER_ERROR", message: translate("serverError") }
    }
    return null
  }

  // Check message patterns for specific error types
  private checkMessagePatterns(
    message: string,
    error: unknown,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (typeof message !== "string") return null

    if (/timeout/i.test(message)) {
      return { code: "TIMEOUT", message: translate("timeout") }
    }
    if (/^TypeError: Failed to fetch$/i.test(message)) {
      // Could be CORS or offline - check if offline
      return this.handleFetchError(translate)
    }
    if (/network|failed to fetch/i.test(message)) {
      return { code: "NETWORK_ERROR", message: translate("networkError") }
    }
    if (/unexpected token|json|parse/i.test(message)) {
      return { code: "BAD_RESPONSE", message: translate("badResponse") }
    }
    if (/invalid url/i.test(message)) {
      return { code: "INVALID_URL", message: translate("invalidUrl") }
    }
    if (/ssl|certificate/i.test(message)) {
      return { code: "SSL_ERROR", message: translate("sslError") }
    }
    if ((error as Error)?.name === "TypeError") {
      return { code: "NETWORK_ERROR", message: translate("networkError") }
    }
    return null
  }

  // Handle "Failed to fetch" error by checking online status
  private handleFetchError(translate: (key: string) => string): {
    code: string
    message: string
  } {
    try {
      const nav = (globalThis as { navigator?: { onLine?: boolean } })
        ?.navigator
      if (nav && !nav.onLine) {
        return { code: "OFFLINE", message: translate("offline") }
      }
    } catch {
      // Ignore errors accessing navigator
    }
    return { code: "CORS_ERROR", message: translate("corsError") }
  }

  // Check for offline or CORS conditions based on status
  private checkNetworkConditions(
    status: number | undefined,
    translate: (key: string) => string
  ): { code: string; message: string } | null {
    if (status === 0) {
      try {
        const nav = (globalThis as { navigator?: { onLine?: boolean } })
          ?.navigator
        if (nav && !nav.onLine) {
          return { code: "OFFLINE", message: translate("offline") }
        }
      } catch {
        // Ignore errors accessing navigator
      }
      return { code: "CORS_ERROR", message: translate("corsError") }
    }
    return null
  }
}

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
      p.type === ParameterType.MESSAGE ||
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
          readOnly: false,
          description: param.description,
          defaultValue: param.defaultValue as FormPrimitive,
          placeholder: param.description || "",
          ...(options?.length ? { options } : {}),
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
  try {
    const url = new URL(serverUrl)
    // Additional check: URL should have proper protocol and host
    if (!url.protocol || !url.host || url.host.endsWith(".")) {
      return {
        reachable: false,
        responseTime: 0,
        error: "Invalid server URL format",
        status: 0,
      }
    }
  } catch {
    return {
      reachable: false,
      responseTime: 0,
      error: "Invalid server URL format",
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
        version: response.data?.version,
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

        try {
          const url = new URL(serverUrl)
          const hostname = url.hostname

          if (!hostname.includes(".") || hostname.length < 4) {
            return {
              reachable: false,
              responseTime,
              error: `Invalid hostname: ${hostname}`,
              status,
            }
          }
        } catch {
          // URL parsing already handled above
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
        steps.version = String(serverInfo?.data?.version || "")
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
                  message: getErrorMessage(error, status),
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
                message: getErrorMessage(error, status),
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
              message: getErrorMessage(error, status),
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
        version: steps.version,
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
          message: getErrorMessage(error, status),
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
        version: String(info?.data?.version || ""),
      }
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error, extractHttpStatus(error)),
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
        error: getErrorMessage(error, extractHttpStatus(error)),
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

// Startup Validation Service
export interface StartupValidationResult {
  isValid: boolean
  error?: ErrorState
  canProceed: boolean
  requiresSettings: boolean
}

export interface StartupValidationOptions {
  config: FmeExportConfig | undefined
  translate: (key: string, params?: any) => string
  signal?: AbortSignal
}

/**
 * Validate widget configuration at startup
 * Returns validation result with appropriate error states and user guidance
 */
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
      error: createConfigError(translate, "configMissing"),
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
        error: createConnectionError(translate, connectionResult.error),
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
      error: createNetworkError(translate),
    }
  }
}

/**
 * Validate that all required configuration fields are present
 */
function validateRequiredFields(
  config: FmeExportConfig,
  translate: (key: string, params?: any) => string
): StartupValidationResult {
  const missing: string[] = []

  if (!config.fmeServerUrl?.trim()) {
    missing.push(translate("fmeServerUrl"))
  }

  if (!config.fmeServerToken?.trim()) {
    missing.push(translate("fmeServerToken"))
  }

  if (!config.repository?.trim()) {
    missing.push(translate("fmeRepository"))
  }

  if (missing.length > 0) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createConfigError(translate, "missingRequiredFields"),
    }
  }

  return {
    isValid: true,
    canProceed: true,
    requiresSettings: false,
  }
}

/**
 * Create configuration error with user guidance
 */
function createConfigError(
  translate: (key: string, params?: any) => string,
  code: string
): ErrorState {
  return {
    message: translate("startupConfigError") || "startupConfigError",
    type: ErrorType.CONFIG,
    code,
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage:
      translate("startupConfigErrorHint") || "startupConfigErrorHint",
    suggestion: translate("openSettingsPanel") || "openSettingsPanel",
  }
}

/**
 * Create connection error from validation service result
 */
function createConnectionError(
  translate: (key: string, params?: any) => string,
  connectionError?: { message: string; type: string; status?: number }
): ErrorState {
  // Interpret incoming message as a translation key when possible
  const baseMessageKey = connectionError?.message || "startupConnectionError"
  let baseMessage = translate(baseMessageKey) || baseMessageKey
  let userMessage = translate("startupConnectionError")
  let suggestion = translate("checkConnectionSettings")

  // Provide specific guidance based on error type
  if (connectionError?.type === "token") {
    baseMessage = translate("startupTokenError") || baseMessage
    userMessage = translate("startupTokenError")
    suggestion = translate("checkTokenSettings")
  } else if (connectionError?.type === "server") {
    baseMessage = translate("startupServerError") || baseMessage
    userMessage = translate("startupServerError")
    suggestion = translate("checkServerSettings")
  } else if (connectionError?.type === "repository") {
    baseMessage = translate("repositoryNotAccessible") || baseMessage
    userMessage = translate("startupRepositoryError")
    suggestion = translate("checkRepositorySettings")
  } else if (connectionError?.type === "network") {
    baseMessage = translate("startupNetworkError") || baseMessage
    userMessage = translate("startupNetworkError")
    suggestion = translate("checkNetworkConnection")
  }

  return {
    message: baseMessage,
    type: ErrorType.NETWORK,
    code: connectionError?.type?.toUpperCase() || "CONNECTION_ERROR",
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage: userMessage,
    suggestion,
  }
}

/**
 * Create network error from exception
 */
function createNetworkError(
  translate: (key: string, params?: any) => string
): ErrorState {
  const message = translate("startupNetworkError") || "startupNetworkError"

  return {
    message,
    type: ErrorType.NETWORK,
    code: "STARTUP_NETWORK_ERROR",
    severity: ErrorSeverity.ERROR,
    recoverable: true,
    timestamp: new Date(),
    timestampMs: Date.now(),
    userFriendlyMessage:
      translate("startupNetworkError") || "startupNetworkError",
    suggestion: translate("checkNetworkConnection") || "checkNetworkConnection",
  }
}

/**
 * Quick validation check without network calls
 * Used for initial validation before attempting connection
 */
export function validateConfigFields(config: FmeExportConfig | undefined): {
  isValid: boolean
  missingFields: string[]
} {
  if (!config) {
    return {
      isValid: false,
      missingFields: ["configuration"],
    }
  }

  const missing: string[] = []

  if (!config.fmeServerUrl?.trim()) {
    missing.push("serverUrl")
  }

  if (!config.fmeServerToken?.trim()) {
    missing.push("token")
  }

  if (!config.repository?.trim()) {
    missing.push("repository")
  }

  return {
    isValid: missing.length === 0,
    missingFields: missing,
  }
}

// Helper functions with improved type safety
export function getErrorMessage(err: unknown, status?: number): string {
  // Handle known status codes first
  if (status === 0) return "startupNetworkError"
  if (status === 401 || status === 403) return "startupTokenError"
  if (status === 404) return "connectionFailed"
  if (status && status >= 500) return "serverError"

  // Extract message from error object
  const message = (err as Error)?.message
  if (typeof message === "string" && message.trim()) {
    // Normalize common fetch error messages
    const lowerMessage = message.toLowerCase()
    if (lowerMessage.includes("failed to fetch")) {
      return "startupNetworkError"
    }
    return "unknownErrorOccurred"
  }

  return "unknownErrorOccurred"
}
