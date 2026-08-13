import { describe, expect, it, vi } from 'vitest'
import { DISCARD_PROMPT, guardedOpenChange, isDirty } from './unsaved-changes'

describe('isDirty', () => {
  it('is false for identical values', () => {
    expect(isDirty({ title: 'Bid package', priority: 2 }, { title: 'Bid package', priority: 2 })).toBe(
      false,
    )
  })

  it('is true when a field changed', () => {
    expect(isDirty({ title: 'Bid' }, { title: '' })).toBe(true)
  })

  it('is true when a field was added', () => {
    expect(isDirty({ title: 'Bid', note: 'x' }, { title: 'Bid' })).toBe(true)
  })

  // An input that was focused and cleared is not a change worth blocking a close over.
  it('treats empty string, null and undefined as the same nothing', () => {
    expect(isDirty({ a: '', b: null, c: undefined }, { a: null, b: undefined, c: '' })).toBe(false)
  })

  it('notices a value replaced by nothing', () => {
    expect(isDirty({ title: '' }, { title: 'Bid package' })).toBe(true)
  })

  describe('arrays', () => {
    it('is false for equal arrays', () => {
      expect(isDirty({ assignees: ['a', 'b'] }, { assignees: ['a', 'b'] })).toBe(false)
    })

    it('is true when an item is added', () => {
      expect(isDirty({ assignees: ['a', 'b'] }, { assignees: ['a'] })).toBe(true)
    })

    // Order is meaning for a list of links, so a reorder is a real change.
    it('is true when the order changed', () => {
      expect(isDirty({ tags: ['a', 'b'] }, { tags: ['b', 'a'] })).toBe(true)
    })

    it('compares objects inside an array', () => {
      const a = { links: [{ title: 'Spec', url: 'https://x' }] }
      const b = { links: [{ title: 'Spec', url: 'https://y' }] }
      expect(isDirty(a, b)).toBe(true)
      expect(isDirty(a, { links: [{ title: 'Spec', url: 'https://x' }] })).toBe(false)
    })

    it('is true when an array replaces a scalar', () => {
      expect(isDirty({ tags: ['a'] }, { tags: 'a' })).toBe(true)
    })

    it('treats an empty array as different from nothing', () => {
      // [] and '' are genuinely different states for a multi-select, so this is not folded
      // into the blank() rule.
      expect(isDirty({ tags: [] }, { tags: '' })).toBe(true)
    })
  })

  describe('dates', () => {
    it('compares by instant, not identity', () => {
      const when = '2026-08-13T00:00:00.000Z'
      expect(isDirty({ due: new Date(when) }, { due: new Date(when) })).toBe(false)
    })

    it('notices a different date', () => {
      expect(
        isDirty({ due: new Date('2026-08-13') }, { due: new Date('2026-08-14') }),
      ).toBe(true)
    })

    it('is true when a date replaces nothing', () => {
      expect(isDirty({ due: new Date('2026-08-13') }, { due: null })).toBe(true)
    })
  })

  it('is false for two empty forms', () => {
    expect(isDirty({}, {})).toBe(false)
  })
})

describe('guardedOpenChange', () => {
  it('lets a clean dialog close without asking', () => {
    const onOpenChange = vi.fn()
    const confirm = vi.fn()
    guardedOpenChange(false, onOpenChange, confirm)(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks before discarding unsaved work', () => {
    const onOpenChange = vi.fn()
    const confirm = vi.fn().mockReturnValue(true)
    guardedOpenChange(true, onOpenChange, confirm)(false)
    expect(confirm).toHaveBeenCalledWith(DISCARD_PROMPT)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open when the user backs out', () => {
    const onOpenChange = vi.fn()
    guardedOpenChange(true, onOpenChange, () => false)(false)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  // Opening is never the destructive direction, so it must never be blocked — a guard that
  // fires on open would make a dirty dialog impossible to reopen.
  it('never guards opening', () => {
    const onOpenChange = vi.fn()
    const confirm = vi.fn()
    guardedOpenChange(true, onOpenChange, confirm)(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('accepts a caller-supplied message', () => {
    const confirm = vi.fn().mockReturnValue(true)
    guardedOpenChange(true, vi.fn(), confirm, 'Throw away this draft?')(false)
    expect(confirm).toHaveBeenCalledWith('Throw away this draft?')
  })
})
