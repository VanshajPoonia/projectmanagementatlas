// "What should I work on next" — ranks a user's open tasks into a short, ordered
// shortlist.
//
// Deliberately a pure function over data the dashboard already holds (no schema, no
// extra query), and deliberately explainable: every ranked item carries the reasons
// that put it where it is. A ranked list with no visible "why" reads as a black box,
// and people stop trusting it the first time it disagrees with them.
//
// Scoring is additive across three signals:
//   urgency  — how close (or past) the due date is; dominates, since deadlines are
//              the thing that actually breaks
//   priority — the 1..5 scale (1 = highest, see scripts/046_flip_priority_scale.sql)
//   momentum — a nudge for work already in progress, so half-done tasks get closed
//              out instead of accumulating

import { getNormalizedTaskStatus } from './task-status'

export interface WorkNextItem {
  task: any
  score: number
  /** Human-readable justifications, most significant first. */
  reasons: string[]
  /** True when the due date has passed — lets the UI style the row as a warning. */
  isOverdue: boolean
}

const DAY_MS = 1000 * 60 * 60 * 24
const DEFAULT_PRIORITY = 3

/** Whole days from today until `due`. Negative = overdue. Null when there's no date. */
function daysUntilDue(due: unknown): number | null {
  if (!due) return null
  const date = new Date(due as string)
  if (Number.isNaN(date.getTime())) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / DAY_MS)
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

function priorityScore(priority: unknown): number {
  const value = Number(priority)
  const normalized = Number.isFinite(value) && value >= 1 && value <= 5 ? value : DEFAULT_PRIORITY
  // 1 (highest) -> 60 ... 5 (lowest) -> 12
  return (6 - normalized) * 12
}

function dueReason(days: number | null): string | null {
  if (days === null) return null
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days <= 7) return `Due in ${days} days`
  return null
}

export function scoreTask(task: any): WorkNextItem {
  const days = daysUntilDue(task?.due_date)
  const priority = Number(task?.priority)
  const inProgress = getNormalizedTaskStatus(task) === 'in_progress'

  const score = urgencyScore(days) + priorityScore(priority) + (inProgress ? 25 : 0)

  // Ordered so the most decision-relevant reason reads first.
  const reasons: string[] = []
  const due = dueReason(days)
  if (due) reasons.push(due)
  if (priority <= 2) reasons.push(priority === 1 ? 'Highest priority' : 'High priority')
  if (inProgress) reasons.push('Already in progress')
  if (days === null) reasons.push('No due date')

  return { task, score, reasons, isOverdue: days !== null && days < 0 }
}

/**
 * Rank a user's tasks into a shortlist. Expects tasks already narrowed to the user
 * (the dashboard's `myTasks`); completed and soft-deleted work is dropped here.
 *
 * Ties break toward the earlier due date, then the higher priority, so the order is
 * stable across renders rather than depending on the input array's order.
 */
export function getWorkNext(tasks: any[], limit = 5): WorkNextItem[] {
  return (tasks ?? [])
    .filter((task) => !task?.deleted_at && getNormalizedTaskStatus(task) !== 'done')
    .map(scoreTask)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score

      const aDue = a.task?.due_date ? new Date(a.task.due_date).getTime() : Infinity
      const bDue = b.task?.due_date ? new Date(b.task.due_date).getTime() : Infinity
      if (aDue !== bDue) return aDue - bDue

      return (Number(a.task?.priority) || DEFAULT_PRIORITY) - (Number(b.task?.priority) || DEFAULT_PRIORITY)
    })
    .slice(0, limit)
}
