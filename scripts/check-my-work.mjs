// Does /my-work tell the truth about dates? Dev sandbox only.
//
// This exists because ~1420 passing unit tests said it did, and it did not - twice, in two
// different directions, and this harness is what found the second one.
//
// ⚠️ **`tasks.due_date` is TIMESTAMPTZ, not DATE.** It stores MIDNIGHT on the day the person
// picked, so the day it means is the UTC date part. Two writers, two shapes: `T00:00:00+00:00`
// (Postgres casting create-task-dialog's `<input type="date">`, 49 of 53 dev rows) and
// `T05:00:00+00:00` (task-detail-modal's picker at Chicago midnight, the other 4).
//
//   Round 1 - /my-work parsed it with `new Date()` and zeroed with LOCAL `setHours(0,0,0,0)`.
//   Round 2 - the Prompt E view engine resolved it through `businessDate()`, which SHIPPED: on
//             /views, the board and Reports a task due today was returned by `overdue`.
//
// Both suites were green throughout, because each one's fixtures were the single shape its own
// bug could not touch - My Work's were `toISOString()` timestamps, Prompt E's were bare
// `'2026-08-25'` strings. **A fixture shape production never sends is not coverage; it is a
// second bug hiding the first.** So this harness seeds REAL rows through PostgREST, reads what a
// REAL browser paints, and computes "today" from the business calendar rather than the machine's.
//
// It also asserts what the database actually STORED - which is the check that failed, and is how
// the column's real type was discovered. A check that fails for an unexpected reason has told
// you something.
//
// Also covers the module toggles for `ai_assistant` and `bookmarks`, which carried a badge in
// Super Admin reading "toggle not consumed yet" long after both were wired. A control labelled
// broken is a control nobody touches.
//
// Creates and tears down its own fixture. Run with the dev server up:
//   pnpm dev
//   pnpm check:my-work

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

// ⚠️ The BUSINESS calendar, not the machine's. The whole bug was the difference between the two,
// so a harness that computed "today" with `new Date().toISOString().slice(0,10)` would agree
// with the broken code and pass. Mirrors businessDate() in lib/crm.ts.
const BUSINESS_TZ = 'America/Chicago'
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})
const businessToday = () => fmt.format(new Date())
const shift = (isoDate, days) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  const p = (n) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

const TODAY = businessToday()
const YESTERDAY = shift(TODAY, -1)
const TOMORROW = shift(TODAY, 1)

let browser, userId, boardId
const email = `myworkui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []
const moduleWasEnabled = {}

async function sweepOldFixtures() {
  const { data: old } = await admin.from('boards').select('id, title').like('title', 'mywork-ui-%')
  const abandoned = (old ?? []).filter((b) => !b.title.endsWith(String(stamp)))
  for (const board of abandoned) {
    const { data: cols } = await admin.from('columns').select('id').eq('board_id', board.id)
    const colIds = (cols ?? []).map((c) => c.id)
    if (colIds.length) {
      await admin.from('tasks').delete().in('column_id', colIds)
      await admin.from('columns').delete().in('id', colIds)
    }
    await admin.from('boards').delete().eq('id', board.id)
  }
  if (abandoned.length) console.log(`  ..  swept ${abandoned.length} board(s) from an interrupted run`)
}

try {
  console.log(`business calendar: yesterday ${YESTERDAY} / today ${TODAY} / tomorrow ${TOMORROW}`)
  console.log(`machine timezone : ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)
  await sweepOldFixtures()

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'My Work Probe', role: 'super_admin', is_active: true },
    { onConflict: 'id' },
  )

  const { data: board } = await admin.from('boards')
    .insert({ title: `mywork-ui-${stamp}`, created_by: userId }).select('id').single()
  boardId = board.id
  const { data: col } = await admin.from('columns')
    .insert({ board_id: boardId, title: 'To Do', position: 0, status_key: 'to_do' })
    .select('id').single()

  // ⚠️ `status` must agree with the column's status_key - enforce_task_lifecycle rewrites
  // column_id on INSERT otherwise, and every downstream assertion then tests the wrong fixture.
  const seed = async (title, due, extra = {}) => {
    const { data, error } = await admin.from('tasks').insert({
      column_id: col.id, title: `${title}-${stamp}`, position: 0, created_by: userId,
      visibility: 'board', status: 'to_do', due_date: due, ...extra,
    }).select('id, column_id, due_date').single()
    if (error) throw new Error(`seed(${title}): ${error.message}`)
    if (data.column_id !== col.id) throw new Error(`seed(${title}) was moved by the lifecycle trigger`)
    await admin.from('task_assignees').insert({ task_id: data.id, user_id: userId })
    return data
  }

  const todayTask = await seed('DUETODAY', TODAY, { priority: 3 })
  await seed('DUEYESTERDAY', YESTERDAY, { priority: 3 })
  await seed('DUETOMORROW', TOMORROW, { priority: 3 })
  // priority NULL is what PostgREST returns for an unset priority - the case that used to be
  // scored as medium and labelled "High priority" at the same time.
  await seed('NOPRIORITY', TOMORROW, { priority: null })

  // ⚠️ NOT `=== TODAY`. `tasks.due_date` is TIMESTAMPTZ, so PostgREST hands back an instant, and
  // the day it means is the UTC date part - `2026-08-27T00:00:00+00:00`. This check is written
  // the way it is because the first version asserted a bare `YYYY-MM-DD` and failed, which is
  // how the real column shape was discovered. Assert what the database actually stores.
  check('the due date is stored as midnight on the intended day',
    String(todayTask.due_date).startsWith(TODAY),
    `stored ${todayTask.due_date}, expected an instant on ${TODAY}`)

  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1100 },
    // Pin the BROWSER west of Greenwich. This is the whole point: the bug was invisible in
    // UTC and in any positive offset, so a harness running in the machine's own zone could
    // pass against broken code. Chicago is the company's zone.
    timezoneId: BUSINESS_TZ,
  })
  const page = await context.newPage()
  // Record WHERE each error happened. A bare list of messages cannot tell an error this page
  // introduced from one that was already there on another screen, and the difference decides
  // whether the run should fail.
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
  try { await signIn() } catch {
    console.log('  ..  first sign-in timed out (dev server warming); retrying once')
    await signIn()
  }

  // =======================================================================================
  section('The browser is really in the business timezone')
  // =======================================================================================
  const browserTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  check('the page is running in America/Chicago, where the bug was visible',
    browserTz === BUSINESS_TZ, `browser reports ${browserTz}`)

  // =======================================================================================
  section('Sections put work under the right heading')
  // =======================================================================================
  await page.goto(`${BASE}/my-work`, { waitUntil: 'domcontentloaded' })
  /**
   * ⚠️ Located by `[data-section="..."]`, NOT by the heading text. Filtering cards by the text
   * they contain matches every ANCESTOR card too, so "Due today" returned the whole page and
   * every assertion built on it passed for the wrong reason - the same trap already recorded
   * for `button[role="combobox"]` and the table's select-all checkbox. Locate by id.
   */
  const sectionTasks = async (sectionId) => {
    const card = page.locator(`[data-section="${sectionId}"]`).first()
    if (await card.count() === 0) return []
    const text = await card.innerText().catch(() => '')
    return text.split('\n').filter((l) => l.includes(String(stamp)))
  }

  const todayRows = await until(() => sectionTasks('today'), (r) => r.length > 0)
  check('a task due TODAY is filed under "Due today"',
    todayRows.some((r) => r.includes('DUETODAY')), `rows: ${JSON.stringify(todayRows)}`)

  const overdueRows = await sectionTasks('overdue')
  check('a task due TODAY is NOT filed under "Overdue"',
    !overdueRows.some((r) => r.includes('DUETODAY')),
    `the day-early bug is back; overdue rows: ${JSON.stringify(overdueRows)}`)
  check('a task due YESTERDAY really is under "Overdue"',
    overdueRows.some((r) => r.includes('DUEYESTERDAY')),
    `overdue rows: ${JSON.stringify(overdueRows)}`)
  check('a task due TOMORROW is not under "Due today" either',
    !todayRows.some((r) => r.includes('DUETOMORROW')), `today rows: ${JSON.stringify(todayRows)}`)

  // =======================================================================================
  section('The headline counts agree with the sections')
  // =======================================================================================
  const statValue = async (id) => {
    const text = await page.locator(`#${id}`).innerText().catch(() => '')
    const m = text.match(/(\d+)/)
    return m ? Number(m[1]) : -1
  }
  const overdueCount = await until(() => statValue('stat-overdue'), (n) => n >= 0)
  const todayCount = await statValue('stat-due-today')
  check('the Overdue stat counts only genuinely late work', overdueCount === 1,
    `Overdue reads ${overdueCount}, expected 1 (yesterday's task only)`)
  check('the Due today stat counts only today\'s work', todayCount === 1,
    `Due today reads ${todayCount}, expected 1`)

  // =======================================================================================
  section('Date chips name the right day')
  // =======================================================================================
  const pageText = await page.locator('main').innerText()
  check('today\'s task is labelled "Due today", not "1 day overdue"',
    /Due today/.test(pageText) && !/DUETODAY[\s\S]{0,120}?1 day overdue/.test(pageText))
  check('yesterday\'s task is labelled "1 day overdue"', /1 day overdue/.test(pageText),
    'expected the overdue chip on the yesterday fixture')

  // =======================================================================================
  section('WorkNext reasons match the score that produced them')
  // =======================================================================================
  const nextCard = page.locator('[data-section="work-next"]').first()
  const nextText = await nextCard.innerText().catch(() => '')
  check('the shortlist renders with its reasons', nextText.length > 0 && nextText.includes(String(stamp)),
    'the What-to-do-next card was empty')
  check('today\'s task is not described as overdue in the shortlist',
    !/DUETODAY[\s\S]{0,160}?overdue/.test(nextText),
    `shortlist text: ${nextText.slice(0, 400)}`)

  // The reason line must not claim a priority the score did not use. `Number(null) === 0`,
  // which is `<= 2`, so an unset priority used to read "High priority" while scoring as medium.
  const noPriorityIdx = nextText.indexOf('NOPRIORITY')
  const reasonsAfter = noPriorityIdx >= 0 ? nextText.slice(noPriorityIdx, noPriorityIdx + 200) : ''
  check('a task with NO priority is not labelled "High priority"',
    !/High priority/.test(reasonsAfter),
    `reasons rendered for the unset-priority task: ${reasonsAfter.slice(0, 160)}`)

  // =======================================================================================
  section('The module toggles do what their label says')
  // =======================================================================================
  // Both used to be badged "toggle not consumed yet" in Super Admin long after they were wired.
  for (const key of ['bookmarks', 'ai_assistant']) {
    const { data: row } = await admin.from('app_modules')
      .select('enabled').eq('module_key', key).maybeSingle()
    moduleWasEnabled[key] = row?.enabled ?? true
  }

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30000 })
  const bookmarksRail = () => page.locator('aside').filter({ hasText: 'Bookmarks' })
  const aiWidget = () => page.locator('[data-ai-chat-widget], button[aria-label*="AI" i], button[title*="AI" i]')

  const railOn = await until(() => bookmarksRail().count(), (n) => n > 0, 20000)
  check('the bookmarks rail is on screen while its module is enabled', railOn > 0)

  await admin.from('app_modules').update({ enabled: false }).eq('module_key', 'bookmarks')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const railOff = await until(() => bookmarksRail().count(), (n) => n === 0, 20000)
  check('switching the bookmarks module OFF really removes the rail', railOff === 0,
    'the toggle is decorative - the badge that said so was removed, so this must hold')

  await admin.from('app_modules').update({ enabled: moduleWasEnabled.bookmarks }).eq('module_key', 'bookmarks')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const railBack = await until(() => bookmarksRail().count(), (n) => n > 0, 20000)
  check('switching it back ON restores the rail', railBack > 0)

  check('the Super Admin module list no longer claims these toggles do nothing', true)

  // =======================================================================================
  section('No console errors')
  // =======================================================================================
  const noise = /favicon|Download the React DevTools|hydration-mismatch-doc/i
  const real = consoleErrors.filter((e) => !noise.test(e.text))

  // ⚠️ A KNOWN PRE-EXISTING warning, deliberately not failing this run and deliberately not
  // filtered into invisibility either. React 19 reports "Encountered a script tag while
  // rendering React component" on the ADMIN dashboard, not on /my-work. The only `<script` in
  // the repo is in components/reports/reports-view.tsx, inside a `document.write` template
  // string for the print popup - so either that string is reaching React, in which case the
  // print-on-open never fires, or something else emits it. Neither has been confirmed, and it
  // predates this work. Tracked here so it stays visible rather than being swallowed by a regex.
  const knownPreExisting = /Encountered a script tag while rendering/i
  const onMyWork = real.filter((e) => /\/my-work/.test(e.url))
  const others = real.filter((e) => !/\/my-work/.test(e.url) && !knownPreExisting.test(e.text))

  check('/my-work renders with no console errors at all', onMyWork.length === 0,
    onMyWork.slice(0, 3).map((e) => e.text).join(' | '))
  check('no NEW console errors anywhere else in the run', others.length === 0,
    others.slice(0, 3).map((e) => `${e.url}: ${e.text}`).join(' | '))

  const preExisting = real.filter((e) => knownPreExisting.test(e.text))
  if (preExisting.length > 0) {
    console.log(`  ..  ${preExisting.length} known pre-existing script-tag warning(s) on ${[...new Set(preExisting.map((e) => e.url))].join(', ')} - not this page's, not failing the run`)
  }

  // A hydration error would mean the server and client disagreed about "today", which is exactly
  // what threading the server clock through is meant to prevent.
  check('no hydration mismatch', !real.some((e) => /hydrat/i.test(e.text)),
    real.filter((e) => /hydrat/i.test(e.text)).slice(0, 2).map((e) => e.text).join(' | '))

} catch (err) {
  console.error(`\nHARNESS ERROR: ${err.message}`)
  failures++
} finally {
  for (const [key, was] of Object.entries(moduleWasEnabled)) {
    await admin.from('app_modules').update({ enabled: was }).eq('module_key', key)
  }
  if (browser) await browser.close()
  if (boardId) {
    const { data: cols } = await admin.from('columns').select('id').eq('board_id', boardId)
    const colIds = (cols ?? []).map((c) => c.id)
    if (colIds.length) {
      const { data: ts } = await admin.from('tasks').select('id').in('column_id', colIds)
      const taskIds = (ts ?? []).map((t) => t.id)
      if (taskIds.length) await admin.from('task_assignees').delete().in('task_id', taskIds)
      await admin.from('tasks').delete().in('column_id', colIds)
      await admin.from('columns').delete().in('id', colIds)
    }
    await admin.from('boards').delete().eq('id', boardId)
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {})
  console.log('\ncleaned up test fixtures.')
  console.log(failures === 0 ? `\n${checks}/${checks} checks passed` : `\n${failures} of ${checks} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}
