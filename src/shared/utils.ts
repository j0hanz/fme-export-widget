import type { IMState } from "jimu-core"
import type { FmeWidgetState } from "./types"
import { StateType } from "./types"

// Format area utility function
export function formatArea(area: number): string {
  if (!area || isNaN(area) || area <= 0) return "0 m²"

  // Define thresholds and conversion factors
  const AREA_THRESHOLD_SQKM = 1000000
  const AREA_CONVERSION_FACTOR = 1000000
  const AREA_DECIMAL_PLACES = 2

  if (area >= AREA_THRESHOLD_SQKM) {
    const areaInSqKm = area / AREA_CONVERSION_FACTOR
    const formattedKmNumber = new Intl.NumberFormat("sv-SE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: AREA_DECIMAL_PLACES,
    }).format(areaInSqKm)
    return `${formattedKmNumber} km²`
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
  if (!maxArea) return { isValid: true }
  if (area > maxArea) {
    return {
      isValid: false,
      message: `Area (${formatArea(area)}) exceeds maximum allowed size (${formatArea(maxArea)})`,
    }
  }
  return { isValid: true }
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
