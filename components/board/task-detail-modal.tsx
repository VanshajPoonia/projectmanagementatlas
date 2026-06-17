'use client'

import React from "react"

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
import { X, Calendar as CalendarIcon, Tag, User, Trash2, Upload, ImageIcon, MessageSquare, Send, FileText, Video, FileIcon, Download } from 'lucide-react'
import { format } from 'date-fns'
import { sendTaskAssignmentEmail, sendCommentEmail, sendTaskUpdateEmail } from '@/lib/email'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface TaskDetailModalProps {
  board?: any
  taskId: string
  open: boolean
  onClose: () => void
  onUpdate: () => void
  isAdmin?: boolean
}

export function TaskDetailModal({ taskId, open, onClose, onUpdate, board, isAdmin = false }: TaskDetailModalProps) {
  const supabase = createClient()
  const [task, setTask] = useState<any>(null)
  const [tags, setTags] = useState<any[]>([])
  const [allTags, setAllTags] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<number>(3)
  const [status, setStatus] = useState('todo')
  const [dueDate, setDueDate] = useState<Date>()
  const [assignees, setAssignees] = useState<string[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3b82f6')
  const [attachments, setAttachments] = useState<any[]>([])
  const [comments, setComments] = useState<any[]>([])
  const [newComment, setNewComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)

  useEffect(() => {
    if (open && taskId) {
      loadTaskDetails()
      loadAllTags()
      loadAttachments()
      loadComments()
      loadCurrentUser()
      loadAssignees()
      if (isAdmin) {
        loadUsers()
      }
    }
  }, [open, taskId])

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
      .select('*, uploaded_by:profiles(full_name, email)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    if (data) setAttachments(data)
  }

  const loadComments = async () => {
    const { data } = await supabase
      .from('task_comments')
      .select('*, author:profiles(full_name, email)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    if (data) setComments(data)
  }

  const loadTaskDetails = async () => {
    const { data: taskData } = await supabase
      .from('tasks')
      .select('*, assigned_user:profiles!tasks_assigned_to_fkey(id, full_name, email), task_tags(tag:tags(*))')
      .eq('id', taskId)
      .single()

    if (taskData) {
      setTask(taskData)
      setTitle(taskData.title)
      setDescription(taskData.description || '')
      setPriority(taskData.priority)
      setStatus(taskData.status)
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
      // task_assignees is the source of truth; keep assigned_to as a mirror of the first assignee
      assigned_to: assignees[0] || null,
    }
    
    // If status changed to 'done', set entry_date to now
    if (status === 'done' && task?.status !== 'done') {
      updateData.entry_date = new Date().toISOString()
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
        .select('full_name, email')
        .eq('id', user?.id || '')
        .single()

      // Send update notification to all assignees if task details changed
      if (assignees.length > 0) {
        const changes = []
        if (task?.title !== title) changes.push(`Title updated to "${title}"`)
        if (task?.description !== description) changes.push('Description updated')
        if (task?.priority !== priority) changes.push(`Priority changed to ${priority}`)
        if (task?.status !== status) changes.push(`Status changed to ${status}`)
        if (task?.due_date !== dueDate?.toISOString()) changes.push('Due date updated')

        if (changes.length > 0) {
          for (const userId of assignees) {
            const user = users.find(u => u.id === userId)
            if (user && user.id !== currentUserProfile?.id) {
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
    }

    setLoading(false)
  }

  const handleAddTag = async (tagId: string) => {
    const { error } = await supabase
      .from('task_tags')
      .insert({ task_id: taskId, tag_id: tagId })

    if (!error) {
      loadTaskDetails()
    }
  }

  const handleRemoveTag = async (tagId: string) => {
    await supabase
      .from('task_tags')
      .delete()
      .eq('task_id', taskId)
      .eq('tag_id', tagId)

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
          author_id: currentUser.id
        })

      if (error) throw error
      
      console.log('[v0] Comment added successfully')
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
    const isAssigned = assignees.includes(userId)
    const newAssignees = isAssigned
      ? assignees.filter(id => id !== userId)
      : [...assignees, userId]

    if (isAssigned) {
      await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .eq('user_id', userId)
    } else {
      await supabase
        .from('task_assignees')
        .insert({ task_id: taskId, user_id: userId })
    }
    setAssignees(newAssignees)

    // Keep the assigned_to mirror in sync with the first assignee
    await supabase
      .from('tasks')
      .update({ assigned_to: newAssignees[0] || null })
      .eq('id', taskId)

    // Notify a newly added assignee
    if (!isAssigned) {
      const assignedUser = users.find(u => u.id === userId)
      if (assignedUser) {
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
      }
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return

    await supabase.from('tasks').delete().eq('id', taskId)
    onUpdate()
    onClose()
  }

  const availableTags = allTags.filter(tag => !tags.find(t => t.id === tag.id))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Task Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              disabled={!isAdmin}
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
              disabled={!isAdmin}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Priority (1-5)</label>
              <Select value={priority?.toString() || '3'} onValueChange={(val) => setPriority(parseInt(val))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 - Lowest</SelectItem>
                  <SelectItem value="2">2 - Low</SelectItem>
                  <SelectItem value="3">3 - Medium</SelectItem>
                  <SelectItem value="4">4 - High</SelectItem>
                  <SelectItem value="5">5 - Highest</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due Date (Only creator can edit) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" />
              Due Date {task?.created_by !== currentUser?.id && <span className="text-xs text-muted-foreground">(Creator only)</span>}
            </Label>
            {task?.created_by === currentUser?.id || isAdmin ? (
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
          {isAdmin && (
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
                    <div
                      key={user.id}
                      onClick={() => handleToggleAssignee(user.id)}
                      className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                        isAssigned ? 'bg-primary/10 border border-primary' : 'hover:bg-accent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isAssigned ? 'bg-primary border-primary' : 'border-muted-foreground'
                        }`}>
                          {isAssigned && <span className="text-primary-foreground text-xs">✓</span>}
                        </div>
                        <span className="text-sm font-medium">{user.full_name}</span>
                        <span className="text-xs text-muted-foreground">({user.email})</span>
                      </div>
                    </div>
                  )
                })}
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
                  {isAdmin && (
                    <button onClick={() => handleRemoveTag(tag.id)}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>

            {isAdmin && (
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
              </>
            )}
          </div>

          {/* Attachments and Comments */}
          <Tabs defaultValue="comments" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="comments" className="gap-2">
                <MessageSquare className="w-4 h-4" />
                Comments ({comments.length})
              </TabsTrigger>
              <TabsTrigger value="attachments" className="gap-2">
                <ImageIcon className="w-4 h-4" />
                Attachments ({attachments.length})
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
                              {new Date(comment.created_at).toLocaleDateString()}
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
                                {new Date(attachment.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 bg-transparent"
                                onClick={() => {
                                  const link = document.createElement('a')
                                  link.href = attachment.file_data
                                  link.download = attachment.file_name
                                  link.click()
                                }}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                              {isAdmin && (
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
          </Tabs>

          {/* Actions */}
          <div className="flex justify-between pt-4">
            {isAdmin && (
              <Button onClick={handleDelete} variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Task
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button onClick={onClose} variant="outline">
                Cancel
              </Button>
              {isAdmin && (
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
