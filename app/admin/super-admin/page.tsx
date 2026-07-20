import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SuperAdminDashboard from '@/components/admin/super-admin-dashboard'

export default async function SuperAdminPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'super_admin') {
    redirect('/admin')
  }

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return <SuperAdminDashboard users={users || []} currentUserId={user.id} />
}
