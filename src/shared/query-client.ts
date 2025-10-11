/**
 * Shared React Query client for FME Export widget.
 *
 * This singleton QueryClient is used by BOTH the runtime widget and settings panel
 * to enable cache sharing and automatic request deduplication across components.
 *
 * Benefits:
 * - Prevents duplicate API calls when both runtime and settings are mounted
 * - Shares cached data (repositories, health checks, workspace details)
 * - Automatic request deduplication when same query runs simultaneously
 * - Consistent retry/staleTime behavior across widget
 */
import { QueryClient } from "@tanstack/react-query"

/**
 * Shared QueryClient singleton for FME Flow API queries.
 *
 * Configuration:
 * - staleTime: 5 minutes - data considered fresh for 5 mins
 * - gcTime: 10 minutes - unused data garbage collected after 10 mins
 * - retry: Smart retry logic (no retry for 4xx errors)
 * - refetchOnWindowFocus: false - don't refetch when user returns to tab
 * - refetchOnReconnect: false - don't refetch on network reconnect
 */
export const fmeQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      retry: (failureCount, error: any) => {
        const status = error?.status || error?.response?.status
        // Don't retry authentication/authorization errors
        if (status === 401 || status === 403) return false
        // Don't retry client errors (400-499)
        if (status && status >= 400 && status < 500) return false
        // Retry server errors (500+) and network errors up to 3 times
        return failureCount < 3
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})
