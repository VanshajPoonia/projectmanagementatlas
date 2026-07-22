'use client'

import { useEffect, useState } from 'react'
import { Check, Plus, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createClient } from '@/lib/supabase/client'
import { getAssigneeIds, getAssignees } from '@/lib/assignees'
import { getNormalizedTaskStatus } from '@/lib/task-status'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { logTaskActivity } from '@/lib/task-activity'
import { sendTaskAssignmentEmail } from '@/lib/email'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface SubtaskListProps {
  /** The parent task. Subtasks copy its column and visibility. */
  parentTask: any
  currentUserId: string
  canEdit: boolean
  /** Everyone assignable, supplied by the modal so this doesn't refetch profiles. */
  users: any[]
  /** Used for the assignment email's board name. */
  board?: any
  /** The acting user's profile, for "X assigned you..." copy. */
  currentUser?: any
  /** Called after any change so the board can refresh its progress rollups. */
  onChange?: () => void
}

function initials(user: any) {
  const source = String(user?.full_name || user?.email || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export default function SubtaskList({
  parentTask,
  currentUserId,
  canEdit,
  users,
  board,
  currentUser,
  onChange,
}: SubtaskListProps) {
  const supabase = createClient()
  const statuses = useTaskStatuses()
  const [subtasks, setSubtasks] = useState<any[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  const parentId = parentTask?.id

  useEffect(() => {
    if (parentId) load()
  }, [parentId])

  const load = async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, status, position, created_by, assigned_to, task_assignees(user_id)')
      .eq('parent_task_id', parentId)
      .is('deleted_at', null)
      .order('position', { ascending: true })

    if (error) {
      console.error('[v0] Failed to load subtasks:', error)
      return
    }
    setSubtasks(data ?? [])
  }

  // Statuses are admin-managed, so the done/undone keys can't be hardcoded — resolve
  // them from the live list and fall back to the well-known defaults.
  const doneKey = statuses.find((s) => getNormalizedTaskStatus({ status: s.key }) === 'done')?.key ?? 'done'
  const openKey = statuses.find((s) => getNormalizedTaskStatus({ status: s.key }) === 'to_do')?.key ?? 'to_do'

  const isDone = (subtask: any) => getNormalizedTaskStatus(subtask) === 'done'
  const doneCount = subtasks.filter(isDone).length

  const handleAdd = async () => {
    const title = newTitle.trim()
    if (!title || busy) return

    setBusy(true)
    // Inherit the parent's column and visibility so the subtask lands inside the same
    // board and is readable by exactly the people who can already see the parent.
    const { error } = await supabase.from('tasks').insert({
      title,
      parent_task_id: parentId,
      column_id: parentTask.column_id,
      created_by: currentUserId,
      visibility: parentTask.visibility ?? 'assigned',
      status: openKey,
      priority: parentTask.priority ?? 3,
      position: subtasks.length,
    })
    setBusy(false)

    if (error) {
      toast.error('Could not add subtask', { description: error.message })
      return
    }

    setNewTitle('')
    logTaskActivity(supabase, parentId, currentUserId, `added subtask "${title}"`)
    await load()
    onChange?.()
  }

  const handleToggle = async (subtask: any) => {
    const nextStatus = isDone(subtask) ? openKey : doneKey

    // Optimistic — a checkbox that lags feels broken.
    setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? { ...s, status: nextStatus } : s)))

    const { error } = await supabase.from('tasks').update({ status: nextStatus }).eq('id', subtask.id)
    if (error) {
      setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? { ...s, status: subtask.status } : s)))
      toast.error('Could not update subtask', { description: error.message })
      return
    }

    logTaskActivity(
      supabase,
      parentId,
      currentUserId,
      `${isDone(subtask) ? 'reopened' : 'completed'} subtask "${subtask.title}"`
    )
    onChange?.()
  }

  /**
   * Mirrors the assignee handling on task cards: task_assignees is the source of
   * truth, tasks.assigned_to is kept in sync as the denormalized primary, and a newly
   * added assignee gets both an in-app notification and an email.
   */
  const handleToggleAssignee = async (subtask: any, userId: string) => {
    const current = getAssigneeIds(subtask)
    const wasAssigned = current.includes(userId)
    const next = wasAssigned ? current.filter((id) => id !== userId) : [...current, userId]

    if (wasAssigned) {
      const { error } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', subtask.id)
        .eq('user_id', userId)
      if (error) {
        toast.error('Could not remove assignee', { description: error.message })
        return
      }
    } else {
      const { error } = await supabase.from('task_assignees').insert({ task_id: subtask.id, user_id: userId })
      if (error) {
        toast.error('Could not add assignee', { description: error.message })
        return
      }
    }

    await supabase.from('tasks').update({ assigned_to: next[0] || null }).eq('id', subtask.id)

    const toggled = users.find((u: any) => u.id === userId)
    logTaskActivity(
      supabase,
      parentId,
      currentUserId,
      `${wasAssigned ? 'removed' : 'added'} ${toggled?.full_name || toggled?.email || 'someone'} on subtask "${subtask.title}"`
    )

    if (!wasAssigned && toggled) {
      if (userId !== currentUserId) {
        await supabase.from('task_notifications').insert({
          recipient_id: userId,
          task_id: subtask.id,
          actor_id: currentUserId,
          type: 'assignment',
          message: `${currentUser?.full_name || currentUser?.email || 'Someone'} assigned you "${subtask.title}"`,
        })
      }
      await sendTaskAssignmentEmail(
        toggled.email,
        toggled.full_name || toggled.email,
        subtask.title,
        `Subtask of "${parentTask.title}"`,
        (parentTask.priority ?? 3).toString(),
        null,
        board?.title || 'Project Board',
        currentUser?.full_name || currentUser?.email || 'Admin'
      )
    }

    await load()
    onChange?.()
  }

  const handleDelete = async (subtask: any) => {
    const { error } = await supabase
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: currentUserId })
      .eq('id', subtask.id)

    if (error) {
      toast.error('Could not delete subtask', { description: error.message })
      return
    }

    logTaskActivity(supabase, parentId, currentUserId, `removed subtask "${subtask.title}"`)
    await load()
    onChange?.()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Subtasks</span>
        {subtasks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {doneCount} of {subtasks.length} done
          </span>
        )}
      </div>

      {subtasks.length > 0 && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={doneCount}
          aria-valuemin={0}
          aria-valuemax={subtasks.length}
          aria-label="Subtask progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${(doneCount / subtasks.length) * 100}%` }}
          />
        </div>
      )}

      <ul className="space-y-1">
        {subtasks.map((subtask) => {
          const done = isDone(subtask)
          const assigned = getAssignees(subtask, users)
          const assignedIds = getAssigneeIds(subtask)

          return (
            <li key={subtask.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
              <button
                type="button"
                onClick={() => canEdit && handleToggle(subtask)}
                disabled={!canEdit}
                aria-label={done ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`}
                className={cn(
                  'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
                  done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground',
                  canEdit ? 'cursor-pointer' : 'cursor-default opacity-70'
                )}
              >
                {done && <Check className="h-3 w-3" />}
              </button>

              <span
                className={cn(
                  'min-w-0 flex-1 break-words text-sm [overflow-wrap:anywhere]',
                  done && 'text-muted-foreground line-through'
                )}
              >
                {subtask.title}
              </span>

              {canEdit ? (
                <Popover
                  open={openPicker === subtask.id}
                  onOpenChange={(next) => setOpenPicker(next ? subtask.id : null)}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Assign ${subtask.title}`}
                      title={assigned.length ? assigned.map((u: any) => u.full_name || u.email).join(', ') : 'Assign'}
                      className={cn(
                        'flex h-5 flex-shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium transition-colors',
                        assigned.length
                          ? 'border-primary/40 bg-primary/10 text-foreground'
                          : 'border-dashed border-muted-foreground/50 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {assigned.length === 0 ? (
                        <UserPlus className="h-3 w-3" />
                      ) : (
                        <>
                          {initials(assigned[0])}
                          {assigned.length > 1 && <span>+{assigned.length - 1}</span>}
                        </>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="end">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Assignees</p>
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {users.map((u: any) => {
                        const on = assignedIds.includes(u.id)
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => handleToggleAssignee(subtask, u.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded p-1.5 text-left text-sm transition-colors',
                              on ? 'bg-primary/10' : 'hover:bg-accent'
                            )}
                          >
                            <div
                              className={cn(
                                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                                on ? 'border-primary bg-primary' : 'border-muted-foreground'
                              )}
                            >
                              {on && <Check className="h-3 w-3 text-primary-foreground" />}
                            </div>
                            <span className="truncate">{u.full_name || u.email}</span>
                          </button>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                assigned.length > 0 && (
                  <span
                    className="flex h-5 flex-shrink-0 items-center rounded-full border border-primary/40 bg-primary/10 px-1.5 text-[10px] font-medium"
                    title={assigned.map((u: any) => u.full_name || u.email).join(', ')}
                  >
                    {initials(assigned[0])}
                    {assigned.length > 1 && `+${assigned.length - 1}`}
                  </span>
                )
              )}

              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(subtask)}
                  aria-label={`Delete ${subtask.title}`}
                  className="h-6 w-6 flex-shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="Add a subtask"
            className="h-8 text-sm"
          />
          <Button size="sm" variant="outline" onClick={handleAdd} disabled={!newTitle.trim() || busy} className="h-8 flex-shrink-0">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {subtasks.length === 0 && !canEdit && (
        <p className="text-xs text-muted-foreground">No subtasks.</p>
      )}
    </div>
  )
}
