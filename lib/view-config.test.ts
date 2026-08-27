import { describe, it, expect } from 'vitest'
import {
  normalizeViewConfig,
  serializeViewConfig,
  configsEqual,
  applyFilters,
  applySort,
  applyGrouping,
  applyHierarchy,
  evaluateCondition,
  runView,
  isFilterComplete,
  incompleteFilters,
  activeFilterCount,
  operatorsFor,
  operatorTakesValues,
  operatorValueCount,
  describeField,
  describeFilter,
  describeView,
  customFilterField,
  parseCustomFilterField,
  DEFAULT_VIEW_CONFIG,
  CURRENT_USER,
  UNASSIGNED,
  type ViewConfig,
  type EvalContext,
  type FilterCondition,
} from './view-config'

const STATUSES = [
  { key: 'to_do', label: 'To Do', category: 'planned' as const, is_closed: false },
  { key: 'in_progress', label: 'In Progress', category: 'started' as const, is_closed: false },
  { key: 'done', label: 'Done', category: 'completed' as const, is_closed: true },
  { key: 'cancelled', label: 'Cancelled', category: 'cancelled' as const, is_closed: true },
]

const USERS = [
  { id: 'u-ann', full_name: 'Ann Adams', email: 'ann@example.com' },
  { id: 'u-bob', full_name: 'Bob Brown', email: 'bob@example.com' },
]

const BOARDS = [
  { id: 'b-1', title: 'Alpha' },
  { id: 'b-2', title: 'Beta' },
]

const NOW = new Date('2026-08-25T15:00:00Z')

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  currentUserId: 'u-ann',
  statuses: STATUSES,
  users: USERS,
  boards: BOARDS,
  now: NOW,
  ...over,
})

function task(over: Record<string, any> = {}) {
  return {
    id: 't1',
    title: 'Prepare bid package',
    description: 'For the Riverside job',
    board_id: 'b-1',
    priority: 3,
    task_assignees: [{ user_id: 'u-ann' }],
    column: { status_key: 'to_do' },
    task_tags: [],
    due_date: '2026-08-27',
    created_at: '2026-08-01T10:00:00Z',
    parent_task_id: null,
    type_key: 'task',
    ...over,
  }
}

const cfg = (over: Partial<ViewConfig> = {}): ViewConfig => ({ ...DEFAULT_VIEW_CONFIG, ...over })

const where = (field: string, operator: any, values: string[] = []): FilterCondition =>
  ({ id: 'c1', field, operator, values })

/* ────────────────────────────────────────────────────────────────────────────────── */

describe('normalizing a config', () => {
  it('fills in every default from an empty object', () => {
    expect(normalizeViewConfig({})).toEqual(DEFAULT_VIEW_CONFIG)
  })

  it('survives null, a string and an array without throwing', () => {
    for (const junk of [null, undefined, 'nope', 42, []]) {
      expect(normalizeViewConfig(junk).layout).toBe(DEFAULT_VIEW_CONFIG.layout)
    }
  })

  // A view saved by a newer build must degrade, not white-screen.
  it('falls back on an unknown layout rather than keeping it', () => {
    expect(normalizeViewConfig({ layout: 'gantt' }).layout).toBe('kanban')
  })

  it('falls back on an unknown descendant mode', () => {
    expect(normalizeViewConfig({ descendants: 'everything' }).descendants).toBe('none')
  })

  it('drops a filter with no field or an unknown operator', () => {
    const parsed = normalizeViewConfig({
      layout: 'list',
      filters: [
        { field: 'priority', operator: 'is', values: ['1'] },
        { field: '', operator: 'is', values: ['x'] },
        { field: 'priority', operator: 'sounds_like', values: ['x'] },
        'not an object',
      ],
    })
    expect(parsed.filters).toHaveLength(1)
    expect(parsed.filters[0].field).toBe('priority')
  })

  it('gives a filter an id when the stored row has none', () => {
    const parsed = normalizeViewConfig({ layout: 'list', filters: [{ field: 'priority', operator: 'is', values: [] }] })
    expect(parsed.filters[0].id).toBeTruthy()
  })

  it('drops a sort rule naming a field that cannot be sorted', () => {
    const parsed = normalizeViewConfig({ layout: 'list', sort: [{ field: 'vibes', direction: 'asc' }] })
    expect(parsed.sort).toEqual([])
  })

  it('treats any direction that is not desc as asc', () => {
    const parsed = normalizeViewConfig({ layout: 'list', sort: [{ field: 'title', direction: 'sideways' }] })
    expect(parsed.sort[0].direction).toBe('asc')
  })

  it('keeps an empty fields array from meaning "show nothing"', () => {
    expect(normalizeViewConfig({ layout: 'list', fields: [] }).fields).toEqual(DEFAULT_VIEW_CONFIG.fields)
  })

  it('round-trips a serialized config unchanged', () => {
    const original = cfg({
      layout: 'table',
      boardIds: ['b-2', 'b-1'],
      descendants: 'all',
      filters: [where('priority', 'is', ['1', '2'])],
      sort: [{ field: 'due_date', direction: 'desc' }],
      group: 'assignee',
      completed: 'hide',
    })
    expect(normalizeViewConfig(serializeViewConfig(original)))
      .toEqual({ ...original, boardIds: ['b-1', 'b-2'] })
  })
})

describe('what gets saved', () => {
  // A free-text box is what you are doing this minute, not how you like to look at work.
  it('never stores the search box', () => {
    expect(serializeViewConfig(cfg({ search: 'riverside' }))).not.toHaveProperty('search')
  })

  it('drops half-built filters so a saved view has no dead rows', () => {
    const saved = serializeViewConfig(cfg({
      filters: [where('priority', 'is', ['1']), where('assignee', 'is', [])],
    }))
    expect((saved.filters as unknown[])).toHaveLength(1)
  })

  it('sorts board ids so reordering the picker is not an unsaved change', () => {
    expect(configsEqual(cfg({ boardIds: ['b-2', 'b-1'] }), cfg({ boardIds: ['b-1', 'b-2'] }))).toBe(true)
  })

  it('sees a real change as a change', () => {
    expect(configsEqual(cfg({ group: 'assignee' }), cfg({ group: 'board' }))).toBe(false)
  })

  it('does not call a typed search an unsaved change', () => {
    expect(configsEqual(cfg({ search: 'x' }), cfg({ search: '' }))).toBe(true)
  })
})

describe('the operator vocabulary', () => {
  it('offers date operators on a date field and never on a select', () => {
    expect(operatorsFor('due_date')).toContain('between')
    expect(operatorsFor('priority')).not.toContain('between')
  })

  it('offers text operators on a title', () => {
    expect(operatorsFor('title')).toContain('contains')
  })

  it('picks operators for a custom field from its declared kind', () => {
    expect(operatorsFor(customFilterField('review_by'), 'date')).toContain('after')
    expect(operatorsFor(customFilterField('notes'), 'text')).toContain('contains')
    expect(operatorsFor(customFilterField('floors'), 'number')).toContain('between')
  })

  it('knows which operators need a value', () => {
    expect(operatorTakesValues('empty')).toBe(false)
    expect(operatorTakesValues('is')).toBe(true)
    expect(operatorValueCount('between')).toBe(2)
    expect(operatorValueCount('not_empty')).toBe(0)
  })

  it('round-trips a custom field key', () => {
    expect(parseCustomFilterField(customFilterField('permit_no'))).toBe('permit_no')
    expect(parseCustomFilterField('priority')).toBeNull()
  })

  it('labels every declared field', () => {
    expect(describeField('due_date')?.label).toBe('Due date')
    expect(describeField('status_category')?.label).toBe('Status means')
  })
})

describe('an unfinished filter', () => {
  // It constrains nothing, and the UI has to be able to SAY so - ATLAS_01 10.2.
  it('is not complete when its operator needs a value it does not have', () => {
    expect(isFilterComplete(where('priority', 'is', []))).toBe(false)
    expect(isFilterComplete(where('priority', 'is', ['']))).toBe(false)
  })

  it('is complete when the operator needs no value', () => {
    expect(isFilterComplete(where('due_date', 'empty'))).toBe(true)
  })

  it('needs both ends of a between', () => {
    expect(isFilterComplete(where('due_date', 'between', ['2026-01-01']))).toBe(false)
    expect(isFilterComplete(where('due_date', 'between', ['2026-01-01', '2026-02-01']))).toBe(true)
  })

  it('matches everything rather than nothing', () => {
    expect(evaluateCondition(task(), where('priority', 'is', []), ctx())).toBe(true)
  })

  it('is reported so the UI can explain the empty-looking filter bar', () => {
    const config = cfg({ filters: [where('priority', 'is', ['1']), where('assignee', 'is', [])] })
    expect(incompleteFilters(config)).toHaveLength(1)
    expect(activeFilterCount(config)).toBe(1)
  })

  it('counts the search box as an active filter', () => {
    expect(activeFilterCount(cfg({ search: 'bid' }))).toBe(1)
    expect(activeFilterCount(cfg({ search: '   ' }))).toBe(0)
  })
})

describe('operators', () => {
  it('is / is not on a single-valued field', () => {
    expect(evaluateCondition(task(), where('priority', 'is', ['3']), ctx())).toBe(true)
    expect(evaluateCondition(task(), where('priority', 'is', ['1']), ctx())).toBe(false)
    expect(evaluateCondition(task(), where('priority', 'is_not', ['1']), ctx())).toBe(true)
  })

  it('treats several values on one condition as alternatives', () => {
    expect(evaluateCondition(task(), where('priority', 'is', ['1', '3']), ctx())).toBe(true)
  })

  // Collapsing a multi-valued field to one value is how "assignee is Ann" silently stops
  // matching a task Ann shares with Bob.
  it('matches a shared assignment on either assignee', () => {
    const shared = task({ task_assignees: [{ user_id: 'u-ann' }, { user_id: 'u-bob' }] })
    expect(evaluateCondition(shared, where('assignee', 'is', ['u-bob']), ctx())).toBe(true)
    expect(evaluateCondition(shared, where('assignee', 'is', ['u-ann']), ctx())).toBe(true)
  })

  it('is not on a multi-valued field excludes the task if ANY value matches', () => {
    const shared = task({ task_assignees: [{ user_id: 'u-ann' }, { user_id: 'u-bob' }] })
    expect(evaluateCondition(shared, where('assignee', 'is_not', ['u-bob']), ctx())).toBe(false)
  })

  it('contains / does not contain are case-insensitive over the title', () => {
    expect(evaluateCondition(task(), where('title', 'contains', ['BID']), ctx())).toBe(true)
    expect(evaluateCondition(task(), where('title', 'does_not_contain', ['BID']), ctx())).toBe(false)
    expect(evaluateCondition(task(), where('title', 'does_not_contain', ['invoice']), ctx())).toBe(true)
  })

  it('contains searches assignee NAMES, not their uuids', () => {
    expect(evaluateCondition(task(), where('assignee', 'contains', ['ann adams']), ctx())).toBe(true)
  })

  it('contains searches tag names', () => {
    const tagged = task({ task_tags: [{ tag: { id: 'tag-1', name: 'Urgent' } }] })
    expect(evaluateCondition(tagged, where('tag', 'contains', ['urg']), ctx())).toBe(true)
  })

  it('empty / not empty on a field that holds nothing', () => {
    expect(evaluateCondition(task({ due_date: null }), where('due_date', 'empty'), ctx())).toBe(true)
    expect(evaluateCondition(task(), where('due_date', 'empty'), ctx())).toBe(false)
    expect(evaluateCondition(task(), where('due_date', 'not_empty'), ctx())).toBe(true)
  })

  it('empty on an unassigned task', () => {
    expect(evaluateCondition(task({ task_assignees: [] }), where('assignee', 'empty'), ctx())).toBe(true)
  })

  it('before / after / between on dates', () => {
    const t = task({ due_date: '2026-08-27' })
    expect(evaluateCondition(t, where('due_date', 'before', ['2026-09-01']), ctx())).toBe(true)
    expect(evaluateCondition(t, where('due_date', 'before', ['2026-08-01']), ctx())).toBe(false)
    expect(evaluateCondition(t, where('due_date', 'after', ['2026-08-01']), ctx())).toBe(true)
    expect(evaluateCondition(t, where('due_date', 'between', ['2026-08-01', '2026-09-01']), ctx())).toBe(true)
    expect(evaluateCondition(t, where('due_date', 'between', ['2026-09-01', '2026-10-01']), ctx())).toBe(false)
  })

  it('accepts a between whose ends arrive the wrong way round', () => {
    expect(evaluateCondition(task(), where('due_date', 'between', ['2026-09-01', '2026-08-01']), ctx())).toBe(true)
  })

  it('a task with no date is neither before nor after one', () => {
    const undated = task({ due_date: null })
    expect(evaluateCondition(undated, where('due_date', 'before', ['2026-09-01']), ctx())).toBe(false)
    expect(evaluateCondition(undated, where('due_date', 'after', ['2026-01-01']), ctx())).toBe(false)
  })
})

describe('the timezone trap', () => {
  // `Date.parse('2026-08-27')` resolves against the RUNTIME's zone - UTC on the server,
  // America/Chicago in the browser - so a five-hour window every day would render the same
  // task as overdue on one and fine on the other. This already bit the CRM. A date-only
  // column must be compared as a CALENDAR DATE, never parsed into an instant.
  it('compares a date-only due date without shifting it a day', () => {
    const t = task({ due_date: '2026-08-25' })
    // Same calendar day: not before, not after, but inside a range that includes it.
    expect(evaluateCondition(t, where('due_date', 'before', ['2026-08-25']), ctx())).toBe(false)
    expect(evaluateCondition(t, where('due_date', 'after', ['2026-08-25']), ctx())).toBe(false)
    expect(evaluateCondition(t, where('due_date', 'between', ['2026-08-25', '2026-08-25']), ctx())).toBe(true)
  })

  it('a midnight-UTC due date is not pulled back to the previous day', () => {
    // 2026-08-25T00:00:00Z is 2026-08-24 19:00 in America/Chicago. A naive instant compare
    // would call this "before 2026-08-25"; a calendar compare in the business zone does not
    // move a bare YYYY-MM-DD at all.
    const t = task({ due_date: '2026-08-25' })
    expect(evaluateCondition(t, where('due_date', 'between', ['2026-08-25', '2026-08-25']), ctx())).toBe(true)
  })

  // ⚠️ The name of this test used to say "by the business calendar, not UTC", and its fixture
  // was a bare '2026-08-25' - a shape this TIMESTAMPTZ column never sends, so it proved neither
  // half. The real rule is the opposite of what the title claimed: a stored midnight means the
  // day it was stored ON, and re-zoning it into Chicago is what moved every due date a day early.
  it('groups the real stored shapes into the right due bucket', () => {
    for (const due of ['2026-08-25', '2026-08-25T00:00:00+00:00', '2026-08-25T05:00:00+00:00']) {
      const groups = applyGrouping([task({ id: 'today', due_date: due })], 'due_bucket', ctx())
      expect(groups[0].key, `due_date ${due}`).toBe('today')
    }
  })

  it('still buckets genuinely late work as overdue', () => {
    const groups = applyGrouping([task({ due_date: '2026-08-24T00:00:00+00:00' })], 'due_bucket', ctx())
    expect(groups[0].key).toBe('overdue')
  })
})

describe('current user and unassigned', () => {
  // As a VALUE rather than an operator, @me composes: "not me", "me or Bob", all for free.
  it('resolves @me to whoever is looking', () => {
    expect(evaluateCondition(task(), where('assignee', 'is', [CURRENT_USER]), ctx())).toBe(true)
    expect(evaluateCondition(task(), where('assignee', 'is', [CURRENT_USER]), ctx({ currentUserId: 'u-bob' }))).toBe(false)
  })

  it('composes with is_not', () => {
    expect(evaluateCondition(task(), where('assignee', 'is_not', [CURRENT_USER]), ctx())).toBe(false)
    expect(evaluateCondition(task(), where('assignee', 'is_not', [CURRENT_USER]), ctx({ currentUserId: 'u-bob' }))).toBe(true)
  })

  it('composes with another person', () => {
    const bobs = task({ task_assignees: [{ user_id: 'u-bob' }] })
    expect(evaluateCondition(bobs, where('assignee', 'is', [CURRENT_USER, 'u-bob']), ctx())).toBe(true)
  })

  // A shared view must not silently mean "assigned to whoever saved it".
  it('matches nobody when signed out rather than everybody', () => {
    expect(evaluateCondition(task(), where('assignee', 'is', [CURRENT_USER]), ctx({ currentUserId: null }))).toBe(false)
  })

  it('@unassigned means the field holds nothing, not the literal string', () => {
    expect(evaluateCondition(task({ task_assignees: [] }), where('assignee', 'is', [UNASSIGNED]), ctx())).toBe(true)
    expect(evaluateCondition(task(), where('assignee', 'is', [UNASSIGNED]), ctx())).toBe(false)
  })

  it('offers unassigned alongside real people in one condition', () => {
    const bobs = task({ task_assignees: [{ user_id: 'u-bob' }] })
    const none = task({ task_assignees: [] })
    const c = where('assignee', 'is', [UNASSIGNED, 'u-bob'])
    expect(evaluateCondition(bobs, c, ctx())).toBe(true)
    expect(evaluateCondition(none, c, ctx())).toBe(true)
    expect(evaluateCondition(task(), c, ctx())).toBe(false)
  })
})

describe('status and category', () => {
  it('reads the status key through the column FK, which is the source of truth', () => {
    expect(evaluateCondition(task(), where('status', 'is', ['to_do']), ctx())).toBe(true)
  })

  // 112 exists because a substring match called a "Blocked" status "to do".
  it('filters by what a status MEANS, not what it is called', () => {
    const cancelled = task({ column: { status_key: 'cancelled' } })
    expect(evaluateCondition(cancelled, where('status_category', 'is', ['cancelled']), ctx())).toBe(true)
    expect(evaluateCondition(cancelled, where('status_category', 'is', ['completed']), ctx())).toBe(false)
  })

  it('hides completed work when asked, and cancelled counts as closed', () => {
    const rows = [task({ id: 'a' }), task({ id: 'b', column: { status_key: 'done' } }), task({ id: 'c', column: { status_key: 'cancelled' } })]
    expect(applyFilters(rows, cfg({ completed: 'hide' }), ctx()).map((t: any) => t.id)).toEqual(['a'])
    expect(applyFilters(rows, cfg({ completed: 'only' }), ctx()).map((t: any) => t.id).sort()).toEqual(['b', 'c'])
    expect(applyFilters(rows, cfg({ completed: 'show' }), ctx())).toHaveLength(3)
  })
})

describe('custom fields', () => {
  const withValues = ctx({ customValues: { t1: { permit_no: 'A-1024', floors: 3 } } })

  it('filters on a custom value', () => {
    expect(evaluateCondition(task(), where(customFilterField('permit_no'), 'contains', ['1024']), withValues)).toBe(true)
  })

  it('treats a task with no value for the field as empty', () => {
    expect(evaluateCondition(task({ id: 'other' }), where(customFilterField('permit_no'), 'empty'), withValues)).toBe(true)
  })

  it('stringifies a numeric custom value for comparison', () => {
    expect(evaluateCondition(task(), where(customFilterField('floors'), 'is', ['3']), withValues)).toBe(true)
  })
})

describe('joining conditions', () => {
  const rows = [
    task({ id: 'a', priority: 1, task_assignees: [{ user_id: 'u-ann' }] }),
    task({ id: 'b', priority: 5, task_assignees: [{ user_id: 'u-bob' }] }),
    task({ id: 'c', priority: 1, task_assignees: [{ user_id: 'u-bob' }] }),
  ]
  const filters = [
    { id: 'p', field: 'priority', operator: 'is' as const, values: ['1'] },
    { id: 'a', field: 'assignee', operator: 'is' as const, values: ['u-ann'] },
  ]

  it('AND requires every condition', () => {
    expect(applyFilters(rows, cfg({ filters, filterJoin: 'and' }), ctx()).map((t: any) => t.id)).toEqual(['a'])
  })

  it('OR requires any condition', () => {
    expect(applyFilters(rows, cfg({ filters, filterJoin: 'or' }), ctx()).map((t: any) => t.id).sort())
      .toEqual(['a', 'b', 'c'].filter((id) => id !== 'b'))
  })

  it('no conditions returns everything', () => {
    expect(applyFilters(rows, cfg(), ctx())).toHaveLength(3)
  })

  it('the search box is ANDed even when the join is OR', () => {
    const found = applyFilters(rows, cfg({ filters, filterJoin: 'or', search: 'riverside' }), ctx())
    expect(found.length).toBeGreaterThan(0)
    expect(applyFilters(rows, cfg({ filters, filterJoin: 'or', search: 'nothing matches this' }), ctx())).toHaveLength(0)
  })

  it('searches the description as well as the title', () => {
    expect(applyFilters(rows, cfg({ search: 'Riverside' }), ctx())).toHaveLength(3)
  })
})

describe('sorting', () => {
  it('sorts priority most-urgent-first on ascending, because 1 is highest', () => {
    const rows = [task({ id: 'low', priority: 5 }), task({ id: 'high', priority: 1 })]
    expect(applySort(rows, cfg({ sort: [{ field: 'priority', direction: 'asc' }] }), ctx()).map((t: any) => t.id))
      .toEqual(['high', 'low'])
  })

  it('sorts a task with no priority last, not first', () => {
    const rows = [task({ id: 'none', priority: null }), task({ id: 'low', priority: 5 })]
    expect(applySort(rows, cfg({ sort: [{ field: 'priority', direction: 'asc' }] }), ctx()).map((t: any) => t.id))
      .toEqual(['low', 'none'])
  })

  it('sorts undated work after every real date, because undated is not urgent', () => {
    const rows = [task({ id: 'none', due_date: null }), task({ id: 'late', due_date: '2027-01-01' })]
    expect(applySort(rows, cfg({ sort: [{ field: 'due_date', direction: 'asc' }] }), ctx()).map((t: any) => t.id))
      .toEqual(['late', 'none'])
  })

  it('sorts assignee by display name, not uuid', () => {
    const rows = [task({ id: 'bob', task_assignees: [{ user_id: 'u-bob' }] }), task({ id: 'ann', task_assignees: [{ user_id: 'u-ann' }] })]
    expect(applySort(rows, cfg({ sort: [{ field: 'assignee', direction: 'asc' }] }), ctx()).map((t: any) => t.id))
      .toEqual(['ann', 'bob'])
  })

  it('sorts unassigned last', () => {
    const rows = [task({ id: 'none', task_assignees: [] }), task({ id: 'ann' })]
    expect(applySort(rows, cfg({ sort: [{ field: 'assignee', direction: 'asc' }] }), ctx()).map((t: any) => t.id))
      .toEqual(['ann', 'none'])
  })

  it('sorts board by title, not uuid', () => {
    const rows = [task({ id: 'beta', board_id: 'b-2' }), task({ id: 'alpha', board_id: 'b-1' })]
    expect(applySort(rows, cfg({ sort: [{ field: 'board', direction: 'asc' }] }), ctx()).map((t: any) => t.id))
      .toEqual(['alpha', 'beta'])
  })

  it('falls through to the next rule when the first ties', () => {
    const rows = [
      task({ id: 'b', priority: 1, title: 'Bravo' }),
      task({ id: 'a', priority: 1, title: 'Alpha' }),
    ]
    const sorted = applySort(rows, cfg({
      sort: [{ field: 'priority', direction: 'asc' }, { field: 'title', direction: 'asc' }],
    }), ctx())
    expect(sorted.map((t: any) => t.id)).toEqual(['a', 'b'])
  })

  it('reverses on desc', () => {
    const rows = [task({ id: 'high', priority: 1 }), task({ id: 'low', priority: 5 })]
    expect(applySort(rows, cfg({ sort: [{ field: 'priority', direction: 'desc' }] }), ctx()).map((t: any) => t.id))
      .toEqual(['low', 'high'])
  })

  it('does not mutate the array it was given', () => {
    const rows = [task({ id: 'b', priority: 5 }), task({ id: 'a', priority: 1 })]
    applySort(rows, cfg({ sort: [{ field: 'priority', direction: 'asc' }] }), ctx())
    expect(rows.map((t: any) => t.id)).toEqual(['b', 'a'])
  })

  it('leaves the order alone with no sort rules', () => {
    const rows = [task({ id: 'b' }), task({ id: 'a' })]
    expect(applySort(rows, cfg(), ctx()).map((t: any) => t.id)).toEqual(['b', 'a'])
  })
})

describe('grouping', () => {
  it('one group holding everything when nothing is grouped', () => {
    const groups = applyGrouping([task(), task({ id: 't2' })], null, ctx())
    expect(groups).toHaveLength(1)
    expect(groups[0].tasks).toHaveLength(2)
  })

  it('labels an assignee group with a name and unassigned with "Unassigned"', () => {
    const groups = applyGrouping([task(), task({ id: 't2', task_assignees: [] })], 'assignee', ctx())
    expect(groups.map((g) => g.label).sort()).toEqual(['Ann Adams', 'Unassigned'])
  })

  it('sorts an empty group last', () => {
    const groups = applyGrouping([task({ id: 'none', task_assignees: [] }), task()], 'assignee', ctx())
    expect(groups[groups.length - 1].key).toBe('__none__')
  })

  it('orders status groups by the catalog, not alphabetically', () => {
    const rows = [task({ id: 'd', column: { status_key: 'done' } }), task({ id: 't', column: { status_key: 'to_do' } })]
    expect(applyGrouping(rows, 'status', ctx()).map((g) => g.key)).toEqual(['to_do', 'done'])
  })

  it('labels a status group with its human label', () => {
    expect(applyGrouping([task()], 'status', ctx())[0].label).toBe('To Do')
  })

  it('orders due buckets by urgency, not by name', () => {
    const rows = [
      task({ id: 'later', due_date: '2027-01-01' }),
      task({ id: 'overdue', due_date: '2026-01-01' }),
      task({ id: 'today', due_date: '2026-08-25' }),
    ]
    expect(applyGrouping(rows, 'due_bucket', ctx()).map((g) => g.key))
      .toEqual(['overdue', 'today', 'later'])
  })

  it('puts undated work in its own bucket', () => {
    const groups = applyGrouping([task({ due_date: null })], 'due_bucket', ctx())
    expect(groups[0].label).toBe('No due date')
  })

  // Correct rather than a bug - but it means group counts sum to more than the task count.
  it('shows a two-tag task under both tags', () => {
    const tagged = task({ task_tags: [{ tag: { id: 'x', name: 'X' } }, { tag: { id: 'y', name: 'Y' } }] })
    const groups = applyGrouping([tagged], 'tag', ctx())
    expect(groups).toHaveLength(2)
    expect(groups.reduce((n, g) => n + g.tasks.length, 0)).toBe(2)
  })

  it('labels a priority group readably', () => {
    expect(applyGrouping([task({ priority: 1 })], 'priority', ctx())[0].label).toBe('1 - Highest')
  })

  it('labels a board group with its title', () => {
    expect(applyGrouping([task()], 'board', ctx())[0].label).toBe('Alpha')
  })
})

describe('hierarchy', () => {
  const rows = [task({ id: 'parent' }), task({ id: 'child', parent_task_id: 'parent' })]

  // Without this the board renders subtasks as loose cards - the reason CLAUDE.md warns that
  // board queries need `WHERE parent_task_id IS NULL`.
  it('parents_only drops subtasks, and is the default so nothing changes on adoption', () => {
    expect(DEFAULT_VIEW_CONFIG.hierarchy).toBe('parents_only')
    expect(applyHierarchy(rows, 'parents_only').map((t: any) => t.id)).toEqual(['parent'])
  })

  it('flat keeps everything', () => {
    expect(applyHierarchy(rows, 'flat')).toHaveLength(2)
  })

  it('nested keeps only top-level rows for the renderer to expand', () => {
    expect(applyHierarchy(rows, 'nested').map((t: any) => t.id)).toEqual(['parent'])
  })
})

describe('the whole pipeline', () => {
  const rows = [
    task({ id: 'a', priority: 1, due_date: '2026-08-26' }),
    task({ id: 'b', priority: 5, due_date: '2026-08-30' }),
    task({ id: 'sub', parent_task_id: 'a' }),
  ]

  it('filters, then sorts, then groups', () => {
    const result = runView(rows, cfg({
      filters: [where('priority', 'is', ['1', '5'])],
      sort: [{ field: 'priority', direction: 'asc' }],
      group: 'priority',
    }), ctx())
    expect(result.tasks.map((t: any) => t.id)).toEqual(['a', 'b'])
    expect(result.groups.map((g) => g.key)).toEqual(['1', '5'])
  })

  // A view quietly showing 2 of 40 looks broken; one that says why does not.
  it('reports how many rows the filters removed', () => {
    const result = runView(rows, cfg({ filters: [where('priority', 'is', ['1'])] }), ctx())
    expect(result.tasks).toHaveLength(1)
    expect(result.hiddenCount).toBe(1)  // 'b'; 'sub' was removed by hierarchy, not by a filter
  })

  it('counts nothing hidden when no filter is set', () => {
    expect(runView(rows, cfg(), ctx()).hiddenCount).toBe(0)
  })
})

describe('saying what a view does', () => {
  it('names the field, the operator and the values', () => {
    expect(describeFilter(where('priority', 'is', ['1', '2']), ctx())).toBe('Priority is 1 or 2')
  })

  it('renders @me as "me" rather than a uuid', () => {
    expect(describeFilter(where('assignee', 'is', [CURRENT_USER]), ctx())).toBe('Assignee is me')
  })

  it('renders @unassigned as "nobody"', () => {
    expect(describeFilter(where('assignee', 'is', [UNASSIGNED]), ctx())).toBe('Assignee is nobody')
  })

  it('reads a between as a range', () => {
    expect(describeFilter(where('due_date', 'between', ['2026-01-01', '2026-02-01']), ctx()))
      .toBe('Due date between 2026-01-01 and 2026-02-01')
  })

  it('omits values for an operator that takes none', () => {
    expect(describeFilter(where('due_date', 'empty'), ctx())).toBe('Due date is empty')
  })

  it('uses a caller-supplied label so a uuid never reaches the screen', () => {
    const label = (_f: string, v: string) => USERS.find((u) => u.id === v)?.full_name ?? v
    expect(describeFilter(where('assignee', 'is', ['u-bob']), ctx(), label)).toBe('Assignee is Bob Brown')
  })

  it('names a custom field by its key when there is no descriptor', () => {
    expect(describeFilter(where(customFilterField('permit_no'), 'not_empty'), ctx()))
      .toBe('permit_no is not empty')
  })

  it('summarizes a whole view in words', () => {
    const text = describeView(cfg({
      layout: 'table', descendants: 'all', filters: [where('priority', 'is', ['1'])],
      group: 'assignee', completed: 'hide',
    }))
    expect(text).toContain('Table')
    expect(text).toContain('1 filter')
    expect(text).toContain('grouped by assignee')
    expect(text).toContain('completed work hidden')
  })

  it('describes the plainest possible view without inventing clauses', () => {
    expect(describeView(cfg())).toBe('Board')
  })
})

describe('due dates use the SHAPE the column really has', () => {
  // ⚠️ `tasks.due_date` is TIMESTAMPTZ, not DATE (001_initial_schema.sql), and it stores MIDNIGHT
  // on the day the person picked. Measured against the sandbox: 49 of 53 rows are
  // `T00:00:00+00:00` (Postgres casting an <input type="date">) and 4 are `T05:00:00+00:00`
  // (the modal's picker at Chicago midnight). Every fixture in this file above uses a bare
  // '2026-08-27' instead, which the column never sends - so the engine could resolve a
  // UTC-midnight instant through America/Chicago, land on the day BEFORE, and pass every test
  // here while returning today's work from an `overdue` filter on production.
  //
  // `created_at` is deliberately NOT covered by this rule: it is a genuine instant, and which
  // day it belongs to really does depend on where you are standing.
  const shapes: Array<[string, string]> = [
    ['UTC midnight (the common one)', '2026-08-27T00:00:00+00:00'],
    ['Chicago midnight', '2026-08-27T05:00:00+00:00'],
    ['a bare calendar date', '2026-08-27'],
  ]

  for (const [label, due] of shapes) {
    it(`means 27 August - ${label}`, () => {
      const t = task({ due_date: due })
      // `is` on a date field compares calendar days.
      expect(evaluateCondition(t, where('due_date', 'is', ['2026-08-27']), ctx())).toBe(true)
      expect(evaluateCondition(t, where('due_date', 'is', ['2026-08-26']), ctx())).toBe(false)
    })

    it(`is not before itself - ${label}`, () => {
      const t = task({ due_date: due })
      expect(evaluateCondition(t, where('due_date', 'before', ['2026-08-27']), ctx())).toBe(false)
      expect(evaluateCondition(t, where('due_date', 'after', ['2026-08-26']), ctx())).toBe(true)
    })

    it(`falls inside a single-day range covering it - ${label}`, () => {
      const t = task({ due_date: due })
      // `between` is inclusive at both ends, so a one-day window must contain the task.
      expect(evaluateCondition(t, where('due_date', 'between', ['2026-08-27', '2026-08-27']), ctx())).toBe(true)
      expect(evaluateCondition(t, where('due_date', 'between', ['2026-08-25', '2026-08-26']), ctx())).toBe(false)
    })
  }

  it('sorts the two stored shapes as the same day rather than a day apart', () => {
    const a = task({ id: 'a', due_date: '2026-08-27T00:00:00+00:00' })
    const b = task({ id: 'b', due_date: '2026-08-27T05:00:00+00:00' })
    const c = task({ id: 'c', due_date: '2026-08-26T00:00:00+00:00' })
    const sorted = applySort([a, b, c], cfg({ sort: [{ field: 'due_date', direction: 'asc' }] }), ctx())
    expect(sorted[0].id).toBe('c')
  })
})
