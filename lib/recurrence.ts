// Recurrence: the client-side mirror of migration 116's date math, plus the vocabulary the
// editor renders.
//
// ⚠️ nextOccurrenceDate() MUST agree with public.next_occurrence_date() for every input. The
// UI uses it to show "next five occurrences" before a rule is saved; the database uses its own
// copy to decide what to actually create. A preview that disagrees with the generator is worse
// than no preview, because it is believed.
//
// The agreement is a gate, not a claim: lib/recurrence.cases.mjs holds the shared case list,
// recurrence.parity.test.ts asserts this file matches it, and scripts/check-recurrence.mjs
// feeds every case to the real function in the real database. Change one side and both fail.
//
// Dates are plain 'YYYY-MM-DD' strings throughout, never Date instants. A recurrence belongs to
// a calendar day, and parsing a date-only value into an instant resolves it against whatever
// timezone the runtime happens to be in - the trap lib/crm.ts's businessDate() documents, five
// hours wide between the server and a Chicago browser.

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export const GENERATION_MODES = ['on_completion', 'schedule'] as const
export type GenerationMode = (typeof GENERATION_MODES)[number]

export interface RecurrenceRule {
  id?: string
  source_task_id?: string
  frequency: Frequency
  interval_count: number
  weekdays: number[] | null
  month_day: number | null
  generation_mode: GenerationMode
  horizon_days: number
  starts_on: string
  ends_on: string | null
  max_occurrences: number | null
  occurrences_created?: number
  is_paused: boolean
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const FREQUENCY_LABELS: Record<Frequency, { one: string; many: string }> = {
  daily: { one: 'day', many: 'days' },
  weekly: { one: 'week', many: 'weeks' },
  monthly: { one: 'month', many: 'months' },
  yearly: { one: 'year', many: 'years' },
}

export const GENERATION_MODE_LABELS: Record<GenerationMode, { label: string; hint: string }> = {
  on_completion: {
    label: 'When the current one is finished',
    hint: 'Exactly one instance is ever live. The next appears once you complete or cancel this one.',
  },
  schedule: {
    label: 'Ahead of time, on the calendar',
    hint: 'Every instance inside the look-ahead window is created now, so upcoming work is visible.',
  },
}

// --- date helpers ------------------------------------------------------------------------
// All arithmetic is done on UTC-midnight Date objects built from the string parts, so no local
// timezone can shift a day. Nothing here ever calls new Date(string).

function toParts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  // Reject a date that does not exist, e.g. 2026-02-30.
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null
  }
  return { y, m, d }
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Day of week, 0=Sunday, matching Postgres EXTRACT(DOW) and the weekdays array. */
export function dayOfWeek(iso: string): number {
  const p = toParts(iso)
  if (!p) return -1
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
}

export function addDays(iso: string, days: number): string {
  const p = toParts(iso)
  if (!p) return iso
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/**
 * Add months, clamping into the target month. This is Postgres interval semantics, which is
 * why the SQL side simply says `+ interval '1 month'`: 2026-01-31 + 1 month is 2026-02-28, not
 * 2026-03-03. Reimplementing that by hand is where off-by-a-few-days bugs come from.
 */
export function addMonths(iso: string, months: number): string {
  const p = toParts(iso)
  if (!p) return iso
  const total = (p.y * 12 + (p.m - 1)) + months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return fmt(y, m, Math.min(p.d, daysInMonth(y, m)))
}

/**
 * The one definition of when a recurrence next fires, mirroring
 * public.next_occurrence_date(). Returns null for input the database would also reject.
 */
export function nextOccurrenceDate(
  after: string,
  frequency: Frequency,
  intervalCount: number,
  weekdays?: number[] | null,
  monthDay?: number | null,
): string | null {
  if (!toParts(after)) return null
  const step = Math.max(Math.trunc(intervalCount) || 1, 1)

  if (frequency === 'daily') return addDays(after, step)

  if (frequency === 'weekly') {
    if (!weekdays || weekdays.length === 0) return addDays(after, step * 7)

    const dow = dayOfWeek(after)
    // Anything left this week?
    for (let s = 1; s <= 6 - dow; s++) {
      if (weekdays.includes(dow + s)) return addDays(after, s)
    }
    // Otherwise jump to the interval-th week ahead, Sunday-anchored, and take its first day.
    const weekStart = addDays(after, -dow + step * 7)
    for (let s = 0; s <= 6; s++) {
      if (weekdays.includes(s)) return addDays(weekStart, s)
    }
    return null
  }

  if (frequency === 'monthly') {
    if (monthDay == null) return addMonths(after, step)
    const p = toParts(after)!
    // Move to the target month first, then clamp into it, so "the 31st" lands on the 30th in a
    // 30-day month rather than overflowing into the next one.
    const total = (p.y * 12 + (p.m - 1)) + step
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    return fmt(y, m, Math.min(monthDay, daysInMonth(y, m)))
  }

  if (frequency === 'yearly') return addMonths(after, step * 12)

  return null
}

// --- rule-level helpers ------------------------------------------------------------------

/**
 * The occurrences a rule would produce next, for the editor's preview.
 *
 * ⚠️ This models SCHEDULE mode only. An on_completion rule's next date depends on when a human
 * closes the current instance, which is not knowable here - describeRule() says so in words
 * instead, and the editor shows this list only for schedule mode. Rendering a confident list of
 * five dates for a rule that produces one at a time would be a lie about how it behaves.
 */
export function previewOccurrences(
  rule: Pick<RecurrenceRule, 'frequency' | 'interval_count' | 'weekdays' | 'month_day' | 'starts_on' | 'ends_on' | 'max_occurrences'>,
  count: number,
  from?: string,
): string[] {
  const out: string[] = []
  if (!toParts(rule.starts_on)) return out

  const today = from && toParts(from) ? from : rule.starts_on
  let cursor = rule.starts_on > today ? rule.starts_on : today

  // starts_on need not itself be a listed weekday; step onto one before listing anything.
  if (rule.frequency === 'weekly' && rule.weekdays?.length && !rule.weekdays.includes(dayOfWeek(cursor))) {
    const stepped = nextOccurrenceDate(cursor, rule.frequency, rule.interval_count, rule.weekdays, rule.month_day)
    if (!stepped) return out
    cursor = stepped
  }

  const limit = Math.min(count, rule.max_occurrences ?? count)
  // Matches the generator's own guard in migration 116 rather than being picked independently.
  // This only ever fills a short preview list, so it cannot legitimately approach the bound.
  let guard = 0
  while (out.length < limit && guard < 20000) {
    if (rule.ends_on && cursor > rule.ends_on) break
    out.push(cursor)
    const next = nextOccurrenceDate(cursor, rule.frequency, rule.interval_count, rule.weekdays, rule.month_day)
    if (!next) break
    cursor = next
    guard++
  }
  return out
}

/** Plain-English cadence, e.g. "every 2 weeks on Mon and Fri". */
export function describeCadence(
  rule: Pick<RecurrenceRule, 'frequency' | 'interval_count' | 'weekdays' | 'month_day'>,
): string {
  const n = Math.max(Math.trunc(rule.interval_count) || 1, 1)
  const unit = FREQUENCY_LABELS[rule.frequency]
  const every = n === 1 ? `every ${unit.one}` : `every ${n} ${unit.many}`

  if (rule.frequency === 'weekly' && rule.weekdays?.length) {
    const days = [...rule.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d] ?? '?')
    const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
    return `${every} on ${list}`
  }
  if (rule.frequency === 'monthly' && rule.month_day) {
    return `${every} on day ${rule.month_day}`
  }
  return every
}

/** The full sentence the editor shows: cadence, how it generates, and what stops it. */
export function describeRule(rule: RecurrenceRule): string {
  const parts = [describeCadence(rule)]
  parts.push(
    rule.generation_mode === 'on_completion'
      ? 'creating the next one only after the current one is finished'
      : `creating them up to ${rule.horizon_days} days ahead`,
  )
  if (rule.ends_on) parts.push(`until ${rule.ends_on}`)
  if (rule.max_occurrences) {
    const left = Math.max(rule.max_occurrences - (rule.occurrences_created ?? 0), 0)
    parts.push(`for ${rule.max_occurrences} occurrences (${left} left)`)
  }
  if (rule.is_paused) parts.push('- currently paused')
  return parts.join(', ')
}

/**
 * Why the database would refuse this rule, or null if it would accept it.
 *
 * Mirrors 116's CHECK constraints exactly, and is deliberately no stricter: per the repo's
 * capability lesson, a client that refuses what the database allows takes an ability away from
 * someone and gives them no way to tell that refusal from a bug.
 */
export function ruleRejectionReason(rule: Partial<RecurrenceRule>): string | null {
  if (!rule.frequency || !FREQUENCIES.includes(rule.frequency)) {
    return 'Pick how often this repeats.'
  }
  const n = rule.interval_count
  if (n == null || !Number.isInteger(n) || n < 1 || n > 1000) {
    return 'Repeat every 1 to 1000 units.'
  }
  if (rule.weekdays != null) {
    if (rule.frequency !== 'weekly') return 'Specific weekdays only apply to a weekly schedule.'
    if (rule.weekdays.length < 1) return 'Pick at least one weekday.'
    if (rule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Weekdays must be 0 (Sunday) to 6.'
  }
  if (rule.month_day != null) {
    if (rule.frequency !== 'monthly') return 'A day of the month only applies to a monthly schedule.'
    if (!Number.isInteger(rule.month_day) || rule.month_day < 1 || rule.month_day > 31) {
      return 'Day of the month must be 1 to 31.'
    }
  }
  if (!rule.starts_on || !toParts(rule.starts_on)) return 'Pick a start date.'
  if (rule.ends_on) {
    if (!toParts(rule.ends_on)) return 'The end date is not a real date.'
    if (rule.ends_on < rule.starts_on) return 'The end date cannot be before the start date.'
  }
  if (rule.max_occurrences != null) {
    if (!Number.isInteger(rule.max_occurrences) || rule.max_occurrences < 1 || rule.max_occurrences > 10000) {
      return 'Limit the number of occurrences to between 1 and 10000.'
    }
  }
  if (rule.horizon_days != null) {
    if (!Number.isInteger(rule.horizon_days) || rule.horizon_days < 1 || rule.horizon_days > 1095) {
      return 'The look-ahead window must be 1 to 1095 days.'
    }
  }
  return null
}

/**
 * Migrating one of 025/086's five task columns onto a rule, used by the detail modal when a
 * user opens a task that predates 116.
 *
 * Returns null when the legacy state cannot be expressed as a schedule - which is exactly the
 * four production rows carrying is_recurring = TRUE with no pattern. The caller shows that as
 * "recurrence incomplete" rather than inventing a cadence. See 116's header.
 */
export function ruleFromLegacyTask(task: {
  is_recurring?: boolean | null
  recurrence_pattern?: string | null
  recurrence_interval?: number | null
  recurrence_weekdays?: number[] | null
  recurrence_end_date?: string | null
  due_date?: string | null
  created_at?: string | null
}): Omit<RecurrenceRule, 'is_paused'> | null {
  if (!task.is_recurring) return null
  const pattern = task.recurrence_pattern
  if (!pattern) return null

  // 086's 'custom' meant "these weekdays", which is weekly with a weekday list. The special
  // case does not survive onto the rule; 116's backfill makes the same translation.
  const isCustom = pattern === 'custom'
  const frequency = (isCustom ? 'weekly' : pattern) as Frequency
  if (!FREQUENCIES.includes(frequency)) return null

  const weekdays = isCustom && task.recurrence_weekdays?.length ? task.recurrence_weekdays : null
  if (isCustom && !weekdays) return null

  const startsOn = (task.due_date ?? task.created_at ?? '').slice(0, 10)
  return {
    frequency,
    interval_count: Math.min(Math.max(task.recurrence_interval ?? 1, 1), 365),
    weekdays,
    month_day: null,
    generation_mode: 'on_completion',
    horizon_days: 30,
    starts_on: toParts(startsOn) ? startsOn : todayInBusinessZone(),
    ends_on: task.recurrence_end_date ? task.recurrence_end_date.slice(0, 10) : null,
    max_occurrences: null,
  }
}

/**
 * Today as a calendar date in the business timezone - the same zone 116's generator defaults
 * to. Using the browser's local date here would put a user west of Chicago a day behind the
 * generator for part of every evening.
 */
export function todayInBusinessZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
