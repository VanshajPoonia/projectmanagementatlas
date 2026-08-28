// Sprint metrics - and the explanation that has to travel with every one of them.
//
// Prompt G lists seven metrics and then attaches a condition to all of them:
//
//   "Every chart must expose: definition, formula, unit, included records, excluded records,
//    last updated."
//
// So a metric here is never a bare number. `MetricValue` carries its own definition, formula,
// unit, the ids it counted, what it deliberately left out, and when it was computed - and the
// UI renders that panel from the value rather than from a hand-written caption beside it. A
// caption can drift from the maths it describes; a field on the same object cannot.
//
// THE OTHER HALF OF THE REQUIREMENT
//   "Historical sprint data must not silently change when current project structure changes."
//
// While a sprint runs, its numbers are computed live from current rows and labelled `live`.
// The moment it closes, migration 124's trigger freezes a snapshot, and from then on every
// consumer reads the snapshot - so a later re-estimate, a status re-categorised (112 did
// exactly that to production), an archived board or a deleted column cannot change what a
// finished sprint claims to have delivered. `source` says which you are looking at, and the
// UI shows it, because "this is live and still moving" is itself information.
//
// No React, no Supabase, no `new Date()` on a stored day.

import type { EstimateUnit, SprintLike } from './agile'
import { formatEstimate, sprintDays } from './agile'
import type { StatusCatalog } from './task-status'
import { getTaskStatusCategory, isClosedCategory } from './task-status'

// ---------------------------------------------------------------------------------------
// The explanation model
// ---------------------------------------------------------------------------------------

export type MetricId =
  | 'committed'
  | 'completed'
  | 'carryover'
  | 'scope_added'
  | 'scope_removed'
  | 'burndown'
  | 'burnup'
  | 'velocity'

export interface MetricDefinition {
  id: MetricId
  label: string
  /** What the number means, in a sentence somebody who has never run a sprint can read. */
  definition: string
  /** How it is calculated, precisely enough to be checked by hand. */
  formula: string
  /** What is deliberately NOT in it. Named, because an unstated exclusion is a wrong number. */
  excludes: string
}

export const METRIC_DEFINITIONS: Record<MetricId, MetricDefinition> = {
  committed: {
    id: 'committed',
    label: 'Committed',
    definition: 'The work that was in this window at the moment it started - what the team said it would do.',
    formula: 'Sum of the estimate each item carried when it was added, over items present at activation.',
    excludes: 'Anything added after the window started (that is Scope added), and any item never estimated, which contributes zero to the total while still being counted.',
  },
  completed: {
    id: 'completed',
    label: 'Completed',
    definition: 'Work in this window that finished.',
    formula: 'Items whose status category is "completed", summed on their current estimate.',
    excludes: 'Cancelled work, which is closed but was not delivered, and work removed from the window before it closed.',
  },
  carryover: {
    id: 'carryover',
    label: 'Carryover',
    definition: 'Work still open when the window ended - it carries into the next one.',
    formula: 'Items still in the window whose status category is not closed.',
    excludes: 'Cancelled items (closed, but not carried) and items removed from the window.',
  },
  scope_added: {
    id: 'scope_added',
    label: 'Scope added',
    definition: 'Work that joined after the window had already started.',
    formula: 'Items whose membership was created while the window was running, so they were never part of the commitment.',
    excludes: 'Anything present at activation, and anything added and then removed again before the close.',
  },
  scope_removed: {
    id: 'scope_removed',
    label: 'Scope removed',
    definition: 'Work taken out of the window before it ended.',
    formula: 'Items whose membership was marked removed, summed on the estimate they carried when they joined.',
    excludes: 'Work that stayed but was cancelled - that is a decision about the work, not about the window.',
  },
  burndown: {
    id: 'burndown',
    label: 'Burndown',
    definition: 'How much work is left, day by day, against a straight line from the starting scope to zero.',
    formula: 'One sample per day: the estimate of every item in the window whose status is not closed.',
    excludes: 'Unestimated items, which count as zero on the line and are reported separately so the curve is not read as complete.',
  },
  burnup: {
    id: 'burnup',
    label: 'Burn-up',
    definition: 'Completed work climbing against total scope, so scope growth is visible rather than hidden inside a flat burndown.',
    formula: 'Per day: completed estimate, plotted under the total estimate of everything in the window that day.',
    excludes: 'Removed items, from the day they were removed. Unestimated items count as zero in both series.',
  },
  velocity: {
    id: 'velocity',
    label: 'Velocity',
    definition: 'Average completed work across recent finished windows - the honest input to how much to plan next time.',
    formula: 'Mean of the frozen completed estimate over the last N completed windows.',
    excludes: 'Cancelled windows, windows still running, and any window whose numbers were never frozen. Windows counted in a different unit are never mixed in.',
  },
}

export type MetricSource = 'live' | 'frozen'

export interface MetricValue {
  id: MetricId
  label: string
  count: number
  estimate: number
  unit: EstimateUnit
  definition: string
  formula: string
  excludes: string
  /** Exactly which work items this number counted. Prompt G's "included records". */
  includedTaskIds: string[]
  /** Items in the number that carried no estimate, so contributed zero to it. */
  unestimated: number
  source: MetricSource
  /** ISO instant. For a frozen metric this is when it was captured, and it never moves again. */
  lastUpdated: string
}

function value(
  id: MetricId,
  parts: { count: number; estimate: number; unit: EstimateUnit; includedTaskIds: string[]; unestimated: number; source: MetricSource; lastUpdated: string },
): MetricValue {
  const def = METRIC_DEFINITIONS[id]
  return { id, label: def.label, definition: def.definition, formula: def.formula, excludes: def.excludes, ...parts }
}

/** The human sentence a chart footnote renders. Built from the value, never written beside it. */
export function explainMetric(metric: MetricValue): string {
  const included = `${metric.count} item${metric.count === 1 ? '' : 's'}`
  const unestimated = metric.unestimated > 0
    ? ` ${metric.unestimated} of them carr${metric.unestimated === 1 ? 'ies' : 'y'} no estimate and count as zero.`
    : ''
  const freshness = metric.source === 'frozen'
    ? ' Frozen when the window closed, so it cannot change.'
    : ' Live - it moves as the work does.'
  return `${metric.definition} ${metric.formula} Counted over ${included}, in ${metric.unit}.${unestimated} Excludes: ${metric.excludes}${freshness}`
}

// ---------------------------------------------------------------------------------------
// Live computation
// ---------------------------------------------------------------------------------------

export interface SprintMemberRow {
  task_id: string
  committed: boolean
  estimate_at_commit: number | null
  removed_at: string | null
}

export interface MetricInputTask {
  id: string
  estimate_value?: number | null
  status?: string | null
  column?: { status_key?: string | null } | null
}

export interface SprintMetricSet {
  sprintId: string
  source: MetricSource
  unit: EstimateUnit
  lastUpdated: string
  committed: MetricValue
  completed: MetricValue
  carryover: MetricValue
  scopeAdded: MetricValue
  scopeRemoved: MetricValue
  /** Everything currently in the window - the denominator a burn-up climbs towards. */
  finalCount: number
  finalEstimate: number
  cancelledCount: number
  capacity: number | null
}

const num = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const round = (n: number) => Number(n.toFixed(2))

/**
 * Compute a running sprint's numbers from current rows.
 *
 * ⚠️ Only for a sprint that has NOT closed. A closed sprint must be read from
 * `metricsFromSnapshot`, or the whole guarantee this module is built on is gone - see the file
 * header. `sprintMetrics` picks between them so no caller has to remember.
 */
export function computeLiveMetrics(input: {
  sprint: SprintLike
  members: SprintMemberRow[]
  tasks: MetricInputTask[]
  statuses: StatusCatalog
  unit: EstimateUnit
  now: string
}): SprintMetricSet {
  const { sprint, members, tasks, statuses, unit, now } = input
  const byId = new Map(tasks.map((t) => [t.id, t]))

  const live = members.filter((m) => !m.removed_at)
  const removed = members.filter((m) => Boolean(m.removed_at))

  const categoryOf = (taskId: string) => {
    const task = byId.get(taskId)
    return task ? getTaskStatusCategory(task, statuses) : undefined
  }
  const estimateOf = (taskId: string) => num(byId.get(taskId)?.estimate_value)

  const tally = (rows: SprintMemberRow[], estimator: (row: SprintMemberRow) => number | null) => {
    let estimate = 0
    let unestimated = 0
    const ids: string[] = []
    for (const row of rows) {
      ids.push(row.task_id)
      const e = estimator(row)
      if (e === null) unestimated++
      else estimate += e
    }
    return { count: rows.length, estimate: round(estimate), includedTaskIds: ids, unestimated }
  }

  const base = { unit, source: 'live' as const, lastUpdated: now }

  const committedRows = members.filter((m) => m.committed)
  const completedRows = live.filter((m) => categoryOf(m.task_id) === 'completed')
  const carryoverRows = live.filter((m) => {
    const c = categoryOf(m.task_id)
    return c ? !isClosedCategory(c) : true
  })
  const addedRows = live.filter((m) => !m.committed)
  const cancelledRows = live.filter((m) => categoryOf(m.task_id) === 'cancelled')

  const finalTally = tally(live, (r) => estimateOf(r.task_id))

  return {
    sprintId: sprint.id,
    source: 'live',
    unit,
    lastUpdated: now,
    // ⚠️ Committed is measured on `estimate_at_commit`, NOT on the task's current estimate.
    // Re-sizing a task afterwards must not rewrite what the team signed up to - that is the
    // whole reason migration 123 stores the estimate on the membership row.
    committed: value('committed', { ...tally(committedRows, (r) => num(r.estimate_at_commit)), ...base }),
    completed: value('completed', { ...tally(completedRows, (r) => estimateOf(r.task_id)), ...base }),
    carryover: value('carryover', { ...tally(carryoverRows, (r) => estimateOf(r.task_id)), ...base }),
    scopeAdded: value('scope_added', { ...tally(addedRows, (r) => estimateOf(r.task_id)), ...base }),
    scopeRemoved: value('scope_removed', { ...tally(removed, (r) => num(r.estimate_at_commit)), ...base }),
    finalCount: finalTally.count,
    finalEstimate: finalTally.estimate,
    cancelledCount: cancelledRows.length,
    capacity: num(sprint.capacity),
  }
}

// ---------------------------------------------------------------------------------------
// Frozen snapshot
// ---------------------------------------------------------------------------------------

/** One row of `public.sprint_metrics` (migration 124). */
export interface SprintMetricsRow {
  sprint_id: string
  captured_at: string
  final_state: 'completed' | 'cancelled'
  estimate_unit: string
  terminology: string
  committed_count: number
  committed_estimate: number | string
  completed_count: number
  completed_estimate: number | string
  carryover_count: number
  carryover_estimate: number | string
  cancelled_count: number
  added_count: number
  added_estimate: number | string
  removed_count: number
  removed_estimate: number | string
  final_count: number
  final_estimate: number | string
  included_task_ids: string[] | null
  unestimated_count: number
  capacity: number | string | null
}

export function metricsFromSnapshot(row: SprintMetricsRow): SprintMetricSet {
  const unit = (['points', 'hours', 'days'].includes(row.estimate_unit) ? row.estimate_unit : 'points') as EstimateUnit
  const included = row.included_task_ids ?? []
  const base = { unit, source: 'frozen' as const, lastUpdated: row.captured_at }
  // ⚠️ The snapshot stores totals, not per-metric id lists - the included set is the window's
  // membership at close. Every metric therefore reports the same included list, and says so,
  // rather than inventing a narrower one that the row cannot actually support.
  const ids = included

  return {
    sprintId: row.sprint_id,
    source: 'frozen',
    unit,
    lastUpdated: row.captured_at,
    committed: value('committed', { count: row.committed_count, estimate: Number(row.committed_estimate), includedTaskIds: ids, unestimated: row.unestimated_count, ...base }),
    completed: value('completed', { count: row.completed_count, estimate: Number(row.completed_estimate), includedTaskIds: ids, unestimated: row.unestimated_count, ...base }),
    carryover: value('carryover', { count: row.carryover_count, estimate: Number(row.carryover_estimate), includedTaskIds: ids, unestimated: row.unestimated_count, ...base }),
    scopeAdded: value('scope_added', { count: row.added_count, estimate: Number(row.added_estimate), includedTaskIds: ids, unestimated: row.unestimated_count, ...base }),
    scopeRemoved: value('scope_removed', { count: row.removed_count, estimate: Number(row.removed_estimate), includedTaskIds: [], unestimated: 0, ...base }),
    finalCount: row.final_count,
    finalEstimate: Number(row.final_estimate),
    cancelledCount: row.cancelled_count,
    capacity: num(row.capacity),
  }
}

/**
 * The one entry point a screen should use: frozen when the window has closed, live otherwise.
 *
 * ⚠️ A closed sprint with NO snapshot returns null rather than falling back to a live
 * computation. Silently recomputing it would produce exactly the number this module exists to
 * prevent - a finished sprint whose velocity quietly changes every time somebody re-estimates
 * a task. "We have no record of this window" is the honest answer, and the UI says it.
 */
export function sprintMetrics(input: {
  sprint: SprintLike
  snapshot: SprintMetricsRow | null | undefined
  members: SprintMemberRow[]
  tasks: MetricInputTask[]
  statuses: StatusCatalog
  unit: EstimateUnit
  now: string
}): SprintMetricSet | null {
  const closed = input.sprint.state === 'completed' || input.sprint.state === 'cancelled'
  if (closed) return input.snapshot ? metricsFromSnapshot(input.snapshot) : null
  return computeLiveMetrics(input)
}

// ---------------------------------------------------------------------------------------
// Burndown / burn-up
// ---------------------------------------------------------------------------------------

/** One row of `public.sprint_burndown_samples` (migration 124). */
export interface BurndownSampleRow {
  sprint_id: string
  on_date: string
  remaining_count: number
  remaining_estimate: number | string
  completed_count: number
  completed_estimate: number | string
  scope_count: number
  scope_estimate: number | string
  unestimated_count: number
  captured_at: string
}

export interface BurndownPoint {
  date: string
  /** null where no sample exists - a gap, not a zero. Drawing zero would invent a crash. */
  remaining: number | null
  completed: number | null
  scope: number | null
  unestimated: number
  /** The straight reference line from starting scope to zero across the window. */
  ideal: number
  isFuture: boolean
}

export interface BurndownSeries {
  points: BurndownPoint[]
  unit: EstimateUnit
  startingScope: number
  /** Days in the window that have no sample at all. Reported, because a gappy chart must say so. */
  missingDays: number
  lastUpdated: string | null
  definition: MetricDefinition
}

/**
 * Build the burndown/burn-up series.
 *
 * ⚠️ A day with no sample is `null`, never 0. This repo runs one cron job a day on the Vercel
 * Hobby plan and samples on demand when someone opens the chart, so gaps are expected - and a
 * gap rendered as zero draws a cliff that says the team finished everything overnight. The
 * series reports `missingDays` so the chart can label itself instead of lying quietly.
 */
export function burndownSeries(input: {
  sprint: SprintLike
  samples: BurndownSampleRow[]
  unit: EstimateUnit
  today: string
}): BurndownSeries {
  const { sprint, samples, unit, today } = input
  const days = sprintDays(sprint)
  const byDate = new Map(samples.map((s) => [s.on_date, s]))

  const first = days.length ? byDate.get(days[0]) : undefined
  // Starting scope: the first sample's scope if there is one, else the earliest sample we have.
  const earliest = [...samples].sort((a, b) => a.on_date.localeCompare(b.on_date))[0]
  const startingScope = Number(first?.scope_estimate ?? earliest?.scope_estimate ?? 0)

  const span = Math.max(1, days.length - 1)
  let missingDays = 0

  const points: BurndownPoint[] = days.map((date, index) => {
    const sample = byDate.get(date)
    const isFuture = date > today
    if (!sample && !isFuture) missingDays++
    return {
      date,
      remaining: sample ? Number(sample.remaining_estimate) : null,
      completed: sample ? Number(sample.completed_estimate) : null,
      scope: sample ? Number(sample.scope_estimate) : null,
      unestimated: sample?.unestimated_count ?? 0,
      ideal: round(startingScope * (1 - index / span)),
      isFuture,
    }
  })

  const lastUpdated = samples.length
    ? samples.reduce((a, b) => (a.captured_at > b.captured_at ? a : b)).captured_at
    : null

  return { points, unit, startingScope: round(startingScope), missingDays, lastUpdated, definition: METRIC_DEFINITIONS.burndown }
}

// ---------------------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------------------

export interface VelocityResult {
  average: number
  unit: EstimateUnit
  /** The windows that were counted, newest first. */
  included: { sprintId: string; title: string; completed: number; capturedAt: string }[]
  /** Windows deliberately left out, each with the reason - Prompt G's "excluded records". */
  excluded: { sprintId: string; title: string; reason: string }[]
  lastUpdated: string | null
  definition: MetricDefinition
}

/**
 * Average completed work over recent finished windows.
 *
 * Reads ONLY frozen snapshots - a velocity computed from live rows is a number that changes
 * retroactively, which is exactly what people should not plan against.
 *
 * ⚠️ Windows counted in a different unit are EXCLUDED, not converted. There is no honest
 * conversion from story points to hours, and averaging them produces a number with no unit at
 * all. The exclusion is reported rather than silent.
 */
export function velocity(input: {
  sprints: (SprintLike & { id: string; title: string })[]
  snapshots: SprintMetricsRow[]
  unit: EstimateUnit
  take?: number
}): VelocityResult {
  const { sprints, snapshots, unit } = input
  const take = input.take ?? 5
  const byId = new Map(snapshots.map((s) => [s.sprint_id, s]))

  const included: VelocityResult['included'] = []
  const excluded: VelocityResult['excluded'] = []

  const closedNewestFirst = [...sprints].sort((a, b) => b.end_date.localeCompare(a.end_date))

  for (const sprint of closedNewestFirst) {
    if (sprint.state === 'active' || sprint.state === 'planned') {
      excluded.push({ sprintId: sprint.id, title: sprint.title, reason: 'Still open - it has no final number yet.' })
      continue
    }
    if (sprint.state === 'cancelled') {
      excluded.push({ sprintId: sprint.id, title: sprint.title, reason: 'Cancelled - it was not delivered.' })
      continue
    }
    const snap = byId.get(sprint.id)
    if (!snap) {
      excluded.push({ sprintId: sprint.id, title: sprint.title, reason: 'No frozen record, so its numbers cannot be trusted.' })
      continue
    }
    if (snap.estimate_unit !== unit) {
      excluded.push({ sprintId: sprint.id, title: sprint.title, reason: `Counted in ${snap.estimate_unit}, not ${unit}. Units are never converted.` })
      continue
    }
    if (included.length >= take) {
      excluded.push({ sprintId: sprint.id, title: sprint.title, reason: `Older than the last ${take} counted.` })
      continue
    }
    included.push({ sprintId: sprint.id, title: sprint.title, completed: Number(snap.completed_estimate), capturedAt: snap.captured_at })
  }

  const average = included.length
    ? round(included.reduce((n, s) => n + s.completed, 0) / included.length)
    : 0
  const lastUpdated = included.length
    ? included.reduce((a, b) => (a.capturedAt > b.capturedAt ? a : b)).capturedAt
    : null

  return { average, unit, included, excluded, lastUpdated, definition: METRIC_DEFINITIONS.velocity }
}

/** A one-line summary of a velocity, including what it left out, for a card subtitle. */
export function explainVelocity(result: VelocityResult): string {
  if (!result.included.length) {
    return `No finished ${result.unit === 'points' ? 'window' : 'window'}s with frozen numbers yet, so there is nothing to average.`
  }
  const dropped = result.excluded.length
    ? ` ${result.excluded.length} window${result.excluded.length === 1 ? '' : 's'} excluded.`
    : ''
  return `Mean completed work over the last ${result.included.length} finished window${result.included.length === 1 ? '' : 's'}: ${formatEstimate(result.average, result.unit)}.${dropped}`
}
