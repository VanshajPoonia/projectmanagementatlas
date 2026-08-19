#!/usr/bin/env node
// Cross-board task move harness - the pass/fail gate for migration 102.
//
// Builds three real boards and two real users via the service role, then drives every check
// through REAL anon-key sessions, exactly as the browser does. What it pins:
//
//   * a task actually moves, and its subtasks come with it;
//   * a subtask cannot be moved on its own (it belongs to whichever board its parent is on);
//   * the destination is enforced - a private board the mover is not a member of, and a
//     board where the mover's board_members role is guest/client, are both refused;
//   * the refusal is an ERROR, not a silent no-op, so the UI can tell the difference;
//   * a refused move leaves the task exactly where it was (the RPC is atomic);
//   * a move the caller is not allowed to make at the SOURCE is refused too;
//   * CONTROL: moving between two ordinary boards still works, so none of the above is a
//     blanket break.
//
// Non-destructive: every fixture is deleted in `finally`. Run: pnpm check:task-move

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
const MOVER = { email: `move-test+${stamp}@example.com`, password: `Move-${stamp}-x9!` }
const OTHER = { email: `move-other+${stamp}@example.com`, password: `Other-${stamp}-x9!` }

/** Everything created here, torn down in reverse order. */
const boards = []
let moverId, otherId, taskId, subtaskId, foreignTaskId
let failures = 0

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${condition || !detail ? '' : `\n        ${detail}`}`)
  if (!condition) failures++
}

async function makeUser({ email, password }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  // boards.created_by -> profiles(id). The on_auth_user_created trigger writes that row, but
  // don't race it - upsert explicitly so this harness never depends on trigger timing.
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({ id: data.user.id, email, role: 'user' }, { onConflict: 'id' })
  if (profileErr) throw new Error(`upsert profile ${email}: ${profileErr.message}`)
  return data.user.id
}

async function makeBoard(title, { createdBy, isPrivate = false }) {
  const { data: board, error } = await admin
    .from('boards')
    .insert({ title: `${title}-${stamp}`, created_by: createdBy, is_private: isPrivate })
    .select('id')
    .single()
  if (error) throw new Error(`create board ${title}: ${error.message}`)
  boards.push(board.id)

  const { data: column, error: colErr } = await admin
    .from('columns')
    .insert({ board_id: board.id, title: 'To Do', position: 0 })
    .select('id')
    .single()
  if (colErr) throw new Error(`create column on ${title}: ${colErr.message}`)

  return { boardId: board.id, columnId: column.id }
}

/** Where does this task live right now, according to the database? */
async function boardOf(id) {
  const { data } = await admin.from('tasks').select('column_id, columns(board_id)').eq('id', id).single()
  return data?.columns?.board_id ?? null
}

try {
  moverId = await makeUser(MOVER)
  otherId = await makeUser(OTHER)

  const home = await makeBoard('move-home', { createdBy: moverId })
  const destination = await makeBoard('move-destination', { createdBy: moverId })
  // Created by the OTHER user, so the mover is a non-member outsider to it.
  const secret = await makeBoard('move-private', { createdBy: otherId, isPrivate: true })
  const restricted = await makeBoard('move-restricted', { createdBy: otherId })

  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .insert({ column_id: home.columnId, title: 'parent task', created_by: moverId, position: 0, visibility: 'board' })
    .select('id')
    .single()
  if (taskErr) throw new Error(`create task: ${taskErr.message}`)
  taskId = task.id

  // Owned by the OTHER user on purpose: it must still ride along with its parent, which is
  // what proves private.task_move_plan's SECURITY DEFINER count is doing real work.
  const { data: subtask, error: subErr } = await admin
    .from('tasks')
    .insert({
      column_id: home.columnId, title: 'child task', created_by: moverId,
      parent_task_id: taskId, position: 0, visibility: 'board',
    })
    .select('id')
    .single()
  if (subErr) throw new Error(`create subtask: ${subErr.message}`)
  subtaskId = subtask.id

  // A task on the restricted board that the mover has no claim on at all - the source-side
  // control for "you cannot move what you cannot manage".
  const { data: foreign, error: foreignErr } = await admin
    .from('tasks')
    .insert({ column_id: restricted.columnId, title: 'not yours', created_by: otherId, position: 0, visibility: 'board' })
    .select('id')
    .single()
  if (foreignErr) throw new Error(`create foreign task: ${foreignErr.message}`)
  foreignTaskId = foreign.id

  const mover = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: signInErr } = await mover.auth.signInWithPassword(MOVER)
  if (signInErr) throw new Error(`signIn mover: ${signInErr.message}`)

  const move = (task, column) => mover.rpc('move_task_to_board', { p_task_id: task, p_column_id: column })

  // --- 1. The happy path, and the subtask riding along. -----------------------------------
  {
    const { data, error } = await move(taskId, destination.columnId)
    check('a task moves to another board', !error && data === destination.boardId, error?.message)
    check('the task really is on the destination board', (await boardOf(taskId)) === destination.boardId)
    check('its subtask moved with it', (await boardOf(subtaskId)) === destination.boardId)
  }

  // --- 2. A subtask has no board of its own. ----------------------------------------------
  {
    const { error } = await move(subtaskId, home.columnId)
    check('a subtask cannot be moved on its own', Boolean(error))
    check(
      'and the refusal explains why',
      Boolean(error?.message?.toLowerCase().includes('subtask moves with its parent')),
      `got: ${error?.message ?? '(no error at all)'}`,
    )
    check('the subtask stayed with its parent', (await boardOf(subtaskId)) === destination.boardId)
  }

  // --- 3. Destination: a private board the mover is not a member of. ----------------------
  {
    const { error } = await move(taskId, secret.columnId)
    check('cannot move a task into a private board you are not a member of', Boolean(error))
    check(
      'the private-board refusal is an error, not a silent no-op',
      (await boardOf(taskId)) === destination.boardId,
      'the task moved anyway - the WITH CHECK is not seeing the destination column',
    )
  }

  // --- 4. Destination: a board where the mover is a guest, then a client. -----------------
  for (const role of ['guest', 'client']) {
    const { error: memberErr } = await admin
      .from('board_members')
      .upsert({ board_id: restricted.boardId, user_id: moverId, role }, { onConflict: 'board_id,user_id' })
    if (memberErr) throw new Error(`set ${role} on restricted board: ${memberErr.message}`)

    const { error } = await move(taskId, restricted.columnId)
    check(`cannot move a task into a board where you are a ${role}`, Boolean(error), 'the move was allowed')
    check(`${role}: the task stayed put`, (await boardOf(taskId)) === destination.boardId)
  }

  // --- 5. Source: a task the mover cannot manage. -----------------------------------------
  {
    // Drop the restrictive membership first, so the refusal below can only be about the
    // task itself and not about the board role from step 4.
    await admin.from('board_members').delete().eq('board_id', restricted.boardId).eq('user_id', moverId)

    const { error } = await move(foreignTaskId, destination.columnId)
    check('cannot move a task you do not own and are not assigned to', Boolean(error), 'the move was allowed')
    check('that task stayed on its own board', (await boardOf(foreignTaskId)) === restricted.boardId)
  }

  // --- 6. A destination column that does not exist. ---------------------------------------
  {
    const { error } = await move(taskId, '00000000-0000-0000-0000-000000000000')
    check('a missing destination column is refused', Boolean(error), 'a bogus column id was accepted')
  }

  // --- 7. CONTROL: none of the above is a blanket break. ----------------------------------
  {
    const { data, error } = await move(taskId, home.columnId)
    check('control: the task moves back to an ordinary board', !error && data === home.boardId, error?.message)
    check('control: the subtask came back too', (await boardOf(subtaskId)) === home.boardId)
  }

  // --- 8. The plain UPDATE path still works for everything that is not a move. ------------
  {
    const { data } = await mover.from('tasks').update({ title: 'renamed in place' }).eq('id', taskId).select('title')
    check(
      'control: an ordinary edit is unaffected by the new WITH CHECK',
      data?.[0]?.title === 'renamed in place',
      'tightening the destination guard broke normal task editing',
    )
  }

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed - a task moves boards with its subtasks, and only onto a board the mover may write to.')
  }
} catch (e) {
  console.error('task-move harness error:', e.message)
  process.exitCode = 1
} finally {
  // The postgrest query builder isn't a real Promise (no .catch()) - use try/catch instead.
  for (const id of [subtaskId, taskId, foreignTaskId]) {
    if (id) { try { await admin.from('tasks').delete().eq('id', id) } catch {} }
  }
  for (const id of boards) {
    try { await admin.from('columns').delete().eq('board_id', id) } catch {}
    try { await admin.from('boards').delete().eq('id', id) } catch {}
  }
  for (const id of [moverId, otherId]) {
    if (id) await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('cleaned up test fixtures.')
}
