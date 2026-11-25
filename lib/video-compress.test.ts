import { describe, expect, it } from 'vitest'
import { VIDEO_MAX_STORED_BYTES } from './marketing-projects'
import { longestVideoSeconds, planVideo, videoProblem } from './video-compress'

describe('planVideo', () => {
  it('keeps a short clip sharp at 720p', () => {
    const plan = planVideo(30, 1920, 1080, true)!
    expect(plan).toMatchObject({ width: 1280, height: 720 })
    expect(plan.bitrate).toBe(3_500_000)
  })

  it('keeps a portrait phone video upright and even-sized', () => {
    const plan = planVideo(20, 2160, 3840, true)!
    expect(plan.height).toBe(1280)
    expect(plan.width % 2).toBe(0)
    expect(plan.width).toBeLessThan(plan.height)
  })

  it('never scales a small video up', () => {
    expect(planVideo(10, 640, 360, true)).toMatchObject({ width: 640, height: 360 })
  })

  it('drops the picture size before the bitrate for a longer video', () => {
    const short = planVideo(120, 1920, 1080, true)!
    const long = planVideo(600, 1920, 1080, true)!
    expect(long.width).toBeLessThan(short.width)
  })

  it('always fits the stored limit', () => {
    for (const seconds of [5, 60, 240, 480, 700]) {
      const plan = planVideo(seconds, 1920, 1080, true)
      if (!plan) continue
      const bytes = ((plan.bitrate + 96_000) * seconds) / 8
      expect(bytes).toBeLessThanOrEqual(VIDEO_MAX_STORED_BYTES)
    }
  })

  it('refuses a video too long to look acceptable', () => {
    expect(planVideo(longestVideoSeconds() + 60, 1920, 1080, true)).toBeNull()
  })

  it('gives a silent video the audio share too', () => {
    expect(planVideo(400, 1920, 1080, false)!.bitrate).toBeGreaterThan(planVideo(400, 1920, 1080, true)!.bitrate)
  })

  it('rejects empty or unknown sizes', () => {
    expect(planVideo(0, 1920, 1080, true)).toBeNull()
    expect(planVideo(10, 0, 0, true)).toBeNull()
  })
})

describe('videoProblem', () => {
  it('accepts up to 500 MB and refuses more or nothing', () => {
    expect(videoProblem({ name: 'a.mov', size: 500 * 1024 * 1024 })).toBeNull()
    expect(videoProblem({ name: 'a.mov', size: 500 * 1024 * 1024 + 1 })).toMatch(/over 500 MB/)
    expect(videoProblem({ name: 'a.mov', size: 0 })).toMatch(/empty/)
  })
})
