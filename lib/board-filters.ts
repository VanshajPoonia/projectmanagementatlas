// Translating the board's filter bar and sort headers into the shared view config.
//
// ⚠️ The board used to carry its OWN filter implementation - an inline `filterTasks()` over
// `filterUser`/`filterPriority`/`filterDateRange`/`searchTerm`, plus its own `sortTasks()`. It
// did not agree with the Reports screen's: the board had "overdue" and reports did not, reports
// had Unassigned, tags and status and the board had none of them, and "filter by assignee" was
// written twice, differently. Both now route through lib/view-config.ts, so the same question
// asked on a board and in a report cannot give two answers.
//
// The board's own UI is unchanged. What changed is where the answer comes from.
//
// ⚠️ AND THE DATE RANGES ARE A BEHAVIOUR FIX, not a refactor. The old code built `new Date()`,
// zeroed its LOCAL hours, and compared that against `new Date(task.due_date)` - which parses a
// `YYYY-MM-DD` DATE column as UTC MIDNIGHT. West of Greenwich those are different days, so a
// task due today counted as overdue for a five-hour window every evening. Same defect CLAUDE.md
// records for the CRM. Everything here compares calendar dates in the business timezone.

import { businessDate } from './crm'
import { addDays, addMonths } from './calendar-grid'
import {
  DEFAULT_VIEW_CONFIG, UNASSIGNED,
  type FilterCondition, type SortRule, type ViewConfig,
} from './view-config'

export type BoardDateRange = 'all' | 'overdue' | 'today' | 'week' | 'month'

/** The board's own sort column names, kept so its headers do not have to be renamed. */
export type BoardSortColumn = 'title' | 'assigned' | 'priority' | 'dueDate'

export interface BoardSort {
  column: BoardSortColumn
  direction: 'asc' | 'desc'
}

const SORT_FIELD: Record<BoardSortColumn, SortRule['field']> = {
  title: 'title',
  assigned: 'assignee',
  priority: 'priority',
  dueDate: 'due_date',
}

export function boardSortToRules(sort: readonly BoardSort[]): SortRule[] {
  return sort.map((entry) => ({ field: SORT_FIELD[entry.column], direction: entry.direction }))
}

/**
 * The date-range chips, as calendar-date conditions.
 *
 * `overdue` carries a second condition rather than flipping the config's `completed` mode,
 * because the two mean different things: `completed: 'hide'` would apply to the whole view,
 * while "overdue" means specifically "past its date AND not finished". `is_not [completed,
 * cancelled]` is exactly what the old `getNormalizedTaskStatus(task) !== 'done'` tested, since
 * the done bucket covers both categories.
 */
export function dateRangeConditions(range: BoardDateRange, now: Date): FilterCondition[] {
  if (range === 'all') return []
  const today = businessDate(now)

  switch (range) {
    case 'overdue':
      return [
        { id: 'range', field: 'due_date', operator: 'before', values: [today] },
        { id: 'range-open', field: 'status_category', operator: 'is_not', values: ['completed', 'cancelled'] },
      ]
    case 'today':
      return [{ id: 'range', field: 'due_date', operator: 'between', values: [today, today] }]
    case 'week':
      return [{ id: 'range', field: 'due_date', operator: 'between', values: [today, addDays(today, 7)] }]
    case 'month':
      return [{ id: 'range', field: 'due_date', operator: 'between', values: [today, addMonths(today, 1)] }]
  }
}

export interface BoardFilterState {
  /** 'all' or a single user id. The board is single-select; the engine is not, so it widens. */
  user: string
  /** 'all' or a single priority as a string. */
  priority: string
  range: BoardDateRange
  search: string
  sort: readonly BoardSort[]
}

export function buildBoardConfig(state: BoardFilterState, now: Date): ViewConfig {
  const filters: FilterCondition[] = []

  if (state.user !== 'all') {
    filters.push({
      id: 'user',
      field: 'assignee',
      operator: 'is',
      // The board had no Unassigned option at all; reports did. Supporting the sentinel here
      // costs nothing and closes the gap the moment the board offers the chip.
      values: [state.user === UNASSIGNED ? UNASSIGNED : state.user],
    })
  }

  if (state.priority !== 'all') {
    filters.push({ id: 'priority', field: 'priority', operator: 'is', values: [state.priority] })
  }

  filters.push(...dateRangeConditions(state.range, now))

  return {
    ...DEFAULT_VIEW_CONFIG,
    layout: 'kanban',
    filters,
    filterJoin: 'and',
    search: state.search,
    sort: boardSortToRules(state.sort),
    // The board has already dropped subtasks and archived rows before this runs (boardTasks),
    // so re-filtering here would be a second, invisible authority over the same decision.
    hierarchy: 'flat',
  }
}

/** What the board's "N filters active" badge counts, unchanged in meaning. */
export function boardActiveFilterCount(state: BoardFilterState): number {
  return (
    (state.user !== 'all' ? 1 : 0) +
    (state.priority !== 'all' ? 1 : 0) +
    (state.range !== 'all' ? 1 : 0) +
    (state.search.trim() !== '' ? 1 : 0)
  )
}
