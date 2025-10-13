import "@testing-library/jest-dom"
import { fmeQueryClient } from "../shared/query-client"

describe("shared query client", () => {
  it("sets conservative defaults for refetch behaviour", () => {
    const options = fmeQueryClient.getDefaultOptions()
    expect(options.queries?.refetchOnReconnect).toBe(false)
    expect(options.queries?.refetchOnWindowFocus).toBe(false)
    expect(options.queries?.staleTime).toBe(5 * 60 * 1000)
    expect(options.queries?.gcTime).toBe(10 * 60 * 1000)
  })

  it("retries only retryable failures up to three times", () => {
    const retry = fmeQueryClient.getDefaultOptions().queries?.retry
    expect(typeof retry).toBe("function")

    const retryFn = retry as (failureCount: number, error: any) => boolean

    expect(retryFn(0, { status: 503 })).toBe(true)
    expect(retryFn(2, { status: 500 })).toBe(true)
    expect(retryFn(3, { status: 500 })).toBe(false)
    expect(retryFn(0, { status: 401 })).toBe(false)
    expect(retryFn(0, { status: 404 })).toBe(false)
    expect(retryFn(0, new Error("network"))).toBe(true)
  })
})
