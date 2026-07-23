export type NormalizedTaskStatus = 'to_do' | 'in_progress' | 'done'

function text(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

// Map a single status string — a canonical status *key* ('in_progress', 'cancelled', …) or a
// free-text column title — to one of the three coarse buckets used for overdue/open math,
// reports and the AI assistant. Substring matching is reliable on canonical keys; it is only
// unreliable on arbitrary column titles, which is why callers prefer the FK (status_key) below.
function bucketFromText(value: string): NormalizedTaskStatus {
  if (value.includes('done') || value.includes('complete') || value.includes('cancel')) {
    return 'done'
  }
  if (value.includes('progress') || value.includes('going') || value.includes('ongoing')) {
    return 'in_progress'
  }
  return 'to_do'
}

export function getNormalizedTaskStatus(task: any): NormalizedTaskStatus {
  // FK-first: an explicit column.status_key is the source of truth. Normalizing the canonical
  // key (not the title) is what stops a "WIP" column silently classifying its tasks as to_do.
  const columnStatusKey = text(task?.column?.status_key)
  if (columnStatusKey) return bucketFromText(columnStatusKey)

  // Legacy fallback for columns without a status_key: fuzzy-match the raw status and the title.
  const status = text(task?.status).replace(/\s+/g, '_')
  const columnTitle = text(task?.column?.title)

  if (
    status === 'done'
    || status.includes('complete')
    || status.includes('cancel')
    || columnTitle.includes('done')
    || columnTitle.includes('complete')
    || columnTitle.includes('cancel')
  ) {
    // "Cancelled" is a closed/terminal state like Done — grouping it here keeps
    // cancelled work out of the "overdue" and "still open" buckets.
    return 'done'
  }

  if (
    status === 'in_progress'
    || status.includes('progress')
    || status.includes('going')
    || status.includes('ongoing')
    || columnTitle.includes('progress')
    || columnTitle.includes('going')
    || columnTitle.includes('ongoing')
  ) {
    return 'in_progress'
  }

  return 'to_do'
}

function isCancelled(task: any) {
  // FK-first: if the column is explicitly mapped, trust that key; else fall back to text.
  const columnStatusKey = text(task?.column?.status_key)
  if (columnStatusKey) return columnStatusKey.includes('cancel')
  return text(task?.status).replace(/\s+/g, '_').includes('cancel') || text(task?.column?.title).includes('cancel')
}

export function getTaskStatusLabel(task: any) {
  if (isCancelled(task)) return 'Cancelled'

  const normalized = getNormalizedTaskStatus(task)

  if (normalized === 'done') return 'Completed'
  if (normalized === 'in_progress') return 'In Progress'
  return 'To Do'
}

interface StatusLike { key: string; label: string }
interface ColumnLike { id: string; title: string; status_key?: string | null; tasks?: unknown[] }

/**
 * Find the board column a task should live in for a given status.
 *
 * FK-first: a column explicitly mapped to this status (columns.status_key) wins. Otherwise we
 * match on the column title (exact, case-insensitive) so a status like "Completed"/"Cancelled"
 * lands in its own column even when several share a normalized bucket, and finally fall back to
 * the normalized to_do/in_progress/done bucket for older boards whose titles don't line up.
 */
export function findColumnForStatus(
  statusKey: string,
  statusLabel: string | undefined,
  columns: ColumnLike[] | undefined | null,
): ColumnLike | undefined {
  if (!columns?.length) return undefined

  const byKey = columns.find((c) => c.status_key === statusKey)
  if (byKey) return byKey

  const label = text(statusLabel)
  if (label) {
    const exact = columns.find((c) => text(c.title) === label)
    if (exact) return exact
  }

  const targetBucket = bucketFromText(text(statusKey))
  return columns.find((c) => getNormalizedTaskStatus({ column: c }) === targetBucket)
}

/**
 * The status key a card should display/select, derived from where the card actually sits.
 *
 * FK-first: the column's own status_key is authoritative. Otherwise the column it's in wins
 * (matched to a status by label) so the dropdown reflects reality; then the raw status key if
 * it's a known status; then the normalized bucket.
 */
export function getEffectiveStatusKey(
  task: any,
  columns: ColumnLike[] | undefined | null,
  statuses: StatusLike[] | undefined | null,
): string {
  const columnId = task?.column_id
  const column = columns?.find((c) => c.id === columnId)

  if (column?.status_key) return column.status_key

  if (column && statuses?.length) {
    const byTitle = statuses.find((s) => text(s.label) === text(column.title))
    if (byTitle) return byTitle.key
  }

  const rawStatus = text(task?.status).replace(/\s+/g, '_')
  if (rawStatus && statuses?.some((s) => s.key === rawStatus)) return rawStatus

  return getNormalizedTaskStatus(task)
}
