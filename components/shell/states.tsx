import * as React from 'react'
import { Lock, Inbox } from 'lucide-react'

import { cn } from '@/lib/utils'

// Shared calm-state primitives for the shell: empty and permission-denied. Both are
// icon + text (never colour alone) and centre within their container.

interface StateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

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
