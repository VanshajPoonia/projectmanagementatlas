#!/usr/bin/env node
// Cross-calendar isolation gate for the multi-calendar marketing feature (migration 085).
// Creates two calendars and two throwaway users, each a member of exactly one, and proves:
// each user sees only their own calendar's item/check/attachment/storage object; an admin
// session sees both unconditionally; a non-member can't INSERT into a calendar by supplying
// its id even though they can't SELECT it; and removing a membership row immediately revokes
// access on the very next query. All fixtures are removed in finally.

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

const userACredentials = { email: `calendar-access-a+${stamp}@example.com`, password: `Calendar-${stamp}-aA!` }
const userBCredentials = { email: `calendar-access-b+${stamp}@example.com`, password: `Calendar-${stamp}-bB!` }
const adminCredentials = { email: `calendar-access-admin+${stamp}@example.com`, password: `Calendar-${stamp}-Ad!` }

let userAId, userBId, adminId
let calendarAId, calendarBId
let itemAId, itemBId
let storagePathA
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

try {
  userAId = await createTestUser(userACredentials)
  userBId = await createTestUser(userBCredentials)
  adminId = await createTestUser(adminCredentials, 'admin')

  const { data: calA, error: calAError } = await admin
    .from('marketing_calendars').insert({ name: `Calendar A ${stamp}`, created_by: userAId }).select('id').single()
  if (calAError) throw new Error(`create calendar A: ${calAError.message}`)
  calendarAId = calA.id

  const { data: calB, error: calBError } = await admin
    .from('marketing_calendars').insert({ name: `Calendar B ${stamp}`, created_by: userBId }).select('id').single()
  if (calBError) throw new Error(`create calendar B: ${calBError.message}`)
  calendarBId = calB.id

  const { error: memberAError } = await admin
    .from('marketing_calendar_members').insert({ calendar_id: calendarAId, user_id: userAId })
  if (memberAError) throw new Error(`seed membership A: ${memberAError.message}`)

  const { error: memberBError } = await admin
    .from('marketing_calendar_members').insert({ calendar_id: calendarBId, user_id: userBId })
  if (memberBError) throw new Error(`seed membership B: ${memberBError.message}`)

  const userA = signedInClient()
  const userB = signedInClient()
  const adminClient = signedInClient()
  const { error: signInAError } = await userA.auth.signInWithPassword(userACredentials)
  const { error: signInBError } = await userB.auth.signInWithPassword(userBCredentials)
  const { error: signInAdminError } = await adminClient.auth.signInWithPassword(adminCredentials)
  if (signInAError) throw new Error(`user A sign-in: ${signInAError.message}`)
  if (signInBError) throw new Error(`user B sign-in: ${signInBError.message}`)
  if (signInAdminError) throw new Error(`admin sign-in: ${signInAdminError.message}`)

  const { data: itemA, error: itemAError } = await userA
    .from('marketing_calendar_items')
    .insert({
      calendar_id: calendarAId,
      assigned_to: userAId,
      date: '2099-02-01',
      day_label: 'MON',
      channel: 'RLS test',
      content: 'Calendar A item',
      is_highlighted: false,
      position: 0,
      source_sheet: null,
      source_row: null,
      source_column: null,
    })
    .select('id')
    .single()
  if (itemAError) throw new Error(`user A create item: ${itemAError.message}`)
  itemAId = itemA.id

  const { data: itemB, error: itemBError } = await userB
    .from('marketing_calendar_items')
    .insert({
      calendar_id: calendarBId,
      assigned_to: userBId,
      date: '2099-02-01',
      day_label: 'MON',
      channel: 'RLS test',
      content: 'Calendar B item',
      is_highlighted: false,
      position: 0,
      source_sheet: null,
      source_row: null,
      source_column: null,
    })
    .select('id')
    .single()
  if (itemBError) throw new Error(`user B create item: ${itemBError.message}`)
  itemBId = itemB.id

  /* ── SELECT isolation ─────────────────────────────────────────── */
  const { data: aSeesA } = await userA.from('marketing_calendar_items').select('id').eq('id', itemAId)
  check("user A sees calendar A's own item", (aSeesA?.length ?? 0) === 1)

  const { data: aSeesB } = await userA.from('marketing_calendar_items').select('id').eq('id', itemBId)
  check("user A cannot see calendar B's item", (aSeesB?.length ?? 0) === 0)

  const { data: bSeesB } = await userB.from('marketing_calendar_items').select('id').eq('id', itemBId)
  check("user B sees calendar B's own item", (bSeesB?.length ?? 0) === 1)

  const { data: bSeesA } = await userB.from('marketing_calendar_items').select('id').eq('id', itemAId)
  check("user B cannot see calendar A's item", (bSeesA?.length ?? 0) === 0)

  const { data: adminSeesBoth } = await adminClient
    .from('marketing_calendar_items').select('id').in('id', [itemAId, itemBId])
  check("an admin session sees both calendars' items unconditionally", (adminSeesBoth?.length ?? 0) === 2)

  /* ── INSERT requires membership, not just a supplied calendar_id ─ */
  const { error: bInsertIntoAError } = await userB
    .from('marketing_calendar_items')
    .insert({
      calendar_id: calendarAId,
      assigned_to: userBId,
      date: '2099-02-02',
      day_label: 'TUE',
      channel: 'RLS test',
      content: 'Should be rejected',
      is_highlighted: false,
      position: 1,
      source_sheet: null,
      source_row: null,
      source_column: null,
    })
  check('a non-member cannot insert into a calendar by supplying its id', Boolean(bInsertIntoAError))

  /* ── checks + attachments + storage isolation (calendar A only) ── */
  const { error: checkAError } = await userA
    .from('marketing_calendar_checks')
    .insert({ item_id: itemAId, user_id: userAId, status: 'posted' })
  check("user A can check off their own calendar's item", !checkAError)

  const { data: bChecksA } = await userB.from('marketing_calendar_checks').select('id').eq('item_id', itemAId)
  check("user B cannot see user A's check on calendar A's item", (bChecksA?.length ?? 0) === 0)

  storagePathA = `${itemAId}/verification.txt`
  const asset = new Blob(['hello'], { type: 'text/plain' })
  const { error: uploadError } = await userA.storage
    .from('marketing-assets')
    .upload(storagePathA, asset, { contentType: 'text/plain' })
  check("user A can upload an attachment to their own calendar's item", !uploadError)

  const { error: attachmentRowError } = await userA.from('marketing_calendar_attachments').insert({
    item_id: itemAId,
    storage_path: storagePathA,
    file_name: 'verification.txt',
    mime_type: 'text/plain',
    file_size: asset.size,
    uploaded_by: userAId,
  })
  check("user A can link the attachment to their own calendar's item", !attachmentRowError)

  const { data: bAttachmentRows } = await userB.from('marketing_calendar_attachments').select('id').eq('item_id', itemAId)
  check("user B cannot see the attachment row on calendar A's item", (bAttachmentRows?.length ?? 0) === 0)

  const { data: bDownload, error: bDownloadError } = await userB.storage.from('marketing-assets').download(storagePathA)
  check("user B cannot download the storage object for calendar A's item", Boolean(bDownloadError) && !bDownload)

  /* ── adding then removing membership grants then revokes access ── */
  const { error: addMemberError } = await admin
    .from('marketing_calendar_members').insert({ calendar_id: calendarAId, user_id: userBId })
  if (addMemberError) throw new Error(`add user B to calendar A: ${addMemberError.message}`)

  const { data: bSeesAAfterAdd } = await userB.from('marketing_calendar_items').select('id').eq('id', itemAId)
  check('adding a membership grants access on the very next query', (bSeesAAfterAdd?.length ?? 0) === 1)

  const { error: removeMemberError } = await admin
    .from('marketing_calendar_members').delete().eq('calendar_id', calendarAId).eq('user_id', userBId)
  if (removeMemberError) throw new Error(`remove user B from calendar A: ${removeMemberError.message}`)

  const { data: bSeesAAfterRemove } = await userB.from('marketing_calendar_items').select('id').eq('id', itemAId)
  check('removing a membership immediately revokes access on the next query', (bSeesAAfterRemove?.length ?? 0) === 0)

  console.log('')
  if (failures) {
    console.log(`${failures} calendar access check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All marketing calendar access checks passed.')
  }
} catch (error) {
  console.error('marketing calendar access harness error:', error.message)
  process.exitCode = 1
} finally {
  if (storagePathA) {
    try { await admin.storage.from('marketing-assets').remove([storagePathA]) } catch {}
  }
  if (itemAId) {
    try { await admin.from('marketing_calendar_items').delete().eq('id', itemAId) } catch {}
  }
  if (itemBId) {
    try { await admin.from('marketing_calendar_items').delete().eq('id', itemBId) } catch {}
  }
  // calendar_id is ON DELETE RESTRICT — calendars can only be removed once no item
  // references them anymore, i.e. after the item deletes above.
  if (calendarAId) {
    try { await admin.from('marketing_calendars').delete().eq('id', calendarAId) } catch {}
  }
  if (calendarBId) {
    try { await admin.from('marketing_calendars').delete().eq('id', calendarBId) } catch {}
  }
  if (userAId) await admin.auth.admin.deleteUser(userAId).catch(() => {})
  if (userBId) await admin.auth.admin.deleteUser(userBId).catch(() => {})
  if (adminId) await admin.auth.admin.deleteUser(adminId).catch(() => {})
  console.log('cleaned up test fixtures.')
}
