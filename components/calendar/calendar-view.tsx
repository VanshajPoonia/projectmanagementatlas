'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface CalendarViewProps {
  tasks: any[]
  users: any[]
}

export default function CalendarView({ tasks, users }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
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
                className={`aspect-square border rounded-lg p-2 ${
                  today ? 'bg-primary/10 border-primary' : 'hover:bg-accent'
                } transition-colors`}
              >
                <div className={`text-sm font-medium mb-1 ${today ? 'text-primary' : ''}`}>
                  {day}
                </div>
                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map(task => {
                    const assignedUser = users.find(u => u.id === task.assigned_to)
                    const color = task.assigned_to ? getUserColor(task.assigned_to) : '#64748b'
                    
                    return (
                      <div
                        key={task.id}
                        className="text-xs p-1 rounded truncate text-white cursor-pointer hover:opacity-80 transition-opacity"
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
    </Card>
  )
}
