import { createFmeClient, extractErrorMessage } from "../utils"
import { extractHttpStatus, validateServerUrl } from "../validations"
import { inFlight } from "./inflight"
import {
  HTTP_STATUS_CODES,
  TIME_CONSTANTS,
  NETWORK_INDICATORS,
  PROXY_INDICATORS,
} from "../../config/constants"

/* Network Error Detection */

// Kontrollerar om felmeddelande indikerar nätverksfel
export const hasNetworkError = (message: string): boolean =>
  NETWORK_INDICATORS.some((indicator) =>
    message.toLowerCase().includes(indicator.toLowerCase())
  )

// Kontrollerar om felmeddelande indikerar proxy-fel
export const hasProxyError = (message: string): boolean =>
  PROXY_INDICATORS.some((indicator) =>
    message.toLowerCase().includes(indicator.toLowerCase())
  )

// Extraherar FME-version från server-respons
export function extractFmeVersion(info: unknown): string {
  if (!info) return ""

  const data = (info as any)?.data ?? info

  // V4 healthcheck doesn't return version info, so we return empty string
  // Version info might be available in the message field for healthcheck
  if (data?.status === "ok" && !data?.version && !data?.build) {
    // V4 healthcheck response - no version available
    return ""
  }

  const fmePattern = /\bFME\s+(?:Flow|Server)\s+(\d{4}(?:\.\d+)?)\b/i
  const versionPattern = /\b(\d+\.\d+(?:\.\d+)?|20\d{2}(?:\.\d+)?)\b/

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
  ]

  for (const key of directKeys) {
    const value = key.includes(".")
      ? key.split(".").reduce((obj, k) => obj?.[k], data)
      : data?.[key]

    if (typeof value === "string") {
      const fmeMatch = value.match(fmePattern)
      if (fmeMatch) return fmeMatch[1]

      const match = value.match(versionPattern)
      if (match) return match[1]
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value >= 2020 && value < 2100) return String(value)
      if (value > 0 && value < 100) return String(value)
    }
  }

  // Fallback: sök alla värden
  try {
    const allValues = Object.values(data || {})
    for (const val of allValues) {
      if (typeof val === "string") {
        const fmeMatch = val.match(fmePattern)
        if (fmeMatch) return fmeMatch[1]

        const match = val.match(versionPattern)
        if (match) return match[1]
      }
    }
  } catch {
    // Ignore
  }

  return ""
}

// Kontrollerar FME Flow server-hälsa och version
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
  const urlValidation = validateServerUrl(serverUrl)
  if (!urlValidation.ok) {
    return {
      reachable: false,
      responseTime: 0,
      error: "invalidUrl",
      status: 0,
    }
  }

  return await inFlight.healthCheck.execute(key, async () => {
    const startTime = Date.now()
    try {
      const client = createFmeClient(serverUrl, token)
      const response = await client.testConnection(signal)
      const elapsed = Date.now() - startTime
      const responseTime =
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed < TIME_CONSTANTS.MAX_RESPONSE_TIME
          ? elapsed
          : elapsed < 0
            ? 0
            : TIME_CONSTANTS.MAX_RESPONSE_TIME

      return {
        reachable: true,
        version: extractFmeVersion(response),
        responseTime,
      }
    } catch (error) {
      const elapsed = Date.now() - startTime
      const responseTime =
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed < TIME_CONSTANTS.MAX_RESPONSE_TIME
          ? elapsed
          : elapsed < 0
            ? 0
            : TIME_CONSTANTS.MAX_RESPONSE_TIME
      const status = extractHttpStatus(error)
      const errorMessage = extractErrorMessage(error)

      if (
        status === HTTP_STATUS_CODES.UNAUTHORIZED ||
        status === HTTP_STATUS_CODES.FORBIDDEN
      ) {
        // 401/403 betyder att servern SVARADE = reachable
        if (hasNetworkError(errorMessage)) {
          const strictValidation = validateServerUrl(serverUrl, {
            strict: true,
          })
          if (!strictValidation.ok) {
            return {
              reachable: false,
              responseTime,
              error: "invalidUrl",
              status,
            }
          }
        }
        return { reachable: true, responseTime, error: errorMessage, status }
      }

      return {
        reachable: false,
        responseTime,
        error: errorMessage,
        status,
      }
    }
  })
}
