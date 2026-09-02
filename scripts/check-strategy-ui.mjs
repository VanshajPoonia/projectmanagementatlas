// Does the strategy module actually work in a browser? Dev sandbox only.
//
// The RLS harness (pnpm check:strategy) proves the database enforces every boundary. This one
// exists because of the lesson CLAUDE.md records twice over: `pnpm check:board-roles` was 9/9
// green for weeks on a guest/client feature that was unusable, because everything broken was
// ABOVE the database - no screen could grant the role. A feature verified only at the database
// is not verified. So this asserts the things only a real browser can:
//
//   - the module really is optional: no nav item AND /strategy itself refuses
//   - the two progress figures are BOTH on screen, separately, and are never blended
//   - the divergence warning appears when the work is done and the number has not moved
//   - a goal, an idea, a purpose, a SWOT entry and a review can each be created from a SCREEN
//   - rejecting an idea really asks for a reason, and the reason really lands in the history
//   - an anonymous review says what it does and does not promise
//   - a review action really becomes an ordinary task on the board
//   - the guide is reachable and says the things that matter
//
// ⚠️ Every database assertion polls (`until`) rather than sleeping. A fixed waitForTimeout
// before a read is a flaky assertion, and a flaky assertion is worse than none because it
// teaches you to re-run until green.
//
// Creates and tears down its own fixture. Run with the dev server up:
//   pnpm dev
//   pnpm check:strategy-ui

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

/** Pick from a Radix <Select>. It will not reopen mid-close, so retry until the item lands. */
async function selectPick(page, triggerId, optionText, budgetMs = 20000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    await page.click(`#${triggerId}`).catch(() => {})
    const item = page.locator(`[role="option"]:has-text("${optionText}")`).first()
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

/**
 * Close every open dialog, and confirm none is left.
 *
 * ⚠️ ONE Escape is not enough and that is not a race, it is arithmetic: rejecting an idea
 * stacks the reason dialog on top of the detail dialog, so a single press leaves one mounted
 * and its overlay swallows the next click. That made the impact/effort checks pass on one run
 * and fail on the next against identical code - and a flaky assertion is worse than none,
 * because it teaches you to re-run until green.
 */
const closeDialogs = async (page, budgetMs = 10000) => {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if ((await page.locator('[role="dialog"]').count()) === 0) return true
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(250)
  }
  return (await page.locator('[role="dialog"]').count()) === 0
}

const openTab = async (page, id) => {
  await page.click(`#strategy-tab-${id}`).catch(() => {})
  await page.waitForTimeout(200)
}

let browser, userId, boardId, columnIds = {}, taskIds = []
const email = `stratui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []
let modulePreviouslyEnabled = null

try {
  const { data: created, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'Strategy Probe', role: 'super_admin', is_active: true }, { onConflict: 'id' },
  )

  const { data: board } = await admin.from('boards')
    .insert({ title: `STRATUI-${stamp}`, created_by: userId }).select('id').single()
  boardId = board.id
  for (const [i, [key, label]] of [['to_do', 'To Do'], ['in_progress', 'In Progress'], ['done', 'Completed']].entries()) {
    const { data: c } = await admin.from('columns')
      .insert({ board_id: boardId, title: label, position: i, status_key: key }).select('id').single()
    columnIds[key] = c.id
  }

  // ⚠️ visibility 'board' explicitly: the column DEFAULTS to 'assigned', which would make these
  // invisible to anyone but their creator and quietly change what every check below measures.
  // ⚠️ `status` is sent as well as `column_id`, because enforce_task_lifecycle REWRITES
  // column_id on insert when tasks.status (default 'to_do') disagrees with the target column.
  const seedTask = async (title, statusKey) => {
    const { data } = await admin.from('tasks').insert({
      column_id: columnIds[statusKey], title: `${title}-${stamp}`, position: 0, created_by: userId,
      visibility: 'board', status: statusKey,
    }).select('id').single()
    taskIds.push(data.id)
    return data.id
  }
  const doneTask = await seedTask('STRATWORK-DONE', 'done')
  const openTask_ = await seedTask('STRATWORK-OPEN', 'to_do')

  const { data: moduleRow } = await admin.from('app_modules').select('enabled').eq('module_key', 'strategy').single()
  modulePreviouslyEnabled = moduleRow?.enabled ?? false

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: page.url() }) })

  /**
   * ⚠️ PRESS UNTIL IT TAKES. `waitUntil: 'domcontentloaded'` returns on server-rendered HTML,
   * and the form's submit handler does not exist until React has hydrated - so on a dev server
   * busy recompiling, the first click lands on inert markup and simply does nothing, producing
   * a bare timeout that reads exactly like broken auth.
   */
  const signIn = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      await page.click('button[type="submit"]').catch(() => {})
      try { await page.waitForURL(/\/admin|\/dashboard/, { timeout: 6000 }); return } catch {
        const shown = await page.locator('[role="alert"], .text-destructive, [data-slot="alert"]')
          .first().innerText({ timeout: 500 }).catch(() => '')
        if (shown.trim()) throw new Error(`the login page says: ${shown.trim()}`)
      }
    }
    throw new Error('sign-in never navigated, and the page showed no error')
  }
  let signedIn = false
  for (let attempt = 1; attempt <= 3 && !signedIn; attempt++) {
    try { await signIn(); signedIn = true } catch (err) {
      if (attempt === 3) throw err
      console.log(`  ..  sign-in attempt ${attempt} timed out (dev server warming); retrying`)
    }
  }

  // =======================================================================================
  section('The module is genuinely optional')
  // =======================================================================================
  // ⚠️ Poll the DATABASE for the state this section depends on before asserting anything about
  // the screen. `app_modules` is a workspace-wide switch, so this check reads a global, and a
  // second harness (or a person) toggling it mid-run makes the two assertions below fail for a
  // reason that has nothing to do with the product - observed once, with two overlapping runs.
  // Verifying the precondition turns that into an honest failure instead of a false one.
  await admin.from('app_modules').update({ enabled: false }).eq('module_key', 'strategy')
  const wentOff = await until(
    async () => (await admin.from('app_modules').select('enabled').eq('module_key', 'strategy').single()).data?.enabled,
    (enabled) => enabled === false,
  )
  check('the module switch really went off before this section asserts anything', wentOff === false)
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  check('with the module OFF there is no Strategy nav item',
    (await page.locator('a[href="/strategy"]').count()) === 0)

  await page.goto(`${BASE}/strategy`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/admin|\/dashboard/, { timeout: 20000 }).catch(() => {})
  check('and /strategy itself refuses, not only the link', !page.url().includes('/strategy'),
    `landed on ${page.url()} - a module toggle that only hides a link is not a toggle`)

  await admin.from('app_modules').update({ enabled: true }).eq('module_key', 'strategy')
  await until(
    async () => (await admin.from('app_modules').select('enabled').eq('module_key', 'strategy').single()).data?.enabled,
    (enabled) => enabled === true,
  )
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  check('CONTROL: switching it on puts Strategy in the nav',
    (await until(() => page.locator('a[href="/strategy"]').count(), (n) => n > 0)) > 0)

  // ⚠️ A WARM-UP NAVIGATION THAT ASSERTS NOTHING. `next dev` compiles a route on first request,
  // and a route still compiling makes every timed assertion below look like a product
  // regression. The sign-in loop above exists for the same reason, one route earlier.
  await page.goto(`${BASE}/strategy`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#strategy-tabs', { timeout: 40000 })

  // =======================================================================================
  section('The guide is reachable and says the things that matter')
  // =======================================================================================
  await page.click('#strategy-info-button')
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  const guide = (await page.locator('[role="dialog"]').innerText()).toLowerCase()
  for (const [label, needle] of [
    ['it changes nothing about your boards', 'changes nothing about your boards'],
    ['the two figures are never combined', 'never combined'],
    ['a goal with no numbers is still a goal', 'still a goal'],
    ['rejecting an idea records why', 'stopping the same idea'],
    ['anonymity says what it cannot fix', 'no setting can fix'],
    ['who can change what', 'who can change what'],
    ['turning it off deletes nothing', 'nothing is deleted'],
    ['it answers common questions', 'common questions'],
  ]) {
    check(`the guide covers ${label}`, guide.includes(needle))
  }
  await page.keyboard.press('Escape')

  // =======================================================================================
  section('A goal can be created from a screen, not from psql')
  // =======================================================================================
  await openTab(page, 'goals')
  await page.click('#goal-new, #goal-new-empty')
  await page.waitForSelector('#goal-title', { timeout: 10000 })
  await page.fill('#goal-title', `STRATGOAL-${stamp}`)
  await page.fill('#goal-metric', 'callbacks')
  await page.fill('#goal-unit', 'per month')
  await page.fill('#goal-start-value', '12')
  await page.fill('#goal-current-value', '12')
  await page.fill('#goal-target-value', '4')
  await page.click('#goal-save')

  const goalRow = await until(
    async () => (await admin.from('goals').select('id, current_value').eq('title', `STRATGOAL-${stamp}`)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('the goal really reaches the database', goalRow.length === 1, JSON.stringify(goalRow))
  const goalId = goalRow[0]?.id

  const opened = await until(
    async () => (await admin.from('goal_checkins').select('kind').eq('goal_id', goalId)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('and creating it opened its measurement history', opened.some((c) => c.kind === 'opened'))

  // =======================================================================================
  section('Both progress figures are on screen, separately')
  // =======================================================================================
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`[data-goal-id="${goalId}"]`, { timeout: 40000 })
  const card = page.locator(`[data-goal-id="${goalId}"]`)
  const cardText = await card.innerText()
  check('"Work done" is on screen', cardText.includes('Work done'))
  check('"Result" is on screen too, as its own figure', cardText.includes('Result'))
  check('there are exactly two progress bars, never one blended track',
    (await card.locator('[role="progressbar"]').count()) === 2,
    `found ${await card.locator('[role="progressbar"]').count()}`)
  check('with nothing linked it says so rather than showing 0%', cardText.includes('Nothing linked'))

  await card.locator(`#goal-progress-${goalId}-explain`).click()
  const explained = await until(() => card.innerText(), (t) => t.includes('Why they are separate'))
  check('and it explains why the two are kept apart',
    explained.includes('finish every task and still fail its outcome'))

  // =======================================================================================
  section('Linking work moves ONE figure and not the other')
  // =======================================================================================
  await admin.from('goal_links').insert([
    { goal_id: goalId, task_id: doneTask, created_by: userId },
    { goal_id: goalId, task_id: openTask_, created_by: userId },
  ])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`[data-goal-id="${goalId}"]`, { timeout: 40000 })
  const linked = await until(() => page.locator(`[data-goal-id="${goalId}"]`).innerText(), (t) => t.includes('50%'))
  check('half the linked work being finished reads as 50%', linked.includes('50%'))
  check('and the result figure is still 0% - the number has not moved', linked.includes('0%'))

  // =======================================================================================
  section('The divergence warning appears when the work is done and the number has not moved')
  // =======================================================================================
  await admin.from('goal_links').delete().eq('goal_id', goalId).eq('task_id', openTask_)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`[data-goal-id="${goalId}"]`, { timeout: 40000 })
  const diverged = await until(
    () => page.locator(`#goal-progress-${goalId}-divergence`).count(), (n) => n > 0,
  )
  check('with every linked item finished and the metric unmoved, the page says so', diverged > 0)
  if (diverged > 0) {
    const message = await page.locator(`#goal-progress-${goalId}-divergence`).innerText()
    check('and it says what that means in words, not just colour',
      message.toLowerCase().includes('has not yet produced the result'), message)
  }

  // =======================================================================================
  section('A measurement can be recorded, and the history keeps the previous reading')
  // =======================================================================================
  await page.click(`#goal-measure-${goalId}`)
  await page.waitForSelector('#measure-value', { timeout: 10000 })
  await page.fill('#measure-value', '8')
  await page.fill('#measure-note', 'two sites switched over')
  await page.click('#measure-save')

  const measured = await until(
    async () => (await admin.from('goal_checkins').select('kind, current_value, note').eq('goal_id', goalId)).data ?? [],
    (rows) => rows.some((c) => c.kind === 'measured'),
  )
  check('the measurement lands', measured.some((c) => c.kind === 'measured'))
  check('with the note attached to it',
    measured.some((c) => c.note === 'two sites switched over'), JSON.stringify(measured))
  check('and the opening reading is still there - nothing was overwritten',
    measured.some((c) => c.kind === 'opened'))

  const carrier = (await admin.from('goals').select('checkin_note').eq('id', goalId).single()).data
  check('the write-only carrier is NULL at rest', carrier?.checkin_note === null)

  const afterMeasure = await until(
    () => page.locator(`[data-goal-id="${goalId}"]`).innerText(), (t) => t.includes('50%') || t.includes('History'),
  )
  check('and the result figure has moved on screen', afterMeasure.includes('50%'))

  // =======================================================================================
  section('Ideas: capture, reject with a reason, and the reason is kept')
  // =======================================================================================
  await openTab(page, 'ideas')
  await page.click('#idea-new, #idea-new-empty')
  await page.waitForSelector('#idea-title', { timeout: 10000 })
  await page.fill('#idea-title', `STRATIDEA-${stamp}`)
  await page.fill('#idea-problem', 'bookings are lost on the phone')
  await page.click('#idea-save')

  const ideaRows = await until(
    async () => (await admin.from('ideas').select('id, state').eq('title', `STRATIDEA-${stamp}`)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('an ordinary capture reaches the database', ideaRows.length === 1)
  const ideaId = ideaRows[0]?.id
  check('and it starts as captured', ideaRows[0]?.state === 'captured')

  const captured = await until(
    async () => (await admin.from('idea_events').select('kind').eq('idea_id', ideaId)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('capturing it opened its history', captured.some((e) => e.kind === 'captured'))

  await page.click(`[data-idea-id="${ideaId}"]`)
  await page.waitForSelector('#idea-move', { timeout: 10000 })
  await selectPick(page, 'idea-move', 'Rejected')
  await page.waitForSelector('#idea-reject-reason', { timeout: 10000 })
  check('rejecting asks for a reason rather than handing back a refusal', true)
  await page.fill('#idea-reject-reason', 'already covered by the portal work')
  await page.click('#idea-reject-save')

  const rejected = await until(
    async () => (await admin.from('idea_events').select('to_state, note').eq('idea_id', ideaId)).data ?? [],
    (rows) => rows.some((e) => e.to_state === 'rejected'),
  )
  check('the rejection lands', rejected.some((e) => e.to_state === 'rejected'))
  check('and the REASON reached the permanent history',
    rejected.some((e) => e.to_state === 'rejected' && e.note === 'already covered by the portal work'),
    JSON.stringify(rejected))

  const allClosed = await closeDialogs(page)
  check('every dialog really closed before the next interaction', allClosed)

  // =======================================================================================
  section('The impact/effort view reads the ideas and never places an unscored one')
  // =======================================================================================
  const lensSwitched = await selectPick(page, 'idea-lens', 'Impact and effort')
  check('the view can be switched to the four-box grid', lensSwitched)
  const matrixText = await until(() => page.locator('#idea-matrix').innerText().catch(() => ''), (t) => t.length > 0)
  check('the four-box view renders', matrixText.includes('Quick wins') && matrixText.includes('Time sinks'))
  check('and the unscored idea is listed separately rather than placed in a box',
    matrixText.includes('Not scored yet'), matrixText.slice(0, 200))

  // =======================================================================================
  section('Purpose and SWOT can be written from a screen')
  // =======================================================================================
  await openTab(page, 'purpose')
  await selectPick(page, 'purpose-board', `STRATUI-${stamp}`)
  await page.fill('#purpose-non_goals', 'not rebuilding the website')
  await page.click('#purpose-save')
  const purposeRow = await until(
    async () => (await admin.from('board_purpose').select('non_goals').eq('board_id', boardId)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('a project purpose really saves', purposeRow[0]?.non_goals === 'not rebuilding the website',
    JSON.stringify(purposeRow))

  await openTab(page, 'swot')
  await page.fill('#swot-input-strength', `STRATSWOT-${stamp}`)
  await page.click('#swot-add-strength')
  const swotRow = await until(
    async () => (await admin.from('strategy_items').select('id, bucket').eq('body', `STRATSWOT-${stamp}`)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('a SWOT entry really saves, in the bucket it was typed into',
    swotRow[0]?.bucket === 'strength', JSON.stringify(swotRow))

  // =======================================================================================
  section('Reviews: anonymity states both halves, and an action becomes real work')
  // =======================================================================================
  await openTab(page, 'reviews')
  await selectPick(page, 'retro-board', `STRATUI-${stamp}`)
  await page.click('#retro-new, #retro-new-empty')
  await page.waitForSelector('#retro-title', { timeout: 10000 })
  await page.fill('#retro-title', `STRATRETRO-${stamp}`)
  await page.check('#retro-anonymous')
  const anonCopy = await page.locator('[role="dialog"]').innerText()
  check('the anonymous option promises what the database enforces',
    anonCopy.toLowerCase().includes('including admins'), anonCopy.slice(0, 200))
  check('and admits the one thing no setting can fix',
    anonCopy.toLowerCase().includes('order they appear in'))
  await page.click('#retro-create')

  const retroRow = await until(
    async () => (await admin.from('retrospectives').select('id, is_anonymous, template').eq('title', `STRATRETRO-${stamp}`)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('the review really is created', retroRow.length === 1)
  check('and really is anonymous in the database, not only on screen', retroRow[0]?.is_anonymous === true)
  const retroId = retroRow[0]?.id

  await page.waitForSelector('#retro-columns', { timeout: 20000 })
  const columnKeys = await page.locator('#retro-columns [data-column]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-column')),
  )
  check('the template it chose decides the columns on screen',
    JSON.stringify(columnKeys) === JSON.stringify(['well', 'not_well', 'ideas']), JSON.stringify(columnKeys))

  await page.fill('#retro-note-well', `handovers went smoothly ${stamp}`)
  await page.click('#retro-add-well')
  const noteRows = await until(
    async () => (await admin.from('retro_notes').select('id, author_id').eq('retro_id', retroId)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('a note can be written from the screen', noteRows.length === 1)
  check('and its public author is NULL because the review is anonymous',
    noteRows[0]?.author_id === null, JSON.stringify(noteRows))

  const noteOnScreen = await until(
    () => page.locator(`[data-note-id="${noteRows[0]?.id}"]`).innerText().catch(() => ''), (t) => t.length > 0,
  )
  check('the author still knows which note is theirs, through the definer function',
    noteOnScreen.includes('Yours'), noteOnScreen)

  await page.fill('#retro-action-input', `write the handover checklist ${stamp}`)
  await page.click('#retro-action-add')
  const actionRows = await until(
    async () => (await admin.from('retro_actions').select('id, converted_at').eq('retro_id', retroId)).data ?? [],
    (rows) => rows.length > 0,
  )
  check('an action can be agreed', actionRows.length === 1)
  check('and does not start life converted', actionRows[0]?.converted_at === null)

  await page.click(`#retro-convert-${actionRows[0]?.id}`)
  await page.waitForSelector('#retro-convert-save', { timeout: 10000 })
  await page.click('#retro-convert-save')

  const converted = await until(
    async () => (await admin.from('retro_actions').select('task_id, converted_at').eq('id', actionRows[0]?.id)).data ?? [],
    (rows) => rows[0]?.task_id,
  )
  check('turning it into work stamps the conversion', Boolean(converted[0]?.converted_at))
  const madeTask = await admin.from('tasks').select('id, title, column_id').eq('id', converted[0]?.task_id).maybeSingle()
  if (madeTask.data) taskIds.push(madeTask.data.id)
  check('and creates an ORDINARY task on the board, not a copy in some other table',
    Boolean(madeTask.data) && madeTask.data.title.includes('write the handover checklist'),
    JSON.stringify(madeTask.data))
  check('the task really sits in one of this board\'s columns',
    Object.values(columnIds).includes(madeTask.data?.column_id), madeTask.data?.column_id)

  // =======================================================================================
  section('Nothing on the page reported an error to the console')
  // =======================================================================================
  // ⚠️ An aborted request is NOT a failure: supabase-js aborts its in-flight fetches when a
  // component unmounts, and PostgREST surfaces that as an ordinary error object.
  const real = consoleErrors.filter((e) => !/AbortError|signal is aborted/i.test(e.text))
  check('zero console errors across the whole run', real.length === 0,
    JSON.stringify(real.slice(0, 3)))

  // =======================================================================================
  section('The page does not scroll sideways on a phone')
  // =======================================================================================
  // A horizontal strip whose length is a function of how many things exist is the same shape
  // as the board header nav that blew up twice, and /agile's tab strip once.
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(`${BASE}/strategy`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#strategy-tabs', { timeout: 40000 })
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no horizontal overflow at 320px', overflow <= 1, `overflowed by ${overflow}px`)
} catch (err) {
  failures++
  console.log(`\nFAIL  the run threw before finishing: ${err?.message ?? err}`)
  console.log(err?.stack ?? '')
} finally {
  if (browser) await browser.close().catch(() => {})
  if (modulePreviouslyEnabled !== null) {
    await admin.from('app_modules').update({ enabled: modulePreviouslyEnabled }).eq('module_key', 'strategy')
  }
  // ⚠️ Scoped to the BOARD, not to the ids this run happens to have tracked. A run that aborts
  // early leaves rows the tracking arrays never saw, and prevent_nonempty_column_delete then
  // refuses the column delete, which refuses the board delete - so the sandbox silently
  // accumulates fixtures.
  await admin.from('goals').delete().like('title', `STRATGOAL-${stamp}%`)
  await admin.from('ideas').delete().like('title', `STRATIDEA-${stamp}%`)
  await admin.from('strategy_items').delete().like('body', `STRATSWOT-${stamp}%`)
  if (boardId) {
    await admin.from('retrospectives').delete().eq('board_id', boardId)
    await admin.from('board_purpose').delete().eq('board_id', boardId)
    const { data: cols } = await admin.from('columns').select('id').eq('board_id', boardId)
    const colIds = (cols ?? []).map((c) => c.id)
    if (colIds.length) {
      const { data: strays } = await admin.from('tasks').select('id').in('column_id', colIds)
      for (const t of strays ?? []) {
        await admin.from('goal_links').delete().eq('task_id', t.id)
        await admin.from('task_assignees').delete().eq('task_id', t.id)
      }
      await admin.from('tasks').delete().in('column_id', colIds).not('parent_task_id', 'is', null)
      await admin.from('tasks').delete().in('column_id', colIds)
    }
    await admin.from('columns').delete().eq('board_id', boardId)
    await admin.from('boards').delete().eq('id', boardId)
  }
  if (userId) {
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId).catch(() => {})
  }
  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
