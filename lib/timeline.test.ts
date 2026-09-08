import { describe, it, expect } from 'vitest'
import {
  barFor,
  daysFromPixels,
  explainRollUp,
  isWeekend,
  monthStart,
  normalizeZoom,
  offsetOf,
  placeBar,
  placeMilestones,
  resizeBar,
  rollUp,
  scheduleViolations,
  shiftBar,
  stepWindow,
  timelineRange,
  timelineTicks,
  todayOffset,
  violationsByTask,
  type TimelineBar,
  type TimelineRelation,
} from './timeline'

/**
 * ⚠️ THE FIXTURES BELOW USE THE SHAPES THE COLUMNS REALLY HOLD, NOT BARE 'YYYY-MM-DD'.
 *
 * This is the single most important thing about this file. CLAUDE.md records that two separate
 * ~1400-test suites both missed the same one-day bug because each used a fixture shape the
 * column never sends: My Work's used toISOString() timestamps, Prompt E's used bare date
 * strings, and each survived the bug the other one had. `tasks.start_date` and `tasks.due_date`
 * are TIMESTAMPTZ, and production holds exactly two shapes - T00:00:00+00:00 from the raw
 * <input type="date"> path, and T05:00:00+00:00 from a Chicago picker before dueDateForStorage
 * normalised the writers. Both appear below, and `pnpm test:timezones` runs the lot under UTC,
 * America/Chicago, Pacific/Auckland and Asia/Calcutta because the bug is invisible in UTC.
 */
const UTC_MIDNIGHT = (day: string) => `${day}T00:00:00+00:00`
const CHICAGO_MIDNIGHT = (day: string) => `${day}T05:00:00+00:00`

describe('barFor: reading a schedule out of two TIMESTAMPTZ columns', () => {
  it('reads the stored calendar day, not the instant, for the UTC-midnight shape', () => {
    const bar = barFor({
      id: 't',
      start_date: UTC_MIDNIGHT('2026-03-02'),
      due_date: UTC_MIDNIGHT('2026-03-06'),
    })
    expect(bar).toEqual({ start: '2026-03-02', end: '2026-03-06', kind: 'scheduled', days: 5 })
  })

  it('reads the stored calendar day for the Chicago-picker shape too', () => {
    // T05:00:00Z is still the 2nd in UTC and would be the 1st if resolved through Chicago.
    const bar = barFor({
      id: 't',
      start_date: CHICAGO_MIDNIGHT('2026-03-02'),
      due_date: CHICAGO_MIDNIGHT('2026-03-06'),
    })
    expect(bar.start).toBe('2026-03-02')
    expect(bar.end).toBe('2026-03-06')
  })

  it('does not invent a start date for a task that only has a due date', () => {
    const bar = barFor({ id: 't', due_date: UTC_MIDNIGHT('2026-03-06') })
    expect(bar).toEqual({ start: '2026-03-06', end: '2026-03-06', kind: 'due_only', days: 1 })
  })

  it('does not invent a due date for a task that only has a start date', () => {
    const bar = barFor({ id: 't', start_date: UTC_MIDNIGHT('2026-03-06') })
    expect(bar.kind).toBe('start_only')
    expect(bar.days).toBe(1)
  })

  it('reports an undated task as unscheduled rather than placing it anywhere', () => {
    const bar = barFor({ id: 't' })
    expect(bar).toEqual({ start: null, end: null, kind: 'unscheduled', days: null })
  })

  it('counts a single-day task as one day, not zero', () => {
    const bar = barFor({
      id: 't',
      start_date: UTC_MIDNIGHT('2026-03-06'),
      due_date: UTC_MIDNIGHT('2026-03-06'),
    })
    expect(bar.days).toBe(1)
  })

  it('clamps a backwards range instead of emitting a negative width', () => {
    // Migration 135's CHECK refuses this, but a database restored from before it could hold it.
    const bar = barFor({
      id: 't',
      start_date: UTC_MIDNIGHT('2026-03-10'),
      due_date: UTC_MIDNIGHT('2026-03-01'),
    })
    expect(bar.days).toBe(1)
    expect(bar.start).toBe('2026-03-01')
  })

  it('survives a daylight-saving transition inside the span', () => {
    // US DST starts 2026-03-08; NZ ends 2026-04-05. A span built with local date maths would
    // lose or gain an hour and round to the wrong number of days.
    const bar = barFor({
      id: 't',
      start_date: UTC_MIDNIGHT('2026-03-06'),
      due_date: UTC_MIDNIGHT('2026-03-10'),
    })
    expect(bar.days).toBe(5)
  })
})

describe('timelineRange', () => {
  const today = '2026-03-15'

  it('always includes today, even when every bar is months away', () => {
    const bars = [barFor({ id: 'a', start_date: UTC_MIDNIGHT('2026-09-01'), due_date: UTC_MIDNIGHT('2026-09-10') })]
    const range = timelineRange(bars, today, 'week')
    expect(range.start <= today).toBe(true)
    expect(todayOffset(range, today)).not.toBeNull()
  })

  it('covers every placed bar', () => {
    const bars = [
      barFor({ id: 'a', start_date: UTC_MIDNIGHT('2026-03-01'), due_date: UTC_MIDNIGHT('2026-03-05') }),
      barFor({ id: 'b', start_date: UTC_MIDNIGHT('2026-04-20'), due_date: UTC_MIDNIGHT('2026-04-25') }),
    ]
    const range = timelineRange(bars, today, 'week')
    expect(range.start <= '2026-03-01').toBe(true)
    expect(range.end >= '2026-04-25').toBe(true)
  })

  it('ignores unscheduled bars rather than treating them as today', () => {
    const withGhost = timelineRange([barFor({ id: 'a' })], today, 'week')
    const empty = timelineRange([], today, 'week')
    expect(withGhost).toEqual(empty)
  })

  it('produces a contiguous day list with no gaps or repeats', () => {
    const range = timelineRange([], today, 'day')
    const unique = new Set(range.days)
    expect(unique.size).toBe(range.days.length)
    expect(range.days[0]).toBe(range.start)
    expect(range.days[range.days.length - 1]).toBe(range.end)
  })

  it('spans a year boundary without losing a day', () => {
    const bars = [barFor({ id: 'a', start_date: UTC_MIDNIGHT('2026-12-28'), due_date: UTC_MIDNIGHT('2027-01-04') })]
    const range = timelineRange(bars, '2026-12-30', 'day')
    expect(range.days).toContain('2026-12-31')
    expect(range.days).toContain('2027-01-01')
  })
})

describe('placeBar', () => {
  const range = timelineRange([], '2026-03-15', 'day') // 2026-03-12 .. 2026-03-18

  it('places a bar at the right column with the right width', () => {
    const bar: TimelineBar = { start: '2026-03-14', end: '2026-03-16', kind: 'scheduled', days: 3 }
    expect(placeBar(range, bar)).toEqual({
      offset: 2, span: 3, clippedStart: false, clippedEnd: false,
    })
  })

  it('clamps a bar that starts before the window and flags it, rather than dropping it', () => {
    const bar: TimelineBar = { start: '2026-01-01', end: '2026-03-14', kind: 'scheduled', days: 73 }
    const placed = placeBar(range, bar)
    expect(placed?.offset).toBe(0)
    expect(placed?.clippedStart).toBe(true)
  })

  it('returns null only when the bar is entirely outside the window', () => {
    const bar: TimelineBar = { start: '2025-01-01', end: '2025-01-02', kind: 'scheduled', days: 2 }
    expect(placeBar(range, bar)).toBeNull()
  })

  it('never returns a span below 1', () => {
    const bar: TimelineBar = { start: '2026-03-12', end: '2026-03-12', kind: 'due_only', days: 1 }
    expect(placeBar(range, bar)?.span).toBe(1)
  })

  it('refuses to place an unscheduled bar', () => {
    expect(placeBar(range, { start: null, end: null, kind: 'unscheduled', days: null })).toBeNull()
  })
})

describe('the axis', () => {
  it('labels every day at day zoom and only months at month zoom', () => {
    const bars = [barFor({ id: 'a', start_date: UTC_MIDNIGHT('2026-01-01'), due_date: UTC_MIDNIGHT('2026-06-30') })]
    const range = timelineRange(bars, '2026-03-15', 'month')
    const dayTicks = timelineTicks(range, 'day')
    const monthTicks = timelineTicks(range, 'month')
    expect(dayTicks.length).toBe(range.days.length)
    expect(monthTicks.length).toBeLessThan(12)
    expect(monthTicks.every((t) => t.date.endsWith('-01'))).toBe(true)
  })

  it('marks quarter starts as major at quarter zoom', () => {
    const bars = [barFor({ id: 'a', start_date: UTC_MIDNIGHT('2026-01-01'), due_date: UTC_MIDNIGHT('2027-06-30') })]
    const range = timelineRange(bars, '2026-03-15', 'quarter')
    const ticks = timelineTicks(range, 'quarter')
    expect(ticks.length).toBeGreaterThan(3)
    expect(ticks.some((t) => t.label.startsWith('Q1'))).toBe(true)
  })

  it('knows a weekend from a weekday', () => {
    expect(isWeekend('2026-03-14')).toBe(true)  // Saturday
    expect(isWeekend('2026-03-15')).toBe(true)  // Sunday
    expect(isWeekend('2026-03-16')).toBe(false) // Monday
  })

  it('offsetOf returns null off either end rather than a negative index', () => {
    const range = timelineRange([], '2026-03-15', 'day')
    expect(offsetOf(range, '2020-01-01')).toBeNull()
    expect(offsetOf(range, '2030-01-01')).toBeNull()
    expect(offsetOf(range, null)).toBeNull()
  })
})

describe('rollUp: a phase spans its children without duplicating them', () => {
  const parent = { id: 'p' }
  const children = [
    { id: 'c1', start_date: UTC_MIDNIGHT('2026-03-02'), due_date: UTC_MIDNIGHT('2026-03-06') },
    { id: 'c2', start_date: UTC_MIDNIGHT('2026-03-10'), due_date: UTC_MIDNIGHT('2026-03-20') },
  ]

  it('derives the envelope of its children when the parent has no dates', () => {
    const roll = rollUp(parent, children)
    expect(roll.bar.start).toBe('2026-03-02')
    expect(roll.bar.end).toBe('2026-03-20')
    expect(roll.derived).toBe(true)
  })

  it('prefers the parent own dates when it has them, and says the span is not derived', () => {
    const roll = rollUp(
      { id: 'p', start_date: UTC_MIDNIGHT('2026-01-01'), due_date: UTC_MIDNIGHT('2026-01-05') },
      children,
    )
    expect(roll.bar.start).toBe('2026-01-01')
    expect(roll.derived).toBe(false)
    expect(explainRollUp(roll)).toBeNull()
  })

  it('reports children it could not cover instead of silently excluding them', () => {
    const roll = rollUp(parent, [...children, { id: 'c3' }])
    expect(roll.unscheduledChildren).toBe(1)
    expect(explainRollUp(roll)).toContain('1 of them')
  })

  it('stays unscheduled when no child has a date either', () => {
    const roll = rollUp(parent, [{ id: 'c1' }, { id: 'c2' }])
    expect(roll.bar.kind).toBe('unscheduled')
    expect(roll.derived).toBe(false)
  })
})

describe('manual drag and resize', () => {
  const bar: TimelineBar = { start: '2026-03-02', end: '2026-03-06', kind: 'scheduled', days: 5 }

  it('shifting keeps the duration exactly', () => {
    const moved = shiftBar(bar, 3)
    expect(moved).toEqual({ start: '2026-03-05', due: '2026-03-09' })
  })

  it('shifting backwards across a month boundary lands on the right days', () => {
    expect(shiftBar(bar, -5)).toEqual({ start: '2026-02-25', due: '2026-03-01' })
  })

  it('shifting a due-only item moves only its due date, never inventing a start', () => {
    const dueOnly = barFor({ id: 't', due_date: UTC_MIDNIGHT('2026-03-06') })
    expect(shiftBar(dueOnly, 2)).toEqual({ start: null, due: '2026-03-08' })
  })

  it('resizing the end leaves the start alone', () => {
    expect(resizeBar(bar, 'end', 4)).toEqual({ start: '2026-03-02', due: '2026-03-10' })
  })

  it('resizing the start leaves the end alone', () => {
    expect(resizeBar(bar, 'start', -2)).toEqual({ start: '2026-02-28', due: '2026-03-06' })
  })

  it('clamps a start dragged past its due date rather than producing a range 135 refuses', () => {
    const edit = resizeBar(bar, 'start', 99)
    expect(edit).toEqual({ start: '2026-03-06', due: '2026-03-06' })
    expect(edit!.start! <= edit!.due!).toBe(true)
  })

  it('clamps an end dragged before its start', () => {
    const edit = resizeBar(bar, 'end', -99)
    expect(edit!.start! <= edit!.due!).toBe(true)
  })

  it('does nothing for a zero-day drag, so a click is never a write', () => {
    expect(shiftBar(bar, 0)).toBeNull()
    expect(resizeBar(bar, 'end', 0)).toBeNull()
  })

  it('converts pixels to days at the current zoom', () => {
    expect(daysFromPixels(34, 'day')).toBe(1)
    expect(daysFromPixels(70, 'week')).toBe(5)
    expect(daysFromPixels(4, 'day')).toBe(0)
  })
})

describe('scheduleViolations: explained, never auto-corrected', () => {
  const bars = new Map<string, TimelineBar>([
    ['a', { start: '2026-03-01', end: '2026-03-10', kind: 'scheduled', days: 10 }],
    ['b', { start: '2026-03-07', end: '2026-03-15', kind: 'scheduled', days: 9 }],
    ['c', { start: '2026-03-11', end: '2026-03-20', kind: 'scheduled', days: 10 }],
  ])
  const titles = new Map([['a', 'Pour foundation']])

  it('flags a successor starting before its blocker finishes, with a day count', () => {
    const rel: TimelineRelation[] = [{ sourceId: 'a', targetId: 'b', kind: 'blocks' }]
    const [violation] = scheduleViolations(bars, rel, titles)
    expect(violation.overlapDays).toBe(3)
    expect(violation.message).toContain('Pour foundation')
    expect(violation.message).toContain('Nothing has been moved')
  })

  it('does not flag a successor that starts after its blocker finishes', () => {
    const rel: TimelineRelation[] = [{ sourceId: 'a', targetId: 'c', kind: 'blocks' }]
    expect(scheduleViolations(bars, rel, titles)).toEqual([])
  })

  it('treats a same-day handover as fine, so the warning does not become constant', () => {
    const sameDay = new Map<string, TimelineBar>([
      ['a', { start: '2026-03-01', end: '2026-03-10', kind: 'scheduled', days: 10 }],
      ['b', { start: '2026-03-10', end: '2026-03-15', kind: 'scheduled', days: 6 }],
    ])
    expect(scheduleViolations(sameDay, [{ sourceId: 'a', targetId: 'b', kind: 'blocks' }])).toEqual([])
  })

  it('says nothing about an end this viewer cannot see', () => {
    const rel: TimelineRelation[] = [{ sourceId: 'a', targetId: 'hidden', kind: 'blocks' }]
    expect(scheduleViolations(bars, rel, titles)).toEqual([])
  })

  it('says nothing about an unscheduled end, which has no dates to conflict', () => {
    const withGhost = new Map(bars)
    withGhost.set('ghost', { start: null, end: null, kind: 'unscheduled', days: null })
    const rel: TimelineRelation[] = [{ sourceId: 'a', targetId: 'ghost', kind: 'blocks' }]
    expect(scheduleViolations(withGhost, rel, titles)).toEqual([])
  })

  it('groups violations by the item that would have to move', () => {
    const rel: TimelineRelation[] = [
      { sourceId: 'a', targetId: 'b', kind: 'blocks' },
      { sourceId: 'c', targetId: 'b', kind: 'precedes' },
    ]
    // Both relations name `b` as the successor, and `b` starts before BOTH predecessors end,
    // so both land on `b`. Neither lands on `a` or `c`: the badge belongs on the item that
    // would have to move, not on the ones it is late against.
    const grouped = violationsByTask(scheduleViolations(bars, rel, titles))
    expect(grouped.get('b')?.length).toBe(2)
    expect(grouped.has('a')).toBe(false)
    expect(grouped.has('c')).toBe(false)
  })

  it('falls back to a neutral phrase when the blocker has no known title', () => {
    const [violation] = scheduleViolations(bars, [{ sourceId: 'a', targetId: 'b', kind: 'blocks' }])
    expect(violation.message).toContain('the item it depends on')
  })
})

describe('milestone markers', () => {
  const range = timelineRange([], '2026-03-15', 'day')

  it('places a milestone on its own day', () => {
    const [marker] = placeMilestones(range, [
      { id: 'm', title: 'Permit', due_date: '2026-03-16', state: 'open' },
    ], '2026-03-15')
    expect(marker.date).toBe('2026-03-16')
    expect(marker.offset).toBe(offsetOf(range, '2026-03-16'))
  })

  it('marks an open milestone in the past as overdue, and a reached one as not', () => {
    const markers = placeMilestones(range, [
      { id: 'a', title: 'Late', due_date: '2026-03-13', state: 'open' },
      { id: 'b', title: 'Done', due_date: '2026-03-13', state: 'reached' },
    ], '2026-03-15')
    expect(markers.find((m) => m.id === 'a')!.overdue).toBe(true)
    expect(markers.find((m) => m.id === 'b')!.overdue).toBe(false)
  })

  it('drops a milestone outside the window rather than clamping it onto an edge', () => {
    expect(placeMilestones(range, [
      { id: 'm', title: 'Far', due_date: '2030-01-01', state: 'open' },
    ], '2026-03-15')).toEqual([])
  })
})

describe('window navigation and zoom', () => {
  it('steps by a screenful at each zoom', () => {
    expect(stepWindow('2026-03-15', 'day', 1)).toBe('2026-03-22')
    expect(stepWindow('2026-03-15', 'week', 1)).toBe('2026-04-12')
    expect(stepWindow('2026-03-15', 'month', 1)).toBe('2026-04-15')
    expect(stepWindow('2026-03-15', 'quarter', 1)).toBe('2026-06-15')
  })

  it('steps backwards symmetrically', () => {
    expect(stepWindow(stepWindow('2026-03-15', 'day', 1), 'day', -1)).toBe('2026-03-15')
  })

  it('snaps to the first of the month', () => {
    expect(monthStart('2026-03-15')).toBe('2026-03-01')
  })

  it('falls back to a known zoom rather than throwing on a stored junk value', () => {
    expect(normalizeZoom('gantt')).toBe('week')
    expect(normalizeZoom(undefined)).toBe('week')
    expect(normalizeZoom('quarter')).toBe('quarter')
  })
})
