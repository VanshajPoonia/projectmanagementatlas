/**
 * Milestones: a dated commitment a project is judged against.
 *
 * ⚠️ THE ONE RULE THIS FILE FOLLOWS, INHERITED FROM PROMPT H.
 * There is no stored `progress` anywhere in migration 133, and there is no function here that
 * returns "milestone progress" as a single blended figure. A milestone's progress is EXECUTION
 * progress - how much of the linked work is finished - and `milestoneProgress` below is a thin
 * adapter over `executionProgress` in lib/goals.ts rather than a second implementation of the
 * same idea. This repo's most expensive recurring shape is two copies of one truth drifting
 * apart (Prompt E's audit found three implementations of one filter, disagreeing), so the
 * adapter is deliberately three lines and delegates everything real.
 *
 * ⚠️ STATE IS A DECISION; BEING LATE IS A FACT.
 * `state` is what a person declared: open, reached, missed, cancelled. Whether an OPEN
 * milestone is overdue is derived from its due date and today, every time it is asked, so the
 * two can never disagree. Nothing here writes "missed" because a date passed - that is 130's
 * rejected-versus-parked distinction, where the reason a thing ended is the half you need six
 * months later and flattening it loses exactly that half.
 */

import {
  executionProgress,
  type ExecutionProgress,
  type GoalLinkRow,
  type GoalTaskRow,
} from './goals'
import type { StatusCatalog } from './task-status'
import { daysBetween } from './calendar-grid'

/* ── Vocabulary ────────────────────────────────────────────────────────────────────── */

export type MilestoneState = 'open' | 'reached' | 'missed' | 'cancelled'

export const MILESTONE_STATES: MilestoneState[] = ['open', 'reached', 'missed', 'cancelled']

export const MILESTONE_STATE_LABELS: Record<MilestoneState, string> = {
  open: 'Open',
  reached: 'Reached',
  missed: 'Missed',
  cancelled: 'Cancelled',
}

/**
 * The states whose meaning is "somebody decided this ended badly", and which therefore owe a
 * reason. Mirrored by private.enforce_milestone_state in migration 133; the parity between
 * this constant and that trigger is a gate (lib/milestones.parity.test.ts and
 * scripts/check-milestones.mjs), not a claim.
 */
export const MILESTONE_STATES_NEEDING_REASON: MilestoneState[] = ['missed', 'cancelled']

export const MILESTONE_STATE_HINTS: Record<MilestoneState, string> = {
  open: 'Still ahead of us. Whether it is late is worked out from the date, not stored.',
  reached: 'Hit. The date it was hit is stamped automatically and cannot be back-dated here.',
  missed: 'The date passed and the commitment was not met. Needs a reason.',
  cancelled: 'The commitment was dropped rather than missed. Needs a reason.',
}

export interface MilestoneRow {
  id: string
  board_id: string
  title: string
  description?: string | null
  owner_id?: string | null
  created_by?: string | null
  due_date: string
  state?: MilestoneState | null
  state_note?: string | null
  state_changed_at?: string | null
  state_changed_by?: string | null
  reached_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface MilestoneTaskRow {
  milestone_id: string
  task_id: string
}

export function milestoneState(milestone: Pick<MilestoneRow, 'state'>): MilestoneState {
  const state = milestone.state
  return state && MILESTONE_STATES.includes(state) ? state : 'open'
}

export function isMilestoneOpen(milestone: Pick<MilestoneRow, 'state'>): boolean {
  return milestoneState(milestone) === 'open'
}

/* ── The transition rule, mirrored from the trigger ────────────────────────────────── */

/**
 * Why this transition would be refused, or null if it is fine.
 *
 * ⚠️ This exists so the dialog can DISABLE its Save button and say why, rather than sending a
 * write the database will refuse. An RLS or trigger refusal surfaces as an error a person
 * cannot act on, and 104 is the recorded case of the opposite mistake: a rule honoured by one
 * screen and by nothing underneath it. Here both halves exist and are pinned against each
 * other, so neither can be the only one enforcing it.
 *
 * A no-op is deliberately not a transition. Re-saving a milestone that is already `missed`
 * without retyping its reason must not be refused, or an ordinary title edit would demand the
 * reason again every time.
 */
export function stateChangeRejection(
  from: MilestoneState | null | undefined,
  to: MilestoneState,
  note: string | null | undefined,
): string | null {
  if (!MILESTONE_STATES.includes(to)) return `${to} is not a milestone state.`
  if (from === to) return null
  if (!MILESTONE_STATES_NEEDING_REASON.includes(to)) return null
  if ((note ?? '').trim() !== '') return null
  return `Recording a milestone as ${MILESTONE_STATE_LABELS[to].toLowerCase()} needs a reason. Six months from now the note is the only record of why the date moved.`
}

/**
 * What the note becomes after a transition, matching the trigger's blanking rules exactly.
 * Used by the dialog to clear the field the moment somebody picks Reached, so the form never
 * shows a reason that the database is about to throw away.
 */
export function noteAfterTransition(
  to: MilestoneState,
  note: string | null | undefined,
): string | null {
  if (!MILESTONE_STATES_NEEDING_REASON.includes(to)) return null
  const trimmed = (note ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/* ── Pressure: derived, never stored ───────────────────────────────────────────────── */

export type MilestonePressure =
  | 'reached'
  | 'missed'
  | 'cancelled'
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'upcoming'

export interface MilestoneStatus {
  state: MilestoneState
  pressure: MilestonePressure
  /** Negative when the date has passed. Null once the milestone is closed in any way. */
  daysRemaining: number | null
  label: string
}

/** Inside this many days an open milestone counts as near-term. */
export const DUE_SOON_DAYS = 7

/**
 * @param today a calendar day (YYYY-MM-DD) in the business zone, resolved ONCE on the server
 *              and passed down. Letting each browser answer "what is today" from its own clock
 *              is the family of bug this repo has shipped five-plus times.
 */
export function milestoneStatus(milestone: MilestoneRow, today: string): MilestoneStatus {
  const state = milestoneState(milestone)

  if (state !== 'open') {
    return {
      state,
      pressure: state,
      daysRemaining: null,
      label: MILESTONE_STATE_LABELS[state],
    }
  }

  const remaining = daysBetween(today, milestone.due_date)

  if (remaining < 0) {
    const late = Math.abs(remaining)
    return {
      state,
      pressure: 'overdue',
      daysRemaining: remaining,
      label: late === 1 ? '1 day overdue' : `${late} days overdue`,
    }
  }
  if (remaining === 0) {
    return { state, pressure: 'due_today', daysRemaining: 0, label: 'Due today' }
  }
  if (remaining <= DUE_SOON_DAYS) {
    return {
      state,
      pressure: 'due_soon',
      daysRemaining: remaining,
      label: remaining === 1 ? 'Due tomorrow' : `Due in ${remaining} days`,
    }
  }
  return {
    state,
    pressure: 'upcoming',
    daysRemaining: remaining,
    label: `Due in ${remaining} days`,
  }
}

/** Whether this milestone should draw attention: late, or open and nearly here. */
export function needsAttention(status: MilestoneStatus): boolean {
  return status.pressure === 'overdue' || status.pressure === 'due_today' || status.pressure === 'due_soon'
}

/* ── Progress ──────────────────────────────────────────────────────────────────────── */

/**
 * How much of this milestone's work is finished.
 *
 * Delegates to lib/goals.ts. The two objects link work differently - a goal may point at whole
 * boards, a milestone only ever at tasks on its own board - but "how much of the linked work is
 * closed" is one question, and answering it twice is how two screens end up disagreeing about
 * the same project.
 *
 * Returns `percent: null` when nothing is linked. NOT zero: "no work linked" and "no work done"
 * are different facts, and a 0% bar on an untouched plan is a criticism the data does not
 * support (129's rule, and 124's for unestimated sprint items).
 */
export function milestoneProgress(
  links: MilestoneTaskRow[],
  tasksById: Map<string, GoalTaskRow>,
  statuses: StatusCatalog,
): ExecutionProgress {
  const asGoalLinks: GoalLinkRow[] = links.map((l) => ({
    id: `${l.milestone_id}:${l.task_id}`,
    goal_id: l.milestone_id,
    task_id: l.task_id,
    board_id: null,
  }))
  return executionProgress(asGoalLinks, tasksById, statuses)
}

/**
 * The sentence under a milestone's progress bar. Built FROM the value object so it cannot
 * describe a different calculation than the one that produced the number - lib/work-next.ts
 * shipped a reason line computed from a different expression than its score, and once is
 * enough.
 */
export function explainProgress(progress: ExecutionProgress): string {
  if (progress.total === 0) {
    return progress.unresolved > 0
      ? `No work you can see is linked to this milestone. ${progress.unresolved} linked ${progress.unresolved === 1 ? 'item is' : 'items are'} on a board you do not have access to.`
      : 'Nothing linked yet, so there is no progress to report.'
  }
  const base = `${progress.closed} of ${progress.total} linked ${progress.total === 1 ? 'item' : 'items'} closed.`
  return progress.unresolved > 0
    ? `${base} ${progress.unresolved} more ${progress.unresolved === 1 ? 'is' : 'are'} on a board you cannot see and ${progress.unresolved === 1 ? 'is' : 'are'} not counted.`
    : base
}

/**
 * ⚠️ A milestone whose work is all done is not automatically reached, and this function is
 * where somebody would be tempted to make it so. It deliberately only SUGGESTS.
 *
 * The plan's ruling on project health is the precedent: "manual first - an auto-status that is
 * wrong destroys trust in every other number shown." Closing every linked task is evidence that
 * a commitment was met, not proof: the milestone may need work nobody linked, or a sign-off
 * that is not a task at all. So the product offers the button and a person presses it.
 */
export function suggestsReached(
  milestone: MilestoneRow,
  progress: ExecutionProgress,
): boolean {
  return isMilestoneOpen(milestone) && progress.total > 0 && progress.percent === 100
}

/* ── Ordering ──────────────────────────────────────────────────────────────────────── */

const STATE_ORDER: Record<MilestoneState, number> = {
  open: 0,
  missed: 1,
  reached: 2,
  cancelled: 3,
}

/**
 * Soonest first, open before closed, stable by title.
 *
 * Open milestones lead because they are the ones still worth acting on, and an overdue one
 * sorts to the very top of that group for free by having the earliest date.
 */
export function sortMilestones(milestones: MilestoneRow[]): MilestoneRow[] {
  return [...milestones].sort((a, b) => {
    const stateDelta = STATE_ORDER[milestoneState(a)] - STATE_ORDER[milestoneState(b)]
    if (stateDelta !== 0) return stateDelta
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
    return (a.title ?? '').localeCompare(b.title ?? '')
  })
}

/** Open milestones that are late or nearly here, soonest first. Feeds My Work. */
export function milestonePressureList(
  milestones: MilestoneRow[],
  today: string,
): { milestone: MilestoneRow; status: MilestoneStatus }[] {
  return sortMilestones(milestones)
    .map((milestone) => ({ milestone, status: milestoneStatus(milestone, today) }))
    .filter((entry) => needsAttention(entry.status))
}
