// Marketing event attachments. The file-type machinery moved to lib/upload-mime.ts
// when task attachments (migration 091) needed the identical allowlist; this module
// keeps its original public API unchanged and now only holds what is specific to
// marketing events - the bucket name, the 50 MB cap, and the item-keyed path shape.

import {
  extensionByMimeType,
  formatUploadSize,
  isUploadPreviewable,
  resolveUploadMimeType,
  UPLOAD_ACCEPT,
  UPLOAD_MIME_TYPES,
  type UploadCandidate,
  type UploadMimeType,
} from './upload-mime'

export const MARKETING_ASSET_BUCKET = 'marketing-assets'
export const MAX_MARKETING_ASSET_BYTES = 50 * 1024 * 1024

export const MARKETING_ASSET_TYPES = UPLOAD_MIME_TYPES
export type MarketingAssetMimeType = UploadMimeType
export const MARKETING_ASSET_ACCEPT = UPLOAD_ACCEPT

export const resolveMarketingAssetMimeType = resolveUploadMimeType
export const isMarketingAssetPreviewable = isUploadPreviewable
export const formatMarketingAssetSize = formatUploadSize

export function validateMarketingAsset(file: UploadCandidate): string | null {
  if (!resolveMarketingAssetMimeType(file)) {
    return 'Choose an image, video, PDF, Office, text, or ZIP file.'
  }
  if (file.size <= 0) return 'This file is empty.'
  if (file.size > MAX_MARKETING_ASSET_BYTES) return 'Choose a file no larger than 50 MB.'
  return null
}

export function buildMarketingAssetPath(
  itemId: string,
  mimeType: MarketingAssetMimeType,
  assetId = crypto.randomUUID(),
) {
  return `${itemId}/${assetId}.${extensionByMimeType[mimeType]}`
}
