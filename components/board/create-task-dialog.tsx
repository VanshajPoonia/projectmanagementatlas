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
  const [priority, setPriority] = useState<number>(3)
  const [dueDate, setDueDate] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrencePattern, setRecurrencePattern] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
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
      setPriority(3)
      setDueDate('')
      setIsRecurring(false)
      setRecurrencePattern('daily')
      setRecurrenceInterval(1)
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
                Priority (1-5)
              </label>
              <Select value={priority.toString()} onValueChange={(val) => setPriority(parseInt(val))} disabled={loading}>
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating Task...' : 'Create Task'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
