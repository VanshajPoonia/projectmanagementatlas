'use client'

import type { FormEvent } from 'react'
import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { VoiceInputButton } from '@/components/ui/voice-input-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createClient } from '@/lib/supabase/client'
import { sendTaskAssignmentEmail } from '@/lib/email'
import { LinkIcon, Plus, X, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { isDirty, useUnsavedChanges } from '@/components/shell/unsaved-changes'
import { findExactColumnForStatus, statusesAvailableOnBoard } from '@/lib/task-status'
import { logTaskActivity } from '@/lib/task-activity'

interface CreateTaskDialogProps {
  board?: any
  open: boolean
  onOpenChange: (open: boolean) => void
  column: any
  columns: any[]
  users: any[]
  boardId: string
  onTaskCreated?: () => void
}

export default function CreateTaskDialog({ open, onOpenChange, column, columns, users, boardId, board, onTaskCreated }: CreateTaskDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const [visibility, setVisibility] = useState<'assigned' | 'board'>('assigned')
  // Per the PM portal spec: priority/status must be explicitly chosen, not silently defaulted.
  const [priority, setPriority] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrencePattern, setRecurrencePattern] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [links, setLinks] = useState<Array<{ title: string; url: string }>>([])
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [allTags, setAllTags] = useState<any[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [initialComment, setInitialComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()
  const taskStatuses = useTaskStatuses()
  /**
   * Only statuses this board actually has a column for. The submit handler below refuses
   * anything else, and used to do so *after* the whole form was filled in - with "ask an
   * admin" as the remedy even when the person reading it was the admin. Cancelled stays
   * excluded on top of that: it is an archive destination, reached by moving existing work
   * there, not somewhere new work is created.
   */
  const creatableStatuses = useMemo(
    () => statusesAvailableOnBoard(taskStatuses, columns).filter((s) => s.key !== 'cancelled'),
    [taskStatuses, columns],
  )

  // Unsaved-change protection. Escape, the X, or a click on the overlay used to throw away
  // everything typed here - title, description, assignees, links, tags and the first comment
  // - with no warning at all.
  //
  // The baseline is "an untouched form", not the values the dialog opened with: `status` and
  // `visibility` are pre-filled from the column and a default, so including them would make a
  // freshly opened dialog report itself dirty and prompt on every close. Only fields the user
  // has to type or pick count.
  const dirty = isDirty(
    { title, description, assignees, dueDate, links, linkTitle, linkUrl, selectedTagIds, initialComment, priority },
    { title: '', description: '', assignees: [], dueDate: '', links: [], linkTitle: '', linkUrl: '', selectedTagIds: [], initialComment: '', priority: null },
  )
  const guardedClose = useUnsavedChanges(dirty, onOpenChange)

  // Only an explicit status link (or exact managed-status title on a legacy board)
  // may choose the initial status. Fuzzy title inference is what allowed cards to be
  // stored in one column with a different raw status.
  useEffect(() => {
    if (open && column?.title) {
      const exactTitleMatch = taskStatuses.find(
        (candidate) => candidate.label.trim().toLowerCase() === column.title.trim().toLowerCase()
      )
      setStatus(column.status_key || exactTitleMatch?.key || '')
    }
  }, [open, column, taskStatuses])

  // Tags (company tags like SRG/AGC included) can't be created here, only picked from
  // the admin-managed list, so load it whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    supabase.from('tags').select('*').order('name').then(({ data }: { data: any[] | null }) => {
      if (data) setAllTags(data)
    })
  }, [open])

  const addLink = () => {
    const trimmedUrl = linkUrl.trim()
    if (!trimmedUrl) return

    setLinks((current) => [
      ...current,
      {
        title: linkTitle.trim() || trimmedUrl,
        url: trimmedUrl,
      },
    ])
    setLinkTitle('')
    setLinkUrl('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Required fields must be explicitly completed before a task can be created.
    if (priority === null) {
      setError('Please select a priority before creating this task.')
      setLoading(false)
      return
    }
    if (!status) {
      setError('Please select a status before creating this task.')
      setLoading(false)
      return
    }

    try {
      const statusLabel = taskStatuses.find((candidate) => candidate.key === status)?.label
      const targetColumn = findExactColumnForStatus(status, statusLabel, columns)
      if (!targetColumn) {
        throw new Error(
          `No column on this board is linked to "${statusLabel || status}". Ask an admin to link one from the column menu.`
        )
      }

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) throw new Error('User not authenticated')

      const taskData = {
        title,
        description,
        column_id: targetColumn.id,
        assigned_to: assignees[0] || null,
        created_by: user.id,
        priority,
        due_date: dueDate || null,
        status,
        position: targetColumn.tasks?.filter((task: any) => !task.deleted_at && !task.archived_at).length || 0,
        visibility,
        is_recurring: isRecurring,
        recurrence_pattern: isRecurring ? recurrencePattern : null,
        recurrence_interval: isRecurring ? recurrenceInterval : null,
      }
      
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert(taskData)
        .select()
        .single()

      if (taskError) throw taskError

      if (links.length > 0) {
        const { error: linksError } = await supabase
          .from('task_links')
          .insert(
            links.map((link) => ({
              task_id: task.id,
              title: link.title,
              url: link.url,
              created_by: user.id,
            }))
          )
        if (linksError) throw linksError
        for (const link of links) {
          logTaskActivity(supabase, task.id, user.id, `added link "${link.title}"`)
        }
      }

      if (selectedTagIds.length > 0) {
        const { error: tagsError } = await supabase
          .from('task_tags')
          .insert(selectedTagIds.map((tagId) => ({ task_id: task.id, tag_id: tagId })))
        if (tagsError) throw tagsError
        for (const tagId of selectedTagIds) {
          const tag = allTags.find((t) => t.id === tagId)
          logTaskActivity(supabase, task.id, user.id, `added tag "${tag?.name || 'Unknown'}"`)
        }
      }

      if (initialComment.trim()) {
        const { error: commentError } = await supabase
          .from('task_comments')
          .insert({ task_id: task.id, comment: initialComment.trim(), user_id: user.id, author_id: user.id })
        if (commentError) throw commentError
        logTaskActivity(supabase, task.id, user.id, 'added a comment')
      }

      // Record every assignee in the join table (source of truth) and notify each
      if (assignees.length > 0) {
        const { error: assigneeError } = await supabase
          .from('task_assignees')
          .insert(assignees.map(userId => ({ task_id: task.id, user_id: userId })))
        if (assigneeError) throw assigneeError

        const { data: currentUserProfile } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', user.id)
          .single()

        const notificationRows = assignees
          .filter((userId) => userId !== user.id)
          .map((userId) => ({
            recipient_id: userId,
            task_id: task.id,
            actor_id: user.id,
            type: 'assignment',
            message: `${currentUserProfile?.full_name || currentUserProfile?.email || 'Someone'} assigned you "${title}"`,
          }))

        if (notificationRows.length > 0) {
          const { error: notificationError } = await supabase
            .from('task_notifications')
            .insert(notificationRows)
          if (notificationError) throw notificationError
        }

        for (const userId of assignees) {
          const assignedUser = users.find(u => u.id === userId)
          if (assignedUser) {
            await sendTaskAssignmentEmail(
              assignedUser.email,
              assignedUser.full_name || assignedUser.email,
              title,
              description,
              priority.toString(),
              dueDate || null,
              board?.title || 'Project Board',
              currentUserProfile?.full_name || currentUserProfile?.email || 'Admin'
            )
          }
        }
      }

      toast.success('Task created', {
        description: assignees.length > 0 ? `${assignees.length} assignee${assignees.length === 1 ? '' : 's'} notified.` : 'Only you and admins can see it until assignees are added.',
      })

      // Reset form
      setTitle('')
      setDescription('')
      setAssignees([])
      setVisibility('assigned')
      setPriority(null)
      setStatus('')
      setDueDate('')
      setIsRecurring(false)
      setRecurrencePattern('daily')
      setRecurrenceInterval(1)
      setLinks([])
      setLinkTitle('')
      setLinkUrl('')
      setSelectedTagIds([])
      setInitialComment('')
      onOpenChange(false)
      
      // Trigger callback to refresh board data
      if (onTaskCreated) {
        onTaskCreated()
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to create task. Please try again.'
      setError(message)
      toast.error('Task was not created', { description: message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={guardedClose}>
      <DialogContent className="max-w-lg max-h-[95vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>Add a new task to {column?.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium">
              Task Title
            </label>
            <Input
              id="title"
              placeholder="Enter task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <VoiceInputButton
                value={description}
                onChange={setDescription}
                className="h-6 w-6 text-muted-foreground"
                title="Dictate description"
              />
            </div>
            <Textarea
              id="description"
              placeholder="Task description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Assign To {assignees.length > 0 && `(${assignees.length})`}
            </label>
            <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
              {users.length === 0 ? (
                <p className="text-xs text-muted-foreground">No users available</p>
              ) : (
                users.map((user) => {
                  const isAssigned = assignees.includes(user.id)
                  return (
                    <button
                      type="button"
                      key={user.id}
                      onClick={() => !loading && setAssignees(
                        isAssigned ? assignees.filter(id => id !== user.id) : [...assignees, user.id]
                      )}
                      className={`flex w-full items-center gap-2 rounded p-2 text-left transition-colors ${
                        isAssigned ? 'bg-primary/10 border border-primary' : 'hover:bg-accent'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        isAssigned ? 'bg-primary border-primary' : 'border-muted-foreground'
                      }`}>
                        {isAssigned && <span className="text-primary-foreground text-xs">✓</span>}
                      </div>
                      <span className="text-sm font-medium">{user.full_name || user.email}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="visibility" className="text-sm font-medium">
              Visibility
            </label>
            <Select value={visibility} onValueChange={(val: 'assigned' | 'board') => setVisibility(val)} disabled={loading}>
              <SelectTrigger id="visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="assigned">Only admins, creator, and assignees</SelectItem>
                <SelectItem value="board">Visible to everyone on the board</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LinkIcon className="h-4 w-4" />
              External links
            </div>
            {links.length > 0 && (
              <div className="space-y-2">
                {links.map((link, index) => (
                  <div key={`${link.url}-${index}`} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{link.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{link.url}</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setLinks((current) => current.filter((_, linkIndex) => linkIndex !== index))}
                      aria-label="Remove link"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
              <Input
                placeholder="Label"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                disabled={loading}
              />
              <Input
                type="url"
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                disabled={loading}
              />
              <Button type="button" variant="outline" onClick={addLink} disabled={loading || !linkUrl.trim()}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Tags
            </label>
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tags yet. Create one from a task&apos;s details after saving.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => {
                  const isSelected = selectedTagIds.includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        setSelectedTagIds((current) =>
                          isSelected ? current.filter((id) => id !== tag.id) : [...current, tag.id]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        isSelected ? 'text-white' : 'text-muted-foreground hover:border-foreground/40'
                      }`}
                      style={isSelected ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                    >
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="initial-comment" className="text-sm font-medium">
              Comment (optional)
            </label>
            <Textarea
              id="initial-comment"
              placeholder="Add a comment..."
              value={initialComment}
              onChange={(e) => setInitialComment(e.target.value)}
              disabled={loading}
              rows={2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="priority" className="text-sm font-medium">
                Priority <span className="text-destructive">*</span>
              </label>
              <Select value={priority === null ? '' : priority.toString()} onValueChange={(val) => setPriority(parseInt(val))} disabled={loading}>
                <SelectTrigger id="priority">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 - Highest</SelectItem>
                  <SelectItem value="2">2 - High</SelectItem>
                  <SelectItem value="3">3 - Medium</SelectItem>
                  <SelectItem value="4">4 - Low</SelectItem>
                  <SelectItem value="5">5 - Lowest</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="status" className="text-sm font-medium">
                Status <span className="text-destructive">*</span>
              </label>
              <Select value={status} onValueChange={setStatus} disabled={loading || creatableStatuses.length === 0}>
                <SelectTrigger id="status">
                  <SelectValue placeholder={creatableStatuses.length === 0 ? 'No status available' : 'Select status'} />
                </SelectTrigger>
                <SelectContent>
                  {creatableStatuses.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Scoping the list to what the board can take introduces one new way to reach a
                  dead end: a board whose only column is Cancelled now has nothing to offer. An
                  empty dropdown reads as a broken control, so say what is wrong and who fixes
                  it - the board banner above has the one-click remedy for an admin. */}
              {creatableStatuses.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This board has no column for any status a new task can start in. An admin can
                  add one from the board&apos;s &ldquo;Add Column&rdquo; button.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="dueDate" className="text-sm font-medium">
                Due Date
              </label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {/* Recurring Task Options */}
          <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Recurring Task</label>
              <button
                type="button"
                onClick={() => setIsRecurring(!isRecurring)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isRecurring ? 'bg-primary' : 'bg-muted-foreground/40'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                    isRecurring ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {isRecurring && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Pattern</label>
                  <Select value={recurrencePattern} onValueChange={(val: any) => setRecurrencePattern(val)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Every (interval)</label>
                  <Input
                    type="number"
                    min="1"
                    max="30"
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(parseInt(e.target.value) || 1)}
                    className="h-9"
                  />
                </div>
              </div>
            )}
            {isRecurring && (
              <p className="text-xs text-muted-foreground">
                This task will repeat every {recurrenceInterval} {recurrencePattern === 'daily' ? 'day(s)' : recurrencePattern === 'weekly' ? 'week(s)' : 'month(s)'}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={loading || !title.trim() || priority === null || !status}>
            {loading ? 'Creating Task...' : 'Create Task'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
