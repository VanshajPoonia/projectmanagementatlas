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

  if (profile?.role === 'admin') {
    redirect('/admin')
  }

  const { data: tasksData } = await supabase
    .from('tasks')
    .select('*, task_assignees(user_id), column:columns(title, board_id, board:boards(id, title))')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  const tasks = tasksData ?? []

  // Fetch all boards
  const { data: boards } = await supabase
    .from('boards')
    .select('*')
    .order('created_at', { ascending: false })

  // Fetch all users for calendar display (to show who's assigned to tasks)
  const { data: users } = await supabase
    .from('profiles')
    .select('id, full_name, email')

  // Flatten board_id from nested structure for proper linking
  const tasksWithBoardId = tasks?.map(task => ({
    ...task,
    board_id: task.column?.board_id
  })) || []

  return <UserDashboard user={profile} tasks={tasksWithBoardId} boards={boards || []} users={users || []} />
}
