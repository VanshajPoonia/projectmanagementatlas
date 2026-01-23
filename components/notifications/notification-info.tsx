'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bell, Mail, MessageSquare, Calendar, CheckCircle } from 'lucide-react'

export default function NotificationInfo() {
  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-600" />
          <CardTitle className="text-lg">Email Notifications Active</CardTitle>
        </div>
        <CardDescription>
          You will receive email updates for the following events:
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Mail className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">Task Assignments</p>
            <p className="text-xs text-muted-foreground">When you are assigned to a new task</p>
          </div>
        </div>
        
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-4 h-4 text-purple-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">Task Updates</p>
            <p className="text-xs text-muted-foreground">When task details, status, or priority changes</p>
          </div>
        </div>
        
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-4 h-4 text-green-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">New Comments</p>
            <p className="text-xs text-muted-foreground">When someone comments on your assigned tasks</p>
          </div>
        </div>
        
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
            <Calendar className="w-4 h-4 text-orange-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">Due Date Reminders</p>
            <p className="text-xs text-muted-foreground">When tasks are due within 1-2 days</p>
          </div>
        </div>

        <div className="pt-3 border-t">
          <Badge variant="secondary" className="text-xs">
            Powered by FormSubmit
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
