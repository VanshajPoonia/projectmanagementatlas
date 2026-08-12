'use client'

import * as React from 'react'
import { Lock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { CapabilityDecision } from '@/lib/capabilities'

// "Never leave a user wondering whether a feature is broken, disabled, or simply not
// theirs." Two shapes, matching the two presentations a CapabilityDecision can ask for:
//
//   hide    — the action is irrelevant to this role; rendering it is noise
//   explain — the user can see the thing, so the restriction is worth stating
//
// A disabled control swallows pointer events, so the tooltip has to hang off a wrapper
// rather than the control itself; the wrapper is focusable so keyboard users reach the
// explanation too.

interface ActionGuardProps {
  decision: CapabilityDecision
  children: React.ReactNode
  /** Rendered instead of the tooltip wrapper when the decision is 'hide'. */
  fallback?: React.ReactNode
  className?: string
}

export function ActionGuard({ decision, children, fallback = null, className }: ActionGuardProps) {
  if (decision.allowed) return <>{children}</>
  if (decision.presentation === 'hide' || !decision.reason) return <>{fallback}</>

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="note"
            aria-label={decision.reason}
            className={cn('inline-flex rounded-md outline-none focus-visible:ring-ring focus-visible:ring-2', className)}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{decision.reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * The visible variant: a short inline sentence for a whole region that has been put into
 * read-only mode. A tooltip is too easy to miss when *every* field on a screen is
 * disabled — at that point the user needs to be told once, plainly, why.
 */
export function RestrictionNote({
  decision,
  className,
}: {
  decision: CapabilityDecision
  className?: string
}) {
  if (decision.allowed || decision.presentation !== 'explain' || !decision.reason) return null

  return (
    <p
      className={cn(
        'text-muted-foreground bg-muted/40 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        className,
      )}
    >
      <Lock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{decision.reason}</span>
    </p>
  )
}

/**
 * Wrap a handler so a denied action cannot run even if its control is somehow reachable
 * (a stale render, a keyboard path around `disabled`, a command fired from the palette).
 * Returns undefined when denied, which also leaves the control genuinely inert.
 *
 * This is a UX backstop, not a security control — RLS is what actually refuses the write.
 */
export function guardAction<T extends (...args: never[]) => unknown>(
  decision: CapabilityDecision,
  handler: T,
): T | undefined {
  return decision.allowed ? handler : undefined
}
