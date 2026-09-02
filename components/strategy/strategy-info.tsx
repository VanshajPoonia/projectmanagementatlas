'use client'

// The "what is this?" affordance for the strategy module.
//
// Same shape as AgileInfoButton and for the same reason: one guide, rendered by one shared
// dialog, on every surface where somebody could be looking at this and wondering what it is.

import { GuideDialog } from '@/components/shell/guide-dialog'
import { STRATEGY_GUIDE } from '@/lib/strategy-guide'

export function StrategyInfoButton({
  className,
  label,
  id = 'strategy-info-button',
}: {
  className?: string
  label?: string
  id?: string
}) {
  return (
    <GuideDialog
      guide={STRATEGY_GUIDE}
      heading="How strategy works"
      className={className}
      label={label}
      id={id}
    />
  )
}
