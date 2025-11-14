import type {
  ArcgisGeometryModules,
  AreaEvaluation,
  AreasAndLengthsParametersCtor,
  AreaStrategy,
  ErrorState,
  EsriConfigLike,
  EsriModules,
  FmeExportConfig,
  GeoJsonPolygon,
  GeometryEngineLike,
  GeometryServiceModule,
  MutableParams,
  NormalizeUtilsModule,
  PolygonLike,
  PolygonMaybe,
  Ring,
  SerializableErrorState,
  WorkspaceParameter,
} from "../../config/index";
import {
  DEGREES_PER_METER,
  ErrorSeverity,
  ErrorType,
  GEODESIC_SEGMENT_LENGTH_METERS,
  GEOMETRY_CONSTS,
  MIN_PLANAR_SEGMENT_DEGREES,
  ParameterType,
  VALIDATION_LIMITS,
} from "../../config/index";
import {
  ensureArray,
  sanitizeParamKey,
  toNumberValue,
  toTrimmedString,
} from "./conversion";
import { createGeometryError } from "./error";
import { loadArcgisModules } from "./index";
import { logDebug, logWarn } from "./logging";

const createAoiSerializationError = (): ErrorState => ({
  message: "GEOMETRY_SERIALIZATION_FAILED",
  type: ErrorType.GEOMETRY,
  code: "GEOMETRY_SERIALIZATION_FAILED",
  severity: ErrorSeverity.ERROR,
  recoverable: true,
  timestamp: new Date(),
  timestampMs: Date.now(),
});

// Jämför två koordinater med numerisk tolerans
export const coordinatesEqual = (a: unknown, b: unknown): boolean => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2)
    return false;

  const len = Math.min(a.length, b.length, 2);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (typeof av !== "number" || typeof bv !== "number") return false;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
    if (Math.abs(av - bv) > 1e-9) return false;
  }
  return true;
};

const normalizeCoordinate = (vertex: unknown): number[] | null => {
  if (!Array.isArray(vertex) || vertex.length < 2) return null;

  const x = typeof vertex[0] === "string" ? Number(vertex[0]) : vertex[0];
  const y = typeof vertex[1] === "string" ? Number(vertex[1]) : vertex[1];

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const result: number[] = [x, y];

  if (vertex.length > 2) {
    const z = typeof vertex[2] === "string" ? Number(vertex[2]) : vertex[2];
    if (Number.isFinite(z)) result.push(z);
  }

  if (vertex.length > 3) {
    const m = typeof vertex[3] === "string" ? Number(vertex[3]) : vertex[3];
    if (Number.isFinite(m)) result.push(m);
  }

  return result;
};

// Normaliserar en polygon-ring och säkerställer att den är stängd
export const normalizeRing = (ring: unknown): number[][] => {
  if (!Array.isArray(ring)) return [];
  const coords: number[][] = [];
  for (const vertex of ring) {
    const tuple = normalizeCoordinate(vertex);
    if (tuple) coords.push(tuple);
  }
  if (coords.length < 3) return [];

  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!coordinatesEqual(first, last)) {
    coords.push([...first]);
  }
  return coords;
};

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isValidCoordinateTuple = (pt: unknown): pt is number[] =>
  Array.isArray(pt) &&
  pt.length >= 2 &&
  pt.length <= 4 &&
  pt.every(isFiniteCoordinate);

const isObjectLike = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const isValidRing = (ring: unknown): boolean => {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  if (!ring.every(isValidCoordinateTuple)) return false;

  const first = ring[0];
  const last = ring[ring.length - 1];
  return coordinatesEqual(first, last);
};

// Kontrollerar om värde är ett giltigt polygon-objekt
export const isPolygonGeometry = (
  value: unknown
): value is { rings: unknown } | { geometry: { rings: unknown } } => {
  if (!isObjectLike(value)) return false;

  const geom =
    "geometry" in value ? (value as { geometry: unknown }).geometry : value;

  if (!isObjectLike(geom)) return false;

  const rings =
    "rings" in geom ? (geom as { rings: unknown }).rings : undefined;

  return Array.isArray(rings) && rings.length > 0 && rings.every(isValidRing);
};

// Extraherar rings från polygon-objekt (hanterar olika format)
const extractRings = (polygon: PolygonLike | null | undefined): Ring[] => {
  if (!polygon || typeof polygon !== "object") return [];

  if (Array.isArray(polygon.rings)) return polygon.rings;
  if (Array.isArray(polygon.geometry?.rings)) return polygon.geometry.rings;

  if (typeof polygon.toJSON === "function") {
    try {
      const json = polygon.toJSON();
      if (json && Array.isArray(json.rings)) return json.rings;
    } catch (error) {
      logWarn(
        "Polygon toJSON serialization failed (fallback to direct access)",
        error
      );
    }
  }

  return [];
};

// Konverterar Esri polygon JSON till GeoJSON-format
export const polygonJsonToGeoJson = (
  polygon: PolygonLike | null | undefined
): GeoJsonPolygon | null => {
  if (!polygon) return null;
  try {
    const rings = extractRings(polygon);
    if (!rings.length) {
      logWarn("polygonJsonToGeoJson: No rings found in polygon", polygon);
      return null;
    }
    const normalized = rings
      .map(normalizeRing)
      .filter((ring) => ring.length >= 4);
    if (!normalized.length) {
      logWarn(
        "polygonJsonToGeoJson: No valid rings after normalization",
        polygon
      );
      return null;
    }
    return {
      type: "Polygon",
      coordinates: normalized,
    };
  } catch (err) {
    const isEmptyInput =
      !polygon ||
      (typeof polygon === "object" && !polygon.rings && !polygon.geometry);
    if (isEmptyInput) {
      logWarn("polygonJsonToGeoJson: Empty/invalid input", polygon);
      return null;
    }
    logWarn(
      "polygonJsonToGeoJson: Unexpected serialization exception",
      err,
      polygon
    );
    return null;
  }
};

const formatNumberForWkt = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  const str = value.toString();
  const hasScientific = /[eE]/.test(str);
  const raw = hasScientific ? value.toFixed(12) : str;
  const trimmed = raw.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return trimmed || "0";
};

const serializeCoordinate = (coords: unknown): string | null => {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const values: string[] = [];
  for (const raw of coords) {
    const num = toNumberValue(raw) ?? Number(raw);
    if (!Number.isFinite(num)) return null;
    values.push(formatNumberForWkt(num));
  }
  return values.length >= 2 ? values.join(" ") : null;
};

const serializeRing = (ring: unknown): string[] => {
  if (!Array.isArray(ring)) return [];
  const parts: string[] = [];
  for (const vertex of ring) {
    const serialized = serializeCoordinate(vertex);
    if (serialized) parts.push(serialized);
  }
  return parts;
};

export const polygonJsonToWkt = (
  polygon: PolygonLike | null | undefined
): string => {
  const geojson = polygonJsonToGeoJson(polygon);
  if (!geojson) return "POLYGON EMPTY";

  const rings = Array.isArray(geojson?.coordinates)
    ? (geojson.coordinates as number[][][])
    : [];

  if (!rings.length) return "POLYGON EMPTY";

  const serialized = rings
    .map(serializeRing)
    .filter((parts) => parts.length >= 4)
    .map((parts) => `(${parts.join(", ")})`)
    .filter((ring) => ring !== "()" && ring !== "( )");

  if (!serialized.length) return "POLYGON EMPTY";

  return `POLYGON(${serialized.join(", ")})`;
};

// Spatial reference utilities (consolidated from validations.ts)
export const readWkids = (
  sr: unknown
): { wkid?: number; latestWkid?: number } => {
  if (typeof sr !== "object" || sr === null) {
    return {};
  }

  const ref = sr as { wkid?: unknown; latestWkid?: unknown };
  const wkid = typeof ref.wkid === "number" ? ref.wkid : undefined;
  const latestWkid =
    typeof ref.latestWkid === "number" ? ref.latestWkid : undefined;

  return { wkid, latestWkid };
};

export const isWebMercatorSr = (sr: unknown): boolean => {
  const ref = sr as { isWebMercator?: boolean } | undefined;
  if (ref?.isWebMercator) return true;
  const { wkid, latestWkid } = readWkids(sr);
  const WKID_WEB_MERCATOR = 3857;
  return wkid === WKID_WEB_MERCATOR || latestWkid === WKID_WEB_MERCATOR;
};

export const isWgs84Sr = (sr: unknown): boolean => {
  const ref = sr as { isGeographic?: boolean; isWGS84?: boolean } | undefined;
  if (ref?.isGeographic || ref?.isWGS84) return true;
  const { wkid, latestWkid } = readWkids(sr);
  const WKID_WGS84 = 4326;
  return wkid === WKID_WGS84 || latestWkid === WKID_WGS84;
};

export const isGeographicSpatialRef = (polygon: __esri.Polygon): boolean => {
  try {
    if (
      isWgs84Sr(polygon.spatialReference) ||
      isWebMercatorSr(polygon.spatialReference)
    ) {
      return true;
    }

    const json = polygon.toJSON?.();
    if (json && typeof json === "object") {
      const spatialRef = (json as { spatialReference?: unknown })
        .spatialReference;
      return isWgs84Sr(spatialRef) || isWebMercatorSr(spatialRef);
    }
  } catch {}

  return false;
};

const projectToWgs84 = (
  poly: __esri.Polygon,
  modules: EsriModules
): __esri.Polygon | null => {
  const { projection, SpatialReference } = modules;
  if (!projection?.project || !SpatialReference) return null;

  const target =
    SpatialReference.WGS84 ??
    (typeof SpatialReference.fromJSON === "function"
      ? SpatialReference.fromJSON({ wkid: 4326 })
      : new SpatialReference({ wkid: 4326 }));

  const projected = projection.project(poly, target);
  if (Array.isArray(projected)) {
    return (projected[0] as __esri.Polygon) || null;
  }
  return (projected as __esri.Polygon) || null;
};

export const toWgs84PolygonJson = (
  polygonJson: PolygonLike | null | undefined,
  modules: EsriModules | null | undefined
): PolygonLike | null => {
  if (!modules?.Polygon) return polygonJson ?? null;

  try {
    const polygon = modules.Polygon.fromJSON(polygonJson);
    if (!polygon) {
      logWarn("toWgs84PolygonJson: Failed to create Polygon from JSON");
      return polygonJson ?? null;
    }

    const spatialRef = polygon.spatialReference;
    if (isWgs84Sr(spatialRef)) {
      return polygon.toJSON();
    }

    const projected = projectToWgs84(polygon, modules);
    if (projected?.toJSON) {
      const result = projected.toJSON();
      const resultSpatialRef = result?.spatialReference;
      if (isWgs84Sr(resultSpatialRef)) {
        if (!resultSpatialRef?.wkid) {
          result.spatialReference = { wkid: 4326 };
        }
        return result;
      }
      logWarn("toWgs84PolygonJson: Projection did not produce WGS84 geometry");
    }

    const { webMercatorUtils } = modules;
    if (webMercatorUtils?.webMercatorToGeographic) {
      const geographic = webMercatorUtils.webMercatorToGeographic(
        polygon
      ) as __esri.Polygon;
      if (geographic?.toJSON) {
        return geographic.toJSON();
      }
    }

    logWarn(
      "toWgs84PolygonJson: Returning original polygon (projection failed)"
    );
    return polygon.toJSON();
  } catch (err) {
    logWarn("toWgs84PolygonJson: Error during projection", err);
    return polygonJson ?? null;
  }
};

export const collectGeometryParamNames = (
  params?: readonly WorkspaceParameter[] | null
): readonly string[] => {
  if (!params?.length) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const param of params) {
    if (!param || param.type !== ParameterType.GEOMETRY) continue;
    const trimmed = toTrimmedString(param.name);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    names.push(trimmed);
  }
  return names;
};

export const summarizeGeometryParameters = (
  params?: readonly WorkspaceParameter[] | null
): {
  readonly names: readonly string[];
  readonly count: number;
  readonly warning: boolean;
} => {
  const names = collectGeometryParamNames(params);
  return {
    names,
    count: names.length,
    warning: names.length > 1,
  };
};

const extractPolygonJson = (
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): unknown => {
  if (isPolygonGeometry(geometryJson)) {
    if ("geometry" in geometryJson) {
      return geometryJson.geometry;
    }
    return geometryJson;
  }

  const fallback = currentGeometry?.toJSON();
  return isPolygonGeometry(fallback) ? fallback : null;
};

const safeStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  _modules: EsriModules | null | undefined,
  config?: FmeExportConfig,
  geometryParamNames?: readonly string[]
): { [key: string]: unknown } => {
  const paramName = sanitizeParamKey(config?.aoiParamName, "AreaOfInterest");
  const aoiJson = extractPolygonJson(geometryJson, currentGeometry);
  if (!aoiJson) return base;

  const serialized = safeStringify(aoiJson);
  if (!serialized) {
    return { ...base, __aoi_error__: createAoiSerializationError() };
  }

  const result: { [key: string]: unknown } = {
    ...base,
    [paramName]: serialized,
  };

  if (geometryParamNames?.length) {
    const extras = new Set<string>();
    for (const name of geometryParamNames) {
      if (typeof name !== "string") continue;
      const sanitized = sanitizeParamKey(name, "");
      if (sanitized && sanitized !== paramName) extras.add(sanitized);
    }
    for (const extra of extras) {
      result[extra] = serialized;
    }
  }

  return result;
};

export const removeAoiErrorMarker = (params: MutableParams): void => {
  if (typeof params.__aoi_error__ !== "undefined") {
    delete params.__aoi_error__;
  }
};

export const makeGeoJson = (polygon: __esri.Polygon) => {
  if (!polygon) {
    return { type: "Polygon" as const, coordinates: [] as const };
  }

  try {
    const polyJson =
      typeof polygon.toJSON === "function"
        ? polygon.toJSON()
        : {
            rings: Array.isArray((polygon as { rings?: unknown }).rings)
              ? (polygon as { rings?: Ring[] }).rings
              : undefined,
          };
    const geo = polygonJsonToGeoJson(polyJson);
    if (geo) return geo;
  } catch (error) {
    void error;
  }

  const polygonRings = (polygon as { rings?: unknown }).rings;
  const rings: readonly unknown[] = Array.isArray(polygonRings)
    ? polygonRings
    : [];

  const normalized: number[][][] = rings
    .map((ring) => normalizeRing(ring))
    .filter((ring) => ring.length >= 4);

  if (!normalized.length) {
    return { type: "Polygon" as const, coordinates: [] as number[][][] };
  }

  return {
    type: "Polygon" as const,
    coordinates: normalized,
  };
};

// Promise-like type guard
const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof (value as { then?: unknown }).then === "function";

// Polygon geometry type guard
const isPolygonGeometryLike = (value: unknown): value is __esri.Polygon =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "polygon";

// Module caching for lazy loading
let normalizeUtilsCache: NormalizeUtilsModule | null | undefined;
let geometryServiceCache: GeometryServiceModule | null | undefined;
let areasAndLengthsParamsCache:
  | AreasAndLengthsParametersCtor
  | null
  | undefined;
let esriConfigCache: EsriConfigLike | null | undefined;

// Unpacks module object to .default or the module itself
const unwrapModule = (module: unknown): unknown =>
  (module as { default?: unknown }).default ?? module;

// Beräknar area med geodesic/planar via GeometryEngine
const tryCalcArea = async (
  engine: GeometryEngineLike | undefined,
  polygon: __esri.Polygon,
  isGeographic: boolean
): Promise<number> => {
  if (!engine) return 0;

  const geodesicAreaFn = engine.geodesicArea;
  if (isGeographic && typeof geodesicAreaFn === "function") {
    try {
      const area = await geodesicAreaFn(polygon, "square-meters");
      if (Number.isFinite(area) && area > 0) return area;
    } catch (error) {
      logWarn("geodesicArea calculation failed, trying planar fallback", error);
    }
  }

  const planarAreaFn = engine.planarArea;
  if (typeof planarAreaFn === "function") {
    try {
      const area = await planarAreaFn(polygon, "square-meters");
      if (Number.isFinite(area) && area > 0) return area;
    } catch (error) {
      logWarn("planarArea calculation failed", error);
    }
  }

  return 0;
};

// Laddar & cachar normalizeUtils modul om ej tillgänglig i modules
const ensureNormalizeUtils = async (
  modules: ArcgisGeometryModules
): Promise<NormalizeUtilsModule | null> => {
  if (modules?.normalizeUtils?.normalizeCentralMeridian) {
    return modules.normalizeUtils;
  }

  if (normalizeUtilsCache !== undefined) return normalizeUtilsCache;

  try {
    const [normalizeUtilsMod] = await loadArcgisModules([
      "esri/geometry/support/normalizeUtils",
    ]);
    normalizeUtilsCache = unwrapModule(
      normalizeUtilsMod
    ) as NormalizeUtilsModule;
  } catch {
    normalizeUtilsCache = null;
  }

  return normalizeUtilsCache;
};

// Laddar & cachar esriConfig modul om ej tillgänglig i modules
const ensureEsriConfig = async (
  modules: ArcgisGeometryModules
): Promise<EsriConfigLike | null> => {
  if (modules?.esriConfig) return modules.esriConfig;
  if (esriConfigCache !== undefined) return esriConfigCache;

  try {
    const [configMod] = await loadArcgisModules(["esri/config"]);
    esriConfigCache = unwrapModule(configMod) as EsriConfigLike;
  } catch {
    esriConfigCache = null;
  }

  return esriConfigCache;
};

// Laddar geometryService & AreasAndLengthsParameters moduler
const ensureGeometryServiceModules = async (): Promise<{
  geometryService: GeometryServiceModule | null;
  AreasAndLengthsParameters: AreasAndLengthsParametersCtor | null;
}> => {
  if (
    geometryServiceCache !== undefined &&
    areasAndLengthsParamsCache !== undefined
  ) {
    return {
      geometryService: geometryServiceCache,
      AreasAndLengthsParameters: areasAndLengthsParamsCache,
    };
  }

  try {
    const [geometryServiceMod, paramsMod] = await loadArcgisModules([
      "esri/rest/geometryService",
      "esri/rest/support/AreasAndLengthsParameters",
    ]);
    const geomService = unwrapModule(
      geometryServiceMod
    ) as GeometryServiceModule;
    const params = unwrapModule(paramsMod) as AreasAndLengthsParametersCtor;

    if (!geomService || !params) {
      logWarn("Geometry service modules returned null after unwrap");
      geometryServiceCache = null;
      areasAndLengthsParamsCache = null;
      return {
        geometryService: null,
        AreasAndLengthsParameters: null,
      };
    }

    geometryServiceCache = geomService;
    areasAndLengthsParamsCache = params;
  } catch (error) {
    logWarn("Failed to load geometry service modules", error);
    geometryServiceCache = null;
    areasAndLengthsParamsCache = null;
  }

  return {
    geometryService: geometryServiceCache,
    AreasAndLengthsParameters: areasAndLengthsParamsCache,
  };
};

// Hämtar geometryServiceUrl från esriConfig eller portalSelf
const resolveGeometryServiceUrl = async (
  modules: ArcgisGeometryModules
): Promise<string | null> => {
  try {
    const directUrl = modules?.esriConfig?.geometryServiceUrl;
    if (typeof directUrl === "string" && directUrl) return directUrl;

    const config = await ensureEsriConfig(modules);
    if (!config) return null;

    const directConfigUrl = config.geometryServiceUrl;
    if (typeof directConfigUrl === "string" && directConfigUrl) {
      return directConfigUrl;
    }

    const requestUrl = config.request?.geometryServiceUrl;
    if (typeof requestUrl === "string" && requestUrl) return requestUrl;

    const helperUrl =
      config.portalSelf?.helperServices?.geometry?.url ||
      config.portalInfo?.helperServices?.geometry?.url ||
      config.helperServices?.geometry?.url;

    if (typeof helperUrl === "string" && helperUrl) return helperUrl;
  } catch {}

  return null;
};

// Wrapprar polygon-värden (kan vara Promise eller synkront)
const maybeResolvePolygon = async (
  value: PolygonMaybe
): Promise<__esri.Polygon | null> => {
  if (!value) return null;
  try {
    const resolved = isPromiseLike(value) ? await value : value;
    if (isPolygonGeometryLike(resolved)) {
      return resolved;
    }
  } catch (error) {
    logWarn("Polygon promise resolution failed", error);
  }
  return null;
};

// Försöker densify med geodesicDensify eller planar densify
const attemptDensify = async (
  engine: GeometryEngineLike | undefined,
  method: "geodesicDensify" | "densify",
  geometry: __esri.Polygon,
  args: readonly unknown[]
): Promise<__esri.Polygon | null> => {
  const densify = engine?.[method];
  if (typeof densify !== "function") return null;
  try {
    const result = densify(geometry, ...(args as [number, string?]));
    return await maybeResolvePolygon(result);
  } catch {
    return null;
  }
};

// Normaliserar polygon över central meridian (WGS84/Web Mercator)
const normalizePolygon = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<__esri.Polygon> => {
  const sr = polygon?.spatialReference;
  const shouldNormalize = isWgs84Sr(sr) || isWebMercatorSr(sr);
  if (!shouldNormalize) return polygon;

  const normalizeUtils = await ensureNormalizeUtils(modules);
  if (!normalizeUtils?.normalizeCentralMeridian) return polygon;

  try {
    const results = await normalizeUtils.normalizeCentralMeridian([polygon]);
    const normalized = Array.isArray(results) ? results[0] : null;
    if (isPolygonGeometryLike(normalized)) {
      if (normalized !== polygon) {
        const originalBounds = polygon.extent;
        const normalizedBounds = normalized.extent;
        if (
          originalBounds &&
          normalizedBounds &&
          Math.abs(originalBounds.xmin - normalizedBounds.xmin) > 180
        ) {
          logDebug("[Geometry] Normalized dateline-crossing polygon", {
            originalExtent: originalBounds,
            normalizedExtent: normalizedBounds,
          });
        }
      }
      return normalized;
    }
  } catch {}

  return polygon;
};

// Applicerar geodesic eller planar densify beroende på SR
const applyDensify = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<__esri.Polygon> => {
  const sr = polygon?.spatialReference;
  const canUseGeodesic = isWgs84Sr(sr) || isWebMercatorSr(sr);
  const isGeographic = isWgs84Sr(sr);

  let working = polygon;

  if (canUseGeodesic) {
    const geodesicArgs: readonly unknown[] = [
      GEODESIC_SEGMENT_LENGTH_METERS,
      "meters",
    ];
    const geodesicResult =
      (await attemptDensify(
        modules?.geometryEngineAsync,
        "geodesicDensify",
        working,
        geodesicArgs
      )) ??
      (await attemptDensify(
        modules?.geometryEngine,
        "geodesicDensify",
        working,
        geodesicArgs
      ));

    if (geodesicResult) {
      working = geodesicResult;
    }
  }

  const planarSegment = isGeographic
    ? Math.max(
        GEODESIC_SEGMENT_LENGTH_METERS * DEGREES_PER_METER,
        MIN_PLANAR_SEGMENT_DEGREES
      )
    : GEODESIC_SEGMENT_LENGTH_METERS;

  const planarArgs: readonly unknown[] = [planarSegment];
  const planarResult =
    (await attemptDensify(
      modules?.geometryEngineAsync,
      "densify",
      working,
      planarArgs
    )) ??
    (await attemptDensify(
      modules?.geometryEngine,
      "densify",
      working,
      planarArgs
    ));

  if (planarResult) {
    working = planarResult;
  }

  return working;
};

// Förbereder polygon: normalisering + densify för area-beräkning
const preparePolygonForArea = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<__esri.Polygon> => {
  let working = polygon;
  working = await normalizePolygon(working, modules);
  working = await applyDensify(working, modules);
  return working;
};

// Beräknar area via remote geometry service (error recovery strategy)
const calcAreaViaGeometryService = async (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules
): Promise<number> => {
  const serviceUrl = await resolveGeometryServiceUrl(modules);
  if (!serviceUrl) return 0;

  const { geometryService, AreasAndLengthsParameters } =
    await ensureGeometryServiceModules();

  if (
    !geometryService?.areasAndLengths ||
    typeof geometryService.areasAndLengths !== "function" ||
    !AreasAndLengthsParameters
  ) {
    return 0;
  }

  try {
    const paramOptions: __esri.AreasAndLengthsParametersProperties & {
      geodesic?: boolean;
    } = {
      polygons: [polygon],
      areaUnit: "square-meters",
      lengthUnit: "meters",
      calculationType: "geodesic",
      geodesic: true,
    };
    const params = new AreasAndLengthsParameters(paramOptions);

    const response = await geometryService.areasAndLengths(serviceUrl, params);
    const area = response?.areas?.[0];
    if (Number.isFinite(area) && Math.abs(area) > 0) {
      return Math.abs(area);
    }
  } catch (error) {
    logDebug("Geometry service area calculation failed, using fallback", error);
  }

  return 0;
};

// Skapar lista med area-strategier för resilient beräkning
const createAreaStrategies = (
  polygon: __esri.Polygon,
  modules: ArcgisGeometryModules,
  geographic: boolean
): AreaStrategy[] => {
  const strategies: AreaStrategy[] = [];

  if (modules?.geometryEngineAsync) {
    strategies.push(() =>
      tryCalcArea(modules.geometryEngineAsync, polygon, geographic)
    );
  }

  if (modules?.geometryEngine) {
    strategies.push(() =>
      tryCalcArea(modules.geometryEngine, polygon, geographic)
    );
  }

  return strategies;
};

// Beräknar area via strategy chain: operators → engine → service
export const calcArea = async (
  geometry: __esri.Geometry | undefined,
  modules: ArcgisGeometryModules
): Promise<number> => {
  if (!geometry || geometry.type !== "polygon") return 0;

  const polygon = geometry as __esri.Polygon;

  const totalVertices =
    polygon.rings?.reduce(
      (sum, ring) => sum + (Array.isArray(ring) ? ring.length : 0),
      0
    ) ?? 0;

  if (totalVertices > VALIDATION_LIMITS.MAX_GEOMETRY_VERTICES) {
    logDebug("[Geometry] Processing complex polygon", {
      vertices: totalVertices,
      rings: polygon.rings?.length ?? 0,
      estimatedProcessingTime: `${Math.round(
        totalVertices / GEOMETRY_CONSTS.VERTICES_PER_MS_ESTIMATE
      )}ms`,
    });
  }

  let prepared = polygon;

  try {
    prepared = await preparePolygonForArea(polygon, modules);
  } catch {
    prepared = polygon;
  }

  const geographic = isGeographicSpatialRef(prepared);

  const strategies = createAreaStrategies(prepared, modules, geographic);
  for (const runStrategy of strategies) {
    try {
      const area = await runStrategy();
      if (area > 0) return area;
    } catch {}
  }

  const geometryServiceArea = await calcAreaViaGeometryService(
    prepared,
    modules
  );
  if (geometryServiceArea > 0) {
    logDebug(
      "[Performance] Fell back to geometry service for area calculation",
      {
        polygonVertices: prepared.rings?.[0]?.length ?? 0,
        spatialReference: prepared.spatialReference?.wkid,
      }
    );
    return geometryServiceArea;
  }

  return 0;
};

// Försöker förenkla polygon med async/sync simplify + validering
const trySimplifyWithFallback = async (
  polygon: __esri.Polygon,
  engine: GeometryEngineLike | undefined,
  engineAsync: GeometryEngineLike | undefined
): Promise<__esri.Polygon | null> => {
  // Först prova async simplify
  const simplifyAsync = engineAsync?.simplify;
  if (typeof simplifyAsync === "function") {
    const asyncResult = await simplifyAsync(polygon);
    const simplified = await maybeResolvePolygon(asyncResult);
    if (simplified) {
      const checkSimple = engineAsync?.isSimple ?? engine?.isSimple;
      if (typeof checkSimple === "function") {
        const simpleResult = checkSimple(simplified);
        const isSimple = isPromiseLike(simpleResult)
          ? await simpleResult
          : simpleResult;
        if (isSimple) return simplified;
      } else {
        return simplified;
      }
    }
  }

  // Sedan prova sync simplify
  const simplifySync = engine?.simplify;
  if (typeof simplifySync === "function") {
    const simplified = await maybeResolvePolygon(simplifySync(polygon));
    if (simplified) {
      const isSimpleFn = engine?.isSimple;
      if (typeof isSimpleFn === "function") {
        const simpleResult = isSimpleFn(simplified);
        const isSimple = isPromiseLike(simpleResult)
          ? await simpleResult
          : simpleResult;
        if (isSimple) return simplified;
      } else {
        return simplified;
      }
    }
  }

  // Slutligen kontrollera om originalet är simple
  const isSimpleFn = engine?.isSimple;
  if (typeof isSimpleFn === "function") {
    const simpleResult = isSimpleFn(polygon);
    const isSimple = isPromiseLike(simpleResult)
      ? await simpleResult
      : simpleResult;
    if (isSimple) return polygon;
  }

  return null;
};

// Förenklar polygon med fallback-strategi
const simplifyPolygon = async (
  poly: __esri.Polygon,
  engine: GeometryEngineLike | undefined,
  engineAsync: GeometryEngineLike | undefined
): Promise<__esri.Polygon | null> => {
  return trySimplifyWithFallback(poly, engine, engineAsync);
};

// Kontrollerar att ring är stängd (första=sista punkt)
const isRingClosed = (ring: unknown[]): boolean => {
  if (!Array.isArray(ring) || ring.length === 0) return false;
  const first = ring[0] as number[] | undefined;
  const last = ring[ring.length - 1] as number[] | undefined;
  return Boolean(
    first &&
      last &&
      Array.isArray(first) &&
      Array.isArray(last) &&
      first[0] === last[0] &&
      first[1] === last[1]
  );
};

// Validerar att alla rings har >=4 punkter och är stängda
const validateRingStructure = (rings: unknown[]): boolean => {
  if (!Array.isArray(rings) || rings.length === 0) return false;

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    if (!isRingClosed(ring)) return false;
  }

  return true;
};

// Validerar att alla holes är innanför första ringen (outer)
const validateHolesWithinOuter = (
  rings: unknown[],
  poly: __esri.Polygon,
  engine: GeometryEngineLike | undefined,
  modules: ArcgisGeometryModules
): boolean => {
  if (rings.length <= 1) return true;
  const contains = engine?.contains;
  if (typeof contains !== "function") return true;

  try {
    const PolygonCtor = modules?.Polygon;
    if (!PolygonCtor) return true;

    const outer = PolygonCtor.fromJSON({
      rings: [rings[0]],
      spatialReference: poly.spatialReference,
    });

    for (let i = 1; i < rings.length; i++) {
      const hole = PolygonCtor.fromJSON({
        rings: [rings[i]],
        spatialReference: poly.spatialReference,
      });
      if (!contains(outer, hole)) return false;
    }
  } catch {
    return true;
  }

  return true;
};

// Helper to create geometry error states
const makeGeometryError = (
  messageKey: string,
  code: string
): { valid: false; error: SerializableErrorState } => ({
  valid: false,
  error: createGeometryError(messageKey, {
    code,
    scope: "general",
  }),
});

// Validerar polygon: simplify, ring structure, area, holes
export const validatePolygon = async (
  geometry: __esri.Geometry | undefined,
  modules: ArcgisGeometryModules
): Promise<{
  valid: boolean;
  error?: SerializableErrorState;
  simplified?: __esri.Polygon;
}> => {
  if (!geometry) {
    return makeGeometryError("geometryMissingMessage", "NO_GEOMETRY");
  }

  if (geometry.type !== "polygon") {
    return makeGeometryError(
      "geometryPolygonRequired",
      "INVALID_GEOMETRY_TYPE"
    );
  }

  if (!modules?.geometryEngine && !modules?.geometryEngineAsync) {
    return { valid: true };
  }

  try {
    const engine = modules.geometryEngine;
    const engineAsync = modules.geometryEngineAsync;
    let poly = geometry as __esri.Polygon;

    const simplified = await simplifyPolygon(poly, engine, engineAsync);
    if (!simplified) {
      return makeGeometryError("geometryNotSimple", "INVALID_GEOMETRY");
    }
    poly = simplified;

    const rawRings = (poly as { rings?: unknown }).rings;
    const rings = ensureArray<number[][]>(rawRings);
    if (!validateRingStructure(rings)) {
      return makeGeometryError("geometryInvalidCode", "GEOMETRY_INVALID");
    }

    const area = await calcArea(poly, modules);
    if (!area || area <= 0) {
      return makeGeometryError("geometryInvalidCode", "GEOMETRY_INVALID");
    }

    if (!validateHolesWithinOuter(rings, poly, engine, modules)) {
      return makeGeometryError("geometryInvalidCode", "GEOMETRY_INVALID");
    }

    return { valid: true, simplified: poly };
  } catch {
    return makeGeometryError(
      "geometryValidationFailedMessage",
      "GEOMETRY_VALIDATION_ERROR"
    );
  }
};

// Konverterar area limit till number eller undefined
const resolveAreaLimit = (limit?: number): number | undefined => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return undefined;
  if (limit <= 0) return undefined;
  return limit;
};

// Utvärderar area mot max/warning thresholds
export const evaluateArea = (
  area: number,
  limits?: { maxArea?: number; largeArea?: number }
): AreaEvaluation => {
  const normalized = Math.abs(area) || 0;
  const maxThreshold = resolveAreaLimit(limits?.maxArea);
  const warningThreshold = resolveAreaLimit(limits?.largeArea);
  const exceedsMaximum =
    typeof maxThreshold === "number" ? normalized > maxThreshold : false;
  const shouldWarn =
    !exceedsMaximum &&
    typeof warningThreshold === "number" &&
    normalized > warningThreshold;

  return {
    area: normalized,
    maxThreshold,
    warningThreshold,
    exceedsMaximum,
    shouldWarn,
  };
};

// Validerar om area överskrider max area
export const checkMaxArea = (
  area: number,
  maxArea?: number
): { ok: boolean; message?: string; code?: string } => {
  const resolved = resolveAreaLimit(maxArea);
  if (!resolved || area <= resolved) {
    return { ok: true };
  }

  return {
    ok: false,
    message: "geometryAreaTooLargeCode",
    code: "AREA_TOO_LARGE",
  };
};

// Kontrollerar om area ska trigga warning (large area)
export const checkLargeArea = (area: number, largeArea?: number): boolean =>
  evaluateArea(area, { largeArea }).shouldWarn;

// Återställer geometry calculation caches för test-syfte
export const resetGeometryCachesForTest = () => {
  normalizeUtilsCache = undefined;
  geometryServiceCache = undefined;
  areasAndLengthsParamsCache = undefined;
  esriConfigCache = undefined;
};
