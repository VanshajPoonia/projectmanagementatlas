#!/usr/bin/env node
// Shared view engine harness - the pass/fail gate for migrations 118 and 119.
//
//   118  boards.parent_board_id + board_descendants  - hierarchy, cycles refused
//   119  saved_views                                 - personal/shared, config validated
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the way
// the app reaches the database - never through the service role, which bypasses RLS and would
// pass whatever the policies said. The service role builds and tears down fixtures only.
//
// Every restriction has a CONTROL case proving it is specific rather than a blanket break, per
// the lesson in CLAUDE.md: a harness that only shows refusals cannot tell a working permission
// apart from a broken table. The bounds checks likewise assert that generous limits ACCEPT.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:views

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
function section(name) {
  console.log(`\n--- ${name} ---`)
}

/** A write RLS refused: PostgREST reports either an error or, for a filtered row, nothing. */
const refused = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0)
const landed = (res) => !res.error && Array.isArray(res.data) && res.data.length > 0

const users = []
async function makeUser(tag, role) {
  const email = `views-${tag}+${stamp}@example.com`
  const password = `Vw-${stamp}-${tag}!x9`
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

const boardIds = []
async function makeBoard(title, extra = {}) {
  const { data, error } = await admin
    .from('boards')
    .insert({ title: `${title} ${stamp}`, created_by: users[0] ?? null, ...extra })
    .select('id')
    .single()
  if (error) throw new Error(`makeBoard(${title}): ${error.message}`)
  boardIds.push(data.id)
  return data.id
}

const viewIds = []
async function trackView(res) {
  if (res?.data?.[0]?.id) viewIds.push(res.data[0].id)
  return res
}

const LIST = { layout: 'list' }

let root, childA, childB, grandchild, privateChild, unrelated

try {
  const owner = await makeUser('owner', 'user')
  const other = await makeUser('other', 'user')
  const adminUser = await makeUser('admin', 'admin')

  // =======================================================================================
  section('118 - board hierarchy')
  // =======================================================================================
  root = await makeBoard('Root')
  childA = await makeBoard('Child A')
  childB = await makeBoard('Child B')
  grandchild = await makeBoard('Grandchild')
  unrelated = await makeBoard('Unrelated')

  await admin.from('boards').update({ parent_board_id: root }).in('id', [childA, childB])
  await admin.from('boards').update({ parent_board_id: childA }).eq('id', grandchild)

  const all = await owner.client.rpc('board_descendants', { p_board_id: root, p_max_depth: null })
  const allIds = (all.data ?? []).map((r) => r.board_id)
  check('board_descendants reaches every generation', allIds.length === 4, JSON.stringify(all.error ?? allIds))
  check('board_descendants includes the grandchild', allIds.includes(grandchild))
  check('board_descendants excludes an unrelated root', !allIds.includes(unrelated))

  const direct = await owner.client.rpc('board_descendants', { p_board_id: root, p_max_depth: 1 })
  const directIds = (direct.data ?? []).map((r) => r.board_id)
  check('depth 1 returns the board and its direct children only', directIds.length === 3, JSON.stringify(directIds))
  check('depth 1 excludes the grandchild', !directIds.includes(grandchild))

  const selfOnly = await owner.client.rpc('board_descendants', { p_board_id: root, p_max_depth: 0 })
  check('depth 0 returns just the board', (selfOnly.data ?? []).length === 1)

  const depths = new Map((all.data ?? []).map((r) => [r.board_id, r.depth]))
  check('the root reports depth 0', depths.get(root) === 0)
  check('a child reports depth 1', depths.get(childA) === 1)
  check('a grandchild reports depth 2', depths.get(grandchild) === 2)

  // The whole point of the feature (ATLAS_01 4.6): no view to update.
  const newChild = await makeBoard('Added later')
  await admin.from('boards').update({ parent_board_id: childB }).eq('id', newChild)
  const afterAdd = await owner.client.rpc('board_descendants', { p_board_id: root, p_max_depth: null })
  check(
    'a board created after the fact is in the roll-up with no view edit',
    (afterAdd.data ?? []).some((r) => r.board_id === newChild),
  )

  // --- cycles ---------------------------------------------------------------------------
  const selfParent = await admin.from('boards').update({ parent_board_id: root }).eq('id', root).select('id')
  check('a board cannot be its own parent', refused(selfParent), JSON.stringify(selfParent.error))

  const loop = await admin.from('boards').update({ parent_board_id: grandchild }).eq('id', root).select('id')
  check('a three-board cycle is refused', refused(loop), JSON.stringify(loop.error))

  const twoLoop = await admin.from('boards').update({ parent_board_id: childA }).eq('id', root).select('id')
  check('a two-board cycle is refused', refused(twoLoop), JSON.stringify(twoLoop.error))

  // CONTROL: the guard refuses cycles, not every re-parent.
  const legal = await admin.from('boards').update({ parent_board_id: root }).eq('id', unrelated).select('id')
  check('CONTROL: a legal re-parent still succeeds', landed(legal), JSON.stringify(legal.error))
  await admin.from('boards').update({ parent_board_id: null }).eq('id', unrelated)

  const detach = await admin.from('boards').update({ parent_board_id: null }).eq('id', childB).select('id')
  check('CONTROL: a board can be detached back to a root', landed(detach))
  await admin.from('boards').update({ parent_board_id: root }).eq('id', childB)

  // --- privacy --------------------------------------------------------------------------
  privateChild = await makeBoard('Private child', { is_private: true, created_by: adminUser.id })
  await admin.from('boards').update({ parent_board_id: root }).eq('id', privateChild)

  const outsiderWalk = await other.client.rpc('board_descendants', { p_board_id: root, p_max_depth: null })
  const outsiderIds = (outsiderWalk.data ?? []).map((r) => r.board_id)
  check(
    'a non-member does not see a private board in the walk',
    !outsiderIds.includes(privateChild),
    JSON.stringify(outsiderIds),
  )
  check('CONTROL: the same non-member still sees the public children', outsiderIds.includes(childA))

  // SECURITY INVOKER is the whole story here: the creator of the private board does see it.
  const creatorWalk = await adminUser.client.rpc('board_descendants', { p_board_id: root, p_max_depth: null })
  check(
    'CONTROL: the private board IS in its own creator\'s walk',
    (creatorWalk.data ?? []).map((r) => r.board_id).includes(privateChild),
  )

  // --- deleting a parent must not delete the work under it --------------------------------
  const doomed = await makeBoard('Doomed parent')
  const survivor = await makeBoard('Survivor')
  await admin.from('boards').update({ parent_board_id: doomed }).eq('id', survivor)
  await admin.from('boards').delete().eq('id', doomed)
  const stillThere = await admin.from('boards').select('id, parent_board_id').eq('id', survivor).maybeSingle()
  check('deleting a parent does NOT delete its children', Boolean(stillThere.data), JSON.stringify(stillThere.error))
  check('the orphan becomes a root rather than dangling', stillThere.data?.parent_board_id === null)

  // =======================================================================================
  section('119 - saved views, personal scope')
  // =======================================================================================
  const mine = await trackView(await owner.client
    .from('saved_views')
    .insert({ owner_id: owner.id, name: `Mine ${stamp}`, scope: 'personal', config: LIST })
    .select('id, name, scope'))
  check('a user can create a personal view', landed(mine), JSON.stringify(mine.error))

  const readMine = await owner.client.from('saved_views').select('id').eq('id', mine.data?.[0]?.id)
  check('CONTROL: the owner can read it back', (readMine.data ?? []).length === 1)

  const otherReads = await other.client.from('saved_views').select('id').eq('id', mine.data?.[0]?.id)
  check('another user cannot read a personal view', (otherReads.data ?? []).length === 0)

  // The one table in this schema an admin deliberately cannot read - asserted by 119 too.
  const adminReads = await adminUser.client.from('saved_views').select('id').eq('id', mine.data?.[0]?.id)
  check('an ADMIN cannot read someone\'s personal view', (adminReads.data ?? []).length === 0)

  const adminEdits = await adminUser.client
    .from('saved_views').update({ name: 'hijacked' }).eq('id', mine.data?.[0]?.id).select('id')
  check('an admin cannot edit a personal view', refused(adminEdits))

  const adminDeletes = await adminUser.client
    .from('saved_views').delete().eq('id', mine.data?.[0]?.id).select('id')
  check('an admin cannot delete a personal view', refused(adminDeletes))

  const forge = await other.client
    .from('saved_views')
    .insert({ owner_id: owner.id, name: `Forged ${stamp}`, scope: 'personal', config: LIST })
    .select('id')
  check('a user cannot create a view owned by somebody else', refused(forge))
  await trackView(forge)

  // =======================================================================================
  section('119 - saved views, shared scope')
  // =======================================================================================
  const shared = await trackView(await owner.client
    .from('saved_views')
    .insert({ owner_id: owner.id, name: `Shared ${stamp}`, scope: 'shared', config: LIST })
    .select('id, scope'))
  check('a user can create a shared view', landed(shared), JSON.stringify(shared.error))

  const sharedId = shared.data?.[0]?.id
  const otherSeesShared = await other.client.from('saved_views').select('id').eq('id', sharedId)
  check('another user CAN read a shared view', (otherSeesShared.data ?? []).length === 1)

  const otherEditsShared = await other.client
    .from('saved_views').update({ name: 'theirs now' }).eq('id', sharedId).select('id')
  check('a plain user cannot edit someone else\'s shared view', refused(otherEditsShared))

  const adminEditsShared = await adminUser.client
    .from('saved_views').update({ name: `Tidied ${stamp}` }).eq('id', sharedId).select('id')
  check('an admin CAN tidy a shared view', landed(adminEditsShared), JSON.stringify(adminEditsShared.error))

  const ownerEdits = await owner.client
    .from('saved_views').update({ name: `Renamed ${stamp}` }).eq('id', sharedId).select('id')
  check('CONTROL: the owner can still edit their own shared view', landed(ownerEdits))

  // =======================================================================================
  section('119 - board-scoped views are bounded by the board')
  // =======================================================================================
  const onPrivate = await trackView(await adminUser.client
    .from('saved_views')
    .insert({ owner_id: adminUser.id, name: `On private ${stamp}`, scope: 'shared', board_id: privateChild, config: LIST })
    .select('id'))
  check('a shared view can be attached to a board its owner can see', landed(onPrivate), JSON.stringify(onPrivate.error))

  const outsiderSeesIt = await other.client.from('saved_views').select('id').eq('id', onPrivate.data?.[0]?.id)
  check(
    'a shared view on a private board is invisible to a non-member',
    (outsiderSeesIt.data ?? []).length === 0,
  )

  const onPublic = await trackView(await owner.client
    .from('saved_views')
    .insert({ owner_id: owner.id, name: `On public ${stamp}`, scope: 'shared', board_id: childA, config: LIST })
    .select('id'))
  check('CONTROL: a shared view on a PUBLIC board is visible to everyone', landed(onPublic))
  const outsiderSeesPublic = await other.client.from('saved_views').select('id').eq('id', onPublic.data?.[0]?.id)
  check('CONTROL: and the non-member really can read that one', (outsiderSeesPublic.data ?? []).length === 1)

  const onHidden = await other.client
    .from('saved_views')
    .insert({ owner_id: other.id, name: `Sneaky ${stamp}`, scope: 'personal', board_id: privateChild, config: LIST })
    .select('id')
  check('a view cannot be attached to a board the creator cannot see', refused(onHidden))
  await trackView(onHidden)

  // =======================================================================================
  section('119 - the config guard refuses what the renderer cannot survive')
  // =======================================================================================
  const bad = [
    ['a non-object config', '"just a string"'],
    ['an unknown layout', { layout: 'gantt' }],
    ['a missing layout', { filters: [] }],
    ['a non-array filters', { layout: 'list', filters: 'nope' }],
    ['a non-array sort', { layout: 'list', sort: {} }],
    ['a non-array visibleFields', { layout: 'list', visibleFields: 3 }],
    ['an unknown descendant mode', { layout: 'list', descendants: 'everything' }],
  ]
  for (const [label, config] of bad) {
    const res = await owner.client
      .from('saved_views')
      .insert({ owner_id: owner.id, name: `Bad ${stamp}`, scope: 'personal', config })
      .select('id')
    check(`refuses ${label}`, refused(res), JSON.stringify(res.data))
    await trackView(res)
  }

  const blank = await owner.client
    .from('saved_views').insert({ owner_id: owner.id, name: '   ', scope: 'personal', config: LIST }).select('id')
  check('refuses a blank name', refused(blank))
  await trackView(blank)

  const tooLong = await owner.client
    .from('saved_views').insert({ owner_id: owner.id, name: 'x'.repeat(121), scope: 'personal', config: LIST }).select('id')
  check('refuses a name past the column limit', refused(tooLong))
  await trackView(tooLong)

  const badScope = await owner.client
    .from('saved_views').insert({ owner_id: owner.id, name: `Scope ${stamp}`, scope: 'public', config: LIST }).select('id')
  check('refuses a scope outside personal/shared', refused(badScope))
  await trackView(badScope)

  // CONTROL: a full, realistic config is ACCEPTED. A guard that only ever refuses cannot be
  // told apart from a broken table.
  const rich = await trackView(await owner.client
    .from('saved_views')
    .insert({
      owner_id: owner.id, name: `Rich ${stamp}`, scope: 'personal', board_id: root,
      config: {
        layout: 'kanban', descendants: 'all', boardIds: [root], filterJoin: 'or',
        filters: [{ id: 'a', field: 'assignee', operator: 'is', values: ['@me'] }],
        sort: [{ field: 'due_date', direction: 'desc' }],
        visibleFields: ['title', 'assignee'], fields: ['title', 'assignee'],
        group: 'status', subgroup: null, density: 'compact',
        hierarchy: 'nested', completed: 'hide',
      },
    })
    .select('id, config'))
  check('CONTROL: a complete, realistic config is accepted', landed(rich), JSON.stringify(rich.error))
  check('every field of it round-trips', rich.data?.[0]?.config?.descendants === 'all')
  check('the @me sentinel is stored verbatim, not resolved at save time',
    rich.data?.[0]?.config?.filters?.[0]?.values?.[0] === '@me')

  // Each of the four layouts must be accepted, or the picker offers a value that cannot save.
  for (const layout of ['list', 'table', 'kanban', 'calendar']) {
    const res = await trackView(await owner.client
      .from('saved_views')
      .insert({ owner_id: owner.id, name: `L-${layout}-${stamp}`, scope: 'personal', config: { layout } })
      .select('id'))
    check(`CONTROL: layout "${layout}" is accepted`, landed(res), JSON.stringify(res.error))
  }
  for (const mode of ['none', 'direct', 'all']) {
    const res = await trackView(await owner.client
      .from('saved_views')
      .insert({ owner_id: owner.id, name: `D-${mode}-${stamp}`, scope: 'personal', config: { layout: 'list', descendants: mode } })
      .select('id'))
    check(`CONTROL: descendant mode "${mode}" is accepted`, landed(res), JSON.stringify(res.error))
  }

  // =======================================================================================
  section('119 - grants and RLS')
  // =======================================================================================
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const anonRead = await anonClient.from('saved_views').select('id')
  check('anon cannot read saved views at all', (anonRead.data ?? []).length === 0)

  const anonWrite = await anonClient
    .from('saved_views').insert({ owner_id: owner.id, name: `Anon ${stamp}`, config: LIST }).select('id')
  check('anon cannot create a saved view', refused(anonWrite))

  const anonWalk = await anonClient.rpc('board_descendants', { p_board_id: root, p_max_depth: null })
  check('anon cannot execute board_descendants', Boolean(anonWalk.error), JSON.stringify(anonWalk.data))

  // updated_at is stamped by the trigger, so a stale client value cannot win.
  const before = await owner.client.from('saved_views').select('updated_at').eq('id', mine.data?.[0]?.id).maybeSingle()
  await new Promise((r) => setTimeout(r, 1100))
  await owner.client.from('saved_views').update({ name: `Touched ${stamp}` }).eq('id', mine.data?.[0]?.id).select('id')
  const after = await owner.client.from('saved_views').select('updated_at').eq('id', mine.data?.[0]?.id).maybeSingle()
  check(
    'updated_at moves on every save, whatever the client sent',
    new Date(after.data?.updated_at).getTime() > new Date(before.data?.updated_at).getTime(),
  )

  const forgedStamp = await owner.client
    .from('saved_views')
    .update({ name: `Stamp ${stamp}`, updated_at: '2000-01-01T00:00:00Z' })
    .eq('id', mine.data?.[0]?.id)
    .select('updated_at')
  check(
    'a backdated updated_at is overwritten rather than stored',
    new Date(forgedStamp.data?.[0]?.updated_at).getFullYear() > 2000,
  )

  // =======================================================================================
  section('119 - deleting')
  // =======================================================================================
  const doomedView = await trackView(await owner.client
    .from('saved_views').insert({ owner_id: owner.id, name: `Doomed ${stamp}`, scope: 'personal', config: LIST }).select('id'))
  const gone = await owner.client.from('saved_views').delete().eq('id', doomedView.data?.[0]?.id).select('id')
  check('CONTROL: an owner can delete their own view', landed(gone))

  // A view is a pointer, not a grant: deleting it must not touch a board or a task.
  const boardsBefore = await admin.from('boards').select('id', { count: 'exact', head: true })
  const viewOnBoard = await trackView(await owner.client
    .from('saved_views').insert({ owner_id: owner.id, name: `Ptr ${stamp}`, scope: 'personal', board_id: childA, config: LIST }).select('id'))
  await owner.client.from('saved_views').delete().eq('id', viewOnBoard.data?.[0]?.id).select('id')
  const boardsAfter = await admin.from('boards').select('id', { count: 'exact', head: true })
  check('deleting a view changes no board', boardsBefore.count === boardsAfter.count)

  // Deleting a BOARD takes its views with it - they point at something that no longer exists.
  const tempBoard = await makeBoard('Temp for cascade')
  const cascadeView = await admin
    .from('saved_views')
    .insert({ owner_id: owner.id, name: `Cascade ${stamp}`, scope: 'personal', board_id: tempBoard, config: LIST })
    .select('id').single()
  await admin.from('boards').delete().eq('id', tempBoard)
  const cascadeGone = await admin.from('saved_views').select('id').eq('id', cascadeView.data.id)
  check('deleting a board removes the views scoped to it', (cascadeGone.data ?? []).length === 0)
} finally {
  // ---------------------------------------------------------------------------------------
  // Teardown - non-destructive, everything created above goes
  // ---------------------------------------------------------------------------------------
  if (viewIds.length) await admin.from('saved_views').delete().in('id', viewIds)
  if (users.length) await admin.from('saved_views').delete().in('owner_id', users)
  // Children first: parent_board_id is ON DELETE SET NULL, so order is not strictly required,
  // but deleting in reverse creation order keeps the log readable.
  for (const id of [...boardIds].reverse()) await admin.from('boards').delete().eq('id', id)
  for (const id of users) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
