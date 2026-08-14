import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CrmOrdersView } from '@/components/crm/crm-orders-view'
import { requireCrmAccess } from '../access'

export default async function CrmOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const supabase = await createClient()
  const access = await requireCrmAccess(supabase)
  if (!access) redirect('/dashboard')

  const { status } = await searchParams

  const [{ data: orders }, { data: statuses }, { data: clients }, { data: profiles }, { data: open }] =
    await Promise.all([
      supabase.from('crm_orders').select('*').order('opened_at', { ascending: false }),
      // All statuses; the pickers filter. See lib/crm.ts activeStatuses().
      supabase.from('crm_statuses').select('*').order('position'),
      supabase.from('crm_clients').select('id, client_ref, company_name, crm_contacts(*)'),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
      supabase.from('crm_order_status_history').select('*').is('exited_at', null),
    ])

  return (
    <CrmOrdersView
      user={access.profile}
      orders={orders ?? []}
      statuses={statuses ?? []}
      clients={clients ?? []}
      profiles={profiles ?? []}
      openIntervals={open ?? []}
      initialStatus={status ?? null}
      serverNow={new Date().toISOString()}
    />
  )
}
