import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ViewsWorkspace from '@/components/views/views-workspace'
import { loadShellData } from '@/lib/shell-data'

/**
 * Views - Prompt E's shared query/configuration surface.
 *
 * A real route rather than a dashboard tab, for the same reason /my-work is: it is a screen
 * people deep-link into and open first, and `/dashboard?tab=` redirects an admin to /admin and
 * drops the query string.
 *
 * ⚠️ Everything below is fetched with the CALLER'S OWN session, so RLS has already decided what
 * comes back: a private board's tasks were never in the array, an archived board's are filtered
 * out below, and every count the screen renders is a count of what this person can see. Nothing
 * in the client re-implements visibility, and nothing there may treat an absence as proof that
 * something does not exist.
 */
export default async function ViewsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  // ⚠️ The error is kept rather than discarded. Dropping it renders a failed query as "no work
  // here yet", which is the most reassuring possible way to tell somebody their workspace is
  // broken - the same defect /my-work had.
  const [tasksResult, boardsResult, usersResult, statusesResult, tagsResult, columnsResult, fieldsResult, valuesResult] =
    await Promise.all([
      supabase
        .from('tasks')
        .select(
          '*, task_assignees(user_id), task_tags(tag:tags(id, name, color)), ' +
          'column:columns(id, title, status_key, board_id, board:boards(id, title, archived_at))',
        )
        .is('deleted_at', null)
        .is('archived_at', null),
      // parent_board_id (migration 118) is what makes descendant scope work. Archived boards
      // are excluded here rather than in the client, because the SELECT policy already hides
      // them from everyone except a super admin and a half-visible tree is confusing.
      supabase
        .from('boards')
        .select('id, title, color, parent_board_id, archived_at, is_private')
        .is('archived_at', null)
        .order('title'),
      supabase.from('profiles').select('id, full_name, email, avatar_url').order('full_name'),
      // Every status, archived included. Filtering the lookup itself is how an archived status
      // stops resolving and its work silently reclassifies - see lib/crm.ts's note.
      supabase
        .from('task_statuses')
        .select('id, key, label, category, is_closed, position, is_archived')
        .order('position'),
      supabase.from('tags').select('id, name, color').order('name'),
      supabase.from('columns').select('id, title, status_key, board_id, position').order('position'),
      supabase
        .from('field_definitions')
        .select('id, key, name, field_type, config, is_archived, board_id, position')
        .order('position'),
      supabase.from('field_values').select('task_id, field_id, value'),
    ])

  const tasks = (tasksResult.data ?? [])
    .filter((task: any) => task.column?.board && !task.column.board.archived_at)
    .map((task: any) => ({
      ...task,
      board_id: task.column?.board_id,
      board_title: task.column?.board?.title ?? null,
    }))

  const shell = await loadShellData(supabase)

  return (
    <ViewsWorkspace
      user={profile}
      tasks={tasks}
      boards={boardsResult.data ?? []}
      users={usersResult.data ?? []}
      statuses={statusesResult.data ?? []}
      tags={tagsResult.data ?? []}
      columns={columnsResult.data ?? []}
      fieldDefinitions={fieldsResult.data ?? []}
      fieldValues={valuesResult.data ?? []}
      shell={shell}
      // The server's instant, so anything date-derived renders identically on both passes.
      // Calling new Date() during render is a hydration error, not a cosmetic one.
      now={new Date().toISOString()}
      loadFailed={Boolean(tasksResult.error)}
    />
  )
}
