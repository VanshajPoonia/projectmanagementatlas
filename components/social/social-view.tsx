'use client'

import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, MessageSquare, PencilLine, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/shell/app-shell'
import { buildWorkspaceNav } from '@/components/shell/workspace-nav'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import { ThemeControls } from '@/components/theme/theme-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { useAppModules } from '@/lib/modules'
import type { ShellData } from '@/lib/shell-data'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { cn } from '@/lib/utils'
import {
  CAPTION_FOLD,
  DECISION_LABEL,
  STATUS_LABEL,
  canSubmitReview,
  countByStatus,
  isUpdatedForReview,
  sortForReview,
  type ReviewDecision,
  type SocialPost,
  type SocialReview,
  type SocialStatus,
} from '@/lib/social-review'

const BUCKET = 'social-media'
const SIGNED_URL_SECONDS = 60 * 60

const STATUS_TONE: Record<SocialStatus, string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  changes_requested: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
  rejected: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
  posted: 'bg-muted text-muted-foreground',
}

const FILTERS: Array<{ key: 'all' | SocialStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Waiting' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

function whenLabel(iso: string | null): string {
  if (!iso) return 'Not scheduled'
  return (
    new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' CT'
  )
}

interface SocialViewProps {
  user: { id: string; role?: string | null; full_name?: string | null; email?: string | null }
  initialPosts: SocialPost[]
  initialReviews: SocialReview[]
  people: Record<string, string>
  shell?: ShellData | null
}

export default function SocialView({ user, initialPosts, initialReviews, people, shell }: SocialViewProps) {
  const role = (user.role ?? 'user') as 'user' | 'admin' | 'super_admin'
  const isAdmin = role === 'admin' || role === 'super_admin'
  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)
  const [posts, setPosts] = useState(initialPosts)
  const [reviews, setReviews] = useState(initialReviews)
  const [urls, setUrls] = useState<Record<string, string>>({})
  // Land on the posts that changed since Bobby last decided, when there are any.
  const [filter, setFilter] = useState<'all' | 'updated' | SocialStatus>(() =>
    initialPosts.some((p) => isUpdatedForReview(p, initialReviews)) ? 'updated' : 'all',
  )
  const [platform, setPlatform] = useState<'all' | SocialPost['platform']>('all')
  const [brand, setBrand] = useState('all')

  const groups: SidebarNavGroup[] = useMemo(
    () => buildWorkspaceNav({ role, modules, canUseMarketingCalendar: isAdmin || calendars.length > 0 }),
    [role, modules, isAdmin, calendars.length],
  )

  // One batch of signed URLs for every file on the page; the bucket is private.
  useEffect(() => {
    const paths = [...new Set(initialPosts.flatMap((p) => p.media.flatMap((m) => [m.path, m.poster].filter(Boolean) as string[])))]
    if (!paths.length) return
    let active = true
    createClient()
      .storage.from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS)
      .then(({ data, error }: { data: Array<{ path: string | null; signedUrl: string }> | null; error: { message: string } | null }) => {
        if (!active) return
        if (error) {
          toast.error('Could not load the post images', { description: error.message })
          return
        }
        setUrls(Object.fromEntries((data ?? []).filter((d) => d.path).map((d) => [d.path as string, d.signedUrl])))
      })
    return () => {
      active = false
    }
  }, [initialPosts])

  const brands = useMemo(() => [...new Set(posts.map((p) => p.brand))].sort(), [posts])
  const counts = countByStatus(posts)
  const updatedIds = useMemo(() => new Set(posts.filter((p) => isUpdatedForReview(p, reviews)).map((p) => p.id)), [posts, reviews])
  const visible = sortForReview(posts).filter(
    (p) =>
      (filter === 'all' || (filter === 'updated' ? updatedIds.has(p.id) : p.status === filter)) &&
      (platform === 'all' || p.platform === platform) &&
      (brand === 'all' || p.brand === brand),
  )

  const submit = async (post: SocialPost, decision: ReviewDecision, note: string): Promise<boolean> => {
    const { data, error } = await createClient()
      .from('social_post_reviews')
      .insert({ post_id: post.id, reviewer_id: user.id, decision, note: note.trim() || null })
      .select('*')
    if (error || !data?.length) {
      toast.error('That was not saved', { description: error?.message ?? 'Reload the page and try again.' })
      return false
    }
    setReviews((prev) => [...prev, data[0] as SocialReview])
    if (decision !== 'comment') setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status: decision } : p)))
    toast.success(decision === 'comment' ? 'Comment added' : STATUS_LABEL[decision as SocialStatus])
    return true
  }

  return (
    <AppShell
      user={{ id: user.id, role, full_name: user.full_name, email: user.email }}
      groups={groups}
      activeId="social"
      breadcrumbs={[{ label: 'Social media' }]}
      topbarActions={<ThemeControls />}
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Social media</h1>
          <p className="text-muted-foreground text-sm">
            Facebook and TikTok posts before they go out. Approve them, ask for changes or reject them. Videos play and carousels
            click through like the apps.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {(updatedIds.size > 0 || filter === 'updated') && (
            <Button
              size="sm"
              variant={filter === 'updated' ? 'default' : 'outline'}
              onClick={() => setFilter('updated')}
              aria-pressed={filter === 'updated'}
              className={cn(filter !== 'updated' && 'border-amber-400 text-amber-900 dark:text-amber-100')}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Updated for you
              <span className="tabular-nums opacity-70">{updatedIds.size}</span>
            </Button>
          )}
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? 'default' : 'outline'}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{f.key === 'all' ? posts.length : counts[f.key]}</span>
            </Button>
          ))}
          <span className="bg-border mx-1 hidden h-6 w-px sm:block" />
          <select
            aria-label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as typeof platform)}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          >
            <option value="all">All platforms</option>
            <option value="facebook">Facebook</option>
            <option value="tiktok">TikTok</option>
          </select>
          <select
            aria-label="Brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          >
            <option value="all">All brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {visible.length === 0 ? (
          <p className="text-muted-foreground py-16 text-center text-sm">
            {posts.length === 0
              ? 'No posts have been uploaded for review yet.'
              : filter === 'updated' && updatedIds.size === 0
                ? 'All caught up. Every updated post has been reviewed.'
                : 'Nothing matches these filters.'}
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                urls={urls}
                reviews={reviews.filter((r) => r.post_id === post.id)}
                updated={updatedIds.has(post.id)}
                people={people}
                onReview={submit}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function MediaViewer({ post, urls }: { post: SocialPost; urls: Record<string, string> }) {
  const [i, setI] = useState(0)
  const items = post.media
  const tall = post.platform === 'tiktok' || post.format === 'reel' || post.format === 'story'
  const m = items[Math.min(i, items.length - 1)]
  return (
    <div className="bg-black">
      <div className={cn('relative w-full', tall ? 'aspect-[9/16]' : 'aspect-[4/5]')}>
        {!m ? (
          <p className="flex h-full items-center justify-center text-sm text-white/70">No media</p>
        ) : m.kind === 'video' ? (
          <video
            key={m.path}
            src={urls[m.path]}
            poster={m.poster ? urls[m.poster] : undefined}
            controls
            playsInline
            preload="none"
            className="h-full w-full object-contain"
          />
        ) : urls[m.path] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={m.path} src={urls[m.path]} alt="" className="h-full w-full object-contain" />
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-white/70">Loading</p>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-3 py-2 text-sm text-white/80">
          <Button size="icon-sm" variant="secondary" aria-label="Previous slide" onClick={() => setI((n) => (n - 1 + items.length) % items.length)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="tabular-nums">
            {Math.min(i, items.length - 1) + 1} of {items.length}
          </span>
          <Button size="icon-sm" variant="secondary" aria-label="Next slide" onClick={() => setI((n) => (n + 1) % items.length)}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}

function PostCard({
  post,
  urls,
  reviews,
  updated,
  people,
  onReview,
}: {
  post: SocialPost
  urls: Record<string, string>
  reviews: SocialReview[]
  updated: boolean
  people: Record<string, string>
  onReview: (post: SocialPost, decision: ReviewDecision, note: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ReviewDecision | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const fold = CAPTION_FOLD[post.platform]
  const cut = post.caption.length > fold
  const tags = post.hashtags.map((h) => `#${h}`).join(' ')

  const send = async (decision: ReviewDecision) => {
    setBusy(true)
    const ok = await onReview(post, decision, note)
    setBusy(false)
    if (ok) {
      setMode(null)
      setNote('')
    }
  }

  return (
    <article
      className={cn('bg-card flex flex-col overflow-hidden rounded-xl border', updated && 'border-amber-400 ring-2 ring-amber-400')}
      data-testid="social-post"
    >
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{post.title}</p>
          <p className="text-muted-foreground text-xs">
            {post.platform === 'facebook' ? 'Facebook' : post.platform === 'tiktok' ? 'TikTok' : 'Instagram'} {post.format} ·{' '}
            {post.brand}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', STATUS_TONE[post.status])}>
          {STATUS_LABEL[post.status]}
        </span>
      </div>

      {updated && (
        <p className="flex items-center gap-1.5 border-b bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Updated. Ready for your review.
        </p>
      )}

      <MediaViewer post={post} urls={urls} />

      <div className="space-y-2 px-4 py-3 text-sm">
        <p className="text-muted-foreground text-xs">{whenLabel(post.scheduled_for)}</p>
        <p className="whitespace-pre-wrap">
          {cut && !open ? post.caption.slice(0, fold).trimEnd() : post.caption}
          {cut && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-muted-foreground ml-1 underline-offset-2 hover:underline">
              {open ? 'See less' : '... See more'}
            </button>
          )}
        </p>
        {tags && <p className="text-sky-700 dark:text-sky-400">{tags}</p>}
      </div>

      {reviews.length > 0 && (
        <ul className="space-y-2 border-t px-4 py-3 text-sm">
          {reviews.map((r) => (
            <li key={r.id}>
              <span className="font-medium">{(r.reviewer_id && people[r.reviewer_id]) || 'Someone'}</span>{' '}
              <span className="text-muted-foreground">
                {DECISION_LABEL[r.decision]} ·{' '}
                {new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
              {r.note && <p className="mt-0.5 whitespace-pre-wrap">{r.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-2 border-t px-4 py-3">
        {mode && (
          <div className="space-y-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              autoFocus
              placeholder={
                mode === 'changes_requested'
                  ? 'What should change? e.g. use a different first photo, shorter caption'
                  : mode === 'rejected'
                    ? 'Why is this one not going out?'
                    : 'Add a comment'
              }
              aria-label="Note"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !canSubmitReview(mode, note)} onClick={() => void send(mode)}>
                {mode === 'changes_requested' ? 'Send changes' : mode === 'rejected' ? 'Reject post' : 'Add comment'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {!mode && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || post.status === 'approved'} onClick={() => void send('approved')}>
              <Check className="size-4" aria-hidden="true" />
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('changes_requested')}>
              <PencilLine className="size-4" aria-hidden="true" />
              Request changes
            </Button>
            <Button size="sm" variant="outline" disabled={busy || post.status === 'rejected'} onClick={() => setMode('rejected')}>
              <X className="size-4" aria-hidden="true" />
              Reject
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode('comment')}>
              <MessageSquare className="size-4" aria-hidden="true" />
              Comment
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}
