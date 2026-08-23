// Can a human actually reach the work-item domain? Dev sandbox only.
//
// scripts/check-work-items.mjs proves migrations 112-115 behave at the database. That is
// exactly the half this repo has repeatedly found insufficient: `board_members.role` was
// 9/9 green for weeks while no UI could set the role, and `app_modules` had policies, grants
// and seeded rows with no writer at all. So this drives a real browser through the screens:
// the type registry, the field builder, filling a field in on a work item, and relating two
// work items to each other.
//
// Creates and tears down its own super-admin fixture. Run with the dev server up:
//   pnpm dev
//   node --env-file=.env.local scripts/check-work-items-ui.mjs

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url ?? '')) throw new Error(`refusing to run against ${url}`)

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}

let browser, userId, boardId, columnId, taskA, taskB, statusKey
const fieldKey = `uiprobe${stamp}`
const email = `wiui-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`
const consoleErrors = []
const createdTaskIds = []

try {
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (userErr) throw new Error(`createUser: ${userErr.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert(
    { id: userId, email, full_name: 'WI Probe', role: 'super_admin', is_active: true },
    { onConflict: 'id' },
  )

  const { data: board } = await admin.from('boards')
    .insert({ title: `wi-ui-${stamp}`, created_by: userId, is_private: false }).select('id').single()
  boardId = board.id
  const { data: column } = await admin.from('columns')
    .insert({ board_id: boardId, title: 'To Do', position: 0, status_key: 'to_do' }).select('id').single()
  columnId = column.id
  const { data: a } = await admin.from('tasks').insert({
    column_id: columnId, title: `Probe item A ${stamp}`, position: 0,
    created_by: userId, visibility: 'board',
  }).select('id').single()
  taskA = a.id
  const { data: b } = await admin.from('tasks').insert({
    column_id: columnId, title: `Probe item B ${stamp}`, position: 1,
    created_by: userId, visibility: 'board',
  }).select('id').single()
  taskB = b.id

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  // ⚠️ Sign-in is retried once with a generous timeout, and that is not superstition: run
  // straight after another browser harness, the dev server is still compiling routes and the
  // post-login navigation can take well over the 30s Playwright defaults to. Observed twice -
  // this harness passed alone and failed in a batch, at exactly this step. Warming /login
  // first and allowing one retry makes the run mean what it says.
  const signIn = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 60000 })
  }
  try {
    await signIn()
  } catch {
    console.log('  ..  first sign-in attempt timed out (dev server warming up); retrying once')
    await signIn()
  }

  // -------------------------------------------------------------------------------------
  // Work item types
  // -------------------------------------------------------------------------------------
  await page.goto(`${BASE}/admin/super-admin`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Types' }).click()
  await page.waitForTimeout(1500)

  const typesHeading = await page.getByText('Work Item Types').first().isVisible().catch(() => false)
  check('the Types tab renders', typesHeading)

  // All eleven seeded types must be reachable, including the nine that are switched off -
  // a screen that only listed the active ones could never switch a new one on.
  for (const name of ['Task', 'Subtask', 'Bug', 'Change Request']) {
    const seen = await page.getByText(name, { exact: true }).first().isVisible().catch(() => false)
    check(`the "${name}" type is on screen`, seen)
  }

  const builtIn = await page.getByText('Built in').first().isVisible().catch(() => false)
  check('system types are marked as built in', builtIn)

  const taskToggle = page.getByRole('button', { name: 'Switch off Task' })
  check('the built-in Task type cannot be switched off from the UI',
    await taskToggle.isDisabled().catch(() => false))

  const bugOn = page.getByRole('button', { name: 'Switch on Bug' })
  await bugOn.click()
  await page.waitForTimeout(1500)
  const { data: bugRow } = await admin.from('work_item_types').select('is_active').eq('key', 'bug').single()
  check('switching a type on really writes to the database', bugRow?.is_active === true)
  // Put it back: this is a shared sandbox and `bug` is seeded off.
  await admin.from('work_item_types').update({ is_active: false }).eq('key', 'bug')

  // -------------------------------------------------------------------------------------
  // Status categories (112). The category is what stops the app guessing a status's meaning
  // from its name - so a super admin has to be able to SET it, or every status added from
  // now on silently takes the default.
  // -------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Statuses' }).click()
  await page.waitForTimeout(1200)

  check('the status screen offers a "Means" picker',
    await page.locator('#new-status-category').isVisible().catch(() => false))
  check('existing statuses show what they mean',
    await page.getByText('Started', { exact: true }).first().isVisible().catch(() => false))

  await page.fill('#new-status-label', `UI Review ${stamp}`)
  await page.locator('#new-status-category').click()
  await page.waitForTimeout(400)
  await page.getByRole('option', { name: /^Started/ }).click()
  await page.getByRole('button', { name: 'Add Status' }).click()
  await page.waitForTimeout(2000)

  const { data: newStatus } = await admin.from('task_statuses')
    .select('key, category, is_closed').eq('key', `ui_review_${stamp}`).maybeSingle()
  statusKey = newStatus?.key ?? null
  check('a status created in the UI stores the category that was chosen',
    newStatus?.category === 'started', JSON.stringify(newStatus))
  check('is_closed is derived from that category, not stored independently',
    newStatus?.is_closed === false)

  // -------------------------------------------------------------------------------------
  // Custom field definition
  // -------------------------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Fields' }).click()
  await page.waitForTimeout(1200)
  check('the Fields tab renders',
    await page.getByText('Custom Fields').first().isVisible().catch(() => false))

  await page.fill('#new-field-name', `Ui Probe ${stamp}`)
  await page.getByRole('button', { name: 'Add Field' }).click()
  await page.waitForTimeout(2000)

  const { data: definition } = await admin.from('field_definitions')
    .select('id, key, field_type').ilike('key', `ui_probe_${stamp}`).maybeSingle()
  check('a super admin can define a field from the UI', Boolean(definition),
    'no field_definitions row was created')

  // -------------------------------------------------------------------------------------
  // Filling the field in on a work item
  // -------------------------------------------------------------------------------------
  await page.goto(`${BASE}/admin/board/${boardId}?task=${taskA}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  check('the work item opens with a Details section for its custom fields',
    await page.getByRole('heading', { name: 'Details' }).first().isVisible().catch(() => false))

  if (definition) {
    const input = page.locator(`#field-${definition.id}`)
    check('the custom field renders a control on the work item',
      await input.isVisible().catch(() => false))
    await input.fill('typed in the browser')
    // Commits on blur, deliberately - see the component header. Blur with Tab, NOT by
    // clicking the page background: the modal is a Radix dialog and a background click lands
    // on its overlay, which dismisses it. That cost a confusing pair of failures the first
    // time this ran - the value never saved and the Relations panel "disappeared", because
    // the whole modal had closed.
    await input.press('Tab')
    await page.waitForTimeout(2500)

    const { data: stored } = await admin.from('field_values')
      .select('value').eq('task_id', taskA).eq('field_id', definition.id).maybeSingle()
    check('typing in the field stores the value against this work item',
      stored?.value === 'typed in the browser', JSON.stringify(stored))
  }

  // -------------------------------------------------------------------------------------
  // Relations
  // -------------------------------------------------------------------------------------
  check('the work item shows a Relations section',
    await page.getByRole('heading', { name: 'Relations' }).first().isVisible().catch(() => false))

  await page.getByRole('button', { name: 'Add relation' }).click()
  await page.waitForTimeout(600)
  await page.fill('#relation-search', `Probe item B ${stamp}`)
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: `Probe item B ${stamp}` }).first().click()
  await page.waitForTimeout(2000)

  const { data: relations } = await admin.from('task_relations')
    .select('source_task_id, target_task_id, relation_type')
    .or(`source_task_id.eq.${taskA},target_task_id.eq.${taskA}`)
  check('adding a "blocked by" relation stores one row', relations?.length === 1,
    JSON.stringify(relations))
  check('the default "blocked by" is stored as B blocks A, not as a second relation type',
    relations?.[0]?.relation_type === 'blocks'
      && relations?.[0]?.source_task_id === taskB
      && relations?.[0]?.target_task_id === taskA,
    JSON.stringify(relations?.[0]))

  // ⚠️ Re-navigate to the deep link; do NOT page.reload(). board-view.tsx opens the modal from
  // `?task=` and then `router.replace`s the param away, so a reload lands on a board with no
  // modal at all - which made the two blocker checks below meaningless the first time this
  // ran: one failed and the other "passed" because the banner was not on screen either way.
  const openTaskA = async () => {
    await page.goto(`${BASE}/admin/board/${boardId}?task=${taskA}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    // Assert the panel is actually rendered before asserting anything about its contents, so
    // an absent banner can never be confused with an absent modal.
    return page.getByRole('heading', { name: 'Relations' }).first().isVisible().catch(() => false)
  }

  // The blocker is open, so the panel must say so rather than merely listing it.
  check('the relations panel is on screen before checking the blocker banner', await openTaskA())
  check('an open blocker is called out on the work item',
    await page.getByText(/Blocked by 1 open work item/).first().isVisible().catch(() => false))

  // Closing the blocker must clear the warning - that is the status CATEGORY doing the work.
  const { data: doneColumn } = await admin.from('columns')
    .insert({ board_id: boardId, title: 'Completed', position: 1, status_key: 'done' })
    .select('id').single()
  await admin.from('tasks').update({ column_id: doneColumn.id, status: 'done' }).eq('id', taskB)
  check('the relations panel is still on screen after the blocker was completed', await openTaskA())
  check('a completed blocker stops being reported as blocking',
    !(await page.getByText(/Blocked by 1 open work item/).first().isVisible().catch(() => false)))
  // ...and the relation itself is still listed, just no longer reported as in the way.
  check('the completed blocker is still listed under "Blocked by"',
    await page.getByText('Blocked by', { exact: true }).first().isVisible().catch(() => false))

  // -------------------------------------------------------------------------------------
  // The type picker: absent with one type, present with two. Without this the Types tab is a
  // toggle that changes nothing anyone can see, which is the defect the tab exists to end.
  // -------------------------------------------------------------------------------------
  // The board's add-task control is an icon button labelled per column (board-view.tsx).
  // Opening the dialog is asserted separately from what is inside it: an unopened dialog has
  // no #work-item-type either, and reporting that as "the picker is correctly hidden" is the
  // vacuous pass this file already fell for once.
  //
  // ⚠️ The board renders MORE THAN ONE control with the accessible name "Add task to To Do"
  // (measured: two, both reporting visible), and clicking the first silently does nothing.
  // So try each candidate until the dialog actually appears rather than trusting `.first()`.
  // The app is fine - a click on the real "+" opens it immediately; this is only about
  // reaching the right node.
  const openCreateDialog = async () => {
    await page.goto(`${BASE}/admin/board/${boardId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const candidates = page.getByRole('button', { name: 'Add task to To Do' })
    for (let i = 0; i < await candidates.count(); i++) {
      await candidates.nth(i).click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(1200)
      if (await page.locator('#title').isVisible().catch(() => false)) return true
    }
    return false
  }

  check('the create dialog opens', await openCreateDialog())
  check('with one active type the create dialog asks no question about it',
    !(await page.locator('#work-item-type').isVisible().catch(() => false)))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  await admin.from('work_item_types').update({ is_active: true }).eq('key', 'bug')
  check('the create dialog re-opens with a second type active', await openCreateDialog())
  check('switching a type on makes it choosable when creating work',
    await page.locator('#work-item-type').isVisible().catch(() => false))

  await page.fill('#title', `Typed bug ${stamp}`)
  const pick = async (trigger, option) => {
    await page.locator(trigger).click()
    await page.waitForTimeout(400)
    await page.getByRole('option', { name: option, exact: true }).click()
    await page.waitForTimeout(300)
  }
  await pick('#work-item-type', 'Bug')
  await pick('#status', 'To Do')
  // Priority is required and deliberately has no default ("must be explicitly chosen, not
  // silently defaulted"), so the submit button stays disabled until it is set.
  await pick('#priority', '3 - Medium')
  await page.getByRole('button', { name: /^Create Task$/i }).click()
  await page.waitForTimeout(3000)

  const { data: bugTask } = await admin.from('tasks')
    .select('id, type_key').eq('title', `Typed bug ${stamp}`).maybeSingle()
  if (bugTask?.id) createdTaskIds.push(bugTask.id)
  check('the chosen type is stored on the new work item', bugTask?.type_key === 'bug',
    JSON.stringify(bugTask))

  check('no console errors on the work item screen',
    consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  console.error(`\nHARNESS ERROR: ${err.message}`)
  if (consoleErrors.length) console.error(`browser console: ${consoleErrors.slice(0, 5).join(' | ')}`)
  failures++
} finally {
  if (browser) await browser.close()
  await admin.from('field_definitions').delete().ilike('key', `ui_probe_${stamp}`)
  await admin.from('field_definitions').delete().eq('key', fieldKey)
  for (const id of [...createdTaskIds, taskA, taskB]) if (id) await admin.from('tasks').delete().eq('id', id)
  if (boardId) await admin.from('columns').delete().eq('board_id', boardId)
  if (boardId) await admin.from('boards').delete().eq('id', boardId)
  if (statusKey) await admin.from('task_statuses').delete().eq('key', statusKey)
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {})
  await admin.from('work_item_types').update({ is_active: false }).eq('key', 'bug')
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
