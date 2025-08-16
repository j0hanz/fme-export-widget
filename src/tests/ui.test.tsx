import { React } from "jimu-core"
import { screen, fireEvent, within } from "@testing-library/react"
import {
  initExtensions,
  initStore,
  widgetRender,
  setTheme,
  mockTheme,
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

describe("UI components", () => {
  const renderWithProviders = widgetRender(true)

  beforeAll(() => {
    initExtensions()
    initStore()
    setTheme(mockTheme)
  })

  test("Icon renders SVG and Tooltip behavior", () => {
    // Icon renders an SVG element
    const { container } = renderWithProviders(
      <Icon src="/mock.svg" ariaLabel="Map" />
    )
    expect(container.querySelector("svg")).toBeTruthy()

    // Tooltip adds aria-describedby when content present
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

    // Tooltip wraps disabled child in span
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

  test("Input and TextArea accessibility and interaction", () => {
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
    expect(textAreaChange).toHaveBeenCalledWith("hello")
  })

  test("Select single and multi-select behavior", () => {
    const onChange = jest.fn()
    const options = [
      { label: "Alpha", value: "a" },
      { label: "Beta", value: "b" },
      { label: "Gamma", value: "c" },
    ]

    // Single select renders selected value
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

    // Multi-select renders multiple selected options
    renderWithProviders(
      <Select options={options} defaultValue={["a", "c"]} value={["a", "c"]} />
    )
    const listbox = screen.getByRole("listbox")
    const selectedOptions = within(listbox).getAllByRole("option", {
      selected: true,
    })
    expect(selectedOptions.length).toBe(2)
    within(listbox).getByRole("option", { name: /Alpha/i, selected: true })
    within(listbox).getByRole("option", { name: /Gamma/i, selected: true })
  })

  test("StateView renders loading and error roles appropriately", () => {
    const { rerender } = renderWithProviders(
      <StateView state={{ kind: "loading", message: "Loading" } as any} />
    )
    expect(screen.getByRole("status")).toBeTruthy()

    const onAction = jest.fn()
    rerender(
      <StateView
        state={
          {
            kind: "error",
            message: "Oops",
            code: "ERR",
            actions: [{ label: "Retry", onClick: onAction }],
          } as any
        }
      />
    )
    const alert = screen.getByRole("alert")
    expect(alert).toBeTruthy()
    const btn = screen.getByRole("button")
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalled()
  })

  test("Button interactions and accessibility patterns", () => {
    // Button disabled prevents onClick and sets accessibility attributes
    const onClick = jest.fn()
    renderWithProviders(<Button text="Do" onClick={onClick} disabled />)
    const disabledBtn = screen.getByRole("button", { name: /Do/i })
    fireEvent.click(disabledBtn)
    expect(onClick).not.toHaveBeenCalled()
    expect(disabledBtn.getAttribute("aria-disabled")).toBe("true")

    // Button loading prevents onClick interaction
    const onClick2 = jest.fn()
    renderWithProviders(<Button text="Load" onClick={onClick2} loading />)
    const loadingBtn = screen.getByRole("button", { name: /Load/i })
    fireEvent.click(loadingBtn)
    expect(onClick2).not.toHaveBeenCalled()

    // Button tooltip provides accessible label for icon-only buttons
    renderWithProviders(<Button icon="/x.svg" tooltip="Hello" />)
    screen.getByRole("button", { name: /Hello/i })
  })

  test("ButtonGroup and ButtonTabs interaction handling", () => {
    // ButtonGroup renders and handles left/right button clicks
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
    expect(onLeft).toHaveBeenCalled()
    expect(onRight).toHaveBeenCalled()

    // ButtonTabs emits onChange and onTabChange events
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
    expect(onChange).toHaveBeenCalledWith("2")
    expect(onTabChange).toHaveBeenCalled()
  })
})
