import { css } from "jimu-core"
import type {
  AreaDisplay,
  ColorFieldConfig,
  EsriModules,
  TranslateFn,
  UnitConversion,
} from "../../config/index"
import { EMAIL_PLACEHOLDER, DEFAULT_DRAWING_HEX } from "../../config/index"
import {
  isFiniteNumber,
  toTrimmedString,
  isNonEmptyTrimmedString,
  toNonEmptyTrimmedString,
} from "./conversion"
import { isValidEmail } from "../validations"

export const formatByteSize = (size: unknown): string | null => {
  if (!isFiniteNumber(size) || size < 0) {
    return null
  }

  // Binära enheter (1024-bas)
  const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const shouldUseSingleDecimal = unitIndex > 0 && value < 10
  const formatted = shouldUseSingleDecimal
    ? value.toFixed(1)
    : Math.round(value).toString()

  return `${formatted} ${UNITS[unitIndex]}`
}

export const formatNumericDisplay = (
  value: number,
  precision?: number
): string => {
  if (!Number.isFinite(value)) return ""
  if (typeof precision === "number" && precision >= 0) {
    return value.toFixed(precision)
  }
  return value.toString()
}

export function resolveMessageOrKey(
  raw: string,
  translate: TranslateFn
): string {
  if (!raw) return ""

  return translate(raw)
}

export const maskEmailForDisplay = (email: unknown): string => {
  const trimmed = toTrimmedString(email)
  if (!trimmed || !isValidEmail(trimmed)) return trimmed || ""

  const atIdx = trimmed.indexOf("@")
  if (atIdx <= 1) return `**${trimmed.slice(atIdx)}`

  const local = trimmed.slice(0, atIdx)
  const domain = trimmed.slice(atIdx)
  const visible = local.slice(0, 2)

  return `${visible}****${domain}`
}

export const buildSupportHintText = (
  translate: TranslateFn,
  supportEmail?: string,
  userFriendly?: string
): string => {
  const email = toTrimmedString(supportEmail)
  if (!email) return toTrimmedString(userFriendly) || ""

  const template = translate("contactSupportEmail")
  return template.replace(EMAIL_PLACEHOLDER, email)
}

export function formatErrorForView(
  translate: TranslateFn,
  baseKeyOrMessage: string,
  code?: string,
  supportEmail?: string,
  userFriendly?: string
): { message: string; code?: string; hint?: string } {
  const message =
    resolveMessageOrKey(baseKeyOrMessage, translate) || baseKeyOrMessage
  const hint = buildSupportHintText(translate, supportEmail, userFriendly)
  return { message, code, hint }
}

const HTML_ENTITY_MAP = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
})

const HTML_ENTITY_REGEX = /&(?:amp|lt|gt|quot|#39);/g
const MAX_HTML_CODE_POINT = 0x10ffff

const decodeHtmlNumericEntity = (value: string, base: number): string => {
  if (value.length > 6) return ""
  if (!/^[0-9a-f]+$/i.test(value)) return ""

  const parsed = Number.parseInt(value, base)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_HTML_CODE_POINT)
    return ""
  try {
    return String.fromCodePoint(parsed)
  } catch {
    return ""
  }
}

const replaceNamedEntities = (value: string): string =>
  value.replace(HTML_ENTITY_REGEX, (match) => HTML_ENTITY_MAP[match] || match)

export const stripHtmlToText = (input?: string): string => {
  if (!input) return ""

  const attemptDomExtraction = (value: string): string | null => {
    const parserAvailable =
      typeof DOMParser !== "undefined" && typeof DOMParser === "function"

    try {
      if (typeof document !== "undefined" && document?.createElement) {
        const container = document.createElement("div")
        container.innerHTML = value
        const text = container.textContent || container.innerText || ""
        container.textContent = ""
        return text
      }
      if (parserAvailable) {
        const parser = new DOMParser()
        const doc = parser.parseFromString(value, "text/html")
        return doc?.body?.textContent || ""
      }
    } catch {
      /* Ignorerar DOM-parsningsfel */
    }
    return null
  }

  const domText = attemptDomExtraction(input)
  if (domText !== null) {
    return domText.replace(/\s+/g, " ").trim()
  }

  const noTags = input
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")

  const decoded = replaceNamedEntities(
    noTags
      .replace(/&#(\d+);/g, (_match, value) =>
        decodeHtmlNumericEntity(value, 10)
      )
      .replace(/&#x([\da-f]+);/gi, (_match, value) =>
        decodeHtmlNumericEntity(value, 16)
      )
  )

  return decoded.replace(/\s+/g, " ").trim()
}

const ERROR_LABEL_PATTERN = /^(?:error|fel|warning|varning|info)\s*[:\-–—]?\s*/i

export const stripErrorLabel = (input?: string): string => {
  const trimmed = toTrimmedString(input)
  if (!trimmed) return ""

  const stripped = trimmed.replace(ERROR_LABEL_PATTERN, "").trim()
  return stripped || trimmed
}

export const styleCss = (style?: React.CSSProperties) =>
  style ? css(style as any) : undefined

export const pad2 = (n: number): string => String(n).padStart(2, "0")

const OFFSET_SUFFIX_RE = /(Z|[+-]\d{2}(?::?\d{2})?)$/i
const FRACTION_SUFFIX_RE = /\.(\d{1,9})$/

const parseTemporalComponents = (
  input: string
): { base: string; fraction: string; offset: string } => {
  if (!input) return { base: "", fraction: "", offset: "" }

  let base = input
  let offset = ""
  const offsetMatch = OFFSET_SUFFIX_RE.exec(base)
  if (offsetMatch?.[1]) {
    offset = offsetMatch[1]
    base = base.slice(0, -offset.length)
  }

  let fraction = ""
  const fractionMatch = FRACTION_SUFFIX_RE.exec(base)
  if (fractionMatch?.[0]) {
    fraction = fractionMatch[0]
    base = base.slice(0, -fraction.length)
  }

  return { base, fraction, offset }
}

export const extractTemporalParts = (
  raw: string
): { base: string; fraction: string; offset: string } => {
  const trimmed = (raw || "").trim()
  return parseTemporalComponents(trimmed)
}

const safePad2 = (part?: string): string | null => {
  if (!part) return null
  const n = Number(part)
  return Number.isFinite(n) && n >= 0 && n <= 99 ? pad2(n) : null
}

export const fmeDateToInput = (v: string): string => {
  const s = (v || "").replace(/\D/g, "")
  if (s.length !== 8) return ""
  const year = s.slice(0, 4)
  const month = s.slice(4, 6)
  const day = s.slice(6, 8)
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (y < 1000 || y > 9999) return ""
  if (m < 1 || m > 12) return ""
  if (d < 1 || d > 31) return ""

  return `${year}-${month}-${day}`
}

export const inputToFmeDate = (v: string): string =>
  v ? v.replace(/-/g, "") : ""

export const fmeDateTimeToInput = (v: string): string => {
  const { base } = extractTemporalParts(v)
  const digits = base.replace(/\D/g, "")
  if (digits.length < 12) return ""
  const y = digits.slice(0, 4)
  const m = digits.slice(4, 6)
  const d = digits.slice(6, 8)
  const hh = digits.slice(8, 10)
  const mm = digits.slice(10, 12)
  const ss = digits.length >= 14 ? digits.slice(12, 14) : ""
  return `${y}-${m}-${d}T${hh}:${mm}${ss ? `:${ss}` : ""}`
}

export const inputToFmeDateTime = (v: string, original?: string): string => {
  if (!v) return ""
  const s = v.trim()
  const [date, time] = s.split("T")
  if (!date || !time) {
    console.log("inputToFmeDateTime: Invalid ISO format", v)
    return ""
  }

  const [y, m, d] = date.split("-")
  const {
    base: timePart,
    fraction: isoFraction,
    offset: isoOffset,
  } = parseTemporalComponents(time)
  const [hh, mi, ssRaw] = timePart.split(":")

  if (!y || y.length !== 4 || !/^\d{4}$/.test(y)) {
    console.log("inputToFmeDateTime: Invalid year", y)
    return ""
  }

  const m2 = safePad2(m)
  const d2 = safePad2(d)
  const hh2 = safePad2(hh)
  const mi2 = safePad2(mi)
  if (!m2 || !d2 || !hh2 || !mi2) {
    console.log("inputToFmeDateTime: Invalid date/time components", {
      m,
      d,
      hh,
      mi,
    })
    return ""
  }

  const ss2 = ssRaw ? safePad2(ssRaw) : "00"
  if (ss2 === null) {
    console.log("inputToFmeDateTime: Invalid seconds", ssRaw)
    return ""
  }

  const base = `${y}${m2}${d2}${hh2}${mi2}${ss2}`
  const originalExtras = original ? extractTemporalParts(original) : null
  const fraction = isoFraction || originalExtras?.fraction || ""
  const offset = isoOffset || originalExtras?.offset || ""

  return `${base}${fraction}${offset}`
}

export const fmeTimeToInput = (v: string): string => {
  const { base } = extractTemporalParts(v)
  const s = base.replace(/\D/g, "")
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`
  if (s.length >= 6) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
  return ""
}

export const inputToFmeTime = (v: string, original?: string): string => {
  if (!v) return ""
  const {
    base: timePart,
    fraction: isoFraction,
    offset: isoOffset,
  } = parseTemporalComponents(v)
  const parts = timePart.split(":").map((x) => x || "")
  const hh = parts[0] || ""
  const mm = parts[1] || ""
  const ss = parts[2] || ""

  const nH = Number(hh)
  const nM = Number(mm)
  if (!Number.isFinite(nH) || !Number.isFinite(nM)) return ""

  const nS = Number(ss)
  const finalSS = Number.isFinite(nS) ? pad2(nS) : "00"
  const base = `${pad2(nH)}${pad2(nM)}${finalSS}`

  const originalExtras = original ? extractTemporalParts(original) : null
  const fraction = isoFraction || originalExtras?.fraction || ""
  const offset = isoOffset || originalExtras?.offset || ""

  return `${base}${fraction}${offset}`
}

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const clamp01 = (value: number): number => clamp(value, 0, 1)
const clamp255 = (value: number): number => clamp(value, 0, 255)
const toHexComponent = (value: number): string =>
  Math.round(clamp255(value)).toString(16).padStart(2, "0")

const formatUnitFraction = (value: number): string =>
  Number(clamp01(value).toFixed(6)).toString()

const formatRgbFraction = (value: number): string =>
  formatUnitFraction(value / 255)

const rgbToHexString = (r: number, g: number, b: number): string =>
  `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`

const cmykToRgb = (
  c: number,
  m: number,
  y: number,
  k: number
): { r: number; g: number; b: number } => {
  const cc = clamp01(c)
  const mm = clamp01(m)
  const yy = clamp01(y)
  const kk = clamp01(k)
  return {
    r: clamp255(255 * (1 - cc) * (1 - kk)),
    g: clamp255(255 * (1 - mm) * (1 - kk)),
    b: clamp255(255 * (1 - yy) * (1 - kk)),
  }
}

const rgbToCmyk = (
  r: number,
  g: number,
  b: number
): { c: number; m: number; y: number; k: number } => {
  const rn = clamp01(r / 255)
  const gn = clamp01(g / 255)
  const bn = clamp01(b / 255)
  const k = 1 - Math.max(rn, gn, bn)

  if (k >= 0.999999) return { c: 0, m: 0, y: 0, k: 1 }

  const denom = 1 - k
  return {
    c: clamp01((1 - rn - k) / denom),
    m: clamp01((1 - gn - k) / denom),
    y: clamp01((1 - bn - k) / denom),
    k: clamp01(k),
  }
}

const parseNormalizedParts = (value: string): number[] =>
  (value || "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(Number)

export const hexToRgbArray = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  const n = m ? parseInt(m[1], 16) : parseInt(DEFAULT_DRAWING_HEX.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

export const normalizedRgbToHex = (
  v: string,
  config?: ColorFieldConfig
): string | null => {
  const parts = parseNormalizedParts(v)
  if (!parts.length) return null

  const treatAsCmyk =
    config?.space === "cmyk" ||
    (!config?.space && !config?.alpha && parts.length === 4)

  if (treatAsCmyk) {
    if (parts.length < 4 || !parts.slice(0, 4).every(Number.isFinite))
      return null
    const [c, m, y, k] = parts
    const rgb = cmykToRgb(c, m, y, k)
    return rgbToHexString(rgb.r, rgb.g, rgb.b)
  }

  if (parts.length < 3 || !parts.slice(0, 3).every(Number.isFinite)) return null
  const [rPart, gPart, bPart] = parts
  const r = clamp255(Math.round(clamp01(rPart) * 255))
  const g = clamp255(Math.round(clamp01(gPart) * 255))
  const b = clamp255(Math.round(clamp01(bPart) * 255))
  return rgbToHexString(r, g, b)
}

export const hexToNormalizedRgb = (
  hex: string,
  config?: ColorFieldConfig
): string | null => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!match) return null

  const numeric = parseInt(match[1], 16)
  const r = (numeric >> 16) & 0xff
  const g = (numeric >> 8) & 0xff
  const b = numeric & 0xff

  if (config?.space === "cmyk") {
    const { c, m, y, k } = rgbToCmyk(r, g, b)
    return [c, m, y, k].map(formatUnitFraction).join(",")
  }

  return [r, g, b].map(formatRgbFraction).join(",")
}

const GEOMETRY_CONSTS = {
  M2_PER_KM2: 1_000_000,
  AREA_DECIMALS: 2,
  METERS_PER_KILOMETER: 1_000,
  SQUARE_FEET_PER_SQUARE_MILE: 27_878_400,
} as const

const UNIT_CONVERSIONS: readonly UnitConversion[] = [
  {
    factor: 0.3048,
    label: "ft²",
    keywords: ["foot", "feet"],
    largeUnit: {
      threshold: GEOMETRY_CONSTS.SQUARE_FEET_PER_SQUARE_MILE,
      factor: GEOMETRY_CONSTS.SQUARE_FEET_PER_SQUARE_MILE,
      label: "mi²",
    },
  },
  { factor: 0.3048006096, label: "ft²", keywords: [] },
  { factor: 1609.344, label: "mi²", keywords: ["mile"] },
  {
    factor: GEOMETRY_CONSTS.METERS_PER_KILOMETER,
    label: "km²",
    keywords: ["kilometer"],
  },
  { factor: 0.9144, label: "yd²", keywords: ["yard"] },
  { factor: 0.0254, label: "in²", keywords: ["inch"] },
  { factor: 0.01, label: "cm²", keywords: ["centimeter"] },
  { factor: 0.001, label: "mm²", keywords: ["millimeter"] },
  { factor: 1852, label: "nm²", keywords: ["nautical"] },
  { factor: 1, label: "m²", keywords: ["meter"] },
] as const

const approxLengthUnit = (
  value: number | undefined,
  target: number
): boolean => {
  if (!isFiniteNumber(value)) return false
  const tolerance = Math.max(1e-9, Math.abs(target) * 1e-6)
  return Math.abs(value - target) <= tolerance
}

const getDecimalPlaces = (value: number, isLargeUnit = false): number => {
  if (isLargeUnit) return 2
  if (value >= 100) return 0
  if (value >= 10) return 1
  return 2
}

const normalizeUnitLabel = (unit?: string): string => {
  if (!unit) return "units²"

  const trimmed = unit.replace(/^esri/i, "").trim()
  if (!trimmed) return "units²"

  const lower = trimmed.toLowerCase()

  switch (lower) {
    case "meters":
      return "m²"
    case "feet":
    case "internationalfeet":
    case "ussfeet":
      return "ft²"
    case "kilometers":
      return "km²"
    case "miles":
      return "mi²"
    case "yards":
      return "yd²"
    case "inches":
      return "in²"
    case "centimeters":
      return "cm²"
    case "millimeters":
      return "mm²"
    case "nauticalmiles":
      return "nm²"
    default:
      return `${lower}²`
  }
}

export const buildLargeAreaWarningMessage = ({
  currentAreaText,
  thresholdAreaText,
  translate,
}: {
  currentAreaText?: string | null
  thresholdAreaText?: string | null
  translate: TranslateFn
}): string | null => {
  const current = toTrimmedString(currentAreaText)
  if (!current) return null

  const threshold = toTrimmedString(thresholdAreaText)

  if (threshold) {
    return translate("largeAreaWarningWithThreshold", {
      current,
      threshold,
    })
  }

  return translate("largeAreaWarning", { current })
}

const matchesUnitKeywords = (
  unitId: string,
  keywords: readonly string[]
): boolean => {
  return keywords.some((keyword) => unitId.includes(keyword))
}

const convertAreaByUnit = (
  area: number,
  factor: number,
  conversion: UnitConversion
): AreaDisplay => {
  const convertedValue = area / (factor * factor)

  if (
    conversion.largeUnit &&
    convertedValue >= conversion.largeUnit.threshold
  ) {
    return {
      value: convertedValue / conversion.largeUnit.factor,
      label: conversion.largeUnit.label,
      decimals: 2,
    }
  }

  const decimals = getDecimalPlaces(
    convertedValue,
    conversion.label.includes("km²") || conversion.label.includes("mi²")
  )
  return { value: convertedValue, label: conversion.label, decimals }
}

const resolveMetricDisplay = (area: number): AreaDisplay => {
  if (area >= GEOMETRY_CONSTS.M2_PER_KM2) {
    return {
      value: area / GEOMETRY_CONSTS.M2_PER_KM2,
      label: "km²",
      decimals: GEOMETRY_CONSTS.AREA_DECIMALS,
    }
  }

  if (area >= 1) {
    return {
      value: Math.round(area),
      label: "m²",
      decimals: 0,
    }
  }

  return {
    value: Number(area.toFixed(2)),
    label: "m²",
    decimals: 2,
  }
}

const resolveAreaForSpatialReference = (
  area: number,
  spatialReference?: __esri.SpatialReference | null
): AreaDisplay => {
  if (!spatialReference) {
    return resolveMetricDisplay(area)
  }

  const metersPerUnit = spatialReference.metersPerUnit
  const hasValidFactor = isFiniteNumber(metersPerUnit)

  if (!hasValidFactor) {
    return resolveMetricDisplay(area)
  }

  const unitId =
    typeof spatialReference.unit === "string"
      ? spatialReference.unit.toLowerCase()
      : ""

  const factor = metersPerUnit

  for (const conversion of UNIT_CONVERSIONS) {
    if (
      approxLengthUnit(factor, conversion.factor) ||
      matchesUnitKeywords(unitId, conversion.keywords)
    ) {
      return convertAreaByUnit(area, factor, conversion)
    }
  }

  const value = area / (factor * factor)
  const decimals = getDecimalPlaces(value)
  return { value, label: normalizeUnitLabel(spatialReference.unit), decimals }
}

export function formatArea(
  area: number,
  modules: EsriModules,
  spatialReference?: __esri.SpatialReference | null
): string {
  const safeArea = Number.isFinite(area) && area > 0 ? area : 0
  const display = resolveAreaForSpatialReference(safeArea, spatialReference)

  const formatNumber = (value: number, decimals: number): string => {
    const intlModule = (modules as any)?.intl
    if (intlModule && typeof intlModule.formatNumber === "function") {
      const result = intlModule.formatNumber(value, {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      })
      return typeof result === "number" ? result.toString() : result
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })
  }

  if (!display.value || display.value <= 0) {
    return `0 ${display.label}`
  }

  const formatted = formatNumber(display.value, display.decimals)
  return `${formatted} ${display.label}`
}

export const extractErrorMessage = (error: unknown): string => {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (typeof error === "number") return error.toString()
  if (error instanceof Error) return error.message || "Error object"

  if (typeof error === "object" && error !== null) {
    const obj = error as { [key: string]: unknown }
    for (const prop of ["message", "error", "details", "description"]) {
      const v = obj[prop]
      if (isNonEmptyTrimmedString(v)) return v.trim()
    }
  }

  return "Unknown error occurred"
}

export const ariaDesc = (id?: string, suffix = "error"): string | undefined =>
  id ? `${id}-${suffix}` : undefined

export const getBtnAria = (
  text?: any,
  icon?: string | boolean,
  jimuAriaLabel?: string,
  tooltip?: string,
  fallbackLabel?: string
): string | undefined => {
  if (jimuAriaLabel) return jimuAriaLabel
  const textLabel = toNonEmptyTrimmedString(text)
  if (textLabel) return textLabel
  if (!icon) return undefined
  const tooltipLabel = toNonEmptyTrimmedString(tooltip)
  return tooltipLabel || fallbackLabel
}
