'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { boardHref } from '@/components/shell/workspace-nav'
import { fetchInboxData, markNotificationsRead } from '@/lib/notifications-data'
import {
  filterInbox,
  groupNotificationBursts,
  notificationHref,
  notificationTypeLabel,
} from '@/lib/notifications'
import { notifyInboxChanged } from '@/lib/notification-events'
import { useReminderDelivery } from './use-reminder-delivery'

interface TaskNotificationToastsProps {
  userId: string
  // Board routes are mirrored under /admin and /dashboard, so the toast has to open the one
  // this viewer is actually allowed to load.
  isAdmin?: boolean
}

/** At most this many toasts on one page load. More than this is a wall, not a notification. */
const MAX_TOASTS = 5

export default function TaskNotificationToasts({ userId, isAdmin = false }: TaskNotificationToastsProps) {
  const shownRef = useRef(false)
  const router = useRouter()

  // Personal reminders (117) are delivered INTO task_notifications, so the component that
  // already surfaces notifications is the right place to make sure they exist. See the hook's
  // header for why the app has to do this rather than leaving it entirely to the nightly cron.
  useReminderDelivery(userId)

  useEffect(() => {
    if (shownRef.current) return
    shownRef.current = true

    const supabase = createClient()

    // Marking read is per-notification and tied to a toast actually finishing its time on
    // screen, rather than the bulk write this component used to fire the moment the query
    // returned. The old version consumed every notification on page load whether or not
    // anyone saw it: on production that left the two people who use the app daily with zero
    // unread rows, while everyone else still had every row they were ever sent.
    //
    // `ids` rather than one id, because a burst is one toast standing for several
    // notifications - dismissing it must clear all of them or the inbox count disagrees with
    // what the person just read.
    const markRead = async (ids: string[]) => {
      await markNotificationsRead(supabase, ids, new Date())
      // Dismissing a toast is the other way a notification becomes read, so the badge has to
      // hear about it too.
      notifyInboxChanged()
    }

    const load = async () => {
      // ⚠️ The SAME read as the inbox, deliberately. A separate hand-written query here is how
      // the two would end up disagreeing about mutes - and a "muted" board that still
      // interrupts you with a toast is worse than no mute button at all.
      const data = await fetchInboxData(supabase, userId)
      if (data.failed) return

      const entries = groupNotificationBursts(
        filterInbox(data.notifications, data.mutes, new Date(), { read: 'unread', scope: 'inbox' }),
      ).slice(0, MAX_TOASTS)

      for (const entry of entries) {
        const n = entry.latest
        const href = notificationHref(n.boardId ? boardHref(isAdmin ? 'admin' : 'user', n.boardId) : null, n)

        toast.info(notificationTypeLabel(n.type), {
          description: entry.grouped ? `${n.message} (+${entry.count - 1} more)` : n.message,
          // Offer no action when there is nowhere specific to go, rather than an "Open"
          // button that lands on the dashboard.
          action: href
            ? {
                label: 'Open',
                onClick: () => {
                  markRead(entry.ids)
                  router.push(href)
                },
              }
            : undefined,
          onAutoClose: () => markRead(entry.ids),
          onDismiss: () => markRead(entry.ids),
        })
      }
    }

    load()
  }, [userId, isAdmin, router])

  return null
}
