'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, ShieldCheck, Users, Building2, SlidersHorizontal } from 'lucide-react'
import EnhancedUserManagement from './enhanced-user-management'
import CompanyManagement from './company-management'
import StatusManagement from './status-management'

interface SuperAdminDashboardProps {
  users: any[]
  currentUserId: string
}

export default function SuperAdminDashboard({ users, currentUserId }: SuperAdminDashboardProps) {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => (window.history.length > 1 ? router.back() : router.push('/admin'))}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <ShieldCheck className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Super Admin</h1>
                <p className="text-sm text-muted-foreground">Manage users and company entities</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="companies" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="companies" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Companies
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="statuses" className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Statuses
            </TabsTrigger>
          </TabsList>

          <TabsContent value="companies">
            <CompanyManagement />
          </TabsContent>

          <TabsContent value="users">
            <EnhancedUserManagement users={users} currentUserId={currentUserId} />
          </TabsContent>

          <TabsContent value="statuses">
            <StatusManagement />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
