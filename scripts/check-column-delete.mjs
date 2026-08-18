#!/usr/bin/env node
// Gate for "is this column empty?" — the question a client cannot answer (migration 108).
//
// board-view.tsx used to answer it from `column.tasks`, which is RLS-filtered.
// private.can_view_task hides ARCHIVED tasks from everyone except a super_admin, while
// deleting a column only needs private.is_admin_user(). So a plain admin looking at a column
// of archived work saw an empty column, confirmed "Remove this empty column?", and was
// refused by 074's trigger with a message contradicting the screen.
//
// This pins all three halves: the filtered view really is short, the honest count really is
// complete, and 074 really does refuse — because the count is only advice, and the trigger is
// what makes losing the work impossible.

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anon || !service) {
  console.error('missing Supabase environment variables')
  process.exit(1)
}

assertDevDatabase()

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()
const password = `Coldel-${stamp}-aA!`
const plainEmail = `coldel-admin+${stamp}@example.com`
const superEmail = `coldel-super+${stamp}@example.com`
const memberEmail = `coldel-member+${stamp}@example.com`

let boardId
const userIds = []
let failures = 0

const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}`); if (!ok) failures++ }

async function makeUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  const { error: pe } = await admin.from('profiles')
    .upsert({ id: data.user.id, email, role, is_active: true }, { onConflict: 'id' })
  if (pe) throw new Error(`profile: ${pe.message}`)
  userIds.push(data.user.id)
  return data.user.id
}

async function signIn(email) {
  const c = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in ${email}: ${error.message}`)
  return c
}

const countVia = async (client, columnId) => {
  const { data, error } = await client.rpc('board_column_task_count', { p_column_id: columnId })
  const row = Array.isArray(data) ? data[0] : data
  return { row, error }
}

try {
  const plainId = await makeUser(plainEmail, 'admin')
  const superId = await makeUser(superEmail, 'super_admin')
  await makeUser(memberEmail, 'user')

  const { data: board } = await admin.from('boards')
    .insert({ title: `coldel-${stamp}`, created_by: superId, updated_by: superId, is_private: false })
    .select().single()
  boardId = board.id

  const { data: archiveCol } = await admin.from('columns')
    .insert({ board_id: boardId, title: 'Cancelled', position: 0, status_key: 'cancelled' })
    .select().single()
  const { data: emptyCol } = await admin.from('columns')
    .insert({ board_id: boardId, title: 'Spare', position: 1, status_key: null })
    .select().single()

  // A task may only be archived once it is cancelled (074's CHECK), so this is the real path.
  const { data: tasks, error: taskError } = await admin.from('tasks').insert([1, 2, 3].map((n) => ({
    title: `archived work ${n} (${stamp})`,
    column_id: archiveCol.id, created_by: superId, priority: 3,
    status: 'cancelled', position: n, visibility: 'board',
  }))).select('id')
  if (taskError) throw new Error(`seed tasks: ${taskError.message}`)
  const { error: arcError } = await admin.from('tasks')
    .update({ archived_at: new Date().toISOString(), archived_by: superId })
    .in('id', tasks.map((t) => t.id))
  if (arcError) throw new Error(`archive: ${arcError.message}`)

  const plain = await signIn(plainEmail)
  const superUser = await signIn(superEmail)
  const member = await signIn(memberEmail)

  /* ── 1. the filtered view really is short ────────────────────────── */
  const visible = async (client) => {
    const { data } = await client.from('columns')
      .select('id, tasks!tasks_column_id_fkey(id)').eq('id', archiveCol.id).maybeSingle()
    return data?.tasks?.length ?? 0
  }
  check('a plain admin\'s board query shows the archived column as EMPTY', await visible(plain) === 0)
  check('a super_admin sees all three archived tasks', await visible(superUser) === 3)

  /* ── 2. the honest count is complete for both ────────────────────── */
  const asPlain = await countVia(plain, archiveCol.id)
  check('the RPC gives a plain admin the true total', !asPlain.error && asPlain.row?.total === 3)
  check('it breaks the total down as archived, not active',
    asPlain.row?.archived === 3 && asPlain.row?.active === 0 && asPlain.row?.deleted === 0)

  const asSuper = await countVia(superUser, archiveCol.id)
  check('a super_admin gets the same number', asSuper.row?.total === 3)

  const onEmpty = await countVia(plain, emptyCol.id)
  check('a genuinely empty column counts zero', onEmpty.row?.total === 0)

  /* ── 3. it is admin-only, and unreachable signed out ─────────────── */
  const asMember = await countVia(member, archiveCol.id)
  check('a non-admin cannot inspect a column', Boolean(asMember.error))

  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const asAnon = await countVia(anonClient, archiveCol.id)
  check('an unauthenticated caller cannot inspect a column', Boolean(asAnon.error))

  /* ── 4. the count is advice; 074 is the guarantee ────────────────── */
  // This is the part that matters most. If the trigger ever goes, the cascade destroys work
  // no matter how good the client's message is.
  const { error: refused } = await plain.from('columns').delete().eq('id', archiveCol.id)
  check('a plain admin is still refused at the database', Boolean(refused))
  const { count: survivors } = await admin.from('tasks')
    .select('id', { count: 'exact', head: true }).in('id', tasks.map((t) => t.id))
  check('every archived task survived the attempt', survivors === 3)

  const { error: superRefused } = await superUser.from('columns').delete().eq('id', archiveCol.id)
  check('not even a super_admin can delete a column with tasks in it', Boolean(superRefused))

  /* ── 5. an empty column still deletes ────────────────────────────── */
  const { error: emptyDeleteError } = await plain.from('columns').delete().eq('id', emptyCol.id)
  check('an actually-empty column still deletes cleanly', !emptyDeleteError)
  const { count: left } = await admin.from('columns')
    .select('id', { count: 'exact', head: true }).eq('id', emptyCol.id)
  check('and it is gone', left === 0)
} finally {
  if (boardId) await admin.from('boards').delete().eq('id', boardId)
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
