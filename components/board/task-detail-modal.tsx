'use client'

import type { ChangeEvent } from 'react'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { VoiceInputButton } from '@/components/ui/voice-input-button'
import { ShareLinkDialog } from './share-link-dialog'
import { MoveTaskDialog } from './move-task-dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { X, Calendar as CalendarIcon, Tag, User, Trash2, Upload, ImageIcon, MessageSquare, Send, FileText, Video, FileIcon, Download, LinkIcon, ExternalLink, Plus, History, Repeat, FolderInput } from 'lucide-react'
import { format } from 'date-fns'
import { sendTaskAssignmentEmail, sendCommentEmail, sendTaskUpdateEmail } from '@/lib/email'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { can, type Actor } from '@/lib/capabilities'
import { classifyWrite, didWrite, writeFailureMessage } from '@/lib/rls-write'
import { ActionGuard, RestrictionNote, guardAction } from '@/components/shell/action-guard'
import { cleanTaskDescription } from '@/lib/display-text'
import { toast } from 'sonner'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { findExactColumnForStatus, statusesForPicker } from '@/lib/task-status'
import { logTaskActivity } from '@/lib/task-activity'
import {
  buildTaskAssetPath,
  formatAttachmentSize,
  isLargeAttachment,
  resolveTaskAttachmentMimeType,
  TASK_ASSET_BUCKET,
  TASK_ASSET_SIGNED_URL_SECONDS,
  TASK_ATTACHMENT_ACCEPT,
  validateTaskAttachment,
} from '@/lib/task-attachments'
import SubtaskList from './subtask-list'
import TaskCustomFields from './task-custom-fields'
import TaskRelationsPanel from './task-relations-panel'
import TaskRecurrencePanel from './task-recurrence-panel'
import TaskRemindersPanel from './task-reminders-panel'

// Mirrors the marketing calendar's custom-recurrence weekday row (and the booking
// restriction dialog it was itself borrowed from) - 0=Sunday..6=Saturday.
const RECURRENCE_WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

function describeRecurrence(pattern: 'daily' | 'weekly' | 'monthly' | 'custom', interval: number, weekdays: number[]) {
  if (pattern === 'custom') {
    if (weekdays.length === 0) return 'no days selected yet'
    const sorted = [...weekdays].sort((a, b) => a - b)
    return `on ${sorted.map(d => RECURRENCE_WEEKDAYS[d].label).join(', ')}`
  }
  const unit = pattern === 'daily' ? 'day(s)' : pattern === 'weekly' ? 'week(s)' : 'month(s)'
  return `every ${interval} ${unit}`
}

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
  /**
   * The board's columns, when the caller has them. Used only to scope the status picker to
   * what this board can accept. Optional and fails open: without it every status is offered,
   * exactly as before, and the save handler still refuses an impossible one.
   */
  columns?: Array<{ id: string; title: string; status_key?: string | null }> | null
  initialTab?: 'comments' | 'attachments' | 'links' | 'activity'
  /**
   * Fired when subtasks change. Separate from `onUpdate` because callers wire that to
   * close the modal - ticking a subtask should refresh the board underneath, not
   * dismiss the task you're working in.
   */
  onSubtaskChange?: () => void
}

export function TaskDetailModal({ taskId, open, onClose, onUpdate, board, isAdmin = false, currentUserId, boardRole = null, columns = null, initialTab = 'comments', onSubtaskChange }: TaskDetailModalProps) {
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
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrencePattern, setRecurrencePattern] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('daily')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([])
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
  const [largeUpload, setLargeUpload] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [moveOpen, setMoveOpen] = useState(false)

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

  // All five gates below come from lib/capabilities.ts, which is where the guest/client
  // restriction (migrations 065/067) and the creator/assignee rules now live - one
  // definition shared with task-card and board-view instead of three copies.
  //
  // `platformRole` is read off the loaded profile rather than the isAdmin prop on
  // purpose: app/dashboard/board/[id]/page.tsx hardcodes isAdmin={false} so that route's
  // edit permissions stay non-admin, and passing both lets `task.attach.large` (migration
  // 091) still resolve for a real admin who opened the board from /dashboard. Both admin
  // and super_admin count, because private.is_admin_user() - the function the RLS policy
  // actually calls - is true for both (migration 047).
  const actor: Actor = {
    userId: currentUserId ?? '',
    platformRole: (currentUser?.role as Actor['platformRole']) ?? 'user',
    boardRole,
    isAdmin,
  }
  const subject = {
    created_by: task?.created_by,
    assigned_to: task?.assigned_to,
    assigneeIds: assignees,
  }
  const editDecision = can(actor, 'task.edit', subject)
  const dueDateDecision = can(actor, 'task.schedule', subject)
  const attachDecision = can(actor, 'task.attach', subject)
  const commentDecision = can(actor, 'comment.create', subject)
  const shareDecision = can(actor, 'share.external', subject)

  /**
   * Deleting an attachment is decided PER FILE, not per task: 091's policy is
   * `uploaded_by = auth.uid() OR can_delete_task(...)`, so an assignee keeps control of
   * their own upload while not being able to remove anyone else's. A single
   * task-level flag could not express that and silently took the uploader's own file
   * away from them.
   */
  const attachmentDeleteDecision = (uploadedBy: string | null | undefined) =>
    can(actor, 'task.attachment.delete', { ...subject, uploadedBy })

  const canUploadLargeFiles = can(actor, 'task.attach.large', subject).allowed
  const canEdit = editDecision.allowed
  // Per the PM portal spec: the due date can only be changed by the task's creator (or an admin).
  const canEditDueDate = dueDateDecision.allowed

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
      // `uploaded_by` is the raw uuid, not an embedded profile: 091's DELETE policy keys
      // off `uploaded_by = auth.uid()`, so the per-file delete decision needs the id. The
      // embedded profile this replaces was fetched and never rendered.
      .select('id, task_id, file_name, file_type, file_size, storage_path, created_at, uploaded_by')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })

    if (!data) return

    // Images render an inline thumbnail and need their bytes right away; everything
    // else only needs them on download, so skip pulling those (often large) blobs here.
    const images = data.filter((attachment: any) => attachment.file_type?.startsWith('image/'))

    // Storage-backed rows (migration 091) carry no file_data at all - a thumbnail for
    // one comes from a short-lived signed URL instead of a base64 data URI.
    const inlineImageIds = images.filter((a: any) => !a.storage_path).map((a: any) => a.id)
    const storageImagePaths = images.filter((a: any) => a.storage_path).map((a: any) => a.storage_path)

    if (inlineImageIds.length === 0 && storageImagePaths.length === 0) {
      setAttachments(data)
      return
    }

    const [inlineResult, signedResult] = await Promise.all([
      inlineImageIds.length
        ? supabase.from('task_attachments').select('id, file_data').in('id', inlineImageIds)
        : Promise.resolve({ data: [] as any[] }),
      storageImagePaths.length
        ? supabase.storage
            .from(TASK_ASSET_BUCKET)
            .createSignedUrls(storageImagePaths, TASK_ASSET_SIGNED_URL_SECONDS)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const fileDataById = new Map((inlineResult.data ?? []).map((row: any) => [row.id, row.file_data]))
    const signedByPath = new Map(
      (signedResult.data ?? [])
        .filter((row: any) => row.signedUrl && !row.error)
        .map((row: any) => [row.path, row.signedUrl]),
    )

    setAttachments(data.map((attachment: any) => ({
      ...attachment,
      file_data: attachment.storage_path
        ? signedByPath.get(attachment.storage_path)
        : fileDataById.get(attachment.id),
    })))
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
      .select('*, column:columns(id, board_id, status_key, title), assigned_user:profiles!tasks_assigned_to_fkey(id, full_name, email), creator:profiles!tasks_created_by_fkey(full_name, email), task_tags(tag:tags(*))')
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
      setIsRecurring(Boolean(taskData.is_recurring))
      setRecurrencePattern(taskData.recurrence_pattern || 'daily')
      setRecurrenceInterval(taskData.recurrence_interval || 1)
      setRecurrenceWeekdays(taskData.recurrence_weekdays || [])
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
    if (isRecurring && recurrencePattern === 'custom' && recurrenceWeekdays.length === 0) {
      toast.error('Select at least one day for a custom recurrence')
      return
    }

    setLoading(true)

    let effectiveStatus = status
    let matchingColumnId: string | undefined

    // Board columns are the source of truth for where a card sits, so when the
    // status changes here, relocate the card into the column that represents it
    // (same behaviour as the inline status dropdown on the tile). Only an exact
    // column match counts - bucketing a status like "cancel" into whatever column
    // happens to share its done/in-progress/to-do bucket would silently move the
    // task somewhere the user didn't choose, so that's rejected instead.
    if (task?.status !== status) {
      const boardId = board?.id || task?.board_id
      const statusLabel = taskStatuses.find((s) => s.key === status)?.label
      const { data: boardColumns } = boardId
        ? await supabase.from('columns').select('id, title, position, status_key').eq('board_id', boardId).order('position')
        : { data: null }
      const matchingColumn = findExactColumnForStatus(status, statusLabel, boardColumns as any)

      if (!matchingColumn) {
        toast.error(`No column on this board is linked to "${statusLabel || status}"`, {
          description: 'An admin can link a column to it from the column\'s "⋮" menu → Link Status. Other changes will still be saved.',
        })
        effectiveStatus = task?.status
        setStatus(task?.status)
      } else if (matchingColumn.id !== task?.column_id) {
        matchingColumnId = matchingColumn.id
      }
    }

    // Auto-generate entry_date when task is marked as complete
    const updateData: any = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status: effectiveStatus,
      due_date: dueDate?.toISOString() || null,
      visibility,
      is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? recurrencePattern : null,
      recurrence_interval: isRecurring && recurrencePattern !== 'custom' ? recurrenceInterval : null,
      recurrence_weekdays: isRecurring && recurrencePattern === 'custom' ? recurrenceWeekdays : null,
      // task_assignees is the source of truth; keep assigned_to as a mirror of the first assignee
      assigned_to: assignees[0] || null,
    }

    // If status changed to 'done', set entry_date to now
    if (effectiveStatus === 'done' && task?.status !== 'done') {
      updateData.entry_date = new Date().toISOString()
    }

    if (matchingColumnId) {
      updateData.column_id = matchingColumnId
    }

    /**
     * ⚠️ This is the one task write that genuinely needs the readability probe.
     *
     * `updateData` carries `visibility` and `assigned_to`, both inputs to
     * private.can_view_task, so a save that sets visibility='assigned' while removing the
     * saver from the assignees succeeds and then returns zero rows - they can no longer
     * read what they just wrote. A bare row count would call that a refusal and send them
     * back to redo a change that is already in the database. See lib/rls-write.ts.
     */
    const outcome = await classifyWrite(
      await supabase.from('tasks').update(updateData).eq('id', taskId).select('id'),
      {
        stillReadable: async () => {
          const { data } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle()
          return Boolean(data)
        },
      },
    )
    const failure = writeFailureMessage(outcome, 'task')
    if (failure) {
      toast.error(failure.title, { description: failure.description })
    }

    if (didWrite(outcome)) {
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
        const newLabel = taskStatuses.find((s) => s.key === status)?.label || status
        changes.push(`Status changed to ${newLabel}`)
        // The database lifecycle trigger records the canonical structured status
        // transition in the same transaction; a second legacy row here would
        // double-count it in timing metrics.
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
      const weekdaysChanged = [...(task?.recurrence_weekdays || [])].sort().join(',') !== [...recurrenceWeekdays].sort().join(',')
      if (Boolean(task?.is_recurring) !== isRecurring) {
        const recurrenceLabel = describeRecurrence(recurrencePattern, recurrenceInterval, recurrenceWeekdays)
        changes.push(isRecurring ? `Set to recur ${recurrenceLabel}` : 'Recurrence turned off')
        activityMessages.push(isRecurring ? `made this task recurring (${recurrenceLabel})` : 'turned off recurrence')
      } else if (isRecurring && (task?.recurrence_pattern !== recurrencePattern || task?.recurrence_interval !== recurrenceInterval || weekdaysChanged)) {
        const recurrenceLabel = describeRecurrence(recurrencePattern, recurrenceInterval, recurrenceWeekdays)
        changes.push(`Recurrence changed to ${recurrenceLabel}`)
        activityMessages.push(`changed the recurrence to ${recurrenceLabel}`)
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
      // 'invisible' already told the user what happened, and calling that a success on
      // top of it would be two contradictory toasts for one save.
      if (outcome.kind === 'ok') toast.success('Task updated')
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

  // The admin-only large-file path (migration 091). The object goes to Storage first;
  // only if the metadata row then links successfully does the upload count as done -
  // otherwise the object is removed again so a failed link cannot leave bytes behind
  // eating into the 1 GB Free-plan storage budget with nothing pointing at them.
  // Mirrors uploadMarketingAssetForItem in components/marketing/marketing-calendar.tsx.
  const uploadLargeAttachment = async (file: File, input: HTMLInputElement) => {
    const mimeType = resolveTaskAttachmentMimeType(file)
    if (!mimeType || !currentUser) return

    const storagePath = buildTaskAssetPath(taskId, mimeType)
    setUploading(true)

    try {
      const { error: uploadError } = await supabase.storage
        .from(TASK_ASSET_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          contentType: mimeType,
          upsert: false,
        })

      if (uploadError) {
        console.error('[v0] Large upload error:', uploadError)
        toast.error('Could not upload file', { description: uploadError.message })
        return
      }

      const { error: metadataError } = await supabase
        .from('task_attachments')
        .insert({
          task_id: taskId,
          file_name: file.name,
          file_type: mimeType,
          storage_path: storagePath,
          file_size: file.size,
          uploaded_by: currentUser.id,
        })

      if (metadataError) {
        await supabase.storage.from(TASK_ASSET_BUCKET).remove([storagePath])
        console.error('[v0] Large upload link error:', metadataError)
        toast.error('The file could not be linked to this task', { description: metadataError.message })
        return
      }

      logTaskActivity(supabase, taskId, currentUser.id, `added attachment "${file.name}"`)
      await loadAttachments()
      toast.success(`Attachment added (${formatAttachmentSize(file.size)})`)
      input.value = ''
    } finally {
      setUploading(false)
    }
  }

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentUser) {
      console.log('[v0] No file or user for upload')
      return
    }

    console.log('[v0] Uploading file:', file.name, 'Size:', file.size)

    // Two paths (migration 091): inline base64 into the DB at 10 MB for everyone, or
    // - when an admin explicitly ticks "Large file" - Supabase Storage at 50 MB. The
    // limits live in lib/task-attachments.ts alongside the reason each one is what it is.
    const useLargePath = largeUpload && canUploadLargeFiles
    const validationError = validateTaskAttachment(file, {
      large: largeUpload,
      isAdmin: canUploadLargeFiles,
    })
    if (validationError) {
      console.log('[v0] File rejected:', validationError)
      toast.error(validationError)
      e.target.value = '' // Reset input
      return
    }

    if (useLargePath) {
      await uploadLargeAttachment(file, e.target)
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

          logTaskActivity(supabase, taskId, currentUser.id, `added attachment "${file.name}"`)
          await loadAttachments()
          toast.success('Attachment added')
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

    const attachment = attachments.find((candidate) => candidate.id === attachmentId)
    const { error } = await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId)

    if (error) {
      toast.error('Could not remove attachment', { description: error.message })
      return
    }

    // Storage-backed attachments (migration 091) leave the object behind when only
    // the row is deleted, and those bytes keep counting against the storage budget.
    // Deliberately after the row delete: if this fails the attachment is still gone
    // from the UI, which is the outcome the user asked for.
    if (attachment?.storage_path) {
      const { error: objectError } = await supabase.storage
        .from(TASK_ASSET_BUCKET)
        .remove([attachment.storage_path])
      if (objectError) {
        console.error('[v0] Orphaned task asset object:', attachment.storage_path, objectError)
      }
    }

    if (currentUser) {
      logTaskActivity(
        supabase,
        taskId,
        currentUser.id,
        `removed attachment "${attachment?.file_name || 'Unknown'}"`
      )
    }
    await loadAttachments()
    toast.success('Attachment removed')
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

    const resolvedTitle = linkTitle.trim() || linkUrl.trim()
    const { error } = await supabase
      .from('task_links')
      .insert({
        task_id: taskId,
        title: resolvedTitle,
        url: linkUrl.trim(),
        created_by: currentUser.id,
      })

    if (error) {
      toast.error('Could not add link', { description: error.message })
      return
    }

    logTaskActivity(supabase, taskId, currentUser.id, `added link "${resolvedTitle}"`)
    setLinkTitle('')
    setLinkUrl('')
    await loadLinks()
    toast.success('Link added')
  }

  const handleDeleteLink = async (linkId: string) => {
    if (!canEdit) return

    const link = links.find((candidate) => candidate.id === linkId)
    const { error } = await supabase
      .from('task_links')
      .delete()
      .eq('id', linkId)

    if (error) {
      toast.error('Could not remove link', { description: error.message })
      return
    }

    if (currentUser) {
      logTaskActivity(
        supabase,
        taskId,
        currentUser.id,
        `removed link "${link?.title || link?.url || 'Unknown'}"`
      )
    }
    await loadLinks()
    toast.success('Link removed')
  }

  const availableTags = allTags.filter(tag => !tags.find(t => t.id === tag.id))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <DialogTitle>Task Details</DialogTitle>
            <div className="flex items-center gap-2">
              {/* Filing a card on the wrong board used to be unfixable: the only way out was
                  to retype it elsewhere and delete the original, losing its comments,
                  attachments, activity and subtasks. Hidden for subtasks, which have no board
                  of their own - they live wherever their parent lives, and the RPC refuses
                  them for that reason. */}
              {canEdit && task && !task.parent_task_id && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setMoveOpen(true)}>
                  <FolderInput className="h-4 w-4" />
                  <span className="hidden sm:inline">Move</span>
                </Button>
              )}
              {/* Minting a public URL is `share.external`, not an inline copy of the
                  same rule - this check used to be written out here and had already
                  drifted from the capability by missing the guest/client term. */}
              {shareDecision.allowed && (
                <ShareLinkDialog resourceType="task" resourceId={taskId} />
              )}
            </div>
          </div>
          {task?.created_at && (
            <p className="text-xs text-muted-foreground">
              Created by {task.creator?.full_name || task.creator?.email || 'Unknown'} on{' '}
              {new Date(task.created_at).toLocaleString('en-US')}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-6">
          {/* Every field below renders disabled when the viewer can't edit. A tooltip on
              each one would be easy to miss when the whole form is read-only, so the
              reason is stated once, plainly, at the top. */}
          <RestrictionNote decision={editDecision} />

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
            <div className="flex items-center justify-between">
              <Label>Description</Label>
              {canEdit && (
                <VoiceInputButton
                  value={description}
                  onChange={setDescription}
                  className="h-6 w-6 text-muted-foreground"
                  title="Dictate description"
                />
              )}
            </div>
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
                  {/* Scoped to what this board has a column for, keeping this task's own
                      status listed. The save handler refuses anything else - it used to do
                      that only after everything else had been typed. */}
                  {statusesForPicker(taskStatuses, columns, status).map((s) => (
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

          {/* Due Date - only the creator (or an admin) can change it */}
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
              <div className="w-full rounded-md border bg-green-50 p-2 font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
                {new Date(task.entry_date).toLocaleString()}
              </div>
            </div>
          )}

          {/*
            Recurrence.

            This used to be a toggle writing tasks.is_recurring plus four descriptive columns
            that NOTHING read - a control that confirmed a repeat and produced no work, for
            months. Migration 116 replaced it with a real rule and an occurrence ledger, and
            this panel is the only way to reach them. The legacy columns are still written by
            handleSave below so nothing that reads them breaks, but they are no longer the
            source of truth; the panel takes them only to recognise a task flagged recurring
            with no rule behind it.
          */}
          {task && (
            <div className="rounded-lg border p-4 bg-muted/30">
              <TaskRecurrencePanel
                taskId={taskId}
                canEdit={canEdit}
                currentUserId={currentUserId}
                legacy={{
                  is_recurring: task.is_recurring,
                  recurrence_pattern: task.recurrence_pattern,
                  recurrence_interval: task.recurrence_interval,
                  recurrence_weekdays: task.recurrence_weekdays,
                  recurrence_end_date: task.recurrence_end_date,
                  due_date: task.due_date,
                  created_at: task.created_at,
                }}
                // onSubtaskChange, not onUpdate: callers wire onUpdate to CLOSE the modal,
                // and generating next week's instance should refresh the board underneath
                // rather than dismiss the task you are looking at. Same situation as ticking
                // a subtask, which is why that callback already exists.
                onGenerated={() => onSubtaskChange?.()}
              />
            </div>
          )}

          {/* Personal reminders. Private to the signed-in user - see 117's header. */}
          {task && (
            <div className="rounded-lg border p-4 bg-muted/30">
              <TaskRemindersPanel
                taskId={taskId}
                currentUserId={currentUserId}
                dueDate={dueDate || task.due_date}
              />
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

          {/* Custom fields (114). Renders nothing at all when no field applies to this work
              item, so a workspace that has defined none sees the modal exactly as before. */}
          {task && (
            <TaskCustomFields
              taskId={taskId}
              boardId={board?.id ?? task?.column?.board_id ?? null}
              typeKey={task?.type_key ?? null}
              canEdit={canEdit}
              currentUserId={currentUserId}
              users={users}
            />
          )}

          {/* Relations (115) - what blocks this, what it blocks, what it duplicates. Distinct
              from Subtasks below (parts of this item) and from the Links tab (external URLs). */}
          {task && <TaskRelationsPanel taskId={taskId} canEdit={canEdit} currentUserId={currentUserId} />}

          {/* Subtasks - only on top-level tasks; nesting is capped at one level (060). */}
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
                            {/* A comment outlives its author now (migration 100): deleting an
                                account keeps what they wrote and nulls the attribution. Without
                                this fallback the name rendered as an empty string, which reads
                                as a broken comment rather than one by someone who has left. */}
                            <span className="text-sm font-medium">
                              {comment.author?.full_name || comment.author?.email || 'Removed user'}
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

              {/* Commenting is deliberately NOT gated on canEdit: the task_comments
                  INSERT policy keys off can_view_task, so a guest or client who can open
                  this task may talk on it. That is the point of the client role. */}
              <div className="space-y-2">
                <RestrictionNote decision={commentDecision} />
                <div className="flex gap-2">
                  <Input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Write a comment..."
                    disabled={!commentDecision.allowed}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleAddComment()
                      }
                    }}
                  />
                  <Button
                    onClick={guardAction(commentDecision, handleAddComment)}
                    size="icon"
                    disabled={!newComment.trim() || !commentDecision.allowed}
                    type="button"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
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
                        return <FileIcon className="w-8 h-8 text-muted-foreground" />
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
                              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                {/* Was `${(file_size / 1024).toFixed(1)} KB`, which reads as
                                    "40960.0 KB" once large files are in play. */}
                                {formatAttachmentSize(attachment.file_size ?? 0)}
                                {isLargeAttachment(attachment) && (
                                  <span className="rounded bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide">
                                    Large
                                  </span>
                                )}
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
                                  // Storage-backed attachments (migration 091) are fetched
                                  // through a short-lived signed URL - the bucket is private,
                                  // so there is no public link to fall back on.
                                  if (attachment.storage_path) {
                                    const { data, error } = await supabase.storage
                                      .from(TASK_ASSET_BUCKET)
                                      .createSignedUrl(attachment.storage_path, TASK_ASSET_SIGNED_URL_SECONDS, {
                                        download: attachment.file_name,
                                      })
                                    if (error || !data?.signedUrl) {
                                      toast.error('Could not download file', { description: error?.message })
                                      return
                                    }
                                    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
                                    return
                                  }

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
                              {attachmentDeleteDecision(attachment.uploaded_by).allowed && (
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
                  // The large path is restricted to the formats the bucket's MIME
                  // allowlist accepts (migration 091); the inline path never was.
                  accept={largeUpload && canUploadLargeFiles ? TASK_ATTACHMENT_ACCEPT : '*/*'}
                  onChange={handleFileUpload}
                  disabled={uploading || !attachDecision.allowed}
                />
                <ActionGuard decision={attachDecision} className="w-full">
                  <Button
                    variant="outline"
                    className="w-full gap-2 bg-transparent"
                    onClick={guardAction(attachDecision, () =>
                      document.getElementById('file-upload')?.click(),
                    )}
                    disabled={uploading || !attachDecision.allowed}
                  >
                    <Upload className="w-4 h-4" />
                    {uploading ? 'Uploading...' : 'Upload File'}
                  </Button>
                </ActionGuard>

                {/* Admin-only, explicit, per-upload opt-in. Hiding it is presentation
                    only - migration 091's INSERT policy is what actually stops a
                    non-admin taking the large path. */}
                {canUploadLargeFiles && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={largeUpload}
                      onChange={(event) => setLargeUpload(event.target.checked)}
                      disabled={uploading}
                    />
                    <span className="text-xs">
                      <span className="font-medium">Large file (up to 50 MB)</span>
                      <span className="block text-muted-foreground">
                        Stores the file outside the database. Admins only, and shared storage
                        is capped at 1 GB in total - use it for files that genuinely need it.
                      </span>
                    </span>
                  </label>
                )}

                <p className="text-xs text-muted-foreground text-center mt-2">
                  {largeUpload && canUploadLargeFiles
                    ? 'Images, PDFs, Videos, Documents, Sheets, ZIP - up to 50 MB'
                    : 'Images, PDFs, Videos, Documents, Sheets - All file types supported, up to 10MB'}
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
          <div className="flex justify-end pt-4">
            <div className="flex gap-2">
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

        {/* Rendered inside the modal so it survives while this dialog is open; Radix portals
            it out of the DOM subtree, so nesting is only a React-tree relationship. */}
        <MoveTaskDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          taskId={taskId}
          taskStatus={status}
          currentBoardId={board?.id}
          currentBoardTitle={board?.title}
          currentUserId={currentUser?.id ?? currentUserId}
          onMoved={() => {
            // The task is no longer on the board underneath this modal, so leaving the modal
            // open would show a card that the board behind it can no longer render. Close
            // first, then refresh the board so the card disappears from where it used to be.
            onClose()
            onUpdate()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
