// Reading side of the audit trail written by migration 098's triggers.
//
// The database stores a stable machine verb (`action`) plus a sentence resolved at write
// time (`summary`). This module only groups and labels; it deliberately does NOT rebuild the
// sentence from `metadata`. Re-deriving it here would mean the log reads differently
// depending on which build is deployed, which defeats the point of a historical record -
// the row must still say what it said on the day it was written, even if a person was
// renamed or a board deleted since.

export type AuditAction =
  | 'board_member.added'
  | 'board_member.role_changed'
  | 'board_member.removed'
  | 'team_member.added'
  | 'team_member.removed'
  | 'calendar_member.added'
  | 'calendar_member.removed'
  | 'profile.role_changed'
  | 'module.toggled'

export interface AuditEvent {
  id: string
  occurred_at: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  subject_id: string | null
  summary: string
  metadata: Record<string, unknown> | null
}

/** Filter buckets, chosen so an admin can answer "what changed about X" in one click. */
export type AuditCategory = 'all' | 'boards' | 'teams' | 'calendars' | 'people' | 'modules'

export const AUDIT_CATEGORIES: readonly { id: AuditCategory; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'boards', label: 'Boards' },
  { id: 'teams', label: 'Teams' },
  { id: 'calendars', label: 'Calendars' },
  { id: 'people', label: 'People' },
  { id: 'modules', label: 'Modules' },
] as const

export function categoryOf(event: Pick<AuditEvent, 'action'>): Exclude<AuditCategory, 'all'> | 'other' {
  if (event.action.startsWith('board_member.')) return 'boards'
  if (event.action.startsWith('team_member.')) return 'teams'
  if (event.action.startsWith('calendar_member.')) return 'calendars'
  if (event.action.startsWith('profile.')) return 'people'
  if (event.action.startsWith('module.')) return 'modules'
  return 'other'
}

export function filterByCategory(events: readonly AuditEvent[], category: AuditCategory): AuditEvent[] {
  if (category === 'all') return [...events]
  return events.filter((event) => categoryOf(event) === category)
}

/**
 * Visual weight, not severity. An action that GRANTS access is the one worth spotting when
 * scanning a long list, because it is the one that can be wrong in a way nobody notices;
 * a removal is conservative by comparison.
 */
export type AuditTone = 'grant' | 'revoke' | 'change'

export function toneOf(event: Pick<AuditEvent, 'action'>): AuditTone {
  if (event.action.endsWith('.added')) return 'grant'
  if (event.action.endsWith('.removed')) return 'revoke'
  return 'change'
}

export interface AuditDay {
  /** ISO date, local to the reader - grouping by UTC would split a working evening in two. */
  date: string
  label: string
  events: AuditEvent[]
}

function localISODate(value: Date): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Group into day buckets, newest first, preserving each day's newest-first ordering.
 *
 * `now` is injected so the Today/Yesterday labels are testable without freezing the clock.
 */
export function groupByDay(events: readonly AuditEvent[], now: Date = new Date()): AuditDay[] {
  const buckets = new Map<string, AuditEvent[]>()

  for (const event of events) {
    const when = new Date(event.occurred_at)
    if (Number.isNaN(when.getTime())) continue
    const key = localISODate(when)
    buckets.set(key, [...(buckets.get(key) ?? []), event])
  }

  const today = localISODate(now)
  const yesterday = localISODate(new Date(now.getTime() - 24 * 60 * 60 * 1000))

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, dayEvents]) => ({
      date,
      label: date === today ? 'Today' : date === yesterday ? 'Yesterday' : formatDayLabel(date),
      events: [...dayEvents].sort(
        (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
      ),
    }))
}

function formatDayLabel(isoDate: string): string {
  // Parsed as local midnight, not UTC - `new Date('2026-08-13')` would be UTC and could
  // render as the previous day for anyone west of Greenwich.
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: new Date().getFullYear() === y ? undefined : 'numeric',
  })
}

export function formatTime(occurredAt: string): string {
  const when = new Date(occurredAt)
  if (Number.isNaN(when.getTime())) return ''
  return when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * Who did it. `actor_id` is null for anything done by the service role or raw SQL, and
 * saying so plainly beats inventing a name or leaving the column blank - "System" is the
 * honest answer to "who ran this migration/script".
 */
export function actorLabel(
  event: Pick<AuditEvent, 'actor_id'>,
  names: ReadonlyMap<string, string>,
): string {
  if (!event.actor_id) return 'System'
  return names.get(event.actor_id) ?? 'A removed user'
}
