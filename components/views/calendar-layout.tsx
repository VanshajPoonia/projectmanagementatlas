'use client'

// CALENDAR - Month / Week / Day, an unscheduled work tray, and drag to reschedule.
//
// Prompt E: "Calendar is an Atlas capability; do not attribute it to Vikunja. Preserve existing
// task calendar behavior. Do not merge the specialized marketing calendar into generic task
// calendar storage." That last line is a schema instruction and it is honoured by omission:
// nothing here reads or writes marketing_calendar_items. The marketing calendar has its own
// recurrence, its own channels and its own membership table, and folding it into task storage
// would mean one of the two loses the model it needs.
//
// ⚠️ EVERY DATE HERE IS A CALENDAR DATE, NEVER AN INSTANT.
// `tasks.due_date` is a DATE in Postgres and arrives as `YYYY-MM-DD`. `new Date('2026-08-25')`
// parses that as UTC MIDNIGHT, which in America/Chicago is 7pm on the 24th - so a task lands on
// the wrong cell for anyone west of Greenwich, and the server and the browser disagree for a
// five-hour window every day. The grid is therefore built from integer year/month/day and every
// comparison is a string compare on `YYYY-MM-DD`, which sorts correctly by construction. Do not
// "simplify" this by parsing into Date objects.

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { businessDate } from '@/lib/crm'
import {
  addDays, dayLabel, monthLabel, parseIso, rangeDates, stepAnchor, taskDueDate,
  type CalendarRange,
} from '@/lib/calendar-grid'
import type { Density } from '@/components/shell/density'
import { dueDateTone } from './task-fields'
import type { EvalContext, ViewConfig } from '@/lib/view-config'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface CalendarLayoutProps {
  tasks: any[]
  config: ViewConfig
  ctx: EvalContext
  density: Density
  onOpenTask: (taskId: string) => void
  /** Returns false when the write did not land, so the optimistic move rolls back. */
  onReschedule?: (taskId: string, dueDate: string | null) => Promise<boolean>
  canReschedule?: boolean
  rescheduleBlockedReason?: string | null
}

export function CalendarLayout({
  tasks, config, ctx, density, onOpenTask, onReschedule,
  canReschedule = false, rescheduleBlockedReason,
}: CalendarLayoutProps) {
  const today = businessDate(ctx.now)
  const [anchor, setAnchor] = useState(today)
  const [range, setRange] = useState<CalendarRange>('month')
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, string | null>>({})

  const dueOf = (task: any): string | null =>
    Object.prototype.hasOwnProperty.call(pending, task.id) ? pending[task.id] : taskDueDate(task)

  const dates = useMemo(() => rangeDates(anchor, range), [anchor, range])

  const byDate = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const task of tasks) {
      const due = dueOf(task)
      if (!due) continue
      const existing = map.get(due)
      if (existing) existing.push(task)
      else map.set(due, [task])
    }
    return map
  }, [tasks, pending])

  const unscheduled = useMemo(() => tasks.filter((t) => !dueOf(t)), [tasks, pending])

  const reschedule = async (taskId: string, date: string | null) => {
    if (!onReschedule) return
    setPending((prev) => ({ ...prev, [taskId]: date }))
    const ok = await onReschedule(taskId, date)
    // A refusal returns zero rows and no error, so `false` is the only signal. Put the card
    // back rather than leaving it on a day the database never agreed to.
    if (!ok) {
      setPending((prev) => {
        const next = { ...prev }
        delete next[taskId]
        return next
      })
    }
  }

  const onDrop = (date: string | null) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    const taskId = e.dataTransfer.getData('text/plain')
    if (taskId) void reschedule(taskId, date)
  }

  const headerLabel =
    range === 'month' ? monthLabel(anchor)
      : range === 'week' ? `Week of ${dayLabel(dates[0])}`
      : dayLabel(anchor)

  const step = (delta: number) => setAnchor(stepAnchor(anchor, range, delta))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => step(-1)} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => step(1)} aria-label="Next">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8" id="calendar-today" onClick={() => setAnchor(today)}>
          Today
        </Button>
        <h2 className="ml-1 text-sm font-semibold">{headerLabel}</h2>

        <div className="bg-muted ml-auto inline-flex rounded-md p-0.5" role="group" aria-label="Calendar range">
          {(['month', 'week', 'day'] as const).map((r) => (
            <Button
              key={r}
              type="button"
              id={`calendar-range-${r}`}
              size="sm"
              variant={range === r ? 'default' : 'ghost'}
              className="h-7 px-2.5 text-xs capitalize"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>

      {!canReschedule && rescheduleBlockedReason && (
        <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-xs">
          {rescheduleBlockedReason}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
        <div className="overflow-x-auto rounded-md border">
          {range !== 'day' && (
            <div className="bg-muted/50 grid grid-cols-7 border-b">
              {WEEKDAYS.map((day) => (
                <div key={day} className="px-2 py-1.5 text-center text-xs font-medium">{day}</div>
              ))}
            </div>
          )}

          <div className={cn('grid', range === 'day' ? 'grid-cols-1' : 'grid-cols-7')}>
            {dates.map((date) => {
              const dayTasks = byDate.get(date) ?? []
              const inMonth = range !== 'month' || parseIso(date).m === parseIso(anchor).m
              const isToday = date === today
              return (
                <div
                  key={date}
                  className={cn(
                    'min-h-[92px] border-r border-b p-1.5 last:border-r-0',
                    !inMonth && 'bg-muted/20',
                    dragOver === date && 'bg-primary/10 ring-primary ring-inset ring-2',
                    range === 'day' && 'min-h-[400px]',
                  )}
                  onDragOver={(e) => { if (canReschedule) { e.preventDefault(); setDragOver(date) } }}
                  onDragLeave={() => setDragOver((cur) => (cur === date ? null : cur))}
                  onDrop={canReschedule ? onDrop(date) : undefined}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        'text-xs',
                        isToday && 'bg-primary text-primary-foreground rounded px-1.5 py-0.5 font-semibold',
                        !inMonth && 'text-muted-foreground',
                      )}
                    >
                      {parseIso(date).d}
                    </span>
                    {dayTasks.length > 0 && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">{dayTasks.length}</Badge>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayTasks.slice(0, range === 'day' ? 100 : density === 'compact' ? 2 : 4).map((task: any) => {
                      const tone = dueDateTone(dueOf(task), ctx.now)
                      return (
                        <button
                          key={task.id}
                          type="button"
                          draggable={canReschedule}
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                          onClick={() => onOpenTask(task.id)}
                          className={cn(
                            'block w-full truncate rounded px-1.5 py-1 text-left text-[11px]',
                            'bg-muted hover:bg-muted/70',
                            tone === 'overdue' && 'bg-red-500/15 text-red-700 dark:text-red-300',
                            canReschedule && 'cursor-grab active:cursor-grabbing',
                          )}
                          title={task.title}
                        >
                          {task.title}
                        </button>
                      )
                    })}
                    {range !== 'day' && dayTasks.length > (density === 'compact' ? 2 : 4) && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground px-1.5 text-[11px]"
                        onClick={() => { setAnchor(date); setRange('day') }}
                      >
                        +{dayTasks.length - (density === 'compact' ? 2 : 4)} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* The unscheduled tray. Work with no date is the work most likely to be forgotten,
            so it sits beside the grid rather than behind a filter. */}
        <aside
          className={cn(
            'rounded-md border p-2',
            dragOver === '__unscheduled__' && 'bg-primary/10 ring-primary ring-inset ring-2',
          )}
          onDragOver={(e) => { if (canReschedule) { e.preventDefault(); setDragOver('__unscheduled__') } }}
          onDragLeave={() => setDragOver((cur) => (cur === '__unscheduled__' ? null : cur))}
          onDrop={canReschedule ? onDrop(null) : undefined}
        >
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Inbox className="h-4 w-4" aria-hidden />
            Unscheduled
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{unscheduled.length}</Badge>
          </h3>

          {unscheduled.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-1.5 py-3 text-xs">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Everything visible here has a date.
            </p>
          ) : (
            <ul className="max-h-[520px] space-y-1 overflow-y-auto">
              {unscheduled.map((task: any) => (
                <li key={task.id}>
                  <button
                    type="button"
                    draggable={canReschedule}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                    onClick={() => onOpenTask(task.id)}
                    className={cn(
                      'bg-muted hover:bg-muted/70 block w-full truncate rounded px-2 py-1.5 text-left text-xs',
                      canReschedule && 'cursor-grab active:cursor-grabbing',
                    )}
                    title={task.title}
                  >
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canReschedule && (
            <p className="text-muted-foreground mt-2 text-[11px]">
              Drag a task onto a day to schedule it, or back here to clear its date.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
