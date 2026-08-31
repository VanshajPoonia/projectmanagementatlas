#!/usr/bin/env node
// Owner-decisions harness - the pass/fail gate for migration 128.
//
// Everything that claims to be a boundary is exercised through a REAL anon-key session, the way
// the app reaches the database - never through the service role, which bypasses RLS and would
// pass whatever the policies said. The service role builds and tears down fixtures only.
//
// ⚠️ Every restriction has a CONTROL case. This table is super-admin-only, and the one that
// matters most is the PLAIN ADMIN: `private.is_admin_user()` is true for admin AND super_admin
// in this database, so a policy that accidentally used it would look correct in review and
// quietly expose governance records to three more people.
//
// ⚠️ Where a guarantee is "the trigger refuses this", the harness TRIES THE BAD WRITE. "The
// trigger exists" and "the trigger refuses this" are different claims.
//
// Non-destructive: everything it creates is deleted in `finally`. Run: pnpm check:decisions

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

const refused = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0)
const landed = (res) => !res.error && Array.isArray(res.data) && res.data.length > 0

const users = []
async function makeUser(tag, role) {
  const email = `dec-${tag}+${stamp}@example.com`
  const password = `De-${stamp}-${tag}!x9`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser(${tag}): ${error.message}`)
  const id = data.user.id
  const { error: pErr } = await admin.from('profiles')
    .upsert({ id, email, full_name: `Dec ${tag}`, role, is_active: true }, { onConflict: 'id' })
  if (pErr) throw new Error(`profile(${tag}): ${pErr.message}`)
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: sErr } = await client.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`signIn(${tag}): ${sErr.message}`)
  users.push(id)
  return { id, email, client }
}

const created = []
try {
  const sup = await makeUser('super', 'super_admin')
  const adm = await makeUser('admin', 'admin')
  const mem = await makeUser('member', 'user')

  // =====================================================================================
  section('A super admin can record and read a decision')
  // =====================================================================================
  const ins = await sup.client.from('owner_decisions').insert({
    title: `HARNESS ${stamp}`, summary: 'probe', detail: 'd', recommendation: 'r',
  }).select('id, status, position')
  check('a super admin can add one', landed(ins), ins.error?.message)
  const id = ins.data?.[0]?.id
  if (!id) throw new Error('no decision id - nothing below can be meaningful')
  created.push(id)
  check('and it starts life open', ins.data[0].status === 'open')

  const read = await sup.client.from('owner_decisions').select('id').eq('id', id)
  check('and read it back', landed(read))

  // =====================================================================================
  section('Nobody below super admin can see it at all')
  // =====================================================================================
  // ⚠️ THE control case. is_admin_user() is true for admin AND super_admin here, so a policy
  // written with the wrong helper looks right and exposes this to three more people.
  const admRead = await adm.client.from('owner_decisions').select('id').eq('id', id)
  check('a PLAIN ADMIN cannot read decisions', !landed(admRead), JSON.stringify(admRead.data))
  const memRead = await mem.client.from('owner_decisions').select('id').eq('id', id)
  check('an ordinary member cannot read decisions', !landed(memRead))

  const admIns = await adm.client.from('owner_decisions')
    .insert({ title: `ADMIN ${stamp}`, summary: 'x' }).select('id')
  check('a plain admin cannot add one', refused(admIns))
  if (landed(admIns)) created.push(admIns.data[0].id)

  const admUpd = await adm.client.from('owner_decisions')
    .update({ summary: 'hijacked' }).eq('id', id).select('id')
  check('a plain admin cannot edit one', refused(admUpd))
  const admDel = await adm.client.from('owner_decisions').delete().eq('id', id).select('id')
  check('a plain admin cannot delete one', refused(admDel))

  const stillThere = await sup.client.from('owner_decisions').select('summary').eq('id', id).single()
  check('and the row is untouched after all of that', stillThere.data?.summary === 'probe')

  // =====================================================================================
  section('Closing a decision needs a reason, and the trigger is the authority')
  // =====================================================================================
  const noNote = await sup.client.from('owner_decisions')
    .update({ status: 'resolved' }).eq('id', id).select('id')
  check('closing with no note is REFUSED', Boolean(noNote.error), 'it was allowed through')
  const blankNote = await sup.client.from('owner_decisions')
    .update({ status: 'resolved', resolution_note: '   ' }).eq('id', id).select('id')
  check('and a whitespace-only note is refused too', Boolean(blankNote.error))

  const closed = await sup.client.from('owner_decisions')
    .update({ status: 'resolved', resolution_note: 'because x' }).eq('id', id)
    .select('status, resolution_note, resolved_at, resolved_by')
  check('CONTROL: with a real note it closes', landed(closed), closed.error?.message)
  check('and the closure is stamped, not left null',
    Boolean(closed.data?.[0]?.resolved_at) && closed.data?.[0]?.resolved_by === sup.id)

  // =====================================================================================
  section('The closure record cannot be forged')
  // =====================================================================================
  // Who closed it and when is the whole value of the log. A client that could set them could
  // make the record say somebody else made a call they did not make.
  const forge = await sup.client.from('owner_decisions')
    .update({ status: 'dismissed', resolution_note: 'n', resolved_by: mem.id, resolved_at: '2000-01-01T00:00:00Z' })
    .eq('id', id).select('resolved_by, resolved_at')
  check('a supplied resolved_by is overwritten with the real actor',
    forge.data?.[0]?.resolved_by === sup.id, String(forge.data?.[0]?.resolved_by))
  check('and a backdated resolved_at is overwritten on UPDATE',
    !String(forge.data?.[0]?.resolved_at ?? '').startsWith('2000'), String(forge.data?.[0]?.resolved_at))

  // =====================================================================================
  section('Reopening clears the outcome rather than leaving a stale one')
  // =====================================================================================
  const reopened = await sup.client.from('owner_decisions')
    .update({ status: 'open' }).eq('id', id)
    .select('status, resolution_note, resolved_at, resolved_by')
  const r = reopened.data?.[0]
  check('it reopens', r?.status === 'open')
  check('and the note, the resolver and the timestamp are all cleared',
    r?.resolution_note === null && r?.resolved_at === null && r?.resolved_by === null,
    JSON.stringify(r))

  // =====================================================================================
  section('The seeded decisions are really there')
  // =====================================================================================
  const seeded = await sup.client.from('owner_decisions')
    .select('title, status').not('title', 'like', 'HARNESS%')
  check('migration 128 seeded the live decisions', (seeded.data?.length ?? 0) >= 4,
    `found ${seeded.data?.length ?? 0}`)
  check('with at least one still waiting on somebody',
    (seeded.data ?? []).some((d) => d.status === 'open'))
  check('and at least one already decided',
    (seeded.data ?? []).some((d) => d.status === 'resolved'))

  // =====================================================================================
  section('A super admin can delete their own record')
  // =====================================================================================
  const del = await sup.client.from('owner_decisions').delete().eq('id', id).select('id')
  check('delete works for a super admin', landed(del))
  if (landed(del)) created.splice(created.indexOf(id), 1)
} catch (err) {
  // Report the throw. Without this the finally prints "N checks passed" over a run that aborted
  // half way, which reads as a clean pass - the most misleading outcome a gate can produce.
  failures++
  console.log(`\nFAIL - the run threw before finishing: ${err?.message ?? err}`)
  console.log(err?.stack ?? '')
} finally {
  for (const id of created) await admin.from('owner_decisions').delete().eq('id', id)
  for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
