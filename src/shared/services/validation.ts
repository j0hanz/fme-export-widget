import type {
  CheckSteps,
  ConnectionValidationOptions,
  ConnectionValidationResult,
  StartupValidationFlowOptions,
  StartupValidationFlowResult,
  StartupValidationOptions,
  StartupValidationResult,
} from "../../config/index";
import {
  ErrorType,
  HTTP_STATUS_CODES,
  ValidationStepStatus,
} from "../../config/index";
import {
  createFmeClient,
  extractErrorMessage,
  getEmail,
  isAbortError,
  isValidEmail,
} from "../utils";
import { createError, mapErrorFromNetwork } from "../utils/error";
import { extractHttpStatus, validateRequiredFields } from "../validations";
import { inFlight } from "./inflight";
import { extractFmeVersion, hasProxyError, healthCheck } from "./network";

// Validerar FME Flow-anslutning steg-för-steg (URL, token, repository)
export async function validateConnection(
  options: ConnectionValidationOptions
): Promise<ConnectionValidationResult> {
  const { serverUrl, token, repository, signal } = options;
  const key = `${serverUrl}|${token}|${repository || "_"}`;
  const steps: CheckSteps = {
    serverUrl: ValidationStepStatus.PENDING,
    token: ValidationStepStatus.PENDING,
    repository: repository
      ? ValidationStepStatus.PENDING
      : ValidationStepStatus.SKIP,
    version: "",
  };

  return await inFlight.validateConnection.execute(
    key,
    async (): Promise<ConnectionValidationResult> => {
      try {
        const client = createFmeClient(serverUrl, token, repository);

        if (!client) {
          return {
            success: false,
            steps,
            error: {
              message: undefined,
              type: "server",
              status: 0,
            },
          };
        }

        // Steg 1: Testar anslutning och hämtar serverinfo
        let serverInfo: any;
        try {
          serverInfo = await client.testConnection(signal);
          steps.serverUrl = ValidationStepStatus.OK;
          steps.token = ValidationStepStatus.OK;
          steps.version = extractFmeVersion(serverInfo);
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
            };
          }
          const status = extractHttpStatus(error);

          if (status === HTTP_STATUS_CODES.UNAUTHORIZED) {
            steps.serverUrl = ValidationStepStatus.OK;
            steps.token = ValidationStepStatus.FAIL;
            return {
              success: false,
              steps,
              error: {
                message: "errorTokenIssue",
                type: "token",
                status,
              },
            };
          } else if (status === HTTP_STATUS_CODES.FORBIDDEN) {
            const rawMessage = extractErrorMessage(error);
            if (hasProxyError(rawMessage)) {
              steps.serverUrl = ValidationStepStatus.FAIL;
              steps.token = ValidationStepStatus.SKIP;
              return {
                success: false,
                steps,
                error: {
                  message: "errorServerUnreachable",
                  type: "server",
                  status,
                },
              };
            }
            try {
              const healthResult = await healthCheck(serverUrl, token, signal);

              if (signal?.aborted) {
                return {
                  success: false,
                  steps,
                  error: {
                    message: "aborted",
                    type: "generic",
                    status: 0,
                  },
                };
              }

              if (healthResult && healthResult && healthResult.reachable) {
                steps.serverUrl = ValidationStepStatus.OK;
                steps.token = ValidationStepStatus.FAIL;
                return {
                  success: false,
                  steps,
                  error: {
                    message: "errorTokenIssue",
                    type: "token",
                    status,
                  },
                };
              } else {
                steps.serverUrl = ValidationStepStatus.FAIL;
                steps.token = ValidationStepStatus.SKIP;
                return {
                  success: false,
                  steps,
                  error: {
                    message: "errorServerUnreachable",
                    type: "server",
                    status,
                  },
                };
              }
            } catch {
              steps.serverUrl = ValidationStepStatus.FAIL;
              steps.token = ValidationStepStatus.SKIP;
              return {
                success: false,
                steps,
                error: {
                  message: "errorServerUnreachable",
                  type: "server",
                  status,
                },
              };
            }
          } else {
            steps.serverUrl = ValidationStepStatus.FAIL;
            steps.token = ValidationStepStatus.SKIP;
            return {
              success: false,
              steps,
              error: {
                message: mapErrorFromNetwork(error, status),
                type: status === 0 ? "network" : "server",
                status,
              },
            };
          }
        }

        const warnings: string[] = [];

        // Steg 3: Validerar specifik repository om angiven
        if (repository) {
          try {
            await client.validateRepository(repository, signal);
            steps.repository = ValidationStepStatus.OK;
          } catch (error) {
            const status = extractHttpStatus(error);
            if (
              status === HTTP_STATUS_CODES.UNAUTHORIZED ||
              status === HTTP_STATUS_CODES.FORBIDDEN
            ) {
              steps.repository = ValidationStepStatus.SKIP;
              warnings.push("repositoryNotAccessible");
            } else {
              steps.repository = ValidationStepStatus.FAIL;
              return {
                success: false,
                steps,
                error: {
                  message: mapErrorFromNetwork(error, status),
                  type: "repository",
                  status,
                },
              };
            }
          }
        }

        return {
          success: true,
          version: typeof steps.version === "string" ? steps.version : "",
          steps,
          warnings: warnings.length ? warnings : undefined,
        };
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
          };
        }

        const status = extractHttpStatus(error);
        return {
          success: false,
          steps,
          error: {
            message: mapErrorFromNetwork(error, status),
            type: "generic",
            status,
          },
        };
      }
    }
  );
}

// Validerar widget-uppstart: config, required fields, FME-anslutning
export async function validateWidgetStartup(
  options: StartupValidationOptions
): Promise<StartupValidationResult> {
  const { config, translate, signal, mapConfigured } = options;

  // Steg 1: Kontrollerar om config finns
  if (!config) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError("errorSetupRequired", {
        type: ErrorType.CONFIG,
        code: "configMissing",
        suggestion: translate("actionOpenSettings"),
        userFriendlyMessage: translate("hintSetupWidget"),
      }),
    };
  }

  // Steg 2: Validerar obligatoriska config-fält
  const requiredFieldsResult = validateRequiredFields(config, translate, {
    mapConfigured: mapConfigured ?? true,
  });
  if (!requiredFieldsResult.isValid) {
    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError("errorSetupRequired", {
        type: ErrorType.CONFIG,
        code: "CONFIG_INCOMPLETE",
      }),
    };
  }

  // Steg 3: Testar FME Flow-anslutning
  try {
    const connectionResult = await validateConnection({
      serverUrl: config.fmeServerUrl,
      token: config.fmeServerToken,
      repository: config.repository,
      signal,
    });

    if (!connectionResult.success) {
      const errorMessage =
        connectionResult.error?.message || "errorValidationFailed";
      const errorType = connectionResult.error?.type || "server";

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
              ? translate("tokenSettingsHint")
              : errorType === "server"
                ? translate("serverUrlSettingsHint")
                : errorType === "repository"
                  ? translate("repositorySettingsHint")
                  : translate("connectionSettingsHint"),
        }),
      };
    }

    // All validering lyckades
    return {
      isValid: true,
      canProceed: true,
      requiresSettings: false,
    };
  } catch (error) {
    if (isAbortError(error)) {
      // Behandla inte abort som ett fel - returnera neutralt tillstånd
      return {
        isValid: false,
        canProceed: false,
        requiresSettings: false,
      };
    }

    return {
      isValid: false,
      canProceed: false,
      requiresSettings: true,
      error: createError("errorStartupFailed", {
        type: ErrorType.NETWORK,
        code: "STARTUP_NETWORK_ERROR",
        suggestion: translate("networkConnectionHint"),
      }),
    };
  }
}

export async function runStartupValidationFlow(
  options: StartupValidationFlowOptions
): Promise<StartupValidationFlowResult> {
  const { config, useMapWidgetIds, translate, signal, onProgress } = options;

  onProgress(translate("validatingStartup"));

  // Step 1: validate map configuration
  onProgress(translate("statusValidatingMap"));
  const hasMapConfigured =
    Array.isArray(useMapWidgetIds) && useMapWidgetIds.length > 0;

  // Step 2: validate widget config and FME connection
  onProgress(translate("statusValidatingConnection"));
  const validationResult = await validateWidgetStartup({
    config,
    translate,
    signal,
    mapConfigured: hasMapConfigured,
  });

  if (!validationResult.isValid) {
    if (validationResult.error) {
      throw new Error(JSON.stringify(validationResult.error));
    } else if (validationResult.requiresSettings) {
      const err = createError("configurationInvalid", {
        type: ErrorType.CONFIG,
        code: "VALIDATION_FAILED",
      });
      throw new Error(JSON.stringify(err));
    }
    return { success: false };
  }

  // Step 3: validate user email for async mode
  if (!config?.syncMode) {
    onProgress(translate("statusValidatingEmail"));
    try {
      const email = await getEmail(config);
      if (!isValidEmail(email)) {
        const err = createError("userEmailMissingError", {
          type: ErrorType.CONFIG,
          code: "UserEmailMissing",
        });
        throw new Error(JSON.stringify(err));
      }
    } catch (emailErr) {
      if (isAbortError(emailErr)) {
        return { success: false };
      }
      const err = createError("userEmailMissingError", {
        type: ErrorType.CONFIG,
        code: "UserEmailMissing",
      });
      throw new Error(JSON.stringify(err));
    }
  }

  return { success: true };
}
