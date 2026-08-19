#!/usr/bin/env node
// Access + integrity gate for the CRM module (migration 103).
//
// Two halves, because CLAUDE.md's own lesson from the guest/client work is that a green RLS
// harness proves nothing on its own:
//   1. ACCESS - anon sees nothing, an active member can work the pipeline, a plain member
//      cannot delete a client, and a deactivated account loses everything on the next query.
//   2. INTEGRITY - the status history cannot be written, rewritten or deleted by the
//      application, and the trigger keeps it true no matter which path moves an order.
//
// The integrity half is the one that matters most: every report in the module is built on
// that table, so an audit trail the app can edit is a report nobody should believe.
//
// All fixtures are removed in finally. Dev sandbox only.

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

const memberCreds = { email: `crm-member-${stamp}@goatlasgo.us`, password: `Crm-${stamp}-mM!` }
const adminCreds = { email: `crm-admin-${stamp}@goatlasgo.us`, password: `Crm-${stamp}-aA!` }

let memberId, adminId, clientId, orderId
let failures = 0

function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

async function createUser(creds, role = 'user') {
  const { data, error } = await admin.auth.admin.createUser({ ...creds, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  const { error: pErr } = await admin
    .from('profiles')
    .upsert({ id: data.user.id, email: creds.email, full_name: `CRM ${role}`, role, is_active: true }, { onConflict: 'id' })
  if (pErr) throw new Error(`upsert profile: ${pErr.message}`)
  return data.user.id
}

async function signIn(creds) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword(creds)
  if (error) throw new Error(`signIn: ${error.message}`)
  return client
}

try {
  memberId = await createUser(memberCreds, 'user')
  adminId = await createUser(adminCreds, 'admin')

  const member = await signIn(memberCreds)
  const adminSession = await signIn(adminCreds)
  const anonClient = createClient(url, anon, { auth: { persistSession: false } })

  /* ── 1. anon ─────────────────────────────────────────────────────────────────────── */
  for (const table of ['crm_clients', 'crm_orders', 'crm_order_status_history', 'crm_statuses', 'crm_notes']) {
    const { data, error } = await anonClient.from(table).select('*').limit(1)
    check(`anon cannot read ${table}`, Boolean(error) || (data?.length ?? 0) === 0,
      error ? error.code : `${data?.length} row(s)`)
  }

  /* ── 2. a member can work the pipeline ───────────────────────────────────────────── */
  const { data: ref, error: refErr } = await member.rpc('claim_crm_client_ref')
  check('a member can claim a client reference', !refErr && typeof ref === 'string' && ref.startsWith('C-'),
    refErr?.message ?? String(ref))

  const { data: created, error: cErr } = await member
    .from('crm_clients')
    .insert({ client_ref: ref, company_name: `Check ${stamp}`, client_type: 'business', created_by: memberId })
    .select('id')
    .single()
  check('a member can create a client', !cErr && Boolean(created?.id), cErr?.message)
  clientId = created?.id

  const { data: orderNo } = await member.rpc('claim_crm_order_no')
  const { data: newOrder, error: oErr } = await member
    .from('crm_orders')
    .insert({ client_id: clientId, order_no: orderNo, status: 'new', created_by: memberId })
    .select('id')
    .single()
  check('a member can create an order', !oErr && Boolean(newOrder?.id), oErr?.message)
  orderId = newOrder?.id

  /* ── 3. the trigger, seen through a real session ─────────────────────────────────── */
  const { data: opening } = await member.from('crm_order_status_history').select('*').eq('order_id', orderId)
  check('creating an order opens exactly one interval', opening?.length === 1, `${opening?.length}`)
  check('the opening interval is still open', opening?.[0]?.exited_at === null)

  await member
    .from('crm_orders')
    .update({ status: 'in_progress', status_change_reason: 'Waiting on customer', status_change_note: 'harness' })
    .eq('id', orderId)

  const { data: afterMove } = await member
    .from('crm_order_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('entered_at')
  check('a transition closes the old interval and opens a new one', afterMove?.length === 2, `${afterMove?.length}`)
  check('the previous interval was closed', afterMove?.[0]?.exited_at !== null)
  check('exactly one interval is open', afterMove?.filter(r => r.exited_at === null).length === 1)
  check('the disposition landed on the interval it describes',
    afterMove?.[1]?.reason === 'Waiting on customer' && afterMove?.[1]?.note === 'harness',
    `${afterMove?.[1]?.reason}`)

  const { data: carriers } = await member
    .from('crm_orders')
    .select('status_change_reason, status_change_note')
    .eq('id', orderId)
    .single()
  check('the disposition carriers are blank at rest',
    carriers?.status_change_reason === null && carriers?.status_change_note === null)

  /* ── 3b. the carriers cannot outlive the transition they describe (migration 104) ──
     103 registered the trigger as BEFORE UPDATE *OF status*, so a write that set only the
     carriers never reached it, and the in-function early return skipped blanking them when
     the status was named but unchanged. Either way they persisted, and the NEXT transition
     read them and stamped that stale disposition onto the interval it opened - the audit
     trail asserting something that never happened. All three steps are pinned here. */
  await member
    .from('crm_orders')
    .update({ status_change_reason: 'Waiting on documentation', status_change_note: 'stale' })
    .eq('id', orderId)
  const { data: afterCarrierOnly } = await member
    .from('crm_orders').select('status_change_reason, status_change_note').eq('id', orderId).single()
  check('a carrier-only write does not persist',
    afterCarrierOnly?.status_change_reason === null && afterCarrierOnly?.status_change_note === null,
    `${afterCarrierOnly?.status_change_reason}`)

  await member
    .from('crm_orders')
    .update({ status: 'in_progress', status_change_reason: 'Waiting on internal review', status_change_note: 'no-op' })
    .eq('id', orderId)
  const { data: afterNoop } = await member
    .from('crm_orders').select('status_change_reason, status_change_note').eq('id', orderId).single()
  check('a no-op status write does not persist the carriers either',
    afterNoop?.status_change_reason === null && afterNoop?.status_change_note === null,
    `${afterNoop?.status_change_reason}`)

  await member.from('crm_orders').update({ status: 'ready_for_estimate' }).eq('id', orderId)
  const { data: inherited } = await member
    .from('crm_order_status_history').select('*').eq('order_id', orderId).eq('status', 'ready_for_estimate')
  check('a later transition inherits no stale disposition',
    inherited?.[0]?.reason === null && inherited?.[0]?.note === null,
    `${inherited?.[0]?.reason}`)

  /* ── 3c. a losing move must say why, below the UI (migration 104) ─────────────────── */
  const { error: noReasonErr } = await member
    .from('crm_orders').update({ status: 'cancel' }).eq('id', orderId)
  check('cancel is refused with no reason', Boolean(noReasonErr), noReasonErr?.code ?? 'UPDATE SUCCEEDED')

  const { error: withReasonErr } = await member
    .from('crm_orders')
    .update({ status: 'cancel', status_change_reason: 'Waiting on customer', status_change_note: 'went elsewhere' })
    .eq('id', orderId)
  check('cancel is accepted once a reason is given', !withReasonErr, withReasonErr?.message)
  await member.from('crm_orders').update({ status: 'in_progress' }).eq('id', orderId)

  /* ── 3d. references cannot collide (migration 104) ────────────────────────────────── */
  const { data: refA } = await member.rpc('claim_crm_client_ref')
  const { data: refB } = await member.rpc('claim_crm_client_ref')
  check('two reference claims never return the same value', Boolean(refA) && refA !== refB, `${refA} vs ${refB}`)

  /* ── 4. the history is not application-writable ──────────────────────────────────── */
  const openRow = afterMove?.find(r => r.exited_at === null)

  const { error: insErr } = await member
    .from('crm_order_status_history')
    .insert({ order_id: orderId, status: 'won', entered_at: new Date().toISOString() })
  check('a member cannot forge a history row', Boolean(insErr), insErr?.code ?? 'INSERT SUCCEEDED')

  const { data: updRows, error: updErr } = await member
    .from('crm_order_status_history')
    .update({ entered_at: '2020-01-01T00:00:00Z' })
    .eq('id', openRow.id)
    .select('id')
  check('a member cannot backdate a history row', Boolean(updErr) || (updRows?.length ?? 0) === 0,
    updErr?.code ?? `${updRows?.length} row(s)`)

  const { data: delRows, error: delErr } = await member
    .from('crm_order_status_history')
    .delete()
    .eq('id', openRow.id)
    .select('id')
  check('a member cannot delete a history row', Boolean(delErr) || (delRows?.length ?? 0) === 0,
    delErr?.code ?? `${delRows?.length} row(s)`)

  // Same three, as an admin: elevation must not unlock the audit trail either.
  const { error: adminInsErr } = await adminSession
    .from('crm_order_status_history')
    .insert({ order_id: orderId, status: 'won', entered_at: new Date().toISOString() })
  check('an admin cannot forge a history row either', Boolean(adminInsErr), adminInsErr?.code ?? 'INSERT SUCCEEDED')

  /* ── 5. reopening clears closed_at ───────────────────────────────────────────────── */
  await member.from('crm_orders').update({ status: 'won' }).eq('id', orderId)
  const { data: closed } = await member.from('crm_orders').select('closed_at').eq('id', orderId).single()
  check('reaching a terminal status stamps closed_at', closed?.closed_at !== null)

  await member.from('crm_orders').update({ status: 'in_progress' }).eq('id', orderId)
  const { data: reopened } = await member.from('crm_orders').select('closed_at').eq('id', orderId).single()
  check('reopening clears closed_at', reopened?.closed_at === null)

  /* ── 6. delete is admin-only ─────────────────────────────────────────────────────── */
  const { data: memberDel } = await member.from('crm_clients').delete().eq('id', clientId).select('id')
  check('a plain member cannot delete a client', (memberDel?.length ?? 0) === 0, `${memberDel?.length} row(s)`)

  /* ── 7. deactivation revokes on the next query ───────────────────────────────────── */
  await admin.from('profiles').update({ is_active: false }).eq('id', memberId)
  const { data: afterDeactivation } = await member.from('crm_clients').select('id').limit(1)
  check('a deactivated member reads no clients', (afterDeactivation?.length ?? 0) === 0,
    `${afterDeactivation?.length} row(s)`)

  const { data: deactivatedWrite } = await member
    .from('crm_orders')
    .update({ status: 'hold' })
    .eq('id', orderId)
    .select('id')
  check('a deactivated member cannot move an order', (deactivatedWrite?.length ?? 0) === 0,
    `${deactivatedWrite?.length} row(s)`)

  /* ── 8. admin can delete, and it cascades the history ────────────────────────────── */
  const { data: adminDel } = await adminSession.from('crm_clients').delete().eq('id', clientId).select('id')
  check('an admin can delete a client', (adminDel?.length ?? 0) === 1, `${adminDel?.length} row(s)`)

  const { count } = await admin
    .from('crm_order_status_history')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
  check('deleting a client cascades its order history', count === 0, `${count} row(s)`)
  clientId = null
} finally {
  if (clientId) await admin.from('crm_clients').delete().eq('id', clientId)
  for (const id of [memberId, adminId]) {
    if (!id) continue
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }
}

console.log(failures === 0 ? '\nAll CRM checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
