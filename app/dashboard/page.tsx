import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import UserDashboard from '@/components/user/user-dashboard'

export default async function DashboardPage() {
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

  // Fetch user's assigned tasks
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*, column:columns(title, board_id, board:boards(id, title))')
    .eq('assigned_to', user.id)
    .order('created_at', { ascending: false })

  // Fetch all boards
  const { data: boards } = await supabase
    .from('boards')
    .select('*')
    .order('created_at', { ascending: false })

  return <UserDashboard user={profile} tasks={tasks || []} boards={boards || []} />
}
