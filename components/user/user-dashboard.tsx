'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, LogOut, Calendar, Kanban, Home, Bookmark, Bell, ListTodo, CheckCircle2, ChevronLeft, Sparkles, CornerDownRight, LayoutGrid, List } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { resolveActiveTab } from '../shell/tab-url'
import { AppShell } from '../shell/app-shell'
import { addressableTabs, buildWorkspaceNav } from '../shell/workspace-nav'
import { buildCreateCommands, type Command } from '../shell/commands'
import type { SidebarNavGroup } from '../shell/app-sidebar'
import Link from 'next/link'
import ChatPanel from '../chat/chat-panel'
import AppointmentsView from '../appointments/appointments-view'
import ProjectIdsView from '../project-ids/project-ids-view'
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
import { ThemeControls } from '../theme/theme-controls'
import ChatUnreadBadge from '../chat/chat-unread-badge'
import GlobalSearch from '../search/global-search'
import { cn } from '@/lib/utils'
import { cleanBoardDescription, cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, getTaskStatusLabel } from '@/lib/task-status'
import { isTaskOwnedBy } from '@/lib/assignees'
import { useAppModules, isModuleEnabled } from '@/lib/modules'
import type { ShellData } from '@/lib/shell-data'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { withFavoritesFirst } from '@/lib/favorites'
import { FavoriteStar } from '../shell/favorite-star'
import { EmptyState } from '../shell/states'

interface UserDashboardProps {
  user: any
  tasks: any[]
  boards: any[]
  users: any[]
  /**
   * Modules + marketing calendars, fetched on the server so the sidebar is correct on the
   * first frame. Optional: without it both hooks fall back to fetching on mount, which is
   * what every screen used to do. See lib/shell-data.ts.
   */
  shell?: ShellData
}

export default function UserDashboard({ user, tasks, boards, users, shell }: UserDashboardProps) {
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
  // Marketing calendars are now admin-creatable, named instances with their own member lists
  // (migration 085) rather than one calendar hardcoded to a single owner - access is "admin, or
  // a member of at least one calendar," not an email compare. See use-marketing-calendars.ts.
  const { calendars: marketingCalendars, refetch: refetchMarketingCalendars } = useMarketingCalendars(shell?.calendars)
  const canUseMarketingCalendar = isAdmin || marketingCalendars.length > 0

  // Starred boards (migration 097). The hook resolves each star against boards this viewer
  // can actually read, so a favourite that outlived its board just disappears.
  const boardHref = useCallback((boardId: string) => `/dashboard/board/${boardId}`, [])
  const {
    favorites,
    resolved: favoriteItems,
    starred: isBoardStarred,
    isPending: isStarPending,
    toggle: toggleFavorite,
  } = useFavorites(user.id, { boardHref })

  const handleToggleFavorite = async (boardId: string, boardTitle: string, next: boolean) => {
    const ok = await toggleFavorite('board', boardId, next)
    if (!ok) {
      toast.error(next ? `Couldn’t favourite ${boardTitle}` : `Couldn’t remove ${boardTitle}`, {
        description: 'The change was undone. Check your connection and try again.',
      })
    }
  }

  // Starred boards float to the top of the grid; the star on each card is what says why.
  const orderedBoards = useMemo(() => withFavoritesFirst(boards, favorites), [boards, favorites])

  // Module activation (PROMPT 3 "1-C"): app_modules is a singleton config table (one org, no
  // org_id) - everything defaults enabled=true, so this is a no-op until a super_admin flips a
  // module off in Super Admin. 'tasks' (Home) is core and always on, not a registered module.
  const modules = useAppModules(shell?.modules)
  const showPersonal = isModuleEnabled(modules, 'personal_tasks')
  const showCalendar = isModuleEnabled(modules, 'calendar')
  const showMarketing = canUseMarketingCalendar && isModuleEnabled(modules, 'marketing_calendar')
  const showBoards = isModuleEnabled(modules, 'boards')
  const showChat = isModuleEnabled(modules, 'chat')
  // Unlike the modules above, 'appointments' is seeded enabled=false (migration 080), so this
  // stays hidden until a super_admin switches it on.
  const showAppointments = isModuleEnabled(modules, 'appointments')
  const showProjectIds = isModuleEnabled(modules, 'project_ids')
  // These two render outside the tab list, so they were seeded into app_modules by 066 but
  // never consumed - switching either off in Super Admin changed nothing. Gated here so the
  // toggle means what it says.
  const showAiAssistant = isModuleEnabled(modules, 'ai_assistant')
  const showBookmarks = isModuleEnabled(modules, 'bookmarks')

  // Built from the shared workspace nav so this sidebar, the /my-work route, /crm and the
  // ⌘K palette can't drift apart - a module switched on or off appears and disappears from
  // all of them at once. The chat unread badge is attached here because it is JSX, which
  // the pure builder deliberately doesn't deal in.
  const sidebarGroups: SidebarNavGroup[] = useMemo(
    () =>
      buildWorkspaceNav({ role: user.role, modules, canUseMarketingCalendar }).map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.id === 'chat'
            ? {
                ...item,
                badge: (
                  <span className="absolute -top-1 -right-2">
                    <ChatUnreadBadge userId={user.id} />
                  </span>
                ),
              }
            : item,
        ),
      })),
    [user.role, user.id, modules, canUseMarketingCalendar],
  )

  // Tabs are the visible sections; only these are addressable via ?tab=. Derived from the
  // nav rather than restated, so a tab can never be reachable without a way to get to it.
  const allowedTabs = useMemo(() => addressableTabs(sidebarGroups), [sidebarGroups])

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
  // The accent used to be resolved here and spread onto this shell's wrapper as an inline
  // style, which is why it never reached a board route or any portaled dialog. It now lives in
  // AccentProvider at the document root (mounted by AccentBoot in app/layout.tsx), including
  // the per-account default that used to be computed on this line.
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

  const activeLabel = sidebarGroups[0].items.find((i) => i.id === activeTab)?.label ?? 'Home'

  // ⌘K "Create" entries. Both are navigations to where the create affordance already
  // lives, and each is gated on the module that owns it - a create shortcut for a
  // section a super_admin switched off would be a dead end.
  // Shared with /my-work, /admin and /crm so the Create section is identical everywhere
  // and its hrefs follow the viewer's role rather than this file's own route.
  const paletteCommands: Command[] = useMemo(
    () => buildCreateCommands({ role: user.role, modules }),
    [user.role, modules],
  )

  return (
    <AppShell
      user={{ id: user.id, role: user.role, full_name: user.full_name, email: user.email }}
      groups={sidebarGroups}
      activeId={activeTab}
      breadcrumbs={[{ label: activeLabel }]}
      favorites={favoriteItems}
      commands={paletteCommands}
      topbarActions={
        <>
          <ThemeControls />
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
      {showAiAssistant && <AiChatWidget userId={user.id} />}

      <div className="flex min-h-0 flex-1">
        {/* Bookmarks sidebar - hidden on mobile. The whole rail is gated, not just its
            contents, so switching the module off doesn't leave an empty collapsible strip. */}
        {showBookmarks && <aside className={cn(
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
        </aside>}

        {/* Main Content */}
        <div className={cn(
          'min-w-0 flex-1 overflow-x-hidden sm:px-4 sm:py-8',
          activeTab === 'marketing' ? 'px-4 py-8' : 'px-3 py-5',
        )}>
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
                        <div className="flex flex-col items-stretch gap-3 rounded-lg border p-4 transition-all hover:border-primary/30 hover:bg-accent hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1">
                            {task.parent?.title && (
                              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                <CornerDownRight className="w-3 h-3 flex-shrink-0" />
                                {task.parent.title}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
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
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
                              className={cn(
                                'self-start sm:self-auto',
                                task.priority <= 2
                                  ? 'border-red-500 text-red-500'
                                  : task.priority === 3
                                  ? 'border-orange-500 text-orange-500'
                                  : 'border-blue-500 text-blue-500',
                              )}
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
                      <div className="flex items-start justify-between gap-3 rounded-lg border bg-secondary/40 p-4 transition-all hover:border-primary/30 hover:bg-accent hover:shadow-md">
                        <div className="flex-1 min-w-0">
                          {task.parent?.title && (
                            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                              <CornerDownRight className="w-3 h-3 flex-shrink-0" />
                              {task.parent.title}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
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
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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

          {/* Gated like its five siblings below. The flag existed but was read only by the
              ⌘K Create commands, which now module-gate themselves in buildCreateCommands -
              leaving these two tabs the only ones whose content ignored their own module. */}
          {showPersonal && (
          <TabsContent value="personal">
            <PersonalTasks userId={user.id} />
          </TabsContent>
          )}

          {showCalendar && (
            <TabsContent value="calendar">
              <CalendarView tasks={topLevelTasks} users={users} isAdmin={isAdmin} />
            </TabsContent>
          )}

          {showMarketing && (
            <TabsContent value="marketing">
              <MarketingCalendar
                userId={user.id}
                userName={user.full_name || user.email}
                isAdmin={isAdmin}
                calendars={marketingCalendars}
                refetchCalendars={refetchMarketingCalendars}
              />
            </TabsContent>
          )}

          {showBoards && (
          <TabsContent value="boards">
            <Card>
              <CardHeader className="flex flex-col items-start justify-between gap-4 space-y-0 px-4 sm:flex-row sm:items-center sm:px-6">
                <div className="min-w-0">
                  <CardTitle>Project Boards</CardTitle>
                  <CardDescription>View all project boards</CardDescription>
                </div>
                <div className="flex shrink-0 items-center rounded-md border">
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
              <CardContent className="px-4 sm:px-6">
                {orderedBoards.length === 0 ? (
                  <EmptyState
                    icon={<Kanban />}
                    title="No boards yet"
                    description="Boards are where work lives - a column per stage, a card per task. An admin creates them, so ask one to set up your first project board."
                  />
                ) : boardsViewMode === 'list' ? (
                  <div className="space-y-2">
                    {orderedBoards.map((board) => (
                      <Link key={board.id} href={`/dashboard/board/${board.id}`} className="block">
                        <Card className="flex-row items-start gap-3 p-3 transition-all hover:border-primary/30 hover:shadow-md sm:items-center">
                          <Kanban className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground sm:mt-0" />
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]">{board.title}</div>
                            {(board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email) && (
                              <p className="truncate text-xs text-muted-foreground">
                                Last edited by {board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email}
                              </p>
                            )}
                          </div>
                          <FavoriteStar
                            active={isBoardStarred('board', board.id)}
                            pending={isStarPending('board', board.id)}
                            label={board.title}
                            onToggle={(next) => handleToggleFavorite(board.id, board.title, next)}
                          />
                        </Card>
                      </Link>
                    ))}
                  </div>
                ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {orderedBoards.map((board) => (
                    // `block` matters: without it the Link is inline, its Card overflows the
                    // grid cell, and neighbouring cards overlap - which silently stole the
                    // click target from the star on the card to its left. The list view above
                    // already had it; the tile view never did. Found by the browser pass, not
                    // by looking.
                    <Link key={board.id} href={`/dashboard/board/${board.id}`} className="block">
                      <Card className="h-full hover:shadow-md transition-all cursor-pointer hover:border-primary/30">
                        <CardHeader className="px-4 sm:px-6">
                          {/* min-w-0 is load-bearing. CardHeader is a CSS grid, and a grid
                              item defaults to min-width:auto - it refuses to shrink below its
                              min-content width. Adding the star pushed this row's min-content
                              past the column, so the row rendered 91px wider than its own
                              card and the star landed on top of the next one. */}
                          <div className="flex min-w-0 items-start gap-3">
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
                            <FavoriteStar
                              active={isBoardStarred('board', board.id)}
                              pending={isStarPending('board', board.id)}
                              label={board.title}
                              onToggle={(next) => handleToggleFavorite(board.id, board.title, next)}
                            />
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
          )}

          {showChat && (
            <TabsContent value="chat">
              <ChatPanel currentUserId={user.id} isAdmin={false} />
            </TabsContent>
          )}

          {showAppointments && (
            <TabsContent value="appointments">
              <AppointmentsView userId={user.id} />
            </TabsContent>
          )}

          {showProjectIds && (
            <TabsContent value="project-ids">
              <ProjectIdsView
                userId={user.id}
                userName={user.full_name || user.email || 'Unknown user'}
              />
            </TabsContent>
          )}
          </Tabs>
        </div>
      </div>
    </AppShell>
  )
}
