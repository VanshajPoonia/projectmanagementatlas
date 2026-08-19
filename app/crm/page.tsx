import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CrmDashboard } from '@/components/crm/crm-dashboard'
import { requireCrmAccess } from './access'

/**
 * CRM dashboard: the operating picture. Everything on it is derived from crm_orders and
 * crm_order_status_history - nothing is stored pre-aggregated, so the numbers cannot drift
 * away from the records they claim to summarise.
 */
export default async function CrmPage() {
  const supabase = await createClient()
  const access = await requireCrmAccess(supabase)
  if (!access) redirect('/dashboard')

  // Errors kept, not dropped - see app/crm/orders/page.tsx. A dashboard that renders zeros
  // on a failed read is the worst version of this defect: every number on it is a claim.
  const results = await Promise.all([
      // Every status, archived included. An order can still be sitting in an archived one, and
      // a status missing from the lookup map reads as "not terminal" - which would have counted
      // every won order as live pipeline the day someone archived Won. Pickers filter, queries
      // do not. See activeStatuses() in lib/crm.ts.
      supabase.from('crm_statuses').select('*').order('position'),
      supabase.from('crm_orders').select('*').order('opened_at', { ascending: false }),
      // Only the open intervals are needed for aging and SLA; the closed ones are for
      // reporting, which is its own page and its own query.
      supabase.from('crm_order_status_history').select('*').is('exited_at', null),
      supabase.from('crm_clients').select('id, client_ref, company_name, status, crm_contacts(*)'),
    ])

  const [{ data: statuses }, { data: orders }, { data: history }, { data: clients }] = results
  const loadFailed = results.some((result) => result.error)

  return (
    <CrmDashboard
      user={access.profile}
      shell={access.shell}
      statuses={statuses ?? []}
      orders={orders ?? []}
      openIntervals={history ?? []}
      clients={clients ?? []}
      serverNow={new Date().toISOString()}
      loadFailed={loadFailed}
    />
  )
}
