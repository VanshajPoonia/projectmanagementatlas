// Pure rules for the Social media approvals page (migration 138). No React, no Supabase.

export type SocialStatus = 'pending' | 'approved' | 'changes_requested' | 'rejected' | 'posted'
export type ReviewDecision = 'approved' | 'changes_requested' | 'rejected' | 'comment'

export interface SocialMedia {
  path: string
  kind: 'image' | 'video'
  poster?: string
}

export interface SocialPost {
  id: string
  brand: string
  platform: 'facebook' | 'tiktok' | 'instagram'
  format: 'post' | 'reel' | 'carousel' | 'story'
  title: string
  caption: string
  hashtags: string[]
  scheduled_for: string | null
  media: SocialMedia[]
  status: SocialStatus
}

export interface SocialReview {
  id: string
  post_id: string
  reviewer_id: string | null
  decision: ReviewDecision
  note: string | null
  created_at: string
}

export const STATUS_LABEL: Record<SocialStatus, string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
  posted: 'Posted',
}

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  approved: 'approved',
  changes_requested: 'asked for changes',
  rejected: 'rejected',
  comment: 'commented',
}

/** Mirrors social_review_note_required: everything but an approval needs a real note. */
export function reviewNeedsNote(decision: ReviewDecision): boolean {
  return decision !== 'approved'
}

export function isBlank(note: string | null | undefined): boolean {
  return !note || !/\S/.test(note)
}

export function canSubmitReview(decision: ReviewDecision, note: string): boolean {
  return !reviewNeedsNote(decision) || !isBlank(note)
}

export function countByStatus(posts: SocialPost[]): Record<SocialStatus, number> {
  const out: Record<SocialStatus, number> = { pending: 0, approved: 0, changes_requested: 0, rejected: 0, posted: 0 }
  for (const p of posts) out[p.status] += 1
  return out
}

/** Soonest first; unscheduled posts go last. */
export function sortForReview(posts: SocialPost[]): SocialPost[] {
  return [...posts].sort((a, b) => {
    if (!a.scheduled_for) return b.scheduled_for ? 1 : a.title.localeCompare(b.title)
    if (!b.scheduled_for) return -1
    return Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for)
  })
}

/** Where a platform hides the rest of a caption behind "See more". */
export const CAPTION_FOLD: Record<SocialPost['platform'], number> = { facebook: 125, tiktok: 100, instagram: 125 }

export function captionWithTags(post: Pick<SocialPost, 'caption' | 'hashtags'>): string {
  const tags = post.hashtags.map((h) => `#${h}`).join(' ')
  return tags ? `${post.caption.trimEnd()}\n\n${tags}` : post.caption
}
