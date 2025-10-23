import type {
  ConnectionValidationOptions,
  ConnectionValidationResult,
  CheckSteps,
  StartupValidationOptions,
  StartupValidationResult,
  StartupValidationFlowOptions,
  StartupValidationFlowResult,
} from "../../config/index"
import { ErrorType, HTTP_STATUS_CODES } from "../../config/index"
import { createFmeClient, extractErrorMessage, isAbortError } from "../utils"
import { extractHttpStatus, validateRequiredFields } from "../validations"
import { createError, mapErrorFromNetwork } from "../utils/error"
import { inFlight } from "./inflight"
import { healthCheck, extractFmeVersion, hasProxyError } from "./network"
import {
  translationKey as makeKey,
  translationKeys as tk,
  translateKey,
} from "../translations"

const VALIDATION_TRANSLATION_SCOPE = "shared.services.validation"

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
              message: undefined,
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

          if (status === HTTP_STATUS_CODES.UNAUTHORIZED) {
            steps.serverUrl = "ok"
            steps.token = "fail"
            return {
              success: false,
              steps,
              error: {
                message: "errorTokenIssue",
                type: "token",
                status,
              },
            }
          } else if (status === HTTP_STATUS_CODES.FORBIDDEN) {
            const rawMessage = extractErrorMessage(error)
            if (hasProxyError(rawMessage)) {
              steps.serverUrl = "fail"
              steps.token = "skip"
              return {
                success: false,
                steps,
                error: {
                  message: "errorServerUnreachable",
                  type: "server",
                  status,
                },
              }
            }
            try {
              const healthResult = await healthCheck(serverUrl, token, signal)

              if (signal?.aborted) {
                return {
                  success: false,
                  steps,
                  error: {
                    message: "aborted",
                    type: "generic",
                    status: 0,
                  },
                }
              }

              if (healthResult && healthResult && healthResult.reachable) {
                steps.serverUrl = "ok"
                steps.token = "fail"
                return {
                  success: false,
                  steps,
                  error: {
                    message: "errorTokenIssue",
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
                    message: "errorServerUnreachable",
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
                  message: "errorServerUnreachable",
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
                message: mapErrorFromNetwork(error, status),
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
            if (
              status === HTTP_STATUS_CODES.UNAUTHORIZED ||
              status === HTTP_STATUS_CODES.FORBIDDEN
            ) {
              steps.repository = "skip"
              warnings.push("repositoryNotAccessible")
            } else {
              steps.repository = "fail"
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorFromNetwork(error, status),
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
            message: mapErrorFromNetwork(error, status),
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
      error: createError("errorSetupRequired", {
        type: ErrorType.CONFIG,
        code: "configMissing",
        suggestion: translateKey(
          translate,
          tk.action("open", "settings"),
          undefined,
          { scope: `${VALIDATION_TRANSLATION_SCOPE}.suggestions.openSettings` }
        ),
        userFriendlyMessage: translateKey(
          translate,
          tk.hint("setup", "widget"),
          undefined,
          { scope: `${VALIDATION_TRANSLATION_SCOPE}.hints.setupWidget` }
        ),
      }),
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
      error: createError("errorSetupRequired", {
        type: ErrorType.CONFIG,
        code: "CONFIG_INCOMPLETE",
      }),
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
      const errorMessage =
        connectionResult.error?.message || "errorValidationFailed"
      const errorType = connectionResult.error?.type || "server"

      return {
        isValid: false,
        canProceed: false,
        requiresSettings: true,
        error: createError(errorMessage, {
          type: ErrorType.NETWORK,
          code:
            connectionResult.error?.type?.toUpperCase() || "CONNECTION_ERROR",
          suggestion:
            errorType === "token"
              ? translateKey(
                  translate,
                  makeKey("token", "settings", "hint"),
                  undefined,
                  {
                    scope: `${VALIDATION_TRANSLATION_SCOPE}.suggestions.tokenHint`,
                  }
                )
              : errorType === "server"
                ? translateKey(
                    translate,
                    makeKey("server", "url", "settings", "hint"),
                    undefined,
                    {
                      scope: `${VALIDATION_TRANSLATION_SCOPE}.suggestions.serverUrlHint`,
                    }
                  )
                : errorType === "repository"
                  ? translateKey(
                      translate,
                      makeKey("repository", "settings", "hint"),
                      undefined,
                      {
                        scope: `${VALIDATION_TRANSLATION_SCOPE}.suggestions.repositoryHint`,
                      }
                    )
                  : translateKey(
                      translate,
                      makeKey("connection", "settings", "hint"),
                      undefined,
                      {
                        scope: `${VALIDATION_TRANSLATION_SCOPE}.suggestions.connectionHint`,
                      }
                    ),
        }),
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
      error: createError("errorStartupFailed", {
        type: ErrorType.NETWORK,
        code: "STARTUP_NETWORK_ERROR",
        suggestion: translateKey(
          translate,
          makeKey("network", "connection", "hint"),
          undefined,
          { scope: `${VALIDATION_TRANSLATION_SCOPE}.suggestions.networkHint` }
        ),
      }),
    }
  }
}

export async function runStartupValidationFlow(
  options: StartupValidationFlowOptions
): Promise<StartupValidationFlowResult> {
  const { config, useMapWidgetIds, translate, signal, onProgress } = options

  onProgress(
    translateKey(translate, makeKey("validating", "startup"), undefined, {
      scope: `${VALIDATION_TRANSLATION_SCOPE}.progress.validatingStartup`,
    })
  )

  // Step 1: validate map configuration
  onProgress(
    translateKey(translate, tk.status("validating", "map"), undefined, {
      scope: `${VALIDATION_TRANSLATION_SCOPE}.progress.validatingMap`,
    })
  )
  const hasMapConfigured =
    Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0

  // Step 2: validate widget config and FME connection
  onProgress(
    translateKey(translate, tk.status("validating", "connection"), undefined, {
      scope: `${VALIDATION_TRANSLATION_SCOPE}.progress.validatingConnection`,
    })
  )
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
      const err = createError("configurationInvalid", {
        type: ErrorType.CONFIG,
        code: "VALIDATION_FAILED",
      })
      throw new Error(JSON.stringify(err))
    }
    return { success: false }
  }

  // Step 3: validate user email for async mode
  if (!config?.syncMode) {
    onProgress(
      translateKey(translate, tk.status("validating", "email"), undefined, {
        scope: `${VALIDATION_TRANSLATION_SCOPE}.progress.validatingEmail`,
      })
    )
    try {
      const { getEmail, isValidEmail } = await import("../utils")
      const email = await getEmail(config)
      if (!isValidEmail(email)) {
        const err = createError("userEmailMissingError", {
          type: ErrorType.CONFIG,
          code: "UserEmailMissing",
        })
        throw new Error(JSON.stringify(err))
      }
    } catch (emailErr) {
      if (isAbortError(emailErr)) {
        return { success: false }
      }
      const err = createError("userEmailMissingError", {
        type: ErrorType.CONFIG,
        code: "UserEmailMissing",
      })
      throw new Error(JSON.stringify(err))
    }
  }

  return { success: true }
}
