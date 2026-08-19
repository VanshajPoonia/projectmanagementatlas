import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface MarketingCalendarSummary {
  id: string
  name: string
  color: string
  is_archived: boolean
}

// RLS on marketing_calendars already scopes this to "every calendar for admins, only mine for
// everyone else" (private.is_calendar_member), so no extra client-side filtering is needed here.
// Includes archived calendars - consumers filter by is_archived for their own purpose (the
// switcher shows active only, the management UI splits into active/archived sections).
/**
 * Pass `initial` (from `loadShellData` on the server) wherever the host can.
 *
 * Membership decides whether a non-admin sees the Marketing section at all, so fetching this
 * on mount meant their sidebar rendered without it and then grew an entry - the nav visibly
 * changing shape under the cursor a moment after the page appeared.
 *
 * The seed is the starting value only, not the truth for the lifetime of the hook: unlike
 * modules, this list is edited from inside the app (Manage Calendars), and `refetch` has to
 * be able to replace it.
 */
export function useMarketingCalendars(initial?: MarketingCalendarSummary[] | null) {
  const [calendars, setCalendars] = useState<MarketingCalendarSummary[]>(initial ?? [])
  // A seeded host is not waiting on anything, so it must not report `loading` - the marketing
  // screen renders a spinner off this and would have flashed one over correct data.
  const [loading, setLoading] = useState(initial === undefined || initial === null)

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('marketing_calendars')
      .select('id, name, color, is_archived')
      .order('name', { ascending: true })
    setCalendars(data ?? [])
  }, [])

  const seeded = initial !== undefined && initial !== null
  useEffect(() => {
    if (seeded) return
    let active = true
    refetch().finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [refetch, seeded])

  return { calendars, loading, refetch }
}
