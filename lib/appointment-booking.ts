/**
 * Pure helpers for the public booking flow (migration 082). Token validation
 * mirrors lib/public-share.ts's isValidShareToken - same token shape (two
 * UUIDv4s, hyphens stripped, 64 hex chars) - kept as a separate, duplicated
 * function rather than imported, so the two capability systems (share links,
 * booking links) stay decoupled and one can change shape without touching
 * the other.
 *
 * The slot-validity check here is a CONVENIENCE for the booking form's live
 * feedback. It is never the authority: scripts/082_appointment_booking.sql's
 * book_appointment() re-validates everything server-side inside one
 * transaction, because the caller is unauthenticated and the request is
 * fully forgeable.
 */

import {
  hasOverlapCapacity,
  isDurationAllowed,
  meetsLeadTime,
  restrictionBlocksInterval,
  type AppointmentRestriction,
  type AppointmentSettings,
} from './appointment-availability'

/**
 * The host's local calendar date and minutes-since-midnight for an instant, in
 * their configured timezone - mirrors book_appointment()'s
 * `timezone(settings.timezone, p_starts_at)` conversion in SQL. Restrictions
 * are wall-clock, so comparing against the visitor's browser timezone (or
 * UTC) would check the wrong calendar day whenever it differs from the host's.
 */
function zonedDateAndMinutes(ms: number, timeZone: string): { dateKey: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(ms)).map(p => [p.type, p.value]),
  )
  // Intl can render midnight as hour "24" with hour12: false; normalize to 0.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour)
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  }
}

/**
 * Converts a wall-clock date+time in an arbitrary IANA zone to the epoch ms
 * instant it represents - the reverse of zonedDateAndMinutes above. Used by
 * the booking form to turn "2026-08-01, 14:00, America/Chicago" (what the
 * visitor picks, always shown in the HOST's zone to avoid a confusing double
 * conversion) into the UTC instant the API and database expect.
 *
 * Standard offset-probing trick (no timezone library): format the same instant
 * in both the target zone and UTC, then use the difference between those two
 * wall-clock readings as the zone's offset at that specific date - this is
 * DST-correct because the offset is derived from the real date in question,
 * not a fixed constant. Both readings are parsed back through the same `Date`
 * constructor, so whatever implicit local-timezone bias that introduces is
 * identical on both sides and cancels out in the subtraction - correctness
 * does not depend on the host machine's own timezone.
 */
export function zonedTimeToUtcMs(dateStr: string, timeStr: string, timeZone: string): number {
  const probeMs = Date.parse(`${dateStr}T${timeStr}:00Z`)
  const asZoned = new Date(probeMs).toLocaleString('en-US', { timeZone })
  const asUtc = new Date(probeMs).toLocaleString('en-US', { timeZone: 'UTC' })
  const offsetMs = new Date(asZoned).getTime() - new Date(asUtc).getTime()
  return probeMs - offsetMs
}

export function isValidBookingToken(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token)
}

export interface BookingLinkState {
  revoked_at: string | null
  expires_at: string | null
}

export function isBookingLinkActive<T extends BookingLinkState>(
  link: T | null | undefined,
  now = Date.now(),
): link is T {
  if (!link || link.revoked_at) return false
  if (!link.expires_at) return true

  const expiry = new Date(link.expires_at).getTime()
  return Number.isFinite(expiry) && expiry > now
}

export interface ExistingAppointmentInterval {
  starts_at: string
  ends_at: string
}

/** Count of already-CONFIRMED appointments overlapping [startMs, endMs). */
export function countOverlappingAppointments(
  existing: ExistingAppointmentInterval[],
  startMs: number,
  endMs: number,
): number {
  return existing.filter(a => {
    const aStart = new Date(a.starts_at).getTime()
    const aEnd = new Date(a.ends_at).getTime()
    return aStart < endMs && startMs < aEnd
  }).length
}

/**
 * Client-side pre-check so the booking form can show a reason before the
 * visitor submits, instead of only after the server rejects it. Requires the
 * requested instants to fall on the same local calendar day in the host's
 * timezone - appointments spanning midnight are out of scope (matches the
 * server-side rule), so any UI built on this should not let a visitor pick a
 * range that crosses midnight in the first place.
 */
export function describeSlotProblem(params: {
  settings: AppointmentSettings
  restrictions: AppointmentRestriction[]
  existing: ExistingAppointmentInterval[]
  startMs: number
  endMs: number
  nowMs?: number
}): string | null {
  const { settings, restrictions, existing, startMs, endMs, nowMs = Date.now() } = params

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 'Choose a valid time range.'
  }

  const durationMinutes = (endMs - startMs) / 60000
  if (!isDurationAllowed(settings, durationMinutes)) {
    return settings.max_duration_minutes !== null && durationMinutes > settings.max_duration_minutes
      ? 'That appointment is longer than the maximum allowed.'
      : 'That appointment is shorter than the minimum allowed.'
  }

  if (!meetsLeadTime(settings, nowMs, startMs)) {
    return settings.allow_same_day
      ? 'That time does not allow enough advance notice.'
      : 'Same-day bookings are not available.'
  }

  const startParts = zonedDateAndMinutes(startMs, settings.timezone)
  const endParts = zonedDateAndMinutes(endMs, settings.timezone)
  if (startParts.dateKey !== endParts.dateKey) {
    return 'Appointments cannot span midnight.'
  }

  const blocked = restrictions.some(r =>
    restrictionBlocksInterval(r, startParts.dateKey, { start: startParts.minutes, end: endParts.minutes }),
  )
  // Deliberately generic: a public visitor should never learn WHY a host is
  // unavailable, only that they are - mirrors the server-side RPC.
  if (blocked) return 'That time is not available.'

  const overlapCount = countOverlappingAppointments(existing, startMs, endMs)
  if (!hasOverlapCapacity(settings, overlapCount)) return 'That time is fully booked.'

  return null
}
