'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Bell,
  BellOff,
  Check,
  Clock,
  Eye,
  EyeOff,
  Inbox as InboxIcon,
  MoreHorizontal,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/shell/app-shell'
import { EmptyState, ErrorState } from '@/components/shell/states'
import { boardHref, buildWorkspaceNav } from '@/components/shell/workspace-nav'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import { buildCreateCommands, type Command } from '@/components/shell/commands'
import { ThemeControls } from '@/components/theme/theme-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { allows } from '@/lib/capabilities'
import { useAppModules } from '@/lib/modules'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { useNow } from '@/lib/use-now'
import { createClient } from '@/lib/supabase/client'
import { notifyInboxChanged } from '@/lib/notification-events'
import { cn } from '@/lib/utils'
import type { ShellData } from '@/lib/shell-data'
import { didWrite, writeFailureMessage, type WriteOutcome } from '@/lib/rls-write'
import {
  BUCKET_COPY,
  SNOOZE_OPTIONS,
  filterInbox,
  groupNotificationBursts,
  inboxCounts,
  notificationHref,
  notificationTypeLabel,
  snoozeUntil,
  type InboxEntry,
  type InboxNotification,
  type InboxScope,
  type NotificationCategory,
} from '@/lib/notifications'
import type { SubscriptionRef } from '@/lib/notifications-data'
import {
  markNotificationsRead,
  markNotificationsUnread,
  setBoardMuted,
  setTaskFollowState,
  snoozeNotifications,
} from '@/lib/notifications-data'

interface InboxViewProps {
  user: any
  initialNotifications: InboxNotification[]
  initialMutedTaskIds: string[]
  initialMutedBoardIds: string[]
  initialFollowingTaskIds: string[]
  /**
   * What this person has muted or followed, NAMED. Listed directly in the Muted view so a mute
   * on something with no notifications yet is still undoable - otherwise muting a quiet project
   * is a one-way door, since there is nothing left to open a menu on.
   */
  initialMutedBoards?: SubscriptionRef[]
  initialMutedTasks?: SubscriptionRef[]
  initialFollowedTasks?: SubscriptionRef[]
  /**
   * True when a query failed. Without it an empty list is indistinguishable from a genuinely
   * clear inbox, and the screen cheerfully congratulates someone whose notifications are down.
   */
  loadFailed?: boolean
  shell?: ShellData
  /** The instant the SERVER rendered at, ISO. See lib/use-now.ts. */
  now: string
}

const SCOPES: ReadonlyArray<{ id: InboxScope; label: string; description: string }> = [
  { id: 'inbox', label: 'Inbox', description: 'Everything addressed to you that you have not put aside.' },
  { id: 'snoozed', label: 'Snoozed', description: 'Put aside until later. They come back on their own.' },
  { id: 'muted', label: 'Muted', description: 'Work you asked not to hear about. Nothing was deleted - unmute and it is all still here.' },
]

/**
 * The Inbox.
 *
 * Two buckets and no more, which is the plan's "avoid overclassification" taken literally: the
 * only split that changes behaviour is "does this need me, or is it telling me something".
 * Every other axis people reach for - by project, by type, by sender - is a filter, and a
 * filter belongs on a list rather than in the shape of the list.
 *
 * Snoozed and Muted are their own scopes rather than being simply hidden, because a control
 * that makes something vanish with no way to find it again is one people stop using: they
 * cannot tell it apart from having lost the thing.
 */
export default function InboxView({
  user,
  initialNotifications,
  initialMutedTaskIds,
  initialMutedBoardIds,
  initialFollowingTaskIds,
  initialMutedBoards = [],
  initialMutedTasks = [],
  initialFollowedTasks = [],
  loadFailed = false,
  shell,
  now: serverNow,
}: InboxViewProps) {
  const now = useNow(serverNow)
  const supabase = useMemo(() => createClient(), [])
  const role = user?.role ?? 'user'
  const isAdmin = role === 'admin' || role === 'super_admin'

  const [notifications, setNotifications] = useState(initialNotifications)
  const [mutedTaskIds, setMutedTaskIds] = useState(() => new Set(initialMutedTaskIds))
  const [mutedBoardIds, setMutedBoardIds] = useState(() => new Set(initialMutedBoardIds))
  const [followingTaskIds, setFollowingTaskIds] = useState(() => new Set(initialFollowingTaskIds))
  // Named subscription lists, kept alongside the id sets so an unmute can remove the row from
  // the list it is rendered in without a refetch.
  const [mutedBoardRefs, setMutedBoardRefs] = useState(initialMutedBoards)
  const [mutedTaskRefs, setMutedTaskRefs] = useState(initialMutedTasks)
  const [followedTaskRefs, setFollowedTaskRefs] = useState(initialFollowedTasks)
  const [scope, setScope] = useState<InboxScope>('inbox')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [busy, setBusy] = useState(false)

  const mutes = useMemo(() => ({ mutedTaskIds, mutedBoardIds }), [mutedTaskIds, mutedBoardIds])
  const counts = useMemo(() => inboxCounts(notifications, mutes, now), [notifications, mutes, now])

  // Board hrefs are built from the viewer's PLATFORM ROLE, never from a surface flag: the two
  // board routes are not interchangeable, and /dashboard/board/<id> silently strips an
  // admin's controls. See components/shell/workspace-nav.ts.
  const favoriteBoardHref = useCallback((boardId: string) => boardHref(role, boardId), [role])
  const { resolved: favoriteItems } = useFavorites(user?.id, { boardHref: favoriteBoardHref })

  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)

  const groups: SidebarNavGroup[] = useMemo(
    () =>
      buildWorkspaceNav({
        role,
        modules,
        canUseMarketingCalendar: isAdmin || calendars.length > 0,
        canViewAudit: allows({ userId: user?.id ?? '', platformRole: role }, 'audit.view'),
      }),
    [role, user?.id, modules, isAdmin, calendars.length],
  )

  const commands: Command[] = useMemo(() => buildCreateCommands({ role, modules }), [role, modules])

  /** Apply a patch to some notifications locally, so the list does not have to be refetched. */
  const patchLocal = useCallback((ids: string[], patch: Partial<InboxNotification>) => {
    const set = new Set(ids)
    setNotifications((prev) => prev.map((n) => (set.has(n.id) ? { ...n, ...patch } : n)))
  }, [])

  /**
   * Run a write, and undo the optimistic state if the database disagreed.
   *
   * ⚠️ An RLS refusal comes back as zero rows and NO error, so `if (error)` alone would report
   * a refusal as a success and leave the screen showing a change that is not in the database.
   * Every write here counts its returned rows (lib/rls-write.ts).
   */
  const runWrite = useCallback(
    async (subject: string, write: () => Promise<WriteOutcome>, rollback: () => void) => {
      setBusy(true)
      try {
        const outcome = await write()
        if (!didWrite(outcome)) {
          rollback()
          const message = writeFailureMessage(outcome, subject)
          if (message) toast.error(message.title, { description: message.description })
          return false
        }
        // Tell the topbar badge. Every write here can change the unread count, and a badge
        // that still says 3 over an empty inbox is one nobody trusts again.
        notifyInboxChanged()
        return true
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const markRead = useCallback(
    async (ids: string[]) => {
      const before = notifications.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, read_at: n.read_at }))
      patchLocal(ids, { read_at: now.toISOString() })
      await runWrite('change', () => markNotificationsRead(supabase, ids, now), () => {
        setNotifications((prev) => prev.map((n) => {
          const prior = before.find((b) => b.id === n.id)
          return prior ? { ...n, read_at: prior.read_at } : n
        }))
      })
    },
    [notifications, now, patchLocal, runWrite, supabase],
  )

  const markUnread = useCallback(
    async (ids: string[]) => {
      const before = notifications.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, read_at: n.read_at, snoozed_until: n.snoozed_until }))
      patchLocal(ids, { read_at: null, snoozed_until: null })
      await runWrite('change', () => markNotificationsUnread(supabase, ids), () => {
        setNotifications((prev) => prev.map((n) => {
          const prior = before.find((b) => b.id === n.id)
          return prior ? { ...n, ...prior } : n
        }))
      })
    },
    [notifications, patchLocal, runWrite, supabase],
  )

  const snooze = useCallback(
    async (ids: string[], minutes: number | null) => {
      const before = notifications.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, snoozed_until: n.snoozed_until }))
      const until = minutes === null ? null : snoozeUntil(minutes, now)
      patchLocal(ids, { snoozed_until: until })
      const ok = await runWrite('snooze', () => snoozeNotifications(supabase, ids, until), () => {
        setNotifications((prev) => prev.map((n) => {
          const prior = before.find((b) => b.id === n.id)
          return prior ? { ...n, snoozed_until: prior.snoozed_until } : n
        }))
      })
      if (ok && minutes !== null) {
        const option = SNOOZE_OPTIONS.find((o) => o.minutes === minutes)
        toast.success('Snoozed', {
          description: `Hidden ${option ? option.label.toLowerCase() : 'for now'}. You can find it under Snoozed.`,
        })
      }
    },
    [notifications, now, patchLocal, runWrite, supabase],
  )

  const setFollow = useCallback(
    async (taskId: string, state: 'following' | 'muted' | null) => {
      const wasFollowing = followingTaskIds.has(taskId)
      const wasMuted = mutedTaskIds.has(taskId)

      setFollowingTaskIds((prev) => {
        const next = new Set(prev)
        if (state === 'following') next.add(taskId)
        else next.delete(taskId)
        return next
      })
      setMutedTaskIds((prev) => {
        const next = new Set(prev)
        if (state === 'muted') next.add(taskId)
        else next.delete(taskId)
        return next
      })
      const title = mutedTaskRefs.find((r) => r.id === taskId)?.title
        ?? followedTaskRefs.find((r) => r.id === taskId)?.title
        ?? notifications.find((n) => n.task_id === taskId)?.taskTitle
        ?? null
      setMutedTaskRefs((prev) =>
        state === 'muted'
          ? prev.some((r) => r.id === taskId) ? prev : [...prev, { id: taskId, title }]
          : prev.filter((r) => r.id !== taskId),
      )
      setFollowedTaskRefs((prev) =>
        state === 'following'
          ? prev.some((r) => r.id === taskId) ? prev : [...prev, { id: taskId, title }]
          : prev.filter((r) => r.id !== taskId),
      )

      await runWrite('change', () => setTaskFollowState(supabase, taskId, user?.id, state, now), () => {
        setFollowingTaskIds((prev) => {
          const next = new Set(prev)
          if (wasFollowing) next.add(taskId); else next.delete(taskId)
          return next
        })
        setMutedTaskIds((prev) => {
          const next = new Set(prev)
          if (wasMuted) next.add(taskId); else next.delete(taskId)
          return next
        })
      })
    },
    [followingTaskIds, mutedTaskIds, mutedTaskRefs, followedTaskRefs, notifications, now, runWrite, supabase, user?.id],
  )

  const setBoardMute = useCallback(
    async (boardId: string, muted: boolean) => {
      const was = mutedBoardIds.has(boardId)
      setMutedBoardIds((prev) => {
        const next = new Set(prev)
        if (muted) next.add(boardId); else next.delete(boardId)
        return next
      })
      const boardTitle = mutedBoardRefs.find((r) => r.id === boardId)?.title
        ?? notifications.find((n) => n.boardId === boardId)?.boardTitle
        ?? null
      setMutedBoardRefs((prev) =>
        muted
          ? prev.some((r) => r.id === boardId) ? prev : [...prev, { id: boardId, title: boardTitle }]
          : prev.filter((r) => r.id !== boardId),
      )
      await runWrite('change', () => setBoardMuted(supabase, boardId, user?.id, muted), () => {
        setMutedBoardIds((prev) => {
          const next = new Set(prev)
          if (was) next.add(boardId); else next.delete(boardId)
          return next
        })
      })
    },
    [mutedBoardIds, mutedBoardRefs, notifications, runWrite, supabase, user?.id],
  )

  const entriesFor = useCallback(
    (bucket: NotificationCategory | 'all') =>
      groupNotificationBursts(
        filterInbox(notifications, mutes, now, { scope, bucket, read: unreadOnly ? 'unread' : 'all' }),
      ),
    [notifications, mutes, now, scope, unreadOnly],
  )

  const actionEntries = useMemo(() => entriesFor('action_required'), [entriesFor])
  const updateEntries = useMemo(() => entriesFor('update'), [entriesFor])
  const otherScopeEntries = useMemo(() => entriesFor('all'), [entriesFor])

  const visibleUnreadIds = useMemo(
    () => [...actionEntries, ...updateEntries].filter((e) => e.unread).flatMap((e) => e.ids),
    [actionEntries, updateEntries],
  )

  const scopeCopy = SCOPES.find((s) => s.id === scope)!

  return (
    <AppShell
      user={{ id: user?.id, role, full_name: user?.full_name, email: user?.email }}
      groups={groups}
      activeId="inbox"
      breadcrumbs={[{ label: 'Inbox' }]}
      favorites={favoriteItems}
      commands={commands}
      topbarActions={<ThemeControls />}
    >
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-muted-foreground text-sm">
            Everything addressed to you, split by whether it needs you to do something.
          </p>
        </header>

        {loadFailed ? (
          <ErrorState
            title="Your inbox could not be loaded"
            description="Nothing is wrong with your notifications - this page failed to read them. Reload to try again; if it keeps failing, tell an admin."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="Inbox view" className="bg-muted flex rounded-lg p-1">
                {SCOPES.map((entry) => (
                  <button
                    key={entry.id}
                    role="tab"
                    aria-selected={scope === entry.id}
                    id={`inbox-scope-${entry.id}`}
                    onClick={() => setScope(entry.id)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      scope === entry.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {entry.label}
                    {entry.id === 'inbox' && counts.unread > 0 && (
                      <Badge variant="secondary" className="ml-2 tabular-nums">{counts.unread}</Badge>
                    )}
                    {entry.id === 'snoozed' && counts.snoozed > 0 && (
                      <Badge variant="secondary" className="ml-2 tabular-nums">{counts.snoozed}</Badge>
                    )}
                    {entry.id === 'muted' && counts.muted > 0 && (
                      <Badge variant="secondary" className="ml-2 tabular-nums">{counts.muted}</Badge>
                    )}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  id="inbox-unread-toggle"
                  aria-pressed={unreadOnly}
                  onClick={() => setUnreadOnly((v) => !v)}
                >
                  {unreadOnly ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  {unreadOnly ? 'Showing unread' : 'Show unread only'}
                </Button>
                {scope === 'inbox' && (
                  <Button
                    variant="outline"
                    size="sm"
                    id="inbox-mark-all-read"
                    disabled={busy || visibleUnreadIds.length === 0}
                    onClick={() => markRead(visibleUnreadIds)}
                  >
                    <Check className="size-4" />
                    Mark all read
                  </Button>
                )}
              </div>
            </div>

            <p className="text-muted-foreground text-xs">{scopeCopy.description}</p>

            {scope === 'inbox' ? (
              <>
                <Bucket
                  bucket="action_required"
                  entries={actionEntries}
                  role={role}
                  now={now}
                  busy={busy}
                  following={followingTaskIds}
                  mutedTasks={mutedTaskIds}
                  mutedBoards={mutedBoardIds}
                  onMarkRead={markRead}
                  onMarkUnread={markUnread}
                  onSnooze={snooze}
                  onSetFollow={setFollow}
                  onSetBoardMute={setBoardMute}
                />
                <Bucket
                  bucket="update"
                  entries={updateEntries}
                  role={role}
                  now={now}
                  busy={busy}
                  following={followingTaskIds}
                  mutedTasks={mutedTaskIds}
                  mutedBoards={mutedBoardIds}
                  onMarkRead={markRead}
                  onMarkUnread={markUnread}
                  onSnooze={snooze}
                  onSetFollow={setFollow}
                  onSetBoardMute={setBoardMute}
                />
              </>
            ) : (
              <>
                {scope === 'muted' && (
                  <Card data-section="inbox-subscriptions">
                    <CardHeader>
                      <CardTitle className="text-base">What you have muted and followed</CardTitle>
                      {/* Listed from the mute tables themselves, not from the notifications
                          below. Muting a project with no notifications yet would otherwise be a
                          one-way door: nothing left on screen to open a menu on. */}
                      <CardDescription>
                        Straight from your own settings, whether or not anything has come through
                        since. Nothing here was deleted - unmute and the history comes back.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <SubscriptionList
                        title="Muted projects"
                        empty="No projects muted."
                        items={mutedBoardRefs}
                        actionLabel="Unmute"
                        busy={busy}
                        idPrefix="unmute-board"
                        onAction={(id) => setBoardMute(id, false)}
                      />
                      <SubscriptionList
                        title="Muted work items"
                        empty="No work items muted."
                        items={mutedTaskRefs}
                        actionLabel="Unmute"
                        busy={busy}
                        idPrefix="unmute-task"
                        onAction={(id) => setFollow(id, null)}
                      />
                      <SubscriptionList
                        title="Followed work items"
                        empty="You are not following anything. Open a work item and press Follow to hear about it even when it is not assigned to you."
                        items={followedTaskRefs}
                        actionLabel="Unfollow"
                        busy={busy}
                        idPrefix="unfollow-task"
                        onAction={(id) => setFollow(id, null)}
                      />
                    </CardContent>
                  </Card>
                )}

                <Card data-section={`inbox-${scope}`}>
                <CardHeader>
                  <CardTitle className="text-base">{scopeCopy.label}</CardTitle>
                  <CardDescription>{scopeCopy.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {otherScopeEntries.length === 0 ? (
                    <EmptyState
                      icon={scope === 'muted' ? <BellOff /> : <Clock />}
                      title={scope === 'muted' ? 'Nothing is muted' : 'Nothing is snoozed'}
                      description={
                        scope === 'muted'
                          ? 'Mute a work item or a whole board from any notification’s menu when it stops being yours to watch.'
                          : 'Snooze a notification to hide it for an hour, a day or a week. It comes back on its own.'
                      }
                    />
                  ) : (
                    <ul className="space-y-2">
                      {otherScopeEntries.map((entry) => (
                        <NotificationRow
                          key={entry.latest.id}
                          entry={entry}
                          role={role}
                          now={now}
                          busy={busy}
                          following={followingTaskIds}
                          mutedTasks={mutedTaskIds}
                          mutedBoards={mutedBoardIds}
                          onMarkRead={markRead}
                          onMarkUnread={markUnread}
                          onSnooze={snooze}
                          onSetFollow={setFollow}
                          onSetBoardMute={setBoardMute}
                        />
                      ))}
                    </ul>
                  )}
                </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

/**
 * One list of things this person has an opinion about, each with the button that undoes it.
 *
 * A missing title means the board or work item is no longer readable. The row is still shown -
 * the setting is still theirs and still real - but it says so rather than rendering a blank.
 */
function SubscriptionList({
  title,
  empty,
  items,
  actionLabel,
  idPrefix,
  busy,
  onAction,
}: {
  title: string
  empty: string
  items: SubscriptionRef[]
  actionLabel: string
  idPrefix: string
  busy: boolean
  onAction: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className={cn('min-w-0 flex-1 truncate text-sm', !item.title && 'text-muted-foreground italic')}>
                {item.title ?? 'No longer available to you'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                id={`${idPrefix}-${item.id}`}
                disabled={busy}
                onClick={() => onAction(item.id)}
              >
                {actionLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface RowActions {
  role: string
  now: Date
  busy: boolean
  following: Set<string>
  mutedTasks: Set<string>
  mutedBoards: Set<string>
  onMarkRead: (ids: string[]) => void
  onMarkUnread: (ids: string[]) => void
  onSnooze: (ids: string[], minutes: number | null) => void
  onSetFollow: (taskId: string, state: 'following' | 'muted' | null) => void
  onSetBoardMute: (boardId: string, muted: boolean) => void
}

function Bucket({ bucket, entries, ...actions }: { bucket: NotificationCategory; entries: InboxEntry[] } & RowActions) {
  const copy = BUCKET_COPY[bucket]
  return (
    <Card data-section={`inbox-${bucket}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {bucket === 'action_required' ? (
            <AlertCircle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          ) : (
            <Bell className="size-4" aria-hidden="true" />
          )}
          {copy.title}
          <Badge variant="secondary" className="ml-1 tabular-nums">{entries.length}</Badge>
        </CardTitle>
        {/* Each bucket says what its rule is. A heading alone leaves the reader guessing at
            why a thing landed in front of them, which is how people stop trusting the split. */}
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <EmptyState
            icon={bucket === 'action_required' ? <Check /> : <InboxIcon />}
            title={bucket === 'action_required' ? 'Nothing is waiting on you' : 'No updates'}
            description={
              bucket === 'action_required'
                ? 'Assignments, mentions and reminders land here. Nothing here means nothing is blocked on you.'
                : 'Comments and changes on work you are part of show up here.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <NotificationRow key={entry.latest.id} entry={entry} {...actions} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Relative age, in whole units.
 *
 * `now` is a parameter for the usual reason: a component that reads the wall clock during
 * render makes the server and the client disagree, and React throws the subtree away.
 */
function ago(iso: string, now: Date): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const minutes = Math.max(0, Math.round((now.getTime() - at) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

function NotificationRow({
  entry,
  role,
  now,
  busy,
  following,
  mutedTasks,
  mutedBoards,
  onMarkRead,
  onMarkUnread,
  onSnooze,
  onSetFollow,
  onSetBoardMute,
}: { entry: InboxEntry } & RowActions) {
  const n = entry.latest
  const href = notificationHref(n.boardId ? boardHref(role as any, n.boardId) : null, n)
  const isFollowing = Boolean(n.task_id && following.has(n.task_id))
  const isTaskMuted = Boolean(n.task_id && mutedTasks.has(n.task_id))
  const isBoardMuted = Boolean(n.boardId && mutedBoards.has(n.boardId))

  return (
    <li
      data-notification-id={n.id}
      data-unread={entry.unread}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
        entry.unread && 'border-primary/30 bg-primary/5',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('mt-1.5 size-2 shrink-0 rounded-full', entry.unread ? 'bg-primary' : 'bg-transparent')}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="shrink-0 text-[10px]">{notificationTypeLabel(n.type)}</Badge>
          {entry.grouped && (
            // A burst is one row with its size on it, rather than four rows nobody reads.
            <Badge variant="secondary" className="shrink-0 text-[10px] tabular-nums">
              {entry.count} events
            </Badge>
          )}
          <span className="text-muted-foreground text-xs">{ago(n.created_at, now)}</span>
        </div>

        {/* The message is the content, so it links. When there is nowhere specific to go it
            renders as plain text rather than as a link that lands on the dashboard. */}
        <p className="mt-1 text-sm">
          {href ? (
            <Link href={href} className="hover:underline" onClick={() => entry.unread && onMarkRead(entry.ids)}>
              {n.message}
            </Link>
          ) : (
            n.message
          )}
        </p>

        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          {n.boardTitle && <span className="truncate">{n.boardTitle}</span>}
          {n.taskTitle && <span className="truncate">{n.taskTitle}</span>}
          {n.onArchivedBoard && <span>on an archived board</span>}
          {isFollowing && <span className="text-primary">Following</span>}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            id={`inbox-actions-${n.id}`}
            aria-label="Notification actions"
            disabled={busy}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {href && (
            <DropdownMenuItem asChild>
              <Link href={href} onClick={() => entry.unread && onMarkRead(entry.ids)}>Open</Link>
            </DropdownMenuItem>
          )}

          {entry.unread ? (
            <DropdownMenuItem id={`inbox-read-${n.id}`} onClick={() => onMarkRead(entry.ids)}>
              <Check className="size-4" />
              Mark read
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem id={`inbox-unread-${n.id}`} onClick={() => onMarkUnread(entry.ids)}>
              <Undo2 className="size-4" />
              Mark unread
            </DropdownMenuItem>
          )}

          {n.snoozed_until ? (
            <DropdownMenuItem id={`inbox-unsnooze-${n.id}`} onClick={() => onSnooze(entry.ids, null)}>
              <Clock className="size-4" />
              Bring back now
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger id={`inbox-snooze-${n.id}`}>
                <Clock className="size-4" />
                Snooze
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SNOOZE_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.id}
                    id={`inbox-snooze-${option.id}-${n.id}`}
                    onClick={() => onSnooze(entry.ids, option.minutes)}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {n.task_id && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {/* Says what the control does to future traffic, not just what it is called. */}
                What you hear about next
              </DropdownMenuLabel>
              <DropdownMenuItem
                id={`inbox-follow-${n.id}`}
                onClick={() => onSetFollow(n.task_id!, isFollowing ? null : 'following')}
              >
                <Eye className="size-4" />
                {isFollowing ? 'Stop following this item' : 'Follow this item'}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`inbox-mute-task-${n.id}`}
                onClick={() => onSetFollow(n.task_id!, isTaskMuted ? null : 'muted')}
              >
                <BellOff className="size-4" />
                {isTaskMuted ? 'Unmute this item' : 'Mute this item'}
              </DropdownMenuItem>
              {n.boardId && (
                <DropdownMenuItem
                  id={`inbox-mute-board-${n.id}`}
                  onClick={() => onSetBoardMute(n.boardId!, !isBoardMuted)}
                >
                  <BellOff className="size-4" />
                  {isBoardMuted ? `Unmute ${n.boardTitle ?? 'this project'}` : `Mute ${n.boardTitle ?? 'this project'}`}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
