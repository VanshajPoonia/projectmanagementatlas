import { describe, expect, it } from 'vitest'
import {
  describeRestrictionDays,
  describeRestrictionTime,
  expandRestrictionDates,
  findBlockingRestriction,
  formatTimeLabel,
  hasOverlapCapacity,
  isDurationAllowed,
  meetsLeadTime,
  parseDateKey,
  parseTimeToMinutes,
  restrictionBlocksInterval,
  restrictionCoversDate,
  weekdayOf,
  type AppointmentRestriction,
} from './appointment-availability'

// The two rows visible in the source recording's restriction table.
const repeating: AppointmentRestriction = {
  starts_on: '2026-07-29',
  ends_on: '2026-08-01',
  is_all_day: false,
  starts_at_time: '05:00',
  ends_at_time: '23:45',
  weekdays: [3, 4, 5, 6], // W Th F Sa
}

const oneTime: AppointmentRestriction = {
  starts_on: '2026-08-02',
  ends_on: '2026-08-02',
  is_all_day: false,
  starts_at_time: '05:00',
  ends_at_time: '12:45',
  weekdays: [],
}

describe('date and time parsing', () => {
  it('rejects dates that do not exist', () => {
    expect(parseDateKey('2026-02-30')).toBeNull()
    expect(parseDateKey('2026-13-01')).toBeNull()
    expect(parseDateKey('not-a-date')).toBeNull()
    expect(parseDateKey('2026-02-28')).not.toBeNull()
  })

  it('reads Postgres HH:MM:SS as well as HH:MM', () => {
    expect(parseTimeToMinutes('05:00')).toBe(300)
    expect(parseTimeToMinutes('05:00:00')).toBe(300)
    expect(parseTimeToMinutes('23:45')).toBe(1425)
    expect(parseTimeToMinutes(null)).toBeNull()
    expect(parseTimeToMinutes('25:00')).toBeNull()
    expect(parseTimeToMinutes('05:99')).toBeNull()
  })

  it('formats times the way the source design labels them', () => {
    expect(formatTimeLabel(300)).toBe('05:00 AM')
    expect(formatTimeLabel(1425)).toBe('11:45 PM')
    expect(formatTimeLabel(765)).toBe('12:45 PM')
    // Midnight and noon are the two the 12-hour clock usually gets wrong.
    expect(formatTimeLabel(0)).toBe('12:00 AM')
    expect(formatTimeLabel(45)).toBe('12:45 AM')
    expect(formatTimeLabel(720)).toBe('12:00 PM')
  })

  it('maps weekdays with Sunday at zero', () => {
    expect(weekdayOf('2026-08-02')).toBe(0) // Sunday
    expect(weekdayOf('2026-07-29')).toBe(3) // Wednesday
    expect(weekdayOf('nonsense')).toBeNull()
  })
})

describe('restrictionCoversDate', () => {
  it('covers only matching weekdays inside the range', () => {
    expect(restrictionCoversDate(repeating, '2026-07-29')).toBe(true)  // Wed
    expect(restrictionCoversDate(repeating, '2026-07-30')).toBe(true)  // Thu
    expect(restrictionCoversDate(repeating, '2026-08-01')).toBe(true)  // Sat
    // Inside the range but not a selected weekday.
    expect(restrictionCoversDate(
      { ...repeating, weekdays: [1] }, '2026-07-29',
    )).toBe(false)
  })

  it('excludes dates outside the range even on a matching weekday', () => {
    // 2026-08-05 is a Wednesday, but the range ends 2026-08-01.
    expect(weekdayOf('2026-08-05')).toBe(3)
    expect(restrictionCoversDate(repeating, '2026-08-05')).toBe(false)
    expect(restrictionCoversDate(repeating, '2026-07-28')).toBe(false)
  })

  it('treats an empty weekday set as every day in the range', () => {
    expect(restrictionCoversDate(oneTime, '2026-08-02')).toBe(true)
    expect(restrictionCoversDate(oneTime, '2026-08-03')).toBe(false)

    const span = { ...oneTime, ends_on: '2026-08-04' }
    expect(restrictionCoversDate(span, '2026-08-03')).toBe(true)
    expect(restrictionCoversDate(span, '2026-08-04')).toBe(true)
  })

  it('is inclusive of both range endpoints', () => {
    const everyDay = { ...repeating, weekdays: [] }
    expect(restrictionCoversDate(everyDay, '2026-07-29')).toBe(true)
    expect(restrictionCoversDate(everyDay, '2026-08-01')).toBe(true)
  })

  it('covers nothing when the range is inverted', () => {
    const inverted = { ...repeating, starts_on: '2026-08-01', ends_on: '2026-07-29' }
    expect(restrictionCoversDate(inverted, '2026-07-30')).toBe(false)
  })
})

describe('restrictionBlocksInterval', () => {
  it('blocks an overlapping interval on a covered day', () => {
    expect(restrictionBlocksInterval(repeating, '2026-07-29', { start: 600, end: 660 }))
      .toBe(true)
  })

  it('does not block a back-to-back interval', () => {
    // Restriction is [300, 1425). An appointment ending exactly at 300, or starting
    // exactly at 1425, must still be bookable.
    expect(restrictionBlocksInterval(repeating, '2026-07-29', { start: 240, end: 300 }))
      .toBe(false)
    expect(restrictionBlocksInterval(repeating, '2026-07-29', { start: 1425, end: 1440 }))
      .toBe(false)
  })

  it('blocks the whole day when all-day', () => {
    const allDay = { ...repeating, is_all_day: true, starts_at_time: null, ends_at_time: null }
    expect(restrictionBlocksInterval(allDay, '2026-07-29', { start: 0, end: 1 })).toBe(true)
    expect(restrictionBlocksInterval(allDay, '2026-07-29', { start: 1439, end: 1440 })).toBe(true)
    // Still only on days it covers.
    expect(restrictionBlocksInterval(allDay, '2026-08-05', { start: 600, end: 660 })).toBe(false)
  })

  it('ignores a malformed rule instead of blocking everything', () => {
    const broken = { ...repeating, starts_at_time: '10:00', ends_at_time: '09:00' }
    expect(restrictionBlocksInterval(broken, '2026-07-29', { start: 600, end: 660 })).toBe(false)
  })

  it('finds which restriction is responsible', () => {
    const found = findBlockingRestriction([oneTime, repeating], '2026-07-30', { start: 600, end: 660 })
    expect(found).toBe(repeating)
    expect(findBlockingRestriction([oneTime, repeating], '2026-08-10', { start: 600, end: 660 }))
      .toBeNull()
  })
})

describe('expandRestrictionDates', () => {
  it('lists only the matching weekdays in range', () => {
    expect(expandRestrictionDates(repeating)).toEqual([
      '2026-07-29', // Wed
      '2026-07-30', // Thu
      '2026-07-31', // Fri
      '2026-08-01', // Sat
    ])
  })

  it('lists every day when no weekday is selected', () => {
    expect(expandRestrictionDates({ ...oneTime, ends_on: '2026-08-04' }))
      .toEqual(['2026-08-02', '2026-08-03', '2026-08-04'])
  })

  it('crosses a month boundary without drift', () => {
    const dates = expandRestrictionDates({
      ...repeating, starts_on: '2026-07-29', ends_on: '2026-08-12', weekdays: [3],
    })
    expect(dates).toEqual(['2026-07-29', '2026-08-05', '2026-08-12'])
  })

  it('is empty when no selected weekday falls in the range', () => {
    // 2026-07-29..2026-07-31 is Wed–Fri; Sunday never occurs.
    expect(expandRestrictionDates({
      ...repeating, ends_on: '2026-07-31', weekdays: [0],
    })).toEqual([])
  })

  it('honours the limit so an open-ended range cannot run away', () => {
    expect(expandRestrictionDates(
      { ...repeating, starts_on: '2026-01-01', ends_on: '2030-01-01', weekdays: [] }, 10,
    )).toHaveLength(10)
  })
})

describe('labels', () => {
  it('renders the weekday abbreviations from the source design', () => {
    expect(describeRestrictionDays(repeating)).toBe('W Th F Sa')
    expect(describeRestrictionDays(oneTime)).toBe('One-time restriction')
  })

  it('orders and de-duplicates weekdays regardless of input order', () => {
    expect(describeRestrictionDays({ ...repeating, weekdays: [6, 3, 4, 3, 5] }))
      .toBe('W Th F Sa')
  })

  it('renders the time range', () => {
    expect(describeRestrictionTime(repeating)).toBe('05:00 AM - 11:45 PM')
    expect(describeRestrictionTime(oneTime)).toBe('05:00 AM - 12:45 PM')
    expect(describeRestrictionTime({ ...repeating, is_all_day: true })).toBe('All day')
  })
})

describe('duration, lead time and overlap rules', () => {
  const settings = {
    min_duration_minutes: 30,
    max_duration_minutes: null as number | null,
    required_lead_time_hours: 0,
    allow_same_day: true,
    allow_overlaps: false,
    max_overlaps: null as number | null,
  }

  it('enforces the minimum, and treats a null maximum as none', () => {
    expect(isDurationAllowed(settings, 30)).toBe(true)
    expect(isDurationAllowed(settings, 29)).toBe(false)
    expect(isDurationAllowed(settings, 10_000)).toBe(true)
    expect(isDurationAllowed(settings, 0)).toBe(false)
    expect(isDurationAllowed(settings, -30)).toBe(false)
  })

  it('enforces a maximum when set', () => {
    const capped = { ...settings, max_duration_minutes: 60 }
    expect(isDurationAllowed(capped, 60)).toBe(true)
    expect(isDurationAllowed(capped, 61)).toBe(false)
  })

  it('requires the configured lead time', () => {
    const now = Date.UTC(2026, 7, 3, 12, 0)
    const twoHours = { ...settings, required_lead_time_hours: 2 }

    expect(meetsLeadTime(twoHours, now, Date.UTC(2026, 7, 3, 14, 0))).toBe(true)
    expect(meetsLeadTime(twoHours, now, Date.UTC(2026, 7, 3, 13, 59))).toBe(false)
    // Never bookable in the past or at the current instant.
    expect(meetsLeadTime(settings, now, Date.UTC(2026, 7, 3, 11, 0))).toBe(false)
    expect(meetsLeadTime(settings, now, now)).toBe(false)
  })

  it('applies the same-day rule independently of lead time', () => {
    const now = Date.UTC(2026, 7, 3, 12, 0)
    const noSameDay = { ...settings, allow_same_day: false }

    expect(meetsLeadTime(noSameDay, now, Date.UTC(2026, 7, 3, 23, 0))).toBe(false)
    expect(meetsLeadTime(noSameDay, now, Date.UTC(2026, 7, 4, 1, 0))).toBe(true)
  })

  it('counts overlap capacity', () => {
    // Nothing booked yet: always room, even with overlaps disabled.
    expect(hasOverlapCapacity(settings, 0)).toBe(true)
    expect(hasOverlapCapacity(settings, 1)).toBe(false)

    const unlimited = { ...settings, allow_overlaps: true, max_overlaps: null }
    expect(hasOverlapCapacity(unlimited, 99)).toBe(true)

    const capped = { ...settings, allow_overlaps: true, max_overlaps: 2 }
    expect(hasOverlapCapacity(capped, 1)).toBe(true)
    expect(hasOverlapCapacity(capped, 2)).toBe(false)
  })
})
