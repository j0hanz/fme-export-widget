import { initGlobal } from "jimu-for-test"
import * as utils from "../shared/utils"
import * as validations from "../shared/validations"
import type { FmeExportConfig } from "../config"

const {
  polygonJsonToGeoJson,
  polygonJsonToWkt,
  toWgs84PolygonJson,
  attachAoi,
} = utils

const { calcArea, validatePolygon, checkMaxArea } = validations

const makePolygonJson = () => ({
  spatialReference: { wkid: 4326 },
  rings: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
})

const makePolygonGeometry = () => ({
  ...makePolygonJson(),
  type: "polygon" as const,
  toJSON() {
    return makePolygonJson()
  },
})

const buildConfig = (
  overrides: Partial<FmeExportConfig> = {}
): FmeExportConfig => ({
  fmeServerUrl: "https://example.com",
  fmeServerToken: "token",
  repository: "demo",
  ...overrides,
})

beforeAll(() => {
  initGlobal()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("polygonJson conversions", () => {
  it("normalizes coordinates and closes rings for geojson export", () => {
    // Arrange
    const raw = {
      spatialReference: { wkid: 3857 },
      rings: [
        [
          [0, 0],
          [0, 2],
          [2, 2],
        ],
      ],
    }

    // Act
    const result = polygonJsonToGeoJson(raw)

    // Assert
    expect(result?.type).toBe("Polygon")
    const ring = result?.coordinates?.[0]
    expect(ring).toBeDefined()
    expect(ring).toHaveLength(4)
    expect(ring?.[0]).toEqual([0, 0])
    expect(ring?.[ring.length - 1]).toEqual([0, 0])
  })

  it("returns null for invalid polygon-like structures", () => {
    // Arrange
    const invalid = {
      rings: [
        [
          [0, 0],
          [1, "nan"],
          [2, 2],
        ],
      ],
    }

    // Act
    const result = polygonJsonToGeoJson(invalid)

    // Assert
    expect(result).toBeNull()
  })

  it("generates WKT with normalized numeric output", () => {
    // Arrange
    const raw = {
      rings: [
        [
          [0, 0],
          [0, 1.5],
          [1, 1.5],
          [0, 0],
        ],
      ],
    }

    // Act
    const wkt = polygonJsonToWkt(raw)

    // Assert
    expect(wkt).toBe("POLYGON((0 0, 0 1.5, 1 1.5, 0 0))")
  })

  it("produces POLYGON EMPTY when conversion fails", () => {
    // Arrange
    const invalid = { rings: [] }

    // Act
    const wkt = polygonJsonToWkt(invalid)

    // Assert
    expect(wkt).toBe("POLYGON EMPTY")
  })
})

describe("toWgs84PolygonJson", () => {
  it("returns original JSON when polygon already WGS84", () => {
    // Arrange
    const json = makePolygonJson()
    const toJSON = jest.fn(() => json)
    const mockPolygon = {
      spatialReference: { wkid: 4326, isWGS84: true },
      toJSON,
    }
    const modules = {
      Polygon: {
        fromJSON: jest.fn(() => mockPolygon),
      },
    }

    // Act
    const result = toWgs84PolygonJson(json, modules as any)

    // Assert
    expect(modules.Polygon.fromJSON).toHaveBeenCalledWith(json)
    expect(result).toEqual(json)
    expect(toJSON).toHaveBeenCalled()
  })

  it("projects to WGS84 using projection utilities when needed", () => {
    // Arrange
    const json = {
      spatialReference: { wkid: 3857 },
      rings: [
        [
          [10, 10],
          [10, 20],
          [20, 20],
          [10, 10],
        ],
      ],
    }
    const projectedJson = {
      spatialReference: { wkid: 4326 },
      rings: [
        [
          [1, 1],
          [1, 2],
          [2, 2],
          [1, 1],
        ],
      ],
    }
    const mockPolygon = {
      spatialReference: { wkid: 3857 },
      toJSON: jest.fn(() => json),
    }
    const modules = {
      Polygon: {
        fromJSON: jest.fn(() => mockPolygon),
      },
      projection: {
        project: jest.fn(() => [{ toJSON: () => projectedJson }]),
      },
      SpatialReference: function SpatialReference(this: any, opts: any) {
        Object.assign(this, opts)
      },
    }
    ;(modules.SpatialReference as any).WGS84 = { wkid: 4326 }

    // Act
    const result = toWgs84PolygonJson(json, modules as any)

    // Assert
    expect(modules.projection.project).toHaveBeenCalled()
    expect(result).toEqual(projectedJson)
  })
})

describe("attachAoi", () => {
  it("derives AOI from current geometry when explicit JSON missing", () => {
    // Arrange
    const base = { existing: true }
    const currentGeometry = {
      toJSON: jest.fn(() => makePolygonJson()),
    }
    const config = buildConfig({
      aoiGeoJsonParamName: "aoi_geojson",
      aoiWktParamName: "aoi_wkt",
    })

    // Act
    const result = attachAoi(
      base,
      undefined,
      currentGeometry as any,
      null,
      config,
      ["AlternateAOI"]
    )

    // Assert
    expect(base).toEqual({ existing: true })
    expect(currentGeometry.toJSON).toHaveBeenCalled()
    expect(result.AreaOfInterest).toBeDefined()
    expect(result.AlternateAOI).toBe(result.AreaOfInterest)
    expect(result).toHaveProperty("aoi_geojson")
    expect(result).toHaveProperty("aoi_wkt")
  })

  it("skips derived outputs when serialization fails", () => {
    // Arrange
    const config = buildConfig({
      aoiGeoJsonParamName: "geo",
      aoiWktParamName: "wkt",
    })
    const failingGeometry: any = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [0, 0],
        ],
      ],
      spatialReference: { wkid: 3857 },
    }
    failingGeometry.toJSON = () => {
      const json: any = {
        spatialReference: { wkid: 3857 },
        rings: failingGeometry.rings,
      }
      json.self = json
      return json
    }

    // Act
    const result = attachAoi({}, failingGeometry, undefined, null, config, [])

    // Assert
    expect(result.__aoi_error__).toBeDefined()
    expect(result).not.toHaveProperty("geo")
    expect(result).not.toHaveProperty("wkt")
  })
})

describe("calcArea", () => {
  it("uses geodesic area when available for geographic polygons", async () => {
    // Arrange
    const polygon = makePolygonGeometry()
    const modules = {
      geometryEngineAsync: {
        geodesicArea: jest.fn().mockResolvedValue(2500),
        planarArea: jest.fn(),
      },
      geometryEngine: {},
    }

    // Act
    const area = await calcArea(polygon as any, modules as any)

    // Assert
    expect(modules.geometryEngineAsync.geodesicArea).toHaveBeenCalledWith(
      polygon as any,
      "square-meters"
    )
    expect(area).toBe(2500)
  })

  it("falls back to planar area when geodesic is unavailable or zero", async () => {
    // Arrange
    const polygon = makePolygonGeometry()
    const modules = {
      geometryEngineAsync: {
        geodesicArea: jest.fn().mockResolvedValue(0),
        planarArea: jest.fn().mockResolvedValue(1234),
      },
      geometryEngine: {
        planarArea: jest.fn().mockReturnValue(4567),
      },
    }

    // Act
    const area = await calcArea(polygon as any, modules as any)

    // Assert
    expect(modules.geometryEngineAsync.planarArea).toHaveBeenCalled()
    expect(area).toBe(1234)
  })

  it("returns zero when geometry is not a polygon", async () => {
    // Arrange
    const geometry = { type: "point" }

    // Act
    const area = await calcArea(geometry as any, {} as any)

    // Assert
    expect(area).toBe(0)
  })
})

describe("validatePolygon", () => {
  const makeModules = (options?: {
    asyncOverrides?: { [key: string]: any }
    engineOverrides?: { [key: string]: any }
  }) => {
    const geometryEngineAsync = {
      simplify: jest.fn((poly: any) => Promise.resolve(poly)),
      isSimple: jest.fn().mockResolvedValue(true),
      geodesicArea: jest.fn().mockResolvedValue(500),
      planarArea: jest.fn().mockResolvedValue(500),
      ...(options?.asyncOverrides || {}),
    }
    const geometryEngine = {
      geodesicArea: jest.fn().mockReturnValue(500),
      planarArea: jest.fn().mockReturnValue(500),
      ...(options?.engineOverrides || {}),
    }
    return {
      geometryEngineAsync,
      geometryEngine,
      Polygon: {
        fromJSON: jest.fn((json: any) => ({
          ...json,
          toJSON: () => json,
        })),
      },
    }
  }

  it("returns simplified polygon when validation succeeds", async () => {
    // Arrange
    const polygon = makePolygonGeometry()
    const modules = makeModules()

    // Act
    const result = await validatePolygon(polygon as any, modules as any)

    // Assert
    expect(result.valid).toBe(true)
    expect(result.simplified).toBeTruthy()
    expect(modules.geometryEngineAsync.simplify).toHaveBeenCalled()
  })

  it("skips advanced checks when geometry engine missing", async () => {
    // Arrange
    const polygon = makePolygonGeometry()

    // Act
    const result = await validatePolygon(polygon as any, {} as any)

    // Assert
    expect(result.valid).toBe(true)
    expect(result.simplified).toBeUndefined()
  })

  it("rejects polygons with open rings", async () => {
    // Arrange
    const polygon = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
      spatialReference: { wkid: 4326 },
    }
    const modules = makeModules()

    // Act
    const result = await validatePolygon(polygon as any, modules as any)

    // Assert
    expect(result.valid).toBe(false)
    expect(result.error?.code).toBe("GEOMETRY_INVALID")
  })

  it("rejects polygons when calculated area is zero", async () => {
    // Arrange
    const polygon = makePolygonGeometry()
    const modules = makeModules({
      asyncOverrides: {
        geodesicArea: jest.fn().mockResolvedValue(0),
        planarArea: jest.fn().mockResolvedValue(0),
      },
      engineOverrides: {
        geodesicArea: jest.fn().mockReturnValue(0),
        planarArea: jest.fn().mockReturnValue(0),
      },
    })

    // Act
    const result = await validatePolygon(polygon as any, modules as any)

    // Assert
    expect(result.valid).toBe(false)
    expect(result.error?.code).toBe("GEOMETRY_INVALID")
  })
})

describe("checkMaxArea", () => {
  it("allows areas below configured threshold", () => {
    // Arrange
    const result = checkMaxArea(500, 1000)

    // Assert
    expect(result.ok).toBe(true)
  })

  it("flags geometries that exceed the maximum", () => {
    // Arrange
    const result = checkMaxArea(2000, 1000)

    // Assert
    expect(result.ok).toBe(false)
    expect(result.code).toBe("AREA_TOO_LARGE")
    expect(result.message).toBe("AREA_TOO_LARGE")
  })
})
