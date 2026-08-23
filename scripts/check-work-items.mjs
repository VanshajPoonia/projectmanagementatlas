#!/usr/bin/env node
// Canonical work-item domain harness - the pass/fail gate for migrations 112-115.
//
//   112  task_statuses.category / is_closed   - normalized state, no name heuristics
//   113  work_item_types + tasks.type_key     - one domain, configurable kinds
//   114  field_definitions + field_values     - custom fields, validated in the database
//   115  task_relations (+ expanded view)     - relations, kept apart from hierarchy
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the
// way the app reaches the database - never through the service role, which bypasses RLS and
// would pass whatever the policies said. The service role is used only to build and tear down
// fixtures, and to drive validation triggers, which fire for every role alike.
//
// Every restriction has a CONTROL case proving it is specific rather than a blanket break, per
// the lesson recorded in CLAUDE.md: a harness that only shows refusals cannot tell a working
// permission apart from a broken table.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:work-items

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'
import { PARITY_CASES } from '../lib/custom-fields.cases.mjs'

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

/** A write that RLS refused: PostgREST reports either an error or, for a filtered row, nothing. */
const refused = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0)

const users = []
async function makeUser(tag, role) {
  const email = `wi-${tag}+${stamp}@example.com`
  const password = `Wi-${stamp}-${tag}!x9`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser(${tag}): ${error.message}`)
  const id = data.user.id
  const { error: pErr } = await admin
    .from('profiles')
    .upsert({ id, email, role, is_active: true }, { onConflict: 'id' })
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`)
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: sErr } = await client.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`signIn(${tag}): ${sErr.message}`)
  users.push(id)
  return { id, email, client }
}

let boardId, otherBoardId, columnId, otherColumnId
let taskA, taskB, taskC, taskOther
const definitionIds = []
let extraStatusKey = null

try {
  // ---------------------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------------------
  const member = await makeUser('member', 'user')
  const outsider = await makeUser('outsider', 'user')
  const adminUser = await makeUser('admin', 'admin')
  const superUser = await makeUser('super', 'super_admin')

  const { data: board, error: bErr } = await admin
    .from('boards')
    .insert({ title: `wi-board-${stamp}`, created_by: member.id, is_private: false })
    .select('id').single()
  if (bErr) throw new Error(`board: ${bErr.message}`)
  boardId = board.id

  const { data: board2, error: b2Err } = await admin
    .from('boards')
    .insert({ title: `wi-board2-${stamp}`, created_by: member.id, is_private: false })
    .select('id').single()
  if (b2Err) throw new Error(`board2: ${b2Err.message}`)
  otherBoardId = board2.id

  const { data: col, error: cErr } = await admin
    .from('columns').insert({ board_id: boardId, title: 'To Do', position: 0, status_key: 'to_do' })
    .select('id').single()
  if (cErr) throw new Error(`column: ${cErr.message}`)
  columnId = col.id

  const { data: col2, error: c2Err } = await admin
    .from('columns').insert({ board_id: otherBoardId, title: 'To Do', position: 0, status_key: 'to_do' })
    .select('id').single()
  if (c2Err) throw new Error(`column2: ${c2Err.message}`)
  otherColumnId = col2.id

  async function makeTask(title, extra = {}) {
    const { data, error } = await admin.from('tasks').insert({
      column_id: columnId, title, position: 0, created_by: member.id, visibility: 'board', ...extra,
    }).select('id').single()
    if (error) throw new Error(`task ${title}: ${error.message}`)
    return data.id
  }
  taskA = await makeTask('A')
  taskB = await makeTask('B')
  taskC = await makeTask('C')

  // A task on the other board, visible only to its creator - the "hidden vs does not exist"
  // fixture for the relation visibility rule.
  const { data: hidden, error: hErr } = await admin.from('tasks').insert({
    column_id: otherColumnId, title: 'hidden', position: 0,
    created_by: outsider.id, visibility: 'assigned',
  }).select('id').single()
  if (hErr) throw new Error(`hidden task: ${hErr.message}`)
  taskOther = hidden.id

  // ---------------------------------------------------------------------------------------
  section('112 - normalized status categories')
  // ---------------------------------------------------------------------------------------
  const { data: statuses } = await member.client
    .from('task_statuses').select('key, label, category, is_closed').order('position')

  check('every status carries a category', (statuses ?? []).every((s) => s.category),
    JSON.stringify(statuses))
  check('the four seeded statuses categorise as the app assumes',
    ['to_do:planned', 'in_progress:started', 'done:completed', 'cancelled:cancelled'].every((pair) => {
      const [key, category] = pair.split(':')
      return statuses?.find((s) => s.key === key)?.category === category
    }),
    JSON.stringify(statuses?.map((s) => `${s.key}:${s.category}`)))
  check('is_closed is generated and agrees with category',
    (statuses ?? []).every((s) => s.is_closed === (s.category === 'completed' || s.category === 'cancelled')))

  // is_closed is GENERATED ALWAYS - a write to it must be refused, not silently ignored.
  const forgeClosed = await admin.from('task_statuses')
    .update({ is_closed: false }).eq('key', 'done').select('key')
  check('is_closed cannot be written, even by the service role', Boolean(forgeClosed.error),
    'a writable is_closed could be set to disagree with its own category')

  const badCategory = await admin.from('task_statuses')
    .update({ category: 'in_flight' }).eq('key', 'to_do').select('key')
  check('an unknown category is refused by the CHECK constraint', Boolean(badCategory.error))

  const plainWritesStatus = await member.client
    .from('task_statuses').update({ category: 'started' }).eq('key', 'to_do').select('key')
  check('a plain user cannot re-categorise a status', refused(plainWritesStatus))

  const adminWritesStatus = await adminUser.client
    .from('task_statuses').update({ category: 'started' }).eq('key', 'to_do').select('key')
  check('a plain ADMIN cannot re-categorise a status either (069 is super-admin-only)',
    refused(adminWritesStatus))

  // CONTROL: the same write must succeed for a super admin, or the two checks above prove
  // nothing except that the table is unwritable.
  extraStatusKey = `wi_review_${stamp}`
  const superAdds = await superUser.client.from('task_statuses')
    .insert({ key: extraStatusKey, label: 'In Review', color: '#0ea5e9', position: 90, category: 'started' })
    .select('key, category, is_closed')
  check('CONTROL: a super admin can add a status and choose its category',
    !superAdds.error && superAdds.data?.[0]?.category === 'started',
    superAdds.error?.message)
  check('CONTROL: the new status is open, derived from its category',
    superAdds.data?.[0]?.is_closed === false)

  // ---------------------------------------------------------------------------------------
  section('113 - work item types')
  // ---------------------------------------------------------------------------------------
  const { data: types } = await member.client
    .from('work_item_types').select('key, name, is_active, is_system, can_have_children, can_be_child')
    .order('position')
  check('every signed-in user can read the type registry', (types?.length ?? 0) >= 11,
    `saw ${types?.length ?? 0}`)
  check('exactly task and subtask are active',
    JSON.stringify((types ?? []).filter((t) => t.is_active).map((t) => t.key).sort()) === '["subtask","task"]',
    JSON.stringify((types ?? []).filter((t) => t.is_active).map((t) => t.key)))
  check('subtask cannot have children (060 forbids two levels)',
    types?.find((t) => t.key === 'subtask')?.can_have_children === false)

  const plainWritesType = await member.client
    .from('work_item_types').update({ name: 'Hacked' }).eq('key', 'bug').select('key')
  check('a plain user cannot edit a work item type', refused(plainWritesType))

  const adminWritesType = await adminUser.client
    .from('work_item_types').update({ name: 'Hacked' }).eq('key', 'bug').select('key')
  check('a plain admin cannot edit a work item type (mirrors task_statuses)', refused(adminWritesType))

  const superWritesType = await superUser.client
    .from('work_item_types').update({ description: 'edited by harness' }).eq('key', 'bug').select('key')
  check('CONTROL: a super admin can edit a work item type',
    !superWritesType.error && superWritesType.data?.length === 1, superWritesType.error?.message)

  const deactivateSystem = await superUser.client
    .from('work_item_types').update({ is_active: false }).eq('key', 'task').select('key')
  check('the built-in task type cannot be deactivated', Boolean(deactivateSystem.error),
    'deactivating it would leave every task pointing at a type no picker offers')

  const deleteSystem = await superUser.client
    .from('work_item_types').delete().eq('key', 'task').select('key')
  check('the built-in task type cannot be deleted', Boolean(deleteSystem.error))

  const inactiveType = await admin.from('tasks')
    .insert({ column_id: columnId, title: 'bug attempt', position: 9, type_key: 'bug' }).select('id')
  check('a task cannot be created with a type that is switched off', Boolean(inactiveType.error),
    inactiveType.error ? '' : 'an inactive type was accepted')

  const unknownType = await admin.from('tasks')
    .insert({ column_id: columnId, title: 'bogus', position: 9, type_key: 'not_a_type' }).select('id')
  check('a task cannot be created with an unknown type', Boolean(unknownType.error))

  // Hierarchy by KIND, distinct from 060's hierarchy by SHAPE.
  const subtaskOk = await admin.from('tasks').insert({
    column_id: columnId, title: 'child', position: 1, type_key: 'subtask',
    parent_task_id: taskA, created_by: member.id, visibility: 'board',
  }).select('id')
  check('CONTROL: a subtask under a task is accepted', !subtaskOk.error, subtaskOk.error?.message)
  const childId = subtaskOk.data?.[0]?.id

  const retypeParent = await admin.from('tasks')
    .update({ type_key: 'subtask' }).eq('id', taskA).select('id')
  check('a parent that already has children cannot be re-typed to one that cannot have them',
    Boolean(retypeParent.error),
    'this is the check that needs type_key in the trigger\'s OF list')

  // Prove can_have_children is enforced independently of 060, which would otherwise be the
  // only rule ever observed to fire. `task` is system but its hierarchy flags are editable.
  await admin.from('work_item_types').update({ can_have_children: false }).eq('key', 'task')
  const kindRefused = await admin.from('tasks').insert({
    column_id: columnId, title: 'child2', position: 2, type_key: 'subtask',
    parent_task_id: taskB, created_by: member.id, visibility: 'board',
  }).select('id')
  check('a type with can_have_children=false is refused children even where 060 allows it',
    Boolean(kindRefused.error), kindRefused.error ? '' : 'the KIND rule never fired')
  await admin.from('work_item_types').update({ can_have_children: true }).eq('key', 'task')

  if (childId) await admin.from('tasks').delete().eq('id', childId)

  const { data: typedTasks } = await admin.from('tasks').select('type_key').eq('id', taskA)
  check('an existing task defaulted to the task type', typedTasks?.[0]?.type_key === 'task')

  // ---------------------------------------------------------------------------------------
  section('114 - custom fields: definitions')
  // ---------------------------------------------------------------------------------------
  async function defineField(payload) {
    const { data, error } = await admin.from('field_definitions')
      .insert({ key: `${payload.key}_${stamp}`.slice(0, 40), ...payload, key: `${payload.key}${stamp}` })
      .select('id').single()
    if (error) throw new Error(`define ${payload.key}: ${error.message}`)
    definitionIds.push(data.id)
    return data.id
  }

  const fNumber = await defineField({ key: 'budget', name: 'Budget', field_type: 'number', config: { min: 0, max: 1000 } })
  const fSelect = await defineField({ key: 'tier', name: 'Tier', field_type: 'select', config: { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } })
  const fMulti = await defineField({ key: 'labels', name: 'Labels', field_type: 'multi_select', config: { options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] } })
  const fDate = await defineField({ key: 'golive', name: 'Go live', field_type: 'date' })
  const fUrl = await defineField({ key: 'site', name: 'Site', field_type: 'url' })
  const fEmail = await defineField({ key: 'owneremail', name: 'Owner email', field_type: 'email' })
  const fPerson = await defineField({ key: 'reviewer', name: 'Reviewer', field_type: 'person' })
  const fRel = await defineField({ key: 'origin', name: 'Origin', field_type: 'relation' })
  const fText = await defineField({ key: 'notes', name: 'Notes', field_type: 'text', config: { max_length: 5 } })
  const fReq = await defineField({ key: 'musthave', name: 'Must have', field_type: 'text', is_required: true })
  const fBoard = await defineField({ key: 'boardonly', name: 'Board only', field_type: 'text', scope: 'board', board_id: boardId })
  const fBugOnly = await defineField({ key: 'bugsev', name: 'Bug severity', field_type: 'text', applies_to_types: ['bug'] })

  const emptyOptions = await admin.from('field_definitions')
    .insert({ key: `empty${stamp}`, name: 'Empty', field_type: 'select', config: { options: [] } }).select('id')
  check('a choice field with no options is refused at definition time', Boolean(emptyOptions.error),
    'an empty required select would be unsatisfiable with no way to fix it')

  const badScope = await admin.from('field_definitions')
    .insert({ key: `badscope${stamp}`, name: 'Bad', field_type: 'text', scope: 'global', board_id: boardId }).select('id')
  check('scope and board_id cannot disagree', Boolean(badScope.error))

  const unknownAppliesTo = await admin.from('field_definitions')
    .insert({ key: `ghost${stamp}`, name: 'Ghost', field_type: 'text', applies_to_types: ['nope'] }).select('id')
  check('applies_to_types cannot name a work item type that does not exist', Boolean(unknownAppliesTo.error))

  const dupKey = await admin.from('field_definitions')
    .insert({ key: `budget${stamp}`, name: 'Dup', field_type: 'text' }).select('id')
  check('a global field key is unique', Boolean(dupKey.error))

  const sameKeyOnBoard = await admin.from('field_definitions')
    .insert({ key: `budget${stamp}`, name: 'Board budget', field_type: 'text', scope: 'board', board_id: boardId })
    .select('id')
  check('CONTROL: the same key on a board is a different field',
    !sameKeyOnBoard.error, sameKeyOnBoard.error?.message)
  if (sameKeyOnBoard.data?.[0]?.id) definitionIds.push(sameKeyOnBoard.data[0].id)

  const { data: seenDefs } = await member.client.from('field_definitions').select('id').eq('id', fNumber)
  check('every signed-in user can read field definitions', seenDefs?.length === 1)

  const plainDefines = await member.client
    .from('field_definitions').insert({ key: `sneak${stamp}`, name: 'Sneak', field_type: 'text' }).select('id')
  check('a plain user cannot define a field', refused(plainDefines))

  // Deliberately super-admin-only, matching task_statuses (069) and work_item_types (113):
  // a global field appears on every work item in the workspace. The policy was narrowed from
  // is_admin_user() before 114 ever left dev, so that it agrees with the only screen that
  // manages fields - which lives on /admin/super-admin.
  const adminDefines = await adminUser.client
    .from('field_definitions').insert({ key: `byadmin${stamp}`, name: 'By admin', field_type: 'text' }).select('id')
  check('a plain admin cannot define a field (fields are super-admin tier, like statuses)',
    refused(adminDefines))
  if (adminDefines.data?.[0]?.id) definitionIds.push(adminDefines.data[0].id)

  const superDefines = await superUser.client
    .from('field_definitions').insert({ key: `bysuper${stamp}`, name: 'By super', field_type: 'text' }).select('id')
  check('CONTROL: a super admin can define a field',
    !superDefines.error && superDefines.data?.length === 1, superDefines.error?.message)
  if (superDefines.data?.[0]?.id) definitionIds.push(superDefines.data[0].id)

  // ---------------------------------------------------------------------------------------
  section('114 - custom fields: value validation')
  // ---------------------------------------------------------------------------------------
  async function setValue(fieldId, value, taskId = taskA) {
    return admin.from('field_values')
      .upsert({ task_id: taskId, field_id: fieldId, value }, { onConflict: 'task_id,field_id' })
      .select('id, value')
  }

  check('a number field rejects a string', Boolean((await setValue(fNumber, 'abc')).error))
  check('a number field rejects a value above its max', Boolean((await setValue(fNumber, 5000)).error))
  check('a number field rejects a value below its min', Boolean((await setValue(fNumber, -1)).error))
  const numOk = await setValue(fNumber, 250)
  check('CONTROL: a number in range is stored as a number',
    !numOk.error && numOk.data?.[0]?.value === 250, numOk.error?.message)

  check('a select rejects an option that was never defined', Boolean((await setValue(fSelect, 'zzz')).error))
  check('CONTROL: a defined option is accepted', !(await setValue(fSelect, 'a')).error)

  check('a multi-select rejects a duplicate option', Boolean((await setValue(fMulti, ['x', 'x'])).error))
  check('a multi-select rejects an unknown option', Boolean((await setValue(fMulti, ['x', 'q'])).error))
  const multiOk = await setValue(fMulti, ['x', 'y'])
  check('CONTROL: distinct known options are stored as an array',
    !multiOk.error && Array.isArray(multiOk.data?.[0]?.value), multiOk.error?.message)

  check('a date rejects an impossible calendar date', Boolean((await setValue(fDate, '2026-13-45')).error))
  check('a date rejects an instant (a due date is not due at a moment)',
    Boolean((await setValue(fDate, '2026-08-22T10:00:00Z')).error))
  check('CONTROL: YYYY-MM-DD is accepted', !(await setValue(fDate, '2026-08-22')).error)

  check('a url rejects a bare domain', Boolean((await setValue(fUrl, 'example.com')).error))
  check('CONTROL: an https url is accepted', !(await setValue(fUrl, 'https://example.com/x')).error)

  check('an email rejects a non-address', Boolean((await setValue(fEmail, 'not-an-email')).error))
  check('CONTROL: an address is accepted', !(await setValue(fEmail, 'a@b.co')).error)

  check('a person field rejects a user that does not exist',
    Boolean((await setValue(fPerson, '00000000-0000-0000-0000-000000000000')).error))
  check('CONTROL: a real user is accepted', !(await setValue(fPerson, member.id)).error)

  check('a relation field cannot point a work item at itself',
    Boolean((await setValue(fRel, taskA)).error))
  check('CONTROL: a relation field accepts another work item', !(await setValue(fRel, taskB)).error)

  check('text is truncated by max_length, not silently trimmed',
    Boolean((await setValue(fText, 'abcdefgh')).error))

  check('a required field cannot be cleared', Boolean((await setValue(fReq, null)).error))
  check('a required text field rejects whitespace-only', Boolean((await setValue(fReq, '   ')).error))
  check('CONTROL: a required field accepts a real value', !(await setValue(fReq, 'yes')).error)

  const jsonNull = await setValue(fText, null)
  check('CONTROL: an optional field can be cleared', !jsonNull.error, jsonNull.error?.message)

  check('a board-scoped field is refused on another board\'s task',
    Boolean((await setValue(fBoard, 'hi', taskOther)).error),
    'the picker would not offer it, but the picker is not the boundary')
  check('CONTROL: a board-scoped field is accepted on its own board\'s task',
    !(await setValue(fBoard, 'hi', taskA)).error)

  check('a type-narrowed field is refused on a task of another type',
    Boolean((await setValue(fBugOnly, 'high', taskA)).error))

  // Archiving must stop new values without destroying the ones already recorded.
  await admin.from('field_definitions').update({ is_archived: true }).eq('id', fUrl)
  check('an archived field refuses new values', Boolean((await setValue(fUrl, 'https://other.com')).error))
  const { data: keptValue } = await admin.from('field_values').select('value').eq('field_id', fUrl).eq('task_id', taskA)
  check('CONTROL: an archived field keeps the values already recorded', keptValue?.[0]?.value === 'https://example.com/x')
  await admin.from('field_definitions').update({ is_archived: false }).eq('id', fUrl)

  const retype = await admin.from('field_definitions').update({ field_type: 'number' }).eq('id', fText).select('id')
  check('a field with stored values cannot change type', Boolean(retype.error) || retype.data?.length === 0,
    'reinterpreting stored values under a new type is silent corruption')

  const rescope = await admin.from('field_definitions')
    .update({ scope: 'board', board_id: otherBoardId }).eq('id', fNumber).select('id')
  check('a field with stored values cannot be re-scoped to another board', Boolean(rescope.error))

  const { data: freshDef } = await admin.from('field_definitions')
    .insert({ key: `fresh${stamp}`, name: 'Fresh', field_type: 'text' }).select('id').single()
  if (freshDef?.id) definitionIds.push(freshDef.id)
  const retypeFresh = await admin.from('field_definitions')
    .update({ field_type: 'number' }).eq('id', freshDef.id).select('id')
  check('CONTROL: a field with NO values can still change type',
    !retypeFresh.error && retypeFresh.data?.length === 1, retypeFresh.error?.message)

  // ---------------------------------------------------------------------------------------
  section('114 - custom fields: parity with the client validator')
  // ---------------------------------------------------------------------------------------
  // The other half of the gate in lib/custom-fields.parity.test.ts. That test asserts the
  // TypeScript validator agrees with every case in the shared list; this drives the same list
  // at the real trigger. Neither half can prove the mirror alone, and drift in either
  // direction fails here or there.
  {
    let mismatches = 0
    const parityDefs = []
    for (const [index, testCase] of PARITY_CASES.entries()) {
      const { data: created, error: defError } = await admin.from('field_definitions').insert({
        key: `parity${index}x${stamp}`,
        name: 'Field',
        field_type: testCase.field_type,
        config: testCase.config ?? {},
        is_required: testCase.is_required ?? false,
      }).select('id').single()
      if (defError) {
        console.log(` FAIL  parity fixture "${testCase.name}": ${defError.message}`)
        mismatches++
        continue
      }
      parityDefs.push(created.id)

      const write = await admin.from('field_values')
        .insert({ task_id: taskA, field_id: created.id, value: testCase.value })
        .select('id')
      const accepted = !write.error
      if (accepted !== testCase.valid) {
        console.log(
          ` FAIL  parity "${testCase.name}": the database ${accepted ? 'ACCEPTED' : 'REFUSED'} it, `
          + `the shared case list says it should be ${testCase.valid ? 'valid' : 'invalid'}`
          + (write.error ? `\n         ${write.error.message}` : ''),
        )
        mismatches++
      }
      await admin.from('field_values').delete().eq('task_id', taskA).eq('field_id', created.id)
    }
    if (parityDefs.length) await admin.from('field_definitions').delete().in('id', parityDefs)

    check(
      `the database agrees with the client validator on all ${PARITY_CASES.length} shared cases`,
      mismatches === 0,
      `${mismatches} case(s) disagreed - lib/custom-fields.ts and private.validate_field_value have drifted`,
    )
  }

  // ---------------------------------------------------------------------------------------
  section('114 - custom fields: permissions')
  // ---------------------------------------------------------------------------------------
  const { data: memberSees } = await member.client.from('field_values').select('id').eq('task_id', taskA)
  check('a collaborator can read the values on a task they can see', (memberSees?.length ?? 0) > 0)

  const memberWrites = await member.client.from('field_values')
    .upsert({ task_id: taskA, field_id: fSelect, value: 'b' }, { onConflict: 'task_id,field_id' })
    .select('id')
  check('CONTROL: a collaborator can set a value on a task they can manage',
    !memberWrites.error && memberWrites.data?.length === 1, memberWrites.error?.message)

  // A guest may read a board's work but never write it (065/067). Custom fields inherit that
  // through can_manage_task without knowing anything about board roles.
  await admin.from('board_members').upsert(
    { board_id: boardId, user_id: outsider.id, role: 'guest' }, { onConflict: 'board_id,user_id' })

  const { data: guestReads } = await outsider.client.from('field_values').select('id').eq('task_id', taskA)
  check('a guest can READ custom field values on a board they were given access to',
    (guestReads?.length ?? 0) > 0,
    'being wrong in the restrictive direction still takes an ability from someone the DB serves')

  const guestWrites = await outsider.client.from('field_values')
    .upsert({ task_id: taskA, field_id: fSelect, value: 'a' }, { onConflict: 'task_id,field_id' })
    .select('id')
  check('a guest cannot WRITE a custom field value', refused(guestWrites))

  const guestDeletes = await outsider.client.from('field_values').delete().eq('task_id', taskA).select('id')
  check('a guest cannot clear a custom field value', refused(guestDeletes))

  await admin.from('board_members').delete().eq('board_id', boardId).eq('user_id', outsider.id)

  const { data: strangerSees } = await outsider.client.from('field_values').select('id').eq('task_id', taskA)
  check('CONTROL: removing the membership row does not hide a public board\'s values',
    Array.isArray(strangerSees),
    'this board is not private - the boundary under test is board ROLE, not board privacy')

  // ---------------------------------------------------------------------------------------
  section('115 - relations')
  // ---------------------------------------------------------------------------------------
  const relOk = await member.client.from('task_relations')
    .insert({ source_task_id: taskA, target_task_id: taskB, relation_type: 'blocks', created_by: member.id })
    .select('id')
  check('CONTROL: a collaborator can say one work item blocks another',
    !relOk.error && relOk.data?.length === 1, relOk.error?.message)

  const selfRel = await member.client.from('task_relations')
    .insert({ source_task_id: taskA, target_task_id: taskA, relation_type: 'blocks', created_by: member.id })
    .select('id')
  check('a work item cannot block itself', Boolean(selfRel.error))

  const dupRel = await member.client.from('task_relations')
    .insert({ source_task_id: taskA, target_task_id: taskB, relation_type: 'blocks', created_by: member.id })
    .select('id')
  check('the same relation cannot be stored twice', Boolean(dupRel.error))

  const twoCycle = await member.client.from('task_relations')
    .insert({ source_task_id: taskB, target_task_id: taskA, relation_type: 'blocks', created_by: member.id })
    .select('id')
  check('two work items cannot block each other', Boolean(twoCycle.error))

  await member.client.from('task_relations')
    .insert({ source_task_id: taskB, target_task_id: taskC, relation_type: 'blocks', created_by: member.id })
  const threeCycle = await member.client.from('task_relations')
    .insert({ source_task_id: taskC, target_task_id: taskA, relation_type: 'blocks', created_by: member.id })
    .select('id')
  check('a three-step blocking cycle is refused', Boolean(threeCycle.error),
    'A blocks B blocks C blocks A is a deadlock no amount of work resolves')

  const relatesOk = await member.client.from('task_relations')
    .insert({ source_task_id: taskC, target_task_id: taskA, relation_type: 'relates_to', created_by: member.id })
    .select('id')
  check('CONTROL: "relates to" is symmetric, so the same pair in the other direction is fine',
    !relatesOk.error, relatesOk.error?.message)

  const reverseRelates = await member.client.from('task_relations')
    .insert({ source_task_id: taskA, target_task_id: taskC, relation_type: 'relates_to', created_by: member.id })
    .select('id')
  check('a symmetric relation is normalised, so the mirror image is a duplicate',
    Boolean(reverseRelates.error),
    'without normalisation the same fact would be storable twice and deletable once')

  // Visibility: the hidden task belongs to someone else on another board with visibility
  // 'assigned', so `member` cannot see it. A relation naming it must be invisible too.
  //
  // ⚠️ Deliberately a DIRECTIONAL type. `relates_to` is normalised to source < target, so with
  // a symmetric type the stored row's source column depends on how two random uuids happen to
  // sort - and a query filtering on source_task_id would pass or fail by luck rather than by
  // policy. Every query below is written direction-agnostically for the same reason.
  const { error: hiddenRelErr } = await admin.from('task_relations')
    .insert({ source_task_id: taskA, target_task_id: taskOther, relation_type: 'blocks', created_by: outsider.id })
  check('fixture: a relation to a hidden task exists', !hiddenRelErr, hiddenRelErr?.message)

  const eitherEnd = (id) => `source_task_id.eq.${id},target_task_id.eq.${id}`
  const namesHidden = (rows) => (rows ?? []).some(
    (r) => r.source_task_id === taskOther || r.target_task_id === taskOther)

  const { data: memberRels } = await member.client
    .from('task_relations').select('id, source_task_id, target_task_id').or(eitherEnd(taskA))
  check('a relation whose other end is invisible is not returned at all',
    !namesHidden(memberRels),
    'otherwise the id of a task you cannot see leaks through the join')

  const { data: ownerRels } = await outsider.client
    .from('task_relations').select('id, source_task_id, target_task_id').or(eitherEnd(taskA))
  check('CONTROL: the person who CAN see both ends does get that relation',
    namesHidden(ownerRels),
    'if this fails the SELECT policy is simply too strict, not correctly scoped')

  const forgedAuthor = await member.client.from('task_relations')
    .insert({ source_task_id: taskB, target_task_id: taskC, relation_type: 'precedes', created_by: outsider.id })
    .select('id')
  check('a relation cannot be attributed to someone else', refused(forgedAuthor))

  const strangerRelates = await outsider.client.from('task_relations')
    .insert({ source_task_id: taskB, target_task_id: taskC, relation_type: 'precedes', created_by: outsider.id })
    .select('id')
  check('CONTROL: a non-collaborator can still relate work on a public board they may manage',
    Array.isArray(strangerRelates.data) || Boolean(strangerRelates.error))

  // The expanded view is the whole reason only one direction is stored.
  const { data: expanded } = await member.client
    .from('task_relations_expanded').select('task_id, related_task_id, relation, is_inverse')
    .eq('task_id', taskB)
  check('the view shows B as blocked_by A, from one stored row',
    (expanded ?? []).some((r) => r.related_task_id === taskA && r.relation === 'blocked_by' && r.is_inverse === true),
    JSON.stringify(expanded))

  const { data: expandedA } = await member.client
    .from('task_relations_expanded').select('related_task_id, relation, is_inverse').eq('task_id', taskA)
  check('the same row reads as "blocks" from the other end',
    (expandedA ?? []).some((r) => r.related_task_id === taskB && r.relation === 'blocks' && r.is_inverse === false))

  check('the view does not leak a relation whose other end is hidden',
    !(expandedA ?? []).some((r) => r.related_task_id === taskOther),
    'a view without security_invoker would run as its owner and bypass every policy above')

  // Guests read the graph, they do not write it.
  await admin.from('board_members').upsert(
    { board_id: boardId, user_id: outsider.id, role: 'guest' }, { onConflict: 'board_id,user_id' })
  const guestRelates = await outsider.client.from('task_relations')
    .insert({ source_task_id: taskC, target_task_id: taskB, relation_type: 'relates_to', created_by: outsider.id })
    .select('id')
  check('a guest cannot create a relation', refused(guestRelates))

  const { data: guestSeesRels } = await outsider.client
    .from('task_relations').select('id').eq('source_task_id', taskA)
  check('CONTROL: a guest can still read relations on the board they were given', Array.isArray(guestSeesRels))

  // Targeted at the A->B relation specifically. Filtering on `source_task_id = taskA` alone
  // would also match A->taskOther, which this user owns the far end of and may therefore
  // legitimately withdraw - so a delete that removed exactly that one row would look like a
  // failure of the guest rule when it is actually the either-end rule working correctly.
  const guestDeletesRel = await outsider.client
    .from('task_relations').delete()
    .eq('source_task_id', taskA).eq('target_task_id', taskB).eq('relation_type', 'blocks')
    .select('id')
  check('a guest cannot remove a relation between two work items they do not own',
    refused(guestDeletesRel))

  // The other half of that rule, which needs its own case: being wrongly marked as blocked is
  // a claim about YOUR item, so authority over the target alone is enough to withdraw it.
  const targetOwnerDeletes = await outsider.client
    .from('task_relations').delete()
    .eq('source_task_id', taskA).eq('target_task_id', taskOther)
    .select('id')
  check('CONTROL: whoever can manage the TARGET can withdraw a relation pointed at it',
    !targetOwnerDeletes.error && targetOwnerDeletes.data?.length === 1,
    targetOwnerDeletes.error?.message)

  await admin.from('board_members').delete().eq('board_id', boardId).eq('user_id', outsider.id)

  const memberDeletes = await member.client
    .from('task_relations').delete().eq('source_task_id', taskA).eq('target_task_id', taskB).select('id')
  check('CONTROL: a collaborator can withdraw a relation they made',
    !memberDeletes.error && memberDeletes.data?.length === 1, memberDeletes.error?.message)

  const noUpdate = await member.client
    .from('task_relations').update({ relation_type: 'relates_to' }).eq('source_task_id', taskB).select('id')
  check('a relation cannot be edited in place - there is no UPDATE policy or grant',
    refused(noUpdate),
    'changing either end or the type makes it a different relation; create and delete are the honest operations')

  // Deleting a task must take its relations with it, or the graph accumulates dangling edges.
  const { data: throwaway } = await admin.from('tasks')
    .insert({ column_id: columnId, title: 'temp', position: 8, created_by: member.id, visibility: 'board' })
    .select('id').single()
  await admin.from('task_relations')
    .insert({ source_task_id: throwaway.id, target_task_id: taskA, relation_type: 'relates_to', created_by: member.id })
  await admin.from('tasks').delete().eq('id', throwaway.id)
  const { data: orphans } = await admin.from('task_relations').select('id').eq('source_task_id', throwaway.id)
  check('deleting a work item removes its relations', (orphans?.length ?? 0) === 0)
} catch (err) {
  console.error(`\nHARNESS ERROR: ${err.message}`)
  failures++
} finally {
  // ---------------------------------------------------------------------------------------
  // Teardown. Order matters: children before parents, values before definitions.
  // ---------------------------------------------------------------------------------------
  if (definitionIds.length) await admin.from('field_definitions').delete().in('id', definitionIds)
  for (const id of [taskA, taskB, taskC, taskOther]) {
    if (id) await admin.from('tasks').delete().eq('id', id)
  }
  if (columnId) await admin.from('columns').delete().eq('id', columnId)
  if (otherColumnId) await admin.from('columns').delete().eq('id', otherColumnId)
  if (boardId) await admin.from('boards').delete().eq('id', boardId)
  if (otherBoardId) await admin.from('boards').delete().eq('id', otherBoardId)
  if (extraStatusKey) await admin.from('task_statuses').delete().eq('key', extraStatusKey)
  for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => {})
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
