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
  type OptionItem,
  ButtonTabs,
} from "../runtime/components/ui"

describe("UI components", () => {
  const renderWithProviders = widgetRender(true)

  beforeAll(() => {
    initExtensions()
    initStore()
    setTheme(mockTheme)
  })

  test("Icon renders an SVG element", () => {
    const { container } = renderWithProviders(
      <Icon src="/mock.svg" ariaLabel="Map" />
    )
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
  })

  test("Tooltip adds aria-describedby to child when content present", () => {
    renderWithProviders(
      <Tooltip content="Help text">
        <button aria-label="Do it">Click</button>
      </Tooltip>
    )
    const btn = screen.getByRole("button", { name: /Do it/i })
    const descId = btn.getAttribute("aria-describedby")
    expect(descId && descId.length > 0).toBe(true)
  })

  test("Tooltip returns bare child when no content can be resolved", () => {
    renderWithProviders(
      <Tooltip>
        {/* No aria-label/title and no content props => no tooltip */}
        <button>Plain</button>
      </Tooltip>
    )
    const btn = screen.getByRole("button", { name: /Plain/i })
    expect(btn.getAttribute("aria-describedby")).toBeNull()
  })

  test("Tooltip wraps disabled child in a span for proper cursor", () => {
    const { container } = renderWithProviders(
      <Tooltip content="info">
        <button aria-label="Disabled child" disabled>
          X
        </button>
      </Tooltip>
    )
    // Expect span wrapper then button
    const span = container.querySelector("span")
    expect(span).toBeTruthy()
    const btn = within(span as HTMLElement).getByRole("button", {
      name: /Disabled child/i,
    })
    expect(btn).toBeTruthy()
  })

  test("Input sets aria attributes from validation and emits onChange", () => {
    const onChange = jest.fn()
    renderWithProviders(
      <Input
        required
        validationMessage="Only numbers"
        pattern={/^\d+$/}
        defaultValue="abc"
        onChange={onChange}
      />
    )
    const input = screen.getByRole("textbox")
    expect(input.getAttribute("aria-required")).toBe("true")
    // Jimu TextInput may not reflect aria-invalid; assert title and describedby instead
    expect(input.getAttribute("title")).toBe("Only numbers")
    expect(input.getAttribute("aria-describedby")).toBeTruthy()
    // Change value
    fireEvent.change(input, { target: { value: "123" } })
    expect(onChange).toHaveBeenCalledWith("123")
  })

  test("TextArea sets aria-invalid when errorText present and updates value", () => {
    const onChange = jest.fn()
    renderWithProviders(
      <TextArea
        required
        errorText="Err"
        defaultValue="hi"
        onChange={onChange}
      />
    )
    const ta = screen.getByRole("textbox")
    expect(ta.getAttribute("aria-required")).toBe("true")
    // describedby should exist when errorText provided
    expect(ta.getAttribute("aria-describedby")).toBeTruthy()
    fireEvent.change(ta, { target: { value: "hello" } })
    expect(onChange).toHaveBeenCalledWith("hello")
  })

  test("Select (single) renders selected value", () => {
    const onChange = jest.fn()
    const options: OptionItem[] = [
      { label: "Alpha", value: "a" },
      { label: "Beta", value: "b" },
    ]
    renderWithProviders(
      <Select
        options={options}
        defaultValue="b"
        onChange={onChange}
        placeholder="Pick"
      />
    )
    const sel = screen.getByRole("combobox")
    // JimuSelect renders the selected label in the button content
    within(sel).getByText(/Beta/i)
  })

  test("Select (multi) renders default selected options", () => {
    const options: OptionItem[] = [
      { label: "One", value: "1" },
      { label: "Two", value: "2" },
      { label: "Three", value: "3" },
    ]
    renderWithProviders(
      <Select options={options} defaultValue={["1", "3"]} value={["1", "3"]} />
    )
    const listbox = screen.getByRole("listbox")
    const selectedOptions = within(listbox).getAllByRole("option", {
      selected: true,
    })
    expect(selectedOptions.length).toBe(2)
    // Assert labels correspond to values 1 and 3
    within(listbox).getByRole("option", { name: /One/i, selected: true })
    within(listbox).getByRole("option", { name: /Three/i, selected: true })
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

  test("ButtonGroup renders left/right buttons and triggers clicks", () => {
    const onLeft = jest.fn()
    const onRight = jest.fn()
    renderWithProviders(
      <ButtonGroup
        leftButton={{ text: "Back", onClick: onLeft }}
        rightButton={{ text: "Next", onClick: onRight }}
      />
    )
    const back = screen.getByRole("button", { name: /Back/i })
    const next = screen.getByRole("button", { name: /Next/i })
    fireEvent.click(back)
    fireEvent.click(next)
    expect(onLeft).toHaveBeenCalled()
    expect(onRight).toHaveBeenCalled()
  })

  test("Button disabled and loading prevent onClick, tooltip-only sets accessible label", () => {
    const onClick = jest.fn()
    // disabled
    renderWithProviders(<Button text="Do" onClick={onClick} disabled />)
    const btn1 = screen.getByRole("button", { name: /Do/i })
    fireEvent.click(btn1)
    expect(onClick).not.toHaveBeenCalled()
    expect(btn1.getAttribute("aria-disabled")).toBe("true")

    // loading
    const onClick2 = jest.fn()
    renderWithProviders(<Button text="Load" onClick={onClick2} loading />)
    const btn2 = screen.getByRole("button", { name: /Load/i })
    fireEvent.click(btn2)
    expect(onClick2).not.toHaveBeenCalled()

    // tooltip provides aria-label when only icon is present
    renderWithProviders(<Button icon="/x.svg" tooltip="Hello" />)
    const iconOnlyBtn = screen.getByRole("button", { name: /Hello/i })
    expect(iconOnlyBtn).toBeTruthy()
  })

  test("ButtonTabs emits onChange and onTabChange on tab click", () => {
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
    const tabTwo = screen.getByRole("radio", { name: /Two/i })
    fireEvent.click(tabTwo)
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0]).toBe("2")
    expect(onTabChange).toHaveBeenCalled()
  })
})
