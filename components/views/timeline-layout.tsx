'use client'

// TIMELINE - horizontal dates, hierarchy, work bars, milestones, today marker, zoom, collapse,
// drag to reschedule and resize to change duration. Prompt I's "first useful version", exactly.
//
// ⚠️ SCHEDULING IS MANUAL. NOTHING HERE MOVES A DATE IT WAS NOT ASKED TO MOVE.
// Prompt I separates manual scheduling (the user owns dates) from automatic (dates constrained
// by relationships), and this build is manual by explicit scope decision. Where a manual date
// contradicts a dependency, the bar carries a warning that names the conflict and the number of
// days - which is Prompt I's "if Atlas moves or refuses to move a date, explain why" honoured
// the only way manual mode can honour it. Automatic rescheduling would be a trigger on `tasks`,
// a different eligibility class entirely (125 versus 127) and a separate decision.
//
// ⚠️ EVERY DATE HERE IS A `YYYY-MM-DD` CALENDAR DAY. `tasks.start_date` and `tasks.due_date` are
// TIMESTAMPTZ storing UTC midnight; lib/timeline.ts normalises both at the boundary and every
// comparison below is a string compare, which sorts correctly by construction. Do not
// "simplify" this by parsing into Date objects - that is the one-day-early family of bug this
// repo has shipped five-plus times.
//
// ⚠️ The grid scrolls inside its own container. A horizontal strip whose length is a function
// of how much work exists is the shape that blew up the board header twice in 2026-08, and
// scripts/audit-mobile.mjs asserts the page body never scrolls sideways.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevronRightIcon,
  Diamond, Inbox, Info,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { calendarDateLabel } from '@/lib/calendar-grid'
import {
  DAY_WIDTH, ZOOM_LABELS, TIMELINE_ZOOMS,
  barFor, daysFromPixels, explainRollUp, isWeekend, placeBar, placeMilestones, resizeBar,
  rollUp, scheduleViolations, shiftBar, timelineRange, timelineTicks, todayOffset,
  violationsByTask,
  type ResizeEdge, type ScheduleEdit, type TimelineBar, type TimelineRelation,
  type TimelineZoom,
} from '@/lib/timeline'
import { MILESTONE_STATE_LABELS, milestoneStatus, type MilestoneRow } from '@/lib/milestones'
import type { Density } from '@/components/shell/density'
import type { EvalContext, ViewConfig } from '@/lib/view-config'

// No `as any` here on purpose: the cast that used to be here was hiding a key ('cozy') that is
// not one of the three real densities, so `expanded` silently fell through to the fallback and
// the densest setting rendered identically to the default.
const ROW_HEIGHT: Record<Density, number> = { compact: 30, comfortable: 38, expanded: 46 }
const RAIL_WIDTH = 260

interface TimelineLayoutProps {
  tasks: any[]
  config: ViewConfig
  ctx: EvalContext
  density: Density
  milestones: MilestoneRow[]
  relations: TimelineRelation[]
  /**
   * ⚠️ Children keyed by parent, supplied by the host from the PRE-hierarchy-filter set.
   *
   * This is not a convenience. `applyHierarchy` drops every child in both `parents_only` and
   * `nested` mode, so `tasks` here contains only roots - and a phase's span is computed FROM its
   * children. Deriving them from `tasks` alone made every parent look undated and sent it to the
   * unscheduled tray, which is a filter silently deleting the entire macro view. Found in a real
   * browser, not in review. ListLayout and TableLayout take the same prop for the same reason.
   */
  childrenByParent: Map<string, any[]>
  /** The server's calendar day, resolved once. Never asked of the browser. */
  today: string
  onOpenTask: (taskId: string) => void
  /** Returns false when the write did not land, so the optimistic move rolls back. */
  onReschedule?: (taskId: string, schedule: ScheduleEdit) => Promise<boolean>
  canReschedule?: boolean
  rescheduleBlockedReason?: string | null
  onOpenMilestone?: (milestoneId: string) => void
}

interface Row {
  task: any
  depth: number
  bar: TimelineBar
  derived: boolean
  rollUpNote: string | null
  childCount: number
  collapsed: boolean
}

export function TimelineLayout({
  tasks, config, ctx, density, milestones, relations, childrenByParent, today,
  onOpenTask, onReschedule, canReschedule = false, rescheduleBlockedReason,
  onOpenMilestone,
}: TimelineLayoutProps) {
  const [zoom, setZoom] = useState<TimelineZoom>('week')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showMilestones, setShowMilestones] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // The optimistic edit in flight, so a bar follows the pointer before the write returns.
  const [preview, setPreview] = useState<{ id: string; edit: ScheduleEdit } | null>(null)
  const dragRef = useRef<
    { id: string; startX: number; bar: TimelineBar; edge: ResizeEdge | null } | null
  >(null)

  const rowHeight = ROW_HEIGHT[density] ?? ROW_HEIGHT.comfortable
  const dayWidth = DAY_WIDTH[zoom]

  /* ── Rows: hierarchy, with a collapsed parent standing in for its children ────────── */

  const { rows, unscheduled } = useMemo(() => {
    const byId = new Map<string, any>(tasks.map((t) => [t.id, t]))
    const childrenOf = childrenByParent
    // A child whose parent is not in this set gets its own root row rather than vanishing: a
    // filter that matches the child and not the parent must still show the child.
    const roots = tasks.filter((t) => !t.parent_task_id || !byId.has(t.parent_task_id))
    const out: Row[] = []
    const tray: any[] = []

    const applyPreview = (task: any) => {
      if (!preview || preview.id !== task.id) return task
      return { ...task, start_date: preview.edit.start, due_date: preview.edit.due }
    }

    const walk = (task: any, depth: number) => {
      const kids = childrenOf.get(task.id) ?? []
      const isCollapsed = collapsed.has(task.id)
      const roll = rollUp(applyPreview(task), kids.map(applyPreview))

      if (roll.bar.kind === 'unscheduled') {
        tray.push(task)
      } else {
        out.push({
          task,
          depth,
          bar: roll.bar,
          derived: roll.derived,
          rollUpNote: explainRollUp(roll),
          childCount: kids.length,
          collapsed: isCollapsed,
        })
      }

      if (kids.length > 0 && !isCollapsed) {
        for (const kid of kids) walk(kid, depth + 1)
      }
    }

    for (const root of roots) walk(root, 0)
    return { rows: out, unscheduled: tray }
  }, [tasks, childrenByParent, collapsed, preview])

  /* ── Geometry ─────────────────────────────────────────────────────────────────────── */

  const range = useMemo(
    () => timelineRange(rows.map((r) => r.bar), today, zoom),
    [rows, today, zoom],
  )
  const ticks = useMemo(() => timelineTicks(range, zoom), [range, zoom])
  const todayCol = todayOffset(range, today)
  const gridWidth = range.days.length * dayWidth

  const markers = useMemo(
    () => (showMilestones ? placeMilestones(range, milestones as any, today) : []),
    [range, milestones, today, showMilestones],
  )

  const violations = useMemo(() => {
    const bars = new Map(rows.map((r) => [r.task.id, r.bar]))
    const titles = new Map(rows.map((r) => [r.task.id, String(r.task.title ?? 'Untitled')]))
    return violationsByTask(scheduleViolations(bars, relations, titles))
  }, [rows, relations])

  /* ── Scroll to today on first paint, and whenever the zoom changes ────────────────── */

  useEffect(() => {
    const el = scrollRef.current
    if (!el || todayCol === null) return
    el.scrollLeft = Math.max(0, todayCol * dayWidth - el.clientWidth / 3)
  }, [todayCol, dayWidth])

  /* ── Drag and resize ──────────────────────────────────────────────────────────────── */

  const beginDrag = useCallback(
    (event: React.PointerEvent, row: Row, edge: ResizeEdge | null) => {
      // A derived span belongs to the children it was computed from. Moving it would have to
      // move all of them, which is automatic scheduling by another name - so the handle is not
      // offered and the row says why on hover.
      if (!canReschedule || row.derived) return
      event.preventDefault()
      event.stopPropagation()
      ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
      dragRef.current = { id: row.task.id, startX: event.clientX, bar: row.bar, edge }
    },
    [canReschedule],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = daysFromPixels(event.clientX - drag.startX, zoom)
      const edit = drag.edge
        ? resizeBar(drag.bar, drag.edge, delta)
        : shiftBar(drag.bar, delta)
      setPreview(edit ? { id: drag.id, edit } : null)
    },
    [zoom],
  )

  const endDrag = useCallback(async () => {
    const drag = dragRef.current
    dragRef.current = null
    const pending = preview
    if (!drag || !pending || !onReschedule) {
      setPreview(null)
      return
    }
    const ok = await onReschedule(pending.id, pending.edit)
    // The row rolls back on a refusal because the parent owns the data; clearing the preview
    // either way is what makes the bar snap to whatever really landed.
    setPreview(null)
    if (!ok) return
  }, [preview, onReschedule])

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const nothingPlaced = rows.length === 0

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-muted inline-flex rounded-md p-0.5" role="group" aria-label="Zoom">
            {TIMELINE_ZOOMS.map((level) => (
              <Button
                key={level}
                type="button"
                id={`timeline-zoom-${level}`}
                size="sm"
                variant={zoom === level ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                aria-pressed={zoom === level}
                onClick={() => setZoom(level)}
              >
                {ZOOM_LABELS[level]}
              </Button>
            ))}
          </div>

          <Button
            type="button"
            id="timeline-today"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => {
              const el = scrollRef.current
              if (el && todayCol !== null) {
                el.scrollTo({ left: Math.max(0, todayCol * dayWidth - el.clientWidth / 3), behavior: 'smooth' })
              }
            }}
          >
            Today
          </Button>

          <Button
            type="button"
            id="timeline-milestones-toggle"
            size="sm"
            variant={showMilestones ? 'default' : 'outline'}
            className="h-8"
            aria-pressed={showMilestones}
            onClick={() => setShowMilestones((v) => !v)}
          >
            <Diamond className="mr-1.5 h-3.5 w-3.5" />
            Milestones
            {milestones.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                {milestones.length}
              </Badge>
            )}
          </Button>

          <div className="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              {canReschedule
                ? 'Drag a bar to move it, or an edge to change its duration. Dates are yours to set: nothing reschedules itself.'
                : rescheduleBlockedReason ?? 'You can view this schedule but not change it.'}
            </span>
          </div>
        </div>

        {nothingPlaced && unscheduled.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
            Nothing to place on a timeline. Work needs a start date or a due date to appear here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <div className="flex">
              {/* Left rail: names. Sticky so the grid scrolls under it. */}
              <div
                className="bg-card shrink-0 border-r"
                style={{ width: RAIL_WIDTH }}
              >
                <div
                  className="bg-muted/50 text-muted-foreground flex items-end border-b px-3 pb-1 text-[11px] font-medium"
                  style={{ height: showMilestones ? 56 : 34 }}
                >
                  Work item
                </div>
                {rows.map((row) => {
                  const conflicts = violations.get(row.task.id)
                  return (
                    <div
                      key={row.task.id}
                      className="hover:bg-muted/40 flex items-center gap-1 border-b px-2 text-xs last:border-b-0"
                      style={{ height: rowHeight, paddingLeft: 8 + row.depth * 14 }}
                    >
                      {row.childCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggle(row.task.id)}
                          aria-expanded={!row.collapsed}
                          aria-label={row.collapsed ? `Expand ${row.task.title}` : `Collapse ${row.task.title}`}
                          className="hover:bg-muted shrink-0 rounded p-0.5"
                        >
                          {row.collapsed
                            ? <ChevronRight className="h-3.5 w-3.5" />
                            : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      ) : (
                        <span className="w-[18px] shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenTask(row.task.id)}
                        className="truncate text-left hover:underline"
                        title={String(row.task.title ?? '')}
                      >
                        {row.task.title}
                      </button>
                      {row.collapsed && row.childCount > 0 && (
                        <Badge variant="secondary" className="ml-auto h-4 shrink-0 px-1 text-[10px]">
                          {row.childCount}
                        </Badge>
                      )}
                      {conflicts && conflicts.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-auto shrink-0" data-timeline-conflict={row.task.id}>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            {conflicts.map((c, i) => <p key={i} className="text-xs">{c.message}</p>)}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* The grid. Its own scroll container, so the page never moves sideways. */}
              <div ref={scrollRef} className="flex-1 overflow-x-auto" data-testid="timeline-scroll">
                <div className="relative" style={{ width: gridWidth, minWidth: '100%' }}>
                  {/* Axis */}
                  <div
                    className="bg-muted/50 relative border-b"
                    style={{ height: showMilestones ? 56 : 34 }}
                  >
                    {ticks.map((tick) => (
                      <div
                        key={tick.date}
                        className={cn(
                          'text-muted-foreground absolute bottom-0 pl-1 text-[10px] leading-6',
                          tick.major && 'text-foreground font-medium',
                        )}
                        style={{ left: tick.offset * dayWidth }}
                      >
                        {tick.label}
                      </div>
                    ))}
                    {showMilestones && markers.map((marker) => (
                      <Tooltip key={marker.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            data-milestone-marker={marker.id}
                            onClick={() => onOpenMilestone?.(marker.id)}
                            className="absolute top-1"
                            style={{ left: marker.offset * dayWidth + dayWidth / 2 - 7 }}
                            aria-label={`Milestone: ${marker.title}`}
                          >
                            <Diamond
                              className={cn(
                                'h-3.5 w-3.5 rotate-0',
                                marker.overdue
                                  ? 'fill-red-500 text-red-600'
                                  : marker.state === 'reached'
                                    ? 'fill-emerald-500 text-emerald-600'
                                    : 'fill-primary text-primary',
                              )}
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p className="text-xs font-medium">{marker.title}</p>
                          <p className="text-muted-foreground text-xs">
                            {calendarDateLabel(marker.date)} ·{' '}
                            {MILESTONE_STATE_LABELS[marker.state as keyof typeof MILESTONE_STATE_LABELS] ?? marker.state}
                            {marker.overdue ? ' · overdue' : ''}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>

                  {/* Weekend tint + today line, behind the bars */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: showMilestones ? 56 : 34 }}>
                    {range.days.map((day, i) =>
                      isWeekend(day) ? (
                        <div
                          key={day}
                          className="bg-muted/40 absolute inset-y-0"
                          style={{ left: i * dayWidth, width: dayWidth }}
                        />
                      ) : null,
                    )}
                    {todayCol !== null && (
                      <div
                        className="absolute inset-y-0 z-10 w-px bg-red-500"
                        style={{ left: todayCol * dayWidth + dayWidth / 2 }}
                        data-testid="timeline-today-line"
                      />
                    )}
                  </div>

                  {/* Bars */}
                  <div
                    className="relative"
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    {rows.map((row) => {
                      const placement = placeBar(range, row.bar)
                      const conflicts = violations.get(row.task.id)
                      const movable = canReschedule && !row.derived
                      return (
                        <div
                          key={row.task.id}
                          className="relative border-b last:border-b-0"
                          style={{ height: rowHeight }}
                        >
                          {placement && (
                            <div
                              data-timeline-bar={row.task.id}
                              data-derived={row.derived ? 'true' : 'false'}
                              onPointerDown={(e) => beginDrag(e, row, null)}
                              onDoubleClick={() => onOpenTask(row.task.id)}
                              className={cn(
                                'absolute top-1/2 flex -translate-y-1/2 items-center rounded px-1.5 text-[11px]',
                                'ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                                row.derived
                                  ? 'bg-muted text-muted-foreground border-muted-foreground/40 border border-dashed'
                                  : row.bar.kind === 'scheduled'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-primary/30 text-foreground border-primary border',
                                conflicts && conflicts.length > 0 && 'ring-2 ring-amber-500',
                                movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                              )}
                              style={{
                                left: placement.offset * dayWidth + 1,
                                width: Math.max(dayWidth - 2, placement.span * dayWidth - 2),
                                height: rowHeight - 12,
                              }}
                              title={
                                row.rollUpNote ??
                                `${calendarDateLabel(row.bar.start!)} to ${calendarDateLabel(row.bar.end!)}`
                              }
                            >
                              {movable && (
                                <span
                                  data-timeline-handle="start"
                                  onPointerDown={(e) => beginDrag(e, row, 'start')}
                                  className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l bg-black/20"
                                  aria-hidden
                                />
                              )}
                              <span className="truncate">
                                {placement.span * dayWidth > 60 ? row.task.title : ''}
                              </span>
                              {movable && (
                                <span
                                  data-timeline-handle="end"
                                  onPointerDown={(e) => beginDrag(e, row, 'end')}
                                  className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r bg-black/20"
                                  aria-hidden
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* The unscheduled tray. Prompt I / master-prompt.md both name it, and it is what stops
            a timeline quietly implying that undated work does not exist. */}
        {unscheduled.length > 0 && (
          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center gap-2">
              <Inbox className="text-muted-foreground h-4 w-4" />
              <h3 className="text-sm font-medium">Not on the timeline</h3>
              <Badge variant="secondary" className="h-5">{unscheduled.length}</Badge>
            </div>
            <p className="text-muted-foreground mb-2 text-xs">
              These have neither a start date nor a due date, so there is nowhere honest to draw
              them. Open one and give it a date to bring it onto the chart.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unscheduled.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  data-unscheduled={task.id}
                  onClick={() => onOpenTask(task.id)}
                  className="bg-muted hover:bg-muted/70 max-w-[240px] truncate rounded px-2 py-1 text-xs"
                >
                  {task.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
