'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface TaskNotificationToastsProps {
  userId: string
}

interface TaskNotification {
  id: string
  message: string
  task_id: string | null
  created_at: string
}

export default function TaskNotificationToasts({ userId }: TaskNotificationToastsProps) {
  const shownRef = useRef(false)

  useEffect(() => {
    if (shownRef.current) return
    shownRef.current = true

    const supabase = createClient()

    const loadNotifications = async () => {
      const { data, error } = await supabase
        .from('task_notifications')
        .select('id,message,task_id,created_at')
        .eq('recipient_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error || !data || data.length === 0) return

      const notifications = data as TaskNotification[]

      for (const notification of notifications) {
        toast.info('Task update', {
          description: notification.message,
          action: notification.task_id
            ? {
                label: 'Open',
                onClick: () => {
                  window.location.href = '/dashboard'
                },
              }
            : undefined,
        })
      }

      await supabase
        .from('task_notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', notifications.map((notification) => notification.id))
    }

    loadNotifications()
  }, [userId])

  return null
}
