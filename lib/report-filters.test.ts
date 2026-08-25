import { describe, it, expect } from 'vitest'
import { UNASSIGNED_FILTER_VALUE, buildReportConfig, pickerDate } from './report-filters'
import { UNASSIGNED, applyFilters, type EvalContext } from './view-config'

const empty = { users: [], tags: [], priorities: [], statuses: [], boards: [] }

const ctx: EvalContext = { currentUserId: null, statuses: [], users: [], boards: [], now: new Date(0) }

const task = (over: Record<string, any> = {}) => ({
  id: 't', title: 'T', board_id: 'b-1', priority: 3,
  task_assignees: [{ user_id: 'u-1' }], task_tags: [],
  column: { status_key: 'to_do' }, due_date: '2026-08-25',
  created_at: '2026-08-01T10:00:00Z', parent_task_id: null, ...over,
})

describe('turning a picker Date into a calendar date', () => {
  it('reads local parts, because the picker returns local midnight', () => {
    expect(pickerDate(new Date(2026, 7, 25))).toBe('2026-08-25')
  })

  it('pads to two digits', () => {
    expect(pickerDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('is undefined when nothing was picked', () => {
    expect(pickerDate(undefined)).toBeUndefined()
  })
})

describe('mapping chips onto conditions', () => {
  it('produces no conditions when nothing is chosen', () => {
    expect(buildReportConfig(empty).filters).toEqual([])
  })

  it('maps each chip group to one condition holding its alternatives', () => {
    const config = buildReportConfig({ ...empty, priorities: ['1', '2'] })
    expect(config.filters).toHaveLength(1)
    expect(config.filters[0]).toMatchObject({ field: 'priority', operator: 'is', values: ['1', '2'] })
  })

  it('translates this screen\'s unassigned sentinel to the engine\'s', () => {
    const config = buildReportConfig({ ...empty, users: [UNASSIGNED_FILTER_VALUE, 'u-1'] })
    expect(config.filters[0].values).toEqual([UNASSIGNED, 'u-1'])
  })

  it('ANDs the groups, so chips narrow rather than widen', () => {
    expect(buildReportConfig({ ...empty, priorities: ['1'], boards: ['b-1'] }).filterJoin).toBe('and')
  })

  // A report counts every task. Narrowing to parents would quietly under-report every total.
  it('counts subtasks, unlike a board', () => {
    expect(buildReportConfig(empty).hierarchy).toBe('flat')
  })

  it('never hides completed work, which a report is usually about', () => {
    expect(buildReportConfig(empty).completed).toBe('show')
  })
})

describe('date ranges', () => {
  it('makes one condition from a two-ended range', () => {
    const config = buildReportConfig({ ...empty, dueFrom: '2026-08-01', dueTo: '2026-08-31' })
    expect(config.filters).toHaveLength(1)
    expect(config.filters[0]).toMatchObject({
      field: 'due_date', operator: 'between', values: ['2026-08-01', '2026-08-31'],
    })
  })

  it('opens the far end when only From is set', () => {
    const config = buildReportConfig({ ...empty, dueFrom: '2026-08-01' })
    expect(config.filters[0].values[1]).toBe('9999-12-31')
  })

  it('opens the near end when only To is set', () => {
    const config = buildReportConfig({ ...empty, dueTo: '2026-08-31' })
    expect(config.filters[0].values[0]).toBe('0001-01-01')
  })

  it('keeps created and due as separate conditions', () => {
    const config = buildReportConfig({ ...empty, dueFrom: '2026-08-01', createdFrom: '2026-01-01' })
    expect(config.filters.map((f) => f.field).sort()).toEqual(['created_at', 'due_date'])
  })
})

describe('the boundary date, end to end', () => {
  // The chips are labelled From and To, which are INCLUSIVE by convention. Mapping them onto
  // `before`/`after` - which are exclusive - would silently drop work due on exactly the date
  // somebody picked, and nobody would notice.
  it('includes a task due on the From date', () => {
    const config = buildReportConfig({ ...empty, dueFrom: '2026-08-25' })
    expect(applyFilters([task({ due_date: '2026-08-25' })], config, ctx)).toHaveLength(1)
  })

  it('includes a task due on the To date', () => {
    const config = buildReportConfig({ ...empty, dueTo: '2026-08-25' })
    expect(applyFilters([task({ due_date: '2026-08-25' })], config, ctx)).toHaveLength(1)
  })

  it('excludes a task one day outside either end', () => {
    const from = buildReportConfig({ ...empty, dueFrom: '2026-08-25' })
    expect(applyFilters([task({ due_date: '2026-08-24' })], from, ctx)).toHaveLength(0)
    const to = buildReportConfig({ ...empty, dueTo: '2026-08-25' })
    expect(applyFilters([task({ due_date: '2026-08-26' })], to, ctx)).toHaveLength(0)
  })

  // The old code did `new Date(task.due_date) >= dateFrom`: a YYYY-MM-DD DATE column parsed as
  // UTC midnight, compared against the picker's LOCAL midnight. West of Greenwich those are
  // different days, so a boundary task fell in or out depending on the reader's timezone.
  it('gives the same answer whatever the runtime timezone', () => {
    const config = buildReportConfig({ ...empty, dueFrom: '2026-08-25', dueTo: '2026-08-25' })
    expect(applyFilters([task({ due_date: '2026-08-25' })], config, ctx)).toHaveLength(1)
  })

  it('drops a task with no due date from any due-date range', () => {
    const config = buildReportConfig({ ...empty, dueFrom: '2026-01-01' })
    expect(applyFilters([task({ due_date: null })], config, ctx)).toHaveLength(0)
  })
})

describe('the whole chip set, end to end', () => {
  const rows = [
    task({ id: 'a', priority: 1, board_id: 'b-1', task_assignees: [{ user_id: 'u-1' }] }),
    task({ id: 'b', priority: 5, board_id: 'b-1', task_assignees: [] }),
    task({ id: 'c', priority: 1, board_id: 'b-2', task_assignees: [{ user_id: 'u-2' }] }),
  ]

  it('narrows as more chips are added', () => {
    expect(applyFilters(rows, buildReportConfig(empty), ctx)).toHaveLength(3)
    expect(applyFilters(rows, buildReportConfig({ ...empty, priorities: ['1'] }), ctx)).toHaveLength(2)
    expect(applyFilters(rows, buildReportConfig({ ...empty, priorities: ['1'], boards: ['b-1'] }), ctx)).toHaveLength(1)
  })

  // Reports has always had this and the board never did. Both do now.
  it('finds unassigned work', () => {
    const config = buildReportConfig({ ...empty, users: [UNASSIGNED_FILTER_VALUE] })
    expect(applyFilters(rows, config, ctx).map((t: any) => t.id)).toEqual(['b'])
  })

  it('reads the status through the column FK, which is the source of truth', () => {
    const config = buildReportConfig({ ...empty, statuses: ['to_do'] })
    expect(applyFilters(rows, config, ctx)).toHaveLength(3)
    expect(applyFilters(rows, buildReportConfig({ ...empty, statuses: ['done'] }), ctx)).toHaveLength(0)
  })
})
