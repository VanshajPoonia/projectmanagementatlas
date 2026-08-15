import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MyWorkView from '@/components/my-work/my-work-view'
import { loadShellData } from '@/lib/shell-data'

/**
 * My Work — the personal cockpit the shell has advertised as "soon" since the nav model
 * was written. Unlike /dashboard this is a real route, not a tab, because it is the one
 * screen people are expected to deep-link and open first.
 *
 * Available to every role: an admin has their own assigned work too, and sending them to
 * /admin instead (as /dashboard does) would leave them without it.
 */
export default async function MyWorkPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  // Same shape as the dashboard's query so the two screens agree about what a task is.
  // RLS decides what comes back; nothing here re-implements visibility.
  const { data: tasksData } = await supabase
    .from('tasks')
    .select('*, task_assignees(user_id), column:columns(title, status_key, board_id, board:boards(id, title, archived_at))')
    .is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false })

  const tasks = (tasksData ?? [])
    .filter((task: any) => task.column?.board && !task.column.board.archived_at)
    .map((task: any) => ({
      ...task,
      board_id: task.column?.board_id,
      board_title: task.column?.board?.title ?? null,
    }))

  // Enabled modules + marketing calendars, so the sidebar is right on the first frame
  // rather than rendering the fallback and correcting itself. See lib/shell-data.ts.
  const shell = await loadShellData(supabase)

  return <MyWorkView user={profile} tasks={tasks} shell={shell} />
}
