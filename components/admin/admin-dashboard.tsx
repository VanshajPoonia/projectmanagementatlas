'use client'

import { useState, useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, Users, ClipboardList, MessageSquare, LogOut, Calendar, FileBarChart, Lock, Home, Megaphone, Bookmark, SlidersHorizontal } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import EnhancedUserManagement from './enhanced-user-management'
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
import DashboardWindow from '../dashboard/dashboard-window'
import AccountSettings from '../account/account-settings'
import ThemeToggle from '../theme-toggle'
import ChatUnreadBadge from '../chat/chat-unread-badge'
import MobileBottomNav, { type NavItem } from '../dashboard/mobile-bottom-nav'
import GlobalSearch from '../search/global-search'
import { gsap } from 'gsap'

interface AdminDashboardProps {
  user: any
  users: any[]
  boards: any[]
  tasks: any[]
}

export default function AdminDashboard({ user, users, boards, tasks }: AdminDashboardProps) {
  const isSuperAdmin = user.role === 'super_admin'
  const [activeTab, setActiveTabState] = useState('overview')
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
    ...(isSuperAdmin ? [{ value: 'users', label: 'Users', icon: Users }] : []),
    { value: 'statuses', label: 'Statuses', icon: SlidersHorizontal },
    { value: 'personal', label: 'Personal', icon: Lock },
  ]

  return (
    <div className="min-h-screen bg-background">
      <TaskNotificationToasts userId={user.id} />
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

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 pb-24 md:pb-8">
        <div ref={tabsRef}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className={isSuperAdmin ? "hidden md:grid w-full max-w-6xl grid-cols-9 h-12" : "hidden md:grid w-full max-w-6xl grid-cols-8 h-12"}>
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
              {isSuperAdmin && (
                <TabsTrigger value="users" className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">Users</span>
                </TabsTrigger>
              )}
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
              <DashboardWindow id="admin-bookmarks" title="Bookmarks" description="Quick links you use every day" icon={<Bookmark className="h-4 w-4" />}>
                <BookmarksSection userId={user.id} isAdmin={true} embedded />
              </DashboardWindow>
              <DashboardWindow id="admin-overview" title="Overview" description="Quick overview of your project management" icon={<LayoutDashboard className="h-4 w-4" />}>
                <TaskOverview tasks={tasks} users={users} />
              </DashboardWindow>
            </TabsContent>

            <TabsContent value="calendar">
              <CalendarView tasks={tasks} users={users} isAdmin />
            </TabsContent>

            <TabsContent value="marketing">
              <MarketingCalendar userId={user.id} userName={user.full_name || user.email} isAdmin />
            </TabsContent>

            <TabsContent value="reports">
              <ReportsView tasks={tasks} users={users} boards={boards} />
            </TabsContent>

            {isSuperAdmin && (
              <TabsContent value="users">
                <EnhancedUserManagement users={users} currentUserId={user.id} />
              </TabsContent>
            )}

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

      <MobileBottomNav
        items={primaryNavItems}
        moreItems={moreNavItems}
        activeTab={activeTab}
        onChange={setActiveTab}
      />
    </div>
  )
}
