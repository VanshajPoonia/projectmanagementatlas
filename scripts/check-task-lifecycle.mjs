#!/usr/bin/env node
// End-to-end lifecycle/RLS verification for migration 074.
// Creates isolated fixtures in the allowlisted dev project, exercises mutations
// through real anon-key sessions, and removes every fixture in finally.

import { randomUUID } from 'node:crypto'
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

const serviceClient = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const stamp = Date.now()
const users = {
  owner: { email: `lifecycle-owner+${stamp}@example.com`, password: `Lifecycle-${stamp}-A!` },
  other: { email: `lifecycle-other+${stamp}@example.com`, password: `Lifecycle-${stamp}-B!` },
}

let ownerId
let otherId
let boardId
let taskId
let shareLinkId
let failures = 0

function check(label, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`)
  if (!condition) failures += 1
}

async function createUser(credentials) {
  const { data, error } = await serviceClient.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser: ${error.message}`)
  const userId = data.user.id
  const { error: profileError } = await serviceClient
    .from('profiles')
    .upsert({ id: userId, email: credentials.email, role: 'user' }, { onConflict: 'id' })
  if (profileError) throw new Error(`upsert profile: ${profileError.message}`)
  return userId
}

async function signedInClient(credentials) {
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword(credentials)
  if (error) throw new Error(`signIn: ${error.message}`)
  return client
}

try {
  ownerId = await createUser(users.owner)
  otherId = await createUser(users.other)
  const ownerClient = await signedInClient(users.owner)
  const otherClient = await signedInClient(users.other)

  const { data: board, error: boardError } = await serviceClient
    .from('boards')
    .insert({
      title: `lifecycle-test-${stamp}`,
      created_by: ownerId,
      is_private: false,
    })
    .select('id')
    .single()
  if (boardError) throw new Error(`create board: ${boardError.message}`)
  boardId = board.id

  const { data: columns, error: columnsError } = await serviceClient
    .from('columns')
    .insert([
      { board_id: boardId, title: 'To Do', position: 0, status_key: 'to_do' },
      { board_id: boardId, title: 'Completed', position: 1, status_key: 'done' },
      { board_id: boardId, title: 'Cancelled', position: 2, status_key: 'cancelled' },
    ])
    .select('id, status_key')
  if (columnsError) throw new Error(`create columns: ${columnsError.message}`)
  const columnByStatus = Object.fromEntries(columns.map((column) => [column.status_key, column.id]))

  const { data: task, error: taskError } = await ownerClient
    .from('tasks')
    .insert({
      column_id: columnByStatus.to_do,
      title: 'Lifecycle fixture',
      created_by: ownerId,
      position: 0,
      status: 'to_do',
    })
    .select('id, column_id, status')
    .single()
  if (taskError) throw new Error(`create task: ${taskError.message}`)
  taskId = task.id
  check('task starts aligned to To Do', task.column_id === columnByStatus.to_do && task.status === 'to_do')

  const { data: initialEvents } = await ownerClient
    .from('task_activity')
    .select('event_type, from_value, to_value')
    .eq('task_id', taskId)
  check(
    'task creation records structured status initialization',
    initialEvents?.some((event) => event.event_type === 'task.status_initialized') === true,
  )

  const { data: completed, error: completeError } = await ownerClient
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', taskId)
    .select('column_id, status')
    .single()
  if (completeError) throw new Error(`complete task: ${completeError.message}`)
  check(
    'status-only update moves the card to its linked column',
    completed.status === 'done' && completed.column_id === columnByStatus.done,
  )

  const { data: statusEvents } = await ownerClient
    .from('task_activity')
    .select('event_type, metadata')
    .eq('task_id', taskId)
    .eq('event_type', 'task.status_changed')
  check(
    'status transition is recorded exactly once by the database',
    statusEvents?.length === 1,
    `${statusEvents?.length ?? 0} rows`,
  )

  const { error: cancelError } = await ownerClient
    .from('tasks')
    .update({ column_id: columnByStatus.cancelled })
    .eq('id', taskId)
  if (cancelError) throw new Error(`cancel task: ${cancelError.message}`)

  const { data: ownerVisibleAfterCancel } = await ownerClient
    .from('tasks')
    .select('id')
    .eq('id', taskId)
  check('cancelled task is hidden from a normal user', ownerVisibleAfterCancel?.length === 0)

  await ownerClient
    .from('tasks')
    .update({ column_id: columnByStatus.to_do, status: 'to_do', archived_at: null, archived_by: null })
    .eq('id', taskId)
  const { data: stillArchived } = await serviceClient
    .from('tasks')
    .select('archived_at, column_id')
    .eq('id', taskId)
    .single()
  check(
    'normal user cannot restore an archived task',
    Boolean(stillArchived.archived_at) && stillArchived.column_id === columnByStatus.cancelled,
  )

  const { error: promoteError } = await serviceClient
    .from('profiles')
    .update({ role: 'super_admin' })
    .eq('id', ownerId)
  if (promoteError) throw new Error(`promote owner: ${promoteError.message}`)

  const { data: restored, error: restoreError } = await ownerClient
    .from('tasks')
    .update({ column_id: columnByStatus.to_do, status: 'to_do', archived_at: null, archived_by: null })
    .eq('id', taskId)
    .select('archived_at, column_id, status')
    .single()
  if (restoreError) throw new Error(`restore task: ${restoreError.message}`)
  check(
    'super admin can restore an archived task',
    restored.archived_at === null
      && restored.column_id === columnByStatus.to_do
      && restored.status === 'to_do',
  )

  const { error: demoteError } = await serviceClient
    .from('profiles')
    .update({ role: 'user' })
    .eq('id', ownerId)
  if (demoteError) throw new Error(`demote owner: ${demoteError.message}`)

  const { error: deleteError } = await ownerClient
    .from('tasks')
    .delete()
    .eq('id', taskId)
  const { data: retainedTask } = await serviceClient
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .maybeSingle()
  check('authenticated hard delete is denied', Boolean(deleteError) && retainedTask?.id === taskId)

  const unauthorizedToken = randomUUID().replaceAll('-', '')
  const { error: unauthorizedShareError } = await otherClient
    .from('share_links')
    .insert({
      token: unauthorizedToken,
      resource_type: 'task',
      resource_id: taskId,
      created_by: otherId,
    })
  check('unrelated user cannot share someone else’s task', Boolean(unauthorizedShareError))

  const authorizedToken = randomUUID().replaceAll('-', '')
  const { data: link, error: shareError } = await ownerClient
    .from('share_links')
    .insert({
      token: authorizedToken,
      resource_type: 'task',
      resource_id: taskId,
      created_by: ownerId,
    })
    .select('id')
    .single()
  if (shareError) throw new Error(`create authorized share: ${shareError.message}`)
  shareLinkId = link.id
  check('task creator can create a share link', Boolean(shareLinkId))

  const { error: makeAdminError } = await serviceClient
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', otherId)
  if (makeAdminError) throw new Error(`promote revoker: ${makeAdminError.message}`)

  const revokedAt = new Date().toISOString()
  const { data: revoked, error: revokeError } = await otherClient
    .from('share_links')
    .update({ revoked_at: revokedAt })
    .eq('id', shareLinkId)
    .select('revoked_at')
    .single()
  if (revokeError) throw new Error(`admin revoke: ${revokeError.message}`)
  check('admin can revoke another creator’s link', Boolean(revoked.revoked_at))

  console.log('')
  if (failures > 0) {
    console.log(`${failures} lifecycle check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All lifecycle checks passed.')
  }
} catch (error) {
  console.error('task-lifecycle harness error:', error.message)
  process.exitCode = 1
} finally {
  if (shareLinkId) {
    try { await serviceClient.from('share_links').delete().eq('id', shareLinkId) } catch {}
  }
  if (taskId) {
    try { await serviceClient.from('tasks').delete().eq('id', taskId) } catch {}
  }
  if (boardId) {
    try { await serviceClient.from('boards').delete().eq('id', boardId) } catch {}
  }
  if (ownerId) await serviceClient.auth.admin.deleteUser(ownerId).catch(() => {})
  if (otherId) await serviceClient.auth.admin.deleteUser(otherId).catch(() => {})
  console.log('cleaned up lifecycle fixtures.')
}
