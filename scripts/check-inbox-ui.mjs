// Does the Inbox actually work in a browser? Dev sandbox only.
//
// The RLS harness (pnpm check:inbox) proves the database enforces the boundaries. This one
// exists because of the lesson recorded in CLAUDE.md: `pnpm check:board-roles` was 9/9 green
// for weeks on a guest/client feature that was unusable, because everything broken was above
// the database - no UI could grant the role, and an unrelated edit silently undid it. A
// permission or preference feature verified only at the database is not verified.
//
// So this asserts the things only a real browser can: that the bell counts what the page
// shows, that muting removes a notification from the inbox WITHOUT destroying it, that
// unmuting brings it back, that a snooze survives, and that a comment notification deep-links
// to the comment rather than dropping the reader on the task.
//
// Creates and tears down its own fixture. Run with the dev server up:
//   pnpm dev
//   pnpm check:inbox-ui

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url ?? '')) throw new Error(`refusing to run against ${url}`)

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()

let failures = 0
let checks = 0
const check = (name, ok, detail = '') => {
  checks++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}
const section = (n) => console.log(`\n--- ${n} ---`)

/**
 * Poll rather than sleep-then-read.
 *
 * ⚠️ Recorded twice already in this repo: a fixed `waitForTimeout` before reading the database
 * is a flaky assertion, and a flaky assertion is worse than none because it teaches you to
 * re-run until green. Three identical runs of check-recurrence-ui once failed three different
 * checks for exactly this reason.
 */
async function until(read, accept, budgetMs = 25000) {
  const deadline = Date.now() + budgetMs
  let last = await read()
  while (Date.now() < deadline) {
    if (accept(last)) return last
    await new Promise((r) => setTimeout(r, 400))
    last = await read()
  }
  return last
}

/**
 * Open a Radix dropdown and click an item, reopening until the item is really visible.
 *
 * ⚠️ A Radix menu will not reopen mid-close: it returns focus to the trigger as the menu
 * unmounts and swallows a second open issued during it. `click(trigger); click(item)` passes
 * once and times out on the very next identical call.
 */
async function menuPick(page, triggerId, itemId, budgetMs = 20000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    await page.click(`#${triggerId}`).catch(() => {})
    const item = page.locator(`#${itemId}`)
    try {
      await item.waitFor({ state: 'visible', timeout: 1500 })
      await item.click()
      return true
    } catch {
      await page.keyboard.press('Escape').catch(() => {})
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  return false
}

let browser, userId, mateId, boardId, taskId, otherTaskId
const email = `inboxui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []

try {
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'Inbox Probe', role: 'super_admin', is_active: true },
    { onConflict: 'id' },
  )

  const mateEmail = `inboxui-mate-${stamp}@goatlasgo.us`
  const { data: mate } = await admin.auth.admin.createUser({
    email: mateEmail, password: `Probe!${stamp}bB`, email_confirm: true,
  })
  mateId = mate.user.id
  await admin.from('profiles').upsert(
    { id: mateId, email: mateEmail, full_name: 'Inbox Colleague', role: 'user', is_active: true },
    { onConflict: 'id' },
  )

  const { data: board } = await admin.from('boards')
    .insert({ title: `inbox-ui-${stamp}`, created_by: userId }).select('id').single()
  boardId = board.id
  const { data: col } = await admin.from('columns')
    .insert({ board_id: boardId, title: 'To Do', position: 0, status_key: 'to_do' })
    .select('id').single()

  const seedTask = async (title) => {
    const { data } = await admin.from('tasks').insert({
      column_id: col.id, title: `${title}-${stamp}`, position: 0, created_by: userId,
      visibility: 'board', status: 'to_do',
    }).select('id').single()
    await admin.from('task_assignees').insert({ task_id: data.id, user_id: userId })
    return data.id
  }
  taskId = await seedTask('INBOXTASK')
  otherTaskId = await seedTask('OTHERTASK')

  // A comment to deep-link at, and the notification that points at it.
  const { data: comment } = await admin.from('task_comments')
    .insert({ task_id: taskId, comment: `Deep linked comment ${stamp}`, user_id: mateId, author_id: mateId })
    .select('id').single()

  const seedNotification = async (taskFor, type, message, extra = {}) => {
    const { data } = await admin.from('task_notifications').insert({
      recipient_id: userId, task_id: taskFor, actor_id: mateId, type, message: `${message}-${stamp}`, ...extra,
    }).select('id').single()
    return data.id
  }

  const assignmentId = await seedNotification(taskId, 'assignment', 'ASSIGNED')
  const commentId = await seedNotification(taskId, 'comment', 'COMMENTED', {
    entity_type: 'comment', entity_id: comment.id,
  })
  const otherId = await seedNotification(otherTaskId, 'update', 'UPDATED')

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: page.url() })
  })

  const signIn = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 60000 })
  }
  // ⚠️ Three attempts, not one. A cold `next dev` compiles /login, the auth round-trip and the
  // dashboard on first hit, and one run in six timed out here with every product assertion
  // unrun - reported as "1 of 0 checks FAILED", which reads like a broken harness rather than a
  // slow server. Retrying is the difference between a flaky gate and a gate.
  let signedIn = false
  for (let attempt = 1; attempt <= 3 && !signedIn; attempt++) {
    try {
      await signIn()
      signedIn = true
    } catch (err) {
      if (attempt === 3) throw err
      console.log(`  ..  sign-in attempt ${attempt} timed out (dev server warming); retrying`)
    }
  }

  // =======================================================================================
  section('The Inbox is reachable, from the nav and from the topbar')
  // =======================================================================================
  // The defect this guards is the one this repo keeps rediscovering: working code behind no
  // route a human can take.
  const navLink = await page.locator('a[href="/inbox"]').count()
  check('the sidebar offers Inbox', navLink > 0)

  const bell = page.locator('[data-testid="inbox-bell"]')
  const bellCount = await until(
    () => bell.getAttribute('data-unread').catch(() => null),
    (v) => v !== null && Number(v) > 0,
  )
  check('the topbar bell shows an unread count', Number(bellCount) === 3,
    `bell reads ${bellCount}, expected 3 seeded notifications`)

  // =======================================================================================
  section('Two buckets, split by whether it needs a person')
  // =======================================================================================
  await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' })

  const bucketText = async (id) => {
    const card = page.locator(`[data-section="${id}"]`).first()
    if (await card.count() === 0) return ''
    return card.innerText().catch(() => '')
  }

  const action = await until(() => bucketText('inbox-action_required'), (t) => t.includes(String(stamp)))
  check('an assignment lands in Action required', action.includes('ASSIGNED'),
    `action bucket: ${action.slice(0, 300)}`)

  const updates = await bucketText('inbox-update')
  check('a comment lands in Updates', updates.includes('COMMENTED'), `updates bucket: ${updates.slice(0, 300)}`)
  check('and an assignment does NOT also appear in Updates', !updates.includes('ASSIGNED'))

  // =======================================================================================
  section('Deep links open the exact context')
  // =======================================================================================
  const commentRow = page.locator(`[data-notification-id="${commentId}"] a`).first()
  const href = await commentRow.getAttribute('href')
  check('a comment notification links to the comment, not just the board',
    Boolean(href && href.includes(`task=${taskId}`) && href.includes(`comment=${comment.id}`)),
    `href was ${href}`)
  // ⚠️ /admin, not /dashboard. The two board routes are not interchangeable: /dashboard passes
  // isAdmin={false} deliberately, so sending an admin there strips controls they are entitled
  // to, with nothing on screen explaining why.
  check('and it sends an admin to the admin board surface', Boolean(href && href.startsWith('/admin/board/')),
    `href was ${href}`)

  // =======================================================================================
  section('Mark read and unread')
  // =======================================================================================
  const readState = async (id) => {
    const { data } = await admin.from('task_notifications').select('read_at').eq('id', id).single()
    return data?.read_at ?? null
  }
  check('PRECONDITION: it starts unread', (await readState(assignmentId)) === null)

  check('the row menu opens', await menuPick(page, `inbox-actions-${assignmentId}`, `inbox-read-${assignmentId}`))
  const nowRead = await until(() => readState(assignmentId), (v) => v !== null)
  check('marking read really writes read_at', nowRead !== null)

  check('the menu offers unread once it is read',
    await menuPick(page, `inbox-actions-${assignmentId}`, `inbox-unread-${assignmentId}`))
  const backUnread = await until(() => readState(assignmentId), (v) => v === null)
  check('marking unread really clears it', backUnread === null)

  // =======================================================================================
  section('Snooze hides without deleting')
  // =======================================================================================
  check('the snooze submenu opens',
    await menuPick(page, `inbox-actions-${assignmentId}`, `inbox-snooze-${assignmentId}`))
  const snoozeItem = page.locator(`#inbox-snooze-1h-${assignmentId}`)
  await snoozeItem.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  await snoozeItem.click().catch(() => {})

  const snoozedUntil = await until(async () => {
    const { data } = await admin.from('task_notifications').select('snoozed_until').eq('id', assignmentId).single()
    return data?.snoozed_until ?? null
  }, (v) => v !== null)
  check('snoozing writes a timestamp', snoozedUntil !== null)

  const stillThere = await admin.from('task_notifications').select('id').eq('id', assignmentId)
  check('and destroys nothing', (stillThere.data ?? []).length === 1)

  const afterSnooze = await until(() => bucketText('inbox-action_required'), (t) => !t.includes('ASSIGNED'))
  check('a snoozed notification leaves the inbox', !afterSnooze.includes('ASSIGNED'))

  await page.click('#inbox-scope-snoozed')
  const snoozedView = await until(() => bucketText('inbox-snoozed'), (t) => t.includes('ASSIGNED'))
  check('and is findable under Snoozed, rather than simply vanishing', snoozedView.includes('ASSIGNED'))

  await admin.from('task_notifications').update({ snoozed_until: null }).eq('id', assignmentId)

  // =======================================================================================
  section('Mute hides without deleting, and unmute brings it back')
  // =======================================================================================
  await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' })
  await until(() => bucketText('inbox-update'), (t) => t.includes('UPDATED'))

  check('the mute-project item is on the row menu',
    await menuPick(page, `inbox-actions-${otherId}`, `inbox-mute-board-${otherId}`))

  const muteRow = await until(async () => {
    const { data } = await admin.from('board_mutes').select('board_id').eq('user_id', userId).eq('board_id', boardId)
    return (data ?? []).length
  }, (n) => n === 1)
  check('muting a project writes the row', muteRow === 1)

  const notificationsAfterMute = await admin.from('task_notifications')
    .select('id', { count: 'exact', head: true }).eq('recipient_id', userId)
  check('muting destroys no notification', notificationsAfterMute.count === 3)

  await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' })
  const mutedOut = await until(() => bucketText('inbox-update'), (t) => !t.includes('UPDATED'), 20000)
  check('a muted project leaves the inbox', !mutedOut.includes('UPDATED'))

  // ⚠️ THE DEAD END THIS GUARDS: a mute you cannot find is a mute you cannot undo. The Muted
  // view lists the subscription itself, straight from board_mutes, so it is undoable even when
  // the project has produced nothing to look at.
  await page.click('#inbox-scope-muted')
  const subscriptions = await until(
    () => page.locator('[data-section="inbox-subscriptions"]').innerText().catch(() => ''),
    (t) => t.includes(`inbox-ui-${stamp}`),
  )
  check('the Muted view names the project, so it can be undone', subscriptions.includes(`inbox-ui-${stamp}`))

  await page.click(`#unmute-board-${boardId}`)
  const unmuted = await until(async () => {
    const { data } = await admin.from('board_mutes').select('board_id').eq('user_id', userId).eq('board_id', boardId)
    return (data ?? []).length
  }, (n) => n === 0)
  check('unmuting really removes the row', unmuted === 0)

  await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' })
  const backAgain = await until(() => bucketText('inbox-update'), (t) => t.includes('UPDATED'), 20000)
  check('and the notification comes back - it was hidden, never deleted', backAgain.includes('UPDATED'))

  // =======================================================================================
  section('Following a work item is reachable from the work item')
  // =======================================================================================
  // Offering Follow only from a notification menu would mean you could only follow something
  // you were already being told about, which is the one case where you do not need it.
  await page.goto(`${BASE}/admin/board/${boardId}?task=${taskId}`, { waitUntil: 'domcontentloaded' })
  const followButton = page.locator('#task-follow-toggle')
  await followButton.waitFor({ state: 'visible', timeout: 30000 })
  check('a work item offers a Follow control', await followButton.count() > 0)

  await followButton.click()
  const followed = await until(async () => {
    const { data } = await admin.from('task_follows').select('state').eq('task_id', taskId).eq('user_id', userId)
    return data?.[0]?.state ?? null
  }, (v) => v === 'following')
  check('pressing Follow really writes the row', followed === 'following')

  // ⚠️ Wait for the BUTTON, not just for the row. The write lands before React has re-rendered
  // the control, so a second click fired on the database's timing hits a button that still
  // reads "Follow" and simply re-follows. Two of three runs failed here before this wait was
  // added - a flaky assertion is worse than none, because it teaches you to re-run until green.
  const followState = await until(
    () => page.locator('#task-follow-toggle').getAttribute('data-follow-state').catch(() => null),
    (v) => v === 'following',
  )
  check('and the button says so before anything else touches it', followState === 'following')
  await page.locator('#task-follow-toggle:not([disabled])').waitFor({ state: 'visible', timeout: 15000 })

  await page.locator('#task-follow-toggle').click()
  const unfollowed = await until(async () => {
    const { data } = await admin.from('task_follows').select('state').eq('task_id', taskId).eq('user_id', userId)
    return (data ?? []).length
  }, (n) => n === 0)
  check('and pressing it again stops following', unfollowed === 0)

  // =======================================================================================
  section('Mark all read')
  // =======================================================================================
  await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' })
  await until(() => bucketText('inbox-action_required'), (t) => t.includes(String(stamp)))
  await page.click('#inbox-mark-all-read')
  const allRead = await until(async () => {
    const { count } = await admin.from('task_notifications')
      .select('id', { count: 'exact', head: true }).eq('recipient_id', userId).is('read_at', null)
    return count
  }, (n) => n === 0)
  check('Mark all read clears every unread notification', allRead === 0)

  const bellAfter = await until(
    () => page.locator('[data-testid="inbox-bell"]').getAttribute('data-unread').catch(() => null),
    (v) => v === '0',
  )
  check('and the bell agrees with the page', bellAfter === '0',
    `bell still reads ${bellAfter} - a badge that disagrees with the screen is one nobody believes`)

  // =======================================================================================
  section('No console errors')
  // =======================================================================================
  const noise = /favicon|Download the React DevTools|hydration-mismatch-doc/i
  const knownPreExisting = /Encountered a script tag while rendering/i
  const real = consoleErrors.filter((e) => !noise.test(e.text) && !knownPreExisting.test(e.text))
  const onInbox = real.filter((e) => /\/inbox/.test(e.url))
  check('/inbox renders with no console errors at all', onInbox.length === 0,
    onInbox.slice(0, 3).map((e) => e.text).join(' | '))
  check('no hydration mismatch', !real.some((e) => /hydrat/i.test(e.text)),
    real.filter((e) => /hydrat/i.test(e.text)).slice(0, 2).map((e) => e.text).join(' | '))
} catch (err) {
  console.error(`\nHARNESS ERROR: ${err.message}`)
  failures++
} finally {
  if (browser) await browser.close()
  for (const id of [userId, mateId]) {
    if (id) await admin.from('task_notifications').delete().eq('recipient_id', id)
  }
  if (boardId) {
    await admin.from('board_mutes').delete().eq('board_id', boardId)
    const { data: cols } = await admin.from('columns').select('id').eq('board_id', boardId)
    const colIds = (cols ?? []).map((c) => c.id)
    if (colIds.length) {
      const { data: ts } = await admin.from('tasks').select('id').in('column_id', colIds)
      const taskIds = (ts ?? []).map((t) => t.id)
      if (taskIds.length) {
        await admin.from('task_follows').delete().in('task_id', taskIds)
        await admin.from('task_comments').delete().in('task_id', taskIds)
        await admin.from('task_assignees').delete().in('task_id', taskIds)
        await admin.from('task_notifications').delete().in('task_id', taskIds)
      }
      await admin.from('tasks').delete().in('column_id', colIds)
      await admin.from('columns').delete().in('id', colIds)
    }
    await admin.from('boards').delete().eq('id', boardId)
  }
  for (const id of [userId, mateId]) {
    if (!id) continue
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('\ncleaned up test fixtures.')
  console.log(failures === 0 ? `\n${checks}/${checks} checks passed` : `\n${failures} of ${checks} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}
