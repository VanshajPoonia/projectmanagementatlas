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
    .select('*')
    .eq('id', id)
    .single()

  if (!board) {
    redirect('/dashboard')
  }

  const [
    { data: columns },
    { data: users },
  ] = await Promise.all([
    supabase.from('columns').select('*, tasks(*, assigned_to:profiles!tasks_assigned_to_fkey(full_name, email), task_tags(tag:tags(*)))').eq('board_id', id).order('position'),
    supabase.from('profiles').select('id, full_name, email'),
  ])

  return <BoardView board={board} columns={columns || []} users={users || []} isAdmin={false} currentUserId={user.id} />
}
