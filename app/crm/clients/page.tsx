import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CrmClientsView } from '@/components/crm/crm-clients-view'
import { requireCrmAccess } from '../access'

export default async function CrmClientsPage() {
  const supabase = await createClient()
  const access = await requireCrmAccess(supabase)
  if (!access) redirect('/dashboard')

  const [{ data: clients }, { data: statuses }, { data: profiles }] = await Promise.all([
    supabase
      .from('crm_clients')
      .select('*, crm_contacts(*)')
      .order('last_activity_at', { ascending: false }),
    // All statuses; the pickers filter. See lib/crm.ts activeStatuses().
    supabase.from('crm_statuses').select('*').order('position'),
    supabase.from('profiles').select('id, full_name, email').order('full_name'),
  ])

  return (
    <CrmClientsView
      user={access.profile}
      shell={access.shell}
      clients={clients ?? []}
      statuses={statuses ?? []}
      profiles={profiles ?? []}
    />
  )
}
