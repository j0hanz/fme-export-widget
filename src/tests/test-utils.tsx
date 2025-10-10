import { React, ReactRedux } from "jimu-core"
import type { ReactNode } from "react"
import { IntlProvider } from "react-intl"
import type { Store } from "redux"

const { Provider } = ReactRedux

export const createTestWrapper = (store: Store) => {
  const Wrapper: React.FC<{ children?: ReactNode }> = ({ children }) => (
    <Provider store={store}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </Provider>
  )
  return Wrapper
}
