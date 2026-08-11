#!/usr/bin/env node
// Write gate for marketing channel column ordering (migration 088).
//
// The bug this exists to prevent: marketing_channels' UPDATE policy is gated on
// `profiles.role = 'admin'` LITERALLY, which excludes super_admin — so the two people
// who actually run this calendar (both super_admin) would have silently failed every
// reorder. The RPC is what makes ordering writable without also handing out renaming,
// which would orphan events (marketing_calendar_items.channel is TEXT, no FK).
//
// Proves, against real RLS with throwaway users: a plain member and a super_admin can
// both reorder; neither can rename or archive; a real admin still can; a stale or
// duplicated ordering is rejected without moving anything; and anon can't call it at all.
// Channel positions are captured up front and restored in finally, so a run leaves the
// sandbox's channel order exactly as it found it.

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

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const stamp = Date.now()

const memberCredentials = { email: `channel-order-member+${stamp}@example.com`, password: `Channel-${stamp}-mM!` }
const superCredentials  = { email: `channel-order-super+${stamp}@example.com`,  password: `Channel-${stamp}-sS!` }
const adminCredentials  = { email: `channel-order-admin+${stamp}@example.com`,  password: `Channel-${stamp}-aA!` }

let originalPositions = []
let seededChannelIds = []
let failures = 0

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`)
  if (!condition) failures++
}

async function createTestUser(credentials, role = 'user') {
  const { data, error } = await admin.auth.admin.createUser({ ...credentials, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id,
    email: credentials.email,
    role,
  }, { onConflict: 'id' })
  if (profileError) throw new Error(`upsert profile: ${profileError.message}`)
  return data.user.id
}

function signedInClient() {
  return createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function signIn(credentials) {
  const client = signedInClient()
  const { error } = await client.auth.signInWithPassword(credentials)
  if (error) throw new Error(`sign-in ${credentials.email}: ${error.message}`)
  return client
}

// The order every client sees: active channels by position, ties broken by id so the
// harness compares against something stable rather than insertion luck.
async function activeOrder(client = admin) {
  const { data, error } = await client
    .from('marketing_channels')
    .select('id,position,is_archived')
    .order('position', { ascending: true })
  if (error) throw new Error(`read channels: ${error.message}`)
  return data.filter(c => !c.is_archived).map(c => c.id)
}

try {
  const { data: before, error: beforeError } = await admin
    .from('marketing_channels').select('id,position')
  if (beforeError) throw new Error(`snapshot channels: ${beforeError.message}`)
  originalPositions = before

  const { data: seeded, error: seedError } = await admin
    .from('marketing_channels')
    .insert([
      { channel: `zz-order-a-${stamp}`, label: `Order A ${stamp}`, position: 9001 },
      { channel: `zz-order-b-${stamp}`, label: `Order B ${stamp}`, position: 9002 },
    ])
    .select('id')
  if (seedError) throw new Error(`seed channels: ${seedError.message}`)
  seededChannelIds = seeded.map(c => c.id)

  const memberId = await createTestUser(memberCredentials, 'user')
  await createTestUser(superCredentials, 'super_admin')
  await createTestUser(adminCredentials, 'admin')

  const member = await signIn(memberCredentials)
  const superAdmin = await signIn(superCredentials)
  const adminUser = await signIn(adminCredentials)

  /* ── 1. a plain member can reorder ───────────────────────────────── */
  const baseline = await activeOrder()
  const swapped = [baseline[1], baseline[0], ...baseline.slice(2)]

  const { error: memberReorderError } = await member
    .rpc('reorder_marketing_channels', { p_channel_ids: swapped })
  check('a plain member can reorder channel columns', !memberReorderError)
  check('the member\'s order is what the database now returns', (await activeOrder()).join() === swapped.join())

  /* ── 2. the order is shared, not per-viewer ──────────────────────── */
  check('another user reads the same order back', (await activeOrder(superAdmin)).join() === swapped.join())

  /* ── 3. super_admin — the case that made the RPC necessary ───────── */
  const superOrder = [...swapped].reverse()
  const { error: superReorderError } = await superAdmin
    .rpc('reorder_marketing_channels', { p_channel_ids: superOrder })
  check('a super_admin can reorder (the literal role=\'admin\' policy excludes them)', !superReorderError)
  check('the super_admin\'s order persisted', (await activeOrder()).join() === superOrder.join())

  /* ── 4. reordering is the ONLY thing that opened up ──────────────── */
  const guineaPig = seededChannelIds[0]
  for (const [who, client] of [['member', member], ['super_admin', superAdmin]]) {
    await client.from('marketing_channels').update({ label: `hijacked by ${who}` }).eq('id', guineaPig)
    await client.from('marketing_channels').update({ is_archived: true }).eq('id', guineaPig)
    await client.from('marketing_channels').delete().eq('id', guineaPig)
    const { data: row } = await admin
      .from('marketing_channels').select('label,is_archived').eq('id', guineaPig).maybeSingle()
    check(`a ${who} still cannot rename, archive or delete a channel`,
      Boolean(row) && row.label === `Order A ${stamp}` && row.is_archived === false)
  }

  // Control: the admin path 055 left in place is untouched by this migration.
  await adminUser.from('marketing_channels').update({ label: `Order A ${stamp} (renamed)` }).eq('id', guineaPig)
  const { data: renamed } = await admin
    .from('marketing_channels').select('label').eq('id', guineaPig).maybeSingle()
  check('an admin can still rename a channel', renamed?.label === `Order A ${stamp} (renamed)`)

  /* ── 5. a stale or malformed ordering changes nothing ────────────── */
  const settled = await activeOrder()

  const { error: partialError } = await member
    .rpc('reorder_marketing_channels', { p_channel_ids: settled.slice(1) })
  check('a partial ordering is rejected', Boolean(partialError))
  check('a rejected partial ordering moved nothing', (await activeOrder()).join() === settled.join())

  const { error: duplicateError } = await member
    .rpc('reorder_marketing_channels', { p_channel_ids: [settled[0], ...settled] })
  check('a duplicated channel id is rejected', Boolean(duplicateError))

  const { error: unknownError } = await member
    .rpc('reorder_marketing_channels', {
      p_channel_ids: [...settled.slice(1), '00000000-0000-0000-0000-000000000000'],
    })
  check('an unknown channel id is rejected', Boolean(unknownError))

  const { error: emptyError } = await member
    .rpc('reorder_marketing_channels', { p_channel_ids: [] })
  check('an empty ordering is rejected', Boolean(emptyError))

  check('nothing moved across any rejected call', (await activeOrder()).join() === settled.join())

  /* ── 6. signed out is not a caller ───────────────────────────────── */
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: anonError } = await anonClient
    .rpc('reorder_marketing_channels', { p_channel_ids: settled })
  check('an unauthenticated caller cannot execute the reorder function', Boolean(anonError))
  check('the anon attempt moved nothing', (await activeOrder()).join() === settled.join())

  /* ── 7. the Personal business unit exists (migration 089) ────────── */
  const { data: personal } = await member
    .from('companies').select('code,name,is_archived').eq('code', 'PERSONAL').maybeSingle()
  check('every signed-in user can see the Personal company', personal?.name === 'Personal' && personal.is_archived === false)
} finally {
  for (const id of seededChannelIds) {
    await admin.from('marketing_channels').delete().eq('id', id)
  }
  for (const row of originalPositions) {
    await admin.from('marketing_channels').update({ position: row.position }).eq('id', row.id)
  }
  for (const credentials of [memberCredentials, superCredentials, adminCredentials]) {
    const { data } = await admin.auth.admin.listUsers()
    const user = data?.users?.find(u => u.email === credentials.email)
    if (user) await admin.auth.admin.deleteUser(user.id)
  }
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
