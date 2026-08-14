#!/usr/bin/env node
// Probe: can the status_change_* carrier columns persist at rest, and can a stale value then
// be attached to a LATER transition it does not describe?
//
// The trigger design's stated guarantee is that the carriers "are always NULL at rest" and
// that the history cannot disagree with crm_orders.status "however the row was moved: import,
// psql, a future automation". This drives exactly those non-UI write paths. Dev sandbox only.

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

assertDevDatabase()

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const failures = []
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n         ${detail}` : ''}`)
  if (!cond) failures.push(label)
}

let clientId
try {
  const { data: client, error: ce } = await admin
    .from('crm_clients')
    .insert({ company_name: '__probe_carriers__', client_type: 'business' })
    .select('id')
    .single()
  if (ce) throw ce
  clientId = client.id

  const { data: order, error: oe } = await admin
    .from('crm_orders')
    .insert({ client_id: clientId, status: 'new' })
    .select('id')
    .single()
  if (oe) throw oe

  console.log('\n1. UPDATE sets the carriers but does NOT touch status')
  await admin
    .from('crm_orders')
    .update({ status_change_reason: 'Waiting on customer', status_change_note: 'stale note' })
    .eq('id', order.id)

  let { data: row } = await admin
    .from('crm_orders')
    .select('status_change_reason, status_change_note')
    .eq('id', order.id)
    .single()
  ok(
    'carriers are blank at rest',
    row.status_change_reason === null && row.status_change_note === null,
    `reason=${JSON.stringify(row.status_change_reason)} note=${JSON.stringify(row.status_change_note)}`,
  )

  console.log('\n2. UPDATE sets status to the SAME value, plus carriers')
  await admin
    .from('crm_orders')
    .update({ status: 'new', status_change_reason: 'Waiting on documentation', status_change_note: 'no-op note' })
    .eq('id', order.id)
  ;({ data: row } = await admin
    .from('crm_orders')
    .select('status_change_reason, status_change_note')
    .eq('id', order.id)
    .single())
  ok(
    'a no-op status write still blanks the carriers',
    row.status_change_reason === null && row.status_change_note === null,
    `reason=${JSON.stringify(row.status_change_reason)} note=${JSON.stringify(row.status_change_note)}`,
  )

  console.log('\n3. A LATER real transition that supplies no disposition of its own')
  await admin.from('crm_orders').update({ status: 'won' }).eq('id', order.id)
  const { data: hist } = await admin
    .from('crm_order_status_history')
    .select('status, reason, note')
    .eq('order_id', order.id)
    .order('entered_at')
  const won = hist.find(h => h.status === 'won')
  ok(
    'the Won interval carries no disposition it was never given',
    won && won.reason === null && won.note === null,
    `won.reason=${JSON.stringify(won?.reason)} won.note=${JSON.stringify(won?.note)}`,
  )

  console.log('\nhistory:', JSON.stringify(hist))
} finally {
  if (clientId) await admin.from('crm_clients').delete().eq('id', clientId)
}

console.log(failures.length ? `\n${failures.length} defect(s) reproduced.` : '\nNo defect reproduced.')
process.exit(failures.length ? 1 : 0)
