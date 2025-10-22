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

        // Step 1: Test connection and get server info
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

        // Step 3: Validate specific repository if provided
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

  // Step 1: Check if config exists
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
        "errorSetupRequired",
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
