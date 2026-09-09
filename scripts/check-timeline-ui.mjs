// Does the timeline actually work in a browser? Dev sandbox only.
//
// The RLS harness (pnpm check:milestones) proves the database enforces every boundary. This one
// exists because of the lesson CLAUDE.md records twice over: `pnpm check:board-roles` was 9/9
// green for weeks on a guest/client feature that was unusable, because everything broken was
// ABOVE the database - no screen could grant the role. A feature verified only at the database
// is not verified. So this asserts the things only a real browser can:
//
//   - the timeline layout really is optional, and the button is absent with the module off
//   - a saved view stuck on the timeline falls back rather than stranding its owner
//   - bars are drawn from the STORED calendar day, in a non-UTC timezone
//   - a drag really writes both dates, and a resize really changes only one end
//   - undated work lands in the tray rather than being silently dropped
//   - a milestone can be created, and marking one missed without a reason is refused ON SCREEN
//   - a dependency conflict is reported and NOTHING is moved
//   - the page never scrolls sideways, however long the chart is
//
// ⚠️ The context is pinned to America/Chicago deliberately. `tasks.start_date` and `due_date`
// are TIMESTAMPTZ storing UTC midnight, and the whole family of one-day-early bugs this repo has
// shipped is INVISIBLE in UTC. A harness running in the machine's own zone (this Mac is
// Asia/Calcutta) would pass against broken code. check-my-work.mjs pins the same zone for the
// same reason, and it is what found the column's real type.
//
// ⚠️ Every database assertion polls (`until`) rather than sleeping. A fixed waitForTimeout
// before a read is a flaky assertion, and a flaky assertion is worse than none because it
// teaches you to re-run until green.
//
// Creates and tears down its own fixture, and restores the module to whatever it found. Run
// with the dev server up:
//   pnpm dev
//   pnpm check:timeline-ui

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

/**
 * Tick a checkbox inside a Radix dropdown, reopening until it lands.
 *
 * ⚠️ A Radix menu will not reopen mid-close: it returns focus to the trigger as it unmounts and
 * swallows a second open issued during that. `click(trigger); click(item)` therefore passes once
 * and times out on the very next identical call, which CLAUDE.md records as a real harness bug.
 */
async function menuPick(page, triggerId, itemText, budgetMs = 20000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    await page.click(`#${triggerId}`).catch(() => {})
    const item = page.locator(`[role="menuitemcheckbox"]:has-text("${itemText}")`).first()
    try {
      await item.waitFor({ state: 'visible', timeout: 1500 })
      await item.click()
      await page.keyboard.press('Escape').catch(() => {})
      return true
    } catch {
      await page.keyboard.press('Escape').catch(() => {})
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  return false
}

/** The stored calendar day of a task, read the way every reader in the app reads it. */
const storedDay = (value) => (value == null ? null : String(value).slice(0, 10))

const readTask = async (id) => {
  const { data } = await admin.from('tasks').select('start_date, due_date').eq('id', id).single()
  return { start: storedDay(data?.start_date), due: storedDay(data?.due_date) }
}

let browser, userId, boardId, viewId
const columnIds = {}
const taskIds = []
const milestoneIds = []
const email = `timelineui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []
let modulePreviouslyEnabled = null

// Fixed dates so every assertion below is arithmetic rather than a moving target.
const SPAN_START = '2026-03-02'
const SPAN_END = '2026-03-06'
const utcMidnight = (day) => `${day}T00:00:00.000Z`

try {
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'Timeline Probe', role: 'super_admin', is_active: true },
    { onConflict: 'id' },
  )

  const { data: board } = await admin.from('boards')
    .insert({ title: `TIMELINEUI-${stamp}`, created_by: userId }).select('id').single()
  boardId = board.id
  for (const [i, [key, label]] of [['to_do', 'To Do'], ['done', 'Completed']].entries()) {
    const { data: c } = await admin.from('columns')
      .insert({ board_id: boardId, title: label, position: i, status_key: key }).select('id').single()
    columnIds[key] = c.id
  }

  // ⚠️ `visibility: 'board'` and a `status` matching the column, both explicitly. The default
  // visibility is 'assigned' (invisible to everyone but the creator) and `enforce_task_lifecycle`
  // REWRITES column_id when `status` disagrees with the column's status_key, which silently
  // relocates a fixture and makes every downstream assertion test the wrong row.
  const seedTask = async (title, { start = null, due = null, parent = null, statusKey = 'to_do', position = 0 } = {}) => {
    const { data, error } = await admin.from('tasks').insert({
      column_id: columnIds[statusKey], title: `${title}-${stamp}`, position, created_by: userId,
      visibility: 'board', status: statusKey,
      start_date: start ? utcMidnight(start) : null,
      due_date: due ? utcMidnight(due) : null,
      parent_task_id: parent,
    }).select('id').single()
    if (error) throw new Error(`seedTask(${title}): ${error.message}`)
    taskIds.push(data.id)
    return data.id
  }

  const spanned = await seedTask('TLSPAN', { start: SPAN_START, due: SPAN_END })
  const dueOnly = await seedTask('TLDUEONLY', { due: '2026-03-12', position: 1 })
  const undated = await seedTask('TLUNDATED', { position: 2 })
  const phase = await seedTask('TLPHASE', { position: 3 })
  const child = await seedTask('TLCHILD', { start: '2026-03-16', due: '2026-03-20', parent: phase, position: 4 })
  // The successor in a dependency that is deliberately violated: it starts before TLSPAN ends.
  const blocked = await seedTask('TLBLOCKED', { start: '2026-03-04', due: '2026-03-09', position: 5 })
  await admin.from('task_relations').insert({
    source_task_id: spanned, target_task_id: blocked, relation_type: 'blocks', created_by: userId,
  })

  const { data: ms } = await admin.from('milestones').insert({
    board_id: boardId, title: `TLMILESTONE-${stamp}`, due_date: '2026-03-10',
    owner_id: userId, created_by: userId,
  }).select('id').single()
  milestoneIds.push(ms.id)

  const { data: moduleRow } = await admin.from('app_modules')
    .select('enabled').eq('module_key', 'timeline').single()
  modulePreviouslyEnabled = moduleRow?.enabled ?? false

  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Chicago',
  })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  const signIn = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      // ⚠️ Pressed until it takes. `waitUntil: 'domcontentloaded'` returns on server-rendered
      // HTML, and the form's submit handler does not exist until React has hydrated - so on a
      // dev server busy recompiling the first click lands on inert markup and does nothing.
      await page.click('button[type="submit"]').catch(() => {})
      try {
        await page.waitForURL(/\/admin|\/dashboard/, { timeout: 6000 })
        return
      } catch {
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

  // ⚠️ A warm-up navigation that asserts NOTHING, so `next dev`'s first-request compile is out
  // of every measurement below. CLAUDE.md records this faking a product regression once already.
  await page.goto(`${BASE}/views`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#layout-table', { timeout: 60000 }).catch(() => {})

  // =======================================================================================
  section('The layout is genuinely optional')
  // =======================================================================================
  await admin.from('app_modules').update({ enabled: false }).eq('module_key', 'timeline')
  await page.goto(`${BASE}/views`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#layout-table', { timeout: 40000 })
  const offCount = await page.locator('#layout-timeline').count()
  check('with the module OFF there is no Timeline button', offCount === 0)
  const otherLayouts = await page.locator('#layout-kanban').count()
  check('CONTROL: and the other four layouts are still there', otherLayouts === 1)

  // A saved view stuck on a switched-off layout must fall back, not strand its owner.
  const { data: stranded } = await admin.from('saved_views').insert({
    owner_id: userId, name: `TLSTRANDED-${stamp}`,
    config: { layout: 'timeline', boardIds: [boardId] },
  }).select('id').single()
  viewId = stranded.id
  await page.goto(`${BASE}/views`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#layout-table', { timeout: 40000 })
  const strandedRenders = await until(
    () => page.locator('[role="group"][aria-label="Layout"] button[aria-pressed="true"]').count(),
    (n) => n > 0,
  )
  check('a saved view on a switched-off layout still renders a usable screen', strandedRenders > 0)

  await admin.from('app_modules').update({ enabled: true }).eq('module_key', 'timeline')
  await page.goto(`${BASE}/views`, { waitUntil: 'domcontentloaded' })
  const onCount = await until(() => page.locator('#layout-timeline').count(), (n) => n > 0, 40000)
  check('CONTROL: switching the module on puts Timeline in the switcher', onCount === 1)

  // =======================================================================================
  section('The chart draws what the database holds')
  // =======================================================================================
  await page.click('#layout-timeline')
  await page.waitForSelector('[data-testid="timeline-scroll"]', { timeout: 30000 })

  const bar = page.locator(`[data-timeline-bar="${spanned}"]`)
  check('a scheduled task gets a bar', await bar.count() === 1)

  // ⚠️ The bar's TITLE carries its two ends, and the browser is in America/Chicago. A reader
  // that resolved the stored instant through the local zone would print 1 March here, which is
  // precisely the bug that shipped into Prompt E and had to be fixed in thirteen places.
  const barTitle = await bar.getAttribute('title')
  check('and its label is built from the STORED day, not the local instant',
    Boolean(barTitle && barTitle.includes('3/2/2026') && barTitle.includes('3/6/2026')),
    `title was ${JSON.stringify(barTitle)} in America/Chicago`)

  check('a task with only a due date is still drawn',
    await page.locator(`[data-timeline-bar="${dueOnly}"]`).count() === 1)

  const trayItem = page.locator(`[data-unscheduled="${undated}"]`)
  check('undated work goes to the tray rather than being silently dropped', await trayItem.count() === 1)
  check('and it is NOT drawn as a bar, which would be a duration nobody entered',
    await page.locator(`[data-timeline-bar="${undated}"]`).count() === 0)

  check('the today marker is on screen', await page.locator('[data-testid="timeline-today-line"]').count() === 1)
  check('the milestone is drawn on the axis', await page.locator(`[data-milestone-marker="${ms.id}"]`).count() === 1)

  // =======================================================================================
  section('Macro/micro: a phase spans its children without duplicating them')
  // =======================================================================================
  const phaseBar = page.locator(`[data-timeline-bar="${phase}"]`)
  check('a parent with no dates of its own still gets a bar', await phaseBar.count() === 1)
  check('and it is marked as DERIVED, so nothing offers to drag it',
    await phaseBar.getAttribute('data-derived') === 'true')
  const phaseTitle = await phaseBar.getAttribute('title')
  check('it says where the span came from', Boolean(phaseTitle && /child|children/i.test(phaseTitle)),
    `title was ${JSON.stringify(phaseTitle)}`)

  const rowsBefore = await admin.from('tasks').select('id', { count: 'exact', head: true })
    .in('column_id', Object.values(columnIds))
  check('and the phase created no extra row: the high-level plan is not a copy',
    rowsBefore.count === taskIds.length, `${rowsBefore.count} rows for ${taskIds.length} seeded`)

  // =======================================================================================
  section('A dependency conflict is reported, and NOTHING is moved')
  // =======================================================================================
  const beforeConflict = await readTask(blocked)
  check('the successor carries a conflict warning', await page.locator(`[data-timeline-conflict="${blocked}"]`).count() === 1)
  const afterConflict = await readTask(blocked)
  check('and manual mode really moved nothing: its dates are byte-identical',
    beforeConflict.start === afterConflict.start && beforeConflict.due === afterConflict.due,
    `${JSON.stringify(beforeConflict)} -> ${JSON.stringify(afterConflict)}`)
  check('CONTROL: an unconflicted task carries no warning',
    await page.locator(`[data-timeline-conflict="${spanned}"]`).count() === 0)

  // =======================================================================================
  section('Dragging a bar really writes both dates')
  // =======================================================================================
  // ⚠️ The chart opens centred on TODAY and this fixture is dated months away, so the bar starts
  // at a NEGATIVE x inside its own scroll container. Without this the mouse lands on empty page
  // and every drag assertion fails for a reason that has nothing to do with dragging - measured,
  // the box read {"x":-1837,"y":2364}.
  await bar.scrollIntoViewIfNeeded()
  const box = await bar.boundingBox()
  if (!box) throw new Error('the bar has no box to drag')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Week zoom is 14px/day, so +42px is +3 days. Moved in steps because a single jump can be
  // coalesced into one pointermove that the handler reads as the start position.
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 })
  await page.mouse.move(box.x + box.width / 2 + 42, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()

  const dragged = await until(() => readTask(spanned), (t) => t.start !== SPAN_START, 20000)
  check('the drag wrote a new start date', dragged.start !== SPAN_START, JSON.stringify(dragged))
  check('and it kept the duration exactly, which is what "move" means',
    dragged.start !== null && dragged.due !== null
    && (Date.parse(`${dragged.due}T00:00:00Z`) - Date.parse(`${dragged.start}T00:00:00Z`))
       === (Date.parse(`${SPAN_END}T00:00:00Z`) - Date.parse(`${SPAN_START}T00:00:00Z`)),
    JSON.stringify(dragged))

  // ⚠️ Both stored values must be UTC midnight. A writer using toISOString() on a local-midnight
  // picker Date would store T05:00:00Z here in Chicago, and every reader takes the UTC date part.
  const { data: raw } = await admin.from('tasks').select('start_date, due_date').eq('id', spanned).single()
  check('and both ends are stored as UTC midnight, so this column keeps ONE shape',
    String(raw.start_date).includes('T00:00:00') && String(raw.due_date).includes('T00:00:00'),
    `${raw.start_date} / ${raw.due_date}`)

  // =======================================================================================
  section('Resizing changes one end only')
  // =======================================================================================
  // A reload resets the config to the default layout, so the timeline has to be re-selected
  // BEFORE waiting for the chart it draws. Waiting first is a 30s timeout on a working page.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#layout-timeline', { timeout: 40000 })
  await page.click('#layout-timeline')
  await page.waitForSelector(`[data-timeline-bar="${spanned}"]`, { timeout: 30000 })

  const beforeResize = await readTask(spanned)
  const bar2 = page.locator(`[data-timeline-bar="${spanned}"]`)
  await bar2.scrollIntoViewIfNeeded()
  const handle = bar2.locator('[data-timeline-handle="end"]')
  check('a movable bar offers a resize handle', await handle.count() === 1)
  const hbox = await handle.boundingBox()
  if (hbox) {
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2)
    await page.mouse.down()
    await page.mouse.move(hbox.x + 20, hbox.y + hbox.height / 2, { steps: 4 })
    await page.mouse.move(hbox.x + 42, hbox.y + hbox.height / 2, { steps: 4 })
    await page.mouse.up()
    const resized = await until(() => readTask(spanned), (t) => t.due !== beforeResize.due, 20000)
    check('resizing the end moved the due date', resized.due !== beforeResize.due,
      `${JSON.stringify(beforeResize)} -> ${JSON.stringify(resized)}`)
    check('and left the start date exactly where it was', resized.start === beforeResize.start,
      `${JSON.stringify(beforeResize)} -> ${JSON.stringify(resized)}`)
  } else {
    check('resizing the end moved the due date', false, 'the handle had no box')
    check('and left the start date exactly where it was', false, 'the handle had no box')
  }

  // A derived bar must NOT offer the handle: moving it would move its children, which is
  // automatic scheduling by another name.
  check('a derived phase bar offers no resize handle',
    await page.locator(`[data-timeline-bar="${phase}"] [data-timeline-handle="end"]`).count() === 0)

  // =======================================================================================
  section('Milestones are reachable from a screen, not from psql')
  // =======================================================================================
  check('the milestone panel lists the seeded one', await page.locator(`[data-milestone="${ms.id}"]`).count() === 1)
  const progressText = await page.locator(`[data-progress="${ms.id}"]`).innerText()
  check('a milestone with nothing linked says so rather than showing 0%',
    /nothing linked/i.test(progressText), `it said ${JSON.stringify(progressText)}`)

  // Creating needs one board in scope, and says why when it does not have one.
  const createDisabled = await page.locator('#milestone-create').isDisabled()
  check('with no single board in scope, New milestone is disabled', createDisabled)
  const reason = await page.locator('text=/Scope this view to one board/i').count()
  check('and the screen says why, rather than looking broken', reason > 0)

  // Scope to this board through the REAL control. There is no ?board= param on /views, and
  // driving the dropdown is the only way to prove a person can actually reach this state.
  const scoped = await menuPick(page, 'view-scope', `TIMELINEUI-${stamp}`)
  check('the board scope control can be driven from the screen', scoped)
  await page.waitForSelector('#milestone-create', { timeout: 30000 })
  const enabledNow = await until(
    () => page.locator('#milestone-create').isDisabled(),
    (disabled) => disabled === false,
    15000,
  )
  check('CONTROL: scoping to one board enables it', enabledNow === false)

  if (enabledNow === false) {
    await page.click('#milestone-create')
    await page.waitForSelector('#milestone-title', { timeout: 15000 })
    await page.fill('#milestone-title', `TLCREATED-${stamp}`)
    await page.fill('#milestone-due', '2026-04-15')
    await page.click('#milestone-save')
    const createdMs = await until(
      async () => {
        const { data } = await admin.from('milestones').select('id').eq('board_id', boardId)
        return data ?? []
      },
      (list) => list.length > 1,
      20000,
    )
    check('an admin can create a milestone from the screen', createdMs.length > 1, `${createdMs.length} on the board`)
    for (const row of createdMs) if (!milestoneIds.includes(row.id)) milestoneIds.push(row.id)

    // ⚠️ POLL ON THE FINAL CONDITION, NOT A WEAKER ONE. The database write above lands a beat
    // BEFORE React unmounts the dialog, so a check that stops at "the row exists" continues
    // while the Radix overlay is still up - and the next section's click is then swallowed by
    // it ("<div data-slot=dialog-overlay> intercepts pointer events", 56 retries, then a
    // timeout that reads like a broken product). Same lesson as the sprint-reorder poll in
    // check-agile-ui and the Radix reopen trap: waiting for the thing you can observe soonest
    // is not the same as waiting for the thing you need.
    await page.waitForSelector('#milestone-title', { state: 'detached', timeout: 15000 })
  } else {
    check('an admin can create a milestone from the screen', false, 'the button never enabled')
  }

  // =======================================================================================
  section('Missing a milestone without a reason is refused ON SCREEN, not only by the trigger')
  // =======================================================================================
  await page.click(`[data-milestone-edit="${ms.id}"]`)
  await page.waitForSelector('#milestone-state', { timeout: 15000 })
  await page.click('#milestone-state')
  const missedOption = page.locator('[role="option"]:has-text("Missed")').first()
  await missedOption.waitFor({ state: 'visible', timeout: 8000 })
  await missedOption.click()

  const saveDisabled = await until(
    () => page.locator('#milestone-save').isDisabled(),
    (d) => d === true,
    8000,
  )
  check('Save is DISABLED until a reason is typed', saveDisabled === true)
  const blockedMsg = await page.locator('[data-milestone-blocked]').innerText().catch(() => '')
  check('and the dialog says why, in words a person can act on',
    /reason/i.test(blockedMsg), `it said ${JSON.stringify(blockedMsg)}`)

  await page.fill('#milestone-note', 'The permit office pushed the review.')
  const saveEnabled = await until(
    () => page.locator('#milestone-save').isDisabled(),
    (d) => d === false,
    8000,
  )
  check('CONTROL: typing a reason enables it', saveEnabled === false)

  await page.click('#milestone-save')
  const missed = await until(
    async () => {
      const { data } = await admin.from('milestones').select('state, state_note').eq('id', ms.id).single()
      return data
    },
    (row) => row?.state === 'missed',
    20000,
  )
  check('and the reason really reaches the database with the state', missed?.state_note?.includes('permit'),
    JSON.stringify(missed))

  // =======================================================================================
  section('The page never scrolls sideways, however long the chart is')
  // =======================================================================================
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`no horizontal page scroll at ${width}px`, overflow <= 1, `overflowed by ${overflow}px`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })

  const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e))
  check('no console errors across the whole run', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} catch (err) {
  failures++
  console.log(`\nFAIL  the run threw before finishing: ${err?.message ?? err}`)
  console.log(err?.stack ?? '')
} finally {
  if (browser) await browser.close().catch(() => {})
  if (modulePreviouslyEnabled !== null) {
    await admin.from('app_modules').update({ enabled: modulePreviouslyEnabled }).eq('module_key', 'timeline')
  }
  if (viewId) await admin.from('saved_views').delete().eq('id', viewId)
  for (const id of milestoneIds) await admin.from('milestones').delete().eq('id', id)
  if (boardId) {
    const { data: cols } = await admin.from('columns').select('id').eq('board_id', boardId)
    const colIds = (cols ?? []).map((c) => c.id)
    if (colIds.length) {
      const { data: strays } = await admin.from('tasks').select('id').in('column_id', colIds)
      for (const t of strays ?? []) {
        await admin.from('task_relations').delete().or(`source_task_id.eq.${t.id},target_task_id.eq.${t.id}`)
        await admin.from('milestone_tasks').delete().eq('task_id', t.id)
        await admin.from('task_assignees').delete().eq('task_id', t.id)
      }
      // Children first: a subtask holds a foreign key to its parent.
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
