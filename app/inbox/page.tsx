import { redirect } from 'next/navigation'

import InboxView from '@/components/inbox/inbox-view'
import { createClient } from '@/lib/supabase/server'
import { fetchInboxData } from '@/lib/notifications-data'
import { loadShellData } from '@/lib/shell-data'

/**
 * The Inbox - everything addressed to this person, in two buckets.
 *
 * Read on the SERVER so the first frame is the real list rather than an empty state that
 * corrects itself a beat later. That matters more here than on most screens: an inbox that
 * paints "You're all caught up" and then fills in is one that trains people to distrust it.
 *
 * Available to every role. An admin gets assigned work and mentions like anyone else, and
 * `/dashboard`'s admin redirect drops query strings, which is why this is a real route.
 */
export default async function InboxPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  // RLS scopes all three reads to this person; nothing here re-implements visibility.
  const inbox = await fetchInboxData(supabase, user.id)
  const shell = await loadShellData(supabase)

  // The server's instant, so "snoozed until" means the same thing on both renders. Reading
  // the wall clock during render is what makes React throw the subtree away.
  return (
    <InboxView
      user={profile}
      initialNotifications={inbox.notifications}
      initialMutedTaskIds={[...inbox.mutes.mutedTaskIds]}
      initialMutedBoardIds={[...inbox.mutes.mutedBoardIds]}
      initialFollowingTaskIds={[...inbox.followingTaskIds]}
      initialMutedBoards={inbox.mutedBoards}
      initialMutedTasks={inbox.mutedTasks}
      initialFollowedTasks={inbox.followedTasks}
      loadFailed={inbox.failed}
      shell={shell}
      now={new Date().toISOString()}
    />
  )
}
