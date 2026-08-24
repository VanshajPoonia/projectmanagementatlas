// Half of the recurrence parity gate. The other half is scripts/check-recurrence.mjs, which
// runs the SAME case list against public.next_occurrence_date() in the real database.
//
// Neither implementation is the reference. The editor previews dates with this file; the
// generator creates them with the SQL one. If they disagree, the preview lies, so both are
// pinned to one list rather than to each other.

import { describe, it, expect } from 'vitest'
import { RECURRENCE_CASES } from './recurrence.cases.mjs'
import {
  nextOccurrenceDate,
  previewOccurrences,
  describeCadence,
  describeRule,
  ruleRejectionReason,
  ruleFromLegacyTask,
  addMonths,
  addDays,
  dayOfWeek,
  todayInBusinessZone,
  type Frequency,
  type RecurrenceRule,
} from './recurrence'

describe('nextOccurrenceDate matches the shared case list', () => {
  for (const c of RECURRENCE_CASES) {
    it(c.name, () => {
      const got = nextOccurrenceDate(
        c.after,
        c.frequency as Frequency,
        c.interval,
        c.weekdays ?? null,
        c.monthDay ?? null,
      )
      expect(got).toBe(c.expect)
    })
  }
})

describe('date helpers', () => {
  it('rejects a date that does not exist', () => {
    expect(nextOccurrenceDate('2026-02-30', 'daily', 1)).toBeNull()
    expect(nextOccurrenceDate('not-a-date', 'daily', 1)).toBeNull()
    expect(nextOccurrenceDate('2026-13-01', 'daily', 1)).toBeNull()
  })

  it('addMonths clamps rather than overflowing', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30')
    expect(addMonths('2026-01-15', 13)).toBe('2027-02-15')
  })

  it('addMonths goes backwards across a year boundary', () => {
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('dayOfWeek is Sunday-zero, matching Postgres EXTRACT(DOW)', () => {
    expect(dayOfWeek('2026-08-23')).toBe(0) // Sunday
    expect(dayOfWeek('2026-08-24')).toBe(1) // Monday
    expect(dayOfWeek('2026-08-29')).toBe(6) // Saturday
  })

  it('todayInBusinessZone returns a calendar date in Chicago, not the local one', () => {
    // 2026-01-02 04:00 UTC is still 2026-01-01 in Chicago. A naive local/UTC read gets this
    // wrong for a six-hour window every night, which is the trap lib/crm.ts documents.
    expect(todayInBusinessZone(new Date('2026-01-02T04:00:00Z'))).toBe('2026-01-01')
    expect(todayInBusinessZone(new Date('2026-01-02T07:00:00Z'))).toBe('2026-01-02')
  })
})

describe('previewOccurrences', () => {
  const base: RecurrenceRule = {
    frequency: 'weekly',
    interval_count: 1,
    weekdays: null,
    month_day: null,
    generation_mode: 'schedule',
    horizon_days: 30,
    starts_on: '2026-08-24',
    ends_on: null,
    max_occurrences: null,
    is_paused: false,
  }

  it('starts at the start date and steps forward', () => {
    expect(previewOccurrences(base, 3, '2026-08-24')).toEqual(['2026-08-24', '2026-08-31', '2026-09-07'])
  })

  it('starts from today when the rule began in the past', () => {
    const got = previewOccurrences(base, 2, '2026-09-10')
    expect(got[0]).toBe('2026-09-10')
  })

  it('stops at the end date rather than filling the count', () => {
    expect(previewOccurrences({ ...base, ends_on: '2026-09-01' }, 5, '2026-08-24'))
      .toEqual(['2026-08-24', '2026-08-31'])
  })

  it('never returns more than max_occurrences', () => {
    expect(previewOccurrences({ ...base, max_occurrences: 2 }, 5, '2026-08-24')).toHaveLength(2)
  })

  it('steps onto a listed weekday when the start date is not one', () => {
    // 2026-08-24 is a Monday; this rule only fires on Wed and Fri.
    const got = previewOccurrences({ ...base, weekdays: [3, 5] }, 3, '2026-08-24')
    expect(got).toEqual(['2026-08-26', '2026-08-28', '2026-09-02'])
  })

  it('returns nothing for an unparseable start date instead of throwing', () => {
    expect(previewOccurrences({ ...base, starts_on: 'soon' }, 3)).toEqual([])
  })
})

describe('describeCadence', () => {
  const b = { frequency: 'weekly' as Frequency, interval_count: 1, weekdays: null, month_day: null }
  it('says "every week" not "every 1 weeks"', () => {
    expect(describeCadence(b)).toBe('every week')
  })
  it('pluralises a real interval', () => {
    expect(describeCadence({ ...b, interval_count: 3 })).toBe('every 3 weeks')
  })
  it('lists one weekday without a conjunction', () => {
    expect(describeCadence({ ...b, weekdays: [1] })).toBe('every week on Mon')
  })
  it('lists several weekdays in week order, however they were entered', () => {
    expect(describeCadence({ ...b, weekdays: [5, 1, 3] })).toBe('every week on Mon, Wed and Fri')
  })
  it('names a monthly day', () => {
    expect(describeCadence({ ...b, frequency: 'monthly', month_day: 15 })).toBe('every month on day 15')
  })
})

describe('describeRule', () => {
  const base: RecurrenceRule = {
    frequency: 'weekly', interval_count: 1, weekdays: null, month_day: null,
    generation_mode: 'on_completion', horizon_days: 30, starts_on: '2026-08-24',
    ends_on: null, max_occurrences: null, is_paused: false,
  }

  it('explains on_completion in terms of finishing, not a calendar', () => {
    expect(describeRule(base)).toContain('only after the current one is finished')
  })

  it('names the look-ahead window in schedule mode', () => {
    expect(describeRule({ ...base, generation_mode: 'schedule', horizon_days: 14 }))
      .toContain('up to 14 days ahead')
  })

  it('counts down remaining occurrences rather than only stating the cap', () => {
    expect(describeRule({ ...base, max_occurrences: 10, occurrences_created: 4 }))
      .toContain('for 10 occurrences (6 left)')
  })

  it('does not report negative remaining occurrences', () => {
    expect(describeRule({ ...base, max_occurrences: 3, occurrences_created: 9 })).toContain('(0 left)')
  })

  it('says when it is paused', () => {
    expect(describeRule({ ...base, is_paused: true })).toContain('currently paused')
  })
})

describe('ruleRejectionReason mirrors 116 CHECK constraints', () => {
  const ok: RecurrenceRule = {
    frequency: 'weekly', interval_count: 1, weekdays: null, month_day: null,
    generation_mode: 'schedule', horizon_days: 30, starts_on: '2026-08-24',
    ends_on: null, max_occurrences: null, is_paused: false,
  }

  it('accepts a well-formed rule', () => {
    expect(ruleRejectionReason(ok)).toBeNull()
  })

  it('refuses weekdays on a non-weekly rule, as the CHECK does', () => {
    expect(ruleRejectionReason({ ...ok, frequency: 'daily', weekdays: [1] })).toMatch(/weekly/)
  })

  it('refuses an empty weekday list - a rule that can never fire', () => {
    expect(ruleRejectionReason({ ...ok, weekdays: [] })).toMatch(/at least one weekday/)
  })

  it('refuses a weekday outside 0-6', () => {
    expect(ruleRejectionReason({ ...ok, weekdays: [7] })).toMatch(/0 \(Sunday\) to 6/)
  })

  it('refuses a month day on a weekly rule', () => {
    expect(ruleRejectionReason({ ...ok, month_day: 15 })).toMatch(/monthly/)
  })

  it('refuses an interval outside 1-1000', () => {
    expect(ruleRejectionReason({ ...ok, interval_count: 0 })).toMatch(/1 to 1000/)
    expect(ruleRejectionReason({ ...ok, interval_count: 1001 })).toMatch(/1 to 1000/)
    expect(ruleRejectionReason({ ...ok, interval_count: 1.5 })).toMatch(/1 to 1000/)
  })

  // The ceilings are deliberately far above real use. These pin that an unusual-but-sane
  // schedule is ACCEPTED, which is the half a bounds check usually forgets to assert.
  it('accepts a schedule at the very top of every bound', () => {
    expect(ruleRejectionReason({
      ...ok, interval_count: 1000, horizon_days: 1095, max_occurrences: 10000,
    })).toBeNull()
  })

  it('refuses an end date before the start date', () => {
    expect(ruleRejectionReason({ ...ok, ends_on: '2026-08-01' })).toMatch(/cannot be before/)
  })

  it('accepts an end date equal to the start date, as the CHECK does', () => {
    expect(ruleRejectionReason({ ...ok, ends_on: '2026-08-24' })).toBeNull()
  })

  it('refuses a horizon outside 1-1095', () => {
    expect(ruleRejectionReason({ ...ok, horizon_days: 0 })).toMatch(/1 to 1095 days/)
    expect(ruleRejectionReason({ ...ok, horizon_days: 1096 })).toMatch(/1 to 1095 days/)
  })

  it('accepts a three-year look-ahead, which the old 365 ceiling refused', () => {
    expect(ruleRejectionReason({ ...ok, horizon_days: 1095 })).toBeNull()
  })

  it('refuses an occurrence cap outside 1-10000', () => {
    expect(ruleRejectionReason({ ...ok, max_occurrences: 0 })).toMatch(/1 and 10000/)
    expect(ruleRejectionReason({ ...ok, max_occurrences: 10001 })).toMatch(/1 and 10000/)
  })
})

describe('ruleFromLegacyTask', () => {
  it('translates a plain weekly task', () => {
    const r = ruleFromLegacyTask({
      is_recurring: true, recurrence_pattern: 'weekly', recurrence_interval: 2,
      due_date: '2026-08-24T00:00:00Z',
    })
    expect(r).toMatchObject({ frequency: 'weekly', interval_count: 2, starts_on: '2026-08-24' })
  })

  it("translates 086's 'custom' into weekly with a weekday list", () => {
    const r = ruleFromLegacyTask({
      is_recurring: true, recurrence_pattern: 'custom', recurrence_weekdays: [1, 3],
      due_date: '2026-08-24T00:00:00Z',
    })
    expect(r).toMatchObject({ frequency: 'weekly', weekdays: [1, 3] })
  })

  it('refuses the production shape with no pattern rather than inventing one', () => {
    // 4 rows on production carry is_recurring = TRUE with a NULL pattern. Guessing a cadence
    // for them would generate work nobody asked for; see 116's header.
    expect(ruleFromLegacyTask({ is_recurring: true, recurrence_pattern: null })).toBeNull()
  })

  it("refuses a 'custom' pattern that names no weekdays", () => {
    expect(ruleFromLegacyTask({ is_recurring: true, recurrence_pattern: 'custom', recurrence_weekdays: [] })).toBeNull()
  })

  it('refuses a task that is not recurring at all', () => {
    expect(ruleFromLegacyTask({ is_recurring: false, recurrence_pattern: 'weekly' })).toBeNull()
  })

  it('defaults to on_completion, the mode that produces one instance at a time', () => {
    const r = ruleFromLegacyTask({ is_recurring: true, recurrence_pattern: 'daily', due_date: '2026-08-24T00:00:00Z' })
    expect(r?.generation_mode).toBe('on_completion')
  })
})
