'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getAssigneeIds, getAssignees } from '@/lib/assignees'

interface CalendarViewProps {
  tasks: any[]
  users: any[]
}

export default function CalendarView({ tasks, users }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<any[]>([])
  const supabase = createClient()

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl">
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
        <div className="grid grid-cols-7 gap-2">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-semibold text-sm py-2">
              {day}
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
                className={`aspect-square border rounded-lg p-2 ${
                  today ? 'bg-primary/10 border-primary' : 'hover:bg-accent'
                } transition-colors ${dayTasks.length > 0 ? 'cursor-pointer' : ''}`}
              >
                <div className={`text-sm font-medium mb-1 ${today ? 'text-primary' : ''}`}>
                  {day}
                </div>
                <div className="space-y-1">
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
              
              return (
                <Link key={task.id} href={`/admin/board/${task.board_id}`}>
                  <Card className="hover:shadow-md transition-all cursor-pointer hover:border-primary">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <div 
                              className="w-3 h-3 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: color }}
                            />
                            <h3 className="font-semibold text-base truncate">{task.title}</h3>
                          </div>
                          
                          {task.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                              {task.description}
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
                              variant={task.status === 'done' ? 'default' : task.status === 'in_progress' ? 'secondary' : 'outline'}
                              className={`text-xs ${
                                task.status === 'done' 
                                  ? 'bg-green-600' 
                                  : task.status === 'in_progress' 
                                  ? 'bg-yellow-600' 
                                  : ''
                              }`}
                            >
                              {task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'In Progress' : 'To Do'}
                            </Badge>
                          </div>
                        </div>
                        
                        <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
