import {
  HTTP_STATUS_CODES,
  NETWORK_INDICATORS,
  PROXY_INDICATORS,
  TIME_CONSTANTS,
} from "../../config/constants";
import { createFmeClient, extractErrorMessage } from "../utils";
import { extractHttpStatus, validateServerUrl } from "../validations";
import { inFlight } from "./inflight";

interface JsonRecord {
  [key: string]: unknown;
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
};

const getNestedValue = (
  source: JsonRecord | null,
  path: readonly string[]
): unknown => {
  let current: unknown = source;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as JsonRecord)[segment];
  }
  return current;
};

const getEnumerableValues = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value as JsonRecord);
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
};

/* Network Error Detection */

// Kontrollerar om felmeddelande indikerar nätverksfel
export const hasNetworkError = (message: string): boolean =>
  NETWORK_INDICATORS.some((indicator) =>
    message.toLowerCase().includes(indicator.toLowerCase())
  );

// Kontrollerar om felmeddelande indikerar proxy-fel
export const hasProxyError = (message: string): boolean =>
  PROXY_INDICATORS.some((indicator) =>
    message.toLowerCase().includes(indicator.toLowerCase())
  );

// Extraherar FME-version från server-respons
export function extractFmeVersion(info: unknown): string {
  if (!info) return "";

  const infoRecord = asRecord(info);
  const dataCandidate = infoRecord?.data ?? info;
  const dataRecord = asRecord(dataCandidate);

  const statusValue = dataRecord?.status;
  const versionValue = dataRecord?.version;
  const buildValue = dataRecord?.build;

  const hasStatusOk = typeof statusValue === "string" && statusValue === "ok";
  const hasVersionInfo =
    versionValue !== undefined && versionValue !== null && versionValue !== "";
  const hasBuildInfo =
    buildValue !== undefined && buildValue !== null && buildValue !== "";

  // V4 healthcheck doesn't return version info, so we return empty string
  if (hasStatusOk && !hasVersionInfo && !hasBuildInfo) {
    return "";
  }

  const fmePattern = /\bFME\s+(?:Flow|Server)\s+(\d{4}(?:\.\d+)?)\b/i;
  const versionPattern = /\b(\d+\.\d+(?:\.\d+)?|20\d{2}(?:\.\d+)?)\b/;

  const directKeys = [
    "version",
    "fmeVersion",
    "fmeflowVersion",
    "app.version",
    "about.version",
    "server.version",
    "edition",
    "build",
    "productName",
    "product",
    "name",
    "message",
  ];

  for (const key of directKeys) {
    const value = key.includes(".")
      ? getNestedValue(dataRecord, key.split("."))
      : dataRecord
        ? dataRecord[key]
        : undefined;

    if (typeof value === "string") {
      const fmeMatch = value.match(fmePattern);
      if (fmeMatch) return fmeMatch[1];

      const match = value.match(versionPattern);
      if (match) return match[1];
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value >= 2020 && value < 2100) return String(value);
      if (value > 0 && value < 100) return String(value);
    }
  }

  // Fallback: sök alla värden
  try {
    const allValues = getEnumerableValues(dataCandidate);
    for (const val of allValues) {
      if (typeof val === "string") {
        const fmeMatch = val.match(fmePattern);
        if (fmeMatch) return fmeMatch[1];

        const match = val.match(versionPattern);
        if (match) return match[1];
      }
    }
    if (typeof dataCandidate === "string") {
      const fmeMatch = dataCandidate.match(fmePattern);
      if (fmeMatch) return fmeMatch[1];

      const match = dataCandidate.match(versionPattern);
      if (match) return match[1];
    }
  } catch {
    // Ignore
  }

  return "";
}

// Kontrollerar FME Flow server-hälsa och version
export async function healthCheck(
  serverUrl: string,
  token: string,
  signal?: AbortSignal
): Promise<{
  reachable: boolean;
  version?: string;
  responseTime?: number;
  error?: string;
  status?: number;
}> {
  const key = `${serverUrl}|${token}`;
  const urlValidation = validateServerUrl(serverUrl);
  if (!urlValidation.ok) {
    return {
      reachable: false,
      responseTime: 0,
      error: "invalidUrl",
      status: 0,
    };
  }

  return await inFlight.healthCheck.execute(key, async () => {
    const startTime = Date.now();
    try {
      const client = createFmeClient(serverUrl, token);
      const response = await client.testConnection(signal);
      const elapsed = Date.now() - startTime;
      const responseTime =
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed < TIME_CONSTANTS.MAX_RESPONSE_TIME
          ? elapsed
          : elapsed < 0
            ? 0
            : TIME_CONSTANTS.MAX_RESPONSE_TIME;

      return {
        reachable: true,
        version: extractFmeVersion(response),
        responseTime,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const responseTime =
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed < TIME_CONSTANTS.MAX_RESPONSE_TIME
          ? elapsed
          : elapsed < 0
            ? 0
            : TIME_CONSTANTS.MAX_RESPONSE_TIME;
      const status = extractHttpStatus(error);
      const errorMessage = extractErrorMessage(error);

      if (
        status === HTTP_STATUS_CODES.UNAUTHORIZED ||
        status === HTTP_STATUS_CODES.FORBIDDEN
      ) {
        // 401/403 betyder att servern SVARADE = reachable
        if (hasNetworkError(errorMessage)) {
          const strictValidation = validateServerUrl(serverUrl, {
            strict: true,
          });
          if (!strictValidation.ok) {
            return {
              reachable: false,
              responseTime,
              error: "invalidUrl",
              status,
            };
          }
        }
        return { reachable: true, responseTime, error: errorMessage, status };
      }

      return {
        reachable: false,
        responseTime,
        error: errorMessage,
        status,
      };
    }
  });
}
