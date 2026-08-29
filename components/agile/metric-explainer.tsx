'use client'

// The panel that travels with every number on this screen.
//
// Prompt G: "Every chart must expose: definition, formula, unit, included records, excluded
// records, last updated." That is rendered FROM THE VALUE - `MetricValue` carries its own
// definition, formula, unit, included ids, exclusions and timestamp - rather than from a
// caption written beside it. A caption drifts from the maths it describes; a field on the same
// object cannot. lib/work-next.ts already shipped a reason line computed from a different
// expression than its score, and once is enough.

import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { formatEstimate } from '@/lib/agile'
import { explainMetric, type MetricValue } from '@/lib/sprint-metrics'

function whenLabel(iso: string): string {
  // A plain absolute stamp, never "3 minutes ago": elapsed time computed during render makes
  // the server and the client disagree on every row (lib/use-now.ts exists for that case).
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString()
}

export function MetricExplainer({ metric }: { metric: MetricValue }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`How ${metric.label} is calculated`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{metric.label}</p>
          <Badge variant={metric.source === 'frozen' ? 'secondary' : 'outline'} className="text-[10px]">
            {metric.source === 'frozen' ? 'Frozen' : 'Live'}
          </Badge>
        </div>
        <dl className="space-y-2">
          <div>
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Definition</dt>
            <dd>{metric.definition}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Formula</dt>
            <dd>{metric.formula}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Unit</dt>
            <dd>{metric.unit}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Included records</dt>
            <dd>
              {metric.count} work item{metric.count === 1 ? '' : 's'}
              {metric.unestimated > 0 && (
                <>
                  {' '}&mdash;{' '}
                  <span className="text-amber-600 dark:text-amber-400">
                    {metric.unestimated} carr{metric.unestimated === 1 ? 'ies' : 'y'} no estimate and count as zero
                  </span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Excluded records</dt>
            <dd>{metric.excludes}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Last updated</dt>
            <dd>
              {whenLabel(metric.lastUpdated)}
              {metric.source === 'frozen'
                ? ' - frozen when this window closed, so it can no longer change.'
                : ' - live, so it moves as the work does.'}
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  )
}

/** A number with its explanation attached. The two are never rendered apart. */
export function MetricTile({ metric, showCount = true }: { metric: MetricValue; showCount?: boolean }) {
  return (
    // ⚠️ The whole explanation is on the tile as accessible text, not only inside a popover a
    // pointer has to open. Prompt G requires every chart to EXPOSE its definition, and a
    // disclosure that exists only behind a hover is exposed to some readers and not others.
    // `explainMetric` builds it from the same value the number came from.
    <div className="bg-card rounded-lg border p-3" role="group" aria-label={explainMetric(metric)}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <span>{metric.label}</span>
        <MetricExplainer metric={metric} />
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">{formatEstimate(metric.estimate, metric.unit)}</p>
      {showCount && (
        <p className="text-muted-foreground text-xs">
          {metric.count} item{metric.count === 1 ? '' : 's'}
          {metric.unestimated > 0 && `, ${metric.unestimated} unestimated`}
        </p>
      )}
    </div>
  )
}
