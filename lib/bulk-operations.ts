// Bulk operations: change many tasks at once, without any of the three ways that goes wrong.
//
// THE THREE FAILURE MODES THIS FILE EXISTS TO PREVENT
//
// 1. Silent partial success. RLS refusals in this product return zero rows and no error (see
//    lib/rls-write.ts). A loop that fires forty updates and reports "done" because nothing
//    threw will happily tell a guest they reassigned forty tasks while changing none. Every
//    item here is classified individually and the report distinguishes changed / unchanged /
//    refused / errored. A run where anything was refused is never reported as a success.
//
// 2. A no-op reported as a change. Setting priority to High on thirty tasks when twelve are
//    already High changed eighteen things, not thirty. planBulkOperation() works that out
//    BEFORE the run so the confirmation can say "18 of 30 will change" - which is also the
//    number that makes a destructive confirmation honest.
//
// 3. An unreviewable destructive action. Archive and delete get an explicit preview listing
//    what is about to happen, because "40 tasks" is not something anyone can sanity-check.
//
// RESUMABILITY comes from the same place idempotency does in migration 116: every operation
// here is a SET to an absolute value, never a relative mutation, so re-running a partially
// completed batch over the whole selection converges on the same state. The one exception is
// shift_dates, which is relative by definition - runBulkOperation therefore reports the exact
// ids it changed so a retry can be narrowed to the ones it did not.
//
// The execution loop takes its per-item write as a parameter rather than importing a Supabase
// client, so the retry and partial-failure behaviour is unit-testable with a fake that fails on
// demand. That behaviour is the whole point of the file and would otherwise only ever be
// exercised by a real outage.

import type { CapabilityDecision } from './capabilities'

export type BulkOperationKind =
  | 'assign'
  | 'unassign'
  | 'priority'
  | 'status'
  | 'label'
  | 'unlabel'
  | 'due_date'
  | 'shift_dates'
  | 'move'
  | 'archive'
  | 'delete'

/**
 * Every kind the engine implements, in one place.
 *
 * ⚠️ Exported so a test can assert the UI's own list is exhaustive over it. `unassign`,
 * `unlabel` and `move` were implemented here and quietly left out of the bulk bar - working
 * code with no route a human could take, which is the defect this repo has hit with
 * `board_members.role`, `app_modules` and the recurrence columns. A union type cannot catch
 * that on its own, because an incomplete array of a union is still a valid array.
 */
export const ALL_OPERATIONS: readonly BulkOperationKind[] = [
  'assign', 'unassign', 'priority', 'status', 'label', 'unlabel',
  'due_date', 'shift_dates', 'move', 'archive', 'delete',
]

export const DESTRUCTIVE_OPERATIONS: readonly BulkOperationKind[] = ['archive', 'delete']

export const OPERATION_LABELS: Record<BulkOperationKind, string> = {
  assign: 'Assign to',
  unassign: 'Remove assignee',
  priority: 'Set priority',
  status: 'Move to status',
  label: 'Add label',
  unlabel: 'Remove label',
  due_date: 'Set due date',
  shift_dates: 'Shift due dates',
  move: 'Move to board',
  archive: 'Archive',
  delete: 'Delete',
}

/** The minimum a task must expose for a bulk plan to be computed. */
export interface BulkTask {
  id: string
  title: string
  priority?: number | null
  due_date?: string | null
  status?: string | null
  column_id?: string | null
  archived_at?: string | null
  assigneeIds?: string[]
  tagIds?: string[]
}

export type ItemOutcome = 'will_change' | 'already_matches' | 'not_permitted'

export interface BulkItemPlan {
  taskId: string
  title: string
  outcome: ItemOutcome
  /** Why it is not permitted, or what it already matches. Always renderable. */
  note?: string
  before?: string
  after?: string
}

export interface BulkPlan {
  kind: BulkOperationKind
  items: BulkItemPlan[]
  counts: { willChange: number; alreadyMatches: number; notPermitted: number; total: number }
  destructive: boolean
  /** The sentence a confirmation dialog should show, or null when none is needed. */
  confirmation: string | null
  /** True when running would do nothing at all. The button should say so, not just be pressed. */
  isNoOp: boolean
}

export interface BulkOperationInput {
  kind: BulkOperationKind
  /** For assign/unassign: a user id. label/unlabel: a tag id. status: a status key. */
  targetId?: string
  /** Human-readable form of targetId, for the preview. */
  targetLabel?: string
  priority?: number
  dueDate?: string | null
  /** shift_dates only. Negative moves earlier. */
  shiftDays?: number
  /** move only. */
  boardId?: string
  columnId?: string
}

/** Per-task authorisation, supplied by the caller from lib/capabilities.ts. */
export type PermissionResolver = (task: BulkTask, kind: BulkOperationKind) => CapabilityDecision

function describePriority(p: number | null | undefined): string {
  const names: Record<number, string> = { 1: 'Highest', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Lowest' }
  return p == null ? 'none' : (names[p] ?? String(p))
}

function shiftIso(iso: string, days: number): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString()
}

/**
 * Work out what a bulk operation would actually do, before doing any of it.
 *
 * Nothing here touches the network. It is the input to both the confirmation dialog and the
 * "N of M will change" count, so the number a user approves is the number that then runs.
 */
export function planBulkOperation(
  input: BulkOperationInput,
  tasks: BulkTask[],
  permit: PermissionResolver,
): BulkPlan {
  const items: BulkItemPlan[] = tasks.map((task) => {
    const decision = permit(task, input.kind)
    if (!decision.allowed) {
      return {
        taskId: task.id,
        title: task.title,
        outcome: 'not_permitted' as const,
        note: decision.reason ?? 'You cannot change this task.',
      }
    }

    switch (input.kind) {
      case 'assign': {
        const has = task.assigneeIds?.includes(input.targetId ?? '') ?? false
        return has
          ? { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: `Already assigned to ${input.targetLabel ?? 'them'}` }
          : { taskId: task.id, title: task.title, outcome: 'will_change' as const, after: input.targetLabel }
      }
      case 'unassign': {
        const has = task.assigneeIds?.includes(input.targetId ?? '') ?? false
        return has
          ? { taskId: task.id, title: task.title, outcome: 'will_change' as const, before: input.targetLabel }
          : { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: `Not assigned to ${input.targetLabel ?? 'them'}` }
      }
      case 'priority': {
        const same = task.priority === input.priority
        return same
          ? { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: `Already ${describePriority(input.priority)}` }
          : {
              taskId: task.id, title: task.title, outcome: 'will_change' as const,
              before: describePriority(task.priority), after: describePriority(input.priority),
            }
      }
      case 'status': {
        const same = task.column_id === input.columnId
        return same
          ? { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: `Already in ${input.targetLabel ?? 'that status'}` }
          : { taskId: task.id, title: task.title, outcome: 'will_change' as const, before: task.status ?? undefined, after: input.targetLabel }
      }
      case 'label': {
        const has = task.tagIds?.includes(input.targetId ?? '') ?? false
        return has
          ? { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: `Already labelled ${input.targetLabel ?? ''}`.trim() }
          : { taskId: task.id, title: task.title, outcome: 'will_change' as const, after: input.targetLabel }
      }
      case 'unlabel': {
        const has = task.tagIds?.includes(input.targetId ?? '') ?? false
        return has
          ? { taskId: task.id, title: task.title, outcome: 'will_change' as const, before: input.targetLabel }
          : { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: 'Does not have that label' }
      }
      case 'due_date': {
        const current = task.due_date ? task.due_date.slice(0, 10) : null
        const next = input.dueDate ? input.dueDate.slice(0, 10) : null
        return current === next
          ? { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: next ? `Already due ${next}` : 'Already has no due date' }
          : {
              taskId: task.id, title: task.title, outcome: 'will_change' as const,
              before: current ?? 'none', after: next ?? 'none',
            }
      }
      case 'shift_dates': {
        // A task with no due date has nothing to shift. Reporting that as "changed" would
        // inflate the count with items the run cannot touch.
        if (!task.due_date) {
          return { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: 'No due date to shift' }
        }
        if (!input.shiftDays) {
          return { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: 'Shift of zero days' }
        }
        return {
          taskId: task.id, title: task.title, outcome: 'will_change' as const,
          before: task.due_date.slice(0, 10),
          after: shiftIso(task.due_date, input.shiftDays).slice(0, 10),
        }
      }
      case 'move': {
        return { taskId: task.id, title: task.title, outcome: 'will_change' as const, after: input.targetLabel }
      }
      case 'archive': {
        return task.archived_at
          ? { taskId: task.id, title: task.title, outcome: 'already_matches' as const, note: 'Already archived' }
          : { taskId: task.id, title: task.title, outcome: 'will_change' as const }
      }
      case 'delete': {
        return { taskId: task.id, title: task.title, outcome: 'will_change' as const }
      }
    }
  })

  const willChange = items.filter((i) => i.outcome === 'will_change').length
  const alreadyMatches = items.filter((i) => i.outcome === 'already_matches').length
  const notPermitted = items.filter((i) => i.outcome === 'not_permitted').length
  const destructive = DESTRUCTIVE_OPERATIONS.includes(input.kind)

  return {
    kind: input.kind,
    items,
    counts: { willChange, alreadyMatches, notPermitted, total: items.length },
    destructive,
    confirmation: destructive && willChange > 0 ? buildConfirmation(input.kind, willChange, notPermitted) : null,
    isNoOp: willChange === 0,
  }
}

function buildConfirmation(kind: BulkOperationKind, willChange: number, notPermitted: number): string {
  const noun = willChange === 1 ? 'task' : 'tasks'
  const verb = kind === 'delete' ? 'Delete' : 'Archive'
  const tail = notPermitted > 0
    ? ` ${notPermitted} other${notPermitted === 1 ? '' : 's'} in your selection cannot be changed by you and will be left alone.`
    : ''
  const consequence = kind === 'delete'
    ? ' Deleted tasks go to the recycle bin and can be restored by an admin.'
    : ' Archived tasks stay searchable and can be restored.'
  return `${verb} ${willChange} ${noun}?${consequence}${tail}`
}

// ---------------------------------------------------------------------------------------
// Execution.
// ---------------------------------------------------------------------------------------

export type ItemStatus = 'changed' | 'unchanged' | 'refused' | 'error'

export interface BulkItemResult {
  taskId: string
  title: string
  status: ItemStatus
  message?: string
  /** How many times this item was tried. >1 means a transient failure was retried. */
  attempts: number
}

export interface BulkRunReport {
  kind: BulkOperationKind
  items: BulkItemResult[]
  counts: Record<ItemStatus, number>
  /** Ids that did change - the input to "retry the rest" without redoing these. */
  changedIds: string[]
  /** Ids worth retrying: transient errors only, never refusals. */
  retryableIds: string[]
  startedAt: string
  finishedAt: string
}

/** What a per-item write reports back. Mirrors lib/rls-write.ts's WriteOutcome vocabulary. */
export type ApplyResult =
  | { kind: 'ok' }
  /** The write succeeded but took the row out of this caller's view. Still a change. */
  | { kind: 'invisible' }
  /** A policy declined. Retrying will not help, so it never is. */
  | { kind: 'refused' }
  | { kind: 'error'; message: string; retryable?: boolean }

export interface RunOptions {
  /** Attempts per item, including the first. Defaults to 3. */
  maxAttempts?: number
  /** Called after each item so the UI can show a live count. */
  onProgress?: (done: number, total: number) => void
  /** Injected so tests can run without waiting. */
  delay?: (ms: number) => Promise<void>
  /** Stop early. Whatever has already been applied stays applied - see the header on resumability. */
  signal?: { aborted: boolean }
}

const defaultDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run a planned operation item by item.
 *
 * Deliberately sequential. A bulk update is not a hot path, and forty parallel writes against
 * PostgREST make partial failure much harder to report accurately - which is the one thing this
 * function exists to get right.
 *
 * Only items the plan marked `will_change` are attempted: an already-matching item is recorded
 * as unchanged without a network call, and a not-permitted item is recorded as refused without
 * one either. That keeps the report's totals equal to the selection size, so nothing a user
 * selected can vanish from the accounting.
 */
export async function runBulkOperation(
  plan: BulkPlan,
  apply: (taskId: string) => Promise<ApplyResult>,
  options: RunOptions = {},
): Promise<BulkRunReport> {
  // Three attempts, not two. Retries only ever apply to transient errors - a refusal is never
  // retried, so a genuinely forbidden item still costs exactly one call - which makes the extra
  // attempt free in the common case and the difference between recovering and not during a
  // brief network blip mid-batch.
  const maxAttempts = Math.max(options.maxAttempts ?? 3, 1)
  const delay = options.delay ?? defaultDelay
  const startedAt = new Date().toISOString()
  const items: BulkItemResult[] = []
  let done = 0

  for (const planned of plan.items) {
    if (options.signal?.aborted) {
      items.push({
        taskId: planned.taskId, title: planned.title, status: 'unchanged',
        message: 'Stopped before this item was reached.', attempts: 0,
      })
      continue
    }

    if (planned.outcome === 'not_permitted') {
      items.push({
        taskId: planned.taskId, title: planned.title, status: 'refused',
        message: planned.note, attempts: 0,
      })
      done++
      options.onProgress?.(done, plan.items.length)
      continue
    }

    if (planned.outcome === 'already_matches') {
      items.push({
        taskId: planned.taskId, title: planned.title, status: 'unchanged',
        message: planned.note, attempts: 0,
      })
      done++
      options.onProgress?.(done, plan.items.length)
      continue
    }

    let attempts = 0
    let result: BulkItemResult | null = null

    while (attempts < maxAttempts) {
      attempts++
      let outcome: ApplyResult
      try {
        outcome = await apply(planned.taskId)
      } catch (err: any) {
        outcome = { kind: 'error', message: err?.message ?? 'Unexpected failure', retryable: true }
      }

      if (outcome.kind === 'ok' || outcome.kind === 'invisible') {
        result = {
          taskId: planned.taskId, title: planned.title, status: 'changed',
          message: outcome.kind === 'invisible' ? 'Saved, but no longer visible to you.' : undefined,
          attempts,
        }
        break
      }

      if (outcome.kind === 'refused') {
        // A policy said no. Trying again produces the same no, and burning a retry on it
        // delays every remaining item for nothing.
        result = {
          taskId: planned.taskId, title: planned.title, status: 'refused',
          message: 'You do not have permission to make this change.', attempts,
        }
        break
      }

      const retryable = outcome.retryable !== false
      if (!retryable || attempts >= maxAttempts) {
        result = {
          taskId: planned.taskId, title: planned.title, status: 'error',
          message: outcome.message, attempts,
        }
        break
      }
      // Back off a little before the next attempt.
      await delay(150 * attempts)
    }

    items.push(result!)
    done++
    options.onProgress?.(done, plan.items.length)
  }

  const counts: Record<ItemStatus, number> = { changed: 0, unchanged: 0, refused: 0, error: 0 }
  for (const item of items) counts[item.status]++

  return {
    kind: plan.kind,
    items,
    counts,
    changedIds: items.filter((i) => i.status === 'changed').map((i) => i.taskId),
    retryableIds: items.filter((i) => i.status === 'error').map((i) => i.taskId),
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}

/**
 * Build a plan containing only the items worth trying again.
 *
 * `retryableIds` is transient errors ONLY - a refusal is never in it, because retrying a policy
 * refusal just asks the same question and gets the same answer, and an item that changed is
 * never in it either, so a retry cannot double-apply. Both of those are decided by
 * runBulkOperation, not here; this function only narrows the original plan to that id set.
 *
 * `confirmation` is dropped deliberately: the destructive prompt was already answered for these
 * exact items on the first run, and asking again for a network blip trains people to click
 * through it.
 */
export function retryPlanFrom(plan: BulkPlan, report: BulkRunReport): BulkPlan {
  const retryable = new Set(report.retryableIds)
  const items = plan.items.filter((i) => retryable.has(i.taskId))
  const counts = {
    willChange: items.filter((i) => i.outcome === 'will_change').length,
    alreadyMatches: items.filter((i) => i.outcome === 'already_matches').length,
    notPermitted: items.filter((i) => i.outcome === 'not_permitted').length,
    total: items.length,
  }
  return {
    kind: plan.kind,
    items,
    counts,
    destructive: plan.destructive,
    confirmation: null,
    isNoOp: counts.willChange === 0,
  }
}

/**
 * Fold a retry's results back into the original report.
 *
 * The invariant that matters: the merged report still accounts for every task the user
 * originally selected, exactly once. A retry covers a subset, so the original row is kept for
 * anything the retry did not touch, and `attempts` accumulates across both runs rather than
 * being overwritten - otherwise a row that took four tries would report two and the retry
 * behaviour would be invisible again.
 */
export function mergeRunReports(original: BulkRunReport, retry: BulkRunReport): BulkRunReport {
  const byId = new Map(retry.items.map((i) => [i.taskId, i]))
  const items: BulkItemResult[] = original.items.map((prev) => {
    const next = byId.get(prev.taskId)
    if (!next) return prev
    return { ...next, attempts: prev.attempts + next.attempts }
  })
  const counts: Record<ItemStatus, number> = { changed: 0, unchanged: 0, refused: 0, error: 0 }
  for (const i of items) counts[i.status] += 1
  return {
    kind: original.kind,
    items,
    counts,
    changedIds: items.filter((i) => i.status === 'changed').map((i) => i.taskId),
    retryableIds: items.filter((i) => i.status === 'error').map((i) => i.taskId),
    startedAt: original.startedAt,
    finishedAt: retry.finishedAt,
  }
}

/**
 * The sentence to show when a run finishes.
 *
 * A run with any refusal or error is NEVER described as a plain success, because the whole
 * failure mode this file guards against is a green toast over a batch that half-worked.
 */
export function summarizeRun(report: BulkRunReport): { tone: 'success' | 'warning' | 'error'; title: string; description: string } {
  const { changed, unchanged, refused, error } = report.counts
  const label = OPERATION_LABELS[report.kind].toLowerCase()

  if (error > 0) {
    return {
      tone: 'error',
      title: `${changed} of ${report.items.length} updated`,
      description: `${error} failed and can be retried. ${refused > 0 ? `${refused} were not permitted. ` : ''}Download the report for the details.`,
    }
  }
  if (refused > 0) {
    return {
      tone: 'warning',
      title: `${changed} of ${report.items.length} updated`,
      description: `${refused} could not be changed by you and were left alone.`,
    }
  }
  if (changed === 0) {
    return {
      tone: 'warning',
      title: 'Nothing changed',
      description: unchanged > 0 ? `All ${unchanged} already matched.` : 'There was nothing to do.',
    }
  }
  return {
    tone: 'success',
    title: `${changed} ${changed === 1 ? 'task' : 'tasks'} updated`,
    description: unchanged > 0 ? `${unchanged} already matched and were left alone. (${label})` : `(${label})`,
  }
}

/**
 * The downloadable report the master prompt asks for on partial failure.
 *
 * CSV rather than JSON because the person who needs it is reconciling a list of work, and
 * every one of them already has a spreadsheet open.
 */
export function bulkReportCsv(report: BulkRunReport): string {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const rows = [
    ['task_id', 'title', 'result', 'attempts', 'detail'].join(','),
    ...report.items.map((i) =>
      [escape(i.taskId), escape(i.title), escape(i.status), String(i.attempts), escape(i.message ?? '')].join(','),
    ),
  ]
  return rows.join('\n')
}
