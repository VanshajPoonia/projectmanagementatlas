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
// Includes archived calendars — consumers filter by is_archived for their own purpose (the
// switcher shows active only, the management UI splits into active/archived sections).
export function useMarketingCalendars() {
  const [calendars, setCalendars] = useState<MarketingCalendarSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('marketing_calendars')
      .select('id, name, color, is_archived')
      .order('name', { ascending: true })
    setCalendars(data ?? [])
  }, [])

  useEffect(() => {
    let active = true
    refetch().finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [refetch])

  return { calendars, loading, refetch }
}
