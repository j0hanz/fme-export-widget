/** Normalizes unknown input into a trimmed string. */
const normalizeString = (
  value: unknown,
  options?: {
    allowEmpty?: boolean
    allowNumeric?: boolean
    nullable?: boolean
  }
): string | null | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed && !options?.allowEmpty) {
      return options?.nullable ? null : undefined
    }
    return trimmed
  }
  if (
    options?.allowNumeric &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return String(value)
  }
  return options?.nullable ? null : undefined
}

// Kontrollerar om värdet är "tomt"
export const isEmpty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "string") return !isNonEmptyTrimmedString(v)
  return false
}

// Type guard för non-empty trimmed string
export const isNonEmptyTrimmedString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

// Returnerar trimmed string eller tom sträng
export const toTrimmedStringOrEmpty = (value: unknown): string => {
  const trimmed = toTrimmedString(value)
  return trimmed ?? ""
}

// Returnerar non-empty trimmed string eller fallback
export const toNonEmptyTrimmedString = (
  value: unknown,
  fallback = ""
): string => {
  const trimmed = toTrimmedString(value)
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

/** Returns a trimmed string when possible; otherwise undefined. */
export const toTrimmedString = (value: unknown): string | undefined =>
  normalizeString(value, { allowNumeric: false })

/** Returns a string (allowing numeric coercion) when possible. */
export const toStringValue = (value: unknown): string | undefined =>
  normalizeString(value, { allowNumeric: true })

/** Type guard for plain objects (excluding arrays). */
export const isPlainObject = (
  value: unknown
): value is { readonly [key: string]: unknown } => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Type guard for finite numbers. */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

export const isValidNumber = (
  value: unknown,
  options?: {
    min?: number
    max?: number
    allowZero?: boolean
    allowNegative?: boolean
  }
): value is number => {
  if (!isFiniteNumber(value)) return false

  const { min, max, allowZero = true, allowNegative = true } = options ?? {}

  if (!allowZero && value === 0) return false
  if (!allowNegative && value < 0) return false
  if (min !== undefined && value < min) return false
  if (max !== undefined && value > max) return false

  return true
}

/** Type guard for File objects. */
export const isFileObject = (value: unknown): value is File =>
  value instanceof File

/** Coerces unknown values into booleans when the intent is clear. */
export const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined
    return value !== 0
  }
  const str = normalizeString(value, { allowNumeric: false })
  if (!str) return undefined
  const normalized = str.toLowerCase()
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false
  return undefined
}

/** Coerces unknown values into finite numbers when possible. */
export const toNumberValue = (value: unknown): number | undefined => {
  if (isFiniteNumber(value)) return value
  const str = normalizeString(value, { allowNumeric: false })
  if (!str) return undefined
  const numeric = Number(str)
  return Number.isFinite(numeric) ? numeric : undefined
}

export const toValidNumber = (
  value: unknown,
  fallback: number,
  options?: Parameters<typeof isValidNumber>[1]
): number => (isValidNumber(value, options) ? value : fallback)

export const clampNumber = (
  value: number,
  min: number,
  max: number
): number => {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

/** Wraps non-array values into an array, filtering nullish values. */
export const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value]

/** Generic helper for fetching the first converted value by key lookup. */
export const pickFromObject = <T>(
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[],
  converter: (value: unknown) => T | undefined,
  fallback?: T
): T | undefined => {
  if (!data) return fallback
  for (const key of keys) {
    const result = converter(data[key])
    if (result !== undefined) return result
  }
  return fallback
}

/** Extracts a string via multi-key lookup. */
export const pickString = (
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[]
): string | undefined => pickFromObject(data, keys, toStringValue)

/** Extracts a boolean via multi-key lookup. */
export const pickBoolean = (
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[],
  fallback = false
): boolean => pickFromObject(data, keys, toBooleanValue, fallback) ?? fallback

/** Extracts a number via multi-key lookup. */
export const pickNumber = (
  data: { readonly [key: string]: unknown } | null | undefined,
  keys: readonly string[]
): number | undefined => pickFromObject(data, keys, toNumberValue)

/** Merges metadata sources by taking the first non-null value per key. */
export const mergeMetadata = (
  sources: ReadonlyArray<{ readonly [key: string]: unknown } | undefined>
): { readonly [key: string]: unknown } => {
  const merged: { [key: string]: unknown } = {}
  for (const source of sources) {
    if (!isPlainObject(source)) continue
    for (const [key, value] of Object.entries(source)) {
      if (value != null && !(key in merged)) {
        merged[key] = value
      }
    }
  }
  return merged
}

/** Attempts to unwrap arrays from common envelope shapes. */
export const unwrapArray = (value: unknown): readonly unknown[] | undefined => {
  if (Array.isArray(value)) return value
  if (isPlainObject(value)) {
    for (const key of ["data", "items", "options"]) {
      const arr = (value as { readonly [key: string]: unknown })[key]
      if (Array.isArray(arr)) return arr
    }
  }
  return undefined
}

/** Filters undefined values from plain objects while preserving keys. */
export const toMetadataRecord = (
  value: unknown
): { readonly [key: string]: unknown } | undefined => {
  if (!isPlainObject(value)) return undefined
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return entries.length ? Object.fromEntries(entries) : undefined
}

/** Normalizes parameter values for safe FME submission. */
export const normalizeParameterValue = (value: unknown): string | number => {
  if (isFiniteNumber(value)) return value
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "true" : "false"
  return JSON.stringify(value ?? null)
}

/** Returns a string suitable for debug logging. */
export const toStr = (val: unknown): string => {
  if (typeof val === "string") return val
  if (typeof val === "number" || typeof val === "boolean") return String(val)
  if (val === undefined) return "undefined"
  if (val === null) return "null"
  if (typeof val === "object") {
    try {
      return JSON.stringify(val)
    } catch {
      return Object.prototype.toString.call(val)
    }
  }
  return Object.prototype.toString.call(val)
}

// Saniterar parameter-nyckel genom att ta bort ogiltiga tecken
export const sanitizeParamKey = (name: unknown, fallback: string): string => {
  const raw = toTrimmedString(name) ?? ""
  const safe = raw.replace(/[^A-Za-z0-9_\-]/g, "").trim()
  return safe || fallback
}

// Normaliserar formulärvärde baserat på om det är multiselect
export const normalizeFormValue = (value: any, isMultiSelect: boolean): any => {
  if (value === undefined || value === null) {
    return isMultiSelect ? [] : ""
  }
  if (isMultiSelect) {
    return Array.isArray(value) ? value : [value]
  }
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof value === "boolean") return value
  return ""
}

// Konverterar felobjekt till serialiserbart format för Redux
export const toSerializable = (error: any): any => {
  if (!error) return null
  const ts =
    typeof error.timestampMs === "number"
      ? error.timestampMs
      : error.timestamp instanceof Date
        ? error.timestamp.getTime()
        : 0
  const { retry, timestamp, ...rest } = error
  return { ...rest, timestampMs: ts, kind: "serializable" as const }
}

/** Utility ensuring iteration only happens on supported values. */
const isIterable = (value: unknown): value is Iterable<unknown> =>
  typeof value !== "string" &&
  typeof (value as any)?.[Symbol.iterator] === "function"

/** Maps values while filtering nullish mapper results. */
export const mapDefined = <T, R>(
  values: Iterable<T> | null | undefined,
  mapper: (value: T, index: number) => R | null | undefined
): R[] => {
  if (!values || !isIterable(values)) return []

  const result: R[] = []
  let index = 0

  for (const value of values) {
    const mapped = mapper(value, index++)
    if (mapped != null) result.push(mapped)
  }

  return result
}
