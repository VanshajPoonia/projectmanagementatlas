#!/usr/bin/env node
// End-to-end RLS gate for private Marketing PM images.
// Creates two throwaway dev users and one event, verifies that the event owner
// can upload/download while the other signed-in user cannot read either the
// attachment row or Storage object, then removes every fixture in finally.

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
const ownerCredentials = {
  email: `marketing-asset-owner+${stamp}@example.com`,
  password: `Marketing-${stamp}-oWn!`,
}
const outsiderCredentials = {
  email: `marketing-asset-outsider+${stamp}@example.com`,
  password: `Marketing-${stamp}-oUt!`,
}

let ownerId
let outsiderId
let itemId
let storagePath
let failures = 0

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`)
  if (!condition) failures++
}

async function createTestUser(credentials) {
  const { data, error } = await admin.auth.admin.createUser({
    ...credentials,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser: ${error.message}`)

  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id,
    email: credentials.email,
    role: 'user',
  }, { onConflict: 'id' })
  if (profileError) throw new Error(`upsert profile: ${profileError.message}`)
  return data.user.id
}

function signedInClient() {
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

try {
  ownerId = await createTestUser(ownerCredentials)
  outsiderId = await createTestUser(outsiderCredentials)

  const owner = signedInClient()
  const outsider = signedInClient()
  const { error: ownerSignInError } = await owner.auth.signInWithPassword(ownerCredentials)
  const { error: outsiderSignInError } = await outsider.auth.signInWithPassword(outsiderCredentials)
  if (ownerSignInError) throw new Error(`owner sign-in: ${ownerSignInError.message}`)
  if (outsiderSignInError) throw new Error(`outsider sign-in: ${outsiderSignInError.message}`)

  const { data: item, error: itemError } = await owner
    .from('marketing_calendar_items')
    .insert({
      assigned_to: ownerId,
      date: '2099-01-01',
      day_label: 'THU',
      channel: 'RLS test',
      content: 'Temporary attachment verification',
      is_highlighted: false,
      position: 0,
      source_sheet: null,
      source_row: null,
      source_column: null,
    })
    .select('id')
    .single()
  if (itemError) throw new Error(`create event: ${itemError.message}`)
  itemId = item.id
  storagePath = `${itemId}/verification.png`

  // Valid 1×1 transparent PNG.
  const png = new Blob([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  ], { type: 'image/png' })

  const { error: uploadError } = await owner.storage
    .from('marketing-assets')
    .upload(storagePath, png, { contentType: 'image/png', upsert: false })
  check('event owner can upload an image', !uploadError)
  if (uploadError) throw new Error(`owner upload: ${uploadError.message}`)

  const { data: attachment, error: attachmentError } = await owner
    .from('marketing_calendar_attachments')
    .insert({
      item_id: itemId,
      storage_path: storagePath,
      file_name: 'verification.png',
      mime_type: 'image/png',
      file_size: png.size,
      uploaded_by: ownerId,
    })
    .select('id')
    .single()
  check('event owner can link the image to the event', Boolean(attachment) && !attachmentError)

  const { data: ownerDownload, error: ownerDownloadError } = await owner.storage
    .from('marketing-assets')
    .download(storagePath)
  check(
    'event owner can download the same image',
    !ownerDownloadError && ownerDownload?.size === png.size,
  )

  const { data: outsiderRows, error: outsiderRowsError } = await outsider
    .from('marketing_calendar_attachments')
    .select('id')
    .eq('item_id', itemId)
  check(
    'another signed-in user cannot see the attachment row',
    !outsiderRowsError && outsiderRows?.length === 0,
  )

  const { data: outsiderDownload, error: outsiderDownloadError } = await outsider.storage
    .from('marketing-assets')
    .download(storagePath)
  check(
    'another signed-in user cannot download the image',
    Boolean(outsiderDownloadError) && !outsiderDownload,
  )

  console.log('')
  if (failures) {
    console.log(`${failures} marketing attachment check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All marketing attachment checks passed.')
  }
} catch (error) {
  console.error('marketing attachment harness error:', error.message)
  process.exitCode = 1
} finally {
  if (storagePath) {
    try { await admin.storage.from('marketing-assets').remove([storagePath]) } catch {}
  }
  if (itemId) {
    try { await admin.from('marketing_calendar_items').delete().eq('id', itemId) } catch {}
  }
  if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => {})
  if (outsiderId) await admin.auth.admin.deleteUser(outsiderId).catch(() => {})
  console.log('cleaned up test fixtures.')
}
