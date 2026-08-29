#!/usr/bin/env node
// Agile-mode harness - the pass/fail gate for migrations 123, 124, 125 and 126.
//
//   123  board_agile_settings, sprints, sprint_items, tasks.estimate_value, columns.wip_limit
//   124  sprint_metrics (frozen), sprint_burndown_samples, the sampling functions
//   125  the WIP enforcement trigger on tasks (dev only - NOT --allow-prod eligible)
//   126  wip_enforcement_installed()
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the way
// the app reaches the database - never through the service role, which bypasses RLS and would
// pass whatever the policies said. The service role builds and tears down fixtures only.
//
// Every restriction has a CONTROL case proving it is specific rather than a blanket break: a
// harness that only shows refusals cannot tell a working permission apart from a broken table.
//
// ⚠️ Where a guarantee is "the constraint refuses this", the harness TRIES THE BAD WRITE. 117's
// lesson: "the constraint exists" and "the constraint refuses this" are different claims, and a
// CHECK whose expression is NULL passes on the very value it was written to reject.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:agile

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
function section(name) { console.log(`\n--- ${name} ---`) }

/** A write RLS refused: PostgREST reports either an error or, for a filtered row, nothing. */
const refused = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0)
const landed = (res) => !res.error && Array.isArray(res.data) && res.data.length > 0

const users = []
async function makeUser(tag, role = 'user') {
  const email = `agile-${tag}+${stamp}@example.com`
  const password = `Ag-${stamp}-${tag}!x9`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser(${tag}): ${error.message}`)
  const id = data.user.id
  const { error: pErr } = await admin
    .from('profiles')
    .upsert({ id, email, full_name: `Agile ${tag}`, role, is_active: true }, { onConflict: 'id' })
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
    .from('boards').insert({ title: `${title}-${stamp}`, created_by: createdBy, ...extra })
    .select('id').single()
  if (error) throw new Error(`board(${title}): ${error.message}`)
  boards.push(data.id)
  const cols = {}
  for (const [i, [key, label]] of [['to_do', 'To Do'], ['in_progress', 'In Progress'], ['done', 'Completed']].entries()) {
    const { data: c, error: ce } = await admin
      .from('columns').insert({ board_id: data.id, title: label, position: i, status_key: key })
      .select('id').single()
    if (ce) throw new Error(`column(${label}): ${ce.message}`)
    cols[key] = c.id
  }
  return { boardId: data.id, columns: cols }
}

const tasks = []
async function makeTask(title, columnId, createdBy, extra = {}) {
  const { data, error } = await admin
    .from('tasks')
    // ⚠️ `status` is set to match the column. enforce_task_lifecycle REWRITES column_id on
    // INSERT when the two disagree, so seeding by column_id alone silently lands the row
    // somewhere else and every assertion downstream then tests the wrong fixture.
    .insert({ title: `${title}-${stamp}`, column_id: columnId, created_by: createdBy, position: 0, visibility: 'board', ...extra })
    .select('id, column_id').single()
  if (error) throw new Error(`task(${title}): ${error.message}`)
  tasks.push(data.id)
  return data
}

const sprintIds = []
async function makeSprint(boardId, title, extra = {}) {
  const { data, error } = await admin
    .from('sprints')
    .insert({ board_id: boardId, title: `${title}-${stamp}`, start_date: '2026-09-01', end_date: '2026-09-14', ...extra })
    .select('*').single()
  if (error) throw new Error(`sprint(${title}): ${error.message}`)
  sprintIds.push(data.id)
  return data
}

try {
  const owner = await makeUser('owner')
  const mate = await makeUser('mate')
  const guest = await makeUser('guest')
  const boss = await makeUser('boss', 'admin')
  const outsider = await makeUser('outsider')

  const { boardId, columns } = await makeBoard('agile-board', owner.id)
  const other = await makeBoard('agile-other', owner.id)
  const priv = await makeBoard('agile-private', owner.id, { is_private: true })

  // =======================================================================================
  section('123 - grants and RLS on the new tables')
  // =======================================================================================
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  for (const table of ['board_agile_settings', 'sprints', 'sprint_items', 'sprint_metrics', 'sprint_burndown_samples']) {
    const res = await anonClient.from(table).select('*').limit(1)
    check(`anon cannot read ${table}`, Boolean(res.error) || (res.data ?? []).length === 0)
  }

  // sprint_items must not be DELETE-able by a client: deleting the row is how a sprint's
  // history quietly becomes flattering.
  const settings = await admin.from('board_agile_settings')
    .insert({ board_id: boardId, is_enabled: true, terminology: 'cycle', estimate_unit: 'points' })
    .select('*').single()
  check('a board can be opted in to agile', !settings.error)

  // =======================================================================================
  section('123 - who may configure a board')
  // =======================================================================================
  const memberReads = await owner.client.from('board_agile_settings').select('board_id').eq('board_id', boardId)
  check('a member of the board reads its agile settings', (memberReads.data ?? []).length === 1)

  const memberWrites = await owner.client
    .from('board_agile_settings').update({ terminology: 'sprint' }).eq('board_id', boardId).select('board_id')
  check('a plain member cannot change them', refused(memberWrites))

  const adminWrites = await boss.client
    .from('board_agile_settings').update({ terminology: 'cycle' }).eq('board_id', boardId).select('board_id')
  check('CONTROL: an admin can - so the refusal above is role-specific, not a broken table', landed(adminWrites))

  const privSettings = await admin.from('board_agile_settings')
    .insert({ board_id: priv.boardId, is_enabled: true }).select('board_id').single()
  const adminOnPrivate = await boss.client
    .from('board_agile_settings').update({ terminology: 'sprint' }).eq('board_id', priv.boardId).select('board_id')
  check('an admin who is not a member of a PRIVATE board cannot configure it either', refused(adminOnPrivate),
    'The settings SELECT policy reads `boards` through the caller. RLS applies SELECT to an UPDATE, so an unreadable board matches zero rows.')

  const outsiderReadsPrivate = await outsider.client
    .from('board_agile_settings').select('board_id').eq('board_id', priv.boardId)
  check('an outsider cannot even read a private board’s agile settings', (outsiderReadsPrivate.data ?? []).length === 0)

  // =======================================================================================
  section('123 - sprints follow the board, and board roles')
  // =======================================================================================
  const memberCreates = await owner.client
    .from('sprints')
    .insert({ board_id: boardId, title: `member-made-${stamp}`, start_date: '2026-10-01', end_date: '2026-10-14' })
    .select('id')
  check('a member can create a sprint on a board they can see', landed(memberCreates))
  if (memberCreates.data?.[0]?.id) sprintIds.push(memberCreates.data[0].id)

  await admin.from('board_members').insert({ board_id: boardId, user_id: guest.id, role: 'guest' })
  const guestCreates = await guest.client
    .from('sprints')
    .insert({ board_id: boardId, title: `guest-made-${stamp}`, start_date: '2026-10-01', end_date: '2026-10-14' })
    .select('id')
  check('a GUEST cannot create a sprint - they are read-only on the board (065)', refused(guestCreates))

  const guestReads = await guest.client.from('sprints').select('id').eq('board_id', boardId)
  check('CONTROL: but a guest CAN read them - the restriction is on writing, not seeing', (guestReads.data ?? []).length > 0)

  const privSprint = await makeSprint(priv.boardId, 'secret')
  const outsiderReadsSprint = await outsider.client.from('sprints').select('id').eq('id', privSprint.id)
  check('a private board’s sprints are invisible to a non-member', (outsiderReadsSprint.data ?? []).length === 0)

  const outsiderCreates = await outsider.client
    .from('sprints').insert({ board_id: priv.boardId, title: `sneak-${stamp}`, start_date: '2026-10-01', end_date: '2026-10-14' })
    .select('id')
  check('and they cannot create one there', refused(outsiderCreates))

  // =======================================================================================
  section('123 - the sprint state machine')
  // =======================================================================================
  const bornClosed = await admin.from('sprints')
    .insert({ board_id: boardId, title: `born-closed-${stamp}`, start_date: '2026-09-01', end_date: '2026-09-14', state: 'completed' })
    .select('id')
  check('a sprint cannot be created already closed', Boolean(bornClosed.error))

  const backwards = await admin.from('sprints')
    .insert({ board_id: boardId, title: `backwards-${stamp}`, start_date: '2026-09-14', end_date: '2026-09-01' })
    .select('id')
  check('a sprint cannot end before it starts', Boolean(backwards.error))

  const sprint = await makeSprint(boardId, 'window-one')
  const second = await makeSprint(boardId, 'window-two', { start_date: '2026-09-15', end_date: '2026-09-28' })

  const started = await admin.from('sprints').update({ state: 'active' }).eq('id', sprint.id).select('state, activated_at').single()
  check('starting a sprint stamps activated_at', Boolean(started.data?.activated_at))

  const twoActive = await admin.from('sprints').update({ state: 'active' }).eq('id', second.id).select('id')
  check('a board cannot have two active sprints at once', Boolean(twoActive.error))

  // =======================================================================================
  section('123 - membership is a pointer, and it is policed')
  // =======================================================================================
  const t1 = await makeTask('work-one', columns.to_do, owner.id)
  const t2 = await makeTask('work-two', columns.to_do, owner.id)
  const t3 = await makeTask('work-three', columns.to_do, owner.id)
  const foreign = await makeTask('other-board-work', other.columns.to_do, owner.id)
  const sub = await makeTask('a-subtask', columns.to_do, owner.id, { parent_task_id: t1.id, type_key: 'subtask' })

  const crossBoard = await admin.from('sprint_items').insert({ sprint_id: sprint.id, task_id: foreign.id }).select('id')
  check('a sprint only holds work from its own board', Boolean(crossBoard.error))

  const subtaskIn = await admin.from('sprint_items').insert({ sprint_id: sprint.id, task_id: sub.id }).select('id')
  check('a SUBTASK cannot be planned in on its own - 113’s is_agile_eligible, finally consulted', Boolean(subtaskIn.error),
    'Its parent already carries it; counting both double-counts every estimate in the burndown.')

  const guestPlans = await guest.client.from('sprint_items').insert({ sprint_id: sprint.id, task_id: t1.id }).select('id')
  check('a guest cannot plan work into a sprint', refused(guestPlans))

  const ownerPlans = await owner.client.from('sprint_items').insert({ sprint_id: sprint.id, task_id: t1.id }).select('id, committed')
  check('CONTROL: the task’s owner can - the refusal above is role-specific', landed(ownerPlans))
  check('work joining a RUNNING sprint is NOT counted as committed', ownerPlans.data?.[0]?.committed === false,
    'It is scope added. A caller that could set its own commitment flag could make any sprint look fully delivered.')

  // Commitment is stamped at ACTIVATION, by the database, in the same transaction - never at
  // insert. This is the only writer of `committed = true` anywhere.
  // ⚠️ On the OTHER board, deliberately: `sprint` is already running on this one, and the
  // one-active-sprint-per-board index would refuse the activation below. A silent refusal
  // there would have made the next two assertions pass or fail for the wrong reason.
  const planned = await makeSprint(other.boardId, 'planned-window', { start_date: '2026-11-01', end_date: '2026-11-14' })
  const p1 = await makeTask('planned-work-a', other.columns.to_do, owner.id)
  const p2 = await makeTask('planned-work-b', other.columns.to_do, owner.id)
  const preCommit = await admin.from('sprint_items').insert({ sprint_id: planned.id, task_id: p1.id }).select('id, committed').single()
  check('work added to a PLANNED sprint is not committed yet - nothing is, until it starts', preCommit.data?.committed === false)

  // The case that made stamping-at-insert wrong: joined before the start, left before the
  // start. It was never part of the commitment and must never be counted as one.
  const churned = await admin.from('sprint_items').insert({ sprint_id: planned.id, task_id: p2.id }).select('id').single()
  await admin.from('sprint_items').update({ removed_at: new Date().toISOString() }).eq('id', churned.data.id)

  const activation = await admin.from('sprints').update({ state: 'active' }).eq('id', planned.id).select('id')
  check('the planned sprint really activated - the assertions below are otherwise meaningless', landed(activation),
    activation.error?.message)
  const afterStart = await admin.from('sprint_items').select('committed').eq('sprint_id', planned.id).eq('task_id', p1.id).single()
  check('starting the sprint marks everything still in it as committed', afterStart.data?.committed === true)

  const churnedAfter = await admin.from('sprint_items').select('committed').eq('id', churned.data.id).single()
  check('but work removed BEFORE the start is not - it was never in the commitment', churnedAfter.data?.committed === false)

  await admin.from('sprints').update({ state: 'cancelled' }).eq('id', planned.id)

  // =======================================================================================
  section('123 - the ledger fields cannot be rewritten')
  // =======================================================================================
  const itemRow = await admin.from('sprint_items').select('id').eq('sprint_id', sprint.id).eq('task_id', t1.id).single()

  const forgeCommit = await owner.client
    .from('sprint_items').update({ committed: true }).eq('id', itemRow.data.id).select('id')
  check('nobody can flip `committed` by hand', Boolean(forgeCommit.error))

  const forgeAdded = await owner.client
    .from('sprint_items').update({ added_at: '2020-01-01T00:00:00Z' }).eq('id', itemRow.data.id).select('id')
  check('nor backdate when work joined', Boolean(forgeAdded.error))

  const forgeEstimate = await owner.client
    .from('sprint_items').update({ estimate_at_commit: 999 }).eq('id', itemRow.data.id).select('id')
  check('nor rewrite the estimate it joined with', Boolean(forgeEstimate.error))

  const hardDelete = await owner.client.from('sprint_items').delete().eq('id', itemRow.data.id).select('id')
  check('and nobody can DELETE a membership row - removal is a soft removal', refused(hardDelete))

  const softRemove = await owner.client
    .from('sprint_items').update({ removed_at: new Date().toISOString() }).eq('id', itemRow.data.id).select('id, removed_count')
  check('CONTROL: removing it IS allowed - so the refusals above are field-specific', landed(softRemove))
  check('and the removal is counted, so churn stays visible', softRemove.data?.[0]?.removed_count === 1)

  const reAdd = await owner.client
    .from('sprint_items').update({ removed_at: null }).eq('id', itemRow.data.id).select('removed_count')
  check('re-adding does NOT reset the churn count - the removal really happened', reAdd.data?.[0]?.removed_count === 1)

  // =======================================================================================
  section('124 - the metrics ledger is read-only and frozen')
  // =======================================================================================
  await admin.from('tasks').update({ estimate_value: 5 }).eq('id', t1.id)
  await admin.from('sprint_items').insert({ sprint_id: sprint.id, task_id: t3.id })
  await admin.from('tasks').update({ estimate_value: 3, column_id: columns.done, status: 'done' }).eq('id', t3.id)

  const completed = await admin.from('sprints').update({ state: 'completed' }).eq('id', sprint.id).select('closed_at').single()
  check('completing a sprint stamps closed_at', Boolean(completed.data?.closed_at))

  const snap = await admin.from('sprint_metrics').select('*').eq('sprint_id', sprint.id).maybeSingle()
  check('a snapshot is written the moment the sprint closes', Boolean(snap.data))
  check('and it counts completed work through 112’s CATEGORY, not a column title', Number(snap.data?.completed_estimate) === 3,
    `got ${snap.data?.completed_estimate}`)
  check('it records the unit the window was counted in', snap.data?.estimate_unit === 'points')
  check('and which records it counted', Array.isArray(snap.data?.included_task_ids) && snap.data.included_task_ids.length > 0)

  // THE guarantee: change everything afterwards, the snapshot must not move.
  const before = JSON.stringify(snap.data)
  await admin.from('tasks').update({ estimate_value: 999 }).eq('id', t3.id)
  await admin.from('tasks').update({ column_id: columns.to_do, status: 'to_do' }).eq('id', t3.id)
  const after = await admin.from('sprint_metrics').select('*').eq('sprint_id', sprint.id).maybeSingle()
  check('re-estimating and re-opening the work does NOT change the frozen numbers', JSON.stringify(after.data) === before,
    'This is the whole point of 124: a finished sprint must not silently change when current project structure does.')

  const writeSnap = await owner.client
    .from('sprint_metrics').update({ completed_estimate: 100 }).eq('sprint_id', sprint.id).select('sprint_id')
  check('a signed-in user cannot rewrite a frozen metric', refused(writeSnap))

  const insertSnap = await owner.client
    .from('sprint_metrics').insert({ sprint_id: second.id, final_state: 'completed', estimate_unit: 'points', terminology: 'sprint' }).select('sprint_id')
  check('nor forge one for a sprint that never closed', refused(insertSnap))

  const readSnap = await owner.client.from('sprint_metrics').select('sprint_id').eq('sprint_id', sprint.id)
  check('CONTROL: they CAN read it - the ledger is read-only, not invisible', (readSnap.data ?? []).length === 1)

  const outsiderSnap = await outsider.client.from('sprint_metrics').select('sprint_id').eq('sprint_id', privSprint.id)
  check('a private board’s metrics are invisible to a non-member', (outsiderSnap.data ?? []).length === 0)

  // =======================================================================================
  section('124 - membership freezes with the sprint')
  // =======================================================================================
  const lateJoin = await admin.from('sprint_items').insert({ sprint_id: sprint.id, task_id: t2.id }).select('id')
  check('nothing can join a CLOSED sprint', Boolean(lateJoin.error))

  const reopen = await admin.from('sprints').update({ state: 'active' }).eq('id', sprint.id).select('id')
  check('a closed sprint cannot be reopened', Boolean(reopen.error))

  const redate = await admin.from('sprints').update({ end_date: '2026-12-31' }).eq('id', sprint.id).select('id')
  check('nor re-dated - every recorded number is scoped to that window', Boolean(redate.error))

  // =======================================================================================
  section('124 - burndown sampling')
  // =======================================================================================
  const active = await makeSprint(boardId, 'sampling-window')
  await admin.from('sprints').update({ state: 'active' }).eq('id', active.id)
  await admin.from('sprint_items').insert({ sprint_id: active.id, task_id: t2.id })

  const s1 = await owner.client.rpc('sample_sprint_burndown', { p_sprint_id: active.id })
  check('a member can take a burndown sample', !s1.error, s1.error?.message)

  const s2 = await owner.client.rpc('sample_sprint_burndown', { p_sprint_id: active.id })
  const rows = await admin.from('sprint_burndown_samples').select('id').eq('sprint_id', active.id)
  check('sampling twice on one day produces ONE point, not two', (rows.data ?? []).length === 1,
    `got ${(rows.data ?? []).length}`)

  const outsiderSample = await outsider.client.rpc('sample_sprint_burndown', { p_sprint_id: privSprint.id })
  check('sampling a board you cannot see is refused', Boolean(outsiderSample.error))

  const writeSample = await owner.client
    .from('sprint_burndown_samples').update({ remaining_estimate: 0 }).eq('sprint_id', active.id).select('id')
  check('a signed-in user cannot rewrite a burndown point', refused(writeSample))

  const sweep = await owner.client.rpc('sample_all_active_sprints')
  check('and cannot run the cross-board sweep - it walks boards they can never see', Boolean(sweep.error))

  // =======================================================================================
  section('125/126 - WIP limits')
  // =======================================================================================
  const installed = await owner.client.rpc('wip_enforcement_installed')
  check('the interface can ask whether enforcement is really installed', !installed.error, installed.error?.message)
  const enforcementOn = installed.data === true

  await admin.from('columns').update({ wip_limit: 1 }).eq('id', columns.in_progress)
  const noLimit = await makeTask('wip-a', columns.to_do, owner.id)
  const fills = await makeTask('wip-b', columns.to_do, owner.id)

  // Warning mode first: the limit must NOT block.
  await admin.from('board_agile_settings').update({ wip_mode: 'warning' }).eq('board_id', boardId)
  const warnMoveA = await admin.from('tasks')
    .update({ column_id: columns.in_progress, status: 'in_progress' }).eq('id', noLimit.id).select('id')
  const warnMoveB = await admin.from('tasks')
    .update({ column_id: columns.in_progress, status: 'in_progress' }).eq('id', fills.id).select('id')
  check('CONTROL: in WARNING mode a full column still accepts work - "do not block by default"',
    landed(warnMoveA) && landed(warnMoveB))

  // Now enforcement.
  await admin.from('board_agile_settings').update({ wip_mode: 'enforcement' }).eq('board_id', boardId)
  await admin.from('tasks').update({ column_id: columns.to_do, status: 'to_do' }).eq('id', fills.id)

  const overLimit = await admin.from('tasks')
    .update({ column_id: columns.in_progress, status: 'in_progress' }).eq('id', fills.id).select('id')
  check('in ENFORCEMENT mode a move into a full column is refused BY THE DATABASE',
    enforcementOn ? Boolean(overLimit.error) : true,
    enforcementOn ? 'migration 125 is applied but the move was allowed' : 'skipped: 125 is not applied here')

  const inPlace = await admin.from('tasks').update({ priority: 2 }).eq('id', noLimit.id).select('id')
  check('but a task ALREADY in the full column can still be edited in place', landed(inPlace),
    'A limit governs arrivals. Refusing an unrelated edit would make a full column unusable.')

  await admin.from('columns').update({ wip_limit: null }).eq('id', columns.in_progress)
  const noLimitMove = await admin.from('tasks')
    .update({ column_id: columns.in_progress, status: 'in_progress' }).eq('id', fills.id).select('id')
  check('CONTROL: with the limit cleared the same move is allowed', landed(noLimitMove))

  const zeroLimit = await admin.from('columns').update({ wip_limit: 0 }).eq('id', columns.in_progress).select('id')
  check('a limit of zero is refused - that hides a column rather than limiting it', Boolean(zeroLimit.error))

  // =======================================================================================
  section('127 - capacity is enforced by the DATABASE when a board asks for it')
  // =======================================================================================
  // ⚠️ This section exists because `capacity_mode = 'enforcement'` was UI-deep when it shipped:
  // honoured by one React component and by nothing underneath it, so an import, psql or a
  // future automation could put a sprint over a capacity its own settings said to refuse. Same
  // defect as crm_statuses.requires_reason (104), profiles.is_active (101) and app_modules.
  const capBoard = await makeBoard('agile-capacity', owner.id)
  await admin.from('board_agile_settings')
    .insert({ board_id: capBoard.boardId, is_enabled: true, capacity_mode: 'warning', estimate_unit: 'points' })
  const capSprint = await makeSprint(capBoard.boardId, 'capacity-window', { capacity: 5 })

  const small = await makeTask('cap-small', capBoard.columns.to_do, owner.id, { estimate_value: 3 })
  const big = await makeTask('cap-big', capBoard.columns.to_do, owner.id, { estimate_value: 4 })
  const unsized = await makeTask('cap-unsized', capBoard.columns.to_do, owner.id)

  // Warning mode first - the default, and what Prompt G asks for.
  const warnFirst = await admin.from('sprint_items').insert({ sprint_id: capSprint.id, task_id: small.id }).select('id')
  const warnOver = await admin.from('sprint_items').insert({ sprint_id: capSprint.id, task_id: big.id }).select('id')
  check('CONTROL: in WARNING mode a sprint can be planned over its capacity - "do not block by default"',
    landed(warnFirst) && landed(warnOver), warnOver.error?.message)

  // Reset to just the 3-point item, then switch the board to enforcement.
  await admin.from('sprint_items').update({ removed_at: new Date().toISOString() })
    .eq('sprint_id', capSprint.id).eq('task_id', big.id)
  await admin.from('board_agile_settings').update({ capacity_mode: 'enforcement' }).eq('board_id', capBoard.boardId)

  // ⚠️ A FRESH task, with no membership row of its own. Reusing `big` here made the refusal
  // ambiguous: it already had a soft-removed row, so the INSERT would also have violated
  // sprint_items_unique - and because a BEFORE trigger runs ahead of the uniqueness check, the
  // test passed while proving nothing about capacity. A control that would pass for a second
  // reason is not a control.
  const fresh = await makeTask('cap-fresh', capBoard.columns.to_do, owner.id, { estimate_value: 4 })
  const blocked = await admin.from('sprint_items').insert({ sprint_id: capSprint.id, task_id: fresh.id }).select('id')
  check('in ENFORCEMENT mode work that would exceed capacity is refused BY THE DATABASE',
    Boolean(blocked.error), 'a service-role insert got past it, so no import or script would be stopped either')
  check('and the refusal names the numbers a person needs to act on',
    /capacity/i.test(blocked.error?.message ?? '') && /5/.test(blocked.error?.message ?? ''),
    blocked.error?.message)

  const unsizedIn = await admin.from('sprint_items').insert({ sprint_id: capSprint.id, task_id: unsized.id }).select('id')
  check('CONTROL: an UNESTIMATED item still goes in - it counts as zero, exactly as the screen says',
    landed(unsizedIn), unsizedIn.error?.message)

  const removeUnderEnforcement = await admin.from('sprint_items')
    .update({ removed_at: new Date().toISOString() })
    .eq('sprint_id', capSprint.id).eq('task_id', small.id).select('id')
  check('CONTROL: removal is never refused by the capacity rule - only an arrival can breach it',
    landed(removeUnderEnforcement), removeUnderEnforcement.error?.message)

  // Re-adding is an UPDATE clearing removed_at, never a second INSERT - 123 keeps the row so
  // the history survives. This exercises the trigger's UPDATE branch, which is the one that has
  // to tell a re-add apart from a removal and from the activation stamp.
  const nowFits = await admin.from('sprint_items').update({ removed_at: null })
    .eq('sprint_id', capSprint.id).eq('task_id', big.id).select('id')
  check('CONTROL: once there is room, re-adding the removed item is accepted',
    landed(nowFits), nowFits.error?.message)

  const reAddOver = await admin.from('sprint_items').update({ removed_at: null })
    .eq('sprint_id', capSprint.id).eq('task_id', small.id).select('id')
  check('but a RE-ADD that would breach capacity is refused too - it is an arrival like any other',
    Boolean(reAddOver.error), reAddOver.error?.message ?? 'the update was allowed')

  // Activation writes `committed` across every live row. If the capacity trigger fired on that
  // UPDATE it would refuse to start any sprint that is exactly at capacity - a deadlock the
  // "only an arrival" guard exists to prevent.
  const startFull = await admin.from('sprints').update({ state: 'active' }).eq('id', capSprint.id).select('state')
  check('a sprint AT capacity can still be started - the activation stamp is not an arrival',
    landed(startFull) && startFull.data?.[0]?.state === 'active', startFull.error?.message)

  const noCapBoard = await makeBoard('agile-nocap', owner.id)
  await admin.from('board_agile_settings')
    .insert({ board_id: noCapBoard.boardId, is_enabled: true, capacity_mode: 'enforcement' })
  const noCapSprint = await makeSprint(noCapBoard.boardId, 'no-capacity-window')
  const huge = await makeTask('nocap-huge', noCapBoard.columns.to_do, owner.id, { estimate_value: 9999 })
  const noCapIn = await admin.from('sprint_items').insert({ sprint_id: noCapSprint.id, task_id: huge.id }).select('id')
  check('CONTROL: with no capacity declared, enforcement has nothing to enforce', landed(noCapIn),
    noCapIn.error?.message)

  // =======================================================================================
  section('123 - estimates')
  // =======================================================================================
  const negative = await admin.from('tasks').update({ estimate_value: -1 }).eq('id', t1.id).select('id')
  check('an estimate cannot be negative', Boolean(negative.error))

  const zero = await admin.from('tasks').update({ estimate_value: 0 }).eq('id', t1.id).select('estimate_value')
  check('CONTROL: zero IS a valid estimate - it is a size, unlike absence', landed(zero))

  const guestEstimates = await guest.client.from('tasks').update({ estimate_value: 8 }).eq('id', t1.id).select('id')
  check('a guest cannot set an estimate - it is an edit to the work item (065)', refused(guestEstimates))

  const ownerEstimates = await owner.client.from('tasks').update({ estimate_value: 8 }).eq('id', t1.id).select('id')
  check('CONTROL: the task’s owner can', landed(ownerEstimates))

  // =======================================================================================
  section('deprovisioning - a departure must not destroy the record')
  // =======================================================================================
  const doomed = await makeUser('doomed')
  const doomedSprint = await makeSprint(boardId, 'left-behind', {
    start_date: '2027-01-01', end_date: '2027-01-14', created_by: doomed.id, owner_id: doomed.id,
  })
  await admin.from('profiles').delete().eq('id', doomed.id)
  await admin.auth.admin.deleteUser(doomed.id).catch(() => {})
  users.splice(users.indexOf(doomed.id), 1)

  const survivor = await admin.from('sprints').select('id, created_by, owner_id').eq('id', doomedSprint.id).maybeSingle()
  check('deleting a person leaves their sprints standing', Boolean(survivor.data),
    'ON DELETE SET NULL, never CASCADE - a departure must not erase the plan the team worked to.')
  check('and only the attribution goes', survivor.data?.created_by === null && survivor.data?.owner_id === null)
} finally {
  // ---------------------------------------------------------------------------------------
  // Teardown - non-destructive, everything created above goes.
  // ---------------------------------------------------------------------------------------
  for (const id of sprintIds) {
    // The ledgers CASCADE from sprints; sprint_items has no client DELETE grant but the
    // service role is not a client role.
    await admin.from('sprint_items').delete().eq('sprint_id', id)
    await admin.from('sprint_burndown_samples').delete().eq('sprint_id', id)
    await admin.from('sprint_metrics').delete().eq('sprint_id', id)
    await admin.from('sprints').delete().eq('id', id)
  }
  for (const id of tasks) {
    await admin.from('sprint_items').delete().eq('task_id', id)
    await admin.from('task_assignees').delete().eq('task_id', id)
    await admin.from('tasks').delete().eq('parent_task_id', id)
    await admin.from('tasks').delete().eq('id', id)
  }
  for (const id of boards) {
    // ⚠️ Scoped to the BOARD, not to the ids this run happens to have tracked. An aborted run
    // (or one that deliberately disabled a trigger, as the "does this harness actually fail"
    // check does) leaves rows the tracking arrays never saw, and `prevent_nonempty_column_delete`
    // then refuses the column delete, which refuses the board delete - so the sandbox silently
    // accumulates fixtures. Observed once; this is the fix.
    const { data: leftoverSprints } = await admin.from('sprints').select('id').eq('board_id', id)
    for (const s of leftoverSprints ?? []) {
      await admin.from('sprint_items').delete().eq('sprint_id', s.id)
      await admin.from('sprint_burndown_samples').delete().eq('sprint_id', s.id)
      await admin.from('sprint_metrics').delete().eq('sprint_id', s.id)
    }
    await admin.from('sprints').delete().eq('board_id', id)
    await admin.from('board_agile_settings').delete().eq('board_id', id)
    await admin.from('board_members').delete().eq('board_id', id)

    const { data: cols } = await admin.from('columns').select('id').eq('board_id', id)
    const colIds = (cols ?? []).map((c) => c.id)
    if (colIds.length) {
      const { data: strays } = await admin.from('tasks').select('id').in('column_id', colIds)
      for (const t of strays ?? []) {
        await admin.from('sprint_items').delete().eq('task_id', t.id)
        await admin.from('task_assignees').delete().eq('task_id', t.id)
      }
      // Children first: a subtask holds a foreign key to its parent.
      await admin.from('tasks').delete().in('column_id', colIds).not('parent_task_id', 'is', null)
      await admin.from('tasks').delete().in('column_id', colIds)
    }
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
