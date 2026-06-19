'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, User, MoreVertical, Tag, Clock, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import { TaskDetailModal } from './task-detail-modal'
import { useState } from 'react'
import { getAssignees } from '@/lib/assignees'

interface TaskCardProps {
  task: any
  isAdmin: boolean
  users: any[]
  board?: any
  isDragging?: boolean
  onUpdate?: () => void
}

export default function TaskCard({ task, isAdmin, users, board, isDragging, onUpdate }: TaskCardProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const supabase = createClient()
  const taskAssignees = getAssignees(task, users)

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this task?')) {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id)
      if (!error) {
        onUpdate?.()
      }
    }
  }

  const getPriorityColor = (priority: number) => {
    if (priority >= 4) return 'border-red-500 text-red-500 bg-red-50'
    if (priority === 3) return 'border-orange-500 text-orange-500 bg-orange-50'
    return 'border-blue-500 text-blue-500 bg-blue-50'
  }

  // Check if task is overdue
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done'
  
  // Calculate days remaining
  const getDaysRemaining = () => {
    if (!task.due_date) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dueDate = new Date(task.due_date)
    dueDate.setHours(0, 0, 0, 0)
    const diffTime = dueDate.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }
  
  const daysRemaining = getDaysRemaining()
  const getCountdownColor = () => {
    if (daysRemaining === null) return ''
    if (daysRemaining < 0) return 'text-red-600 bg-red-50 border-red-200'
    if (daysRemaining === 0) return 'text-orange-600 bg-orange-50 border-orange-200'
    if (daysRemaining <= 3) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-green-600 bg-green-50 border-green-200'
  }

  return (
    <>
      <Card 
        className={`group p-4 cursor-grab active:cursor-grabbing hover:shadow-lg transition-all hover:scale-[1.02] ${
          isDragging ? 'shadow-xl rotate-2 opacity-70 cursor-grabbing' : ''
        } ${isOverdue ? 'border-2 border-red-400 bg-red-50/30' : 'hover:border-primary/50'}`}
        onClick={() => setDetailOpen(true)}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-sm leading-tight flex-1 text-pretty">{task.title}</h4>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDetailOpen(true); }}>
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDelete(); }} className="text-red-600">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
          )}

          {/* Tags */}
          {task.task_tags && task.task_tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.task_tags.slice(0, 3).map((tt: any) => (
                <Badge
                  key={tt.tag.id}
                  style={{ backgroundColor: tt.tag.color }}
                  className="text-white text-xs px-2 py-0"
                >
                  {tt.tag.name}
                </Badge>
              ))}
              {task.task_tags.length > 3 && (
                <Badge variant="outline" className="text-xs px-2 py-0">
                  +{task.task_tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {task.priority && (
              <Badge variant="outline" className={`text-xs ${getPriorityColor(task.priority)}`}>
                Priority: {task.priority}
              </Badge>
            )}
            {task.is_recurring && (
              <Badge variant="outline" className="text-xs bg-purple-50 border-purple-200 text-purple-600 gap-1">
                <Repeat className="w-3 h-3" />
                {task.recurrence_pattern}
              </Badge>
            )}
          </div>

          {/* Countdown Clock */}
          {daysRemaining !== null && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-md border font-semibold text-sm ${getCountdownColor()}`}>
              <Clock className="w-4 h-4" />
              <span>
                {daysRemaining < 0 
                  ? `${Math.abs(daysRemaining)} days overdue` 
                  : daysRemaining === 0 
                  ? 'Due today!' 
                  : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`}
              </span>
            </div>
          )}

          <div className="space-y-1 pt-2 border-t">
            {taskAssignees.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <User className="w-3 h-3" />
                <span className="truncate">
                  {taskAssignees.length === 1
                    ? (taskAssignees[0].full_name || taskAssignees[0].email)
                    : `${taskAssignees[0].full_name || taskAssignees[0].email} +${taskAssignees.length - 1}`}
                </span>
              </div>
            )}
            {task.due_date && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="w-3 h-3" />
                <span>{new Date(task.due_date).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <TaskDetailModal
        taskId={task.id}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdate={() => {
          setDetailOpen(false)
          onUpdate?.()
        }}
        board={board}
        isAdmin={isAdmin}
      />
    </>
  )
}
