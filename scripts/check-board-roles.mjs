#!/usr/bin/env node
// Guest/client board-role verification harness — the pass/fail gate for migration 065
// (board_members.role). Creates one throwaway user + one throwaway board/column/task via the
// service role, gives the user each restricted role in turn, and asserts through a REAL anon-key
// session (exactly like the app) that they can view but cannot create/update/delete tasks on it.
// A 'member' control case proves the restriction is role-specific, not a blanket break.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:board-roles

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
const USER = { email: `role-test+${stamp}@example.com`, password: `Role-${stamp}-x9!` }

let userId, boardId, columnId, taskId
let failures = 0

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`)
  if (!condition) failures++
}

try {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: USER.email, password: USER.password, email_confirm: true,
  })
  if (createErr) throw new Error(`createUser: ${createErr.message}`)
  userId = created.user.id

  // boards.created_by -> profiles(id), not auth.users(id) directly. The on_auth_user_created
  // trigger creates the profiles row, but don't race it — upsert explicitly so this harness
  // doesn't depend on trigger timing.
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({ id: userId, email: USER.email, role: 'user' }, { onConflict: 'id' })
  if (profileErr) throw new Error(`upsert profile: ${profileErr.message}`)

  const { data: board, error: boardErr } = await admin
    .from('boards')
    .insert({ title: `role-test-board-${stamp}`, created_by: userId, is_private: false })
    .select('id')
    .single()
  if (boardErr) throw new Error(`create board: ${boardErr.message}`)
  boardId = board.id

  const { data: column, error: colErr } = await admin
    .from('columns')
    .insert({ board_id: boardId, title: 'To Do', position: 0 })
    .select('id')
    .single()
  if (colErr) throw new Error(`create column: ${colErr.message}`)
  columnId = column.id

  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .insert({ column_id: columnId, title: 'original title', created_by: userId, position: 0 })
    .select('id')
    .single()
  if (taskErr) throw new Error(`create task: ${taskErr.message}`)
  taskId = task.id

  const userClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: signInErr } = await userClient.auth.signInWithPassword(USER)
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`)

  async function setRole(role) {
    const { error } = await admin
      .from('board_members')
      .upsert({ board_id: boardId, user_id: userId, role }, { onConflict: 'board_id,user_id' })
    if (error) throw new Error(`set role ${role}: ${error.message}`)
  }

  async function resetTitle() {
    await admin.from('tasks').update({ title: 'original title' }).eq('id', taskId)
  }

  for (const role of ['guest', 'client']) {
    await setRole(role)

    const { data: seen } = await userClient.from('tasks').select('id').eq('id', taskId)
    check(`${role}: can view the task`, (seen ?? []).length === 1)

    await resetTitle()
    const { data: updated } = await userClient.from('tasks').update({ title: 'hijacked' }).eq('id', taskId).select('title')
    check(`${role}: cannot update the task`, (updated ?? []).length === 0)

    const { data: inserted } = await userClient
      .from('tasks')
      .insert({ column_id: columnId, title: 'sneaked in', created_by: userId, position: 1 })
      .select('id')
    check(`${role}: cannot create a task on the board`, (inserted ?? []).length === 0)

    const { data: deleted } = await userClient.from('tasks').delete().eq('id', taskId).select('id')
    check(`${role}: cannot delete the task`, (deleted ?? []).length === 0)
  }

  // Control: a plain 'member' CAN still update — proves the restriction is role-specific.
  await setRole('member')
  await resetTitle()
  const { data: memberUpdated } = await userClient.from('tasks').update({ title: 'member edit' }).eq('id', taskId).select('title')
  check(`member (control): CAN update the task`, memberUpdated?.[0]?.title === 'member edit')

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed — guest/client roles are read-only, member is unaffected.')
  }
} catch (e) {
  console.error('board-role harness error:', e.message)
  process.exitCode = 1
} finally {
  // The postgrest query builder isn't a real Promise (no .catch()) — use try/catch instead.
  if (taskId) { try { await admin.from('tasks').delete().eq('id', taskId) } catch {} }
  if (columnId) { try { await admin.from('columns').delete().eq('id', columnId) } catch {} }
  if (boardId) { try { await admin.from('boards').delete().eq('id', boardId) } catch {} }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {})
  console.log('cleaned up test fixtures.')
}
