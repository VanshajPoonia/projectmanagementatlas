'use client'

// The small pieces every CRM screen shares.
//
// They live together so the module reads as one system: a status means the same colour on the
// dashboard, the client list and the order table, and a metric is laid out the same way
// wherever it appears. The alternative - each screen styling its own pill - is how a module
// ends up with four slightly different greens.

import { readableInk, withAlpha } from '@/lib/color'
import { useSurface } from '@/lib/use-surface'
import { cn } from '@/lib/utils'
import type { CrmStatus } from '@/lib/crm'

/**
 * A status as a pill, inked from the status's own configured colour.
 *
 * The colour is admin-configurable, so it cannot be trusted to be readable: it is tinted to
 * 12% for the fill and the label is contrast-corrected against that exact composite. Picking
 * a pale yellow in the status admin therefore produces a legible pill instead of a broken one.
 */
export function StatusPill({
  status,
  className,
}: {
  status: Pick<CrmStatus, 'label' | 'color'> | undefined
  className?: string
}) {
  const surface = useSurface()
  if (!status) return <span className="text-muted-foreground text-xs">-</span>

  const tint = surface.isDark ? 0.22 : 0.12
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{
        backgroundColor: withAlpha(status.color, tint),
        color: readableInk(status.color, mix(status.color, tint, surface.card)),
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      {status.label}
    </span>
  )
}

/** Local composite so the pill can measure contrast against what it actually paints. */
function mix(color: string, alpha: number, background: string): string {
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  const parse = (h: string) => ({
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  })
  if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(background)) return background
  const f = parse(color)
  const b = parse(background)
  return `#${hex(f.r * alpha + b.r * (1 - alpha))}${hex(f.g * alpha + b.g * (1 - alpha))}${hex(
    f.b * alpha + b.b * (1 - alpha),
  )}`
}

/**
 * One headline number.
 *
 * `tone` exists for the single case where a figure is bad news (orders past SLA). Everything
 * else stays neutral on purpose: if four tiles are all coloured, none of them is a signal.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'neutral' | 'alert' | 'positive'
}) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p
        className={cn(
          'mt-1 text-3xl font-semibold tracking-tight tabular-nums',
          tone === 'alert' && 'text-red-600 dark:text-red-400',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </div>
  )
}

/** A labelled field in a read-only detail column. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children || <span className="text-muted-foreground">-</span>}</dd>
    </div>
  )
}
