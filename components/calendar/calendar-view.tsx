'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getAssigneeIds, getAssignees } from '@/lib/assignees'
import { cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, getTaskStatusLabel } from '@/lib/task-status'

interface CalendarViewProps {
  tasks: any[]
  users: any[]
  isAdmin?: boolean
}

export default function CalendarView({ tasks, users, isAdmin = false }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<any[]>([])
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({})
  const supabase = createClient()
  const router = useRouter()

  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).getDate()

  const firstDayOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay()

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const getUserColor = (userId: string) => {
    const colors = [
      '#3b82f6', // blue
      '#10b981', // green
      '#f59e0b', // amber
      '#ef4444', // red
      '#8b5cf6', // violet
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#84cc16', // lime
    ]
    const userIndex = users.findIndex(u => u.id === userId)
    return colors[userIndex % colors.length]
  }

  const getTasksForDate = (day: number) => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
    const dateString = date.toISOString().split('T')[0]
    
    return tasks.filter(task => {
      if (!task.due_date) return false
      const taskDate = new Date(task.due_date).toISOString().split('T')[0]
      return taskDate === dateString
    })
  }

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const isToday = (day: number) => {
    const today = new Date()
    return (
      day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    )
  }

  const handleDateClick = (day: number) => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
    const dayTasks = getTasksForDate(day)
    
    if (dayTasks.length > 0) {
      setSelectedDate(date)
      setExpandedTasks(dayTasks)
    }
  }

  const closeDialog = () => {
    setSelectedDate(null)
    setExpandedTasks([])
  }

  const handleToggleComplete = async (task: any) => {
    const currentStatus = statusOverrides[task.id] ?? task.status
    const isDone = getNormalizedTaskStatus({ ...task, status: currentStatus }) === 'done'
    const newStatus = isDone ? 'to_do' : 'done'

    setStatusOverrides((prev) => ({ ...prev, [task.id]: newStatus }))

    const updateData: Record<string, any> = { status: newStatus }
    if (newStatus === 'done') updateData.entry_date = new Date().toISOString()

    const { error } = await supabase.from('tasks').update(updateData).eq('id', task.id)

    if (error) {
      setStatusOverrides((prev) => ({ ...prev, [task.id]: currentStatus }))
      toast.error('Could not update task', { description: error.message })
      return
    }

    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg sm:text-2xl">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button onClick={goToToday} variant="outline" size="sm">
              Today
            </Button>
            <Button onClick={previousMonth} variant="outline" size="icon">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button onClick={nextMonth} variant="outline" size="icon">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* User Legend */}
        <div className="flex flex-wrap gap-2 pt-4 border-t">
          {users.map(user => (
            <div key={user.id} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: getUserColor(user.id) }}
              />
              <span className="text-sm">{user.full_name || user.email}</span>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-semibold text-[11px] sm:text-sm py-2">
              {day.slice(0, 3)}
            </div>
          ))}

          {/* Empty cells for days before month starts */}
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {/* Calendar days */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dayTasks = getTasksForDate(day)
            const today = isToday(day)

            return (
              <div
                key={day}
                onClick={() => handleDateClick(day)}
                className={`aspect-square border rounded-lg p-1 sm:p-2 ${
                  today ? 'bg-primary/10 border-primary' : 'hover:bg-accent'
                } transition-colors ${dayTasks.length > 0 ? 'cursor-pointer' : ''}`}
              >
                <div className={`text-xs sm:text-sm font-medium mb-1 ${today ? 'text-primary' : ''}`}>
                  {day}
                </div>

                {/* Mobile: dots only */}
                <div className="flex flex-wrap gap-0.5 sm:hidden">
                  {dayTasks.slice(0, 4).map(task => {
                    const firstAssigneeId = getAssigneeIds(task)[0]
                    const color = firstAssigneeId ? getUserColor(firstAssigneeId) : '#475569'
                    return (
                      <span
                        key={task.id}
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                    )
                  })}
                </div>

                {/* Larger screens: truncated title chips */}
                <div className="hidden sm:block space-y-1">
                  {dayTasks.slice(0, 3).map(task => {
                    const firstAssigneeId = getAssigneeIds(task)[0]
                    const color = firstAssigneeId ? getUserColor(firstAssigneeId) : '#475569'

                    return (
                      <div
                        key={task.id}
                        className="text-xs p-1 rounded truncate text-white hover:opacity-90 transition-opacity font-medium shadow-sm"
                        style={{ backgroundColor: color }}
                        title={task.title}
                      >
                        {task.title}
                      </div>
                    )
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-xs text-muted-foreground pl-1">
                      +{dayTasks.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>

      {/* Expanded Date Dialog */}
      <Dialog open={selectedDate !== null} onOpenChange={closeDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>
                Tasks for {selectedDate?.toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </span>
              <Badge variant="secondary">{expandedTasks.length} task{expandedTasks.length !== 1 ? 's' : ''}</Badge>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 mt-4">
            {expandedTasks.map(task => {
              const taskAssignees = getAssignees(task, users)
              const firstAssigneeId = getAssigneeIds(task)[0]
              const color = firstAssigneeId ? getUserColor(firstAssigneeId) : '#475569'
              const effectiveStatus = statusOverrides[task.id] ?? task.status
              const taskWithEffectiveStatus = { ...task, status: effectiveStatus }
              const taskStatus = getNormalizedTaskStatus(taskWithEffectiveStatus)
              const isDone = taskStatus === 'done'

              return (
                <div key={task.id} className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => handleToggleComplete(task)}
                    aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
                    className={`mt-4 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      isDone ? 'bg-primary border-primary' : 'border-muted-foreground hover:border-primary'
                    }`}
                  >
                    {isDone && <Check className="h-3 w-3 text-primary-foreground" />}
                  </button>
                  <Link href={`/${isAdmin ? 'admin' : 'dashboard'}/board/${task.board_id}`} className="flex-1 min-w-0">
                    <Card className="hover:shadow-md transition-all cursor-pointer hover:border-primary">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <div
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <h3 className={`break-words text-base font-semibold line-clamp-2 [overflow-wrap:anywhere] ${isDone ? 'line-through text-muted-foreground' : ''}`}>{task.title}</h3>
                            </div>

                            {cleanTaskDescription(task.description) && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                                {cleanTaskDescription(task.description)}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {taskAssignees.length ? taskAssignees.map((u: any) => u.full_name || u.email).join(', ') : 'Unassigned'}
                              </Badge>

                              {task.priority && (
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${
                                    task.priority >= 4
                                      ? 'border-red-500 text-red-500 bg-red-50'
                                      : task.priority === 3
                                      ? 'border-orange-500 text-orange-500 bg-orange-50'
                                      : 'border-blue-500 text-blue-500 bg-blue-50'
                                  }`}
                                >
                                  Priority: {task.priority}
                                </Badge>
                              )}

                              <Badge
                                variant={isDone ? 'default' : taskStatus === 'in_progress' ? 'secondary' : 'outline'}
                                className={`text-xs ${
                                  isDone
                                    ? 'bg-green-600'
                                    : taskStatus === 'in_progress'
                                    ? 'bg-yellow-600'
                                    : ''
                                }`}
                              >
                                {getTaskStatusLabel(taskWithEffectiveStatus)}
                              </Badge>
                            </div>
                          </div>

                          <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
