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
 * A column deliberately set up for this exact status — either linked via columns.status_key
 * (the "Link Status" column menu) or titled to match the status label precisely. Used when a
 * user explicitly picks a status from a task's dropdown: relocating the card into a column that
 * only *coincidentally* buckets the same way (see bucketFromText) would silently move the task
 * somewhere the user didn't choose, so that fallback is deliberately excluded here (unlike
 * findColumnForStatus, which drag-and-drop and legacy boards still rely on).
 */
export function findExactColumnForStatus(
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

  return undefined
}

/**
 * The statuses this board can actually accept — the ones findExactColumnForStatus resolves to
 * a column. Everything else would be refused at save time, so a picker must not offer it.
 *
 * Why this exists: the status pickers listed every status the org had defined regardless of
 * the board in front of you, and the check that rejects an impossible one runs on SUBMIT. So
 * you could pick "Cancelled" on a board with no Cancelled column, fill the whole form, and
 * only then be told no — with "ask an admin" as the remedy even when you were the admin.
 * Filtering the list at the source turns that into an option that was never offered.
 *
 * ⚠️ Fails OPEN. When `columns` is null/undefined — not loaded yet, or a caller that has no
 * board in scope — every status is returned rather than none. An empty picker reads as a
 * broken control, and the submit-time guard is still there to catch a genuinely impossible
 * choice; a picker that is briefly too generous is strictly better than one that is empty.
 */
export function statusesAvailableOnBoard<T extends StatusLike>(
  statuses: T[] | undefined | null,
  columns: ColumnLike[] | undefined | null,
): T[] {
  if (!statuses?.length) return []
  if (!columns) return statuses
  return statuses.filter((s) => Boolean(findExactColumnForStatus(s.key, s.label, columns)))
}

/**
 * The inverse: active statuses this board has no column for. Drives the admin-only prompt
 * that offers to create the missing column, so the gap is visible to the person who can
 * close it instead of surfacing as a refusal to whoever hits it first.
 *
 * Unlike statusesAvailableOnBoard this fails CLOSED — unknown columns means nothing is
 * reported missing, because prompting someone to fix a board you have not finished reading
 * is worse than staying quiet.
 */
export function statusesMissingFromBoard<T extends StatusLike>(
  statuses: T[] | undefined | null,
  columns: ColumnLike[] | undefined | null,
): T[] {
  if (!statuses?.length || !columns) return []
  return statuses.filter((s) => !findExactColumnForStatus(s.key, s.label, columns))
}

/**
 * What a status picker should offer: the statuses the board can accept, plus — always — the
 * one the record already holds, even when no column represents it any more.
 *
 * That last part is the CRM review's lesson (CLAUDE.md): a select whose value is not among
 * its options renders blank, so a task sitting in a status whose column was deleted would
 * show an empty control and silently offer to change to something else. Keeping its own
 * status listed means the control always says what is true.
 */
export function statusesForPicker<T extends StatusLike>(
  statuses: T[] | undefined | null,
  columns: ColumnLike[] | undefined | null,
  keepKey?: string | null,
): T[] {
  const available = statusesAvailableOnBoard(statuses, columns)
  if (!keepKey || available.some((s) => s.key === keepKey)) return available

  const current = statuses?.find((s) => s.key === keepKey)
  if (!current) return available

  // Re-derived from `statuses` rather than appended, so the picker keeps the admin-defined
  // order instead of pushing the current status to the bottom.
  const keep = new Set([...available.map((s) => s.key), keepKey])
  return (statuses ?? []).filter((s) => keep.has(s.key))
}

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

  const exact = findExactColumnForStatus(statusKey, statusLabel, columns)
  if (exact) return exact

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
