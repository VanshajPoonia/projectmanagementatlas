import { fitWithin, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '@/lib/marketing-projects'

export interface CompressedPhoto {
  blob: Blob
  width: number
  height: number
  originalBytes: number
}

/**
 * Shrinks a photo in the browser: fit inside `maxEdge`, turn it upright, flatten any
 * transparency onto white and save as JPEG. Throws a plain-words error when the browser
 * cannot read the file (HEIC outside Safari, a broken image).
 */
export async function compressPhoto(file: File, maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY): Promise<CompressedPhoto> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${file.name} could not be read. Try a JPG or PNG.`)
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot shrink photos.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error(`${file.name} could not be shrunk. Try a different photo.`)
    return { blob, width, height, originalBytes: file.size }
  } finally {
    bitmap.close()
  }
}
