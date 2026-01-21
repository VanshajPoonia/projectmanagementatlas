'use client'

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
import { X, Calendar as CalendarIcon, Tag, User, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

interface TaskDetailModalProps {
  taskId: string
  open: boolean
  onClose: () => void
  onUpdate: () => void
  isAdmin?: boolean
}

export function TaskDetailModal({ taskId, open, onClose, onUpdate, isAdmin = false }: TaskDetailModalProps) {
  const supabase = createClient()
  const [task, setTask] = useState<any>(null)
  const [tags, setTags] = useState<any[]>([])
  const [allTags, setAllTags] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [status, setStatus] = useState('todo')
  const [dueDate, setDueDate] = useState<Date>()
  const [assignedTo, setAssignedTo] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3b82f6')

  useEffect(() => {
    if (open && taskId) {
      loadTaskDetails()
      loadAllTags()
      if (isAdmin) {
        loadUsers()
      }
    }
  }, [open, taskId])

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
      setAssignedTo(taskData.assigned_to || '')
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
    const { error } = await supabase
      .from('tasks')
      .update({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status,
        due_date: dueDate?.toISOString() || null,
        assigned_to: assignedTo || null,
      })
      .eq('id', taskId)

    if (!error) {
      onUpdate()
      onClose()
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
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
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

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left bg-transparent" disabled={!isAdmin}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          {/* Assigned User */}
          {isAdmin && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Assigned To
              </Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
