import { attachAoi } from "../runtime/widget"

// Minimal Esri modules stub used by attachAoi -> toWgs84PolygonJson
const makeModules = (opts?: {
  useWmToGeo?: boolean
  wgs84Rings?: number[][][]
}) => {
  class Polygon {
    rings: number[][][] = []
    spatialReference: any = { wkid: 4326 }
    toJSON() {
      return { rings: this.rings, spatialReference: this.spatialReference }
    }
    static fromJSON(json: any) {
      const p = new Polygon()
      p.rings = Array.isArray(json?.rings) ? json.rings : []
      p.spatialReference = json?.spatialReference || { wkid: 4326 }
      return p
    }
  }

  const webMercatorUtils = opts?.useWmToGeo
    ? {
        webMercatorToGeographic: jest.fn((poly: any) => {
          // Return a polygon-like object with toJSON() giving WGS84
          const rings = opts?.wgs84Rings || poly?.rings || []
          return {
            toJSON: () => ({ rings, spatialReference: { wkid: 4326 } }),
          }
        }),
      }
    : {}

  return {
    Polygon,
    webMercatorUtils,
  } as any
}

describe("attachAoi AOI exports (GeoJSON/WKT)", () => {
  const baseParams = { foo: "bar" }
  const aoiRings = [
    [
      [1113194.907, 1118889.974], // ~ (10, 10) in degrees for illustration only
      [2226389.814, 1118889.974],
      [2226389.814, 2226842.989],
      [1113194.907, 2226842.989],
      [1113194.907, 1118889.974],
    ],
  ]
  const aoi3857 = { rings: aoiRings, spatialReference: { wkid: 3857 } }

  test("converts 3857 to WGS84 via webMercatorUtils for GeoJSON and WKT", () => {
    const wgs84Rings = [
      [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
        [10, 10],
      ],
    ]

    const modules = makeModules({ useWmToGeo: true, wgs84Rings })
    const cfg = {
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tkn",
      repository: "repo",
      aoiGeoJsonParamName: "AOI_GJ",
      aoiWktParamName: "AOI_WKT",
    } as any

    const out = attachAoi(baseParams, aoi3857, undefined as any, modules, cfg)

    // Baseline AOI Esri JSON string always present under default param name
    expect(typeof (out as any).AreaOfInterest).toBe("string")

    // GeoJSON reflects WGS84 rings from the wmUtils stub
    const gj = JSON.parse((out as any).AOI_GJ)
    expect(gj).toMatchObject({ type: "Polygon" })
    expect(gj.coordinates).toEqual(wgs84Rings)

    // WKT reflects WGS84 rings
    expect((out as any).AOI_WKT).toBe(
      "POLYGON((10 10, 20 10, 20 20, 10 20, 10 10))"
    )
  })

  test("passes through 4326 without calling webMercatorUtils", () => {
    const modules = makeModules({ useWmToGeo: true, wgs84Rings: [] })
    const spy = (modules.webMercatorUtils.webMercatorToGeographic ||
      jest.fn()) as jest.Mock

    const aoi4326 = {
      rings: [
        [
          [1, 2],
          [3, 2],
          [3, 4],
          [1, 4],
          [1, 2],
        ],
      ],
      spatialReference: { wkid: 4326 },
    }

    const cfg = {
      fmeServerUrl: "https://example.com",
      fmeServerToken: "tkn",
      repository: "repo",
      aoiGeoJsonParamName: "GJ",
      aoiWktParamName: "WKT",
    } as any
    const out = attachAoi(baseParams, aoi4326, undefined as any, modules, cfg)

    // wmUtils should not be called for 4326 input
    expect(spy).not.toHaveBeenCalled()

    const gj = JSON.parse((out as any).GJ)
    expect(gj.coordinates).toEqual(aoi4326.rings)
    expect((out as any).WKT).toBe("POLYGON((1 2, 3 2, 3 4, 1 4, 1 2))")
  })
})
