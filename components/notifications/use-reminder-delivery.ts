'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Fire the signed-in user's own due reminders while the app is open.
 *
 * ⚠️ THIS EXISTS BECAUSE OF A HOSTING LIMIT, NOT A DESIGN PREFERENCE.
 * The Vercel project is on the Hobby plan, where cron jobs run at most once a day. The nightly
 * sweep at /api/cron/scheduled-work therefore cannot honour a "30 minutes before" reminder, and
 * shipping that option while it silently fired up to 24 hours late would be precisely the kind
 * of control-wired-to-nothing that migrations 116 and 117 were written to end. So the app
 * delivers its own user's reminders as it goes.
 *
 * It calls `deliver_my_due_reminders()` (migration 117), which is scoped to auth.uid() with no
 * parameter that could widen it - that is what makes it safe to expose to a client at all, when
 * the full sweep is revoked from every client role. It returns a count and nothing else.
 *
 * Idempotent, so it cannot collide with the nightly sweep or with a second tab: delivery claims
 * each reminder by stamping delivered_at inside the same statement that reads it, so whichever
 * caller gets there first is the only one that delivers.
 *
 * The delivered rows land in `task_notifications`, which TaskNotificationToasts already reads -
 * so a reminder surfaces through the same path as every other notification rather than
 * inventing a second one.
 */

/**
 * Five minutes. Frequent enough that the finest-grained reminder offered (30 minutes) is never
 * meaningfully late, and rare enough to be invisible - one RPC returning a single integer.
 */
const INTERVAL_MS = 5 * 60 * 1000

export function useReminderDelivery(userId: string | null | undefined) {
  const running = useRef(false)

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    let cancelled = false

    const deliver = async () => {
      // A slow call must not stack up behind itself when the tab has been backgrounded and
      // the browser fires several timers at once.
      if (running.current) return
      running.current = true
      try {
        await supabase.rpc('deliver_my_due_reminders')
      } catch {
        // Deliberately silent. This is background upkeep the user did not ask for; a toast
        // saying "could not check reminders" is noise about a thing they cannot act on, and
        // the nightly sweep is the backstop.
      } finally {
        running.current = false
      }
    }

    // Once on mount, so opening the app shows anything that came due while it was closed.
    deliver()
    const timer = setInterval(() => { if (!cancelled) deliver() }, INTERVAL_MS)

    // Coming back to a tab that has been open all afternoon should not wait out the interval.
    const onVisible = () => { if (document.visibilityState === 'visible') deliver() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId])
}
