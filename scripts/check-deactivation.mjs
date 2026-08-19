#!/usr/bin/env node
// Deactivating an account must actually revoke access (migration 101).
//
// Before 101 it revoked nothing at all. `profiles.is_active` was written by the Super Admin
// toggle and read by nobody: zero RLS policies, zero helper functions, zero lines of
// application code. A "deactivated" person kept every power they had and could sign in as
// normal, while the admin who deactivated them saw a red Inactive badge and believed the
// opposite. This harness exists so that can never quietly become true again.
//
// It asserts the layered enforcement:
//   - elevated access dies at the DATABASE on the very next query (no re-login, no waiting
//     for a token to expire)
//   - writing work is refused
//   - signing in is refused by the auth server
//   - the user cannot switch their own flag back on
//   - reactivating restores everything
//
// Non-destructive: everything it creates is removed in `finally`. Run: pnpm check:deactivation

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
const PASSWORD = `Deact-${stamp}-x9!`

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const section = (n) => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 60 - n.length))}`)

const ids = {}
let boardId, columnId, taskId

async function makeUser(tag, role) {
  const email = `deact-${tag}-${stamp}@goatlasgo.us`
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw new Error(`createUser ${tag}: ${error.message}`)
  await admin.from('profiles')
    .upsert({ id: data.user.id, email, full_name: `Deact ${tag}`, role, is_active: true }, { onConflict: 'id' })
  ids[tag] = data.user.id
  return { id: data.user.id, email }
}

async function signIn(email) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  return { client, error }
}

const setActive = async (userId, isActive) => {
  const { error } = await admin.from('profiles')
    .update({ is_active: isActive, deactivated_at: isActive ? null : new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(`setActive: ${error.message}`)
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : '876000h',
  })
  if (banError) throw new Error(`ban: ${banError.message}`)
}

try {
  const target = await makeUser('target', 'admin')
  const owner = await makeUser('owner', 'admin')

  const { data: board } = await admin.from('boards')
    .insert({ title: `deact-board-${stamp}`, created_by: owner.id, updated_by: owner.id, is_private: false })
    .select('id').single()
  boardId = board.id
  const { data: column } = await admin.from('columns')
    .insert({ board_id: boardId, title: 'To Do', position: 0 }).select('id').single()
  columnId = column.id
  const { data: task } = await admin.from('tasks')
    .insert({ column_id: columnId, title: 'original title', created_by: owner.id, position: 0, visibility: 'board' })
    .select('id').single()
  taskId = task.id

  // Sign in BEFORE deactivating, and keep this client. Everything below reuses it, which is
  // the case that matters: a ban stops new tokens, but this person already has one.
  const { client: live, error: signInErr } = await signIn(target.email)
  check('an active account can sign in', !signInErr, signInErr?.message)

  section('while active (control)')
  const { data: createdBefore } = await live.from('tasks')
    .insert({ column_id: columnId, title: `before-${stamp}`, created_by: ids.target, position: 5 }).select('id')
  check('they can create a task', (createdBefore ?? []).length === 1)
  if (createdBefore?.length) await admin.from('tasks').delete().in('id', createdBefore.map((r) => r.id))

  const { data: updatedBefore } = await live.from('tasks')
    .update({ title: 'admin edit' }).eq('id', taskId).select('id')
  check('their admin powers work', (updatedBefore ?? []).length === 1)
  await admin.from('tasks').update({ title: 'original title' }).eq('id', taskId)

  section('the moment they are switched off')
  await setActive(ids.target, false)

  // Same client, same token, no re-login. RLS is evaluated per request, so this must bite now
  // rather than whenever the access token happens to expire.
  const { data: createdAfter } = await live.from('tasks')
    .insert({ column_id: columnId, title: `after-${stamp}`, created_by: ids.target, position: 6 }).select('id')
  check('they can no longer create work, on the very next request', (createdAfter ?? []).length === 0)
  if (createdAfter?.length) await admin.from('tasks').delete().in('id', createdAfter.map((r) => r.id))

  const { data: updatedAfter } = await live.from('tasks')
    .update({ title: 'hijacked' }).eq('id', taskId).select('id')
  check('their admin edit powers are gone', (updatedAfter ?? []).length === 0)

  // The audit log is admin-only, so losing admin means losing it. A good proxy for "every
  // is_admin_user() gate closed at once".
  const { data: auditAfter } = await live.from('audit_events').select('id').limit(1)
  check('admin-only surfaces close to them', (auditAfter ?? []).length === 0)

  // Creating a task, a comment and a chat message each have their own INSERT check that does
  // NOT route through can_manage_task, so each needed amending separately. The first run of
  // this harness caught tasks; these pin all three.
  const { data: commentAfter } = await live.from('task_comments')
    .insert({ task_id: taskId, user_id: ids.target, author_id: ids.target, comment: `after-${stamp}` }).select('id')
  check('they can no longer comment', (commentAfter ?? []).length === 0)
  if (commentAfter?.length) await admin.from('task_comments').delete().in('id', commentAfter.map((r) => r.id))

  const { data: chatAfter } = await live.from('chat_messages')
    .insert({ sender_id: ids.target, recipient_id: ids.owner, message: `after-${stamp}` }).select('id')
  check('they can no longer send chat messages', (chatAfter ?? []).length === 0)
  if (chatAfter?.length) await admin.from('chat_messages').delete().in('id', chatAfter.map((r) => r.id))

  section('they cannot let themselves back in')
  // 101 revoked authenticated's UPDATE on is_active. Without that, the flag would be
  // self-service and every check above would be theatre.
  const { data: selfRestore, error: selfErr } = await live.from('profiles')
    .update({ is_active: true }).eq('id', ids.target).select('id')
  check('they cannot switch their own access back on',
    (selfRestore ?? []).length === 0 || Boolean(selfErr), 'the update was accepted')

  const { data: selfPromote } = await live.from('profiles')
    .update({ role: 'super_admin' }).eq('id', ids.target).select('id')
  check('they cannot promote themselves either', (selfPromote ?? []).length === 0)

  section('signing in again is refused')
  const { error: reSignIn } = await signIn(target.email)
  check('the auth server refuses a fresh sign-in', Boolean(reSignIn), 'sign-in succeeded')

  section('and it is all reversible')
  await setActive(ids.target, true)
  const { client: restored, error: restoredErr } = await signIn(target.email)
  check('they can sign in again once restored', !restoredErr, restoredErr?.message)

  const { data: createdRestored } = await restored.from('tasks')
    .insert({ column_id: columnId, title: `restored-${stamp}`, created_by: ids.target, position: 7 }).select('id')
  check('their access comes back intact', (createdRestored ?? []).length === 1)
  if (createdRestored?.length) await admin.from('tasks').delete().in('id', createdRestored.map((r) => r.id))

  section('self-service settings still work')
  // The column-level grant had to be narrowed to protect is_active. If that went too far,
  // everyone loses their notification preferences, so this is the guard against overshooting.
  const { data: prefs, error: prefsErr } = await restored.from('profiles')
    .update({ notify_email_comment: false, full_name: 'Deact target renamed' })
    .eq('id', ids.target).select('id')
  check('a user can still edit their own name and notification settings',
    (prefs ?? []).length === 1 && !prefsErr, prefsErr?.message)

  section('the change is recorded')
  const { data: events } = await admin.from('audit_events')
    .select('action').eq('subject_id', ids.target).in('action', ['profile.deactivated', 'profile.reactivated'])
  check('switching access off is audited', (events ?? []).some((e) => e.action === 'profile.deactivated'))
  check('restoring it is audited', (events ?? []).some((e) => e.action === 'profile.reactivated'))

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed - deactivation genuinely revokes access, and reverses cleanly.')
  }
} catch (e) {
  console.error('deactivation harness error:', e.message)
  process.exitCode = 1
} finally {
  const sweep = async (label, fn) => {
    try { const { error } = await fn(); if (error) console.error(`  cleanup ${label}: ${error.message}`) }
    catch (e) { console.error(`  cleanup ${label}: ${e.message}`) }
  }
  if (boardId) await sweep('board', () => admin.from('boards').delete().eq('id', boardId))
  for (const [tag, id] of Object.entries(ids)) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) { console.error(`  cleanup user ${tag}: ${error.message}`); process.exitCode = 1 }
  }
  await sweep('audit rows', () => admin.from('audit_events').delete().like('summary', 'Deact %'))
  console.log('cleaned up test fixtures.')
}
