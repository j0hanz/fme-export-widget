import type { ConnectionValidationResult } from "../../config/index"

/* Inflight Request Cache för request-deduplicering */

// Generisk cache för inflight requests med automatisk cleanup
export class InflightCache<T> {
  private readonly cache = new Map<string, Promise<T>>()

  // Kör factory om inget inflight request finns, annars returnera befintligt
  async execute(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.cache.get(key)
    if (existing) return existing

    const promise = factory()
    this.cache.set(key, promise)

    // Rensa cache när request är klar
    return promise.finally(() => {
      this.cache.delete(key)
    })
  }
}

// Inflight request-cacher för vanliga operationer
export const inFlight = {
  healthCheck: new InflightCache<{
    reachable: boolean
    version?: string
    responseTime?: number
    error?: string
    status?: number
  }>(),
  validateConnection: new InflightCache<ConnectionValidationResult>(),
}
