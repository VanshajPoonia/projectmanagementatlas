import { describe, it, expect } from 'vitest'
import {
  FIRST_SEQUENCE,
  LAST_SEQUENCE,
  centralYearMonth,
  formatClaimedAt,
  formatProjectId,
  matchesProjectIdSearch,
  nextSequence,
  upcomingProjectIds,
  usedThisMonth,
  type ProjectIdRow,
} from './project-ids'

function row(overrides: Partial<ProjectIdRow> = {}): ProjectIdRow {
  return {
    id: 'row-1',
    project_id: '26081111',
    year_month: '2608',
    seq: 1111,
    client_name: 'Acme Roofing',
    company_id: null,
    grabbed_by: 'user-1',
    grabbed_by_name: 'Bobby Shanks',
    grabbed_at: '2026-08-11T22:39:08.000Z',
    ...overrides,
  }
}

describe('project ID numbering', () => {
  it('formats a number as YYMM followed by the sequence', () => {
    expect(formatProjectId('2608', 1111)).toBe('26081111')
    expect(formatProjectId('2612', 9999)).toBe('26129999')
  })

  it('starts a fresh month at 1111', () => {
    expect(nextSequence([], '2608')).toBe(FIRST_SEQUENCE)
    expect(nextSequence([row({ year_month: '2607', seq: 1150 })], '2608')).toBe(FIRST_SEQUENCE)
  })

  it('continues from the highest sequence already used this month', () => {
    const rows = [row({ seq: 1111 }), row({ seq: 1113 }), row({ seq: 1112 })]
    expect(nextSequence(rows, '2608')).toBe(1114)
  })

  // The guarantee the whole feature rests on: a number must never come back around. Counting
  // rows instead of taking the maximum would re-issue 1113 here.
  it('never re-issues a number after an earlier row disappears', () => {
    const rows = [row({ seq: 1111 }), row({ seq: 1112 }), row({ seq: 1113 })]
    const afterDeletion = rows.filter((r) => r.seq !== 1112)
    expect(nextSequence(afterDeletion, '2608')).toBe(1114)
  })

  it('counts only the current month as used', () => {
    const rows = [row({ year_month: '2608' }), row({ year_month: '2608' }), row({ year_month: '2607' })]
    expect(usedThisMonth(rows, '2608')).toBe(2)
    expect(usedThisMonth(rows, '2607')).toBe(1)
  })
})

describe('the upcoming-numbers preview', () => {
  it('lists the next numbers in order starting from the given sequence', () => {
    expect(upcomingProjectIds('2608', 1111, 3)).toEqual(['26081111', '26081112', '26081113'])
  })

  it('stops at the end of the month rather than rendering a 5-digit number', () => {
    const preview = upcomingProjectIds('2608', LAST_SEQUENCE - 1, 5)
    expect(preview).toEqual(['26089998', '26089999'])
    expect(preview.every((id) => id.length === 8)).toBe(true)
  })

  it('returns nothing once the month is exhausted', () => {
    expect(upcomingProjectIds('2608', LAST_SEQUENCE + 1, 5)).toEqual([])
  })
})

describe('the Central-time prefix', () => {
  it('uses Central time, not UTC, at the month boundary', () => {
    // 2026-09-01T02:00Z is 2026-08-31 21:00 in Chicago - still August's prefix.
    expect(centralYearMonth(new Date('2026-09-01T02:00:00Z'))).toBe('2608')
    // Six hours later it is genuinely September in Chicago too.
    expect(centralYearMonth(new Date('2026-09-01T08:00:00Z'))).toBe('2609')
  })

  it('zero-pads single-digit months', () => {
    expect(centralYearMonth(new Date('2026-03-15T18:00:00Z'))).toBe('2603')
  })

  it('formats claim timestamps in Central time', () => {
    // 22:39Z on Aug 11 is 5:39pm Central the same day.
    expect(formatClaimedAt('2026-08-11T22:39:08.000Z')).toContain('5:39')
    expect(formatClaimedAt('2026-08-11T22:39:08.000Z')).toContain('Aug 11, 2026')
  })

  it('does not crash on an unreadable timestamp', () => {
    expect(formatClaimedAt('not-a-date')).toBe('-')
  })
})

describe('history search', () => {
  const entry = row({ project_id: '26081115', client_name: 'Riverside Build', grabbed_by_name: 'Kayla Viehland' })

  it('matches on the project number', () => {
    expect(matchesProjectIdSearch(entry, '1115')).toBe(true)
  })

  it('matches on the client, case-insensitively', () => {
    expect(matchesProjectIdSearch(entry, 'riverside')).toBe(true)
  })

  it('matches on who grabbed it', () => {
    expect(matchesProjectIdSearch(entry, 'Kayla')).toBe(true)
  })

  it('shows everything for an empty or whitespace query', () => {
    expect(matchesProjectIdSearch(entry, '')).toBe(true)
    expect(matchesProjectIdSearch(entry, '   ')).toBe(true)
  })

  it('excludes rows that match nothing', () => {
    expect(matchesProjectIdSearch(entry, 'nonexistent')).toBe(false)
  })
})
