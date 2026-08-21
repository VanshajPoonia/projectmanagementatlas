// Board navigation + column renaming harness. Dev sandbox only, own fixtures, torn down.
//
// Everything here is checked in a REAL browser because none of it is visible from the
// database. CLAUDE.md's standing lesson is that a passing RLS harness does not mean a
// feature works: the three things this pins were all correct at the database and wrong
// above it.
//
//   1. THE BOARD SWITCHER opens a board on the surface the viewer's ROLE entitles them to.
//      /dashboard/board/<id> passes isAdmin={false} deliberately, so a switcher that built
//      its links from that flag would keep an admin in the stripped surface for every board
//      they opened next - and for every board they starred, since a favourite stores the
//      href it was created from.
//
//   2. THE HEADER NAV keeps its ?tab= and follows app_modules. It used to be two hardcoded
//      arrays keyed off the same isAdmin flag, pushing a bare /admin | /dashboard: an admin
//      clicking "Boards" from a board wrote the wrong sessionStorage key, landed on
//      /dashboard, was redirected to /admin with the query string dropped, and arrived on
//      whatever tab they last had open.
//
//   3. RENAMING A LINKED COLUMN renames the STATUS, and 107's cascade carries it to every
//      board. A column linked to a status is named by that status; writing columns.title on
//      one board would look saved and be silently reverted by the next status rename.
//      task_statuses is super-admin-only (069), so the plain-admin case is pinned too - it
//      is the control that proves the gate is role-specific and not a blanket break.
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

const people = {}
async function mkUser(tag, role) {
  const email = `bs-${tag}-${stamp}@goatlasgo.us`
  const password = `Probe!${stamp}aA`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  await admin.from('profiles').upsert({ id: data.user.id, email, full_name: `BS ${tag}`, role, is_active: true })
  people[tag] = { id: data.user.id, email, password }
  return people[tag]
}

/**
 * Sign in and wait until the app has actually moved off /login.
 *
 * ⚠️ The fill must happen AFTER hydration. The login form validates the email against React
 * state, not against the DOM input, so filling a not-yet-hydrated page writes a value no
 * onChange ever saw and the form rejects its own populated field with "Only @goatlasgo.us
 * email addresses are allowed." That failed exactly once in this harness, on the second
 * browser context, and read like a product bug - hence the retry and the quoted alert.
 */
async function login(page, who) {
  const attempt = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    // The submit button is rendered by the same component as the inputs, so waiting for it
    // to be enabled is the closest signal available that React is driving the form.
    await page.locator('button[type=submit]').waitFor({ state: 'visible' })
    await page.fill('input[type=email]', who.email)
    await page.fill('input[type=password]', who.password)
    await page.click('button[type=submit]')
    await page.waitForURL(u => !/\/login/.test(u.toString()), { timeout: 45000 })
  }

  try {
    await attempt()
  } catch {
    try {
      await attempt()
    } catch {
      const alertText = await page.locator('[role=alert]').allInnerTexts().catch(() => [])
      throw new Error(`login as ${who.email} did not leave /login${alertText.length ? `: ${alertText.join(' | ').trim()}` : ' (no error shown)'}`)
    }
  }
}

let browser, boardA, boardB, statusBefore
try {
  const su = await mkUser('super', 'super_admin')
  const ad = await mkUser('admin', 'admin')

  // Two throwaway boards so the switcher has somewhere to go, each with its own columns.
  const { data: statuses } = await admin.from('task_statuses').select('id, key, label').eq('is_archived', false).order('position')
  statusBefore = statuses.find(s => s.key === 'to_do')

  const mkBoard = async (title) => {
    const { data, error } = await admin.from('boards').insert({ title, created_by: su.id }).select().single()
    if (error) throw error
    await admin.from('columns').insert(statuses.map((s, i) => ({
      board_id: data.id, title: s.label, status_key: s.key, position: i,
    })))
    return data
  }
  boardA = await mkBoard(`ZZ Switcher A ${stamp}`)
  boardB = await mkBoard(`ZZ Switcher B ${stamp}`)

  browser = await chromium.launch()

  // ── 1. super admin: switcher + routing + column rename ────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await login(page, su)

    // Land on the STRIPPED surface on purpose - this is the routing trap.
    await page.goto(`${BASE}/dashboard/board/${boardA.id}`, { waitUntil: 'networkidle' })

    const trigger = page.getByRole('button', { name: /Switch board\. Currently on/ })
    check('board switcher is present on the board header', await trigger.count() === 1)

    await trigger.click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ state: 'visible', timeout: 5000 })
    const names = await menu.getByRole('menuitem').allInnerTexts()
    check('switcher lists both boards', names.some(n => n.includes('ZZ Switcher A')) && names.some(n => n.includes('ZZ Switcher B')),
      `${names.length} entries`)

    await menu.getByRole('menuitem', { name: new RegExp(`ZZ Switcher B ${stamp}`) }).click()
    // ⚠️ Wait on the DESTINATION board's id, not on /board/ - the page this starts from
    // already matches that, so a looser pattern resolves instantly and every assertion after
    // it measures the page we were trying to leave.
    await page.waitForURL(u => u.toString().includes(boardB.id), { timeout: 15000 })
    await page.waitForLoadState('networkidle')
    check('switching board navigates to the ADMIN surface, not the stripped one',
      page.url().includes(`/admin/board/${boardB.id}`), page.url().replace(BASE, ''))
    check('the admin surface really is admin (Add Column is present)',
      await page.getByRole('button', { name: /Add Column/i }).count() > 0)

    // ── the header nav: one "Go to" menu, and its contents ──
    // It is a menu rather than a strip of icon buttons on purpose. Sourcing the list from
    // buildWorkspaceNav grew it from four hardcoded entries to a dozen, and a dozen icon
    // buttons ate the middle of the header - measured, not guessed: the board title was
    // squeezed out of its own page and the description reflowed to one word per line.
    await page.goto(`${BASE}/admin/board/${boardA.id}`, { waitUntil: 'networkidle' })
    const openNav = async () => {
      await page.getByRole('button', { name: 'Go to another section' }).click()
      const m = page.getByRole('menu')
      await m.waitFor({ state: 'visible', timeout: 5000 })
      return m
    }

    const navMenu = await openNav()
    const navLabels = await navMenu.getByRole('menuitem').allInnerTexts()
    const { data: crmRow } = await admin.from('app_modules').select('enabled').eq('module_key', 'crm').maybeSingle()
    check('board header nav follows app_modules for CRM',
      navLabels.includes('CRM') === Boolean(crmRow?.enabled),
      `crm enabled=${crmRow?.enabled}, in menu=${navLabels.includes('CRM')}`)
    check('board header nav offers My Work (not a module, never hideable)',
      navLabels.includes('My Work'), navLabels.join(', '))
    await page.keyboard.press('Escape')

    // The header must stay one row, with the title readable, however many modules are on.
    const header = await page.evaluate(() => {
      const h1 = document.querySelector('header h1')
      return {
        pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        titleWidth: h1 ? Math.round(h1.getBoundingClientRect().width) : 0,
        headerHeight: Math.round(document.querySelector('header').getBoundingClientRect().height),
      }
    })
    check('the board header does not push the page sideways', !header.pageScrollsSideways)
    check('the board title still has real width in the header',
      header.titleWidth > 100, `${header.titleWidth}px wide, header ${header.headerHeight}px tall`)

    // ── routing: leaving a board must keep its tab AND its host ──
    // Start from the STRIPPED surface, which is where the old code got this wrong: it
    // pushed a bare /dashboard, which redirects an admin to /admin and drops the query.
    await page.goto(`${BASE}/dashboard/board/${boardA.id}`, { waitUntil: 'networkidle' })
    const navMenu2 = await openNav()
    await navMenu2.getByRole('menuitem', { name: 'Boards', exact: true }).click()
    await page.waitForURL(u => !/\/board\//.test(u.toString()), { timeout: 15000 })
    check('nav from a board keeps its tab and lands on the admin host',
      page.url().includes('/admin?tab=boards'), page.url().replace(BASE, ''))

    // ── the phone bar keeps the board-relevant destinations on the bar itself ──
    // Nav order is the sidebar's, where Home/My Work/Personal/Calendar/Marketing come first,
    // so a naive slice(0,5) buries Boards and Chat in the "More" drawer on the one screen
    // that IS a board. This is the check that would catch that coming back.
    const phone = await ctx.newPage()
    await phone.setViewportSize({ width: 390, height: 844 })
    await phone.goto(`${BASE}/admin/board/${boardA.id}`, { waitUntil: 'networkidle' })
    await phone.waitForTimeout(600)
    const barLabels = await phone.evaluate(() => {
      const bar = document.querySelector('nav.fixed, [class*="fixed"][class*="bottom-0"]')
      if (!bar) return null
      return Array.from(bar.querySelectorAll('button')).map(b => b.textContent.trim())
    })
    check('the phone bar keeps Boards reachable without opening More',
      Array.isArray(barLabels) && barLabels.includes('Boards'), (barLabels || []).join(', '))
    await phone.close()

    // ── column rename (linked column -> renames the status everywhere) ──
    await page.goto(`${BASE}/admin/board/${boardA.id}`, { waitUntil: 'networkidle' })
    const newLabel = `Backlog ${stamp}`
    const col = page.locator('section', { has: page.getByRole('heading', { name: statusBefore.label, exact: true }) }).first()
    await col.getByRole('button').filter({ hasNot: page.locator('svg.lucide-plus') }).last().click()
    await page.getByRole('menuitem', { name: /Rename Column/i }).click()
    const dlg = page.getByRole('dialog')
    await dlg.waitFor({ state: 'visible' })
    const desc = await dlg.innerText()
    check('rename dialog states the change is workspace-wide for a linked column',
      /every column tracking it on every board/i.test(desc))
    await dlg.getByLabel('Name').fill(newLabel)
    await dlg.getByRole('button', { name: 'Rename', exact: true }).click()
    await dlg.waitFor({ state: 'hidden', timeout: 15000 })
    await page.waitForTimeout(1200)

    check('the column on screen now shows the new name',
      await page.getByRole('heading', { name: newLabel, exact: true }).count() > 0)

    const { data: st } = await admin.from('task_statuses').select('label').eq('id', statusBefore.id).single()
    check('the STATUS was renamed in the database', st.label === newLabel, st.label)

    const { data: cascaded } = await admin.from('columns').select('title, board_id').eq('status_key', statusBefore.key)
    const allRenamed = cascaded.every(c => c.title === newLabel)
    check('the rename cascaded to every board', allRenamed, `${cascaded.length} columns, ${cascaded.filter(c => c.title === newLabel).length} renamed`)

    check('no console errors during the whole super-admin pass', errors.length === 0, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ── 2. plain admin: rename is refused at the UI, honestly ─────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await login(page, ad)
    await page.goto(`${BASE}/admin/board/${boardA.id}`, { waitUntil: 'networkidle' })

    const col = page.locator('section').filter({ has: page.getByRole('heading', { name: /Backlog/ }) }).first()
    await col.getByRole('button').filter({ hasNot: page.locator('svg.lucide-plus') }).last().click()
    await page.getByRole('menuitem', { name: /Rename Column/i }).click()
    const dlg = page.getByRole('dialog')
    await dlg.waitFor({ state: 'visible' })
    const txt = await dlg.innerText()
    check('a plain admin is told a linked rename is super-admin-only',
      /Only a super admin can rename a status/i.test(txt))
    check('and the Rename button is disabled rather than failing at the database',
      await dlg.getByRole('button', { name: 'Rename', exact: true }).isDisabled())
    await ctx.close()
  }
} catch (e) {
  check('harness completed without throwing', false, e.message)
  console.error(e)
} finally {
  // Restore the status label and clean up.
  try {
    if (statusBefore) {
      await admin.from('task_statuses').update({ label: statusBefore.label }).eq('id', statusBefore.id)
      await admin.from('columns').update({ title: statusBefore.label }).eq('status_key', statusBefore.key)
    }
    for (const b of [boardA, boardB]) if (b) await admin.from('boards').delete().eq('id', b.id)
    for (const p of Object.values(people)) await admin.auth.admin.deleteUser(p.id)
  } catch (e) { console.error('cleanup:', e.message) }
  if (browser) await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
