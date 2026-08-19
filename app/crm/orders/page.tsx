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

  // ⚠️ Errors are kept. Destructuring `{ data }` alone made every failure render as an
  // empty CRM - no orders, no clients, no pipeline - which is indistinguishable from a
  // quiet week and considerably more alarming once someone acts on it.
  const results = await Promise.all([
      supabase.from('crm_orders').select('*').order('opened_at', { ascending: false }),
      // All statuses; the pickers filter. See lib/crm.ts activeStatuses().
      supabase.from('crm_statuses').select('*').order('position'),
      supabase.from('crm_clients').select('id, client_ref, company_name, crm_contacts(*)'),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
      supabase.from('crm_order_status_history').select('*').is('exited_at', null),
    ])

  const [{ data: orders }, { data: statuses }, { data: clients }, { data: profiles }, { data: open }] = results
  const loadFailed = results.some((result) => result.error)

  return (
    <CrmOrdersView
      user={access.profile}
      shell={access.shell}
      orders={orders ?? []}
      statuses={statuses ?? []}
      clients={clients ?? []}
      profiles={profiles ?? []}
      openIntervals={open ?? []}
      initialStatus={status ?? null}
      serverNow={new Date().toISOString()}
      loadFailed={loadFailed}
    />
  )
}
