// Shared utility functions
export const isAuthError = (status: number): boolean =>
  status === 403 || status === 401

export function getErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message
    return typeof message === "string" || typeof message === "number"
      ? String(message)
      : ""
  }
  return ""
}

// Resolve a message or a key to a translated message if available
export function resolveMessageOrKey(
  raw: string,
  translate: (key: string) => string
): string {
  if (!raw) return raw
  const exact = translate(raw)
  if (exact && exact !== raw) return exact
  const camelKey = raw
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/^([a-z])/, (_, c: string) => c)
  const camel = translate(camelKey)
  return camel && camel !== camelKey ? camel : raw
}

// Email validation utility
export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== "string" || !email) return false
  if (/no-?reply/i.test(email)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Geometry processing constants
const GEOMETRY_CONSTS = {
  COINCIDENT_EPSILON: 1e-3,
} as const

// Point coincidence helper for geometry processing
const arePointsCoincident = (p1: unknown[], p2: unknown[]): boolean => {
  return (
    Array.isArray(p1) &&
    Array.isArray(p2) &&
    Math.abs((p1[0] as number) - (p2[0] as number)) <
      GEOMETRY_CONSTS.COINCIDENT_EPSILON &&
    Math.abs((p1[1] as number) - (p2[1] as number)) <
      GEOMETRY_CONSTS.COINCIDENT_EPSILON
  )
}

// Sanitize polygon JSON - ensure rings are closed, coordinates are numbers, remove Z/M flags, preserve spatial ref
export const sanitizePolygonJson = (
  value: unknown,
  spatialRef?: unknown
): unknown => {
  if (!value || typeof value !== "object") return value
  const src: any = value
  if (!Array.isArray(src.rings)) return value

  const ensureClosure = (ring: any[]): any[] => {
    const cleaned = ring.map((pt: any) => {
      if (!Array.isArray(pt) || pt.length < 2) return pt
      const x = typeof pt[0] === "number" ? pt[0] : Number(pt[0])
      const y = typeof pt[1] === "number" ? pt[1] : Number(pt[1])
      return [x, y]
    })
    try {
      const first = cleaned[0]
      const last = cleaned[cleaned.length - 1]
      const closed = arePointsCoincident(first, last)
      return closed ? cleaned : [...cleaned, [first[0], first[1]]]
    } catch (closureError) {
      console.warn(
        "Geometry sanitization - Ring closure processing failed:",
        closureError
      )
      return cleaned
    }
  }

  const cleanedRings = src.rings.map((r: any) => ensureClosure(r))
  const result: any = { ...src, rings: cleanedRings }

  // Remove Z/M flags
  delete result.hasZ
  delete result.hasM

  // Preserve spatial reference if provided and missing
  if (spatialRef && !result.spatialReference) {
    result.spatialReference = spatialRef
  }

  return result
}
