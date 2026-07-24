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
    supabase.from('boards').select('*, creator:profiles!boards_created_by_fkey(full_name, email), editor:profiles!boards_updated_by_fkey(full_name, email)').is('archived_at', null).order('created_at', { ascending: false }),
    // Subtasks included so an admin's own assigned subtasks reach their dashboard;
    // AdminDashboard splits them back out for the aggregate views (see topLevelTasks).
    supabase.from('tasks').select('*, column:columns(board_id, status_key), task_assignees(user_id), task_tags(tag:tags(*))').is('deleted_at', null).order('created_at', { ascending: false }),
  ])

  // Resolved locally rather than via a PostgREST embed — parent_task_id is a
  // self-referencing foreign key, where the `!hint` is ambiguous between the parent
  // (to-one) and children (to-many) directions, and the wrong one yields an array.
  const titleById = new Map((tasks || []).map(task => [task.id, task.title]))

  // Flatten board_id from nested column object, dropping tasks whose board is archived
  const activeBoardIds = new Set((boards || []).map(board => board.id))
  const tasksWithBoardId = (tasks || [])
    .filter(task => activeBoardIds.has(task.column?.board_id))
    .map(task => ({
      ...task,
      board_id: task.column?.board_id,
      parent: task.parent_task_id
        ? { id: task.parent_task_id, title: titleById.get(task.parent_task_id) ?? null }
        : null,
    }))

  return <AdminDashboard user={profile} users={users || []} boards={boards || []} tasks={tasksWithBoardId} />
}
