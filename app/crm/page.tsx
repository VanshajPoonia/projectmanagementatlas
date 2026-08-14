import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CrmDashboard } from '@/components/crm/crm-dashboard'
import { requireCrmAccess } from './access'

/**
 * CRM dashboard: the operating picture. Everything on it is derived from crm_orders and
 * crm_order_status_history — nothing is stored pre-aggregated, so the numbers cannot drift
 * away from the records they claim to summarise.
 */
export default async function CrmPage() {
  const supabase = await createClient()
  const access = await requireCrmAccess(supabase)
  if (!access) redirect('/dashboard')

  const [{ data: statuses }, { data: orders }, { data: history }, { data: clients }] =
    await Promise.all([
      supabase.from('crm_statuses').select('*').eq('is_archived', false).order('position'),
      supabase.from('crm_orders').select('*').order('opened_at', { ascending: false }),
      // Only the open intervals are needed for aging and SLA; the closed ones are for
      // reporting, which is its own page and its own query.
      supabase.from('crm_order_status_history').select('*').is('exited_at', null),
      supabase.from('crm_clients').select('id, client_ref, company_name, status, crm_contacts(*)'),
    ])

  return (
    <CrmDashboard
      user={access.profile}
      statuses={statuses ?? []}
      orders={orders ?? []}
      openIntervals={history ?? []}
      clients={clients ?? []}
      serverNow={new Date().toISOString()}
    />
  )
}
