// Metrics reports harness. Dev sandbox only, own fixtures, torn down.
//
// Bobby's Super Admin list, item (4): "we need to create metrics reports for things such as:
// a. entry date to close date. b. entry date to progression on each status to close.
// c. personelle reports."
//
// (a) and (c) already existed. (b) existed only in its AVERAGED form - "In Progress takes 3d on
// average across every task" - which is a different question from the one the sentence asks:
// where did THIS piece of work sit on its way through. This pins both readings, and it pins
// them against a task whose history is built here so the expected numbers are known exactly
// rather than read off whatever happens to be in the sandbox.
//
// The status history is written by 074's lifecycle trigger and by nothing else, so the fixture
// moves a task between columns the way a person would and lets the database record it.
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url)) throw new Error(`refusing to run against ${url}`)

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

let browser, su, board
const TASK_TITLE = `ZZ Journey ${stamp}`
try {
  const email = `bs-met-${stamp}@goatlasgo.us`
  const password = `Probe!${stamp}aA`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  su = { id: data.user.id, email, password }
  await admin.from('profiles').upsert({ id: su.id, email, full_name: 'BS Metrics', role: 'super_admin', is_active: true })

  const { data: statuses } = await admin.from('task_statuses').select('key, label').eq('is_archived', false).order('position')
  const { data: b, error: be } = await admin.from('boards').insert({ title: `ZZ Metrics ${stamp}`, created_by: su.id }).select().single()
  if (be) throw be
  board = b
  const { data: cols, error: ce } = await admin.from('columns')
    .insert(statuses.map((s, i) => ({ board_id: b.id, title: s.label, status_key: s.key, position: i })))
    .select()
  if (ce) throw ce
  const colFor = (key) => cols.find((c) => c.status_key === key)

  // Create in To Do, then walk it through the board. Each move fires 074's trigger, which is
  // the sole writer of status history.
  const { data: task, error: te } = await admin.from('tasks').insert({
    title: TASK_TITLE, column_id: colFor('to_do').id, status: 'to_do',
    created_by: su.id, position: 0, priority: 2,
  }).select().single()
  if (te) throw te

  const moveTo = async (key) => {
    const { error } = await admin.from('tasks')
      .update({ column_id: colFor(key).id, status: key }).eq('id', task.id)
    if (error) throw error
    // Distinct timestamps, or two events share an instant and no stage has a duration.
    await new Promise((r) => setTimeout(r, 1200))
  }
  await moveTo('in_progress')
  await moveTo('done')

  const { data: history } = await admin.from('task_activity')
    .select('event_type, from_value, to_value').eq('task_id', task.id).not('event_type', 'is', null)
    .order('created_at')
  check('the database recorded the task walking through each status',
    (history ?? []).length >= 2,
    (history ?? []).map((h) => `${h.from_value}->${h.to_value}`).join(', '))

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 })

  await page.goto(`${BASE}/admin?tab=reports`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const metricsTab = page.getByRole('tab', { name: /^Metrics$/ })
  check('Metrics is reachable from Reports', await metricsTab.count() === 1)
  await metricsTab.click()
  await page.waitForTimeout(5000)

  const text = await page.locator('body').innerText()
  check('metrics finished computing', !text.includes('Computing metrics'))

  // (a) entry date to close date
  check('(a) entry to close is reported', text.includes('Avg entry → close') && text.includes('Median entry → close'))
  check('(a) a per-task entry/close table is reported', text.includes('Recently completed: entry to close'))

  // (b) progression through each status, both readings
  check('(b) average time in each status is reported', text.includes('Average time in each status'))
  check('(b) per-task progression is reported', text.includes('Where the time went, task by task'))

  // Scoped to the journey card itself. Checking the whole page for the title would also match
  // the entry-to-close table below it, which proves nothing about the stage breakdown.
  // data-slot="card" is the Card root; filtering plain divs matched the CardHeader, whose text
  // is only the title, so every assertion about the card's contents failed for the wrong reason.
  const journeyCard = page.locator('[data-slot="card"]').filter({
    hasText: 'Where the time went, task by task',
  }).first()
  const journeyText = await journeyCard.innerText()
  check('(b) the fixture task appears inside the journey card',
    journeyText.includes(TASK_TITLE), journeyText.slice(0, 140).replace(/\n+/g, ' | '))
  check('(b) its journey names each status it passed through',
    journeyText.includes('To Do') && journeyText.includes('In Progress'),
    journeyText.slice(0, 200).replace(/\n+/g, ' | '))
  const segments = await journeyCard.locator('div[title*=":"]').count()
  check('(b) the journey is drawn as proportional segments, one per stage',
    segments >= 2, `${segments} segments`)

  // (c) personnel
  check('(c) personnel reporting is present', text.includes('Personnel'))

  // Honesty about coverage: the numbers must say what they are built on.
  check('the report says how much of the data it could actually measure',
    text.includes('Timing data coverage') && /Recorded close events cover \d+ of \d+/.test(text))

  const stageChips = await page.locator('span', { hasText: /·\s*\d+[smhd]/ }).count()
  check('stage durations are labelled, not just drawn', stageChips > 0, `${stageChips} labelled stages`)

  check('no console errors on the metrics tab', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))
  if (process.env.METRICS_SHOT) await page.screenshot({ path: process.env.METRICS_SHOT, fullPage: true })
} finally {
  if (browser) await browser.close()
  if (board) await admin.from('boards').delete().eq('id', board.id)
  if (su) await admin.auth.admin.deleteUser(su.id)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
  process.exit(1)
}
