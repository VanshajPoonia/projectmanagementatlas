import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import StrategyWorkspace from '@/components/strategy/strategy-workspace'
import { loadShellData } from '@/lib/shell-data'
import { isModuleEnabledOnServer } from '@/lib/module-registry'
import { loadStrategyData } from '@/lib/strategy-data'
import { businessDate } from '@/lib/crm'

/**
 * Strategy - Prompt H's optional goals / ideas / purpose / SWOT / retrospectives surface.
 *
 * ⚠️ THE MODULE IS CHECKED HERE, ON THE SERVER, not only in the nav. A module toggle that only
 * hides a link is not a toggle: the AI assistant was gated at three render sites and nowhere
 * else, so switching it off removed the widget while its API route kept answering. Any module
 * with a route of its own owes that route this check.
 *
 * ⚠️ Everything below is fetched with the CALLER'S OWN session, so RLS has already decided what
 * comes back. Nothing in the client re-implements visibility, and nothing there may treat an
 * absence as proof something does not exist - lib/goals.ts reports a link whose task it cannot
 * resolve as `unresolved` rather than counting it as unfinished work.
 */
export default async function StrategyPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const enabled = await isModuleEnabledOnServer(supabase, 'strategy')
  // Back to the dashboard rather than a 404: the module being off is a workspace
  // configuration, not a missing page, and the nav will not have offered the link anyway.
  if (!enabled) redirect('/dashboard')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  const [strategy, boardsResult, tasksResult, statusesResult, usersResult, typesResult, columnsResult, shell] =
    await Promise.all([
      loadStrategyData(supabase),
      supabase.from('boards').select('id, title, color, is_private, archived_at').is('archived_at', null).order('title'),
      // Only what a goal link or a conversion needs. The full task payload the board renders
      // would be several times this for no benefit on a page that shows titles and statuses.
      supabase
        .from('tasks')
        .select('id, title, status, column:columns(id, status_key, board_id)')
        .is('deleted_at', null)
        .is('archived_at', null),
      // Every status, archived included. Filtering the lookup itself is how an archived status
      // stops resolving and its work silently reclassifies (lib/crm.ts's note).
      supabase.from('task_statuses').select('id, key, label, category, is_closed, position, is_archived').order('position'),
      supabase.from('profiles').select('id, full_name, email, avatar_url').order('full_name'),
      supabase.from('work_item_types').select('key, name, is_active').order('position'),
      supabase.from('columns').select('id, board_id, title, status_key, position').order('position'),
      loadShellData(supabase),
    ])

  const tasks = (tasksResult.data ?? []).map((task: any) => ({
    ...task,
    board_id: task.column?.board_id ?? null,
  }))

  return (
    <StrategyWorkspace
      user={profile}
      boards={boardsResult.data ?? []}
      tasks={tasks}
      statuses={statusesResult.data ?? []}
      users={usersResult.data ?? []}
      workItemTypes={typesResult.data ?? []}
      columns={columnsResult.data ?? []}
      initial={strategy}
      shell={shell}
      // ⚠️ Today as a CALENDAR DAY in the business zone, resolved once on the server. Goal
      // timeframes are DATE columns, so "is this overdue" must be a calendar comparison -
      // letting each browser answer it from its own clock is the family of bug that has
      // shipped five-plus times in this repo already.
      today={businessDate(new Date())}
      loadFailed={strategy.loadFailed || Boolean(boardsResult.error || tasksResult.error)}
    />
  )
}
