'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Lock, Plus, X, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { shortDayLabel, taskDueDate } from '@/lib/calendar-grid'
import { businessDate } from '@/lib/crm'
import { showUndoableToast } from '@/components/shell/undo-toast'

interface PersonalTasksProps {
  userId: string
}

export default function PersonalTasks({ userId }: PersonalTasksProps) {
  const [tasks, setTasks] = useState<any[]>([])
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    loadTasks()
  }, [userId])

  const loadTasks = async () => {
    const { data } = await supabase
      .from('personal_tasks')
      .select('*')
      .eq('user_id', userId)
      .order('is_done', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (data) setTasks(data)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)

    const { data, error } = await supabase
      .from('personal_tasks')
      .insert({
        user_id: userId,
        title: title.trim(),
        due_date: dueDate || null,
      })
      .select()
      .single()

    if (!error && data) {
      setTasks([data, ...tasks])
      setTitle('')
      setDueDate('')
    }
    setLoading(false)
  }

  const handleToggleDone = async (task: any) => {
    const { error } = await supabase
      .from('personal_tasks')
      .update({ is_done: !task.is_done, updated_at: new Date().toISOString() })
      .eq('id', task.id)
    if (!error) {
      setTasks(tasks.map(t => t.id === task.id ? { ...t, is_done: !t.is_done } : t))
    }
  }

  // Deleting used to be a single unconfirmed click with no feedback at all - the row simply
  // vanished and there was no way back. It stays one click (a confirmation on every private
  // to-do would be heavier than the mistake it prevents), but the whole row is captured
  // first and the toast offers to put it back exactly as it was, original id included.
  const handleDelete = async (task: any) => {
    const snapshot = { ...task }
    const { error } = await supabase.from('personal_tasks').delete().eq('id', task.id)
    if (error) {
      toast.error('Couldn’t delete that task', { description: error.message })
      return
    }
    setTasks(prev => prev.filter(t => t.id !== task.id))

    showUndoableToast(toast, {
      message: 'Task deleted',
      description: snapshot.title,
      undoneMessage: 'Task restored',
      onUndo: async () => {
        // Re-inserted with its original id, so this is the same row coming back rather than
        // a lookalike copy.
        const { data, error: restoreError } = await supabase
          .from('personal_tasks')
          .insert(snapshot)
          .select()
          .single()
        if (restoreError) return { ok: false, error: restoreError.message }
        setTasks(prev => (prev.some(t => t.id === data.id) ? prev : [data, ...prev]))
        return { ok: true }
      },
    })
  }

  const isOverdue = (task: any) =>
    task.due_date && !task.is_done &&
    // Calendar days in the business zone. personal_tasks.due_date is TIMESTAMPTZ storing
    // midnight, so comparing instants marked today's work overdue - see lib/calendar-grid.ts.
    (taskDueDate(task) ?? '9999-12-31') < businessDate(new Date())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          Personal Tasks
        </CardTitle>
        <CardDescription>Private: only visible to you</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
          <Input
            placeholder="Add a personal task..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={loading}
            className="flex-1 min-w-[180px]"
          />
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={loading}
            className="w-auto"
          />
          <Button type="submit" disabled={loading || !title.trim()} size="icon">
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-3 p-2 rounded-lg border group hover:bg-accent/50 transition-colors"
            >
              <button
                type="button"
                onClick={() => handleToggleDone(task)}
                className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                  task.is_done ? 'bg-primary border-primary' : 'border-muted-foreground'
                }`}
              >
                {task.is_done && <span className="text-primary-foreground text-xs">✓</span>}
              </button>

              <span className={`flex-1 text-sm ${task.is_done ? 'line-through text-muted-foreground' : ''}`}>
                {task.title}
              </span>

              {task.due_date && (
                <span className={`flex items-center gap-1 text-xs ${
                  isOverdue(task) ? 'text-red-600 font-medium dark:text-red-400' : 'text-muted-foreground'
                }`}>
                  <Calendar className="w-3 h-3" />
                  {shortDayLabel(taskDueDate(task)!)}
                </span>
              )}

              {/* Named explicitly: a bare X reads as nothing to a screen reader, and
                  opacity-0 until hover means it is keyboard-reachable but invisible - so
                  focus-visible has to bring it back or a keyboard user tabs into a control
                  they cannot see. */}
              <button
                type="button"
                aria-label={`Delete ${task.title}`}
                onClick={() => handleDelete(task)}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-ring rounded-sm text-muted-foreground hover:text-destructive transition-opacity outline-none focus-visible:ring-2"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No personal tasks yet - add one above.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
