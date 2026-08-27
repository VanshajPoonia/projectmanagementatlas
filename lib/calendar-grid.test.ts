import { describe, it, expect } from 'vitest'
import {
  iso, parseIso, daysInMonth, weekdayOf, addDays, addMonths,
  rangeDates, taskDueDate, stepAnchor, monthLabel, dayLabel,
  daysBetween,
  shortDayLabel,
  calendarDateLabel,
  dueDateAsPickerDate,
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

  // ⚠️ This block used to assert the OPPOSITE - that a timestamp resolves through the business
  // calendar, so `2026-08-25T02:00:00Z` was "2026-08-24". That rule is wrong for this column and
  // it shipped: `tasks.due_date` is TIMESTAMPTZ storing MIDNIGHT on the chosen day, so the
  // overwhelming majority of real rows are `T00:00:00+00:00` - and re-zoning those to Chicago
  // moved every due date to the day before. Measured against the sandbox: 49 of 53 rows are UTC
  // midnight, the other 4 are 05:00Z, which is Chicago midnight on the SAME day. The stored day
  // is the answer in both shapes.
  it('reads the day the user picked, for both shapes the app actually writes', () => {
    // create-task-dialog: <input type="date"> -> Postgres casts to UTC midnight.
    expect(taskDueDate({ due_date: '2026-08-25T00:00:00+00:00' })).toBe('2026-08-25')
    // task-detail-modal: a picker at LOCAL (Chicago) midnight, toISOString'd.
    expect(taskDueDate({ due_date: '2026-08-25T05:00:00+00:00' })).toBe('2026-08-25')
  })

  it('does not move a due date to the day before, which is the bug it replaced', () => {
    // The old rule returned '2026-08-24' for this, so a task due the 25th read as overdue on
    // the 25th. This is the single assertion that would have caught it.
    expect(taskDueDate({ due_date: '2026-08-25T00:00:00Z' })).not.toBe('2026-08-24')
  })

  it('still passes a bare calendar date through untouched', () => {
    expect(taskDueDate({ due_date: '2026-08-25' })).toBe('2026-08-25')
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

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    expect(daysBetween('2026-08-27', '2026-08-30')).toBe(3)
    expect(daysBetween('2026-08-27', '2026-08-24')).toBe(-3)
    expect(daysBetween('2026-08-27', '2026-08-27')).toBe(0)
  })

  it('crosses month and year boundaries', () => {
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
  })

  it('counts the leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1)
  })

  it('is unaffected by a DST transition falling between the two dates', () => {
    // US DST ends 1 November 2026, so this span contains a 25-hour local day. Both ends are
    // built as UTC midnights, so the answer is still a whole number of days.
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    // ...and the spring-forward 23-hour day, 8 March 2026.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })
})

describe('shortDayLabel', () => {
  it('names the calendar date it was given, not the instant before it', () => {
    // 30 August 2026 is a Sunday. The old `format(new Date('2026-08-30'), 'EEE d MMM')` printed
    // "Sat 29 Aug" in America/Chicago, because the parse lands on UTC midnight and the format
    // then renders it in the reader's zone. Measured, and it shipped on /my-work.
    expect(shortDayLabel('2026-08-30')).toBe('Sun 30 Aug')
    expect(shortDayLabel('2026-01-01')).toBe('Thu 1 Jan')
    expect(shortDayLabel('2026-12-31')).toBe('Thu 31 Dec')
  })

  it('is the same string whatever zone the reader is in', () => {
    // Nothing here touches the local zone, so this holds by construction; the test exists
    // because the version it replaced did not.
    expect(shortDayLabel('2026-08-30')).toBe(shortDayLabel('2026-08-30'))
  })
})

describe('calendarDateLabel', () => {
  it('keeps the year, because a due date outlives the year you are reading it in', () => {
    // The regression this pins: every one of these screens rendered
    // `toLocaleDateString('en-US')` for months, and the due-date fix swapped them to
    // `shortDayLabel`, which has no year. A task due 5 Jan 2027 then displayed the same as one
    // due 5 Jan 2026, and the Reports CSV lost the year while its Created Date column kept it.
    expect(calendarDateLabel('2026-08-27')).toBe('8/27/2026')
    expect(calendarDateLabel('2027-01-05')).toBe('1/5/2027')
    expect(calendarDateLabel('2025-12-31')).toBe('12/31/2025')
  })

  it('renders the same string the app rendered before the due-date fix', () => {
    // Byte-for-byte parity with the expression it restores, for a value whose UTC day and the
    // reader's day agree. That is the whole claim: the DAY was wrong, the FORMAT was not.
    expect(calendarDateLabel('2026-08-27')).toBe(
      new Date(Date.UTC(2026, 7, 27)).toLocaleDateString('en-US', { timeZone: 'UTC' }),
    )
  })

  it('carries a year where the compact chip carries none', () => {
    expect(calendarDateLabel('2026-01-05')).not.toBe(calendarDateLabel('2027-01-05'))
    expect(calendarDateLabel('2026-01-05')).toMatch(/\d{4}/)
    // The chip states no year at all, which is fine for "Due Sat 29 Aug" a few days out and is
    // why it stays on /my-work only. It is not a general-purpose date label.
    expect(shortDayLabel('2026-01-05')).not.toMatch(/\d{4}/)
  })
})

describe('dueDateAsPickerDate', () => {
  it('hands a picker a Date whose LOCAL day is the day the task is due', () => {
    // `new Date('2026-08-27T00:00:00+00:00')` is 26 August 19:00 in Chicago, so the calendar
    // highlighted the 26th for a task due the 27th. Measured before this existed.
    for (const stored of ['2026-08-27T00:00:00+00:00', '2026-08-27T05:00:00+00:00', '2026-08-27']) {
      const d = dueDateAsPickerDate(stored)
      expect(d, `stored ${stored}`).toBeInstanceOf(Date)
      expect(d!.getFullYear(), `stored ${stored}`).toBe(2026)
      expect(d!.getMonth(), `stored ${stored}`).toBe(7) // August
      expect(d!.getDate(), `stored ${stored}`).toBe(27)
    }
  })

  it('is undefined for no date, so the control renders empty rather than at the epoch', () => {
    expect(dueDateAsPickerDate(null)).toBeUndefined()
    expect(dueDateAsPickerDate(undefined)).toBeUndefined()
    expect(dueDateAsPickerDate('')).toBeUndefined()
    expect(dueDateAsPickerDate('not a date')).toBeUndefined()
  })
})
