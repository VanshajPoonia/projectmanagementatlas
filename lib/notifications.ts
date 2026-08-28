// The inbox: what a notification MEANS, and which of them a person should be looking at.
//
// Pure functions over `task_notifications` rows (migration 035, extended by 120). No React, no
// Supabase client, no `new Date()` inside anything that decides something - every function that
// needs "now" takes it as a parameter, so the server and the client cannot disagree about
// whether a snooze has expired (the hydration trap lib/use-now.ts exists for).
//
// ⚠️ THIS IS PRESENTATION, NOT A BOUNDARY. RLS decides which notification rows a person can
// read at all (`recipient_id = auth.uid()`). Everything here runs on rows the database has
// already agreed to hand over, and is about attention rather than access.

/**
 * Two buckets, and deliberately only two.
 *
 * The plan's wording is "avoid overclassification", and it is the right instinct: an inbox
 * with seven tabs is an inbox nobody reads, because deciding which tab a thing is in becomes
 * the reader's job. The only distinction that changes behaviour is "does this need me to do
 * something, or is it telling me something".
 */
export type NotificationCategory = 'action_required' | 'update'

export interface NotificationTypeInfo {
  category: NotificationCategory
  /** Short label for the row's badge. */
  label: string
  /** Why this type is in the bucket it is in - shown where the buckets are explained. */
  rationale: string
}

/**
 * Every notification `type` the application writes, and what it means.
 *
 * Kept as a map here rather than as a lookup table in Postgres, deliberately: nothing filters
 * on the category server-side, nothing writes it, and no screen edits it, so a table would be
 * schema built ahead of a need - the same call that kept `team_role` off `team_members`. When
 * a server-side digest needs to GROUP BY category, that is the day the table earns itself.
 *
 * ⚠️ The four types with a writer today are `assignment`, `update` and `reminder` (035, 117 and
 * the board components) and `comment`/`mention` (added with the inbox). The rest are named
 * ahead of their writers ONLY because they are the vocabulary the plan lists, and every one is
 * classified rather than guessed at - see `classifyNotification` for what happens to a type
 * that is not here at all.
 */
export const NOTIFICATION_TYPES: Record<string, NotificationTypeInfo> = {
  assignment: {
    category: 'action_required',
    label: 'Assigned',
    rationale: 'Work was handed to you; nobody else is going to pick it up.',
  },
  mention: {
    category: 'action_required',
    label: 'Mention',
    rationale: 'Someone addressed you by name and is waiting on your answer.',
  },
  approval: {
    category: 'action_required',
    label: 'Approval',
    rationale: 'Something is parked until you approve or reject it.',
  },
  blocked: {
    category: 'action_required',
    label: 'Blocked',
    rationale: 'Work you own cannot proceed until something is cleared.',
  },
  reminder: {
    category: 'action_required',
    label: 'Reminder',
    rationale: 'You asked to be reminded about this at this moment.',
  },
  request: {
    category: 'action_required',
    label: 'Request',
    rationale: 'Someone outside the team is waiting on a response.',
  },
  comment: {
    category: 'update',
    label: 'Comment',
    rationale: 'A conversation moved on work you are part of. Read it when you get to it.',
  },
  update: {
    category: 'update',
    label: 'Updated',
    rationale: 'Details changed on work you are part of.',
  },
  completed: {
    category: 'update',
    label: 'Completed',
    rationale: 'Work you were following finished.',
  },
}

/**
 * Which bucket a notification belongs in.
 *
 * ⚠️ An UNKNOWN type resolves to `action_required`, and the direction of that default is the
 * whole decision. Getting it wrong towards Updates buries something that needed a person;
 * getting it wrong towards Action Required is noise the reader can dismiss in one click. Noise
 * is recoverable and a missed hand-off is not, so the default is the noisy one - and because
 * an unknown type can only come from code somebody just wrote, it announces itself immediately
 * rather than lurking in a second list.
 */
export function classifyNotification(type: string | null | undefined): NotificationCategory {
  return NOTIFICATION_TYPES[String(type ?? '')]?.category ?? 'action_required'
}

export function notificationTypeLabel(type: string | null | undefined): string {
  return NOTIFICATION_TYPES[String(type ?? '')]?.label ?? 'Notice'
}

/** The row shape the inbox works with, flattened from the join the query already does. */
export interface InboxNotification {
  id: string
  type: string
  message: string
  created_at: string
  read_at: string | null
  snoozed_until: string | null
  task_id: string | null
  actor_id: string | null
  entity_type: string | null
  entity_id: string | null
  actorName: string | null
  taskTitle: string | null
  boardId: string | null
  boardTitle: string | null
  /** An archived board is still readable, but there is nowhere useful to send someone. */
  onArchivedBoard: boolean
}

/**
 * Flatten one PostgREST row into `InboxNotification`.
 *
 * Shared by the inbox and the toasts so the two cannot end up disagreeing about which board a
 * notification belongs to - which matters because muting is decided by exactly that field.
 */
export function normalizeNotificationRow(row: any): InboxNotification {
  const column = row?.task?.column
  const board = column?.board
  return {
    id: String(row?.id),
    type: String(row?.type ?? 'update'),
    message: String(row?.message ?? ''),
    created_at: String(row?.created_at ?? ''),
    read_at: row?.read_at ?? null,
    snoozed_until: row?.snoozed_until ?? null,
    task_id: row?.task_id ?? null,
    actor_id: row?.actor_id ?? null,
    entity_type: row?.entity_type ?? null,
    entity_id: row?.entity_id ?? null,
    actorName: row?.actor?.full_name ?? row?.actor?.email ?? null,
    taskTitle: row?.task?.title ?? null,
    boardId: column?.board_id ?? board?.id ?? null,
    boardTitle: board?.title ?? null,
    onArchivedBoard: Boolean(board?.archived_at),
  }
}

export function isUnread(n: InboxNotification): boolean {
  return n.read_at === null
}

/**
 * Is this notification currently snoozed?
 *
 * Compared as instants, which is right here and wrong for a due date - a snooze IS a moment
 * ("stop bothering me until 4pm"), whereas a due date is a calendar day. See
 * lib/calendar-grid.ts for the other case and why the two must not share an implementation.
 */
export function isSnoozed(n: InboxNotification, now: Date): boolean {
  if (!n.snoozed_until) return false
  const until = Date.parse(n.snoozed_until)
  return Number.isFinite(until) && until > now.getTime()
}

/**
 * Snooze durations, expressed as durations.
 *
 * ⚠️ Not "tomorrow morning" or "Monday 9am". Those need a timezone to mean anything, and this
 * repo has five recorded bugs from resolving a stored value in the wrong one. A duration is
 * the same length everywhere on earth, and the label says exactly what the user gets.
 */
export const SNOOZE_OPTIONS: ReadonlyArray<{ id: string; label: string; minutes: number }> = [
  { id: '1h', label: 'For 1 hour', minutes: 60 },
  { id: '4h', label: 'For 4 hours', minutes: 4 * 60 },
  { id: '1d', label: 'For a day', minutes: 24 * 60 },
  { id: '1w', label: 'For a week', minutes: 7 * 24 * 60 },
]

export function snoozeUntil(minutes: number, now: Date): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

export interface MuteState {
  /** Task ids this person muted (`task_follows.state = 'muted'`). */
  mutedTaskIds: ReadonlySet<string>
  /** Board ids this person muted (`board_mutes`). */
  mutedBoardIds: ReadonlySet<string>
}

export const NO_MUTES: MuteState = { mutedTaskIds: new Set(), mutedBoardIds: new Set() }

/**
 * Is this notification muted for this person?
 *
 * ⚠️ Read-time, never write-time. The writers are ordinary client components; a mute that
 * relied on each of them remembering to check would leak the first time somebody added a
 * fifth writer. Filtering here also means unmuting brings the history BACK, rather than having
 * silently destroyed it - "mute" is a statement about attention, not a delete.
 */
export function isMuted(n: InboxNotification, mutes: MuteState): boolean {
  if (n.task_id && mutes.mutedTaskIds.has(n.task_id)) return true
  if (n.boardId && mutes.mutedBoardIds.has(n.boardId)) return true
  return false
}

export type InboxScope = 'inbox' | 'snoozed' | 'muted'

export interface InboxFilter {
  bucket?: NotificationCategory | 'all'
  /** 'unread' hides anything already read; 'all' shows the history. */
  read?: 'unread' | 'all'
  scope?: InboxScope
}

/**
 * Narrow a person's notifications down to what the current screen is asking for.
 *
 * The three scopes are exclusive by design: `inbox` is what wants attention now, and the other
 * two exist so that snoozing and muting are *visible* rather than a way for things to vanish.
 * A control that makes something disappear with no way to find it again is one a person stops
 * using, because they cannot tell it apart from having lost the thing.
 */
export function filterInbox(
  notifications: readonly InboxNotification[],
  mutes: MuteState,
  now: Date,
  filter: InboxFilter = {},
): InboxNotification[] {
  const { bucket = 'all', read = 'all', scope = 'inbox' } = filter

  return (notifications ?? []).filter((n) => {
    const muted = isMuted(n, mutes)
    const snoozed = isSnoozed(n, now)

    if (scope === 'muted') {
      if (!muted) return false
    } else if (scope === 'snoozed') {
      if (muted || !snoozed) return false
    } else {
      if (muted || snoozed) return false
    }

    if (read === 'unread' && !isUnread(n)) return false
    if (bucket !== 'all' && classifyNotification(n.type) !== bucket) return false
    return true
  })
}

/** Headline counts. Muted and snoozed rows are never counted as waiting on anybody. */
export function inboxCounts(
  notifications: readonly InboxNotification[],
  mutes: MuteState,
  now: Date,
): { actionRequired: number; updates: number; unread: number; snoozed: number; muted: number } {
  let actionRequired = 0
  let updates = 0
  let unread = 0
  let snoozed = 0
  let muted = 0

  for (const n of notifications ?? []) {
    if (isMuted(n, mutes)) { muted++; continue }
    if (isSnoozed(n, now)) { snoozed++; continue }
    if (!isUnread(n)) continue
    unread++
    if (classifyNotification(n.type) === 'action_required') actionRequired++
    else updates++
  }

  return { actionRequired, updates, unread, snoozed, muted }
}

/**
 * One row in the inbox, which may stand for several notifications.
 *
 * `ids` is every notification the entry covers, so marking it read marks all of them. Reading
 * one and leaving four unread underneath is how an unread count ends up disagreeing with what
 * is on screen.
 */
export interface InboxEntry {
  /** The newest notification in the burst - what the row displays. */
  latest: InboxNotification
  ids: string[]
  count: number
  /** True when this entry stands for more than one notification. */
  grouped: boolean
  /** Unread if ANY member is unread; marking read clears the whole burst. */
  unread: boolean
  category: NotificationCategory
}

/** Bursts closer together than this collapse into one row. */
export const BURST_WINDOW_MINUTES = 60

/**
 * Collapse a burst of related events into one entry.
 *
 * The plan asks for this and the reason is concrete: saving a task with four fields changed
 * writes four notifications a few hundred milliseconds apart, and an inbox that shows them as
 * four rows is one that people scroll past. Grouping is on (task, type, actor) inside a time
 * window - the same person doing the same kind of thing to the same item.
 *
 * ⚠️ Deliberately NOT across actors, and NOT across types. "Ann commented" and "Bob commented"
 * are two facts, and merging them into "2 comments" throws away the one detail most likely to
 * decide whether you open it. Same for a comment and a reassignment: they collapse to
 * "2 updates", which is a row that tells you nothing.
 *
 * Input must be newest-first (which is the order the query returns); output preserves it.
 */
export function groupNotificationBursts(
  notifications: readonly InboxNotification[],
  windowMinutes: number = BURST_WINDOW_MINUTES,
): InboxEntry[] {
  const windowMs = windowMinutes * 60_000
  const entries: InboxEntry[] = []

  for (const n of notifications ?? []) {
    const key = `${n.task_id ?? '-'}|${n.type}|${n.actor_id ?? '-'}`
    const at = Date.parse(n.created_at)

    const open = entries.find((entry) => {
      if (`${entry.latest.task_id ?? '-'}|${entry.latest.type}|${entry.latest.actor_id ?? '-'}` !== key) return false
      const latestAt = Date.parse(entry.latest.created_at)
      if (!Number.isFinite(latestAt) || !Number.isFinite(at)) return false
      return Math.abs(latestAt - at) <= windowMs
    })

    if (open) {
      open.ids.push(n.id)
      open.count++
      open.grouped = true
      open.unread = open.unread || isUnread(n)
      continue
    }

    entries.push({
      latest: n,
      ids: [n.id],
      count: 1,
      grouped: false,
      unread: isUnread(n),
      category: classifyNotification(n.type),
    })
  }

  return entries
}

/**
 * Where a notification should open.
 *
 * ⚠️ `boardHref` is passed IN, already built for this viewer by
 * components/shell/workspace-nav.ts. It is not computed here and it is not stored on the row,
 * because the two board routes are not interchangeable: /dashboard/board/<id> deliberately
 * strips an admin's controls, so which one a person must be sent to depends on their role and
 * not on the notification. A path baked in at write time pins every later reader into whichever
 * surface the writer happened to be on - the exact bug five call sites had in 2026-08-21.
 *
 * Returns null when there is nowhere specific to go, so a caller can offer no action rather
 * than an "Open" button that lands on the dashboard. A notification about work on an archived
 * board is one of those cases.
 */
export function notificationHref(
  boardHref: string | null,
  n: Pick<InboxNotification, 'task_id' | 'entity_type' | 'entity_id' | 'onArchivedBoard'>,
): string | null {
  if (!boardHref || !n.task_id || n.onArchivedBoard) return null

  const params = new URLSearchParams({ task: n.task_id })

  // The deep link the plan asks for: not "here is the task", but "here is the comment".
  // Anything else stays task-level rather than inventing a route that does not exist.
  if (n.entity_type === 'comment' && n.entity_id) params.set('comment', n.entity_id)

  return `${boardHref}?${params.toString()}`
}

/** Plain-language explanation of a bucket, rendered above it. */
export const BUCKET_COPY: Record<NotificationCategory, { title: string; description: string }> = {
  action_required: {
    title: 'Action required',
    description: 'Waiting on you specifically. Nothing here moves until you do something.',
  },
  update: {
    title: 'Updates',
    description: 'Work you are part of changed. Worth knowing, not worth interrupting for.',
  },
}
