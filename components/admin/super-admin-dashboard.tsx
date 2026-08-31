'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, ShieldCheck, Users, Building2, SlidersHorizontal, UsersRound, ToggleLeft, Shapes, Table2, Gavel } from 'lucide-react'
import { ThemeControls } from '@/components/theme/theme-controls'
import EnhancedUserManagement from './enhanced-user-management'
import { DecisionManagement } from './decision-management'
import CompanyManagement from './company-management'
import StatusManagement from './status-management'
import TeamManagement from './team-management'
import ModuleManagement from './module-management'
import WorkItemTypeManagement from './work-item-type-management'
import FieldManagement from './field-management'

interface SuperAdminDashboardProps {
  users: any[]
  currentUserId: string
}

export default function SuperAdminDashboard({ users, currentUserId }: SuperAdminDashboardProps) {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-start gap-3 sm:items-center sm:gap-4">
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3"
              onClick={() => (window.history.length > 1 ? router.back() : router.push('/admin'))}
              aria-label="Back to admin dashboard"
            >
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Back</span>
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary">
                <ShieldCheck className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold tracking-tight sm:text-xl">Super Admin</h1>
                <p className="text-sm text-muted-foreground">Manage users and company entities</p>
              </div>
            </div>
            {/* This page builds its own header rather than using AppShell's topbar, so the
                theme control has to be repeated here or the page is a dark-mode dead end. */}
            <div className="ml-auto shrink-0">
              <ThemeControls />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 py-5 sm:px-4 sm:py-8">
        <Tabs defaultValue="companies" className="space-y-6">
          {/* Equal columns cannot hold seven icon-and-word labels on a 390px screen - at 12px
              text they collided with their own icons. Below `sm` the strip scrolls sideways at
              its natural width instead, which is the one place horizontal scroll is the right
              answer: the row is the control. `max-w-3xl` is gone with the seventh tab - the
              grid needs the full container width to fit them. */}
          <TabsList className="-mx-3 flex h-auto w-auto max-w-full justify-start gap-1 overflow-x-auto rounded-none px-3 sm:mx-0 sm:grid sm:w-full sm:grid-cols-8 sm:gap-0 sm:rounded-lg sm:px-1 sm:py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="companies" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <Building2 className="h-4 w-4" />
              Companies
            </TabsTrigger>
            <TabsTrigger value="teams" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <UsersRound className="h-4 w-4" />
              Teams
            </TabsTrigger>
            <TabsTrigger value="users" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="statuses" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <SlidersHorizontal className="h-4 w-4" />
              Statuses
            </TabsTrigger>
            <TabsTrigger value="modules" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <ToggleLeft className="h-4 w-4" />
              Modules
            </TabsTrigger>
            <TabsTrigger value="decisions" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <Gavel className="h-4 w-4" />
              Decisions
            </TabsTrigger>
            <TabsTrigger value="types" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <Shapes className="h-4 w-4" />
              Types
            </TabsTrigger>
            <TabsTrigger value="fields" className="shrink-0 gap-1.5 px-3 py-2 text-xs whitespace-nowrap sm:min-w-0 sm:shrink sm:gap-2 sm:px-3 sm:text-sm">
              <Table2 className="h-4 w-4" />
              Fields
            </TabsTrigger>
          </TabsList>

          <TabsContent value="companies">
            <CompanyManagement />
          </TabsContent>

          <TabsContent value="teams">
            <TeamManagement />
          </TabsContent>

          <TabsContent value="users">
            <EnhancedUserManagement users={users} currentUserId={currentUserId} />
          </TabsContent>

          <TabsContent value="statuses">
            <StatusManagement />
          </TabsContent>

          <TabsContent value="modules">
            <ModuleManagement />
          </TabsContent>

          <TabsContent value="decisions">
            <DecisionManagement userId={currentUserId} />
          </TabsContent>

          <TabsContent value="types">
            <WorkItemTypeManagement />
          </TabsContent>

          <TabsContent value="fields">
            <FieldManagement />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
