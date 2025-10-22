import type {
  SubmissionPreparationOptions,
  SubmissionPreparationResult,
  MutableParams,
} from "../../config/index"
import {
  parseSubmissionFormData,
  prepFmeParams,
  applyDirectiveDefaults,
  removeAoiErrorMarker,
  toTrimmedString,
  normalizeServiceModeConfig,
  isNonEmptyTrimmedString,
} from "../utils"
import { resolveRemoteDataset } from "./dataset"

// Förbereder submission-parametrar med AOI och remote dataset-upplösning
export async function prepareSubmissionParams({
  rawFormData,
  userEmail,
  geometryJson,
  geometry,
  modules,
  config,
  workspaceParameters,
  workspaceItem,
  selectedWorkspaceName,
  areaWarning,
  drawnArea,
  makeCancelable,
  fmeClient,
  signal,
  remoteDatasetSubfolder,
  onStatusChange,
}: SubmissionPreparationOptions): Promise<SubmissionPreparationResult> {
  onStatusChange?.("normalizing")
  const { sanitizedFormData, uploadFile, remoteUrl } =
    parseSubmissionFormData(rawFormData)
  const normalizedConfig = normalizeServiceModeConfig(config || undefined)

  const baseParams = prepFmeParams(
    {
      data: sanitizedFormData,
    },
    userEmail,
    geometryJson,
    geometry || undefined,
    modules,
    {
      config: normalizedConfig,
      workspaceParameters,
      workspaceItem,
      areaWarning,
      drawnArea,
    }
  )

  const aoiError = (baseParams as MutableParams).__aoi_error__
  if (aoiError) {
    onStatusChange?.("complete")
    return { params: null, aoiError }
  }

  const params: MutableParams = { ...baseParams }

  const shouldResolveRemoteDataset = Boolean(
    uploadFile || isNonEmptyTrimmedString(remoteUrl)
  )

  if (shouldResolveRemoteDataset) {
    onStatusChange?.("resolvingDataset")
  }

  await resolveRemoteDataset({
    params,
    remoteUrl,
    uploadFile,
    config: normalizedConfig,
    workspaceParameters,
    makeCancelable,
    fmeClient,
    signal,
    subfolder: remoteDatasetSubfolder,
    workspaceName:
      toTrimmedString(workspaceItem?.name) ||
      toTrimmedString(selectedWorkspaceName) ||
      null,
  })

  onStatusChange?.("applyingDefaults")
  const paramsWithDefaults = applyDirectiveDefaults(params, normalizedConfig)
  removeAoiErrorMarker(paramsWithDefaults as MutableParams)

  onStatusChange?.("complete")
  return { params: paramsWithDefaults }
}
