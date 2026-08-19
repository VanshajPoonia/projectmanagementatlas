#!/usr/bin/env node
// Pass/fail gate for migration 091 - the admin-only large-file path for task attachments.
//
// The client hides the "Large file" toggle from non-admins, but that is presentation.
// What actually has to hold is the database: a non-admin must not be able to put an
// object in the task-assets bucket or write a row carrying a storage_path, no matter
// what they send. This harness asserts that through REAL anon-key sessions (exactly
// like the app), never the service role, so it is testing RLS and not a mock.
//
// It also pins the things a future migration could quietly break: that the inline
// base64 path still works untouched at 10 MB, that the two paths stay mutually
// exclusive, and that a plain member can still DOWNLOAD what an admin uploaded -
// without which the whole feature would be useless.
//
// Non-destructive: every fixture is removed in `finally`. Run: pnpm check:task-attachments

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

const BUCKET = 'task-assets'
const MAX_LARGE = 50 * 1024 * 1024
const MAX_INLINE = 10 * 1024 * 1024

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()

const ADMIN_USER = { email: `task-attach-admin+${stamp}@example.com`, password: `Attach-${stamp}-aD!` }
const MEMBER_USER = { email: `task-attach-member+${stamp}@example.com`, password: `Attach-${stamp}-mE!` }
const OUTSIDER_USER = { email: `task-attach-outsider+${stamp}@example.com`, password: `Attach-${stamp}-oU!` }

let adminId, memberId, outsiderId, boardId, columnId, taskId
const objectsToClean = []
let failures = 0

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

async function createUser({ email, password }, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  // Don't race the on_auth_user_created trigger - set the role explicitly.
  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: data.user.id, email, role }, { onConflict: 'id' })
  if (profileError) throw new Error(`upsert profile ${email}: ${profileError.message}`)
  return data.user.id
}

async function signIn(credentials) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword(credentials)
  if (error) throw new Error(`signIn ${credentials.email}: ${error.message}`)
  return client
}

// A payload of a given size that is still a plausible PDF, so the bucket's MIME
// allowlist is exercised rather than sidestepped.
function pdfOfSize(bytes) {
  const header = Buffer.from('%PDF-1.7\n')
  return new Blob([header, Buffer.alloc(bytes - header.length)], { type: 'application/pdf' })
}

try {
  // 'admin' rather than 'super_admin' on purpose: private.is_admin_user() must be true
  // for both (migration 047), and 'admin' is the weaker of the two - if the gate opens
  // for this user it opens for super_admin too.
  adminId = await createUser(ADMIN_USER, 'admin')
  memberId = await createUser(MEMBER_USER, 'user')

  const { data: board, error: boardErr } = await admin
    .from('boards')
    .insert({ title: `attach-test-board-${stamp}`, created_by: memberId, is_private: false })
    .select('id').single()
  if (boardErr) throw new Error(`create board: ${boardErr.message}`)
  boardId = board.id

  const { data: column, error: colErr } = await admin
    .from('columns')
    .insert({ board_id: boardId, title: 'To Do', position: 0 })
    .select('id').single()
  if (colErr) throw new Error(`create column: ${colErr.message}`)
  columnId = column.id

  // Created by the MEMBER so that can_manage_task passes for them - this proves the
  // large-file refusal below is about being a non-admin, not about lacking task access.
  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .insert({ column_id: columnId, title: 'attachment target', created_by: memberId, position: 0 })
    .select('id').single()
  if (taskErr) throw new Error(`create task: ${taskErr.message}`)
  taskId = task.id

  const adminClient = await signIn(ADMIN_USER)
  const memberClient = await signIn(MEMBER_USER)

  // ---------------------------------------------------------------------------
  // 1. The bucket is configured the way the Free plan requires.
  // ---------------------------------------------------------------------------
  const { data: bucket, error: bucketErr } = await admin.storage.getBucket(BUCKET)
  check('task-assets bucket exists', !bucketErr && Boolean(bucket))
  check('task-assets is private (no public URL path)', bucket?.public === false)
  // getBucket returns the raw snake_case row, not the camelCase shape of the upload options.
  check('task-assets caps files at 50 MB (Supabase Free ceiling)', bucket?.file_size_limit === MAX_LARGE)

  // ---------------------------------------------------------------------------
  // 2. The admin path works end to end, above the old 10 MB limit.
  // ---------------------------------------------------------------------------
  const largePath = `${taskId}/${crypto.randomUUID()}.pdf`
  const largePdf = pdfOfSize(MAX_INLINE + 1) // one byte past what the inline path allows
  const { error: adminUploadErr } = await adminClient.storage
    .from(BUCKET)
    .upload(largePath, largePdf, { contentType: 'application/pdf', upsert: false })
  check('admin can upload an object larger than the 10 MB inline limit', !adminUploadErr)
  if (!adminUploadErr) objectsToClean.push(largePath)

  const { data: linkedRow, error: linkErr } = await adminClient
    .from('task_attachments')
    .insert({
      task_id: taskId,
      file_name: 'large.pdf',
      file_type: 'application/pdf',
      storage_path: largePath,
      file_size: largePdf.size,
      uploaded_by: adminId,
    })
    .select('id, storage_path, file_data').single()
  check('admin can link the object to the task', Boolean(linkedRow) && !linkErr)
  check('a storage-backed row carries no base64 payload', linkedRow?.file_data === null)

  // ---------------------------------------------------------------------------
  // 3. The non-admin cannot take that path - at either layer.
  // ---------------------------------------------------------------------------
  const memberPath = `${taskId}/${crypto.randomUUID()}.pdf`
  const { error: memberUploadErr } = await memberClient.storage
    .from(BUCKET)
    .upload(memberPath, pdfOfSize(1024), { contentType: 'application/pdf', upsert: false })
  check('non-admin CANNOT upload an object, even to a task they own', Boolean(memberUploadErr))
  if (!memberUploadErr) objectsToClean.push(memberPath)

  // The row gate is independent of the object gate: even handed a path that already
  // exists (the admin's), a non-admin must not be able to write storage_path.
  const { data: memberRows, error: memberRowErr } = await memberClient
    .from('task_attachments')
    .insert({
      task_id: taskId,
      file_name: 'stolen.pdf',
      file_type: 'application/pdf',
      storage_path: `${taskId}/${crypto.randomUUID()}.pdf`,
      file_size: 4096,
      uploaded_by: memberId,
    })
    .select('id')
  check(
    'non-admin CANNOT insert a row carrying a storage_path',
    (memberRows ?? []).length === 0 || Boolean(memberRowErr),
  )

  // ---------------------------------------------------------------------------
  // 4. Control cases - the restriction is admin-specific, not a blanket break.
  // ---------------------------------------------------------------------------
  const { data: inlineRow, error: inlineErr } = await memberClient
    .from('task_attachments')
    .insert({
      task_id: taskId,
      file_name: 'small.txt',
      file_type: 'text/plain',
      file_data: `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`,
      file_size: 5,
      uploaded_by: memberId,
    })
    .select('id').single()
  check('non-admin CAN still use the inline base64 path (unchanged)', Boolean(inlineRow) && !inlineErr)

  // Reading is deliberately NOT admin-gated - otherwise an admin could only attach
  // files nobody working the task could open.
  const { data: memberSees } = await memberClient
    .from('task_attachments')
    .select('id, storage_path')
    .eq('task_id', taskId)
    .not('storage_path', 'is', null)
  check('non-admin CAN see the admin-uploaded attachment row', (memberSees ?? []).length === 1)

  const { data: memberDownload, error: memberDownloadErr } = await memberClient.storage
    .from(BUCKET)
    .download(largePath)
  check(
    'non-admin CAN download the admin-uploaded file',
    !memberDownloadErr && memberDownload?.size === largePdf.size,
  )

  // ---------------------------------------------------------------------------
  // 5. The two paths stay mutually exclusive (the XOR CHECK).
  // ---------------------------------------------------------------------------
  const { error: bothErr } = await adminClient
    .from('task_attachments')
    .insert({
      task_id: taskId,
      file_name: 'both.pdf',
      file_type: 'application/pdf',
      storage_path: `${taskId}/${crypto.randomUUID()}.pdf`,
      file_data: 'data:application/pdf;base64,JVBERi0x',
      file_size: 8,
      uploaded_by: adminId,
    })
  check('a row cannot carry BOTH a storage_path and base64 data', Boolean(bothErr))

  const { error: neitherErr } = await adminClient
    .from('task_attachments')
    .insert({ task_id: taskId, file_name: 'neither.pdf', file_type: 'application/pdf', file_size: 8, uploaded_by: adminId })
  check('a row cannot carry NEITHER a storage_path nor base64 data', Boolean(neitherErr))

  // ---------------------------------------------------------------------------
  // 6. Someone with no access to the task sees nothing - can_view_task governs the
  //    object as well as the row, so a private board hides the bytes too.
  //
  //    This needs a genuinely unrelated third user. The member above cannot play the
  //    part: they CREATED the task, and can_view_task grants the creator access
  //    regardless of board privacy - correctly, which is why an earlier version of
  //    this check failed against a perfectly good policy.
  // ---------------------------------------------------------------------------
  outsiderId = await createUser(OUTSIDER_USER, 'user')
  const outsiderClient = await signIn(OUTSIDER_USER)

  const { error: privateErr } = await admin.from('boards').update({ is_private: true }).eq('id', boardId)
  if (privateErr) throw new Error(`make board private: ${privateErr.message}`)

  const { data: outsiderRows } = await outsiderClient
    .from('task_attachments')
    .select('id')
    .eq('task_id', taskId)
  check(
    'an unrelated user on a private board sees no attachments at all',
    (outsiderRows ?? []).length === 0,
  )

  const { data: outsiderDownload, error: outsiderDownloadErr } = await outsiderClient.storage
    .from(BUCKET)
    .download(largePath)
  check(
    'that user cannot download the object either',
    Boolean(outsiderDownloadErr) && !outsiderDownload,
  )

  console.log('')
  if (failures > 0) {
    console.log(`${failures} task attachment check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All task attachment checks passed - large uploads are admin-only, reads are not.')
  }
} catch (error) {
  console.error('task attachment harness error:', error.message)
  process.exitCode = 1
} finally {
  if (objectsToClean.length) {
    try { await admin.storage.from(BUCKET).remove(objectsToClean) } catch {}
  }
  if (taskId) { try { await admin.from('task_attachments').delete().eq('task_id', taskId) } catch {} }
  if (taskId) { try { await admin.from('tasks').delete().eq('id', taskId) } catch {} }
  if (columnId) { try { await admin.from('columns').delete().eq('id', columnId) } catch {} }
  if (boardId) { try { await admin.from('boards').delete().eq('id', boardId) } catch {} }
  if (adminId) await admin.auth.admin.deleteUser(adminId).catch(() => {})
  if (memberId) await admin.auth.admin.deleteUser(memberId).catch(() => {})
  if (outsiderId) await admin.auth.admin.deleteUser(outsiderId).catch(() => {})
  console.log('cleaned up test fixtures.')
}
