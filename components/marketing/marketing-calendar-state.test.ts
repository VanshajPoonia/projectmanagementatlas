import { describe, expect, it } from 'vitest'
import {
  buildCustomWeekdayDateKeys,
  buildScheduleGridMonths,
  buildRecurringDateKeys,
  buildRecurringSeriesScheduleUpdates,
  centeredScrollLeft,
  dayLabelForDateKey,
  isImportedWeekendPlaceholder,
  MAX_SCHEDULED_MARKETING_POSTS,
  moveListItem,
  marketingCalendarStorageKey,
  reconcileCompanySelection,
  resolveSelectedCalendarId,
  toggleCompanySelection,
} from './marketing-calendar-state'

const allCompanies = ['srg', 'agc']

describe('marketing calendar company filter', () => {
  it('isolates a company when it is clicked from All', () => {
    expect(toggleCompanySelection([], 'agc')).toEqual(['agc'])
    expect(toggleCompanySelection([], 'srg')).toEqual(['srg'])
  })

  it('returns to All when the last selected company is turned off', () => {
    expect(toggleCompanySelection(['agc'], 'agc')).toEqual([])
  })

  it('switches directly between companies instead of falling back to All', () => {
    expect(toggleCompanySelection(['srg'], 'agc')).toEqual(['agc'])
    expect(toggleCompanySelection(['agc'], 'srg')).toEqual(['srg'])
  })

  it('preserves valid filters and removes archived company ids on refresh', () => {
    expect(reconcileCompanySelection(['agc', 'archived'], allCompanies)).toEqual(['agc'])
    expect(reconcileCompanySelection(['archived'], allCompanies)).toEqual([])
  })

  it('keeps the most recently selected company from legacy multi-select state', () => {
    expect(reconcileCompanySelection(['srg', 'agc'], allCompanies)).toEqual(['agc'])
  })
})

describe('marketing calendar column reordering', () => {
  const columns = ['fb', 'ig', 'blog', 'email']

  it('moves a column to a later slot, shifting the ones it passes left', () => {
    expect(moveListItem(columns, 0, 2)).toEqual(['ig', 'blog', 'fb', 'email'])
  })

  it('moves a column to an earlier slot', () => {
    expect(moveListItem(columns, 3, 1)).toEqual(['fb', 'email', 'ig', 'blog'])
  })

  it('never drops or duplicates a column', () => {
    for (let from = 0; from < columns.length; from++) {
      for (let to = 0; to < columns.length; to++) {
        expect([...moveListItem(columns, from, to)].sort()).toEqual([...columns].sort())
      }
    }
  })

  it('returns the original array by reference for a no-op move, so no write is sent', () => {
    expect(moveListItem(columns, 2, 2)).toBe(columns)
    expect(moveListItem(columns, -1, 1)).toBe(columns)
    expect(moveListItem(columns, 1, columns.length)).toBe(columns)
    expect(moveListItem(columns, columns.length, 0)).toBe(columns)
  })

  it('leaves the source array untouched', () => {
    const original = [...columns]
    moveListItem(columns, 0, 3)
    expect(columns).toEqual(original)
  })
})

describe('marketing calendar Today navigation', () => {
  it('centers today using scroll-container-relative geometry', () => {
    expect(centeredScrollLeft({
      currentScrollLeft: 640,
      containerLeft: 80,
      containerWidth: 360,
      targetLeft: 410,
      targetWidth: 150,
    })).toBe(865)
  })

  it('never scrolls before the start of the week board', () => {
    expect(centeredScrollLeft({
      currentScrollLeft: 0,
      containerLeft: 80,
      containerWidth: 900,
      targetLeft: 120,
      targetWidth: 150,
    })).toBe(0)
  })
})

describe('recurring marketing event editing', () => {
  it('moves every repeat by the same date offset', () => {
    expect(buildRecurringSeriesScheduleUpdates(
      [
        { id: 'first', date: '2026-07-28', channel: 'social' },
        { id: 'second', date: '2026-08-04', channel: 'social' },
        { id: 'third', date: '2026-08-11', channel: 'social' },
      ],
      {
        anchorDate: '2026-07-28',
        nextDate: '2026-07-30',
        anchorChannel: 'social',
        nextChannel: 'instagram',
      },
    )).toEqual([
      { id: 'first', date: '2026-07-30', day_label: 'THU', channel: 'instagram' },
      { id: 'second', date: '2026-08-06', day_label: 'THU', channel: 'instagram' },
      { id: 'third', date: '2026-08-13', day_label: 'THU', channel: 'instagram' },
    ])
  })

  it('keeps other channel streams intact while moving their dates', () => {
    expect(buildRecurringSeriesScheduleUpdates(
      [
        { id: 'social', date: '2026-07-31', channel: 'social' },
        { id: 'email', date: '2026-07-31', channel: 'email' },
      ],
      {
        anchorDate: '2026-07-31',
        nextDate: '2026-08-01',
        anchorChannel: 'social',
        nextChannel: 'instagram',
      },
    )).toEqual([
      { id: 'social', date: '2026-08-01', day_label: 'SAT', channel: 'instagram' },
      { id: 'email', date: '2026-08-01', day_label: 'SAT', channel: 'email' },
    ])
  })
})

describe('recurring marketing event creation', () => {
  it('matches the screenshot weekly range using an inclusive cutoff', () => {
    const dates = buildRecurringDateKeys(
      '2026-07-31',
      'weekly',
      '2026-12-31',
    )

    expect(dates).toHaveLength(22)
    expect(dates.slice(0, 3)).toEqual([
      '2026-07-31',
      '2026-08-07',
      '2026-08-14',
    ])
    expect(dates.at(-1)).toBe('2026-12-25')
    expect(dates.every(date => dayLabelForDateKey(date) === 'FRI')).toBe(true)
  })

  it('does not silently stop daily schedules after 104 dates', () => {
    const dates = buildRecurringDateKeys(
      '2026-07-31',
      'daily',
      '2026-12-31',
    )

    expect(dates).toHaveLength(154)
    expect(dates.at(-1)).toBe('2026-12-31')
  })

  it('keeps the original day-of-month after a short month', () => {
    expect(buildRecurringDateKeys(
      '2027-01-31',
      'monthly',
      '2027-05-31',
    )).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
    ])
  })

  it('handles leap years and quarterly month-end clamping', () => {
    expect(buildRecurringDateKeys(
      '2028-01-31',
      'monthly',
      '2028-03-31',
    )).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ])

    expect(buildRecurringDateKeys(
      '2026-11-30',
      'quarterly',
      '2027-08-31',
    )).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
      '2027-08-30',
    ])
  })

  it('returns no dates for invalid or reversed ranges', () => {
    expect(buildRecurringDateKeys('2026-02-30', 'daily', '2026-03-10')).toEqual([])
    expect(buildRecurringDateKeys('2026-08-01', 'weekly', '2026-07-01')).toEqual([])
  })

  it('returns one extra date so oversized schedules can be rejected explicitly', () => {
    const dates = buildRecurringDateKeys(
      '2020-01-01',
      'daily',
      '2030-01-01',
    )
    expect(dates).toHaveLength(MAX_SCHEDULED_MARKETING_POSTS + 1)
  })
})

describe('custom weekday marketing schedule', () => {
  it('keeps only the selected weekdays, in order, across a multi-week range', () => {
    expect(buildCustomWeekdayDateKeys(
      '2026-07-28', // Tue
      '2026-08-11', // Tue
      [2, 4], // Tue, Thu
    )).toEqual([
      '2026-07-28',
      '2026-07-30',
      '2026-08-04',
      '2026-08-06',
      '2026-08-11',
    ])
  })

  it('returns no dates when no weekday is selected, unlike an empty restriction range', () => {
    expect(buildCustomWeekdayDateKeys('2026-07-28', '2026-08-11', [])).toEqual([])
  })

  it('returns no dates for a reversed range', () => {
    expect(buildCustomWeekdayDateKeys('2026-08-11', '2026-07-28', [2])).toEqual([])
  })

  it('returns no dates for a malformed date key', () => {
    expect(buildCustomWeekdayDateKeys('2026-02-30', '2026-03-10', [1])).toEqual([])
  })

  it('includes a single-day range only when its weekday is selected', () => {
    expect(buildCustomWeekdayDateKeys('2026-07-28', '2026-07-28', [2])).toEqual(['2026-07-28'])
    expect(buildCustomWeekdayDateKeys('2026-07-28', '2026-07-28', [3])).toEqual([])
  })

  it('returns one extra date so oversized custom schedules can be rejected explicitly', () => {
    const dates = buildCustomWeekdayDateKeys(
      '2020-01-01',
      '2030-01-01',
      [0, 1, 2, 3, 4, 5, 6],
    )
    expect(dates).toHaveLength(MAX_SCHEDULED_MARKETING_POSTS + 1)
  })
})

describe('imported weekend placeholders', () => {
  it('recognizes exact imported Sat/Sun wk filler rows', () => {
    expect(isImportedWeekendPlaceholder({
      source_sheet: '2026 Calendar',
      day_label: 'SAT',
      content: ' wk ',
    })).toBe(true)
  })

  it('keeps real weekend posts and user-created events', () => {
    expect(isImportedWeekendPlaceholder({
      source_sheet: '2026 Calendar',
      day_label: 'SAT',
      content: 'Happy 4th',
    })).toBe(false)
    expect(isImportedWeekendPlaceholder({
      source_sheet: null,
      day_label: 'SUN',
      content: 'wk',
    })).toBe(false)
  })
})

describe('buildScheduleGridMonths', () => {
  const flat = (months: ReturnType<typeof buildScheduleGridMonths>) =>
    months.flatMap((m) => m.weeks.flat()).filter((c): c is NonNullable<typeof c> => c !== null)

  it('lays a single month out as Sunday-first weeks', () => {
    const months = buildScheduleGridMonths('2026-08-01', '2026-08-31')
    expect(months).toHaveLength(1)
    expect(months[0].monthKey).toBe('2026-08-01')
    // 2026-08-01 is a Saturday, so the first week is six nulls then the 1st.
    expect(months[0].weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(months[0].weeks[0][6]?.dateKey).toBe('2026-08-01')
    expect(months[0].weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('emits every day of the month exactly once', () => {
    const cells = flat(buildScheduleGridMonths('2026-08-01', '2026-08-31'))
    expect(cells).toHaveLength(31)
    expect(new Set(cells.map((c) => c.dateKey)).size).toBe(31)
  })

  it('spans several months when the range does', () => {
    const months = buildScheduleGridMonths('2026-08-20', '2026-10-03')
    expect(months.map((m) => m.monthKey)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
  })

  it('marks days outside the range so they can be greyed and left unclickable', () => {
    const cells = flat(buildScheduleGridMonths('2026-08-10', '2026-08-12'))
    const inRange = cells.filter((c) => c.inRange).map((c) => c.dateKey)
    expect(inRange).toEqual(['2026-08-10', '2026-08-11', '2026-08-12'])
    // The rest of August is still laid out, just not selectable.
    expect(cells.length).toBe(31)
  })

  it('handles a leap February', () => {
    const cells = flat(buildScheduleGridMonths('2028-02-01', '2028-02-29'))
    expect(cells).toHaveLength(29)
    expect(cells.at(-1)?.dateKey).toBe('2028-02-29')
  })

  it('returns nothing for an inverted or unparseable range', () => {
    expect(buildScheduleGridMonths('2026-08-31', '2026-08-01')).toEqual([])
    expect(buildScheduleGridMonths('2026-02-30', '2026-03-10')).toEqual([])
    expect(buildScheduleGridMonths('', '2026-03-10')).toEqual([])
  })

  it('refuses a range too wide to lay out, so the caller falls back to the list', () => {
    expect(buildScheduleGridMonths('2026-01-01', '2027-06-30')).toEqual([])
    expect(buildScheduleGridMonths('2026-01-01', '2026-12-31').length).toBe(12)
  })
})

describe('which calendar the switcher opens on', () => {
  // Mirrors production: an admin sees all three, ordered by name, and the alphabetically
  // first one is an empty calendar nobody is a member of.
  const kaylaPersonal = { id: 'personal', member_user_ids: [] }
  const marketing = { id: 'marketing', member_user_ids: ['kayla'] }
  const test = { id: 'test', member_user_ids: ['bobby', 'kayla'] }
  const all = [kaylaPersonal, marketing, test]

  it('does not open a calendar the viewer holds no membership row on', () => {
    expect(
      resolveSelectedCalendarId({ current: null, calendars: all, storedId: null, userId: 'kayla' }),
    ).toBe('marketing')
  })

  it('restores what the viewer last chose', () => {
    expect(
      resolveSelectedCalendarId({ current: null, calendars: all, storedId: 'test', userId: 'kayla' }),
    ).toBe('test')
  })

  it('ignores a stored calendar that was archived or is no longer reachable', () => {
    expect(
      resolveSelectedCalendarId({ current: null, calendars: [marketing], storedId: 'gone', userId: 'kayla' }),
    ).toBe('marketing')
  })

  it('keeps a live selection when the list is refetched', () => {
    // An admin creating or archiving a calendar re-runs this; re-deciding here would undo
    // the switch the user just made.
    expect(
      resolveSelectedCalendarId({ current: 'personal', calendars: all, storedId: 'test', userId: 'kayla' }),
    ).toBe('personal')
  })

  it('drops a live selection the viewer can no longer reach', () => {
    expect(
      resolveSelectedCalendarId({ current: 'personal', calendars: [marketing], storedId: null, userId: 'kayla' }),
    ).toBe('marketing')
  })

  it('falls back to the first calendar when the viewer is a member of none', () => {
    expect(
      resolveSelectedCalendarId({ current: null, calendars: all, storedId: null, userId: 'stranger' }),
    ).toBe('personal')
  })

  it('returns null when there is nothing to show', () => {
    expect(
      resolveSelectedCalendarId({ current: 'personal', calendars: [], storedId: 'test', userId: 'kayla' }),
    ).toBeNull()
  })

  it('keys the stored choice per user so a shared browser does not leak one', () => {
    expect(marketingCalendarStorageKey('kayla')).not.toBe(marketingCalendarStorageKey('bobby'))
  })
})
