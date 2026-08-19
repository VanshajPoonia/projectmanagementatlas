/**
 * Pure evaluation of a host's appointment rules.
 *
 * Restrictions are stored as rules (migration 080) and expanded here on demand,
 * never materialized into per-day rows. Everything in this file is deliberately
 * free of I/O and of `new Date()`-without-argument so it stays unit-testable and
 * gives the same answer on any machine.
 *
 * Dates are 'YYYY-MM-DD' keys handled in UTC, matching the convention already used
 * by components/marketing/marketing-calendar-state.ts - calculating in UTC avoids
 * the local-midnight drift that shifts a day either side of a DST boundary.
 *
 * Times are wall clock, expressed as minutes since midnight. A restriction means
 * "not on Wednesday mornings" irrespective of offset, so no zone is applied here.
 * Converting to absolute instants is the booking path's job (phase 2), and that is
 * the only place appointment_settings.timezone is needed.
 */

export interface AppointmentSettings {
  min_duration_minutes: number
  max_duration_minutes: number | null
  required_lead_time_hours: number
  allow_same_day: boolean
  allow_overlaps: boolean
  max_overlaps: number | null
  timezone: string
}

export interface AppointmentRestriction {
  starts_on: string
  ends_on: string
  is_all_day: boolean
  starts_at_time: string | null
  ends_at_time: string | null
  /** 0 = Sunday … 6 = Saturday. Empty means every day in the range (one-time). */
  weekdays: number[]
}

/** Interval in minutes since midnight, half-open: [start, end). */
export interface TimeInterval {
  start: number
  end: number
}

export const MINUTES_IN_DAY = 1440

// Matches the abbreviations the source design renders in its restriction table
// ("W Th F Sa").
const WEEKDAY_LABELS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'] as const

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

/** Parses a date key as UTC midnight, rejecting non-existent dates like 2026-02-30. */
export function parseDateKey(dateKey: string): Date | null {
  const match = DATE_KEY_PATTERN.exec(dateKey)
  if (!match) return null

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null

  return date
}

export function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/** 0 = Sunday … 6 = Saturday, or null when the key is malformed. */
export function weekdayOf(dateKey: string): number | null {
  return parseDateKey(dateKey)?.getUTCDay() ?? null
}

/** Accepts 'HH:MM' and Postgres' 'HH:MM:SS'. Returns minutes since midnight. */
export function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null
  const match = TIME_PATTERN.exec(time)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null

  return hours * 60 + minutes
}

/** '05:00 AM', '11:45 PM', '12:45 AM' - the format the source design displays. */
export function formatTimeLabel(minutesSinceMidnight: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY - 1, Math.round(minutesSinceMidnight)))
  const hours24 = Math.floor(clamped / 60)
  const minutes = clamped % 60
  const suffix = hours24 < 12 ? 'AM' : 'PM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12

  return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`
}

/**
 * The window a restriction blocks on a day it applies to. An all-day restriction
 * covers the whole day; a timed one covers only its own span.
 */
export function restrictionInterval(restriction: AppointmentRestriction): TimeInterval | null {
  if (restriction.is_all_day) return { start: 0, end: MINUTES_IN_DAY }

  const start = parseTimeToMinutes(restriction.starts_at_time)
  const end = parseTimeToMinutes(restriction.ends_at_time)
  if (start === null || end === null || end <= start) return null

  return { start, end }
}

/**
 * Whether a restriction applies on a given date: inside its range, and - when it
 * repeats - on a matching weekday. An empty `weekdays` covers every day in range,
 * which is how a one-time restriction is stored.
 */
export function restrictionCoversDate(
  restriction: AppointmentRestriction,
  dateKey: string,
): boolean {
  const date = parseDateKey(dateKey)
  const start = parseDateKey(restriction.starts_on)
  const end = parseDateKey(restriction.ends_on)
  if (!date || !start || !end || end < start) return false

  const time = date.getTime()
  if (time < start.getTime() || time > end.getTime()) return false
  if (restriction.weekdays.length === 0) return true

  return restriction.weekdays.includes(date.getUTCDay())
}

/**
 * Half-open overlap: an appointment ending exactly when a restriction begins does
 * not conflict. Closed comparison here would refuse every back-to-back booking.
 */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.start < b.end && b.start < a.end
}

export function restrictionBlocksInterval(
  restriction: AppointmentRestriction,
  dateKey: string,
  interval: TimeInterval,
): boolean {
  if (!restrictionCoversDate(restriction, dateKey)) return false

  const blocked = restrictionInterval(restriction)
  // A malformed row blocks nothing rather than blocking everything: silently
  // refusing all bookings is a worse failure than ignoring one broken rule.
  if (!blocked) return false

  return intervalsOverlap(blocked, interval)
}

export function findBlockingRestriction<T extends AppointmentRestriction>(
  restrictions: T[],
  dateKey: string,
  interval: TimeInterval,
): T | null {
  return restrictions.find(r => restrictionBlocksInterval(r, dateKey, interval)) ?? null
}

/** Every date a restriction actually lands on, for previews and the summary table. */
export function expandRestrictionDates(
  restriction: AppointmentRestriction,
  limit = 366,
): string[] {
  const start = parseDateKey(restriction.starts_on)
  const end = parseDateKey(restriction.ends_on)
  if (!start || !end || end < start) return []

  const dates: string[] = []
  const cursor = new Date(start)

  while (cursor.getTime() <= end.getTime() && dates.length < limit) {
    const key = toDateKey(cursor)
    if (restrictionCoversDate(restriction, key)) dates.push(key)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return dates
}

/** 'W Th F Sa' for a repeating rule, 'One-time restriction' otherwise. */
export function describeRestrictionDays(restriction: AppointmentRestriction): string {
  if (restriction.weekdays.length === 0) return 'One-time restriction'

  return [...new Set(restriction.weekdays)]
    .filter(day => day >= 0 && day <= 6)
    .sort((a, b) => a - b)
    .map(day => WEEKDAY_LABELS[day])
    .join(' ')
}

/** '05:00 AM - 11:45 PM', or 'All day'. */
export function describeRestrictionTime(restriction: AppointmentRestriction): string {
  if (restriction.is_all_day) return 'All day'

  const interval = restrictionInterval(restriction)
  if (!interval) return 'Invalid time range'

  return `${formatTimeLabel(interval.start)} - ${formatTimeLabel(interval.end)}`
}

export function isDurationAllowed(
  settings: Pick<AppointmentSettings, 'min_duration_minutes' | 'max_duration_minutes'>,
  durationMinutes: number,
): boolean {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return false
  if (durationMinutes < settings.min_duration_minutes) return false
  if (settings.max_duration_minutes === null) return true

  return durationMinutes <= settings.max_duration_minutes
}

/**
 * Lead time and the same-day rule, evaluated against an explicit `now` so tests
 * never depend on the wall clock. Both bounds are absolute epoch milliseconds.
 */
export function meetsLeadTime(
  settings: Pick<AppointmentSettings, 'required_lead_time_hours' | 'allow_same_day'>,
  nowMs: number,
  slotStartMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(slotStartMs)) return false
  if (slotStartMs <= nowMs) return false

  if (!settings.allow_same_day) {
    const now = new Date(nowMs)
    const slot = new Date(slotStartMs)
    if (toDateKey(now) === toDateKey(slot)) return false
  }

  const requiredMs = settings.required_lead_time_hours * 60 * 60 * 1000
  return slotStartMs - nowMs >= requiredMs
}

/**
 * Whether one more booking fits alongside those already in the slot. Mirrors the
 * source design's "Allow Scheduling Overlaps" plus "Max # of Scheduling Overlaps",
 * where no maximum means unlimited.
 */
export function hasOverlapCapacity(
  settings: Pick<AppointmentSettings, 'allow_overlaps' | 'max_overlaps'>,
  concurrentCount: number,
): boolean {
  if (concurrentCount <= 0) return true
  if (!settings.allow_overlaps) return false
  if (settings.max_overlaps === null) return true

  return concurrentCount < settings.max_overlaps
}

/**
 * Client-side mirror of migration 080's CHECK constraints, so the dialog can
 * explain a problem instead of surfacing a raw constraint violation. The database
 * remains the authority - this never replaces it.
 */
export function validateRestrictionDraft(draft: {
  reason: string
  starts_on: string
  ends_on: string
  is_all_day: boolean
  starts_at_time: string | null
  ends_at_time: string | null
  weekdays: number[]
}): string | null {
  if (!draft.reason.trim()) return 'Add a reason for this restriction.'
  if (draft.reason.trim().length > 200) return 'Keep the reason under 200 characters.'

  const start = parseDateKey(draft.starts_on)
  const end = parseDateKey(draft.ends_on)
  if (!start) return 'Choose a valid start date.'
  if (!end) return 'Choose a valid end date.'
  if (end < start) return 'The end date must be on or after the start date.'

  if (draft.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    return 'Select valid days of the week.'
  }

  if (!draft.is_all_day) {
    const startMinutes = parseTimeToMinutes(draft.starts_at_time)
    const endMinutes = parseTimeToMinutes(draft.ends_at_time)
    if (startMinutes === null) return 'Choose a valid start time.'
    if (endMinutes === null) return 'Choose a valid end time.'
    if (endMinutes <= startMinutes) return 'The end time must be after the start time.'
  }

  // A repeating rule whose weekdays never occur inside its own range would be
  // stored happily and then block nothing - catch it while it can still be fixed.
  if (draft.weekdays.length > 0) {
    const covered = expandRestrictionDates({
      starts_on: draft.starts_on,
      ends_on: draft.ends_on,
      is_all_day: draft.is_all_day,
      starts_at_time: draft.starts_at_time,
      ends_at_time: draft.ends_at_time,
      weekdays: draft.weekdays,
    })
    if (covered.length === 0) {
      return 'None of the selected days fall between the start and end dates.'
    }
  }

  return null
}
