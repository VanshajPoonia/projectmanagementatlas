// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadMedia } from './project-media-client'

const KEY = 'projects/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg'
let outcomes: Array<'drop' | number>
let sent: number

class FakeXhr {
  status = 0
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  open() {}
  setRequestHeader() {}
  send() {
    const outcome = outcomes[sent++]
    queueMicrotask(() => {
      if (outcome === 'drop') this.onerror?.()
      else {
        this.status = outcome
        this.onload?.()
      }
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = 0
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ urls: { [KEY]: 'https://r2/put' } }))))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('uploadMedia', () => {
  it('tries again with a fresh link when the connection drops', async () => {
    outcomes = ['drop', 200]
    const done = uploadMedia(KEY, new Blob(['x']), 'image/jpeg')
    await vi.advanceTimersByTimeAsync(3000)
    await expect(done).resolves.toBeUndefined()
    expect(sent).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after three dropped tries', async () => {
    outcomes = ['drop', 'drop', 'drop']
    const done = uploadMedia(KEY, new Blob(['x']), 'image/jpeg')
    const failed = expect(done).rejects.toThrow('could not reach the file service')
    await vi.advanceTimersByTimeAsync(10_000)
    await failed
    expect(sent).toBe(3)
  })

  it('does not retry a refusal', async () => {
    outcomes = [403]
    await expect(uploadMedia(KEY, new Blob(['x']), 'image/jpeg')).rejects.toThrow('The upload was refused (403).')
    expect(sent).toBe(1)
  })
})
