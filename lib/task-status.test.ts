import { describe, it, expect } from 'vitest'
import {
  getNormalizedTaskStatus,
  getTaskStatusLabel,
  getEffectiveStatusKey,
  findColumnForStatus,
  statusesAvailableOnBoard,
  statusesMissingFromBoard,
  statusesForPicker,
} from './task-status'

describe('getNormalizedTaskStatus - FK first (columns.status_key)', () => {
  it('trusts an explicit status_key even when the column title is unconventional', () => {
    // The whole point of Phase 1B: a board naming its column "WIP" must not be misread.
    expect(getNormalizedTaskStatus({ column: { title: 'WIP', status_key: 'in_progress' } })).toBe('in_progress')
    expect(getNormalizedTaskStatus({ column: { title: 'Icebox', status_key: 'to_do' } })).toBe('to_do')
    expect(getNormalizedTaskStatus({ column: { title: 'Shipped', status_key: 'done' } })).toBe('done')
    expect(getNormalizedTaskStatus({ column: { title: 'Scrapped', status_key: 'cancelled' } })).toBe('done')
  })

  it('an explicit status_key overrides a stale task.status', () => {
    expect(
      getNormalizedTaskStatus({ status: 'to_do', column: { title: 'WIP', status_key: 'in_progress' } }),
    ).toBe('in_progress')
  })
})

describe('getNormalizedTaskStatus - legacy fallback (no status_key)', () => {
  it('still classifies by conventional column titles', () => {
    expect(getNormalizedTaskStatus({ column: { title: 'In Progress' } })).toBe('in_progress')
    expect(getNormalizedTaskStatus({ column: { title: 'Completed' } })).toBe('done')
    expect(getNormalizedTaskStatus({ column: { title: 'To Do' } })).toBe('to_do')
    expect(getNormalizedTaskStatus({ column: { title: 'On Going Indefinitely' } })).toBe('in_progress')
  })

  it('reproduces the bug the FK fixes: an unconventional title without a key falls to to_do', () => {
    expect(getNormalizedTaskStatus({ column: { title: 'WIP' } })).toBe('to_do')
  })

  it('classifies by the raw status when there is no column', () => {
    expect(getNormalizedTaskStatus({ status: 'in_progress' })).toBe('in_progress')
    expect(getNormalizedTaskStatus({ status: 'cancelled' })).toBe('done')
    expect(getNormalizedTaskStatus({ status: 'to_do' })).toBe('to_do')
  })
})

describe('getTaskStatusLabel', () => {
  it('shows Cancelled distinctly via status_key', () => {
    expect(getTaskStatusLabel({ column: { title: 'Scrapped', status_key: 'cancelled' } })).toBe('Cancelled')
  })
  it('maps buckets to human labels', () => {
    expect(getTaskStatusLabel({ column: { title: 'WIP', status_key: 'in_progress' } })).toBe('In Progress')
    expect(getTaskStatusLabel({ column: { title: 'Shipped', status_key: 'done' } })).toBe('Completed')
    expect(getTaskStatusLabel({ column: { title: 'Backlog', status_key: 'to_do' } })).toBe('To Do')
  })
})

describe('getEffectiveStatusKey - FK first', () => {
  const columns = [
    { id: 'c1', title: 'WIP', status_key: 'in_progress' },
    { id: 'c2', title: 'Backlog', status_key: 'to_do' },
  ]
  const statuses = [
    { key: 'to_do', label: 'To Do' },
    { key: 'in_progress', label: 'In Progress' },
  ]

  it('returns the column status_key directly', () => {
    expect(getEffectiveStatusKey({ column_id: 'c1' }, columns, statuses)).toBe('in_progress')
  })

  it('falls back to a title→label match when a column has no status_key', () => {
    const cols = [{ id: 'c3', title: 'In Progress' }]
    expect(getEffectiveStatusKey({ column_id: 'c3' }, cols, statuses)).toBe('in_progress')
  })
})

describe('findColumnForStatus - FK first', () => {
  const columns = [
    { id: 'c1', title: 'WIP', status_key: 'in_progress' },
    { id: 'c2', title: 'Backlog', status_key: 'to_do' },
  ]

  it('finds the column explicitly mapped to the status', () => {
    expect(findColumnForStatus('in_progress', 'In Progress', columns)?.id).toBe('c1')
  })

  it('falls back to title / bucket when no column has the key', () => {
    const cols = [{ id: 'x', title: 'In Progress' }]
    expect(findColumnForStatus('in_progress', 'In Progress', cols)?.id).toBe('x')
  })
})


/**
 * Regression cover for a real report: picking a status the board had no column for filled in
 * the whole create-task form and then refused it on submit, telling the user - who was often
 * the admin - to "ask an admin". The pickers now offer only what the board can accept.
 */
describe('status pickers are scoped to what the board can accept', () => {
  const statuses = [
    { key: 'to_do', label: 'To Do' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'done', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ]
  // EmpowerMe on production: To Do / In Progress / Completed linked, no Cancelled column,
  // plus two custom columns linked to nothing.
  const empowerMe = [
    { id: 'c1', title: 'To Do', status_key: 'to_do' },
    { id: 'c2', title: 'In Progress', status_key: 'in_progress' },
    { id: 'c3', title: 'Completed', status_key: 'done' },
    { id: 'c4', title: 'Notes', status_key: null },
    { id: 'c5', title: 'On going', status_key: null },
  ]

  it('offers only the statuses that resolve to a column', () => {
    expect(statusesAvailableOnBoard(statuses, empowerMe).map(s => s.key))
      .toEqual(['to_do', 'in_progress', 'done'])
  })

  it('reports the missing one so an admin can be prompted to add it', () => {
    expect(statusesMissingFromBoard(statuses, empowerMe).map(s => s.key)).toEqual(['cancelled'])
  })

  it('counts a column matched by title alone, not just by the FK', () => {
    // Legacy boards predating 063 have no status_key; an exact title match still resolves.
    const legacy = [{ id: 'c1', title: 'Cancelled', status_key: null }]
    expect(statusesAvailableOnBoard(statuses, legacy).map(s => s.key)).toEqual(['cancelled'])
  })

  it('does NOT count a column that merely buckets the same way', () => {
    // "On Going Indefinitely" buckets to in_progress, but nobody chose it for that status.
    const drifted = [{ id: 'c1', title: 'On Going Indefinitely', status_key: null }]
    expect(statusesAvailableOnBoard(statuses, drifted)).toEqual([])
  })

  it('counts a drifted column once it is explicitly linked', () => {
    const linked = [{ id: 'c1', title: 'On Going Indefinitely', status_key: 'in_progress' }]
    expect(statusesAvailableOnBoard(statuses, linked).map(s => s.key)).toEqual(['in_progress'])
  })

  describe('fail-open vs fail-closed on unknown columns', () => {
    it('offers everything when the columns are not loaded - an empty picker reads as broken', () => {
      expect(statusesAvailableOnBoard(statuses, null)).toEqual(statuses)
      expect(statusesAvailableOnBoard(statuses, undefined)).toEqual(statuses)
    })

    it('reports nothing missing when the columns are not loaded', () => {
      expect(statusesMissingFromBoard(statuses, null)).toEqual([])
      expect(statusesMissingFromBoard(statuses, undefined)).toEqual([])
    })

    it('offers nothing on a board with no columns at all', () => {
      expect(statusesAvailableOnBoard(statuses, [])).toEqual([])
    })
  })

  describe('statusesForPicker keeps the record its own status', () => {
    it('keeps a status whose column has gone, so the control never renders blank', () => {
      const keys = statusesForPicker(statuses, empowerMe, 'cancelled').map(s => s.key)
      expect(keys).toContain('cancelled')
      expect(keys).toEqual(['to_do', 'in_progress', 'done', 'cancelled'])
    })

    it('preserves the admin-defined order rather than appending the kept status', () => {
      const reordered = [
        { key: 'cancelled', label: 'Cancelled' },
        { key: 'to_do', label: 'To Do' },
        { key: 'done', label: 'Completed' },
      ]
      const cols = [{ id: 'c1', title: 'To Do', status_key: 'to_do' }]
      expect(statusesForPicker(reordered, cols, 'cancelled').map(s => s.key))
        .toEqual(['cancelled', 'to_do'])
    })

    it('adds nothing when the current status is already reachable', () => {
      expect(statusesForPicker(statuses, empowerMe, 'to_do').map(s => s.key))
        .toEqual(['to_do', 'in_progress', 'done'])
    })

    it('ignores a status key that is not a defined status', () => {
      expect(statusesForPicker(statuses, empowerMe, 'legacy_junk').map(s => s.key))
        .toEqual(['to_do', 'in_progress', 'done'])
    })

    it('does not duplicate when called with no key', () => {
      expect(statusesForPicker(statuses, empowerMe, null).map(s => s.key))
        .toEqual(['to_do', 'in_progress', 'done'])
    })
  })
})
