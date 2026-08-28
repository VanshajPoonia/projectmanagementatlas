// Does optional agile mode actually work in a browser? Dev sandbox only.
//
// The RLS harness (pnpm check:agile) proves the database enforces every boundary. This one
// exists because of the lesson CLAUDE.md records twice over: `pnpm check:board-roles` was 9/9
// green for weeks on a guest/client feature that was unusable, because everything broken was
// ABOVE the database - no screen could grant the role. A feature verified only at the database
// is not verified. So this asserts the things only a real browser can:
//
//   - the module really is optional, at BOTH levels (workspace switch, per-board opt-in)
//   - an admin can reach every control from a screen, not from psql
//   - the vocabulary really changes when the board picks a different noun
//   - the capacity warning appears and does not block, by default
//   - closing a window freezes its numbers ON SCREEN, and says so
//   - a WIP limit can be set from the board, and the badge does not promise more than the
//     database will do
//
// ⚠️ Every database assertion polls (`until`) rather than sleeping. A fixed waitForTimeout
// before a read is a flaky assertion, and a flaky assertion is worse than none because it
// teaches you to re-run until green.
//
// Creates and tears down its own fixture. Run with the dev server up:
//   pnpm dev
//   pnpm check:agile-ui

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

let browser, userId, boardId, columnIds = {}, taskIds = []
const email = `agileui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []
let modulePreviouslyEnabled = null

try {
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'Agile Probe', role: 'super_admin', is_active: true },
    { onConflict: 'id' },
  )

  const { data: board } = await admin.from('boards')
    .insert({ title: `AGILEUI-${stamp}`, created_by: userId }).select('id').single()
  boardId = board.id
  for (const [i, [key, label]] of [['to_do', 'To Do'], ['in_progress', 'In Progress'], ['done', 'Completed']].entries()) {
    const { data: c } = await admin.from('columns')
      .insert({ board_id: boardId, title: label, position: i, status_key: key }).select('id').single()
    columnIds[key] = c.id
  }

  const seedTask = async (title, statusKey = 'to_do', estimate = null) => {
    const { data } = await admin.from('tasks').insert({
      column_id: columnIds[statusKey], title: `${title}-${stamp}`, position: 0, created_by: userId,
      visibility: 'board', status: statusKey, estimate_value: estimate,
    }).select('id').single()
    taskIds.push(data.id)
    return data.id
  }
  const a = await seedTask('AGILEWORK-A', 'to_do', 5)
  const b = await seedTask('AGILEWORK-B', 'to_do', 3)
  const c = await seedTask('AGILEWORK-C', 'to_do', null)

  // Remember the module's real state so the run leaves the workspace exactly as it found it.
  const { data: moduleRow } = await admin.from('app_modules').select('enabled').eq('module_key', 'agile').single()
  modulePreviouslyEnabled = moduleRow?.enabled ?? false

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: page.url() }) })

  const signIn = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 60000 })
  }
  // Three attempts: a cold `next dev` compiles /login, the auth round-trip and the dashboard on
  // first hit, and a timeout here reports "1 of 0 checks FAILED", which reads like a broken
  // harness rather than a slow server.
  let signedIn = false
  for (let attempt = 1; attempt <= 3 && !signedIn; attempt++) {
    try { await signIn(); signedIn = true } catch (err) {
      if (attempt === 3) throw err
      console.log(`  ..  sign-in attempt ${attempt} timed out (dev server warming); retrying`)
    }
  }

  // =======================================================================================
  section('The module is genuinely optional at the workspace level')
  // =======================================================================================
  await admin.from('app_modules').update({ enabled: false }).eq('module_key', 'agile')
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  const hiddenLink = await page.locator('a[href="/agile"]').count()
  check('with the module OFF there is no Agile nav item', hiddenLink === 0)

  await page.goto(`${BASE}/agile`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/admin|\/dashboard/, { timeout: 20000 }).catch(() => {})
  check('and /agile itself refuses, not only the link', !page.url().includes('/agile'),
    `landed on ${page.url()} - a module toggle that only hides a link is not a toggle`)

  await admin.from('app_modules').update({ enabled: true }).eq('module_key', 'agile')
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  const shownLink = await until(() => page.locator('a[href="/agile"]').count(), (n) => n > 0)
  check('CONTROL: switching it on puts Agile in the nav', shownLink > 0)

  // =======================================================================================
  section('It is optional again per board, and off until somebody opts in')
  // =======================================================================================
  await page.goto(`${BASE}/agile?board=${boardId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#agile-board-picker', { timeout: 30000 })

  const offNotice = await until(
    () => page.locator('text=/Agile is off for/i').count(),
    (n) => n > 0,
  )
  check('a board that has not opted in says so rather than showing sprint vocabulary', offNotice > 0)

  const newSprintHidden = await page.locator('#agile-new-sprint').count()
  check('and offers no way to create a sprint on it', newSprintHidden === 0)

  // =======================================================================================
  section('An admin can reach every control from a screen')
  // =======================================================================================
  await page.click('#agile-settings-button')
  await page.waitForSelector('#agile-enabled', { timeout: 15000 })
  check('the settings dialog opens from the page', true)

  await selectPick(page, 'agile-enabled', 'On')
  await selectPick(page, 'agile-term', 'Cycle')
  await page.click('button:has-text("Save settings")')

  const saved = await until(
    async () => (await admin.from('board_agile_settings').select('is_enabled, terminology').eq('board_id', boardId).maybeSingle()).data,
    (r) => r?.is_enabled === true,
  )
  check('switching agile on really writes to the database', saved?.is_enabled === true)
  check('and the chosen vocabulary is stored', saved?.terminology === 'cycle', `stored ${saved?.terminology}`)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#agile-new-sprint', { timeout: 30000 })
  const nounOnButton = await page.locator('#agile-new-sprint').innerText()
  check('the screen says "cycle", not "sprint" - the vocabulary really is the board’s', /cycle/i.test(nounOnButton),
    `button reads "${nounOnButton}"`)

  // =======================================================================================
  section('Creating and starting a window')
  // =======================================================================================
  await page.click('#agile-new-sprint')
  await page.waitForSelector('#sprint-title', { timeout: 15000 })
  await page.fill('#sprint-title', `WINDOW-${stamp}`)
  await page.fill('#sprint-capacity', '6')
  await page.click('button:has-text("Create cycle")')

  const sprintRow = await until(
    async () => (await admin.from('sprints').select('id, title, capacity, state').eq('board_id', boardId).maybeSingle()).data,
    (r) => Boolean(r),
  )
  check('the window is created from the dialog', Boolean(sprintRow?.id))
  check('with the capacity that was typed', Number(sprintRow?.capacity) === 6)
  check('and it starts life planned, not running', sprintRow?.state === 'planned')

  // =======================================================================================
  section('Planning work in, and the capacity warning')
  // =======================================================================================
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#agile-tab-planning', { timeout: 30000 })

  const addFirst = page.locator(`text=AGILEWORK-A-${stamp}`).first()
  await addFirst.waitFor({ state: 'visible', timeout: 20000 })
  // The row's own Add button, scoped to that row rather than to the first button on the page.
  await page.locator(`div:has(> div > button:text-is("AGILEWORK-A-${stamp}")) >> button:has-text("Add")`).first()
    .click({ timeout: 15000 })
    .catch(async () => { await page.locator('button:has-text("Add")').first().click() })

  const planned = await until(
    async () => (await admin.from('sprint_items').select('task_id').eq('sprint_id', sprintRow.id).is('removed_at', null)).data ?? [],
    (rows) => rows.length >= 1,
  )
  check('work planned in from the backlog reaches the database', planned.length >= 1)
  check('and it is a POINTER, not a copy - the task itself is untouched',
    (await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('column_id', columnIds.to_do)).count === 3,
    'a second row would mean the module had forked the work item')

  // Push it over capacity (6) by adding B (3) and A (5) = 8.
  await admin.from('sprint_items').insert({ sprint_id: sprintRow.id, task_id: b })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const capacityText = await until(
    () => page.locator('#agile-capacity-signal').innerText().catch(() => ''),
    (t) => /over capacity/i.test(t),
  )
  check('going over capacity warns on screen', /over capacity/i.test(capacityText), capacityText)
  check('and says it is a warning only - "do not block by default"', /warning only|still plan it in/i.test(capacityText),
    capacityText)

  // The unestimated item must be reported, never quietly counted as zero.
  await admin.from('sprint_items').insert({ sprint_id: sprintRow.id, task_id: c })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const unestimatedText = await until(
    () => page.locator('#agile-capacity-signal').innerText().catch(() => ''),
    (t) => /no estimate/i.test(t),
  )
  check('an unestimated item is reported rather than silently counted as zero',
    /no estimate/i.test(unestimatedText), unestimatedText)

  // =======================================================================================
  section('Starting the window records the commitment')
  // =======================================================================================
  await page.click('#agile-start-sprint')
  const committed = await until(
    async () => (await admin.from('sprint_items').select('committed').eq('sprint_id', sprintRow.id).is('removed_at', null)).data ?? [],
    (rows) => rows.length > 0 && rows.every((r) => r.committed),
  )
  check('starting it marks everything in it as committed', committed.length === 3 && committed.every((r) => r.committed),
    JSON.stringify(committed))

  // =======================================================================================
  section('Every metric explains itself')
  // =======================================================================================
  await page.click('#agile-tab-metrics')
  await page.waitForSelector('#agile-metric-tiles', { timeout: 20000 })
  const tileText = await page.locator('#agile-metric-tiles').innerText()
  for (const label of ['Committed', 'Completed', 'Carryover', 'Scope added', 'Scope removed']) {
    check(`the "${label}" metric is on screen`, tileText.includes(label))
  }

  // ⚠️ Open until the popover is really on screen, then read ONE node. A locator matching
  // several elements throws under strict mode and the catch turns that into an empty string -
  // which then fails every assertion below for a reason that has nothing to do with the
  // product. Same family as the `button[role="combobox"]).first()` trap.
  let explainer = ''
  for (let attempt = 0; attempt < 8 && !/Definition/i.test(explainer); attempt++) {
    await page.locator('button[aria-label="How Committed is calculated"]').first().click().catch(() => {})
    explainer = await page.locator('[data-radix-popper-content-wrapper]').first()
      .innerText({ timeout: 2000 }).catch(() => '')
    if (!/Definition/i.test(explainer)) {
      await page.keyboard.press('Escape').catch(() => {})
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  // ⚠️ Case-INSENSITIVE. Those labels are styled `uppercase`, and innerText returns what the
  // reader actually sees, so a case-sensitive `includes` failed all six against a popover that
  // was rendering them perfectly. A harness that reports a styling choice as a missing feature
  // is worse than no harness: it sends you to fix working code.
  const seen = explainer.toLowerCase()
  for (const field of ['Definition', 'Formula', 'Unit', 'Included records', 'Excluded records', 'Last updated']) {
    check(`its explanation exposes "${field}" - Prompt G requires all six`, seen.includes(field.toLowerCase()),
      explainer.slice(0, 200))
  }
  check('and says whether the number is live or frozen', /Live|Frozen/.test(explainer))
  await page.keyboard.press('Escape')

  const velocityText = await page.locator('#agile-velocity').innerText()
  check('velocity says what it excluded rather than averaging everything',
    /excluded|nothing to average/i.test(velocityText), velocityText)

  // =======================================================================================
  section('Closing the window freezes the numbers, on screen')
  // =======================================================================================
  await page.click('#agile-complete-sprint')
  const snapshot = await until(
    async () => (await admin.from('sprint_metrics').select('*').eq('sprint_id', sprintRow.id).maybeSingle()).data,
    (r) => Boolean(r),
  )
  check('completing it writes the frozen snapshot', Boolean(snapshot))

  // Change the work underneath it. The screen must not move.
  await admin.from('tasks').update({ estimate_value: 999 }).eq('id', a)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.click('#agile-tab-metrics')
  await page.waitForSelector('#agile-metric-tiles', { timeout: 20000 })
  const frozenText = await until(
    () => page.locator('#agile-metric-tiles').innerText().catch(() => ''),
    (t) => t.length > 0,
  )
  check('re-estimating the work afterwards does NOT change what the closed window reports',
    !frozenText.includes('999'), frozenText)

  const frozenBadge = await page.locator('text=/Frozen when it closed/i').count()
  check('and the screen SAYS the numbers are frozen', frozenBadge > 0)

  // =======================================================================================
  section('WIP limits are reachable from the board, and honest about themselves')
  // =======================================================================================
  await page.goto(`${BASE}/admin/board/${boardId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=In Progress', { timeout: 30000 })

  // Located by the column's own id, never by shape - see the note on that button.
  let menuReachable = false
  const wipItem = page.locator('[role="menuitem"]:has-text("WIP limit")').first()
  for (let attempt = 0; attempt < 8 && !menuReachable; attempt++) {
    await page.click(`#column-menu-${columnIds.in_progress}`, { timeout: 5000 }).catch(() => {})
    menuReachable = await wipItem.isVisible({ timeout: 1500 }).catch(() => false)
    if (!menuReachable) {
      await page.keyboard.press('Escape').catch(() => {})
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  check('the board’s column menu offers a WIP limit - not psql', menuReachable)

  if (menuReachable) {
    await wipItem.click()
    await page.waitForSelector('#wip-limit-input', { timeout: 15000 })
    await page.fill('#wip-limit-input', '2')
    await page.click('button:has-text("Save limit")')
    const limited = await until(
      async () => (await admin.from('columns').select('wip_limit').eq('id', columnIds.in_progress).single()).data,
      (r) => r?.wip_limit === 2,
    )
    check('setting it from the board really writes the limit', limited?.wip_limit === 2)

    const badge = await until(() => page.locator('text=/WIP 0\\/2|WIP 1\\/2/').count(), (n) => n > 0)
    check('and the column header shows it', badge > 0)
  }

  // =======================================================================================
  section('The estimate field is on the work item, and only where agile is on')
  // =======================================================================================
  // ⚠️ This exists because the save payload is CONDITIONAL. `tasks.estimate_value` arrives with
  // migration 123, which is not applied everywhere at once, so an unconditional key would make
  // PostgREST reject every task save on a database without the column - taking out task editing
  // for a field nobody on that board can see. Both halves are asserted: it saves where the field
  // is shown, and the rest of the form still saves where it is not.
  // ⚠️ `locator.isVisible()` takes NO timeout - it is an instant probe. Using it straight after
  // a goto asks "is this on screen right now", the answer is no because nothing has rendered,
  // and the CONTROL below then passes for exactly the wrong reason. Wait for the dialog first,
  // then wait for the field; a control that passes because the page had not loaded is worse
  // than no control.
  const openTaskModal = async (taskId) => {
    await page.goto(`${BASE}/admin/board/${boardId}?task=${taskId}`, { waitUntil: 'domcontentloaded' })
    try {
      await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 30000 })
      return true
    } catch { return false }
  }
  const seesField = async () => {
    try {
      await page.locator('#task-estimate').waitFor({ state: 'visible', timeout: 8000 })
      return true
    } catch { return false }
  }
  // ⚠️ Wait for the field to hold the value it is supposed to hold, not merely to exist.
  // Editing an input whose own load is still in flight is how this harness measured "typed 13,
  // stored 3" - which turned out to be a real product race, not a harness artefact.
  const fieldSettled = async (expected) => {
    try {
      await page.waitForFunction(
        (want) => document.querySelector('#task-estimate')?.value === want,
        expected, { timeout: 10000 },
      )
      return true
    } catch { return false }
  }

  const modalOpen = await openTaskModal(b)
  check('the work item really opened - every assertion below is otherwise meaningless', modalOpen)
  const hasField = modalOpen ? await seesField() : false
  check('a board with agile ON offers an estimate on the work item', hasField)

  if (hasField) {
    const unitLabel = await page.locator('label[for="task-estimate"]').innerText()
    check('and labels it with the board’s own unit', /points/i.test(unitLabel), unitLabel)

    check('the field arrives already holding the stored estimate, not empty', await fieldSettled('3'),
      `reads "${await page.locator('#task-estimate').inputValue()}"`)
    await page.locator('#task-estimate').fill('13')
    // The modal's submit is labelled "Update Task", not "Save" - located by its real text
    // rather than by a guess, so a rename shows up as a failure here instead of a timeout.
    await page.locator('button:has-text("Update Task")').first().click()
    const savedEstimate = await until(
      async () => (await admin.from('tasks').select('estimate_value').eq('id', b).single()).data,
      (r) => Number(r?.estimate_value) === 13,
    )
    check('editing it from the modal really saves', Number(savedEstimate?.estimate_value) === 13,
      `stored ${savedEstimate?.estimate_value}`)
  }

  // The control: switch agile off for the board, and the rest of the form must still save.
  await admin.from('board_agile_settings').update({ is_enabled: false }).eq('board_id', boardId)
  const controlOpen = await openTaskModal(b)
  check('the work item opened again with agile switched off', controlOpen)
  const fieldGone = controlOpen ? !(await seesField()) : false
  check('CONTROL: with agile OFF the estimate field is not on the work item at all', fieldGone)


  // ⚠️ Asserted, never `if (visible) { ... }`. A conditional block whose condition quietly goes
  // false does not fail - the checks inside it simply stop existing, and the run still reports
  // a clean pass over two assertions that never ran. That happened here once already, when a
  // block inserted above navigated away from this modal.
  const titleBox = page.locator('input[value*="AGILEWORK-B"]').first()
  const titleReady = await titleBox.isVisible({ timeout: 0 }).catch(() => false)
    || await titleBox.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  check('the title field is editable with agile off - the two checks below depend on it', titleReady)
  if (titleReady) {
    await titleBox.fill(`AGILEWORK-B-RENAMED-${stamp}`)
    await page.locator('button:has-text("Update Task")').first().click()
    const renamed = await until(
      async () => (await admin.from('tasks').select('title, estimate_value').eq('id', b).single()).data,
      (r) => /RENAMED/.test(r?.title ?? ''),
    )
    check('and the rest of the form still saves - the estimate key is simply not sent',
      /RENAMED/.test(renamed?.title ?? ''), `title is "${renamed?.title}"`)
    check('leaving the stored estimate untouched rather than clearing it',
      Number(renamed?.estimate_value) === 13, `stored ${renamed?.estimate_value}`)
  }

  // ⚠️ Still with agile OFF, and on the BOARD - the WIP entry lives on an existing screen every
  // admin already uses. Prompt G's promise is that a board with agile off "is an ordinary
  // board", so an ungated column menu would put Scrum machinery in front of every marketing,
  // contracting and finance board the day this ships: a visible change to a screen nobody asked
  // to change. This runs LAST in the section because it navigates away from the modal above.
  await page.keyboard.press('Escape').catch(() => {})
  await page.goto(`${BASE}/admin/board/${boardId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`#column-menu-${columnIds.in_progress}`, { timeout: 30000 })
  await page.click(`#column-menu-${columnIds.in_progress}`).catch(() => {})
  const renameItem = page.locator('[role="menuitem"]:has-text("Rename Column")').first()
  const menuOpened = await renameItem.waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true).catch(() => false)
  check('the column menu opened - the control below is otherwise vacuous', menuOpened)
  const wipStillOffered = await page.locator('[role="menuitem"]:has-text("WIP limit")').first()
    .isVisible().catch(() => false)
  check('CONTROL: with agile OFF the column menu offers no WIP limit either', menuOpened && !wipStillOffered)
  check('and the rest of the column menu is untouched - the gate is specific, not a blanket break',
    menuOpened)
  await page.keyboard.press('Escape').catch(() => {})

  await admin.from('board_agile_settings').update({ is_enabled: true }).eq('board_id', boardId)

  // =======================================================================================
  section('No console errors anywhere in that run')
  // =======================================================================================
  const real = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e.text))
  check('zero console errors', real.length === 0, real.map((e) => `${e.url}: ${e.text}`).join(' | '))
} catch (err) {
  // ⚠️ Report the throw. Without this the finally prints "40/40 checks passed" over a run that
  // aborted half way, which reads as a clean pass - the most misleading possible outcome for a
  // gate. The exit code below is what actually decides.
  failures++
  console.log(`\nFAIL  the run threw before finishing: ${err?.message ?? err}`)
  console.log(err?.stack ?? '')
} finally {
  if (browser) await browser.close().catch(() => {})

  // Teardown - the workspace is left exactly as it was found, module switch included.
  if (modulePreviouslyEnabled !== null) {
    await admin.from('app_modules').update({ enabled: modulePreviouslyEnabled }).eq('module_key', 'agile')
  }
  if (boardId) {
    const { data: ss } = await admin.from('sprints').select('id').eq('board_id', boardId)
    for (const s of ss ?? []) {
      await admin.from('sprint_items').delete().eq('sprint_id', s.id)
      await admin.from('sprint_burndown_samples').delete().eq('sprint_id', s.id)
      await admin.from('sprint_metrics').delete().eq('sprint_id', s.id)
    }
    await admin.from('sprints').delete().eq('board_id', boardId)
    await admin.from('board_agile_settings').delete().eq('board_id', boardId)
  }
  for (const id of taskIds) {
    await admin.from('task_assignees').delete().eq('task_id', id)
    await admin.from('tasks').delete().eq('id', id)
  }
  if (boardId) {
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
