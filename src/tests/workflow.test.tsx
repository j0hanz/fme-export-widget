import "@testing-library/jest-dom"
import { screen } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal, mockTheme, widgetRender } from "jimu-for-test"
import { ViewMode } from "../config"
import type { WorkspaceItem } from "../config"
import { Workflow } from "../runtime/components/workflow"
import * as sharedHooks from "../shared/hooks"

initGlobal()

const renderWithStoreThemeIntl = widgetRender(true, mockTheme as any)

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
