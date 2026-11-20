import { redirect } from 'next/navigation'

import SocialView from '@/components/social/social-view'
import { isModuleEnabledOnServer } from '@/lib/module-registry'
import { loadShellData } from '@/lib/shell-data'
import type { SocialPost, SocialReview } from '@/lib/social-review'
import { createClient } from '@/lib/supabase/server'

/** Social post approvals (migration 138). RLS limits both tables to the marketing team. */
export default async function SocialPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (!(await isModuleEnabledOnServer(supabase, 'social_media'))) redirect('/my-work')

  const [{ data: profile }, postsResult, reviewsResult, { data: profiles }, shell] = await Promise.all([
    supabase.from('profiles').select('id, role, full_name, email').eq('id', user.id).single(),
    supabase.from('social_posts').select('id, brand, platform, format, title, caption, hashtags, scheduled_for, media, status, created_at, updated_at'),
    supabase.from('social_post_reviews').select('id, post_id, reviewer_id, decision, note, created_at').order('created_at'),
    supabase.from('profiles').select('id, full_name, email'),
    loadShellData(supabase),
  ])

  // Not a member of the marketing team: the policies return nothing, so send them home
  // rather than showing an empty page that reads as "nothing to review".
  const role = profile?.role ?? 'user'
  const isAdmin = role === 'admin' || role === 'super_admin'
  if (!isAdmin && !(shell?.calendars ?? []).some((c) => c.member_user_ids.includes(user.id))) redirect('/my-work')

  const people = Object.fromEntries((profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p.full_name || p.email || 'Someone']))

  if (postsResult.error) throw new Error(`Could not load social posts: ${postsResult.error.message}`)

  return (
    <SocialView
      user={{ id: user.id, role, full_name: profile?.full_name, email: profile?.email ?? user.email }}
      initialPosts={(postsResult.data ?? []) as SocialPost[]}
      initialReviews={(reviewsResult.data ?? []) as SocialReview[]}
      people={people}
      shell={shell}
    />
  )
}
