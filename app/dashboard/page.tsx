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

  // Fetch tasks where the user is one of the assignees (multi-assignee, all equal).
  // Union task_assignees with the legacy assigned_to so it works regardless of
  // whether the backfill (scripts/028) has run yet.
  const [{ data: assigneeRows }, { data: legacyRows }] = await Promise.all([
    supabase.from('task_assignees').select('task_id').eq('user_id', user.id),
    supabase.from('tasks').select('id').eq('assigned_to', user.id),
  ])
  const assignedTaskIds = Array.from(
    new Set([
      ...(assigneeRows ?? []).map((r) => r.task_id),
      ...(legacyRows ?? []).map((r) => r.id),
    ])
  )

  let tasks: any[] = []
  if (assignedTaskIds.length > 0) {
    const { data } = await supabase
      .from('tasks')
      .select('*, task_assignees(user_id), column:columns(title, board_id, board:boards(id, title))')
      .in('id', assignedTaskIds)
      .order('created_at', { ascending: false })
    tasks = data ?? []
  }

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
