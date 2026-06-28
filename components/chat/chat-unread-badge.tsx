'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Small red count of unread chat messages, shown on the Chat tab. */
export default function ChatUnreadBadge({ userId }: { userId: string }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const load = async () => {
      const { count: c } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId)
        .is('read_at', null)
      if (active && typeof c === 'number') setCount(c)
    }

    load()
    const interval = setInterval(load, 15000)
    const channel = supabase
      .channel(`chat-unread-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `recipient_id=eq.${userId}` }, load)
      .subscribe()

    return () => {
      active = false
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [userId])

  if (count <= 0) return null

  return (
    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
      {count > 9 ? '9+' : count}
    </span>
  )
}
