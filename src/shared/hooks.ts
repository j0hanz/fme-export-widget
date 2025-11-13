import { hooks, React } from "jimu-core";
import type { IMState, IMThemeVariables } from "jimu-core";
import type { JimuMapView } from "jimu-arcgis";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shallowEqual, useSelector } from "react-redux";
import type { Dispatch } from "redux";
import type {
  ConfigWithImmutable,
  ConnectionValidationResult,
  ErrorType,
  EsriModules,
  FormPrimitive,
  FormValues,
  LoadingFlagKey,
  LoadingSnapshot,
  SerializableErrorState,
  UseDebounceOptions,
  ValidateConnectionVariables,
  WorkspaceItem,
  WorkspaceItemDetail,
  WorkspaceParameter,
} from "../config/index";
import {
  DEFAULT_REPOSITORY,
  ErrorSeverity,
  ESRI_MODULES_TO_LOAD,
  NETWORK_CONFIG,
  TIME_CONSTANTS,
  WORKSPACE_ITEM_TYPE,
} from "../config/index";
import { fmeActions } from "../extensions/store";
import { healthCheck, validateConnection } from "./services";
import {
  buildTokenCacheKey,
  createFmeClient,
  isNonNegativeNumber,
  linkAbortSignal,
  loadArcgisModules,
  logIfNotAbort,
  queryKeys,
  safeAbortController,
} from "./utils";

const hasLoadFunction = (
  candidate: unknown
): candidate is { load: () => Promise<void> } => {
  if (typeof candidate !== "object" || candidate === null) return false;
  return typeof Reflect.get(candidate, "load") === "function";
};

const isGeometryOperatorContainer = (
  value: unknown
): value is EsriModules["geometryOperators"] =>
  typeof value === "object" && value !== null;

const extractGeometryOperators = (
  candidate: unknown
): EsriModules["geometryOperators"] | null => {
  if (typeof candidate !== "object" || candidate === null) return null;
  const operators = Reflect.get(candidate, "operators");
  return isGeometryOperatorContainer(operators) ? operators : null;
};

const isWorkspaceItemDetail = (
  value: unknown
): value is WorkspaceItemDetail => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as { name?: unknown }).name === "string";
};

const isWorkspaceParameterArray = (
  value: unknown
): value is WorkspaceParameter[] => Array.isArray(value);

/* ArcGIS Resource Utilities */

// Kör operation säkert på resurs, ignorerar fel
const executeSafely = <T>(
  resource: T | null | undefined,
  operation: (value: T) => void
): void => {
  if (!resource) return;
  try {
    operation(resource);
  } catch {}
};

// Avbryter aktiv sketch-operation säkert
export const safeCancelSketch = (vm?: __esri.SketchViewModel | null): void => {
  executeSafely(vm, (model) => {
    model.cancel();
  });
};

// Rensar alla grafik från layer säkert
export const safeClearLayer = (layer?: __esri.GraphicsLayer | null): void => {
  executeSafely(layer, (graphics) => {
    graphics.removeAll();
  });
};

// Förstör GraphicsLayer-objekt säkert
export const destroyGraphicsLayer = (
  layer?: __esri.GraphicsLayer | null
): void => {
  executeSafely(layer, (graphics) => {
    const destroyFn = (graphics as { destroy?: () => void }).destroy;
    if (typeof destroyFn === "function") {
      destroyFn.call(graphics);
    }
  });
};

// Tar bort GraphicsLayer från karta säkert
export const removeLayerFromMap = (
  jmv?: JimuMapView | null,
  layer?: __esri.GraphicsLayer | null
): void => {
  if (!jmv?.view?.map) return;
  executeSafely(layer, (graphicsLayer) => {
    if (graphicsLayer.parent) {
      jmv.view.map.remove(graphicsLayer);
    }
  });
};

/* Debounce Hook */

// Debounced-funktion med cancel/flush/isPending-metoder
type DebouncedFn<T extends (...args: unknown[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void;
  flush: () => void;
  isPending: () => boolean;
};

// Hook för debounced callback med delay och optional pending-notifiering
export const useDebounce = <T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number,
  options?: UseDebounceOptions
): DebouncedFn<T> => {
  const safeDelay = isNonNegativeNumber(delay) ? delay : 0;
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef(false);
  const lastArgsRef = React.useRef<Parameters<T> | null>(null);
  const callbackRef = hooks.useLatest(callback);
  const optionsRef = hooks.useLatest(options);

  // Notifierar pending-state-förändring via callback
  const notifyPending = hooks.useEventCallback((next: boolean) => {
    if (pendingRef.current === next) {
      return;
    }
    pendingRef.current = next;
    const handler = optionsRef.current?.onPendingChange;
    if (typeof handler === "function") {
      try {
        handler(next);
      } catch {}
    }
  });

  // Avbryter pending debounce och rensar state
  const cancel = hooks.useEventCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastArgsRef.current = null;
    if (pendingRef.current) {
      notifyPending(false);
    }
  });

  // Kör callback efter delay, notifierar pending under väntan
  const run = hooks.useEventCallback((...args: Parameters<T>) => {
    lastArgsRef.current = args;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    notifyPending(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      lastArgsRef.current = null;
      try {
        callbackRef.current(...args);
      } finally {
        notifyPending(false);
      }
    }, safeDelay);
  });

  // Kör callback omedelbart med senaste args (avbryter debounce)
  const flush = hooks.useEventCallback(() => {
    if (!lastArgsRef.current) {
      return;
    }
    const args = lastArgsRef.current;
    cancel();
    callbackRef.current(...args);
  });

  const debouncedRef = React.useRef<DebouncedFn<T> | null>(null);
  const runRef = hooks.useLatest(run);
  const cancelRef = hooks.useLatest(cancel);
  const flushRef = hooks.useLatest(flush);

  // Skapar stabil debounced-funktion med cancel/flush/isPending
  if (!debouncedRef.current) {
    const runner = ((...args: Parameters<T>) => {
      runRef.current(...args);
    }) as DebouncedFn<T>;
    runner.cancel = () => cancelRef.current();
    runner.flush = () => flushRef.current();
    runner.isPending = () => pendingRef.current;
    debouncedRef.current = runner;
  }

  // Use latest cancel ref to ensure cleanup always uses current cancel logic
  const cancelLatest = hooks.useLatest(cancel);
  hooks.useEffectOnce(() => {
    return () => {
      cancelLatest.current();
    };
  });

  const debounced = debouncedRef.current;
  if (!debounced) {
    throw new Error("debounceUnavailable");
  }
  return debounced;
};

/* ArcGIS Modules Loader Hook */

// Hook för att ladda ArcGIS-moduler asynkront med error-hantering
export const useEsriModules = (
  reloadSignal: number
): {
  modules: EsriModules | null;
  loading: boolean;
  errorKey: string | null;
} => {
  const [state, setState] = React.useState<{
    modules: EsriModules | null;
    loading: boolean;
    errorKey: string | null;
  }>({ modules: null, loading: true, errorKey: null });

  hooks.useEffectWithPreviousValues(() => {
    let cancelled = false;

    // Behåll moduler om reloadSignal är 0, annars rensa och ladda om
    setState((prev) => ({
      modules: reloadSignal === 0 ? prev.modules : null,
      loading: true,
      errorKey: null,
    }));

    const loadModules = async () => {
      try {
        const loaded = await loadArcgisModules(ESRI_MODULES_TO_LOAD);
        if (cancelled) return;

        const [
          SketchViewModel,
          GraphicsLayer,
          geometryEngine,
          geometryEngineAsync,
          webMercatorUtils,
          projection,
          SpatialReference,
          normalizeUtils,
          Polyline,
          Polygon,
          Graphic,
        ] = loaded as [
          EsriModules["SketchViewModel"],
          EsriModules["GraphicsLayer"],
          EsriModules["geometryEngine"],
          EsriModules["geometryEngineAsync"],
          EsriModules["webMercatorUtils"],
          EsriModules["projection"],
          EsriModules["SpatialReference"],
          EsriModules["normalizeUtils"],
          EsriModules["Polyline"],
          EsriModules["Polygon"],
          EsriModules["Graphic"],
        ];

        // Ladda projection-modul om det har load-metod
        try {
          if (hasLoadFunction(projection)) {
            await projection.load();
          }
        } catch (error) {
          /* Non-critical projection module warmup failure */
        }

        // Extrahera geometry operators från async eller sync engine
        const geometryOperators =
          extractGeometryOperators(geometryEngineAsync) ??
          extractGeometryOperators(geometryEngine) ??
          null;

        const modules: EsriModules = {
          SketchViewModel,
          GraphicsLayer,
          geometryEngine,
          geometryEngineAsync,
          webMercatorUtils,
          projection,
          SpatialReference,
          normalizeUtils,
          Polyline,
          Polygon,
          Graphic,
          geometryOperators,
        };

        setState({
          modules,
          loading: false,
          errorKey: null,
        });
      } catch (error) {
        if (!cancelled) {
          setState({ modules: null, loading: false, errorKey: "errorMapInit" });
        }
      }
    };

    void loadModules();
    return () => {
      cancelled = true;
    };
  }, [reloadSignal]);

  return state;
};

/* Map Resources Management Hook */

// Hook för att hantera kartresurser (JimuMapView, SketchViewModel, layers)
export const useMapResources = () => {
  const [state, setState] = React.useState<{
    jimuMapView: JimuMapView | null;
    sketchViewModel: __esri.SketchViewModel | null;
    graphicsLayer: __esri.GraphicsLayer | null;
    cleanupHandles: (() => void) | null;
  }>({
    jimuMapView: null,
    sketchViewModel: null,
    graphicsLayer: null,
    cleanupHandles: null,
  });

  // Uppdaterar enskild resurs och kör cleanup om nödvändigt
  const updateResource = hooks.useEventCallback(
    <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => {
      setState((prev) => {
        // Kör cleanup på gammal SketchViewModel om den ersätts
        if (
          key === "sketchViewModel" &&
          prev.sketchViewModel &&
          prev.sketchViewModel !== value
        ) {
          try {
            const cleaner = (
              prev.sketchViewModel as unknown as { __fmeCleanup__?: () => void }
            )?.__fmeCleanup__;
            if (typeof cleaner === "function") {
              cleaner();
            }
          } catch {}
        }

        // Kör cleanup-handles om de ersätts
        if (
          key === "cleanupHandles" &&
          prev.cleanupHandles &&
          prev.cleanupHandles !== value
        ) {
          try {
            prev.cleanupHandles();
          } catch {}
        }

        return { ...prev, [key]: value };
      });
    }
  );

  // Frigör drawing-resurser (VM, layer, handles) med optional MapView-reset
  const releaseDrawingResources = hooks.useEventCallback(
    (resetMapView: boolean) => {
      const { sketchViewModel, graphicsLayer, jimuMapView, cleanupHandles } =
        state;

      if (cleanupHandles) {
        try {
          cleanupHandles();
        } catch {}
      }

      safeCancelSketch(sketchViewModel);
      executeSafely(sketchViewModel, (model) => {
        if (typeof model.destroy === "function") {
          model.destroy();
        }
      });

      removeLayerFromMap(jimuMapView, graphicsLayer);
      safeClearLayer(graphicsLayer);
      destroyGraphicsLayer(graphicsLayer);

      setState((prev) => ({
        ...prev,
        jimuMapView: resetMapView ? null : prev.jimuMapView,
        sketchViewModel: null,
        graphicsLayer: null,
        cleanupHandles: null,
      }));
    }
  );

  // Tar ner drawing-resurser utan att rensa JimuMapView
  const teardownDrawingResources = hooks.useEventCallback(() => {
    releaseDrawingResources(false);
  });

  // Rensar alla resurser inklusive JimuMapView
  const cleanupResources = hooks.useEventCallback(() => {
    releaseDrawingResources(true);
  });

  return {
    ...state,
    setJimuMapView: (view: JimuMapView | null) =>
      updateResource("jimuMapView", view),
    setSketchViewModel: (vm: __esri.SketchViewModel | null) =>
      updateResource("sketchViewModel", vm),
    setGraphicsLayer: (layer: __esri.GraphicsLayer | null) =>
      updateResource("graphicsLayer", layer),
    setCleanupHandles: (cleanup: (() => void) | null) =>
      updateResource("cleanupHandles", cleanup),
    teardownDrawingResources,
    cleanupResources,
  };
};

/* Error Handling Hooks */

// Hook för att dispatcha fel till Redux store med standardiserad struktur
export const useErrorDispatcher = (
  dispatch: (action: unknown) => void,
  widgetId: string
) =>
  hooks.useEventCallback((message: string, type: ErrorType, code?: string) => {
    const error: SerializableErrorState = {
      message,
      type,
      code: code || "UNKNOWN",
      severity: ErrorSeverity.ERROR,
      recoverable: true,
      timestampMs: Date.now(),
      kind: "serializable",
      userFriendlyMessage: "",
      suggestion: "",
    };
    dispatch(fmeActions.setError("general", error, widgetId));
  });

// Hook för formulärhantering med validering och onChange-notifiering
export const useFormStateManager = (
  validator: {
    initializeValues: () => FormValues;
    validateValues: (values: FormValues) => {
      isValid: boolean;
      errors: { [key: string]: string };
    };
  },
  onValuesChange?: (values: FormValues) => void
) => {
  const [values, setValues] = React.useState<FormValues>(() =>
    validator.initializeValues()
  );
  const [isValid, setIsValid] = React.useState(true);
  const [errors, setErrors] = React.useState<{ [key: string]: string }>({});

  // Synkar värden och notifierar onChange-callback
  const syncValues = hooks.useEventCallback((next: FormValues) => {
    setValues(next);
    onValuesChange?.(next);
  });

  // Uppdaterar enskilt fält och synkar
  const updateField = hooks.useEventCallback(
    (field: string, value: FormPrimitive) => {
      const updated = { ...values, [field]: value };
      syncValues(updated);
    }
  );

  // Validerar formulär och uppdaterar isValid/errors
  const validateForm = hooks.useEventCallback(() => {
    const validation = validator.validateValues(values);
    setIsValid(validation.isValid);
    setErrors(validation.errors);
    return validation;
  });

  // Återställer formulär till initialvärden
  const resetForm = hooks.useEventCallback(() => {
    const nextValues = validator.initializeValues();
    setErrors({});
    setIsValid(true);
    syncValues(nextValues);
  });

  return {
    values,
    isValid,
    errors,
    updateField,
    validateForm,
    resetForm,
    setValues: syncValues,
    setIsValid,
    setErrors,
  };
};

/* Settings Panel Hooks */

// Selector för builder-state (fallback till runtime state)
export const useBuilderSelector = <T>(selector: (state: IMState) => T): T => {
  return useSelector((state: IMState) => {
    const builderState = state?.appStateInBuilder;
    const effectiveState = builderState ?? state;
    return selector(effectiveState);
  });
};

// Hook för selector med shallowEqual optimization
export const useShallowEqualSelector = <T>(
  selector: (state: IMState) => T
): T => {
  return useSelector(selector, shallowEqual);
};

// Hook för builder-selector med shallowEqual optimization
export const useBuilderShallowEqualSelector = <T>(
  selector: (state: IMState) => T
): T => {
  return useSelector((state: IMState) => {
    const builderState = state?.appStateInBuilder;
    const effectiveState = builderState ?? state;
    return selector(effectiveState);
  }, shallowEqual);
};

// Hook för config-uppdateringar (använder Immutable.set om tillgänglig)
export const useUpdateConfig = (
  id: string,
  config: unknown,
  onSettingChange: (update: { id: string; config: unknown }) => void
) => {
  return hooks.useEventCallback((key: string, value: unknown) => {
    const configWithSet = config as ConfigWithImmutable;
    onSettingChange({
      id,
      config: configWithSet.set ? configWithSet.set(key, value) : config,
    });
  });
};

// Config-value getters för type-safe access med defaults

// Hämtar string-värde från config med fallback
export const useStringConfigValue = (config: unknown) => {
  const configRef = hooks.useLatest(config);
  return hooks.useEventCallback((key: string, defaultValue = ""): string => {
    const v = configRef.current?.[key];
    return typeof v === "string" ? v : defaultValue;
  });
};

// Hämtar boolean-värde från config med fallback
export const useBooleanConfigValue = (config: unknown) => {
  const configRef = hooks.useLatest(config);
  return hooks.useEventCallback(
    (key: string, defaultValue = false): boolean => {
      const v = configRef.current?.[key];
      return typeof v === "boolean" ? v : defaultValue;
    }
  );
};

// Hämtar number-värde från config med fallback
export const useNumberConfigValue = (config: unknown) => {
  const configRef = hooks.useLatest(config);
  return hooks.useEventCallback(
    (key: string, defaultValue?: number): number | undefined => {
      const v = configRef.current?.[key];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      return defaultValue;
    }
  );
};

type UseThemeHook = () => unknown;

const useFallbackTheme: UseThemeHook = () => {
  const [theme] = React.useState<{ [key: string]: unknown }>(() => ({}));
  return theme;
};

let resolvedUseTheme: UseThemeHook | null = null;
let loadThemeHookPromise: Promise<UseThemeHook> | null = null;

const getGlobalUseTheme = (): UseThemeHook | null => {
  try {
    const candidate = (
      globalThis as unknown as { jimuTheme?: { useTheme?: UseThemeHook } }
    )?.jimuTheme?.useTheme;
    return typeof candidate === "function" ? candidate : null;
  } catch {
    return null;
  }
};

const resolveUseThemeHook = (): UseThemeHook => {
  if (resolvedUseTheme) {
    return resolvedUseTheme;
  }

  const globalHook = getGlobalUseTheme();
  if (globalHook) {
    resolvedUseTheme = globalHook;
    return resolvedUseTheme;
  }

  resolvedUseTheme = useFallbackTheme;
  return resolvedUseTheme;
};

const loadUseThemeHook = (): Promise<UseThemeHook> => {
  if (loadThemeHookPromise) {
    return loadThemeHookPromise;
  }

  loadThemeHookPromise = import("jimu-theme")
    .then((mod) => {
      const hook =
        mod && typeof mod.useTheme === "function"
          ? (mod.useTheme as UseThemeHook)
          : (getGlobalUseTheme() ?? useFallbackTheme);
      resolvedUseTheme = hook;
      return hook;
    })
    .catch(() => {
      resolvedUseTheme = getGlobalUseTheme() ?? useFallbackTheme;
      return resolvedUseTheme;
    });

  return loadThemeHookPromise;
};

// Hook för att skapa styled-components från jimu-theme
export const useSettingStyles = <TStyles>(
  createStylesFn: (theme: IMThemeVariables) => TStyles
): TStyles => {
  const [, forceRender] = React.useReducer((count) => count + 1, 0);
  const themeHookRef = React.useRef<UseThemeHook | null>(null);

  if (themeHookRef.current === null) {
    themeHookRef.current = resolveUseThemeHook();
  }

  hooks.useEffectOnce(() => {
    if (themeHookRef.current === useFallbackTheme) {
      loadUseThemeHook().then((hook) => {
        if (hook !== themeHookRef.current) {
          themeHookRef.current = hook;
          forceRender();
        }
      });
    }
  });

  const activeHook = themeHookRef.current ?? useFallbackTheme;
  const theme = activeHook();
  return createStylesFn(theme as IMThemeVariables);
};

/* UI Component Hooks */

let idSeq = 0;

// Genererar unikt ID för UI-komponenter (persistent över renders)
export const useUniqueId = (): string => {
  const idRef = React.useRef<string>();
  if (!idRef.current) {
    if (idSeq >= Number.MAX_SAFE_INTEGER) {
      idSeq = 0;
    }
    idSeq += 1;
    idRef.current = `fme-${idSeq}`;
  }
  return idRef.current;
};

// Hook för controlled value med onChange-callback (via useControlled)
export const useControlledValue = <T = unknown>(
  controlled?: T,
  defaultValue?: T,
  onChange?: (value: T) => void
): readonly [T, (value: T) => void] => {
  const [value, setValue] = hooks.useControlled({
    controlled,
    default: defaultValue,
  });

  const handleChange = hooks.useEventCallback((newValue: T) => {
    setValue(newValue);
    onChange?.(newValue);
  });

  return [value, handleChange] as const;
};

/* Loading Latch Hook */

interface LoadableState {
  readonly kind: string;
  readonly message?: React.ReactNode;
  readonly detail?: React.ReactNode;
  readonly messages?: readonly React.ReactNode[];
  [key: string]: unknown;
}

const createLoadingSnapshot = (
  source: LoadableState | null | undefined
): LoadingSnapshot => {
  if (!source) return null;
  const message = source.message;
  const detail = source.detail;
  const rawMessages = source.messages;
  const messages = Array.isArray(rawMessages)
    ? (rawMessages.filter(
        (entry) => entry !== null && entry !== undefined
      ) as readonly React.ReactNode[])
    : undefined;

  if (
    message == null &&
    detail == null &&
    (!messages || messages.length === 0)
  ) {
    return null;
  }

  return { message, detail, messages };
};

// Hook för att låsa loading-state i minsta tid (undviker flicker)
export const useLoadingLatch = (
  state: LoadableState,
  delay: number
): { showLoading: boolean; snapshot: LoadingSnapshot } => {
  const safeDelay = isNonNegativeNumber(delay) ? delay : 0;
  const [latched, setLatched] = React.useState(state.kind === "loading");
  const startRef = React.useRef<number | null>(
    state.kind === "loading" ? Date.now() : null
  );
  const snapshotRef = React.useRef<LoadingSnapshot>(
    state.kind === "loading" ? createLoadingSnapshot(state) : null
  );

  const resetLatch = hooks.useEventCallback(() => {
    setLatched(false);
    startRef.current = null;
    snapshotRef.current = null;
  });

  hooks.useEffectWithPreviousValues(() => {
    if (state.kind === "loading") {
      snapshotRef.current = createLoadingSnapshot(state);
      if (startRef.current == null) {
        startRef.current = Date.now();
      }
      setLatched(true);
      return undefined;
    }

    if (startRef.current == null) {
      resetLatch();
      return undefined;
    }

    const elapsed = Date.now() - startRef.current;
    const safeElapsed = isNonNegativeNumber(elapsed) ? elapsed : 0;
    const remaining = Math.max(0, safeDelay - safeElapsed);

    if (remaining === 0) {
      resetLatch();
      return undefined;
    }

    const timer = setTimeout(() => {
      resetLatch();
    }, remaining);

    return () => {
      clearTimeout(timer);
    };
  }, [state, safeDelay, resetLatch]);

  const isLoading = state.kind === "loading";
  const snapshot = isLoading
    ? createLoadingSnapshot(state)
    : snapshotRef.current;

  return {
    showLoading: isLoading || latched,
    snapshot,
  };
};

/* Abort Controller Hooks */

// Hook för att hantera senaste AbortController med cancel/create
export const useLatestAbortController = () => {
  const controllerRef = React.useRef<AbortController | null>(null);

  // Avbryter aktuell controller och rensar referens
  const cancel = hooks.useEventCallback(() => {
    const controller = controllerRef.current;
    safeAbortController(controller);
    controllerRef.current = null;
  });

  // Avbryter befintlig och skapar ny AbortController
  const abortAndCreate = hooks.useEventCallback(() => {
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  });

  // Rensar controller-referens om den matchar given controller
  const finalize = hooks.useEventCallback(
    (controller?: AbortController | null) => {
      if (!controller) return;
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  );

  return {
    controllerRef,
    abortAndCreate,
    cancel,
    finalize,
  };
};

/* Query System Domain Hooks (React Query) */

// Hook för att hämta workspaces från repository
export function useWorkspaces(
  config: {
    repository?: string;
    fmeServerUrl?: string;
    fmeServerToken?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery<WorkspaceItem[]>({
    queryKey: queryKeys.workspaces(
      config.repository || DEFAULT_REPOSITORY,
      config.fmeServerUrl,
      config.fmeServerToken
    ),
    queryFn: async ({ signal }) => {
      const client = createFmeClient(
        config.fmeServerUrl,
        config.fmeServerToken,
        config.repository
      );
      if (!client) {
        throw new Error("FME client not initialized");
      }

      const repositoryName = config.repository || DEFAULT_REPOSITORY;
      const response = await client.getRepositoryItems(
        repositoryName,
        WORKSPACE_ITEM_TYPE,
        undefined,
        undefined,
        signal
      );

      const items = Array.isArray(response?.data?.items)
        ? (response.data.items as WorkspaceItem[])
        : [];
      return items;
    },
    enabled:
      (options?.enabled ?? true) &&
      Boolean(config.fmeServerUrl && config.fmeServerToken),
  });
}

// Hook för att hämta workspace-item med parametrar
export function useWorkspaceItem(
  workspace: string | undefined,
  config: {
    repository?: string;
    fmeServerUrl?: string;
    fmeServerToken?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery<{
    item: WorkspaceItemDetail;
    parameters: WorkspaceParameter[];
  }>({
    queryKey: queryKeys.workspaceItem(
      workspace,
      config.repository || DEFAULT_REPOSITORY,
      config.fmeServerUrl,
      config.fmeServerToken
    ),
    queryFn: async ({ signal }) => {
      if (!workspace) {
        throw new Error("Workspace name required");
      }

      const client = createFmeClient(
        config.fmeServerUrl,
        config.fmeServerToken,
        config.repository
      );
      if (!client) {
        throw new Error("FME client not initialized");
      }

      const repositoryName = config.repository || DEFAULT_REPOSITORY;

      // Hämta workspace-item och parametrar parallellt
      const [itemResult, paramsResult] = await Promise.allSettled([
        client.getWorkspaceItem(workspace, repositoryName, signal),
        client.getWorkspaceParameters(workspace, repositoryName, signal),
      ]);

      // Kasta fel om item-hämtning misslyckas
      if (itemResult.status === "rejected") {
        const error = itemResult.reason;
        throw error instanceof Error
          ? error
          : new Error(
              typeof error === "string" && error.trim()
                ? error
                : "Failed to fetch workspace item"
            );
      }

      let parameters: WorkspaceParameter[] = [];
      if (
        paramsResult.status === "fulfilled" &&
        isWorkspaceParameterArray(paramsResult.value?.data)
      ) {
        parameters = paramsResult.value.data;
      }

      const itemValue = itemResult.value?.data;
      if (!isWorkspaceItemDetail(itemValue)) {
        throw new Error("Workspace item missing data");
      }

      return {
        item: itemValue,
        parameters,
      };
    },
    enabled:
      (options?.enabled ?? true) &&
      Boolean(workspace && config.fmeServerUrl && config.fmeServerToken),
    staleTime: TIME_CONSTANTS.TEN_MINUTES,
    refetchOnMount: false,
  });
}

// Hook för att prefetcha workspaces i chunks med progress-callback
export function usePrefetchWorkspaces(
  workspaces: readonly WorkspaceItem[] | undefined,
  config: {
    repository?: string;
    fmeServerUrl?: string;
    fmeServerToken?: string;
  },
  options?: {
    enabled?: boolean;
    chunkSize?: number;
    onProgress?: (loaded: number, total: number) => void;
  }
) {
  const queryClient = useQueryClient();

  const [state, setState] = React.useState<{
    isPrefetching: boolean;
    progress: { loaded: number; total: number } | null;
    prefetchStatus: "idle" | "loading" | "success" | "error";
  }>(() => ({
    isPrefetching: false,
    progress: null,
    prefetchStatus: "idle",
  }));

  const enabled = options?.enabled ?? true;
  const chunkSize = options?.chunkSize ?? 10;

  const configRef = hooks.useLatest(config);
  const workspacesRef = hooks.useLatest(workspaces);
  const onProgressRef = hooks.useLatest(options?.onProgress);

  hooks.useEffectWithPreviousValues(() => {
    const workspacesSnapshot = workspacesRef.current;

    let cancelled = false;
    const abortControllers = new Set<AbortController>();

    const abortAllControllers = (reason?: unknown): void => {
      abortControllers.forEach((controller) => {
        safeAbortController(controller, reason);
      });
      abortControllers.clear();
    };

    const cleanup = () => {
      cancelled = true;
      abortAllControllers();
    };

    if (!enabled || !workspacesSnapshot?.length) {
      setState({
        isPrefetching: false,
        progress: null,
        prefetchStatus: "idle",
      });
      return cleanup;
    }

    const configSnapshot = configRef.current ?? {};
    const repository = configSnapshot.repository || DEFAULT_REPOSITORY;
    const fmeServerUrl = configSnapshot.fmeServerUrl;
    const fmeServerToken = configSnapshot.fmeServerToken;
    if (!fmeServerUrl || !fmeServerToken) {
      return cleanup;
    }

    const client = createFmeClient(fmeServerUrl, fmeServerToken, repository);
    if (!client) {
      return cleanup;
    }

    const registerAbortController = (
      controller: AbortController
    ): (() => void) => {
      abortControllers.add(controller);
      return () => {
        abortControllers.delete(controller);
      };
    };

    const linkSignals = (
      source: AbortSignal | undefined,
      controller: AbortController
    ): (() => void) => {
      return linkAbortSignal(source, controller);
    };

    const prefetch = async () => {
      setState({
        isPrefetching: true,
        progress: { loaded: 0, total: workspacesSnapshot.length },
        prefetchStatus: "loading",
      });

      // Dela workspaces i chunks för batch-prefetch
      const chunks: WorkspaceItem[][] = [];
      for (let i = 0; i < workspacesSnapshot.length; i += chunkSize) {
        chunks.push(workspacesSnapshot.slice(i, i + chunkSize));
      }

      let loaded = 0;

      try {
        for (const chunk of chunks) {
          if (cancelled) break;

          // Prefetcha chunk med max samtidiga requests för att inte överbelasta browser/nätverk
          const MAX_CONCURRENT = NETWORK_CONFIG.MAX_CONCURRENT_PREFETCH;
          const semaphore = { active: 0, queue: [] as Array<() => void> };

          const withLimit = async <T>(fn: () => Promise<T>): Promise<T> => {
            while (semaphore.active >= MAX_CONCURRENT) {
              await new Promise<void>((resolve) =>
                semaphore.queue.push(resolve)
              );
            }
            semaphore.active++;
            try {
              return await fn();
            } finally {
              semaphore.active--;
              const next = semaphore.queue.shift();
              if (next) next();
            }
          };

          // Prefetcha alla workspaces i chunk parallellt med begränsning
          await Promise.allSettled(
            chunk.map((ws) =>
              withLimit(() =>
                queryClient.prefetchQuery({
                  queryKey: queryKeys.workspaceItem(
                    ws.name,
                    repository,
                    fmeServerUrl,
                    fmeServerToken
                  ),
                  queryFn: async ({ signal }) => {
                    const controller = new AbortController();
                    const unregister = registerAbortController(controller);
                    const unlink = linkSignals(signal, controller);
                    try {
                      const effectiveSignal = controller.signal;
                      const [itemResp, paramsResp] = await Promise.all([
                        client.getWorkspaceItem(
                          ws.name,
                          repository,
                          effectiveSignal
                        ),
                        client.getWorkspaceParameters(
                          ws.name,
                          repository,
                          effectiveSignal
                        ),
                      ]);
                      return {
                        item: itemResp.data,
                        parameters: Array.isArray(paramsResp?.data)
                          ? paramsResp.data
                          : [],
                      };
                    } finally {
                      unlink();
                      unregister();
                    }
                  },
                  staleTime: TIME_CONSTANTS.TEN_MINUTES,
                })
              )
            )
          );

          // Check if cancelled before updating state
          if (cancelled) break;

          // Uppdatera progress efter varje chunk
          loaded += chunk.length;
          setState((prev) => ({
            ...prev,
            progress: { loaded, total: workspacesSnapshot.length },
          }));
          onProgressRef.current?.(loaded, workspacesSnapshot.length);
        }

        if (!cancelled) {
          setState({
            isPrefetching: false,
            progress: null,
            prefetchStatus: "success",
          });
        }
      } catch (error) {
        if (!cancelled) {
          logIfNotAbort("Workspace prefetch error", error);
          setState({
            isPrefetching: false,
            progress: null,
            prefetchStatus: "error",
          });
        }
      } finally {
        abortAllControllers();
      }
    };

    void prefetch();

    return cleanup;
  }, [
    enabled,
    queryClient,
    chunkSize,
    onProgressRef,
    config?.repository,
    config?.fmeServerUrl,
    config?.fmeServerToken,
    workspaces,
  ]);

  return state;
}

// Hook för att hämta repositories från FME Flow
export function useRepositories(
  serverUrl: string | undefined,
  token: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery<Array<{ name: string }>>({
    queryKey: ["fme", "repositories", serverUrl, buildTokenCacheKey(token)],
    queryFn: async ({ signal }) => {
      const client = createFmeClient(serverUrl, token, DEFAULT_REPOSITORY);
      if (!client) {
        throw new Error("FME client not initialized");
      }

      const response = await client.getRepositories(signal);
      return response.data ?? [];
    },
    enabled: (options?.enabled ?? true) && Boolean(serverUrl && token),
  });
}

// Hook för health-check mot FME Flow
export function useHealthCheck(
  serverUrl: string | undefined,
  token: string | undefined,
  options?: { enabled?: boolean; refetchOnWindowFocus?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.health(serverUrl, token),
    queryFn: async ({ signal }) => {
      if (!serverUrl || !token) {
        throw new Error("Missing credentials");
      }
      return await healthCheck(serverUrl, token, signal);
    },
    enabled: (options?.enabled ?? true) && Boolean(serverUrl && token),
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
  });
}

// Hook för connection-validering med abort-hantering
export function useValidateConnection() {
  const queryClient = useQueryClient();
  const controllerRef = React.useRef<AbortController | null>(null);

  // Avbryter pågående validering
  const cancel = hooks.useEventCallback(() => {
    const controller = controllerRef.current;
    if (controller && !controller.signal.aborted) {
      try {
        controller.abort();
      } catch {}
    }
    controllerRef.current = null;
  });

  const mutation = useMutation<
    ConnectionValidationResult,
    Error,
    ValidateConnectionVariables
  >({
    mutationFn: async (variables) => {
      return await validateConnection({
        serverUrl: variables.serverUrl,
        token: variables.token,
        repository: variables.repository,
        signal: controllerRef.current?.signal,
      });
    },
    onSuccess: (data, variables) => {
      // Uppdatera health-check cache vid lyckad validering
      if (data.success) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.health(variables.serverUrl, variables.token),
        });
      }
    },
  });

  // Avbryter befintlig och kör ny validering
  const mutateAsync = hooks.useEventCallback(
    async (variables: ValidateConnectionVariables) => {
      cancel();
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        return await mutation.mutateAsync(variables);
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    }
  );

  // Fire-and-forget variant av mutateAsync
  const mutate = hooks.useEventCallback(
    (variables: ValidateConnectionVariables) => {
      void mutateAsync(variables);
    }
  );

  // Avbryt pågående validering vid unmount
  hooks.useUnmount(() => {
    cancel();
  });

  return {
    ...mutation,
    mutate,
    mutateAsync,
  };
}

// Hook för att hantera loading-flags med minimum display time
export function useMinLoadingTime(
  reduxDispatch: Dispatch,
  widgetId: string,
  minimumMs = TIME_CONSTANTS.MIN_LOADING_DELAY_MS
) {
  const startTimesRef = React.useRef<{ [key: string]: number }>({});

  const setFlag = hooks.useEventCallback((flag: string, value: boolean) => {
    if (value) {
      // Loading startar - sätt omedelbart och spara starttid
      startTimesRef.current[flag] = Date.now();
      reduxDispatch(
        fmeActions.setLoadingFlag(flag as LoadingFlagKey, true, widgetId)
      );
    } else {
      // Loading slutar - säkerställ minimum display time
      const startTime = startTimesRef.current[flag];
      if (startTime) {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, minimumMs - elapsed);

        if (remaining > 0) {
          setTimeout(() => {
            reduxDispatch(
              fmeActions.setLoadingFlag(flag as LoadingFlagKey, false, widgetId)
            );
            delete startTimesRef.current[flag];
          }, remaining);
        } else {
          reduxDispatch(
            fmeActions.setLoadingFlag(flag as LoadingFlagKey, false, widgetId)
          );
          delete startTimesRef.current[flag];
        }
      } else {
        reduxDispatch(
          fmeActions.setLoadingFlag(flag as LoadingFlagKey, false, widgetId)
        );
      }
    }
  });

  return setFlag;
}
