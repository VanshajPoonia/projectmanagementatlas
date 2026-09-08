#!/usr/bin/env node
// Milestone + timeline harness - the pass/fail gate for migrations 133-136 (Prompt I).
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the way
// the app reaches the database - never through the service role, which bypasses RLS and would
// pass whatever the policies said. The service role builds and tears down fixtures only.
//
// ⚠️ EVERY RESTRICTION HAS A CONTROL CASE. A harness that only proves refusals cannot tell a
// working policy from a table nobody can touch at all. Migration 133 has three write tiers that
// would look identical under refusal-only testing: an admin manages any milestone on a board
// they can see, the OWNER may update their own, and everyone else may only read.
//
// ⚠️ THE STATE MACHINE IS A PARITY GATE. lib/milestones.cases.mjs declares which transitions
// are accepted and refused; lib/milestones.parity.test.ts runs them against the TypeScript
// mirror that disables the Save button, and this file runs the SAME list against the real
// trigger. Neither is the reference. A dialog stricter than the database takes an ability away
// with no way to tell that from a bug; a dialog looser than it produces an error nobody could
// have predicted. Same shape as the custom-field (114) and recurrence (116) parity gates.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:milestones

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'
import { MILESTONE_STATE_CASES, MILESTONE_NOTE_CASES } from '../lib/milestones.cases.mjs'

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

const refused = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0)
const landed = (res) => !res.error && Array.isArray(res.data) && res.data.length > 0

const users = []
async function makeUser(tag, role) {
  const email = `ms-${tag}+${stamp}@example.com`
  const password = `Ms-${stamp}-${tag}!x9`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser(${tag}): ${error.message}`)
  const id = data.user.id
  const { error: pErr } = await admin.from('profiles')
    .upsert({ id, email, full_name: `MS ${tag}`, role, is_active: true }, { onConflict: 'id' })
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`)
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: sErr } = await client.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`signIn(${tag}): ${sErr.message}`)
  users.push(id)
  return { id, email, client }
}

const boardIds = []
const taskIds = []
const milestoneIds = []
const goalIds = []
const today = new Date().toISOString().slice(0, 10)

try {
  const adm = await makeUser('admin', 'admin')
  const owner = await makeUser('owner', 'user')
  const mem = await makeUser('member', 'user')
  const guest = await makeUser('guest', 'user')

  // Two boards, because the cross-board rule is one of the things under test and migration
  // 133's own post-conditions could only exercise it if a second board happened to exist.
  const board = await admin.from('boards')
    .insert({ title: `Milestone harness ${stamp}`, created_by: adm.id }).select('id').single()
  if (board.error) throw new Error(`board: ${board.error.message}`)
  boardIds.push(board.data.id)

  const other = await admin.from('boards')
    .insert({ title: `Milestone harness other ${stamp}`, created_by: adm.id }).select('id').single()
  if (other.error) throw new Error(`other board: ${other.error.message}`)
  boardIds.push(other.data.id)

  const column = await admin.from('columns')
    .insert({ board_id: board.data.id, title: 'To Do', status_key: 'to_do', position: 0 }).select('id').single()
  const otherColumn = await admin.from('columns')
    .insert({ board_id: other.data.id, title: 'To Do', status_key: 'to_do', position: 0 }).select('id').single()
  const doneColumn = await admin.from('columns')
    .insert({ board_id: board.data.id, title: 'Done', status_key: 'done', position: 1 }).select('id').single()

  // ⚠️ visibility 'board' explicitly. `tasks.visibility` DEFAULTS to 'assigned', and an
  // assigned-visibility task with no assignee is visible to its creator alone - so a fixture
  // taking the default makes a link control case fail for a reason unrelated to milestones.
  const mkTask = async (col, title, status, position) => {
    const res = await admin.from('tasks').insert({
      column_id: col, title: `${title} ${stamp}`, status, position,
      visibility: 'board', created_by: adm.id,
    }).select('id').single()
    if (res.error) throw new Error(`task ${title}: ${res.error.message}`)
    taskIds.push(res.data.id)
    return res.data.id
  }

  const taskA = await mkTask(column.data.id, 'Harness A', 'to_do', 0)
  const taskB = await mkTask(column.data.id, 'Harness B', 'to_do', 1)
  const taskOther = await mkTask(otherColumn.data.id, 'Harness other-board', 'to_do', 0)

  await admin.from('board_members').insert({ board_id: board.data.id, user_id: guest.id, role: 'guest' })

  // =====================================================================================
  section('Who may create a milestone')
  // =====================================================================================
  const admIns = await adm.client.from('milestones')
    .insert({ board_id: board.data.id, title: `HARNESS ms ${stamp}`, due_date: today, owner_id: owner.id, created_by: adm.id })
    .select('id, state, state_note, reached_at')
  check('an admin can create a milestone on a board they can see', landed(admIns), admIns.error?.message)
  const msId = admIns.data?.[0]?.id
  if (!msId) throw new Error('no milestone id - nothing below can be meaningful')
  milestoneIds.push(msId)

  check('it starts open with no reason and no reached stamp',
    admIns.data[0].state === 'open' && admIns.data[0].state_note === null && admIns.data[0].reached_at === null)

  const memIns = await mem.client.from('milestones')
    .insert({ board_id: board.data.id, title: `MEMBER ms ${stamp}`, due_date: today }).select('id')
  check('an ordinary member cannot create one', refused(memIns))

  const guestIns = await guest.client.from('milestones')
    .insert({ board_id: board.data.id, title: `GUEST ms ${stamp}`, due_date: today }).select('id')
  check('a board guest cannot create one either', refused(guestIns))

  // =====================================================================================
  section('Who may read one')
  // =====================================================================================
  const memRead = await mem.client.from('milestones').select('id').eq('id', msId)
  check('a member can READ a milestone on a board they can see', landed(memRead))
  const guestRead = await guest.client.from('milestones').select('id').eq('id', msId)
  check('a guest can read it too - read-only is not no-access', landed(guestRead))

  // The privacy control: reading follows the board, with no rule of its own.
  await admin.from('boards').update({ is_private: true }).eq('id', other.data.id)
  const privMs = await admin.from('milestones')
    .insert({ board_id: other.data.id, title: `PRIVATE ms ${stamp}`, due_date: today }).select('id').single()
  milestoneIds.push(privMs.data.id)
  const memPriv = await mem.client.from('milestones').select('id').eq('id', privMs.data.id)
  check('a private board hides its milestones from a non-member, with no privacy rule of its own',
    (memPriv.data ?? []).length === 0)
  const admPriv = await adm.client.from('milestones').select('id').eq('id', privMs.data.id)
  check('CONTROL: and the same query returns the public board\'s milestone, so the table is readable',
    landed(await adm.client.from('milestones').select('id').eq('id', msId)))
  await admin.from('boards').update({ is_private: false }).eq('id', other.data.id)

  // =====================================================================================
  section('The owner may update their own, which is wider than create/delete')
  // =====================================================================================
  const ownerUpd = await owner.client.from('milestones')
    .update({ state: 'reached' }).eq('id', msId).select('id, state, reached_at')
  check('the OWNER can record their own milestone as reached without being an admin', landed(ownerUpd), ownerUpd.error?.message)
  check('and reaching it stamps reached_at without being asked', Boolean(ownerUpd.data?.[0]?.reached_at))

  const memUpd = await mem.client.from('milestones')
    .update({ title: 'member rename' }).eq('id', msId).select('id')
  check('CONTROL: a member who is NOT the owner cannot update it', refused(memUpd))

  const ownerDel = await owner.client.from('milestones').delete().eq('id', msId).select('id')
  check('the owner cannot DELETE it - update is deliberately the only widened verb', refused(ownerDel))

  const stillThere = await admin.from('milestones').select('id').eq('id', msId)
  check('CONTROL: and it really is still there after that refusal', (stillThere.data ?? []).length === 1)

  await adm.client.from('milestones').update({ state: 'open' }).eq('id', msId)

  // =====================================================================================
  section('The state machine, run against the real trigger (parity with lib/milestones.cases.mjs)')
  // =====================================================================================
  for (const testCase of MILESTONE_STATE_CASES) {
    // Put the row into the `from` state with the service role, so the setup is never what is
    // under test, then attempt the transition as the admin.
    const seed = { state: testCase.from, state_note: null, reached_at: null, state_changed_at: null, state_changed_by: null }
    if (testCase.from === 'missed' || testCase.from === 'cancelled') seed.state_note = 'seeded reason'
    await admin.from('milestones').update(seed).eq('id', msId)

    const res = await adm.client.from('milestones')
      .update({ state: testCase.to, state_note: testCase.note })
      .eq('id', msId).select('id, state')

    const accepted = landed(res)
    check(
      `${testCase.from} -> ${testCase.to} (${testCase.note === null ? 'no note' : JSON.stringify(testCase.note)}): ${testCase.accepted ? 'accepted' : 'refused'}`,
      accepted === testCase.accepted,
      accepted ? 'the database accepted it' : `the database refused it: ${res.error?.message ?? 'zero rows'}`,
    )
  }

  // =====================================================================================
  section('The reason carrier never comes to rest where it should not (103/104)')
  // =====================================================================================
  for (const testCase of MILESTONE_NOTE_CASES) {
    await admin.from('milestones')
      .update({ state: 'open', state_note: null, reached_at: null }).eq('id', msId)
    await adm.client.from('milestones')
      .update({ state: testCase.to, state_note: testCase.note }).eq('id', msId)
    const row = await admin.from('milestones').select('state, state_note').eq('id', msId).single()
    check(
      testCase.name,
      (row.data?.state_note !== null) === testCase.keptNote,
      `state=${row.data?.state} note=${JSON.stringify(row.data?.state_note)}`,
    )
  }

  // The 104 defect exactly: a note supplied on an UPDATE that does NOT change the state must
  // not be stamped onto the NEXT transition.
  await admin.from('milestones').update({ state: 'open', state_note: null, reached_at: null }).eq('id', msId)
  await adm.client.from('milestones').update({ title: `renamed ${stamp}`, state_note: 'smuggled' }).eq('id', msId)
  const afterNoop = await admin.from('milestones').select('state_note').eq('id', msId).single()
  check('a reason smuggled in on an ordinary edit does not stick to an OPEN milestone',
    afterNoop.data?.state_note === null, `note=${JSON.stringify(afterNoop.data?.state_note)}`)

  await adm.client.from('milestones').update({ state: 'missed', state_note: 'the real reason' }).eq('id', msId)
  const afterReal = await admin.from('milestones').select('state_note').eq('id', msId).single()
  check('and the NEXT real transition carries the reason actually supplied for it',
    afterReal.data?.state_note === 'the real reason', `note=${JSON.stringify(afterReal.data?.state_note)}`)

  // Reopening clears the whole outcome together.
  await adm.client.from('milestones').update({ state: 'open' }).eq('id', msId)
  const reopened = await admin.from('milestones')
    .select('state_note, reached_at, state_changed_at, state_changed_by').eq('id', msId).single()
  check('reopening clears reason, reached_at, and both stamps together',
    reopened.data?.state_note === null && reopened.data?.reached_at === null
    && reopened.data?.state_changed_at === null && reopened.data?.state_changed_by === null)

  // =====================================================================================
  section('The stamps cannot be forged')
  // =====================================================================================
  const forged = await adm.client.from('milestones')
    .update({ state: 'reached', state_changed_by: mem.id, state_changed_at: '2001-01-01T00:00:00Z' })
    .eq('id', msId).select('state_changed_by, state_changed_at')
  check('a transition cannot claim somebody else made it',
    landed(forged) && forged.data[0].state_changed_by === adm.id,
    `state_changed_by=${forged.data?.[0]?.state_changed_by} expected ${adm.id}`)
  check('and it cannot be back-dated on an update',
    !String(forged.data?.[0]?.state_changed_at ?? '').startsWith('2001'))

  // Honoured on INSERT, though, so a genuinely historical milestone can be entered.
  const historical = await adm.client.from('milestones').insert({
    board_id: board.data.id, title: `HISTORICAL ${stamp}`, due_date: '2024-06-01',
    state: 'missed', state_note: 'entered from last year', state_changed_at: '2024-06-02T00:00:00Z',
  }).select('id, state_changed_at')
  check('CONTROL: but a historical milestone CAN be entered with its real date on insert',
    landed(historical) && String(historical.data[0].state_changed_at).startsWith('2024'),
    `got ${historical.data?.[0]?.state_changed_at}`)
  if (historical.data?.[0]?.id) milestoneIds.push(historical.data[0].id)

  // =====================================================================================
  section('Linking work: same board only, one milestone per task')
  // =====================================================================================
  const linkOk = await adm.client.from('milestone_tasks')
    .insert({ milestone_id: msId, task_id: taskA, added_by: adm.id }).select('task_id')
  check('an admin can link work on the same board', landed(linkOk), linkOk.error?.message)

  const crossBoard = await adm.client.from('milestone_tasks')
    .insert({ milestone_id: msId, task_id: taskOther }).select('task_id')
  check('work on ANOTHER board is refused by the trigger', Boolean(crossBoard.error),
    crossBoard.error?.message ?? 'it was accepted')

  const secondMs = await adm.client.from('milestones')
    .insert({ board_id: board.data.id, title: `SECOND ${stamp}`, due_date: today }).select('id')
  milestoneIds.push(secondMs.data?.[0]?.id)
  const twoMilestones = await adm.client.from('milestone_tasks')
    .insert({ milestone_id: secondMs.data[0].id, task_id: taskA }).select('task_id')
  check('a task cannot belong to two milestones', Boolean(twoMilestones.error))

  const guestLink = await guest.client.from('milestone_tasks')
    .insert({ milestone_id: msId, task_id: taskB }).select('task_id')
  check('a guest cannot link work - putting a task in a plan is a statement about the task', refused(guestLink))

  const guestReadLink = await guest.client.from('milestone_tasks').select('task_id').eq('milestone_id', msId)
  check('CONTROL: but a guest CAN read the links, so the refusal above is about writing', landed(guestReadLink))

  // Deleting a milestone must never delete the work.
  const throwaway = await admin.from('milestones')
    .insert({ board_id: board.data.id, title: `THROWAWAY ${stamp}`, due_date: today }).select('id').single()
  await admin.from('milestone_tasks').insert({ milestone_id: throwaway.data.id, task_id: taskB })
  await adm.client.from('milestones').delete().eq('id', throwaway.data.id)
  const taskSurvived = await admin.from('tasks').select('id').eq('id', taskB)
  check('deleting a milestone takes its links and leaves the WORK alone', (taskSurvived.data ?? []).length === 1)
  const linkGone = await admin.from('milestone_tasks').select('task_id').eq('milestone_id', throwaway.data.id)
  check('and the links really are gone', (linkGone.data ?? []).length === 0)

  // =====================================================================================
  section('134: a goal may point at a milestone, and only at one thing')
  // =====================================================================================
  const goal = await adm.client.from('goals')
    .insert({ title: `HARNESS goal ${stamp}`, created_by: adm.id }).select('id')
  const goalId = goal.data?.[0]?.id
  if (goalId) goalIds.push(goalId)

  const goalMsLink = await adm.client.from('goal_links')
    .insert({ goal_id: goalId, milestone_id: msId }).select('id')
  check('a goal can be linked to a milestone', landed(goalMsLink), goalMsLink.error?.message)

  const twoEnds = await adm.client.from('goal_links')
    .insert({ goal_id: goalId, milestone_id: msId, board_id: board.data.id }).select('id')
  check('a link with two ends is refused', Boolean(twoEnds.error))

  const noEnds = await adm.client.from('goal_links').insert({ goal_id: goalId }).select('id')
  check('a link with no ends is refused', Boolean(noEnds.error))

  const boardEnd = await adm.client.from('goal_links')
    .insert({ goal_id: goalId, board_id: board.data.id }).select('id')
  check('CONTROL: 129\'s original board end still works', landed(boardEnd), boardEnd.error?.message)

  // =====================================================================================
  section('135: tasks.start_date')
  // =====================================================================================
  const setSpan = await adm.client.from('tasks')
    .update({ start_date: '2026-03-02T00:00:00.000Z', due_date: '2026-03-06T00:00:00.000Z' })
    .eq('id', taskA).select('id, start_date, due_date')
  check('a task can carry a start date and a due date', landed(setSpan), setSpan.error?.message)

  const backwards = await adm.client.from('tasks')
    .update({ start_date: '2026-03-10T00:00:00.000Z', due_date: '2026-03-01T00:00:00.000Z' })
    .eq('id', taskA).select('id')
  check('a start date after its due date is refused by the constraint', Boolean(backwards.error))

  const nullStart = await adm.client.from('tasks')
    .update({ start_date: null }).eq('id', taskA).select('id, start_date')
  check('CONTROL: clearing the start date is accepted, so the constraint is not refusing everything',
    landed(nullStart) && nullStart.data[0].start_date === null)

  const guestSpan = await guest.client.from('tasks')
    .update({ start_date: '2026-03-02T00:00:00.000Z' }).eq('id', taskA).select('id')
  check('a guest cannot schedule work - dragging a bar writes `tasks` and 065 still applies', refused(guestSpan))

  // =====================================================================================
  section('136: the timeline layout is storable, and the layout list is still a list')
  // =====================================================================================
  const tlView = await mem.client.from('saved_views')
    .insert({ owner_id: mem.id, name: `HARNESS timeline ${stamp}`, config: { layout: 'timeline' } })
    .select('id')
  check('a saved view can ask for the timeline layout', landed(tlView), tlView.error?.message)
  if (tlView.data?.[0]?.id) await admin.from('saved_views').delete().eq('id', tlView.data[0].id)

  const ganttView = await mem.client.from('saved_views')
    .insert({ owner_id: mem.id, name: `HARNESS gantt ${stamp}`, config: { layout: 'gantt' } })
    .select('id')
  check('CONTROL: an unknown layout is still refused, so 136 widened rather than opened',
    Boolean(ganttView.error))

  const kanbanView = await mem.client.from('saved_views')
    .insert({ owner_id: mem.id, name: `HARNESS kanban ${stamp}`, config: { layout: 'kanban' } })
    .select('id')
  check('CONTROL: 119\'s original layouts still validate', landed(kanbanView))
  if (kanbanView.data?.[0]?.id) await admin.from('saved_views').delete().eq('id', kanbanView.data[0].id)

  const module = await mem.client.from('app_modules')
    .select('module_key, enabled').eq('module_key', 'timeline').maybeSingle()
  check('the timeline module row exists', Boolean(module.data), module.error?.message)
  // ⚠️ NOT asserted as `false`. 136 seeds it off; whether it is on TODAY is an owner decision
  // taken afterwards, exactly as agile's and strategy's were, and pinning it here would turn a
  // legitimate switch-on into a failing gate.
  check('and it is a real boolean either way', typeof module.data?.enabled === 'boolean')

  // =====================================================================================
  section('Deprovisioning was decided at creation, not discovered later (119\'s lesson)')
  // =====================================================================================
  const doomed = await makeUser('doomed', 'user')
  const doomedMs = await admin.from('milestones')
    .insert({ board_id: board.data.id, title: `DOOMED ${stamp}`, due_date: today, owner_id: doomed.id, created_by: doomed.id })
    .select('id').single()
  milestoneIds.push(doomedMs.data.id)
  await admin.from('milestone_tasks').insert({ milestone_id: doomedMs.data.id, task_id: taskB })

  await admin.auth.admin.deleteUser(doomed.id)
  const survivor = await admin.from('milestones')
    .select('id, owner_id, created_by').eq('id', doomedMs.data.id).maybeSingle()
  check('deleting a person does NOT destroy the milestone they owned', Boolean(survivor.data))
  check('it keeps the record and drops only the attribution',
    survivor.data?.owner_id === null && survivor.data?.created_by === null,
    `owner=${survivor.data?.owner_id} created_by=${survivor.data?.created_by}`)
  const survivorLink = await admin.from('milestone_tasks').select('task_id').eq('milestone_id', doomedMs.data.id)
  check('and its linked work is untouched', (survivorLink.data ?? []).length === 1)
  users.splice(users.indexOf(doomed.id), 1)
} catch (err) {
  // Report the throw. Without this the finally prints "N checks passed" over a run that aborted
  // half way, which reads as a clean pass - the most misleading outcome a gate can produce.
  failures++
  console.log(`\nFAIL - the run threw before finishing: ${err?.message ?? err}`)
  console.log(err?.stack ?? '')
} finally {
  for (const id of goalIds.filter(Boolean)) await admin.from('goals').delete().eq('id', id)
  for (const id of milestoneIds.filter(Boolean)) await admin.from('milestones').delete().eq('id', id)
  for (const id of taskIds) await admin.from('tasks').delete().eq('id', id)
  for (const id of boardIds) await admin.from('boards').delete().eq('id', id)
  for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
