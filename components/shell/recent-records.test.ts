import { describe, it, expect } from 'vitest'
import {
  RECENT_LIMIT,
  forgetRecord,
  parseRecentRecords,
  recentStorageKey,
  rememberRecord,
  serializeRecentRecords,
  type RecentRecord,
} from './recent-records'

function board(n: number, at = n): RecentRecord {
  return { key: `board:${n}`, kind: 'board', label: `Board ${n}`, href: `/dashboard/board/${n}`, at }
}

describe('rememberRecord', () => {
  it('puts the newest visit first', () => {
    const list = rememberRecord(rememberRecord([], board(1)), board(2))
    expect(list.map((r) => r.key)).toEqual(['board:2', 'board:1'])
  })

  // The whole point of a "recent" list: revisiting moves an entry, it does not clone it.
  it('moves a revisited record to the top instead of duplicating it', () => {
    const list = [board(1), board(2), board(3)].reduce(rememberRecordReducer, [] as RecentRecord[])
    const revisited = rememberRecord(list, board(1))
    expect(revisited.map((r) => r.key)).toEqual(['board:1', 'board:3', 'board:2'])
    expect(revisited).toHaveLength(3)
  })

  // A renamed board must not linger under both its old and new name.
  it('refreshes the label of a revisited record', () => {
    const list = rememberRecord([], board(1))
    const renamed = rememberRecord(list, { ...board(1), label: 'Renamed' })
    expect(renamed).toHaveLength(1)
    expect(renamed[0].label).toBe('Renamed')
  })

  it('caps the list at the limit, dropping the oldest', () => {
    let list: RecentRecord[] = []
    for (let i = 0; i < RECENT_LIMIT + 4; i++) list = rememberRecord(list, board(i))
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(list[0].key).toBe(`board:${RECENT_LIMIT + 3}`)
    expect(list.some((r) => r.key === 'board:0')).toBe(false)
  })

  it('stamps a timestamp when the caller omits one', () => {
    const before = Date.now()
    const [record] = rememberRecord([], { key: 'board:x', kind: 'board', label: 'X', href: '/x' })
    expect(record.at).toBeGreaterThanOrEqual(before)
  })
})

function rememberRecordReducer(acc: RecentRecord[], entry: RecentRecord) {
  return rememberRecord(acc, entry)
}

describe('forgetRecord', () => {
  it('removes only the named record', () => {
    const list = [board(1), board(2)]
    expect(forgetRecord(list, 'board:1').map((r) => r.key)).toEqual(['board:2'])
  })

  it('is a no-op for an unknown key', () => {
    const list = [board(1)]
    expect(forgetRecord(list, 'board:nope')).toEqual(list)
  })
})

describe('parseRecentRecords', () => {
  it('round-trips a serialized list', () => {
    const list = [board(1), board(2)]
    expect(parseRecentRecords(serializeRecentRecords(list))).toEqual(list)
  })

  // The shell renders this on every page. Bad JSON must degrade to "no history" rather
  // than throwing and taking the sidebar down with it.
  it('degrades to empty for missing, malformed, or wrongly-shaped values', () => {
    expect(parseRecentRecords(null)).toEqual([])
    expect(parseRecentRecords('not json')).toEqual([])
    expect(parseRecentRecords('{"not":"an array"}')).toEqual([])
  })

  it('drops individual entries that fail the shape check', () => {
    const raw = JSON.stringify([board(1), { key: 'x' }, { ...board(2), kind: 'nonsense' }])
    expect(parseRecentRecords(raw).map((r) => r.key)).toEqual(['board:1'])
  })

  it('truncates an over-long persisted list', () => {
    const raw = JSON.stringify(Array.from({ length: 50 }, (_, i) => board(i)))
    expect(parseRecentRecords(raw)).toHaveLength(RECENT_LIMIT)
  })
})

describe('recentStorageKey', () => {
  it('is per-user so two accounts on one browser stay separate', () => {
    expect(recentStorageKey('a')).not.toBe(recentStorageKey('b'))
  })
})
