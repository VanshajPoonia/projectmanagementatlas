'use client'

import type { FormEvent } from 'react'
import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createClient } from '@/lib/supabase/client'
import { sendTaskAssignmentEmail } from '@/lib/email'
import { LinkIcon, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { getNormalizedTaskStatus } from '@/lib/task-status'

interface CreateTaskDialogProps {
  board?: any
  open: boolean
  onOpenChange: (open: boolean) => void
  column: any
  users: any[]
  boardId: string
  onTaskCreated?: () => void
}

export default function CreateTaskDialog({ open, onOpenChange, column, users, boardId, board, onTaskCreated }: CreateTaskDialogProps) {
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()
  const taskStatuses = useTaskStatuses()

  // Surface the column's implied status (normalized to a real status key) when the dialog
  // opens so the user can confirm it, and so the default always matches a managed status.
  useEffect(() => {
    if (open && column?.title) {
      setStatus(getNormalizedTaskStatus({ column: { title: column.title } }))
    }
  }, [open, column])

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
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) throw new Error('User not authenticated')

      const taskData = {
        title,
        description,
        column_id: column.id,
        assigned_to: assignees[0] || null,
        created_by: user.id,
        priority,
        due_date: dueDate || null,
        status,
        position: column.tasks?.length || 0,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <label htmlFor="description" className="text-sm font-medium">
              Description
            </label>
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
              <Select value={status} onValueChange={setStatus} disabled={loading}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {taskStatuses.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  isRecurring ? 'bg-primary' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
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
