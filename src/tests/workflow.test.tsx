import "@testing-library/jest-dom"
import { screen } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal, mockTheme, widgetRender } from "jimu-for-test"
import { QueryClientProvider } from "@tanstack/react-query"
import { fmeQueryClient } from "../shared/query-client"
import { ViewMode } from "../config"
import type { WorkspaceItem } from "../config"
import { Workflow } from "../runtime/components/workflow"
import * as sharedHooks from "../shared/hooks"

initGlobal()

const baseRender = widgetRender(true, mockTheme as any)

// Wrapper som inkluderar QueryClientProvider för React Query hooks
const renderWithStoreThemeIntl = (ui: React.ReactElement) =>
  baseRender(
    <QueryClientProvider client={fmeQueryClient}>{ui}</QueryClientProvider>
  )

const baseLoadingState = Object.freeze({
  modules: false,
  submission: false,
  workspaces: false,
  parameters: false,
})

describe("Workflow workspace view", () => {
  let useDebounceSpy: jest.SpyInstance
  let useWorkspacesSpy: jest.SpyInstance
  let useWorkspaceItemSpy: jest.SpyInstance

  beforeEach(() => {
    useDebounceSpy = jest
      .spyOn(sharedHooks, "useDebounce")
      .mockImplementation((callback: any) => {
        const fn: any = (...args: any[]) => callback(...args)
        fn.cancel = jest.fn()
        fn.flush = jest.fn()
        fn.isPending = jest.fn(() => false)
        return fn
      })
    useWorkspacesSpy = jest
      .spyOn(sharedHooks, "useWorkspaces")
      .mockReturnValue({
        data: [],
        isLoading: false,
        isFetching: false,
        isError: false,
        error: undefined,
        refetch: jest.fn(),
        isFetched: true,
      } as any)
    useWorkspaceItemSpy = jest
      .spyOn(sharedHooks, "useWorkspaceItem")
      .mockReturnValue({
        data: null,
        isError: false,
        error: undefined,
        isFetching: false,
      } as any)
  })

  afterEach(() => {
    useDebounceSpy.mockRestore()
    useWorkspacesSpy.mockRestore()
    useWorkspaceItemSpy.mockRestore()
  })

  it("shows empty state after a completed zero-result fetch", () => {
    renderWithStoreThemeIntl(
      <Workflow
        widgetId="w1"
        state={ViewMode.WORKSPACE_SELECTION}
        workspaceItems={[]}
        loadingState={baseLoadingState}
        isPrefetchingWorkspaces={false}
        workspacePrefetchStatus="idle"
        workspacePrefetchProgress={null}
        onBack={jest.fn()}
        onReset={jest.fn()}
        config={
          {
            fmeServerUrl: "https://example.com",
            fmeServerToken: "token",
            repository: "Repo",
          } as any
        }
      />
    )

    expect(
      screen.getByText("Inga arbetsytor hittades i detta repository")
    ).toBeInTheDocument()
  })

  it("keeps workspaces visible while background prefetch runs", () => {
    const workspace: WorkspaceItem = {
      name: "Demo",
      title: "Demo Arbetsyta",
      type: "WORKSPACE",
    }

    useWorkspacesSpy.mockReturnValue({
      data: [workspace],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: undefined,
      refetch: jest.fn(),
      isFetched: true,
    } as any)

    renderWithStoreThemeIntl(
      <Workflow
        widgetId="w2"
        state={ViewMode.WORKSPACE_SELECTION}
        workspaceItems={[workspace]}
        loadingState={baseLoadingState}
        isPrefetchingWorkspaces={true}
        workspacePrefetchStatus="loading"
        workspacePrefetchProgress={{ loaded: 1, total: 3 }}
        onBack={jest.fn()}
        onReset={jest.fn()}
        config={
          {
            fmeServerUrl: "https://example.com",
            fmeServerToken: "token",
            repository: "Repo",
          } as any
        }
      />
    )

    expect(screen.getByRole("button", { name: "Demo Arbetsyta" })).toBeVisible()
  })
})

describe("Workflow order result view", () => {
  const baseConfig = {
    fmeServerUrl: "https://example.com",
    fmeServerToken: "token",
    repository: "Repo",
  } as const

  const renderOrderResult = (orderResult: any) =>
    renderWithStoreThemeIntl(
      <Workflow
        widgetId="w-order"
        state={ViewMode.ORDER_RESULT}
        orderResult={orderResult}
        loadingState={baseLoadingState}
        isPrefetchingWorkspaces={false}
        workspacePrefetchStatus="idle"
        workspacePrefetchProgress={null}
        onBack={jest.fn()}
        onReset={jest.fn()}
        onReuseGeography={jest.fn()}
        config={baseConfig as any}
      />
    )

  it("renders success state with download link", () => {
    renderOrderResult({
      success: true,
      cancelled: false,
      workspaceName: "TestWorkspace",
      jobId: 123,
      downloadUrl: "https://example.com/file.zip",
      downloadFilename: "file.zip",
      serviceMode: "sync",
    })

    expect(screen.getByText("Exporten är klar")).toBeVisible()
    expect(screen.getByRole("link", { name: "Ladda ner" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Ny beställning" })).toBeVisible()
  })

  it("renders failure state with retry action", () => {
    renderOrderResult({
      success: false,
      cancelled: false,
      workspaceName: "TestWorkspace",
      jobId: 200,
      code: "FME_JOB_FAILURE",
      status: "FAILURE",
      message: "Job failed",
    })

    expect(screen.getByText("Beställningen misslyckades")).toBeVisible()
    expect(
      screen.getByText(
        "FME Flow-transformationen misslyckades. Kontrollera loggfilen ovan för detaljer."
      )
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Försök igen" })).toBeVisible()
    expect(screen.getByText(/Felkod: FME_JOB_FAILURE/)).toBeVisible()
  })

  it("renders cancelled state with new order action", () => {
    renderOrderResult({
      success: false,
      cancelled: true,
      workspaceName: "TestWorkspace",
      jobId: 300,
      code: "FME_JOB_CANCELLED",
    })

    expect(screen.getByText("Beställning avbruten")).toBeVisible()
    expect(
      screen.getByText("Beställningen avbröts innan den slutfördes.")
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Skapa ny beställning" })
    ).toBeVisible()
    expect(screen.queryByText(/Felkod:/)).toBeNull()
  })

  it("shows timeout specific messaging for cancelled jobs", () => {
    renderOrderResult({
      success: false,
      cancelled: true,
      workspaceName: "TestWorkspace",
      jobId: 301,
      code: "FME_JOB_CANCELLED_TIMEOUT",
    })

    expect(
      screen.getByText(
        "Beställningen avbröts på grund av tidsgräns. Arbetsytan tog för lång tid att köra."
      )
    ).toBeVisible()
  })
})
