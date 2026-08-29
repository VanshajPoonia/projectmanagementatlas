import { describe, it, expect } from 'vitest'
import {
  sprintNoun, sprintNounTitle, sprintNounPluralTitle, formatEstimate,
  normalizeAgileSettings, defaultAgileSettings, agileActive,
  sprintPhase, sprintWindow, sprintDays, defaultSprint, startBlockedReason,
  capacityStatus, wipStatus, wipBlockReason,
  orderBacklog, moveInBacklog, groupIntoSwimlanes, sumEstimates,
  canPlanIntoSprint, planBlockedReason, isOpenTask, isCompletedTask,
  resolveAgileBoardId, agileBoardStorageKey, planReorder, availableReorderActions,
  type SprintLike,
} from './agile'

const STATUSES = [
  { key: 'to_do', category: 'planned' as const, is_closed: false },
  { key: 'in_progress', category: 'started' as const, is_closed: false },
  { key: 'done', category: 'completed' as const, is_closed: true },
  { key: 'cancelled', category: 'cancelled' as const, is_closed: true },
]

const sprint = (over: Partial<SprintLike> = {}): SprintLike => ({
  id: over.id ?? 's1',
  title: over.title ?? 'Window 1',
  start_date: over.start_date ?? '2026-09-01',
  end_date: over.end_date ?? '2026-09-14',
  state: over.state ?? 'planned',
  capacity: over.capacity ?? null,
})

describe('vocabulary is the board\'s, never hardcoded Scrum', () => {
  it('renders each configured noun', () => {
    expect(sprintNoun('sprint')).toBe('sprint')
    expect(sprintNoun('cycle')).toBe('cycle')
    expect(sprintNoun('iteration')).toBe('iteration')
    expect(sprintNounTitle('cycle')).toBe('Cycle')
    expect(sprintNounPluralTitle('iteration')).toBe('Iterations')
  })

  it('falls back to "sprint" for a value the database could not hold', () => {
    expect(sprintNoun('scrum' as any)).toBe('sprint')
  })

  it('never says "point" when the board counts hours', () => {
    expect(formatEstimate(8, 'hours')).toBe('8 hours')
    expect(formatEstimate(1, 'hours')).toBe('1 hour')
    expect(formatEstimate(1, 'days')).toBe('1 day')
    expect(formatEstimate(3, 'points')).toBe('3 points')
  })

  it('distinguishes "no estimate" from zero, because they mean different things', () => {
    expect(formatEstimate(null, 'points')).toBe('No estimate')
    expect(formatEstimate(undefined, 'points')).toBe('No estimate')
    expect(formatEstimate(0, 'points')).toBe('0 points')
  })

  it('drops a trailing .00 - these are estimates, not measurements', () => {
    expect(formatEstimate(8.0, 'points')).toBe('8 points')
    expect(formatEstimate(2.5, 'points')).toBe('2.5 points')
  })
})

describe('settings default to off, at every level', () => {
  it('a board with no row has agile off and says "sprint"', () => {
    const s = defaultAgileSettings('b1')
    expect(s.is_enabled).toBe(false)
    expect(s.terminology).toBe('sprint')
    expect(s.capacity_mode).toBe('warning')
    expect(s.wip_mode).toBe('warning')
  })

  it('needs BOTH the module and the board opt-in', () => {
    const on = { ...defaultAgileSettings('b1'), is_enabled: true }
    expect(agileActive(false, on)).toBe(false)
    expect(agileActive(true, defaultAgileSettings('b1'))).toBe(false)
    expect(agileActive(true, on)).toBe(true)
    expect(agileActive(true, null)).toBe(false)
  })

  it('coerces a junk row rather than rendering a value no screen can handle', () => {
    const s = normalizeAgileSettings('b1', { terminology: 'kanban', estimate_unit: 'bananas', wip_mode: 'block' })
    expect(s.terminology).toBe('sprint')
    expect(s.estimate_unit).toBe('points')
    expect(s.wip_mode).toBe('warning')
  })
})

describe('the window is compared as calendar days, in every timezone', () => {
  it('places today before, inside and after', () => {
    expect(sprintPhase(sprint(), '2026-08-31')).toBe('upcoming')
    expect(sprintPhase(sprint(), '2026-09-01')).toBe('running')
    expect(sprintPhase(sprint(), '2026-09-14')).toBe('running')
    expect(sprintPhase(sprint(), '2026-09-15')).toBe('ended')
  })

  it('counts both ends - a one-day window is one day, not zero', () => {
    const w = sprintWindow(sprint({ start_date: '2026-09-01', end_date: '2026-09-01' }), '2026-09-01')
    expect(w.totalDays).toBe(1)
    expect(w.elapsedDays).toBe(1)
    expect(w.remainingDays).toBe(0)
  })

  it('clamps elapsed to the window rather than reporting day 40 of 14', () => {
    expect(sprintWindow(sprint(), '2026-10-30').elapsedDays).toBe(14)
    expect(sprintWindow(sprint(), '2026-08-01').elapsedDays).toBe(0)
  })

  it('crosses a DST transition without gaining or losing a day', () => {
    // 2026-11-01 is the US fall-back. Built with Date.UTC throughout, so no zone can shorten it.
    const w = sprintWindow(sprint({ start_date: '2026-10-26', end_date: '2026-11-08' }), '2026-11-08')
    expect(w.totalDays).toBe(14)
    expect(sprintDays(sprint({ start_date: '2026-10-26', end_date: '2026-11-08' }))).toHaveLength(14)
  })

  it('the day list starts on the start date and ends on the end date', () => {
    const days = sprintDays(sprint())
    expect(days[0]).toBe('2026-09-01')
    expect(days[days.length - 1]).toBe('2026-09-14')
  })

  it('bounds a mis-entered decade-long window rather than building 4000 nodes', () => {
    expect(sprintDays(sprint({ start_date: '2020-01-01', end_date: '2030-01-01' }))).toHaveLength(400)
  })
})

describe('which window a screen opens on', () => {
  it('prefers the running one', () => {
    const all = [sprint({ id: 'a', state: 'completed', end_date: '2026-08-01' }), sprint({ id: 'b', state: 'active' })]
    expect(defaultSprint(all, '2026-09-05')?.id).toBe('b')
  })

  it('falls back to the NEXT upcoming, not the alphabetically first', () => {
    const all = [
      sprint({ id: 'later', title: 'Alpha', start_date: '2026-10-01', end_date: '2026-10-14' }),
      sprint({ id: 'sooner', title: 'Zulu', start_date: '2026-09-20', end_date: '2026-09-30' }),
    ]
    expect(defaultSprint(all, '2026-09-05')?.id).toBe('sooner')
  })

  it('falls back to the most recently ENDED, not the oldest', () => {
    const all = [
      sprint({ id: 'old', state: 'completed', start_date: '2026-01-01', end_date: '2026-01-14' }),
      sprint({ id: 'recent', state: 'completed', start_date: '2026-08-01', end_date: '2026-08-14' }),
    ]
    expect(defaultSprint(all, '2026-09-05')?.id).toBe('recent')
  })

  it('returns null when there is nothing', () => {
    expect(defaultSprint([], '2026-09-05')).toBeNull()
  })
})

describe('starting a window explains itself when it cannot', () => {
  it('refuses a second running window and names the first', () => {
    const a = sprint({ id: 'a', title: 'Running one', state: 'active' })
    const b = sprint({ id: 'b', state: 'planned' })
    expect(startBlockedReason(b, [a, b])).toContain('Running one')
  })

  it('refuses to reopen a closed window', () => {
    const done = sprint({ state: 'completed' })
    expect(startBlockedReason(done, [done])).toContain('cannot be reopened')
  })

  it('allows the ordinary case', () => {
    const s = sprint()
    expect(startBlockedReason(s, [s])).toBeNull()
  })
})

describe('capacity warns and only blocks when configured', () => {
  const base = { unit: 'points' as const, unestimated: 0 }

  it('says nothing useful when no capacity is declared', () => {
    const s = capacityStatus({ ...base, planned: 40, capacity: null, mode: 'warning' })
    expect(s.state).toBe('undeclared')
    expect(s.blocks).toBe(false)
  })

  it('warns over capacity but does NOT block by default', () => {
    const s = capacityStatus({ ...base, planned: 26, capacity: 20, mode: 'warning' })
    expect(s.state).toBe('over')
    expect(s.over).toBe(6)
    expect(s.blocks).toBe(false)
    expect(s.message).toContain('6 points over capacity')
  })

  it('blocks only in enforcement mode - Prompt G\'s "unless configured"', () => {
    expect(capacityStatus({ ...base, planned: 26, capacity: 20, mode: 'enforcement' }).blocks).toBe(true)
    expect(capacityStatus({ ...base, planned: 10, capacity: 20, mode: 'enforcement' }).blocks).toBe(false)
  })

  it('never hides unestimated work behind an under-capacity message', () => {
    const s = capacityStatus({ ...base, planned: 12, capacity: 20, unestimated: 6, mode: 'warning' })
    expect(s.state).toBe('under')
    expect(s.unestimated).toBe(6)
    expect(s.message).toContain('6 items carry no estimate')
  })

  it('treats zero capacity as undeclared, or every window is over from its first item', () => {
    expect(capacityStatus({ ...base, planned: 1, capacity: 0, mode: 'warning' }).state).toBe('undeclared')
  })
})

describe('WIP never claims a refusal the database will not make', () => {
  it('is silent with no limit', () => {
    expect(wipStatus({ count: 99, limit: null, mode: 'enforcement', enforcementAvailable: true }).state).toBe('none')
  })

  it('warns at the limit without blocking in warning mode', () => {
    const s = wipStatus({ count: 3, limit: 3, mode: 'warning', enforcementAvailable: true })
    expect(s.state).toBe('at')
    expect(s.blocks).toBe(false)
  })

  it('blocks at the limit in enforcement mode', () => {
    expect(wipStatus({ count: 3, limit: 3, mode: 'enforcement', enforcementAvailable: true }).blocks).toBe(true)
  })

  it('does NOT block when the enforcing migration is not applied - a warning that turns out untrue is worse than none', () => {
    const s = wipStatus({ count: 5, limit: 3, mode: 'enforcement', enforcementAvailable: false })
    expect(s.state).toBe('over')
    expect(s.blocks).toBe(false)
  })

  it('names the column and the limit in the refusal', () => {
    const reason = wipBlockReason('In Progress', wipStatus({ count: 3, limit: 3, mode: 'enforcement', enforcementAvailable: true }))
    expect(reason).toContain('In Progress')
    expect(reason).toContain('3')
  })

  it('gives no reason when nothing is blocked', () => {
    expect(wipBlockReason('To Do', wipStatus({ count: 1, limit: 3, mode: 'enforcement', enforcementAvailable: true }))).toBeNull()
  })
})

describe('the backlog is the board\'s own order, not a second ranking', () => {
  it('sorts by position', () => {
    const ids = orderBacklog([
      { id: 'c', title: 'C', position: 2 },
      { id: 'a', title: 'A', position: 0 },
      { id: 'b', title: 'B', position: 1 },
    ]).map((t) => t.id)
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('puts a task with no position last rather than first', () => {
    const ids = orderBacklog([
      { id: 'none', title: 'N', position: null },
      { id: 'first', title: 'F', position: 0 },
    ]).map((t) => t.id)
    expect(ids).toEqual(['first', 'none'])
  })

  it('moves an item and leaves the rest in order', () => {
    expect(moveInBacklog(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveInBacklog(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op for an out-of-range or unchanged move', () => {
    expect(moveInBacklog(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(moveInBacklog(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })

  it('clamps a drop past the end instead of dropping the item', () => {
    expect(moveInBacklog(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a'])
  })
})

describe('swimlanes reuse parent_task_id - there is no second hierarchy', () => {
  const tasks = [
    { id: 'epic', title: 'Checkout rebuild', position: 0, parent_task_id: null },
    { id: 't1', title: 'Card form', position: 1, parent_task_id: 'epic' },
    { id: 't2', title: 'Receipt email', position: 2, parent_task_id: 'epic' },
    { id: 'loose', title: 'Fix typo', position: 3, parent_task_id: null },
  ]

  it('groups children under their parent and keeps loose work in its own lane', () => {
    const lanes = groupIntoSwimlanes(tasks)
    expect(lanes).toHaveLength(2)
    expect(lanes[0].title).toBe('Checkout rebuild')
    expect(lanes[0].items.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(lanes[1].id).toBeNull()
    expect(lanes[1].items.map((t) => t.id)).toEqual(['loose'])
  })

  it('does not repeat a lane-heading parent inside the ungrouped lane', () => {
    const lanes = groupIntoSwimlanes(tasks)
    expect(lanes[1].items.some((t) => t.id === 'epic')).toBe(false)
  })

  it('puts an orphan in the ungrouped lane rather than a lane titled with an unresolvable id', () => {
    // The parent is missing because RLS or a filter removed it - NOT because it does not exist.
    const lanes = groupIntoSwimlanes([{ id: 'x', title: 'Orphan', position: 0, parent_task_id: 'gone' }])
    expect(lanes).toHaveLength(1)
    expect(lanes[0].id).toBeNull()
    expect(lanes[0].items.map((t) => t.id)).toEqual(['x'])
  })

  it('omits the ungrouped lane entirely when everything has a parent', () => {
    const lanes = groupIntoSwimlanes([
      { id: 'p', title: 'Parent', position: 0, parent_task_id: null },
      { id: 'c', title: 'Child', position: 1, parent_task_id: 'p' },
    ])
    expect(lanes).toHaveLength(1)
    expect(lanes[0].id).toBe('p')
  })
})

describe('summing estimates reports what it could not count', () => {
  it('returns the total and the unestimated count together', () => {
    const { total, unestimated } = sumEstimates([
      { estimate_value: 3 }, { estimate_value: null }, { estimate_value: 5 }, { estimate_value: undefined },
    ])
    expect(total).toBe(8)
    expect(unestimated).toBe(2)
  })

  it('counts a zero estimate as estimated - zero is a size, absence is not', () => {
    const { total, unestimated } = sumEstimates([{ estimate_value: 0 }])
    expect(total).toBe(0)
    expect(unestimated).toBe(0)
  })
})

describe('open / completed read 112\'s category, never a column title', () => {
  const task = (statusKey: string) => ({ id: 't', column: { status_key: statusKey } })

  it('classifies through the catalog', () => {
    expect(isOpenTask(task('in_progress'), STATUSES)).toBe(true)
    expect(isOpenTask(task('done'), STATUSES)).toBe(false)
    expect(isCompletedTask(task('done'), STATUSES)).toBe(true)
  })

  it('does NOT count cancelled work as completed, though both are closed', () => {
    expect(isCompletedTask(task('cancelled'), STATUSES)).toBe(false)
    expect(isOpenTask(task('cancelled'), STATUSES)).toBe(false)
  })
})

describe('only agile-eligible types are planned into a window', () => {
  const types = [
    { key: 'task', name: 'Task', is_agile_eligible: true },
    { key: 'subtask', name: 'Subtask', is_agile_eligible: false },
  ]

  it('refuses a subtask, which its parent already carries', () => {
    expect(canPlanIntoSprint('subtask', types)).toBe(false)
    expect(planBlockedReason('subtask', types, 'cycle')).toContain('cycle')
  })

  it('allows a task and gives no reason', () => {
    expect(canPlanIntoSprint('task', types)).toBe(true)
    expect(planBlockedReason('task', types, 'sprint')).toBeNull()
  })

  it('permits rather than refuses when the catalog has not loaded - the trigger is the boundary', () => {
    expect(canPlanIntoSprint('task', null)).toBe(true)
    expect(canPlanIntoSprint('anything', [])).toBe(true)
  })
})

describe('which board the agile screen opens on', () => {
  const boards = [
    { id: 'a', title: 'Alpha', agileEnabled: false },
    { id: 'z', title: 'Zulu', agileEnabled: true },
  ]

  it('honours an explicit link above everything', () => {
    expect(resolveAgileBoardId({ requested: 'a', remembered: 'z', boards })).toBe('a')
  })

  it('then what this user last chose', () => {
    expect(resolveAgileBoardId({ remembered: 'a', boards })).toBe('a')
  })

  it('then a board that actually runs sprints - NOT the alphabetically first', () => {
    expect(resolveAgileBoardId({ boards })).toBe('z')
  })

  it('ignores a remembered or requested board that is no longer visible', () => {
    expect(resolveAgileBoardId({ requested: 'gone', remembered: 'also-gone', boards })).toBe('z')
  })

  it('falls back to the first board when none has agile on', () => {
    const off = boards.map((b) => ({ ...b, agileEnabled: false }))
    expect(resolveAgileBoardId({ boards: off })).toBe('a')
  })

  it('returns null when there are no boards at all', () => {
    expect(resolveAgileBoardId({ boards: [] })).toBeNull()
  })
})

describe('backlog order is the board\'s own, read as (column, position)', () => {
  const t = (id: string, colPos: number, pos: number, colId = `c${colPos}`) =>
    ({ id, title: id.toUpperCase(), position: pos, column: { id: colId, position: colPos } })

  it('orders by the COLUMN first, then position within it', () => {
    const ids = orderBacklog([t('c', 1, 0), t('a', 0, 0), t('b', 0, 1)]).map((x) => x.id)
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('does not let two columns\' position-0 rows fall through to an alphabetical tie-break', () => {
    // The bug this replaced: tasks.position is an index WITHIN a column, so these two both
    // hold 0 and the old comparator resolved them by title - "zeta" before "alpha" purely
    // because of which column each sat in was invisible to it.
    const ids = orderBacklog([
      { id: 'alpha', title: 'alpha', position: 0, column: { id: 'later', position: 5 } },
      { id: 'zeta', title: 'zeta', position: 0, column: { id: 'first', position: 0 } },
    ]).map((x) => x.id)
    expect(ids).toEqual(['zeta', 'alpha'])
  })

  it('still puts a task with no position last within its column', () => {
    const ids = orderBacklog([
      { id: 'none', title: 'N', position: null, column: { id: 'c', position: 0 } },
      { id: 'first', title: 'F', position: 0, column: { id: 'c', position: 0 } },
    ]).map((x) => x.id)
    expect(ids).toEqual(['first', 'none'])
  })
})

describe('reordering is planned, and refuses when it cannot be honest', () => {
  const col = { id: 'todo', position: 0 }
  const rows = [
    { id: 'a', title: 'A', position: 0, column: col },
    { id: 'b', title: 'B', position: 1, column: col },
    { id: 'c', title: 'C', position: 2, column: col },
  ]

  it('moves an item up and renumbers the whole column densely', () => {
    const plan = planReorder(rows, 'c', 'up')
    expect(plan.blockedReason).toBeNull()
    expect(plan.updates).toEqual([
      { id: 'a', position: 0 }, { id: 'c', position: 1 }, { id: 'b', position: 2 },
    ])
  })

  it('moves to top and to bottom', () => {
    expect(planReorder(rows, 'c', 'top').updates.map((u) => u.id)).toEqual(['c', 'a', 'b'])
    expect(planReorder(rows, 'a', 'bottom').updates.map((u) => u.id)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op at the ends rather than an error', () => {
    expect(planReorder(rows, 'a', 'up').updates).toEqual([])
    expect(planReorder(rows, 'a', 'up').blockedReason).toBeNull()
    expect(planReorder(rows, 'c', 'down').updates).toEqual([])
  })

  it('REFUSES while the list is filtered - index 3 of a filtered list is not index 3 of the order', () => {
    const plan = planReorder(rows, 'c', 'top', { listIsComplete: false })
    expect(plan.updates).toEqual([])
    expect(plan.blockedReason).toMatch(/filters/i)
  })

  it('only ever renumbers ONE column, never work in another', () => {
    const mixed = [...rows, { id: 'x', title: 'X', position: 0, column: { id: 'doing', position: 1 } }]
    const plan = planReorder(mixed, 'c', 'top')
    expect(plan.updates.map((u) => u.id)).toEqual(['c', 'a', 'b'])
    expect(plan.updates.some((u) => u.id === 'x')).toBe(false)
  })

  it('refuses an item with no column - it has no position to change', () => {
    const plan = planReorder([{ id: 'loose', title: 'L', position: 0, column: null }], 'loose', 'top')
    expect(plan.blockedReason).toMatch(/no board column|not on a board/i)
  })

  it('offers only the actions that would actually do something', () => {
    expect(availableReorderActions(rows, 'a')).toEqual(['down', 'bottom'])
    expect(availableReorderActions(rows, 'c')).toEqual(['top', 'up'])
    expect(availableReorderActions(rows, 'b')).toEqual(['top', 'up', 'down', 'bottom'])
  })

  it('offers nothing at all while the list is incomplete', () => {
    expect(availableReorderActions(rows, 'b', { listIsComplete: false })).toEqual([])
  })

  it('offers nothing for a column holding a single item', () => {
    expect(availableReorderActions([rows[0]], 'a')).toEqual([])
  })
})
