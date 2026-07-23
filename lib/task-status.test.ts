import { describe, it, expect } from 'vitest'
import {
  getNormalizedTaskStatus,
  getTaskStatusLabel,
  getEffectiveStatusKey,
  findColumnForStatus,
} from './task-status'

describe('getNormalizedTaskStatus — FK first (columns.status_key)', () => {
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

describe('getNormalizedTaskStatus — legacy fallback (no status_key)', () => {
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

describe('getEffectiveStatusKey — FK first', () => {
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

describe('findColumnForStatus — FK first', () => {
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
