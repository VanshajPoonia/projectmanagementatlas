#!/usr/bin/env node
// Deleting a person must remove the account and keep the company's work (migration 100).
//
// Before 100 this was impossible twice over: `boards.created_by` and `tasks.created_by` were
// NOT NULL with an ON DELETE SET NULL rule, so Postgres aborted every delete of anyone who
// had created a board — which, since only admins create boards here, meant no admin could
// ever be deprovisioned. And where a delete did succeed, CASCADE quietly took the person's
// comments and any company-wide bookmarks they had made with them.
//
// This harness builds one person with one of everything, deletes them the way the app does,
// and asserts item by item what survived and what did not.
//
// Non-destructive: everything it creates is removed in `finally`. Run: pnpm check:deprovision

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !service) {
  console.error('missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

assertDevDatabase()

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const section = (n) => console.log(`\n── ${n} ${'─'.repeat(Math.max(0, 62 - n.length))}`)

const ids = {}
const made = { boards: [], bookmarks: [] }

async function makeUser(tag, role) {
  const email = `deprov-${tag}-${stamp}@goatlasgo.us`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: `Deprov-${stamp}-x9!`, email_confirm: true,
  })
  if (error) throw new Error(`createUser ${tag}: ${error.message}`)
  await admin.from('profiles')
    .upsert({ id: data.user.id, email, full_name: `Deprov ${tag}`, role }, { onConflict: 'id' })
  ids[tag] = data.user.id
  return data.user.id
}

try {
  const leaver = await makeUser('leaver', 'admin')
  const keeper = await makeUser('keeper', 'super_admin')

  // One of everything the leaver owns.
  const { data: board, error: bErr } = await admin.from('boards')
    .insert({ title: `deprov-board-${stamp}`, created_by: leaver, updated_by: leaver, is_private: true })
    .select('id').single()
  if (bErr) throw new Error(`board: ${bErr.message}`)
  made.boards.push(board.id)

  const { data: column } = await admin.from('columns')
    .insert({ board_id: board.id, title: 'To Do', position: 0 }).select('id').single()
  const { data: task } = await admin.from('tasks')
    .insert({ column_id: column.id, title: `deprov-task-${stamp}`, created_by: leaver, position: 0, visibility: 'board' })
    .select('id').single()
  const { data: comment } = await admin.from('task_comments')
    .insert({ task_id: task.id, user_id: leaver, author_id: leaver, comment: `deprov-comment-${stamp}` })
    .select('id').single()

  const { data: companyBookmark, error: cbErr } = await admin.from('bookmarks')
    .insert({ title: `deprov-company-${stamp}`, url: 'https://example.com', scope: 'company', created_by: leaver })
    .select('id').single()
  if (cbErr) throw new Error(`company bookmark: ${cbErr.message}`)
  made.bookmarks.push(companyBookmark.id)

  const { data: personalBookmark } = await admin.from('bookmarks')
    .insert({ title: `deprov-personal-${stamp}`, url: 'https://example.com', scope: 'personal', created_by: leaver, user_id: leaver })
    .select('id').single()
  const { data: personalTask } = await admin.from('personal_tasks')
    .insert({ user_id: leaver, title: `deprov-personal-task-${stamp}` }).select('id').single()

  await admin.from('board_members').insert({ board_id: board.id, user_id: leaver, role: 'member' })

  // ── The delete itself ───────────────────────────────────────────────────────────────
  section('the delete can even happen')
  // Board transfer first, exactly as app/api/admin/delete-user/route.ts does it. Without
  // this the private board would keep a NULL creator and its membership list could never be
  // changed again by anyone (061 has no admin bypass).
  const { data: transferred, error: tErr } = await admin.from('boards')
    .update({ created_by: keeper }).eq('created_by', leaver).select('id')
  check('their boards can be transferred to the deleting super admin', !tErr && transferred?.length === 1,
    tErr?.message ?? `transferred ${transferred?.length ?? 0}`)

  const { error: delErr } = await admin.auth.admin.deleteUser(leaver)
  // The whole point: this used to fail with "Database error deleting user" for anyone who
  // had ever created a board.
  check('the account deletes without a database error', !delErr, delErr?.message)

  const { data: goneProfile } = await admin.from('profiles').select('id').eq('id', leaver).maybeSingle()
  check('the profile is gone', goneProfile === null)

  // ── What must survive ───────────────────────────────────────────────────────────────
  section('their work is still here')
  const { data: keptBoard } = await admin.from('boards').select('id, created_by').eq('id', board.id).maybeSingle()
  check('the board survives', keptBoard != null)
  check('the board is now owned by the super admin, not orphaned', keptBoard?.created_by === keeper,
    `created_by is ${keptBoard?.created_by ?? 'null'}`)

  const { data: keptTask } = await admin.from('tasks').select('id, title, created_by').eq('id', task.id).maybeSingle()
  check('the task survives', keptTask != null)
  check('the task keeps its title', keptTask?.title === `deprov-task-${stamp}`)
  // Attribution goes to NULL rather than being reassigned: rewriting it would make the task
  // claim to have been written by whoever ran the deletion.
  check('the task is no longer attributed to anyone', keptTask?.created_by === null,
    `created_by is ${keptTask?.created_by}`)

  const { data: keptComment } = await admin.from('task_comments')
    .select('id, comment, user_id, author_id').eq('id', comment.id).maybeSingle()
  check('the comment survives', keptComment != null, 'it was CASCADE-deleted')
  check('the comment keeps its text', keptComment?.comment === `deprov-comment-${stamp}`)
  check('the comment is no longer attributed to anyone',
    keptComment?.user_id === null && keptComment?.author_id === null)

  const { data: keptBookmark } = await admin.from('bookmarks')
    .select('id, created_by').eq('id', companyBookmark.id).maybeSingle()
  check('the shared company bookmark survives', keptBookmark != null, 'it was CASCADE-deleted')
  check('the company bookmark is no longer attributed to anyone', keptBookmark?.created_by === null)

  // ── What must go ────────────────────────────────────────────────────────────────────
  section('their private things are gone')
  const { data: pTask } = await admin.from('personal_tasks').select('id').eq('id', personalTask.id).maybeSingle()
  check('their personal tasks are deleted', pTask === null)

  const { data: pBookmark } = await admin.from('bookmarks').select('id').eq('id', personalBookmark.id).maybeSingle()
  check('their personal bookmarks are deleted', pBookmark === null)

  const { data: membership } = await admin.from('board_members')
    .select('user_id').eq('board_id', board.id).eq('user_id', leaver).maybeSingle()
  check('their board memberships are deleted', membership === null)

  // ── The audit trail ─────────────────────────────────────────────────────────────────
  section('the deletion is recorded')
  const { data: events } = await admin.from('audit_events')
    .select('action, summary, metadata').eq('subject_id', leaver).eq('action', 'profile.deleted')
  check('deleting an account records an audit event', (events ?? []).length === 1,
    `found ${(events ?? []).length}`)
  check('the audit summary names them and says the work was kept',
    events?.[0]?.summary?.includes('Deprov leaver') && /kept/i.test(events?.[0]?.summary ?? ''),
    events?.[0]?.summary)
  // The row must outlive its subject, which is why actor_id/subject_id carry no foreign key.
  check('the audit row survives the person it is about', events?.[0] != null)

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed — the account goes, the work stays.')
  }
} catch (e) {
  console.error('deprovision harness error:', e.message)
  process.exitCode = 1
} finally {
  const sweep = async (label, fn) => {
    try { const { error } = await fn(); if (error) console.error(`  cleanup ${label}: ${error.message}`) }
    catch (e) { console.error(`  cleanup ${label}: ${e.message}`) }
  }
  if (made.bookmarks.length) await sweep('bookmarks', () => admin.from('bookmarks').delete().in('id', made.bookmarks))
  if (made.boards.length) {
    // Tasks and comments cascade with the board; columns do too.
    await sweep('boards', () => admin.from('boards').delete().in('id', made.boards))
  }
  for (const [tag, id] of Object.entries(ids)) {
    const { error } = await admin.auth.admin.deleteUser(id)
    // The leaver is already gone by design; only a surviving fixture is a problem.
    if (error && !/not found/i.test(error.message)) {
      console.error(`  cleanup user ${tag}: ${error.message}`)
      process.exitCode = 1
    }
  }
  await sweep('audit rows', () => admin.from('audit_events').delete().like('summary', 'Deprov %'))
  console.log('cleaned up test fixtures.')
}
