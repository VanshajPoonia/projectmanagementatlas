import { describe, it, expect } from 'vitest'
import {
  buildBoardConfig, boardActiveFilterCount, boardSortToRules, dateRangeConditions,
  type BoardFilterState,
} from './board-filters'
import { UNASSIGNED, applyFilters, applySort, type EvalContext } from './view-config'

const STATUSES = [
  { key: 'to_do', label: 'To Do', category: 'planned' as const, is_closed: false },
  { key: 'done', label: 'Done', category: 'completed' as const, is_closed: true },
  { key: 'cancelled', label: 'Cancelled', category: 'cancelled' as const, is_closed: true },
]

const USERS = [
  { id: 'u-ann', full_name: 'Ann Adams' },
  { id: 'u-bob', full_name: 'Bob Brown' },
]

// A Tuesday, mid-afternoon UTC - which is still the same calendar day in America/Chicago.
const NOW = new Date('2026-08-25T15:00:00Z')
// Late evening UTC, which is the PREVIOUS calendar day in America/Chicago. The old code
// compared a UTC-parsed due date against a LOCAL midnight, so this is the window where it
// disagreed with itself.
const LATE = new Date('2026-08-26T02:00:00Z')

const ctx: EvalContext = {
  currentUserId: 'u-ann', statuses: STATUSES, users: USERS, boards: [], now: NOW,
}

const state = (over: Partial<BoardFilterState> = {}): BoardFilterState => ({
  user: 'all', priority: 'all', range: 'all', search: '', sort: [], ...over,
})

const task = (over: Record<string, any> = {}) => ({
  id: 't', title: 'Prepare bid', description: 'Riverside', board_id: 'b-1', priority: 3,
  task_assignees: [{ user_id: 'u-ann' }], task_tags: [],
  column: { status_key: 'to_do' }, due_date: '2026-08-25', parent_task_id: null, ...over,
})

describe('sort headers', () => {
  it('maps the board\'s own column names onto engine fields', () => {
    expect(boardSortToRules([{ column: 'assigned', direction: 'asc' }]))
      .toEqual([{ field: 'assignee', direction: 'asc' }])
    expect(boardSortToRules([{ column: 'dueDate', direction: 'desc' }]))
      .toEqual([{ field: 'due_date', direction: 'desc' }])
  })

  it('preserves multi-column sort order, which shift-click builds', () => {
    const rules = boardSortToRules([
      { column: 'priority', direction: 'asc' },
      { column: 'title', direction: 'desc' },
    ])
    expect(rules.map((r) => r.field)).toEqual(['priority', 'title'])
  })

  it('still sorts through the shared engine', () => {
    const rows = [task({ id: 'low', priority: 5 }), task({ id: 'high', priority: 1 })]
    const config = buildBoardConfig(state({ sort: [{ column: 'priority', direction: 'asc' }] }), NOW)
    expect(applySort(rows, config, ctx).map((t: any) => t.id)).toEqual(['high', 'low'])
  })
})

describe('the filter bar', () => {
  it('filters nothing when every control is "all"', () => {
    expect(buildBoardConfig(state(), NOW).filters).toEqual([])
  })

  it('filters by one assignee', () => {
    const config = buildBoardConfig(state({ user: 'u-bob' }), NOW)
    expect(applyFilters([task(), task({ id: 'b', task_assignees: [{ user_id: 'u-bob' }] })], config, ctx))
      .toHaveLength(1)
  })

  // The board never had this option; reports did. Supporting the sentinel closes the gap the
  // moment the board offers the chip.
  it('understands unassigned even though the board has no chip for it yet', () => {
    const config = buildBoardConfig(state({ user: UNASSIGNED }), NOW)
    expect(applyFilters([task(), task({ id: 'n', task_assignees: [] })], config, ctx).map((t: any) => t.id))
      .toEqual(['n'])
  })

  it('filters by priority', () => {
    const config = buildBoardConfig(state({ priority: '1' }), NOW)
    expect(applyFilters([task({ priority: 1 }), task({ id: 'b', priority: 5 })], config, ctx)).toHaveLength(1)
  })

  it('searches the title and the description', () => {
    const config = buildBoardConfig(state({ search: 'riverside' }), NOW)
    expect(applyFilters([task()], config, ctx)).toHaveLength(1)
    expect(applyFilters([task()], buildBoardConfig(state({ search: 'nope' }), NOW), ctx)).toHaveLength(0)
  })

  it('ANDs the controls together', () => {
    const config = buildBoardConfig(state({ user: 'u-ann', priority: '1' }), NOW)
    expect(applyFilters([task({ priority: 1 })], config, ctx)).toHaveLength(1)
    expect(applyFilters([task({ priority: 5 })], config, ctx)).toHaveLength(0)
  })

  it('counts active filters the same way the badge always did', () => {
    expect(boardActiveFilterCount(state())).toBe(0)
    expect(boardActiveFilterCount(state({ user: 'u-1', range: 'today', search: 'x' }))).toBe(3)
    expect(boardActiveFilterCount(state({ search: '   ' }))).toBe(0)
  })
})

describe('the date-range chips', () => {
  it('all adds no condition', () => {
    expect(dateRangeConditions('all', NOW)).toEqual([])
  })

  it('today is an inclusive range of one day', () => {
    const [condition] = dateRangeConditions('today', NOW)
    expect(condition).toMatchObject({ operator: 'between', values: ['2026-08-25', '2026-08-25'] })
  })

  it('week reaches seven days out', () => {
    expect(dateRangeConditions('week', NOW)[0].values).toEqual(['2026-08-25', '2026-09-01'])
  })

  it('month reaches one month out, clamping rather than rolling over', () => {
    expect(dateRangeConditions('month', new Date('2026-01-31T15:00:00Z'))[0].values)
      .toEqual(['2026-01-31', '2026-02-28'])
  })

  // The old code tested `getNormalizedTaskStatus(task) !== 'done'`, and the done bucket covers
  // completed AND cancelled. Two conditions, not a flip of the view's `completed` mode, because
  // "overdue" means "past its date AND unfinished" rather than "hide finished work everywhere".
  it('overdue means past AND not finished', () => {
    const conditions = dateRangeConditions('overdue', NOW)
    expect(conditions).toHaveLength(2)
    expect(conditions[0]).toMatchObject({ field: 'due_date', operator: 'before', values: ['2026-08-25'] })
    expect(conditions[1]).toMatchObject({
      field: 'status_category', operator: 'is_not', values: ['completed', 'cancelled'],
    })
  })

  it('counts a genuinely late open task as overdue', () => {
    const config = buildBoardConfig(state({ range: 'overdue' }), NOW)
    expect(applyFilters([task({ due_date: '2026-08-01' })], config, ctx)).toHaveLength(1)
  })

  it('does not call a finished task overdue', () => {
    const config = buildBoardConfig(state({ range: 'overdue' }), NOW)
    const late = task({ due_date: '2026-08-01', column: { status_key: 'done' } })
    expect(applyFilters([late], config, ctx)).toHaveLength(0)
  })

  it('does not call a cancelled task overdue either', () => {
    const config = buildBoardConfig(state({ range: 'overdue' }), NOW)
    const killed = task({ due_date: '2026-08-01', column: { status_key: 'cancelled' } })
    expect(applyFilters([killed], config, ctx)).toHaveLength(0)
  })

  it('drops an undated task from every range, as the old code did', () => {
    for (const range of ['overdue', 'today', 'week', 'month'] as const) {
      const config = buildBoardConfig(state({ range }), NOW)
      expect(applyFilters([task({ due_date: null })], config, ctx)).toHaveLength(0)
    }
  })
})

describe('the timezone bug this replaced', () => {
  // The old code built `new Date()`, zeroed its LOCAL hours, and compared that against
  // `new Date(task.due_date)` - which parses a YYYY-MM-DD DATE column as UTC midnight. West of
  // Greenwich those are different days, so a task due today counted as overdue for a five-hour
  // window every evening. Calendar comparison in the business zone cannot do that.
  it('does not call today\'s work overdue late in the evening', () => {
    const config = buildBoardConfig(state({ range: 'overdue' }), LATE)
    // 2026-08-26T02:00Z is 25 August 21:00 in America/Chicago, so 25 August is still today.
    expect(applyFilters([task({ due_date: '2026-08-25' })], config, { ...ctx, now: LATE })).toHaveLength(0)
  })

  it('still finds it under "today" at the same instant', () => {
    const config = buildBoardConfig(state({ range: 'today' }), LATE)
    expect(applyFilters([task({ due_date: '2026-08-25' })], config, { ...ctx, now: LATE })).toHaveLength(1)
  })

  it('gives the same answer at either instant on the same business day', () => {
    for (const instant of [NOW, LATE]) {
      const config = buildBoardConfig(state({ range: 'today' }), instant)
      expect(applyFilters([task({ due_date: '2026-08-25' })], config, { ...ctx, now: instant })).toHaveLength(1)
    }
  })
})

describe('what the board still owns', () => {
  // boardTasks() already drops subtasks and archived rows before the engine runs. Re-filtering
  // here would be a second, invisible authority over the same decision.
  it('does not re-filter subtasks', () => {
    const config = buildBoardConfig(state(), NOW)
    expect(config.hierarchy).toBe('flat')
    expect(applyFilters([task({ parent_task_id: 'parent' })], config, ctx)).toHaveLength(1)
  })

  it('does not hide completed work by itself', () => {
    const config = buildBoardConfig(state(), NOW)
    expect(applyFilters([task({ column: { status_key: 'done' } })], config, ctx)).toHaveLength(1)
  })
})

describe('the SHAPE the due_date column really has', () => {
  // ⚠️ The block above ("the timezone bug this replaced") uses `due_date: '2026-08-25'`, a bare
  // calendar date. **This column never sends that.** `tasks.due_date` is TIMESTAMPTZ
  // (001_initial_schema.sql), and PostgREST returns an instant: measured against the sandbox,
  // 49 of 53 rows are `T00:00:00+00:00` and the other 4 are `T05:00:00+00:00`.
  //
  // So those tests passed while the engine was wrong for every real row: resolving a UTC-midnight
  // instant through America/Chicago yields the day BEFORE, and a task due today came back from
  // the `overdue` filter. That reached production in Prompt E. A fixture shape production never
  // produces is not coverage, it is a second bug hiding the first.
  const UTC_MIDNIGHT = '2026-08-25T00:00:00+00:00'   // <input type="date"> -> Postgres
  const CHICAGO_MIDNIGHT = '2026-08-25T05:00:00+00:00' // the modal's picker, toISOString'd

  for (const [label, due] of [['UTC midnight', UTC_MIDNIGHT], ['Chicago midnight', CHICAGO_MIDNIGHT]]) {
    it(`does not call work due today overdue - ${label}`, () => {
      const config = buildBoardConfig(state({ range: 'overdue' }), NOW)
      expect(applyFilters([task({ due_date: due })], config, ctx)).toHaveLength(0)
    })

    it(`finds it under "today" instead - ${label}`, () => {
      const config = buildBoardConfig(state({ range: 'today' }), NOW)
      expect(applyFilters([task({ due_date: due })], config, ctx)).toHaveLength(1)
    })

    it(`gives the same answer late in the evening - ${label}`, () => {
      const config = buildBoardConfig(state({ range: 'today' }), LATE)
      expect(applyFilters([task({ due_date: due })], config, { ...ctx, now: LATE })).toHaveLength(1)
    })
  }

  it('still reports genuinely late work as overdue', () => {
    const config = buildBoardConfig(state({ range: 'overdue' }), NOW)
    const late = task({ due_date: '2026-08-24T00:00:00+00:00' })
    expect(applyFilters([late], config, ctx)).toHaveLength(1)
  })

  it('agrees with the bare-date form, so both shapes mean the same day', () => {
    const config = buildBoardConfig(state({ range: 'today' }), NOW)
    const asDate = applyFilters([task({ due_date: '2026-08-25' })], config, ctx)
    const asStamp = applyFilters([task({ due_date: UTC_MIDNIGHT })], config, ctx)
    expect(asStamp.length).toBe(asDate.length)
  })
})
