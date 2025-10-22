import type {
  ErrorState,
  EsriModules,
  FmeExportConfig,
  MutableParams,
  WorkspaceParameter,
} from "../../config/index"
import { ErrorSeverity, ErrorType, ParameterType } from "../../config/index"
import { toTrimmedString } from "./conversion"
import { sanitizeParamKey } from "./form"

const createAoiSerializationError = (): ErrorState => ({
  message: "GEOMETRY_SERIALIZATION_FAILED",
  type: ErrorType.GEOMETRY,
  code: "GEOMETRY_SERIALIZATION_FAILED",
  severity: ErrorSeverity.ERROR,
  recoverable: true,
  timestamp: new Date(),
  timestampMs: Date.now(),
})

export const coordinatesEqual = (a: unknown, b: unknown): boolean => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  const len = Math.min(a.length, b.length, 2)
  for (let i = 0; i < len; i++) {
    const av = a[i]
    const bv = b[i]
    if (typeof av !== "number" || typeof bv !== "number") return false
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return false
    if (Math.abs(av - bv) > 1e-9) return false
  }
  return true
}

const normalizeCoordinate = (vertex: unknown): number[] | null => {
  if (!Array.isArray(vertex) || vertex.length < 2) return null
  const [x, y, z, m] = vertex.map((part) =>
    typeof part === "string" ? Number(part) : (part as number)
  )
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  const result: number[] = [x, y]
  if (Number.isFinite(z)) result.push(z)
  if (Number.isFinite(m)) result.push(m)
  return result
}

export const normalizeRing = (ring: unknown): number[][] => {
  if (!Array.isArray(ring)) return []
  const coords: number[][] = []
  for (const vertex of ring) {
    const tuple = normalizeCoordinate(vertex)
    if (tuple) coords.push(tuple)
  }
  if (coords.length < 3) return []

  const first = coords[0]
  const last = coords[coords.length - 1]
  if (!coordinatesEqual(first, last)) {
    coords.push([...first])
  }
  return coords
}

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const isValidCoordinateTuple = (pt: unknown): pt is number[] =>
  Array.isArray(pt) &&
  pt.length >= 2 &&
  pt.length <= 4 &&
  pt.every(isFiniteCoordinate)

const isObjectLike = (value: unknown): value is object =>
  typeof value === "object" && value !== null

const isValidRing = (ring: unknown): boolean => {
  if (!Array.isArray(ring) || ring.length < 4) return false
  if (!ring.every(isValidCoordinateTuple)) return false

  const first = ring[0]
  const last = ring[ring.length - 1]
  return coordinatesEqual(first, last)
}

export const isPolygonGeometry = (
  value: unknown
): value is { rings: unknown } | { geometry: { rings: unknown } } => {
  if (!isObjectLike(value)) return false

  const geom =
    "geometry" in value ? (value as { geometry: unknown }).geometry : value

  if (!isObjectLike(geom)) return false

  const rings = "rings" in geom ? (geom as { rings: unknown }).rings : undefined

  return Array.isArray(rings) && rings.length > 0 && rings.every(isValidRing)
}

const extractRings = (poly: any): any[] => {
  if (!poly || typeof poly !== "object") return []

  if (Array.isArray(poly.rings)) return poly.rings
  if (Array.isArray(poly.geometry?.rings)) return poly.geometry.rings

  if (typeof poly.toJSON === "function") {
    try {
      const json = poly.toJSON()
      if (json && Array.isArray(json.rings)) return json.rings
    } catch {}
  }

  return []
}

export const polygonJsonToGeoJson = (poly: any): any => {
  if (!poly) return null
  try {
    const rings = extractRings(poly)
    if (!rings.length) {
      console.log("polygonJsonToGeoJson: No rings found in polygon", poly)
      return null
    }
    const normalized = rings
      .map(normalizeRing)
      .filter((ring) => ring.length >= 4)
    if (!normalized.length) {
      console.log(
        "polygonJsonToGeoJson: No valid rings after normalization",
        poly
      )
      return null
    }
    return {
      type: "Polygon",
      coordinates: normalized,
    }
  } catch (err) {
    console.log("polygonJsonToGeoJson: Serialization failed", err, poly)
    return null
  }
}

const formatNumberForWkt = (value: number): string => {
  if (!Number.isFinite(value)) return "0"
  const str = value.toString()
  const hasScientific = /[eE]/.test(str)
  const raw = hasScientific ? value.toFixed(12) : str
  const trimmed = raw.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")
  return trimmed || "0"
}

const serializeCoordinate = (coords: unknown): string | null => {
  if (!Array.isArray(coords) || coords.length < 2) return null
  const values: string[] = []
  for (const raw of coords) {
    const num = typeof raw === "number" ? raw : Number(raw)
    if (!Number.isFinite(num)) return null
    values.push(formatNumberForWkt(num))
  }
  return values.length >= 2 ? values.join(" ") : null
}

const serializeRing = (ring: unknown): string[] => {
  if (!Array.isArray(ring)) return []
  const parts: string[] = []
  for (const vertex of ring) {
    const serialized = serializeCoordinate(vertex)
    if (serialized) parts.push(serialized)
  }
  return parts
}

export const polygonJsonToWkt = (poly: any): string => {
  const geojson = polygonJsonToGeoJson(poly)
  if (!geojson) return "POLYGON EMPTY"

  const rings = Array.isArray(geojson?.coordinates)
    ? (geojson.coordinates as number[][][])
    : []

  if (!rings.length) return "POLYGON EMPTY"

  const serialized = rings
    .map(serializeRing)
    .filter((parts) => parts.length >= 4)
    .map((parts) => `(${parts.join(", ")})`)
    .filter((ring) => ring !== "()" && ring !== "( )")

  if (!serialized.length) return "POLYGON EMPTY"

  return `POLYGON(${serialized.join(", ")})`
}

const isWgs84Spatial = (sr: any): boolean =>
  sr?.isWGS84 === true || sr?.wkid === 4326

const projectToWgs84 = (
  poly: __esri.Polygon,
  modules: EsriModules
): __esri.Polygon | null => {
  const { projection, SpatialReference } = modules
  if (!projection?.project || !SpatialReference) return null

  const SpatialRefCtor = SpatialReference as any
  const target =
    SpatialRefCtor.WGS84 ||
    (typeof SpatialRefCtor === "function"
      ? new SpatialRefCtor({ wkid: 4326 })
      : { wkid: 4326 })

  const projected = projection.project(poly, target)
  if (Array.isArray(projected)) {
    return (projected[0] as __esri.Polygon) || null
  }
  return (projected as __esri.Polygon) || null
}

export const toWgs84PolygonJson = (
  polyJson: any,
  modules: EsriModules | null | undefined
): any => {
  if (!modules?.Polygon) return polyJson

  try {
    const poly = modules.Polygon.fromJSON(polyJson)
    if (!poly) {
      console.log("toWgs84PolygonJson: Failed to create Polygon from JSON")
      return polyJson
    }

    const sr = (poly as any).spatialReference
    if (isWgs84Spatial(sr)) {
      return poly.toJSON()
    }

    const projected = projectToWgs84(poly, modules)
    if (projected?.toJSON) {
      const result = projected.toJSON()
      const resultSr = result?.spatialReference
      if (isWgs84Spatial(resultSr)) {
        if (!resultSr?.wkid) {
          result.spatialReference = { wkid: 4326 }
        }
        return result
      }
      console.log(
        "toWgs84PolygonJson: Projection did not produce WGS84 geometry"
      )
    }

    const { webMercatorUtils } = modules
    if (webMercatorUtils?.webMercatorToGeographic) {
      const geographic = webMercatorUtils.webMercatorToGeographic(
        poly
      ) as __esri.Polygon
      if (geographic?.toJSON) {
        return geographic.toJSON()
      }
    }

    console.log(
      "toWgs84PolygonJson: Returning original polygon (projection failed)"
    )
    return poly.toJSON()
  } catch (err) {
    console.log("toWgs84PolygonJson: Error during projection", err)
    return polyJson
  }
}

export const collectGeometryParamNames = (
  params?: readonly WorkspaceParameter[] | null
): readonly string[] => {
  if (!params?.length) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const param of params) {
    if (!param || param.type !== ParameterType.GEOMETRY) continue
    const trimmed = toTrimmedString(param.name)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    names.push(trimmed)
  }
  return names
}

const extractPolygonJson = (
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined
): unknown => {
  if (isPolygonGeometry(geometryJson)) {
    const asAny = geometryJson as any
    return "geometry" in asAny ? asAny.geometry : geometryJson
  }

  const fallback = currentGeometry?.toJSON()
  return isPolygonGeometry(fallback) ? fallback : null
}

const safeStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export const attachAoi = (
  base: { [key: string]: unknown },
  geometryJson: unknown,
  currentGeometry: __esri.Geometry | undefined,
  _modules: EsriModules | null | undefined,
  config?: FmeExportConfig,
  geometryParamNames?: readonly string[]
): { [key: string]: unknown } => {
  const paramName = sanitizeParamKey(config?.aoiParamName, "AreaOfInterest")
  const aoiJson = extractPolygonJson(geometryJson, currentGeometry)
  if (!aoiJson) return base

  const serialized = safeStringify(aoiJson)
  if (!serialized) {
    return { ...base, __aoi_error__: createAoiSerializationError() }
  }

  const result: { [key: string]: unknown } = {
    ...base,
    [paramName]: serialized,
  }

  if (geometryParamNames?.length) {
    const extras = new Set<string>()
    for (const name of geometryParamNames) {
      const sanitized = sanitizeParamKey(name, "")
      if (sanitized && sanitized !== paramName) extras.add(sanitized)
    }
    for (const extra of extras) {
      result[extra] = serialized
    }
  }

  return result
}

export const removeAoiErrorMarker = (params: MutableParams): void => {
  if (typeof params.__aoi_error__ !== "undefined") {
    delete params.__aoi_error__
  }
}

export const makeGeoJson = (polygon: __esri.Polygon) => {
  if (!polygon) {
    return { type: "Polygon" as const, coordinates: [] as const }
  }

  try {
    const polyJson =
      typeof (polygon as any)?.toJSON === "function"
        ? (polygon as any).toJSON()
        : { rings: (polygon as any)?.rings }
    const geo = polygonJsonToGeoJson(polyJson)
    if (geo) return geo
  } catch (error) {
    void error
  }

  const rings = Array.isArray((polygon as any)?.rings)
    ? (polygon as any).rings
    : []

  const normalized: number[][][] = rings
    .map((ring: any) => normalizeRing(ring))
    .filter((ring) => ring.length >= 4)

  if (!normalized.length) {
    return { type: "Polygon" as const, coordinates: [] as number[][][] }
  }

  return {
    type: "Polygon" as const,
    coordinates: normalized,
  }
}
