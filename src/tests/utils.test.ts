import { resolveMessageOrKey } from "../shared/utils"

// Simple translator factory: looks up keys in a dict; otherwise returns the key
const makeTranslator = (dict: { [key: string]: string }) => (key: string) =>
  Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key

describe("resolveMessageOrKey", () => {
  test("returns raw when empty string provided", () => {
    const t = makeTranslator({})
    expect(resolveMessageOrKey("", t)).toBe("")
  })

  test("returns exact translation when available for raw key", () => {
    const t = makeTranslator({ HELLO_WORLD: "Hi there" })
    expect(resolveMessageOrKey("HELLO_WORLD", t)).toBe("Hi there")
  })

  test("uses camelCase fallback when exact translation is not available", () => {
    const t = makeTranslator({ helloWorld: "Hello Camel" })
    expect(resolveMessageOrKey("HELLO_WORLD", t)).toBe("Hello Camel")
  })

  test("returns raw when neither exact nor camelCase translation is available", () => {
    const t = makeTranslator({})
    expect(resolveMessageOrKey("SOME_UNTRANSLATED_KEY", t)).toBe(
      "SOME_UNTRANSLATED_KEY"
    )
  })

  test("prefers exact translation over camelCase when both exist", () => {
    const t = makeTranslator({
      HELLO_WORLD: "Exact Wins",
      helloWorld: "Camel Fallback",
    })
    expect(resolveMessageOrKey("HELLO_WORLD", t)).toBe("Exact Wins")
  })
})
