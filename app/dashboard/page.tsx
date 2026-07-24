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

  if (profile?.role === 'admin' || profile?.role === 'super_admin') {
    redirect('/admin')
  }

  // Subtasks are included so work assigned at subtask level still reaches the person
  // doing it. The dashboard narrows which of them count as yours (see `myTasks` in
  // UserDashboard).
  const { data: tasksData } = await supabase
    .from('tasks')
    .select('*, task_assignees(user_id), column:columns(title, status_key, board_id, board:boards(id, title, archived_at))')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  const tasks = tasksData ?? []

  // Fetch all boards (archived boards are hidden from non-admins)
  const { data: boards } = await supabase
    .from('boards')
    .select('*, creator:profiles!boards_created_by_fkey(full_name, email), editor:profiles!boards_updated_by_fkey(full_name, email)')
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  // Fetch all users for calendar display (to show who's assigned to tasks)
  const { data: users } = await supabase
    .from('profiles')
    .select('id, full_name, email')

  // Parent titles are resolved here rather than with a PostgREST embed: parent_task_id
  // is a self-referencing foreign key, where the `!hint` syntax is ambiguous between
  // the parent (to-one) and children (to-many) directions. Getting that wrong yields an
  // array instead of an object and the breadcrumb silently disappears. Every task is
  // already in hand, so a local lookup is both cheaper and unambiguous.
  const titleById = new Map(tasks.map(task => [task.id, task.title]))

  // Flatten board_id from nested structure for proper linking, dropping tasks
  // whose board is archived (or missing/inaccessible)
  const tasksWithBoardId = tasks
    .filter(task => task.column?.board && !task.column.board.archived_at)
    .map(task => ({
      ...task,
      board_id: task.column?.board_id,
      parent: task.parent_task_id
        ? { id: task.parent_task_id, title: titleById.get(task.parent_task_id) ?? null }
        : null,
    }))

  return <UserDashboard user={profile} tasks={tasksWithBoardId} boards={boards || []} users={users || []} />
}
