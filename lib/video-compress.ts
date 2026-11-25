// Shrinks a video in the browser before it uploads, so a phone video of several hundred MB lands
// as an MP4 small enough for one Storage file (50 MB on the Supabase Free plan).
//
// mediabunny does the work on WebCodecs, which uses the phone's video hardware, and is loaded only
// when someone picks a video so it never weighs down the rest of the app.

import { VIDEO_MAX_SOURCE_BYTES, VIDEO_MAX_STORED_BYTES } from '@/lib/marketing-projects'

/** Aim under the stored limit: the container and audio add a little on top of the video bitrate. */
const TARGET_BYTES = Math.floor(VIDEO_MAX_STORED_BYTES * 0.88)
const AUDIO_BITRATE = 96_000
/** A small MP4 is left alone, because re-encoding it would only cost quality. */
const KEEP_AS_IS_BYTES = 20 * 1024 * 1024

interface Tier {
  edge: number
  minBitrate: number
  maxBitrate: number
}

/** Best first. A longer video drops to a smaller picture before it drops to mush. */
const TIERS: Tier[] = [
  { edge: 1280, minBitrate: 1_200_000, maxBitrate: 3_500_000 },
  { edge: 960, minBitrate: 700_000, maxBitrate: 2_000_000 },
  { edge: 640, minBitrate: 350_000, maxBitrate: 1_000_000 },
]

export interface VideoPlan {
  width: number
  height: number
  bitrate: number
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/**
 * The picture size and bitrate that fit `durationSeconds` of video under the stored limit.
 * Null means it is too long to look acceptable at any size.
 */
export function planVideo(durationSeconds: number, width: number, height: number, hasAudio: boolean): VideoPlan | null {
  if (!(durationSeconds > 0) || !(width > 0) || !(height > 0)) return null
  const budget = (TARGET_BYTES * 8) / durationSeconds - (hasAudio ? AUDIO_BITRATE : 0)
  const tier = TIERS.find((t) => budget >= t.minBitrate)
  if (!tier) return null
  const scale = Math.min(1, tier.edge / Math.max(width, height))
  return { width: even(width * scale), height: even(height * scale), bitrate: Math.floor(Math.min(tier.maxBitrate, budget)) }
}

/** The longest video that can still be squeezed under the limit, with audio. */
export function longestVideoSeconds(): number {
  const lowest = TIERS[TIERS.length - 1]
  return Math.floor((TARGET_BYTES * 8) / (lowest.minBitrate + AUDIO_BITRATE))
}

/** Said before any work starts, so a file that can never upload is refused at once. */
export function videoProblem(file: Pick<File, 'size' | 'name'>): string | null {
  if (file.size <= 0) return `${file.name} is empty.`
  if (file.size > VIDEO_MAX_SOURCE_BYTES) return `${file.name} is over 500 MB. Trim it and try again.`
  return null
}

export interface CompressedVideo {
  blob: Blob
  poster: Blob
  width: number
  height: number
  duration: number
  originalBytes: number
}

async function posterOf(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The poster frame could not be made.'))), 'image/jpeg', 0.8),
  )
}

/**
 * Re-encodes `file` to H.264 and AAC in an MP4 and grabs a poster frame. `onProgress` gets 0 to 1.
 * Throws a plain-words error when the browser cannot read or encode the video.
 */
export async function compressVideo(file: File, onProgress?: (fraction: number) => void): Promise<CompressedVideo> {
  const problem = videoProblem(file)
  if (problem) throw new Error(problem)

  const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, CanvasSink } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack().catch(() => null)
  if (!track) throw new Error(`${file.name} could not be read as a video. Try an MP4 or MOV.`)
  const duration = await input.computeDuration()
  const audio = await input.getPrimaryAudioTrack().catch(() => null)
  const width = await track.getDisplayWidth()
  const height = await track.getDisplayHeight()

  const plan = planVideo(duration, width, height, Boolean(audio))
  if (!plan) {
    throw new Error(`${file.name} is too long to shrink under 50 MB. Keep it under about ${Math.floor(longestVideoSeconds() / 60)} minutes.`)
  }

  const sink = new CanvasSink(track, { width: Math.min(plan.width, 640), fit: 'contain' })
  const frame = await sink.getCanvas(Math.min(1, duration / 2))
  if (!frame) throw new Error(`${file.name} could not be read as a video. Try an MP4 or MOV.`)
  const poster = await posterOf(frame.canvas)

  const isMp4 = /mp4|m4v/i.test(file.type) || /\.(mp4|m4v)$/i.test(file.name)
  if (isMp4 && file.size <= KEEP_AS_IS_BYTES && (await track.getCodec()) === 'avc') {
    onProgress?.(1)
    return { blob: new Blob([file], { type: 'video/mp4' }), poster, width, height, duration, originalBytes: file.size }
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const conversion = await Conversion.init({
    input,
    output,
    video: { codec: 'avc', width: plan.width, height: plan.height, fit: 'contain', bitrate: plan.bitrate, forceTranscode: true },
    audio: { codec: 'aac', bitrate: AUDIO_BITRATE },
    showWarnings: false,
  })
  if (!conversion.isValid) throw new Error(`This browser cannot shrink ${file.name}. Try a recent Safari or Chrome.`)
  conversion.onProgress = (fraction) => onProgress?.(Math.min(1, fraction))
  await conversion.execute()

  const buffer = output.target.buffer
  if (!buffer) throw new Error(`${file.name} could not be converted.`)
  const blob = new Blob([buffer], { type: 'video/mp4' })
  if (blob.size > VIDEO_MAX_STORED_BYTES) throw new Error(`${file.name} is still over 50 MB after shrinking. Trim it and try again.`)
  return { blob, poster, width: plan.width, height: plan.height, duration, originalBytes: file.size }
}
