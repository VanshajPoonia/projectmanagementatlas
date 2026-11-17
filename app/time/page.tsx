import { redirect } from 'next/navigation'

import TimeLogView from '@/components/time/time-log-view'
import { isModuleEnabledOnServer } from '@/lib/module-registry'
import { loadShellData } from '@/lib/shell-data'
import { createClient } from '@/lib/supabase/server'
import type { TimeEntry } from '@/lib/time-tracking'

/** The viewer's own hours. RLS on time_entries already limits rows to the owner. */
export default async function TimePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (!(await isModuleEnabledOnServer(supabase, 'time_tracking'))) redirect('/my-work')

  const [{ data: profile }, { data: entries }, shell] = await Promise.all([
    supabase.from('profiles').select('id, role, full_name, email').eq('id', user.id).single(),
    supabase
      .from('time_entries')
      .select('id, started_at, ended_at, note')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(2000),
    loadShellData(supabase),
  ])

  return (
    <TimeLogView
      user={{ id: user.id, role: profile?.role, full_name: profile?.full_name, email: profile?.email ?? user.email }}
      initialEntries={(entries ?? []) as TimeEntry[]}
      shell={shell}
      now={new Date().toISOString()}
    />
  )
}
