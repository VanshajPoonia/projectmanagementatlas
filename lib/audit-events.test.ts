import { describe, expect, it } from 'vitest'
import {
  actorLabel,
  categoryOf,
  filterByCategory,
  formatTime,
  groupByDay,
  toneOf,
  type AuditEvent,
} from './audit-events'

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: over.id ?? crypto.randomUUID(),
  occurred_at: over.occurred_at ?? '2026-08-13T10:00:00.000Z',
  actor_id: over.actor_id ?? 'actor-1',
  action: over.action ?? 'board_member.added',
  entity_type: over.entity_type ?? 'board',
  entity_id: over.entity_id ?? 'board-1',
  subject_id: over.subject_id ?? 'subject-1',
  summary: over.summary ?? 'Someone was given full access to a board.',
  metadata: over.metadata ?? {},
})

describe('categoryOf', () => {
  it('buckets each trigger family', () => {
    expect(categoryOf({ action: 'board_member.added' })).toBe('boards')
    expect(categoryOf({ action: 'board_member.role_changed' })).toBe('boards')
    expect(categoryOf({ action: 'team_member.removed' })).toBe('teams')
    expect(categoryOf({ action: 'calendar_member.added' })).toBe('calendars')
    expect(categoryOf({ action: 'profile.role_changed' })).toBe('people')
    expect(categoryOf({ action: 'module.toggled' })).toBe('modules')
  })

  // An action written by a future migration must still render, in a bucket of its own,
  // rather than being silently filed under Boards or dropped from the list.
  it('files an unknown action under other rather than guessing', () => {
    expect(categoryOf({ action: 'something.new' })).toBe('other')
  })
})

describe('filterByCategory', () => {
  const events = [
    event({ action: 'board_member.added' }),
    event({ action: 'team_member.added' }),
    event({ action: 'profile.role_changed' }),
  ]

  it('returns everything for all', () => {
    expect(filterByCategory(events, 'all')).toHaveLength(3)
  })

  it('narrows to one family', () => {
    expect(filterByCategory(events, 'teams').map((e) => e.action)).toEqual(['team_member.added'])
  })

  it('returns a copy, not the original array', () => {
    expect(filterByCategory(events, 'all')).not.toBe(events)
  })

  it('yields nothing when no event matches', () => {
    expect(filterByCategory(events, 'modules')).toEqual([])
  })
})

describe('toneOf', () => {
  it('marks grants, revocations and changes apart', () => {
    expect(toneOf({ action: 'board_member.added' })).toBe('grant')
    expect(toneOf({ action: 'team_member.removed' })).toBe('revoke')
    expect(toneOf({ action: 'board_member.role_changed' })).toBe('change')
    expect(toneOf({ action: 'module.toggled' })).toBe('change')
  })
})

describe('groupByDay', () => {
  const now = new Date(2026, 7, 13, 15, 0, 0) // 13 Aug 2026, local

  it('labels today and yesterday relatively', () => {
    const groups = groupByDay(
      [
        event({ occurred_at: new Date(2026, 7, 13, 9, 0).toISOString() }),
        event({ occurred_at: new Date(2026, 7, 12, 9, 0).toISOString() }),
      ],
      now,
    )
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
  })

  it('puts newer days first', () => {
    const groups = groupByDay(
      [
        event({ occurred_at: new Date(2026, 7, 10, 9, 0).toISOString() }),
        event({ occurred_at: new Date(2026, 7, 13, 9, 0).toISOString() }),
        event({ occurred_at: new Date(2026, 7, 11, 9, 0).toISOString() }),
      ],
      now,
    )
    expect(groups[0].label).toBe('Today')
    expect(groups.map((g) => g.date)).toEqual(['2026-08-13', '2026-08-11', '2026-08-10'])
  })

  it('puts newer events first inside a day', () => {
    const groups = groupByDay(
      [
        event({ id: 'early', occurred_at: new Date(2026, 7, 13, 8, 0).toISOString() }),
        event({ id: 'late', occurred_at: new Date(2026, 7, 13, 17, 0).toISOString() }),
      ],
      now,
    )
    expect(groups[0].events.map((e) => e.id)).toEqual(['late', 'early'])
  })

  it('groups by the reader’s local day, not UTC', () => {
    // 23:30 local on the 13th. Grouping on the UTC date would file this under the 14th for
    // anyone west of Greenwich, splitting one working evening across two headings.
    const late = new Date(2026, 7, 13, 23, 30)
    const groups = groupByDay([event({ occurred_at: late.toISOString() })], now)
    expect(groups[0].date).toBe('2026-08-13')
    expect(groups[0].label).toBe('Today')
  })

  it('skips an unparseable timestamp instead of throwing', () => {
    const groups = groupByDay([event({ occurred_at: 'not a date' }), event()], now)
    expect(groups).toHaveLength(1)
    expect(groups[0].events).toHaveLength(1)
  })

  it('returns nothing for an empty log', () => {
    expect(groupByDay([], now)).toEqual([])
  })

  it('includes the year only for days outside the current one', () => {
    const groups = groupByDay([event({ occurred_at: new Date(2025, 0, 5, 9, 0).toISOString() })], now)
    expect(groups[0].label).toMatch(/2025/)
  })
})

describe('actorLabel', () => {
  const names = new Map([['actor-1', 'Kayla Viehland']])

  it('names a known actor', () => {
    expect(actorLabel({ actor_id: 'actor-1' }, names)).toBe('Kayla Viehland')
  })

  // auth.uid() is null for the service role and for raw SQL, which is most migrations.
  it('calls a null actor System rather than blank', () => {
    expect(actorLabel({ actor_id: null }, names)).toBe('System')
  })

  it('does not pretend to know a deleted user', () => {
    expect(actorLabel({ actor_id: 'gone' }, names)).toBe('A removed user')
  })
})

describe('formatTime', () => {
  it('formats a wall-clock time', () => {
    expect(formatTime(new Date(2026, 7, 13, 14, 5).toISOString())).toMatch(/2:05/)
  })

  it('returns empty for an unparseable value rather than "Invalid Date"', () => {
    expect(formatTime('nonsense')).toBe('')
  })
})
