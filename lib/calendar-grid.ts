// Calendar date arithmetic, in calendar space.
//
// Pulled out of calendar-layout.tsx so it can be tested without a DOM, the same split as
// lib/marketing-calendar-state.ts. Date maths is exactly the kind of code that looks obviously
// right and is off by one for half the planet.
//
// ⚠️ EVERY VALUE HERE IS A `YYYY-MM-DD` STRING, NEVER AN INSTANT.
// `tasks.due_date` is a DATE in Postgres and arrives as `YYYY-MM-DD`. `new Date('2026-08-25')`
// parses that as UTC midnight, which is 7pm on the 24th in America/Chicago - so a task lands on
// the wrong cell for anyone west of Greenwich, and the server and browser disagree for a
// five-hour window every day. This already bit the CRM (see CLAUDE.md).
//
// Where a Date IS constructed below it is always via `Date.UTC(y, m, d)` with integer parts and
// read back with `getUTC*`, which is a pure calendar calculation that no timezone can move.
// `YYYY-MM-DD` also sorts lexicographically, so ordering and range checks are string compares.

import { businessDate } from './crm'

export type CalendarRange = 'month' | 'week' | 'day'

export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parseIso(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split('-').map(Number)
  return { y, m, d }
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Day of week, 0 = Sunday. Computed in UTC so no zone can shift it. */
export function weekdayOf(value: string): number {
  const { y, m, d } = parseIso(value)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function addDays(value: string, delta: number): string {
  const { y, m, d } = parseIso(value)
  const shifted = new Date(Date.UTC(y, m - 1, d + delta))
  return iso(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/**
 * Month arithmetic clamps the day rather than rolling over: one month after 31 Jan is 28 Feb,
 * not 3 March. Rolling over is the behaviour `new Date` gives by default and it is never what
 * a person paging through a calendar means.
 */
export function addMonths(value: string, delta: number): string {
  const { y, m, d } = parseIso(value)
  const target = m - 1 + delta
  const ty = y + Math.floor(target / 12)
  const tm = (((target % 12) + 12) % 12) + 1
  return iso(ty, tm, Math.min(d, daysInMonth(ty, tm)))
}

export function monthLabel(value: string): string {
  const { y, m } = parseIso(value)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

export function dayLabel(value: string): string {
  const { y, m, d } = parseIso(value)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

/**
 * The cells a range covers. Month always returns whole weeks so the grid is rectangular -
 * a ragged final row is the classic "the 31st has no cell" bug.
 */
export function rangeDates(anchor: string, range: CalendarRange): string[] {
  if (range === 'day') return [anchor]

  if (range === 'week') {
    const start = addDays(anchor, -weekdayOf(anchor))
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }

  const { y, m } = parseIso(anchor)
  const first = iso(y, m, 1)
  const gridStart = addDays(first, -weekdayOf(first))
  const cells = Math.ceil((daysInMonth(y, m) + weekdayOf(first)) / 7) * 7
  return Array.from({ length: cells }, (_, i) => addDays(gridStart, i))
}

/**
 * A task's due date as a calendar date. A bare `YYYY-MM-DD` is returned untouched - re-zoning
 * it is precisely the bug this module exists to prevent. A full timestamp is resolved through
 * the business timezone, because that is the calendar the company works in.
 */
export function taskDueDate(task: { due_date?: unknown }): string | null {
  const raw = task?.due_date
  if (!raw) return null
  const text = String(raw)
  if (CALENDAR_DATE_PATTERN.test(text)) return text
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : businessDate(parsed)
}

/** Step one range forward or back from an anchor. */
export function stepAnchor(anchor: string, range: CalendarRange, delta: number): string {
  if (range === 'month') return addMonths(anchor, delta)
  return addDays(anchor, range === 'week' ? delta * 7 : delta)
}
