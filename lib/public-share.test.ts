import { describe, expect, it } from 'vitest'
import {
  isPublicShareLinkActive,
  isPublicTaskAvailable,
  isValidShareToken,
  visiblePublicBoardTasks,
} from './public-share'

describe('public share availability', () => {
  it('accepts only the 256-bit token format emitted by the share dialog', () => {
    expect(isValidShareToken('a'.repeat(64))).toBe(true)
    expect(isValidShareToken('A1'.repeat(32))).toBe(true)
    expect(isValidShareToken('a'.repeat(63))).toBe(false)
    expect(isValidShareToken(`${'a'.repeat(63)}-`)).toBe(false)
  })

  it('rejects revoked, expired, and malformed-expiry links', () => {
    const now = Date.parse('2026-07-28T12:00:00.000Z')

    expect(isPublicShareLinkActive({ revoked_at: null, expires_at: null }, now)).toBe(true)
    expect(isPublicShareLinkActive({
      revoked_at: null,
      expires_at: '2026-07-28T12:00:01.000Z',
    }, now)).toBe(true)
    expect(isPublicShareLinkActive({
      revoked_at: '2026-07-28T11:00:00.000Z',
      expires_at: null,
    }, now)).toBe(false)
    expect(isPublicShareLinkActive({
      revoked_at: null,
      expires_at: '2026-07-28T12:00:00.000Z',
    }, now)).toBe(false)
    expect(isPublicShareLinkActive({ revoked_at: null, expires_at: 'not-a-date' }, now)).toBe(false)
  })

  it('rejects archived or deleted tasks and tasks on archived boards', () => {
    expect(isPublicTaskAvailable({
      deleted_at: null,
      archived_at: null,
      column: { board: { archived_at: null } },
    })).toBe(true)
    expect(isPublicTaskAvailable({ deleted_at: '2026-07-28T12:00:00Z' })).toBe(false)
    expect(isPublicTaskAvailable({ archived_at: '2026-07-28T12:00:00Z' })).toBe(false)
    expect(isPublicTaskAvailable({
      column: { board: { archived_at: '2026-07-28T12:00:00Z' } },
    })).toBe(false)
  })

  it('omits unavailable tasks and subtasks from a shared board', () => {
    const tasks = [
      { id: 'active', deleted_at: null, archived_at: null, parent_task_id: null },
      { id: 'archived', deleted_at: null, archived_at: '2026-07-28', parent_task_id: null },
      { id: 'deleted', deleted_at: '2026-07-28', archived_at: null, parent_task_id: null },
      { id: 'subtask', deleted_at: null, archived_at: null, parent_task_id: 'active' },
    ]

    expect(visiblePublicBoardTasks(tasks).map(task => task.id)).toEqual(['active'])
  })
})
