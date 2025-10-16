import { QueryClient } from "@tanstack/react-query"

// Konfigurerad QueryClient med caching och retry-logik
export const fmeQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // Data betraktas som färsk i 5 min
      gcTime: 10 * 60 * 1000, // Garbage collection efter 10 min
      retry: (failureCount, error: any) => {
        const status = error?.status || error?.response?.status
        // Retry inte för autentiseringsfel (401, 403)
        if (status === 401 || status === 403) return false
        // Retry inte för klientfel (400-499)
        if (status && status >= 400 && status < 500) return false
        // Retry serverfel (500+) och nätverksfel upp till 3 gånger
        return failureCount < 3
      },
      refetchOnWindowFocus: false, // Ingen auto-refetch vid window focus
      refetchOnReconnect: false, // Ingen auto-refetch vid reconnect
    },
  },
})
