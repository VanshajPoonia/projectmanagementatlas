import { createClient as createAdminClient } from '@supabase/supabase-js'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Eye, Calendar, Lock } from 'lucide-react'
import { getTaskStatusLabel } from '@/lib/task-status'
import { cleanTaskDescription } from '@/lib/display-text'
import { getContrastTextColor } from '@/lib/utils'
import {
  isPublicShareLinkActive,
  isPublicTaskAvailable,
  isValidShareToken,
  visiblePublicBoardTasks,
} from '@/lib/public-share'

// Public, unauthenticated view — always fetch fresh, never cache a shared resource's contents.
export const dynamic = 'force-dynamic'

// Service-role client: this route is the ONLY place a shared board/task is read without a
// session, and only ever for the single resource_id the validated token points at.
function adminDb() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function priorityClass(priority: number) {
  if (priority <= 2) return 'border-red-500 text-red-600'
  if (priority === 3) return 'border-orange-500 text-orange-600'
  return 'border-blue-500 text-blue-600'
}

function InvalidLink() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="max-w-md p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">This link is no longer available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The share link may have been revoked, expired, or the item was removed.
        </p>
      </Card>
    </div>
  )
}

function ShareUnavailable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="max-w-md p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">This shared item could not be loaded</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The service may be temporarily unavailable. Refresh the page to try again.
        </p>
      </Card>
    </div>
  )
}

function ViewOnlyBanner({ label }: { label: string }) {
  return (
    <div className="mb-6 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
      <Eye className="h-4 w-4 text-primary" />
      <span><span className="font-medium text-foreground">View-only</span> · {label}. You can see this but not make changes.</span>
    </div>
  )
}

function TaskChip({ task, statusLabel }: { task: any; statusLabel: string }) {
  const desc = cleanTaskDescription(task.description)
  return (
    <Card className="space-y-2 p-3">
      <div className="text-sm font-medium leading-tight [overflow-wrap:anywhere]">{task.title}</div>
      {desc && <p className="line-clamp-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">{desc}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">{statusLabel}</Badge>
        {task.priority != null && (
          <Badge variant="outline" className={`text-[10px] ${priorityClass(task.priority)}`}>P{task.priority}</Badge>
        )}
        {task.due_date && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Calendar className="h-3 w-3" />{new Date(task.due_date).toLocaleDateString('en-US')}
          </span>
        )}
        {(task.task_tags || []).slice(0, 3).map((tt: any) => tt.tag && (
          <span key={tt.tag.id} className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: tt.tag.color, color: getContrastTextColor(tt.tag.color) }}>
            {tt.tag.name}
          </span>
        ))}
      </div>
    </Card>
  )
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isValidShareToken(token)) return <InvalidLink />

  const db = adminDb()

  const { data: link, error: linkError } = await db
    .from('share_links')
    .select('resource_type, resource_id, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (linkError) return <ShareUnavailable />
  if (!isPublicShareLinkActive(link)) return <InvalidLink />

  if (link.resource_type === 'board') {
    const { data: board, error: boardError } = await db
      .from('boards')
      .select('id, title, description, archived_at')
      .eq('id', link.resource_id)
      .maybeSingle()

    if (boardError) return <ShareUnavailable />
    if (!board || board.archived_at) return <InvalidLink />

    const { data: columns, error: columnsError } = await db
      .from('columns')
      .select('id, title, status_key, position, tasks:tasks!tasks_column_id_fkey(id, title, description, priority, due_date, status, deleted_at, archived_at, parent_task_id, task_tags(tag:tags(id, name, color)))')
      .eq('board_id', board.id)
      .is('tasks.deleted_at', null)
      .is('tasks.archived_at', null)
      .is('tasks.parent_task_id', null)
      .order('position')

    if (columnsError) return <ShareUnavailable />

    return (
      <div className="min-h-screen bg-muted/20 px-4 py-8">
        <div className="mx-auto max-w-6xl">
          <ViewOnlyBanner label="shared board" />
          <h1 className="text-2xl font-semibold">{board.title}</h1>
          {board.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{board.description}</p>}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(columns || []).map((col: any) => {
              const statusLabel = getTaskStatusLabel({ column: { status_key: col.status_key, title: col.title } })
              // Keep a server-side defensive filter even though PostgREST also filters the
              // embedded relation above. A future query change must not re-expose archived data.
              const tasks = visiblePublicBoardTasks(col.tasks)
              return (
                <div key={col.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{col.title}</h2>
                    <Badge variant="secondary" className="text-[10px]">{tasks.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {tasks.length === 0
                      ? <p className="text-xs text-muted-foreground/60">No tasks</p>
                      : tasks.map((t: any) => <TaskChip key={t.id} task={t} statusLabel={statusLabel} />)}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-10 text-center text-xs text-muted-foreground/60">Shared via the project workspace · view-only</p>
        </div>
      </div>
    )
  }

  if (link.resource_type !== 'task') return <InvalidLink />

  const { data: task, error: taskError } = await db
    .from('tasks')
    .select('id, title, description, priority, due_date, status, deleted_at, archived_at, column:columns(title, status_key, board:boards(archived_at)), task_tags(tag:tags(id, name, color))')
    .eq('id', link.resource_id)
    .is('deleted_at', null)
    .is('archived_at', null)
    .maybeSingle()

  if (taskError) return <ShareUnavailable />
  if (!task || !isPublicTaskAvailable(task as any)) return <InvalidLink />
  const visibleTask = task as any

  const { data: subtasks, error: subtasksError } = await db
    .from('tasks')
    .select('id, title, deleted_at, archived_at, column:columns(status_key, title)')
    .eq('parent_task_id', visibleTask.id)
    .is('deleted_at', null)
    .is('archived_at', null)

  if (subtasksError) return <ShareUnavailable />

  const statusLabel = getTaskStatusLabel(visibleTask)
  const desc = cleanTaskDescription(visibleTask.description)

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <ViewOnlyBanner label="shared task" />
        <Card className="space-y-4 p-6">
          <h1 className="text-xl font-semibold [overflow-wrap:anywhere]">{visibleTask.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{statusLabel}</Badge>
            {visibleTask.priority != null && <Badge variant="outline" className={priorityClass(visibleTask.priority)}>Priority {visibleTask.priority}</Badge>}
            {visibleTask.due_date && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />{new Date(visibleTask.due_date).toLocaleDateString('en-US')}
              </span>
            )}
          </div>
          {(visibleTask.task_tags || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {visibleTask.task_tags.map((tt: any) => tt.tag && (
                <span key={tt.tag.id} className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: tt.tag.color, color: getContrastTextColor(tt.tag.color) }}>
                  {tt.tag.name}
                </span>
              ))}
            </div>
          )}
          {desc && <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">{desc}</p>}
          {(subtasks || []).length > 0 && (
            <div className="border-t pt-4">
              <h2 className="mb-2 text-sm font-medium">Subtasks</h2>
              <ul className="space-y-1">
                {subtasks!.map((s: any) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="text-[10px]">{getTaskStatusLabel(s)}</Badge>
                    <span className="[overflow-wrap:anywhere]">{s.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <p className="mt-8 text-center text-xs text-muted-foreground/60">Shared via the project workspace · view-only</p>
      </div>
    </div>
  )
}
