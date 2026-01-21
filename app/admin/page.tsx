import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminDashboard from '@/components/admin/admin-dashboard'

export default async function AdminPage() {
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

  if (!profile?.is_admin) {
    redirect('/dashboard')
  }

  // Fetch all data for admin dashboard
  const [
    { data: users },
    { data: boards },
    { data: tasks },
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('boards').select('*').order('created_at', { ascending: false }),
    supabase.from('tasks').select('*, assigned_to:profiles!tasks_assigned_to_fkey(full_name, email)').order('created_at', { ascending: false }),
  ])

  return <AdminDashboard user={profile} users={users || []} boards={boards || []} tasks={tasks || []} />
}
