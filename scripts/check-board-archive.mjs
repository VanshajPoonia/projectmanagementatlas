// Board archive/restore harness. Dev sandbox only, own fixtures, torn down.
//
// Bobby: "when you archive a board and then restore it, it then makes a double entry of that
// in the system. Test it out."
//
// A single archive/restore round trip was always clean, which is why this went unfixed for a
// while. The duplicate needs a SECOND click before the first write returns: nothing disabled
// the control while it was in flight, and both handlers prepended unconditionally with
// `[board, ...prev]`, so the handler ran twice and the list accepted the same board twice.
//
// The board then appears twice on screen while the database still holds one row, and it
// clears on reload - which is exactly what makes it read as duplicated data rather than a
// rendering glitch. Measured before the fix was written: 2 cards, 1 row.
//
// Every check below asserts BOTH numbers, because agreement between them is the actual
// property under test.
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

let browser, su, plainAdmin, board, board2
const TITLE = `ZZ Archive Probe ${stamp}`
const TITLE2 = `ZZ Archive Probe Two ${stamp}`
try {
  const email = `bs-arch-${stamp}@goatlasgo.us`
  const password = `Probe!${stamp}aA`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  su = { id: data.user.id, email, password }
  await admin.from('profiles').upsert({ id: su.id, email, full_name: 'BS Archive', role: 'super_admin', is_active: true })

  // A plain admin, to prove 110's gate is role-specific and not a blanket break. They must
  // still be able to RENAME a board: 110 narrows one column transition, not the whole row.
  const adminEmail = `bs-arch-plain-${stamp}@goatlasgo.us`
  const { data: pa, error: pae } = await admin.auth.admin.createUser({
    email: adminEmail, password, email_confirm: true,
  })
  if (pae) throw pae
  plainAdmin = { id: pa.user.id, email: adminEmail, password }
  await admin.from('profiles').upsert({ id: plainAdmin.id, email: adminEmail, full_name: 'BS Plain Admin', role: 'admin', is_active: true })

  const { data: b, error: be } = await admin.from('boards').insert({ title: TITLE, created_by: su.id }).select().single()
  if (be) throw be
  board = b
  // A second board, so the in-flight guard can be shown to be per-board rather than global.
  const { data: b2, error: be2 } = await admin.from('boards').insert({ title: TITLE2, created_by: su.id }).select().single()
  if (be2) throw be2
  board2 = b2

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 })

  await page.goto(`${BASE}/admin?tab=boards`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  const onScreen = () => page.getByText(TITLE, { exact: true }).count()

  /**
   * Read the count once it has stopped moving.
   *
   * A fixed sleep after each write made this harness flake: the optimistic state update and
   * the count raced, and "archiving takes the board out of the live list" failed once for that
   * reason alone. Waiting for the expected number instead would bias every check toward
   * passing, so this waits for the number to be STABLE and then reports whatever it is.
   */
  const stableCount = async () => {
    let prev = await onScreen()
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(200)
      const now = await onScreen()
      if (now === prev) return now
      prev = now
    }
    return prev
  }
  const inDb = async () => (await admin.from('boards').select('id').eq('title', TITLE)).data.length
  const archived = async () =>
    ((await admin.from('boards').select('archived_at').eq('title', TITLE)).data[0] ?? {}).archived_at

  check('the board is on screen exactly once to begin with', await stableCount() === 1 && await inDb() === 1)

  const openArchived = async () => {
    const disc = page.getByRole('button', { name: /Archived boards/i })
    if (await disc.count() && (await disc.first().getAttribute('aria-expanded')) !== 'true') {
      await disc.first().click()
      await page.waitForTimeout(300)
    }
  }
  const archiveIt = async () => {
    await page.getByLabel(`Actions for ${TITLE}`).first().click()
    await page.getByRole('menuitem', { name: /archive/i }).click()
    await page.waitForTimeout(1500)
  }

  // ── one clean round trip ─────────────────────────────────────────────────
  await archiveIt()
  const afterArchive = await stableCount()
  check('archiving takes the board out of the live list', afterArchive === 0, `${afterArchive} on screen`)
  check('archiving stamps the row rather than deleting it',
    Boolean(await archived()) && await inDb() === 1)

  await openArchived()
  check('the archived board is listed for a super admin', await stableCount() === 1)

  await page.getByRole('button', { name: /^Restore$/i }).first().click()
  await page.waitForTimeout(1500)
  const afterRestore = await stableCount()
  check('restoring puts the board back exactly once',
    afterRestore === 1 && await inDb() === 1, `${afterRestore} on screen`)
  check('restoring clears the archive stamp', (await archived()) === null)

  // ── a second round trip, in case the first left stale state behind ───────
  await archiveIt()
  await openArchived()
  await page.getByRole('button', { name: /^Restore$/i }).first().click()
  await page.waitForTimeout(1500)
  const afterSecond = await stableCount()
  check('a second round trip still shows the board exactly once',
    afterSecond === 1 && await inDb() === 1, `${afterSecond} on screen`)

  // ── the regression itself: a double-click on Restore ─────────────────────
  await archiveIt()
  await openArchived()
  await page.getByRole('button', { name: /^Restore$/i }).first()
    .click({ clickCount: 2, delay: 30 }).catch(() => {})
  await page.waitForTimeout(2000)
  const doubled = await stableCount()
  check('a double-click on Restore does not double the board',
    doubled === 1 && await inDb() === 1, `${doubled} on screen, ${await inDb()} in db`)

  // ── the same hazard on the archive side ──────────────────────────────────
  await page.getByLabel(`Actions for ${TITLE}`).first().click()
  await page.getByRole('menuitem', { name: /archive/i }).click({ clickCount: 2, delay: 30 }).catch(() => {})
  await page.waitForTimeout(2000)
  await openArchived()
  const afterDoubleArchive = await stableCount()
  check('a double-click on Archive does not double the board',
    afterDoubleArchive === 1 && await inDb() === 1, `${afterDoubleArchive} on screen`)

  // ── the guard is per-board, not a single "something is moving" flag ──────
  //
  // The first fix for the duplicate used one movingBoardId. That silently dropped a click on a
  // DIFFERENT board while the first write was outstanding: nothing happened and nothing said
  // why, which is a worse failure than the duplicate it was preventing.
  {
    // The check above left the board archived; put it back so both boards start live.
    await openArchived()
    await page.getByRole('button', { name: /^Restore$/i }).first().click()
    await page.waitForTimeout(1500)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const isArchived = async (t) =>
      Boolean(((await admin.from('boards').select('archived_at').eq('title', t)).data[0] ?? {}).archived_at)

    await page.getByLabel(`Actions for ${TITLE}`).first().click()
    await page.getByRole('menuitem', { name: /archive/i }).click()
    // No settle: the second click has to land while the first write is still outstanding.
    await page.getByLabel(`Actions for ${TITLE2}`).first().click()
    await page.getByRole('menuitem', { name: /archive/i }).click()
    await page.waitForTimeout(3000)
    const [one, two] = [await isArchived(TITLE), await isArchived(TITLE2)]
    check('archiving a second board while the first is still saving still archives it',
      one && two, `first=${one}, second=${two}`)

    // Put BOTH boards back. Restoring only .first() restored the wrong one: the archived list
    // is ordered archived_at desc, so the second board is at the top and the board under test
    // was left archived, which then failed every later check for reasons that had nothing to
    // do with the code being tested.
    await openArchived()
    for (let i = 0; i < 4; i++) {
      const restores = page.getByRole('button', { name: /^Restore$/i })
      if (await restores.count() === 0) break
      await restores.first().click()
      await page.waitForTimeout(1400)
    }
    check('both boards are live again before the permission checks',
      !(await isArchived(TITLE)) && !(await isArchived(TITLE2)),
      `${TITLE.slice(-4)} archived=${await isArchived(TITLE)}, two archived=${await isArchived(TITLE2)}`)
  }

  // ── the list a reload produces is the one already on screen ──────────────
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await openArchived()
  const afterReload = await stableCount()
  check('a reload agrees with what was on screen', afterReload === 1 && await inDb() === 1,
    `${afterReload} on screen`)

  // ── 110: archiving is super-admin-only, both in the UI and underneath it ──
  {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const p2 = await ctx2.newPage()
    p2.on('dialog', (d) => d.accept())
    await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p2.locator('button[type=submit]').waitFor({ state: 'visible' })
    await p2.fill('input[type=email]', plainAdmin.email)
    await p2.fill('input[type=password]', plainAdmin.password)
    await p2.click('button[type=submit]')
    await p2.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 45000 })
    await p2.goto(`${BASE}/admin?tab=boards`, { waitUntil: 'networkidle' })
    await p2.waitForTimeout(1200)

    check('a plain admin can see the board at all', await p2.getByText(TITLE, { exact: true }).count() === 1)

    await p2.getByLabel(`Actions for ${TITLE}`).first().click()
    await p2.waitForTimeout(400)
    const archiveItems = await p2.getByRole('menuitem', { name: /archive/i }).count()
    check('a plain admin is not offered Archive Board', archiveItems === 0, `${archiveItems} archive items`)
    const editItems = await p2.getByRole('menuitem', { name: /edit board/i }).count()
    check('a plain admin still has the rest of the menu (control)', editItems === 1, `${editItems} edit items`)
    await p2.keyboard.press('Escape')

    await ctx2.close()

    // The button was never the boundary. Make the same write directly as the plain admin,
    // against real RLS and 110's trigger, and confirm the database is the thing refusing.
    const asAdmin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { error: signInErr } = await asAdmin.auth.signInWithPassword({
      email: plainAdmin.email, password: plainAdmin.password,
    })
    if (signInErr) throw signInErr
    const { error: archErr } = await asAdmin
      .from('boards').update({ archived_at: new Date().toISOString() }).eq('id', board.id).select()
    check('the database refuses a plain admin archiving a board',
      Boolean(archErr) && /super admin can archive/i.test(archErr?.message ?? ''),
      archErr?.message ?? '(no error - the write was allowed)')
    check('the board really is still live after that attempt', (await archived()) === null)

    // Control: the same person may still rename it, so 110 narrowed a transition, not the row.
    const { data: renamed, error: renameErr } = await asAdmin
      .from('boards').update({ title: `${TITLE} renamed` }).eq('id', board.id).select('id, title')
    check('a plain admin can still rename a board (control)',
      !renameErr && renamed?.length === 1, renameErr?.message ?? `${renamed?.length ?? 0} rows`)
    await admin.from('boards').update({ title: TITLE }).eq('id', board.id)
    await asAdmin.auth.signOut()
  }
} finally {
  if (browser) await browser.close()
  if (board) await admin.from('boards').delete().eq('id', board.id)
  if (board2) await admin.from('boards').delete().eq('id', board2.id)
  if (su) await admin.auth.admin.deleteUser(su.id)
  if (plainAdmin) await admin.auth.admin.deleteUser(plainAdmin.id)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
  process.exit(1)
}
