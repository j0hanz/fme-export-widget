import type {
  ConnectionValidationOptions,
  ConnectionValidationResult,
  CheckSteps,
  StartupValidationOptions,
  StartupValidationResult,
} from "../../config/index"
import { ErrorType } from "../../config/index"
import { createFmeClient, extractErrorMessage, isAbortError } from "../utils"
import {
  extractHttpStatus,
  validateRequiredFields,
  createError,
  mapErrorToKey,
} from "../validations"
import { inFlight } from "./inflight"
import { healthCheck, extractFmeVersion, hasProxyError } from "./network"

// Validerar FME Flow-anslutning steg-för-steg (URL, token, repository)
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

  return await inFlight.validateConnection.execute(
    key,
    async (): Promise<ConnectionValidationResult> => {
      try {
        const client = createFmeClient(serverUrl, token, repository)

        if (!client) {
          return {
            success: false,
            steps,
            error: {
              message: "connectionFailedMessage",
              type: "server",
              status: 0,
            },
          }
        }

        // Steg 1: Testar anslutning och hämtar serverinfo
        let serverInfo: any
        try {
          serverInfo = await client.testConnection(signal)
          steps.serverUrl = "ok"
          steps.token = "ok"
          steps.version = extractFmeVersion(serverInfo)
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
            if (hasProxyError(rawMessage)) {
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
            try {
              const healthResult = await healthCheck(serverUrl, token, signal)

              if (healthResult.reachable) {
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
            } catch {
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

        const warnings: string[] = []

        // Steg 3: Validerar specifik repository om angiven
        if (repository) {
          try {
            await client.validateRepository(repository, signal)
            steps.repository = "ok"
          } catch (error) {
            const status = extractHttpStatus(error)
            if (status === 401 || status === 403) {
              steps.repository = "skip"
              warnings.push("repositoryNotAccessible")
            } else {
              steps.repository = "fail"
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorToKey(error, status),
                  type: "repository",
                  status,
                },
              }
            }
          }
        }

        return {
          success: true,
          version: typeof steps.version === "string" ? steps.version : "",
          steps,
          warnings: warnings.length ? warnings : undefined,
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

// Validerar widget-uppstart: config, required fields, FME-anslutning
export async function validateWidgetStartup(
  options: StartupValidationOptions
): Promise<StartupValidationResult> {
  const { config, translate, signal, mapConfigured } = options

  // Steg 1: Kontrollerar om config finns
  if (!config) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "errorSetupRequired",
        ErrorType.CONFIG,
        "configMissing",
        translate,
        {
          suggestion: translate("actionOpenSettings"),
          userFriendlyMessage: translate("hintSetupWidget"),
        }
      ),
    }
  }

  // Steg 2: Validerar obligatoriska config-fält
  const requiredFieldsResult = validateRequiredFields(config, translate, {
    mapConfigured: mapConfigured ?? true,
  })
  if (!requiredFieldsResult.isValid) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError(
        "errorSetupRequired",
        ErrorType.CONFIG,
        "CONFIG_INCOMPLETE",
        translate
      ),
    }
  }

  // Steg 3: Testar FME Flow-anslutning
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
          connectionResult.error?.message || "errorConnectionIssue",
          ErrorType.NETWORK,
          connectionResult.error?.type?.toUpperCase() || "CONNECTION_ERROR",
          translate,
          {
            suggestion:
              connectionResult.error?.type === "token"
                ? translate("tokenSettingsHint")
                : connectionResult.error?.type === "server"
                  ? translate("serverUrlSettingsHint")
                  : connectionResult.error?.type === "repository"
                    ? translate("repositorySettingsHint")
                    : translate("connectionSettingsHint"),
          }
        ),
      }
    }

    // All validering lyckades
    return {
      isValid: true,
      canProceed: true,
      requiresSettings: false,
    }
  } catch (error) {
    if (isAbortError(error)) {
      // Behandla inte abort som ett fel - returnera neutralt tillstånd
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
        "errorNetworkIssue",
        ErrorType.NETWORK,
        "STARTUP_NETWORK_ERROR",
        translate,
        {
          suggestion: translate("networkConnectionHint"),
        }
      ),
    }
  }
}

export interface StartupValidationFlowOptions {
  config: any
  useMapWidgetIds: string[]
  translate: (key: string) => string
  signal: AbortSignal
  onProgress: (step: string) => void
}

export interface StartupValidationFlowResult {
  success: boolean
  error?: any
}

export async function runStartupValidationFlow(
  options: StartupValidationFlowOptions
): Promise<StartupValidationFlowResult> {
  const { config, useMapWidgetIds, translate, signal, onProgress } = options

  onProgress(translate("validatingStartup"))

  // Step 1: validate map configuration
  onProgress(translate("statusValidatingMap"))
  const hasMapConfigured =
    Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0

  // Step 2: validate widget config and FME connection
  onProgress(translate("statusValidatingConnection"))
  const validationResult = await validateWidgetStartup({
    config,
    translate,
    signal,
    mapConfigured: hasMapConfigured,
  })

  if (!validationResult.isValid) {
    if (validationResult.error) {
      throw new Error(JSON.stringify(validationResult.error))
    } else if (validationResult.requiresSettings) {
      const err = createError(
        "configurationInvalid",
        ErrorType.CONFIG,
        "VALIDATION_FAILED",
        translate
      )
      throw new Error(JSON.stringify(err))
    }
    return { success: false }
  }

  // Step 3: validate user email for async mode
  if (!config?.syncMode) {
    onProgress(translate("statusValidatingEmail"))
    try {
      const { getEmail, isValidEmail } = await import("../utils")
      const email = await getEmail(config)
      if (!isValidEmail(email)) {
        const err = createError(
          "userEmailMissingError",
          ErrorType.CONFIG,
          "UserEmailMissing",
          translate
        )
        throw new Error(JSON.stringify(err))
      }
    } catch (emailErr) {
      if (isAbortError(emailErr)) {
        return { success: false }
      }
      const err = createError(
        "userEmailMissingError",
        ErrorType.CONFIG,
        "UserEmailMissing",
        translate
      )
      throw new Error(JSON.stringify(err))
    }
  }

  return { success: true }
}
