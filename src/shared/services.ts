import type {
  RealTimeMeasurements,
  AreaTemplate,
  ErrorState,
  FmeWidgetState,
  WorkspaceParameter,
} from "./types"
import { ErrorType, ErrorSeverity, FmeActionType, ParameterType } from "./types"

import { AppStateManager } from "jimu-core"
import { validateTemplateImport } from "./utils"
import { fmeActions } from "../extensions/store"

// Modern geometry operators service - replaces deprecated MeasurementService
export class GeometryOperatorsService {
  private readonly areaOperator: any
  private readonly geodeticAreaOperator: any
  private readonly lengthOperator: any
  private readonly geodeticLengthOperator: any
  private readonly centroidOperator: any
  private readonly simplifyOperator: any
  private readonly bufferOperator: any
  private readonly geodesicBufferOperator: any
  private readonly convexHullOperator: any
  private initialized = false

  constructor(operators: {
    areaOperator: any
    geodeticAreaOperator: any
    lengthOperator: any
    geodeticLengthOperator: any
    centroidOperator: any
    simplifyOperator: any
    bufferOperator: any
    geodesicBufferOperator: any
    convexHullOperator: any
  }) {
    this.areaOperator = operators.areaOperator
    this.geodeticAreaOperator = operators.geodeticAreaOperator
    this.lengthOperator = operators.lengthOperator
    this.geodeticLengthOperator = operators.geodeticLengthOperator
    this.centroidOperator = operators.centroidOperator
    this.simplifyOperator = operators.simplifyOperator
    this.bufferOperator = operators.bufferOperator
    this.geodesicBufferOperator = operators.geodesicBufferOperator
    this.convexHullOperator = operators.convexHullOperator
  }

  // Initialize all operators
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // Only load operators that exist and have a load method
      const loadPromises = [
        this.areaOperator?.load?.(),
        this.geodeticAreaOperator?.load?.(),
        this.lengthOperator?.load?.(),
        this.geodeticLengthOperator?.load?.(),
        this.centroidOperator?.load?.(),
        this.simplifyOperator?.load?.(),
        this.bufferOperator?.load?.(),
        this.geodesicBufferOperator?.load?.(),
        this.convexHullOperator?.load?.(),
      ].filter((promise) => promise !== undefined)

      if (loadPromises.length > 0) {
        await Promise.all(loadPromises)
      }

      this.initialized = true
    } catch (error) {
      console.warn("Failed to initialize geometry operators:", error)
      // Don't throw error - allow widget to continue with basic functionality
      this.initialized = true
    }
  }

  // Calculate measurements using modern geometry operators
  calculateMeasurements(
    geometry: __esri.Geometry,
    spatialReference?: __esri.SpatialReference
  ): RealTimeMeasurements {
    if (!this.initialized) {
      console.warn("Geometry operators not initialized")
      return { area: 0 }
    }

    const sr = spatialReference || geometry.spatialReference
    const isGeodesic = sr?.isGeographic || sr?.isWebMercator

    let area = 0
    let distance = 0
    let centroid: { x: number; y: number } | null = null
    let pointsAdded = 0

    try {
      if (geometry.type === "polygon") {
        const polygon = geometry as __esri.Polygon
        pointsAdded = polygon.rings?.[0]?.length || 0

        // Use modern operators for accurate calculations
        if (pointsAdded >= 3) {
          area = Math.abs(
            isGeodesic
              ? this.geodeticAreaOperator.execute(polygon, {
                  units: "square-meters",
                })
              : this.areaOperator.execute(polygon, { units: "square-meters" })
          )
          distance = Math.abs(
            isGeodesic
              ? this.geodeticLengthOperator.execute(polygon, {
                  units: "meters",
                })
              : this.lengthOperator.execute(polygon, { units: "meters" })
          )

          // Use dedicated centroid operator for better accuracy
          const centroidPoint = this.centroidOperator.execute(polygon)
          centroid = centroidPoint
            ? { x: centroidPoint.x, y: centroidPoint.y }
            : null
        }
      }
    } catch (error) {
      console.warn("Geometry calculation failed:", error)
    }

    return {
      area,
      distance,
      centroid,
      drawingProgress: {
        pointsAdded,
        isClosingPolygon: false,
        canCompletePolygon: pointsAdded >= 3,
        totalPerimeter: distance,
      },
    }
  }

  // Simplify geometry to remove unnecessary vertices while preserving shape
  simplifyGeometry(geometry: __esri.Geometry): __esri.Geometry | null {
    if (!this.initialized) {
      console.warn("Geometry operators not initialized")
      return null
    }

    try {
      return this.simplifyOperator.execute(geometry)
    } catch (error) {
      console.warn("Geometry simplification failed:", error)
      return geometry
    }
  }

  // Create buffer around geometry (planar)
  createBuffer(
    geometry: __esri.Geometry,
    distance: number,
    unit = "meters"
  ): __esri.Polygon | null {
    if (!this.initialized) {
      console.warn("Geometry operators not initialized")
      return null
    }

    try {
      return this.bufferOperator.execute(geometry, distance, { unit })
    } catch (error) {
      console.warn("Buffer operation failed:", error)
      return null
    }
  }

  // Create geodesic buffer around geometry
  createGeodesicBuffer(
    geometry: __esri.Geometry,
    distance: number,
    unit = "meters"
  ): __esri.Polygon | null {
    if (!this.initialized) {
      console.warn("Geometry operators not initialized")
      return null
    }

    try {
      return this.geodesicBufferOperator.execute(geometry, distance, { unit })
    } catch (error) {
      console.warn("Geodesic buffer operation failed:", error)
      return null
    }
  }

  // Generate convex hull for geometry simplification
  createConvexHull(geometry: __esri.Geometry): __esri.Geometry | null {
    if (!this.initialized) {
      console.warn("Geometry operators not initialized")
      return null
    }

    try {
      return this.convexHullOperator.execute(geometry)
    } catch (error) {
      console.warn("Convex hull operation failed:", error)
      return null
    }
  }

  destroy(): void {
    this.initialized = false
  }
}

export class TemplatePersistenceService {
  private readonly dbName: string
  private readonly storeName = "templates"
  private readonly version = 1
  private isInitialized = false
  private isAvailable = false

  constructor(widgetId: string) {
    this.dbName = `fme-export-${widgetId}`
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      await this.openDatabase()
      this.isAvailable = true
    } catch (error) {
      console.warn("Template persistence not available:", error)
      this.isAvailable = false
    } finally {
      this.isInitialized = true
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(this.dbName, this.version)

      openRequest.onupgradeneeded = (event: any) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" })
        }
      }

      openRequest.onsuccess = (event: any) => {
        resolve(event.target.result)
      }

      openRequest.onerror = () => {
        reject(new Error("Failed to open IndexedDB"))
      }
    })
  }

  async loadTemplates(): Promise<AreaTemplate[]> {
    if (!this.isAvailable) return []

    try {
      const db = await this.openDatabase()
      const transaction = db.transaction([this.storeName], "readonly")
      const objectStore = transaction.objectStore(this.storeName)
      const request = objectStore.getAll()

      return new Promise((resolve) => {
        request.onsuccess = () => {
          db.close()
          resolve(Array.isArray(request.result) ? request.result : [])
        }
        request.onerror = () => {
          db.close()
          resolve([])
        }
      })
    } catch {
      return []
    }
  }

  async saveTemplate(template: AreaTemplate): Promise<void> {
    if (!this.isAvailable) {
      throw new Error("Template storage not available")
    }

    const db = await this.openDatabase()
    const transaction = db.transaction([this.storeName], "readwrite")
    const request = transaction.objectStore(this.storeName).put(template)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close()
        resolve()
      }
      request.onerror = () => {
        db.close()
        reject(new Error("Failed to save template"))
      }
    })
  }

  async deleteTemplate(templateId: string): Promise<void> {
    if (!this.isAvailable) {
      throw new Error("Template storage not available")
    }

    const db = await this.openDatabase()
    const transaction = db.transaction([this.storeName], "readwrite")
    const request = transaction.objectStore(this.storeName).delete(templateId)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close()
        resolve()
      }
      request.onerror = () => {
        db.close()
        reject(new Error("Failed to delete template"))
      }
    })
  }

  async clearAllTemplates(): Promise<void> {
    if (!this.isAvailable) {
      throw new Error("Template storage not available")
    }

    const db = await this.openDatabase()
    const transaction = db.transaction([this.storeName], "readwrite")
    const request = transaction.objectStore(this.storeName).clear()

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close()
        resolve()
      }
      request.onerror = () => {
        db.close()
        reject(new Error("Failed to clear templates"))
      }
    })
  }

  async exportTemplates(): Promise<string> {
    const templates = await this.loadTemplates()
    return JSON.stringify(templates, null, 2)
  }

  async exportSingleTemplate(templateId: string): Promise<string> {
    const template = (await this.loadTemplates()).find(
      (t) => t.id === templateId
    )
    if (!template) {
      throw new Error("Template not found")
    }
    return JSON.stringify(template, null, 2)
  }

  async importTemplates(templatesJson: string): Promise<AreaTemplate[]> {
    if (!this.isAvailable) {
      throw new Error("Template storage not available")
    }

    let parsedData
    try {
      parsedData = JSON.parse(templatesJson)
    } catch {
      throw new Error("Invalid JSON format")
    }

    // Handle both single template and array of templates
    const templatesArray = Array.isArray(parsedData) ? parsedData : [parsedData]

    // Get existing templates for validation
    const existingTemplates = await this.loadTemplates()

    // Use comprehensive validation from utils
    const validationResult = validateTemplateImport(
      templatesArray,
      existingTemplates
    )

    if (validationResult.totalErrors.length > 0) {
      throw new Error(validationResult.totalErrors.join("\n"))
    }

    // Save all valid templates
    const db = await this.openDatabase()
    const transaction = db.transaction([this.storeName], "readwrite")
    const objectStore = transaction.objectStore(this.storeName)

    const savePromises = validationResult.validTemplates.map((template) => {
      return new Promise<void>((resolve, reject) => {
        const request = objectStore.put(template)
        request.onsuccess = () => {
          resolve()
        }
        request.onerror = () => {
          reject(new Error("Template save failed"))
        }
      })
    })

    await Promise.all(savePromises)
    db.close()

    return validationResult.validTemplates
  }

  get available(): boolean {
    return this.isAvailable
  }

  get initialized(): boolean {
    return this.isInitialized
  }

  destroy(): void {
    this.isInitialized = false
    this.isAvailable = false
  }
}

export class ErrorHandlingService {
  private errorHistory: ErrorState[] = []
  private readonly maxHistorySize = 10

  // Create standard error with context
  createError(
    message: string,
    type: ErrorType,
    options: {
      code?: string
      severity?: ErrorSeverity
      recoverable?: boolean
      retry?: () => void
      details?: { [key: string]: any }
    } = {}
  ): ErrorState {
    const {
      code,
      severity = ErrorSeverity.ERROR,
      recoverable = false,
      retry,
      details = {},
    } = options

    const error: ErrorState = {
      message,
      code,
      severity,
      type,
      timestamp: new Date(),
      recoverable,
      retry: recoverable ? retry : undefined,
      details,
    }

    this.addToHistory(error)
    return error
  }

  // Create network-specific errors with retry logic
  createNetworkError(
    message: string,
    options: {
      statusCode?: number
      endpoint?: string
      retry?: () => void
    } = {}
  ): ErrorState {
    const { statusCode, endpoint, retry } = options

    return this.createError(message, ErrorType.NETWORK, {
      code: statusCode ? `HTTP_${statusCode}` : "NETWORK_ERROR",
      severity: ErrorSeverity.ERROR,
      recoverable: true,
      retry,
      details: { statusCode, endpoint },
    })
  }

  // Create validation errors with field-specific context
  createValidationError(
    message: string,
    field?: string,
    value?: any
  ): ErrorState {
    return this.createError(message, ErrorType.VALIDATION, {
      code: field ? `VALIDATION_${field.toUpperCase()}` : "VALIDATION_ERROR",
      severity: ErrorSeverity.WARNING,
      recoverable: true,
      details: { field, value },
    })
  }

  // Create template-specific errors
  createTemplateError(
    message: string,
    operation: "SAVE" | "LOAD" | "DELETE" | "IMPORT" | "EXPORT",
    templateId?: string
  ): ErrorState {
    return this.createError(message, ErrorType.TEMPLATE, {
      code: `TEMPLATE_${operation}_ERROR`,
      severity: ErrorSeverity.ERROR,
      recoverable: operation !== "DELETE",
      details: { operation, templateId },
    })
  }

  // Get error suggestions based on error type and context
  getErrorSuggestions(error: ErrorState): string[] {
    const suggestions: string[] = []

    switch (error.type) {
      case ErrorType.NETWORK:
        suggestions.push("Check your internet connection")
        if (error.details?.statusCode === 401) {
          suggestions.push(
            "Your session may have expired - try refreshing the page"
          )
        }
        if (
          typeof error.details?.statusCode === "number" &&
          error.details.statusCode >= 500
        ) {
          suggestions.push("Server is experiencing issues - try again later")
        }
        break

      case ErrorType.TEMPLATE:
        if (error.details?.operation === "IMPORT") {
          suggestions.push("Check that the file contains valid template data")
          suggestions.push("Ensure template names are unique")
        }
        if (error.details?.operation === "SAVE") {
          suggestions.push("Check that you have sufficient storage space")
          suggestions.push("Try using a shorter template name")
        }
        break

      case ErrorType.VALIDATION:
        if (error.details?.field && typeof error.details.field === "string") {
          suggestions.push(`Check the ${error.details.field} field`)
        }
        suggestions.push("Ensure all required fields are filled")
        break

      case ErrorType.GEOMETRY:
        suggestions.push("Try redrawing your area")
        suggestions.push("Ensure the drawn area is not too large")
        break

      case ErrorType.MODULE:
        suggestions.push("Try refreshing the page")
        suggestions.push("Check your internet connection")
        break

      case ErrorType.API:
        suggestions.push("Check your network connection")
        suggestions.push("Try again in a few moments")
        break

      case ErrorType.CONFIG:
        suggestions.push("Check widget configuration")
        suggestions.push("Contact your administrator")
        break

      case ErrorType.AREA_TOO_LARGE:
        suggestions.push("Try drawing a smaller area")
        suggestions.push("Split your area into smaller sections")
        break
    }

    return suggestions
  }

  private addToHistory(error: ErrorState): void {
    this.errorHistory.unshift(error)
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(0, this.maxHistorySize)
    }
  }

  getErrorHistory(): ErrorState[] {
    return [...this.errorHistory]
  }

  clearHistory(): void {
    this.errorHistory = []
  }
}

export interface AppStateRestoreResult {
  isRestoreReady: boolean
  hasRestoredState: boolean
}

export type NotificationCallback = (notification: {
  severity: "success" | "error" | "warning" | "info"
  message: string
}) => void

export type TranslationCallback = (key: string) => string

export class AppStateService {
  private readonly widgetId: string
  private isRestoreReady = false
  private hasRestoredState = false
  private appStateManager: any = null

  constructor(widgetId: string) {
    this.widgetId = widgetId
  }

  // Initialize the service and register the restore function
  initialize(
    dispatch: any,
    setNotification?: NotificationCallback,
    translate?: TranslationCallback
  ): AppStateRestoreResult {
    try {
      this.appStateManager = AppStateManager.getInstance()

      // Check if local state is supported
      if (!AppStateManager.isSupportLocalState()) {
        // Use debug level logging instead of warn to reduce noise
        console.debug(
          "FME Export: Local state persistence not available - templates will use memory storage only"
        )
        this.isRestoreReady = true
        return this.getRestoreResult()
      }

      // Create the restore function
      const restoreFunction = (lastLocalState: any) => {
        this.executeStateRestore(
          lastLocalState,
          dispatch,
          setNotification,
          translate
        )
      }

      // Register the restore function
      this.appStateManager.registerRestoreFunction(restoreFunction)
      this.isRestoreReady = true

      return this.getRestoreResult()
    } catch (error) {
      console.error("Failed to initialize AppStateService:", error)
      this.isRestoreReady = true // Set ready even on failure to prevent blocking
      return this.getRestoreResult()
    }
  }

  // Execute the state restoration logic
  public executeStateRestore(
    lastLocalState: any,
    dispatch: any,
    setNotification?: NotificationCallback,
    translate?: TranslationCallback
  ): void {
    const widgetState = lastLocalState[this.widgetId]
    if (!widgetState) {
      console.info("No previous state found for widget restoration")
      return
    }

    console.info("Restoring widget state from AppStateManager:", widgetState)

    try {
      // Restore serializable Redux state using available actions
      if (widgetState.viewMode && widgetState.viewMode !== "initial") {
        dispatch(fmeActions.setViewMode(widgetState.viewMode))
      }

      if (widgetState.geometryJson) {
        dispatch({
          type: FmeActionType.SET_GEOMETRY,
          geometry: widgetState.geometryJson,
          drawnArea: widgetState.drawnArea || 0,
        })
      }

      if (widgetState.formValues) {
        dispatch(fmeActions.setFormValues(widgetState.formValues))
      }

      if (widgetState.templateName) {
        dispatch({
          type: FmeActionType.SET_TEMPLATE_NAME,
          templateName: widgetState.templateName,
        })
      }

      if (widgetState.drawingTool) {
        dispatch({
          type: FmeActionType.SET_DRAWING_TOOL,
          drawingTool: widgetState.drawingTool,
        })
      }

      // Show success notification for state restoration
      if (setNotification && translate) {
        setNotification({
          severity: "info",
          message:
            translate("stateRestoredFromPrevious") ||
            "Previous drawing and settings restored",
        })
      }

      this.hasRestoredState = true
    } catch (error) {
      console.error("Failed to restore widget state:", error)
    }
  }

  // Save the current widget state to AppStateManager
  async saveState(state: FmeWidgetState): Promise<void> {
    if (!AppStateManager.isSupportLocalState() || !this.appStateManager) {
      return
    }

    try {
      // Only save state that's worth restoring (avoid saving initial/empty states)
      const shouldSave =
        state.viewMode !== "initial" ||
        state.geometryJson !== null ||
        state.drawnArea > 0 ||
        state.templateName !== "" ||
        state.selectedWorkspace !== null ||
        Object.keys(state.formValues).length > 0

      if (shouldSave) {
        const stateToSave = {
          viewMode: state.viewMode,
          geometryJson: state.geometryJson,
          drawnArea: state.drawnArea,
          templateName: state.templateName,
          selectedWorkspace: state.selectedWorkspace,
          formValues: state.formValues,
          drawingTool: state.drawingTool,
          selectedTemplateId: state.selectedTemplateId,
          timestamp: Date.now(),
        }

        await this.appStateManager.putLocalState(this.widgetId, stateToSave)
        console.info("Widget state saved to AppStateManager")
      }
    } catch (error) {
      console.warn("Failed to save widget state to AppStateManager:", error)
    }
  }

  // Check if local state persistence is supported
  isLocalStateSupported(): boolean {
    return AppStateManager.isSupportLocalState()
  }

  // Get the current restore result
  getRestoreResult(): AppStateRestoreResult {
    return {
      isRestoreReady: this.isRestoreReady,
      hasRestoredState: this.hasRestoredState,
    }
  }

  // Destroy the service and clean up state
  destroy(): void {
    this.isRestoreReady = false
    this.hasRestoredState = false
    this.appStateManager = null
  }
}

// Parameter Form Service - generates dynamic forms from FME workspace parameters
export class ParameterFormService {
  private readonly skipParameters = [
    "MAXX",
    "MINX",
    "MAXY",
    "MINY",
    "AreaOfInterest",
  ]

  // Generate dynamic form configuration from workspace parameters
  generateFormConfig(
    parameters: readonly WorkspaceParameter[],
    workspaceName: string
  ): DynamicFormConfig {
    const filteredParams = parameters.filter(
      (param) => !this.skipParameters.includes(param.name)
    )

    const fields = filteredParams.map((param) => this.createFieldConfig(param))
    const requiredFields = filteredParams
      .filter((p) => !p.optional)
      .map((p) => p.name)

    return {
      workspaceName,
      titleId: this.generateTitleId(workspaceName),
      subtitleId: this.generateSubtitleId(workspaceName),
      fields,
      requiredFields,
    }
  }

  // Create field configuration from workspace parameter
  private createFieldConfig(param: WorkspaceParameter): DynamicFieldConfig {
    let fieldConfig: DynamicFieldConfig = {
      field: param.name,
      labelId: param.description || param.name, // Use description directly as label
      required: !param.optional,
      type: this.mapParameterType(param.type),
      defaultValue: param.defaultValue,
    }

    // Note: param.model typically contains type information like "string"
    // rather than helpful text, so we don't use it for helperId

    // Add options for choice-based parameters
    if (param.listOptions && param.listOptions.length > 0) {
      fieldConfig = {
        ...fieldConfig,
        options: param.listOptions.map((option) => ({
          value: option.value,
          label: option.caption || option.value,
        })),
      }
    }

    return fieldConfig
  }

  // Map FME parameter types to form field types
  private mapParameterType(fmeType: ParameterType): FormFieldType {
    switch (fmeType) {
      case ParameterType.CHOICE:
      case ParameterType.LOOKUP_CHOICE:
      case ParameterType.STRING_OR_CHOICE:
        return FormFieldType.SELECT
      case ParameterType.LISTBOX:
      case ParameterType.LOOKUP_LISTBOX:
        return FormFieldType.MULTI_SELECT
      case ParameterType.TEXT_EDIT:
        return FormFieldType.TEXTAREA
      case ParameterType.BOOLEAN:
        return FormFieldType.CHECKBOX
      case ParameterType.INTEGER:
      case ParameterType.FLOAT:
        return FormFieldType.NUMBER
      case ParameterType.PASSWORD:
        return FormFieldType.PASSWORD
      case ParameterType.FILE_OR_URL:
      case ParameterType.FILENAME:
      case ParameterType.FILENAME_MUSTEXIST:
        return FormFieldType.FILE
      default:
        return FormFieldType.TEXT
    }
  }

  // Generate title ID for translation
  private generateTitleId(workspaceName: string): string {
    return `${workspaceName.toLowerCase().replace(/\W+/g, "_")}_title`
  }

  // Generate subtitle ID for translation
  private generateSubtitleId(workspaceName: string): string {
    return `${workspaceName.toLowerCase().replace(/\W+/g, "_")}_subtitle`
  }

  // Validate form values against parameter definitions
  validateFormValues(
    formValues: { [key: string]: any },
    parameters: readonly WorkspaceParameter[]
  ): FormValidationResult {
    const errors: { [field: string]: string } = {}
    let isValid = true

    for (const param of parameters) {
      const value = formValues[param.name]

      // Check required fields
      if (
        !param.optional &&
        (value === undefined || value === null || value === "")
      ) {
        errors[param.name] = `${param.description || param.name} is required`
        isValid = false
        continue
      }

      // Type-specific validation
      if (value !== undefined && value !== null && value !== "") {
        const typeError = this.validateParameterType(value, param)
        if (typeError) {
          errors[param.name] = typeError
          isValid = false
        }
      }
    }

    return { isValid, errors }
  }

  // Validate individual parameter value against its type
  private validateParameterType(
    value: any,
    param: WorkspaceParameter
  ): string | null {
    switch (param.type) {
      case ParameterType.INTEGER:
        if (!Number.isInteger(Number(value))) {
          return `${param.description || param.name} must be an integer`
        }
        break
      case ParameterType.FLOAT:
        if (isNaN(Number(value))) {
          return `${param.description || param.name} must be a number`
        }
        break
      case ParameterType.BOOLEAN:
        if (typeof value !== "boolean") {
          return `${param.description || param.name} must be true or false`
        }
        break
      case ParameterType.CHOICE:
      case ParameterType.LOOKUP_CHOICE:
      case ParameterType.STRING_OR_CHOICE:
        if (
          param.listOptions &&
          !param.listOptions.some((opt) => opt.value === value)
        ) {
          return `${param.description || param.name} must be one of the available options`
        }
        break
      default:
        // Handle other parameter types (TEXT, LISTBOX, FILENAME, etc.)
        // For most text-based parameters, basic validation is sufficient
        if (
          param.type === ParameterType.TEXT ||
          param.type === ParameterType.LISTBOX ||
          param.type === ParameterType.FILENAME ||
          param.type === ParameterType.FILENAME_MUSTEXIST ||
          param.type === ParameterType.FOLDER ||
          param.type === ParameterType.PASSWORD ||
          param.type === ParameterType.COORDINATE_SYSTEM ||
          param.type === ParameterType.RANGE ||
          param.type === ParameterType.LOOKUP_LISTBOX ||
          param.type === ParameterType.STRING_OR_ATTR_LIST ||
          param.type === ParameterType.ATTR_LIST ||
          param.type === ParameterType.FEATURE_TYPE_LIST ||
          param.type === ParameterType.GEOMETRY ||
          param.type === ParameterType.FILE_OR_URL ||
          param.type === ParameterType.TEXT_EDIT
        ) {
          // Basic validation - most parameter types accept string values
          if (
            value !== null &&
            value !== undefined &&
            typeof value !== "string" &&
            typeof value !== "number"
          ) {
            return `${param.description || param.name} must be a valid value`
          }
        }
        break
    }
    return null
  }
}

// Dynamic form configuration types
export interface DynamicFormConfig {
  readonly workspaceName: string
  readonly titleId: string
  readonly subtitleId: string
  readonly fields: readonly DynamicFieldConfig[]
  readonly requiredFields: readonly string[]
}

export interface DynamicFieldConfig {
  readonly field: string
  readonly labelId: string
  readonly required: boolean
  readonly type: FormFieldType
  readonly defaultValue?: any
  readonly options?: ReadonlyArray<{ value: string; label: string }>
  readonly helperId?: string
  readonly readOnly?: boolean
}

export enum FormFieldType {
  TEXT = "text",
  TEXTAREA = "textarea",
  SELECT = "select",
  MULTI_SELECT = "multi_select",
  CHECKBOX = "checkbox",
  NUMBER = "number",
  PASSWORD = "password",
  FILE = "file",
}

export interface FormValidationResult {
  readonly isValid: boolean
  readonly errors: { [field: string]: string }
}
