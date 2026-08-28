import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AgileWorkspace from '@/components/agile/agile-workspace'
import { loadShellData } from '@/lib/shell-data'
import { isModuleEnabledOnServer } from '@/lib/module-registry'
import { businessDate } from '@/lib/crm'

/**
 * Agile mode - Prompt G's optional Scrum/Kanban surface.
 *
 * ⚠️ THE MODULE IS CHECKED HERE, ON THE SERVER, not only in the nav. A module toggle that
 * only hides a link is not a toggle: the AI assistant was gated at three render sites and
 * nowhere else, so switching it off removed the widget while its API route kept answering.
 * Any module with a route of its own owes that route this check.
 *
 * ⚠️ Everything below is fetched with the CALLER'S OWN session, so RLS has already decided
 * what comes back. A private board's sprints were never in the array, and every count this
 * screen renders is a count of what this person can see. Nothing in the client re-implements
 * visibility, and nothing there may treat an absence as proof something does not exist.
 */
export default async function AgilePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const enabled = await isModuleEnabledOnServer(supabase, 'agile')
  // Back to the dashboard rather than a 404: the module being off is a workspace
  // configuration, not a missing page, and the nav will not have offered the link anyway.
  if (!enabled) redirect('/dashboard')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  const [boardsResult, settingsResult, tasksResult, statusesResult, usersResult, typesResult, columnsResult] =
    await Promise.all([
      supabase
        .from('boards')
        .select('id, title, color, is_private, archived_at')
        .is('archived_at', null)
        .order('title'),
      // Every settings row the caller can see, in one query - the switcher has to know which
      // boards run sprints before it can pick a sensible default, and asking per board would
      // be one round trip per board on first paint.
      supabase.from('board_agile_settings').select('board_id, is_enabled, terminology, estimate_unit, capacity_mode, wip_mode'),
      supabase
        .from('tasks')
        .select(
          'id, title, description, position, priority, due_date, estimate_value, parent_task_id, ' +
          'type_key, status, assigned_to, created_by, visibility, ' +
          'task_assignees(user_id), column:columns(id, title, status_key, board_id, position, wip_limit)',
        )
        .is('deleted_at', null)
        .is('archived_at', null),
      // Every status, archived included. Filtering the lookup itself is how an archived status
      // stops resolving and its work silently reclassifies (lib/crm.ts's note).
      supabase.from('task_statuses').select('id, key, label, category, is_closed, is_approval, position, is_archived').order('position'),
      supabase.from('profiles').select('id, full_name, email, avatar_url').order('full_name'),
      supabase.from('work_item_types').select('key, name, plural_name, is_agile_eligible, is_active').order('position'),
      supabase.from('columns').select('id, board_id, title, status_key, position, wip_limit').order('position'),
    ])

  const tasks = (tasksResult.data ?? []).map((task: any) => ({
    ...task,
    board_id: task.column?.board_id ?? null,
  }))

  const shell = await loadShellData(supabase)

  return (
    <AgileWorkspace
      user={profile}
      boards={boardsResult.data ?? []}
      settings={settingsResult.data ?? []}
      tasks={tasks}
      statuses={statusesResult.data ?? []}
      users={usersResult.data ?? []}
      workItemTypes={typesResult.data ?? []}
      columns={columnsResult.data ?? []}
      shell={shell}
      // The server's instant, so anything date-derived renders identically on both passes.
      // Calling new Date() during render is a hydration error, not a cosmetic one.
      now={new Date().toISOString()}
      // ⚠️ Today as a CALENDAR DAY in the business zone, resolved once on the server. Sprint
      // windows are DATE columns, so "has this sprint ended" must be a calendar comparison -
      // letting each browser answer it from its own clock is exactly the family of bug that
      // has shipped five times in this repo already.
      today={businessDate(new Date())}
      loadFailed={Boolean(tasksResult.error || boardsResult.error)}
    />
  )
}
