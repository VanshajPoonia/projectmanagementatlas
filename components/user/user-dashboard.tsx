'use client'

import { useEffect, useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, LogOut, Calendar, Kanban, Home, Bookmark, Bell, ListTodo, CheckCircle2, ChevronLeft, Sparkles, CornerDownRight, LayoutGrid, List } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { resolveActiveTab } from '../shell/tab-url'
import { AppShell } from '../shell/app-shell'
import type { SidebarNavGroup } from '../shell/app-sidebar'
import Link from 'next/link'
import ChatPanel from '../chat/chat-panel'
import CalendarView from '../calendar/calendar-view'
import NotificationInfo from '../notifications/notification-info'
import TaskNotificationToasts from '../notifications/task-notification-toasts'
import AiChatWidget from '../ai-chat/ai-chat-widget'
import PersonalTasks from '../personal/personal-tasks'
import BookmarksSection from '../bookmarks/bookmarks-section'
import MarketingCalendar from '../marketing/marketing-calendar'
import DashboardWindow from '../dashboard/dashboard-window'
import WorkNext from '../dashboard/work-next'
import AccountSettings from '../account/account-settings'
import ThemeToggle from '../theme-toggle'
import AccentThemePicker, { useAccentTheme } from '../theme/accent-theme-picker'
import ChatUnreadBadge from '../chat/chat-unread-badge'
import GlobalSearch from '../search/global-search'
import { cn } from '@/lib/utils'
import { cleanBoardDescription, cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, getTaskStatusLabel } from '@/lib/task-status'
import { isTaskOwnedBy } from '@/lib/assignees'
import { useAppModules, isModuleEnabled } from '@/lib/modules'

interface UserDashboardProps {
  user: any
  tasks: any[]
  boards: any[]
  users: any[]
}

export default function UserDashboard({ user, tasks, boards, users }: UserDashboardProps) {
  const [activeTab, setActiveTabState] = useState('tasks')
  const [boardsViewMode, setBoardsViewMode] = useState<'tile' | 'list'>('tile')
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('bookmarks_sidebar_open')
    return saved === null ? true : saved === 'true'
  })
  const toggleSidebar = () => setSidebarOpen(prev => {
    const next = !prev
    localStorage.setItem('bookmarks_sidebar_open', String(next))
    return next
  })
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  const isKaylaMarketingUser = String(user.email ?? '').trim().toLowerCase() === 'kayla@goatlasgo.us'
  const canUseMarketingCalendar = isKaylaMarketingUser || isAdmin

  // Module activation (PROMPT 3 "1-C"): app_modules is a singleton config table (one org, no
  // org_id) — everything defaults enabled=true, so this is a no-op until a super_admin flips a
  // module off in Super Admin. 'tasks' (Home) is core and always on, not a registered module.
  const modules = useAppModules()
  const showPersonal = isModuleEnabled(modules, 'personal_tasks')
  const showCalendar = isModuleEnabled(modules, 'calendar')
  const showMarketing = canUseMarketingCalendar && isModuleEnabled(modules, 'marketing_calendar')
  const showBoards = isModuleEnabled(modules, 'boards')
  const showChat = isModuleEnabled(modules, 'chat')

  // Tabs are the visible sections; only these are addressable via ?tab=.
  const allowedTabs = useMemo(
    () => [
      'tasks',
      ...(showPersonal ? ['personal'] : []),
      ...(showCalendar ? ['calendar'] : []),
      ...(showMarketing ? ['marketing'] : []),
      ...(showBoards ? ['boards'] : []),
      ...(showChat ? ['chat'] : []),
    ],
    [showPersonal, showCalendar, showMarketing, showBoards, showChat],
  )

  // Keep the active tab in sync with the URL so sections are deep-linkable and the
  // browser Back/Forward buttons move between them. Falls back to the last session
  // tab (e.g. after returning from a board) and finally to Home. Runs on every
  // ?tab= change; setting the same value is a no-op, so no feedback loop.
  useEffect(() => {
    setActiveTabState(
      resolveActiveTab(searchParams.get('tab'), sessionStorage.getItem('user-active-tab'), allowedTabs, 'tasks'),
    )
  }, [searchParams, allowedTabs])

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab)
    sessionStorage.setItem('user-active-tab', tab)
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (params.get('tab') !== tab) {
      params.set('tab', tab)
      router.push(`${pathname}?${params.toString()}`)
    }
  }
  const defaultAccentColor = isKaylaMarketingUser ? '#e91e8c' : '#111111'
  const { color: accentColor, setColor: setAccentColor, reset: resetAccentColor, style: accentStyle } = useAccentTheme(user.id, defaultAccentColor)
  // The calendar plots deliverables by due date and lets them be rescheduled; subtasks
  // carry no due date of their own, so they'd only add noise. Mirrors the admin shell.
  const topLevelTasks = useMemo(() => tasks.filter((task: any) => !task.parent_task_id), [tasks])

  const myTasks = useMemo(() => tasks.filter((task) => isTaskOwnedBy(task, user.id)), [tasks, user.id])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const todoTasks = myTasks.filter(t => getNormalizedTaskStatus(t) === 'to_do')
  const inProgressTasks = myTasks.filter(t => getNormalizedTaskStatus(t) === 'in_progress')
  const doneTasks = myTasks.filter(t => getNormalizedTaskStatus(t) === 'done')
  const activeTasks = myTasks.filter(t => getNormalizedTaskStatus(t) !== 'done')

  const sidebarGroups: SidebarNavGroup[] = [
    {
      id: 'sections',
      label: 'Workspace',
      items: [
        { id: 'tasks', label: 'Home', icon: 'home', href: '/dashboard?tab=tasks', status: 'live' },
        ...(showPersonal
          ? [{ id: 'personal', label: 'Personal', icon: 'lock', href: '/dashboard?tab=personal', status: 'live' as const }]
          : []),
        ...(showCalendar
          ? [{ id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/dashboard?tab=calendar', status: 'live' as const }]
          : []),
        ...(showMarketing
          ? [{ id: 'marketing', label: 'Marketing', icon: 'megaphone', href: '/dashboard?tab=marketing', status: 'live' as const }]
          : []),
        ...(showBoards
          ? [{ id: 'boards', label: 'Boards', icon: 'kanban', href: '/dashboard?tab=boards', status: 'live' as const }]
          : []),
        ...(showChat
          ? [{
          id: 'chat',
          label: 'Chat',
          icon: 'message',
          href: '/dashboard?tab=chat',
          status: 'live' as const,
          badge: (
            <span className="absolute -top-1 -right-2">
              <ChatUnreadBadge userId={user.id} />
            </span>
          ),
        }]
          : []),
      ],
    },
  ]
  const activeLabel = sidebarGroups[0].items.find((i) => i.id === activeTab)?.label ?? 'Home'

  return (
    <AppShell
      user={{ id: user.id, role: user.role, full_name: user.full_name, email: user.email }}
      groups={sidebarGroups}
      activeId={activeTab}
      breadcrumbs={[{ label: activeLabel }]}
      style={accentStyle}
      topbarActions={
        <>
          <AccentThemePicker color={accentColor} onChange={setAccentColor} onReset={resetAccentColor} />
          <ThemeToggle />
          <AccountSettings
            userId={user.id}
            currentName={user.full_name || ''}
            email={user.email}
            notifyAssignment={user.notify_email_assignment}
            notifyUpdate={user.notify_email_update}
            notifyComment={user.notify_email_comment}
            notifyDueSoon={user.notify_email_due_soon}
          />
          <Button onClick={handleSignOut} variant="outline" size="sm">
            <LogOut className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
        </>
      }
    >
      <TaskNotificationToasts userId={user.id} />
      <AiChatWidget userId={user.id} />

      <div className="flex min-h-0 flex-1">
        {/* Bookmarks sidebar — hidden on mobile */}
        <aside className={cn(
          "hidden md:flex flex-col flex-shrink-0 border-r bg-muted/10 overflow-hidden transition-[width] duration-200 ease-in-out",
          sidebarOpen ? "w-64" : "w-10"
        )}>
          <div className={cn("flex items-center border-b px-2 py-2.5 min-h-11 flex-shrink-0", sidebarOpen ? "justify-between" : "justify-center")}>
            {sidebarOpen && (
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 pl-1">
                <Bookmark className="h-3.5 w-3.5" />
                Bookmarks
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={toggleSidebar} aria-label={sidebarOpen ? 'Collapse bookmarks' : 'Expand bookmarks'}>
              {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            </Button>
          </div>
          {sidebarOpen && (
            <div className="flex-1 overflow-y-auto p-3">
              <BookmarksSection userId={user.id} isAdmin={isAdmin} embedded sidebar />
            </div>
          )}
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0 px-4 py-8 overflow-x-hidden">
          <div className="mb-6">
            <GlobalSearch isAdmin={isAdmin} />
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">

          <TabsContent value="tasks" className="space-y-6">
            <DashboardWindow
              id="work-next"
              title="Work on next"
              description="Ranked by deadline, priority, and what you've already started"
              icon={<Sparkles className="h-4 w-4" />}
            >
              <WorkNext tasks={myTasks} basePath="/dashboard" />
            </DashboardWindow>

            <DashboardWindow id="notifications" title="Notifications" icon={<Bell className="h-4 w-4" />}>
              <NotificationInfo />
            </DashboardWindow>

            <DashboardWindow id="task-summary" title="Task Summary" description="Your workload at a glance" icon={<ClipboardList className="h-4 w-4" />}>
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
            </DashboardWindow>

            <DashboardWindow id="active-tasks" title="My Active Tasks" description="Assigned tasks that still need attention" icon={<ListTodo className="h-4 w-4" />}>
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
                            {task.parent?.title && (
                              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                <CornerDownRight className="w-3 h-3 flex-shrink-0" />
                                {task.parent.title}
                              </p>
                            )}
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
                                  {new Date(task.due_date).toLocaleDateString('en-US')}
                                </span>
                              )}
                            </div>
                          </div>
                          {task.priority && (
                            <Badge
                              variant="outline"
                              className={
                                task.priority <= 2
                                  ? 'border-red-500 text-red-500'
                                  : task.priority === 3
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
            </DashboardWindow>

            <DashboardWindow id="done-tasks" title="Done Tasks" description="Assigned tasks that have been completed" icon={<CheckCircle2 className="h-4 w-4" />} defaultCollapsed>
                <div className="space-y-4">
                  {doneTasks.map((task) => (
                    <Link
                      key={task.id}
                      href={task.column?.board_id ? `/dashboard/board/${task.column.board_id}` : '#'}
                      className="block group"
                    >
                      <div className="flex items-center justify-between gap-3 p-4 border rounded-lg bg-secondary/40 hover:bg-accent transition-all cursor-pointer hover:shadow-md hover:border-primary/30">
                        <div className="flex-1 min-w-0">
                          {task.parent?.title && (
                            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                              <CornerDownRight className="w-3 h-3 flex-shrink-0" />
                              {task.parent.title}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <h4 className="min-w-0 break-words font-medium text-muted-foreground line-through decoration-2 [overflow-wrap:anywhere]">{task.title}</h4>
                            <Badge className="bg-green-600">
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
                                {new Date(task.due_date).toLocaleDateString('en-US')}
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
            </DashboardWindow>
          </TabsContent>

          <TabsContent value="personal">
            <PersonalTasks userId={user.id} />
          </TabsContent>

          <TabsContent value="calendar">
            <CalendarView tasks={topLevelTasks} users={users} isAdmin={isAdmin} />
          </TabsContent>

          {canUseMarketingCalendar && (
            <TabsContent value="marketing">
              <MarketingCalendar userId={user.id} userName={user.full_name || user.email} isAdmin={isAdmin} />
            </TabsContent>
          )}

          <TabsContent value="boards">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Project Boards</CardTitle>
                  <CardDescription>View all project boards</CardDescription>
                </div>
                <div className="flex items-center border rounded-md">
                  <Button
                    onClick={() => setBoardsViewMode('tile')}
                    variant={boardsViewMode === 'tile' ? 'default' : 'ghost'}
                    size="sm"
                    className="gap-2 rounded-r-none"
                    aria-label="Tile view"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={() => setBoardsViewMode('list')}
                    variant={boardsViewMode === 'list' ? 'default' : 'ghost'}
                    size="sm"
                    className="gap-2 rounded-l-none"
                    aria-label="List view"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {boardsViewMode === 'list' ? (
                  <div className="space-y-2">
                    {boards.map((board) => (
                      <Link key={board.id} href={`/dashboard/board/${board.id}`}>
                        <Card className="flex items-center gap-3 p-3 hover:shadow-md transition-all cursor-pointer hover:border-primary/30">
                          <Kanban className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{board.title}</div>
                            {(board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email) && (
                              <p className="truncate text-xs text-muted-foreground">
                                Last edited by {board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email}
                              </p>
                            )}
                          </div>
                        </Card>
                      </Link>
                    ))}
                  </div>
                ) : (
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
                              {(board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email) && (
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  Last edited by {board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email}
                                </p>
                              )}
                              {board.created_by !== board.updated_by && (board.creator?.full_name || board.creator?.email) && (
                                <p className="truncate text-xs text-muted-foreground">
                                  Created by {board.creator.full_name || board.creator.email}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    </Link>
                  ))}
                </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chat">
            <ChatPanel currentUserId={user.id} isAdmin={false} />
          </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  )
}
