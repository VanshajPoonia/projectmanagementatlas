#!/usr/bin/env node
// Pass/fail gate for migration 092 - private, conversation-scoped chat attachments.
//
// The thing that actually has to hold: a direct-message attachment must not be
// readable by someone outside the conversation, and must not be readable at all
// without a session. Before 092 the bucket was public, so the object was served off
// the CDN with no auth - this harness proves that is closed, using REAL anon-key
// sessions and an unauthenticated fetch, never the service role.
//
// Non-destructive: every fixture is removed in `finally`. Run: pnpm check:chat-attachments

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

const BUCKET = 'chat-attachments'
const MAX_CHAT = 50 * 1024 * 1024 // 093: the Supabase Free per-file ceiling

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()

const SENDER = { email: `chat-sender+${stamp}@example.com`, password: `Chat-${stamp}-sE!` }
const RECIPIENT = { email: `chat-recipient+${stamp}@example.com`, password: `Chat-${stamp}-rE!` }
const OUTSIDER = { email: `chat-outsider+${stamp}@example.com`, password: `Chat-${stamp}-oU!` }

let senderId, recipientId, outsiderId, messageId, objectPath
let failures = 0
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); if (!ok) failures++ }

async function createUser({ email, password }, role = 'user') {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  const { error: profileError } = await admin
    .from('profiles').upsert({ id: data.user.id, email, role }, { onConflict: 'id' })
  if (profileError) throw new Error(`upsert profile ${email}: ${profileError.message}`)
  return data.user.id
}

async function signIn(credentials) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword(credentials)
  if (error) throw new Error(`signIn ${credentials.email}: ${error.message}`)
  return client
}

try {
  senderId = await createUser(SENDER)
  recipientId = await createUser(RECIPIENT)
  outsiderId = await createUser(OUTSIDER)

  const senderClient = await signIn(SENDER)
  const recipientClient = await signIn(RECIPIENT)
  const outsiderClient = await signIn(OUTSIDER)

  // ---------------------------------------------------------------------------
  // 1. The bucket is no longer a public, unlimited dumping ground.
  // ---------------------------------------------------------------------------
  const { data: bucket } = await admin.storage.getBucket(BUCKET)
  check('chat-attachments is PRIVATE (was public - the whole point of 092)', bucket?.public === false)
  check('chat-attachments caps files at 50 MB, the plan maximum (was unlimited)', bucket?.file_size_limit === MAX_CHAT)
  check('chat-attachments has the full 23-type MIME allowlist (had none)', (bucket?.allowed_mime_types ?? []).length === 23)

  // ---------------------------------------------------------------------------
  // 2. A real send: object into the sender's folder, message referencing the path.
  // ---------------------------------------------------------------------------
  objectPath = `${senderId}/${crypto.randomUUID()}.png`
  const png = new Blob([Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )], { type: 'image/png' })

  const { error: uploadError } = await senderClient.storage
    .from(BUCKET).upload(objectPath, png, { contentType: 'image/png', upsert: false })
  check('sender can upload into their own folder', !uploadError)
  if (uploadError) throw new Error(`sender upload: ${uploadError.message}`)

  const { data: message, error: messageError } = await senderClient
    .from('chat_messages')
    .insert({ sender_id: senderId, recipient_id: recipientId, message: 'Image', attachment_path: objectPath })
    .select('id').single()
  check('sender can send a message referencing the attachment path', Boolean(message) && !messageError)
  messageId = message?.id

  // ---------------------------------------------------------------------------
  // 3. The people in the conversation can read it; nobody else can.
  // ---------------------------------------------------------------------------
  const { data: senderRead, error: senderReadErr } = await senderClient.storage.from(BUCKET).download(objectPath)
  check('sender can read their own attachment', !senderReadErr && senderRead?.size > 0)

  const { data: recipientRead, error: recipientReadErr } = await recipientClient.storage.from(BUCKET).download(objectPath)
  check('RECIPIENT can read the attachment sent to them', !recipientReadErr && recipientRead?.size > 0)

  const { data: outsiderRead, error: outsiderReadErr } = await outsiderClient.storage.from(BUCKET).download(objectPath)
  check(
    'an uninvolved signed-in user CANNOT read it (002 let any authenticated user read every chat file)',
    Boolean(outsiderReadErr) && !outsiderRead,
  )

  const { data: outsiderList } = await outsiderClient.storage.from(BUCKET).list(senderId)
  check('an uninvolved user cannot even list the sender\'s folder', (outsiderList ?? []).length === 0)

  // ---------------------------------------------------------------------------
  // 4. The headline fix: no session, no access. This is what "public" broke.
  // ---------------------------------------------------------------------------
  const publicUrl = `${url}/storage/v1/object/public/${BUCKET}/${objectPath}`
  const publicResponse = await fetch(publicUrl)
  check(
    `an UNAUTHENTICATED request to the public CDN URL is refused (HTTP ${publicResponse.status})`,
    !publicResponse.ok,
  )

  const authedUrl = `${url}/storage/v1/object/${BUCKET}/${objectPath}`
  const authedResponse = await fetch(authedUrl)
  check(
    `an UNAUTHENTICATED request to the object URL is refused (HTTP ${authedResponse.status})`,
    !authedResponse.ok,
  )

  // ---------------------------------------------------------------------------
  // 5. Signed URLs are how the client renders it - and only for participants.
  // ---------------------------------------------------------------------------
  const { data: signed } = await recipientClient.storage.from(BUCKET).createSignedUrl(objectPath, 60)
  check('recipient can mint a signed URL', Boolean(signed?.signedUrl))
  if (signed?.signedUrl) {
    const signedResponse = await fetch(signed.signedUrl)
    check(`the signed URL serves the file (HTTP ${signedResponse.status})`, signedResponse.ok)
  }

  const { data: outsiderSigned } = await outsiderClient.storage.from(BUCKET).createSignedUrl(objectPath, 60)
  check('an uninvolved user cannot mint a signed URL', !outsiderSigned?.signedUrl)

  // ---------------------------------------------------------------------------
  // 6. Writes stay scoped to your own folder.
  // ---------------------------------------------------------------------------
  const { error: crossWriteErr } = await outsiderClient.storage
    .from(BUCKET).upload(`${senderId}/${crypto.randomUUID()}.png`, png, { contentType: 'image/png' })
  check('a user cannot upload into someone else\'s folder', Boolean(crossWriteErr))

  const { data: crossDelete } = await outsiderClient.storage.from(BUCKET).remove([objectPath])
  check('a user cannot delete someone else\'s attachment', (crossDelete ?? []).length === 0)

  console.log('')
  if (failures > 0) {
    console.log(`${failures} chat attachment check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All chat attachment checks passed - DM attachments are private and conversation-scoped.')
  }
} catch (error) {
  console.error('chat attachment harness error:', error.message)
  process.exitCode = 1
} finally {
  if (objectPath) { try { await admin.storage.from(BUCKET).remove([objectPath]) } catch {} }
  if (messageId) { try { await admin.from('chat_messages').delete().eq('id', messageId) } catch {} }
  for (const id of [senderId, recipientId, outsiderId]) {
    if (id) await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('cleaned up test fixtures.')
}
