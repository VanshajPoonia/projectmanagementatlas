'use client'

// The two progress figures, side by side, never combined.
//
// ⚠️ THIS COMPONENT IS THE POINT OF PROMPT H. "Display separately: execution progress... and
// outcome progress... Never imply they are the same." So the two bars are:
//   * always both rendered, even when one is unavailable, so a missing figure reads as
//     missing rather than as the other one;
//   * differently coloured and separately labelled, never stacked into one track;
//   * never averaged, and there is no prop here that could produce a single number.
//
// Each bar carries its own explanation - definition, formula, what it counted, what it left
// out - built from the value object rather than written beside it. A caption written beside a
// number drifts from the maths that produced it; a field on the same object cannot.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  explainExecution, explainOutcome, formatMeasure, progressDivergence,
  type ExecutionProgress, type OutcomeProgress,
} from '@/lib/goals'

function Bar({ percent, tone }: { percent: number | null; tone: 'work' | 'result' }) {
  return (
    <div
      className="bg-muted h-2 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      // A bar with no value still needs a name, or a screen reader announces a silent 0%.
      aria-label={tone === 'work' ? 'Work done' : 'Result'}
      aria-valuetext={percent === null ? 'Not available' : `${percent}%`}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all',
          // Two visually distinct tracks. Colour is never the only cue - each has its own
          // heading and its own number - but sharing one colour would invite them to be read
          // as two halves of one thing.
          tone === 'work' ? 'bg-primary' : 'bg-emerald-500 dark:bg-emerald-400',
        )}
        style={{ width: `${percent ?? 0}%` }}
      />
    </div>
  )
}

export function ProgressPair({
  execution,
  outcome,
  id,
}: {
  execution: ExecutionProgress
  outcome: OutcomeProgress
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const divergence = progressDivergence(execution, outcome)

  return (
    <div className="space-y-3" id={id}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Work done</span>
            <span className="text-sm tabular-nums">
              {execution.percent === null ? 'Nothing linked' : `${execution.percent}%`}
            </span>
          </div>
          <Bar percent={execution.percent} tone="work" />
          <p className="text-muted-foreground text-xs">
            {execution.total === 0
              ? 'Link projects or work items to see this.'
              : `${execution.closed} of ${execution.total} linked work item${execution.total === 1 ? '' : 's'} finished.`}
            {execution.unresolved > 0 && ` ${execution.unresolved} not visible to you.`}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Result</span>
            <span className="text-sm tabular-nums">
              {outcome.percent === null ? 'Not measured' : `${outcome.percent}%`}
            </span>
          </div>
          <Bar percent={outcome.percent} tone="result" />
          <p className="text-muted-foreground text-xs">
            {outcome.unavailableReason
              ?? `${formatMeasure(outcome.current, outcome.unit)} of the way from ${formatMeasure(outcome.start, outcome.unit)} to ${formatMeasure(outcome.target, outcome.unit)}.`}
          </p>
        </div>
      </div>

      {divergence && (
        <p
          className={cn(
            'rounded-md border-l-2 px-3 py-2 text-sm leading-relaxed',
            divergence.tone === 'warning'
              ? 'border-amber-500 bg-amber-500/5'
              : 'border-sky-500 bg-sky-500/5',
          )}
          id={id ? `${id}-divergence` : undefined}
        >
          {divergence.message}
        </p>
      )}

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 h-7 px-2 text-xs"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          id={id ? `${id}-explain` : undefined}
        >
          <ChevronDown className={cn('mr-1 h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          How these are worked out
        </Button>
        {open && (
          <dl className="text-muted-foreground mt-2 space-y-2 text-xs leading-relaxed">
            <div>
              <dt className="text-foreground font-medium">Work done</dt>
              <dd>{explainExecution(execution)}</dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Result</dt>
              <dd>{explainOutcome(outcome)}</dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Why they are separate</dt>
              <dd>
                A project can finish every task and still fail its outcome. Averaging the two
                would hide exactly that case, so this page never shows a single progress figure
                for a goal.
              </dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}
