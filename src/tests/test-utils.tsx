import { React, ReactRedux } from "jimu-core"
import type { ReactNode } from "react"
import { IntlProvider } from "react-intl"
import type { Store } from "redux"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const { Provider } = ReactRedux

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  })
}

export function createQueryWrapper(queryClient: QueryClient) {
  return ({ children }: { children?: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

export const createTestWrapper = (store: Store) => {
  const queryClient = createTestQueryClient()
  const Wrapper: React.FC<{ children?: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <IntlProvider locale="en" messages={{}}>
          {children}
        </IntlProvider>
      </Provider>
    </QueryClientProvider>
  )
  return Wrapper
}
