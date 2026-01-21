'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, User, MoreVertical, Tag } from 'lucide-react'
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

interface TaskCardProps {
  task: any
  isAdmin: boolean
  users: any[]
  isDragging?: boolean
  onUpdate?: () => void
}

export default function TaskCard({ task, isAdmin, users, isDragging, onUpdate }: TaskCardProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const supabase = createClient()

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this task?')) {
      await supabase.from('tasks').delete().eq('id', task.id)
    }
  }

  const priorityColors = {
    high: 'border-red-500 text-red-500 bg-red-50',
    medium: 'border-orange-500 text-orange-500 bg-orange-50',
    low: 'border-blue-500 text-blue-500 bg-blue-50',
  }

  return (
    <>
      <Card 
        className={`p-4 cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 ${isDragging ? 'shadow-xl rotate-2 opacity-70' : ''}`}
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
              <Badge variant="outline" className={`text-xs ${priorityColors[task.priority as keyof typeof priorityColors]}`}>
                {task.priority}
              </Badge>
            )}
          </div>

          <div className="space-y-1 pt-2 border-t">
            {task.assigned_to && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <User className="w-3 h-3" />
                <span className="truncate">{task.assigned_to.full_name || task.assigned_to.email}</span>
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
        isAdmin={isAdmin}
      />
    </>
  )
}
