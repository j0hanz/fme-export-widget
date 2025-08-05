import type { IMState } from "jimu-core"
import type {
  FmeExportConfig,
  FmeWidgetState,
  AreaTemplate,
  LoadingFlags,
  RealTimeMeasurements,
  EsriModules,
} from "./types"
import { TEMPLATE_VALIDATION_RULES, StateType } from "./types"

// Constants
const CONFIG_ERRORS = {
  FME_SERVER_URL_REQUIRED:
    "FME Server URL is required (fmeServerUrl or fme_server_url)",
  FME_SERVER_TOKEN_REQUIRED:
    "FME Server token is required (fmeServerToken or fmw_server_token)",
  REPOSITORY_REQUIRED: "Repository is required",
  INVALID_FME_SERVER_URL: "FME Server URL must be a valid URL",
  INVALID_API_URL: "API URL must be a valid URL",
  INVALID_GEOMETRY_SERVICE_URL: "Geometry service URL must be a valid URL",
} as const

const CONFIG_MAPPINGS = {
  FME_SERVER_URL: ["fmeServerUrl", "fme_server_url"],
  FME_SERVER_TOKEN: ["fmeServerToken", "fmw_server_token"],
  GEOMETRY_SERVICE_URL: ["geometryServiceUrl", "geometryService"],
} as const

// Format area utility function
export function formatArea(area: number): string {
  if (!area || isNaN(area) || area <= 0) return "0 m²"

  // Define thresholds and conversion factors
  const AREA_THRESHOLD_SQKM = 1000000 // 1 sq km = 1,000,000 sq m
  const AREA_CONVERSION_FACTOR = 1000000 // Convert m² to km²
  const AREA_DECIMAL_PLACES = 2

  if (area >= AREA_THRESHOLD_SQKM) {
    const kmValue = area / AREA_CONVERSION_FACTOR
    const formattedNumber = new Intl.NumberFormat("sv-SE", {
      minimumFractionDigits: AREA_DECIMAL_PLACES,
      maximumFractionDigits: AREA_DECIMAL_PLACES,
    }).format(kmValue)
    return `${formattedNumber} km²`
  }

  const formattedNumber = new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(area))
  return `${formattedNumber} m²`
}

// Validate area against maximum allowed size
export function validateArea(
  area: number,
  maxArea?: number
): {
  isValid: boolean
  message?: string
} {
  if (!maxArea) {
    return { isValid: true }
  }
  if (area > maxArea) {
    return {
      isValid: false,
      message: `Area exceeds maximum allowed size of ${formatArea(maxArea)}`,
    }
  }
  return { isValid: true }
}

// Validate FME Export configuration with enhanced error handling
export function validateConfig(config: FmeExportConfig): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Enhanced FME Server URL validation with better error context
  const fmeServerUrl = CONFIG_MAPPINGS.FME_SERVER_URL.find(
    (prop) => config[prop]
  )
    ? config[CONFIG_MAPPINGS.FME_SERVER_URL.find((prop) => config[prop])]
    : null

  if (!fmeServerUrl) {
    errors.push(
      `${CONFIG_ERRORS.FME_SERVER_URL_REQUIRED}. Available properties: ${CONFIG_MAPPINGS.FME_SERVER_URL.join(", ")}`
    )
  }

  // Enhanced FME Server token validation with better error context
  const fmeServerToken = CONFIG_MAPPINGS.FME_SERVER_TOKEN.find(
    (prop) => config[prop]
  )
    ? config[CONFIG_MAPPINGS.FME_SERVER_TOKEN.find((prop) => config[prop])]
    : null

  if (!fmeServerToken) {
    errors.push(
      `${CONFIG_ERRORS.FME_SERVER_TOKEN_REQUIRED}. Available properties: ${CONFIG_MAPPINGS.FME_SERVER_TOKEN.join(", ")}`
    )
  }

  if (!config.repository) {
    errors.push(
      `${CONFIG_ERRORS.REPOSITORY_REQUIRED}. This should specify the FME repository name.`
    )
  }

  // Enhanced URL format validation with more detailed feedback
  if (fmeServerUrl) {
    try {
      const url = new URL(fmeServerUrl)
      if (!url.protocol.startsWith("http")) {
        errors.push(
          `${CONFIG_ERRORS.INVALID_FME_SERVER_URL}. Protocol must be http or https, got: ${url.protocol}`
        )
      }
      if (!url.hostname) {
        errors.push(
          `${CONFIG_ERRORS.INVALID_FME_SERVER_URL}. Missing hostname in URL: ${fmeServerUrl}`
        )
      }
    } catch (urlError) {
      errors.push(
        `${CONFIG_ERRORS.INVALID_FME_SERVER_URL}. Invalid URL format: ${fmeServerUrl} (${urlError.message})`
      )
    }
  }

  // Enhanced API URL validation (optional)
  if (config.api) {
    try {
      const url = new URL(config.api)
      if (!url.protocol.startsWith("http")) {
        errors.push(
          `${CONFIG_ERRORS.INVALID_API_URL}. API URL protocol must be http or https, got: ${url.protocol}`
        )
      }
    } catch (urlError) {
      errors.push(
        `${CONFIG_ERRORS.INVALID_API_URL}. Invalid API URL format: ${config.api} (${urlError.message})`
      )
    }
  }

  // Enhanced geometry service URL validation with mapping support
  const geometryServiceUrl = CONFIG_MAPPINGS.GEOMETRY_SERVICE_URL.find(
    (prop) => config[prop]
  )
    ? config[CONFIG_MAPPINGS.GEOMETRY_SERVICE_URL.find((prop) => config[prop])]
    : null

  if (geometryServiceUrl) {
    try {
      const url = new URL(geometryServiceUrl)
      if (!url.protocol.startsWith("http")) {
        errors.push(
          `${CONFIG_ERRORS.INVALID_GEOMETRY_SERVICE_URL}. Protocol must be http or https, got: ${url.protocol}`
        )
      }
    } catch (urlError) {
      errors.push(
        `${CONFIG_ERRORS.INVALID_GEOMETRY_SERVICE_URL}. Invalid geometry service URL: ${geometryServiceUrl} (${urlError.message})`
      )
    }
  }

  // Additional validation for max area if provided
  if (config.maxArea !== undefined) {
    if (typeof config.maxArea !== "number" || config.maxArea <= 0) {
      errors.push(
        "maxArea must be a positive number representing maximum allowed area in square meters"
      )
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

// State Management Utilities
export const getFmeWidgetState = (
  state: IMState,
  widgetId: string
): FmeWidgetState | undefined => {
  return state.widgetsState?.[widgetId]?.["fme-state"]
}

export const getUiStateSlice = (state: IMState, widgetId: string) => {
  const fmeState = getFmeWidgetState(state, widgetId)
  return {
    uiState: fmeState?.uiState || StateType.IDLE,
    uiStateData: fmeState?.uiStateData || {},
  }
}

// Template Validation Utilities
export interface TemplateValidationResult {
  template: AreaTemplate | null
  errors: string[]
  isValid: boolean
}

export interface TemplateImportValidationResult {
  validTemplates: AreaTemplate[]
  invalidTemplates: TemplateValidationResult[]
  totalErrors: string[]
}

// Validate a single template's basic structure and fields
export function validateTemplateStructure(
  template: any,
  index: number
): TemplateValidationResult {
  const errors: string[] = []

  // Basic structure validation
  if (!template || typeof template !== "object") {
    errors.push(`Template ${index + 1}: Invalid template structure`)
    return { template: null, errors, isValid: false }
  }

  // Required field validation
  if (!template.id || typeof template.id !== "string") {
    errors.push(`Template ${index + 1}: Missing or invalid ID`)
  }
  if (!template.name || typeof template.name !== "string") {
    errors.push(`Template ${index + 1}: Missing or invalid name`)
  }
  if (!template.geometry) {
    errors.push(`Template ${index + 1}: Missing geometry data`)
  }
  if (typeof template.area !== "number" || template.area <= 0) {
    errors.push(`Template ${index + 1}: Missing or invalid area`)
  }
  if (!template.createdDate) {
    errors.push(`Template ${index + 1}: Missing creation date`)
  }

  return {
    template: errors.length === 0 ? template : null,
    errors,
    isValid: errors.length === 0,
  }
}

// Validate template name according to business rules
export function validateTemplateName(
  name: string,
  index: number,
  existingNames: Set<string>,
  importNames: Set<string>
): string[] {
  const errors: string[] = []
  const trimmedName = name.trim()

  if (trimmedName.length === 0) {
    errors.push(`Template ${index + 1}: Name cannot be empty`)
  }
  if (trimmedName.length > TEMPLATE_VALIDATION_RULES.MAX_NAME_LENGTH) {
    errors.push(
      `Template ${index + 1}: Name too long (max ${TEMPLATE_VALIDATION_RULES.MAX_NAME_LENGTH} characters)`
    )
  }
  if (TEMPLATE_VALIDATION_RULES.INVALID_CHARS_REGEX.test(trimmedName)) {
    errors.push(`Template ${index + 1}: Name contains invalid characters`)
  }
  if (existingNames.has(trimmedName.toLowerCase())) {
    errors.push(
      `Template ${index + 1}: Name "${trimmedName}" already exists in storage`
    )
  }
  if (importNames.has(trimmedName.toLowerCase())) {
    errors.push(
      `Template ${index + 1}: Duplicate name "${trimmedName}" found in import file`
    )
  }

  return errors
}

// Validate template ID uniqueness
export function validateTemplateId(
  id: string,
  index: number,
  existingIds: Set<string>,
  importIds: Set<string>
): string[] {
  const errors: string[] = []

  if (existingIds.has(id)) {
    errors.push(`Template ${index + 1}: ID "${id}" already exists in storage`)
  }
  if (importIds.has(id)) {
    errors.push(
      `Template ${index + 1}: Duplicate ID "${id}" found in import file`
    )
  }

  return errors
}

// Validate template count limits
export function validateTemplateCount(
  existingCount: number,
  newCount: number
): { isValid: boolean; error?: string } {
  const totalAfterImport = existingCount + newCount

  if (totalAfterImport > TEMPLATE_VALIDATION_RULES.MAX_TEMPLATES) {
    return {
      isValid: false,
      error: `Cannot import ${newCount} templates. Maximum limit of ${TEMPLATE_VALIDATION_RULES.MAX_TEMPLATES} templates would be exceeded (currently have ${existingCount})`,
    }
  }

  return { isValid: true }
}

// Main template import validation function
export function validateTemplateImport(
  templatesArray: any[],
  existingTemplates: AreaTemplate[]
): TemplateImportValidationResult {
  const existingNames = new Set(
    existingTemplates.map((t) => t.name.toLowerCase())
  )
  const existingIds = new Set(existingTemplates.map((t) => t.id))

  // Sets to track names and IDs for import validation
  const importNames = new Set<string>()
  const importIds = new Set<string>()

  // Validate each template
  const validationResults = templatesArray.map((template, index) => {
    // Basic structure validation
    const structureResult = validateTemplateStructure(template, index)
    if (!structureResult.isValid) {
      return structureResult
    }

    const errors: string[] = []

    // Name validation
    if (template.name) {
      const nameErrors = validateTemplateName(
        template.name,
        index,
        existingNames,
        importNames
      )
      errors.push(...nameErrors)

      // Add to import set if name is valid
      if (nameErrors.length === 0) {
        importNames.add(template.name.trim().toLowerCase())
      }
    }

    // ID validation
    if (template.id) {
      const idErrors = validateTemplateId(
        template.id,
        index,
        existingIds,
        importIds
      )
      errors.push(...idErrors)

      // Add to import set if ID is valid
      if (idErrors.length === 0) {
        importIds.add(template.id)
      }
    }

    return {
      template: errors.length === 0 ? template : null,
      errors,
      isValid: errors.length === 0,
    }
  })

  // Separate valid and invalid templates
  const validTemplates = validationResults
    .filter((result) => result.isValid)
    .map((result) => result.template)
  const invalidTemplates = validationResults.filter((result) => !result.isValid)

  // Collect all error messages
  const totalErrors: string[] = []

  if (invalidTemplates.length > 0) {
    const validationErrors = invalidTemplates
      .map((result) => result.errors.join("; "))
      .join("\n")
    totalErrors.push(`Import validation failed:\n${validationErrors}`)
  }

  if (validTemplates.length === 0) {
    totalErrors.push("No valid templates found in import data")
  }

  // Check template count limits
  const countValidation = validateTemplateCount(
    existingTemplates.length,
    validTemplates.length
  )
  if (!countValidation.isValid && countValidation.error) {
    totalErrors.push(countValidation.error)
  }

  return {
    validTemplates,
    invalidTemplates,
    totalErrors,
  }
}

// Validate template name for single template operations (like saving)
export function validateSingleTemplateName(
  name: string,
  existingTemplates: AreaTemplate[],
  currentTemplateId?: string
): {
  isValid: boolean
  errors: {
    nameEmpty: boolean
    nameTooLong: boolean
    nameExists: boolean
    hasInvalidChars: boolean
  }
} {
  const trimmedName = name.trim()
  const existingNames = existingTemplates
    .filter((t) => t.id !== currentTemplateId) // Exclude current template when editing
    .map((t) => t.name.toLowerCase())

  const errors = {
    nameEmpty: trimmedName.length === 0,
    nameTooLong: trimmedName.length > TEMPLATE_VALIDATION_RULES.MAX_NAME_LENGTH,
    nameExists: existingNames.includes(trimmedName.toLowerCase()),
    hasInvalidChars:
      TEMPLATE_VALIDATION_RULES.INVALID_CHARS_REGEX.test(trimmedName),
  }

  const isValid =
    !errors.nameEmpty &&
    !errors.nameTooLong &&
    !errors.nameExists &&
    !errors.hasInvalidChars

  return { isValid, errors }
}

// Widget utility functions from widget.tsx
export const createGeometryFromTemplate = async (
  template: AreaTemplate
): Promise<__esri.Geometry | null> => {
  if (!template.geometry) return null

  try {
    const { loadArcGISJSAPIModules } = await import("jimu-arcgis")
    const [jsonUtils] = await loadArcGISJSAPIModules([
      "esri/geometry/support/jsonUtils",
    ])
    return jsonUtils.fromJSON(template.geometry)
  } catch (error) {
    console.error("❌ Failed to create geometry from template:", error)
    return null
  }
}

export const downloadJSON = (json: string, filename: string) => {
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const createLoadingWrapper = (dispatch: any) => {
  return function withLoadingFlags<R>(
    flag: keyof LoadingFlags,
    fn: () => Promise<R>
  ): Promise<R> {
    const { fmeActions } = require("../extensions/store")
    dispatch(fmeActions.setLoadingFlags({ [flag]: true }))
    return fn().finally(() =>
      dispatch(fmeActions.setLoadingFlags({ [flag]: false }))
    )
  }
}

// Map graphics and measurement utilities
export const createMeasurementGraphics = (
  geometry: __esri.Geometry,
  measurements: RealTimeMeasurements,
  measurementLayer: __esri.GraphicsLayer,
  modules: EsriModules,
  _isUpdate = false // Prefix with underscore to indicate it's intentionally unused
) => {
  if (!geometry || !measurements.area || !measurementLayer || !modules) return

  try {
    if (geometry.type !== "polygon") return

    const { Graphic, TextSymbol, SimpleMarkerSymbol, centroidOperator } =
      modules

    // Use centroid operator to get the center point
    const centroid = centroidOperator.execute(geometry as __esri.Polygon)
    if (!centroid) return

    // Clear all existing measurement graphics first to ensure no leftover labels
    measurementLayer.removeAll()

    // Import STYLES here to avoid circular dependency
    const { STYLES } = require("./css")

    // Create marker symbol
    const markerSymbol = new SimpleMarkerSymbol({
      style: "circle",
      color: STYLES.colors.blackTransparent,
      size: 8,
      outline: {
        color: STYLES.colors.white,
        width: 2,
      },
    })

    // Create text symbol with formatted area
    const textSymbol = new TextSymbol({
      text: formatArea(measurements.area),
      color: STYLES.measurementLabel.color,
      font: {
        size: STYLES.measurementLabel.fontSize,
        weight: STYLES.measurementLabel.fontWeight,
        family: STYLES.measurementLabel.fontFamily,
      },
      haloColor: STYLES.measurementLabel.haloColor,
      haloSize: STYLES.measurementLabel.haloSize,
      xoffset: 0,
      yoffset: 15, // Offset text above the marker
      horizontalAlignment: STYLES.measurementLabel.horizontalAlignment,
      verticalAlignment: STYLES.measurementLabel.verticalAlignment,
    })

    // Create and add marker and text graphics
    const markerGraphic = new Graphic({
      geometry: centroid,
      symbol: markerSymbol,
      attributes: {
        isMeasurementGraphic: true,
        type: "centroid-marker",
      },
    })

    const textGraphic = new Graphic({
      geometry: centroid,
      symbol: textSymbol,
      attributes: {
        isMeasurementGraphic: true,
        type: "area-label",
      },
    })

    measurementLayer.addMany([markerGraphic, textGraphic])
  } catch (error) {
    console.warn("Failed to create/update measurement graphics:", error)
  }
}

// Utility function to programmatically manage measurement widget visibility
export const configureMeasurementWidget = (
  view: __esri.MapView,
  geometry: __esri.Geometry | null,
  measurementWidget: __esri.Measurement | null
) => {
  if (!view || !geometry || !measurementWidget) return

  try {
    // Show measurement widget and set appropriate tool based on geometry type
    measurementWidget.visible = true

    if (geometry.type === "polygon") {
      measurementWidget.activeTool = "area"
    } else if (geometry.type === "polyline") {
      measurementWidget.activeTool = "distance"
    }
  } catch (error) {
    console.warn("Error using measurement widget:", error)
  }
}
