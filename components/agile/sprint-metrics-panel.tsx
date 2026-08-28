'use client'

// The metrics tab.
//
// Prompt G's two conditions are met here rather than described:
//   1. Every number carries its own definition/formula/unit/included/excluded/last-updated,
//      rendered from the value by MetricExplainer.
//   2. A CLOSED window reads its frozen snapshot and a running one is computed live and
//      labelled live. `sprintMetrics` picks, so no screen has to remember which.
//
// ⚠️ A closed window with no frozen record shows "no record", never a recomputation. Silently
// recomputing it would produce exactly the number this module exists to prevent: a finished
// window whose velocity quietly changes every time somebody re-estimates a task.

import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shell/states'
import { MetricTile } from './metric-explainer'
import { SprintChart } from './sprint-charts'
import {
  METRIC_DEFINITIONS, burndownSeries, explainVelocity, sprintMetrics, velocity,
  type BurndownSampleRow, type SprintMemberRow, type SprintMetricsRow,
} from '@/lib/sprint-metrics'
import { formatEstimate, sprintNoun, sprintNounPlural, type AgileSettings, type SprintLike } from '@/lib/agile'
import type { StatusCatalog } from '@/lib/task-status'

interface Props {
  settings: AgileSettings
  statuses: StatusCatalog
  sprint: (SprintLike & { id: string; title: string }) | null
  allSprints: (SprintLike & { id: string; title: string })[]
  members: SprintMemberRow[]
  tasks: any[]
  snapshots: SprintMetricsRow[]
  samples: BurndownSampleRow[]
  now: string
  today: string
}

export function SprintMetricsPanel({
  settings, statuses, sprint, allSprints, members, tasks, snapshots, samples, now, today,
}: Props) {
  const unit = settings.estimate_unit
  const term = settings.terminology

  const snapshot = sprint ? snapshots.find((s) => s.sprint_id === sprint.id) ?? null : null

  const set = useMemo(
    () => (sprint ? sprintMetrics({ sprint, snapshot, members, tasks, statuses, unit, now }) : null),
    [sprint, snapshot, members, tasks, statuses, unit, now],
  )

  const series = useMemo(
    () => (sprint ? burndownSeries({ sprint, samples: samples.filter((s) => s.sprint_id === sprint.id), unit, today }) : null),
    [sprint, samples, unit, today],
  )

  const vel = useMemo(
    () => velocity({ sprints: allSprints, snapshots, unit }),
    [allSprints, snapshots, unit],
  )

  if (!sprint) {
    return (
      <EmptyState
        title={`No ${sprintNoun(term)} selected`}
        description={`Pick a ${sprintNoun(term)} above to see how it went.`}
      />
    )
  }

  return (
    <div className="space-y-6">
      {!set ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">No recorded numbers for this {sprintNoun(term)}.</p>
            <p className="text-xs">
              It closed without a snapshot being written. Its numbers are deliberately not recomputed from
              today&apos;s work items: estimates, statuses and boards all move afterwards, so a recomputed
              figure would be a different number every time you looked. &quot;We have no record&quot; is the
              honest answer.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={set.source === 'frozen' ? 'secondary' : 'outline'}>
              {set.source === 'frozen' ? 'Frozen when it closed' : 'Live'}
            </Badge>
            {set.capacity !== null && (
              <span className="text-muted-foreground text-xs">
                Capacity {formatEstimate(set.capacity, set.unit)}
              </span>
            )}
            {set.cancelledCount > 0 && (
              <span className="text-muted-foreground text-xs">
                {set.cancelledCount} cancelled item{set.cancelledCount === 1 ? '' : 's'} - closed, but not counted as delivered
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" id="agile-metric-tiles">
            <MetricTile metric={set.committed} />
            <MetricTile metric={set.completed} />
            <MetricTile metric={set.carryover} />
            <MetricTile metric={set.scopeAdded} />
            <MetricTile metric={set.scopeRemoved} />
          </div>

          {series && (
            <div className="grid gap-4 lg:grid-cols-2">
              <SprintChart series={series} kind="burndown" title="Burndown" />
              <SprintChart series={series} kind="burnup" title="Burn-up" />
            </div>
          )}
        </>
      )}

      <section className="bg-card space-y-2 rounded-lg border p-4" id="agile-velocity">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Velocity</h3>
          <p className="text-xl font-semibold tabular-nums">{formatEstimate(vel.average, vel.unit)}</p>
        </header>
        <p className="text-muted-foreground text-xs">{explainVelocity(vel)}</p>
        <p className="text-muted-foreground text-xs">
          {METRIC_DEFINITIONS.velocity.formula} Excludes: {METRIC_DEFINITIONS.velocity.excludes}
          {' '}Last updated: {vel.lastUpdated ? new Date(vel.lastUpdated).toLocaleString() : 'never'}.
        </p>

        {vel.included.length > 0 && (
          <div>
            <p className="text-muted-foreground mt-2 text-xs font-medium uppercase">Counted</p>
            <ul className="text-sm">
              {vel.included.map((s) => (
                <li key={s.sprintId} className="flex justify-between gap-2">
                  <span className="truncate">{s.title}</span>
                  <span className="tabular-nums">{formatEstimate(s.completed, vel.unit)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {vel.excluded.length > 0 && (
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer text-xs font-medium uppercase">
              {vel.excluded.length} {sprintNounPlural(term)} excluded
            </summary>
            <ul className="mt-1 space-y-0.5">
              {vel.excluded.map((s) => (
                <li key={s.sprintId} className="text-muted-foreground text-xs">
                  <span className="text-foreground">{s.title}</span> &mdash; {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}
