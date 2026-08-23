export type NormalizedTaskStatus = 'to_do' | 'in_progress' | 'done'

/**
 * The normalized meaning of a status, as stored in `task_statuses.category` (migration 112).
 *
 * This is the durable domain fact. `NormalizedTaskStatus` above is a *presentation* collapse
 * of it into the three buckets this app's dashboards, cards and reports render. They are
 * deliberately different vocabularies: keeping `backlog` distinguishable from `planned` at the
 * data layer is what lets a future Backlog status exist without every consumer learning about
 * it, because both already collapse to `to_do` here.
 */
export type StatusCategory = 'backlog' | 'planned' | 'started' | 'completed' | 'cancelled'

export const STATUS_CATEGORIES: StatusCategory[] = [
  'backlog',
  'planned',
  'started',
  'completed',
  'cancelled',
]

/** Human wording for the category picker in status management. */
export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  backlog: 'Backlog - captured, not yet scheduled',
  planned: 'Planned - scheduled, not started',
  started: 'Started - actively being worked on',
  completed: 'Completed - finished successfully',
  cancelled: 'Cancelled - closed without completing',
}

const CATEGORY_BUCKET: Record<StatusCategory, NormalizedTaskStatus> = {
  backlog: 'to_do',
  planned: 'to_do',
  started: 'in_progress',
  // Cancelled collapses to `done` because every consumer of this bucket is asking "is this
  // still open?" - cancelled work is not open, and counting it as overdue would be wrong.
  // Callers that need to tell the two apart ask for the category, not the bucket.
  completed: 'done',
  cancelled: 'done',
}

export function bucketForCategory(category: StatusCategory): NormalizedTaskStatus {
  return CATEGORY_BUCKET[category] ?? 'to_do'
}

/** A closed status is one where work has left the pipeline. Mirrors `task_statuses.is_closed`. */
export function isClosedCategory(category: StatusCategory): boolean {
  return category === 'completed' || category === 'cancelled'
}

/** The narrow shape this module needs from a status row; `useTaskStatuses` returns a superset. */
export interface CategorizedStatus {
  key: string
  label?: string
  category?: StatusCategory | null
}

/** Every status row the app knows about, or nothing when the caller has no catalog to hand. */
export type StatusCatalog = readonly CategorizedStatus[] | null | undefined

function text(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function isStatusCategory(value: unknown): value is StatusCategory {
  return typeof value === 'string' && (STATUS_CATEGORIES as string[]).includes(value)
}

/**
 * The declared category for a status key, or undefined when the catalog cannot answer -
 * because none was supplied, because it has not loaded, or because the key is not one of
 * ours. Undefined means "fall back", never "no category".
 */
export function categoryForStatusKey(
  key: string | null | undefined,
  statuses: StatusCatalog,
): StatusCategory | undefined {
  if (!key || !statuses?.length) return undefined
  const normalizedKey = text(key)
  const match = statuses.find((s) => text(s.key) === normalizedKey)
  const category = match?.category
  return isStatusCategory(category) ? category : undefined
}

/**
 * LEGACY. Map a status string to a bucket by looking for substrings in it.
 *
 * ⚠️ This is the guess migration 112 exists to retire, and it is wrong for any status whose
 * name does not happen to contain one of these words - `review`, `blocked`, `wip`, `qa` and
 * `waiting` all fall through to `to_do`, so blocked work reports as not started. It survives
 * only as the last resort for callers that have a bare status string and no catalog to
 * resolve it against; every path below consults `task_statuses.category` first and returns
 * before reaching here whenever that answers.
 */
function bucketFromText(value: string): NormalizedTaskStatus {
  if (value.includes('done') || value.includes('complete') || value.includes('cancel')) {
    return 'done'
  }
  if (value.includes('progress') || value.includes('going') || value.includes('ongoing')) {
    return 'in_progress'
  }
  return 'to_do'
}

/**
 * The status key a task effectively holds, read straight off the row.
 *
 * FK-first per migration 063: an explicit `column.status_key` is the source of truth, because
 * a column titled "WIP" says nothing reliable about what it means. Falls back to the
 * denormalised `tasks.status` string, which `lib/task-mutations.ts` still writes alongside
 * `column_id`.
 */
function rawStatusKey(task: any): string {
  const columnStatusKey = text(task?.column?.status_key)
  if (columnStatusKey) return columnStatusKey
  return text(task?.status).replace(/\s+/g, '_')
}

/**
 * Which of the three coarse buckets a task sits in, for overdue/open math, reports, the
 * dashboards and the AI assistant.
 *
 * Pass `statuses` (from `useTaskStatuses()`) wherever it is available: with a catalog the
 * answer comes from `task_statuses.category`, which an admin declared, and is correct for any
 * status the workspace ever adds. Without one the legacy substring heuristic decides, which is
 * right only for statuses whose names happen to contain the words it looks for.
 */
export function getNormalizedTaskStatus(task: any, statuses?: StatusCatalog): NormalizedTaskStatus {
  const key = rawStatusKey(task)

  const category = categoryForStatusKey(key, statuses)
  if (category) return bucketForCategory(category)

  // No catalog, or a key it does not know. Everything below is the pre-112 behaviour,
  // unchanged, so a caller that passes no catalog gets exactly what it got before.
  if (text(task?.column?.status_key)) return bucketFromText(text(task.column.status_key))

  const status = key
  const columnTitle = text(task?.column?.title)

  if (
    status === 'done'
    || status.includes('complete')
    || status.includes('cancel')
    || columnTitle.includes('done')
    || columnTitle.includes('complete')
    || columnTitle.includes('cancel')
  ) {
    // "Cancelled" is a closed/terminal state like Done - grouping it here keeps
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

/**
 * The category a task's status declares, or undefined when the catalog cannot say.
 *
 * Use this over `getNormalizedTaskStatus` whenever completed and cancelled must be told
 * apart - they share the `done` bucket by design.
 */
export function getTaskStatusCategory(task: any, statuses: StatusCatalog): StatusCategory | undefined {
  return categoryForStatusKey(rawStatusKey(task), statuses)
}

function isCancelled(task: any, statuses?: StatusCatalog) {
  const category = getTaskStatusCategory(task, statuses)
  if (category) return category === 'cancelled'

  // Legacy: FK-first, then text.
  const columnStatusKey = text(task?.column?.status_key)
  if (columnStatusKey) return columnStatusKey.includes('cancel')
  return text(task?.status).replace(/\s+/g, '_').includes('cancel') || text(task?.column?.title).includes('cancel')
}

/**
 * What to show as this task's status.
 *
 * With a catalog this returns the status's own admin-chosen label, so a workspace that adds
 * "In Review" sees "In Review" rather than the bucket name. Without one it returns the same
 * four hardcoded strings it always has - which, for the four seeded statuses, are identical to
 * their labels, so passing a catalog changes nothing about what today's data renders.
 */
export function getTaskStatusLabel(task: any, statuses?: StatusCatalog): string {
  const key = rawStatusKey(task)
  if (key && statuses?.length) {
    const match = statuses.find((s) => text(s.key) === key)
    if (match?.label) return match.label
  }

  if (isCancelled(task, statuses)) return 'Cancelled'

  const normalized = getNormalizedTaskStatus(task, statuses)

  if (normalized === 'done') return 'Completed'
  if (normalized === 'in_progress') return 'In Progress'
  return 'To Do'
}

/**
 * The category a status row declares, or undefined when it carries none - an un-migrated
 * row, or a hand-built literal. Undefined always means "fall back", never "no category".
 */
export function statusCategoryOf(status: CategorizedStatus | null | undefined): StatusCategory | undefined {
  const category = status?.category
  return isStatusCategory(category) ? category : undefined
}

/**
 * Is this status the cancelled kind?
 *
 * Cancelled is not just another closed status in this product - it is an archive destination.
 * New work is never created there (see `statusesForCreation`), and the board refuses to open
 * the create dialog on a cancelled column. Asking the category rather than comparing the key
 * to the literal `'cancelled'` is what makes that hold for a workspace that adds a second
 * cancelled-category status, e.g. "Won't Do" or "Rejected".
 */
export function isCancelledStatus(status: CategorizedStatus | null | undefined): boolean {
  const category = statusCategoryOf(status)
  if (category) return category === 'cancelled'
  return text(status?.key).includes('cancel')
}

/** Is work in this status still open? Mirrors the generated `task_statuses.is_closed`. */
export function isOpenStatus(status: CategorizedStatus | null | undefined): boolean {
  const category = statusCategoryOf(status)
  if (category) return !isClosedCategory(category)
  return bucketFromText(text(status?.key)) !== 'done'
}

/**
 * The statuses new work may be created in - everything except the cancelled ones.
 *
 * `done` deliberately stays: creating an already-finished task is a legitimate way to record
 * work that happened outside the tool. Cancelling something that was never started is not.
 */
export function statusesForCreation<T extends CategorizedStatus>(
  statuses: T[] | null | undefined,
): T[] {
  return (statuses ?? []).filter((s) => !isCancelledStatus(s))
}

/**
 * The category of the status a board column is linked to (migration 063's `status_key`).
 * Undefined for a custom column with no linked status, or when the catalog has not loaded.
 */
export function categoryForColumn(
  column: { status_key?: string | null } | null | undefined,
  statuses: StatusCatalog,
): StatusCategory | undefined {
  return categoryForStatusKey(column?.status_key, statuses)
}

interface StatusLike { key: string; label: string }

interface ColumnLike { id: string; title: string; status_key?: string | null; tasks?: unknown[] }

/**
 * A column deliberately set up for this exact status - either linked via columns.status_key
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
 * The statuses this board can actually accept - the ones findExactColumnForStatus resolves to
 * a column. Everything else would be refused at save time, so a picker must not offer it.
 *
 * Why this exists: the status pickers listed every status the org had defined regardless of
 * the board in front of you, and the check that rejects an impossible one runs on SUBMIT. So
 * you could pick "Cancelled" on a board with no Cancelled column, fill the whole form, and
 * only then be told no - with "ask an admin" as the remedy even when you were the admin.
 * Filtering the list at the source turns that into an option that was never offered.
 *
 * ⚠️ Fails OPEN. When `columns` is null/undefined - not loaded yet, or a caller that has no
 * board in scope - every status is returned rather than none. An empty picker reads as a
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
 * Unlike statusesAvailableOnBoard this fails CLOSED - unknown columns means nothing is
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
 * What a status picker should offer: the statuses the board can accept, plus - always - the
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
