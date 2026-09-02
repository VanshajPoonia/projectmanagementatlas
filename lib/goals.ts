// Goals - and the one distinction Prompt H spends most of its words on.
//
//   "Display separately: EXECUTION PROGRESS - how much planned work is complete.
//    OUTCOME PROGRESS - did the target business/user metric improve.
//    Never imply they are the same."
//
// ATLAS_01 10.6 puts the cost plainly: "A project can complete all tasks and still fail its
// outcome." So this module deliberately has NO function that returns "goal progress". There
// are two functions returning two differently-shaped values, and nothing here will average,
// blend or default one into the other. If a caller wants a single percentage for a progress
// bar, it has to choose which one it means, in the open, at the call site.
//
// The same explainability contract as lib/sprint-metrics.ts applies (Prompt H inherits it
// from ATLAS_01 10.5): a number travels with its definition, its formula, what it counted,
// what it left out, its unit and when it last moved. The panel renders from the value, never
// from a caption written beside it - a caption drifts from the maths, a field cannot.
//
// No React, no Supabase, and no `new Date()` on a stored day: `starts_on` / `ends_on` are
// DATE columns and are compared as calendar strings through lib/calendar-grid.ts, which is
// this repo's fifth-plus attempt at not re-learning the tasks.due_date lesson.

import { daysBetween } from './calendar-grid'
import { getTaskStatusCategory, isClosedCategory, type StatusCatalog } from './task-status'

export type GoalState = 'active' | 'achieved' | 'missed' | 'cancelled'
export type GoalConfidence = 'high' | 'medium' | 'low'
export type GoalHealth = 'on_track' | 'at_risk' | 'off_track'

export const GOAL_STATES: GoalState[] = ['active', 'achieved', 'missed', 'cancelled']

export const GOAL_STATE_LABELS: Record<GoalState, string> = {
  active: 'Active',
  achieved: 'Achieved',
  // Not "failed". A goal that ended short is information about how the company forecasts,
  // and a word people flinch from is a word they stop recording honestly.
  missed: 'Missed',
  cancelled: 'Cancelled',
}

export const GOAL_CONFIDENCE_LABELS: Record<GoalConfidence, string> = {
  high: 'Confident',
  medium: 'Unsure',
  low: 'Doubtful',
}

export const GOAL_HEALTH_LABELS: Record<GoalHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
}

/**
 * ⚠️ Health is entered by a person and never inferred, matching the plan's ruling on project
 * health: "manual first - an auto-status that is wrong destroys trust in every other number
 * shown." A goal can be 80% of the way to its number and off track because the last 20% is
 * the hard part, and no formula knows that.
 */
export const GOAL_HEALTH_IS_MANUAL =
  'Health is set by a person, never calculated. A goal can be most of the way to its number and still be off track, and a status that guesses wrong stops people trusting the numbers beside it.'

export interface GoalRow {
  id: string
  title: string
  description?: string | null
  owner_id?: string | null
  starts_on?: string | null
  ends_on?: string | null
  metric?: string | null
  unit?: string | null
  start_value?: number | string | null
  current_value?: number | string | null
  target_value?: number | string | null
  confidence?: GoalConfidence | null
  health?: GoalHealth | null
  state?: GoalState | null
  position?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export interface GoalLinkRow {
  id: string
  goal_id: string
  board_id?: string | null
  task_id?: string | null
}

export interface GoalTaskRow {
  id: string
  title?: string | null
  status?: string | null
  column?: { status_key?: string | null; board_id?: string | null } | null
}

export interface GoalCheckinRow {
  id: string
  goal_id: string
  on_date: string
  current_value?: number | string | null
  confidence?: GoalConfidence | null
  health?: GoalHealth | null
  note?: string | null
  kind: 'opened' | 'measured'
  created_at: string
}

/** PostgREST hands NUMERIC back as a string. Everything below goes through this first. */
export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------------------
// The two progress models. Two shapes, deliberately - see the header.
// ---------------------------------------------------------------------------------------

export interface ExecutionProgress {
  /** Null when nothing is linked. NOT zero: "no work linked" and "no work done" are different. */
  percent: number | null
  closed: number
  total: number
  /** Exactly which work items were counted. ATLAS_01 10.5's "included records". */
  includedTaskIds: string[]
  /**
   * Work linked to this goal that this viewer cannot resolve - a task on a board they cannot
   * see. Counting it would put a number on screen with nothing behind it; hiding the fact
   * would let a partial list read as a complete one, which is this codebase's most repeated
   * defect ("hidden from you" and "does not exist" arriving identical).
   */
  unresolved: number
  boardCount: number
  definition: string
  formula: string
  excludes: string
}

export interface OutcomeProgress {
  /**
   * Null whenever the three numbers cannot answer the question - no target, no start, or a
   * start equal to the target. A goal with no metric is a perfectly good goal and must not be
   * shown as 0%.
   */
  percent: number | null
  start: number | null
  current: number | null
  target: number | null
  unit: string | null
  /** 'up' when the target is above the start, 'down' when the aim is to reduce it. */
  direction: 'up' | 'down' | null
  /** Why there is no percentage, when there is none. Rendered instead of a bar. */
  unavailableReason: string | null
  lastMeasured: string | null
  definition: string
  formula: string
  excludes: string
}

const EXECUTION_DEFINITION =
  'How much of the work linked to this goal is finished.'
const EXECUTION_FORMULA =
  'Linked work items whose status category is completed or cancelled, divided by all linked work items.'
const EXECUTION_EXCLUDES =
  'Work on a linked project that has not been linked to the goal itself, and any linked item this viewer cannot see. It says nothing about whether the goal is being reached.'

const OUTCOME_DEFINITION =
  'How far the measurement has moved from where it started towards its target.'
const OUTCOME_FORMULA =
  '(current - start) / (target - start), clamped to 0-100%. It works the same way when the target is lower than the start.'
const OUTCOME_EXCLUDES =
  'Everything about the work. Finishing every task moves this number by nothing at all unless the measurement itself moved.'

/**
 * Execution progress: how much of the LINKED WORK is finished.
 *
 * ⚠️ `tasks` is one of the 35 tables RLS can return a partial list from, so `tasksById` holds
 * only what this viewer may see. An id in `links` with no entry there has been filtered, not
 * deleted, and it is reported as `unresolved` rather than silently dropped or counted as open.
 */
export function executionProgress(
  links: GoalLinkRow[],
  tasksById: Map<string, GoalTaskRow>,
  statuses: StatusCatalog,
): ExecutionProgress {
  const taskLinks = links.filter((l) => l.task_id)
  const boardIds = new Set(links.filter((l) => l.board_id).map((l) => l.board_id as string))

  const included: string[] = []
  let closed = 0
  let unresolved = 0

  for (const link of taskLinks) {
    const task = tasksById.get(link.task_id as string)
    if (!task) {
      unresolved += 1
      continue
    }
    included.push(task.id)
    const category = getTaskStatusCategory(task, statuses)
    if (category && isClosedCategory(category)) closed += 1
  }

  return {
    percent: included.length === 0 ? null : Math.round((closed / included.length) * 100),
    closed,
    total: included.length,
    includedTaskIds: included,
    unresolved,
    boardCount: boardIds.size,
    definition: EXECUTION_DEFINITION,
    formula: EXECUTION_FORMULA,
    excludes: EXECUTION_EXCLUDES,
  }
}

/**
 * Outcome progress: did the measurement move.
 *
 * Direction-aware on purpose. "Cut callbacks from 12 to 4" is a goal, and a formula that
 * assumes bigger is better reports it as -200% while it is going perfectly.
 */
export function outcomeProgress(goal: GoalRow, checkins: GoalCheckinRow[] = []): OutcomeProgress {
  const start = num(goal.start_value)
  const current = num(goal.current_value)
  const target = num(goal.target_value)
  const unit = goal.unit?.trim() ? goal.unit.trim() : null

  const measured = checkins
    .filter((c) => c.goal_id === goal.id)
    .map((c) => c.created_at)
    .sort()
  const lastMeasured = measured.length > 0 ? measured[measured.length - 1] : null

  const base = {
    start, current, target, unit, lastMeasured,
    definition: OUTCOME_DEFINITION,
    formula: OUTCOME_FORMULA,
    excludes: OUTCOME_EXCLUDES,
  }

  if (target === null) {
    return { ...base, percent: null, direction: null, unavailableReason: 'No target has been set, so there is nothing to measure against.' }
  }
  if (start === null) {
    return { ...base, percent: null, direction: null, unavailableReason: 'No starting value has been recorded, so movement cannot be measured.' }
  }
  if (start === target) {
    return {
      ...base,
      percent: null,
      direction: null,
      // Not 100%, and not 0%. Either would be an answer to a question nobody asked.
      unavailableReason: 'The starting value and the target are the same, so there is no distance to cover.',
    }
  }
  if (current === null) {
    return {
      ...base,
      percent: null,
      direction: target > start ? 'up' : 'down',
      unavailableReason: 'No measurement has been recorded yet.',
    }
  }

  const ratio = (current - start) / (target - start)
  return {
    ...base,
    percent: Math.max(0, Math.min(100, Math.round(ratio * 100))),
    direction: target > start ? 'up' : 'down',
    unavailableReason: null,
  }
}

/**
 * The sentence under a progress figure. Built from the value so it cannot describe a
 * different calculation than the one that produced the number (lib/work-next.ts shipped a
 * reason line computed from a different expression than its score; once is enough).
 */
export function explainExecution(p: ExecutionProgress): string {
  if (p.total === 0 && p.unresolved === 0) {
    return `${EXECUTION_DEFINITION} Nothing is linked to this goal yet, so there is no execution figure - which is different from nothing being done.`
  }
  const unresolved = p.unresolved > 0
    ? ` ${p.unresolved} linked item${p.unresolved === 1 ? '' : 's'} could not be shown to you, so ${p.unresolved === 1 ? 'it is' : 'they are'} not in this figure.`
    : ''
  const boards = p.boardCount > 0 ? ` ${p.boardCount} project${p.boardCount === 1 ? ' is' : 's are'} linked as well; whole projects are not counted here, only individual work items.` : ''
  return `${EXECUTION_DEFINITION} ${EXECUTION_FORMULA} Counted over ${p.total} work item${p.total === 1 ? '' : 's'}, ${p.closed} finished.${unresolved}${boards} Excludes: ${EXECUTION_EXCLUDES}`
}

/**
 * A measurement with its unit attached.
 *
 * A single non-letter unit (%, °) sits tight against the number; a word (hours, contracts,
 * leads) takes a space. The unit is free text a person typed, so the rule is about the shape
 * of what they typed rather than a list of units we happen to have thought of.
 */
export function formatMeasure(value: number | null, unit: string | null): string {
  if (value === null) return '-'
  const n = String(value)
  if (!unit) return n
  const tight = unit.length === 1 && !/[a-z]/i.test(unit)
  return tight ? `${n}${unit}` : `${n} ${unit}`
}

export function explainOutcome(p: OutcomeProgress): string {
  if (p.unavailableReason) return `${OUTCOME_DEFINITION} ${p.unavailableReason} Excludes: ${OUTCOME_EXCLUDES}`
  return `${OUTCOME_DEFINITION} ${OUTCOME_FORMULA} From ${formatMeasure(p.start, p.unit)} to ${formatMeasure(p.target, p.unit)}, currently ${formatMeasure(p.current, p.unit)}. Excludes: ${OUTCOME_EXCLUDES}`
}

/**
 * The warning that has to appear whenever both figures are on screen and they disagree.
 *
 * This is the entire point of Prompt H's "never imply they are the same", expressed as
 * something the product actually says out loud rather than a layout convention. Returns null
 * when there is nothing worth saying, so it never becomes noise people learn to skip.
 */
export function progressDivergence(
  execution: ExecutionProgress,
  outcome: OutcomeProgress,
): { tone: 'warning' | 'info'; message: string } | null {
  if (execution.percent === null || outcome.percent === null) return null

  const gap = execution.percent - outcome.percent
  if (gap >= 40) {
    return {
      tone: 'warning',
      message: `${execution.percent}% of the linked work is finished, but the measurement has moved ${outcome.percent}% of the way to its target. Doing the work has not yet produced the result.`,
    }
  }
  if (gap <= -40) {
    return {
      tone: 'info',
      message: `The measurement is ${outcome.percent}% of the way to its target while only ${execution.percent}% of the linked work is finished. Something other than this plan is moving the number - worth understanding before crediting the plan.`,
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------
// Timeframe
// ---------------------------------------------------------------------------------------

export interface GoalWindow {
  label: string
  /** Null when the goal has no dates, which is allowed. */
  daysRemaining: number | null
  isOverdue: boolean
  hasStarted: boolean
}

/**
 * @param today a calendar day in the business zone, resolved ONCE on the server and passed
 *              down. Letting each browser answer "what is today" from its own clock is the
 *              family of bug that has shipped five-plus times in this repo.
 */
export function goalWindow(goal: GoalRow, today: string): GoalWindow {
  const start = goal.starts_on ?? null
  const end = goal.ends_on ?? null

  if (!start && !end) return { label: 'No timeframe', daysRemaining: null, isOverdue: false, hasStarted: true }
  if (start && !end) return { label: `From ${start}`, daysRemaining: null, isOverdue: false, hasStarted: today >= start }
  if (!start && end) {
    const remaining = daysBetween(today, end)
    return { label: `By ${end}`, daysRemaining: remaining, isOverdue: remaining < 0, hasStarted: true }
  }

  const remaining = daysBetween(today, end as string)
  return {
    label: `${start} to ${end}`,
    daysRemaining: remaining,
    isOverdue: remaining < 0,
    hasStarted: today >= (start as string),
  }
}

/** Open goals first, then by position, then newest. Closed goals keep their own order below. */
export function sortGoals(goals: GoalRow[]): GoalRow[] {
  const rank = (g: GoalRow) => ((g.state ?? 'active') === 'active' ? 0 : 1)
  return [...goals].sort((a, b) => {
    const byState = rank(a) - rank(b)
    if (byState !== 0) return byState
    const byPosition = (a.position ?? 0) - (b.position ?? 0)
    if (byPosition !== 0) return byPosition
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
}

export function isGoalOpen(goal: GoalRow): boolean {
  return (goal.state ?? 'active') === 'active'
}

/**
 * Whether this update needs a check-in note.
 *
 * Mirrors migration 129's trigger exactly, and says so, per this repo's rule that a
 * capability naming the policy it mirrors is the only kind that can be checked. A UI stricter
 * than its policy takes an ability away from somebody the database was built to serve; a UI
 * looser than its policy produces a refusal the user cannot explain.
 */
export function requiresCheckin(before: GoalRow, after: Partial<GoalRow>): boolean {
  const changed = (key: 'current_value' | 'confidence' | 'health') => {
    if (!(key in after)) return false
    if (key === 'current_value') return num(after.current_value) !== num(before.current_value)
    return (after[key] ?? null) !== (before[key] ?? null)
  }
  return changed('current_value') || changed('confidence') || changed('health')
}
