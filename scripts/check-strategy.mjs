#!/usr/bin/env node
// Strategy harness - the pass/fail gate for migrations 129-132 (Prompt H).
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the way
// the app reaches the database - never through the service role, which bypasses RLS and would
// pass whatever the policies said. The service role builds and tears down fixtures only.
//
// ⚠️ EVERY RESTRICTION HAS A CONTROL CASE. A harness that only proves refusals cannot tell a
// working policy from a table nobody can touch at all, and this module deliberately has THREE
// different write tiers (anyone signed in, a board member, an admin) that would all look
// identical if only the refusals were checked.
//
// ⚠️ Where a guarantee is "the trigger refuses this", the harness TRIES THE BAD WRITE. "The
// trigger exists" and "the trigger refuses this" are different claims (117's lesson, where a
// CHECK silently passed on the empty array it had been written to reject).
//
// ⚠️ THE RETRO TEMPLATE MAP IS A PARITY GATE. lib/retrospectives.ts declares which column keys
// each template has, and migration 132's trigger enforces the same map. Every key the
// TypeScript side declares is written here against the real database, plus one bogus key, so
// the two cannot drift without this failing - the same shape as the custom-fields and
// recurrence parity gates.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:strategy

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'
import { RETRO_TEMPLATES, RETRO_TEMPLATE_COLUMNS } from '../lib/retrospectives.ts'

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
  const email = `strat-${tag}+${stamp}@example.com`
  const password = `St-${stamp}-${tag}!x9`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser(${tag}): ${error.message}`)
  const id = data.user.id
  const { error: pErr } = await admin.from('profiles')
    .upsert({ id, email, full_name: `Strat ${tag}`, role, is_active: true }, { onConflict: 'id' })
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`)
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: sErr } = await client.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`signIn(${tag}): ${sErr.message}`)
  users.push(id)
  return { id, email, client }
}

const goalIds = []
const ideaIds = []
const canvasIds = []
const retroIds = []
const boardIds = []
const taskIds = []

try {
  const sup = await makeUser('super', 'super_admin')
  const adm = await makeUser('admin', 'admin')
  const mem = await makeUser('member', 'user')
  const guest = await makeUser('guest', 'user')

  // A board with a column and a task, built with the service role so the fixture itself is
  // never what is under test.
  const board = await admin.from('boards')
    .insert({ title: `Strategy harness ${stamp}`, created_by: adm.id }).select('id').single()
  if (board.error) throw new Error(`board: ${board.error.message}`)
  boardIds.push(board.data.id)

  const column = await admin.from('columns')
    .insert({ board_id: board.data.id, title: 'To Do', status_key: 'to_do', position: 0 }).select('id').single()
  if (column.error) throw new Error(`column: ${column.error.message}`)

  // ⚠️ visibility 'board', explicitly. `tasks.visibility` DEFAULTS to 'assigned', and an
  // assigned-visibility task with no assignee is visible to its creator alone - so a fixture
  // that took the default would make the goal-link control case fail for a reason that has
  // nothing to do with goal links. Measured, not assumed: the probe that found this showed the
  // policy refusing correctly on a task the member genuinely could not see.
  const task = await admin.from('tasks')
    .insert({ column_id: column.data.id, title: `Harness task ${stamp}`, status: 'to_do', position: 0, visibility: 'board', created_by: adm.id })
    .select('id').single()
  if (task.error) throw new Error(`task: ${task.error.message}`)
  taskIds.push(task.data.id)

  // Its opposite: work the member genuinely cannot see, so the refusal below is about
  // visibility rather than about the member's tier.
  const hidden = await admin.from('tasks')
    .insert({ column_id: column.data.id, title: `Harness hidden ${stamp}`, status: 'to_do', position: 1, visibility: 'assigned', created_by: adm.id })
    .select('id').single()
  if (hidden.error) throw new Error(`hidden task: ${hidden.error.message}`)
  taskIds.push(hidden.data.id)

  // The guest is a real guest on this board - the control that proves the read-only tier is
  // role-specific and not a blanket break.
  await admin.from('board_members').insert({ board_id: board.data.id, user_id: guest.id, role: 'guest' })

  // =====================================================================================
  section('Goals: who can create, and who can move the number')
  // =====================================================================================
  const goalIns = await adm.client.from('goals').insert({
    title: `HARNESS goal ${stamp}`, metric: 'callbacks', unit: 'per month',
    start_value: 12, current_value: 12, target_value: 4, owner_id: mem.id, created_by: adm.id,
  }).select('id, current_value')
  check('an admin can create a goal', landed(goalIns), goalIns.error?.message)
  const goalId = goalIns.data?.[0]?.id
  if (!goalId) throw new Error('no goal id - nothing below can be meaningful')
  goalIds.push(goalId)

  const memIns = await mem.client.from('goals').insert({ title: `MEMBER goal ${stamp}` }).select('id')
  check('an ordinary member cannot create one', refused(memIns))
  if (landed(memIns)) goalIds.push(memIns.data[0].id)

  const memRead = await mem.client.from('goals').select('id').eq('id', goalId)
  check('but every signed-in person can READ goals - a goal nobody sees aligns nobody', landed(memRead))

  // CONTROL: the owner is a plain member, and the whole point of the wider UPDATE policy is
  // that they can keep the number current without an admin.
  const ownerUpd = await mem.client.from('goals')
    .update({ current_value: 9, checkin_note: 'two sites switched over' }).eq('id', goalId)
    .select('id, current_value, checkin_note')
  check('CONTROL: the OWNER (a plain member) can record a measurement', landed(ownerUpd), ownerUpd.error?.message)
  check('and the write-only carrier is NULL at rest', ownerUpd.data?.[0]?.checkin_note === null,
    JSON.stringify(ownerUpd.data?.[0]))

  const strangerUpd = await guest.client.from('goals').update({ current_value: 1 }).eq('id', goalId).select('id')
  check('somebody who is neither an admin nor the owner cannot', refused(strangerUpd))

  const memDel = await mem.client.from('goals').delete().eq('id', goalId).select('id')
  check('and the owner cannot DELETE it either - only an admin can', refused(memDel))

  // =====================================================================================
  section('The measurement ledger is trigger-written and read-only')
  // =====================================================================================
  const history = await mem.client.from('goal_checkins').select('id, kind, current_value, note').eq('goal_id', goalId)
  check('opening a measurable goal opened its ledger',
    (history.data ?? []).some((c) => c.kind === 'opened'), JSON.stringify(history.data))
  check('and the measurement was recorded with its note',
    (history.data ?? []).some((c) => c.kind === 'measured' && c.note === 'two sites switched over'))

  const forge = await adm.client.from('goal_checkins')
    .insert({ goal_id: goalId, current_value: 4, kind: 'measured' }).select('id')
  check('an ADMIN cannot forge a measurement', refused(forge), JSON.stringify(forge.data))
  const rewrite = await sup.client.from('goal_checkins').update({ current_value: 4 }).eq('goal_id', goalId).select('id')
  check('a SUPER ADMIN cannot rewrite one', refused(rewrite))
  const erase = await sup.client.from('goal_checkins').delete().eq('goal_id', goalId).select('id')
  check('and cannot delete one', refused(erase))

  // The trigger's own rules, tried rather than described.
  const noteAlone = await adm.client.from('goals')
    .update({ checkin_note: 'drive-by' }).eq('id', goalId).select('id')
  check('a note with no measurement behind it is refused', Boolean(noteAlone.error))
  const stillNull = await adm.client.from('goals').select('checkin_note').eq('id', goalId).single()
  check('and the refused note is not left sitting on the goal', stillNull.data?.checkin_note === null)

  const bornWithNote = await adm.client.from('goals')
    .insert({ title: `HARNESS born ${stamp}`, checkin_note: 'nope' }).select('id')
  check('a note supplied at creation is refused rather than silently dropped', Boolean(bornWithNote.error))
  if (landed(bornWithNote)) goalIds.push(bornWithNote.data[0].id)

  // =====================================================================================
  section('Goal links: both ends have to be visible')
  // =====================================================================================
  const linkOk = await mem.client.from('goal_links')
    .insert({ goal_id: goalId, task_id: task.data.id, created_by: mem.id }).select('id')
  check('CONTROL: the goal owner can link a work item they can see', landed(linkOk), linkOk.error?.message)

  const bothEnds = await mem.client.from('goal_links')
    .insert({ goal_id: goalId, board_id: board.data.id, task_id: task.data.id }).select('id')
  check('a link with two ends is refused - exactly one, enforced by a CHECK', Boolean(bothEnds.error))

  const noEnds = await mem.client.from('goal_links').insert({ goal_id: goalId }).select('id')
  check('and a link with no end is refused too', Boolean(noEnds.error))

  const hiddenLink = await mem.client.from('goal_links')
    .insert({ goal_id: goalId, task_id: hidden.data.id, created_by: mem.id }).select('id')
  check('but NOT a work item they cannot see - a goal cannot be made to count invisible work',
    refused(hiddenLink), JSON.stringify(hiddenLink.data))

  const guestLink = await guest.client.from('goal_links')
    .insert({ goal_id: goalId, board_id: board.data.id }).select('id')
  check('somebody who is neither an admin nor the goal owner cannot link work', refused(guestLink))

  const noUpdateGrant = await adm.client.from('goal_links').update({ goal_id: goalId }).eq('goal_id', goalId).select('id')
  check('goal_links has no UPDATE path at all - changing an end makes it a different link', Boolean(noUpdateGrant.error))

  // =====================================================================================
  section('Ideas: anyone may capture, an author or an admin may move')
  // =====================================================================================
  const ideaIns = await mem.client.from('ideas')
    .insert({ title: `HARNESS idea ${stamp}`, problem: 'p', impact: 'high', effort: 'low', created_by: mem.id })
    .select('id, state')
  check('CONTROL: an ORDINARY MEMBER can capture an idea - a locked idea box collects nothing',
    landed(ideaIns), ideaIns.error?.message)
  const ideaId = ideaIns.data?.[0]?.id
  if (!ideaId) throw new Error('no idea id')
  ideaIds.push(ideaId)
  check('and it starts as captured', ideaIns.data[0].state === 'captured')

  const captured = await mem.client.from('idea_events').select('kind').eq('idea_id', ideaId)
  check('capturing it opened its history', (captured.data ?? []).some((e) => e.kind === 'captured'))

  const authorMove = await mem.client.from('ideas').update({ state: 'researching' }).eq('id', ideaId).select('state')
  check('the author can move their own idea', landed(authorMove) && authorMove.data[0].state === 'researching')

  const strangerMove = await guest.client.from('ideas').update({ state: 'validated' }).eq('id', ideaId).select('id')
  check('somebody else cannot', refused(strangerMove))

  const adminMove = await adm.client.from('ideas').update({ state: 'validated' }).eq('id', ideaId).select('state')
  check('CONTROL: an admin can move anybody\'s idea', landed(adminMove))

  const noReason = await adm.client.from('ideas').update({ state: 'rejected' }).eq('id', ideaId).select('id')
  check('rejecting with no reason is refused BY THE TRIGGER, not by the dialog', Boolean(noReason.error))

  const withReason = await adm.client.from('ideas')
    .update({ state: 'rejected', state_note: 'covered by existing work' }).eq('id', ideaId).select('state, state_note')
  check('rejecting with a reason works', landed(withReason) && withReason.data[0].state === 'rejected')
  check('and the carrier is NULL at rest', withReason.data?.[0]?.state_note === null)

  const reasonInHistory = await mem.client.from('idea_events').select('note, to_state').eq('idea_id', ideaId)
  check('the reason reached the permanent history',
    (reasonInHistory.data ?? []).some((e) => e.to_state === 'rejected' && e.note === 'covered by existing work'))

  const forgeEvent = await sup.client.from('idea_events')
    .insert({ idea_id: ideaId, kind: 'state_change', to_state: 'validated' }).select('id')
  check('even a super admin cannot forge a pipeline event', refused(forgeEvent))
  const eraseEvent = await sup.client.from('idea_events').delete().eq('idea_id', ideaId).select('id')
  check('or erase one', refused(eraseEvent))

  const bornConverted = await mem.client.from('ideas')
    .insert({ title: `HARNESS born ${stamp}`, converted_at: new Date().toISOString() }).select('id')
  check('an idea cannot be created already converted', Boolean(bornConverted.error))
  if (landed(bornConverted)) ideaIds.push(bornConverted.data[0].id)

  // Research notes: author edits, admin removes.
  const noteIns = await mem.client.from('idea_notes')
    .insert({ idea_id: ideaId, body: 'three clients asked', created_by: mem.id }).select('id')
  check('anyone active can add research to an idea', landed(noteIns), noteIns.error?.message)
  const noteId = noteIns.data?.[0]?.id

  const otherEdit = await guest.client.from('idea_notes').update({ body: 'rewritten' }).eq('id', noteId).select('id')
  check('somebody else cannot rewrite that research', refused(otherEdit))
  const adminEdit = await adm.client.from('idea_notes').update({ body: 'rewritten by admin' }).eq('id', noteId).select('id')
  check('and NEITHER CAN AN ADMIN - editing somebody\'s words under their name is worse than deleting them',
    refused(adminEdit))
  const adminDelete = await adm.client.from('idea_notes').delete().eq('id', noteId).select('id')
  check('CONTROL: an admin CAN remove it', landed(adminDelete))

  // =====================================================================================
  section('SWOT: admin-written, everyone-readable, and the bucket must match its canvas')
  // =====================================================================================
  const orgItem = await adm.client.from('strategy_items')
    .insert({ canvas: 'swot', bucket: 'strength', body: `HARNESS strength ${stamp}`, created_by: adm.id })
    .select('id, board_id')
  check('an admin can write an org-level entry', landed(orgItem), orgItem.error?.message)
  if (landed(orgItem)) canvasIds.push(orgItem.data[0].id)
  check('and org level means board_id is NULL', orgItem.data?.[0]?.board_id === null)

  const memberRead = await mem.client.from('strategy_items').select('id').eq('id', orgItem.data?.[0]?.id)
  check('CONTROL: a plain member can READ it', landed(memberRead))

  const memberWrite = await mem.client.from('strategy_items')
    .insert({ canvas: 'swot', bucket: 'threat', body: 'nope' }).select('id')
  check('but cannot write one', refused(memberWrite))
  if (landed(memberWrite)) canvasIds.push(memberWrite.data[0].id)

  const wrongBucket = await adm.client.from('strategy_items')
    .insert({ canvas: 'swot', bucket: 'problem', body: 'wrong canvas' }).select('id')
  check('a bucket from another canvas is refused', Boolean(wrongBucket.error))

  // =====================================================================================
  section('Project purpose: optional, board-scoped, admin-written')
  // =====================================================================================
  const purpose = await adm.client.from('board_purpose')
    .insert({ board_id: board.data.id, purpose: 'harness', non_goals: 'not redesigning anything' })
    .select('board_id, non_goals')
  check('an admin can write a purpose', landed(purpose), purpose.error?.message)
  check('CONTROL: a plain member can read it',
    landed(await mem.client.from('board_purpose').select('board_id').eq('board_id', board.data.id)))
  const memPurpose = await mem.client.from('board_purpose')
    .update({ purpose: 'hijacked' }).eq('board_id', board.data.id).select('board_id')
  check('and cannot write one', refused(memPurpose))

  // =====================================================================================
  section('Retrospectives: the template map is a parity gate, not a comment')
  // =====================================================================================
  for (const template of RETRO_TEMPLATES) {
    const r = await adm.client.from('retrospectives')
      .insert({ board_id: board.data.id, title: `HARNESS ${template} ${stamp}`, template, created_by: adm.id })
      .select('id')
    if (!landed(r)) { check(`a ${template} review can be created`, false, r.error?.message); continue }
    retroIds.push(r.data[0].id)

    let allAccepted = true
    for (const columnKey of RETRO_TEMPLATE_COLUMNS[template]) {
      const n = await adm.client.from('retro_notes')
        .insert({ retro_id: r.data[0].id, column_key: columnKey, body: `probe ${columnKey}` }).select('id')
      if (!landed(n)) allAccepted = false
    }
    check(`every column lib/retrospectives.ts declares for "${template}" is accepted by the database`, allAccepted)

    const bogus = await adm.client.from('retro_notes')
      .insert({ retro_id: r.data[0].id, column_key: 'not_a_column', body: 'x' }).select('id')
    check(`and a column that template does NOT have is refused ("${template}")`, Boolean(bogus.error))
  }

  // =====================================================================================
  section('Anonymity is a grant that does not exist, not a flag')
  // =====================================================================================
  const anonRetro = await adm.client.from('retrospectives')
    .insert({ board_id: board.data.id, title: `HARNESS anon ${stamp}`, template: 'plain', is_anonymous: true, created_by: adm.id })
    .select('id')
  check('an anonymous review can be created', landed(anonRetro), anonRetro.error?.message)
  const anonId = anonRetro.data?.[0]?.id
  retroIds.push(anonId)

  // The member writes a note and TRIES to attribute it to themselves.
  const anonNote = await mem.client.from('retro_notes')
    .insert({ retro_id: anonId, column_key: 'notes', body: 'this is anonymous', author_id: mem.id })
    .select('id, author_id')
  check('a member can write in it', landed(anonNote), anonNote.error?.message)
  check('and the public author is NULL WHATEVER THE CLIENT SENT', anonNote.data?.[0]?.author_id === null,
    JSON.stringify(anonNote.data?.[0]))
  const anonNoteId = anonNote.data?.[0]?.id

  const readAuthors = await sup.client.from('retro_note_authors').select('note_id, user_id')
  check('a SUPER ADMIN cannot read retro_note_authors at all', Boolean(readAuthors.error),
    `error was: ${readAuthors.error?.message ?? 'none'} / rows: ${JSON.stringify(readAuthors.data)}`)
  const admAuthors = await adm.client.from('retro_note_authors').select('note_id')
  check('and neither can an admin', Boolean(admAuthors.error))

  const mine = await mem.client.rpc('my_retro_note_ids', { p_retro: anonId })
  check('but the author can find their OWN note through the definer function',
    Array.isArray(mine.data) && mine.data.some((row) => (row?.id ?? row) === anonNoteId),
    JSON.stringify(mine.data))

  const notMine = await adm.client.rpc('my_retro_note_ids', { p_retro: anonId })
  check('CONTROL: somebody who wrote nothing gets an empty list, not everybody else\'s',
    Array.isArray(notMine.data) && notMine.data.length === 0, JSON.stringify(notMine.data))

  const authorEdit = await mem.client.from('retro_notes').update({ body: 'edited by its author' }).eq('id', anonNoteId).select('id')
  check('CONTROL: the author can still edit their own anonymous note', landed(authorEdit), authorEdit.error?.message)

  const otherEditNote = await guest.client.from('retro_notes').update({ body: 'hijacked' }).eq('id', anonNoteId).select('id')
  check('somebody else cannot edit it', refused(otherEditNote))
  const adminEditNote = await adm.client.from('retro_notes').update({ body: 'hijacked by admin' }).eq('id', anonNoteId).select('id')
  check('and neither can an admin', refused(adminEditNote))

  const flip = await adm.client.from('retrospectives').update({ is_anonymous: false }).eq('id', anonId).select('id')
  check('anonymity cannot be switched off after people have written under it', Boolean(flip.error))

  const setAuthor = await mem.client.from('retro_notes').update({ author_id: mem.id }).eq('id', anonNoteId).select('id')
  check('and the public author cannot be set later - there is no UPDATE grant on that column',
    Boolean(setAuthor.error))

  // =====================================================================================
  section('Voting: the count is public, the voters are not')
  // =====================================================================================
  const vote = await mem.client.from('retro_votes').insert({ note_id: anonNoteId, user_id: mem.id }).select('note_id')
  check('a member can vote', landed(vote), vote.error?.message)

  const counted = await adm.client.from('retro_notes').select('vote_count').eq('id', anonNoteId).single()
  check('and the count is visible to everyone', counted.data?.vote_count === 1, JSON.stringify(counted.data))

  const whoVoted = await adm.client.from('retro_votes').select('user_id').eq('note_id', anonNoteId)
  check('but an ADMIN cannot see who voted', (whoVoted.data ?? []).length === 0, JSON.stringify(whoVoted.data))
  const supVoted = await sup.client.from('retro_votes').select('user_id').eq('note_id', anonNoteId)
  check('and neither can a super admin', (supVoted.data ?? []).length === 0)
  const ownVote = await mem.client.from('retro_votes').select('note_id').eq('note_id', anonNoteId)
  check('CONTROL: the voter can see their OWN vote', landed(ownVote))

  const forgeCount = await adm.client.from('retro_notes').update({ vote_count: 99 }).eq('id', anonNoteId).select('id')
  check('the count cannot be written by hand - no UPDATE grant on that column', Boolean(forgeCount.error))

  const withdraw = await mem.client.from('retro_votes').delete().eq('note_id', anonNoteId).eq('user_id', mem.id).select('note_id')
  check('a vote can be withdrawn', landed(withdraw))
  const recounted = await adm.client.from('retro_notes').select('vote_count').eq('id', anonNoteId).single()
  check('and the count follows it back down', recounted.data?.vote_count === 0)

  // =====================================================================================
  section('Guests and clients stay read-only, exactly as everywhere else')
  // =====================================================================================
  const guestRead = await guest.client.from('retrospectives').select('id').eq('id', anonId)
  check('CONTROL: a guest can READ a review on a board they have access to', landed(guestRead))
  const guestNote = await guest.client.from('retro_notes')
    .insert({ retro_id: anonId, column_key: 'notes', body: 'guest note' }).select('id')
  check('but cannot write a note in it', refused(guestNote))
  const guestRetro = await guest.client.from('retrospectives')
    .insert({ board_id: board.data.id, title: 'guest retro', template: 'plain' }).select('id')
  check('and cannot start one', refused(guestRetro))
  if (landed(guestRetro)) retroIds.push(guestRetro.data[0].id)
  const guestVote = await guest.client.from('retro_votes').insert({ note_id: anonNoteId, user_id: guest.id }).select('note_id')
  check('and cannot vote', refused(guestVote))

  // =====================================================================================
  section('A closed review is the record of what was said')
  // =====================================================================================
  const closed = await adm.client.from('retrospectives').update({ state: 'closed' }).eq('id', anonId).select('state')
  check('it can be closed', landed(closed) && closed.data[0].state === 'closed')
  const lateNote = await mem.client.from('retro_notes')
    .insert({ retro_id: anonId, column_key: 'notes', body: 'too late' }).select('id')
  check('and takes no more notes', Boolean(lateNote.error))
  const lateVote = await mem.client.from('retro_votes').insert({ note_id: anonNoteId, user_id: mem.id }).select('note_id')
  check('and no more votes', Boolean(lateVote.error))

  // =====================================================================================
  section('Actions become canonical work items, never copies')
  // =====================================================================================
  const openRetro = await adm.client.from('retrospectives')
    .insert({ board_id: board.data.id, title: `HARNESS actions ${stamp}`, template: 'plain', created_by: adm.id })
    .select('id')
  const openId = openRetro.data?.[0]?.id
  retroIds.push(openId)

  const action = await mem.client.from('retro_actions')
    .insert({ retro_id: openId, body: 'write the handover checklist', created_by: mem.id })
    .select('id, converted_at')
  check('a member can agree an action', landed(action), action.error?.message)
  check('and it does not start life converted', action.data?.[0]?.converted_at === null)
  const actionId = action.data?.[0]?.id

  const bornDone = await mem.client.from('retro_actions')
    .insert({ retro_id: openId, body: 'x', converted_at: new Date().toISOString() }).select('id')
  check('an action cannot be created already converted', Boolean(bornDone.error))

  const converted = await mem.client.from('retro_actions')
    .update({ task_id: task.data.id }).eq('id', actionId).select('task_id, converted_at')
  check('pointing it at a work item stamps the conversion', landed(converted) && converted.data[0].converted_at !== null)
  check('and the work item is the CANONICAL task, not a copy', converted.data?.[0]?.task_id === task.data.id)

  const stillOneTask = await admin.from('tasks').select('id').eq('id', task.data.id)
  check('the task itself was not duplicated by any of this', (stillOneTask.data ?? []).length === 1)

  // =====================================================================================
  section('The module seeds OFF, so applying these migrations changed nothing anyone can see')
  // =====================================================================================
  const module = await mem.client.from('app_modules').select('module_key, enabled').eq('module_key', 'strategy').maybeSingle()
  check('the strategy module row exists', Boolean(module.data), module.error?.message)
  // ⚠️ NOT asserted as `false`. 129 seeds it off; whether it is on TODAY is an owner decision
  // taken afterwards, exactly as agile's was, and pinning it here would turn a legitimate
  // switch-on into a failing gate.
  check('and it is a real boolean either way', typeof module.data?.enabled === 'boolean')
} catch (err) {
  // Report the throw. Without this the finally prints "N checks passed" over a run that aborted
  // half way, which reads as a clean pass - the most misleading outcome a gate can produce.
  failures++
  console.log(`\nFAIL - the run threw before finishing: ${err?.message ?? err}`)
  console.log(err?.stack ?? '')
} finally {
  for (const id of retroIds.filter(Boolean)) await admin.from('retrospectives').delete().eq('id', id)
  for (const id of canvasIds) await admin.from('strategy_items').delete().eq('id', id)
  for (const id of ideaIds) await admin.from('ideas').delete().eq('id', id)
  for (const id of goalIds) await admin.from('goals').delete().eq('id', id)
  for (const id of taskIds) await admin.from('tasks').delete().eq('id', id)
  for (const id of boardIds) await admin.from('boards').delete().eq('id', id)
  for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
