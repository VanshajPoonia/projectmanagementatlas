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
  created_at: string
  updated_at: string
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

/**
 * True when the post changed after its latest decision, or after it was first uploaded if nobody
 * has decided yet. Deciding sets updated_at to the review's own time (138's trigger), so a fresh
 * approval clears it. Comments are not decisions and leave it alone. A posted post is done and never asks again.
 */
export function isUpdatedForReview(post: Pick<SocialPost, 'id' | 'status' | 'created_at' | 'updated_at'>, reviews: SocialReview[]): boolean {
  if (post.status === 'posted') return false
  let since = post.created_at
  for (const r of reviews) {
    if (r.post_id === post.id && r.decision !== 'comment' && Date.parse(r.created_at) > Date.parse(since)) since = r.created_at
  }
  return Date.parse(post.updated_at) > Date.parse(since)
}

/** Soonest first; unscheduled posts go last. */
export function sortForReview(posts: SocialPost[]): SocialPost[] {
  return [...posts].sort((a, b) => {
    if (!a.scheduled_for) return b.scheduled_for ? 1 : a.title.localeCompare(b.title)
    if (!b.scheduled_for) return -1
    return Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for)
  })
}

/**
 * Images a reviewer attaches, e.g. the photo Bobby wants used instead. They live in the
 * social-media bucket as reviews/<review id>_<n>.<ext>, so the review id ties them to the note
 * without a schema change. The bucket accepts only these types, up to 50 MB (138).
 */
export const REVIEW_IMAGE_DIR = 'reviews'
export const REVIEW_IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }
export const REVIEW_IMAGE_MAX_BYTES = 52428800

export function reviewImageProblem(file: { type: string; size: number }): string | null {
  if (!REVIEW_IMAGE_TYPES[file.type]) return 'Use a JPG or PNG image.'
  if (file.size > REVIEW_IMAGE_MAX_BYTES) return 'That image is over 50 MB.'
  return null
}

export function reviewImagePath(reviewId: string, index: number, type: string): string {
  return `${REVIEW_IMAGE_DIR}/${reviewId}_${index}.${REVIEW_IMAGE_TYPES[type]}`
}

/** File names listed from reviews/, grouped by review id and kept in upload order. */
export function groupReviewImages(names: string[]): Record<string, string[]> {
  const out: Record<string, Array<{ n: number; path: string }>> = {}
  for (const name of names) {
    const m = /^([0-9a-f-]{36})_(\d+)\.(jpg|png)$/.exec(name)
    if (!m) continue
    ;(out[m[1]] ??= []).push({ n: Number(m[2]), path: `${REVIEW_IMAGE_DIR}/${name}` })
  }
  return Object.fromEntries(Object.entries(out).map(([id, files]) => [id, files.sort((a, b) => a.n - b.n).map((f) => f.path)]))
}

/** Where a platform hides the rest of a caption behind "See more". */
export const CAPTION_FOLD: Record<SocialPost['platform'], number> = { facebook: 125, tiktok: 100, instagram: 125 }

export function captionWithTags(post: Pick<SocialPost, 'caption' | 'hashtags'>): string {
  const tags = post.hashtags.map((h) => `#${h}`).join(' ')
  return tags ? `${post.caption.trimEnd()}\n\n${tags}` : post.caption
}

/** A saved wording of a post's description (139). Newest is the current one once anyone edits. */
export interface CaptionVersion {
  id: string
  post_id: string
  caption: string
  hashtags: string[]
  source: 'uploaded' | 'edited' | 'restored'
  restored_from: string | null
  edited_by: string | null
  created_at: string
}

/** Mirrors the caption CHECK on social_posts (138). */
export const CAPTION_MAX = 5000

/** "#stlouis, realtor #stlouis" -> ["stlouis", "realtor"]. Same cleaning as Postroom's cleanTag. */
export function parseHashtags(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(/[\s,]+/)) {
    const tag = raw.replace(/^#+/, '')
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(tag)
  }
  return out
}

export function formatHashtags(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(' ')
}

export function sameDescription(a: Pick<SocialPost, 'caption' | 'hashtags'>, b: Pick<SocialPost, 'caption' | 'hashtags'>): boolean {
  return a.caption === b.caption && a.hashtags.length === b.hashtags.length && a.hashtags.every((t, i) => t === b.hashtags[i])
}

/** Mirrors save_social_caption (139): not blank, within the column's limit, and actually changed. */
export function canSaveCaption(current: Pick<SocialPost, 'caption' | 'hashtags'>, next: Pick<SocialPost, 'caption' | 'hashtags'>): boolean {
  return !isBlank(next.caption) && next.caption.length <= CAPTION_MAX && !sameDescription(current, next)
}

/** Microseconds since the epoch. Date.parse stops at milliseconds, and one save writes two rows within one. */
export function instantMicros(iso: string): number {
  const frac = /\.(\d+)/.exec(iso)?.[1] ?? ''
  return Date.parse(iso.replace(/\.\d+/, '')) * 1000 + Number((frac + '000000').slice(0, 6))
}

/** Newest first, in the order the database wrote them. */
export function sortVersions(versions: CaptionVersion[]): CaptionVersion[] {
  return [...versions].sort((a, b) => instantMicros(b.created_at) - instantMicros(a.created_at) || b.id.localeCompare(a.id))
}

export function versionLabel(v: CaptionVersion, people: Record<string, string>): string {
  if (v.source === 'uploaded') return 'As uploaded'
  const who = (v.edited_by && people[v.edited_by]) || 'Someone'
  return v.source === 'restored' ? `${who} restored an earlier version` : `${who} edited`
}

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string }

/**
 * Word-level diff from `before` to `after`, keeping spaces and line breaks attached so the result
 * reads as text. Plain LCS: a caption is at most 5000 characters, so the table stays small.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(/\s+|[^\s]+/g) ?? []
  const b = after.match(/\s+|[^\s]+/g) ?? []
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('removed', a[i++])
    } else {
      push('added', b[j++])
    }
  }
  while (i < a.length) push('removed', a[i++])
  while (j < b.length) push('added', b[j++])
  return out
}
