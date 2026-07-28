import { describe, expect, it } from 'vitest'
import {
  buildMarketingAssetPath,
  formatMarketingImageSize,
  MAX_MARKETING_IMAGE_BYTES,
  validateMarketingImage,
} from './marketing-assets'

describe('marketing image attachments', () => {
  it('accepts supported images within the size limit', () => {
    expect(validateMarketingImage({
      name: 'campaign.webp',
      size: 2 * 1024 * 1024,
      type: 'image/webp',
    })).toBeNull()
  })

  it('rejects unsupported, empty, and oversized files', () => {
    expect(validateMarketingImage({ name: 'post.svg', size: 100, type: 'image/svg+xml' }))
      .toMatch(/JPEG/)
    expect(validateMarketingImage({ name: 'empty.png', size: 0, type: 'image/png' }))
      .toMatch(/empty/)
    expect(validateMarketingImage({
      name: 'huge.jpg',
      size: MAX_MARKETING_IMAGE_BYTES + 1,
      type: 'image/jpeg',
    })).toMatch(/10 MB/)
  })

  it('keeps every stored object inside its event folder', () => {
    expect(buildMarketingAssetPath('event-123', 'image/png', 'asset-456'))
      .toBe('event-123/asset-456.png')
  })

  it('formats image sizes for the attachment card', () => {
    expect(formatMarketingImageSize(512)).toBe('1 KB')
    expect(formatMarketingImageSize(1536)).toBe('2 KB')
    expect(formatMarketingImageSize(2.25 * 1024 * 1024)).toBe('2.3 MB')
  })
})
