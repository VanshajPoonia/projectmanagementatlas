import { describe, it, expect } from 'vitest'
import { isRequestAborted } from './request-aborted'

describe('isRequestAborted', () => {
  it('recognises a DOMException by name', () => {
    expect(isRequestAborted({ name: 'AbortError', message: 'aborted' })).toBe(true)
  })

  it('recognises the shape supabase-js actually produces', () => {
    // Copied from a real run, which is the only fixture worth trusting here: this repo has
    // twice shipped a bug that its tests missed because the fixtures were a shape production
    // never sends.
    expect(isRequestAborted({
      message: 'AbortError: signal is aborted without reason',
      details: 'AbortError: signal is aborted without reason\n    at ...',
      hint: '',
      code: '',
    })).toBe(true)
  })

  it('does NOT swallow a real failure', () => {
    // The whole risk of this helper is hiding something that matters. An RLS refusal, a network
    // error and a constraint violation must all still be reported.
    expect(isRequestAborted({ message: 'permission denied for table task_comments', code: '42501' })).toBe(false)
    expect(isRequestAborted({ message: 'Failed to fetch' })).toBe(false)
    expect(isRequestAborted({ message: 'duplicate key value violates unique constraint', code: '23505' })).toBe(false)
    expect(isRequestAborted({ name: 'TypeError', message: 'x is not a function' })).toBe(false)
    // A timeout is NOT an abort: the request did not complete and the viewer is looking at
    // stale or empty data, which is precisely what the console should still report.
    expect(isRequestAborted({ name: 'TimeoutError', message: 'signal timed out' })).toBe(false)
  })

  it('is not fooled by a message that merely mentions aborting', () => {
    expect(isRequestAborted({ message: 'the user aborted the upload deliberately' })).toBe(false)
  })

  it('handles nothing gracefully', () => {
    expect(isRequestAborted(null)).toBe(false)
    expect(isRequestAborted(undefined)).toBe(false)
    expect(isRequestAborted('AbortError')).toBe(false)
  })
})
