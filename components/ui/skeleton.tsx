import { cn } from '@/lib/utils'

// Loading placeholder. The pulse is disabled under prefers-reduced-motion so the
// UI stays calm for motion-sensitive users (accessibility rule; see design-system.md).
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-accent motion-safe:animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
