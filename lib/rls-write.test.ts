import { describe, it, expect, vi } from 'vitest'
import { classifyWrite, didWrite, writeFailureMessage } from './rls-write'

// The whole point of this module is that "no error" and "it worked" are different
// statements under RLS. Each test below is one way they come apart.

describe('classifyWrite', () => {
  it('reports ok when the row came back', async () => {
    expect(await classifyWrite({ data: [{ id: 'a' }], error: null })).toEqual({ kind: 'ok' })
  })

  it('reports the error when PostgREST actually errored', async () => {
    const outcome = await classifyWrite({ data: null, error: { message: 'boom' } })
    expect(outcome).toEqual({ kind: 'error', message: 'boom' })
  })

  // The defect this module exists for: zero rows, no error, and the old code read that as
  // success because it only ever looked at `error`.
  it('reports refused for zero rows and no error', async () => {
    expect(await classifyWrite({ data: [], error: null })).toEqual({ kind: 'refused' })
    expect(await classifyWrite({ data: null, error: null })).toEqual({ kind: 'refused' })
  })

  it('prefers a real error over the row count', async () => {
    const outcome = await classifyWrite({ data: [], error: { message: 'constraint' } })
    expect(outcome).toEqual({ kind: 'error', message: 'constraint' })
  })

  describe('the RETURNING-is-filtered trap', () => {
    // A write that makes the row invisible to its own author returns zero rows while
    // having succeeded. Calling that "refused" would replace one lie with another.
    it('reports invisible when the row can no longer be read', async () => {
      const outcome = await classifyWrite(
        { data: [], error: null },
        { stillReadable: async () => false },
      )
      expect(outcome).toEqual({ kind: 'invisible' })
    })

    it('reports refused when the row is still sitting there readable', async () => {
      const outcome = await classifyWrite(
        { data: [], error: null },
        { stillReadable: async () => true },
      )
      expect(outcome).toEqual({ kind: 'refused' })
    })

    it('does not spend a round-trip on the probe when rows came back', async () => {
      const probe = vi.fn(async () => true)
      await classifyWrite({ data: [{ id: 'a' }], error: null }, { stillReadable: probe })
      expect(probe).not.toHaveBeenCalled()
    })

    it('does not probe on a real error either', async () => {
      const probe = vi.fn(async () => true)
      await classifyWrite({ data: [], error: { message: 'x' } }, { stillReadable: probe })
      expect(probe).not.toHaveBeenCalled()
    })
  })

  describe('multi-row writes', () => {
    it('accepts the full expected count', async () => {
      const outcome = await classifyWrite({ data: [{}, {}, {}], error: null }, { expected: 3 })
      expect(outcome).toEqual({ kind: 'ok' })
    })

    // Partial success is the outcome most likely to be waved through, and it is the worst
    // one: some rows changed and the user was told everything did.
    it('treats a partial result as refused', async () => {
      const outcome = await classifyWrite({ data: [{}, {}], error: null }, { expected: 3 })
      expect(outcome).toEqual({ kind: 'refused' })
    })

    it('never resolves a partial result to invisible, however the probe answers', async () => {
      const outcome = await classifyWrite(
        { data: [{}], error: null },
        { expected: 2, stillReadable: async () => false },
      )
      expect(outcome).toEqual({ kind: 'refused' })
    })
  })
})

describe('writeFailureMessage', () => {
  it('says nothing when the write succeeded', () => {
    expect(writeFailureMessage({ kind: 'ok' })).toBeNull()
  })

  it('passes a real error through so the user can act on it', () => {
    const message = writeFailureMessage({ kind: 'error', message: 'duplicate key' }, 'title')
    expect(message?.title).toContain('title')
    expect(message?.description).toContain('duplicate key')
  })

  it('tells a refused user their change did not survive', () => {
    const message = writeFailureMessage({ kind: 'refused' }, 'priority')
    expect(message?.title).toContain('not saved')
  })

  // An invisible write is not a failure, and phrasing it as one would send the user to
  // re-do a change that is already in the database.
  it('does not describe an invisible write as a failure', () => {
    const message = writeFailureMessage({ kind: 'invisible' })
    expect(message?.title).toContain('Saved')
    expect(message?.title).not.toContain('not saved')
  })

  // Nothing here may name a policy, a table or a function - an audit-style leak in a
  // toast is the same defect as one in the access log's summaries.
  it('leaks no internals in the refusal copy', () => {
    for (const kind of ['refused', 'invisible'] as const) {
      const message = writeFailureMessage({ kind })!
      const text = `${message.title} ${message.description}`.toLowerCase()
      for (const internal of ['policy', 'rls', 'auth.uid', 'postgres', 'private.', 'select']) {
        expect(text).not.toContain(internal)
      }
    }
  })
})

describe('didWrite', () => {
  it('counts an invisible write as written, because it was', () => {
    expect(didWrite({ kind: 'ok' })).toBe(true)
    expect(didWrite({ kind: 'invisible' })).toBe(true)
    expect(didWrite({ kind: 'refused' })).toBe(false)
    expect(didWrite({ kind: 'error', message: 'x' })).toBe(false)
  })
})
