'use client'

import Link from 'next/link'
import { Bell } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useInboxCount } from './use-inbox-count'

/**
 * The Inbox entry point in the topbar.
 *
 * One button, always the same width whatever the count says, because the topbar has run out of
 * room twice already in this codebase and a control that grows with its data is the one that
 * does it a third time. The badge is absolutely positioned for the same reason.
 *
 * ⚠️ The count is announced, not just drawn. A red dot is invisible to a screen reader, and
 * "3 unread" in the accessible name is the only version of this control some people get.
 */
export function InboxBell({ userId, className }: { userId?: string | null; className?: string }) {
  const { unread } = useInboxCount(userId)

  if (!userId) return null

  const label = unread === 0 ? 'Inbox, nothing unread' : `Inbox, ${unread} unread`

  return (
    <Link
      href="/inbox"
      aria-label={label}
      title={label}
      data-testid="inbox-bell"
      data-unread={unread}
      // ⚠️ `data-slot="button"` is what app/globals.css's `@media (pointer: coarse)` rule
      // matches to give a real control a 44px minimum height. A bare `<a>` is deliberately NOT
      // matched there - the old rule turned every inline link inside a sentence into a 44px
      // block - so a link that IS a button has to say so. Without it this measures 36px on a
      // phone, on every screen in the app.
      data-slot="button"
      className={cn(
        'text-muted-foreground hover:text-foreground focus-visible:ring-ring relative inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors outline-none hover:bg-accent focus-visible:ring-2',
        className,
      )}
    >
      <Bell className="size-4" aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
