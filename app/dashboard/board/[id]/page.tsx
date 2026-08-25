import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BoardView from '@/components/board/board-view'
import { loadShellData } from '@/lib/shell-data'

export default async function UserBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const { data: board } = await supabase
    .from('boards')
    .select('*, creator:profiles!boards_created_by_fkey(full_name, email)')
    .eq('id', id)
    .single()

  if (!board) {
    redirect('/dashboard')
  }

  const [
    { data: columns },
    { data: users },
    { data: membership },
    { data: boards },
    shell,
  ] = await Promise.all([
    supabase.from('columns').select('*, tasks!tasks_column_id_fkey(*, assigned_to:profiles!tasks_assigned_to_fkey(id, full_name, email), task_assignees(user_id), task_tags(tag:tags(*)))').eq('board_id', id).order('position'),
    supabase.from('profiles').select('id, full_name, email'),
    supabase.from('board_members').select('role').eq('board_id', id).eq('user_id', user.id).maybeSingle(),
    // The board switcher's list. RLS is the authority on which boards appear: the `boards`
    // SELECT policy (061) already hides a private board from a non-member, so this returns
    // exactly what this viewer may open and the switcher never offers a dead destination.
    // Archived boards are excluded to match every other board list in the app.
    supabase.from('boards').select('id, title, is_private').is('archived_at', null).order('title'),
    // Enabled modules + marketing calendars. A board renders outside AppShell, so its header
    // nav used to be a hand-written list that ignored both - the exact drift CLAUDE.md
    // records for /admin. It now comes from buildWorkspaceNav like every other surface.
    loadShellData(supabase),
  ])

  return <BoardView board={board} columns={columns || []} users={users || []} isAdmin={false} isSuperAdmin={profile?.role === 'super_admin'} platformRole={profile?.role ?? 'user'} currentUserId={user.id} boardRole={membership?.role ?? null} boards={boards || []} shell={shell} now={new Date().toISOString()} />
}
