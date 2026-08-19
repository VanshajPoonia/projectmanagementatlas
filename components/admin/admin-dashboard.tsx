'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, LogOut, Calendar, Home, Bookmark, ChevronLeft, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { resolveActiveTab } from '../shell/tab-url'
import { AppShell } from '../shell/app-shell'
import { addressableTabs, buildWorkspaceNav } from '../shell/workspace-nav'
import { buildCreateCommands, type Command } from '../shell/commands'
import type { SidebarNavGroup } from '../shell/app-sidebar'
import BoardManagement from './board-management'
import AccessLog from './access-log'
import { allows } from '@/lib/capabilities'
import TaskOverview from './task-overview'
import ChatPanel from '../chat/chat-panel'
import CalendarView from '../calendar/calendar-view'
import ReportsView from '../reports/reports-view'
import MetricsView from '../reports/metrics-view'
import PersonalTasks from '../personal/personal-tasks'
import ProjectIdsView from '../project-ids/project-ids-view'
import AppointmentsView from '../appointments/appointments-view'
import BookmarksSection from '../bookmarks/bookmarks-section'
import MarketingCalendar from '../marketing/marketing-calendar'
import TaskNotificationToasts from '../notifications/task-notification-toasts'
import AiChatWidget from '../ai-chat/ai-chat-widget'
import DashboardWindow from '../dashboard/dashboard-window'
import WorkNext from '../dashboard/work-next'
import AccountSettings from '../account/account-settings'
import { ThemeControls } from '../theme/theme-controls'
import ChatUnreadBadge from '../chat/chat-unread-badge'
import GlobalSearch from '../search/global-search'
import { gsap } from 'gsap'
import { cn } from '@/lib/utils'
import { isTaskOwnedBy } from '@/lib/assignees'
import { useAppModules, isModuleEnabled } from '@/lib/modules'
import type { ShellData } from '@/lib/shell-data'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'

interface AdminDashboardProps {
  user: any
  users: any[]
  boards: any[]
  tasks: any[]
  /**
   * Modules + marketing calendars, fetched on the server so the sidebar is correct on the
   * first frame. Optional: without it both hooks fall back to fetching on mount, which is
   * what every screen used to do. See lib/shell-data.ts.
   */
  shell?: ShellData
}

export default function AdminDashboard({ user, users, boards, tasks, shell }: AdminDashboardProps) {
  const isSuperAdmin = user.role === 'super_admin'

  // Starred boards for the sidebar and ⌘K. Admin board links go through /admin/board/:id,
  // which is why the href builder is passed in rather than inferred.
  const favoriteBoardHref = useCallback((boardId: string) => `/admin/board/${boardId}`, [])
  const { resolved: favoriteItems } = useFavorites(user.id, { boardHref: favoriteBoardHref })

  // Aggregate views count deliverables, not checklist items, so they stay on
  // top-level tasks. Counting subtasks here would change every historical report
  // number the moment someone breaks a task down.
  const topLevelTasks = useMemo(() => tasks.filter((task: any) => !task.parent_task_id), [tasks])

  // The admin's own queue, by the same rule every other surface uses.
  const myTasks = useMemo(() => tasks.filter((task: any) => isTaskOwnedBy(task, user.id)), [tasks, user.id])
  const [activeTab, setActiveTabState] = useState('overview')
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
  const tabsRef = useRef<HTMLDivElement>(null)

  // Module activation (PROMPT 3 "1-C"): app_modules is a singleton config table (one org, no
  // org_id) - everything defaults enabled=true, so this is a no-op until a super_admin flips a
  // module off in Super Admin. 'overview' is a core admin function, not a registered module,
  // so it's always on. Statuses management moved to the Super Admin page (069) - status
  // creation/editing is now super_admin-only, so it no longer belongs in the shared admin tabs.
  const modules = useAppModules(shell?.modules)
  const showCalendar = isModuleEnabled(modules, 'calendar')
  const showMarketing = isModuleEnabled(modules, 'marketing_calendar')
  const { calendars: marketingCalendars, refetch: refetchMarketingCalendars } = useMarketingCalendars(shell?.calendars)
  const showReports = isModuleEnabled(modules, 'reports')
  const showBoards = isModuleEnabled(modules, 'boards')
  const showChat = isModuleEnabled(modules, 'chat')
  const showPersonal = isModuleEnabled(modules, 'personal_tasks')
  const showProjectIds = isModuleEnabled(modules, 'project_ids')
  // Seeded enabled=false (migration 080), so this stays hidden until a super_admin switches
  // it on. It had a tab on the user dashboard and none here, which meant an admin who
  // switched Appointments on could see the module everywhere except their own home screen.
  const showAppointments = isModuleEnabled(modules, 'appointments')
  // These two render outside the tab list, so they were seeded into app_modules by 066 but
  // never consumed - switching either off in Super Admin changed nothing. Gated here so the
  // toggle means what it says.
  const showAiAssistant = isModuleEnabled(modules, 'ai_assistant')
  const showBookmarks = isModuleEnabled(modules, 'bookmarks')

  // The audit trail (migration 098). Not a module: a log you can switch off is not a log,
  // and the point of recording access changes is that nobody chooses whether they are
  // recorded. Gated on the capability instead, which resolves to admin + super_admin and
  // matches the table's own RLS policy.
  const canViewAudit = allows({ userId: user.id, platformRole: user.role }, 'audit.view')

  // Built from the shared workspace nav, exactly as the user dashboard, /my-work and /crm
  // do. This screen used to hand-write its own list, which is why Appointments and CRM
  // never appeared here however they were toggled in Super Admin → Modules. The chat unread
  // badge is attached here because it is JSX, which the pure builder deliberately avoids.
  const sidebarGroups: SidebarNavGroup[] = useMemo(
    () =>
      buildWorkspaceNav({
        role: user.role,
        modules,
        // This route is admin-only (app/admin/page.tsx redirects everyone else), and the
        // rule from migration 085 is "admin, or a member of at least one calendar" - so
        // the membership half can't change the answer here.
        canUseMarketingCalendar: true,
        canViewAudit,
      }).map((group) => ({
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
    [user.role, user.id, modules, canViewAudit],
  )

  // Sections addressable via ?tab=, derived from the nav rather than restated. A tab with
  // no nav item would be unreachable; a nav item with no tab would fall back to Home.
  const allowedTabs = useMemo(() => addressableTabs(sidebarGroups), [sidebarGroups])

  // Keep the active tab in sync with the URL so sections are deep-linkable and the
  // browser Back/Forward buttons move between them; falls back to the last session
  // tab (e.g. after returning from a board), then Overview. Setting the same value
  // is a no-op, so there's no feedback loop with the push below.
  //
  // allowedTabs is a dependency because app_modules loads asynchronously: on the first
  // render the fallback list has appointments and crm off, so a deep link to a module that
  // is switched on would resolve to Overview and stay there once the real list arrived.
  useEffect(() => {
    setActiveTabState(
      resolveActiveTab(searchParams.get('tab'), sessionStorage.getItem('admin-active-tab'), allowedTabs, 'overview'),
    )
  }, [searchParams, allowedTabs])

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab)
    sessionStorage.setItem('admin-active-tab', tab)
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (params.get('tab') !== tab) {
      params.set('tab', tab)
      router.push(`${pathname}?${params.toString()}`)
    }
  }

  useEffect(() => {
    if (tabsRef.current) {
      gsap.fromTo(
        tabsRef.current,
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, delay: 0.3, ease: 'power3.out' }
      )
    }
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const activeLabel = sidebarGroups[0].items.find((i) => i.id === activeTab)?.label ?? 'Home'

  // ⌘K's Create section. This screen used to pass no commands at all, so the palette had
  // no Create group for an admin - and per CLAUDE.md every real user of this app is one.
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
      <TaskNotificationToasts userId={user.id} isAdmin />
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
              <BookmarksSection userId={user.id} isAdmin={true} embedded sidebar />
            </div>
          )}
        </aside>}

        {/* Main Content */}
        <div className="flex-1 min-w-0 px-4 py-8 overflow-x-hidden">
          <div className="mb-6">
            <GlobalSearch isAdmin />
          </div>
        <div ref={tabsRef}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">

            <TabsContent value="overview" className="space-y-6">
              <DashboardWindow
                id="admin-work-next"
                title="Work on next"
                description="Ranked by deadline, priority, and what you've already started"
                icon={<Sparkles className="h-4 w-4" />}
              >
                <WorkNext tasks={myTasks} basePath="/admin" />
              </DashboardWindow>

              <DashboardWindow id="admin-overview" title="Overview" description="Quick overview of your project management" icon={<LayoutDashboard className="h-4 w-4" />}>
                <TaskOverview tasks={topLevelTasks} users={users} />
              </DashboardWindow>
            </TabsContent>

            {showCalendar && (
              <TabsContent value="calendar">
                <CalendarView tasks={topLevelTasks} users={users} isAdmin />
              </TabsContent>
            )}

            {showMarketing && (
              <TabsContent value="marketing">
                <MarketingCalendar
                  userId={user.id}
                  userName={user.full_name || user.email}
                  isAdmin
                  calendars={marketingCalendars}
                  refetchCalendars={refetchMarketingCalendars}
                />
              </TabsContent>
            )}

            {showReports && (
              <TabsContent value="reports">
                <Tabs defaultValue="table" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="table">Report</TabsTrigger>
                    <TabsTrigger value="metrics">Metrics</TabsTrigger>
                  </TabsList>
                  <TabsContent value="table">
                    <ReportsView tasks={topLevelTasks} users={users} boards={boards} />
                  </TabsContent>
                  <TabsContent value="metrics">
                    <MetricsView tasks={topLevelTasks} users={users} boards={boards} />
                  </TabsContent>
                </Tabs>
              </TabsContent>
            )}

            {showBoards && (
              <TabsContent value="boards">
                <BoardManagement boards={boards} isSuperAdmin={isSuperAdmin} currentUserId={user.id} />
              </TabsContent>
            )}

            {showChat && (
              <TabsContent value="chat">
                <ChatPanel currentUserId={user.id} isAdmin={true} />
              </TabsContent>
            )}

            {showPersonal && (
              <TabsContent value="personal">
                <PersonalTasks userId={user.id} />
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

            {canViewAudit && (
              <TabsContent value="access-log">
                <AccessLog currentUserId={user.id} currentUserRole={user.role} />
              </TabsContent>
            )}
          </Tabs>
        </div>
        </div>
      </div>
    </AppShell>
  )
}
