// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compressPhoto } from './image-compress'

const drawImage = vi.fn()

beforeEach(() => {
  drawImage.mockClear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage, set fillStyle(_v: string) {}, set imageSmoothingQuality(_v: string) {} } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'], { type: 'image/jpeg' })))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubDecode(impl: () => Promise<void>) {
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, writable: true, value: impl })
}

const file = new File(['abc'], 'IMG_0001.HEIC', { type: 'image/heic' })

describe('compressPhoto on an iPhone', () => {
  it('retries without options when the browser rejects them', async () => {
    const close = vi.fn()
    const make = vi.fn(async (_f: File, options?: unknown) => {
      if (options) throw new TypeError('options not supported')
      return { width: 4000, height: 3000, close }
    })
    vi.stubGlobal('createImageBitmap', make)
    const out = await compressPhoto(file)
    expect(make).toHaveBeenCalledTimes(2)
    expect(out).toMatchObject({ width: 1800, height: 1350, originalBytes: 3 })
    expect(close).toHaveBeenCalled()
  })

  it('falls back to an image element when createImageBitmap cannot read the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('cannot decode') }))
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    stubDecode(async () => undefined)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(3000)
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(4000)
    const out = await compressPhoto(file)
    expect(out).toMatchObject({ width: 1350, height: 1800 })
    expect(drawImage).toHaveBeenCalled()
  })

  it('says so in plain words when nothing can read the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('no') }))
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    stubDecode(async () => { throw new Error('no') })
    await expect(compressPhoto(file)).rejects.toThrow('IMG_0001.HEIC could not be read')
  })
})
