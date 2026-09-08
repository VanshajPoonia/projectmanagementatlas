import { describe, it, expect } from 'vitest'
import {
  DUE_SOON_DAYS,
  MILESTONE_STATES,
  MILESTONE_STATES_NEEDING_REASON,
  explainProgress,
  isMilestoneOpen,
  milestonePressureList,
  milestoneProgress,
  milestoneState,
  milestoneStatus,
  needsAttention,
  noteAfterTransition,
  sortMilestones,
  stateChangeRejection,
  suggestsReached,
  type MilestoneRow,
} from './milestones'
import type { GoalTaskRow } from './goals'
import type { CategorizedStatus } from './task-status'

const STATUSES: CategorizedStatus[] = [
  { key: 'to_do', label: 'To Do', category: 'planned', is_closed: false } as CategorizedStatus,
  { key: 'in_progress', label: 'In Progress', category: 'started', is_closed: false } as CategorizedStatus,
  { key: 'done', label: 'Done', category: 'completed', is_closed: true } as CategorizedStatus,
  { key: 'cancelled', label: 'Cancelled', category: 'cancelled', is_closed: true } as CategorizedStatus,
]

const milestone = (over: Partial<MilestoneRow> = {}): MilestoneRow => ({
  id: 'm1',
  board_id: 'b1',
  title: 'Permit issued',
  due_date: '2026-03-20',
  state: 'open',
  ...over,
})

const task = (id: string, statusKey: string): GoalTaskRow => ({
  id,
  title: id,
  status: statusKey,
  column: { status_key: statusKey, board_id: 'b1' },
})

describe('state is a decision', () => {
  it('treats a missing or unknown state as open rather than guessing', () => {
    expect(milestoneState({ state: null })).toBe('open')
    expect(milestoneState({ state: 'nonsense' as never })).toBe('open')
    expect(isMilestoneOpen({ state: undefined })).toBe(true)
  })

  it('only missed and cancelled need a reason', () => {
    expect(MILESTONE_STATES_NEEDING_REASON).toEqual(['missed', 'cancelled'])
    expect(MILESTONE_STATES).toHaveLength(4)
  })
})

describe('milestoneStatus: being late is derived, never stored', () => {
  it('reports an open milestone whose date has passed as overdue, with a day count', () => {
    const status = milestoneStatus(milestone({ due_date: '2026-03-10' }), '2026-03-15')
    expect(status.pressure).toBe('overdue')
    expect(status.daysRemaining).toBe(-5)
    expect(status.label).toBe('5 days overdue')
  })

  it('singularises one day overdue', () => {
    expect(milestoneStatus(milestone({ due_date: '2026-03-14' }), '2026-03-15').label)
      .toBe('1 day overdue')
  })

  it('distinguishes due today from due soon', () => {
    expect(milestoneStatus(milestone({ due_date: '2026-03-15' }), '2026-03-15').pressure).toBe('due_today')
    expect(milestoneStatus(milestone({ due_date: '2026-03-16' }), '2026-03-15').label).toBe('Due tomorrow')
    expect(milestoneStatus(milestone({ due_date: '2026-03-20' }), '2026-03-15').pressure).toBe('due_soon')
  })

  it('puts the due-soon boundary exactly where the constant says', () => {
    const edge = milestoneStatus(milestone({ due_date: '2026-03-22' }), '2026-03-15')
    const past = milestoneStatus(milestone({ due_date: '2026-03-23' }), '2026-03-15')
    expect(DUE_SOON_DAYS).toBe(7)
    expect(edge.pressure).toBe('due_soon')
    expect(past.pressure).toBe('upcoming')
  })

  it('never calls a CLOSED milestone overdue, however long ago its date was', () => {
    for (const state of ['reached', 'missed', 'cancelled'] as const) {
      const status = milestoneStatus(milestone({ state, due_date: '2020-01-01' }), '2026-03-15')
      expect(status.pressure).toBe(state)
      expect(status.daysRemaining).toBeNull()
      expect(needsAttention(status)).toBe(false)
    }
  })

  it('counts days across a month and a year boundary correctly', () => {
    expect(milestoneStatus(milestone({ due_date: '2027-01-01' }), '2026-12-30').daysRemaining).toBe(2)
    expect(milestoneStatus(milestone({ due_date: '2026-03-01' }), '2026-02-25').daysRemaining).toBe(4)
  })

  it('never marks an open milestone missed on its own', () => {
    // The whole point of separating the decision from the fact: a late milestone is still OPEN.
    const status = milestoneStatus(milestone({ due_date: '2020-01-01' }), '2026-03-15')
    expect(status.state).toBe('open')
    expect(status.pressure).toBe('overdue')
  })
})

describe('progress: null is not zero', () => {
  it('reports nothing linked as null, not 0%', () => {
    const progress = milestoneProgress([], new Map(), STATUSES)
    expect(progress.percent).toBeNull()
    expect(progress.total).toBe(0)
    expect(explainProgress(progress)).toBe('Nothing linked yet, so there is no progress to report.')
  })

  it('counts closed linked work', () => {
    const tasks = new Map([
      ['t1', task('t1', 'done')],
      ['t2', task('t2', 'to_do')],
      ['t3', task('t3', 'cancelled')],
      ['t4', task('t4', 'in_progress')],
    ])
    const progress = milestoneProgress(
      ['t1', 't2', 't3', 't4'].map((task_id) => ({ milestone_id: 'm1', task_id })),
      tasks,
      STATUSES,
    )
    // Cancelled is closed as well as completed: both are endings.
    expect(progress.closed).toBe(2)
    expect(progress.total).toBe(4)
    expect(progress.percent).toBe(50)
  })

  it('reports work on a board the viewer cannot see as unresolved, never as open', () => {
    const progress = milestoneProgress(
      [{ milestone_id: 'm1', task_id: 'visible' }, { milestone_id: 'm1', task_id: 'hidden' }],
      new Map([['visible', task('visible', 'done')]]),
      STATUSES,
    )
    expect(progress.total).toBe(1)
    expect(progress.percent).toBe(100)
    expect(progress.unresolved).toBe(1)
    expect(explainProgress(progress)).toContain('cannot see')
  })

  it('says so when EVERY linked item is hidden, rather than reading as unplanned', () => {
    const progress = milestoneProgress(
      [{ milestone_id: 'm1', task_id: 'hidden' }],
      new Map(),
      STATUSES,
    )
    expect(progress.percent).toBeNull()
    expect(explainProgress(progress)).toContain('do not have access')
  })
})

describe('suggestsReached only suggests', () => {
  const full = milestoneProgress(
    [{ milestone_id: 'm1', task_id: 't1' }],
    new Map([['t1', task('t1', 'done')]]),
    STATUSES,
  )

  it('suggests when every linked item is closed', () => {
    expect(suggestsReached(milestone(), full)).toBe(true)
  })

  it('does not suggest for a milestone that is already closed', () => {
    expect(suggestsReached(milestone({ state: 'reached' }), full)).toBe(false)
    expect(suggestsReached(milestone({ state: 'cancelled' }), full)).toBe(false)
  })

  it('does not suggest when nothing is linked, which would read as done', () => {
    expect(suggestsReached(milestone(), milestoneProgress([], new Map(), STATUSES))).toBe(false)
  })

  it('is only ever a suggestion: the row it is given keeps its own state', () => {
    const row = milestone()
    suggestsReached(row, full)
    expect(row.state).toBe('open')
  })
})

describe('the note follows the transition', () => {
  it('keeps a reason for the states that need one', () => {
    expect(noteAfterTransition('missed', '  permit expired  ')).toBe('permit expired')
    expect(noteAfterTransition('cancelled', 'scope pulled')).toBe('scope pulled')
  })

  it('drops any reason on reached and open, matching the trigger blanking it', () => {
    expect(noteAfterTransition('reached', 'ignore me')).toBeNull()
    expect(noteAfterTransition('open', 'ignore me')).toBeNull()
  })

  it('treats whitespace as no reason at all', () => {
    expect(noteAfterTransition('missed', '   \t ')).toBeNull()
  })
})

describe('sorting puts what needs acting on first', () => {
  it('orders open before closed, then by date, then by title', () => {
    const sorted = sortMilestones([
      milestone({ id: 'reached', state: 'reached', due_date: '2026-01-01' }),
      milestone({ id: 'later', due_date: '2026-06-01' }),
      milestone({ id: 'late', due_date: '2026-01-05' }),
      milestone({ id: 'cancelled', state: 'cancelled', due_date: '2026-01-01' }),
      milestone({ id: 'missed', state: 'missed', due_date: '2026-01-01' }),
    ])
    expect(sorted.map((m) => m.id)).toEqual(['late', 'later', 'missed', 'reached', 'cancelled'])
  })

  it('does not mutate the array it was given', () => {
    const input = [milestone({ id: 'b', due_date: '2026-06-01' }), milestone({ id: 'a', due_date: '2026-01-01' })]
    sortMilestones(input)
    expect(input.map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('breaks a same-date tie by title so the order is stable between renders', () => {
    const sorted = sortMilestones([
      milestone({ id: '1', title: 'Zebra', due_date: '2026-03-01' }),
      milestone({ id: '2', title: 'Apple', due_date: '2026-03-01' }),
    ])
    expect(sorted.map((m) => m.title)).toEqual(['Apple', 'Zebra'])
  })
})

describe('milestonePressureList feeds My Work', () => {
  it('returns only open milestones that are late or near, soonest first', () => {
    const list = milestonePressureList([
      milestone({ id: 'far', due_date: '2026-12-01' }),
      milestone({ id: 'late', due_date: '2026-03-01' }),
      milestone({ id: 'soon', due_date: '2026-03-18' }),
      milestone({ id: 'done', state: 'reached', due_date: '2026-01-01' }),
    ], '2026-03-15')
    expect(list.map((e) => e.milestone.id)).toEqual(['late', 'soon'])
  })

  it('is empty rather than throwing when there are no milestones at all', () => {
    expect(milestonePressureList([], '2026-03-15')).toEqual([])
  })
})
