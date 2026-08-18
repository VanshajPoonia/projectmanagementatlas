'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarPicker } from '@/components/ui/calendar'
import { Calendar, User, Tag, Clock, Repeat, History, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { TaskDetailModal } from './task-detail-modal'
import { useState } from 'react'
import { getAssignees, getAssigneeIds } from '@/lib/assignees'
import { can, type Actor } from '@/lib/capabilities'
import {
  DEFAULT_DENSITY,
  densityCardClass,
  showsDescriptionPreview,
  showsSecondaryDetail,
  type Density,
} from '@/components/shell/density'
import { cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, findExactColumnForStatus, getEffectiveStatusKey, statusesForPicker } from '@/lib/task-status'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { sendTaskAssignmentEmail } from '@/lib/email'
import { logTaskActivity } from '@/lib/task-activity'
import { getContrastTextColor } from '@/lib/utils'
import { format } from 'date-fns'
import { toast } from 'sonner'

interface TaskCardProps {
  task: any
  isAdmin: boolean
  currentUserId: string
  /** The caller's board_members row for this board, if any (null = no row = full default access). */
  boardRole?: 'member' | 'guest' | 'client' | null
  /** Viewer's own density preference; never shared, never written to the task. */
  density?: Density
  users: any[]
  board?: any
  columns?: any[]
  /** This task's subtasks, supplied by the board so the card can show progress. */
  subtasks?: any[]
  isDragging?: boolean
  onUpdate?: () => void
}

export default function TaskCard({ task, isAdmin, currentUserId, boardRole = null, density = DEFAULT_DENSITY, users, board, columns, subtasks, isDragging, onUpdate }: TaskCardProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailInitialTab, setDetailInitialTab] = useState<'comments' | 'activity'>('comments')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false)
  const supabase = createClient()
  const taskAssignees = getAssignees(task, users)
  const assigneeIds = getAssigneeIds(task)
  const taskDescription = cleanTaskDescription(task.description)
  // Edit rules come from lib/capabilities.ts so the tile, the detail modal and the board
  // cannot drift apart; platformRole is unused here (no capability on this surface reads
  // it) so the isAdmin prop carries the whole decision, as it did before.
  const actor: Actor = { userId: currentUserId, platformRole: 'user', boardRole, isAdmin }
  const subject = { created_by: task.created_by, assigned_to: task.assigned_to, assigneeIds }
  const editDecision = can(actor, 'task.edit', subject)
  const dueDateDecision = can(actor, 'task.schedule', subject)
  const canEdit = editDecision.allowed
  const canEditDueDate = dueDateDecision.allowed
  const currentUser = users.find((u: any) => u.id === currentUserId)
  const statuses = useTaskStatuses()

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim()
    setEditingTitle(false)
    if (!trimmed || trimmed === task.title) {
      setTitleDraft(task.title)
      return
    }
    const { error } = await supabase.from('tasks').update({ title: trimmed }).eq('id', task.id)
    if (error) {
      toast.error('Could not update title', { description: error.message })
      setTitleDraft(task.title)
      return
    }
    logTaskActivity(supabase, task.id, currentUserId, `renamed the task from "${task.title}" to "${trimmed}"`)
    onUpdate?.()
  }

  // Inline description edit on the card — same "no popup" convention Bobby asked for, mirroring
  // how the modal initializes (cleaned text) and logs ("updated the description").
  const handleSaveDescription = async () => {
    const trimmed = descDraft.trim()
    setEditingDesc(false)
    if (trimmed === (taskDescription || '')) return
    const { error } = await supabase.from('tasks').update({ description: trimmed || null }).eq('id', task.id)
    if (error) {
      toast.error('Could not update description', { description: error.message })
      setDescDraft(taskDescription || '')
      return
    }
    logTaskActivity(supabase, task.id, currentUserId, 'updated the description')
    onUpdate?.()
  }

  const handlePriorityChange = async (value: string) => {
    const { error } = await supabase.from('tasks').update({ priority: parseInt(value) }).eq('id', task.id)
    if (error) {
      toast.error('Could not update priority', { description: error.message })
      return
    }
    logTaskActivity(supabase, task.id, currentUserId, `changed priority from ${task.priority} to ${value}`)
    onUpdate?.()
  }

  const handleStatusChange = async (value: string) => {
    // Board columns are the source of truth for where a card sits, so changing
    // status here also relocates the card into whichever column represents that
    // status (mirrors the status drag-and-drop between columns already sets).
    const statusLabel = statuses.find(s => s.key === value)?.label
    const matchingColumn = findExactColumnForStatus(value, statusLabel, columns)
    if (!matchingColumn) {
      toast.error(`No column on this board is linked to "${statusLabel || value}"`, {
        description: 'An admin can link a column to it from the column\'s "⋮" menu → Link Status.',
      })
      return
    }
    const updates: Record<string, any> = { status: value }
    if (matchingColumn.id !== task.column_id) {
      updates.column_id = matchingColumn.id
      updates.position = (matchingColumn as any).tasks?.length || 0
    }

    const { error } = await supabase.from('tasks').update(updates).eq('id', task.id)
    if (error) {
      toast.error('Could not update status', { description: error.message })
      return
    }
    // Status history is written transactionally by the database lifecycle trigger.
    // Logging it again here would double-count the transition in timing metrics.
    onUpdate?.()
  }

  const handleDueDateChange = async (date: Date | undefined) => {
    const { error } = await supabase.from('tasks').update({ due_date: date ? date.toISOString() : null }).eq('id', task.id)
    if (error) {
      toast.error('Could not update due date', { description: error.message })
      return
    }
    logTaskActivity(
      supabase,
      task.id,
      currentUserId,
      date ? `set the due date to ${format(date, 'PP')}` : 'removed the due date'
    )
    onUpdate?.()
  }

  const handleToggleAssignee = async (userId: string) => {
    const isAssigned = assigneeIds.includes(userId)
    const newAssignees = isAssigned ? assigneeIds.filter((id) => id !== userId) : [...assigneeIds, userId]

    if (isAssigned) {
      const { error } = await supabase.from('task_assignees').delete().eq('task_id', task.id).eq('user_id', userId)
      if (error) {
        toast.error('Could not remove assignee', { description: error.message })
        return
      }
    } else {
      const { error } = await supabase.from('task_assignees').insert({ task_id: task.id, user_id: userId })
      if (error) {
        toast.error('Could not add assignee', { description: error.message })
        return
      }
    }

    // Keep the assigned_to mirror in sync with the first assignee.
    await supabase.from('tasks').update({ assigned_to: newAssignees[0] || null }).eq('id', task.id)

    const toggledUser = users.find((u: any) => u.id === userId)
    logTaskActivity(
      supabase,
      task.id,
      currentUserId,
      `${isAssigned ? 'removed' : 'added'} assignee ${toggledUser?.full_name || toggledUser?.email || 'Unknown'}`
    )

    if (!isAssigned) {
      const assignedUser = users.find((u: any) => u.id === userId)
      if (assignedUser) {
        if (userId !== currentUserId) {
          await supabase.from('task_notifications').insert({
            recipient_id: userId,
            task_id: task.id,
            actor_id: currentUserId,
            type: 'assignment',
            message: `${currentUser?.full_name || currentUser?.email || 'Someone'} assigned you "${task.title}"`,
          })
        }
        await sendTaskAssignmentEmail(
          assignedUser.email,
          assignedUser.full_name || assignedUser.email,
          task.title,
          taskDescription,
          (task.priority ?? 3).toString(),
          task.due_date || null,
          board?.title || 'Project Board',
          currentUser?.full_name || currentUser?.email || 'Admin'
        )
        toast.success('Assignee notified', {
          description: `${assignedUser.full_name || assignedUser.email} was added to this task.`,
        })
      }
    }

    onUpdate?.()
  }

  const getPriorityColor = (priority: number) => {
    if (priority <= 2) return 'border-red-500 text-red-500 bg-red-50 dark:bg-red-950/40'
    if (priority === 3) return 'border-orange-500 text-orange-500 bg-orange-50 dark:bg-orange-950/40'
    return 'border-blue-500 text-blue-500 bg-blue-50 dark:bg-blue-950/40'
  }

  // Check if task is overdue
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && getNormalizedTaskStatus(task) !== 'done'
  
  // Calculate days remaining
  const getDaysRemaining = () => {
    if (!task.due_date) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dueDate = new Date(task.due_date)
    dueDate.setHours(0, 0, 0, 0)
    const diffTime = dueDate.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }
  
  const daysRemaining = getDaysRemaining()

  const subtaskCount = subtasks?.length ?? 0
  const subtasksDone = (subtasks ?? []).filter((s: any) => getNormalizedTaskStatus(s) === 'done').length
  const getCountdownColor = () => {
    if (daysRemaining === null) return ''
    if (daysRemaining < 0) return 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-900'
    if (daysRemaining === 0) return 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950/40 dark:border-orange-900'
    if (daysRemaining <= 3) return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/40 dark:border-yellow-900'
    return 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/40 dark:border-green-900'
  }

  return (
    <>
      <Card
        className={`group min-w-0 cursor-grab overflow-hidden active:cursor-grabbing transition-colors hover:border-primary/40 hover:shadow-md ${densityCardClass(density)} ${
          isDragging ? 'shadow-xl opacity-80 cursor-grabbing' : ''
        } ${isOverdue ? 'border-red-300 bg-red-50/30 dark:border-red-800 dark:bg-red-950/40' : ''}`}
        onClick={() => {
          setDetailInitialTab('comments')
          setDetailOpen(true)
        }}
      >
        <div className={density === 'compact' ? 'space-y-1.5' : 'space-y-2.5'}>
          <div className="flex min-w-0 items-start justify-between gap-2">
            {editingTitle ? (
              <Input
                autoFocus
                value={titleDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSaveTitle()
                  } else if (e.key === 'Escape') {
                    setTitleDraft(task.title)
                    setEditingTitle(false)
                  }
                }}
                className="h-7 min-w-0 flex-1 text-sm font-semibold"
              />
            ) : (
              <h4
                className={`min-w-0 flex-1 break-words text-sm font-semibold leading-tight text-pretty line-clamp-4 [overflow-wrap:anywhere] ${
                  canEdit ? 'rounded hover:bg-accent' : ''
                }`}
                onClick={(e) => {
                  if (!canEdit) return
                  e.stopPropagation()
                  setTitleDraft(task.title)
                  setEditingTitle(true)
                }}
              >
                {task.title}
              </h4>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setDetailInitialTab('activity')
                setDetailOpen(true)
              }}
              aria-label="View activity"
              title="View activity"
            >
              <History className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Compact exists to fit more work on screen, so the description preview and
              its "add a description" affordance drop out entirely at that density. */}
          {!showsSecondaryDetail(density) ? null : editingDesc ? (
            <Textarea
              autoFocus
              value={descDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={handleSaveDescription}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSaveDescription()
                } else if (e.key === 'Escape') {
                  setDescDraft(taskDescription || '')
                  setEditingDesc(false)
                }
              }}
              placeholder="Add a description... (⌘/Ctrl+Enter to save, Esc to cancel)"
              rows={3}
              className="min-h-0 text-xs"
            />
          ) : taskDescription ? (
            <p
              className={`break-words text-xs text-muted-foreground [overflow-wrap:anywhere] ${
                showsDescriptionPreview(density) ? 'line-clamp-6' : 'line-clamp-3'
              } ${canEdit ? 'cursor-text rounded hover:bg-accent' : ''}`}
              onClick={(e) => {
                if (!canEdit) return
                e.stopPropagation()
                setDescDraft(taskDescription || '')
                setEditingDesc(true)
              }}
            >
              {taskDescription}
            </p>
          ) : canEdit ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setDescDraft('')
                setEditingDesc(true)
              }}
              className="text-left text-xs italic text-muted-foreground/60 hover:text-foreground"
            >
              + Add description
            </button>
          ) : null}

          {/* Tags */}
          {task.task_tags && task.task_tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.task_tags.slice(0, 3).map((tt: any) => (
                <Badge
                  key={tt.tag.id}
                  style={{ backgroundColor: tt.tag.color, color: getContrastTextColor(tt.tag.color) }}
                  className="text-xs px-2 py-0"
                >
                  {tt.tag.name}
                </Badge>
              ))}
              {task.task_tags.length > 3 && (
                <Badge variant="outline" className="text-xs px-2 py-0">
                  +{task.task_tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {task.priority && (
              canEdit ? (
                <Select value={task.priority.toString()} onValueChange={handlePriorityChange}>
                  <SelectTrigger
                    onClick={(e) => e.stopPropagation()}
                    className={`h-6 w-auto gap-1 border px-2 text-xs ${getPriorityColor(task.priority)}`}
                  >
                    <SelectValue>{`Priority: ${task.priority}`}</SelectValue>
                  </SelectTrigger>
                  <SelectContent onClick={(e) => e.stopPropagation()}>
                    <SelectItem value="1">1 - Highest</SelectItem>
                    <SelectItem value="2">2 - High</SelectItem>
                    <SelectItem value="3">3 - Medium</SelectItem>
                    <SelectItem value="4">4 - Low</SelectItem>
                    <SelectItem value="5">5 - Lowest</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline" className={`text-xs ${getPriorityColor(task.priority)}`}>
                  Priority: {task.priority}
                </Badge>
              )
            )}
            {(() => {
              const effectiveStatus = getEffectiveStatusKey(task, columns, statuses)
              const statusDef = statuses.find(s => s.key === effectiveStatus)
              const statusColor = statusDef?.color || '#64748b'
              if (canEdit) {
                return (
                  <Select value={effectiveStatus} onValueChange={handleStatusChange}>
                    <SelectTrigger
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 w-auto gap-1 border px-2 text-xs"
                      style={{ borderColor: statusColor, color: statusColor, backgroundColor: `${statusColor}18` }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    {/* Scoped to what this board has a column for, plus whatever this card
                        already is — handleStatusChange refuses the rest, and a card sitting in
                        a status whose column was deleted must still say so rather than render
                        an empty control. */}
                    <SelectContent onClick={(e) => e.stopPropagation()}>
                      {statusesForPicker(statuses, columns, effectiveStatus).map(s => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
              return (
                <Badge variant="outline" className="text-xs" style={{ borderColor: statusColor, color: statusColor }}>
                  {statusDef?.label || effectiveStatus}
                </Badge>
              )
            })()}
            {task.is_recurring && (
              <Badge variant="outline" className="text-xs bg-purple-50 border-purple-200 text-purple-600 gap-1 dark:bg-purple-950/40 dark:border-purple-900 dark:text-purple-400">
                <Repeat className="w-3 h-3" />
                {task.recurrence_pattern}
              </Badge>
            )}
          </div>

          {subtaskCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${(subtasksDone / subtaskCount) * 100}%` }}
                />
              </div>
              <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <ListChecks className="h-3 w-3" />
                {subtasksDone}/{subtaskCount}
              </span>
            </div>
          )}

          {daysRemaining !== null && (
            <Badge variant="outline" className={`gap-1 text-xs ${getCountdownColor()}`}>
              <Clock className="w-3 h-3" />
              <span>
                {daysRemaining < 0
                  ? `${Math.abs(daysRemaining)} days overdue`
                  : daysRemaining === 0
                  ? 'Due today'
                  : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`}
              </span>
            </Badge>
          )}

          <div className="space-y-1 border-t pt-2">
            {canEdit ? (
              <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="flex w-full items-center gap-2 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <User className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                      {taskAssignees.length === 0
                        ? 'Unassigned'
                        : taskAssignees.length === 1
                        ? (taskAssignees[0].full_name || taskAssignees[0].email)
                        : `${taskAssignees[0].full_name || taskAssignees[0].email} +${taskAssignees.length - 1}`}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start" onClick={(e) => e.stopPropagation()}>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Assignees</p>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {users.map((u: any) => {
                      const isAssigned = assigneeIds.includes(u.id)
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => handleToggleAssignee(u.id)}
                          className={`flex w-full items-center gap-2 rounded p-1.5 text-left text-sm transition-colors ${
                            isAssigned ? 'bg-primary/10' : 'hover:bg-accent'
                          }`}
                        >
                          <div
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              isAssigned ? 'bg-primary border-primary' : 'border-muted-foreground'
                            }`}
                          >
                            {isAssigned && <span className="text-[10px] text-primary-foreground">✓</span>}
                          </div>
                          <span className="truncate">{u.full_name || u.email}</span>
                        </button>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              taskAssignees.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <User className="w-3 h-3" />
                  <span className="truncate">
                    {taskAssignees.length === 1
                      ? (taskAssignees[0].full_name || taskAssignees[0].email)
                      : `${taskAssignees[0].full_name || taskAssignees[0].email} +${taskAssignees.length - 1}`}
                  </span>
                </div>
              )
            )}

            {canEditDueDate ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="flex w-full items-center gap-2 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span>{task.due_date ? format(new Date(task.due_date), 'PP') : 'Set due date'}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
                  <CalendarPicker
                    mode="single"
                    selected={task.due_date ? new Date(task.due_date) : undefined}
                    onSelect={handleDueDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            ) : (
              task.due_date && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3" />
                  <span>{new Date(task.due_date).toLocaleDateString('en-US')}</span>
                </div>
              )
            )}
          </div>
        </div>
      </Card>

      <TaskDetailModal
        columns={columns}
        taskId={task.id}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdate={() => {
          setDetailOpen(false)
          onUpdate?.()
        }}
        // Refresh the board's rollup without dismissing the task being worked in.
        onSubtaskChange={() => onUpdate?.()}
        board={board}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        boardRole={boardRole}
        initialTab={detailInitialTab}
      />
    </>
  )
}
