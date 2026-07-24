import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BoardView from '@/components/board/board-view'

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
  ] = await Promise.all([
    supabase.from('columns').select('*, tasks!tasks_column_id_fkey(*, assigned_to:profiles!tasks_assigned_to_fkey(id, full_name, email), task_assignees(user_id), task_tags(tag:tags(*)))').eq('board_id', id).order('position'),
    supabase.from('profiles').select('id, full_name, email'),
    supabase.from('board_members').select('role').eq('board_id', id).eq('user_id', user.id).maybeSingle(),
  ])

  return <BoardView board={board} columns={columns || []} users={users || []} isAdmin={false} currentUserId={user.id} boardRole={membership?.role ?? null} />
}
