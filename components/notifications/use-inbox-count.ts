'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchInboxData } from '@/lib/notifications-data'
import { inboxCounts } from '@/lib/notifications'
import { INBOX_CHANGED_EVENT } from '@/lib/notification-events'

/**
 * The unread badge on the topbar's Inbox bell.
 *
 * ⚠️ It counts what `filterInbox` would SHOW, not `count(*) where read_at is null`. A cheap
 * server-side count would include muted and snoozed rows, so the badge would say 7 and the
 * screen would show 2 - and a badge that disagrees with the page is one people stop believing,
 * which defeats the only thing a badge is for. Muting and snoozing are read-time rules
 * (migration 120's header says why), so the count has to apply them too.
 *
 * Polls on the same cadence and the same triggers as the reminder delivery hook next to it -
 * mount, an interval, and coming back to the tab - rather than opening a realtime channel for
 * a number.
 */
const INTERVAL_MS = 2 * 60 * 1000

export function useInboxCount(userId: string | null | undefined) {
  const [counts, setCounts] = useState({ unread: 0, actionRequired: 0 })

  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      const data = await fetchInboxData(createClient(), userId)
      // A failed read must not silently reset the badge to zero: "nothing is waiting on you"
      // is a claim, and a broken query is not evidence for it.
      if (data.failed) return
      const next = inboxCounts(data.notifications, data.mutes, new Date())
      setCounts({ unread: next.unread, actionRequired: next.actionRequired })
    } catch {
      // Background upkeep nobody asked for; a toast about it is noise they cannot act on.
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const run = () => { if (!cancelled) refresh() }

    run()
    const timer = setInterval(run, INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)

    // The Inbox screen says when it has changed something. Without this, marking everything
    // read left the page empty and the badge still claiming three unread until the next poll -
    // and a badge that disagrees with the page in front of you is one nobody believes again.
    window.addEventListener(INBOX_CHANGED_EVENT, run)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(INBOX_CHANGED_EVENT, run)
    }
  }, [userId, refresh])

  return { ...counts, refresh }
}
