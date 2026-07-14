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

  if (profile?.role !== 'admin' && profile?.role !== 'super_admin') {
    redirect('/dashboard')
  }

  // Fetch all data for admin dashboard
  const [
    { data: users },
    { data: boards },
    { data: tasks },
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('boards').select('*, creator:profiles!boards_created_by_fkey(full_name, email)').is('archived_at', null).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*, column:columns(board_id), task_assignees(user_id), task_tags(tag:tags(*))').is('deleted_at', null).order('created_at', { ascending: false }),
  ])

  // Flatten board_id from nested column object, dropping tasks whose board is archived
  const activeBoardIds = new Set((boards || []).map(board => board.id))
  const tasksWithBoardId = (tasks || [])
    .filter(task => activeBoardIds.has(task.column?.board_id))
    .map(task => ({
      ...task,
      board_id: task.column?.board_id
    }))

  return <AdminDashboard user={profile} users={users || []} boards={boards || []} tasks={tasksWithBoardId} />
}
