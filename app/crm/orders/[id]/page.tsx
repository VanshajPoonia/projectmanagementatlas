import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CrmStatusControl } from '@/components/crm/crm-status-control'
import { requireCrmAccess } from '../../access'

export default async function CrmOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireCrmAccess(supabase)
  if (!access) redirect('/dashboard')

  const { id } = await params

  const { data: order } = await supabase.from('crm_orders').select('*').eq('id', id).maybeSingle()
  // RLS returns nothing for a row the viewer cannot see, which is indistinguishable from a
  // row that does not exist — and should be, so 404 is the right answer to both.
  if (!order) notFound()

  const [{ data: client }, { data: statuses }, { data: history }, { data: profiles }] =
    await Promise.all([
      supabase.from('crm_clients').select('*, crm_contacts(*)').eq('id', order.client_id).maybeSingle(),
      supabase.from('crm_statuses').select('*').order('position'),
      supabase
        .from('crm_order_status_history')
        .select('*')
        .eq('order_id', id)
        .order('entered_at', { ascending: true }),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
    ])

  return (
    <CrmStatusControl
      user={access.profile}
      shell={access.shell}
      order={order}
      client={client ?? null}
      statuses={statuses ?? []}
      history={history ?? []}
      profiles={profiles ?? []}
      serverNow={new Date().toISOString()}
    />
  )
}
