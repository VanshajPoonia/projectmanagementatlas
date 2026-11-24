'use client'

import { useEffect, useState } from 'react'

import { SocialBoard } from '@/components/social/social-view'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import type { CaptionVersion, SocialPost, SocialReview } from '@/lib/social-review'
import { createClient } from '@/lib/supabase/client'

type Loaded = {
  posts: SocialPost[]
  reviews: SocialReview[]
  versions: CaptionVersion[]
  versionsError: string | null
  people: Record<string, string>
}

/** Loads the post board's data in the browser, for the Social media button on the Marketing tab. */
export default function SocialBoardLoader({ userId }: { userId: string }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      const supabase = createClient()
      const [postsResult, reviewsResult, versionsResult, profilesResult] = await Promise.all([
        supabase.from('social_posts').select('id, brand, platform, format, title, caption, hashtags, scheduled_for, media, status, created_at, updated_at'),
        supabase.from('social_post_reviews').select('id, post_id, reviewer_id, decision, note, created_at').order('created_at'),
        fetchAllRows<CaptionVersion>((from, to) =>
          supabase
            .from('social_post_caption_versions')
            .select('id, post_id, caption, hashtags, source, restored_from, edited_by, created_at')
            .order('created_at')
            .order('id')
            .range(from, to),
        ),
        supabase.from('profiles').select('id, full_name, email'),
      ])
      if (!active) return
      if (postsResult.error) return setError(`Could not load social posts: ${postsResult.error.message}`)
      if (reviewsResult.error) return setError(`Could not load the reviews: ${reviewsResult.error.message}`)
      const people = Object.fromEntries(
        (profilesResult.data ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p.full_name || p.email || 'Someone']),
      )
      setData({
        posts: (postsResult.data ?? []) as SocialPost[],
        reviews: (reviewsResult.data ?? []) as SocialReview[],
        versions: versionsResult.data ?? [],
        versionsError: versionsResult.error?.message ?? null,
        people,
      })
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  if (error) return <p role="alert" className="text-destructive py-10 text-center text-sm">{error}</p>
  if (!data) return <p className="text-muted-foreground py-16 text-center text-sm">Loading posts...</p>

  return (
    <SocialBoard
      userId={userId}
      embedded
      initialPosts={data.posts}
      initialReviews={data.reviews}
      initialVersions={data.versions}
      versionsError={data.versionsError}
      people={data.people}
    />
  )
}
