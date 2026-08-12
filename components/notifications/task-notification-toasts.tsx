'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface TaskNotificationToastsProps {
  userId: string
  // Board routes are mirrored under /admin and /dashboard, so the toast has to open the one
  // this viewer is actually allowed to load. Matches global-search.tsx's goToTask().
  isAdmin?: boolean
}

interface TaskNotificationRow {
  id: string
  message: string
  task_id: string | null
  created_at: string
  task: { column: { board_id: string | null; board: { archived_at: string | null } | null } | null } | null
}

export default function TaskNotificationToasts({ userId, isAdmin = false }: TaskNotificationToastsProps) {
  const shownRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    if (shownRef.current) return
    shownRef.current = true

    const supabase = createClient()

    // Marking read is per-notification and tied to a toast actually finishing its time on
    // screen, rather than the bulk write this component used to fire the moment the query
    // returned. The old version consumed every notification on page load whether or not
    // anyone saw it: on production that left the two people who use the app daily with zero
    // unread rows, while everyone else still had every row they were ever sent. A notification
    // whose toast never completed now survives to the next load instead of being lost.
    //
    // `.is('read_at', null)` keeps it idempotent, so an onDismiss/onAutoClose double-fire or a
    // click on Open followed by a dismiss cannot stamp a second, later timestamp.
    const markRead = async (id: string) => {
      await supabase
        .from('task_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null)
    }

    const load = async () => {
      const { data, error } = await supabase
        .from('task_notifications')
        .select('id,message,task_id,created_at,task:tasks(column:columns(board_id, board:boards(archived_at)))')
        .eq('recipient_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error || !data || data.length === 0) return

      for (const notification of data as unknown as TaskNotificationRow[]) {
        const column = notification.task?.column
        const boardId = column?.board_id
        const onArchivedBoard = Boolean(column?.board?.archived_at)
        const canOpen = Boolean(notification.task_id && boardId && !onArchivedBoard)

        toast.info('Task update', {
          description: notification.message,
          // Offer no action when there is nowhere specific to go. The previous version always
          // rendered an "Open" button and always sent it to /dashboard, ignoring the task id
          // it had already fetched.
          action: canOpen
            ? {
                label: 'Open',
                onClick: () => {
                  markRead(notification.id)
                  router.push(
                    `/${isAdmin ? 'admin' : 'dashboard'}/board/${boardId}?task=${notification.task_id}`,
                  )
                },
              }
            : undefined,
          onAutoClose: () => markRead(notification.id),
          onDismiss: () => markRead(notification.id),
        })
      }
    }

    load()
  }, [userId, isAdmin, router])

  return null
}
