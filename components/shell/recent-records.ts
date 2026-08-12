// Recently viewed records — the shell's "where was I?" memory.
//
// The sidebar has always had a Recent section, but nothing ever fed it: every host
// passed the default empty array, so the block silently never rendered. This module is
// the missing half.
//
// Pure, framework-free logic (use-recent-records.ts wraps it with localStorage + SSR
// guards) so the ordering and de-duplication rules are unit-testable without a DOM —
// same split as sidebar-state.ts.

export type RecentKind = 'board' | 'task' | 'view'

export interface RecentRecord {
  /** Stable identity, e.g. `board:<uuid>`. Revisiting moves the entry rather than adding one. */
  key: string
  kind: RecentKind
  label: string
  href: string
  /** Epoch ms of the most recent visit. */
  at: number
}

/** How many entries survive. Long enough to cover a work session, short enough to scan. */
export const RECENT_LIMIT = 8

/** Per-user key so two accounts on one browser don't inherit each other's history. */
export function recentStorageKey(userId: string): string {
  return `app_recent_records:${userId}`
}

function isRecord(value: unknown): value is RecentRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<RecentRecord>
  return (
    typeof r.key === 'string' &&
    typeof r.label === 'string' &&
    typeof r.href === 'string' &&
    typeof r.at === 'number' &&
    (r.kind === 'board' || r.kind === 'task' || r.kind === 'view')
  )
}

/**
 * Parse persisted JSON defensively. Anything malformed — a hand-edited value, a shape
 * from an older build — degrades to "no history" rather than throwing inside the shell,
 * which would take the whole sidebar down with it.
 */
export function parseRecentRecords(raw: string | null): RecentRecord[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

export function serializeRecentRecords(records: RecentRecord[]): string {
  return JSON.stringify(records)
}

/**
 * Add a visit, newest first.
 *
 * Re-visiting an existing record moves it to the top and refreshes its label rather
 * than appending a duplicate — a renamed board should not appear twice under two names.
 */
export function rememberRecord(
  records: RecentRecord[],
  entry: Omit<RecentRecord, 'at'> & { at?: number },
  limit: number = RECENT_LIMIT,
): RecentRecord[] {
  const at = entry.at ?? Date.now()
  const next: RecentRecord = { ...entry, at }
  return [next, ...records.filter((r) => r.key !== entry.key)].slice(0, limit)
}

/** Drop a record — e.g. after its board is archived and the link would 404. */
export function forgetRecord(records: RecentRecord[], key: string): RecentRecord[] {
  return records.filter((r) => r.key !== key)
}
