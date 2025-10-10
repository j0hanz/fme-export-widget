import { React } from "jimu-core"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  fmeQueryCache,
  fmeQueryClient,
  useFmeQuery,
  useFmeMutation,
} from "../shared/query"
import type { QueryOptions } from "../config/types"

describe("FME query system", () => {
  beforeEach(() => {
    fmeQueryCache.clear()
  })

  it("stores cached data and notifies subscribers", () => {
    const key = ["cache", "test"] as const
    let notified = 0

    const unsubscribe = fmeQueryCache.subscribe(key, () => {
      notified += 1
    })

    fmeQueryCache.set(key, { status: "loading" })
    fmeQueryCache.notify(key)

    const entry = fmeQueryCache.get<string>(key)
    expect(entry?.status).toBe("loading")
    expect(notified).toBeGreaterThan(0)

    unsubscribe()
  })

  it("deduplicates concurrent fetches", async () => {
    let callCount = 0
    const options: QueryOptions<string> = {
      queryKey: ["dedupe", "workspaces"],
      queryFn: async () => {
        callCount += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return "payload"
      },
    }

    const [first, second] = await Promise.all([
      fmeQueryClient.fetchQuery(options),
      fmeQueryClient.fetchQuery(options),
    ])

    expect(first).toBe("payload")
    expect(second).toBe("payload")
    expect(callCount).toBe(1)
  })

  it("provides hook state updates for useFmeQuery", async () => {
    const queryFn = jest.fn(() => Promise.resolve("result"))

    const TestComponent = () => {
      const result = useFmeQuery({
        queryKey: ["hook-test"],
        queryFn,
      })

      return (
        <div>
          <div data-testid="status">{result.status}</div>
          <div data-testid="data">{result.data ?? ""}</div>
        </div>
      )
    }

    const { rerender } = render(<TestComponent />)

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("success")
    })
    expect(screen.getByTestId("data").textContent).toBe("result")
    expect(queryFn).toHaveBeenCalledTimes(1)

    rerender(<TestComponent />)

    await waitFor(() => {
      expect(screen.getByTestId("data").textContent).toBe("result")
    })
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it("supports useFmeMutation for async operations", async () => {
    const mutationFn = jest.fn(async (variables: { value: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return `${variables.value}-done`
    })

    const MutationComponent = () => {
      const mutation = useFmeMutation({
        mutationFn: async (variables: { value: string }) =>
          await mutationFn(variables),
      })

      return (
        <div>
          <div data-testid="mutation-status">{mutation.status}</div>
          <div data-testid="mutation-data">{mutation.data ?? ""}</div>
          <button
            type="button"
            onClick={() => {
              mutation.mutate({ value: "go" })
            }}
          >
            mutate
          </button>
        </div>
      )
    }

    render(<MutationComponent />)

    expect(screen.getByTestId("mutation-status").textContent).toBe("idle")

    await userEvent.click(screen.getByRole("button", { name: "mutate" }))

    await waitFor(() => {
      expect(screen.getByTestId("mutation-status").textContent).toBe("success")
    })
    expect(screen.getByTestId("mutation-data").textContent).toBe("go-done")
    expect(mutationFn).toHaveBeenCalledTimes(1)
  })
})
