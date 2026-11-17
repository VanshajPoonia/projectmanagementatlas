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
