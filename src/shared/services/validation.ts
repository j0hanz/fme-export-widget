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
  logIfNotAbort,
} from "../utils";
import { createError, mapErrorFromNetwork } from "../utils/error";
import { extractHttpStatus, validateRequiredFields } from "../validations";
import { inFlight } from "./inflight";
import { extractFmeVersion, hasProxyError, healthCheck } from "./network";

/* Validation Result Helpers */

/** Creates validation failure result for aborted requests. */
const createAbortedResult = (
  steps: CheckSteps,
  message = "aborted"
): ConnectionValidationResult => ({
  success: false,
  steps,
  error: {
    message,
    type: "generic" as const,
    status: 0,
  },
});

/** Creates validation failure result for server unreachable errors. */
const createServerUnreachableResult = (
  steps: CheckSteps,
  status?: number
): ConnectionValidationResult => ({
  success: false,
  steps,
  error: {
    message: "errorServerUnreachable",
    type: "server" as const,
    status,
  },
});

/** Creates validation failure result for token errors. */
const createTokenErrorResult = (
  steps: CheckSteps,
  status?: number
): ConnectionValidationResult => ({
  success: false,
  steps,
  error: {
    message: "errorTokenIssue",
    type: "token" as const,
    status,
  },
});

/** Creates validation failure result for repository errors. */
const createRepositoryErrorResult = (
  steps: CheckSteps,
  status?: number
): ConnectionValidationResult => ({
  success: false,
  steps,
  error: {
    message: "errorRepositoryIssue",
    type: "repository" as const,
    status,
  },
});

/** Checks if signal is aborted and returns appropriate result. */
const checkAbortSignal = (
  signal: AbortSignal | undefined,
  steps: CheckSteps
): ConnectionValidationResult | null => {
  if (signal?.aborted) {
    return createAbortedResult(steps);
  }
  return null;
};

const createNetworkOrServerErrorResult = (
  error: unknown,
  steps: CheckSteps,
  status: number
): ConnectionValidationResult => {
  const type = status === 0 ? ("network" as const) : ("server" as const);
  return {
    success: false,
    steps,
    error: {
      message: mapErrorFromNetwork(error, status),
      type,
      status,
    },
  };
};

const handleForbiddenError = async (
  options: {
    steps: CheckSteps;
    status: number;
    serverUrl: string;
    token?: string | null;
    signal?: AbortSignal;
  },
  proxyDetected: boolean
): Promise<ConnectionValidationResult> => {
  const { steps, status, serverUrl, token, signal } = options;

  if (proxyDetected) {
    steps.serverUrl = ValidationStepStatus.FAIL;
    steps.token = ValidationStepStatus.SKIP;
    return createServerUnreachableResult(steps, status);
  }

  try {
    const healthResult = await healthCheck(serverUrl, token, signal);
    const abortCheck = checkAbortSignal(signal, steps);
    if (abortCheck) return abortCheck;

    if (healthResult?.reachable) {
      steps.serverUrl = ValidationStepStatus.OK;
      steps.token = ValidationStepStatus.FAIL;
      return createTokenErrorResult(steps, status);
    }

    steps.serverUrl = ValidationStepStatus.FAIL;
    steps.token = ValidationStepStatus.SKIP;
    return createServerUnreachableResult(steps, status);
  } catch (healthError) {
    logIfNotAbort("Health check during 403 handling failed", healthError);
    steps.serverUrl = ValidationStepStatus.FAIL;
    steps.token = ValidationStepStatus.SKIP;
    return createServerUnreachableResult(steps, status);
  }
};

const handleServerHandshakeError = async (params: {
  error: unknown;
  steps: CheckSteps;
  serverUrl: string;
  token?: string | null;
  signal?: AbortSignal;
}): Promise<ConnectionValidationResult> => {
  const { error, steps, serverUrl, token, signal } = params;

  if (isAbortError(error)) {
    return createAbortedResult(steps, (error as Error).message);
  }

  const status = extractHttpStatus(error);

  if (status === HTTP_STATUS_CODES.UNAUTHORIZED) {
    steps.serverUrl = ValidationStepStatus.OK;
    steps.token = ValidationStepStatus.FAIL;
    return createTokenErrorResult(steps, status);
  }

  if (status === HTTP_STATUS_CODES.FORBIDDEN) {
    const rawMessage = extractErrorMessage(error);
    const proxyDetected = hasProxyError(rawMessage);
    return handleForbiddenError(
      { steps, status, serverUrl, token, signal },
      proxyDetected
    );
  }

  steps.serverUrl = ValidationStepStatus.FAIL;
  steps.token = ValidationStepStatus.SKIP;
  return createNetworkOrServerErrorResult(error, steps, status);
};

const performServerHandshake = async (params: {
  client: NonNullable<ReturnType<typeof createFmeClient>>;
  steps: CheckSteps;
  serverUrl: string;
  token?: string | null;
  signal?: AbortSignal;
}): Promise<ConnectionValidationResult | null> => {
  try {
    const serverInfo = await params.client.testConnection(params.signal);
    params.steps.serverUrl = ValidationStepStatus.OK;
    params.steps.token = ValidationStepStatus.OK;
    params.steps.version = extractFmeVersion(serverInfo);
    return null;
  } catch (error) {
    return handleServerHandshakeError({
      error,
      steps: params.steps,
      serverUrl: params.serverUrl,
      token: params.token,
      signal: params.signal,
    });
  }
};

interface RepositoryValidationOutcome {
  warnings: string[];
  failure?: ConnectionValidationResult;
}

const validateRepositoryStep = async (params: {
  client: NonNullable<ReturnType<typeof createFmeClient>>;
  repository?: string | null;
  signal?: AbortSignal;
  steps: CheckSteps;
}): Promise<RepositoryValidationOutcome> => {
  const warnings: string[] = [];

  if (!params.repository) {
    return { warnings };
  }

  try {
    await params.client.validateRepository(params.repository, params.signal);
    params.steps.repository = ValidationStepStatus.OK;
    return { warnings };
  } catch (error) {
    const status = extractHttpStatus(error);
    const isAuthError =
      status === HTTP_STATUS_CODES.UNAUTHORIZED ||
      status === HTTP_STATUS_CODES.FORBIDDEN;

    if (isAuthError) {
      params.steps.repository = ValidationStepStatus.SKIP;
      warnings.push("repositoryNotAccessible");
      return { warnings };
    }

    params.steps.repository = ValidationStepStatus.FAIL;
    return {
      warnings,
      failure: createRepositoryErrorResult(params.steps, status),
    };
  }
};

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

        const handshakeFailure = await performServerHandshake({
          client,
          steps,
          serverUrl,
          token,
          signal,
        });

        if (handshakeFailure) {
          return handshakeFailure;
        }

        const { warnings, failure } = await validateRepositoryStep({
          client,
          repository,
          signal,
          steps,
        });

        if (failure) {
          return failure;
        }

        return {
          success: true,
          version: typeof steps.version === "string" ? steps.version : "",
          steps,
          warnings: warnings.length ? warnings : undefined,
        };
      } catch (error) {
        if (isAbortError(error)) {
          return createAbortedResult(steps, (error as Error).message);
        }

        const status = extractHttpStatus(error);
        return {
          success: false,
          steps,
          error: {
            message: mapErrorFromNetwork(error, status),
            type: "generic" as const,
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
