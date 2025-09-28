export type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_PREFIX = "[FME Export]"

const resolveLogger = (level: LogLevel): ((...args: any[]) => void) => {
  if (typeof console === "undefined") {
    return () => undefined
  }

  switch (level) {
    case "debug":
      return console.debug?.bind(console) ?? console.log.bind(console)
    case "info":
      return console.info?.bind(console) ?? console.log.bind(console)
    case "warn":
      return console.warn?.bind(console) ?? console.log.bind(console)
    case "error":
      return console.error?.bind(console) ?? console.log.bind(console)
  }
}

const log = (level: LogLevel, message: string, details?: unknown): void => {
  const logger = resolveLogger(level)
  if (details === undefined) {
    logger(LOG_PREFIX, message)
  } else {
    logger(LOG_PREFIX, message, details)
  }
}

export const logDebug = (message: string, details?: unknown): void => {
  log("debug", message, details)
}

export const logInfo = (message: string, details?: unknown): void => {
  log("info", message, details)
}

export const logWarn = (message: string, details?: unknown): void => {
  log("warn", message, details)
}

export const logError = (message: string, details?: unknown): void => {
  log("error", message, details)
}

export const isTestEnv = (): boolean =>
  typeof process !== "undefined" &&
  !!(process as any).env &&
  (!!(process as any).env.JEST_WORKER_ID ||
    (process as any).env.NODE_ENV === "test")

const unwrapModule = (module: unknown) => (module as any)?.default ?? module

export async function loadArcgisModules(
  modules: readonly string[]
): Promise<unknown[]> {
  if (!Array.isArray(modules) || !modules.length) {
    return []
  }

  if (isTestEnv()) {
    const stub = (globalThis as any).__ESRI_TEST_STUB__
    if (typeof stub === "function") {
      return stub(modules)
    }
  }

  try {
    const mod = await import("jimu-arcgis")
    const loader = (mod as any)?.loadArcGISJSAPIModules
    if (typeof loader !== "function") {
      throw new Error("ARCGIS_MODULE_ERROR")
    }
    const loaded = await loader(modules as string[])
    return (loaded || []).map(unwrapModule)
  } catch (error) {
    logError("Failed to load ArcGIS modules", error)
    throw new Error("ARCGIS_MODULE_ERROR")
  }
}
