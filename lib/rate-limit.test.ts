import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkRateLimit } from './rate-limit'

// The limiter keeps state in a module-level Map, so each test uses a UNIQUE key to
// stay isolated from the others. Time is driven with fake timers so the sliding
// window is deterministic (no real sleeps).
describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to the limit, then blocks', () => {
    const key = 'user-a:route'
    expect(checkRateLimit(key, 3, 1000)).toBe(true)
    expect(checkRateLimit(key, 3, 1000)).toBe(true)
    expect(checkRateLimit(key, 3, 1000)).toBe(true)
    // 4th within the window is over the limit.
    expect(checkRateLimit(key, 3, 1000)).toBe(false)
  })

  it('lets requests through again once the window has slid past old timestamps', () => {
    const key = 'user-b:route'
    expect(checkRateLimit(key, 2, 1000)).toBe(true)
    expect(checkRateLimit(key, 2, 1000)).toBe(true)
    expect(checkRateLimit(key, 2, 1000)).toBe(false) // blocked at the cap

    // Advance past the window so the earlier timestamps expire.
    vi.setSystemTime(1001)
    expect(checkRateLimit(key, 2, 1000)).toBe(true)
  })

  it('keeps separate callers in separate buckets', () => {
    expect(checkRateLimit('caller-1:x', 1, 1000)).toBe(true)
    expect(checkRateLimit('caller-1:x', 1, 1000)).toBe(false)
    // A different key is unaffected by caller-1 exhausting its bucket.
    expect(checkRateLimit('caller-2:x', 1, 1000)).toBe(true)
  })

  it('slides partially: only timestamps older than the window drop off', () => {
    const key = 'user-c:route'
    vi.setSystemTime(0)
    expect(checkRateLimit(key, 2, 1000)).toBe(true) // t=0
    vi.setSystemTime(600)
    expect(checkRateLimit(key, 2, 1000)).toBe(true) // t=600, bucket=[0,600]
    vi.setSystemTime(700)
    expect(checkRateLimit(key, 2, 1000)).toBe(false) // still 2 in window → blocked
    vi.setSystemTime(1001)
    // t=0 has expired (>1000 old) but t=600 remains → one slot free.
    expect(checkRateLimit(key, 2, 1000)).toBe(true)
  })
})
