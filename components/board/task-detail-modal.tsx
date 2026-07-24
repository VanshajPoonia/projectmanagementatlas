'use client'

import type { ChangeEvent } from 'react'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { X, Calendar as CalendarIcon, Tag, User, Trash2, Upload, ImageIcon, MessageSquare, Send, FileText, Video, FileIcon, Download, LinkIcon, ExternalLink, Plus, History } from 'lucide-react'
import { format } from 'date-fns'
import { sendTaskAssignmentEmail, sendCommentEmail, sendTaskUpdateEmail } from '@/lib/email'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cleanTaskDescription } from '@/lib/display-text'
import { toast } from 'sonner'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { findColumnForStatus } from '@/lib/task-status'
import { logTaskActivity } from '@/lib/task-activity'
import SubtaskList from './subtask-list'

interface TaskDetailModalProps {
  board?: any
  taskId: string
  open: boolean
  onClose: () => void
  onUpdate: () => void
  isAdmin?: boolean
  currentUserId: string
  /** The caller's board_members row for this board, if any (null = no row = full default access). */
  boardRole?: 'member' | 'guest' | 'client' | null
  initialTab?: 'comments' | 'attachments' | 'links' | 'activity'
  /**
   * Fired when subtasks change. Separate from `onUpdate` because callers wire that to
   * close the modal — ticking a subtask should refresh the board underneath, not
   * dismiss the task you're working in.
   */
  onSubtaskChange?: () => void
}

export function TaskDetailModal({ taskId, open, onClose, onUpdate, board, isAdmin = false, currentUserId, boardRole = null, initialTab = 'comments', onSubtaskChange }: TaskDetailModalProps) {
  const supabase = createClient()
  const taskStatuses = useTaskStatuses()
  const [task, setTask] = useState<any>(null)
  const [activeTab, setActiveTab] = useState(initialTab)
  const [activity, setActivity] = useState<any[]>([])
  const [tags, setTags] = useState<any[]>([])
  const [allTags, setAllTags] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<number>(3)
  const [status, setStatus] = useState('to_do')
  const [visibility, setVisibility] = useState<'assigned' | 'board'>('assigned')
  const [dueDate, setDueDate] = useState<Date>()
  const [assignees, setAssignees] = useState<string[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3b82f6')
  const [attachments, setAttachments] = useState<any[]>([])
  const [comments, setComments] = useState<any[]>([])
  const [links, setLinks] = useState<any[]>([])
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [newComment, setNewComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)

  useEffect(() => {
    if (open && taskId) {
      setActiveTab(initialTab)
      loadTaskDetails()
      loadAllTags()
      loadAttachments()
      loadComments()
      loadLinks()
      loadCurrentUser()
      loadAssignees()
      loadUsers()
      loadActivity()
    }
  }, [open, taskId])

  // Mirrors the server-side restriction from migrations 065/067 — guest/client board
  // members can view but not create/edit/delete tasks.
  const isRestrictedMember = boardRole === 'guest' || boardRole === 'client'
  const canEdit = !isRestrictedMember && Boolean(
    isAdmin
    || task?.created_by === currentUserId
    || (typeof task?.assigned_to === 'string' ? task.assigned_to : task?.assigned_to?.id) === currentUserId
    || assignees.includes(currentUserId)
  )
  const canDelete = !isRestrictedMember && Boolean(isAdmin || task?.created_by === currentUserId)
  // Per the PM portal spec: the due date can only be changed by the task's creator (or an admin).
  const canEditDueDate = !isRestrictedMember && Boolean(isAdmin || task?.created_by === currentUserId)

  const loadAssignees = async () => {
    const { data } = await supabase
      .from('task_assignees')
      .select('user_id')
      .eq('task_id', taskId)
    if (data) {
      setAssignees(data.map((a: any) => a.user_id))
    }
  }

  const loadCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setCurrentUser(profile)
    }
  }

  const loadAttachments = async () => {
    const { data } = await supabase
      .from('task_attachments')
      .select('id, task_id, file_name, file_type, file_size, created_at, uploaded_by:profiles(full_name, email)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })

    if (!data) return

    // Images render an inline thumbnail and need file_data right away; everything
    // else only needs it on download, so skip pulling those (often large) blobs here.
    const imageIds = data.filter((attachment: any) => attachment.file_type?.startsWith('image/')).map((attachment: any) => attachment.id)

    if (imageIds.length === 0) {
      setAttachments(data)
      return
    }

    const { data: imageData } = await supabase
      .from('task_attachments')
      .select('id, file_data')
      .in('id', imageIds)

    const fileDataById = new Map((imageData ?? []).map((row: any) => [row.id, row.file_data]))
    setAttachments(data.map((attachment: any) => ({ ...attachment, file_data: fileDataById.get(attachment.id) })))
  }

  const loadComments = async () => {
    const { data, error } = await supabase
      .from('task_comments')
      .select('*, author:profiles!task_comments_author_id_fkey(full_name, email)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[v0] Failed to load comments:', error)
      return
    }
    if (data) setComments(data)
  }

  const loadActivity = async () => {
    const { data, error } = await supabase
      .from('task_activity')
      .select('*, actor:profiles(full_name, email)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[v0] Failed to load activity:', error)
      return
    }
    if (data) setActivity(data)
  }

  const loadLinks = async () => {
    const { data } = await supabase
      .from('task_links')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    if (data) setLinks(data)
  }

  const loadTaskDetails = async () => {
    const { data: taskData } = await supabase
      .from('tasks')
      .select('*, assigned_user:profiles!tasks_assigned_to_fkey(id, full_name, email), creator:profiles!tasks_created_by_fkey(full_name, email), task_tags(tag:tags(*))')
      .eq('id', taskId)
      .single()

    if (taskData) {
      setTask(taskData)
      setTitle(taskData.title)
      setDescription(cleanTaskDescription(taskData.description))
      setPriority(taskData.priority)
      setStatus(taskData.status)
      setVisibility(taskData.visibility || 'assigned')
      setDueDate(taskData.due_date ? new Date(taskData.due_date) : undefined)
      setTags(taskData.task_tags?.map((tt: any) => tt.tag) || [])
    }
  }

  const loadAllTags = async () => {
    const { data } = await supabase
      .from('tags')
      .select('*')
      .order('name')
    if (data) setAllTags(data)
  }

  const loadUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .order('full_name')
    if (data) setUsers(data)
  }

  const handleUpdate = async () => {
    if (!title.trim()) return

    setLoading(true)

    // Auto-generate entry_date when task is marked as complete
    const updateData: any = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status,
      due_date: dueDate?.toISOString() || null,
      visibility,
      // task_assignees is the source of truth; keep assigned_to as a mirror of the first assignee
      assigned_to: assignees[0] || null,
    }
    
    // If status changed to 'done', set entry_date to now
    if (status === 'done' && task?.status !== 'done') {
      updateData.entry_date = new Date().toISOString()
    }

    // Board columns are the source of truth for where a card sits, so when the
    // status changes here, relocate the card into the column that represents it
    // (same behaviour as the inline status dropdown on the tile).
    if (task?.status !== status) {
      const boardId = board?.id || task?.board_id
      if (boardId) {
        const { data: boardColumns } = await supabase
          .from('columns')
          .select('id, title, position')
          .eq('board_id', boardId)
          .order('position')
        const statusLabel = taskStatuses.find((s) => s.key === status)?.label
        const matchingColumn = findColumnForStatus(status, statusLabel, boardColumns as any)
        if (matchingColumn && matchingColumn.id !== task?.column_id) {
          updateData.column_id = matchingColumn.id
        }
      }
    }

    const { error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)

    if (!error) {
      // Get current user info for notifications
      const { data: { user } } = await supabase.auth.getUser()
      const { data: currentUserProfile } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', user?.id || '')
        .single()
      const actorId = currentUserProfile?.id || user?.id

      // Diff against the task as it was before this save, once, for both the
      // assignee notification text and the task's activity log.
      const changes: string[] = []
      const activityMessages: string[] = []
      const dueDateISO = dueDate?.toISOString() || null
      if (task?.title !== title) {
        changes.push(`Title updated to "${title}"`)
        activityMessages.push(`renamed the task from "${task?.title}" to "${title}"`)
      }
      if (cleanTaskDescription(task?.description) !== description) {
        changes.push('Description updated')
        activityMessages.push('updated the description')
      }
      if (task?.priority !== priority) {
        changes.push(`Priority changed to ${priority}`)
        activityMessages.push(`changed priority from ${task?.priority} to ${priority}`)
      }
      if (task?.status !== status) {
        const oldLabel = taskStatuses.find((s) => s.key === task?.status)?.label || task?.status
        const newLabel = taskStatuses.find((s) => s.key === status)?.label || status
        changes.push(`Status changed to ${newLabel}`)
        activityMessages.push(`changed status from "${oldLabel}" to "${newLabel}"`)
      }
      if ((task?.visibility || 'assigned') !== visibility) {
        const visLabel = visibility === 'board' ? 'board visible' : 'assigned only'
        changes.push(`Visibility changed to ${visLabel}`)
        activityMessages.push(`changed visibility to ${visLabel}`)
      }
      if ((task?.due_date || null) !== dueDateISO) {
        changes.push('Due date updated')
        activityMessages.push(dueDate ? `set the due date to ${format(dueDate, 'PP')}` : 'removed the due date')
      }

      if (actorId) {
        activityMessages.forEach((message) => logTaskActivity(supabase, taskId, actorId, message))
      }

      // Send update notification to all assignees if task details changed
      if (assignees.length > 0) {
        if (changes.length > 0) {
          const notificationRows = assignees
            .filter((userId) => userId !== actorId)
            .map((userId) => ({
              recipient_id: userId,
              task_id: taskId,
              actor_id: actorId,
              type: 'update',
              message: `${currentUserProfile?.full_name || currentUserProfile?.email || 'Someone'} updated "${title}": ${changes.join(', ')}`,
            }))

          if (actorId && notificationRows.length > 0) {
            const { error: notificationError } = await supabase
              .from('task_notifications')
              .insert(notificationRows)

            if (notificationError) {
              console.error('Could not create task update notifications', notificationError)
            }
          }

          for (const userId of assignees) {
            const user = users.find(u => u.id === userId)
            if (user && user.id !== actorId) {
              await sendTaskUpdateEmail(
                user.email,
                user.full_name || user.email,
                title,
                currentUserProfile?.full_name || currentUserProfile?.email || 'Someone',
                changes.join(', ')
              )
            }
          }
        }
      }
      
      onUpdate()
      loadTaskDetails()
      toast.success('Task updated')
    } else {
      toast.error('Could not update task', { description: error.message })
    }

    setLoading(false)
  }

  const handleAddTag = async (tagId: string) => {
    const { error } = await supabase
      .from('task_tags')
      .insert({ task_id: taskId, tag_id: tagId })

    if (!error) {
      const tag = allTags.find((t) => t.id === tagId)
      logTaskActivity(supabase, taskId, currentUser?.id, `added tag "${tag?.name || 'Unknown'}"`)
      loadTaskDetails()
    }
  }

  const handleRemoveTag = async (tagId: string) => {
    await supabase
      .from('task_tags')
      .delete()
      .eq('task_id', taskId)
      .eq('tag_id', tagId)

    const tag = allTags.find((t) => t.id === tagId)
    logTaskActivity(supabase, taskId, currentUser?.id, `removed tag "${tag?.name || 'Unknown'}"`)
    loadTaskDetails()
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return

    const { data, error } = await supabase
      .from('tags')
      .insert({ name: newTagName.trim(), color: newTagColor })
      .select()
      .single()

    if (!error && data) {
      setAllTags([...allTags, data])
      handleAddTag(data.id)
      setNewTagName('')
      setNewTagColor('#3b82f6')
    }
  }

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentUser) {
      console.log('[v0] No file or user for upload')
      return
    }

    console.log('[v0] Uploading file:', file.name, 'Size:', file.size)

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      console.log('[v0] File too large')
      alert('File size must be less than 10MB')
      e.target.value = '' // Reset input
      return
    }

    setUploading(true)
    
    try {
      // Convert file to base64 for storage
      const reader = new FileReader()
      reader.onloadend = async () => {
        try {
          const base64 = reader.result as string
          
          const { error } = await supabase
            .from('task_attachments')
            .insert({
              task_id: taskId,
              file_name: file.name,
              file_type: file.type,
              file_data: base64,
              file_size: file.size,
              uploaded_by: currentUser.id
            })

          if (error) throw error
          
          await loadAttachments()
          e.target.value = '' // Reset input for next upload
        } catch (err) {
          console.error('[v0] Upload error:', err)
          alert('Failed to upload file. Please try again.')
        } finally {
          setUploading(false)
        }
      }
      reader.onerror = () => {
        console.error('[v0] File read error')
        alert('Failed to read file')
        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch (err) {
      console.error('[v0] File upload error:', err)
      setUploading(false)
    }
  }

  const handleAddComment = async () => {
    if (!newComment.trim() || !currentUser) {
      console.log('[v0] Cannot add comment - no text or user')
      return
    }

    const commentText = newComment.trim()
    setNewComment('') // Clear immediately for better UX
    console.log('[v0] Adding comment:', commentText)
    
    try {
      const { error } = await supabase
        .from('task_comments')
        .insert({
          task_id: taskId,
          comment: commentText,
          user_id: currentUser.id,
          author_id: currentUser.id
        })

      if (error) throw error

      console.log('[v0] Comment added successfully')
      logTaskActivity(supabase, taskId, currentUser.id, 'added a comment')
      await loadComments()

      // Send email notifications to all assignees
      if (assignees.length > 0) {
        console.log('[v0] Sending email notifications to assignees')
        for (const userId of assignees) {
          const user = users.find(u => u.id === userId)
          if (user && user.id !== currentUser.id) {
            await sendCommentEmail(
              user.email,
              user.full_name || user.email,
              title,
              currentUser.full_name || currentUser.email,
              commentText
            )
          }
        }
      }
    } catch (err) {
      console.error('[v0] Comment error:', err)
      setNewComment(commentText) // Restore comment if failed
      alert('Failed to add comment. Please try again.')
    }
  }

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!confirm('Delete this attachment?')) return
    
    await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId)
    
    loadAttachments()
  }

  const handleToggleAssignee = async (userId: string) => {
    if (!canEdit) return

    const isAssigned = assignees.includes(userId)
    const newAssignees = isAssigned
      ? assignees.filter(id => id !== userId)
      : [...assignees, userId]

    if (isAssigned) {
      const { error } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .eq('user_id', userId)
      if (error) {
        toast.error('Could not remove assignee', { description: error.message })
        return
      }
    } else {
      const { error } = await supabase
        .from('task_assignees')
        .insert({ task_id: taskId, user_id: userId })
      if (error) {
        toast.error('Could not add assignee', { description: error.message })
        return
      }
    }
    setAssignees(newAssignees)

    // Keep the assigned_to mirror in sync with the first assignee
    await supabase
      .from('tasks')
      .update({ assigned_to: newAssignees[0] || null })
      .eq('id', taskId)

    const toggledUser = users.find((u) => u.id === userId)
    logTaskActivity(
      supabase,
      taskId,
      currentUser?.id,
      `${isAssigned ? 'removed' : 'added'} assignee ${toggledUser?.full_name || toggledUser?.email || 'Unknown'}`
    )

    // Notify a newly added assignee
    if (!isAssigned) {
      const assignedUser = users.find(u => u.id === userId)
      if (assignedUser) {
        if (userId !== currentUser?.id) {
          await supabase
            .from('task_notifications')
            .insert({
              recipient_id: userId,
              task_id: taskId,
              actor_id: currentUser?.id,
              type: 'assignment',
              message: `${currentUser?.full_name || currentUser?.email || 'Someone'} assigned you "${title}"`,
            })
        }

        await sendTaskAssignmentEmail(
          assignedUser.email,
          assignedUser.full_name || assignedUser.email,
          title,
          description,
          priority.toString(),
          dueDate?.toISOString() || null,
          board?.title || 'Project Board',
          currentUser?.full_name || currentUser?.email || 'Admin'
        )
        toast.success('Assignee notified', {
          description: `${assignedUser.full_name || assignedUser.email} was added to this task.`,
        })
      }
    }
  }

  const handleAddLink = async () => {
    if (!canEdit || !linkUrl.trim() || !currentUser) return

    const { error } = await supabase
      .from('task_links')
      .insert({
        task_id: taskId,
        title: linkTitle.trim() || linkUrl.trim(),
        url: linkUrl.trim(),
        created_by: currentUser.id,
      })

    if (error) {
      toast.error('Could not add link', { description: error.message })
      return
    }

    setLinkTitle('')
    setLinkUrl('')
    await loadLinks()
    toast.success('Link added')
  }

  const handleDeleteLink = async (linkId: string) => {
    if (!canEdit) return

    const { error } = await supabase
      .from('task_links')
      .delete()
      .eq('id', linkId)

    if (error) {
      toast.error('Could not remove link', { description: error.message })
      return
    }

    await loadLinks()
    toast.success('Link removed')
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return

    const { error } = await supabase
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: currentUserId })
      .eq('id', taskId)

    if (error) {
      toast.error('Could not delete task', { description: error.message })
      return
    }

    onUpdate()
    onClose()
    toast.success('Task deleted', {
      description: 'You can undo this action for a short time.',
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error: undoError } = await supabase
            .from('tasks')
            .update({ deleted_at: null, deleted_by: null })
            .eq('id', taskId)
          if (undoError) {
            toast.error('Could not restore task')
          } else {
            toast.success('Task restored')
            onUpdate()
          }
        },
      },
    })
  }

  const availableTags = allTags.filter(tag => !tags.find(t => t.id === tag.id))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Task Details</DialogTitle>
          {task?.created_at && (
            <p className="text-xs text-muted-foreground">
              Created by {task.creator?.full_name || task.creator?.email || 'Unknown'} on{' '}
              {new Date(task.created_at).toLocaleString('en-US')}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              disabled={!canEdit}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={5}
              disabled={!canEdit}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Priority (1-5)</label>
              <Select value={priority?.toString() || '3'} onValueChange={(val) => setPriority(parseInt(val))} disabled={!canEdit}>
                <SelectTrigger>
                  <SelectValue />
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

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus} disabled={!canEdit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {taskStatuses.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                  {/* Keep the task's current status selectable even if it has since been archived. */}
                  {status && !taskStatuses.some((s) => s.key === status) && (
                    <SelectItem value={status}>{status.replace(/_/g, ' ')}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(value: 'assigned' | 'board') => setVisibility(value)} disabled={!canEdit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="assigned">Only admins, creator, and assignees</SelectItem>
                <SelectItem value="board">Visible to everyone on the board</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Due Date — only the creator (or an admin) can change it */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" />
              Due Date
              {!canEditDueDate && <span className="text-xs font-normal text-muted-foreground">(Creator only)</span>}
            </Label>
            {canEditDueDate ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal bg-transparent">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <div className="w-full p-2 border rounded-md bg-muted text-muted-foreground">
                {dueDate ? format(dueDate, 'PPP') : 'No due date set'}
              </div>
            )}
          </div>

          {/* Entry Date (Auto-generated, read-only) */}
          {task?.entry_date && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-muted-foreground">
                <CalendarIcon className="w-4 h-4" />
                Entry Date (Completed)
              </Label>
              <div className="w-full p-2 border rounded-md bg-green-50 text-green-700 font-medium">
                {new Date(task.entry_date).toLocaleString()}
              </div>
            </div>
          )}

          {/* Assigned Users - Multiple Selection */}
          {canEdit && (
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Assigned To ({assignees.length} {assignees.length === 1 ? 'person' : 'people'})
              </Label>
              
              {/* Display assigned users */}
              <div className="flex flex-wrap gap-2">
                {assignees.length === 0 ? (
                  <Badge variant="outline" className="text-muted-foreground">No assignees</Badge>
                ) : (
                  assignees.map(userId => {
                    const user = users.find(u => u.id === userId)
                    return (
                      <Badge key={userId} className="gap-1 pr-1">
                        {user?.full_name || user?.email || 'Unknown'}
                        <button
                          type="button"
                          onClick={() => handleToggleAssignee(userId)}
                          className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    )
                  })
                )}
              </div>

              {/* Add more assignees */}
              <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                <p className="text-xs text-muted-foreground font-medium">Click to add/remove users:</p>
                {users.map(user => {
                  const isAssigned = assignees.includes(user.id)
                  return (
                    <button
                      type="button"
                      key={user.id}
                      onClick={() => handleToggleAssignee(user.id)}
                      className={`flex w-full items-center justify-between rounded p-2 text-left transition-colors ${
                        isAssigned ? 'bg-primary/10 border border-primary' : 'hover:bg-accent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isAssigned ? 'bg-primary border-primary' : 'border-muted-foreground'
                        }`}>
                          {isAssigned && <span className="text-primary-foreground text-xs">✓</span>}
                        </div>
                        <span className="text-sm font-medium">{user.full_name || user.email}</span>
                        <span className="text-xs text-muted-foreground">({user.email})</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!canEdit && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Assigned To
              </Label>
              <div className="flex flex-wrap gap-2">
                {assignees.length === 0 ? (
                  <Badge variant="outline" className="text-muted-foreground">No assignees</Badge>
                ) : (
                  assignees.map(userId => {
                    const user = users.find(u => u.id === userId)
                    return (
                      <Badge key={userId} variant="outline">
                        {user?.full_name || user?.email || 'Unknown'}
                      </Badge>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Tags
            </Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map(tag => (
                <Badge
                  key={tag.id}
                  style={{ backgroundColor: tag.color }}
                  className="text-white flex items-center gap-1"
                >
                  {tag.name}
                  {canEdit && (
                    <button type="button" onClick={() => handleRemoveTag(tag.id)}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>

            {canEdit && (
              <>
                <Select onValueChange={handleAddTag}>
                  <SelectTrigger>
                    <SelectValue placeholder="Add existing tag" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTags.map(tag => (
                      <SelectItem key={tag.id} value={tag.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {isAdmin && (
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="New tag name"
                    />
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="w-12 h-10 rounded border cursor-pointer"
                    />
                    <Button onClick={handleCreateTag} variant="outline">
                      Create Tag
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Subtasks — only on top-level tasks; nesting is capped at one level (060). */}
          {task && !task.parent_task_id && (
            <div className="border-t pt-4">
              <SubtaskList
                parentTask={task}
                currentUserId={currentUserId}
                canEdit={canEdit}
                users={users}
                board={board}
                currentUser={currentUser}
                onChange={() => {
                  loadActivity()
                  onSubtaskChange?.()
                }}
              />
            </div>
          )}

          {/* Attachments, Comments, and Activity */}
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value as typeof activeTab)
              if (value === 'activity') loadActivity()
            }}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="comments" className="gap-2">
                <MessageSquare className="w-4 h-4" />
                Comments ({comments.length})
              </TabsTrigger>
              <TabsTrigger value="attachments" className="gap-2">
                <ImageIcon className="w-4 h-4" />
                Attachments ({attachments.length})
              </TabsTrigger>
              <TabsTrigger value="links" className="gap-2">
                <LinkIcon className="w-4 h-4" />
                Links ({links.length})
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-2">
                <History className="w-4 h-4" />
                Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="space-y-4">
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-4">
                  {comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No comments yet</p>
                  ) : (
                    comments.map((comment) => (
                      <div key={comment.id} className="flex gap-3 p-3 bg-muted/50 rounded-lg">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>
                            {comment.author?.full_name?.[0] || comment.author?.email?.[0] || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {comment.author?.full_name || comment.author?.email}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(comment.created_at).toLocaleDateString('en-US')}
                            </span>
                          </div>
                          <p className="text-sm">{comment.comment}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleAddComment()
                    }
                  }}
                />
                <Button 
                  onClick={handleAddComment} 
                  size="icon" 
                  disabled={!newComment.trim()}
                  type="button"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="attachments" className="space-y-4">
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                  {attachments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No attachments</p>
                  ) : (
                    attachments.map((attachment) => {
                      const isImage = attachment.file_type?.startsWith('image/')
                      const isPDF = attachment.file_type === 'application/pdf'
                      const isVideo = attachment.file_type?.startsWith('video/')
                      const isDoc = attachment.file_type?.includes('document') || attachment.file_type?.includes('word') || attachment.file_type?.includes('sheet') || attachment.file_type?.includes('excel')
                      
                      const getFileIcon = () => {
                        if (isPDF) return <FileText className="w-8 h-8 text-red-500" />
                        if (isVideo) return <Video className="w-8 h-8 text-purple-500" />
                        if (isDoc) return <FileIcon className="w-8 h-8 text-blue-500" />
                        return <FileIcon className="w-8 h-8 text-gray-500" />
                      }
                      
                      return (
                        <div key={attachment.id} className="relative group border rounded-lg p-3 hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0">
                              {isImage ? (
                                <img
                                  src={attachment.file_data || "/placeholder.svg"}
                                  alt={attachment.file_name}
                                  className="w-16 h-16 object-cover rounded"
                                />
                              ) : (
                                <div className="w-16 h-16 bg-muted rounded flex items-center justify-center">
                                  {getFileIcon()}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{attachment.file_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(attachment.file_size / 1024).toFixed(1)} KB
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(attachment.created_at).toLocaleDateString('en-US')}
                              </p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 bg-transparent"
                                onClick={async () => {
                                  let fileData = attachment.file_data
                                  if (!fileData) {
                                    const { data } = await supabase
                                      .from('task_attachments')
                                      .select('file_data')
                                      .eq('id', attachment.id)
                                      .single()
                                    fileData = data?.file_data
                                  }
                                  if (!fileData) {
                                    toast.error('Could not download file')
                                    return
                                  }
                                  const link = document.createElement('a')
                                  link.href = fileData
                                  link.download = attachment.file_name
                                  link.click()
                                }}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                              {canDelete && (
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleDeleteAttachment(attachment.id)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>

              <div>
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept="*/*"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                <Button
                  variant="outline"
                  className="w-full gap-2 bg-transparent"
                  onClick={() => document.getElementById('file-upload')?.click()}
                  disabled={uploading}
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading...' : 'Upload File'}
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Images, PDFs, Videos, Documents, Sheets - All file types supported
                </p>
              </div>
            </TabsContent>

            <TabsContent value="links" className="space-y-4">
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                  {links.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No links yet</p>
                  ) : (
                    links.map((link) => (
                      <div key={link.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-w-0 items-center gap-2 break-words text-sm font-medium text-primary hover:underline [overflow-wrap:anywhere]"
                          >
                            <ExternalLink className="h-4 w-4 shrink-0" />
                            {link.title}
                          </a>
                          <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{link.url}</p>
                        </div>
                        {canEdit && (
                          <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteLink(link.id)} aria-label="Remove link">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              {canEdit && (
                <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                  <Input
                    placeholder="Label"
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                  />
                  <Input
                    type="url"
                    placeholder="https://..."
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                  />
                  <Button onClick={handleAddLink} variant="outline" disabled={!linkUrl.trim()}>
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity" className="space-y-4">
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-4">
                  {activity.length === 0 && !task?.created_at ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No activity yet</p>
                  ) : (
                    <>
                      {activity.map((entry) => (
                        <div key={entry.id} className="flex gap-3 p-3 bg-muted/50 rounded-lg">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {entry.actor?.full_name?.[0] || entry.actor?.email?.[0] || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">
                                {entry.actor?.full_name || entry.actor?.email || 'Unknown'}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(entry.created_at).toLocaleString('en-US')}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{entry.action}</p>
                          </div>
                        </div>
                      ))}
                      {task?.created_at && (
                        <div className="flex gap-3 p-3 bg-muted/50 rounded-lg">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {task.creator?.full_name?.[0] || task.creator?.email?.[0] || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">
                                {task.creator?.full_name || task.creator?.email || 'Unknown'}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(task.created_at).toLocaleString('en-US')}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">created the task</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {/* Actions */}
          <div className="flex justify-between pt-4">
            {canDelete && (
              <Button onClick={handleDelete} variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Task
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button onClick={onClose} variant="outline">
                Cancel
              </Button>
              {canEdit && (
                <Button onClick={handleUpdate} disabled={loading || !title.trim()}>
                  {loading ? 'Updating...' : 'Update Task'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
