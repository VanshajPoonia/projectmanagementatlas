'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, GitCompare, History, ImagePlus, MessageSquare, Pencil, PencilLine, RotateCcw, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/shell/app-shell'
import { buildWorkspaceNav } from '@/components/shell/workspace-nav'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import { ThemeControls } from '@/components/theme/theme-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { useAppModules } from '@/lib/modules'
import type { ShellData } from '@/lib/shell-data'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { cn } from '@/lib/utils'
import {
  CAPTION_FOLD,
  CAPTION_MAX,
  DECISION_LABEL,
  REVIEW_IMAGE_DIR,
  REVIEW_IMAGE_TYPES,
  STATUS_LABEL,
  canSaveCaption,
  canSubmitReview,
  captionWithTags,
  countByStatus,
  formatHashtags,
  groupReviewImages,
  isBlank,
  isUpdatedForReview,
  parseHashtags,
  reviewImagePath,
  reviewImageProblem,
  sameDescription,
  sortForReview,
  sortVersions,
  versionLabel,
  wordDiff,
  type CaptionVersion,
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
  initialVersions: CaptionVersion[]
  versionsError: string | null
  people: Record<string, string>
  shell?: ShellData | null
}

type Description = Pick<SocialPost, 'caption' | 'hashtags'>

function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function SocialView({ user, initialPosts, initialReviews, initialVersions, versionsError, people, shell }: SocialViewProps) {
  const role = (user.role ?? 'user') as 'user' | 'admin' | 'super_admin'
  const isAdmin = role === 'admin' || role === 'super_admin'
  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)
  const [posts, setPosts] = useState(initialPosts)
  const [reviews, setReviews] = useState(initialReviews)
  const [versions, setVersions] = useState(initialVersions)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [reviewImages, setReviewImages] = useState<Record<string, string[]>>({})
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

  // The bucket is private, so every file on the page is shown through a signed URL.
  const signPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return
    const { data, error } = await createClient().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
    if (error) {
      toast.error('Could not load the post images', { description: error.message })
      return
    }
    const signed = (data ?? []).filter((d: { path: string | null }) => d.path) as Array<{ path: string; signedUrl: string }>
    setUrls((prev) => ({ ...prev, ...Object.fromEntries(signed.map((d) => [d.path, d.signedUrl])) }))
  }, [])

  useEffect(() => {
    if (versionsError) toast.error('Could not load the description history', { description: versionsError })
  }, [versionsError])

  useEffect(() => {
    void signPaths([...new Set(initialPosts.flatMap((p) => p.media.flatMap((m) => [m.path, m.poster].filter(Boolean) as string[])))])
  }, [initialPosts, signPaths])

  // Images reviewers attached. Listed in pages because Storage caps a listing at 1000 names.
  useEffect(() => {
    let active = true
    const load = async () => {
      const storage = createClient().storage.from(BUCKET)
      const names: string[] = []
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await storage.list(REVIEW_IMAGE_DIR, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
        if (error) {
          toast.error('Could not load the images attached to reviews', { description: error.message })
          return
        }
        names.push(...(data ?? []).map((f: { name: string }) => f.name))
        if ((data ?? []).length < 1000) break
      }
      if (!active) return
      const known = new Set(initialReviews.map((r) => r.id))
      const grouped = Object.fromEntries(Object.entries(groupReviewImages(names)).filter(([id]) => known.has(id)))
      setReviewImages((prev) => ({ ...grouped, ...prev }))
      await signPaths(Object.values(grouped).flat())
    }
    void load()
    return () => {
      active = false
    }
  }, [initialReviews, signPaths])

  const brands = useMemo(() => [...new Set(posts.map((p) => p.brand))].sort(), [posts])
  const counts = countByStatus(posts)
  const updatedIds = useMemo(() => new Set(posts.filter((p) => isUpdatedForReview(p, reviews)).map((p) => p.id)), [posts, reviews])
  const visible = sortForReview(posts).filter(
    (p) =>
      (filter === 'all' || (filter === 'updated' ? updatedIds.has(p.id) : p.status === filter)) &&
      (platform === 'all' || p.platform === platform) &&
      (brand === 'all' || p.brand === brand),
  )

  const submit = async (post: SocialPost, decision: ReviewDecision, note: string, images: File[]): Promise<boolean> => {
    const supabase = createClient()
    const storage = supabase.storage.from(BUCKET)
    // The id is chosen here so the images can be named after the review before it exists.
    const id = crypto.randomUUID()
    const paths: string[] = []
    for (const [i, file] of images.entries()) {
      const path = reviewImagePath(id, i + 1, file.type)
      const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false })
      if (error) {
        if (paths.length) await storage.remove(paths)
        toast.error('The image did not upload', { description: error.message })
        return false
      }
      paths.push(path)
    }
    const { data, error } = await supabase
      .from('social_post_reviews')
      .insert({ id, post_id: post.id, reviewer_id: user.id, decision, note: note.trim() || null })
      .select('*')
    if (error || !data?.length) {
      // Images with no review pointing at them would only use up the storage budget.
      if (paths.length) await storage.remove(paths)
      toast.error('That was not saved', { description: error?.message ?? 'Reload the page and try again.' })
      return false
    }
    if (paths.length) {
      setReviewImages((prev) => ({ ...prev, [id]: paths }))
      void signPaths(paths)
    }
    setReviews((prev) => [...prev, data[0] as SocialReview])
    if (decision !== 'comment') setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status: decision } : p)))
    toast.success(decision === 'comment' ? 'Comment added' : STATUS_LABEL[decision as SocialStatus])
    return true
  }

  // Through edit_social_post_caption (139), so a save and its history row land together. The
  // expected wording is what this page last saw; if the post changed since, the save is refused.
  const saveCaption = async (post: SocialPost, next: Description, restoredFrom: string | null = null): Promise<boolean> => {
    const { data, error } = await createClient().rpc('edit_social_post_caption', {
      p_post_id: post.id,
      p_caption: next.caption,
      p_hashtags: next.hashtags,
      p_expected_caption: post.caption,
      p_expected_hashtags: post.hashtags,
      p_restored_from: restoredFrom,
    })
    if (error) {
      toast.error('The description was not saved', { description: error.message })
      return false
    }
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, caption: next.caption, hashtags: next.hashtags } : p)))
    setVersions((prev) => [...prev, ...((data ?? []) as CaptionVersion[])])
    toast.success(restoredFrom ? 'Earlier version restored' : 'Description saved', {
      description: 'The wording it replaced is kept under History.',
    })
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
            click through like the apps. Want a different photo? Use Upload image on the post and attach the one you want. Want
            different wording? Use Edit description. Every earlier version stays under History, where you can compare or restore it.
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
                versions={versions.filter((v) => v.post_id === post.id)}
                reviewImages={reviewImages}
                updated={updatedIds.has(post.id)}
                people={people}
                onReview={submit}
                onSaveCaption={saveCaption}
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
  versions,
  reviewImages,
  updated,
  people,
  onReview,
  onSaveCaption,
}: {
  post: SocialPost
  urls: Record<string, string>
  reviews: SocialReview[]
  versions: CaptionVersion[]
  reviewImages: Record<string, string[]>
  updated: boolean
  people: Record<string, string>
  onReview: (post: SocialPost, decision: ReviewDecision, note: string, images: File[]) => Promise<boolean>
  onSaveCaption: (post: SocialPost, next: Description, restoredFrom?: string | null) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [mode, setMode] = useState<ReviewDecision | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const fold = CAPTION_FOLD[post.platform]
  const cut = post.caption.length > fold
  const tags = post.hashtags.map((h) => `#${h}`).join(' ')

  useEffect(() => {
    const next = images.map((f) => URL.createObjectURL(f))
    setPreviews(next)
    return () => next.forEach((u) => URL.revokeObjectURL(u))
  }, [images])

  const pickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])]
    e.target.value = ''
    const ok = picked.filter((f) => {
      const problem = reviewImageProblem(f)
      if (problem) toast.error(`${f.name} was not added`, { description: problem })
      return !problem
    })
    if (!ok.length) return
    setImages((prev) => [...prev, ...ok])
    // Attaching a photo is a change request unless they already chose to comment.
    if (mode !== 'comment') setMode('changes_requested')
    if (isBlank(note)) setNote(ok.length + images.length > 1 ? 'Use these images instead.' : 'Use this image instead.')
  }

  const reset = () => {
    setMode(null)
    setNote('')
    setImages([])
  }

  const send = async (decision: ReviewDecision) => {
    setBusy(true)
    const ok = await onReview(post, decision, note, images)
    setBusy(false)
    if (ok) reset()
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
        {editing ? (
          <DescriptionEditor
            post={post}
            onCancel={() => setEditing(false)}
            onSave={async (next) => {
              const ok = await onSaveCaption(post, next)
              if (ok) setEditing(false)
            }}
          />
        ) : (
          <>
            <p className="whitespace-pre-wrap">
              {cut && !open ? post.caption.slice(0, fold).trimEnd() : post.caption}
              {cut && (
                <button type="button" onClick={() => setOpen((v) => !v)} className="text-muted-foreground ml-1 underline-offset-2 hover:underline">
                  {open ? 'See less' : '... See more'}
                </button>
              )}
            </p>
            {tags && <p className="text-sky-700 dark:text-sky-400">{tags}</p>}
            <div className="-ml-2 flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={post.status === 'posted'}
                title={post.status === 'posted' ? 'Already posted. Change it on Facebook or TikTok.' : undefined}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Edit description
              </Button>
              {versions.length > 0 && (
                <Button size="sm" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
                  <History className="size-4" aria-hidden="true" />
                  History
                  <span className="tabular-nums opacity-70">{versions.length}</span>
                </Button>
              )}
            </div>
            {showHistory && versions.length > 0 && (
              <DescriptionHistory
                post={post}
                versions={versions}
                people={people}
                onRestore={(v) => onSaveCaption(post, { caption: v.caption, hashtags: v.hashtags }, v.id)}
              />
            )}
          </>
        )}
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
              {(reviewImages[r.id] ?? []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {reviewImages[r.id].map((path, i) =>
                    urls[path] ? (
                      <a
                        key={path}
                        href={urls[path]}
                        target="_blank"
                        rel="noreferrer"
                        className="block size-20 overflow-hidden rounded-md border"
                        aria-label={`Open attached image ${i + 1} full size`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={urls[path]} alt="" className="size-full object-cover" />
                      </a>
                    ) : (
                      <span key={path} className="bg-muted block size-20 rounded-md" />
                    ),
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-2 border-t px-4 py-3">
        <input
          ref={fileInput}
          type="file"
          accept={Object.keys(REVIEW_IMAGE_TYPES).join(',')}
          multiple
          className="hidden"
          onChange={pickImages}
          data-testid="review-image-input"
        />
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
            {previews.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Images to attach">
                {previews.map((src, i) => (
                  <li key={src} className="relative size-20 overflow-hidden rounded-md border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, n) => n !== i))}
                      disabled={busy}
                      className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 text-white hover:bg-black"
                      aria-label={`Remove image ${i + 1}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || !canSubmitReview(mode, note)} onClick={() => void send(mode)}>
                {busy && images.length > 0
                  ? 'Uploading...'
                  : mode === 'changes_requested'
                    ? 'Send changes'
                    : mode === 'rejected'
                      ? 'Reject post'
                      : 'Add comment'}
              </Button>
              {mode !== 'rejected' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                  <ImagePlus className="size-4" aria-hidden="true" />
                  {images.length ? 'Add another' : 'Attach image'}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
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
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()}>
              <ImagePlus className="size-4" aria-hidden="true" />
              Upload image
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

function DescriptionEditor({ post, onSave, onCancel }: { post: SocialPost; onSave: (next: Description) => Promise<void>; onCancel: () => void }) {
  const [caption, setCaption] = useState(post.caption)
  const [tagText, setTagText] = useState(formatHashtags(post.hashtags))
  const [busy, setBusy] = useState(false)
  const next = { caption, hashtags: parseHashtags(tagText) }
  const fold = CAPTION_FOLD[post.platform]

  const save = async () => {
    setBusy(true)
    await onSave(next)
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={CAPTION_MAX} rows={8} autoFocus aria-label="Description" />
      <p className="text-muted-foreground text-xs">
        {caption.length > fold ? `The first ${fold} characters show before "See more".` : 'All of it shows before "See more".'}{' '}
        <span className="tabular-nums">
          {caption.length}/{CAPTION_MAX}
        </span>
      </p>
      <Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="#stlouis #realtor" aria-label="Hashtags" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !canSaveCaption(post, next)} onClick={() => void save()}>
          {busy ? 'Saving...' : 'Save description'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">The current wording is kept under History, so you can always go back to it.</p>
    </div>
  )
}

function DescriptionHistory({
  post,
  versions,
  people,
  onRestore,
}: {
  post: SocialPost
  versions: CaptionVersion[]
  people: Record<string, string>
  onRestore: (version: CaptionVersion) => Promise<boolean>
}) {
  const [comparing, setComparing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const sorted = sortVersions(versions)
  // The newest version matching what is on the post. None matches after a re-upload changed it.
  const currentId = sorted.find((v) => sameDescription(v, post))?.id ?? null
  const now = captionWithTags(post)

  const restore = async (v: CaptionVersion) => {
    setBusy(v.id)
    const ok = await onRestore(v)
    setBusy(null)
    if (ok) setComparing(null)
  }

  return (
    <section aria-label="Description history" className="bg-muted/40 space-y-2 rounded-lg border p-3">
      {!currentId && (
        <p className="text-muted-foreground text-xs">The wording on the post now came from an upload. It joins this list the next time someone edits.</p>
      )}
      <ol className="space-y-2">
        {sorted.map((v) => {
          const isCurrent = v.id === currentId
          return (
            <li key={v.id} className="bg-background rounded-md border p-2" data-testid="caption-version">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="text-xs">
                  <span className="font-medium">{versionLabel(v, people)}</span>
                  {v.source !== 'uploaded' && <span className="text-muted-foreground"> · {stamp(v.created_at)}</span>}
                  {isCurrent && (
                    <Badge variant="secondary" className="ml-1.5">
                      Current
                    </Badge>
                  )}
                </p>
                {!isCurrent && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-pressed={comparing === v.id} onClick={() => setComparing((c) => (c === v.id ? null : v.id))}>
                      <GitCompare className="size-4" aria-hidden="true" />
                      Compare
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null || post.status === 'posted'} onClick={() => void restore(v)}>
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {busy === v.id ? 'Restoring...' : 'Restore'}
                    </Button>
                  </div>
                )}
              </div>
              {comparing === v.id ? (
                <div className="mt-1 space-y-1">
                  <p className="text-muted-foreground text-xs">Red is only in this version. Green is only in the current one.</p>
                  <p className="text-xs whitespace-pre-wrap">
                    {wordDiff(captionWithTags(v), now).map((part, i) =>
                      part.kind === 'same' ? (
                        <span key={i}>{part.text}</span>
                      ) : part.kind === 'removed' ? (
                        <del key={i} className="rounded-sm bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100">
                          {part.text}
                        </del>
                      ) : (
                        <ins key={i} className="rounded-sm bg-emerald-100 text-emerald-900 no-underline dark:bg-emerald-900/40 dark:text-emerald-100">
                          {part.text}
                        </ins>
                      ),
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground mt-1 line-clamp-3 text-xs whitespace-pre-wrap">{captionWithTags(v)}</p>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
