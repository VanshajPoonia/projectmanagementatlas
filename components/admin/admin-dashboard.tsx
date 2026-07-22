'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, ClipboardList, MessageSquare, LogOut, Calendar, FileBarChart, Lock, Home, Megaphone, Bookmark, SlidersHorizontal, ChevronLeft, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
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
import AccountSettings from '../account/account-settings'
import ThemeToggle from '../theme-toggle'
import ChatUnreadBadge from '../chat/chat-unread-badge'
import MobileBottomNav, { type NavItem } from '../dashboard/mobile-bottom-nav'
import GlobalSearch from '../search/global-search'
import { gsap } from 'gsap'
import { cn } from '@/lib/utils'

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
  const supabase = createClient()
  const headerRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  // Restores whichever tab was active before navigating away (e.g. into a board),
  // so the in-app Back button returns here instead of resetting to Home.
  useEffect(() => {
    const savedTab = sessionStorage.getItem('admin-active-tab')
    if (savedTab) setActiveTabState(savedTab)
  }, [])

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab)
    sessionStorage.setItem('admin-active-tab', tab)
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TaskNotificationToasts userId={user.id} />
      <AiChatWidget userId={user.id} />
      {/* Header */}
      <header ref={headerRef} className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <LayoutDashboard className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">{user.full_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <Button onClick={() => router.push('/admin/super-admin')} variant="outline" size="sm" className="gap-2">
                <ShieldCheck className="w-4 h-4" />
                <span className="hidden sm:inline">Super Admin</span>
              </Button>
            )}
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
          </div>
        </div>
        <div className="container mx-auto px-4 pb-3">
          <GlobalSearch isAdmin />
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 min-h-0">
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
        <main className="flex-1 min-w-0 px-4 py-8 pb-24 md:pb-8 overflow-x-hidden">
        <div ref={tabsRef}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="hidden md:grid w-full max-w-6xl grid-cols-8 h-12">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <Home className="w-4 h-4" />
                <span className="hidden sm:inline">Home</span>
              </TabsTrigger>
              <TabsTrigger value="calendar" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Calendar</span>
              </TabsTrigger>
              <TabsTrigger value="marketing" className="flex items-center gap-2">
                <Megaphone className="w-4 h-4" />
                <span className="hidden sm:inline">Marketing</span>
              </TabsTrigger>
              <TabsTrigger value="reports" className="flex items-center gap-2">
                <FileBarChart className="w-4 h-4" />
                <span className="hidden sm:inline">Reports</span>
              </TabsTrigger>
              <TabsTrigger value="boards" className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                <span className="hidden sm:inline">Boards</span>
              </TabsTrigger>
              <TabsTrigger value="statuses" className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Statuses</span>
              </TabsTrigger>
              <TabsTrigger value="chat" className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Chat</span>
                <ChatUnreadBadge userId={user.id} />
              </TabsTrigger>
              <TabsTrigger value="personal" className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                <span className="hidden sm:inline">Personal</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
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
        </main>
      </div>

      <MobileBottomNav
        items={primaryNavItems}
        moreItems={moreNavItems}
        activeTab={activeTab}
        onChange={handleMobileNavChange}
      />
    </div>
  )
}
