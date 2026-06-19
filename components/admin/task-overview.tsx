'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { getAssigneeNames } from '@/lib/assignees'
import { cleanTaskDescription } from '@/lib/display-text'

interface TaskOverviewProps {
  tasks: any[]
  users: any[]
}

export default function TaskOverview({ tasks, users }: TaskOverviewProps) {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.status === 'done').length
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length
  const todoTasks = tasks.filter(t => t.status === 'todo').length

  const stats = [
    { title: 'Total Tasks', value: totalTasks, icon: ClipboardList, primary: true },
    { title: 'Completed', value: completedTasks, icon: CheckCircle2, primary: false },
    { title: 'In Progress', value: inProgressTasks, icon: Clock, primary: false },
    { title: 'To Do', value: todoTasks, icon: AlertCircle, primary: false },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
        <p className="text-muted-foreground">Quick overview of your project management</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.primary ? 'bg-primary' : 'bg-secondary'}`}>
                <stat.icon className={`w-5 h-5 ${stat.primary ? 'text-primary-foreground' : 'text-foreground'}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {tasks.slice(0, 10).map((task) => {
              const assigneeNames = getAssigneeNames(task, users)
              const taskDescription = cleanTaskDescription(task.description)

              return (
                <Link key={task.id} href={`/admin/board/${task.board_id}`}>
                  <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer hover:border-primary">
                    <div className="flex-1">
                      <h4 className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{task.title}</h4>
                      {taskDescription && (
                        <p className="text-sm text-muted-foreground line-clamp-1">{taskDescription}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Assigned to: {assigneeNames.length ? assigneeNames.join(', ') : 'Unassigned'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={task.status === 'done' ? 'default' : task.status === 'in_progress' ? 'secondary' : 'outline'}
                        className={
                          task.status === 'done' 
                            ? 'bg-green-600' 
                            : task.status === 'in_progress' 
                            ? 'bg-yellow-600' 
                            : ''
                        }
                      >
                        {task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'In Progress' : 'To Do'}
                      </Badge>
                      {task.priority && (
                        <Badge variant="outline" className={
                          task.priority >= 4
                            ? 'border-red-500 text-red-500' 
                            : task.priority === 3
                            ? 'border-orange-500 text-orange-500' 
                            : 'border-blue-500 text-blue-500'
                        }>
                          {task.priority}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
            {tasks.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No tasks created yet
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
