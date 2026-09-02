import { describe, it, expect } from 'vitest'
import {
  executionProgress, outcomeProgress, progressDivergence, explainExecution, explainOutcome,
  goalWindow, sortGoals, requiresCheckin, num, isGoalOpen, formatMeasure,
  GOAL_STATE_LABELS, GOAL_HEALTH_IS_MANUAL,
  type GoalRow, type GoalLinkRow, type GoalTaskRow,
} from './goals'

const STATUSES = [
  { key: 'to_do', category: 'planned' as const, is_closed: false },
  { key: 'in_progress', category: 'started' as const, is_closed: false },
  { key: 'done', category: 'completed' as const, is_closed: true },
  { key: 'cancelled', category: 'cancelled' as const, is_closed: true },
]

const task = (id: string, statusKey: string): GoalTaskRow => ({
  id, title: id, status: statusKey, column: { status_key: statusKey, board_id: 'b1' },
})

const goal = (over: Partial<GoalRow> = {}): GoalRow => ({ id: 'g1', title: 'A goal', ...over })

const taskLink = (taskId: string): GoalLinkRow => ({ id: `l-${taskId}`, goal_id: 'g1', task_id: taskId, board_id: null })

describe('execution and outcome are never the same number', () => {
  it('reports both independently for a goal whose work is done and whose metric has not moved', () => {
    const links = [taskLink('t1'), taskLink('t2')]
    const tasks = new Map([['t1', task('t1', 'done')], ['t2', task('t2', 'done')]])

    const execution = executionProgress(links, tasks, STATUSES)
    const outcome = outcomeProgress(goal({ start_value: 10, current_value: 10, target_value: 50 }))

    expect(execution.percent).toBe(100)
    expect(outcome.percent).toBe(0)
  })

  it('warns when finishing the work has not produced the result', () => {
    const execution = executionProgress([taskLink('t1')], new Map([['t1', task('t1', 'done')]]), STATUSES)
    const outcome = outcomeProgress(goal({ start_value: 0, current_value: 0, target_value: 100 }))
    const divergence = progressDivergence(execution, outcome)

    expect(divergence?.tone).toBe('warning')
    expect(divergence?.message).toContain('has not yet produced the result')
  })

  it('flags the reverse too - the number moved without the plan', () => {
    const execution = executionProgress([taskLink('t1'), taskLink('t2')], new Map([['t1', task('t1', 'to_do')], ['t2', task('t2', 'to_do')]]), STATUSES)
    const outcome = outcomeProgress(goal({ start_value: 0, current_value: 90, target_value: 100 }))
    const divergence = progressDivergence(execution, outcome)

    expect(divergence?.tone).toBe('info')
    expect(divergence?.message).toContain('Something other than this plan')
  })

  it('says nothing when the two roughly agree, so the warning never becomes noise', () => {
    const execution = executionProgress([taskLink('t1'), taskLink('t2')], new Map([['t1', task('t1', 'done')], ['t2', task('t2', 'to_do')]]), STATUSES)
    const outcome = outcomeProgress(goal({ start_value: 0, current_value: 60, target_value: 100 }))
    expect(progressDivergence(execution, outcome)).toBeNull()
  })

  it('stays silent when either figure is unavailable rather than inventing a comparison', () => {
    const execution = executionProgress([], new Map(), STATUSES)
    const outcome = outcomeProgress(goal({ start_value: 0, current_value: 50, target_value: 100 }))
    expect(progressDivergence(execution, outcome)).toBeNull()
  })
})

describe('execution progress', () => {
  it('is null when nothing is linked - which is not the same as nothing being done', () => {
    const p = executionProgress([], new Map(), STATUSES)
    expect(p.percent).toBeNull()
    expect(p.total).toBe(0)
    expect(explainExecution(p)).toContain('different from nothing being done')
  })

  it('counts cancelled work as closed, because it is no longer planned work', () => {
    const links = [taskLink('t1'), taskLink('t2')]
    const tasks = new Map([['t1', task('t1', 'done')], ['t2', task('t2', 'cancelled')]])
    expect(executionProgress(links, tasks, STATUSES).percent).toBe(100)
  })

  it('reports links it cannot resolve rather than counting them as unfinished', () => {
    // t2 is on a board this viewer cannot see, so RLS filtered the task and not the link.
    const links = [taskLink('t1'), taskLink('t2')]
    const tasks = new Map([['t1', task('t1', 'done')]])
    const p = executionProgress(links, tasks, STATUSES)

    expect(p.percent).toBe(100)
    expect(p.total).toBe(1)
    expect(p.unresolved).toBe(1)
    expect(explainExecution(p)).toContain('could not be shown to you')
  })

  it('counts linked projects separately and never folds them into the work figure', () => {
    const links: GoalLinkRow[] = [
      { id: 'l1', goal_id: 'g1', board_id: 'b1', task_id: null },
      taskLink('t1'),
    ]
    const p = executionProgress(links, new Map([['t1', task('t1', 'to_do')]]), STATUSES)
    expect(p.total).toBe(1)
    expect(p.boardCount).toBe(1)
    expect(p.percent).toBe(0)
  })

  it('names exactly which work items it counted', () => {
    const p = executionProgress([taskLink('t1'), taskLink('t2')], new Map([['t1', task('t1', 'done')], ['t2', task('t2', 'to_do')]]), STATUSES)
    expect(p.includedTaskIds).toEqual(['t1', 't2'])
  })
})

describe('outcome progress', () => {
  it('measures movement from start to target', () => {
    expect(outcomeProgress(goal({ start_value: 0, current_value: 25, target_value: 100 })).percent).toBe(25)
  })

  it('works when the aim is to REDUCE a number', () => {
    // "Cut callbacks from 12 to 4." A formula assuming bigger is better reports -200% here.
    const p = outcomeProgress(goal({ start_value: 12, current_value: 8, target_value: 4 }))
    expect(p.percent).toBe(50)
    expect(p.direction).toBe('down')
  })

  it('clamps rather than reporting 140%', () => {
    expect(outcomeProgress(goal({ start_value: 0, current_value: 140, target_value: 100 })).percent).toBe(100)
  })

  it('clamps a number that went backwards to zero rather than showing a negative bar', () => {
    expect(outcomeProgress(goal({ start_value: 10, current_value: 5, target_value: 100 })).percent).toBe(0)
  })

  it('is null with a stated reason when there is no target', () => {
    const p = outcomeProgress(goal({ start_value: 0, current_value: 5 }))
    expect(p.percent).toBeNull()
    expect(p.unavailableReason).toContain('No target')
  })

  it('is null when start and target are the same, rather than 0% or 100%', () => {
    const p = outcomeProgress(goal({ start_value: 5, current_value: 5, target_value: 5 }))
    expect(p.percent).toBeNull()
    expect(p.unavailableReason).toContain('no distance to cover')
  })

  it('is null when nothing has been measured yet, and still knows which way is forward', () => {
    const p = outcomeProgress(goal({ start_value: 0, target_value: 100 }))
    expect(p.percent).toBeNull()
    expect(p.direction).toBe('up')
    expect(p.unavailableReason).toContain('No measurement')
  })

  it('reads NUMERIC values that PostgREST hands back as strings', () => {
    const p = outcomeProgress(goal({ start_value: '0.0000', current_value: '30.0000', target_value: '60.0000' }))
    expect(p.percent).toBe(50)
  })

  it('takes the last measurement time from the check-in ledger', () => {
    const p = outcomeProgress(goal({ start_value: 0, current_value: 1, target_value: 2 }), [
      { id: 'c1', goal_id: 'g1', on_date: '2026-09-01', kind: 'opened', created_at: '2026-09-01T10:00:00Z' },
      { id: 'c2', goal_id: 'g1', on_date: '2026-09-05', kind: 'measured', created_at: '2026-09-05T10:00:00Z' },
      { id: 'c3', goal_id: 'other', on_date: '2026-09-09', kind: 'measured', created_at: '2026-09-09T10:00:00Z' },
    ])
    expect(p.lastMeasured).toBe('2026-09-05T10:00:00Z')
  })
})

describe('the explanation is built from the value, never written beside it', () => {
  it('names the unit and the two ends', () => {
    const p = outcomeProgress(goal({ start_value: 2, current_value: 3, target_value: 8, unit: '%' }))
    const text = explainOutcome(p)
    expect(text).toContain('From 2% to 8%')
    expect(text).toContain('currently 3%')
  })

  it('explains why there is no figure instead of printing a formula that produced nothing', () => {
    expect(explainOutcome(outcomeProgress(goal({})))).toContain('No target has been set')
  })

  it('always states that outcome excludes the work', () => {
    expect(explainOutcome(outcomeProgress(goal({ start_value: 0, current_value: 1, target_value: 2 }))))
      .toContain('Finishing every task moves this number by nothing')
  })
})

describe('timeframe', () => {
  // These dates are DATE columns and are compared as calendar strings. The suite runs under
  // four timezones via `pnpm test:timezones`; anything that parsed them into an instant would
  // fail in at least one of them, which is how this repo now catches its oldest bug family.
  it('reports days remaining from the business day it was given', () => {
    const w = goalWindow(goal({ starts_on: '2026-09-01', ends_on: '2026-09-30' }), '2026-09-10')
    expect(w.daysRemaining).toBe(20)
    expect(w.isOverdue).toBe(false)
  })

  it('is overdue the day after it ends, not the same day', () => {
    expect(goalWindow(goal({ ends_on: '2026-09-30' }), '2026-09-30').isOverdue).toBe(false)
    expect(goalWindow(goal({ ends_on: '2026-09-30' }), '2026-10-01').isOverdue).toBe(true)
  })

  it('accepts a goal with no dates at all', () => {
    const w = goalWindow(goal({}), '2026-09-10')
    expect(w.label).toBe('No timeframe')
    expect(w.daysRemaining).toBeNull()
  })

  it('knows a goal has not started yet', () => {
    expect(goalWindow(goal({ starts_on: '2026-10-01', ends_on: '2026-10-31' }), '2026-09-10').hasStarted).toBe(false)
  })
})

describe('housekeeping', () => {
  it('puts open goals first', () => {
    const rows = [goal({ id: 'a', state: 'achieved', position: 0 }), goal({ id: 'b', state: 'active', position: 5 })]
    expect(sortGoals(rows).map((g) => g.id)).toEqual(['b', 'a'])
  })

  it('calls a goal that ended short "Missed", never "Failed"', () => {
    expect(GOAL_STATE_LABELS.missed).toBe('Missed')
  })

  it('says out loud that health is entered rather than calculated', () => {
    expect(GOAL_HEALTH_IS_MANUAL).toContain('never calculated')
  })

  it('treats a goal with no state as active', () => {
    expect(isGoalOpen(goal({}))).toBe(true)
  })

  it('reads a numeric string, an empty string and a null the same way the database does', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num('')).toBeNull()
    expect(num(null)).toBeNull()
    expect(num('not a number')).toBeNull()
  })
})

describe('requiresCheckin mirrors migration 129s trigger', () => {
  const before = goal({ current_value: 10, confidence: 'medium', health: 'on_track' })

  it('is true when the measurement moves', () => {
    expect(requiresCheckin(before, { current_value: 11 })).toBe(true)
  })

  it('is true when confidence or health moves', () => {
    expect(requiresCheckin(before, { confidence: 'low' })).toBe(true)
    expect(requiresCheckin(before, { health: 'at_risk' })).toBe(true)
  })

  it('is false for a rename, which the trigger would refuse a note on', () => {
    expect(requiresCheckin(before, { title: 'Renamed' } as Partial<GoalRow>)).toBe(false)
  })

  it('is false when the same value is sent again - a no-op is not a measurement', () => {
    expect(requiresCheckin(before, { current_value: 10 })).toBe(false)
    // And the string form the database returns must compare equal to the number sent back.
    expect(requiresCheckin(goal({ current_value: '10.0000' }), { current_value: 10 })).toBe(false)
  })
})

describe('formatMeasure keeps a symbol tight and a word spaced', () => {
  it('writes 12% and 12 hours', () => {
    expect(formatMeasure(12, '%')).toBe('12%')
    expect(formatMeasure(12, 'hours')).toBe('12 hours')
  })

  it('renders a missing measurement as a dash rather than a zero', () => {
    expect(formatMeasure(null, '%')).toBe('-')
  })
})
