'use client'

// Burndown and burn-up, drawn as inline SVG.
//
// No chart library: two line series over at most ~30 points does not justify one, and a
// dependency here would have to be loaded on a page most of this workspace never opens.
//
// ⚠️ A DAY WITH NO SAMPLE IS A GAP, NOT A ZERO. This app runs one cron job a day on the Vercel
// Hobby plan and samples on open, so gaps are expected - and a gap drawn as zero renders a
// cliff that says the team finished everything overnight. The path breaks at every null, and
// the caption reports how many days are missing so the chart labels itself rather than lying
// quietly.

import { formatEstimate } from '@/lib/agile'
import type { BurndownSeries } from '@/lib/sprint-metrics'

const W = 640
const H = 200
const PAD = { top: 12, right: 12, bottom: 24, left: 44 }

function buildPath(points: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  points.forEach((value, i) => {
    if (value === null) { pen = false; return }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)} `
    pen = true
  })
  return d.trim()
}

export function SprintChart({
  series, kind, title,
}: { series: BurndownSeries; kind: 'burndown' | 'burnup'; title: string }) {
  const pts = series.points
  const n = Math.max(1, pts.length - 1)

  const values = pts.flatMap((p) => [p.remaining, p.completed, p.scope, p.ideal].filter((v): v is number => v !== null))
  const max = Math.max(1, ...values)

  const x = (i: number) => PAD.left + (i / n) * (W - PAD.left - PAD.right)
  const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom)

  const primary = kind === 'burndown'
    ? buildPath(pts.map((p) => p.remaining), x, y)
    : buildPath(pts.map((p) => p.completed), x, y)
  const secondary = kind === 'burndown'
    ? buildPath(pts.map((p) => p.ideal), x, y)
    : buildPath(pts.map((p) => p.scope), x, y)

  const primaryLabel = kind === 'burndown' ? 'Remaining' : 'Completed'
  const secondaryLabel = kind === 'burndown' ? 'Ideal' : 'Total scope'

  const hasData = pts.some((p) => (kind === 'burndown' ? p.remaining : p.completed) !== null)

  return (
    <figure className="bg-card space-y-2 rounded-lg border p-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">
          <span className="text-foreground">&mdash;</span> {primaryLabel}
          {'   '}
          <span className="text-muted-foreground">- -</span> {secondaryLabel}
        </span>
      </figcaption>

      {hasData ? (
        // ⚠️ Wide content scrolls inside its own container - the page body must never scroll
        // sideways, and a fixed-width SVG in a narrow card is the classic way it starts to.
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[20rem]"
            role="img"
            aria-label={`${title}. ${primaryLabel} starts at ${formatEstimate(series.startingScope, series.unit)}.`}
          >
            <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="stroke-border" strokeWidth={1} />
            <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} className="stroke-border" strokeWidth={1} />
            <text x={4} y={PAD.top + 4} className="fill-muted-foreground text-[10px]">{max}</text>
            <text x={4} y={H - PAD.bottom} className="fill-muted-foreground text-[10px]">0</text>
            <text x={PAD.left} y={H - 6} className="fill-muted-foreground text-[10px]">{pts[0]?.date.slice(5)}</text>
            <text x={W - PAD.right - 30} y={H - 6} className="fill-muted-foreground text-[10px]">{pts[pts.length - 1]?.date.slice(5)}</text>

            <path d={secondary} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 4" />
            <path d={primary} fill="none" className="stroke-primary" strokeWidth={2} />
          </svg>
        </div>
      ) : (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No samples yet. The first point appears once this window has work in it and the page has been opened.
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        {series.definition.definition} {series.definition.formula} Unit: {series.unit}.
        {' '}Excludes: {series.definition.excludes}
        {series.missingDays > 0 && (
          <>
            {' '}
            <span className="text-amber-700 dark:text-amber-400">
              {series.missingDays} day{series.missingDays === 1 ? '' : 's'} in this window have no sample and are drawn as gaps, not zeros.
            </span>
          </>
        )}
        {' '}Last updated: {series.lastUpdated ? new Date(series.lastUpdated).toLocaleString() : 'never'}.
      </p>
    </figure>
  )
}
