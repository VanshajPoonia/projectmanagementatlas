'use client'

import React from "react"

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createClient } from '@/lib/supabase/client'
import { sendTaskAssignmentEmail } from '@/lib/email'

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
  const [assignedTo, setAssignedTo] = useState<string>('unassigned')
  const [priority, setPriority] = useState<string>('medium')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) throw new Error('User not authenticated')

      const status = column.title.toLowerCase().replace(' ', '_')
      
      const taskData = {
        title,
        description,
        column_id: column.id,
        assigned_to: assignedTo === 'unassigned' ? null : assignedTo,
        created_by: user.id,
        priority,
        due_date: dueDate || null,
        status,
        position: column.tasks?.length || 0,
      }
      
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert(taskData)
        .select()
        .single()

      if (taskError) throw taskError

      // Send email notification if task is assigned
      if (assignedTo !== 'unassigned' && assignedTo) {
        const assignedUser = users.find(u => u.id === assignedTo)
        const { data: currentUserProfile } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', user.id)
          .single()
        
        if (assignedUser) {
          console.log('[v0] Sending email notification to:', assignedUser.email)
          await sendTaskAssignmentEmail(
            assignedUser.email,
            assignedUser.full_name || assignedUser.email,
            title,
            description,
            priority,
            dueDate,
            board?.title || 'Project Board',
            currentUserProfile?.full_name || currentUserProfile?.email || 'Admin'
          )
        }
      }

      // Reset form
      setTitle('')
      setDescription('')
      setAssignedTo('unassigned')
      setPriority('medium')
      setDueDate('')
      onOpenChange(false)
      
      // Trigger callback to refresh board data
      if (onTaskCreated) {
        onTaskCreated()
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to create task. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
            <label htmlFor="assignedTo" className="text-sm font-medium">
              Assign To
            </label>
            <Select value={assignedTo} onValueChange={setAssignedTo} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder="Select a user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="priority" className="text-sm font-medium">
                Priority
              </label>
              <Select value={priority} onValueChange={setPriority} disabled={loading}>
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating Task...' : 'Create Task'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
