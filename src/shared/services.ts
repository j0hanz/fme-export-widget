import type {
  RealTimeMeasurements,
  FmeExportConfig,
  AreaTemplate,
  ErrorState,
  FmeWidgetState,
} from "./types"
import { ErrorType, ErrorSeverity, FmeActionType } from "./types"

// Import esriRequest for making HTTP requests with built-in ArcGIS support.  Using esriRequest enables automatic
// GET-to-POST switching based on URL length, consistent parameter encoding and abort signal handling.
import esriRequest from "esri/request"
import { getAppStore, AppStateManager } from "jimu-core"
import { validateTemplateImport } from "./utils"
import { fmeActions } from "../extensions/store"

// Constants
const USER_EMAIL = {
  DEFAULT_DOMAIN: "@lund.se",
  FALLBACK: "kartor@lund.se",
} as const

const API_CONFIG = {
  HEADERS: {
    "Content-Type": "application/json",
  },
  METHODS: {
    GET: "GET" as const,
    POST: "POST" as const,
    PUT: "PUT" as const,
    DELETE: "DELETE" as const,
  },
} as const

const USER_DATA_FIELDS = {
  EMAIL: ["mail", "email"],
  USERNAME: ["username", "user", "name"],
} as const

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

// Private cache for user email lookups
const emailCache = new Map<string, { email: string; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes cache

// Fetch user email from API based on username
async function fetchUserEmailFromApi(
  username: string,
  apiUrl: string
): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, 5000)

  try {
    // Use esriRequest to perform the API call.  esriRequest automatically adds f=json,
    // handles URL encoding and supports AbortSignal cancellation.  We specify
    // responseType: "json" to get parsed JSON data.
    const request = esriRequest(`${apiUrl}/user/${username}`, {
      responseType: "json",
      signal: controller.signal,
      headers: API_CONFIG.HEADERS,
    })
    const response = await request

    clearTimeout(timeoutId)

    // esriRequest returns an object with a `data` property containing the parsed JSON.
    const userData: any = response.data
    if (userData) {
      // Enhanced field checking with priority order
      for (const field of USER_DATA_FIELDS.EMAIL) {
        const emailValue = userData[field]
        if (
          emailValue &&
          typeof emailValue === "string" &&
          emailValue.includes("@")
        ) {
          return emailValue
        }
      }
    }
    return null
  } catch (error) {
    clearTimeout(timeoutId)
    // esriRequest will throw a generic Error on abort or network error.  Check error.name for AbortError.
    if (error.name === "AbortError") {
      console.warn("API request timed out")
    } else {
      console.warn("Failed to fetch user email from API:", error)
    }
    return null
  }
}

// Public function to get user email
export async function getUserEmail(config?: FmeExportConfig): Promise<string> {
  try {
    const appStore = getAppStore()
    const user = appStore.getState().user

    // Primary: Direct email from user state
    if (user?.email) {
      return user.email
    }

    // Secondary: Check username-based resolution
    if (user?.username) {
      const username = user.username.split("@")[0]
      const cacheKey = `${username}-${config?.api || "default"}`

      // Check cache first
      const cached = emailCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.email
      }

      // API-based email resolution with improved error handling
      const apiUrl = config?.api
      if (apiUrl && username) {
        try {
          const email = await fetchUserEmailFromApi(username, apiUrl)
          if (email) {
            // Cache successful result
            emailCache.set(cacheKey, { email, timestamp: Date.now() })
            return email
          }
        } catch (apiError) {
          console.warn("API email fetch failed, using fallback:", apiError)
        }
      }

      // Construct from username with domain
      if (username) {
        const constructedEmail = `${username}${USER_EMAIL.DEFAULT_DOMAIN}`
        // Cache constructed email
        emailCache.set(cacheKey, {
          email: constructedEmail,
          timestamp: Date.now(),
        })
        return constructedEmail
      }
    }

    return USER_EMAIL.FALLBACK
  } catch (error) {
    console.warn("Failed to get user email:", error)
    return USER_EMAIL.FALLBACK
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
        console.warn(
          "Local state persistence not supported in this environment"
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

      if (widgetState.activeExportType) {
        dispatch({
          type: FmeActionType.SET_ACTIVE_EXPORT_TYPE,
          exportType: widgetState.activeExportType,
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
        state.activeExportType !== null ||
        Object.keys(state.formValues).length > 0

      if (shouldSave) {
        const stateToSave = {
          viewMode: state.viewMode,
          geometryJson: state.geometryJson,
          drawnArea: state.drawnArea,
          templateName: state.templateName,
          activeExportType: state.activeExportType,
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
