import { React, hooks } from "jimu-core"
import { abortManager } from "./api"
import { isAbortError, logIfNotAbort } from "./utils"
import { isRetryableError } from "./validations"
import type {
  QueryKey,
  QueryStatus,
  QueryOptions,
  UseFmeQueryResult,
  MutationOptions,
  UseFmeMutationResult,
  CacheEntry,
} from "../config/types"

const DEFAULTS = Object.freeze({
  STALE_TIME: 5 * 60 * 1000, // 5 minutes
  CACHE_TIME: 10 * 60 * 1000, // 10 minutes
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000, // 1 second
  MAX_CACHE_SIZE: 100, // Maximum entries
})

function stringifyUnknown(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol") return value.toString()
  if (value instanceof Error) return value.message || value.name
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export function serializeQueryKey(key: QueryKey): string {
  try {
    return JSON.stringify(key)
  } catch {
    const parts = Array.from(key).map((part) => stringifyUnknown(part))
    return parts.join("|")
  }
}

function defaultRetryDelay(attempt: number): number {
  const base = DEFAULTS.RETRY_DELAY * Math.pow(2, attempt - 1)
  return Math.min(base, 10000)
}

function notifySubscribers(subscribers: Set<() => void>): void {
  subscribers.forEach((cb) => {
    try {
      cb()
    } catch (error) {
      logIfNotAbort("FmeQueryCache subscriber error", error)
    }
  })
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(stringifyUnknown(value))
}

class FmeQueryCache {
  private readonly cache = new Map<string, CacheEntry<any>>()
  private readonly gcTimers = new Map<string, ReturnType<typeof setTimeout>>()

  get<T>(key: QueryKey): CacheEntry<T> | undefined {
    return this.cache.get(serializeQueryKey(key)) as CacheEntry<T> | undefined
  }

  set<T>(key: QueryKey, entry: Partial<CacheEntry<T>>): void {
    const serialized = serializeQueryKey(key)
    const existing = this.cache.get(serialized)

    const next: CacheEntry<T> = {
      data:
        entry.data !== undefined
          ? entry.data
          : (existing?.data as T | undefined),
      error:
        entry.error !== undefined
          ? entry.error
          : (existing?.error ?? undefined),
      status: entry.status ?? existing?.status ?? "idle",
      timestamp: entry.timestamp ?? existing?.timestamp ?? Date.now(),
      subscribers: entry.subscribers ?? existing?.subscribers ?? new Set(),
      retryCount: entry.retryCount ?? existing?.retryCount ?? 0,
      abortController:
        entry.abortController ?? existing?.abortController ?? null,
    }

    this.cache.set(serialized, next)

    if (this.cache.size > DEFAULTS.MAX_CACHE_SIZE) {
      this.evictOldest()
    }
  }

  subscribe(key: QueryKey, callback: () => void): () => void {
    const entry = this.getOrCreate(key)
    entry.subscribers.add(callback)

    return () => {
      entry.subscribers.delete(callback)
    }
  }

  notify(key: QueryKey): void {
    const entry = this.get(key)
    if (!entry) return

    notifySubscribers(entry.subscribers)
  }

  invalidate(keyPrefix?: QueryKey): void {
    if (!keyPrefix) {
      this.cache.forEach((entry) => {
        entry.status = "idle"
        entry.timestamp = 0
        notifySubscribers(entry.subscribers)
      })
      return
    }

    const prefix = serializeQueryKey(keyPrefix)
    this.cache.forEach((entry, serialized) => {
      if (serialized.startsWith(prefix)) {
        entry.status = "idle"
        entry.timestamp = 0
        notifySubscribers(entry.subscribers)
      }
    })
  }

  remove(key: QueryKey): void {
    this.removeSerializedKey(serializeQueryKey(key))
  }

  scheduleGc(key: QueryKey, cacheTime: number): void {
    const serialized = serializeQueryKey(key)
    const delay = Number.isFinite(cacheTime)
      ? Math.max(cacheTime, 0)
      : DEFAULTS.CACHE_TIME

    const existing = this.gcTimers.get(serialized)
    if (existing) {
      clearTimeout(existing)
    }

    const timer = setTimeout(() => {
      const entry = this.cache.get(serialized)
      if (entry && entry.subscribers.size === 0 && entry.status !== "loading") {
        this.removeSerializedKey(serialized)
      }
    }, delay)

    this.gcTimers.set(serialized, timer)
  }

  clear(): void {
    const keys: string[] = []
    this.cache.forEach((_entry, serialized) => {
      keys.push(serialized)
    })

    keys.forEach((serialized) => {
      this.removeSerializedKey(serialized)
    })
  }

  forEachEntry(
    callback: (serialized: string, entry: CacheEntry<any>) => void
  ): void {
    this.cache.forEach((entry, serialized) => {
      callback(serialized, entry)
    })
  }

  getStats(): {
    size: number
    entries: Array<{ key: string; status: QueryStatus; age: number }>
  } {
    const now = Date.now()
    const entries: Array<{ key: string; status: QueryStatus; age: number }> = []

    this.cache.forEach((entry, serialized) => {
      entries.push({
        key: serialized,
        status: entry.status,
        age: now - entry.timestamp,
      })
    })

    return {
      size: this.cache.size,
      entries: entries.sort((a, b) => b.age - a.age),
    }
  }

  private getOrCreate<T>(key: QueryKey): CacheEntry<T> {
    const serialized = serializeQueryKey(key)
    let entry = this.cache.get(serialized) as CacheEntry<T> | undefined

    if (!entry) {
      entry = {
        data: undefined,
        error: undefined,
        status: "idle",
        timestamp: 0,
        subscribers: new Set(),
        retryCount: 0,
        abortController: null,
      }
      this.cache.set(serialized, entry)
    }

    return entry
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    this.cache.forEach((entry, serialized) => {
      if (entry.subscribers.size === 0 && entry.status !== "loading") {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp
          oldestKey = serialized
        }
      }
    })

    if (oldestKey) {
      this.removeSerializedKey(oldestKey)
    }
  }

  removeSerializedKey(serialized: string): void {
    const entry = this.cache.get(serialized)
    if (entry?.abortController && !entry.abortController.signal.aborted) {
      try {
        entry.abortController.abort()
      } catch {}
    }

    abortManager.release(serialized, entry?.abortController ?? null)

    this.cache.delete(serialized)

    const timer = this.gcTimers.get(serialized)
    if (timer) {
      clearTimeout(timer)
      this.gcTimers.delete(serialized)
    }
  }
}

export const fmeQueryCache = new FmeQueryCache()

export class FmeQueryClient {
  private readonly cache = fmeQueryCache

  async fetchQuery<T>(options: QueryOptions<T>): Promise<T> {
    const {
      queryKey,
      queryFn,
      retry = DEFAULTS.RETRY_COUNT,
      retryDelay = defaultRetryDelay,
    } = options

    const serializedKey = serializeQueryKey(queryKey)
    const entry = this.cache.get<T>(queryKey)

    if (entry?.status === "loading" && entry.abortController) {
      return await new Promise<T>((resolve, reject) => {
        const unsubscribe = this.cache.subscribe(queryKey, () => {
          const updated = this.cache.get<T>(queryKey)
          if (updated?.status === "success") {
            unsubscribe()
            const data = updated.data
            if (data === undefined) {
              reject(new Error("Query resolved without data"))
              return
            }
            resolve(data)
          } else if (updated?.status === "error") {
            unsubscribe()
            reject(toError(updated.error))
          }
        })
      })
    }

    const controller = new AbortController()
    abortManager.register(serializedKey, controller)
    this.cache.set(queryKey, {
      status: "loading",
      abortController: controller,
    })
    this.cache.notify(queryKey)

    const attemptFetch = async (attempt: number): Promise<T> => {
      try {
        const data = await queryFn(controller.signal)

        this.cache.set(queryKey, {
          data,
          status: "success",
          timestamp: Date.now(),
          error: undefined,
          retryCount: 0,
          abortController: null,
        })
        this.cache.notify(queryKey)

        try {
          options.onSuccess?.(data)
        } catch {}

        return data
      } catch (error) {
        if (isAbortError(error)) {
          const abortError =
            error instanceof Error ? error : new Error("Aborted request")
          throw abortError
        }

        const maxRetries = retry === false ? 0 : retry
        const retryable = isRetryableError(error)
        const shouldRetry = retryable && attempt < maxRetries

        if (shouldRetry) {
          const delay =
            typeof retryDelay === "function" ? retryDelay(attempt) : retryDelay

          await new Promise((resolve) => setTimeout(resolve, delay))

          if (controller.signal.aborted) {
            throw new Error("Aborted during retry delay")
          }

          return await attemptFetch(attempt + 1)
        }

        this.cache.set(queryKey, {
          error,
          status: "error",
          timestamp: Date.now(),
          retryCount: attempt,
          abortController: null,
        })
        this.cache.notify(queryKey)

        try {
          options.onError?.(error)
        } catch {}

        throw toError(error)
      }
    }

    try {
      return await attemptFetch(1)
    } finally {
      abortManager.release(serializedKey, controller)
      const current = this.cache.get<T>(queryKey)
      if (current?.abortController === controller) {
        this.cache.set(queryKey, { abortController: null })
      }
    }
  }

  invalidateQueries(keyPrefix?: QueryKey): void {
    this.cache.invalidate(keyPrefix)
  }

  removeQueries(keyPrefix?: QueryKey): void {
    if (!keyPrefix) {
      this.cache.clear()
      return
    }

    const prefix = serializeQueryKey(keyPrefix)
    const targets: string[] = []
    this.cache.forEachEntry((serialized) => {
      if (serialized.startsWith(prefix)) {
        targets.push(serialized)
      }
    })

    targets.forEach((serialized) => {
      this.cache.removeSerializedKey(serialized)
    })
  }

  getQueryStats(): ReturnType<FmeQueryCache["getStats"]> {
    return this.cache.getStats()
  }
}

export const fmeQueryClient = new FmeQueryClient()

export async function fetchQuery<T>(options: QueryOptions<T>): Promise<T> {
  return await fmeQueryClient.fetchQuery(options)
}

export async function prefetchQuery<T>(
  options: QueryOptions<T>
): Promise<void> {
  const isEnabled = options.enabled ?? true
  if (!isEnabled) return

  const entry = fmeQueryCache.get<T>(options.queryKey)
  const staleTime =
    typeof options.staleTime === "number"
      ? options.staleTime
      : DEFAULTS.STALE_TIME

  const now = Date.now()
  if (entry?.status === "success" && now - entry.timestamp <= staleTime) {
    return
  }

  try {
    await fmeQueryClient.fetchQuery(options)
  } catch (error) {
    if (!isAbortError(error)) {
      const finalError =
        error instanceof Error ? error : new Error(String(error))
      throw finalError
    }
  }
}

export function useFmeQuery<T>(options: QueryOptions<T>): UseFmeQueryResult<T> {
  const {
    queryKey,
    enabled = true,
    cacheTime = DEFAULTS.CACHE_TIME,
    refetchOnWindowFocus = false,
    refetchOnReconnect = false,
  } = options

  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0)
  const isMountedRef = React.useRef(true)

  const optionsRef = hooks.useLatest(options)
  const queryKeyRef = hooks.useLatest(queryKey)
  const serializedKey = serializeQueryKey(queryKey)

  hooks.useEffectWithPreviousValues(() => {
    const unsubscribe = fmeQueryCache.subscribe(queryKey, () => {
      if (isMountedRef.current) {
        forceUpdate()
      }
    })

    return () => {
      unsubscribe()
    }
  }, [serializedKey])

  const executeFetch = hooks.useEventCallback(async () => {
    const currentOptions = optionsRef.current
    const isEnabled = currentOptions.enabled ?? true
    if (!isEnabled) return

    const currentKey = queryKeyRef.current
    const entry = fmeQueryCache.get<T>(currentKey)
    const now = Date.now()
    const threshold =
      typeof currentOptions.staleTime === "number"
        ? currentOptions.staleTime
        : DEFAULTS.STALE_TIME

    const shouldFetch =
      !entry ||
      entry.status === "idle" ||
      entry.status === "error" ||
      now - entry.timestamp > threshold

    if (!shouldFetch && entry?.status === "success") {
      return
    }

    try {
      await fmeQueryClient.fetchQuery(currentOptions)
    } catch (error) {
      if (!isAbortError(error)) {
        // cache already stores the error state
      }
    }
  })

  hooks.useEffectWithPreviousValues(() => {
    if (enabled) {
      void executeFetch()
    }
  }, [enabled, executeFetch, serializedKey])

  hooks.useEffectWithPreviousValues(() => {
    if (!refetchOnWindowFocus || !enabled) return

    const handleFocus = () => {
      void executeFetch()
    }

    window.addEventListener("focus", handleFocus)
    return () => {
      window.removeEventListener("focus", handleFocus)
    }
  }, [refetchOnWindowFocus, enabled, executeFetch])

  hooks.useEffectWithPreviousValues(() => {
    if (!refetchOnReconnect || !enabled) return

    const handleOnline = () => {
      void executeFetch()
    }

    window.addEventListener("online", handleOnline)
    return () => {
      window.removeEventListener("online", handleOnline)
    }
  }, [refetchOnReconnect, enabled, executeFetch])

  hooks.useEffectWithPreviousValues(() => {
    fmeQueryCache.scheduleGc(queryKey, cacheTime)
  }, [cacheTime, serializedKey])

  hooks.useEffectOnce(() => {
    return () => {
      isMountedRef.current = false
    }
  })

  const entry = fmeQueryCache.get<T>(queryKey)
  const hasData = entry?.data !== undefined
  const status = entry?.status ?? "idle"

  return {
    data: entry?.data,
    error: entry?.error,
    isLoading: enabled && !hasData && status === "loading",
    isSuccess: status === "success",
    isError: status === "error",
    isFetching: status === "loading",
    refetch: executeFetch,
    status,
  }
}

export function useFmeMutation<TData, TVariables>(
  options: MutationOptions<TData, TVariables>
): UseFmeMutationResult<TData, TVariables> {
  const optionsRef = hooks.useLatest(options)

  const [state, setState] = React.useState<{
    data: TData | undefined
    error: unknown
    status: QueryStatus
  }>({
    data: undefined,
    error: undefined,
    status: "idle",
  })

  const [abortController, setAbortController] =
    React.useState<AbortController | null>(null)

  const cancel = hooks.useEventCallback(() => {
    if (abortController && !abortController.signal.aborted) {
      try {
        abortController.abort()
      } catch {}
    }
    setAbortController(null)
  })

  const mutateAsync = hooks.useEventCallback(
    async (variables: TVariables): Promise<TData> => {
      cancel()

      const controller = new AbortController()
      setAbortController(controller)

      setState({
        data: undefined,
        error: undefined,
        status: "loading",
      })

      const currentOptions = optionsRef.current

      try {
        const data = await currentOptions.mutationFn(
          variables,
          controller.signal
        )

        if (controller.signal.aborted) {
          throw new Error("Mutation was aborted")
        }

        setState({ data, error: undefined, status: "success" })

        try {
          currentOptions.onSuccess?.(data, variables)
        } catch {}

        try {
          currentOptions.onSettled?.(data, undefined, variables)
        } catch {}

        return data
      } catch (error) {
        const finalError: Error = isAbortError(error)
          ? error instanceof Error
            ? error
            : new Error("Aborted request")
          : toError(error)
        setState({ data: undefined, error: finalError, status: "error" })

        try {
          currentOptions.onError?.(finalError, variables)
        } catch {}

        try {
          currentOptions.onSettled?.(undefined, finalError, variables)
        } catch {}

        throw finalError
      } finally {
        setAbortController(null)
      }
    }
  )

  const mutate = hooks.useEventCallback((variables: TVariables) => {
    void mutateAsync(variables)
  })

  const reset = hooks.useEventCallback(() => {
    cancel()
    setState({ data: undefined, error: undefined, status: "idle" })
  })

  hooks.useEffectOnce(() => {
    return () => {
      cancel()
    }
  })

  return {
    mutate,
    mutateAsync,
    data: state.data,
    error: state.error,
    isLoading: state.status === "loading",
    isSuccess: state.status === "success",
    isError: state.status === "error",
    isIdle: state.status === "idle",
    reset,
    status: state.status,
  }
}
