import { React } from "jimu-core"
import { screen, fireEvent, within } from "@testing-library/react"
import "@testing-library/jest-dom"
import {
  initExtensions,
  initStore,
  widgetRender,
  setTheme,
  mockTheme,
  waitForMilliseconds,
  runFuncAsync,
  withStoreThemeIntlRender,
} from "jimu-for-test"
import Button, {
  Icon,
  Tooltip,
  Input,
  TextArea,
  Select,
  StateView,
  ButtonGroup,
  ButtonTabs,
} from "../runtime/components/ui"
import { makeErrorView } from "../shared/types"

describe("UI components", () => {
  const renderWithProviders = widgetRender(true)

  beforeAll(() => {
    initExtensions()
    initStore()
    setTheme(mockTheme)
  })

  test("Icon renders SVG and Tooltip behavior", () => {
    // Icon renders inline SVG
    const { container } = renderWithProviders(
      <Icon src="/mock.svg" ariaLabel="Map" />
    )
    expect(container.querySelector("svg")).toBeTruthy()

    // Tooltip adds aria-describedby when content exists
    renderWithProviders(
      <Tooltip content="Help text">
        <button aria-label="Do it">Click</button>
      </Tooltip>
    )
    const btnWithTooltip = screen.getByRole("button", { name: /Do it/i })
    expect(btnWithTooltip.getAttribute("aria-describedby")).toBeTruthy()

    // Tooltip returns bare child when no content
    renderWithProviders(
      <Tooltip>
        <button>Plain</button>
      </Tooltip>
    )
    const plainBtn = screen.getByRole("button", { name: /Plain/i })
    expect(plainBtn.getAttribute("aria-describedby")).toBeNull()

    // Tooltip wraps disabled child in span for accessibility
    const tooltipContainer = renderWithProviders(
      <Tooltip content="info">
        <button aria-label="Disabled child" disabled>
          X
        </button>
      </Tooltip>
    ).container
    const span = tooltipContainer.querySelector("span")
    expect(span).toBeTruthy()
    const disabledBtn = within(span as HTMLElement).getByRole("button", {
      name: /Disabled child/i,
    })
    expect(disabledBtn).toBeTruthy()
  })

  test("Input and TextArea accessibility and interaction", async () => {
    // Input sets aria attributes and emits onChange
    const inputChange = jest.fn()
    renderWithProviders(
      <Input
        required
        validationMessage="Only numbers"
        pattern={/^\d+$/}
        defaultValue="abc"
        onChange={inputChange}
      />
    )
    const input = screen.getByRole("textbox")
    expect(input.getAttribute("aria-required")).toBe("true")
    expect(input.getAttribute("title")).toBe("Only numbers")
    expect(input.getAttribute("aria-describedby")).toBeTruthy()

    fireEvent.change(input, { target: { value: "123" } })
    // Flush microtasks from jimu‑ui input
    await waitForMilliseconds(0)
    expect(inputChange).toHaveBeenCalledWith("123")

    // TextArea sets aria-invalid when errorText present
    const textAreaChange = jest.fn()
    renderWithProviders(
      <TextArea
        required
        errorText="Err"
        defaultValue="hi"
        onChange={textAreaChange}
      />
    )
    const textArea = screen.getAllByRole("textbox")[1] // Second textbox after input
    expect(textArea.getAttribute("aria-required")).toBe("true")
    expect(textArea.getAttribute("aria-describedby")).toBeTruthy()

    fireEvent.change(textArea, { target: { value: "hello" } })
    // Flush microtasks from TextArea change
    await waitForMilliseconds(0)
    expect(textAreaChange).toHaveBeenCalledWith("hello")
  })

  test("Select single and multi-select behavior", async () => {
    const onChange = jest.fn()
    const options = [
      { label: "Alpha", value: "a" },
      { label: "Beta", value: "b" },
      { label: "Gamma", value: "c" },
    ]

    // Single select shows selected option
    renderWithProviders(
      <Select
        options={options}
        defaultValue="b"
        onChange={onChange}
        placeholder="Pick"
      />
    )
    const singleSelect = screen.getByRole("combobox")
    within(singleSelect).getByText(/Beta/i)
    renderWithProviders(
      <Select options={options} defaultValue={["a", "c"]} value={["a", "c"]} />
    )
    await waitForMilliseconds(0)
    // Expect both selected option labels to appear somewhere in the DOM
    expect(screen.getByText(/Alpha/i)).toBeInTheDocument()
    expect(screen.getByText(/Gamma/i)).toBeInTheDocument()
  })

  test("StateView renders loading and error roles appropriately", async () => {
    const { rerender } = renderWithProviders(
      <StateView state={{ kind: "loading", message: "Loading" } as any} />
    )
    expect(screen.getByRole("status")).toBeTruthy()

    const onAction = jest.fn()
    rerender(
      <StateView
        state={makeErrorView("Oops", {
          code: "ERR",
          actions: [{ label: "Retry", onClick: onAction }],
        })}
      />
    )
    const alert = screen.getByRole("alert")
    expect(alert).toBeTruthy()
    const btn = screen.getByRole("button")
    fireEvent.click(btn)
    // Flush microtasks for onClick
    await waitForMilliseconds(0)
    expect(onAction).toHaveBeenCalled()
  })

  test("Button interactions and accessibility patterns", async () => {
    // Disabled button prevents onClick and sets aria-disabled
    const onClick = jest.fn()
    renderWithProviders(<Button text="Do" onClick={onClick} disabled />)
    const disabledBtn = screen.getByRole("button", { name: /Do/i })
    fireEvent.click(disabledBtn)
    await waitForMilliseconds(0)
    expect(onClick).not.toHaveBeenCalled()
    expect(disabledBtn.getAttribute("aria-disabled")).toBe("true")

    // Loading button prevents onClick
    const onClick2 = jest.fn()
    renderWithProviders(<Button text="Load" onClick={onClick2} loading />)
    const loadingBtn = screen.getByRole("button", { name: /Load/i })
    fireEvent.click(loadingBtn)
    await waitForMilliseconds(0)
    expect(onClick2).not.toHaveBeenCalled()

    // Tooltip provides accessible label for icon-only button
    renderWithProviders(<Button icon="/x.svg" tooltip="Hello" />)
    // Delay to allow tooltip aria-label injection
    await waitForMilliseconds(0)
    screen.getByRole("button", { name: /Hello/i })
  })

  test("ButtonGroup and ButtonTabs interaction handling", async () => {
    // ButtonGroup handles left/right clicks
    const onLeft = jest.fn()
    const onRight = jest.fn()
    renderWithProviders(
      <ButtonGroup
        leftButton={{ text: "Back", onClick: onLeft }}
        rightButton={{ text: "Next", onClick: onRight }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Back/i }))
    fireEvent.click(screen.getByRole("button", { name: /Next/i }))
    await waitForMilliseconds(0)
    expect(onLeft).toHaveBeenCalled()
    expect(onRight).toHaveBeenCalled()

    // ButtonTabs emits onChange and onTabChange
    const onChange = jest.fn()
    const onTabChange = jest.fn()
    const items = [
      { label: "One", value: "1" },
      { label: "Two", value: "2" },
    ]
    renderWithProviders(
      <ButtonTabs
        items={items as any}
        defaultValue="1"
        onChange={onChange as any}
        onTabChange={onTabChange as any}
      />
    )
    fireEvent.click(screen.getByRole("radio", { name: /Two/i }))
    await waitForMilliseconds(0)
    expect(onChange).toHaveBeenCalledWith("2")
    expect(onTabChange).toHaveBeenCalled()
  })

  test("Select aria-describedby passthrough (single and multi)", async () => {
    const renderWithProviders = widgetRender(true)
    const options = [
      { label: "One", value: "1" },
      { label: "Two", value: "2" },
    ]

    // Single-select should preserve provided aria-describedby
    renderWithProviders(
      <Select options={options} defaultValue="1" ariaDescribedBy="s-help" />
    )
    const combo = screen.getByRole("combobox")
    await waitForMilliseconds(0)
    expect(combo.getAttribute("aria-describedby")).toBe("s-help")
    renderWithProviders(
      <Select
        options={options}
        defaultValue={["1"]}
        value={["1"]}
        ariaDescribedBy="m-help"
      />
    )
    await waitForMilliseconds(0)
    const elWithDescribedBy = document.querySelector(
      '[aria-describedby="m-help"]'
    )
    expect(elWithDescribedBy).toBeTruthy()
  })

  test("Select multi-select applies style to native select", async () => {
    const renderWithProviders = widgetRender(true)
    const options = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ]
    renderWithProviders(
      <Select
        options={options}
        defaultValue={["a"]}
        value={["a"]}
        style={{ width: 321 }}
      />
    )
    await waitForMilliseconds(0)
    const selectEl = screen.queryByRole("listbox")
    if (selectEl) {
      expect((selectEl as HTMLSelectElement).style.width).toBe("321px")
    } else {
      const styled = Array.from(
        document.querySelectorAll<HTMLElement>("[style]")
      ).find((el) => {
        const attr = el.getAttribute("style") || ""
        return el.style.width === "321px" || /width\s*:\s*321(?:px)?/.test(attr)
      })
      expect(styled).toBeTruthy()
    }
  })

  // Example: advanced helpers for async flows and store injection
  test("withStoreThemeIntlRender and runFuncAsync can be used for custom renders", async () => {
    const renderWithProviders = withStoreThemeIntlRender()
    const { getByRole } = renderWithProviders(<Button text="Click me" />)
    fireEvent.click(getByRole("button", { name: /Click me/i }))
    // runFuncAsync flushes microtasks when awaited
    const flush = runFuncAsync(0)
    // Execute a callback to allow queued timers to complete
    await flush(() => {
      // Allow any pending state updates to process
      return Promise.resolve()
    }, [])
    expect(getByRole("button", { name: /Click me/i })).toBeInTheDocument()
  })
})
