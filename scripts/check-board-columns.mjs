#!/usr/bin/env node
// Write gate for board column ordering and status-name cascade (migrations 106 + 107).
//
// Two bugs this exists to pin, both of the kind CLAUDE.md keeps recording — the database was
// fine and no human could reach the feature, or the write silently reached nothing:
//
//   1. columns.position decided every board's left-to-right order and nothing ever wrote it
//      after the initial seed, so a column added later was pinned to the far right forever.
//      reorder_board_columns (106) is the write path; it is SECURITY INVOKER, so a non-admin
//      must be REFUSED rather than quietly changing nothing.
//   2. Renaming a status swept board columns with `update({title}).eq('title', oldLabel)`.
//      That reached only columns whose title still read exactly like the old label, and — the
//      part nobody could have noticed — no private board at all, because RLS applies SELECT
//      policies to an UPDATE that has to read rows to find them, and 099 hid private boards'
//      columns from non-members. rename_columns_for_status (107) is the fix, and the control
//      case below still runs the OLD direct UPDATE to prove that is why it was needed.
//
// Every fixture is created and torn down here; the sandbox's own boards are never touched.

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

const adminCredentials  = { email: `board-cols-admin+${stamp}@example.com`,  password: `Cols-${stamp}-aA!` }
const memberCredentials = { email: `board-cols-member+${stamp}@example.com`, password: `Cols-${stamp}-mM!` }
const ownerCredentials  = { email: `board-cols-owner+${stamp}@example.com`,  password: `Cols-${stamp}-oO!` }

const STATUS_KEY = `probe_status_${stamp}`
let boardIds = []
let userIds = []
let failures = 0

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`)
  if (!condition) failures++
}

async function createTestUser(credentials, role = 'user') {
  const { data, error } = await admin.auth.admin.createUser({ ...credentials, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  const { error: profileError } = await admin.from('profiles').upsert(
    { id: data.user.id, email: credentials.email, role, is_active: true }, { onConflict: 'id' },
  )
  if (profileError) throw new Error(`upsert profile: ${profileError.message}`)
  userIds.push(data.user.id)
  return data.user.id
}

async function signIn(credentials) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword(credentials)
  if (error) throw new Error(`sign-in ${credentials.email}: ${error.message}`)
  return client
}

// Read straight through the service role: what the harness asserts is what the DATABASE holds,
// never what a particular caller is allowed to see.
async function orderOf(boardId) {
  const { data, error } = await admin
    .from('columns').select('id,title,position').eq('board_id', boardId).order('position')
  if (error) throw new Error(`read columns: ${error.message}`)
  return data
}
const idsOf = (cols) => cols.map(c => c.id)

async function makeBoard({ title, ownerId, isPrivate, columns }) {
  const { data: board, error } = await admin.from('boards')
    .insert({ title, created_by: ownerId, updated_by: ownerId, is_private: isPrivate })
    .select().single()
  if (error) throw new Error(`create board: ${error.message}`)
  boardIds.push(board.id)

  const { error: colError } = await admin.from('columns').insert(
    columns.map((c, index) => ({ board_id: board.id, title: c.title, position: index, status_key: c.status_key ?? null })),
  )
  if (colError) throw new Error(`create columns: ${error?.message ?? colError.message}`)
  return board
}

try {
  const adminId  = await createTestUser(adminCredentials, 'admin')
  await createTestUser(memberCredentials, 'user')
  const ownerId  = await createTestUser(ownerCredentials, 'user')

  const adminUser = await signIn(adminCredentials)
  const member    = await signIn(memberCredentials)

  // A throwaway status so the cascade is asserted against something no real board uses.
  const { error: statusError } = await admin.from('task_statuses')
    .insert({ key: STATUS_KEY, label: `Probe ${stamp}`, color: '#6366f1', position: 900 })
  if (statusError) throw new Error(`create status: ${statusError.message}`)

  const open = await makeBoard({
    title: `probe-open-${stamp}`, ownerId: adminId, isPrivate: false,
    columns: [
      { title: 'Alpha', status_key: null },
      { title: 'Beta',  status_key: null },
      { title: 'Gamma', status_key: null },
      // Deliberately named NOTHING like the status: the title sweep could never have found it.
      { title: 'Drifted name', status_key: STATUS_KEY },
    ],
  })

  // Private, owned by somebody else, with the admin deliberately NOT a member — the board the
  // old sweep could not write and could not see.
  const secret = await makeBoard({
    title: `probe-private-${stamp}`, ownerId, isPrivate: true,
    columns: [
      { title: `Probe ${stamp}`, status_key: STATUS_KEY },
      { title: 'Custom, unlinked', status_key: null },
    ],
  })

  /* ── 1. an admin can rearrange a board's columns ─────────────────── */
  const before = await orderOf(open.id)
  const rotated = [before[2].id, before[0].id, before[1].id, before[3].id]

  const { data: moved, error: reorderError } = await adminUser
    .rpc('reorder_board_columns', { p_board_id: open.id, p_column_ids: rotated })
  check('an admin can rearrange a board\'s columns', !reorderError)
  check('the RPC reports every column it renumbered', moved === 4)
  check('the new order is what the database returns', idsOf(await orderOf(open.id)).join() === rotated.join())

  const positions = (await orderOf(open.id)).map(c => c.position)
  check('positions are renumbered contiguously from zero', positions.join() === '0,1,2,3')

  /* ── 2. the order is the board's, not the viewer's ───────────────── */
  const { data: asMember } = await member
    .from('columns').select('id').eq('board_id', open.id).order('position')
  check('another user reads back the same order', idsOf(asMember ?? []).join() === rotated.join())

  /* ── 3. a non-admin is REFUSED, not silently ignored ─────────────── */
  // The trap this pins: under RLS a refused UPDATE returns zero rows and no error, so without
  // the row-count check inside the RPC this would have reported success and changed nothing.
  const memberAttempt = [...rotated].reverse()
  const { error: memberError } = await member
    .rpc('reorder_board_columns', { p_board_id: open.id, p_column_ids: memberAttempt })
  check('a non-admin cannot rearrange columns', Boolean(memberError))
  check('the refusal says so rather than reporting success',
    (memberError?.message ?? '').toLowerCase().includes('permission'))
  check('the refused attempt moved nothing', idsOf(await orderOf(open.id)).join() === rotated.join())

  /* ── 4. a stale or malformed ordering changes nothing ────────────── */
  const settled = idsOf(await orderOf(open.id))

  const { error: partialError } = await adminUser
    .rpc('reorder_board_columns', { p_board_id: open.id, p_column_ids: settled.slice(1) })
  check('a partial ordering is rejected', Boolean(partialError))

  const { error: duplicateError } = await adminUser
    .rpc('reorder_board_columns', { p_board_id: open.id, p_column_ids: [settled[0], ...settled.slice(1), settled[0]] })
  check('a duplicated column id is rejected', Boolean(duplicateError))

  const { error: emptyError } = await adminUser
    .rpc('reorder_board_columns', { p_board_id: open.id, p_column_ids: [] })
  check('an empty ordering is rejected', Boolean(emptyError))

  // A column from another board must not be smuggled into this board's ordering.
  const secretColumns = idsOf(await orderOf(secret.id))
  const { error: foreignError } = await adminUser
    .rpc('reorder_board_columns', { p_board_id: open.id, p_column_ids: [...settled.slice(1), secretColumns[0]] })
  check('a column belonging to another board is rejected', Boolean(foreignError))
  check('that other board was left alone', idsOf(await orderOf(secret.id)).join() === secretColumns.join())

  check('nothing moved across any rejected call', idsOf(await orderOf(open.id)).join() === settled.join())

  /* ── 5. signed out is not a caller ───────────────────────────────── */
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: anonReorderError } = await anonClient
    .rpc('reorder_board_columns', { p_board_id: open.id, p_column_ids: settled })
  check('an unauthenticated caller cannot rearrange columns', Boolean(anonReorderError))

  /* ── 6. the control case: why 107 had to exist ───────────────────── */
  // The exact call the old status-management code made, run by a real admin. It must reach the
  // open board and NOT the private one. If this ever starts passing on the private board, 107
  // has become unnecessary and should be reconsidered rather than kept out of habit.
  await adminUser.from('columns').update({ title: 'Swept by title' }).eq('status_key', STATUS_KEY)
  const openAfterSweep = await orderOf(open.id)
  const secretAfterSweep = await orderOf(secret.id)
  check('the old direct sweep reaches an open board',
    openAfterSweep.some(c => c.title === 'Swept by title'))
  check('the old direct sweep silently misses a private board — the bug 107 fixes',
    secretAfterSweep.every(c => c.title !== 'Swept by title'))

  /* ── 7. the cascade reaches every linked column ──────────────────── */
  const cascadeTitle = `Renamed ${stamp}`
  const { data: renamedCount, error: cascadeError } = await adminUser
    .rpc('rename_columns_for_status', { p_status_key: STATUS_KEY, p_title: cascadeTitle })
  check('an admin can run the status rename cascade', !cascadeError)
  check('it reports how many columns it renamed', renamedCount === 2)

  const openAfter = await orderOf(open.id)
  const secretAfter = await orderOf(secret.id)
  check('the linked column on the open board was renamed',
    openAfter.some(c => c.title === cascadeTitle))
  check('the linked column on the PRIVATE board was renamed too',
    secretAfter.some(c => c.title === cascadeTitle))
  check('columns with no status link keep their own names',
    openAfter.filter(c => ['Alpha', 'Beta', 'Gamma'].includes(c.title)).length === 3
    && secretAfter.some(c => c.title === 'Custom, unlinked'))
  check('rearranging did not disturb the rename, or vice versa',
    idsOf(openAfter).join() === settled.join())

  // Idempotent: running it again renames nothing, so a UI reporting the count cannot inflate it.
  const { data: secondRun } = await adminUser
    .rpc('rename_columns_for_status', { p_status_key: STATUS_KEY, p_title: cascadeTitle })
  check('re-running the cascade with the same name renames nothing', secondRun === 0)

  /* ── 8. the cascade is admin-only and validates its input ────────── */
  const { error: memberCascadeError } = await member
    .rpc('rename_columns_for_status', { p_status_key: STATUS_KEY, p_title: 'hijacked' })
  check('a non-admin cannot run the cascade', Boolean(memberCascadeError))

  const { error: anonCascadeError } = await anonClient
    .rpc('rename_columns_for_status', { p_status_key: STATUS_KEY, p_title: 'hijacked' })
  check('an unauthenticated caller cannot run the cascade', Boolean(anonCascadeError))

  const { error: unknownStatusError } = await adminUser
    .rpc('rename_columns_for_status', { p_status_key: `no_such_status_${stamp}`, p_title: 'x' })
  check('an unknown status key is refused rather than renaming nothing quietly',
    Boolean(unknownStatusError))

  const { error: blankTitleError } = await adminUser
    .rpc('rename_columns_for_status', { p_status_key: STATUS_KEY, p_title: '   ' })
  check('a blank column name is refused', Boolean(blankTitleError))

  const finalOpen = await orderOf(open.id)
  const finalSecret = await orderOf(secret.id)
  check('no rejected cascade call changed a title',
    finalOpen.filter(c => c.title === cascadeTitle).length === 1
    && finalSecret.filter(c => c.title === cascadeTitle).length === 1)

  /* ── 9. one column per status per board still holds ──────────────── */
  const { error: duplicateStatusError } = await admin.from('columns')
    .insert({ board_id: open.id, title: 'Second claim', position: 9, status_key: STATUS_KEY })
  check('a board cannot hold two columns for the same status', Boolean(duplicateStatusError))
} finally {
  for (const id of boardIds) await admin.from('boards').delete().eq('id', id)
  await admin.from('task_statuses').delete().eq('key', STATUS_KEY)
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
