import type {
  FmeExportConfig,
  MutableParams,
  TextOrFileValue,
  TranslateFn,
  WorkspaceParameter,
} from "../../config/index"
import { UPLOAD_PARAM_TYPES } from "../../config/index"
import type { Dispatch, SetStateAction } from "react"
import {
  isFileObject,
  mapDefined,
  toStringValue,
  toTrimmedString,
  normalizeParameterValue,
  sanitizeParamKey,
} from "./conversion"
import { isValidExternalUrlForOptGetUrl } from "../validations"

// Bygger ett Set av normaliserade choice-värden för parameter-validering
export const buildChoiceSet = (
  list: WorkspaceParameter["listOptions"]
): Set<string | number> | null =>
  list?.length
    ? new Set(list.map((opt) => normalizeParameterValue(opt.value)))
    : null

// Skapar placeholder-texter för formulär-fält
export const makePlaceholders = (
  translate: TranslateFn,
  fieldLabel: string
) => ({
  enter: translate("phEnter", { field: fieldLabel }),
  select: translate("phSelect", { field: fieldLabel }),
})

const PLACEHOLDER_KIND_MAP = Object.freeze({
  email: "phEmail",
  phone: "phPhone",
  search: "phSearch",
} as const)

export const getTextPlaceholder = (
  field: { placeholder?: string } | undefined,
  placeholders: { enter: string },
  translate: TranslateFn,
  kind?: "email" | "phone" | "search"
): string => {
  if (field?.placeholder) return field.placeholder
  if (kind) return translate(PLACEHOLDER_KIND_MAP[kind])
  return placeholders.enter
}

const normalizeFormEntries = (
  entries: Iterable<[string, unknown]>
): { [key: string]: unknown } => {
  const normalized: { [key: string]: unknown } = {}
  for (const [key, value] of entries) {
    normalized[key] = coerceFormValueForSubmission(value)
  }
  return normalized
}

// Parsar formulär-data och extraherar filer, URLs och saniterade värden
export const parseSubmissionFormData = (rawData: {
  [key: string]: unknown
}): {
  sanitizedFormData: { [key: string]: unknown }
  uploadFile: File | null
  remoteUrl: string
} => {
  const {
    __upload_file__: uploadField,
    __remote_dataset_url__: remoteDatasetField,
    opt_geturl: optGetUrlField,
    ...restFormData
  } = rawData

  const sanitizedOptGetUrl = toTrimmedString(optGetUrlField)
  const sanitizedFormData: { [key: string]: unknown } = { ...restFormData }
  if (sanitizedOptGetUrl) {
    sanitizedFormData.opt_geturl = sanitizedOptGetUrl
  }

  const normalizedFormData = normalizeFormEntries(
    Object.entries(sanitizedFormData)
  )

  const uploadFile = uploadField instanceof File ? uploadField : null
  const remoteUrl = toTrimmedString(remoteDatasetField) ?? ""

  return { sanitizedFormData: normalizedFormData, uploadFile, remoteUrl }
}

const findUploadParameterTarget = (
  parameters?: readonly WorkspaceParameter[] | null
): string | undefined => {
  if (!parameters) return undefined

  for (const parameter of parameters) {
    if (!parameter) continue
    const normalizedType = String(
      parameter.type
    ) as (typeof UPLOAD_PARAM_TYPES)[number]
    if (UPLOAD_PARAM_TYPES.includes(normalizedType) && parameter.name) {
      return parameter.name
    }
  }

  return undefined
}

// Applicerar uploaded dataset path till FME-parametrar
export const applyUploadedDatasetParam = ({
  finalParams,
  uploadedPath,
  parameters,
  explicitTarget,
}: {
  finalParams: { [key: string]: unknown }
  uploadedPath?: string
  parameters?: readonly WorkspaceParameter[] | null
  explicitTarget: string | null
}): void => {
  if (!uploadedPath) return

  if (explicitTarget) {
    finalParams[explicitTarget] = uploadedPath
    return
  }

  const inferredTarget = findUploadParameterTarget(parameters)
  if (inferredTarget) {
    finalParams[inferredTarget] = uploadedPath
    return
  }

  if (
    typeof (finalParams as { SourceDataset?: unknown }).SourceDataset ===
    "undefined"
  ) {
    ;(finalParams as { SourceDataset?: unknown }).SourceDataset = uploadedPath
  }
}

export const sanitizeOptGetUrlParam = (
  params: MutableParams,
  config: FmeExportConfig | null | undefined
): void => {
  if (!params) return

  const featureEnabled = Boolean(
    config?.allowRemoteDataset && config?.allowRemoteUrlDataset
  )

  if (!featureEnabled) {
    if (typeof params.opt_geturl !== "undefined") delete params.opt_geturl
    return
  }

  const trimmed = toTrimmedString(params.opt_geturl)
  if (trimmed && isValidExternalUrlForOptGetUrl(trimmed)) {
    params.opt_geturl = trimmed
    return
  }

  if (typeof params.opt_geturl !== "undefined") delete params.opt_geturl
}

export const resolveUploadTargetParam = (
  config: FmeExportConfig | null | undefined
): string | null => {
  if (!config?.uploadTargetParamName) return null

  const sanitized = sanitizeParamKey(config.uploadTargetParamName, "")
  return sanitized || null
}

export const getFileDisplayName = (
  file: File,
  translate?: TranslateFn
): string => {
  const name = toTrimmedString((file as any)?.name)
  if (name) return name
  return translate ? translate("lblUnnamedFile") : "unnamed-file"
}

const isCompositeValue = (
  value: unknown
): value is { mode: string; [key: string]: unknown } => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "mode" in value
  )
}

const extractFileValue = (composite: TextOrFileValue): unknown => {
  if (isFileObject(composite.file)) {
    return composite.file
  }
  return (
    toTrimmedString(composite.fileName) ??
    toStringValue(composite.fileName ?? composite.file) ??
    ""
  )
}

export const coerceFormValueForSubmission = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value
  }

  if (!isCompositeValue(value)) {
    return value
  }

  const composite = value as TextOrFileValue
  if (composite.mode === "file") {
    return extractFileValue(composite)
  }

  if (composite.mode === "text") {
    const normalized = toStringValue(composite.text) ?? ""
    return normalized
  }

  return value
}

export const initFormValues = (
  formConfig: readonly any[]
): { [key: string]: any } => {
  const result: { [key: string]: any } = {}
  for (const field of formConfig) {
    if (field?.name) {
      result[field.name] = field.defaultValue ?? ""
    }
  }
  return result
}

export const canResetButton = (
  onReset: (() => void) | undefined,
  canResetFlag: boolean,
  state: string,
  drawnArea: number,
  isDrawing?: boolean,
  clickCount?: number
): boolean => {
  if (!onReset || !canResetFlag || state === "order-result") return false
  if (state === "drawing")
    return Boolean(clickCount && clickCount > 0) || Boolean(isDrawing)
  return drawnArea > 0 && state !== "initial"
}

export const shouldShowWorkspaceLoading = (
  isLoading: boolean,
  _workspaces: readonly any[],
  state: string,
  hasError?: boolean
): boolean => {
  if (hasError) {
    return false
  }

  const needsLoading =
    state === "workspace-selection" || state === "export-options"

  return needsLoading && isLoading
}

export const setError = <T extends { [k: string]: any }>(
  set: Dispatch<SetStateAction<T>>,
  key: keyof T,
  value?: T[keyof T]
) => {
  set((prev) => ({ ...prev, [key]: value as any }))
}

export const clearErrors = <T extends { [k: string]: any }>(
  set: Dispatch<SetStateAction<T>>,
  keys: Array<keyof T>
) => {
  set((prev) => {
    const next: any = { ...prev }
    for (const k of keys) next[k as string] = undefined
    return next
  })
}

export const collectTrimmedStrings = (
  values: Iterable<unknown> | null | undefined
): string[] => mapDefined(values, (value) => toTrimmedString(value))

export const uniqueStrings = (values: Iterable<string>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

export const collectStringsFromProp = (
  values: Iterable<unknown> | null | undefined,
  prop: string
): string[] =>
  mapDefined(values, (value) => {
    if (typeof value !== "object" || value === null) return undefined
    const record = value as { [key: string]: unknown }
    return toTrimmedString(record[prop])
  })
