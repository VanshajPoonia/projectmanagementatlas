// Optional agile mode: the pure vocabulary, capacity, WIP and window logic.
//
// Prompt G opens with "this module must be optional" and "do not force Scrum language on
// marketing / contracting / real estate / finance / operations". Both of those are decisions
// this file makes concrete: nothing here assumes the word "sprint", every noun comes from the
// board's own setting, and every function is a no-op-shaped answer when agile is off.
//
// No React, no Supabase, no dates-as-instants. Sprint windows are calendar DATE strings
// (`YYYY-MM-DD`, migration 123) and are compared as calendar days through lib/calendar-grid.ts,
// never parsed into a Date and compared against `now`. That is not stylistic - this repo has
// shipped the same off-by-one-day bug five separate times by resolving a stored day through a
// timezone, and a sprint that ends "tomorrow" for one reader and "today" for another makes
// every burndown disagree with the board beside it.

import { addDays, daysBetween } from './calendar-grid'
import type { StatusCatalog } from './task-status'
import { getTaskStatusCategory, isClosedCategory } from './task-status'

// ---------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------

/** One underlying model; the board picks the noun. Migration 123's `terminology` CHECK. */
export type Terminology = 'sprint' | 'cycle' | 'iteration'
export const TERMINOLOGIES: readonly Terminology[] = ['sprint', 'cycle', 'iteration'] as const

/**
 * The unit an estimate is counted in. Deliberately a board setting rather than part of the
 * column name: `tasks.estimate_value` carries no unit, so a board that switches from points
 * to hours needs no data migration and no column name can contradict the configuration.
 */
export type EstimateUnit = 'points' | 'hours' | 'days'
export const ESTIMATE_UNITS: readonly EstimateUnit[] = ['points', 'hours', 'days'] as const

/** Prompt G: "Mode: warning | enforcement." Warning is the default, for both capacity and WIP. */
export type EnforcementMode = 'warning' | 'enforcement'
export const ENFORCEMENT_MODES: readonly EnforcementMode[] = ['warning', 'enforcement'] as const

export type SprintState = 'planned' | 'active' | 'completed' | 'cancelled'
export const SPRINT_STATES: readonly SprintState[] = ['planned', 'active', 'completed', 'cancelled'] as const

export const SPRINT_STATE_LABELS: Record<SprintState, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const NOUNS: Record<Terminology, { one: string; many: string }> = {
  sprint: { one: 'sprint', many: 'sprints' },
  cycle: { one: 'cycle', many: 'cycles' },
  iteration: { one: 'iteration', many: 'iterations' },
}

/** The singular noun this board uses, lower case: "sprint" | "cycle" | "iteration". */
export function sprintNoun(term: Terminology): string {
  return NOUNS[term]?.one ?? NOUNS.sprint.one
}

export function sprintNounPlural(term: Terminology): string {
  return NOUNS[term]?.many ?? NOUNS.sprint.many
}

/** Title case, for headings and buttons. */
export function sprintNounTitle(term: Terminology): string {
  const noun = sprintNoun(term)
  return noun.charAt(0).toUpperCase() + noun.slice(1)
}

export function sprintNounPluralTitle(term: Terminology): string {
  const noun = sprintNounPlural(term)
  return noun.charAt(0).toUpperCase() + noun.slice(1)
}

const UNIT_NOUNS: Record<EstimateUnit, { one: string; many: string }> = {
  points: { one: 'point', many: 'points' },
  hours: { one: 'hour', many: 'hours' },
  days: { one: 'day', many: 'days' },
}

export function estimateUnitLabel(unit: EstimateUnit, value: number): string {
  const nouns = UNIT_NOUNS[unit] ?? UNIT_NOUNS.points
  return value === 1 ? nouns.one : nouns.many
}

/**
 * Format an estimate for display. Trailing `.00` is dropped because "8 points" reads as a
 * size and "8.00 points" reads as a measurement, and these are estimates.
 */
export function formatEstimate(value: number | null | undefined, unit: EstimateUnit): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'No estimate'
  const n = Number(value)
  const text = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
  return `${text} ${estimateUnitLabel(unit, n)}`
}

// ---------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------

export interface AgileSettings {
  board_id: string
  is_enabled: boolean
  terminology: Terminology
  estimate_unit: EstimateUnit
  capacity_mode: EnforcementMode
  wip_mode: EnforcementMode
}

/**
 * What a board with NO settings row means.
 *
 * ⚠️ Absence here is a fact, not a hidden row: `board_agile_settings`' SELECT policy shows the
 * row to anyone who can see the board, so a caller who can read the board and gets nothing back
 * genuinely has no settings. That is the one thing worth stating, because "hidden from you" and
 * "does not exist" arriving identical is the shape behind several bugs in this repo - here they
 * cannot, because the settings row is never narrower than the board itself.
 */
export function defaultAgileSettings(boardId: string): AgileSettings {
  return {
    board_id: boardId,
    is_enabled: false,
    terminology: 'sprint',
    estimate_unit: 'points',
    capacity_mode: 'warning',
    wip_mode: 'warning',
  }
}

const oneOf = <T extends string>(allowed: readonly T[], raw: unknown, fallback: T): T =>
  allowed.includes(raw as T) ? (raw as T) : fallback

/** Coerce a row from the database (or a stale cache) into a shape the UI can render. */
export function normalizeAgileSettings(boardId: string, raw: any): AgileSettings {
  if (!raw) return defaultAgileSettings(boardId)
  return {
    board_id: raw.board_id ?? boardId,
    is_enabled: Boolean(raw.is_enabled),
    terminology: oneOf(TERMINOLOGIES, raw.terminology, 'sprint'),
    estimate_unit: oneOf(ESTIMATE_UNITS, raw.estimate_unit, 'points'),
    capacity_mode: oneOf(ENFORCEMENT_MODES, raw.capacity_mode, 'warning'),
    wip_mode: oneOf(ENFORCEMENT_MODES, raw.wip_mode, 'warning'),
  }
}

/** Agile is on for this board only when the module is on AND the board opted in. */
export function agileActive(moduleEnabled: boolean, settings: AgileSettings | null | undefined): boolean {
  return Boolean(moduleEnabled && settings?.is_enabled)
}

// ---------------------------------------------------------------------------------------
// The sprint window
// ---------------------------------------------------------------------------------------

export interface SprintLike {
  id: string
  title: string
  goal?: string | null
  start_date: string
  end_date: string
  state: SprintState
  capacity?: number | null
  owner_id?: string | null
}

export type SprintPhase = 'upcoming' | 'running' | 'ended'

/**
 * Where today sits relative to the window - a pure calendar-day comparison of three
 * `YYYY-MM-DD` strings, so it gives the same answer in Chicago, UTC and Auckland.
 *
 * Note this describes the DATES, not the STATE: a sprint can be `planned` while its start date
 * has passed (nobody pressed start), and that gap is exactly what the planning screen needs to
 * point at. Never infer one from the other.
 */
export function sprintPhase(sprint: Pick<SprintLike, 'start_date' | 'end_date'>, today: string): SprintPhase {
  if (today < sprint.start_date) return 'upcoming'
  if (today > sprint.end_date) return 'ended'
  return 'running'
}

export interface SprintWindow {
  totalDays: number
  elapsedDays: number
  remainingDays: number
  phase: SprintPhase
}

/** Inclusive of both ends: a one-day sprint is one day long, not zero. */
export function sprintWindow(sprint: Pick<SprintLike, 'start_date' | 'end_date'>, today: string): SprintWindow {
  const totalDays = daysBetween(sprint.start_date, sprint.end_date) + 1
  const phase = sprintPhase(sprint, today)
  const elapsedRaw = daysBetween(sprint.start_date, today) + 1
  const elapsedDays = Math.max(0, Math.min(totalDays, elapsedRaw))
  return { totalDays, elapsedDays, remainingDays: Math.max(0, totalDays - elapsedDays), phase }
}

/** Every calendar day in the window, for a burndown's x-axis. Bounded so a mis-entered range cannot hang the page. */
export function sprintDays(sprint: Pick<SprintLike, 'start_date' | 'end_date'>, max = 400): string[] {
  const total = Math.min(daysBetween(sprint.start_date, sprint.end_date) + 1, max)
  const out: string[] = []
  for (let i = 0; i < total; i++) out.push(addDays(sprint.start_date, i))
  return out
}

/**
 * Which sprint a board screen should open on.
 *
 * The active one, else the next upcoming by start date, else the most recently ended. The
 * fallback order matters: opening on the oldest completed sprint because it sorted first is
 * the same defect as the marketing calendar opening on "Kayla's Personal" because of the
 * alphabet.
 */
export function defaultSprint<T extends SprintLike>(sprints: T[], today: string): T | null {
  const active = sprints.find((s) => s.state === 'active')
  if (active) return active
  const upcoming = sprints
    .filter((s) => s.state === 'planned' && s.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  if (upcoming.length) return upcoming[0]
  const past = sprints
    .filter((s) => s.state === 'completed')
    .sort((a, b) => b.end_date.localeCompare(a.end_date))
  if (past.length) return past[0]
  return sprints[0] ?? null
}

/** Why a state transition is unavailable, in the words the button should use. */
export function startBlockedReason<T extends SprintLike>(sprint: T, all: T[]): string | null {
  if (sprint.state === 'active') return 'It is already running.'
  if (sprint.state === 'completed' || sprint.state === 'cancelled') {
    return `A ${sprint.state} ${sprintNoun('sprint')} cannot be reopened - its recorded numbers describe a window that has closed.`
  }
  const other = all.find((s) => s.id !== sprint.id && s.state === 'active')
  if (other) return `"${other.title}" is already running. Finish it first - two at once makes "the current commitment" ambiguous.`
  return null
}

// ---------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------

export type CapacityState = 'undeclared' | 'under' | 'at' | 'over'

export interface CapacityStatus {
  state: CapacityState
  planned: number
  capacity: number | null
  /** Members with no estimate. They contribute zero, so a plan can look under capacity purely by being unestimated. */
  unestimated: number
  over: number
  /** Whether the UI should refuse the add, per the board's capacity_mode. */
  blocks: boolean
  message: string
}

/**
 * Prompt G: "Warn when over capacity. Do not block by default unless configured."
 *
 * ⚠️ `unestimated` is surfaced rather than folded in. Treating an unestimated item as zero is
 * how a plan reads "12 of 20 points" while carrying six items nobody has sized - the warning
 * says "under capacity" and it is wrong. Counting it as some average would be worse: it would
 * invent a number and then be used to plan against.
 */
export function capacityStatus(input: {
  planned: number
  capacity: number | null | undefined
  unestimated: number
  unit: EstimateUnit
  mode: EnforcementMode
}): CapacityStatus {
  const { planned, unestimated, unit, mode } = input
  const capacity = input.capacity ?? null
  const base = { planned, capacity, unestimated, over: 0, blocks: false }

  if (capacity === null || capacity <= 0) {
    return {
      ...base,
      state: 'undeclared',
      message: unestimated > 0
        ? `No capacity set. ${unestimated} item${unestimated === 1 ? '' : 's'} carry no estimate.`
        : 'No capacity set for this window.',
    }
  }

  const over = Number((planned - capacity).toFixed(2))
  const unestimatedNote = unestimated > 0
    ? ` ${unestimated} item${unestimated === 1 ? ' carries' : 's carry'} no estimate and count as zero here.`
    : ''

  if (over > 0) {
    return {
      ...base,
      state: 'over',
      over,
      blocks: mode === 'enforcement',
      message: `${formatEstimate(over, unit)} over capacity (${formatEstimate(planned, unit)} planned against ${formatEstimate(capacity, unit)}).${unestimatedNote}`,
    }
  }
  if (over === 0) {
    return { ...base, state: 'at', message: `Exactly at capacity (${formatEstimate(capacity, unit)}).${unestimatedNote}` }
  }
  return {
    ...base,
    state: 'under',
    message: `${formatEstimate(Math.abs(over), unit)} of capacity left (${formatEstimate(planned, unit)} of ${formatEstimate(capacity, unit)}).${unestimatedNote}`,
  }
}

// ---------------------------------------------------------------------------------------
// WIP
// ---------------------------------------------------------------------------------------

export type WipState = 'none' | 'under' | 'at' | 'over'

export interface WipStatus {
  state: WipState
  count: number
  limit: number | null
  /** True only when the DATABASE will refuse the move (migration 125), never on the UI's own opinion. */
  blocks: boolean
  message: string
}

/**
 * ⚠️ `blocks` is true only in enforcement mode, and enforcement is only real once migration 125
 * is applied. The UI must not claim a move will be refused when the database will happily take
 * it - a warning that turns out to be untrue is how people learn to ignore the next one.
 */
export function wipStatus(input: {
  count: number
  limit: number | null | undefined
  mode: EnforcementMode
  enforcementAvailable?: boolean
}): WipStatus {
  const limit = input.limit ?? null
  const count = input.count
  if (limit === null || limit <= 0) {
    return { state: 'none', count, limit: null, blocks: false, message: '' }
  }
  const blocks = input.mode === 'enforcement' && input.enforcementAvailable !== false
  if (count > limit) {
    return {
      state: 'over',
      count, limit, blocks,
      message: `${count} items, over the limit of ${limit}.`,
    }
  }
  if (count === limit) {
    return {
      state: 'at',
      count, limit, blocks,
      message: blocks
        ? `At the limit of ${limit}. Nothing more can be moved in until something leaves.`
        : `At the limit of ${limit}.`,
    }
  }
  return { state: 'under', count, limit, blocks: false, message: `${count} of ${limit}.` }
}

/** Why an arrival into this column is refused, phrased for a toast rather than a log. */
export function wipBlockReason(columnTitle: string, status: WipStatus): string | null {
  if (!status.blocks || status.state === 'under' || status.state === 'none') return null
  return `"${columnTitle}" is at its work-in-progress limit of ${status.limit}. Finish or move something out first.`
}

// ---------------------------------------------------------------------------------------
// Backlog
// ---------------------------------------------------------------------------------------

export interface BacklogTask {
  id: string
  title: string
  position?: number | null
  priority?: number | null
  estimate_value?: number | null
  parent_task_id?: string | null
  type_key?: string | null
  column?: { status_key?: string | null } | null
  status?: string | null
  assigned_to?: string | null
  task_assignees?: { user_id: string }[] | null
}

/**
 * Prompt G's backlog is "prioritized ordering", and the ordering is the board's own `position`
 * - deliberately NOT a second ranking column. A backlog that sorts differently from the board
 * it belongs to is two orders that must agree forever, which is what 115 refused for relations
 * and what this codebase has been bitten by every time it kept two copies of one truth.
 */
export function orderBacklog<T extends BacklogTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER
    const pb = b.position ?? Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return a.title.localeCompare(b.title)
  })
}

/** Pure list move, returning the ids in their new order. The caller persists positions. */
export function moveInBacklog(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= ids.length) return ids
  const clamped = Math.max(0, Math.min(ids.length - 1, toIndex))
  if (clamped === fromIndex) return ids
  const next = [...ids]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(clamped, 0, moved)
  return next
}

/**
 * Epic/feature grouping, Taiga's story swimlanes, without a second hierarchy.
 *
 * A parent work item forms the swimlane and its children sit inside it; anything without a
 * parent that IS a parent to nothing lands in a single ungrouped lane. There is no `epic_id`
 * column, because 113's `parent_task_id` already expresses this and a second parent pointer
 * would be a second truth.
 */
export interface Swimlane<T> {
  id: string | null
  title: string
  parent: T | null
  items: T[]
}

export function groupIntoSwimlanes<T extends BacklogTask>(
  tasks: T[],
  ungroupedLabel = 'No parent item',
): Swimlane<T>[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const lanes = new Map<string, Swimlane<T>>()
  const loose: T[] = []

  for (const task of orderBacklog(tasks)) {
    const parentId = task.parent_task_id ?? null
    if (!parentId) { loose.push(task); continue }
    const parent = byId.get(parentId) ?? null
    // ⚠️ A parent that is not in `tasks` was filtered out by RLS or by the view's own filters -
    // it is not proof the parent does not exist. Its children go to the ungrouped lane rather
    // than into a lane titled with an id nobody can resolve.
    if (!parent) { loose.push(task); continue }
    if (!lanes.has(parentId)) {
      lanes.set(parentId, { id: parentId, title: parent.title, parent, items: [] })
    }
    lanes.get(parentId)!.items.push(task)
  }

  const ordered = orderBacklog(loose)
  const laneList = [...lanes.values()].sort((a, b) => a.title.localeCompare(b.title))
  // Parents that head a lane must not also appear as loose items in the ungrouped lane.
  const headed = new Set(laneList.map((l) => l.id))
  const ungrouped = ordered.filter((t) => !headed.has(t.id))

  return ungrouped.length
    ? [...laneList, { id: null, title: ungroupedLabel, parent: null, items: ungrouped }]
    : laneList
}

/**
 * Total estimate over a set, plus how many carried none.
 *
 * Returned together on purpose: a sum with no unestimated count beside it is a number that
 * looks complete and is not, and every capacity decision in this module is made from it.
 */
export function sumEstimates(tasks: { estimate_value?: number | null }[]): { total: number; unestimated: number } {
  let total = 0
  let unestimated = 0
  for (const t of tasks) {
    const raw = t.estimate_value
    if (raw === null || raw === undefined || Number.isNaN(Number(raw))) { unestimated++; continue }
    total += Number(raw)
  }
  return { total: Number(total.toFixed(2)), unestimated }
}

/** Is this work item still open, resolved through 112's category and never a column title. */
export function isOpenTask(task: any, statuses: StatusCatalog): boolean {
  const category = getTaskStatusCategory(task, statuses)
  return category ? !isClosedCategory(category) : true
}

/** Is it finished (completed, not cancelled) - the only thing a velocity may count. */
export function isCompletedTask(task: any, statuses: StatusCatalog): boolean {
  return getTaskStatusCategory(task, statuses) === 'completed'
}

/**
 * May this work item be planned into a sprint on its own?
 *
 * Mirrors migration 123's membership trigger, which reads `work_item_types.is_agile_eligible`
 * - the first consumer that column has ever had. A subtask is carried by its parent, so
 * counting it separately double-counts its estimate in every burndown.
 *
 * ⚠️ This is a UI convenience, not the boundary: the trigger is. If the two ever disagree, the
 * database wins and the person sees a refusal they were told would not happen - so keep this
 * function pointing at the same column rather than at a hardcoded list of type keys.
 */
export function canPlanIntoSprint(
  typeKey: string | null | undefined,
  types: { key: string; is_agile_eligible: boolean }[] | null | undefined,
): boolean {
  if (!typeKey || !types?.length) return true
  const found = types.find((t) => t.key === typeKey)
  return found ? found.is_agile_eligible : true
}

export function planBlockedReason(
  typeKey: string | null | undefined,
  types: { key: string; name: string; is_agile_eligible: boolean }[] | null | undefined,
  term: Terminology,
): string | null {
  if (canPlanIntoSprint(typeKey, types)) return null
  const name = types?.find((t) => t.key === typeKey)?.name ?? typeKey
  return `${name} items are carried by their parent, so they are not planned into a ${sprintNoun(term)} on their own.`
}

// ---------------------------------------------------------------------------------------
// Which board the agile screen opens on
// ---------------------------------------------------------------------------------------

export interface AgileBoardOption {
  id: string
  title: string
  agileEnabled: boolean
}

/**
 * Resolve the board to show, in priority order: an explicit `?board=` link, then what this
 * user last chose, then a board that actually has agile switched on, then the first board.
 *
 * ⚠️ The third step is the one that matters, and it is the marketing-calendar lesson applied
 * before shipping rather than after: that switcher defaulted to `activeCalendars[0]` and the
 * hook ordered by name, so production opened every visit on an empty calendar because of the
 * alphabet. Opening the agile screen on a board that has never run a sprint would be the same
 * bug - the screen would look broken while the configured board sat one click away.
 *
 * Only an explicit switch is worth storing. Persisting this resolver's own fallback would pin
 * a user to the branch least likely to be right.
 */
export function resolveAgileBoardId(input: {
  requested?: string | null
  remembered?: string | null
  boards: AgileBoardOption[]
}): string | null {
  const { boards } = input
  const exists = (id: string | null | undefined) => Boolean(id && boards.some((b) => b.id === id))

  if (exists(input.requested)) return input.requested!
  if (exists(input.remembered)) return input.remembered!
  const enabled = boards.find((b) => b.agileEnabled)
  if (enabled) return enabled.id
  return boards[0]?.id ?? null
}

/** Per-user key, so two accounts on one browser keep their own choice. */
export function agileBoardStorageKey(userId: string): string {
  return `agile_board:${userId}`
}
