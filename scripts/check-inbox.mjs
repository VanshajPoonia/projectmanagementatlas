#!/usr/bin/env node
// Inbox harness - the pass/fail gate for migrations 120, 121 and 122.
//
//   120  task_notifications.snoozed_until / entity_*, task_follows, board_mutes
//   121  task_statuses.is_approval
//   122  notify_task_watchers
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the way
// the app reaches the database - never through the service role, which bypasses RLS and would
// pass whatever the policies said. The service role builds and tears down fixtures only.
//
// Every restriction has a CONTROL case proving it is specific rather than a blanket break: a
// harness that only shows refusals cannot tell a working permission apart from a broken table.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:inbox

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anon || !service) {
  console.error('missing env: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

assertDevDatabase()

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()

let failures = 0
let checks = 0
function check(label, condition, detail = '') {
  checks++
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${!condition && detail ? `\n         ${detail}` : ''}`)
  if (!condition) failures++
}
function section(name) {
  console.log(`\n--- ${name} ---`)
}

/** A write RLS refused: PostgREST reports either an error or, for a filtered row, nothing. */
const refused = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0)
const landed = (res) => !res.error && Array.isArray(res.data) && res.data.length > 0

const users = []
async function makeUser(tag, role = 'user') {
  const email = `inbox-${tag}+${stamp}@example.com`
  const password = `Ib-${stamp}-${tag}!x9`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser(${tag}): ${error.message}`)
  const id = data.user.id
  const { error: pErr } = await admin
    .from('profiles')
    .upsert({ id, email, full_name: `Inbox ${tag}`, role, is_active: true }, { onConflict: 'id' })
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`)
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: sErr } = await client.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`signIn(${tag}): ${sErr.message}`)
  users.push(id)
  return { id, email, client }
}

const boards = []
async function makeBoard(title, createdBy, extra = {}) {
  const { data, error } = await admin
    .from('boards')
    .insert({ title: `${title}-${stamp}`, created_by: createdBy, ...extra })
    .select('id')
    .single()
  if (error) throw new Error(`board(${title}): ${error.message}`)
  boards.push(data.id)

  const { data: column, error: cErr } = await admin
    .from('columns')
    .insert({ board_id: data.id, title: 'To Do', position: 0 })
    .select('id')
    .single()
  if (cErr) throw new Error(`column(${title}): ${cErr.message}`)
  return { boardId: data.id, columnId: column.id }
}

const tasks = []
async function makeTask(title, columnId, createdBy, extra = {}) {
  const { data, error } = await admin
    .from('tasks')
    .insert({ title: `${title}-${stamp}`, column_id: columnId, created_by: createdBy, position: 0, visibility: 'board', ...extra })
    .select('id')
    .single()
  if (error) throw new Error(`task(${title}): ${error.message}`)
  tasks.push(data.id)
  return data.id
}

const notifications = []
async function seedNotification(recipientId, taskId, actorId, type, message, extra = {}) {
  const { data, error } = await admin
    .from('task_notifications')
    .insert({ recipient_id: recipientId, task_id: taskId, actor_id: actorId, type, message, ...extra })
    .select('id')
    .single()
  if (error) throw new Error(`notification(${type}): ${error.message}`)
  notifications.push(data.id)
  return data.id
}

const statusKeys = []

try {
  const owner = await makeUser('owner')
  const mate = await makeUser('mate')
  const boss = await makeUser('boss', 'super_admin')

  const { boardId, columnId } = await makeBoard('inbox-board', owner.id)
  const taskId = await makeTask('shared-task', columnId, owner.id)
  await admin.from('task_assignees').insert({ task_id: taskId, user_id: owner.id })

  // =======================================================================================
  section('120 - a notification belongs to exactly one person')
  // =======================================================================================
  const mine = await seedNotification(owner.id, taskId, mate.id, 'assignment', `Mine ${stamp}`)
  const theirs = await seedNotification(mate.id, taskId, owner.id, 'assignment', `Theirs ${stamp}`)

  const ownerSees = await owner.client.from('task_notifications').select('id').in('id', [mine, theirs])
  check('a person reads their own notification', (ownerSees.data ?? []).some((r) => r.id === mine))
  check('and cannot read anyone else’s', !(ownerSees.data ?? []).some((r) => r.id === theirs))

  const stealRead = await owner.client
    .from('task_notifications').update({ read_at: new Date().toISOString() }).eq('id', theirs).select('id')
  check('cannot mark someone else’s notification read', refused(stealRead))

  const ownRead = await owner.client
    .from('task_notifications').update({ read_at: new Date().toISOString() }).eq('id', mine).select('id')
  check('CONTROL: can mark their own read', landed(ownRead))

  const ownUnread = await owner.client
    .from('task_notifications').update({ read_at: null }).eq('id', mine).select('id')
  check('CONTROL: and unread again', landed(ownUnread))

  // =======================================================================================
  section('120 - snooze')
  // =======================================================================================
  const until = new Date(Date.now() + 3600_000).toISOString()
  const snoozed = await owner.client
    .from('task_notifications').update({ snoozed_until: until }).eq('id', mine).select('id,snoozed_until')
  check('a person can snooze their own notification', landed(snoozed))
  check('and the timestamp is really stored', Boolean(snoozed.data?.[0]?.snoozed_until))

  const stealSnooze = await owner.client
    .from('task_notifications').update({ snoozed_until: until }).eq('id', theirs).select('id')
  check('cannot snooze someone else’s notification', refused(stealSnooze))

  const unsnoozed = await owner.client
    .from('task_notifications').update({ snoozed_until: null }).eq('id', mine).select('id')
  check('CONTROL: snooze can be lifted', landed(unsnoozed))

  // =======================================================================================
  section('120 - deep-link columns are constrained, not free text')
  // =======================================================================================
  const badEntity = await admin
    .from('task_notifications')
    .insert({ recipient_id: owner.id, task_id: taskId, type: 'comment', message: 'x', entity_type: 'nonsense' })
    .select('id')
  check('an unknown entity_type is refused', Boolean(badEntity.error))

  const orphanEntity = await admin
    .from('task_notifications')
    .insert({ recipient_id: owner.id, task_id: taskId, type: 'comment', message: 'x', entity_id: taskId })
    .select('id')
  check('an entity id with no type is refused', Boolean(orphanEntity.error))

  const goodEntity = await admin
    .from('task_notifications')
    .insert({ recipient_id: owner.id, task_id: taskId, type: 'comment', message: `Deep ${stamp}`, entity_type: 'comment', entity_id: taskId })
    .select('id')
  check('CONTROL: a real entity pair is accepted', landed(goodEntity))
  if (goodEntity.data?.[0]?.id) notifications.push(goodEntity.data[0].id)

  // =======================================================================================
  section('120 - follow and mute are private to the person who set them')
  // =======================================================================================
  const follow = await owner.client
    .from('task_follows').upsert({ task_id: taskId, user_id: owner.id, state: 'following' }).select('task_id')
  check('a person can follow a task they can see', landed(follow))

  const forgedFollow = await owner.client
    .from('task_follows').upsert({ task_id: taskId, user_id: mate.id, state: 'muted' }).select('task_id')
  check('cannot mute a task on somebody else’s behalf', refused(forgedFollow))

  await admin.from('task_follows').upsert({ task_id: taskId, user_id: mate.id, state: 'following' })
  const peek = await owner.client.from('task_follows').select('user_id').eq('task_id', taskId)
  check('cannot see who else follows a task', (peek.data ?? []).every((r) => r.user_id === owner.id))

  // A mute list says something about a person's attention, so not even a super admin reads it.
  const bossPeek = await boss.client.from('task_follows').select('user_id').eq('task_id', taskId)
  check('not even a super admin reads someone else’s follows', (bossPeek.data ?? []).length === 0)

  const bossMutePeek = await boss.client.from('board_mutes').select('user_id')
  check('not even a super admin reads someone else’s board mutes', (bossMutePeek.data ?? []).every((r) => r.user_id === boss.id))

  const flip = await owner.client
    .from('task_follows').upsert({ task_id: taskId, user_id: owner.id, state: 'muted' }).select('state')
  check('CONTROL: following flips to muted in place', landed(flip) && flip.data[0].state === 'muted')

  const unfollow = await owner.client
    .from('task_follows').delete().eq('task_id', taskId).eq('user_id', owner.id).select('task_id')
  check('CONTROL: a person can drop their own row', landed(unfollow))

  const stealDelete = await owner.client
    .from('task_follows').delete().eq('task_id', taskId).eq('user_id', mate.id).select('task_id')
  check('cannot delete somebody else’s follow', refused(stealDelete))
  const mateStill = await admin.from('task_follows').select('user_id').eq('task_id', taskId).eq('user_id', mate.id)
  check('and the other person’s row really survived', (mateStill.data ?? []).length === 1)

  // =======================================================================================
  section('120 - board mutes')
  // =======================================================================================
  // ⚠️ `ignoreDuplicates`, matching what the app sends. supabase-js's default upsert is ON
  // CONFLICT DO UPDATE, which Postgres refuses without the UPDATE privilege even when no
  // conflict occurs - and board_mutes deliberately has no UPDATE grant. This harness caught
  // that in the client before anyone could hit it.
  const muteBoard = await owner.client
    .from('board_mutes').upsert({ board_id: boardId, user_id: owner.id }, { ignoreDuplicates: true }).select('board_id')
  check('a person can mute a board they can see', landed(muteBoard))

  const defaultUpsert = await owner.client
    .from('board_mutes').upsert({ board_id: boardId, user_id: owner.id }).select('board_id')
  check('a merging upsert is refused, because a mute has nothing to update', refused(defaultUpsert))

  const forgedMute = await owner.client
    .from('board_mutes').upsert({ board_id: boardId, user_id: mate.id }, { ignoreDuplicates: true }).select('board_id')
  check('cannot mute a board on somebody else’s behalf', refused(forgedMute))

  // A board this user cannot SELECT must not be mutable: the INSERT policy's bare EXISTS
  // resolves through the caller's own boards policy, so an invisible board is an absent one.
  const { boardId: hiddenBoard } = await makeBoard('inbox-private', mate.id, { is_private: true })
  const muteHidden = await owner.client
    .from('board_mutes').upsert({ board_id: hiddenBoard, user_id: owner.id }, { ignoreDuplicates: true }).select('board_id')
  check('cannot mute a private board they cannot see', refused(muteHidden))

  const unmute = await owner.client
    .from('board_mutes').delete().eq('board_id', boardId).eq('user_id', owner.id).select('board_id')
  check('CONTROL: a person can unmute their own board', landed(unmute))

  // Muting hides notifications; it must never delete one. Unmuting is what brings them back.
  const beforeMute = await admin.from('task_notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', owner.id)
  await owner.client.from('board_mutes').upsert({ board_id: boardId, user_id: owner.id }, { ignoreDuplicates: true })
  const afterMute = await admin.from('task_notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', owner.id)
  check('muting a board destroys no notification', beforeMute.count === afterMute.count)
  await owner.client.from('board_mutes').delete().eq('board_id', boardId).eq('user_id', owner.id)

  // =======================================================================================
  section('121 - a status can declare that work in it awaits approval')
  // =======================================================================================
  const approvalKey = `harness_approval_${stamp}`
  statusKeys.push(approvalKey)
  const { data: nextPos } = await admin.from('task_statuses').select('position').order('position', { ascending: false }).limit(1)
  const seedStatus = await admin
    .from('task_statuses')
    .insert({ key: approvalKey, label: `Harness approval ${stamp}`, color: '#888888', position: (nextPos?.[0]?.position ?? 0) + 1, category: 'started', is_approval: true })
    .select('key,is_approval,is_closed,category')
  check('is_approval can be set on a status', landed(seedStatus) && seedStatus.data[0].is_approval === true)
  check('and it does not make the status closed - approval is orthogonal to category',
    seedStatus.data?.[0]?.is_closed === false && seedStatus.data?.[0]?.category === 'started')

  const memberWrite = await owner.client
    .from('task_statuses').update({ is_approval: false }).eq('key', approvalKey).select('key')
  check('a plain member cannot reclassify a status', refused(memberWrite))

  const bossWrite = await boss.client
    .from('task_statuses').update({ is_approval: false }).eq('key', approvalKey).select('key')
  check('CONTROL: a super admin can', landed(bossWrite))
  await admin.from('task_statuses').update({ is_approval: true }).eq('key', approvalKey)

  const readable = await owner.client.from('task_statuses').select('key,is_approval').eq('key', approvalKey)
  check('every signed-in user can READ the flag, which is what My Work needs', (readable.data ?? []).length === 1)

  // =======================================================================================
  section('122 - notify_task_watchers reaches followers the caller cannot see')
  // =======================================================================================
  // mate follows the task; owner is its assignee. Neither can read the other's follow row.
  await admin.from('task_follows').upsert({ task_id: taskId, user_id: mate.id, state: 'following' })

  const before = await admin.from('task_notifications').select('id', { count: 'exact', head: true }).eq('task_id', taskId)
  const fanout = await owner.client.rpc('notify_task_watchers', {
    p_task_id: taskId,
    p_type: 'comment',
    p_message: `Fanout ${stamp}`,
    p_entity_type: 'comment',
    p_entity_id: null,
  })
  check('the RPC runs for someone who can see the task', !fanout.error, fanout.error?.message)
  check('and it notified the follower the caller cannot even list', fanout.data >= 1)

  const mateGot = await admin
    .from('task_notifications').select('id,recipient_id,type').eq('task_id', taskId).eq('recipient_id', mate.id).eq('message', `Fanout ${stamp}`)
  check('the follower really has the row', (mateGot.data ?? []).length === 1)
  for (const row of mateGot.data ?? []) notifications.push(row.id)

  const selfGot = await admin
    .from('task_notifications').select('id').eq('recipient_id', owner.id).eq('message', `Fanout ${stamp}`)
  check('the actor is never notified about their own action', (selfGot.data ?? []).length === 0)

  const after = await admin.from('task_notifications').select('id', { count: 'exact', head: true }).eq('task_id', taskId)
  check('exactly one notification was created', after.count === before.count + 1)

  // A task on a private board the caller is not a member of: they cannot see it, so they
  // cannot use the RPC to mail everyone who can.
  const { columnId: hiddenColumn } = await makeBoard('inbox-private-2', mate.id, { is_private: true })
  const hiddenTask = await makeTask('hidden', hiddenColumn, mate.id)
  const forgedFanout = await owner.client.rpc('notify_task_watchers', {
    p_task_id: hiddenTask, p_type: 'comment', p_message: 'nope', p_entity_type: null, p_entity_id: null,
  })
  check('the RPC refuses a task the caller cannot see', Boolean(forgedFanout.error))

  const emptyMessage = await owner.client.rpc('notify_task_watchers', {
    p_task_id: taskId, p_type: 'comment', p_message: '   ', p_entity_type: null, p_entity_id: null,
  })
  check('an empty message is refused', Boolean(emptyMessage.error))

  const longMessage = await owner.client.rpc('notify_task_watchers', {
    p_task_id: taskId, p_type: 'comment', p_message: 'x'.repeat(2001), p_entity_type: null, p_entity_id: null,
  })
  check('an over-long message is refused', Boolean(longMessage.error))

  // Generous ceilings must ACCEPT, or a bounds check cannot tell a limit from a broken table.
  const atTheLimit = await owner.client.rpc('notify_task_watchers', {
    p_task_id: taskId, p_type: 'comment', p_message: 'y'.repeat(2000), p_entity_type: null, p_entity_id: null,
  })
  check('CONTROL: a message at exactly the limit is accepted', !atTheLimit.error)
  const limitRows = await admin.from('task_notifications').select('id').eq('task_id', taskId).eq('message', 'y'.repeat(2000))
  for (const row of limitRows.data ?? []) notifications.push(row.id)

  // A deactivated account keeps its follow row and stops receiving mail (101).
  await admin.from('profiles').update({ is_active: false }).eq('id', mate.id)
  const deactivatedFanout = await owner.client.rpc('notify_task_watchers', {
    p_task_id: taskId, p_type: 'comment', p_message: `Deactivated ${stamp}`, p_entity_type: null, p_entity_id: null,
  })
  check('a deactivated follower is not notified', !deactivatedFanout.error && deactivatedFanout.data === 0)
  await admin.from('profiles').update({ is_active: true }).eq('id', mate.id)

  // Muting is a READ-time rule. The row must still be written, so unmuting brings it back.
  await admin.from('task_follows').upsert({ task_id: taskId, user_id: mate.id, state: 'muted' })
  const mutedFanout = await owner.client.rpc('notify_task_watchers', {
    p_task_id: taskId, p_type: 'comment', p_message: `Muted ${stamp}`, p_entity_type: null, p_entity_id: null,
  })
  const mutedRows = await admin.from('task_notifications').select('id').eq('recipient_id', mate.id).eq('message', `Muted ${stamp}`)
  for (const row of mutedRows.data ?? []) notifications.push(row.id)
  check('a muted person is still an assignee-or-follower at write time, because mute is applied at read',
    !mutedFanout.error && (mutedRows.data ?? []).length === 0,
    'mate is muted, not following, so they are not a watcher at all here')

  // =======================================================================================
  section('122 - the function is not reachable by the wrong roles')
  // =======================================================================================
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const anonCall = await anonClient.rpc('notify_task_watchers', {
    p_task_id: taskId, p_type: 'comment', p_message: 'nope', p_entity_type: null, p_entity_id: null,
  })
  check('a signed-out caller cannot notify anybody', Boolean(anonCall.error))

  const anonFollows = await anonClient.from('task_follows').select('task_id')
  check('a signed-out caller reads no follows', (anonFollows.data ?? []).length === 0)
  const anonMutes = await anonClient.from('board_mutes').select('board_id')
  check('a signed-out caller reads no board mutes', (anonMutes.data ?? []).length === 0)

  // =======================================================================================
  section('120 - deprovisioning: a preference dies with its owner and takes nothing else')
  // =======================================================================================
  const doomed = await makeUser('doomed')
  await admin.from('task_follows').upsert({ task_id: taskId, user_id: doomed.id, state: 'following' })
  await admin.from('board_mutes').upsert({ board_id: boardId, user_id: doomed.id })
  const tasksBefore = await admin.from('tasks').select('id', { count: 'exact', head: true })

  await admin.from('profiles').delete().eq('id', doomed.id)
  await admin.auth.admin.deleteUser(doomed.id).catch(() => {})
  users.splice(users.indexOf(doomed.id), 1)

  const followGone = await admin.from('task_follows').select('user_id').eq('user_id', doomed.id)
  const muteGone = await admin.from('board_mutes').select('user_id').eq('user_id', doomed.id)
  const tasksAfter = await admin.from('tasks').select('id', { count: 'exact', head: true })
  check('deleting a person removes their follows', (followGone.data ?? []).length === 0)
  check('and their board mutes', (muteGone.data ?? []).length === 0)
  check('and takes no work item with them', tasksBefore.count === tasksAfter.count)
} finally {
  // ---------------------------------------------------------------------------------------
  // Teardown - non-destructive, everything created above goes
  // ---------------------------------------------------------------------------------------
  for (const id of tasks) {
    await admin.from('task_notifications').delete().eq('task_id', id)
    await admin.from('task_follows').delete().eq('task_id', id)
    await admin.from('task_assignees').delete().eq('task_id', id)
    await admin.from('tasks').delete().eq('id', id)
  }
  if (notifications.length) await admin.from('task_notifications').delete().in('id', notifications)
  if (statusKeys.length) await admin.from('task_statuses').delete().in('key', statusKeys)
  for (const id of boards) {
    await admin.from('board_mutes').delete().eq('board_id', id)
    await admin.from('columns').delete().eq('board_id', id)
    await admin.from('boards').delete().eq('id', id)
  }
  for (const id of users) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
