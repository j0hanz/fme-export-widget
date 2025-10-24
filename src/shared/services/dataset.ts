import type { RemoteDatasetOptions, ApiResponse } from "../../config/index"
import {
  shouldApplyRemoteDatasetUrl,
  shouldUploadRemoteDataset,
  toTrimmedString,
  sanitizeOptGetUrlParam,
  applyUploadedDatasetParam,
  resolveUploadTargetParam,
} from "../utils"

// Löser remote dataset genom att ladda upp eller länka via opt_geturl
export async function resolveRemoteDataset({
  params,
  remoteUrl,
  uploadFile,
  config,
  workspaceParameters,
  makeCancelable,
  fmeClient,
  signal,
  subfolder,
  workspaceName,
}: RemoteDatasetOptions): Promise<void> {
  sanitizeOptGetUrlParam(params, config)

  if (shouldApplyRemoteDatasetUrl(remoteUrl, config)) {
    params.opt_geturl = remoteUrl
    return
  }

  if (!shouldUploadRemoteDataset(config, uploadFile)) {
    return
  }

  const targetWorkspace = toTrimmedString(workspaceName)
  if (!targetWorkspace) {
    throw new Error("REMOTE_DATASET_WORKSPACE_REQUIRED")
  }

  if (typeof params.opt_geturl !== "undefined") {
    delete params.opt_geturl
  }

  const uploadResponse = await makeCancelable<ApiResponse<{ path: string }>>(
    fmeClient.uploadToTemp(uploadFile, {
      subfolder,
      signal,
      repository: config?.repository,
      workspace: targetWorkspace,
    })
  )

  const uploadedPath = uploadResponse.data?.path
  applyUploadedDatasetParam({
    finalParams: params,
    uploadedPath,
    parameters: workspaceParameters,
    explicitTarget: resolveUploadTargetParam(config),
  })
}
