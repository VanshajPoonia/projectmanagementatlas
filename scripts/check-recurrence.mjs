#!/usr/bin/env node
// Recurrence + reminders harness - the pass/fail gate for migrations 116 and 117.
//
//   116  recurrence_rules + recurrence_occurrences  - the schedule, and what it produced
//   117  task_reminders                             - private, per-user, idempotent delivery
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the
// way the app reaches the database - never through the service role, which bypasses RLS and
// would pass whatever the policies said. The service role builds and tears down fixtures and
// drives the generator, which is what the scheduled job does.
//
// Every restriction has a CONTROL case proving it is specific rather than a blanket break.
//
// It also runs lib/recurrence.cases.mjs against the REAL public.next_occurrence_date(). That
// list is checked a second time by lib/recurrence.parity.test.ts against the TypeScript mirror,
// so the editor's preview and the dates the generator actually creates cannot drift apart.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:recurrence

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'
import { RECURRENCE_CASES } from '../lib/recurrence.cases.mjs'

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
function section(name) {
  console.log(`\n--- ${name} ---`)
}

/** A write RLS refused: PostgREST reports either an error or, for a filtered row, nothing. */
const refused = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0)

const users = []
async function makeUser(tag, role) {
  const email = `rec-${tag}+${stamp}@example.com`
  const password = `Rec-${stamp}-${tag}!x9`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser(${tag}): ${error.message}`)
  const id = data.user.id
  const { error: pErr } = await admin.from('profiles')
    .upsert({ id, email, role, is_active: true }, { onConflict: 'id' })
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`)
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: sErr } = await client.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`signIn(${tag}): ${sErr.message}`)
  users.push(id)
  return { id, email, client }
}

let boardId, todoColId, doneColId, cancelColId
let taskA, taskB
const createdTaskIds = []
const ruleIds = []

/** Every task the generator produced for a rule, so teardown can remove them. */
async function generatedTaskIds(ruleId) {
  const { data } = await admin.from('recurrence_occurrences').select('task_id').eq('rule_id', ruleId)
  return (data ?? []).map((r) => r.task_id).filter(Boolean)
}

try {
  const member = await makeUser('member', 'user')
  const outsider = await makeUser('outsider', 'user')
  const adminUser = await makeUser('admin', 'admin')

  const { data: board, error: bErr } = await admin.from('boards')
    .insert({ title: `rec-board-${stamp}`, created_by: member.id, is_private: false })
    .select('id').single()
  if (bErr) throw new Error(`board: ${bErr.message}`)
  boardId = board.id

  const cols = await admin.from('columns').insert([
    { board_id: boardId, title: 'To Do', position: 0, status_key: 'to_do' },
    { board_id: boardId, title: 'Done', position: 1, status_key: 'done' },
    { board_id: boardId, title: 'Cancelled', position: 2, status_key: 'cancelled' },
  ]).select('id, status_key')
  if (cols.error) throw new Error(`columns: ${cols.error.message}`)
  todoColId = cols.data.find((c) => c.status_key === 'to_do').id
  doneColId = cols.data.find((c) => c.status_key === 'done').id
  cancelColId = cols.data.find((c) => c.status_key === 'cancelled').id

  const tasks = await admin.from('tasks').insert([
    { column_id: todoColId, title: `rec-a-${stamp}`, position: 0, created_by: member.id, visibility: 'board', priority: 2 },
    { column_id: todoColId, title: `rec-b-${stamp}`, position: 1, created_by: member.id, visibility: 'board',
      due_date: '2126-08-25T15:00:00Z' },
  ]).select('id')
  if (tasks.error) throw new Error(`tasks: ${tasks.error.message}`)
  taskA = tasks.data[0].id
  taskB = tasks.data[1].id

  // =======================================================================================
  section('116 - date math parity with lib/recurrence.ts')
  // =======================================================================================
  // The same list lib/recurrence.parity.test.ts runs against the TypeScript mirror. Both
  // halves must agree, because one draws the preview and the other creates the work.
  let parityFailures = []
  for (const c of RECURRENCE_CASES) {
    const { data, error } = await admin.rpc('next_occurrence_date', {
      p_after: c.after,
      p_frequency: c.frequency,
      p_interval: c.interval,
      p_weekdays: c.weekdays ?? null,
      p_month_day: c.monthDay ?? null,
    })
    if (error) { parityFailures.push(`${c.name}: ${error.message}`); continue }
    const got = data ?? null
    if (got !== c.expect) parityFailures.push(`${c.name}: expected ${c.expect}, got ${got}`)
  }
  check(`all ${RECURRENCE_CASES.length} shared date-math cases agree with the database`,
    parityFailures.length === 0, parityFailures.slice(0, 5).join('\n         '))

  // =======================================================================================
  section('116 - the rule is reachable by the people who own the work')
  // =======================================================================================
  const memberCreates = await member.client.from('recurrence_rules').insert({
    source_task_id: taskA, frequency: 'weekly', interval_count: 1,
    generation_mode: 'schedule', horizon_days: 21, starts_on: '2126-08-24', created_by: member.id,
  }).select('id')
  check('CONTROL: a collaborator can put a schedule on their own task',
    !memberCreates.error && memberCreates.data?.length === 1, memberCreates.error?.message)
  const ruleA = memberCreates.data?.[0]?.id
  if (ruleA) ruleIds.push(ruleA)

  const forged = await outsider.client.from('recurrence_rules').insert({
    source_task_id: taskA, frequency: 'daily', interval_count: 1,
    starts_on: '2126-08-24', created_by: member.id,
  }).select('id')
  check('a rule cannot be created claiming someone else made it', refused(forged))

  const secondRule = await member.client.from('recurrence_rules').insert({
    source_task_id: taskA, frequency: 'daily', interval_count: 1,
    starts_on: '2126-08-24', created_by: member.id,
  }).select('id')
  check('a task cannot carry two schedules at once', refused(secondRule),
    'ambiguity about "the rule for this task" would reach every consumer')

  // =======================================================================================
  section('116 - CHECK constraints refuse rules that cannot fire')
  // =======================================================================================
  const badCases = [
    ['an unknown frequency', { frequency: 'fortnightly', interval_count: 1 }],
    ['interval 0', { frequency: 'daily', interval_count: 0 }],
    ['interval above 1000', { frequency: 'daily', interval_count: 1001 }],
    ['a horizon above 1095 days', { frequency: 'daily', interval_count: 1, horizon_days: 1096 }],
    ['an occurrence cap above 10000', { frequency: 'daily', interval_count: 1, max_occurrences: 10001 }],
    ['weekdays on a daily rule', { frequency: 'daily', interval_count: 1, weekdays: [1] }],
    ['an empty weekday list', { frequency: 'weekly', interval_count: 1, weekdays: [] }],
    ['a weekday outside 0-6', { frequency: 'weekly', interval_count: 1, weekdays: [9] }],
    ['a month day on a weekly rule', { frequency: 'weekly', interval_count: 1, month_day: 15 }],
    ['a month day above 31', { frequency: 'monthly', interval_count: 1, month_day: 40 }],
    ['an end date before the start', { frequency: 'daily', interval_count: 1, ends_on: '2026-01-01' }],
    ['a horizon of 0 days', { frequency: 'daily', interval_count: 1, horizon_days: 0 }],
    ['an unknown generation mode', { frequency: 'daily', interval_count: 1, generation_mode: 'magic' }],
  ]
  for (const [label, patch] of badCases) {
    const res = await admin.from('recurrence_rules').insert({
      source_task_id: taskB, starts_on: '2126-08-24', created_by: member.id, ...patch,
    }).select('id')
    // Through the SERVICE ROLE, so this is the CHECK constraint refusing rather than RLS.
    check(`the database refuses ${label}`, Boolean(res.error), 'accepted a rule that can never fire')
    if (!res.error && res.data?.[0]) await admin.from('recurrence_rules').delete().eq('id', res.data[0].id)
  }

  // A bounds check that only proves refusals cannot tell a generous ceiling from a broken
  // table. The ceilings here are deliberately far above real use, so the accepting half is
  // the half worth pinning - the first version of this schema capped interval at 365 and a
  // horizon at 365, which refused perfectly reasonable schedules with a raw constraint error.
  const generous = await admin.from('recurrence_rules').insert({
    source_task_id: taskB, frequency: 'daily', interval_count: 1000,
    horizon_days: 1095, max_occurrences: 10000, starts_on: '2126-08-24', created_by: member.id,
  }).select('id')
  check('CONTROL: a schedule at the very top of every bound is accepted',
    !generous.error && generous.data?.length === 1, generous.error?.message)
  if (generous.data?.[0]) await admin.from('recurrence_rules').delete().eq('id', generous.data[0].id)

  // =======================================================================================
  section('116 - generation is idempotent, which is the whole point')
  // =======================================================================================
  const run1 = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleA, p_today: '2126-08-24' })
  const created1 = (run1.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0)
  check('a schedule-mode rule fills its horizon on the first run', created1 === 4,
    `expected 4 weekly occurrences inside 21 days, got ${created1}: ${run1.error?.message ?? ''}`)

  const run2 = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleA, p_today: '2126-08-24' })
  const created2 = (run2.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0)
  check('re-running the same sweep creates nothing', created2 === 0,
    `a retried job duplicated ${created2} occurrence(s)`)

  const run3 = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleA, p_today: '2126-08-24' })
  check('a third run still creates nothing',
    (run3.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0) === 0)

  const { data: ledger } = await admin.from('recurrence_occurrences')
    .select('occurrence_date, task_id').eq('rule_id', ruleA).order('occurrence_date')
  check('every ledger row points at a real task', (ledger ?? []).every((r) => r.task_id))
  check('the ledger dates are the rule\'s cadence, one week apart',
    (ledger ?? []).map((r) => r.occurrence_date).join(',') === '2126-08-24,2126-08-31,2126-09-07,2126-09-14',
    (ledger ?? []).map((r) => r.occurrence_date).join(','))

  const { data: ruleRow } = await admin.from('recurrence_rules')
    .select('occurrences_created').eq('id', ruleA).single()
  check('the rule\'s own counter matches the ledger',
    ruleRow?.occurrences_created === (ledger ?? []).length)

  // A generated task must be indistinguishable from a hand-made one, and must NOT itself
  // look like a schedule - otherwise every copy offers to be edited as a recurrence.
  const { data: gen } = await admin.from('tasks').select('title, priority, is_recurring, column_id, due_date')
    .eq('id', ledger[0].task_id).single()
  check('a generated task copies the template\'s content', gen?.title === `rec-a-${stamp}` && gen?.priority === 2)
  check('a generated task is NOT itself marked recurring', gen?.is_recurring === false,
    'an occurrence is not a rule; marking it one would offer a second schedule to edit')
  check('a generated task lands in an OPEN column, not the template\'s', gen?.column_id === todoColId)

  // =======================================================================================
  section('116 - deleting a generated task does not resurrect it')
  // =======================================================================================
  await admin.from('tasks').delete().eq('id', ledger[0].task_id)
  const { data: afterDelete } = await admin.from('recurrence_occurrences')
    .select('occurrence_date, task_id').eq('rule_id', ruleA).eq('occurrence_date', ledger[0].occurrence_date).single()
  check('the ledger row survives its task being deleted', Boolean(afterDelete))
  check('and it now points at nothing, rather than cascading away', afterDelete?.task_id === null)

  const run4 = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleA, p_today: '2126-08-24' })
  check('the next sweep does NOT re-create the deleted occurrence',
    (run4.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0) === 0,
    '"I deleted this week\'s instance" must not mean "make it again every run"')

  // =======================================================================================
  section('116 - bounds actually stop a rule')
  // =======================================================================================
  await admin.from('recurrence_rules').update({ is_paused: true }).eq('id', ruleA)
  const paused = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleA, p_today: '2126-12-01' })
  check('a paused rule is skipped entirely', (paused.data ?? []).length === 0)
  await admin.from('recurrence_rules').update({ is_paused: false }).eq('id', ruleA)

  await admin.from('recurrence_rules').update({ ends_on: '2126-08-25' }).eq('id', ruleA)
  const ended = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleA, p_today: '2126-12-01' })
  check('a rule past its end date reports why rather than looking broken',
    (ended.data ?? [])[0]?.skipped_reason === 'past its end date',
    JSON.stringify(ended.data))
  await admin.from('recurrence_rules').update({ ends_on: null }).eq('id', ruleA)

  const { data: current } = await admin.from('recurrence_rules').select('occurrences_created').eq('id', ruleA).single()
  await admin.from('recurrence_rules').update({ max_occurrences: current.occurrences_created }).eq('id', ruleA)
  const capped = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleA, p_today: '2127-01-01' })
  check('a rule at its occurrence limit reports why',
    (capped.data ?? [])[0]?.skipped_reason === 'occurrence limit reached', JSON.stringify(capped.data))
  await admin.from('recurrence_rules').update({ max_occurrences: null }).eq('id', ruleA)

  // =======================================================================================
  section('116 - on_completion produces one instance at a time')
  // =======================================================================================
  const onComp = await admin.from('recurrence_rules').insert({
    source_task_id: taskB, frequency: 'weekly', interval_count: 1,
    generation_mode: 'on_completion', starts_on: '2126-08-24', created_by: member.id,
  }).select('id').single()
  const ruleB = onComp.data.id
  ruleIds.push(ruleB)

  const openRun = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleB, p_today: '2126-08-24' })
  check('nothing is created while the current instance is still open',
    (openRun.data ?? [])[0]?.skipped_reason === 'current occurrence is still open', JSON.stringify(openRun.data))

  await admin.from('tasks').update({ column_id: doneColId, status: 'done' }).eq('id', taskB)
  const doneRun = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleB, p_today: '2126-08-24' })
  check('CONTROL: completing the current instance creates exactly one more',
    (doneRun.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0) === 1, JSON.stringify(doneRun.data))

  // 112's category, not the word "done". A board with a "Scrapped" column must behave the same.
  const { data: latest } = await admin.from('recurrence_occurrences')
    .select('task_id').eq('rule_id', ruleB).order('occurrence_date', { ascending: false }).limit(1).single()
  await admin.from('tasks').update({ column_id: cancelColId, status: 'cancelled' }).eq('id', latest.task_id)
  const cancelRun = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleB, p_today: '2126-08-24' })
  check('CANCELLING counts as closed too - the category decides, not the column title',
    (cancelRun.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0) === 1, JSON.stringify(cancelRun.data))

  // Finishing three weeks late must produce ONE future instance, not three overdue copies.
  const { data: newest } = await admin.from('recurrence_occurrences')
    .select('task_id, occurrence_date').eq('rule_id', ruleB)
    .order('occurrence_date', { ascending: false }).limit(1).single()
  await admin.from('tasks').update({ column_id: doneColId, status: 'done' }).eq('id', newest.task_id)
  const lateRun = await admin.rpc('run_recurrence_generation', { p_rule_id: ruleB, p_today: '2126-10-05' })
  check('completing weeks late creates ONE instance, not one per missed week',
    (lateRun.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0) === 1, JSON.stringify(lateRun.data))
  const { data: afterLate } = await admin.from('recurrence_occurrences')
    .select('occurrence_date').eq('rule_id', ruleB).order('occurrence_date', { ascending: false }).limit(1).single()
  check('and it is dated in the future, not backfilled into the gap',
    afterLate.occurrence_date >= '2126-10-05', afterLate.occurrence_date)

  // A rule whose start date is years in the past must still land on a FUTURE date. The
  // catch-up walk used to give up after 500 steps and carry on with whatever date it had
  // reached, which for anything older than 500 intervals meant quietly creating an occurrence
  // dated in the past. 260 weekly steps here is well inside the guard and proves the walk
  // completes rather than truncating.
  const { data: oldTask } = await admin.from('tasks').insert({
    column_id: doneColId, title: `rec-old-${stamp}`, position: 9,
    created_by: member.id, visibility: 'board', status: 'done',
  }).select('id').single()
  createdTaskIds.push(oldTask.id)
  const { data: oldRule } = await admin.from('recurrence_rules').insert({
    source_task_id: oldTask.id, frequency: 'weekly', interval_count: 1,
    generation_mode: 'on_completion', starts_on: '2021-01-04', created_by: member.id,
  }).select('id').single()
  ruleIds.push(oldRule.id)
  const catchUp = await admin.rpc('run_recurrence_generation', { p_rule_id: oldRule.id, p_today: '2026-01-04' })
  check('a rule started five years ago still generates', 
    (catchUp.data ?? []).reduce((n, r) => n + (r.created_count ?? 0), 0) === 1,
    JSON.stringify(catchUp.data))
  const { data: caught } = await admin.from('recurrence_occurrences')
    .select('occurrence_date').eq('rule_id', oldRule.id).single()
  check('and the occurrence it creates is in the FUTURE, not left behind by a truncated walk',
    caught?.occurrence_date >= '2026-01-04', caught?.occurrence_date)

  // =======================================================================================
  section('116 - the ledger cannot be forged')
  // =======================================================================================
  const forgeInsert = await member.client.from('recurrence_occurrences')
    .insert({ rule_id: ruleA, occurrence_date: '2126-12-25' }).select('id')
  check('a collaborator cannot write the occurrence ledger', refused(forgeInsert),
    'every idempotency guarantee rests on the ledger being accurate')

  const forgeAsAdmin = await adminUser.client.from('recurrence_occurrences')
    .insert({ rule_id: ruleA, occurrence_date: '2126-12-26' }).select('id')
  check('an ADMIN cannot write it either - it has no privileged writer at all', refused(forgeAsAdmin))

  const forgeDelete = await member.client.from('recurrence_occurrences')
    .delete().eq('rule_id', ruleA).select('id')
  check('a collaborator cannot delete ledger rows to make work regenerate', refused(forgeDelete))

  const readLedger = await member.client.from('recurrence_occurrences').select('id').eq('rule_id', ruleA)
  check('CONTROL: but they can READ the ledger for work they can see',
    !readLedger.error && (readLedger.data?.length ?? 0) > 0, readLedger.error?.message)

  // The generator itself must be unreachable: it is SECURITY DEFINER and enforces no bounds.
  const directGen = await member.client.rpc('create_recurrence_occurrence', {
    p_rule_id: ruleA, p_occurrence_date: '2126-12-31',
  })
  check('create_recurrence_occurrence is not callable by a signed-in user', Boolean(directGen.error),
    'it bypasses paused, ends_on, max_occurrences and RLS alike')

  // =======================================================================================
  section('116 - a rule is only visible to people who can see its work')
  // =======================================================================================
  const outsiderReads = await outsider.client.from('recurrence_rules').select('id').eq('id', ruleA)
  check('CONTROL: a rule on a PUBLIC board is readable by any signed-in user',
    !outsiderReads.error && outsiderReads.data?.length === 1,
    'this board is deliberately public, so this proves the SELECT policy is not a blanket deny')

  await admin.from('boards').update({ is_private: true }).eq('id', boardId)
  const outsiderReadsPrivate = await outsider.client.from('recurrence_rules').select('id').eq('id', ruleA)
  check('making the board private hides the rule from a non-member',
    (outsiderReadsPrivate.data?.length ?? 0) === 0)
  const outsiderReadsLedger = await outsider.client.from('recurrence_occurrences').select('id').eq('rule_id', ruleA)
  check('and hides its occurrence ledger too', (outsiderReadsLedger.data?.length ?? 0) === 0)
  const memberStillReads = await member.client.from('recurrence_rules').select('id').eq('id', ruleA)
  check('CONTROL: the board\'s own creator still sees it', memberStillReads.data?.length === 1)
  await admin.from('boards').update({ is_private: false }).eq('id', boardId)

  // =======================================================================================
  section('116 - guest/client cannot schedule work')
  // =======================================================================================
  await admin.from('board_members').insert({ board_id: boardId, user_id: outsider.id, role: 'guest' })
  const guestSchedules = await outsider.client.from('recurrence_rules').insert({
    source_task_id: taskA, frequency: 'daily', interval_count: 1,
    starts_on: '2126-08-24', created_by: outsider.id,
  }).select('id')
  check('a guest cannot put a schedule on a task they can only read', refused(guestSchedules),
    '065/067 make guest and client read-only, and a schedule creates work')

  const guestPauses = await outsider.client.from('recurrence_rules')
    .update({ is_paused: true }).eq('id', ruleA).select('id')
  check('a guest cannot pause someone else\'s schedule', refused(guestPauses))

  const guestReads = await outsider.client.from('recurrence_rules').select('id').eq('id', ruleA)
  check('CONTROL: but a guest CAN see the schedule on work they can read',
    !guestReads.error && guestReads.data?.length === 1, guestReads.error?.message)

  const guestRuns = await outsider.client.rpc('run_recurrence_generation', { p_rule_id: ruleA })
  check('CONTROL: a guest may run a rule they can see - it creates only what the rule already allows',
    !guestRuns.error, guestRuns.error?.message)

  const outsiderFullSweep = await outsider.client.rpc('run_recurrence_generation', { p_rule_id: null })
  check('a non-admin cannot run a FULL sweep across every rule in the workspace',
    Boolean(outsiderFullSweep.error), 'a full sweep is the scheduled job\'s job, or an admin\'s')

  const adminFullSweep = await adminUser.client.rpc('run_recurrence_generation', { p_rule_id: null })
  check('CONTROL: an admin can', !adminFullSweep.error, adminFullSweep.error?.message)

  await admin.from('board_members').delete().eq('board_id', boardId).eq('user_id', outsider.id)

  // =======================================================================================
  section('117 - a reminder is private to the person who set it')
  // =======================================================================================
  const mineSet = await member.client.from('task_reminders').insert({
    task_id: taskA, user_id: member.id, offset_minutes: 1440, channel: 'in_app',
  }).select('id')
  check('CONTROL: a collaborator can set a reminder on their own work',
    !mineSet.error && mineSet.data?.length === 1, mineSet.error?.message)

  const theirsSet = await outsider.client.from('task_reminders').insert({
    task_id: taskA, user_id: member.id, offset_minutes: 60, channel: 'in_app',
  }).select('id')
  check('nobody can set a reminder ON someone else\'s behalf', refused(theirsSet))

  const outsiderOwn = await outsider.client.from('task_reminders').insert({
    task_id: taskA, user_id: outsider.id, offset_minutes: 60, channel: 'in_app',
  }).select('id')
  check('CONTROL: two different people CAN each have their own reminder on one task',
    !outsiderOwn.error && outsiderOwn.data?.length === 1, outsiderOwn.error?.message)

  const memberSees = await member.client.from('task_reminders').select('id, user_id').eq('task_id', taskA)
  check('each person sees only their own reminder on that task',
    memberSees.data?.length === 1 && memberSees.data[0].user_id === member.id,
    JSON.stringify(memberSees.data))

  // The one table in this schema an admin deliberately cannot read.
  const adminSees = await adminUser.client.from('task_reminders').select('id').eq('task_id', taskA)
  check('an ADMIN cannot read anyone\'s reminders - there is no bypass by design',
    (adminSees.data?.length ?? 0) === 0,
    'an admin has no business reading what someone privately asked to be nudged about')

  const stealDelete = await outsider.client.from('task_reminders')
    .delete().eq('id', mineSet.data[0].id).select('id')
  check('nobody can delete someone else\'s reminder', refused(stealDelete))

  const mineDelete = await member.client.from('task_reminders')
    .delete().eq('id', mineSet.data[0].id).select('id')
  check('CONTROL: they can delete their own', !mineDelete.error && mineDelete.data?.length === 1)
  await member.client.from('task_reminders').insert({
    task_id: taskA, user_id: member.id, offset_minutes: 1440, channel: 'in_app',
  })

  // =======================================================================================
  section('117 - the shape of a reminder is enforced, not assumed')
  // =======================================================================================
  const bothShapes = await admin.from('task_reminders').insert({
    task_id: taskA, user_id: outsider.id, offset_minutes: 60, remind_at: '2126-08-24T09:00:00Z',
  }).select('id')
  check('a reminder cannot be both relative and absolute', Boolean(bothShapes.error),
    '"both set" has no defensible meaning and would silently prefer one')

  const neitherShape = await admin.from('task_reminders').insert({
    task_id: taskA, user_id: outsider.id, channel: 'in_app',
  }).select('id')
  check('a reminder cannot be neither', Boolean(neitherShape.error))

  const badChannel = await admin.from('task_reminders').insert({
    task_id: taskA, user_id: outsider.id, offset_minutes: 60, channel: 'carrier_pigeon',
  }).select('id')
  check('an unknown channel is refused', Boolean(badChannel.error))

  const negativeOffset = await admin.from('task_reminders').insert({
    task_id: taskA, user_id: outsider.id, offset_minutes: -60,
  }).select('id')
  check('a reminder cannot fire AFTER its own due date', Boolean(negativeOffset.error),
    'that is a report, not a reminder')

  // Renewals and compliance work genuinely want "three months before". The first version of
  // this constraint capped the offset at 60 days and would have refused it.
  const longLead = await admin.from('task_reminders').insert({
    task_id: taskB, user_id: adminUser.id, offset_minutes: 129600, channel: 'in_app',
  }).select('id')
  check('CONTROL: a three-month lead time is accepted', !longLead.error, longLead.error?.message)
  if (longLead.data?.[0]) await admin.from('task_reminders').delete().eq('id', longLead.data[0].id)

  const tooLongLead = await admin.from('task_reminders').insert({
    task_id: taskB, user_id: adminUser.id, offset_minutes: 525601,
  }).select('id')
  check('but more than a year ahead is refused', Boolean(tooLongLead.error))

  const longNote = await admin.from('task_reminders').insert({
    task_id: taskB, user_id: adminUser.id, offset_minutes: 90, note: 'x'.repeat(2000),
  }).select('id')
  check('CONTROL: a 2000-character note is accepted', !longNote.error, longNote.error?.message)
  if (longNote.data?.[0]) await admin.from('task_reminders').delete().eq('id', longNote.data[0].id)

  const duplicate = await member.client.from('task_reminders').insert({
    task_id: taskA, user_id: member.id, offset_minutes: 1440, channel: 'email',
  }).select('id')
  check('the same person cannot set the same reminder twice on one task', Boolean(duplicate.error))

  // =======================================================================================
  section('117 - delivered_at is not writable, so delivery stays idempotent')
  // =======================================================================================
  const { data: mine } = await admin.from('task_reminders')
    .select('id').eq('task_id', taskA).eq('user_id', member.id).single()

  const stampIt = await member.client.from('task_reminders')
    .update({ delivered_at: new Date().toISOString() }).eq('id', mine.id).select('id')
  check('a client cannot stamp delivered_at', refused(stampIt),
    'setting it silences a reminder; clearing it makes one fire repeatedly')

  const insertStamped = await member.client.from('task_reminders').insert({
    task_id: taskB, user_id: member.id, offset_minutes: 30,
    delivered_at: new Date().toISOString(),
  }).select('id, delivered_at')
  // A table-wide INSERT grant would have covered every column; 117 grants INSERT per column.
  check('nor set it on the way in', refused(insertStamped) || insertStamped.data?.[0]?.delivered_at === null,
    JSON.stringify(insertStamped.data))
  if (insertStamped.data?.[0]?.id) {
    await admin.from('task_reminders').delete().eq('id', insertStamped.data[0].id)
  }

  const editMine = await member.client.from('task_reminders')
    .update({ note: 'ring the supplier first' }).eq('id', mine.id).select('id')
  check('CONTROL: they can still edit the parts of their own reminder that are theirs',
    !editMine.error && editMine.data?.length === 1, editMine.error?.message)

  // =======================================================================================
  section('117 - delivery fires once, and only for what is actually due')
  // =======================================================================================
  // taskB is due 2126-08-25T15:00Z; a 1-day-before reminder is due from 2126-08-24T15:00Z.
  await admin.from('tasks').update({ column_id: todoColId, status: 'to_do' }).eq('id', taskB)
  const { data: dueSoon } = await admin.from('task_reminders').insert({
    task_id: taskB, user_id: outsider.id, offset_minutes: 1440, channel: 'both',
  }).select('id').single()

  const tooEarly = await admin.rpc('deliver_due_reminders', { p_now: '2126-08-01T00:00:00Z' })
  check('nothing is delivered before it is due',
    !(tooEarly.data ?? []).some((r) => r.reminder_id === dueSoon.id), JSON.stringify(tooEarly.data))

  const nowDue = await admin.rpc('deliver_due_reminders', { p_now: '2126-08-24T16:00:00Z' })
  const delivered = (nowDue.data ?? []).find((r) => r.reminder_id === dueSoon.id)
  check('CONTROL: it IS delivered once due', Boolean(delivered), JSON.stringify(nowDue.error ?? nowDue.data))
  check('and it reports that an email is owed, per the channel and the 045 preference',
    delivered?.wants_email === true)

  const again = await admin.rpc('deliver_due_reminders', { p_now: '2126-08-24T16:00:00Z' })
  check('re-running delivery does NOT deliver it a second time',
    !(again.data ?? []).some((r) => r.reminder_id === dueSoon.id),
    'the claim and the read are one statement precisely so a retry cannot double-notify')

  const { data: notes } = await admin.from('task_notifications')
    .select('id, type').eq('recipient_id', outsider.id).eq('task_id', taskB)
  check('exactly one in-app notification exists for it',
    (notes ?? []).filter((n) => n.type === 'reminder').length === 1,
    `found ${(notes ?? []).length}`)

  // A closed task must not generate reminders; 112's category decides, not the status text.
  const { data: closedRem } = await admin.from('task_reminders').insert({
    task_id: taskA, user_id: outsider.id, remind_at: '2126-08-01T00:00:00Z', channel: 'in_app',
  }).select('id').single()
  await admin.from('tasks').update({ column_id: cancelColId, status: 'cancelled' }).eq('id', taskA)
  const onClosed = await admin.rpc('deliver_due_reminders', { p_now: '2126-08-24T16:00:00Z' })
  check('a reminder on a CANCELLED task is not delivered',
    !(onClosed.data ?? []).some((r) => r.reminder_id === closedRem.id),
    'cancelled is closed by category, even though the word "done" appears nowhere')
  await admin.from('tasks').update({ column_id: todoColId, status: 'to_do' }).eq('id', taskA)

  // =======================================================================================
  section('117 - the full sweep is not reachable by a client')
  // =======================================================================================
  const clientSweep = await member.client.rpc('deliver_due_reminders', { p_now: null })
  check('a signed-in user cannot run the full reminder sweep', Boolean(clientSweep.error),
    'it returns every user\'s reminder data; only the scheduled job may')

  const adminSweep = await adminUser.client.rpc('deliver_due_reminders', { p_now: null })
  check('not even an admin can', Boolean(adminSweep.error))

  const scoped = await member.client.rpc('deliver_my_due_reminders')
  check('CONTROL: but anyone can deliver their OWN due reminders', !scoped.error, scoped.error?.message)
  check('and it returns a bare count, never anyone\'s data', typeof scoped.data === 'number')

  // The scoped version must not touch a different user's row, whatever else is pending.
  const { data: outsiderPending } = await admin.from('task_reminders')
    .select('id, delivered_at').eq('user_id', outsider.id).is('delivered_at', null)
  const before = (outsiderPending ?? []).length
  await member.client.rpc('deliver_my_due_reminders')
  const { data: outsiderAfter } = await admin.from('task_reminders')
    .select('id').eq('user_id', outsider.id).is('delivered_at', null)
  check('one user delivering their own reminders leaves everyone else\'s alone',
    (outsiderAfter ?? []).length === before, `${before} -> ${(outsiderAfter ?? []).length}`)
} catch (err) {
  console.error(`\nHARNESS ERROR: ${err.message}\n${err.stack ?? ''}`)
  failures++
} finally {
  // ---------------------------------------------------------------------------------------
  // Teardown. Generated tasks first: they are real rows the harness created as a side effect.
  // ---------------------------------------------------------------------------------------
  for (const ruleId of ruleIds) {
    for (const id of await generatedTaskIds(ruleId)) {
      await admin.from('tasks').delete().eq('id', id)
    }
    await admin.from('recurrence_rules').delete().eq('id', ruleId)
  }
  for (const id of [taskA, taskB, ...createdTaskIds]) {
    if (id) await admin.from('tasks').delete().eq('id', id)
  }
  for (const id of [todoColId, doneColId, cancelColId]) {
    if (id) await admin.from('columns').delete().eq('id', id)
  }
  if (boardId) await admin.from('boards').delete().eq('id', boardId)
  for (const id of users) {
    await admin.from('task_notifications').delete().eq('recipient_id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
