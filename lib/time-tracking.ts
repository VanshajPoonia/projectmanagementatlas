// Pure helpers for the topbar timer (migration 137). No React, no Supabase.
//
// Totals are clipped to each range in the viewer's local time, so a session that runs past
// midnight counts toward both days. A running entry counts up to `now`.

export interface TimeEntry {
  id: string
  started_at: string
  ended_at: string | null
  note: string | null
}

export interface TimeTotals {
  today: number
  week: number
  month: number
  all: number
}

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

function endOf(entry: TimeEntry, now: Date): number {
  return entry.ended_at ? Date.parse(entry.ended_at) : now.getTime()
}

export function entryDurationMs(entry: TimeEntry, now: Date): number {
  return Math.max(0, endOf(entry, now) - Date.parse(entry.started_at))
}

export function overlapMs(entry: TimeEntry, from: Date, to: Date, now: Date): number {
  const start = Math.max(Date.parse(entry.started_at), from.getTime())
  const end = Math.min(endOf(entry, now), to.getTime())
  return Math.max(0, end - start)
}

/** Local midnight today, the Monday of this week, and the 1st of this month. */
export function rangeStarts(now: Date): { today: Date; week: Date; month: Date } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysSinceMonday = (today.getDay() + 6) % 7
  const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday)
  const month = new Date(now.getFullYear(), now.getMonth(), 1)
  return { today, week, month }
}

export function totals(entries: TimeEntry[], now: Date): TimeTotals {
  const { today, week, month } = rangeStarts(now)
  const sum = (from: Date) => entries.reduce((acc, e) => acc + overlapMs(e, from, now, now), 0)
  return {
    today: sum(today),
    week: sum(week),
    month: sum(month),
    all: entries.reduce((acc, e) => acc + entryDurationMs(e, now), 0),
  }
}

export function runningEntry(entries: TimeEntry[]): TimeEntry | null {
  return entries.find((e) => e.ended_at === null) ?? null
}

/** 1:02:03, for the live clock. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 3h 05m, for totals. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** Spoken form for the accessible name, e.g. "1 hour 5 minutes". */
export function spokenDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`)
  parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`)
  return parts.join(' ')
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** One row per entry, oldest first, with decimal hours for invoicing. */
export function toCsv(entries: TimeEntry[], now: Date): string {
  const rows = [...entries]
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    .map((e) =>
      [
        e.started_at,
        e.ended_at ?? '',
        (entryDurationMs(e, now) / HOUR_MS).toFixed(2),
        csvCell(e.note ?? ''),
      ].join(','),
    )
  return ['started_at,ended_at,hours,note', ...rows].join('\n')
}

/** YYYY-MM-DD for the viewer's local calendar day. */
export function localDayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

export interface DayGroup {
  day: string
  totalMs: number
  entries: TimeEntry[]
}

/** Entries grouped by the local day they started, newest day first. */
export function groupByDay(entries: TimeEntry[], now: Date): DayGroup[] {
  const groups = new Map<string, DayGroup>()
  for (const entry of entries) {
    const day = localDayKey(new Date(entry.started_at))
    const group = groups.get(day) ?? { day, totalMs: 0, entries: [] }
    group.entries.push(entry)
    group.totalMs += entryDurationMs(entry, now)
    groups.set(day, group)
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  }
  return [...groups.values()].sort((a, b) => (a.day < b.day ? 1 : -1))
}

/**
 * A manual entry from a local date, a start time and a length in hours.
 * Returns null when the input is not a real day or the session would end in the future.
 */
export function manualEntryRange(
  day: string,
  startTime: string,
  hours: number,
  now: Date,
): { started_at: string; ended_at: string } | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const tm = /^(\d{2}):(\d{2})$/.exec(startTime)
  if (!dm || !tm || !(hours > 0) || hours > 24) return null
  const start = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]))
  if (localDayKey(start) !== day) return null
  const end = new Date(start.getTime() + Math.round(hours * 60) * 60_000)
  if (end.getTime() > now.getTime()) return null
  return { started_at: start.toISOString(), ended_at: end.toISOString() }
}
