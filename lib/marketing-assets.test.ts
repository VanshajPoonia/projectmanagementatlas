import { describe, expect, it } from 'vitest'
import {
  buildMarketingAssetPath,
  formatMarketingAssetSize,
  isMarketingAssetPreviewable,
  MAX_MARKETING_ASSET_BYTES,
  resolveMarketingAssetMimeType,
  validateMarketingAsset,
} from './marketing-assets'

describe('marketing event attachments', () => {
  it('accepts supported image, document, video, and archive files', () => {
    for (const file of [
      { name: 'campaign.webp', type: 'image/webp' },
      { name: 'brief.pdf', type: 'application/pdf' },
      {
        name: 'schedule.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      { name: 'launch.mp4', type: 'video/mp4' },
      { name: 'source-files.zip', type: 'application/zip' },
    ]) {
      expect(validateMarketingAsset({ ...file, size: 2 * 1024 * 1024 })).toBeNull()
    }
  })

  it('uses a recognized extension when the browser omits or aliases the MIME type', () => {
    expect(resolveMarketingAssetMimeType({ name: 'iphone-photo.heic', type: '' }))
      .toBe('image/heic')
    expect(resolveMarketingAssetMimeType({
      name: 'source-files.zip',
      type: 'application/x-zip-compressed',
    })).toBe('application/zip')
  })

  it('rejects unsupported, empty, and oversized files', () => {
    expect(validateMarketingAsset({ name: 'installer.exe', size: 100, type: 'application/x-msdownload' }))
      .toMatch(/image, video/)
    expect(validateMarketingAsset({ name: 'empty.png', size: 0, type: 'image/png' }))
      .toMatch(/empty/)
    expect(validateMarketingAsset({
      name: 'huge.mp4',
      size: MAX_MARKETING_ASSET_BYTES + 1,
      type: 'video/mp4',
    })).toMatch(/50 MB/)
  })

  it('keeps every stored object inside its event folder with a safe extension', () => {
    expect(buildMarketingAssetPath('event-123', 'application/pdf', 'asset-456'))
      .toBe('event-123/asset-456.pdf')
  })

  it('only previews browser-safe raster images', () => {
    expect(isMarketingAssetPreviewable('image/png')).toBe(true)
    expect(isMarketingAssetPreviewable('image/svg+xml')).toBe(false)
    expect(isMarketingAssetPreviewable('application/pdf')).toBe(false)
  })

  it('formats file sizes for the attachment card', () => {
    expect(formatMarketingAssetSize(512)).toBe('1 KB')
    expect(formatMarketingAssetSize(1536)).toBe('2 KB')
    expect(formatMarketingAssetSize(2.25 * 1024 * 1024)).toBe('2.3 MB')
  })
})
