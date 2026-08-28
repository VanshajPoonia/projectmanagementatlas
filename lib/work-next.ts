// "What should I work on next" - ranks a user's open tasks into a short, ordered
// shortlist.
//
// Deliberately a pure function over data the dashboard already holds (no schema, no
// extra query), and deliberately explainable: every ranked item carries the reasons
// that put it where it is. A ranked list with no visible "why" reads as a black box,
// and people stop trusting it the first time it disagrees with them.
//
// Scoring is additive across three signals:
//   urgency  - how close (or past) the due date is; dominates, since deadlines are
//              the thing that actually breaks
//   priority - the 1..5 scale (1 = highest, see scripts/046_flip_priority_scale.sql)
//   momentum - a nudge for work already in progress, so half-done tasks get closed
//              out instead of accumulating
//
// Three more signals arrive from outside the task row itself, and are supplied by the caller
// as `WorkSignals` because they need queries this module must not run:
//
//   blocked  - something has to finish first (task_relations, migration 115). A large
//              PENALTY: recommending work its owner cannot start is worse than recommending
//              nothing, because they find out only after opening it.
//   blocking - other people's work is waiting on this one (also 115). A boost, because the
//              cost of a day's delay is multiplied by however many items are stuck behind it.
//   approval - the item's status is flagged is_approval (migration 121). A penalty for the
//              same reason as blocked: it is parked on somebody else's decision.
//
// Every one of them is DETERMINISTIC and every one of them appears in `reasons`. There is no
// hidden term: if the list ranks something surprisingly, the row says why.

import { getNormalizedTaskStatus } from './task-status'
import { daysBetween, taskDueDate } from './calendar-grid'
import { businessDate } from './crm'

export interface WorkNextItem {
  task: any
  score: number
  /** Human-readable justifications, most significant first. */
  reasons: string[]
  /** True when the due date has passed - lets the UI style the row as a warning. */
  isOverdue: boolean
  /** True when something has to finish first, or somebody has to approve it. */
  isBlocked: boolean
}

/**
 * What the surrounding graph says about one task. Supplied by the caller, never queried here:
 * this module stays a pure function over data a screen already holds, and the relation and
 * status-catalog reads belong to the page that owns them.
 *
 * Every field defaults to "no signal", so a caller that knows none of this gets exactly the
 * ranking it got before any of these existed.
 */
export interface WorkSignals {
  /** Open work items that must finish before this one can proceed (`blocked_by`). */
  blockedBy?: number
  /** Open work items belonging to somebody else that are waiting on this one (`blocks`). */
  blocking?: number
  /** The task sits in a status a super admin has marked as awaiting approval. */
  awaitingApproval?: boolean
}

const NO_SIGNALS: WorkSignals = {}

/** How a caller supplies signals per task. */
export type WorkSignalsFor = (task: any) => WorkSignals

const DEFAULT_PRIORITY = 3

/**
 * Whole days from today until `due`. Negative = overdue. Null when there's no date.
 *
 * ⚠️ Calendar dates in the business zone, never instants - see the same note on
 * `daysUntil` in my-work.ts. `due_date` is a Postgres DATE and arrives as `YYYY-MM-DD`;
 * parsing that with `new Date()` and zeroing it with local `setHours` shifted every date a
 * day earlier west of Greenwich, so work due today was scored and labelled as a day overdue.
 *
 * `now` is a parameter rather than a `new Date()` inside the function for two reasons: the
 * scoring is only testable at a fixed instant if the caller owns the clock, and a component
 * that reads the wall clock during render makes the server and client disagree across a day
 * boundary (the hydration trap `lib/use-now.ts` exists for).
 */
function daysUntilDue(due: unknown, now: Date): number | null {
  const date = taskDueDate({ due_date: due })
  if (!date) return null
  return daysBetween(businessDate(now), date)
}

/**
 * Urgency contribution. Overdue work outranks everything else and keeps climbing
 * the longer it slips, but the climb is capped at 30 days so one ancient forgotten
 * task can't permanently occupy the top of the list.
 */
function urgencyScore(days: number | null): number {
  if (days === null) return 0
  if (days < 0) return 100 + Math.min(Math.abs(days), 30) * 2
  if (days === 0) return 90
  if (days === 1) return 70
  if (days <= 3) return 55
  if (days <= 7) return 35
  if (days <= 14) return 15
  return 5
}

/**
 * The 1..5 priority a task actually carries, falling back to the middle of the scale.
 *
 * ⚠️ Extracted so the SCORE and the REASON cannot disagree. They did: the reason line tested
 * the raw `Number(task.priority)`, and `Number(null)` is 0, so every task with no priority set
 * (a nullable column, so most of them) was scored as medium and simultaneously labelled
 * "High priority". A displayed reason that the score does not support is worse than no reason -
 * it is the unexplained-ranking failure this module was written to avoid.
 */
function normalizePriority(priority: unknown): number {
  const value = Number(priority)
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : DEFAULT_PRIORITY
}

function priorityScore(priority: number): number {
  // 1 (highest) -> 60 ... 5 (lowest) -> 12
  return (6 - priority) * 12
}

function dueReason(days: number | null): string | null {
  if (days === null) return null
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days <= 7) return `Due in ${days} days`
  return null
}

/**
 * Penalty for work that cannot be started, and boost for work other people are stuck behind.
 *
 * The penalties are large enough to sink an item below undated work but NOT large enough to
 * push it off the list entirely: something badly overdue AND blocked still deserves to be
 * seen, because the right next action there is to go and unblock it.
 */
const BLOCKED_PENALTY = 60
const APPROVAL_PENALTY = 40
const BLOCKING_BOOST = 20

export function scoreTask(task: any, now: Date = new Date(), signals: WorkSignals = NO_SIGNALS): WorkNextItem {
  const days = daysUntilDue(task?.due_date, now)
  const priority = normalizePriority(task?.priority)
  const inProgress = getNormalizedTaskStatus(task) === 'in_progress'

  // ⚠️ Read once, into locals, and used for BOTH the score and the reason. The one bug this
  // module has already shipped was a reason line that tested a different expression from the
  // one the score used, so every unprioritised task was labelled "High priority".
  const blockedBy = Math.max(0, Number(signals.blockedBy ?? 0) || 0)
  const blocking = Math.max(0, Number(signals.blocking ?? 0) || 0)
  const awaitingApproval = Boolean(signals.awaitingApproval)

  const score =
    urgencyScore(days) +
    priorityScore(priority) +
    (inProgress ? 25 : 0) +
    (blocking > 0 ? BLOCKING_BOOST : 0) -
    (blockedBy > 0 ? BLOCKED_PENALTY : 0) -
    (awaitingApproval ? APPROVAL_PENALTY : 0)

  // Ordered so the most decision-relevant reason reads first. Being unable to act at all
  // outranks a deadline: a due date tells you when, a blocker tells you whether.
  const reasons: string[] = []
  if (blockedBy > 0) reasons.push(`Blocked by ${blockedBy} item${blockedBy === 1 ? '' : 's'}`)
  if (awaitingApproval) reasons.push('Waiting on approval')
  const due = dueReason(days)
  if (due) reasons.push(due)
  if (blocking > 0) reasons.push(`Blocks ${blocking} other item${blocking === 1 ? '' : 's'}`)
  if (priority <= 2) reasons.push(priority === 1 ? 'Highest priority' : 'High priority')
  if (inProgress) reasons.push('Already in progress')
  if (days === null) reasons.push('No due date')

  return {
    task,
    score,
    reasons,
    isOverdue: days !== null && days < 0,
    isBlocked: blockedBy > 0 || awaitingApproval,
  }
}

/**
 * Rank a user's tasks into a shortlist. Expects tasks already narrowed to the user
 * (the dashboard's `myTasks`); completed and soft-deleted work is dropped here.
 *
 * Ties break toward the earlier due date, then the higher priority, so the order is
 * stable across renders rather than depending on the input array's order.
 */
export function getWorkNext(
  tasks: any[],
  limit = 5,
  now: Date = new Date(),
  signalsFor?: WorkSignalsFor,
): WorkNextItem[] {
  return (tasks ?? [])
    .filter((task) => !task?.deleted_at && getNormalizedTaskStatus(task) !== 'done')
    .map((task) => scoreTask(task, now, signalsFor ? signalsFor(task) : NO_SIGNALS))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score

      // Calendar dates compared as strings, so this never parses a DATE column into an
      // instant. Undated work gets a sentinel that sorts after every real date.
      const aDue = taskDueDate(a.task ?? {}) ?? '9999-12-31'
      const bDue = taskDueDate(b.task ?? {}) ?? '9999-12-31'
      if (aDue !== bDue) return aDue < bDue ? -1 : 1

      return normalizePriority(a.task?.priority) - normalizePriority(b.task?.priority)
    })
    .slice(0, limit)
}
