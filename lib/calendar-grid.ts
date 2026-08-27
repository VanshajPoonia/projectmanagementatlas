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

// businessDate is deliberately NOT used for due dates here - see dueCalendarDate below.

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
 * Whole days from calendar date `from` to calendar date `to`. Negative when `to` is earlier.
 *
 * Both ends are UTC midnights built from their own y/m/d, so no DST transition can fall between
 * them and the answer is always a whole number of days.
 *
 * ⚠️ The thing this replaces: `new Date('2026-08-27')` parses to UTC midnight, and calling
 * `.setHours(0, 0, 0, 0)` on the result then zeroes it in LOCAL time. West of Greenwich that
 * lands on the previous day, so every date read that way is a day early. Never mix a parsed
 * date-only string with local-time zeroing.
 */
export function daysBetween(from: string, to: string): number {
  const a = parseIso(from)
  const b = parseIso(to)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
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
 * The compact form: "Sat 30 Aug". For lists where the long form would dominate the row.
 *
 * ⚠️ Formatted from a UTC midnight with `timeZone: 'UTC'`, like every other label here. The
 * obvious `format(new Date('2026-08-30'), 'EEE d MMM')` renders that instant in the READER's
 * zone, so west of Greenwich it prints the day before - a due date labelled one day early,
 * which is exactly the bug this module exists to prevent and which shipped on /my-work.
 */
export function shortDayLabel(value: string): string {
  const { y, m, d } = parseIso(value)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
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
 * The calendar DAY a due date means.
 *
 * ⚠️ **`tasks.due_date` is `TIMESTAMPTZ`, not `DATE`** (`001_initial_schema.sql`) - measured
 * against the sandbox, not assumed. It does not arrive as `YYYY-MM-DD`; it arrives as an
 * instant, and the instant is always MIDNIGHT on the day the person meant:
 *
 *   - `create-task-dialog.tsx` writes the raw value of an `<input type="date">`, so Postgres
 *     casts `'2026-08-27'` to `2026-08-27T00:00:00+00:00`. 49 of 53 dev rows are this shape.
 *   - `task-detail-modal.tsx` writes `Date.toISOString()` from a picker set to LOCAL midnight,
 *     so a Chicago user produces `2026-08-27T05:00:00+00:00`. The other 4 rows are this shape.
 *
 * In both cases the intended day is the **UTC date part**, and resolving the instant through the
 * business timezone instead is wrong: `2026-08-27T00:00:00Z` is 26 August in Chicago, so every
 * due date came out a day early. That is not a hypothetical - it shipped twice, once through
 * `new Date()` + local `setHours`, and again through `businessDate()` in the Prompt E view
 * engine, whose tests all used date-only fixtures the column never produces.
 *
 * A bare `YYYY-MM-DD` is still passed through untouched, for callers holding a real DATE column.
 *
 * ⚠️ This rule is for a stored calendar DAY only. A genuine instant - `created_at`, `updated_at`,
 * "3 hours ago" - must still go through `businessDate()`, because for those the question really
 * is "which day was that, here?".
 */
export function dueCalendarDate(value: unknown): string | null {
  if (value == null || value === '') return null
  const text = String(value)
  if (CALENDAR_DATE_PATTERN.test(text)) return text
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return iso(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate())
}

/** `dueCalendarDate` for a task row. */
export function taskDueDate(task: { due_date?: unknown }): string | null {
  return dueCalendarDate(task?.due_date)
}

/**
 * A `Date` at LOCAL midnight on a stored due date's day, for seeding a date PICKER.
 *
 * ⚠️ `new Date(storedValue)` is wrong here for the same reason it is wrong everywhere else in
 * this module: `2026-08-27T00:00:00+00:00` is 26 August 19:00 in Chicago, so the calendar
 * highlighted the **26th** for a task due the **27th**. Measured. A picker is a calendar-day
 * control, so it has to be handed a Date whose LOCAL y/m/d are the day we mean.
 */
export function dueDateAsPickerDate(value: unknown): Date | undefined {
  const day = dueCalendarDate(value)
  if (!day) return undefined
  const { y, m, d } = parseIso(day)
  return new Date(y, m - 1, d)
}

/** Step one range forward or back from an anchor. */
export function stepAnchor(anchor: string, range: CalendarRange, delta: number): string {
  if (range === 'month') return addMonths(anchor, delta)
  return addDays(anchor, range === 'week' ? delta * 7 : delta)
}
