import * as React from 'react'
import { AlertTriangle, Inbox, Lock } from 'lucide-react'

import { cn } from '@/lib/utils'

// Shared calm-state primitives for the shell. Every major destination owes the viewer
// four of these - loading, empty, error, permission denied - because the alternative is
// a blank screen that could mean any of them.
//
// All of them pair an icon with text: colour is never the only cue.

interface StateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

/**
 * The empty state answers three questions, in this order:
 *   1. what is this screen
 *   2. why does it matter
 *   3. what is the first useful thing to do
 *
 * `title` covers (1), `description` covers (2), `action` covers (3). A screen that only
 * says "Nothing here" has answered none of them.
 */
export function EmptyState({ icon, title, description, action, className }: StateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center',
        className,
      )}
    >
      <div className="text-muted-foreground [&_svg]:size-8" aria-hidden="true">
        {icon ?? <Inbox />}
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function PermissionDenied({
  title = 'You don’t have access to this',
  description = 'Ask an admin if you think you should. Server-side rules still apply regardless of what the interface shows.',
  action,
  className,
}: Partial<StateProps>) {
  return (
    <EmptyState
      className={className}
      icon={<Lock />}
      title={title}
      description={description}
      action={action}
    />
  )
}

/**
 * Something failed. Says what broke, whether the previous state is still safe, and
 * offers a retry - a bare "Something went wrong" leaves the user unable to decide
 * whether to try again or stop touching it.
 */
export function ErrorState({
  title = 'That didn’t load',
  description = 'Nothing was changed. You can try again, and if it keeps failing the data is still safe on the server.',
  action,
  className,
}: Partial<StateProps>) {
  return (
    <EmptyState
      className={cn('border-destructive/40', className)}
      icon={<AlertTriangle />}
      title={title}
      description={description}
      action={action}
    />
  )
}

/**
 * Skeleton rows for a loading list. Deliberately shaped like the content that replaces
 * it so the layout doesn't jump, and `motion-safe` so a reduced-motion preference stops
 * the pulse rather than being overridden by it.
 */
export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-muted h-16 rounded-lg motion-safe:animate-pulse"
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
