// My Work - the personal cockpit.
//
// The plan is explicit that "My Work" is not a synonym for "assigned to me". It should
// answer:
//
//   What is mine?              → assigned / created sections
//   What is urgent?            → overdue, due today, due this week
//   What should I do next?     → the ranked shortlist, with its reasons (work-next.ts)
//   What is waiting on someone → delegated: I created it, someone else owns it
//   What blocks others?        → NOT ANSWERABLE YET - needs task dependencies
//   What requires approval?    → NOT ANSWERABLE YET - needs an approvals module
//
// The last two are deliberately absent rather than approximated. A section that quietly
// guesses at "blocked" is worse than no section: people would rely on it, and the first
// time it was wrong they would stop trusting every other number on the page. See
// UNANSWERED_QUESTIONS, which the view renders as an explicit note.
//
// Pure functions over task rows the page already fetches - no schema, no extra query.

import { getNormalizedTaskStatus } from './task-status'
import { getWorkNext, type WorkNextItem } from './work-next'
import { daysBetween, taskDueDate } from './calendar-grid'
import { businessDate } from './crm'

export interface MyWorkSection {
  id: string
  title: string
  /** Why this section exists - rendered as the section's own explanation. */
  description: string
  tasks: any[]
}

/** Questions My Work is *supposed* to answer but cannot with today's schema. */
export const UNANSWERED_QUESTIONS: ReadonlyArray<{ question: string; blockedBy: string }> = [
  { question: 'What am I blocking for someone else?', blockedBy: 'task dependencies' },
  { question: 'What is waiting on my approval?', blockedBy: 'an approvals module' },
]

/**
 * Whole days from today until `due`. Negative = overdue. Null when there's no date.
 *
 * ⚠️ Both ends are CALENDAR DATES in the business zone, never instants. `due_date` is a
 * Postgres DATE and arrives as a bare `YYYY-MM-DD`; the previous version parsed that with
 * `new Date()` (UTC midnight) and then zeroed it with local `setHours`, which in any negative
 * UTC offset lands on the day before. Measured in America/Chicago: a task due today reported
 * -1, so the Overdue count included today's work and "Due today" showed tomorrow's, all day,
 * every day. Same defect class as the CRM's target-close date and the board's overdue filter.
 */
export function daysUntil(due: unknown, now: Date = new Date()): number | null {
  const date = taskDueDate({ due_date: due })
  if (!date) return null
  return daysBetween(businessDate(now), date)
}

export function isOpen(task: any): boolean {
  return !task?.deleted_at && getNormalizedTaskStatus(task) !== 'done'
}

/**
 * Split a user's open work into the sections above.
 *
 * `mine` is the caller's own tasks (already narrowed by assignment - the dashboard's
 * `myTasks`); `all` is everything they can see, which is what makes the delegated
 * section possible. Ordering inside every section is earliest-due-first so the top of
 * each list is the thing that breaks soonest; undated work sorts last rather than
 * first, which is what a null date would otherwise do.
 */
export function buildMyWork(
  mine: any[],
  all: any[],
  userId: string,
  now: Date = new Date(),
): { sections: MyWorkSection[]; next: WorkNextItem[] } {
  const open = (mine ?? []).filter(isOpen)

  const overdue: any[] = []
  const today: any[] = []
  const thisWeek: any[] = []

  for (const task of open) {
    const days = daysUntil(task?.due_date, now)
    if (days === null) continue
    if (days < 0) overdue.push(task)
    else if (days === 0) today.push(task)
    else if (days <= 7) thisWeek.push(task)
  }

  const inProgress = open.filter((task) => getNormalizedTaskStatus(task) === 'in_progress')

  // The honest version of "waiting on someone else" with today's schema: work I created
  // and handed off. Without dependencies this is the only real hand-off signal there is.
  const mineIds = new Set(open.map((t) => t?.id))
  const delegated = (all ?? [])
    .filter(isOpen)
    .filter((task) => task?.created_by === userId && !mineIds.has(task?.id))

  const sections: MyWorkSection[] = [
    {
      id: 'overdue',
      title: 'Overdue',
      description: 'Past its due date and still open. These are the ones already costing something.',
      tasks: byDueDate(overdue),
    },
    {
      id: 'today',
      title: 'Due today',
      description: 'Due before the day is out.',
      tasks: byDueDate(today),
    },
    {
      id: 'in-progress',
      title: 'In progress',
      description: 'Already started. Finishing these beats starting something new.',
      tasks: byDueDate(inProgress),
    },
    {
      id: 'this-week',
      title: 'Due this week',
      description: 'Lands within the next seven days.',
      tasks: byDueDate(thisWeek),
    },
    {
      id: 'delegated',
      title: 'Waiting on someone else',
      description: 'You created these and someone else is carrying them. Chase, or take them back.',
      tasks: byDueDate(delegated),
    },
  ]

  return { sections: sections.filter((s) => s.tasks.length > 0), next: getWorkNext(open, 5, now) }
}

/**
 * Earliest due date first; undated work sorts to the end rather than the front.
 *
 * Compared as `YYYY-MM-DD` strings, which sort lexicographically, so this never parses a date
 * column into an instant either. Undated work gets a sentinel that sorts after every real date.
 */
export function byDueDate(tasks: any[]): any[] {
  const key = (t: any) => taskDueDate(t ?? {}) ?? '9999-12-31'
  return [...tasks].sort((a, b) => {
    const aDue = key(a)
    const bDue = key(b)
    if (aDue !== bDue) return aDue < bDue ? -1 : 1
    return String(a?.title ?? '').localeCompare(String(b?.title ?? ''))
  })
}

/** Headline counts for the top of the page. */
export function myWorkSummary(mine: any[], now: Date = new Date()) {
  const open = (mine ?? []).filter(isOpen)
  let overdue = 0
  let dueToday = 0
  for (const task of open) {
    const days = daysUntil(task?.due_date, now)
    if (days === null) continue
    if (days < 0) overdue++
    else if (days === 0) dueToday++
  }
  return { open: open.length, overdue, dueToday }
}
