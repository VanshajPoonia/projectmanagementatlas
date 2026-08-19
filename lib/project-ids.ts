// Pure helpers for the Project ID ledger (migration 090). Kept out of the view so the
// numbering rules - which are the whole product here - are unit-testable without a browser
// or a database.
//
// The authoritative allocation happens in public.claim_project_id(); everything below is for
// *displaying* what is coming next. If the two ever disagree, the database wins.

/** The organization runs on Central time, and so does the YYMM prefix. */
export const LEDGER_TIME_ZONE = 'America/Chicago'

/** The first sequence issued in any month. Mirrors claim_project_id()'s COALESCE(MAX, 1110)+1. */
export const FIRST_SEQUENCE = 1111

/** The last sequence a 4-digit slot can hold. */
export const LAST_SEQUENCE = 9999

export interface ProjectIdRow {
  id: string
  project_id: string
  year_month: string
  seq: number
  client_name: string
  company_id: string | null
  grabbed_by: string | null
  grabbed_by_name: string
  grabbed_at: string
}

/**
 * The YYMM prefix for a given instant, in Central time.
 *
 * Deliberately not derived from the local clock: someone claiming at 11pm Central on the last
 * day of a month is still in that month, and a UTC-based prefix would already have rolled over.
 */
export function centralYearMonth(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEDGER_TIME_ZONE,
    year: '2-digit',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((p) => p.type === 'year')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  return `${year}${month}`
}

/** Renders the number exactly as the database stores it: YYMM followed by the 4-digit sequence. */
export function formatProjectId(yearMonth: string, seq: number): string {
  return `${yearMonth}${seq}`
}

/**
 * The sequence the next claim will receive, given everything already claimed.
 *
 * Counts from the highest sequence used this month rather than from the row count, so deleting
 * a row (which only a database admin can do) can never hand the same number out twice.
 */
export function nextSequence(rows: Pick<ProjectIdRow, 'year_month' | 'seq'>[], yearMonth: string): number {
  const highest = rows
    .filter((row) => row.year_month === yearMonth)
    .reduce((max, row) => Math.max(max, row.seq), FIRST_SEQUENCE - 1)
  return highest + 1
}

/**
 * The next `count` numbers, for the read-only "ready to use" preview.
 *
 * Stops at the end of the month's range instead of rendering impossible 5-digit numbers.
 */
export function upcomingProjectIds(yearMonth: string, from: number, count: number): string[] {
  const ids: string[] = []
  for (let seq = from; seq < from + count && seq <= LAST_SEQUENCE; seq++) {
    ids.push(formatProjectId(yearMonth, seq))
  }
  return ids
}

/** How many numbers were claimed in the given month. */
export function usedThisMonth(rows: Pick<ProjectIdRow, 'year_month'>[], yearMonth: string): number {
  return rows.filter((row) => row.year_month === yearMonth).length
}

/**
 * Free-text match across the three things anyone actually looks a number up by: the number
 * itself, the client it was taken for, and who took it.
 */
export function matchesProjectIdSearch(row: ProjectIdRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    row.project_id.toLowerCase().includes(needle) ||
    row.client_name.toLowerCase().includes(needle) ||
    row.grabbed_by_name.toLowerCase().includes(needle)
  )
}

/** Timestamps are displayed in the same zone the numbers are minted in, and labelled as such. */
export function formatClaimedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: LEDGER_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
