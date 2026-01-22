'use client'

import { useState, useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, Users, ClipboardList, MessageSquare, LogOut, Calendar, FileBarChart } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import EnhancedUserManagement from './enhanced-user-management'
import BoardManagement from './board-management'
import TaskOverview from './task-overview'
import ChatPanel from '../chat/chat-panel'
import CalendarView from '../calendar/calendar-view'
import ReportsView from '../reports/reports-view'
import UserManagement from './user-management' // Added import for UserManagement
import { gsap } from 'gsap'

interface AdminDashboardProps {
  user: any
  users: any[]
  boards: any[]
  tasks: any[]
}

export default function AdminDashboard({ user, users, boards, tasks }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const router = useRouter()
  const supabase = createClient()
  const headerRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header ref={headerRef} className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <LayoutDashboard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Admin Dashboard</h1>
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
        <div ref={tabsRef}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full max-w-4xl grid-cols-6 h-12">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="calendar" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Calendar</span>
              </TabsTrigger>
              <TabsTrigger value="reports" className="flex items-center gap-2">
                <FileBarChart className="w-4 h-4" />
                <span className="hidden sm:inline">Reports</span>
              </TabsTrigger>
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Users</span>
              </TabsTrigger>
              <TabsTrigger value="boards" className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                <span className="hidden sm:inline">Boards</span>
              </TabsTrigger>
              <TabsTrigger value="chat" className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Chat</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <TaskOverview tasks={tasks} users={users} />
            </TabsContent>

            <TabsContent value="calendar">
              <CalendarView tasks={tasks} users={users} />
            </TabsContent>

            <TabsContent value="reports">
              <ReportsView tasks={tasks} users={users} boards={boards} />
            </TabsContent>

            <TabsContent value="users">
              <EnhancedUserManagement users={users} currentUserId={user.id} />
            </TabsContent>

            <TabsContent value="boards">
              <BoardManagement boards={boards} />
            </TabsContent>

            <TabsContent value="chat">
              <ChatPanel currentUserId={user.id} isAdmin={true} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
