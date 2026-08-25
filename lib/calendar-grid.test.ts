import { describe, it, expect } from 'vitest'
import {
  iso, parseIso, daysInMonth, weekdayOf, addDays, addMonths,
  rangeDates, taskDueDate, stepAnchor, monthLabel, dayLabel,
} from './calendar-grid'

describe('building calendar dates', () => {
  it('pads month and day to two digits so the string sorts', () => {
    expect(iso(2026, 1, 5)).toBe('2026-01-05')
    expect(iso(2026, 12, 31)).toBe('2026-12-31')
  })

  it('sorts lexicographically in date order, which every range check relies on', () => {
    const dates = ['2026-12-31', '2026-01-05', '2026-02-01']
    expect([...dates].sort()).toEqual(['2026-01-05', '2026-02-01', '2026-12-31'])
  })

  it('round-trips through parseIso', () => {
    expect(parseIso('2026-08-25')).toEqual({ y: 2026, m: 8, d: 25 })
  })
})

describe('month lengths', () => {
  it('knows the short months', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('handles a leap year', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28)  // divisible by 100, not 400
    expect(daysInMonth(2000, 2)).toBe(29)
  })
})

describe('weekdays', () => {
  it('reads a known date correctly', () => {
    expect(weekdayOf('2026-08-25')).toBe(2)  // a Tuesday
    expect(weekdayOf('2026-08-23')).toBe(0)  // Sunday
  })

  // The whole reason this module exists: a bare YYYY-MM-DD parsed as an instant lands on the
  // previous day for anyone west of Greenwich.
  it('does not shift a date near midnight in either direction', () => {
    expect(weekdayOf('2026-01-01')).toBe(4)  // Thursday
    expect(weekdayOf('2026-12-31')).toBe(4)  // Thursday
  })
})

describe('adding days', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-02-01', -1)).toBe('2026-01-31')
  })

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('is its own inverse', () => {
    for (const start of ['2026-03-08', '2026-11-01', '2026-01-01']) {
      expect(addDays(addDays(start, 40), -40)).toBe(start)
    }
  })

  // 8 March 2026 and 1 November 2026 are US DST transitions. A day-arithmetic implementation
  // built on local-time Date objects loses or gains an hour here and can return the same day
  // twice; calendar arithmetic cannot.
  it('steps cleanly across both daylight-saving transitions', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })

  it('walks a whole year one day at a time and lands exactly one year on', () => {
    let cursor = '2026-01-01'
    for (let i = 0; i < 365; i++) cursor = addDays(cursor, 1)
    expect(cursor).toBe('2027-01-01')
  })
})

describe('adding months', () => {
  it('moves within a year', () => {
    expect(addMonths('2026-08-25', 1)).toBe('2026-09-25')
    expect(addMonths('2026-08-25', -1)).toBe('2026-07-25')
  })

  it('crosses a year boundary in both directions', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15')
  })

  // Rolling over is what `new Date` does by default and it is never what a person paging
  // through a calendar means.
  it('clamps the day instead of rolling into the next month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
})

describe('the grid a range covers', () => {
  it('a day is one cell', () => {
    expect(rangeDates('2026-08-25', 'day')).toEqual(['2026-08-25'])
  })

  it('a week is seven cells starting on Sunday', () => {
    const week = rangeDates('2026-08-25', 'week')
    expect(week).toHaveLength(7)
    expect(week[0]).toBe('2026-08-23')
    expect(weekdayOf(week[0])).toBe(0)
    expect(week[6]).toBe('2026-08-29')
  })

  it('the anchor is always inside its own week', () => {
    for (const day of ['2026-08-23', '2026-08-25', '2026-08-29']) {
      expect(rangeDates(day, 'week')).toContain(day)
    }
  })

  it('a month is a whole number of weeks, so the grid is rectangular', () => {
    for (const anchor of ['2026-02-10', '2026-08-25', '2028-02-10', '2026-05-01']) {
      expect(rangeDates(anchor, 'month').length % 7).toBe(0)
    }
  })

  it('starts on a Sunday and includes every day of the month', () => {
    const cells = rangeDates('2026-08-25', 'month')
    expect(weekdayOf(cells[0])).toBe(0)
    for (let d = 1; d <= 31; d++) expect(cells).toContain(iso(2026, 8, d))
  })

  // The classic off-by-one: a month whose last day lands in a new week loses its final row.
  it('includes the last day of a month that ends on a Sunday', () => {
    // 31 May 2026 is a Sunday.
    expect(weekdayOf('2026-05-31')).toBe(0)
    expect(rangeDates('2026-05-15', 'month')).toContain('2026-05-31')
  })

  it('includes 29 February in a leap year', () => {
    expect(rangeDates('2028-02-10', 'month')).toContain('2028-02-29')
  })

  it('never repeats a cell', () => {
    const cells = rangeDates('2026-08-25', 'month')
    expect(new Set(cells).size).toBe(cells.length)
  })

  it('is contiguous - every cell is one day after the last', () => {
    const cells = rangeDates('2026-08-25', 'month')
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]).toBe(addDays(cells[i - 1], 1))
    }
  })
})

describe('stepping the anchor', () => {
  it('moves a month at a time in month range', () => {
    expect(stepAnchor('2026-08-25', 'month', 1)).toBe('2026-09-25')
  })

  it('moves seven days at a time in week range', () => {
    expect(stepAnchor('2026-08-25', 'week', 1)).toBe('2026-09-01')
    expect(stepAnchor('2026-08-25', 'week', -1)).toBe('2026-08-18')
  })

  it('moves one day at a time in day range', () => {
    expect(stepAnchor('2026-08-25', 'day', 1)).toBe('2026-08-26')
  })
})

describe('reading a due date off a task', () => {
  // Returning it untouched is the point: re-zoning a bare date is the bug.
  it('passes a date-only value through unchanged', () => {
    expect(taskDueDate({ due_date: '2026-08-25' })).toBe('2026-08-25')
  })

  it('is null when there is no date', () => {
    expect(taskDueDate({ due_date: null })).toBeNull()
    expect(taskDueDate({})).toBeNull()
    expect(taskDueDate({ due_date: '' })).toBeNull()
  })

  it('is null rather than NaN for an unparseable value', () => {
    expect(taskDueDate({ due_date: 'not a date' })).toBeNull()
  })

  it('resolves a full timestamp through the business calendar', () => {
    // 2026-08-25T02:00:00Z is still 24 August in America/Chicago.
    expect(taskDueDate({ due_date: '2026-08-25T02:00:00Z' })).toBe('2026-08-24')
    expect(taskDueDate({ due_date: '2026-08-25T18:00:00Z' })).toBe('2026-08-25')
  })
})

describe('labels', () => {
  it('names the month and year', () => {
    expect(monthLabel('2026-08-25')).toBe('August 2026')
  })

  it('names the day without shifting it', () => {
    expect(dayLabel('2026-08-25')).toContain('August 25')
    expect(dayLabel('2026-01-01')).toContain('January 1')
  })
})
