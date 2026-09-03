// Can a human actually reach the shared view engine? Dev sandbox only.
//
// scripts/check-views.mjs proves migrations 118 and 119 behave at the database. That is exactly
// the half this repo has repeatedly found insufficient: `board_members.role` was 9/9 green for
// weeks while no UI could set the role, `app_modules` had policies and seeded rows with no
// writer at all, and the recurrence columns had a prominent toggle wired to nothing for months.
// So this drives a real browser.
//
// It asserts the things a code review cannot see: that a saved view really round-trips through
// Postgres and survives a reload, that switching layout does not change the ANSWER, that the
// descendant scope really pulls a child board's work into its parent's view, and that an
// unfinished filter says so instead of silently narrowing nothing.
//
// Every database assertion polls (`until`) rather than sleeping. `click(); waitForTimeout();
// read()` is how check-recurrence-ui.mjs came to fail three different checks on three
// consecutive runs of identical code - a flaky assertion is worse than none, because it teaches
// you to re-run until green.
//
// Creates and tears down its own fixture. Run with the dev server up:
//   pnpm dev
//   pnpm check:views-ui

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
    await new Promise((r) => setTimeout(r, 500))
    last = await read()
  }
  return last
}

/**
 * Open a dropdown and click one of its items.
 *
 * ⚠️ Not `click(trigger); click(item)`. Radix returns focus to the trigger as the menu closes,
 * and a second open issued during that unmount is swallowed - so the menu is shut when the item
 * click goes out and the locator waits 30s for something that will never appear. Observed: the
 * first Options interaction passed and the very next one timed out on identical code. Reopen
 * until the item is really on screen.
 */
async function menuPick(page, triggerId, itemId, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    await page.click(triggerId)
    const item = page.locator(itemId)
    try {
      await item.waitFor({ state: 'visible', timeout: 4000 })
      await item.click()
      return true
    } catch {
      await page.keyboard.press('Escape').catch(() => {})
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

let browser, userId, parentBoard, childBoard, parentCol, childCol
let customFieldId = null
const taskIds = []
const email = `viewsui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []

/** Debris from a run that was killed before its own teardown - e.g. piped into `head`. */
async function sweepOldFixtures() {
  const { data: old } = await admin.from('boards').select('id, title').like('title', 'views-ui-%')
  const abandoned = (old ?? []).filter((b) => !b.title.endsWith(String(stamp)))
  for (const board of abandoned) {
    await admin.from('saved_views').delete().eq('board_id', board.id)
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
  await sweepOldFixtures()

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'Views Probe', role: 'super_admin', is_active: true },
    { onConflict: 'id' },
  )

  // A parent board and a child board. The child's work must appear in the parent's view ONLY
  // when the descendant scope says so - that is the Vikunja problem Prompt E names.
  const { data: parent } = await admin.from('boards')
    .insert({ title: `views-ui-parent-${stamp}`, created_by: userId }).select('id').single()
  parentBoard = parent.id
  const { data: child } = await admin.from('boards')
    .insert({ title: `views-ui-child-${stamp}`, created_by: userId, parent_board_id: parentBoard })
    .select('id').single()
  childBoard = child.id

  const { data: pCols } = await admin.from('columns').insert([
    { board_id: parentBoard, title: 'To Do', position: 0, status_key: 'to_do' },
    { board_id: parentBoard, title: 'Done', position: 1, status_key: 'done' },
  ]).select('id, status_key')
  parentCol = pCols.find((c) => c.status_key === 'to_do').id
  const parentDone = pCols.find((c) => c.status_key === 'done').id

  const { data: cCols } = await admin.from('columns')
    .insert([{ board_id: childBoard, title: 'To Do', position: 0, status_key: 'to_do' }])
    .select('id').single()
  childCol = cCols.id

  /**
   * ⚠️ `status` must AGREE with the target column's status_key. `enforce_task_lifecycle`
   * (private) reads tasks.status on INSERT - which defaults to 'to_do' - and, when it differs
   * from the column's, MOVES the row to whichever column on that board carries the requested
   * status. So seeding a "finished" task by column_id alone silently lands it in To Do, and
   * every status assertion downstream then tests the wrong fixture. Measured, not reasoned.
   */
  const seed = async (columnId, title, status, extra = {}) => {
    const { data, error } = await admin.from('tasks').insert({
      column_id: columnId, title: `${title} ${stamp}`, position: taskIds.length,
      created_by: userId, visibility: 'board', priority: 3, status, ...extra,
    }).select('id, column_id').single()
    if (error) throw new Error(`seed(${title}): ${error.message}`)
    if (data.column_id !== columnId) {
      throw new Error(`seed(${title}): the lifecycle trigger moved it out of the intended column`)
    }
    taskIds.push(data.id)
    return data.id
  }

  await seed(parentCol, 'Parent high', 'to_do', { priority: 1, due_date: '2126-09-01' })
  await seed(parentCol, 'Parent low', 'to_do', { priority: 5 })
  await seed(parentDone, 'Parent finished', 'done', { priority: 3 })
  await seed(childCol, 'Child work', 'to_do', { priority: 2 })

  // A `select` custom field, because its stored value is an option ID and its label is
  // somewhere else entirely. A column that prints the stored value shows `option_1`.
  const { data: fieldDef, error: fieldErr } = await admin.from('field_definitions').insert({
    key: `views_ui_stage_${stamp}`, name: `Stage ${stamp}`, field_type: 'select',
    config: { options: [{ id: 'option_1', label: `Awaiting survey ${stamp}` }] },
    scope: 'global', position: 0,
  }).select('id, key').single()
  if (fieldErr) throw new Error(`custom field fixture: ${fieldErr.message}`)
  customFieldId = fieldDef.id
  const { error: valueErr } = await admin.from('field_values')
    .insert({ task_id: taskIds[0], field_id: fieldDef.id, value: 'option_1' })
  if (valueErr) throw new Error(`custom field value fixture: ${valueErr.message}`)

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

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
  section('The route is reachable from the nav, not just by typing a URL')
  // =======================================================================================
  const navLink = page.locator('a[href="/views"]').first()
  check('a Views link exists in the shell nav', await navLink.count() > 0)

  await page.goto(`${BASE}/views`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#view-count', { timeout: 60000 })
  check('the Views page renders', await page.locator('h1', { hasText: 'Views' }).first().isVisible())

  const countText = async () => (await page.locator('#view-count').innerText().catch(() => '')) || ''
  const shownCount = async () => {
    const text = await countText()
    const match = text.match(/^(\d+)\s+shown/)
    return match ? Number(match[1]) : -1
  }

  const initial = await until(shownCount, (n) => n > 0)
  check('it shows work without any filter set', initial > 0, `count text: ${await countText()}`)

  // =======================================================================================
  section('Descendant scope - the Vikunja problem')
  // =======================================================================================
  // Scope to the PARENT board only. The child's task must be absent.
  await page.click('#view-scope')
  await page.getByRole('menuitemcheckbox', { name: new RegExp(`views-ui-parent-${stamp}`) }).click()
  await page.keyboard.press('Escape')

  const parentOnly = await until(shownCount, (n) => n === 3)
  check('scoping to one board narrows to its own work', parentOnly === 3, `got ${parentOnly}`)

  const childVisible = async () =>
    (await page.getByText(`Child work ${stamp}`).count()) > 0
  check('the child board\'s work is NOT in a "this board only" view', !(await childVisible()))

  // Now switch descendant scope to "everything beneath it". The child's task must appear -
  // with no filter edited, no board list maintained.
  await page.click('#view-descendants')
  await page.getByRole('option', { name: /everything beneath/i }).click()

  const withDescendants = await until(shownCount, (n) => n === 4)
  check('"everything beneath it" pulls the child board\'s work in', withDescendants === 4, `got ${withDescendants}`)
  check('and the child task is really on screen', await until(childVisible, (v) => v === true, 8000))

  // "Direct children" must reach one generation. Same tree, one level, so it matches here.
  await page.click('#view-descendants')
  await page.getByRole('option', { name: /direct children/i }).click()
  const direct = await until(shownCount, (n) => n === 4)
  check('"direct children" reaches the immediate child', direct === 4, `got ${direct}`)

  await page.click('#view-descendants')
  await page.getByRole('option', { name: /this board only/i }).click()
  const backToOne = await until(shownCount, (n) => n === 3)
  check('and switching back to "this board only" excludes it again', backToOne === 3, `got ${backToOne}`)

  // =======================================================================================
  section('Filters - visible, explained, and actually applied')
  // =======================================================================================
  await page.click('#view-filters')
  await page.waitForSelector('#filter-add', { timeout: 15000 })
  await page.click('#filter-add')

  const conditionField = page.locator('[id^="filter-field-"]').first()
  await conditionField.waitFor({ timeout: 15000 })

  // A brand-new condition has no value yet. It must NOT silently narrow, and it must say so.
  const stillThree = await until(shownCount, (n) => n === 3, 8000)
  check('an unfinished condition does not filter anything out', stillThree === 3, `got ${stillThree}`)
  check(
    'and the screen says it is not filtering yet',
    (await page.getByText(/not filtering yet/i).count()) > 0,
  )

  // Point it at priority, choose "is", value 1.
  await conditionField.click()
  await page.getByRole('option', { name: 'Priority', exact: true }).click()

  const valuePicker = page.locator('[id^="filter-value-"]').first()
  await valuePicker.waitFor({ timeout: 15000 })
  await valuePicker.locator('button[role="combobox"]').click()
  await page.getByRole('option', { name: '1 - Highest' }).click()

  const filtered = await until(shownCount, (n) => n === 1)
  check('a completed condition really filters', filtered === 1, `got ${filtered}`)

  const hiddenText = await countText()
  check('it reports how many rows the filter hid', /hidden by filters/.test(hiddenText), hiddenText)

  // Collapse the builder: the active filter must be visible as a chip carrying its VALUE.
  await page.click('#view-filters')
  const chip = page.getByText(/Priority is 1/i).first()
  check('the active filter shows as a chip naming the field and its value', await chip.count() > 0)

  // =======================================================================================
  section('Saving a view really round-trips through Postgres')
  // =======================================================================================
  const viewName = `Probe view ${stamp}`
  await page.click('#saved-view-save-as')
  await page.waitForSelector('#saved-view-name', { timeout: 15000 })
  await page.fill('#saved-view-name', viewName)
  await page.click('#saved-view-confirm')

  const savedRow = await until(
    async () => {
      const { data } = await admin.from('saved_views').select('id, name, scope, config').eq('name', viewName).maybeSingle()
      return data
    },
    (row) => Boolean(row),
  )
  check('the view exists in the database', Boolean(savedRow), 'no row found')
  check('it saved as personal by default', savedRow?.scope === 'personal')
  check('the filter was saved with it', savedRow?.config?.filters?.length === 1, JSON.stringify(savedRow?.config?.filters))
  check('the layout was saved with it', Boolean(savedRow?.config?.layout))

  // The search box is deliberately NOT part of a saved view.
  check('the search box was not stored', savedRow?.config?.search === undefined)

  // Reload: the view must still be offered and must restore what it stored.
  await page.goto(`${BASE}/views`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#saved-view-picker', { timeout: 60000 })
  await page.click('#saved-view-picker')
  const offered = page.getByRole('menuitem', { name: new RegExp(viewName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
  // Poll: the picker's list arrives from an async load, so reading the count once right after
  // opening the menu tests how fast the round trip was, not whether the view is offered.
  const offeredCount = await until(async () => offered.count(), (n) => n > 0, 15000)
  check('the saved view is offered after a reload', offeredCount > 0)
  await offered.first().click()

  const restored = await until(shownCount, (n) => n === 1)
  check('opening it restores the filtered result', restored === 1, `got ${restored}`)
  check(
    'and its filter chip comes back too',
    (await until(async () => page.getByText(/Priority is 1/i).count(), (n) => n > 0, 10000)) > 0,
  )

  // =======================================================================================
  section('The view is not the data - every layout gives the same answer')
  // =======================================================================================
  const answers = {}
  for (const layout of ['list', 'table', 'kanban']) {
    await page.click(`#layout-${layout}`)
    answers[layout] = await until(shownCount, (n) => n >= 0, 10000)
  }
  check(
    'switching layout does not change how many tasks match',
    answers.list === 1 && answers.table === 1 && answers.kanban === 1,
    JSON.stringify(answers),
  )

  await page.click('#layout-table')
  await page.waitForSelector('table', { timeout: 15000 })
  check('the table layout renders a real table', await page.locator('table thead th').count() > 0)
  check('the title column is present', (await page.locator('thead th', { hasText: 'Title' }).count()) > 0)

  await page.click('#layout-calendar')
  await page.waitForSelector('#calendar-today', { timeout: 15000 })
  check('the calendar layout offers month, week and day', await page.locator('#calendar-range-day').count() > 0)
  check('the calendar has an unscheduled tray', (await page.getByText('Unscheduled').count()) > 0)

  await page.click('#layout-list')

  // =======================================================================================
  section('Grouping and completed-work handling')
  // =======================================================================================
  // Clear the filter first so grouping has something to group.
  await page.click('#view-filters')
  await page.locator('button[aria-label^="Remove condition"]').first().click()
  await page.click('#view-filters')
  await until(shownCount, (n) => n === 3)

  await page.click('#view-group')
  await page.getByRole('option', { name: /Group by status$/i }).click()
  const groupHeadings = await until(
    // Scoped to <main>: the app shell has its own <section> elements with aria-expanded
    // buttons, and counting those would make this pass for the wrong reason.
    async () => page.locator('main section button[aria-expanded]').count(),
    (n) => n >= 2,
  )
  check('grouping by status produces more than one group', groupHeadings >= 2, `got ${groupHeadings}`)

  check('the Options menu opens and offers "hide completed"', await menuPick(page, '#view-options', '#completed-hide'))
  const openOnly = await until(shownCount, (n) => n === 2)
  check('hiding completed work drops the finished task', openOnly === 2, `got ${openOnly}`)

  check('and reopening it offers "completed only"', await menuPick(page, '#view-options', '#completed-only'))
  const doneOnly = await until(shownCount, (n) => n === 1)
  check('"completed only" shows just the finished task', doneOnly === 1, `got ${doneOnly}`)

  await menuPick(page, '#view-options', '#completed-show')
  await until(shownCount, (n) => n === 3)

  // =======================================================================================
  section('Editing through a view writes to the database')
  // =======================================================================================
  await page.click('#layout-table')
  await page.waitForSelector('table', { timeout: 15000 })

  const renameTarget = taskIds[1]
  const newTitle = `Renamed inline ${stamp}`
  const editButton = page.locator(`button[aria-label^="Rename Parent low ${stamp}"]`).first()
  if (await editButton.count() > 0) {
    await editButton.click({ force: true })
    // Not `table input`: the header's select-all checkbox is the first input in the table.
    const input = page.locator('table input[type="text"], table input:not([type])').first()
    await input.waitFor({ timeout: 10000 })
    await input.fill(newTitle)
    await input.press('Enter')

    const renamed = await until(
      async () => {
        const { data } = await admin.from('tasks').select('title').eq('id', renameTarget).maybeSingle()
        return data?.title
      },
      (title) => title === newTitle,
    )
    check('an inline rename in the table lands in the database', renamed === newTitle, `got "${renamed}"`)
  } else {
    check('an inline rename in the table lands in the database', false, 'no rename control found')
  }

  // =======================================================================================
  section('Deleting a view is not a permission grant and touches no work')
  // =======================================================================================
  const tasksBefore = await admin.from('tasks').select('id', { count: 'exact', head: true }).in('id', taskIds)

  page.once('dialog', (d) => d.accept())
  await page.click('#saved-view-delete')

  const viewGone = await until(
    async () => {
      const { data } = await admin.from('saved_views').select('id').eq('name', viewName)
      return data?.length ?? -1
    },
    (n) => n === 0,
  )
  check('deleting a view removes it from the database', viewGone === 0)

  const tasksAfter = await admin.from('tasks').select('id', { count: 'exact', head: true }).in('id', taskIds)
  check('and no task was touched', tasksBefore.count === tasksAfter.count)

  // =======================================================================================
  section('An admin can actually set a parent board')
  // =======================================================================================
  // The whole hierarchy feature is unreachable without this control - the defect this repo
  // keeps finding (board_members.role, app_modules, the recurrence toggle).
  await page.goto(`${BASE}/admin?tab=boards`, { waitUntil: 'domcontentloaded' })
  const createButton = page.getByRole('button', { name: /new board|create board|add board/i }).first()
  // Poll rather than reading once: waitForSelector('body') returns on server-rendered HTML,
  // long before the boards tab has rendered its controls.
  const hasCreate = await until(async () => createButton.count(), (n) => n > 0, 30000)
  if (hasCreate > 0) {
    await createButton.click()
    const parentPicker = page.locator('#parent-board')
    await parentPicker.waitFor({ timeout: 15000 })
    check('the create-board dialog offers a parent board picker', await parentPicker.isVisible())
    await parentPicker.click()
    check(
      'the picker lists existing boards as candidate parents',
      (await page.getByRole('option', { name: new RegExp(`views-ui-parent-${stamp}`) }).count()) > 0,
    )
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  } else {
    check('the create-board dialog offers a parent board picker', false, 'no create button found')
    check('the picker lists existing boards as candidate parents', false, 'no create button found')
  }

  // =======================================================================================
  section('A custom field column shows what it means, not the id it stores')
  // =======================================================================================
  // formatFieldValue existed for this and had no call site, so FieldCell fell back to
  // String(value): a select rendered `option_1`, a person a raw uuid, a checkbox `true`.
  // The unit tests pin FieldCell given a populated context; only a real browser proves the
  // workspace actually SEEDS that context, which is the half that was broken.
  await page.goto(`${BASE}/views`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#view-fields', { timeout: 60000 })
  // Table, because a column is the plainest place to see a formatted value.
  await page.click('#layout-table')
  await page.waitForSelector('table thead th', { timeout: 20000 })

  const picked = await menuPick(
    page, '#view-fields', `[role="menuitem"]:has-text("Stage ${stamp}")`,
  )
  check('the fields menu offers the custom field as a column', picked,
    'a field an admin created was not offerable as a column')

  const labelShown = await until(
    async () => page.getByText(`Awaiting survey ${stamp}`).count(),
    (n) => n > 0,
    20000,
  )
  check('a select field renders its option label', labelShown > 0,
    'the column printed the stored value instead of resolving it')
  check(
    'and never the option id it stores',
    (await page.getByText('option_1', { exact: true }).count()) === 0,
  )

  // =======================================================================================
  section('No console errors')
  // =======================================================================================
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|Download the React DevTools|hydrat.*extension/i.test(e),
  )
  check('zero console errors across the whole run', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} catch (error) {
  check('the harness ran to completion', false, error?.message ?? String(error))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (userId) await admin.from('saved_views').delete().eq('owner_id', userId)
  for (const board of [childBoard, parentBoard]) {
    if (!board) continue
    await admin.from('saved_views').delete().eq('board_id', board)
  }
  if (customFieldId) {
    await admin.from('field_values').delete().eq('field_id', customFieldId)
    await admin.from('field_definitions').delete().eq('id', customFieldId)
  }
  if (taskIds.length) await admin.from('tasks').delete().in('id', taskIds)
  for (const board of [childBoard, parentBoard]) {
    if (!board) continue
    await admin.from('columns').delete().eq('board_id', board)
    await admin.from('boards').delete().eq('id', board)
  }
  if (userId) {
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId).catch(() => {})
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
