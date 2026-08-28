// Can a human actually reach quick capture, bulk operations, recurrence and reminders?
// Dev sandbox only.
//
// scripts/check-recurrence.mjs proves migrations 116 and 117 behave at the database. That is
// exactly the half this repo has repeatedly found insufficient: `board_members.role` was 9/9
// green for weeks while no UI could set the role, `app_modules` had policies and seeded rows
// with no writer at all, and the recurrence columns this work replaces had a prominent toggle
// wired to nothing for months. So this drives a real browser.
//
// It deliberately asserts the things a code review cannot see: that the parse is VISIBLE before
// saving, that the bulk count is the count that will change rather than the selection size, and
// that a destructive bulk action asks first.
//
// Creates and tears down its own fixture. Run with the dev server up:
//   pnpm dev
//   node --env-file=.env.local scripts/check-recurrence-ui.mjs

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url ?? '')) throw new Error(`refusing to run against ${url}`)

const BASE = process.env.BASE_URL || 'http://localhost:3000'

/**
 * The same server, addressed by IPv4 literal, for requests made by NODE rather than by the
 * browser.
 *
 * ⚠️ `page.request` runs in Node, and Node resolves `localhost` to `::1` BEFORE `127.0.0.1`
 * (`dns.lookup('localhost', {all:true})` returns the IPv6 address first). `next dev` binds IPv4
 * only, so every `page.request` call died with `connect ECONNREFUSED ::1:3000` while
 * `page.goto` against the identical URL succeeded, because the browser does its own happy-eyeballs
 * resolution. The run aborted after 74 passing checks and reported a harness error, which reads
 * like a broken harness rather than an unroutable address family.
 *
 * Only the Node-side calls are rewritten. `BASE` stays as given so the browser keeps using
 * whatever host the operator asked for, and an explicit BASE_URL is honoured untouched.
 */
const NODE_BASE = process.env.BASE_URL || 'http://127.0.0.1:3000'
const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}
const section = (n) => console.log(`\n--- ${n} ---`)

let browser, userId, boardId, todoCol, doneCol, destBoardId, destColId
const taskIds = []
const email = `recui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []

/**
 * Sweep debris from any earlier run that did not reach its own teardown.
 *
 * ⚠️ This is not belt-and-braces. A harness piped into `head` gets SIGPIPE the moment head has
 * what it wants, which kills the process part-way through `finally` and leaves a board, its
 * columns and its tasks behind - observed, and the reason this exists. Fixtures are named with
 * a stamp so anything matching the prefix but not THIS run's stamp is certainly abandoned.
 */
/**
 * Poll a read until it returns something acceptable, or the budget runs out.
 *
 * ⚠️ Every database assertion in this file used to be `click(); waitForTimeout(2500); read()`.
 * Against a warm dev server that passed; against a cold one the write had not landed yet and
 * the check failed for a reason with nothing to do with the behaviour under test. Three
 * different checks failed on three consecutive runs of identical code, which is the exact trap
 * this repo already recorded: a flaky assertion is worse than none, because it teaches you to
 * re-run until green.
 *
 * The last read is returned whether or not it was accepted, so a genuine failure still reports
 * the real value rather than a timeout.
 */
async function until(read, accept, budgetMs = 25000) {
  const deadline = Date.now() + budgetMs
  let last = await read()
  while (Date.now() < deadline) {
    if (accept(last)) return last
    await new Promise((r) => setTimeout(r, 500))
    last = await read()
  }
  return last
}

async function sweepOldFixtures() {
  const { data: old } = await admin.from('boards').select('id, title').or('title.like.rec-ui-%,title.like.rec-ui-dest-%')
  const abandoned = (old ?? []).filter((b) => !b.title.endsWith(String(stamp)))
  if (abandoned.length === 0) return
  for (const board of abandoned) {
    const { data: cols } = await admin.from('columns').select('id').eq('board_id', board.id)
    const colIds = (cols ?? []).map((c) => c.id)
    if (colIds.length) {
      const { data: ts } = await admin.from('tasks').select('id').in('column_id', colIds)
      const tIds = (ts ?? []).map((t) => t.id)
      if (tIds.length) {
        const { data: rs } = await admin.from('recurrence_rules').select('id').in('source_task_id', tIds)
        for (const r of rs ?? []) await admin.from('recurrence_occurrences').delete().eq('rule_id', r.id)
        await admin.from('recurrence_rules').delete().in('source_task_id', tIds)
        await admin.from('task_reminders').delete().in('task_id', tIds)
        await admin.from('tasks').delete().in('parent_task_id', tIds)
        await admin.from('tasks').delete().in('id', tIds)
      }
      await admin.from('columns').delete().in('id', colIds)
    }
    await admin.from('boards').delete().eq('id', board.id)
  }
  console.log(`  ..  swept ${abandoned.length} fixture board(s) left by an earlier interrupted run`)
}

try {
  await sweepOldFixtures()

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'Rec Probe', role: 'super_admin', is_active: true },
    { onConflict: 'id' },
  )

  const { data: board } = await admin.from('boards')
    .insert({ title: `rec-ui-${stamp}`, created_by: userId, is_private: false }).select('id').single()
  boardId = board.id
  const cols = await admin.from('columns').insert([
    { board_id: boardId, title: 'To Do', position: 0, status_key: 'to_do' },
    { board_id: boardId, title: 'Done', position: 1, status_key: 'done' },
  ]).select('id, status_key')
  todoCol = cols.data.find((c) => c.status_key === 'to_do').id
  doneCol = cols.data.find((c) => c.status_key === 'done').id

  for (let i = 0; i < 3; i++) {
    const { data: t } = await admin.from('tasks').insert({
      column_id: todoCol, title: `Probe task ${i} ${stamp}`, position: i,
      created_by: userId, visibility: 'board', priority: 3,
      due_date: '2126-09-01T12:00:00Z',
    }).select('id').single()
    taskIds.push(t.id)
  }

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  // Same retry as check-work-items-ui.mjs, for the same reason: run in a batch, the dev server
  // is still compiling and post-login navigation exceeds Playwright's 30s default.
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

  const boardUrl = `${BASE}/admin/board/${boardId}`
  const openBoard = async () => {
    await page.goto(boardUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Probe task 0', { timeout: 30000 })
  }
  await openBoard()

  // =====================================================================================
  section('The keyboard shortcut opens capture, and knows when not to')
  // =====================================================================================
  // A shortcut is only worth having if it fires when you want it and stays out of the way when
  // you do not. Both halves are asserted, because the second is the one that makes it a hazard.
  // ⚠️ A document-level keydown listener does not exist until React has hydrated, and
  // waitForSelector returns on server-rendered HTML. Sleeping a fixed amount and hoping is
  // exactly the flaky-assertion trap this repo has already been bitten by, so press and
  // re-press until it opens or the budget is spent. Either the shortcut works within a few
  // seconds or it does not work at all; both are real answers, neither depends on timing.
  let capturedByKey = false
  for (let i = 0; i < 20 && !capturedByKey; i++) {
    await page.keyboard.press('c')
    capturedByKey = await page.locator('#quick-capture-input').isVisible().catch(() => false)
    if (!capturedByKey) await page.waitForTimeout(500)
  }
  check('pressing C opens quick capture', capturedByKey)

  // With the dialog already open, C must not stack a second one on top.
  await page.fill('#quick-capture-input', '')
  await page.click('#quick-capture-input')
  await page.keyboard.type('c')
  const typedValue = await page.inputValue('#quick-capture-input').catch(() => '')
  check('C typed inside a text field types the letter instead of re-opening', typedValue === 'c', typedValue)
  const stackedDialogs = await page.locator('#quick-capture-input').count()
  check('and exactly one capture dialog is mounted, not two', stackedDialogs === 1, String(stackedDialogs))

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('Escape closes it again',
    !(await page.locator('#quick-capture-input').isVisible().catch(() => false)))

  // And the help panel must actually list it - an undocumented shortcut is one nobody finds.
  await page.keyboard.press('?')
  await page.waitForTimeout(800)
  // The panel opens on Features; the shortcut table lives behind its own tab and is not in the
  // DOM until that tab is selected.
  await page.getByRole('tab', { name: /Keyboard shortcuts/i }).click().catch(() => {})
  await page.waitForTimeout(500)
  // .first() matters: more than one [role="dialog"] can be mounted and a bare locator would
  // throw a strict-mode violation that the catch would silently turn into an empty string.
  const helpText = await page.locator('[role="dialog"]').first().innerText().catch(() => '')
  check('the help panel documents the C shortcut', /Quick add a task/i.test(helpText),
    helpText.slice(0, 160).replace(/\n/g, ' | '))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // =====================================================================================
  section('Quick capture is reachable and shows its working')
  // =====================================================================================
  const quickAdd = page.getByRole('button', { name: /Quick add/i })
  check('the board offers a Quick add button', await quickAdd.isVisible().catch(() => false))
  await quickAdd.click()
  await page.waitForSelector('#quick-capture-input', { timeout: 10000 })

  await page.fill('#quick-capture-input', 'Prepare bid package tomorrow 3pm high priority')
  await page.waitForTimeout(400)

  // The requirement is not "it parses" - it is that the user can SEE what it decided before
  // committing to it. A parse that happens invisibly is a parse nobody can correct.
  const chips = page.locator('[data-testid="capture-chips"] [data-field]')
  const chipCount = await chips.count()
  check('the parsed fields are shown as chips', chipCount >= 3, `saw ${chipCount}`)

  const chipText = await page.locator('[data-testid="capture-chips"]').innerText().catch(() => '')
  check('the DATE chip shows an absolute date, not the words the user typed',
    /\d{4}/.test(chipText) && /August|September/i.test(chipText), chipText.replace(/\n/g, ' | '))
  check('the priority chip names the level', /High/i.test(chipText), chipText.replace(/\n/g, ' | '))

  const titlePreview = await page.locator('[data-testid="capture-title"]').innerText().catch(() => '')
  check('the remaining title is shown separately', titlePreview === 'Prepare bid package', titlePreview)

  // Dismissing a chip must put the words BACK, not drop them.
  //
  // ⚠️ Wait for the title to CHANGE rather than sleeping a fixed 300ms and reading. This is a
  // React state update rendered by a dev server that may be compiling something else, and the
  // fixed sleep made this check pass and fail on identical code - a flaky assertion is worse
  // than none, because it teaches you to re-run until green.
  await page.locator('[data-testid="capture-chips"] button').first().click()
  let afterDismiss = titlePreview
  try {
    await page.waitForFunction(
      (before) => document.querySelector('[data-testid="capture-title"]')?.textContent?.trim() !== before,
      titlePreview,
      { timeout: 5000 },
    )
    afterDismiss = await page.locator('[data-testid="capture-title"]').innerText().catch(() => '')
  } catch { /* leave afterDismiss unchanged so the check below fails honestly */ }
  check('dismissing a chip returns its text to the title rather than discarding it',
    afterDismiss.length > titlePreview.length, `"${titlePreview}" -> "${afterDismiss}"`)

  // An unresolvable @name must stay in the title and say why.
  await page.fill('#quick-capture-input', 'Ping @nobodyhere about it')
  await page.waitForTimeout(400)
  const warnText = await page.locator('[data-testid="capture-warnings"]').innerText().catch(() => '')
  check('an unmatched @name produces a visible warning', /No one here matches/i.test(warnText), warnText)
  const keptTitle = await page.locator('[data-testid="capture-title"]').innerText().catch(() => '')
  check('and the @name is still in the title', keptTitle.includes('@nobodyhere'), keptTitle)

  // Actually create one.
  await page.fill('#quick-capture-input', `Quick captured ${stamp} tomorrow p1`)
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Create task' }).click()

  const captured = await until(
    async () => (await admin.from('tasks')
      .select('id, title, priority, due_date')
      .eq('column_id', todoCol).ilike('title', `%Quick captured ${stamp}%`)).data ?? [],
    (rows) => rows.length === 1,
  )
  check('quick capture really creates a task', (captured?.length ?? 0) === 1, JSON.stringify(captured))
  if (captured?.[0]) {
    taskIds.push(captured[0].id)
    check('and the parsed priority is stored', captured[0].priority === 1, String(captured[0].priority))
    check('and the parsed due date is stored', Boolean(captured[0].due_date), String(captured[0].due_date))
    check('and the title excludes the parsed words',
      captured[0].title === `Quick captured ${stamp}`, captured[0].title)
  }

  // =====================================================================================
  section('Multi-create previews before it writes')
  // =====================================================================================
  await page.getByRole('tab', { name: 'Paste a list' }).click()
  await page.waitForTimeout(300)
  await page.fill('textarea', `Launch campaign ${stamp}\n  Draft Facebook post\n  Draft Instagram post`)
  await page.waitForTimeout(500)

  const preview = page.locator('[data-testid="capture-preview"]')
  check('a preview of the pasted lines is shown before anything is created',
    await preview.isVisible().catch(() => false))

  const countText = await page.locator('[data-testid="capture-count"]').innerText().catch(() => '')
  check('the number that will be created is stated', /3 tasks will be created/i.test(countText), countText)

  // Indentation is offered, never applied silently.
  const nestBox = page.locator('#use-hierarchy')
  check('nesting is offered as an explicit choice', await nestBox.isVisible().catch(() => false))
  check('and it is OFF by default, so indentation is never acted on silently',
    (await nestBox.isChecked().catch(() => true)) === false)

  await nestBox.check()
  await page.waitForTimeout(300)
  const nestedCount = await page.locator('[data-testid="capture-count"]').innerText().catch(() => '')
  check('turning nesting on restates the shape it will create',
    /1 top level, 2 as subtasks/i.test(nestedCount), nestedCount)

  await page.getByRole('button', { name: /Create 3 tasks/i }).click()

  const parent = await until(
    async () => (await admin.from('tasks')
      .select('id').eq('column_id', todoCol).ilike('title', `%Launch campaign ${stamp}%`).maybeSingle()).data,
    (row) => Boolean(row),
  )
  check('the parent was created', Boolean(parent))
  if (parent) {
    taskIds.push(parent.id)
    // The parent lands first and the children follow, so finding the parent is NOT proof the
    // batch is finished - wait for the children on their own budget.
    const kids = await until(
      async () => (await admin.from('tasks').select('id, type_key').eq('parent_task_id', parent.id)).data ?? [],
      (rows) => rows.length === 2,
    )
    check('and the indented lines became real subtasks of it', (kids?.length ?? 0) === 2, JSON.stringify(kids))
    check('typed as subtasks, per 113', (kids ?? []).every((k) => k.type_key === 'subtask'))
    for (const k of kids ?? []) taskIds.push(k.id)
  }

  // A "Repeats" chip that displays and is then dropped on save is the exact defect migration
  // 116 exists to end - and the first version of this dialog did precisely that. So the chip
  // has to be traced all the way to a row in recurrence_rules.
  await page.getByRole('tab', { name: 'One task' }).click()
  await page.waitForTimeout(400)
  await page.fill('#quick-capture-input', `Site walkthrough ${stamp} every monday`)
  await page.waitForTimeout(500)
  const recurChip = await page.locator('[data-testid="capture-chips"] [data-field="recurrence"]')
    .innerText().catch(() => '')
  check('a recurrence phrase is recognised and shown', /every Monday/i.test(recurChip), recurChip)

  await page.getByRole('button', { name: 'Create task' }).click()
  const recurTask = await until(
    async () => (await admin.from('tasks')
      .select('id').ilike('title', `%Site walkthrough ${stamp}%`).maybeSingle()).data,
    (row) => Boolean(row),
  )
  check('the task is created', Boolean(recurTask))
  if (recurTask) {
    taskIds.push(recurTask.id)
    const { data: capturedRule } = await admin.from('recurrence_rules')
      .select('frequency, weekdays, generation_mode').eq('source_task_id', recurTask.id).maybeSingle()
    check('and a REAL schedule was created from the phrase, not just displayed',
      Boolean(capturedRule), 'the chip said it repeats; the database must agree')
    check('with the weekday the user named',
      JSON.stringify(capturedRule?.weekdays) === '[1]', JSON.stringify(capturedRule?.weekdays))
    check('and one live instance at a time, not a flood',
      capturedRule?.generation_mode === 'on_completion', capturedRule?.generation_mode)
  }

  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // =====================================================================================
  section('Bulk operations state what will change, not what is selected')
  // =====================================================================================
  await openBoard()
  await page.getByRole('button', { name: /^Select$/ }).click()
  await page.waitForTimeout(600)

  const boxes = page.locator('input[type="checkbox"][aria-label^="Select Probe task"]')
  const boxCount = await boxes.count()
  check('selection mode puts a checkbox on each card', boxCount >= 3, `saw ${boxCount}`)

  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await boxes.nth(2).check()
  await page.waitForTimeout(500)

  const bar = page.locator('[data-testid="bulk-action-bar"]')
  check('the bulk bar appears once tasks are selected', await bar.isVisible().catch(() => false))
  const barCount = await page.locator('[data-testid="bulk-count"]').innerText().catch(() => '')
  check('and it names how many are selected', /3 selected/.test(barCount), barCount)

  // The three fixtures are all priority 3 already. Setting priority to 3 must therefore
  // report ZERO changes - the exact case a naive bulk bar reports as "3 updated".
  await page.getByRole('button', { name: /Set priority/i }).click()
  await page.waitForTimeout(800)
  const noopCount = await page.locator('[data-testid="bulk-will-change"]').innerText().catch(() => '')
  check('setting a value every task already has reports 0 will change', noopCount === '0', noopCount)
  const applyBtn = page.getByRole('button', { name: /Nothing to change/i })
  check('and the apply button says so rather than looking ready',
    await applyBtn.isVisible().catch(() => false))

  // Now a real change.
  // ⚠️ Locate by id, never `button[role="combobox"]').first()`. The board behind the dialog
  // has its own comboboxes, and .first() resolves to one of THOSE - visible, enabled, and
  // permanently un-clickable behind the dialog overlay. That is how this harness failed the
  // first time it ran, and the failure reads as a timeout rather than as "wrong element".
  await page.locator('#bulk-priority').click()
  await page.waitForTimeout(400)
  await page.getByRole('option', { name: /1 - Highest/ }).click()
  await page.waitForTimeout(600)
  const realCount = await page.locator('[data-testid="bulk-will-change"]').innerText().catch(() => '')
  check('changing to a genuinely different value reports 3 will change', realCount === '3', realCount)

  await page.getByRole('button', { name: /Apply to 3/i }).click()

  const bumped = await until(
    async () => (await admin.from('tasks').select('priority').in('id', taskIds.slice(0, 3))).data ?? [],
    (rows) => rows.length === 3 && rows.every((t) => t.priority === 1),
  )
  check('the bulk change really lands in the database',
    (bumped ?? []).every((t) => t.priority === 1), JSON.stringify(bumped))

  // Every operation the engine implements must have a button. `unassign`, `unlabel` and `move`
  // were implemented in lib/bulk-operations.ts and left out of the bar - working code behind
  // no route a human could take, this repo's most-repeated defect.
  await openBoard()
  await page.getByRole('button', { name: /^Select$/ }).click()
  await page.waitForTimeout(600)
  const boxesAll = page.locator('input[type="checkbox"][aria-label^="Select Probe task"]')
  await boxesAll.nth(0).check()
  await page.waitForTimeout(500)
  const barLabels = await page.locator('[data-testid="bulk-action-bar"]').innerText().catch(() => '')
  for (const label of ['Assign to', 'Remove assignee', 'Set priority', 'Move to status',
                       'Add label', 'Remove label', 'Set due date', 'Shift due dates',
                       'Move to board', 'Archive', 'Delete']) {
    check(`the bulk bar offers "${label}"`, barLabels.includes(label), barLabels.replace(/\n/g, ' | '))
  }

  // Move is the one that needs a cross-board destination, so it is worth driving end to end.
  const { data: otherBoard } = await admin.from('boards')
    .insert({ title: `rec-ui-dest-${stamp}`, created_by: userId, is_private: false }).select('id').single()
  destBoardId = otherBoard.id
  const { data: destCol } = await admin.from('columns')
    .insert({ board_id: destBoardId, title: 'To Do', position: 0, status_key: 'to_do' }).select('id').single()
  destColId = destCol.id

  await page.getByRole('button', { name: /Move to board/i }).click()
  await page.waitForTimeout(900)
  await page.locator('#bulk-move').click()
  await page.waitForTimeout(600)
  await page.getByRole('option', { name: new RegExp(`rec-ui-dest-${stamp}`) }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /Apply to 1/i }).click()
  await page.waitForTimeout(3500)

  const { data: movedTask } = await admin.from('tasks')
    .select('column_id').eq('id', taskIds[0]).single()
  check('bulk Move really moves the task to the other board',
    movedTask?.column_id === destColId, `${movedTask?.column_id} vs ${destColId}`)
  // Put it back so the later recurrence checks still find it on this board.
  await admin.from('tasks').update({ column_id: todoCol }).eq('id', taskIds[0])

  // =====================================================================================
  section('A destructive bulk action asks first')
  // =====================================================================================
  await openBoard()
  await page.getByRole('button', { name: /^Select$/ }).click()
  await page.waitForTimeout(600)
  const boxes2 = page.locator('input[type="checkbox"][aria-label^="Select Probe task"]')
  await boxes2.nth(0).check()
  await boxes2.nth(1).check()
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: /^Archive$/i }).click()
  await page.waitForTimeout(900)
  const confirmText = await page.locator('[data-testid="bulk-confirmation"]').innerText().catch(() => '')
  check('archiving asks for confirmation, naming the count',
    /Archive 2 tasks\?/i.test(confirmText), confirmText)
  check('and says what archiving means, rather than assuming it is understood',
    /restored/i.test(confirmText), confirmText)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const { data: notArchived } = await admin.from('tasks')
    .select('archived_at').in('id', taskIds.slice(0, 2))
  check('CONTROL: dismissing the confirmation archives nothing',
    (notArchived ?? []).every((t) => t.archived_at === null), JSON.stringify(notArchived))

  // =====================================================================================
  section('Recurrence is a real schedule, not a toggle wired to nothing')
  // =====================================================================================
  await page.goto(`${boardUrl}?task=${taskIds[0]}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="recurrence-panel"]', { timeout: 30000 })

  check('the task detail shows a recurrence panel',
    await page.locator('[data-testid="recurrence-panel"]').isVisible().catch(() => false))
  check('a task with no schedule says so plainly',
    await page.getByText('This task does not repeat').isVisible().catch(() => false))

  await page.getByRole('button', { name: 'Set a schedule' }).click()
  await page.waitForTimeout(700)

  // Weekly is the default; switch to schedule mode so the preview is meaningful.
  const modeSelect = page.locator('#rec-mode')
  await modeSelect.click()
  await page.waitForTimeout(400)
  await page.getByRole('option', { name: /Ahead of time/i }).click()
  await page.waitForTimeout(700)

  const previewBox = page.locator('[data-testid="recurrence-preview"]')
  check('schedule mode previews the dates it will actually create',
    await previewBox.isVisible().catch(() => false))
  const previewText = await previewBox.innerText().catch(() => '')
  check('and the preview holds real dates', /\d{4}-\d{2}-\d{2}/.test(previewText), previewText)

  await page.getByRole('button', { name: 'Create schedule' }).click()

  const rule = await until(
    async () => (await admin.from('recurrence_rules')
      .select('id, frequency, generation_mode').eq('source_task_id', taskIds[0]).maybeSingle()).data,
    (row) => Boolean(row),
  )
  check('the schedule is really written', Boolean(rule), JSON.stringify(rule))
  check('with the mode the user picked', rule?.generation_mode === 'schedule', rule?.generation_mode)

  const summary = await page.locator('[data-testid="recurrence-summary"]').innerText().catch(() => '')
  check('the saved schedule is described in plain English',
    /every week/i.test(summary), summary)

  // The whole point: it must produce work, and pressing it twice must not double up.
  //
  // ⚠️ This used to sleep 3000ms and then read the ledger, which failed intermittently against
  // a cold dev server: generation had not finished, the first read saw 0, and the SECOND read
  // then saw 5 - so the idempotency check reported "0 -> 5" and the real behaviour (correct
  // both times) was never in question. Poll for the write to land instead of guessing how long
  // an RPC takes. A count that stops moving is the actual signal being waited on.
  const occurrencesFor = async (ruleId) => {
    const { data } = await admin.from('recurrence_occurrences').select('task_id').eq('rule_id', ruleId)
    return data ?? []
  }
  const settledOccurrences = async (ruleId, { atLeast = 0, budgetMs = 30000 } = {}) => {
    let last = -1
    let stable = 0
    const deadline = Date.now() + budgetMs
    while (Date.now() < deadline) {
      const rows = await occurrencesFor(ruleId)
      if (rows.length === last && rows.length >= atLeast) {
        // Two identical reads in a row, and enough rows to be worth believing.
        if (++stable >= 2) return rows
      } else {
        stable = 0
      }
      last = rows.length
      await page.waitForTimeout(750)
    }
    return occurrencesFor(ruleId)
  }

  await page.getByRole('button', { name: /Run now/i }).click()
  const occ1 = await settledOccurrences(rule.id, { atLeast: 1 })
  check('Run now actually creates tasks', occ1.length > 0, `${occ1.length} created`)
  for (const o of occ1) if (o.task_id) taskIds.push(o.task_id)

  // The second press must be OBSERVED to have completed, or "nothing changed" passes for the
  // trivial reason that nothing has happened yet. The panel says so out loud, so wait for that.
  await page.getByRole('button', { name: /Run now/i }).click()
  const sawNothingToCreate = await page
    .waitForSelector('text=/Nothing to create|already up to date/i', { timeout: 15000 })
    .then(() => true).catch(() => false)
  const occ2 = await settledOccurrences(rule.id, { atLeast: occ1.length })
  check('pressing Run now again creates nothing more',
    occ2.length === occ1.length, `${occ1.length} -> ${occ2.length}`)
  check('and it says so rather than silently doing nothing', sawNothingToCreate)

  // =====================================================================================
  section('Reminders are personal and reachable')
  // =====================================================================================
  check('the task detail shows a reminders panel',
    await page.locator('[data-testid="reminders-panel"]').isVisible().catch(() => false))
  check('and says plainly that reminders are private',
    await page.getByText(/private to you/i).isVisible().catch(() => false))

  await page.locator('[data-testid="reminders-panel"]').getByRole('button', { name: /Add/i }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Set reminder' }).click()

  const reminder = await until(
    async () => (await admin.from('task_reminders')
      .select('id, user_id, offset_minutes').eq('task_id', taskIds[0]).maybeSingle()).data,
    (row) => Boolean(row),
  )
  check('a reminder is really created', Boolean(reminder), JSON.stringify(reminder))
  check('owned by the person who set it', reminder?.user_id === userId)
  check('with the offset they chose', reminder?.offset_minutes === 1440, String(reminder?.offset_minutes))

  // 117 grants UPDATE on a reminder's own columns. Until this was wired the grant had no
  // consumer at all - a granted ability with no route to it, the same defect as an
  // unreachable bulk operation pointing the other way.
  await page.locator('[data-testid="reminders-panel"]')
    .getByRole('button', { name: /^Edit reminder/ }).click()
  await page.waitForTimeout(700)
  await page.fill('#rem-note', 'Ring the supplier first')
  await page.getByRole('button', { name: 'Update reminder' }).click()

  const editedReminder = await until(
    async () => (await admin.from('task_reminders')
      .select('note, delivered_at').eq('task_id', taskIds[0]).maybeSingle()).data,
    (row) => row?.note === 'Ring the supplier first',
  )
  check('a pending reminder can be edited in place', editedReminder?.note === 'Ring the supplier first',
    JSON.stringify(editedReminder))

  // =====================================================================================
  section('The scheduled sweep refuses without its secret, and reports honestly with it')
  // =====================================================================================
  // Without CRON_SECRET the route 401s and the nightly sweep silently never runs, which looks
  // exactly like a healthy schedule from outside - so the auth path is worth pinning, not just
  // the happy path. It also caught a real crash: lib/email.ts built its Resend client at module
  // load, so an unset RESEND_API_KEY made this route 500 before reaching its own auth check,
  // taking recurrence generation down with it.
  const secret = process.env.CRON_SECRET
  check('CRON_SECRET is configured', Boolean(secret),
    'without it the sweep 401s and never runs')

  const unauth = await page.request.get(`${NODE_BASE}/api/cron/scheduled-work`)
  check('the sweep refuses a request with no secret', unauth.status() === 401, String(unauth.status()))

  const wrong = await page.request.get(`${NODE_BASE}/api/cron/scheduled-work`, {
    headers: { Authorization: 'Bearer definitely-not-the-secret' },
  })
  check('and refuses a wrong secret', wrong.status() === 401, String(wrong.status()))

  if (secret) {
    const ok = await page.request.get(`${NODE_BASE}/api/cron/scheduled-work`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    check('and runs with the right one', ok.status() === 200, String(ok.status()))
    const body = await ok.json().catch(() => ({}))
    check('reporting what it considered rather than just "done"',
      typeof body?.recurrence?.rulesConsidered === 'number'
      && typeof body?.reminders?.delivered === 'number', JSON.stringify(body))
    check('and it is idempotent - a second immediate run creates nothing new', await (async () => {
      const again = await page.request.get(`${NODE_BASE}/api/cron/scheduled-work`, {
        headers: { Authorization: `Bearer ${secret}` },
      })
      const b = await again.json().catch(() => ({}))
      return b?.recurrence?.tasksCreated === 0
    })())
  }

  // =====================================================================================
  section('No console errors across all of it')
  // =====================================================================================
  const realErrors = consoleErrors.filter((e) => !/favicon|ResizeObserver|hydrat/i.test(e))
  check('zero console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} catch (err) {
  console.error(`\nHARNESS ERROR: ${err.message}\n${err.stack ?? ''}`)
  failures++
} finally {
  if (browser) await browser.close()
  const { data: rules } = await admin.from('recurrence_rules').select('id').in('source_task_id', taskIds)
  for (const r of rules ?? []) {
    const { data: occ } = await admin.from('recurrence_occurrences').select('task_id').eq('rule_id', r.id)
    for (const o of occ ?? []) if (o.task_id) await admin.from('tasks').delete().eq('id', o.task_id)
    await admin.from('recurrence_rules').delete().eq('id', r.id)
  }
  // Subtasks before parents, or the FK refuses.
  for (const id of taskIds) await admin.from('tasks').delete().eq('parent_task_id', id)
  for (const id of taskIds) await admin.from('tasks').delete().eq('id', id)
  if (destColId) await admin.from('tasks').delete().eq('column_id', destColId)
  if (todoCol) await admin.from('tasks').delete().eq('column_id', todoCol)
  if (destColId) await admin.from('columns').delete().eq('id', destColId)
  if (destBoardId) await admin.from('boards').delete().eq('id', destBoardId)
  if (doneCol) await admin.from('columns').delete().eq('id', doneCol)
  if (todoCol) await admin.from('columns').delete().eq('id', todoCol)
  if (boardId) await admin.from('boards').delete().eq('id', boardId)
  if (userId) {
    await admin.from('task_notifications').delete().eq('recipient_id', userId)
    await admin.auth.admin.deleteUser(userId).catch(() => {})
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
