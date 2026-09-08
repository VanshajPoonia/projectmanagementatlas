/**
 * The timeline layout's engine: dates in, geometry out. No React, no Supabase, no `new Date()`.
 *
 * ⚠️ EVERY DATE IN THIS FILE IS A `YYYY-MM-DD` CALENDAR DAY, and that is the whole safety story.
 * `tasks.start_date` and `tasks.due_date` are TIMESTAMPTZ storing UTC midnight; milestones use a
 * real DATE. Both are normalised through `dueCalendarDate` at the boundary (`barFor`), so no
 * arithmetic below ever touches an instant, no DST transition can land inside a span, and the
 * layout cannot reproduce the one-day-early family of bugs this repo has shipped five-plus
 * times. `today` is resolved ONCE on the server and passed in; nothing here asks the browser.
 *
 * ⚠️ SCHEDULING IS MANUAL. THE USER OWNS EVERY DATE.
 * Prompt I distinguishes manual scheduling (the user owns dates) from automatic (dates are
 * constrained by relationships), and this build is manual only, by explicit scope decision.
 * So nothing in this file moves a date it was not asked to move. What it does instead is
 * `scheduleViolations`: when a manual date contradicts a dependency, the timeline SAYS SO and
 * explains which relation and by how many days, which is Prompt I's "if Atlas moves or refuses
 * to move a date, explain why" honoured in the only way manual mode can honour it. Automatic
 * rescheduling would be a trigger on `tasks`, which is a different eligibility class entirely
 * (125 versus 127) and a separate decision.
 */

import {
  addDays,
  addMonths,
  daysBetween,
  dueCalendarDate,
  iso,
  parseIso,
  weekdayOf,
} from './calendar-grid'

/* ── Zoom ──────────────────────────────────────────────────────────────────────────── */

export type TimelineZoom = 'day' | 'week' | 'month' | 'quarter'

export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ['day', 'week', 'month', 'quarter'] as const

export const ZOOM_LABELS: Record<TimelineZoom, string> = {
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
}

/**
 * How wide one day is at each zoom, in px. The axis is always a grid of DAYS - zoom changes the
 * column width and which gridlines get a label, never the unit. Bucketing into weeks or months
 * would make a bar's ends land on a bucket boundary rather than on its real date, which is a
 * chart that quietly disagrees with the record it is drawing.
 */
export const DAY_WIDTH: Record<TimelineZoom, number> = {
  day: 34,
  week: 14,
  month: 5,
  quarter: 2,
}

/** How much padding to leave either side of the work, so bars are not flush to the edge. */
export const ZOOM_PADDING_DAYS: Record<TimelineZoom, number> = {
  day: 3,
  week: 7,
  month: 14,
  quarter: 30,
}

export const DEFAULT_ZOOM: TimelineZoom = 'week'

export function normalizeZoom(value: unknown): TimelineZoom {
  return TIMELINE_ZOOMS.includes(value as TimelineZoom) ? (value as TimelineZoom) : DEFAULT_ZOOM
}

/* ── Bars ──────────────────────────────────────────────────────────────────────────── */

/**
 * How much of a work item's schedule is actually known.
 *
 * ⚠️ `due_only` does NOT get a start date invented for it. A bar drawn from today, or from the
 * project start, to the due date is a duration nobody entered, and every number downstream
 * would then be reporting a guess as a fact. It renders as a single-day marker on its due date
 * and says "no start date" when asked. Same rule as 124's `unestimated_count`: the missing
 * figure is reported as missing, never folded in as a value.
 */
export type BarKind = 'scheduled' | 'due_only' | 'start_only' | 'unscheduled'

export interface TimelineBar {
  /** Null only when kind is 'unscheduled'. */
  start: string | null
  end: string | null
  kind: BarKind
  /** Inclusive day count. Null when there is nothing to measure. */
  days: number | null
}

export interface TimelineTask {
  id: string
  title?: string | null
  start_date?: unknown
  due_date?: unknown
  parent_task_id?: string | null
  [key: string]: unknown
}

export const BAR_KIND_HINTS: Record<BarKind, string> = {
  scheduled: 'Has a start and a due date.',
  due_only: 'Has a due date but no start date, so it is drawn as a single day rather than a span.',
  start_only: 'Has a start date but no due date, so it is drawn as a single day rather than a span.',
  unscheduled: 'Has neither date, so it cannot be placed on the timeline.',
}

/**
 * The span a task occupies, read from whichever of its two dates exist.
 *
 * ⚠️ A backwards range cannot come from the product - migration 135's CHECK refuses
 * start_date > due_date - but it can come from a database restored before that migration, so
 * the reader clamps to a single day rather than emitting a negative width. Failing loudly here
 * would take out the whole chart over one bad row.
 */
export function barFor(task: TimelineTask): TimelineBar {
  const start = dueCalendarDate(task.start_date)
  const end = dueCalendarDate(task.due_date)

  if (start && end) {
    if (start > end) return { start: end, end, kind: 'scheduled', days: 1 }
    return { start, end, kind: 'scheduled', days: daysBetween(start, end) + 1 }
  }
  if (end) return { start: end, end, kind: 'due_only', days: 1 }
  if (start) return { start, end: start, kind: 'start_only', days: 1 }
  return { start: null, end: null, kind: 'unscheduled', days: null }
}

export function isPlaced(bar: TimelineBar): boolean {
  return bar.start !== null && bar.end !== null
}

/* ── The axis ──────────────────────────────────────────────────────────────────────── */

export interface TimelineRange {
  start: string
  end: string
  /** Every day in the range, inclusive. The grid's columns. */
  days: string[]
}

export interface TimelineTick {
  date: string
  label: string
  /** Index into `range.days`. */
  offset: number
  /** A stronger rule for the first day of a month or quarter. */
  major: boolean
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * The date window the chart covers: everything placed, padded, and always including today.
 *
 * Today is forced into range deliberately. A chart of next quarter's work with no today line is
 * a chart you cannot orient yourself in, and the marker vanishing is worse than a little empty
 * space.
 */
export function timelineRange(
  bars: TimelineBar[],
  today: string,
  zoom: TimelineZoom = DEFAULT_ZOOM,
): TimelineRange {
  const placed = bars.filter(isPlaced)
  const pad = ZOOM_PADDING_DAYS[zoom]

  let start = today
  let end = today
  for (const bar of placed) {
    if (bar.start! < start) start = bar.start!
    if (bar.end! > end) end = bar.end!
  }

  start = addDays(start, -pad)
  end = addDays(end, pad)

  const days: string[] = []
  const total = daysBetween(start, end)
  for (let i = 0; i <= total; i += 1) days.push(addDays(start, i))

  return { start, end, days }
}

/** Where a day sits in the grid, or null when it is off the ends. */
export function offsetOf(range: TimelineRange, date: string | null | undefined): number | null {
  if (!date) return null
  const offset = daysBetween(range.start, date)
  return offset < 0 || offset >= range.days.length ? null : offset
}

export interface BarPlacement {
  offset: number
  span: number
  /** True when the bar runs off one end of the visible window and is drawn clipped. */
  clippedStart: boolean
  clippedEnd: boolean
}

/**
 * A bar's column and width, clamped to the visible window.
 *
 * Clamping rather than dropping: a bar that starts before the window still needs to be on
 * screen, because otherwise scrolling backwards is the only way to discover the work exists.
 */
export function placeBar(range: TimelineRange, bar: TimelineBar): BarPlacement | null {
  if (!isPlaced(bar)) return null
  if (bar.end! < range.start || bar.start! > range.end) return null

  const rawStart = daysBetween(range.start, bar.start!)
  const rawEnd = daysBetween(range.start, bar.end!)
  const offset = Math.max(0, rawStart)
  const last = Math.min(range.days.length - 1, rawEnd)

  return {
    offset,
    span: Math.max(1, last - offset + 1),
    clippedStart: rawStart < 0,
    clippedEnd: rawEnd > range.days.length - 1,
  }
}

/**
 * The labelled gridlines. Density follows zoom so the header never collides with itself:
 * every day when days are 34px wide, every Monday at week zoom, every month beyond that.
 */
export function timelineTicks(range: TimelineRange, zoom: TimelineZoom): TimelineTick[] {
  const ticks: TimelineTick[] = []

  range.days.forEach((date, offset) => {
    const { y, m, d } = parseIso(date)
    const firstOfMonth = d === 1
    const firstOfQuarter = firstOfMonth && (m - 1) % 3 === 0

    if (zoom === 'day') {
      ticks.push({ date, label: `${d}`, offset, major: firstOfMonth })
      return
    }
    if (zoom === 'week') {
      if (weekdayOf(date) === 1 || firstOfMonth) {
        ticks.push({
          date,
          label: firstOfMonth ? `${MONTH_NAMES[m - 1]} ${d}` : `${d}`,
          offset,
          major: firstOfMonth,
        })
      }
      return
    }
    if (zoom === 'month') {
      if (firstOfMonth) {
        ticks.push({
          date,
          label: m === 1 ? `${MONTH_NAMES[m - 1]} ${y}` : MONTH_NAMES[m - 1],
          offset,
          major: firstOfQuarter,
        })
      }
      return
    }
    if (firstOfQuarter) {
      ticks.push({ date, label: `Q${Math.floor((m - 1) / 3) + 1} ${y}`, offset, major: m === 1 })
    }
  })

  return ticks
}

/** Where the today line goes, or null when today is somehow outside the window. */
export function todayOffset(range: TimelineRange, today: string): number | null {
  return offsetOf(range, today)
}

/** Weekend columns get a tint. Purely presentational, but it is what makes a span readable. */
export function isWeekend(date: string): boolean {
  const day = weekdayOf(date)
  return day === 0 || day === 6
}

/* ── Macro / micro: a parent's span comes from its children ────────────────────────── */

export interface RollUp {
  bar: TimelineBar
  /** True when this span was computed from children rather than entered on the row itself. */
  derived: boolean
  childCount: number
  /** Children with no dates at all, so the derived span does not cover them. */
  unscheduledChildren: number
}

/**
 * A parent's bar: its own dates if it has them, otherwise the envelope of its children.
 *
 * This is Prompt I's macro/micro requirement, and the constraint attached to it is the whole
 * design: "Do not duplicate records to create the high-level plan." So a phase is not a new
 * kind of row. It is an ordinary work item with children (`tasks.parent_task_id`, migration
 * 060/113), and collapsing it draws one bar spanning what is underneath. Nothing is copied, and
 * expanding shows the very same rows.
 *
 * ⚠️ `derived` is returned rather than hidden because a derived span behaves differently under
 * drag: moving a bar that came from its children would have to move all of them, which is
 * automatic scheduling by another name. The UI does not offer the handle, and it says why.
 */
export function rollUp(parent: TimelineTask, children: TimelineTask[]): RollUp {
  const own = barFor(parent)
  if (isPlaced(own)) {
    return { bar: own, derived: false, childCount: children.length, unscheduledChildren: 0 }
  }

  const childBars = children.map(barFor)
  const placed = childBars.filter(isPlaced)
  const unscheduled = childBars.length - placed.length

  if (placed.length === 0) {
    return {
      bar: own,
      derived: false,
      childCount: children.length,
      unscheduledChildren: unscheduled,
    }
  }

  let start = placed[0].start!
  let end = placed[0].end!
  for (const bar of placed) {
    if (bar.start! < start) start = bar.start!
    if (bar.end! > end) end = bar.end!
  }

  return {
    bar: { start, end, kind: 'scheduled', days: daysBetween(start, end) + 1 },
    derived: true,
    childCount: children.length,
    unscheduledChildren: unscheduled,
  }
}

export function explainRollUp(roll: RollUp): string | null {
  if (!roll.derived) return null
  const base = `Span taken from ${roll.childCount} ${roll.childCount === 1 ? 'child' : 'children'}, because this item has no dates of its own.`
  return roll.unscheduledChildren > 0
    ? `${base} ${roll.unscheduledChildren} of them ${roll.unscheduledChildren === 1 ? 'has' : 'have'} no dates and ${roll.unscheduledChildren === 1 ? 'is' : 'are'} not covered by it.`
    : base
}

/* ── Manual drag and resize ────────────────────────────────────────────────────────── */

export type ResizeEdge = 'start' | 'end'

export interface ScheduleEdit {
  start: string | null
  due: string | null
}

/** Move a whole bar, keeping its duration. Only meaningful for a fully scheduled item. */
export function shiftBar(bar: TimelineBar, deltaDays: number): ScheduleEdit | null {
  if (!isPlaced(bar) || deltaDays === 0) return null
  if (bar.kind === 'due_only') return { start: null, due: addDays(bar.end!, deltaDays) }
  if (bar.kind === 'start_only') return { start: addDays(bar.start!, deltaDays), due: null }
  return { start: addDays(bar.start!, deltaDays), due: addDays(bar.end!, deltaDays) }
}

/**
 * Drag one edge.
 *
 * ⚠️ The far edge NEVER moves, and the dragged edge is clamped so it cannot cross it. Letting a
 * start pass its due date would be refused by migration 135's CHECK, and a drag that silently
 * fails after the bar has visibly moved is worse than one that stops - the person has already
 * been told, by the UI, that it worked.
 *
 * Resizing a `due_only` or `start_only` item is how it gains its missing date, so those grow
 * into a real span rather than being refused.
 */
export function resizeBar(
  bar: TimelineBar,
  edge: ResizeEdge,
  deltaDays: number,
): ScheduleEdit | null {
  if (!isPlaced(bar) || deltaDays === 0) return null

  if (edge === 'start') {
    const proposed = addDays(bar.start!, deltaDays)
    return { start: proposed > bar.end! ? bar.end! : proposed, due: bar.end! }
  }
  const proposed = addDays(bar.end!, deltaDays)
  return { start: bar.start!, due: proposed < bar.start! ? bar.start! : proposed }
}

/** How many days a pointer movement is worth at this zoom. */
export function daysFromPixels(pixels: number, zoom: TimelineZoom): number {
  return Math.round(pixels / DAY_WIDTH[zoom])
}

/* ── Dependency violations: explained, never auto-corrected ────────────────────────── */

export interface TimelineRelation {
  /** The item that must come first. */
  sourceId: string
  /** The item that must come after. */
  targetId: string
  /** 'blocks' or 'precedes' from migration 115. Only these two constrain a schedule. */
  kind: 'blocks' | 'precedes'
}

export interface ScheduleViolation {
  sourceId: string
  targetId: string
  kind: 'blocks' | 'precedes'
  /** How many days the successor would have to move to clear it. Always positive. */
  overlapDays: number
  message: string
}

/**
 * Where a manual schedule contradicts a dependency.
 *
 * ⚠️ THIS IS THE WHOLE OF PROMPT I'S "EXPLAIN WHY" IN MANUAL MODE. Automatic scheduling would
 * move the successor and then owe an explanation for having done so. Manual scheduling moves
 * nothing, so what it owes instead is to notice and say. Returning a count of days rather than
 * a boolean is deliberate: "starts 3 days before its blocker finishes" is something a person
 * can act on, and "invalid" is not.
 *
 * Only `blocks` and `precedes` constrain time. `duplicates` and `relates_to` (115) say nothing
 * about order, and treating them as constraints would produce warnings nobody can resolve.
 *
 * ⚠️ An item this viewer cannot see is not a violation. Relation rows are readable only when
 * BOTH ends are (115's policy), but a filtered VIEW can still hide one end, and reporting a
 * conflict against a bar that is not on screen is a warning with nothing behind it - the same
 * rule `executionProgress` applies to unresolved links.
 */
export function scheduleViolations(
  bars: Map<string, TimelineBar>,
  relations: TimelineRelation[],
  titles?: Map<string, string>,
): ScheduleViolation[] {
  const out: ScheduleViolation[] = []

  for (const relation of relations) {
    const first = bars.get(relation.sourceId)
    const second = bars.get(relation.targetId)
    if (!first || !second || !isPlaced(first) || !isPlaced(second)) continue

    // The successor must not begin before the predecessor ends. Same-day is fine: a handover
    // inside one working day is normal, and flagging it would make the warning constant.
    if (second.start! >= first.end!) continue

    const overlap = daysBetween(second.start!, first.end!)
    if (overlap <= 0) continue

    const firstName = titles?.get(relation.sourceId) ?? 'the item it depends on'
    const verb = relation.kind === 'blocks' ? 'is blocked by' : 'follows'

    out.push({
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      kind: relation.kind,
      overlapDays: overlap,
      message: `Starts ${overlap} ${overlap === 1 ? 'day' : 'days'} before ${firstName} is due to finish, and ${verb} it. Nothing has been moved: dates here are yours to set.`,
    })
  }

  return out
}

/** Violations grouped by the item that would have to move, which is where the badge goes. */
export function violationsByTask(
  violations: ScheduleViolation[],
): Map<string, ScheduleViolation[]> {
  const out = new Map<string, ScheduleViolation[]>()
  for (const violation of violations) {
    const list = out.get(violation.targetId) ?? []
    list.push(violation)
    out.set(violation.targetId, list)
  }
  return out
}

/* ── Milestone markers ─────────────────────────────────────────────────────────────── */

export interface MilestoneMarker {
  id: string
  title: string
  date: string
  offset: number
  state: string
  overdue: boolean
}

export function placeMilestones(
  range: TimelineRange,
  milestones: { id: string; title: string; due_date: string; state?: string | null }[],
  today: string,
): MilestoneMarker[] {
  const out: MilestoneMarker[] = []
  for (const milestone of milestones) {
    const date = dueCalendarDate(milestone.due_date)
    const offset = offsetOf(range, date)
    if (date === null || offset === null) continue
    const state = milestone.state ?? 'open'
    out.push({
      id: milestone.id,
      title: milestone.title,
      date,
      offset,
      state,
      overdue: state === 'open' && date < today,
    })
  }
  return out
}

/* ── Window navigation ─────────────────────────────────────────────────────────────── */

/** Step the visible window by roughly one screen at the current zoom. */
export function stepWindow(anchor: string, zoom: TimelineZoom, delta: number): string {
  if (zoom === 'quarter') return addMonths(anchor, delta * 3)
  if (zoom === 'month') return addMonths(anchor, delta)
  return addDays(anchor, zoom === 'week' ? delta * 28 : delta * 7)
}

/** The first day of the month a date falls in. Used to snap the axis to something legible. */
export function monthStart(date: string): string {
  const { y, m } = parseIso(date)
  return iso(y, m, 1)
}
