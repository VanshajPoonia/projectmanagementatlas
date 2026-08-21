// Board attachments harness (migration 111). Dev sandbox only, own fixtures, torn down.
//
// Bobby's task is titled "Attach Files/Photos To A Board/Tile/Task". The task half shipped in
// 020/091/093; the board half did not exist at all.
//
// What this pins is the part that is easy to get wrong and invisible from the UI: a board file
// must be exactly as private as its board. The policies key off private.can_view_board, which
// reuses 070's predicate, so a private board's files are unreadable by a non-member even though
// the row and the object both exist. Every check below runs as a REAL signed-in user against
// real RLS, never as the service role.
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url)) throw new Error(`refusing to run against ${url}`)

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

const people = {}
async function mkUser(tag, role) {
  const email = `bs-ba-${tag}-${stamp}@goatlasgo.us`
  const password = `Probe!${stamp}aA`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  await admin.from('profiles').upsert({ id: data.user.id, email, full_name: `BS ${tag}`, role, is_active: true })
  people[tag] = { id: data.user.id, email, password }
  return people[tag]
}
async function clientFor(who) {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: who.email, password: who.password })
  if (error) throw error
  return c
}

let openBoard, privateBoard, browser
try {
  const su = await mkUser('super', 'super_admin')
  const ad = await mkUser('admin', 'admin')
  const member = await mkUser('member', 'user')

  const mkBoard = async (title, isPrivate) => {
    const { data, error } = await admin.from('boards')
      .insert({ title, created_by: su.id, is_private: isPrivate }).select().single()
    if (error) throw error
    return data
  }
  openBoard = await mkBoard(`ZZ BA Open ${stamp}`, false)
  privateBoard = await mkBoard(`ZZ BA Private ${stamp}`, true)

  const asSuper = await clientFor(su)
  const asAdmin = await clientFor(ad)
  const asMember = await clientFor(member)

  // ── an admin can attach a file to an open board ──────────────────────────
  const path = `${openBoard.id}/${crypto.randomUUID()}-brief.txt`
  const body = new Blob([`board brief ${stamp}`], { type: 'text/plain' })
  const { error: upErr } = await asAdmin.storage.from('board-assets').upload(path, body, {
    contentType: 'text/plain', upsert: false,
  })
  check('an admin can upload an object into board-assets', !upErr, upErr?.message ?? '')

  const { data: ins, error: insErr } = await asAdmin.from('board_attachments').insert({
    board_id: openBoard.id, file_name: 'brief.txt', file_type: 'text/plain',
    file_size: 20, storage_path: path, uploaded_by: ad.id,
  }).select('id')
  check('an admin can record the attachment row', !insErr && ins?.length === 1,
    insErr?.message ?? `${ins?.length ?? 0} rows`)
  const attachmentId = ins?.[0]?.id

  // ── everyone who can see the board can read its files ────────────────────
  const { data: memberSees } = await asMember.from('board_attachments').select('id').eq('board_id', openBoard.id)
  check('a plain member can read an open board\'s files', memberSees?.length === 1, `${memberSees?.length ?? 0} rows`)

  const { data: signed, error: signErr } = await asMember.storage
    .from('board-assets').createSignedUrl(path, 60)
  check('a plain member can get a signed URL for the object', !signErr && Boolean(signed?.signedUrl),
    signErr?.message ?? '')

  // ── a plain member may not upload ────────────────────────────────────────
  const memberPath = `${openBoard.id}/${crypto.randomUUID()}-sneaky.txt`
  const { error: memberUpErr } = await asMember.storage.from('board-assets').upload(memberPath, body, {
    contentType: 'text/plain', upsert: false,
  })
  check('a plain member cannot upload an object', Boolean(memberUpErr), memberUpErr?.message ?? '(allowed!)')

  const { data: memberIns } = await asMember.from('board_attachments').insert({
    board_id: openBoard.id, file_name: 'sneaky.txt', storage_path: `${openBoard.id}/sneaky-${stamp}`,
    uploaded_by: member.id,
  }).select('id')
  check('a plain member cannot record an attachment row', !memberIns || memberIns.length === 0,
    `${memberIns?.length ?? 0} rows`)

  // ── a private board's files are as private as the board ──────────────────
  const privPath = `${privateBoard.id}/${crypto.randomUUID()}-secret.txt`
  const { error: privUpErr } = await asSuper.storage.from('board-assets').upload(privPath, body, {
    contentType: 'text/plain', upsert: false,
  })
  check('the board creator can upload to their private board', !privUpErr, privUpErr?.message ?? '')
  await asSuper.from('board_attachments').insert({
    board_id: privateBoard.id, file_name: 'secret.txt', storage_path: privPath, uploaded_by: su.id,
  }).select('id')

  const { data: outsiderRows } = await asAdmin.from('board_attachments').select('id').eq('board_id', privateBoard.id)
  check('a non-member admin cannot see a private board\'s attachment rows',
    !outsiderRows || outsiderRows.length === 0, `${outsiderRows?.length ?? 0} rows`)

  const { data: outsiderUrl, error: outsiderErr } = await asAdmin.storage
    .from('board-assets').createSignedUrl(privPath, 60)
  check('a non-member admin cannot sign a private board\'s object',
    Boolean(outsiderErr) || !outsiderUrl?.signedUrl, outsiderErr?.message ?? '(signed!)')

  // Control: adding them to the board makes both work, so the refusal is membership and not
  // something incidental.
  await admin.from('board_members').insert({ board_id: privateBoard.id, user_id: ad.id, role: 'member' })
  const { data: nowRows } = await asAdmin.from('board_attachments').select('id').eq('board_id', privateBoard.id)
  check('adding them to the board grants access (control)', nowRows?.length === 1, `${nowRows?.length ?? 0} rows`)

  // ── deletion is the uploader or a super admin, not any admin ─────────────
  const { data: memberDel } = await asMember.from('board_attachments').delete().eq('id', attachmentId).select('id')
  check('a plain member cannot delete someone else\'s file',
    !memberDel || memberDel.length === 0, `${memberDel?.length ?? 0} rows`)

  const { data: ownDel } = await asAdmin.from('board_attachments').delete().eq('id', attachmentId).select('id')
  check('the uploader can delete their own file', ownDel?.length === 1, `${ownDel?.length ?? 0} rows`)

  // ── the bucket is private, and anon holds nothing ────────────────────────
  const anonClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: anonRows } = await anonClient.from('board_attachments').select('id')
  check('an anonymous caller sees no attachment rows', !anonRows || anonRows.length === 0,
    `${anonRows?.length ?? 0} rows`)

  // ── a human can actually reach it ────────────────────────────────────────
  //
  // A passing RLS harness does not mean the feature works: this repo shipped guest/client
  // roles that no UI could grant, and an app_modules table no screen could write. So the
  // dialog is opened in a real browser and a real file goes through the real input.
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.fill('input[type=email]', people.admin.email)
  await page.fill('input[type=password]', people.admin.password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 })
  await page.goto(`${BASE}/admin/board/${openBoard.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  const filesButton = page.getByRole('button', { name: 'Board files' })
  check('the board header offers a Files button', await filesButton.count() === 1)
  await filesButton.first().click()
  await page.waitForTimeout(800)
  const dialog = page.locator('[role=dialog]')
  check('the files dialog opens', (await dialog.innerText()).includes('Board files'))
  check('an admin is offered the upload control',
    await dialog.getByRole('button', { name: /Add a file/i }).count() === 1)

  await dialog.locator('input[type=file]').setInputFiles({
    name: 'site-plan.txt', mimeType: 'text/plain', buffer: Buffer.from(`site plan ${stamp}`),
  })
  await page.waitForTimeout(3000)
  const afterUpload = await dialog.innerText()
  check('a file uploaded through the UI appears in the list', afterUpload.includes('site-plan.txt'),
    afterUpload.slice(0, 120).replace(/\n+/g, ' | '))

  const { data: uiRows } = await admin.from('board_attachments')
    .select('storage_path, file_name, uploaded_by').eq('board_id', openBoard.id).eq('file_name', 'site-plan.txt')
  check('the UI upload reached the database with the right uploader',
    uiRows?.length === 1 && uiRows[0].uploaded_by === people.admin.id, `${uiRows?.length ?? 0} rows`)
  check('the UI stored the object under the board id, which the policies key off',
    Boolean(uiRows?.[0]?.storage_path?.startsWith(`${openBoard.id}/`)), uiRows?.[0]?.storage_path ?? '')
  check('no console errors while attaching', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  const { data: bucket } = await admin.storage.getBucket('board-assets')
  check('the board-assets bucket is private', bucket?.public === false, `public=${bucket?.public}`)
  // getBucket returns the raw row, so these are snake_case, not the camelCase the JS client
  // uses elsewhere.
  check('the bucket enforces the 50 MB per-file ceiling', bucket?.file_size_limit === 52428800,
    String(bucket?.file_size_limit))
  // Assert against task-assets rather than a hardcoded count. A PSD being attachable to a task
  // and refused on a board would be indefensible, and a magic number would not have caught it:
  // the first draft of 111 restated the list by hand and quietly diverged by four types.
  const { data: taskBucket } = await admin.storage.getBucket('task-assets')
  const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort())
  check('board files accept exactly the file types task files do',
    same(bucket?.allowed_mime_types, taskBucket?.allowed_mime_types),
    `board ${bucket?.allowed_mime_types?.length ?? 0} vs task ${taskBucket?.allowed_mime_types?.length ?? 0}`)
} finally {
  if (browser) await browser.close()
  for (const board of [openBoard, privateBoard]) {
    if (!board) continue
    const { data: objs } = await admin.storage.from('board-assets').list(board.id)
    if (objs?.length) {
      await admin.storage.from('board-assets').remove(objs.map((o) => `${board.id}/${o.name}`))
    }
    await admin.from('boards').delete().eq('id', board.id)
  }
  for (const who of Object.values(people)) await admin.auth.admin.deleteUser(who.id)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
  process.exit(1)
}
