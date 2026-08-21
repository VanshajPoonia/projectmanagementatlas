'use client'

import { cn } from '@/lib/utils'
import { buildScheduleGridMonths } from './marketing-calendar-state'

const DAY_HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const monthLabel = new Intl.DateTimeFormat('en-US', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
})
const fullDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})

interface ScheduleDateGridProps {
  /** First and last day of the range the pattern was defined over. */
  startDateKey: string
  endDateKey: string
  /** Dates the pattern generated, before the user pruned anything. */
  patternDates: string[]
  /** Pattern dates the user has struck out. */
  skippedDates: Set<string>
  /** Dates the user added by hand, outside the pattern. */
  addedDates: string[]
  /** Toggle a day on or off. The caller decides which list it belongs in. */
  onToggle: (dateKey: string) => void
}

/**
 * Pick the exact days of a schedule on a calendar instead of off a list.
 *
 * Bobby asked for this directly: "it can also pop up a calendar where you can ctrl+click on the
 * specific days you want ... bc we may not want it to repeat the exact same days every week of
 * the defined custom range."
 *
 * Two deliberate departures from how he described it:
 *
 *   1. **Plain click, not ctrl+click.** A modifier is invisible to anyone who was not told about
 *      it and unreachable on a phone, and this dialog is used on both. Every day here is a
 *      toggle, which is the same gesture the weekday buttons above it already use.
 *   2. **It is a view of the schedule, not a second way to build one.** Clicking writes to the
 *      SAME skipped/added lists the date list below writes to, so the two can never disagree.
 *      This app has been bitten more than once by a second parallel path to the same state.
 */
export function ScheduleDateGrid({
  startDateKey,
  endDateKey,
  patternDates,
  skippedDates,
  addedDates,
  onToggle,
}: ScheduleDateGridProps) {
  const months = buildScheduleGridMonths(startDateKey, endDateKey)
  if (months.length === 0) return null

  const pattern = new Set(patternDates)
  const added = new Set(addedDates)

  return (
    <div className="space-y-3">
      {months.map((month) => (
        <div key={month.monthKey} className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            {monthLabel.format(new Date(`${month.monthKey}T00:00:00Z`))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {DAY_HEADS.map((d, i) => (
              <div key={i} className="pb-0.5 text-center text-[10px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {month.weeks.flat().map((cell, i) => {
              if (!cell) return <div key={`pad-${i}`} />

              const selected = added.has(cell.dateKey)
                || (pattern.has(cell.dateKey) && !skippedDates.has(cell.dateKey))
              const day = Number(cell.dateKey.slice(-2))

              if (!cell.inRange) {
                return (
                  <div key={cell.dateKey} className="py-1 text-center text-xs text-muted-foreground/30">
                    {day}
                  </div>
                )
              }

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  onClick={() => onToggle(cell.dateKey)}
                  aria-pressed={selected}
                  aria-label={`${selected ? 'Remove' : 'Add'} ${fullDate.format(new Date(`${cell.dateKey}T00:00:00Z`))}`}
                  className={cn(
                    'rounded py-1 text-center text-xs transition-colors',
                    selected
                      ? 'bg-foreground font-medium text-background'
                      : 'text-foreground hover:bg-accent',
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
