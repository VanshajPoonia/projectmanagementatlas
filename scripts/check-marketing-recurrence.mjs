#!/usr/bin/env node
// End-to-end recurrence transaction gate.
// Creates a four-row, two-date/two-channel series in the guarded dev project,
// proves a late company-link failure rolls the schedule update back, then proves
// a valid call shifts every row together. All fixtures are removed in finally.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
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
const credentials = {
  email: `marketing-recurrence+${stamp}@example.com`,
  password: `Recurrence-${stamp}-x9!`,
}
const recurrenceGroupId = randomUUID()

let userId
let itemIds = []
let failures = 0

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`)
  if (!condition) failures++
}

const originalRows = [
  { date: '2026-08-05', day_label: 'WED', channel: 'RLS social', position: 0 },
  { date: '2026-08-05', day_label: 'WED', channel: 'RLS email', position: 0 },
  { date: '2026-08-12', day_label: 'WED', channel: 'RLS social', position: 1 },
  { date: '2026-08-12', day_label: 'WED', channel: 'RLS email', position: 1 },
]

try {
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    ...credentials,
    email_confirm: true,
  })
  if (createUserError) throw new Error(`createUser: ${createUserError.message}`)
  userId = createdUser.user.id

  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    email: credentials.email,
    role: 'user',
  }, { onConflict: 'id' })
  if (profileError) throw new Error(`upsert profile: ${profileError.message}`)

  const { data: companies, error: companyError } = await admin
    .from('companies')
    .select('id')
    .eq('is_archived', false)
    .order('position')
    .limit(2)
  if (companyError || !companies?.length) {
    throw new Error(`load companies: ${companyError?.message ?? 'none available'}`)
  }

  const user = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await user.auth.signInWithPassword(credentials)
  if (signInError) throw new Error(`sign-in: ${signInError.message}`)

  const { data: inserted, error: insertError } = await user
    .from('marketing_calendar_items')
    .insert(originalRows.map(row => ({
      ...row,
      assigned_to: userId,
      content: 'Original recurrence',
      is_highlighted: false,
      source_sheet: null,
      source_row: null,
      source_column: null,
      recurrence_group_id: recurrenceGroupId,
    })))
    .select('id,date,channel')
  if (insertError || inserted?.length !== originalRows.length) {
    throw new Error(`create series: ${insertError?.message ?? 'wrong row count'}`)
  }
  itemIds = inserted.map(row => row.id)

  const { error: initialCompanyError } = await user
    .from('marketing_calendar_item_companies')
    .insert(itemIds.map(itemId => ({
      item_id: itemId,
      company_id: companies[0].id,
    })))
  if (initialCompanyError) throw new Error(`link initial company: ${initialCompanyError.message}`)

  const shiftedUpdates = inserted.map(row => ({
    id: row.id,
    date: row.date === '2026-08-05' ? '2026-08-06' : '2026-08-13',
    day_label: 'THU',
    channel: row.channel,
  }))

  const { error: rollbackError } = await user.rpc(
    'update_marketing_calendar_series_atomic',
    {
      p_recurrence_group_id: recurrenceGroupId,
      p_updates: shiftedUpdates,
      p_content: 'This must roll back',
      p_is_highlighted: true,
      p_company_ids: [randomUUID()],
    },
  )
  check('a late company-link failure rejects the transaction', Boolean(rollbackError))

  const { data: afterRollback } = await user
    .from('marketing_calendar_items')
    .select('date,day_label,content,is_highlighted')
    .eq('recurrence_group_id', recurrenceGroupId)
    .order('date')
  check(
    'failed transaction leaves every schedule row unchanged',
    afterRollback?.length === 4
      && afterRollback.every(row =>
        row.day_label === 'WED'
        && row.content === 'Original recurrence'
        && row.is_highlighted === false),
  )

  const { data: updatedCount, error: updateError } = await user.rpc(
    'update_marketing_calendar_series_atomic',
    {
      p_recurrence_group_id: recurrenceGroupId,
      p_updates: shiftedUpdates,
      p_content: 'Shifted recurrence',
      p_is_highlighted: true,
      p_company_ids: companies.map(company => company.id),
    },
  )
  check('valid series update changes all four rows together', !updateError && updatedCount === 4)

  const { data: afterSuccess } = await user
    .from('marketing_calendar_items')
    .select('date,day_label,content,is_highlighted')
    .eq('recurrence_group_id', recurrenceGroupId)
    .order('date')
  check(
    'successful transaction keeps every occurrence on Thursday',
    afterSuccess?.length === 4
      && afterSuccess.every(row =>
        row.day_label === 'THU'
        && row.content === 'Shifted recurrence'
        && row.is_highlighted === true),
  )

  const { count: companyLinkCount, error: linkCountError } = await user
    .from('marketing_calendar_item_companies')
    .select('*', { count: 'exact', head: true })
    .in('item_id', itemIds)
  check(
    'company links commit in the same transaction',
    !linkCountError && companyLinkCount === itemIds.length * companies.length,
  )

  console.log('')
  if (failures) {
    console.log(`${failures} recurrence check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All marketing recurrence checks passed.')
  }
} catch (error) {
  console.error('marketing recurrence harness error:', error.message)
  process.exitCode = 1
} finally {
  if (itemIds.length) {
    try { await admin.from('marketing_calendar_items').delete().in('id', itemIds) } catch {}
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {})
  console.log('cleaned up test fixtures.')
}
