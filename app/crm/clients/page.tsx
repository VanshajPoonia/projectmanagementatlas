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
    supabase.from('crm_statuses').select('*').eq('is_archived', false).order('position'),
    supabase.from('profiles').select('id, full_name, email').order('full_name'),
  ])

  return (
    <CrmClientsView
      user={access.profile}
      clients={clients ?? []}
      statuses={statuses ?? []}
      profiles={profiles ?? []}
    />
  )
}
