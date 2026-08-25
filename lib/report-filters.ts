// Translating the Reports screen's filter chips into the shared view config.
//
// Pure, and in lib/ rather than beside the component, for the same reason lib/teams.ts and
// lib/my-work.ts are: the mapping is where the meaning lives, and a meaning nobody can test is
// a meaning nobody should trust.

import {
  DEFAULT_VIEW_CONFIG, UNASSIGNED,
  type FilterCondition, type ViewConfig,
} from './view-config'

export const UNASSIGNED_FILTER_VALUE = '__unassigned__'

// Widest representable calendar dates, used to turn a one-ended "From"/"To" into the engine's
// `between`. See the note on buildReportConfig below.
const FIRST_DATE = '0001-01-01'
const LAST_DATE = '9999-12-31'

/** `YYYY-MM-DD` from a picker's Date, read in LOCAL parts - the picker returns local midnight. */
export function pickerDate(value: Date | undefined): string | undefined {
  if (!value) return undefined
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

/**
 * Translate this screen's chip state into the shared view config.
 *
 * ⚠️ This screen used to carry its OWN filter implementation - nine `useState`s reduced by a
 * hand-written `applyFilters()` inside a `useEffect` that wrote into a second state. It did not
 * agree with the board's: reports offered Unassigned and the board did not, the board offered
 * "overdue" and reports did not, and the two answered "filter by assignee" with different code.
 * The chip UI is kept exactly as it was - it is good, and people know it - but the ANSWER now
 * comes from lib/view-config.ts, so the same question asked here and on a board cannot differ.
 *
 * Two deliberate differences from the code this replaces:
 *
 *  1. A one-ended range becomes a `between` against the widest representable date rather than a
 *     new operator. The chips are labelled "From" and "To", which are INCLUSIVE by convention,
 *     and `between` is inclusive at both ends; `before`/`after` are exclusive, so mapping onto
 *     them would silently drop work due on exactly the boundary date somebody picked.
 *
 *  2. Dates are compared as CALENDAR DATES, not instants. The old code did
 *     `new Date(task.due_date) >= dateFrom`, which parses a `YYYY-MM-DD` DATE column as UTC
 *     midnight and compares it against the picker's LOCAL midnight - so a task due on the
 *     boundary date fell in or out depending on the reader's timezone. That is the same defect
 *     CLAUDE.md records for the CRM, and this is a fix, not a refactor.
 */
export function buildReportConfig(input: {
  users: string[]
  tags: string[]
  priorities: string[]
  statuses: string[]
  boards: string[]
  createdFrom?: string
  createdTo?: string
  dueFrom?: string
  dueTo?: string
}): ViewConfig {
  const filters: FilterCondition[] = []
  const add = (id: string, field: string, values: string[]) => {
    if (values.length) filters.push({ id, field, operator: 'is', values })
  }

  add('user', 'assignee', input.users.map((v) => (v === UNASSIGNED_FILTER_VALUE ? UNASSIGNED : v)))
  add('tag', 'tag', input.tags)
  add('priority', 'priority', input.priorities)
  add('status', 'status', input.statuses)
  add('board', 'board', input.boards)

  if (input.createdFrom || input.createdTo) {
    filters.push({
      id: 'created', field: 'created_at', operator: 'between',
      values: [input.createdFrom ?? FIRST_DATE, input.createdTo ?? LAST_DATE],
    })
  }
  if (input.dueFrom || input.dueTo) {
    filters.push({
      id: 'due', field: 'due_date', operator: 'between',
      values: [input.dueFrom ?? FIRST_DATE, input.dueTo ?? LAST_DATE],
    })
  }

  // `flat` because a report counts every task, subtasks included - narrowing to parents here
  // would quietly under-report every total on the screen.
  return { ...DEFAULT_VIEW_CONFIG, layout: 'list', hierarchy: 'flat', filters, filterJoin: 'and' }
}
