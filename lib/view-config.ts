// The view configuration model - one normalized config that every layout renders from.
//
// Prompt E's rule is three words: THE VIEW IS NOT THE DATA. A board, a list, a table and a
// calendar are four ways of drawing the same answer to the same question, and today they are
// four separate implementations of asking it:
//
//   board-view.tsx    filterUser ('all' | id), filterPriority, filterDateRange, searchTerm,
//                     sortConfig - filtered by an inline filterTasks()
//   reports-view.tsx  NINE useStates (user[], tags[], priority[], status[], board[], created
//                     from/to, due from/to) - filtered in a useEffect into a SECOND state
//   calendar-view.tsx no filters at all
//
// They do not agree. Reports offers Unassigned, the board does not. The board offers overdue,
// reports does not. Reports filters by tag and status, the board cannot. So the same question
// gives different answers on different screens, and nobody can carry one from A to B.
//
// This file is the single answer. It is PURE - no React, no Supabase, no dates read from the
// ambient clock - so every rule below is unit-testable and, more importantly, is the same rule
// wherever it runs.
//
// ──────────────────────────────────────────────────────────────────────────────────────
// FOUR DESIGN DECISIONS WORTH ARGUING WITH LATER
//
// 1. "current user" is a VALUE, not an operator, though Prompt E lists it beside `is` and
//    `before`. As an operator it can only express "assignee is me". As a value it composes:
//    `assignee is not @me`, `assignee is @me or Bob`, `created_by is @me` all fall out for
//    free, and the operator list stays orthogonal to the field list. Resolved at evaluation
//    time from the context, never baked into a saved view - otherwise a shared view would
//    silently mean "assigned to whoever saved it".
//
// 2. ONE ordered `fields` array, not `visibleFields` + `fieldOrder`. A field is visible iff it
//    is in the array, and its index is its order. Two arrays that must agree forever is the
//    same defect 115 refused for relations: they rot, and the failure is silent.
//
// 3. Descendant scope is `none | direct | all`, never a stored list of board ids. That is the
//    whole point of ATLAS_01 4.6: Vikunja users maintain the descendant list BY HAND, so a new
//    child project is invisible to the roll-up until someone edits the filter. Membership is
//    resolved from `boards.parent_board_id` at read time (see lib/board-hierarchy.ts), so a
//    board created a minute ago is already in its ancestors' views.
//
// 4. Dates are compared as CALENDAR DATES in an explicit zone, never parsed to an instant.
//    `due_date` is a DATE in Postgres and arrives as `YYYY-MM-DD`; `Date.parse('2026-08-14')`
//    resolves against the runtime's zone, which is UTC on the server and America/Chicago in the
//    browser, so a five-hour window every day would render "overdue" differently on each. This
//    already bit the CRM (recorded in CLAUDE.md) and it is the same trap here.

import { businessDate } from './crm'
import { getAssigneeIds } from './assignees'
import {
  getNormalizedTaskStatus,
  getTaskStatusCategory,
  type StatusCatalog,
  type StatusCategory,
} from './task-status'
import { DEFAULT_DENSITY, type Density } from '@/components/shell/density'

/* ── Vocabulary ────────────────────────────────────────────────────────────────────── */

/** The four layouts Prompt E names. Mirrored by 119's config validation trigger. */
export type Layout = 'list' | 'table' | 'kanban' | 'calendar'
export const LAYOUTS: readonly Layout[] = ['list', 'table', 'kanban', 'calendar'] as const

export const LAYOUT_LABELS: Record<Layout, string> = {
  list: 'List',
  table: 'Table',
  kanban: 'Board',
  calendar: 'Calendar',
}

/** How far below the scoped board(s) a view reaches. Never a stored id list - see note 3. */
export type DescendantScope = 'none' | 'direct' | 'all'
export const DESCENDANT_SCOPES: readonly DescendantScope[] = ['none', 'direct', 'all'] as const

export const DESCENDANT_LABELS: Record<DescendantScope, string> = {
  none: 'This board only',
  direct: 'This board and its direct children',
  all: 'This board and everything beneath it',
}

/**
 * ⚠️ These are the operators Prompt E lists, minus `current user` (see note 1). `between` is
 * kept distinct from a pair of before/after conditions because a range is one idea to a
 * reader, and a filter chip that says "due between Mon and Fri" is legible where two chips
 * joined by AND are not.
 */
export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'before'
  | 'after'
  | 'between'
  | 'empty'
  | 'not_empty'

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  before: 'before',
  after: 'after',
  between: 'between',
  empty: 'is empty',
  not_empty: 'is not empty',
}

/** The sentinel that means "whoever is looking". Resolved at evaluation time, never stored. */
export const CURRENT_USER = '@me'
/** The sentinel for "nobody is assigned". Reports had this; the board did not. Now both do. */
export const UNASSIGNED = '@unassigned'

export type FieldKind = 'text' | 'select' | 'date' | 'number'

export type FilterField =
  | 'title'
  | 'description'
  | 'assignee'
  | 'created_by'
  | 'priority'
  | 'status'
  | 'status_category'
  | 'board'
  | 'tag'
  | 'type'
  | 'due_date'
  | 'created_at'

/** Custom fields (114) filter as `custom:<field_key>`. */
export function customFilterField(fieldKey: string): string {
  return `custom:${fieldKey}`
}
export function parseCustomFilterField(field: string): string | null {
  return field.startsWith('custom:') ? field.slice('custom:'.length) : null
}

export interface FieldDescriptor {
  field: string
  label: string
  kind: FieldKind
  /** Operators that make sense here. A UI offering `before` on a priority is a UI lying. */
  operators: readonly FilterOperator[]
}

const TEXT_OPERATORS: readonly FilterOperator[] = [
  'contains', 'does_not_contain', 'is', 'is_not', 'empty', 'not_empty',
]
const SELECT_OPERATORS: readonly FilterOperator[] = ['is', 'is_not', 'empty', 'not_empty']
const DATE_OPERATORS: readonly FilterOperator[] = ['before', 'after', 'between', 'empty', 'not_empty']

export const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
  { field: 'title',           label: 'Title',        kind: 'text',   operators: TEXT_OPERATORS },
  { field: 'description',     label: 'Description',  kind: 'text',   operators: TEXT_OPERATORS },
  { field: 'assignee',        label: 'Assignee',     kind: 'select', operators: SELECT_OPERATORS },
  { field: 'created_by',      label: 'Created by',   kind: 'select', operators: SELECT_OPERATORS },
  { field: 'priority',        label: 'Priority',     kind: 'select', operators: SELECT_OPERATORS },
  { field: 'status',          label: 'Status',       kind: 'select', operators: SELECT_OPERATORS },
  { field: 'status_category', label: 'Status means', kind: 'select', operators: SELECT_OPERATORS },
  { field: 'board',           label: 'Board',        kind: 'select', operators: SELECT_OPERATORS },
  { field: 'tag',             label: 'Tag',          kind: 'select', operators: SELECT_OPERATORS },
  { field: 'type',            label: 'Work type',    kind: 'select', operators: SELECT_OPERATORS },
  { field: 'due_date',        label: 'Due date',     kind: 'date',   operators: DATE_OPERATORS },
  { field: 'created_at',      label: 'Created',      kind: 'date',   operators: DATE_OPERATORS },
] as const

export function describeField(field: string): FieldDescriptor | undefined {
  return FIELD_DESCRIPTORS.find((d) => d.field === field)
}

/** Operators legal for a field, including custom ones, whose kind the caller supplies. */
export function operatorsFor(field: string, customKind?: FieldKind): readonly FilterOperator[] {
  const known = describeField(field)
  if (known) return known.operators
  if (parseCustomFilterField(field)) {
    switch (customKind) {
      case 'date':   return DATE_OPERATORS
      case 'number': return ['is', 'is_not', 'before', 'after', 'between', 'empty', 'not_empty']
      case 'select': return SELECT_OPERATORS
      default:       return TEXT_OPERATORS
    }
  }
  return SELECT_OPERATORS
}

/** Whether an operator needs any value at all. `empty` taking values is a UI bug waiting. */
export function operatorTakesValues(operator: FilterOperator): boolean {
  return operator !== 'empty' && operator !== 'not_empty'
}

export function operatorValueCount(operator: FilterOperator): number {
  if (!operatorTakesValues(operator)) return 0
  return operator === 'between' ? 2 : Infinity
}

/* ── The config ────────────────────────────────────────────────────────────────────── */

export interface FilterCondition {
  id: string
  field: string
  operator: FilterOperator
  /**
   * For `is`/`is_not` these are alternatives (any match wins) - one condition, many values, so
   * "assignee is Ann or Bob" stays one legible chip. For `between` it is exactly [from, to].
   * For text operators the first entry is the needle.
   */
  values: string[]
}

export type FilterJoin = 'and' | 'or'

export type GroupField =
  | 'status' | 'status_category' | 'assignee' | 'created_by' | 'priority' | 'board' | 'tag'
  | 'type' | 'due_bucket'

export interface SortRule {
  field: 'title' | 'priority' | 'due_date' | 'created_at' | 'updated_at' | 'status' | 'assignee' | 'board' | 'position'
  direction: 'asc' | 'desc'
}

/** How a view treats parents and children. `nested` renders subtasks under their parent. */
export type HierarchyMode = 'flat' | 'nested' | 'parents_only'

/** Completed work is hidden by default on working views and shown on reporting ones. */
export type CompletedMode = 'show' | 'hide' | 'only'

export interface ViewConfig {
  layout: Layout
  /** Empty = every board the caller can see. */
  boardIds: string[]
  descendants: DescendantScope
  filters: FilterCondition[]
  filterJoin: FilterJoin
  /** Free-text box, kept out of `filters` so it can stay ephemeral while filters persist. */
  search: string
  sort: SortRule[]
  group: GroupField | null
  subgroup: GroupField | null
  /** Ordered. Membership = visible, index = position. See note 2. */
  fields: string[]
  density: Density
  hierarchy: HierarchyMode
  completed: CompletedMode
}

export const DEFAULT_FIELDS: string[] = [
  'title', 'assignee', 'status', 'priority', 'due_date', 'tag',
]

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  layout: 'kanban',
  boardIds: [],
  descendants: 'none',
  filters: [],
  filterJoin: 'and',
  search: '',
  sort: [],
  group: null,
  subgroup: null,
  fields: DEFAULT_FIELDS,
  density: DEFAULT_DENSITY,
  hierarchy: 'parents_only',
  completed: 'show',
}

/**
 * Parse anything (a jsonb blob from saved_views, a URL param, a hand-edited row) into a config
 * that is safe to render. Unknown values fall back to the default rather than throwing: a view
 * saved by a newer build must degrade, not white-screen. 119's trigger guards the shape the
 * renderer cannot survive without; this guards everything else.
 */
export function normalizeViewConfig(raw: unknown): ViewConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback

  return {
    layout: pick(input.layout, LAYOUTS, DEFAULT_VIEW_CONFIG.layout),
    boardIds: Array.isArray(input.boardIds) ? input.boardIds.filter((b): b is string => typeof b === 'string') : [],
    descendants: pick(input.descendants, DESCENDANT_SCOPES, DEFAULT_VIEW_CONFIG.descendants),
    filters: normalizeFilters(input.filters),
    filterJoin: pick(input.filterJoin, ['and', 'or'] as const, DEFAULT_VIEW_CONFIG.filterJoin),
    search: typeof input.search === 'string' ? input.search : '',
    sort: normalizeSort(input.sort),
    group: normalizeGroup(input.group),
    subgroup: normalizeGroup(input.subgroup),
    fields: Array.isArray(input.fields) && input.fields.length
      ? input.fields.filter((f): f is string => typeof f === 'string')
      : DEFAULT_FIELDS,
    density: pick(input.density, ['compact', 'comfortable', 'expanded'] as const, DEFAULT_VIEW_CONFIG.density),
    hierarchy: pick(input.hierarchy, ['flat', 'nested', 'parents_only'] as const, DEFAULT_VIEW_CONFIG.hierarchy),
    completed: pick(input.completed, ['show', 'hide', 'only'] as const, DEFAULT_VIEW_CONFIG.completed),
  }
}

const GROUP_FIELDS: readonly GroupField[] = [
  'status', 'status_category', 'assignee', 'created_by', 'priority', 'board', 'tag', 'type',
  'due_bucket',
]

function normalizeGroup(value: unknown): GroupField | null {
  return GROUP_FIELDS.includes(value as GroupField) ? (value as GroupField) : null
}

const SORT_FIELDS: readonly SortRule['field'][] = [
  'title', 'priority', 'due_date', 'created_at', 'updated_at', 'status', 'assignee', 'board', 'position',
]

function normalizeSort(value: unknown): SortRule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { field, direction } = entry as Record<string, unknown>
    if (!SORT_FIELDS.includes(field as SortRule['field'])) return []
    return [{
      field: field as SortRule['field'],
      direction: direction === 'desc' ? 'desc' as const : 'asc' as const,
    }]
  })
}

const OPERATORS: readonly FilterOperator[] = [
  'is', 'is_not', 'contains', 'does_not_contain', 'before', 'after', 'between', 'empty', 'not_empty',
]

function normalizeFilters(value: unknown): FilterCondition[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const { id, field, operator, values } = entry as Record<string, unknown>
    if (typeof field !== 'string' || !field) return []
    if (!OPERATORS.includes(operator as FilterOperator)) return []
    return [{
      id: typeof id === 'string' && id ? id : `f${index}`,
      field,
      operator: operator as FilterOperator,
      values: Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [],
    }]
  })
}

/**
 * A condition with no value on an operator that needs one matches everything, which reads to a
 * user as "my filter did nothing". The builder keeps such rows so they can be finished; the
 * evaluator skips them; and `incompleteFilters` lets the UI say so out loud rather than leaving
 * someone to wonder whether the filter is broken (ATLAS_01 10.2).
 */
export function isFilterComplete(condition: FilterCondition): boolean {
  if (!operatorTakesValues(condition.operator)) return true
  if (condition.operator === 'between') {
    return condition.values.length === 2 && condition.values.every((v) => v !== '')
  }
  return condition.values.some((v) => v !== '')
}

export function incompleteFilters(config: ViewConfig): FilterCondition[] {
  return config.filters.filter((c) => !isFilterComplete(c))
}

/** What the UI shows as "N filters active" - only the ones actually doing something. */
export function activeFilterCount(config: ViewConfig): number {
  return config.filters.filter(isFilterComplete).length + (config.search.trim() ? 1 : 0)
}

/* ── Evaluation ────────────────────────────────────────────────────────────────────── */

export interface EvalContext {
  /** Resolves CURRENT_USER. Null when signed out, which makes `@me` match nothing. */
  currentUserId: string | null
  /** The FULL status list, never a filtered one - see lib/crm.ts's note on lookups. */
  statuses?: StatusCatalog
  users?: any[]
  boards?: any[]
  /** The instant "today" means. Passed in, never read from the clock - see note 4. */
  now: Date
  /** Custom field values as `{ [taskId]: { [fieldKey]: value } }`, when custom filters are used. */
  customValues?: Record<string, Record<string, unknown>>
}

function resolveValues(values: string[], ctx: EvalContext): string[] {
  return values.map((v) => (v === CURRENT_USER ? (ctx.currentUserId ?? '\0none') : v))
}

function asText(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

/** Calendar date of a task field in the business zone, or null. Never an instant. */
function calendarDateOf(value: unknown, ctx: EvalContext): string | null {
  if (value == null || value === '') return null
  const raw = String(value)
  // A DATE column arrives as YYYY-MM-DD and is already a calendar date - do not re-zone it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return businessDate(parsed)
}

function taskTagIds(task: any): string[] {
  const tags = task?.task_tags
  if (!Array.isArray(tags)) return []
  return tags.map((tt: any) => tt?.tag?.id ?? tt?.tag_id).filter(Boolean)
}

function taskTagNames(task: any): string[] {
  const tags = task?.task_tags
  if (!Array.isArray(tags)) return []
  return tags.map((tt: any) => tt?.tag?.name).filter(Boolean)
}

/**
 * The raw value(s) a field holds on a task. Returns an array because several fields are
 * genuinely multi-valued (assignees, tags), and collapsing them to a string is how
 * "assignee is Ann" silently stops matching a task Ann shares with Bob.
 */
export function fieldValues(task: any, field: string, ctx: EvalContext): string[] {
  const customKey = parseCustomFilterField(field)
  if (customKey) {
    const value = ctx.customValues?.[task?.id]?.[customKey]
    if (value == null || value === '') return []
    return Array.isArray(value) ? value.map(asText) : [asText(value)]
  }

  switch (field) {
    case 'title':       return task?.title ? [String(task.title)] : []
    case 'description': return task?.description ? [String(task.description)] : []
    case 'assignee':    return getAssigneeIds(task)
    case 'created_by':  return task?.created_by ? [String(task.created_by)] : []
    case 'priority':    return task?.priority == null ? [] : [String(task.priority)]
    case 'status': {
      const key = task?.column?.status_key || task?.status
      return key ? [String(key)] : []
    }
    case 'status_category': {
      const category = getTaskStatusCategory(task, ctx.statuses)
      return category ? [category] : []
    }
    case 'board':       return task?.board_id ? [String(task.board_id)] : []
    case 'tag':         return taskTagIds(task)
    case 'type':        return task?.type_key ? [String(task.type_key)] : []
    case 'due_date': {
      const d = calendarDateOf(task?.due_date, ctx)
      return d ? [d] : []
    }
    case 'created_at': {
      const d = calendarDateOf(task?.created_at, ctx)
      return d ? [d] : []
    }
    default: return []
  }
}

/** Text a `contains` search should look through for a field. */
function searchableText(task: any, field: string, ctx: EvalContext): string {
  if (field === 'tag') return taskTagNames(task).join(' ')
  if (field === 'assignee') {
    const ids = getAssigneeIds(task)
    const names = (ctx.users ?? []).filter((u) => ids.includes(u?.id)).map((u) => u?.full_name || u?.email || '')
    return names.join(' ')
  }
  return fieldValues(task, field, ctx).join(' ')
}

export function evaluateCondition(task: any, condition: FilterCondition, ctx: EvalContext): boolean {
  if (!isFilterComplete(condition)) return true  // an unfinished filter constrains nothing

  const present = fieldValues(task, condition.field, ctx)
  const wanted = resolveValues(condition.values, ctx).filter((v) => v !== '')

  switch (condition.operator) {
    case 'empty':     return present.length === 0
    case 'not_empty': return present.length > 0

    case 'is':
    case 'is_not': {
      // UNASSIGNED is "this field holds nothing", which is a different question from
      // "this field holds the string @unassigned" - reports got this right, the board had no
      // concept of it at all.
      const wantsEmpty = wanted.includes(UNASSIGNED)
      const concrete = wanted.filter((v) => v !== UNASSIGNED)
      const matched =
        (wantsEmpty && present.length === 0) ||
        present.some((p) => concrete.includes(p))
      return condition.operator === 'is' ? matched : !matched
    }

    case 'contains':
    case 'does_not_contain': {
      const haystack = searchableText(task, condition.field, ctx).toLowerCase()
      const found = wanted.some((needle) => haystack.includes(needle.toLowerCase()))
      return condition.operator === 'contains' ? found : !found
    }

    case 'before':
    case 'after':
    case 'between': {
      const [value] = present
      if (value == null) return false  // no date cannot be before or after one
      // YYYY-MM-DD sorts lexicographically, which is why calendarDateOf normalizes to it.
      if (condition.operator === 'before')  return value < wanted[0]
      if (condition.operator === 'after')   return value > wanted[0]
      const [from, to] = wanted[0] <= wanted[1] ? [wanted[0], wanted[1]] : [wanted[1], wanted[0]]
      return value >= from && value <= to
    }

    default: return true
  }
}

/** Whether a task survives the config's completed-work rule. */
export function passesCompletedMode(task: any, config: ViewConfig, ctx: EvalContext): boolean {
  if (config.completed === 'show') return true
  const done = getNormalizedTaskStatus(task, ctx.statuses) === 'done'
  return config.completed === 'only' ? done : !done
}

function matchesSearch(task: any, search: string, ctx: EvalContext): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  const title = asText(task?.title).toLowerCase()
  const description = asText(task?.description).toLowerCase()
  return title.includes(needle) || description.includes(needle)
}

/**
 * The one filter implementation. Every layout calls this, so a question asked on the board and
 * the same question asked in reports cannot give different answers.
 */
export function applyFilters<T = any>(tasks: T[], config: ViewConfig, ctx: EvalContext): T[] {
  const complete = config.filters.filter(isFilterComplete)

  return tasks.filter((task) => {
    if (!passesCompletedMode(task, config, ctx)) return false
    if (!matchesSearch(task, config.search, ctx)) return false
    if (complete.length === 0) return true

    return config.filterJoin === 'or'
      ? complete.some((c) => evaluateCondition(task, c, ctx))
      : complete.every((c) => evaluateCondition(task, c, ctx))
  })
}

/* ── Sort ──────────────────────────────────────────────────────────────────────────── */

function sortKey(task: any, field: SortRule['field'], ctx: EvalContext): string | number {
  switch (field) {
    case 'title':    return asText(task?.title).toLowerCase()
    // Priority is 1 = highest, so ascending priority means most-urgent-first, which is what a
    // reader expects from "sort by priority". Missing priority sorts last, not first.
    case 'priority': return task?.priority == null ? Number.MAX_SAFE_INTEGER : Number(task.priority)
    case 'due_date': {
      const d = calendarDateOf(task?.due_date, ctx)
      // No due date sorts LAST in both directions would need a stable partition; instead it
      // sorts after every real date ascending, which is the useful default: undated work is
      // not the most urgent thing you own.
      return d ?? '9999-12-31'
    }
    case 'created_at': return asText(task?.created_at)
    case 'updated_at': return asText(task?.updated_at ?? task?.created_at)
    case 'status':     return asText(task?.column?.status_key ?? task?.status)
    case 'assignee': {
      const [first] = getAssigneeIds(task)
      if (!first) return '￿'  // unassigned last
      const user = (ctx.users ?? []).find((u) => u?.id === first)
      return asText(user?.full_name || user?.email || first).toLowerCase()
    }
    case 'board': {
      const board = (ctx.boards ?? []).find((b) => b?.id === task?.board_id)
      return asText(board?.title ?? task?.board_id).toLowerCase()
    }
    case 'position': return Number(task?.position ?? 0)
    default: return 0
  }
}

export function applySort<T = any>(tasks: T[], config: ViewConfig, ctx: EvalContext): T[] {
  if (config.sort.length === 0) return tasks
  return [...tasks].sort((a, b) => {
    for (const { field, direction } of config.sort) {
      const ka = sortKey(a, field, ctx)
      const kb = sortKey(b, field, ctx)
      let comparison = 0
      if (typeof ka === 'number' && typeof kb === 'number') comparison = ka - kb
      else comparison = String(ka).localeCompare(String(kb))
      if (comparison !== 0) return direction === 'asc' ? comparison : -comparison
    }
    return 0
  })
}

/* ── Group ─────────────────────────────────────────────────────────────────────────── */

export interface ViewGroup<T = any> {
  key: string
  label: string
  tasks: T[]
}

const DUE_BUCKET_ORDER = ['overdue', 'today', 'week', 'later', 'none'] as const
const DUE_BUCKET_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due this week',
  later: 'Later',
  none: 'No due date',
}

function dueBucket(task: any, ctx: EvalContext): string {
  const due = calendarDateOf(task?.due_date, ctx)
  if (!due) return 'none'
  const today = businessDate(ctx.now)
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  const weekOut = new Date(ctx.now)
  weekOut.setDate(weekOut.getDate() + 7)
  return due <= businessDate(weekOut) ? 'week' : 'later'
}

function groupKeysFor(task: any, field: GroupField, ctx: EvalContext): string[] {
  if (field === 'due_bucket') return [dueBucket(task, ctx)]
  const values = fieldValues(task, field, ctx)
  return values.length ? values : ['__none__']
}

function groupLabel(field: GroupField, key: string, ctx: EvalContext): string {
  if (key === '__none__') {
    return field === 'assignee' ? 'Unassigned' : 'None'
  }
  if (field === 'due_bucket') return DUE_BUCKET_LABELS[key] ?? key
  if (field === 'assignee' || field === 'created_by') {
    const user = (ctx.users ?? []).find((u) => u?.id === key)
    return user?.full_name || user?.email || 'Unknown person'
  }
  if (field === 'board') {
    const board = (ctx.boards ?? []).find((b) => b?.id === key)
    return board?.title ?? 'Unknown board'
  }
  if (field === 'status') {
    const status = (ctx.statuses ?? []).find((s: any) => s?.key === key)
    return (status as any)?.label ?? key
  }
  if (field === 'priority') {
    return ({ '1': '1 - Highest', '2': '2 - High', '3': '3 - Medium', '4': '4 - Low', '5': '5 - Lowest' } as Record<string, string>)[key] ?? key
  }
  return key
}

/**
 * ⚠️ A task with two tags appears under BOTH tags, and that is correct rather than a bug - but
 * it means the group counts sum to more than the task count, so any UI showing a total must
 * take it from the ungrouped list. Named here because the alternative (picking one tag) hides
 * work from a group the user explicitly asked to see.
 */
export function applyGrouping<T = any>(tasks: T[], field: GroupField | null, ctx: EvalContext): ViewGroup<T>[] {
  if (!field) return [{ key: '__all__', label: 'All', tasks }]

  const buckets = new Map<string, T[]>()
  for (const task of tasks) {
    for (const key of groupKeysFor(task, field, ctx)) {
      const existing = buckets.get(key)
      if (existing) existing.push(task)
      else buckets.set(key, [task])
    }
  }

  const keys = [...buckets.keys()]
  if (field === 'due_bucket') {
    keys.sort((a, b) => DUE_BUCKET_ORDER.indexOf(a as any) - DUE_BUCKET_ORDER.indexOf(b as any))
  } else if (field === 'status') {
    const order = (ctx.statuses ?? []).map((s: any) => s?.key)
    keys.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  } else {
    keys.sort((a, b) => {
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      return groupLabel(field, a, ctx).localeCompare(groupLabel(field, b, ctx))
    })
  }

  return keys.map((key) => ({ key, label: groupLabel(field, key, ctx), tasks: buckets.get(key)! }))
}

/* ── Hierarchy ─────────────────────────────────────────────────────────────────────── */

/**
 * `parents_only` is the board's long-standing behaviour and the reason CLAUDE.md warns that
 * board queries need `WHERE parent_task_id IS NULL` - without it subtasks render as loose
 * cards. It is preserved as the DEFAULT so switching a board to this engine changes nothing.
 */
export function applyHierarchy<T = any>(tasks: T[], mode: HierarchyMode): T[] {
  if (mode === 'flat') return tasks
  return tasks.filter((t: any) => !t?.parent_task_id)
}

/* ── The whole pipeline ────────────────────────────────────────────────────────────── */

export interface ViewResult<T = any> {
  /** Everything that survived filtering, before grouping. Take counts from here. */
  tasks: T[]
  groups: ViewGroup<T>[]
  /** Rows removed by the config, so a view can say "12 hidden by filters" instead of nothing. */
  hiddenCount: number
}

export function runView<T = any>(tasks: T[], config: ViewConfig, ctx: EvalContext): ViewResult<T> {
  const scoped = applyHierarchy(tasks, config.hierarchy)
  const filtered = applyFilters(scoped, config, ctx)
  const sorted = applySort(filtered, config, ctx)
  return {
    tasks: sorted,
    groups: applyGrouping(sorted, config.group, ctx),
    hiddenCount: scoped.length - filtered.length,
  }
}

/* ── Describing a config in words ──────────────────────────────────────────────────── */

/**
 * ATLAS_01 10.2: never leave a user wondering whether something is broken, disabled or just
 * filtered. A view that quietly shows 3 of 40 tasks looks broken; one that says why does not.
 */
export function describeFilter(
  condition: FilterCondition,
  ctx: EvalContext,
  labelForValue?: (field: string, value: string) => string,
): string {
  const descriptor = describeField(condition.field)
  const fieldLabel = descriptor?.label ?? parseCustomFilterField(condition.field) ?? condition.field
  const op = OPERATOR_LABELS[condition.operator]

  if (!operatorTakesValues(condition.operator)) return `${fieldLabel} ${op}`

  const rendered = condition.values.map((v) => {
    if (v === CURRENT_USER) return 'me'
    if (v === UNASSIGNED) return 'nobody'
    return labelForValue?.(condition.field, v) ?? v
  })

  if (condition.operator === 'between') return `${fieldLabel} ${op} ${rendered[0]} and ${rendered[1]}`
  return `${fieldLabel} ${op} ${rendered.join(' or ')}`
}

export function describeView(config: ViewConfig): string {
  const parts: string[] = [LAYOUT_LABELS[config.layout]]
  if (config.descendants !== 'none') parts.push(DESCENDANT_LABELS[config.descendants].toLowerCase())
  const active = activeFilterCount(config)
  if (active) parts.push(`${active} filter${active === 1 ? '' : 's'}`)
  if (config.group) parts.push(`grouped by ${config.group.replace('_', ' ')}`)
  if (config.completed === 'hide') parts.push('completed work hidden')
  if (config.completed === 'only') parts.push('completed work only')
  return parts.join(', ')
}

/** Structural equality, so "unsaved changes" on a view is a fact rather than a guess. */
export function configsEqual(a: ViewConfig, b: ViewConfig): boolean {
  return JSON.stringify(serializeViewConfig(a)) === JSON.stringify(serializeViewConfig(b))
}

/**
 * What actually lands in `saved_views.config`. `search` is deliberately EXCLUDED: a free-text
 * box is what you are doing this minute, not how you like to look at work, and saving it means
 * every reopen of the view starts pre-filtered by a word someone typed once.
 */
export function serializeViewConfig(config: ViewConfig): Record<string, unknown> {
  return {
    layout: config.layout,
    boardIds: [...config.boardIds].sort(),
    descendants: config.descendants,
    filters: config.filters.filter(isFilterComplete).map((c) => ({
      id: c.id, field: c.field, operator: c.operator, values: c.values,
    })),
    filterJoin: config.filterJoin,
    sort: config.sort,
    group: config.group,
    subgroup: config.subgroup,
    fields: config.fields,
    density: config.density,
    hierarchy: config.hierarchy,
    completed: config.completed,
  }
}
