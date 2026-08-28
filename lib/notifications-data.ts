// Reading and writing the inbox.
//
// The Supabase client is a PARAMETER everywhere in this file, never imported. The inbox is
// read on the server (so the first frame is right and the unread badge does not pop in) and
// written from the browser, and a module that imported the browser client could not be touched
// by a Server Component at all - the same constraint that forced lib/module-registry.ts to
// exist next to lib/modules.ts.
//
// ⚠️ EVERY WRITE ASKS FOR ITS ROWS BACK AND COUNTS THEM. An RLS refusal over PostgREST is a
// zero-row response with NO error, so `if (error)` alone reports a refusal as a success. That
// has bitten this repo three times (board membership, module toggles, bulk operations); see
// lib/rls-write.ts.

import { classifyWrite, type WriteOutcome } from './rls-write'
import { normalizeNotificationRow, type InboxNotification, type MuteState } from './notifications'

/**
 * One select string, used by the inbox AND by the toasts.
 *
 * They must agree about which board a notification belongs to, because that is the field
 * muting is decided on: a toast reading a different shape would happily interrupt someone
 * about a board they had muted.
 */
export const NOTIFICATION_SELECT =
  'id,type,message,created_at,read_at,snoozed_until,task_id,actor_id,entity_type,entity_id,' +
  'actor:profiles!task_notifications_actor_id_fkey(full_name,email),' +
  'task:tasks(title,column:columns(board_id,board:boards(id,title,archived_at)))'

/**
 * How far back the inbox reads.
 *
 * A cap rather than everything, because production already holds ~170 rows for a handful of
 * people and there is no story for the day that is 170,000. 200 is comfortably more than one
 * screen and the query is ordered newest-first, so what is dropped is the oldest already-read
 * history - the part nobody scrolls to.
 */
export const INBOX_LIMIT = 200

/** A work item or board this person has an explicit opinion about, named so it can be undone. */
export interface SubscriptionRef {
  id: string
  /** Null when the row is no longer readable - see the note on `mutedBoards` below. */
  title: string | null
}

export interface InboxData {
  notifications: InboxNotification[]
  mutes: MuteState
  /** Task ids this person has explicitly chosen to follow. */
  followingTaskIds: Set<string>
  /**
   * Everything this person has muted or followed, NAMED - not just the ids used for filtering.
   *
   * ⚠️ This exists because of a real dead end. Mute a project with no notifications yet and it
   * disappears from every list: there is no notification to open a menu on, so there is no way
   * back. A control whose effect cannot be undone from anywhere is one people stop trusting.
   * The Muted view lists these directly, so unmuting never depends on having something muted
   * still to look at.
   *
   * `title` is null when the board or task is no longer readable (deleted, or access removed).
   * The row is still listed, because the mute is still real and still theirs to remove.
   */
  mutedBoards: SubscriptionRef[]
  mutedTasks: SubscriptionRef[]
  followedTasks: SubscriptionRef[]
  /**
   * True when a query failed. ⚠️ Kept rather than swallowed: an empty inbox and a broken
   * inbox look identical, and "You're all caught up" is the most reassuring possible way to
   * tell someone their notifications are down.
   */
  failed: boolean
}

export const EMPTY_INBOX: InboxData = {
  notifications: [],
  mutes: { mutedTaskIds: new Set(), mutedBoardIds: new Set() },
  followingTaskIds: new Set(),
  mutedBoards: [],
  mutedTasks: [],
  followedTasks: [],
  failed: false,
}

/**
 * Everything the inbox needs, in three queries that do not depend on each other.
 *
 * RLS scopes all three to the caller: `recipient_id = auth.uid()` on the notifications, and
 * `user_id = auth.uid()` on the follows and mutes (migration 120, with no admin bypass - a
 * mute list is a statement about your own attention).
 */
export async function fetchInboxData(supabase: any, userId: string): Promise<InboxData> {
  const [notificationsResult, followsResult, boardMutesResult] = await Promise.all([
    supabase
      .from('task_notifications')
      .select(NOTIFICATION_SELECT)
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(INBOX_LIMIT),
    // The titles ride along on the same read. A left join through RLS returns null for a row
    // the caller may not see, which is exactly the "hidden vs does not exist" ambiguity - and
    // here it does not matter, because the question being answered is "what have I muted",
    // and the answer is the person's own row either way.
    supabase.from('task_follows').select('task_id,state,task:tasks(title)').eq('user_id', userId),
    supabase.from('board_mutes').select('board_id,board:boards(title)').eq('user_id', userId),
  ])

  const mutedTaskIds = new Set<string>()
  const followingTaskIds = new Set<string>()
  const mutedTasks: SubscriptionRef[] = []
  const followedTasks: SubscriptionRef[] = []
  for (const row of followsResult.data ?? []) {
    const ref: SubscriptionRef = { id: row.task_id, title: (row as any).task?.title ?? null }
    if (row.state === 'muted') {
      mutedTaskIds.add(row.task_id)
      mutedTasks.push(ref)
    } else if (row.state === 'following') {
      followingTaskIds.add(row.task_id)
      followedTasks.push(ref)
    }
  }

  const mutedBoards: SubscriptionRef[] = (boardMutesResult.data ?? []).map((row: any) => ({
    id: row.board_id,
    title: row.board?.title ?? null,
  }))

  return {
    notifications: (notificationsResult.data ?? []).map(normalizeNotificationRow),
    mutes: {
      mutedTaskIds,
      mutedBoardIds: new Set<string>(mutedBoards.map((b) => b.id)),
    },
    followingTaskIds,
    mutedBoards,
    mutedTasks,
    followedTasks,
    failed: Boolean(notificationsResult.error || followsResult.error || boardMutesResult.error),
  }
}

/**
 * Mark a set of notifications read, unread, or snoozed.
 *
 * ⚠️ `ids` is a set because the inbox groups bursts: one row on screen can stand for four
 * notifications, and reading three of them would leave an unread count that disagrees with
 * what the person is looking at.
 *
 * No `stillReadable` probe: none of these columns is an input to the SELECT policy
 * (`recipient_id = auth.uid()`), so a write here cannot take the row out of its own owner's
 * view. That is the case lib/rls-write.ts says to pass no probe for.
 */
async function updateNotifications(supabase: any, ids: string[], patch: Record<string, unknown>): Promise<WriteOutcome> {
  if (ids.length === 0) return { kind: 'ok' }
  const result = await supabase.from('task_notifications').update(patch).in('id', ids).select('id')
  return classifyWrite(result, { expected: ids.length })
}

export function markNotificationsRead(supabase: any, ids: string[], now: Date): Promise<WriteOutcome> {
  return updateNotifications(supabase, ids, { read_at: now.toISOString() })
}

export function markNotificationsUnread(supabase: any, ids: string[]): Promise<WriteOutcome> {
  // Unsnoozing too: a notification you have deliberately brought back is not one you also
  // want hidden until Thursday.
  return updateNotifications(supabase, ids, { read_at: null, snoozed_until: null })
}

export function snoozeNotifications(supabase: any, ids: string[], until: string | null): Promise<WriteOutcome> {
  return updateNotifications(supabase, ids, { snoozed_until: until })
}

/**
 * Follow, mute, or stop caring about one work item.
 *
 * `state = null` deletes the row, which is the difference between "I have no opinion" and
 * "I have decided not to hear about this". Upsert rather than delete-then-insert: flipping
 * following -> muted must never leave a window in which the row does not exist.
 */
export async function setTaskFollowState(
  supabase: any,
  taskId: string,
  userId: string,
  state: 'following' | 'muted' | null,
  now: Date,
): Promise<WriteOutcome> {
  if (state === null) {
    const result = await supabase
      .from('task_follows')
      .delete()
      .eq('task_id', taskId)
      .eq('user_id', userId)
      .select('task_id')
    // A delete of a row that was never there returns zero rows and is not a refusal, so this
    // one asks the question the other way round: it is only a problem if the row survives.
    if (result.error) return { kind: 'error', message: result.error.message }
    return { kind: 'ok' }
  }

  const result = await supabase
    .from('task_follows')
    .upsert({ task_id: taskId, user_id: userId, state, updated_at: now.toISOString() }, { onConflict: 'task_id,user_id' })
    .select('task_id')
  return classifyWrite(result)
}

export async function setBoardMuted(
  supabase: any,
  boardId: string,
  userId: string,
  muted: boolean,
): Promise<WriteOutcome> {
  if (!muted) {
    const result = await supabase.from('board_mutes').delete().eq('board_id', boardId).eq('user_id', userId).select('board_id')
    if (result.error) return { kind: 'error', message: result.error.message }
    return { kind: 'ok' }
  }

  // ⚠️ `ignoreDuplicates`, which PostgREST sends as ON CONFLICT DO NOTHING. The default upsert
  // is ON CONFLICT DO UPDATE, and Postgres requires the UPDATE privilege for that whether or
  // not a conflict actually happens - `board_mutes` deliberately has no UPDATE grant, because
  // a mute has nothing to edit. Measured: the default form was refused for every user,
  // including on a board they had just created.
  const result = await supabase
    .from('board_mutes')
    .upsert({ board_id: boardId, user_id: userId }, { onConflict: 'board_id,user_id', ignoreDuplicates: true })
    .select('board_id')

  // Zero rows here is genuinely ambiguous: DO NOTHING returns nothing when the row was already
  // there, and RLS returns nothing when it refused. Reading the row back is the only way to
  // tell "already muted" (a success) from "not allowed" (a failure) - the same probe
  // lib/rls-write.ts exists for.
  return classifyWrite(result, {
    stillReadable: async () => {
      const probe = await supabase
        .from('board_mutes').select('board_id').eq('board_id', boardId).eq('user_id', userId)
      // A readable row means the mute is in place, so the write effectively landed. `refused`
      // is the honest answer only when it is NOT there.
      return (probe.data?.length ?? 0) === 0
    },
  })
}

/**
 * Notify everyone watching a work item - assignees plus explicit followers, minus the actor.
 *
 * ⚠️ THIS CANNOT BE DONE FROM THE CLIENT, and the reason is worth keeping. `task_follows` is
 * private (`user_id = auth.uid()`, no admin bypass), so a caller asking "who follows this
 * task" gets back their own row and nothing else - and would conclude the task has no
 * followers. "Hidden from you" and "does not exist" arrive looking identical. Migration 122's
 * `notify_task_watchers` resolves the audience past RLS and returns a count, so the follower
 * list never leaves the database.
 *
 * Returns how many people were notified, or null when the call failed. A null is worth
 * surfacing in a log rather than a toast: the comment itself already saved, and "your comment
 * posted but nobody was told" is a different failure from "your comment did not post".
 */
export async function notifyTaskWatchers(
  supabase: any,
  input: {
    taskId: string
    type: string
    message: string
    entityType?: 'task' | 'comment' | 'field' | 'relation' | 'approval' | 'request' | null
    entityId?: string | null
  },
): Promise<number | null> {
  const { data, error } = await supabase.rpc('notify_task_watchers', {
    p_task_id: input.taskId,
    p_type: input.type,
    p_message: input.message,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
  })
  if (error) return null
  return typeof data === 'number' ? data : 0
}
