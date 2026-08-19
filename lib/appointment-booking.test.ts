import { describe, expect, it } from 'vitest'
import {
  countOverlappingAppointments,
  describeSlotProblem,
  isBookingLinkActive,
  isValidBookingToken,
  zonedTimeToUtcMs,
} from './appointment-booking'
import type { AppointmentRestriction, AppointmentSettings } from './appointment-availability'

const settings: AppointmentSettings = {
  min_duration_minutes: 30,
  max_duration_minutes: 120,
  required_lead_time_hours: 2,
  allow_same_day: true,
  allow_overlaps: false,
  max_overlaps: null,
  timezone: 'America/Chicago',
}

describe('isValidBookingToken', () => {
  it('accepts the 64-hex shape and rejects everything else', () => {
    expect(isValidBookingToken('a'.repeat(64))).toBe(true)
    expect(isValidBookingToken('a'.repeat(63))).toBe(false)
    expect(isValidBookingToken('g'.repeat(64))).toBe(false)
    expect(isValidBookingToken('')).toBe(false)
  })
})

describe('isBookingLinkActive', () => {
  it('rejects revoked and expired links, accepts everything else', () => {
    const now = Date.UTC(2026, 7, 3, 12, 0)
    expect(isBookingLinkActive({ revoked_at: '2026-08-01', expires_at: null }, now)).toBe(false)
    expect(isBookingLinkActive({ revoked_at: null, expires_at: '2026-08-01T00:00:00Z' }, now)).toBe(false)
    expect(isBookingLinkActive({ revoked_at: null, expires_at: null }, now)).toBe(true)
    expect(isBookingLinkActive({ revoked_at: null, expires_at: '2026-09-01T00:00:00Z' }, now)).toBe(true)
    expect(isBookingLinkActive(null, now)).toBe(false)
  })
})

describe('zonedTimeToUtcMs', () => {
  it('converts a summer (CDT, UTC-5) wall-clock time correctly', () => {
    // 2026-08-01 12:00 in America/Chicago (CDT) is 2026-08-01 17:00 UTC.
    expect(zonedTimeToUtcMs('2026-08-01', '12:00', 'America/Chicago'))
      .toBe(Date.UTC(2026, 7, 1, 17, 0))
  })

  it('converts a winter (CST, UTC-6) wall-clock time correctly', () => {
    // 2026-01-15 12:00 in America/Chicago (CST, no DST) is 2026-01-15 18:00 UTC.
    expect(zonedTimeToUtcMs('2026-01-15', '12:00', 'America/Chicago'))
      .toBe(Date.UTC(2026, 0, 15, 18, 0))
  })

  it('round-trips through zonedDateAndMinutes (used internally by describeSlotProblem)', () => {
    const ms = zonedTimeToUtcMs('2026-08-01', '14:30', 'America/Chicago')
    // 14:30 = 870 minutes since midnight.
    const restriction: AppointmentRestriction = {
      starts_on: '2026-08-01', ends_on: '2026-08-01', is_all_day: false,
      starts_at_time: '14:00', ends_at_time: '15:00', weekdays: [],
    }
    const result = describeSlotProblem({
      settings, restrictions: [restriction], existing: [],
      startMs: ms, endMs: ms + 30 * 60000, nowMs: Date.UTC(2026, 6, 1),
    })
    expect(result).toBe('That time is not available.')
  })

  it('is a UTC no-op', () => {
    expect(zonedTimeToUtcMs('2026-08-01', '12:00', 'UTC')).toBe(Date.UTC(2026, 7, 1, 12, 0))
  })
})

describe('countOverlappingAppointments', () => {
  it('counts only appointments that actually overlap the interval', () => {
    const existing = [
      { starts_at: '2026-08-03T14:00:00Z', ends_at: '2026-08-03T15:00:00Z' },
      { starts_at: '2026-08-03T20:00:00Z', ends_at: '2026-08-03T21:00:00Z' },
    ]
    expect(countOverlappingAppointments(existing, Date.parse('2026-08-03T14:30:00Z'), Date.parse('2026-08-03T14:45:00Z'))).toBe(1)
    expect(countOverlappingAppointments(existing, Date.parse('2026-08-03T15:00:00Z'), Date.parse('2026-08-03T16:00:00Z'))).toBe(0)
    expect(countOverlappingAppointments(existing, Date.parse('2026-08-03T00:00:00Z'), Date.parse('2026-08-04T00:00:00Z'))).toBe(2)
  })
})

describe('describeSlotProblem', () => {
  const now = Date.UTC(2026, 6, 30, 12, 0) // 2026-07-30 12:00 UTC

  it('accepts a valid slot with no restrictions and no conflicts', () => {
    const startMs = Date.UTC(2026, 7, 5, 20, 0) // well past lead time
    const endMs = startMs + 45 * 60000
    expect(describeSlotProblem({ settings, restrictions: [], existing: [], startMs, endMs, nowMs: now })).toBeNull()
  })

  it('rejects a duration shorter than the minimum', () => {
    const startMs = Date.UTC(2026, 7, 5, 20, 0)
    const endMs = startMs + 10 * 60000
    expect(describeSlotProblem({ settings, restrictions: [], existing: [], startMs, endMs, nowMs: now }))
      .toMatch(/shorter than the minimum/)
  })

  it('rejects insufficient lead time', () => {
    const startMs = now + 30 * 60000 // 30 minutes out, settings require 2 hours
    const endMs = startMs + 45 * 60000
    expect(describeSlotProblem({ settings, restrictions: [], existing: [], startMs, endMs, nowMs: now }))
      .toMatch(/advance notice/)
  })

  it('rejects a slot that falls inside a restriction, without leaking the reason', () => {
    // 2026-07-29..2026-08-01, Wed/Thu/Fri/Sat, 05:00-23:45 local time.
    const restriction: AppointmentRestriction = {
      starts_on: '2026-07-29', ends_on: '2026-08-01', is_all_day: false,
      starts_at_time: '05:00', ends_at_time: '23:45', weekdays: [3, 4, 5, 6],
    }
    // 2026-08-01 15:00 in America/Chicago (CDT, UTC-5) = 20:00 UTC.
    const startMs = Date.UTC(2026, 7, 1, 20, 0)
    const endMs = startMs + 45 * 60000
    const result = describeSlotProblem({ settings, restrictions: [restriction], existing: [], startMs, endMs, nowMs: now })
    expect(result).toBe('That time is not available.')
  })

  // This is the case that would have caught the original bug: computing the
  // restriction date in UTC instead of the host's timezone. 2026-08-02 04:30
  // in America/Chicago (CDT, UTC-5) is 2026-08-02 09:30 UTC - a Sunday in both
  // zones, BUT the boundary case below crosses midnight between the two.
  it('evaluates the restriction date in the HOST timezone, not UTC', () => {
    const restriction: AppointmentRestriction = {
      starts_on: '2026-08-01', ends_on: '2026-08-01', is_all_day: true,
      starts_at_time: null, ends_at_time: null, weekdays: [],
    }
    // 2026-08-01 22:00 America/Chicago (CDT, UTC-5) = 2026-08-02 03:00 UTC -
    // still Aug 1 locally (through 23:59:59 CDT), but already Aug 2 in UTC.
    // A UTC-only check would compute dateKey '2026-08-02', miss the
    // restriction (which only covers Aug 1), and wrongly allow the booking.
    const startMs = Date.UTC(2026, 7, 2, 3, 0)
    const endMs = startMs + 30 * 60000
    const result = describeSlotProblem({ settings, restrictions: [restriction], existing: [], startMs, endMs, nowMs: now })
    expect(result).toBe('That time is not available.')
  })

  it('rejects a slot with no overlap capacity', () => {
    const startMs = Date.UTC(2026, 7, 5, 20, 0)
    const endMs = startMs + 45 * 60000
    const existing = [{ starts_at: new Date(startMs).toISOString(), ends_at: new Date(endMs).toISOString() }]
    expect(describeSlotProblem({ settings, restrictions: [], existing, startMs, endMs, nowMs: now }))
      .toBe('That time is fully booked.')
  })

  it('rejects a slot spanning midnight in the host timezone', () => {
    // 2026-08-05 23:45 America/Chicago through 2026-08-06 00:15 - crosses midnight locally.
    const startMs = Date.UTC(2026, 8, 6, 4, 45)
    const endMs = Date.UTC(2026, 8, 6, 5, 15)
    expect(describeSlotProblem({ settings, restrictions: [], existing: [], startMs, endMs, nowMs: now }))
      .toBe('Appointments cannot span midnight.')
  })
})
