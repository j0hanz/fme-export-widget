type KeyInput = string | readonly string[]

export type TranslationKey = string & {
  readonly __translationKeyBrand: unique symbol
}

type KeyInputList = readonly KeyInput[]
type KeyInputArgs = KeyInput[]

interface KeyRegistryEntry {
  readonly segments: readonly string[]
}

const keyRegistry = new Map<string, KeyRegistryEntry>()
const usageRegistry = new Map<string, Set<string>>()

const isProduction = (): boolean => {
  if (typeof process === "undefined") return false
  return process.env?.NODE_ENV === "production"
}

const flattenInputs = (inputs: KeyInputList): string[] =>
  inputs
    .flatMap((input) => (Array.isArray(input) ? input : [input]))
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)

const splitSegment = (segment: string): string[] => {
  const sanitized = segment.replace(/[^0-9a-zA-Z]+/g, " ").trim()
  if (!sanitized) return []
  const parts = sanitized.split(" ").filter(Boolean)
  return parts.length ? parts : [sanitized]
}

const withLowerFirst = (value: string): string => {
  if (!value) return ""
  return value.charAt(0).toLowerCase() + value.slice(1)
}

const withUpperFirst = (value: string): string => {
  if (!value) return ""
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const normalizeSegments = (segments: readonly string[]): string => {
  if (!segments.length) {
    throw new Error("createTranslationKey requires at least one segment")
  }

  const [firstRaw, ...restRaw] = segments
  const firstParts = splitSegment(firstRaw)
  if (!firstParts.length) {
    throw new Error("createTranslationKey received an empty segment")
  }

  const firstHead = withLowerFirst(firstParts[0])
  const firstTail = firstParts
    .slice(1)
    .map((part) => withUpperFirst(part))
    .join("")

  const rest = restRaw
    .flatMap((part) => splitSegment(part))
    .map((part) => withUpperFirst(part))
    .join("")

  return `${firstHead}${firstTail}${rest}`
}

const registerKey = (key: string, segments: readonly string[]): void => {
  if (!keyRegistry.has(key)) {
    keyRegistry.set(key, { segments: [...segments] })
    return
  }

  if (isProduction()) return

  const existing = keyRegistry.get(key)
  if (!existing) return

  const existingSignature = existing.segments.join(".")
  const incomingSignature = segments.join(".")
  if (existingSignature !== incomingSignature) {
    console.warn(
      `translation key collision detected for "${key}": "${existingSignature}" vs "${incomingSignature}"`
    )
  }
}

const markKey = (key: string, segments: readonly string[]): TranslationKey => {
  registerKey(key, segments)
  return key as TranslationKey
}

export const createTranslationKey = (
  ...inputs: KeyInputArgs
): TranslationKey => {
  const segments = flattenInputs(inputs)
  const key = normalizeSegments(segments)
  return markKey(key, segments)
}

export interface TranslationKeyFactory {
  (...segments: KeyInputList): TranslationKey
  extend: (...segments: KeyInputList) => TranslationKeyFactory
}

const createFactory = (base: KeyInputList): TranslationKeyFactory => {
  const factory = ((...segments: KeyInputArgs) =>
    createTranslationKey(...base, ...segments)) as TranslationKeyFactory

  factory.extend = (...segments: KeyInputArgs) =>
    createFactory([...base, ...segments])

  return factory
}

export const translationKey = createFactory([])

export const translationKeys = {
  key: translationKey,
  action: translationKey.extend("action"),
  aria: translationKey.extend("aria"),
  error: translationKey.extend("error"),
  hint: translationKey.extend("hint"),
  label: translationKey.extend("lbl"),
  message: translationKey.extend("msg"),
  option: translationKey.extend("opt"),
  placeholder: translationKey.extend("placeholder"),
  status: translationKey.extend("status"),
  title: translationKey.extend("title"),
  validation: translationKey.extend("val"),
} as const

export const noteTranslationUsage = (
  key: TranslationKey | string,
  scope?: string
): void => {
  if (!scope) return
  const resolved = typeof key === "string" ? key : (key as string)
  let scopes = usageRegistry.get(resolved)
  if (!scopes) {
    scopes = new Set<string>()
    usageRegistry.set(resolved, scopes)
  }
  if (scopes.has(scope)) return
  scopes.add(scope)
  if (!isProduction() && typeof console !== "undefined") {
    const reporter = console.debug || console.info || console.log
    if (typeof reporter === "function") {
      reporter(`[translations] ${scope} -> ${resolved}`)
    }
  }
}

export const getRegisteredTranslationKeys = (): readonly string[] =>
  Array.from(keyRegistry.keys()).sort()

export const getTranslationUsage = (): {
  readonly [key: string]: readonly string[]
} => {
  const result: { [key: string]: readonly string[] } = {}
  usageRegistry.forEach((scopes, key) => {
    result[key] = Array.from(scopes).sort()
  })
  return result
}

export const resetTranslationUsage = (): void => {
  usageRegistry.clear()
}
