'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, ClipboardList, MessageSquare, LogOut, Calendar, FileBarChart, Lock, Home, Megaphone, Bookmark, SlidersHorizontal, ChevronLeft, ShieldCheck, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { resolveActiveTab } from '../shell/tab-url'
import { AppShell } from '../shell/app-shell'
import type { SidebarNavGroup } from '../shell/app-sidebar'
import BoardManagement from './board-management'
import StatusManagement from './status-management'
import TaskOverview from './task-overview'
import ChatPanel from '../chat/chat-panel'
import CalendarView from '../calendar/calendar-view'
import ReportsView from '../reports/reports-view'
import PersonalTasks from '../personal/personal-tasks'
import BookmarksSection from '../bookmarks/bookmarks-section'
import MarketingCalendar from '../marketing/marketing-calendar'
import TaskNotificationToasts from '../notifications/task-notification-toasts'
import AiChatWidget from '../ai-chat/ai-chat-widget'
import DashboardWindow from '../dashboard/dashboard-window'
import WorkNext from '../dashboard/work-next'
import AccountSettings from '../account/account-settings'
import ThemeToggle from '../theme-toggle'
import ChatUnreadBadge from '../chat/chat-unread-badge'
import MobileBottomNav, { type NavItem } from '../dashboard/mobile-bottom-nav'
import GlobalSearch from '../search/global-search'
import { gsap } from 'gsap'
import { cn } from '@/lib/utils'
import { isTaskOwnedBy } from '@/lib/assignees'

interface AdminDashboardProps {
  user: any
  users: any[]
  boards: any[]
  tasks: any[]
}

export default function AdminDashboard({ user, users, boards, tasks }: AdminDashboardProps) {
  const isSuperAdmin = user.role === 'super_admin'

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
  const headerRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  // Sections addressable via ?tab= — matches the TabsTrigger values below.
  const allowedTabs = ['overview', 'calendar', 'marketing', 'reports', 'boards', 'statuses', 'chat', 'personal']

  // Keep the active tab in sync with the URL so sections are deep-linkable and the
  // browser Back/Forward buttons move between them; falls back to the last session
  // tab (e.g. after returning from a board), then Overview. Setting the same value
  // is a no-op, so there's no feedback loop with the push below.
  useEffect(() => {
    setActiveTabState(
      resolveActiveTab(searchParams.get('tab'), sessionStorage.getItem('admin-active-tab'), allowedTabs, 'overview'),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { y: -80, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out' }
      )
    }

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

  const primaryNavItems: NavItem[] = [
    { value: 'overview', label: 'Home', icon: Home },
    { value: 'boards', label: 'Boards', icon: ClipboardList },
    { value: 'reports', label: 'Reports', icon: FileBarChart },
    {
      value: 'chat',
      label: 'Chat',
      icon: MessageSquare,
      badge: (
        <span className="absolute -top-1 -right-2">
          <ChatUnreadBadge userId={user.id} />
        </span>
      ),
    },
  ]

  const moreNavItems: NavItem[] = [
    { value: 'calendar', label: 'Calendar', icon: Calendar },
    { value: 'marketing', label: 'Marketing', icon: Megaphone },
    { value: 'statuses', label: 'Statuses', icon: SlidersHorizontal },
    { value: 'personal', label: 'Personal', icon: Lock },
    ...(isSuperAdmin ? [{ value: 'super-admin', label: 'Super Admin', icon: ShieldCheck }] : []),
  ]

  // Super Admin is a dedicated page, not a tab — intercept its nav value and
  // navigate instead of switching tabs.
  const handleMobileNavChange = (value: string) => {
    if (value === 'super-admin') {
      router.push('/admin/super-admin')
      return
    }
    setActiveTab(value)
  }

  const adminSections: SidebarNavGroup['items'] = [
    { id: 'overview', label: 'Home', icon: 'home', href: '/admin?tab=overview', status: 'live' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/admin?tab=calendar', status: 'live' },
    { id: 'marketing', label: 'Marketing', icon: 'megaphone', href: '/admin?tab=marketing', status: 'live' },
    { id: 'reports', label: 'Reports', icon: 'reports', href: '/admin?tab=reports', status: 'live' },
    { id: 'boards', label: 'Boards', icon: 'kanban', href: '/admin?tab=boards', status: 'live' },
    { id: 'statuses', label: 'Statuses', icon: 'statuses', href: '/admin?tab=statuses', status: 'live' },
    {
      id: 'chat',
      label: 'Chat',
      icon: 'message',
      href: '/admin?tab=chat',
      status: 'live',
      badge: (
        <span className="absolute -top-1 -right-2">
          <ChatUnreadBadge userId={user.id} />
        </span>
      ),
    },
    { id: 'personal', label: 'Personal', icon: 'lock', href: '/admin?tab=personal', status: 'live' },
  ]
  const sidebarGroups: SidebarNavGroup[] = [
    { id: 'sections', label: 'Workspace', items: adminSections },
    ...(isSuperAdmin
      ? [{
          id: 'admin',
          label: 'Admin',
          items: [{ id: 'super-admin', label: 'Super Admin', icon: 'crown', href: '/admin/super-admin', status: 'live' as const }],
        }]
      : []),
  ]
  const activeLabel = adminSections.find((i) => i.id === activeTab)?.label ?? 'Home'

  return (
    <AppShell
      user={{ id: user.id, role: user.role, full_name: user.full_name, email: user.email }}
      groups={sidebarGroups}
      activeId={activeTab}
      breadcrumbs={[{ label: activeLabel }]}
      topbarActions={
        <>
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
              <BookmarksSection userId={user.id} isAdmin={true} embedded sidebar />
            </div>
          )}
        </aside>

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

            <TabsContent value="calendar">
              <CalendarView tasks={topLevelTasks} users={users} isAdmin />
            </TabsContent>

            <TabsContent value="marketing">
              <MarketingCalendar userId={user.id} userName={user.full_name || user.email} isAdmin />
            </TabsContent>

            <TabsContent value="reports">
              <ReportsView tasks={topLevelTasks} users={users} boards={boards} />
            </TabsContent>

            <TabsContent value="boards">
              <BoardManagement boards={boards} />
            </TabsContent>

            <TabsContent value="statuses">
              <StatusManagement />
            </TabsContent>

            <TabsContent value="chat">
              <ChatPanel currentUserId={user.id} isAdmin={true} />
            </TabsContent>

            <TabsContent value="personal">
              <PersonalTasks userId={user.id} />
            </TabsContent>
          </Tabs>
        </div>
        </div>
      </div>
    </AppShell>
  )
}
