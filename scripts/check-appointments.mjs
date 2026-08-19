#!/usr/bin/env node
// Appointment rules RLS harness - the pass/fail gate for migrations 080/081.
// Creates two throwaway hosts via the service role, then asserts through REAL anon-key
// sessions (exactly like the app) that each can manage only their own settings and
// restrictions, and that an unauthenticated caller sees nothing at all.
//
// Mirrors scripts/check-board-roles.mjs. Non-destructive: everything it creates is
// deleted in `finally`. Run: pnpm check:appointments

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

// Two separate hosts. Both plain 'user' role, because the policies also allow admins to
// read for oversight - an admin here would mask a real isolation failure.
const HOSTS = [
  { email: `appt-a+${stamp}@example.com`, password: `ApptA-${stamp}-x9!` },
  { email: `appt-b+${stamp}@example.com`, password: `ApptB-${stamp}-x9!` },
]

let failures = 0
const createdUserIds = []
let restrictionA

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

async function signIn(host) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email: host.email, password: host.password })
  if (error) throw new Error(`signIn ${host.email}: ${error.message}`)
  return client
}

try {
  for (const host of HOSTS) {
    const { data, error } = await admin.auth.admin.createUser({
      email: host.email, password: host.password, email_confirm: true,
    })
    if (error) throw new Error(`createUser: ${error.message}`)
    host.id = data.user.id
    createdUserIds.push(host.id)

    // appointment_* FKs point at profiles(id). The on_auth_user_created trigger creates
    // that row, but don't race it - upsert explicitly, as check-board-roles.mjs does.
    const { error: profileErr } = await admin
      .from('profiles')
      .upsert({ id: host.id, email: host.email, role: 'user' }, { onConflict: 'id' })
    if (profileErr) throw new Error(`upsert profile: ${profileErr.message}`)
  }

  const [hostA, hostB] = HOSTS
  const clientA = await signIn(hostA)
  const clientB = await signIn(hostB)

  // --- Host A creates their own rules -------------------------------------------------
  const { error: settingsErr } = await clientA
    .from('appointment_settings')
    .upsert({ user_id: hostA.id, min_duration_minutes: 45, required_lead_time_hours: 2 }, { onConflict: 'user_id' })
  check('A: can create their own settings', !settingsErr)

  const { data: restriction, error: restrictionErr } = await clientA
    .from('appointment_restrictions')
    .insert({
      user_id: hostA.id, created_by: hostA.id, reason: 'harness restriction',
      starts_on: '2026-07-29', ends_on: '2026-08-01',
      is_all_day: false, starts_at_time: '05:00', ends_at_time: '23:45',
      weekdays: [3, 4, 5, 6],
    })
    .select('id')
    .single()
  check('A: can create their own restriction', !restrictionErr && !!restriction)
  restrictionA = restriction?.id

  const { data: ownRead } = await clientA
    .from('appointment_restrictions').select('id').eq('id', restrictionA)
  check('A: can read their own restriction', (ownRead ?? []).length === 1)

  // --- Host B must be fully isolated ---------------------------------------------------
  const { data: bReadsSettings } = await clientB
    .from('appointment_settings').select('user_id').eq('user_id', hostA.id)
  check('B: CANNOT read A\'s settings', (bReadsSettings ?? []).length === 0)

  const { data: bReadsRestrictions } = await clientB
    .from('appointment_restrictions').select('id').eq('id', restrictionA)
  check('B: CANNOT read A\'s restriction', (bReadsRestrictions ?? []).length === 0)

  const { data: bUpdates } = await clientB
    .from('appointment_restrictions').update({ reason: 'hijacked' }).eq('id', restrictionA).select('id')
  check('B: CANNOT update A\'s restriction', (bUpdates ?? []).length === 0)

  const { data: bDeletes } = await clientB
    .from('appointment_restrictions').delete().eq('id', restrictionA).select('id')
  check('B: CANNOT delete A\'s restriction', (bDeletes ?? []).length === 0)

  // The WITH CHECK on INSERT must stop B writing a row that belongs to A.
  const { data: bInserts } = await clientB
    .from('appointment_restrictions')
    .insert({
      user_id: hostA.id, reason: 'planted', starts_on: '2026-09-01', ends_on: '2026-09-02', is_all_day: true,
    })
    .select('id')
  check('B: CANNOT create a restriction owned by A', (bInserts ?? []).length === 0)

  const { data: bInsertsSettings } = await clientB
    .from('appointment_settings').insert({ user_id: hostA.id, min_duration_minutes: 5 }).select('user_id')
  check('B: CANNOT create settings owned by A', (bInsertsSettings ?? []).length === 0)

  // --- Confirm A is genuinely unaffected (proves the above isn't a blanket break) ------
  const { data: aStillReads } = await clientA
    .from('appointment_restrictions').select('reason').eq('id', restrictionA)
  check('A (control): restriction still intact and readable', aStillReads?.[0]?.reason === 'harness restriction')

  const { data: aUpdates } = await clientA
    .from('appointment_restrictions').update({ reason: 'edited by owner' }).eq('id', restrictionA).select('reason')
  check('A (control): CAN update their own restriction', aUpdates?.[0]?.reason === 'edited by owner')

  // --- Anonymous callers get nothing (081 revoked the default anon grants) -------------
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: anonRestrictions } = await anonClient.from('appointment_restrictions').select('id')
  check('anon: CANNOT read restrictions', (anonRestrictions ?? []).length === 0)

  const { data: anonSettings } = await anonClient.from('appointment_settings').select('user_id')
  check('anon: CANNOT read settings', (anonSettings ?? []).length === 0)

  const { data: anonInsert } = await anonClient
    .from('appointment_restrictions')
    .insert({ user_id: hostA.id, reason: 'anon', starts_on: '2026-09-01', ends_on: '2026-09-01', is_all_day: true })
    .select('id')
  check('anon: CANNOT create a restriction', (anonInsert ?? []).length === 0)

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed - appointment rules are per-host and closed to anon.')
  }
} catch (e) {
  console.error('appointments harness error:', e.message)
  process.exitCode = 1
} finally {
  // The postgrest query builder isn't a real Promise (no .catch()) - use try/catch instead.
  if (restrictionA) { try { await admin.from('appointment_restrictions').delete().eq('id', restrictionA) } catch {} }
  for (const id of createdUserIds) {
    try { await admin.from('appointment_restrictions').delete().eq('user_id', id) } catch {}
    try { await admin.from('appointment_settings').delete().eq('user_id', id) } catch {}
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('cleaned up test fixtures.')
}
