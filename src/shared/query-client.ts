import { QueryClient } from "@tanstack/react-query"

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
