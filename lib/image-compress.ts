import { fitWithin, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '@/lib/marketing-projects'

export interface CompressedPhoto {
  blob: Blob
  width: number
  height: number
  originalBytes: number
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

async function viaBitmap(file: File, options?: ImageBitmapOptions): Promise<Decoded> {
  const bitmap = await createImageBitmap(file, options)
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
}

async function viaImageElement(file: File): Promise<Decoded> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/**
 * Tries the readers in turn. iPhone Safari is picky: some versions reject createImageBitmap
 * options, and an <img> will often open a HEIC that createImageBitmap refuses.
 */
async function decode(file: File): Promise<Decoded> {
  const readers: Array<() => Promise<Decoded>> = []
  if (typeof createImageBitmap === 'function') {
    readers.push(() => viaBitmap(file, { imageOrientation: 'from-image' }), () => viaBitmap(file))
  }
  readers.push(() => viaImageElement(file))
  let last: unknown
  for (const read of readers) {
    try {
      const decoded = await read()
      if (decoded.width > 0 && decoded.height > 0) return decoded
      decoded.release()
    } catch (e) {
      last = e
    }
  }
  throw new Error(`${file.name} could not be read. Try a JPG or PNG.`, { cause: last })
}

/**
 * Shrinks a photo in the browser: fit inside `maxEdge`, turn it upright, flatten any
 * transparency onto white and save as JPEG. Throws a plain-words error when the browser
 * cannot read the file (HEIC outside Safari, a broken image).
 */
export async function compressPhoto(file: File, maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY): Promise<CompressedPhoto> {
  const decoded = await decode(file)
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot shrink photos.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.source, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error(`${file.name} could not be shrunk. Try a different photo.`)
    return { blob, width, height, originalBytes: file.size }
  } finally {
    decoded.release()
  }
}
