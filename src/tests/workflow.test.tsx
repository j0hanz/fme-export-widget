import type { ReactNode } from "react"
import { React } from "jimu-core"
import { createStore } from "redux"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Workflow from "../runtime/components/workflow"
import { ViewMode, ParameterType } from "../config/enums"
import type {
  WorkspaceItem,
  WorkspaceItemDetail,
  WorkspaceParameter,
} from "../config/types"
import { createTestWrapper } from "./test-utils"

jest.mock("../shared/hooks", () => {
  const actual = jest.requireActual("../shared/hooks")
  return {
    ...actual,
    useWorkspaces: jest.fn(),
    useWorkspaceItem: jest.fn(),
  }
})

jest.mock("../runtime/components/ui.tsx", () => {
  const ActualReact = require("react") as typeof React
  const Button = ActualReact.forwardRef<HTMLButtonElement, any>(
    (
      {
        text,
        children,
        onClick,
      }: { text?: string; children?: ReactNode; onClick?: () => void },
      ref
    ) => (
      <button type="button" ref={ref} onClick={onClick}>
        {text ?? children ?? null}
      </button>
    )
  )
  Button.displayName = "MockButton"

  const Container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  )

  return {
    Button,
    ButtonGroup: Container,
    StateView: ({ state }: { state?: { message?: ReactNode } }) => (
      <div data-testid="state-view">{state?.message ?? null}</div>
    ),
    Form: ({ children }: { children?: ReactNode }) => <form>{children}</form>,
    Field: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ButtonTabs: Container,
    Alert: () => <div role="alert" />,
    renderSupportHint: () => null,
    ScheduleFields: () => null,
    UrlInput: () => null,
  }
})

jest.mock("../config/index", () => {
  const actual = jest.requireActual("../config/index")
  return {
    ...actual,
    useUiStyles: () => ({
      parent: {},
      header: {},
      content: {},
      centered: {},
      selection: { container: {} },
      btn: { group: {} },
      headerAlert: {},
      typo: { instruction: {}, caption: {}, title: {}, detail: {} },
    }),
  }
})

const hooksModule = require("../shared/hooks") as {
  useWorkspaces: jest.Mock
  useWorkspaceItem: jest.Mock
}

const workspaceItems: WorkspaceItem[] = [
  {
    name: "site-boundaries",
    title: "Site Boundaries",
    type: "WORKSPACE",
  },
]

const workspaceParameters: WorkspaceParameter[] = [
  {
    name: "PARAM_A",
    type: ParameterType.TEXT,
    optional: false,
  },
]

const workspaceDetail: WorkspaceItemDetail = {
  name: "site-boundaries",
  title: "Site Boundaries",
  type: "WORKSPACE",
  parameters: workspaceParameters,
}

const cachedWorkspacePayload = {
  parameters: workspaceParameters,
  item: workspaceDetail,
}

const refetchWorkspaces = jest.fn(() => Promise.resolve())
const refetchWorkspaceItem = jest.fn(() => Promise.resolve())

describe("Workflow workspace selection", () => {
  beforeEach(() => {
    refetchWorkspaces.mockClear()
    refetchWorkspaceItem.mockClear()

    hooksModule.useWorkspaces.mockImplementation(() => ({
      data: workspaceItems,
      isFetching: false,
      isError: false,
      refetch: refetchWorkspaces,
    }))

    hooksModule.useWorkspaceItem.mockImplementation(
      (
        workspaceName?: string,
        _config?: { repository?: string },
        _options?: { enabled?: boolean }
      ) => ({
        data: workspaceName ? cachedWorkspacePayload : null,
        isFetching: false,
        isError: false,
        refetch: refetchWorkspaceItem,
      })
    )
  })

  it("invokes onWorkspaceSelected even when workspace details are cached", async () => {
    const onWorkspaceSelected = jest.fn()
    const user = userEvent.setup()
    const handleBack = jest.fn()
    const store = createStore((state = {}) => state)

    const Wrapper = createTestWrapper(store)

    render(
      <Workflow
        widgetId="widget-1"
        state={ViewMode.WORKSPACE_SELECTION}
        config={{
          fmeServerUrl: "https://example.com",
          fmeServerToken: "token",
          repository: "Data",
        }}
        workspaceItems={workspaceItems}
        selectedWorkspace={null}
        workspaceParameters={[]}
        onWorkspaceSelected={onWorkspaceSelected}
        onBack={handleBack}
        instructionText=""
        drawnArea={0}
        areaWarning={false}
        formatArea={() => ""}
      />,
      { wrapper: Wrapper }
    )

    const workspaceButton = await screen.findByRole("button", {
      name: "Site Boundaries",
    })

    await user.click(workspaceButton)

    await waitFor(() => {
      expect(onWorkspaceSelected).toHaveBeenCalledTimes(1)
    })

    onWorkspaceSelected.mockClear()

    await user.click(workspaceButton)

    await waitFor(() => {
      expect(onWorkspaceSelected).toHaveBeenCalledTimes(1)
    })
  })
})
