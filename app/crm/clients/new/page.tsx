import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CrmIntakeForm } from '@/components/crm/crm-intake-form'
import { requireCrmAccess } from '../../access'

export default async function CrmIntakePage() {
  const supabase = await createClient()
  const access = await requireCrmAccess(supabase)
  if (!access) redirect('/dashboard')

  const [{ data: statuses }, { data: profiles }] = await Promise.all([
    supabase.from('crm_statuses').select('*').eq('is_archived', false).order('position'),
    supabase.from('profiles').select('id, full_name, email').order('full_name'),
  ])

  return (
    <CrmIntakeForm user={access.profile} statuses={statuses ?? []} profiles={profiles ?? []} />
  )
}
