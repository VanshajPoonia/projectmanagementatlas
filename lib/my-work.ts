// My Work - the personal cockpit.
//
// The plan is explicit that "My Work" is not a synonym for "assigned to me". It should answer:
//
//   What belongs to me?        → assigned / in progress / personal
//   What needs attention?      → overdue, due today, due this week
//   What should I do next?     → the ranked shortlist, with its reasons (work-next.ts)
//   What am I waiting on?      → blocked by others, waiting on approval, delegated
//   What am I blocking?        → blocking others
//
// ⚠️ THE LAST TWO USED TO BE LISTED HERE AS UNANSWERABLE, and that stopped being true two
// migrations ago. `115` shipped task relations (blocks / blocked_by, with the inverse derived
// by `task_relations_expanded`) and `121` let a status declare that work in it is waiting on
// somebody's sign-off. The gap note outlived the schema that closed it, which is its own small
// lesson: a documented limitation needs an owner, or it becomes a claim the code no longer
// supports. What remains genuinely unanswerable is in UNANSWERED_QUESTIONS below, and it is a
// shorter list than it was.
//
// Pure functions over rows the page already fetches. Nothing here queries anything: the
// relation rows, the personal tasks and the approval status keys all arrive as arguments, so
// this module stays trivially testable and the page keeps ownership of its own reads.

import { getNormalizedTaskStatus } from './task-status'
import { getWorkNext, type WorkNextItem, type WorkSignals } from './work-next'
import { daysBetween, taskDueDate } from './calendar-grid'
import { businessDate } from './crm'
import type { ExpandedRelation } from './task-relations'

export interface MyWorkSection {
  id: string
  title: string
  /** Why this section exists - rendered as the section's own explanation. */
  description: string
  tasks: any[]
}

/**
 * Questions My Work is *supposed* to answer but still cannot.
 *
 * Kept deliberately short and specific. A section that quietly guesses is worse than no
 * section: people rely on it, and the first time it is wrong they stop trusting every other
 * number on the page.
 */
export const UNANSWERED_QUESTIONS: ReadonlyArray<{ question: string; blockedBy: string }> = [
  { question: 'Which of my work is at risk because a milestone is slipping?', blockedBy: 'milestones' },
  { question: 'What is a client waiting on me for?', blockedBy: 'the client portal' },
]

/**
 * Whole days from today until `due`. Negative = overdue. Null when there's no date.
 *
 * ⚠️ Both ends are CALENDAR DATES, never instants. `due_date` is TIMESTAMPTZ holding midnight
 * on the day somebody picked, so the intended day is the UTC date part - `taskDueDate` is the
 * only correct reader. Resolving it through a timezone lands on the day before for the common
 * row shape, which is the same one-day defect this repo has now recorded five times.
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
 * The status key a task actually holds.
 *
 * FK-first, matching `getEffectiveStatusKey`'s rule - the column's own `status_key` (migration
 * 063) is authoritative, and `tasks.status` is the fallback. Written out here rather than
 * reused because the shapes differ: that function takes a separate `columns` array, and My
 * Work's query embeds the column on the task.
 */
export function taskStatusKeyOf(task: any): string {
  const fromColumn = task?.column?.status_key
  if (fromColumn) return String(fromColumn)
  return String(task?.status ?? '').trim().replace(/\s+/g, '_')
}

export interface MyWorkContext {
  /** Rows from `task_relations_expanded`, already RLS-filtered. */
  relations?: readonly ExpandedRelation[]
  /** `task_statuses.key` for every status flagged `is_approval` (migration 121). */
  approvalStatusKeys?: ReadonlySet<string>
  /** The viewer's own `personal_tasks` rows, when the module is on. */
  personalTasks?: readonly any[]
}

/**
 * What the relation graph says about one task, for the sections and for WorkNext.
 *
 * ⚠️ Only relations whose OTHER END this page can resolve are counted. A relation row is
 * readable only when the viewer can see both tasks (migration 115's SELECT policy), so an
 * unresolvable other end means the page filtered it - it is on an archived board. Counting it
 * would put a number on screen with nothing behind it: the reader clicks through to find
 * nothing, which is worse than the number being one lower. Stated rather than silent.
 */
export function relationSignals(
  relations: readonly ExpandedRelation[] | undefined,
  byId: Map<string, any>,
  userId: string,
  isMine: (task: any) => boolean,
): Map<string, { blockedBy: any[]; blocking: any[] }> {
  const signals = new Map<string, { blockedBy: any[]; blocking: any[] }>()
  const entry = (taskId: string) => {
    let found = signals.get(taskId)
    if (!found) {
      found = { blockedBy: [], blocking: [] }
      signals.set(taskId, found)
    }
    return found
  }

  for (const relation of relations ?? []) {
    const other = byId.get(relation.related_task_id)
    if (!other || !isOpen(other)) continue

    if (relation.relation === 'blocked_by') {
      entry(relation.task_id).blockedBy.push(other)
    } else if (relation.relation === 'blocks') {
      // "Blocking others" means somebody ELSE is stuck. A task of mine blocking another task
      // of mine is just my own sequencing, and reporting it as an obligation to a colleague
      // would be a number that means nothing.
      if (!isMine(other)) entry(relation.task_id).blocking.push(other)
    }
  }

  return signals
}

/**
 * Split a user's work into sections.
 *
 * `mine` is the caller's own tasks (already narrowed by assignment - the dashboard's
 * `myTasks`); `all` is everything they can see, which is what makes the delegated section
 * possible. Ordering inside every section is earliest-due-first so the top of each list is the
 * thing that breaks soonest; undated work sorts last rather than first.
 *
 * Empty sections are dropped, so the page never shows a heading with nothing under it - except
 * that the CALLER decides order and visibility (see lib/my-work-preferences.ts), because which
 * of these questions matters most is a personal thing and one person's preference must not
 * change anyone else's screen.
 */
export function buildMyWork(
  mine: any[],
  all: any[],
  userId: string,
  now: Date = new Date(),
  context: MyWorkContext = {},
): { sections: MyWorkSection[]; next: WorkNextItem[] } {
  const open = (mine ?? []).filter(isOpen)
  const mineIds = new Set(open.map((t) => t?.id))
  const byId = new Map<string, any>((all ?? []).map((task) => [task?.id, task]))
  const isMine = (task: any) => mineIds.has(task?.id)

  const signals = relationSignals(context.relations, byId, userId, isMine)
  const approvalKeys = context.approvalStatusKeys ?? new Set<string>()
  const awaitsApproval = (task: any) => approvalKeys.has(taskStatusKeyOf(task))

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
  const blocked = open.filter((task) => (signals.get(task?.id)?.blockedBy.length ?? 0) > 0)
  const blocking = open.filter((task) => (signals.get(task?.id)?.blocking.length ?? 0) > 0)
  const awaitingApproval = open.filter(awaitsApproval)

  // The honest version of "waiting on someone else" that needs no relations: work I created
  // and handed off.
  const delegated = (all ?? [])
    .filter(isOpen)
    .filter((task) => task?.created_by === userId && !mineIds.has(task?.id))

  // ⚠️ `is_done`, not `completed`. That is the column name in 030, and the wrong one would
  // have filtered nothing and listed every finished personal task forever.
  const personal = byDueDate((context.personalTasks ?? []).filter((task: any) => !task?.is_done))

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
      id: 'blocked',
      title: 'Blocked by others',
      description:
        'Something else has to finish first. Chasing the blocker is the only thing that moves these.',
      tasks: byDueDate(blocked),
    },
    {
      id: 'awaiting-approval',
      title: 'Waiting on approval',
      description:
        'Parked in a status that means somebody has to sign off. Not yours to push until they do.',
      tasks: byDueDate(awaitingApproval),
    },
    {
      id: 'blocking',
      title: 'Blocking others',
      description:
        'Someone else’s work is waiting on these. A day’s delay here costs more than a day.',
      tasks: byDueDate(blocking),
    },
    {
      id: 'in-progress',
      title: 'In progress',
      description: 'Already started. Finishing these beats starting something new.',
      tasks: byDueDate(inProgress),
    },
    {
      id: 'this-week',
      title: 'Upcoming',
      description: 'Lands within the next seven days.',
      tasks: byDueDate(thisWeek),
    },
    {
      id: 'delegated',
      title: 'Waiting on someone else',
      description: 'You created these and someone else is carrying them. Chase, or take them back.',
      tasks: byDueDate(delegated),
    },
    {
      id: 'personal',
      title: 'Personal tasks',
      description: 'Your own list. Nobody else can see these.',
      tasks: personal,
    },
    {
      id: 'assigned',
      title: 'Assigned to me',
      description:
        'Everything open with your name on it, including everything already listed above. The complete picture, last, because the sections above are the parts that need a decision.',
      tasks: byDueDate(open),
    },
  ]

  const workSignals = (task: any): WorkSignals => {
    const signal = signals.get(task?.id)
    return {
      blockedBy: signal?.blockedBy.length ?? 0,
      blocking: signal?.blocking.length ?? 0,
      awaitingApproval: awaitsApproval(task),
    }
  }

  return {
    sections: sections.filter((s) => s.tasks.length > 0),
    next: getWorkNext(open, 5, now, workSignals),
  }
}

/**
 * Earliest due date first; undated work sorts to the end rather than the front.
 *
 * Compared as `YYYY-MM-DD` strings, which sort lexicographically, so this never parses a due
 * date into an instant either.
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
export function myWorkSummary(
  mine: any[],
  now: Date = new Date(),
  context: MyWorkContext = {},
  all: any[] = mine,
) {
  const open = (mine ?? []).filter(isOpen)
  const mineIds = new Set(open.map((t) => t?.id))
  const byId = new Map<string, any>((all ?? []).map((task) => [task?.id, task]))
  const signals = relationSignals(context.relations, byId, '', (task) => mineIds.has(task?.id))

  let overdue = 0
  let dueToday = 0
  let blocked = 0
  for (const task of open) {
    if ((signals.get(task?.id)?.blockedBy.length ?? 0) > 0) blocked++
    const days = daysUntil(task?.due_date, now)
    if (days === null) continue
    if (days < 0) overdue++
    else if (days === 0) dueToday++
  }
  return { open: open.length, overdue, dueToday, blocked }
}
