'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, User, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import EditTaskDialog from './edit-task-dialog'
import { useState } from 'react'

interface TaskCardProps {
  task: any
  isAdmin: boolean
  users: any[]
  isDragging?: boolean
}

export default function TaskCard({ task, isAdmin, users, isDragging }: TaskCardProps) {
  const [editOpen, setEditOpen] = useState(false)
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
      <Card className={`p-4 cursor-move hover:shadow-md transition-all ${isDragging ? 'shadow-xl rotate-2' : ''}`}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-sm leading-tight flex-1">{task.title}</h4>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="text-red-600">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {task.priority && (
              <Badge variant="outline" className={`text-xs ${priorityColors[task.priority as keyof typeof priorityColors]}`}>
                {task.priority}
              </Badge>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t">
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

      {isAdmin && (
        <EditTaskDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          task={task}
          users={users}
        />
      )}
    </>
  )
}
