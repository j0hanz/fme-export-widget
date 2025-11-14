import type * as LoggingExports from "../services/logging";

type LoggingModule = typeof LoggingExports;

let cachedLoggingModule: LoggingModule | null = null;
let loggingModulePromise: Promise<LoggingModule> | null = null;

const loadLoggingModule = (): Promise<LoggingModule> => {
  if (cachedLoggingModule) {
    return Promise.resolve(cachedLoggingModule);
  }
  if (!loggingModulePromise) {
    loggingModulePromise = import("../services/logging").then((mod) => {
      cachedLoggingModule = mod;
      return mod;
    });
  }
  return loggingModulePromise;
};

type LoggingFunction = (...params: unknown[]) => void;

const invokeConditional = (
  accessor: (mod: LoggingModule) => LoggingFunction | undefined,
  args: unknown[]
): void => {
  void loadLoggingModule()
    .then((mod) => {
      const fn = accessor(mod);
      if (typeof fn === "function") {
        fn(...args);
      }
    })
    .catch(() => undefined);
};

export const logDebug = (...args: unknown[]): void => {
  invokeConditional((mod) => mod.conditionalLog, args);
};

export const logWarn = (...args: unknown[]): void => {
  invokeConditional((mod) => mod.conditionalWarn, args);
};
