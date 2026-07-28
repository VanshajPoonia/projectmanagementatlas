export const MARKETING_ASSET_BUCKET = 'marketing-assets'
export const MAX_MARKETING_IMAGE_BYTES = 10 * 1024 * 1024

export const MARKETING_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

const extensionByMimeType: Record<(typeof MARKETING_IMAGE_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

interface ImageCandidate {
  name: string
  size: number
  type: string
}

export function validateMarketingImage(file: ImageCandidate): string | null {
  if (!MARKETING_IMAGE_TYPES.includes(file.type as (typeof MARKETING_IMAGE_TYPES)[number])) {
    return 'Choose a JPEG, PNG, WebP, or GIF image.'
  }
  if (file.size <= 0) return 'This image is empty.'
  if (file.size > MAX_MARKETING_IMAGE_BYTES) return 'Choose an image smaller than 10 MB.'
  return null
}

export function buildMarketingAssetPath(
  itemId: string,
  mimeType: (typeof MARKETING_IMAGE_TYPES)[number],
  assetId = crypto.randomUUID(),
) {
  return `${itemId}/${assetId}.${extensionByMimeType[mimeType]}`
}
