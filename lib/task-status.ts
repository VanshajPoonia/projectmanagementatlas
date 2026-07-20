export type NormalizedTaskStatus = 'to_do' | 'in_progress' | 'done'

function text(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

export function getNormalizedTaskStatus(task: any): NormalizedTaskStatus {
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

export function getTaskStatusLabel(task: any) {
  const normalized = getNormalizedTaskStatus(task)

  if (normalized === 'done') return 'Done'
  if (normalized === 'in_progress') return 'In Progress'
  return 'To Do'
}

interface StatusLike { key: string; label: string }
interface ColumnLike { id: string; title: string; tasks?: unknown[] }

/**
 * Find the board column a task should live in for a given status.
 *
 * Board columns are the source of truth for where a card sits, so picking a
 * status on a card should relocate it into the column that represents that
 * status. We match on the column title first (exact, case-insensitive) so a
 * status like "Completed" or "Cancelled" lands in its own column even when
 * several columns share the same normalized bucket (e.g. Done + Completed).
 * Falls back to the normalized to_do/in_progress/done bucket for older boards
 * whose column titles don't line up with the status labels.
 */
export function findColumnForStatus(
  statusKey: string,
  statusLabel: string | undefined,
  columns: ColumnLike[] | undefined | null,
): ColumnLike | undefined {
  if (!columns?.length) return undefined

  const label = text(statusLabel)
  if (label) {
    const exact = columns.find((c) => text(c.title) === label)
    if (exact) return exact
  }

  const targetBucket = getNormalizedTaskStatus({ status: statusKey })
  return columns.find((c) => getNormalizedTaskStatus({ column: { title: c.title } }) === targetBucket)
}

/**
 * The status key a card should display/select, derived from where the card
 * actually sits. The column it's in wins (matched to a status by label), so the
 * dropdown always reflects reality; otherwise fall back to the raw status key if
 * it's a known status, then to the normalized bucket.
 */
export function getEffectiveStatusKey(
  task: any,
  columns: ColumnLike[] | undefined | null,
  statuses: StatusLike[] | undefined | null,
): string {
  const columnId = task?.column_id
  const column = columns?.find((c) => c.id === columnId)
  if (column && statuses?.length) {
    const byTitle = statuses.find((s) => text(s.label) === text(column.title))
    if (byTitle) return byTitle.key
  }

  const rawStatus = text(task?.status).replace(/\s+/g, '_')
  if (rawStatus && statuses?.some((s) => s.key === rawStatus)) return rawStatus

  return getNormalizedTaskStatus(task)
}
