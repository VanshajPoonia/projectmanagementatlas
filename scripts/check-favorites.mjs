#!/usr/bin/env node
// Favourites access-control harness - the pass/fail gate for migration 097.
//
// A favourites list is private data: it says which boards a person cares about, which is a
// small but real signal about what they work on. 097's policies scope every row to its owner
// with no admin exemption, and this proves that through REAL anon-key sessions (exactly like
// the app), not by reading the catalog:
//   - owner        : stars, reads back, unstars
//   - another user : cannot read the owner's stars, cannot write into the owner's list,
//                    cannot delete the owner's row
//   - an admin     : same as another user - deliberately NOT exempted
//   - signed-out   : sees nothing, writes nothing
//
// It also pins the two structural guarantees the migration asserts: the unique index makes a
// double-star idempotent rather than a 23505, and UPDATE is not granted (star/unstar only).
//
// Non-destructive: every fixture it creates is deleted in `finally`. Run: pnpm check:favorites

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

const ACCOUNTS = {
  owner: { email: `fav-owner+${stamp}@example.com`, password: `Fav-${stamp}-o9!`, role: 'user' },
  other: { email: `fav-other+${stamp}@example.com`, password: `Fav-${stamp}-x9!`, role: 'user' },
  admin: { email: `fav-admin+${stamp}@example.com`, password: `Fav-${stamp}-a9!`, role: 'admin' },
}

const createdUserIds = []
const createdBoardIds = []
let failures = 0

function check(label, condition, extra = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${extra ? ` (${extra})` : ''}`)
  if (!condition) failures++
}

async function makeUser({ email, password, role }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  const id = data.user.id
  createdUserIds.push(id)
  const { error: pErr } = await admin.from('profiles').upsert({ id, email, role }, { onConflict: 'id' })
  if (pErr) throw new Error(`upsert profile ${email}: ${pErr.message}`)
  return id
}

async function sessionFor({ email, password }) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn ${email}: ${error.message}`)
  return client
}

try {
  const ids = {
    owner: await makeUser(ACCOUNTS.owner),
    other: await makeUser(ACCOUNTS.other),
    admin: await makeUser(ACCOUNTS.admin),
  }

  // A real board to star, plus a private one nobody in this harness is a member of - the
  // second is what proves a favourite is a pointer and not a grant.
  const { data: boards, error: boardErr } = await admin
    .from('boards')
    .insert([
      { title: `harness-fav-board-${stamp}`, created_by: ids.owner, is_private: false },
      { title: `harness-fav-private-${stamp}`, created_by: ids.other, is_private: true },
    ])
    .select('id,title')
  if (boardErr) throw new Error(`create boards: ${boardErr.message}`)
  const openBoard = boards.find((b) => b.title.includes('-board-'))
  const privateBoard = boards.find((b) => b.title.includes('-private-'))
  createdBoardIds.push(openBoard.id, privateBoard.id)

  const asOwner = await sessionFor(ACCOUNTS.owner)
  const asOther = await sessionFor(ACCOUNTS.other)
  const asAdmin = await sessionFor(ACCOUNTS.admin)
  const signedOut = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })

  // --- 1. The owner can star ------------------------------------------------------------
  const { error: starErr } = await asOwner
    .from('user_favorites')
    .insert({ user_id: ids.owner, entity_type: 'board', entity_id: openBoard.id })
  check('owner can star a board', !starErr, starErr?.message)

  const { data: ownerRows } = await asOwner.from('user_favorites').select('entity_id')
  check('owner reads their own star back', (ownerRows ?? []).some((r) => r.entity_id === openBoard.id))

  // --- 2. Nobody else can read it -------------------------------------------------------
  const { data: otherRows } = await asOther.from('user_favorites').select('entity_id')
  check(
    'another user cannot see the owner’s favourites',
    !(otherRows ?? []).some((r) => r.entity_id === openBoard.id),
    `saw ${(otherRows ?? []).length} row(s)`,
  )

  // The control case that makes the "no admin exemption" decision real rather than a
  // comment. Most policies in this schema call is_admin_user(); this one deliberately
  // does not, and that difference has to be provable.
  const { data: adminRows } = await asAdmin.from('user_favorites').select('entity_id')
  check(
    'an admin cannot see another person’s favourites either',
    !(adminRows ?? []).some((r) => r.entity_id === openBoard.id),
    `saw ${(adminRows ?? []).length} row(s)`,
  )

  // --- 3. Nobody else can write into it -------------------------------------------------
  const { error: forgeErr } = await asOther
    .from('user_favorites')
    .insert({ user_id: ids.owner, entity_type: 'board', entity_id: privateBoard.id })
  check('another user cannot write into the owner’s list', !!forgeErr, forgeErr?.message ?? 'insert succeeded')

  // PostgREST reports a zero-row DELETE as success, so assert on what survived rather than
  // on the absence of an error - the exact trap CLAUDE.md records for zero-row UPDATE.
  await asOther.from('user_favorites').delete().eq('entity_id', openBoard.id)
  const { data: afterForeignDelete } = await asOwner.from('user_favorites').select('entity_id')
  check(
    'another user’s delete removes nothing from the owner’s list',
    (afterForeignDelete ?? []).some((r) => r.entity_id === openBoard.id),
  )

  const { error: adminDeleteErr } = await asAdmin.from('user_favorites').delete().eq('entity_id', openBoard.id)
  const { data: afterAdminDelete } = await asOwner.from('user_favorites').select('entity_id')
  check(
    'an admin cannot clear someone else’s favourites',
    (afterAdminDelete ?? []).some((r) => r.entity_id === openBoard.id),
    adminDeleteErr?.message,
  )

  // --- 4. Idempotency -------------------------------------------------------------------
  const { error: dupeErr } = await asOwner
    .from('user_favorites')
    .upsert(
      { user_id: ids.owner, entity_type: 'board', entity_id: openBoard.id },
      { onConflict: 'user_id,entity_type,entity_id', ignoreDuplicates: true },
    )
  check('starring twice is idempotent, not a unique violation', !dupeErr, dupeErr?.message)

  const { count: dupeCount } = await asOwner
    .from('user_favorites')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', openBoard.id)
  check('a double-star leaves exactly one row', dupeCount === 1, `found ${dupeCount}`)

  // --- 5. A favourite is a pointer, not a grant -----------------------------------------
  // Starring a private board the user is not a member of is allowed (097 deliberately does
  // not check visibility), but it must not make the board readable.
  await asOwner
    .from('user_favorites')
    .insert({ user_id: ids.owner, entity_type: 'board', entity_id: privateBoard.id })
  const { data: reachable } = await asOwner.from('boards').select('id').eq('id', privateBoard.id)
  check(
    'starring a private board does NOT make it readable',
    (reachable ?? []).length === 0,
    `boards returned ${(reachable ?? []).length} row(s)`,
  )

  // --- 6. Constraints -------------------------------------------------------------------
  const { error: badTypeErr } = await asOwner
    .from('user_favorites')
    .insert({ user_id: ids.owner, entity_type: 'wormhole', entity_id: openBoard.id })
  check('an unknown entity_type is rejected by the CHECK', !!badTypeErr, badTypeErr?.message ?? 'insert succeeded')

  // 097 asserts UPDATE is ungranted so that reordering has to be a deliberate later grant.
  const { error: updateErr } = await asOwner
    .from('user_favorites')
    .update({ position: 5 })
    .eq('entity_id', openBoard.id)
  check('UPDATE is not granted yet (star/unstar only)', !!updateErr, updateErr?.message ?? 'update succeeded')

  // --- 7. Signed out --------------------------------------------------------------------
  const { data: anonRows, error: anonErr } = await signedOut.from('user_favorites').select('entity_id')
  check(
    'signed-out reads nothing',
    (anonRows ?? []).length === 0,
    anonErr ? anonErr.message : 'empty result',
  )
  const { error: anonWriteErr } = await signedOut
    .from('user_favorites')
    .insert({ user_id: ids.owner, entity_type: 'board', entity_id: openBoard.id })
  check('signed-out writes nothing', !!anonWriteErr, anonWriteErr?.message ?? 'insert succeeded')

  // --- 8. Unstar ------------------------------------------------------------------------
  await asOwner.from('user_favorites').delete().eq('entity_id', openBoard.id)
  const { data: afterUnstar } = await asOwner.from('user_favorites').select('entity_id')
  check(
    'owner can unstar their own board',
    !(afterUnstar ?? []).some((r) => r.entity_id === openBoard.id),
  )

  // --- 9. Deleting the account takes the favourites with it -----------------------------
  // The FK is ON DELETE CASCADE from profiles. Worth pinning because CLAUDE.md records a
  // seven-month-old bug that came from getting this direction backwards.
  const throwaway = await makeUser({
    email: `fav-temp+${stamp}@example.com`,
    password: `Fav-${stamp}-t9!`,
    role: 'user',
  })
  await admin
    .from('user_favorites')
    .insert({ user_id: throwaway, entity_type: 'board', entity_id: openBoard.id })
  await admin.auth.admin.deleteUser(throwaway)
  const { count: orphaned } = await admin
    .from('user_favorites')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', throwaway)
  check('deleting an account cascades its favourites away', orphaned === 0, `${orphaned} left behind`)

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed - favourites are private to their owner, and a star grants nothing.')
  }
} catch (e) {
  console.error('favourites harness error:', e.message)
  process.exitCode = 1
} finally {
  // ORDER MATTERS, and getting it wrong is silent. boards.created_by references profiles,
  // so deleting an account that still owns a board fails the cascade - and Supabase reports
  // that as a failed deleteUser, which an ignored .catch() would swallow. The harness then
  // "cleans up" while leaving real profiles behind, and the next run of check:teams fails
  // with "not every profile is in a team" pointing at accounts nobody can explain.
  // Boards first, users second, and every failure is printed.
  const problems = []
  for (const id of createdBoardIds) {
    const { error } = await admin.from('boards').delete().eq('id', id)
    if (error) problems.push(`board ${id}: ${error.message}`)
  }
  for (const id of createdUserIds) {
    await admin.from('user_favorites').delete().eq('user_id', id)
    const { error } = await admin.auth.admin.deleteUser(id)
    // "not found" is fine: check 9 deletes one of these on purpose.
    if (error && !/not found/i.test(error.message)) problems.push(`user ${id}: ${error.message}`)
  }

  if (problems.length > 0) {
    console.error('\n⚠️  cleanup left fixtures behind - these will break other harnesses:')
    for (const p of problems) console.error('   ' + p)
    process.exitCode = 1
  } else {
    console.log('cleaned up test fixtures.')
  }
}
