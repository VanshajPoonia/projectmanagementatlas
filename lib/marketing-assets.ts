export const MARKETING_ASSET_BUCKET = 'marketing-assets'
export const MAX_MARKETING_ASSET_BYTES = 50 * 1024 * 1024

export const MARKETING_ASSET_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/vnd.adobe.photoshop',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/postscript',
  'text/plain',
  'text/csv',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/zip',
] as const

export type MarketingAssetMimeType = (typeof MARKETING_ASSET_TYPES)[number]

const extensionByMimeType: Record<MarketingAssetMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/vnd.adobe.photoshop': 'psd',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/postscript': 'ai',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/zip': 'zip',
}

const mimeTypeByExtension: Record<string, MarketingAssetMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  psd: 'image/vnd.adobe.photoshop',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ai: 'application/postscript',
  eps: 'application/postscript',
  txt: 'text/plain',
  csv: 'text/csv',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  zip: 'application/zip',
}

const mimeTypeAliases: Record<string, MarketingAssetMimeType> = {
  'image/jpg': 'image/jpeg',
  'application/x-zip-compressed': 'application/zip',
  'application/x-photoshop': 'image/vnd.adobe.photoshop',
  'application/photoshop': 'image/vnd.adobe.photoshop',
}

const previewableMimeTypes = new Set<MarketingAssetMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export const MARKETING_ASSET_ACCEPT = [
  ...MARKETING_ASSET_TYPES,
  ...Object.keys(mimeTypeByExtension).map(extension => `.${extension}`),
].join(',')

interface AssetCandidate {
  name: string
  size: number
  type: string
}

export function resolveMarketingAssetMimeType(
  file: Pick<AssetCandidate, 'name' | 'type'>,
): MarketingAssetMimeType | null {
  const browserMimeType = file.type.toLowerCase().split(';', 1)[0].trim()
  if (MARKETING_ASSET_TYPES.includes(browserMimeType as MarketingAssetMimeType)) {
    return browserMimeType as MarketingAssetMimeType
  }
  if (mimeTypeAliases[browserMimeType]) return mimeTypeAliases[browserMimeType]

  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension ? mimeTypeByExtension[extension] ?? null : null
}

export function validateMarketingAsset(file: AssetCandidate): string | null {
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

export function isMarketingAssetPreviewable(mimeType: string) {
  return previewableMimeTypes.has(mimeType as MarketingAssetMimeType)
}

export function formatMarketingAssetSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
