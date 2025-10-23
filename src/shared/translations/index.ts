import type { TranslateFn } from "../../config/index"
import {
  createTranslationKey,
  getRegisteredTranslationKeys,
  getTranslationUsage,
  noteTranslationUsage,
  resetTranslationUsage,
  translationKey,
  translationKeys,
  type TranslationKey,
} from "./keys"

export type { TranslationKey }

export {
  createTranslationKey,
  getRegisteredTranslationKeys,
  getTranslationUsage,
  noteTranslationUsage,
  resetTranslationUsage,
  translationKey,
  translationKeys,
}

export interface TranslateKeyOptions {
  readonly scope?: string
}

export const resolveTranslationKey = (
  key: TranslationKey | string,
  options?: TranslateKeyOptions
): string => {
  const resolved = typeof key === "string" ? key : (key as string)
  if (options?.scope) {
    noteTranslationUsage(resolved, options.scope)
  }
  return resolved
}

export const translateKey = (
  translate: TranslateFn,
  key: TranslationKey | string,
  params?: { readonly [key: string]: unknown },
  options?: TranslateKeyOptions
): string => {
  const resolved = resolveTranslationKey(key, options)
  return translate(resolved, params)
}
