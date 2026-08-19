#!/usr/bin/env node
// The Prompt B access-control gate: the full permission matrix, verified against REAL RLS
// through real anon-key sessions, plus the audit trail from migration 098.
//
// scripts/check-board-roles.mjs already gates migration 065 narrowly (can a guest write?).
// This harness is the wider one the plan asks for, and it exists mainly because the narrow
// one passed while the feature was, in practice, broken: the roles it verified could not be
// granted from any UI, and the board-edit path silently reset them. A harness that only
// tests the database can be fully green while the product is not.
//
// Covers, per the plan's test matrix:
//   regular member · guest · client · admin · super-admin · removed member · private board
//   direct URL access (= reading a row by id, which is all a URL ultimately does)
//   mutation without UI (every check here is a raw PostgREST call, by construction)
//   cross-board access · role change during an active session
// Plus three regressions specific to defects found while writing this slice:
//   role preservation across an unrelated board edit, the non-creator silent-failure,
//   and direct public-share insertion after a member is narrowed to guest/client.
//
// Non-destructive: everything it creates is removed in `finally`. Run: pnpm check:access-matrix

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

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()

let failures = 0
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${!condition && detail ? `  (${detail})` : ''}`)
  if (!condition) failures++
}
function section(name) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 66 - name.length))}`)
}

const people = {}      // label -> { id, email, password, client }
const created = { boards: [], columns: [], tasks: [], shareLinks: [] }

async function makePerson(label, platformRole) {
  const email = `matrix-${label}-${stamp}@goatlasgo.us`
  const password = `Matrix-${stamp}-x9!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser ${label}: ${error.message}`)
  // Don't race the on_auth_user_created trigger; set the role explicitly either way.
  const { error: pErr } = await admin.from('profiles')
    .upsert({ id: data.user.id, email, full_name: `Matrix ${label}`, role: platformRole }, { onConflict: 'id' })
  if (pErr) throw new Error(`profile ${label}: ${pErr.message}`)

  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: sErr } = await client.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`)

  people[label] = { id: data.user.id, email, password, client }
  return people[label]
}

// ⚠️ tasks.visibility DEFAULTs to 'assigned', not 'board'. A task left at the default is
// invisible to anyone who is not its creator, an assignee, or an admin - regardless of board
// membership. The first version of this harness omitted it and read the resulting "member
// cannot see the task" as a privacy bug, when it was the visibility feature working exactly
// as designed. Fixture tasks are board-visible so that membership is the variable under
// test; the 'assigned' case gets its own explicit checks below.
async function makeBoard(title, ownerId, isPrivate) {
  const { data: board, error } = await admin.from('boards')
    .insert({ title, created_by: ownerId, updated_by: ownerId, is_private: isPrivate })
    .select('id, title').single()
  if (error) throw new Error(`create board: ${error.message}`)
  created.boards.push(board.id)

  const { data: column, error: cErr } = await admin.from('columns')
    .insert({ board_id: board.id, title: 'To Do', position: 0 }).select('id').single()
  if (cErr) throw new Error(`create column: ${cErr.message}`)
  created.columns.push(column.id)

  const { data: task, error: tErr } = await admin.from('tasks')
    .insert({ column_id: column.id, title: 'original title', created_by: ownerId, position: 0, visibility: 'board' })
    .select('id').single()
  if (tErr) throw new Error(`create task: ${tErr.message}`)
  created.tasks.push(task.id)

  // A second task left at the column default, so the two visibility modes can be compared
  // on identical membership.
  const { data: quiet, error: qErr } = await admin.from('tasks')
    .insert({ column_id: column.id, title: 'assigned-only task', created_by: ownerId, position: 1 })
    .select('id, visibility').single()
  if (qErr) throw new Error(`create assigned-only task: ${qErr.message}`)
  created.tasks.push(quiet.id)

  return { ...board, columnId: column.id, taskId: task.id, assignedOnlyTaskId: quiet.id }
}

const setRole = async (boardId, userId, role) => {
  const { error } = await admin.from('board_members')
    .upsert({ board_id: boardId, user_id: userId, role }, { onConflict: 'board_id,user_id' })
  if (error) throw new Error(`set role: ${error.message}`)
}
const dropMembership = async (boardId, userId) => {
  await admin.from('board_members').delete().eq('board_id', boardId).eq('user_id', userId)
}

/** Every write below goes straight at PostgREST - this IS the "mutation without UI" case. */
async function canRead(client, taskId) {
  const { data } = await client.from('tasks').select('id').eq('id', taskId)
  return (data ?? []).length === 1
}
async function canUpdate(client, taskId) {
  const { data } = await client.from('tasks').update({ title: `edit-${Math.random()}` }).eq('id', taskId).select('id')
  const ok = (data ?? []).length === 1
  await admin.from('tasks').update({ title: 'original title' }).eq('id', taskId)
  return ok
}
async function canCreate(client, columnId, userId) {
  const { data } = await client.from('tasks')
    .insert({ column_id: columnId, title: `probe-${stamp}`, created_by: userId, position: 99 }).select('id')
  const ids = (data ?? []).map((r) => r.id)
  if (ids.length) await admin.from('tasks').delete().in('id', ids)
  return ids.length === 1
}
async function canShare(client, resourceType, resourceId, userId) {
  const token = (randomUUID() + randomUUID()).replaceAll('-', '')
  const { data } = await client.from('share_links')
    .insert({ token, resource_type: resourceType, resource_id: resourceId, created_by: userId })
    .select('id')
  const ids = (data ?? []).map((row) => row.id)
  created.shareLinks.push(...ids)
  return ids.length === 1
}

try {
  await makePerson('member', 'user')
  await makePerson('guest', 'user')
  await makePerson('client', 'user')
  await makePerson('admin', 'admin')
  await makePerson('super', 'super_admin')
  await makePerson('outsider', 'user')

  // The owner of every fixture board. Board INSERT is admin-only (049), and 061 makes the
  // creator the sole owner of the membership list, so the owner must be an admin.
  const owner = await makePerson('owner', 'admin')

  const open = await makeBoard(`matrix-open-${stamp}`, owner.id, false)
  const secret = await makeBoard(`matrix-private-${stamp}`, owner.id, true)
  const other = await makeBoard(`matrix-other-${stamp}`, owner.id, false)

  // ── Baseline: an open board is readable and writable by any signed-in user ──────────
  section('regular member (no explicit membership row)')
  check('member: can read a task on an open board', await canRead(people.member.client, open.taskId))
  check('member: can create a task on an open board', await canCreate(people.member.client, open.columnId, people.member.id))
  // 035's can_manage_task: editing is for the creator, assignees and admins. A bystander
  // being unable to edit is correct, not a role restriction.
  check('member: cannot edit a task they neither created nor are assigned to',
    !(await canUpdate(people.member.client, open.taskId)))
  // The other half of the visibility feature, and the reason board membership alone is not
  // the whole access story: an 'assigned' task is private to its creator and assignees even
  // on a wide-open board.
  check('member: cannot read an assigned-only task they are not on',
    !(await canRead(people.member.client, open.assignedOnlyTaskId)))
  check('admin: CAN read an assigned-only task', await canRead(people.admin.client, open.assignedOnlyTaskId))

  // ── Restricted roles ───────────────────────────────────────────────────────────────
  for (const role of ['guest', 'client']) {
    section(`${role} on an open board`)
    await setRole(open.id, people[role].id, role)
    check(`${role}: can read the task`, await canRead(people[role].client, open.taskId))
    check(`${role}: cannot create a task`, !(await canCreate(people[role].client, open.columnId, people[role].id)))
    check(`${role}: cannot edit the task`, !(await canUpdate(people[role].client, open.taskId)))
    const { data: deleted } = await people[role].client.from('tasks').delete().eq('id', open.taskId).select('id')
    check(`${role}: cannot delete the task`, (deleted ?? []).length === 0)
  }

  // The restriction must be about the ROW, not about the board being open or closed.
  section('restricted role on a private board')
  await setRole(secret.id, people.guest.id, 'guest')
  check('guest: can read a private board they are a member of', await canRead(people.guest.client, secret.taskId))
  check('guest: still cannot write on it', !(await canCreate(people.guest.client, secret.columnId, people.guest.id)))

  // ── Admin and super-admin ──────────────────────────────────────────────────────────
  section('admin / super-admin')
  check('admin: can edit any task on an open board', await canUpdate(people.admin.client, open.taskId))
  check('super_admin: can edit any task on an open board', await canUpdate(people.super.client, open.taskId))

  // 061 removed the admin bypass on private boards on purpose: an admin who could re-add
  // themselves made "remove this admin" meaningless. Role alone grants nothing here.
  check('admin: CANNOT read a private board they are not a member of',
    !(await canRead(people.admin.client, secret.taskId)))
  check('super_admin: CANNOT read a private board they are not a member of',
    !(await canRead(people.super.client, secret.taskId)))

  // An admin who holds a restricted role is restricted. task_restricted_by_board_role is
  // ANDed on top of can_manage_task, so it can only ever remove access - including theirs.
  await setRole(open.id, people.admin.id, 'guest')
  check('admin marked as a guest: loses write access on that board',
    !(await canCreate(people.admin.client, open.columnId, people.admin.id)))
  await dropMembership(open.id, people.admin.id)
  check('admin: regains write access once the guest row is removed',
    await canCreate(people.admin.client, open.columnId, people.admin.id))

  // ── Public share links (migration 109) ─────────────────────────────────────────────
  section('public share links respect board role')
  // Create a task while the actor is a full member, then change only their board role.
  // This is the exact B3a regression: task ownership must not outlive the share capability.
  const { data: memberTask, error: memberTaskError } = await people.member.client.from('tasks')
    .insert({
      column_id: other.columnId,
      title: `share-role-fixture-${stamp}`,
      created_by: people.member.id,
      position: 7,
      visibility: 'board',
    })
    .select('id')
    .single()
  if (memberTaskError) throw new Error(`create share-role fixture: ${memberTaskError.message}`)
  created.tasks.push(memberTask.id)

  await dropMembership(other.id, people.member.id)
  check('task creator with no membership row: can create a public task link',
    await canShare(people.member.client, 'task', memberTask.id, people.member.id))
  check('unrelated member: cannot create a public link for someone else\'s task',
    !(await canShare(people.outsider.client, 'task', memberTask.id, people.outsider.id)))

  for (const role of ['guest', 'client']) {
    await setRole(other.id, people.member.id, role)
    check(`task creator narrowed to ${role}: cannot create a public task link`,
      !(await canShare(people.member.client, 'task', memberTask.id, people.member.id)))
  }
  await setRole(other.id, people.member.id, 'member')
  check('task creator restored to member: can share again on the next request',
    await canShare(people.member.client, 'task', memberTask.id, people.member.id))

  await dropMembership(open.id, people.admin.id)
  check('admin with no restricted row: can create a public task link',
    await canShare(people.admin.client, 'task', open.taskId, people.admin.id))
  check('admin with no restricted row: can create a public board link',
    await canShare(people.admin.client, 'board', open.id, people.admin.id))
  check('private-board creator: can still create a public board link',
    await canShare(owner.client, 'board', secret.id, owner.id))
  check('private-task creator: can still create a public task link',
    await canShare(owner.client, 'task', secret.taskId, owner.id))
  for (const role of ['guest', 'client']) {
    await setRole(open.id, people.admin.id, role)
    check(`admin narrowed to ${role}: cannot create a public task link`,
      !(await canShare(people.admin.client, 'task', open.taskId, people.admin.id)))
    check(`admin narrowed to ${role}: cannot create a public board link`,
      !(await canShare(people.admin.client, 'board', open.id, people.admin.id)))
  }
  await dropMembership(open.id, people.admin.id)

  // ── Private boards / direct URL access ─────────────────────────────────────────────
  section('private board + direct URL access')
  check('outsider: cannot read a private board task by id', !(await canRead(people.outsider.client, secret.taskId)))
  const { data: boardByUrl } = await people.outsider.client.from('boards').select('id').eq('id', secret.id)
  check('outsider: cannot fetch the private board itself by id', (boardByUrl ?? []).length === 0)
  // Migration 099. Before it, `columns` still carried 001's "any signed-in user" SELECT
  // policy, so the titles and order of a private board's columns were readable by anyone
  // with the board id - the structure of private work, if not its contents.
  const { data: colByUrl } = await people.outsider.client.from('columns').select('id').eq('board_id', secret.id)
  check('outsider: cannot enumerate the private board\'s columns', (colByUrl ?? []).length === 0)
  check('admin: also cannot enumerate them, since role alone grants nothing on a private board',
    ((await people.admin.client.from('columns').select('id').eq('board_id', secret.id)).data ?? []).length === 0)
  // Control: the fix must be about privacy, not a blanket break of the board view.
  const { data: openCols } = await people.outsider.client.from('columns').select('id').eq('board_id', open.id)
  check('control: an open board\'s columns are still readable', (openCols ?? []).length === 1)
  const { data: memberCols } = await people.guest.client.from('columns').select('id').eq('board_id', secret.id)
  check('control: a member of the private board CAN read its columns', (memberCols ?? []).length === 1)
  check('outsider: cannot create a task in a private board\'s column',
    !(await canCreate(people.outsider.client, secret.columnId, people.outsider.id)))

  // ── Cross-board access ─────────────────────────────────────────────────────────────
  section('cross-board access')
  // The guest role is granted on `open`. It must not follow them to a different board.
  check('guest on one board: can still write on a DIFFERENT open board',
    await canCreate(people.guest.client, other.columnId, people.guest.id))

  // ── Role change during an active session ───────────────────────────────────────────
  section('role change during an active session')
  // Same client object, same JWT, no re-login. RLS is evaluated per request, so a role
  // change must bite immediately rather than at the next sign-in.
  await dropMembership(other.id, people.member.id)
  check('member: can write before the change', await canCreate(people.member.client, other.columnId, people.member.id))
  await setRole(other.id, people.member.id, 'guest')
  check('member -> guest: write is refused on the very next request, no re-login',
    !(await canCreate(people.member.client, other.columnId, people.member.id)))
  await setRole(other.id, people.member.id, 'member')
  check('guest -> member: write is restored on the very next request',
    await canCreate(people.member.client, other.columnId, people.member.id))

  // ── Removed member ─────────────────────────────────────────────────────────────────
  section('removed member')
  await setRole(secret.id, people.member.id, 'member')
  check('member of a private board: can read it', await canRead(people.member.client, secret.taskId))
  await dropMembership(secret.id, people.member.id)
  check('removed from a private board: access is gone on the next query',
    !(await canRead(people.member.client, secret.taskId)))

  // ── Regression: the board-edit path must not reset roles ───────────────────────────
  section('regression: an unrelated board edit must not change anyone\'s role')
  // The shipped bug: saving a board deleted every membership row and re-inserted it without
  // `role`, so editing the TITLE promoted a guest to a full member with write access.
  await setRole(open.id, people.guest.id, 'guest')
  const { error: titleErr } = await owner.client.from('boards')
    .update({ title: `matrix-open-renamed-${stamp}` }).eq('id', open.id)
  check('owner can rename their board', !titleErr, titleErr?.message)

  const { data: afterRename } = await admin.from('board_members')
    .select('role').eq('board_id', open.id).eq('user_id', people.guest.id).maybeSingle()
  check('guest role survives a board rename', afterRename?.role === 'guest', `role is now ${afterRename?.role ?? 'gone'}`)
  check('guest still cannot write after the rename',
    !(await canCreate(people.guest.client, open.columnId, people.guest.id)))

  // ── Regression: membership writes by a non-creator must not look successful ─────────
  section('regression: non-creator membership writes are visibly refused')
  // PostgREST reports no error for a DELETE/UPDATE that matches zero rows, so the UI has to
  // ask for the rows back and count them. These assertions pin the behaviour the UI relies on.
  const { data: delRows, error: delErr } = await people.admin.client.from('board_members')
    .delete().eq('board_id', open.id).eq('user_id', people.guest.id).select('user_id')
  check('non-creator admin: DELETE reports no error (this is why counting is required)', !delErr)
  check('non-creator admin: DELETE affects zero rows', (delRows ?? []).length === 0)

  const { data: insRows } = await people.admin.client.from('board_members')
    .insert({ board_id: open.id, user_id: people.outsider.id, role: 'member' }).select('user_id')
  check('non-creator admin: INSERT returns no rows', (insRows ?? []).length === 0)

  const { data: stillGuest } = await admin.from('board_members')
    .select('role').eq('board_id', open.id).eq('user_id', people.guest.id).maybeSingle()
  check('the membership list is genuinely unchanged by all of that', stillGuest?.role === 'guest')

  const { data: ownerDel } = await owner.client.from('board_members')
    .delete().eq('board_id', open.id).eq('user_id', people.guest.id).select('user_id')
  check('control: the board CREATOR can remove a member', (ownerDel ?? []).length === 1)

  // ── Audit trail (migration 098) ────────────────────────────────────────────────────
  section('audit events (migration 098)')
  const auditFor = async (entityId) => {
    const { data } = await admin.from('audit_events')
      .select('action, summary, subject_id, metadata').eq('entity_id', entityId)
      .order('occurred_at', { ascending: true })
    return data ?? []
  }

  await setRole(other.id, people.client.id, 'client')
  await setRole(other.id, people.client.id, 'guest')
  const events = await auditFor(other.id)
  check('adding a member records an event',
    events.some((e) => e.action === 'board_member.added' && e.subject_id === people.client.id))
  check('changing a role records an event',
    events.some((e) => e.action === 'board_member.role_changed' && e.subject_id === people.client.id))

  // Filter by subject as well as board: the session-role section above already produced
  // role_changed events for a different person on this same board, and matching only on
  // action picked up theirs.
  const roleChange = events.find(
    (e) => e.action === 'board_member.role_changed' && e.subject_id === people.client.id,
  )
  check('the role change records both ends of the transition',
    roleChange?.metadata?.from === 'client' && roleChange?.metadata?.to === 'guest',
    JSON.stringify(roleChange?.metadata))
  check('the summary names the person rather than an id',
    Boolean(roleChange?.summary?.includes('Matrix client')), roleChange?.summary)
  // "Do not expose security-sensitive internals in user-facing audit descriptions."
  check('the summary leaks no internals',
    !/policy|rls|auth\.uid|private\.|board_members|[0-9a-f]{8}-[0-9a-f]{4}/i.test(roleChange?.summary ?? ''),
    roleChange?.summary)

  await dropMembership(other.id, people.client.id)
  check('removing a member records an event',
    (await auditFor(other.id)).some((e) => e.action === 'board_member.removed' && e.subject_id === people.client.id))

  const beforeRoleChange = (await admin.from('audit_events').select('id', { count: 'exact', head: true })
    .eq('action', 'profile.role_changed')).count ?? 0
  await admin.from('profiles').update({ role: 'admin' }).eq('id', people.outsider.id)
  const afterRoleChange = (await admin.from('audit_events').select('id', { count: 'exact', head: true })
    .eq('action', 'profile.role_changed')).count ?? 0
  check('a platform role change records an event', afterRoleChange === beforeRoleChange + 1)

  // Updating a profile field that is not `role` must not generate noise.
  const beforeNoise = (await admin.from('audit_events').select('id', { count: 'exact', head: true })
    .eq('action', 'profile.role_changed')).count ?? 0
  await admin.from('profiles').update({ full_name: 'Renamed Person' }).eq('id', people.outsider.id)
  const afterNoise = (await admin.from('audit_events').select('id', { count: 'exact', head: true })
    .eq('action', 'profile.role_changed')).count ?? 0
  check('renaming a profile records NO role event', afterNoise === beforeNoise)

  section('audit log visibility')
  const { data: adminSees } = await people.admin.client.from('audit_events').select('id').limit(1)
  check('an admin can read the audit log', (adminSees ?? []).length === 1)
  const { data: superSees } = await people.super.client.from('audit_events').select('id').limit(1)
  check('a super_admin can read the audit log', (superSees ?? []).length === 1)
  const { data: userSees } = await people.member.client.from('audit_events').select('id').limit(1)
  check('a non-admin CANNOT read the audit log', (userSees ?? []).length === 0)

  // The log must not be forgeable by the people it is about.
  const { error: forgeErr } = await people.admin.client.from('audit_events')
    .insert({ action: 'forged', entity_type: 'board', summary: 'nothing to see here' })
  check('even an admin cannot write to the audit log', Boolean(forgeErr), 'insert was accepted')
  const { data: wiped } = await people.super.client.from('audit_events')
    .delete().eq('entity_id', other.id).select('id')
  check('even a super_admin cannot delete audit rows', (wiped ?? []).length === 0)

  // Anonymous access, per the 095 convention.
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: anonSees } = await anonClient.from('audit_events').select('id').limit(1)
  check('a signed-out visitor cannot read the audit log', (anonSees ?? []).length === 0)

  // Deleting a board must not fabricate "X was removed from the board" for every member.
  section('audit: cascade deletions are not recorded as decisions')
  const doomed = await makeBoard(`matrix-doomed-${stamp}`, owner.id, false)
  await setRole(doomed.id, people.member.id, 'guest')
  await admin.from('boards').delete().eq('id', doomed.id)
  created.boards = created.boards.filter((id) => id !== doomed.id)
  const doomedEvents = await auditFor(doomed.id)
  check('board deletion records an "added" event but no phantom "removed" event',
    doomedEvents.some((e) => e.action === 'board_member.added') &&
    !doomedEvents.some((e) => e.action === 'board_member.removed'),
    doomedEvents.map((e) => e.action).join(', '))

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed - the access matrix and audit trail behave as specified.')
  }
} catch (e) {
  console.error('access-matrix harness error:', e.message)
  process.exitCode = 1
} finally {
  // Order matters: tasks and columns reference boards, and boards reference profiles, so a
  // user deleted too early makes the board delete fail and leaves fixtures behind. A failure
  // here is reported loudly rather than swallowed - a silent cleanup failure is how the
  // teams harness ended up with four orphaned accounts.
  const cleanup = async (label, fn) => {
    try { const { error } = await fn(); if (error) console.error(`  cleanup ${label}: ${error.message}`) }
    catch (e) { console.error(`  cleanup ${label}: ${e.message}`) }
  }
  if (created.shareLinks.length) await cleanup('share links', () => admin.from('share_links').delete().in('id', created.shareLinks))
  if (created.tasks.length) await cleanup('tasks', () => admin.from('tasks').delete().in('id', created.tasks))
  if (created.columns.length) await cleanup('columns', () => admin.from('columns').delete().in('id', created.columns))
  if (created.boards.length) await cleanup('boards', () => admin.from('boards').delete().in('id', created.boards))
  for (const [label, person] of Object.entries(people)) {
    const { error } = await admin.auth.admin.deleteUser(person.id)
    if (error) {
      console.error(`  cleanup user ${label}: ${error.message}`)
      process.exitCode = 1
    }
  }
  // Audit rows are deliberately not FK'd to anything, so they outlive the fixtures and must
  // be swept explicitly. This is the audit log doing its job, not a leak.
  await cleanup('audit rows', () => admin.from('audit_events').delete().like('summary', '%Matrix %'))
  await cleanup('audit rows (renamed)', () => admin.from('audit_events').delete().like('summary', 'Renamed Person%'))
  console.log('cleaned up test fixtures.')
}
