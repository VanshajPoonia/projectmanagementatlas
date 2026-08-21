// Realtime dictation harness. Dev sandbox only, own fixtures, torn down.
//
// Bobby reported the mic as "isn't doing realtime dictation as we talk". The cause was
// `interimResults = false` plus an onresult handler that kept only finalized results, so the
// field stayed empty until the engine decided a phrase was over - seconds of nothing while
// you speak. Turning interim results on is not enough on its own: an interim result is a
// GUESS that the engine re-sends and revises, so the old `onTranscript` contract (append the
// chunk) would have written the same half-heard phrase into the field once per event.
//
// The real speech engine is not available or deterministic in a headless browser, so this
// injects a fake one and drives it with the exact event shape the Web Speech API emits:
// a `results` list of `{ isFinal, [0].transcript }` plus the `resultIndex` marking where this
// event's news starts. What is under test is the component's handling of that shape, which is
// where the bug was.
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

// A stand-in for the browser's speech engine, installed before any app code runs.
const FAKE_ENGINE = `
  window.__speech = { started: 0, stopped: 0, opts: null }
  class FakeRecognition {
    constructor() { window.__speech.rec = this }
    start() { window.__speech.started++; window.__speech.opts = {
      continuous: this.continuous, interimResults: this.interimResults, lang: this.lang } }
    stop() { window.__speech.stopped++; this.onend && this.onend() }
  }
  // Headless Chromium defines BOTH names natively, and the component prefers SpeechRecognition,
  // so overriding only the webkit alias leaves the real (unavailable) engine in charge.
  window.SpeechRecognition = FakeRecognition
  window.webkitSpeechRecognition = FakeRecognition
  // chunks: [{ text, final }]. resultIndex is where this event's news begins.
  window.__say = (chunks, resultIndex = 0) => {
    const list = chunks.map(c => ({ isFinal: !!c.final, 0: { transcript: c.text }, length: 1 }))
    window.__speech.rec.onresult({ results: list, resultIndex })
  }
`

let browser, su, board
try {
  const email = `bs-dict-${stamp}@goatlasgo.us`
  const password = `Probe!${stamp}aA`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  su = { id: data.user.id, email, password }
  await admin.from('profiles').upsert({ id: su.id, email, full_name: 'BS Dictation', role: 'super_admin', is_active: true })

  const { data: statuses } = await admin.from('task_statuses').select('key, label').eq('is_archived', false).order('position')
  const { data: b, error: be } = await admin.from('boards').insert({ title: `ZZ Dictation ${stamp}`, created_by: su.id }).select().single()
  if (be) throw be
  board = b
  const { error: ce } = await admin.from('columns').insert(
    statuses.map((s, i) => ({ board_id: b.id, title: s.label, status_key: s.key, position: i })),
  )
  if (ce) throw ce

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(FAKE_ENGINE)
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 })

  await page.goto(`${BASE}/admin/board/${b.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // Open the create-task dialog, which carries the mic next to its description field.
  // Target the "+" by its exact aria-label. A regex match on the accessible name resolved to
  // the column's overflow menu instead, which opened the menu and no dialog.
  const addBtn = page.locator('button[aria-label="Add task to To Do"]').first()
  await addBtn.waitFor({ state: 'visible', timeout: 15000 })
  await addBtn.click()
  await page.waitForTimeout(1500)
  const description = page.locator('#description')
  if (await description.count() === 0) {
    await page.screenshot({ path: 'dictation-debug.png', fullPage: true })
    const dialogs = await page.locator('[role=dialog]').allInnerTexts()
    const areas = await page.locator('textarea').evaluateAll(els => els.map(e => e.id || e.name || e.placeholder))
    throw new Error(`no #description. dialogs=${JSON.stringify(dialogs).slice(0,300)} textareas=${JSON.stringify(areas)}`)
  }
  await description.waitFor({ state: 'visible', timeout: 15000 })

  // aria-pressed is on the mic and nothing else in this dialog. Its LABEL flips to "Stop
  // dictation" while listening, so a name-based locator stops matching after the first click.
  const mic = page.locator('[role=dialog] button[aria-pressed]').first()
  check('the mic button is on the create-task dialog',
    await page.locator('[role=dialog] button[aria-label="Dictate description"]').count() > 0)

  await mic.click()
  await page.waitForTimeout(200)

  const opts = await page.evaluate(() => window.__speech.opts)
  check('dictation asks the engine for interim results', opts?.interimResults === true,
    `interimResults=${opts?.interimResults}`)
  check('dictation keeps listening across phrases', opts?.continuous === true)
  check('the button reports itself as listening', await mic.getAttribute('aria-pressed') === 'true')

  // ── words appear while still being spoken ─────────────────────────────────
  await page.evaluate(() => window.__say([{ text: 'we should', final: false }]))
  await page.waitForTimeout(120)
  check('an interim phrase reaches the field before it is finalized',
    (await description.inputValue()) === 'we should', `got "${await description.inputValue()}"`)

  // ── the engine revising its guess replaces, never appends ─────────────────
  await page.evaluate(() => window.__say([{ text: 'we should call', final: false }]))
  await page.evaluate(() => window.__say([{ text: 'we should call Bobby', final: false }]))
  await page.waitForTimeout(120)
  const revised = await description.inputValue()
  check('a revised guess replaces the previous one rather than stacking',
    revised === 'we should call Bobby', `got "${revised}"`)

  // ── finalizing keeps the phrase, and the next phrase follows it ───────────
  await page.evaluate(() => window.__say([{ text: 'we should call Bobby', final: true }]))
  await page.evaluate(() => window.__say([
    { text: 'we should call Bobby', final: true },
    { text: 'tomorrow', final: false },
  ], 1))
  await page.waitForTimeout(120)
  const running = await description.inputValue()
  check('a finalized phrase is kept and the next guess follows it',
    running === 'we should call Bobby tomorrow', `got "${running}"`)

  await page.evaluate(() => window.__say([
    { text: 'we should call Bobby', final: true },
    { text: 'tomorrow morning', final: true },
  ], 1))
  await page.waitForTimeout(120)
  check('two finalized phrases both survive',
    (await description.inputValue()) === 'we should call Bobby tomorrow morning',
    `got "${await description.inputValue()}"`)

  // ── stopping settles the field and does not lose anything ────────────────
  await mic.click()
  await page.waitForTimeout(250)
  const settled = await description.inputValue()
  check('stopping keeps every word that was spoken',
    settled === 'we should call Bobby tomorrow morning', `got "${settled}"`)
  check('the button reports itself as no longer listening',
    await mic.getAttribute('aria-pressed') === 'false')

  // ── a second session appends after existing text, it does not clobber it ──
  await mic.click()
  await page.waitForTimeout(150)
  await page.evaluate(() => window.__say([{ text: 'and email Kayla', final: true }]))
  await page.waitForTimeout(120)
  const second = await description.inputValue()
  check('a second dictation continues after what is already in the field',
    second === 'we should call Bobby tomorrow morning and email Kayla', `got "${second}"`)
  await mic.click()
  await page.waitForTimeout(200)

  // ── typing by hand still works, and dictating after it anchors correctly ──
  await description.click()
  await description.press('End')
  await description.type(' plus a note')
  await page.waitForTimeout(120)
  await mic.click()
  await page.waitForTimeout(150)
  await page.evaluate(() => window.__say([{ text: 'about the invoice', final: true }]))
  await page.waitForTimeout(120)
  const mixed = await description.inputValue()
  check('dictation anchors to text the user typed by hand',
    mixed === 'we should call Bobby tomorrow morning and email Kayla plus a note about the invoice',
    `got "${mixed}"`)
  await mic.click()
  await page.waitForTimeout(200)

  // ── the task actually saves what was dictated ────────────────────────────
  const title = `ZZ Dictated ${stamp}`
  await page.locator('#title').fill(title)
  // Priority is required and has no default, so the submit button stays disabled without it.
  await page.locator('#priority').click()
  await page.getByRole('option', { name: /^3 - Medium$/ }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^Create Task$/i }).click()
  await page.waitForTimeout(2500)
  const { data: saved } = await admin.from('tasks').select('description').eq('title', title).maybeSingle()
  check('the dictated text is what gets saved',
    saved?.description === mixed, `stored "${saved?.description ?? '(no row)'}"`)

  check('no console errors during dictation', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))
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
