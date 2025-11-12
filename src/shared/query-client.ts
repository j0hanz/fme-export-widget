import { QueryClient } from "@tanstack/react-query";
import {
  HTTP_STATUS_CODES,
  HTTP_STATUS_RANGES,
  TIME_CONSTANTS,
} from "../config/constants";

// Konfigurerad QueryClient med caching och retry-logik
export const fmeQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: TIME_CONSTANTS.FIVE_MINUTES, // Data betraktas som färsk i 5 min
      gcTime: TIME_CONSTANTS.TEN_MINUTES, // Garbage collection efter 10 min
      retry: (failureCount, error: any) => {
        const status = error?.status || error?.response?.status;
        // Retry inte för autentiseringsfel (401, 403)
        if (
          status === HTTP_STATUS_CODES.UNAUTHORIZED ||
          status === HTTP_STATUS_CODES.FORBIDDEN
        )
          return false;
        // Retry inte för klientfel (400-499)
        if (
          status &&
          status >= HTTP_STATUS_RANGES.CLIENT_ERROR_MIN &&
          status < HTTP_STATUS_RANGES.SERVER_ERROR_MIN
        )
          return false;
        // Retry serverfel (500+) och nätverksfel upp till 3 gånger
        return failureCount < 3;
      },
      refetchOnWindowFocus: false, // Ingen auto-refetch vid window focus
      refetchOnReconnect: false, // Ingen auto-refetch vid reconnect
    },
  },
});
