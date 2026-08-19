'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { getAssigneeNames } from '@/lib/assignees'
import { cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, getTaskStatusLabel } from '@/lib/task-status'

interface TaskOverviewProps {
  tasks: any[]
  users: any[]
}

export default function TaskOverview({ tasks, users }: TaskOverviewProps) {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => getNormalizedTaskStatus(t) === 'done').length
  const inProgressTasks = tasks.filter(t => getNormalizedTaskStatus(t) === 'in_progress').length
  const todoTasks = tasks.filter(t => getNormalizedTaskStatus(t) === 'to_do').length

  const stats = [
    { title: 'Total Tasks', value: totalTasks, icon: ClipboardList, primary: true },
    { title: 'Completed', value: completedTasks, icon: CheckCircle2, primary: false },
    { title: 'In Progress', value: inProgressTasks, icon: Clock, primary: false },
    { title: 'To Do', value: todoTasks, icon: AlertCircle, primary: false },
  ]

  return (
    <div className="space-y-6">
      {/* No heading here. The DashboardWindow this renders inside is already titled
          "Overview" with the same description word for word, so repeating it printed the
          title twice - which on a phone cost a third of the first screen. */}

      {/* Two across on a phone. One per row meant four full-height cards to read four
          numbers, so the headline figure of the whole dashboard took two thumb-scrolls. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="min-w-0 text-xs font-medium sm:text-sm">{stat.title}</CardTitle>
              <div className={`size-8 sm:size-10 shrink-0 rounded-lg flex items-center justify-center ${stat.primary ? 'bg-primary' : 'bg-secondary'}`}>
                <stat.icon className={`size-4 sm:size-5 ${stat.primary ? 'text-primary-foreground' : 'text-foreground'}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold sm:text-3xl">{stat.value}</div>
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
              const taskStatus = getNormalizedTaskStatus(task)

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
                        variant={taskStatus === 'done' ? 'default' : taskStatus === 'in_progress' ? 'secondary' : 'outline'}
                        className={
                          taskStatus === 'done'
                            ? 'bg-green-600' 
                            : taskStatus === 'in_progress'
                            ? 'bg-yellow-600' 
                            : ''
                        }
                      >
                        {getTaskStatusLabel(task)}
                      </Badge>
                      {task.priority && (
                        <Badge variant="outline" className={
                          task.priority <= 2
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
