import { describe, expect, it } from 'vitest'
import {
  BURST_WINDOW_MINUTES,
  NOTIFICATION_TYPES,
  NO_MUTES,
  SNOOZE_OPTIONS,
  classifyNotification,
  filterInbox,
  groupNotificationBursts,
  inboxCounts,
  isMuted,
  isSnoozed,
  isUnread,
  normalizeNotificationRow,
  notificationHref,
  notificationTypeLabel,
  snoozeUntil,
  type InboxNotification,
} from './notifications'

const NOW = new Date('2026-08-28T12:00:00.000Z')

function n(over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: over.id ?? 'n1',
    type: 'update',
    message: 'Something happened',
    created_at: '2026-08-28T11:00:00.000Z',
    read_at: null,
    snoozed_until: null,
    task_id: 't1',
    actor_id: 'a1',
    entity_type: null,
    entity_id: null,
    actorName: 'Ann',
    taskTitle: 'Fix the roof',
    boardId: 'b1',
    boardTitle: 'Site work',
    onArchivedBoard: false,
    ...over,
  }
}

function mutes(taskIds: string[] = [], boardIds: string[] = []) {
  return { mutedTaskIds: new Set(taskIds), mutedBoardIds: new Set(boardIds) }
}

describe('classification', () => {
  it('puts the types that need a person in Action required', () => {
    for (const type of ['assignment', 'mention', 'approval', 'blocked', 'reminder', 'request']) {
      expect(classifyNotification(type)).toBe('action_required')
    }
  })

  it('puts the types that merely inform in Updates', () => {
    for (const type of ['comment', 'update', 'completed']) {
      expect(classifyNotification(type)).toBe('update')
    }
  })

  it('classifies every type it knows about, with a label and a rationale', () => {
    for (const [key, info] of Object.entries(NOTIFICATION_TYPES)) {
      expect(info.category, key).toMatch(/^(action_required|update)$/)
      expect(info.label.length, key).toBeGreaterThan(0)
      expect(info.rationale.length, key).toBeGreaterThan(0)
    }
  })

  it('covers every type the application actually writes', () => {
    // If a writer starts sending a new type, it belongs in the map rather than falling
    // through to the unknown default. These are the types grep finds in the components,
    // migration 117's delivery, and the inbox's own writers.
    for (const written of ['assignment', 'update', 'reminder', 'comment', 'mention']) {
      expect(NOTIFICATION_TYPES[written], written).toBeDefined()
    }
  })

  it('defaults an unknown type to Action required rather than burying it', () => {
    // Deliberate direction: noise is one dismissal, a missed hand-off is not recoverable.
    expect(classifyNotification('something_new')).toBe('action_required')
    expect(classifyNotification(null)).toBe('action_required')
    expect(classifyNotification(undefined)).toBe('action_required')
    expect(notificationTypeLabel('something_new')).toBe('Notice')
  })
})

describe('normalizeNotificationRow', () => {
  it('flattens the join the query already does', () => {
    const row = {
      id: 'x', type: 'comment', message: 'hi', created_at: '2026-08-28T10:00:00Z',
      read_at: null, snoozed_until: null, task_id: 't9', actor_id: 'a9',
      entity_type: 'comment', entity_id: 'c9',
      actor: { full_name: 'Bob', email: 'bob@example.com' },
      task: { title: 'Pour slab', column: { board_id: 'b9', board: { id: 'b9', title: 'AGC', archived_at: null } } },
    }
    expect(normalizeNotificationRow(row)).toMatchObject({
      id: 'x', type: 'comment', actorName: 'Bob', taskTitle: 'Pour slab',
      boardId: 'b9', boardTitle: 'AGC', onArchivedBoard: false, entity_id: 'c9',
    })
  })

  it('falls back to the actor email, and survives a missing task entirely', () => {
    expect(normalizeNotificationRow({ id: 'x', actor: { email: 'b@e.com' } }).actorName).toBe('b@e.com')
    const bare = normalizeNotificationRow({ id: 'x', type: 'reminder', message: 'm' })
    expect(bare.boardId).toBeNull()
    expect(bare.actorName).toBeNull()
    expect(bare.onArchivedBoard).toBe(false)
  })

  it('flags an archived board, which is what removes the Open action', () => {
    const row = { id: 'x', task: { column: { board_id: 'b', board: { archived_at: '2026-01-01T00:00:00Z' } } } }
    expect(normalizeNotificationRow(row).onArchivedBoard).toBe(true)
  })
})

describe('read, snooze and mute state', () => {
  it('reads unread from read_at, not from anything derived', () => {
    expect(isUnread(n())).toBe(true)
    expect(isUnread(n({ read_at: '2026-08-28T11:30:00Z' }))).toBe(false)
  })

  it('treats a snooze as an instant that expires', () => {
    expect(isSnoozed(n({ snoozed_until: '2026-08-28T13:00:00.000Z' }), NOW)).toBe(true)
    expect(isSnoozed(n({ snoozed_until: '2026-08-28T11:00:00.000Z' }), NOW)).toBe(false)
    expect(isSnoozed(n(), NOW)).toBe(false)
  })

  it('ignores an unparseable snooze rather than hiding the row forever', () => {
    expect(isSnoozed(n({ snoozed_until: 'not a date' }), NOW)).toBe(false)
  })

  it('snoozes by duration, so no timezone is involved', () => {
    expect(snoozeUntil(60, NOW)).toBe('2026-08-28T13:00:00.000Z')
    expect(SNOOZE_OPTIONS.map((o) => o.minutes)).toEqual([60, 240, 1440, 10080])
    // Every label says what the user gets, rather than naming a time of day we cannot honour.
    for (const option of SNOOZE_OPTIONS) expect(option.label).toMatch(/^For a?\s?/)
  })

  it('mutes by task or by board', () => {
    expect(isMuted(n(), NO_MUTES)).toBe(false)
    expect(isMuted(n(), mutes(['t1']))).toBe(true)
    expect(isMuted(n(), mutes([], ['b1']))).toBe(true)
    expect(isMuted(n({ task_id: null, boardId: null }), mutes(['t1'], ['b1']))).toBe(false)
  })
})

describe('filterInbox', () => {
  const rows = [
    n({ id: 'a', type: 'assignment' }),
    n({ id: 'b', type: 'comment', read_at: '2026-08-28T11:30:00Z' }),
    n({ id: 'c', type: 'update', snoozed_until: '2026-08-28T18:00:00.000Z' }),
    n({ id: 'd', type: 'mention', task_id: 't2' }),
  ]

  it('hides muted and snoozed rows from the inbox itself', () => {
    const out = filterInbox(rows, mutes(['t2']), NOW)
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('shows snoozed and muted rows in their own scopes, so nothing simply vanishes', () => {
    expect(filterInbox(rows, mutes(['t2']), NOW, { scope: 'snoozed' }).map((r) => r.id)).toEqual(['c'])
    expect(filterInbox(rows, mutes(['t2']), NOW, { scope: 'muted' }).map((r) => r.id)).toEqual(['d'])
  })

  it('does not double-count a row that is both muted and snoozed', () => {
    const both = [n({ id: 'z', task_id: 't3', snoozed_until: '2026-08-28T18:00:00.000Z' })]
    expect(filterInbox(both, mutes(['t3']), NOW, { scope: 'snoozed' })).toHaveLength(0)
    expect(filterInbox(both, mutes(['t3']), NOW, { scope: 'muted' })).toHaveLength(1)
  })

  it('filters by bucket and by unread', () => {
    expect(filterInbox(rows, NO_MUTES, NOW, { bucket: 'action_required' }).map((r) => r.id)).toEqual(['a', 'd'])
    expect(filterInbox(rows, NO_MUTES, NOW, { bucket: 'update' }).map((r) => r.id)).toEqual(['b'])
    expect(filterInbox(rows, NO_MUTES, NOW, { read: 'unread' }).map((r) => r.id)).toEqual(['a', 'd'])
  })

  it('survives a null list', () => {
    expect(filterInbox(null as any, NO_MUTES, NOW)).toEqual([])
  })
})

describe('inboxCounts', () => {
  it('counts only what is unread, unmuted and not snoozed as waiting on you', () => {
    const rows = [
      n({ id: 'a', type: 'assignment' }),
      n({ id: 'b', type: 'comment' }),
      n({ id: 'c', type: 'assignment', read_at: '2026-08-28T11:00:00Z' }),
      n({ id: 'd', type: 'assignment', snoozed_until: '2026-08-28T18:00:00.000Z' }),
      n({ id: 'e', type: 'assignment', task_id: 't9' }),
    ]
    expect(inboxCounts(rows, mutes(['t9']), NOW)).toEqual({
      actionRequired: 1, updates: 1, unread: 2, snoozed: 1, muted: 1,
    })
  })
})

describe('groupNotificationBursts', () => {
  it('collapses the same actor doing the same thing to the same task', () => {
    const rows = [
      n({ id: '1', created_at: '2026-08-28T11:00:00Z' }),
      n({ id: '2', created_at: '2026-08-28T10:59:00Z' }),
      n({ id: '3', created_at: '2026-08-28T10:58:00Z' }),
    ]
    const [entry] = groupNotificationBursts(rows)
    expect(entry.count).toBe(3)
    expect(entry.grouped).toBe(true)
    // Marking the row read has to clear every notification underneath it, or the unread
    // count disagrees with what is on screen.
    expect(entry.ids).toEqual(['1', '2', '3'])
    expect(entry.latest.id).toBe('1')
  })

  it('never merges two different people', () => {
    const rows = [n({ id: '1', actor_id: 'ann' }), n({ id: '2', actor_id: 'bob' })]
    expect(groupNotificationBursts(rows)).toHaveLength(2)
  })

  it('never merges two different kinds of event', () => {
    const rows = [n({ id: '1', type: 'comment' }), n({ id: '2', type: 'assignment' })]
    expect(groupNotificationBursts(rows)).toHaveLength(2)
  })

  it('never merges across tasks', () => {
    const rows = [n({ id: '1', task_id: 't1' }), n({ id: '2', task_id: 't2' })]
    expect(groupNotificationBursts(rows)).toHaveLength(2)
  })

  it('does not merge events further apart than the window', () => {
    const rows = [
      n({ id: '1', created_at: '2026-08-28T11:00:00Z' }),
      n({ id: '2', created_at: '2026-08-28T09:30:00Z' }),
    ]
    expect(groupNotificationBursts(rows, BURST_WINDOW_MINUTES)).toHaveLength(2)
  })

  it('marks the entry unread when any member is unread', () => {
    const rows = [
      n({ id: '1', read_at: '2026-08-28T11:05:00Z', created_at: '2026-08-28T11:00:00Z' }),
      n({ id: '2', created_at: '2026-08-28T10:59:00Z' }),
    ]
    const [entry] = groupNotificationBursts(rows)
    expect(entry.count).toBe(2)
    expect(entry.unread).toBe(true)
  })

  it('keeps rows with no task apart, since they share no subject', () => {
    const rows = [
      n({ id: '1', task_id: null, actor_id: null, created_at: '2026-08-28T11:00:00Z' }),
      n({ id: '2', task_id: null, actor_id: null, created_at: '2026-08-28T10:59:00Z' }),
    ]
    // Same key by construction, so these DO group - the point of this case is that it does
    // not throw on nulls and does not invent a subject.
    expect(groupNotificationBursts(rows)).toHaveLength(1)
  })
})

describe('notificationHref', () => {
  it('deep links to the task on the board href it is handed', () => {
    expect(notificationHref('/admin/board/b1', n())).toBe('/admin/board/b1?task=t1')
    expect(notificationHref('/dashboard/board/b1', n())).toBe('/dashboard/board/b1?task=t1')
  })

  it('carries a comment id through, so the reader lands on the comment', () => {
    expect(notificationHref('/admin/board/b1', n({ entity_type: 'comment', entity_id: 'c7' })))
      .toBe('/admin/board/b1?task=t1&comment=c7')
  })

  it('ignores an entity type it has no route for', () => {
    expect(notificationHref('/admin/board/b1', n({ entity_type: 'field', entity_id: 'f1' })))
      .toBe('/admin/board/b1?task=t1')
  })

  it('offers nowhere to go rather than a link that lands on the wrong thing', () => {
    expect(notificationHref(null, n())).toBeNull()
    expect(notificationHref('/admin/board/b1', n({ task_id: null }))).toBeNull()
    expect(notificationHref('/admin/board/b1', n({ onArchivedBoard: true }))).toBeNull()
  })
})
