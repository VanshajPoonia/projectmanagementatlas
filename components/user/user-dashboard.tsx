'use client'

import { useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LayoutDashboard, ClipboardList, MessageSquare, LogOut, Calendar, Kanban, Lock, Home, Megaphone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ChatPanel from '../chat/chat-panel'
import CalendarView from '../calendar/calendar-view'
import NotificationInfo from '../notifications/notification-info'
import TaskNotificationToasts from '../notifications/task-notification-toasts'
import PersonalTasks from '../personal/personal-tasks'
import BookmarksSection from '../bookmarks/bookmarks-section'
import MarketingCalendar from '../marketing/marketing-calendar'
import { cleanBoardDescription, cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, getTaskStatusLabel } from '@/lib/task-status'

interface UserDashboardProps {
  user: any
  tasks: any[]
  boards: any[]
  users: any[]
}

export default function UserDashboard({ user, tasks, boards, users }: UserDashboardProps) {
  const [activeTab, setActiveTab] = useState('tasks')
  const router = useRouter()
  const supabase = createClient()
  const isAdmin = user.role === 'admin'
  const isKaylaMarketingUser = String(user.email ?? '').trim().toLowerCase() === 'kayla@goatlasgo.us'
  const canUseMarketingCalendar = isKaylaMarketingUser || isAdmin
  const myTasks = useMemo(() => {
    return tasks.filter((task) => {
      const assignedToId = typeof task.assigned_to === 'string' ? task.assigned_to : task.assigned_to?.id
      const assigneeRows = Array.isArray(task.task_assignees) ? task.task_assignees : []

      return task.created_by === user.id
        || assignedToId === user.id
        || assigneeRows.some((assignee: any) => assignee.user_id === user.id)
    })
  }, [tasks, user.id])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const todoTasks = myTasks.filter(t => getNormalizedTaskStatus(t) === 'to_do')
  const inProgressTasks = myTasks.filter(t => getNormalizedTaskStatus(t) === 'in_progress')
  const doneTasks = myTasks.filter(t => getNormalizedTaskStatus(t) === 'done')
  const activeTasks = myTasks.filter(t => getNormalizedTaskStatus(t) !== 'done')

  return (
    <div className="min-h-screen bg-background">
      <TaskNotificationToasts userId={user.id} />
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <LayoutDashboard className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">My Dashboard</h1>
              <p className="text-sm text-muted-foreground">{user.full_name}</p>
            </div>
          </div>
          <Button onClick={handleSignOut} variant="outline" size="sm">
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className={`grid w-full ${canUseMarketingCalendar ? 'max-w-4xl grid-cols-6' : 'max-w-3xl grid-cols-5'} h-12`}>
            <TabsTrigger value="tasks" className="flex items-center gap-2">
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">Home</span>
            </TabsTrigger>
            <TabsTrigger value="personal" className="flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">Personal</span>
            </TabsTrigger>
            <TabsTrigger value="calendar" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Calendar</span>
            </TabsTrigger>
            {canUseMarketingCalendar && (
              <TabsTrigger value="marketing" className="flex items-center gap-2">
                <Megaphone className="w-4 h-4" />
                <span className="hidden sm:inline">Marketing</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="boards" className="flex items-center gap-2">
              <Kanban className="w-4 h-4" />
              <span className="hidden sm:inline">Boards</span>
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Chat</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="space-y-6">
            <BookmarksSection userId={user.id} isAdmin={false} />

            {/* Notification Info */}
            <NotificationInfo />

            {/* Task Stats */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">To Do</CardTitle>
                  <div className="w-8 h-8 bg-secondary rounded-lg flex items-center justify-center">
                    <ClipboardList className="w-4 h-4 text-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{todoTasks.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                  <div className="w-8 h-8 bg-secondary rounded-lg flex items-center justify-center">
                    <ClipboardList className="w-4 h-4 text-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{inProgressTasks.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Completed</CardTitle>
                  <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                    <ClipboardList className="w-4 h-4 text-primary-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">{doneTasks.length}</div>
                </CardContent>
              </Card>
            </div>

            {/* Task List */}
            <Card>
              <CardHeader>
                <CardTitle>My Active Tasks</CardTitle>
                <CardDescription>Assigned tasks that still need attention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {activeTasks.map((task) => {
                    const taskStatus = getNormalizedTaskStatus(task)
                    return (
                      <Link
                        key={task.id}
                        href={task.column?.board_id ? `/dashboard/board/${task.column.board_id}` : '#'}
                        className="block group"
                      >
                        <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-all cursor-pointer hover:shadow-md hover:border-primary/30">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{task.title}</h4>
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
                                {task.column?.title || getTaskStatusLabel(task)}
                              </Badge>
                            </div>
                            {cleanTaskDescription(task.description) && (
                              <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                                {cleanTaskDescription(task.description)}
                              </p>
                            )}
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              {task.column?.board && (
                                <span className="flex items-center gap-1">
                                  <Kanban className="w-3 h-3" />
                                  {task.column.board.title}
                                </span>
                              )}
                              {task.due_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(task.due_date).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                          {task.priority && (
                            <Badge
                              variant="outline"
                              className={
                                task.priority === 'high'
                                  ? 'border-red-500 text-red-500'
                                  : task.priority === 'medium'
                                  ? 'border-orange-500 text-orange-500'
                                  : 'border-blue-500 text-blue-500'
                              }
                            >
                              {task.priority}
                            </Badge>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                  {activeTasks.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No active tasks assigned
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Done Tasks</CardTitle>
                <CardDescription>Assigned tasks that have been completed</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {doneTasks.map((task) => (
                    <Link
                      key={task.id}
                      href={task.column?.board_id ? `/dashboard/board/${task.column.board_id}` : '#'}
                      className="block group"
                    >
                      <div className="flex items-center justify-between gap-3 p-4 border rounded-lg bg-secondary/40 hover:bg-accent transition-all cursor-pointer hover:shadow-md hover:border-primary/30">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="min-w-0 break-words font-medium text-muted-foreground line-through decoration-2 [overflow-wrap:anywhere]">{task.title}</h4>
                            <Badge className="bg-green-600">
                              {task.column?.title || 'Done'}
                            </Badge>
                          </div>
                          {cleanTaskDescription(task.description) && (
                            <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                              {cleanTaskDescription(task.description)}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            {task.column?.board && (
                              <span className="flex items-center gap-1">
                                <Kanban className="w-3 h-3" />
                                {task.column.board.title}
                              </span>
                            )}
                            {task.due_date && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(task.due_date).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                  {doneTasks.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No done tasks yet
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="personal">
            <PersonalTasks userId={user.id} />
          </TabsContent>

          <TabsContent value="calendar">
            <CalendarView tasks={tasks} users={users} />
          </TabsContent>

          {canUseMarketingCalendar && (
            <TabsContent value="marketing">
              <MarketingCalendar userId={user.id} userName={user.full_name || user.email} isAdmin={isAdmin} />
            </TabsContent>
          )}

          <TabsContent value="boards">
            <Card>
              <CardHeader>
                <CardTitle>Project Boards</CardTitle>
                <CardDescription>View all project boards</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {boards.map((board) => (
                    <Link key={board.id} href={`/dashboard/board/${board.id}`}>
                      <Card className="hover:shadow-md transition-all cursor-pointer hover:border-primary/30">
                        <CardHeader>
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
                              <Kanban className="w-5 h-5 text-primary-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-lg truncate">{board.title}</CardTitle>
                              {cleanBoardDescription(board.description) && (
                                <CardDescription className="text-sm line-clamp-2">
                                  {cleanBoardDescription(board.description)}
                                </CardDescription>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chat">
            <ChatPanel currentUserId={user.id} isAdmin={false} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
