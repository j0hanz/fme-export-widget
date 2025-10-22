import { createFmeClient, extractErrorMessage } from "../utils"
import { extractHttpStatus, validateServerUrl } from "../validations"
import { inFlight } from "./inflight"

/* Network Error Detection */

// Indikatorer för nätverksfel i felmeddelanden
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

// Indikatorer för proxy-relaterade fel
const PROXY_INDICATORS = Object.freeze([
  "Unable to load",
  "/sharing/proxy",
  "proxy",
])

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
  ]

  for (const key of directKeys) {
    const value = key.includes(".")
      ? key.split(".").reduce((obj, k) => obj?.[k], data)
      : data?.[key]

    if (typeof value === "string") {
      const match = value.match(versionPattern)
      if (match) return match[1]
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  // Search all values as fallback
  try {
    const allValues = Object.values(data || {})
    for (const val of allValues) {
      if (typeof val === "string") {
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
        Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0

      return {
        reachable: true,
        version: extractFmeVersion(response),
        responseTime,
      }
    } catch (error) {
      const elapsed = Date.now() - startTime
      const responseTime =
        Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0
      const status = extractHttpStatus(error)
      const errorMessage = extractErrorMessage(error)

      if (status === 401 || status === 403) {
        if (hasNetworkError(errorMessage)) {
          return {
            reachable: false,
            responseTime,
            error: errorMessage,
            status,
          }
        }

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

      return {
        reachable: false,
        responseTime,
        error: errorMessage,
        status,
      }
    }
  })
}
