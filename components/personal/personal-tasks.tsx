'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Lock, Plus, X, Calendar } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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

  const handleDelete = async (taskId: string) => {
    const { error } = await supabase.from('personal_tasks').delete().eq('id', taskId)
    if (!error) {
      setTasks(tasks.filter(t => t.id !== taskId))
    }
  }

  const isOverdue = (task: any) =>
    task.due_date && !task.is_done && new Date(task.due_date) < new Date(new Date().toDateString())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          Personal Tasks
        </CardTitle>
        <CardDescription>Private — only visible to you</CardDescription>
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
                  isOverdue(task) ? 'text-red-600 font-medium' : 'text-muted-foreground'
                }`}>
                  <Calendar className="w-3 h-3" />
                  {new Date(task.due_date).toLocaleDateString()}
                </span>
              )}

              <button
                type="button"
                onClick={() => handleDelete(task.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No personal tasks yet — add one above.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
