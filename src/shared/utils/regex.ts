const DEFAULT_MAX_PATTERN_LENGTH = 512;

export const escapeForRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const escapeForCharacterClass = (value: string): string =>
  value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

export const createSafeRegExp = (
  pattern: string,
  flags = "",
  options?: { readonly maxLength?: number }
): RegExp | null => {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_PATTERN_LENGTH;
  if (pattern.length > maxLength) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
};
